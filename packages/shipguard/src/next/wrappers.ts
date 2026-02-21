import path from "node:path";
import { readFileSync } from "node:fs";
import ts from "typescript";
import type {
  NextRoute,
  WrapperIndex,
  WrapperAnalysis,
  WrapperEvidence,
  NextMiddlewareIndex,
  NextHints,
  ProtectionSummary,
  ProtectionStatus,
} from "./types.js";
import type { ResolveOptions } from "../util/resolve.js";
import { resolveImportPath, followReExport } from "../util/resolve.js";
import { extractHofWrapperChain, findImportSource } from "../util/hof.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildWrapperIndex(
  routes: NextRoute[],
  rootDir: string,
  resolveOpts: ResolveOptions,
  authFunctions: string[],
  rateLimitWrappers: string[],
): WrapperIndex {
  const wrapperMap = new Map<string, WrapperAnalysis>();

  // Phase A: Extract wrapper calls from all route files
  for (const route of routes) {
    const src = readSource(rootDir, route.file);
    if (!src) continue;

    const chain = extractHofWrapperChain(src);
    for (const wrapperName of chain) {
      let entry = wrapperMap.get(wrapperName);
      if (!entry) {
        // Phase B: Resolve and analyze on first encounter
        const importSource = findImportSource(src, wrapperName);
        const definition = resolveWrapper(
          wrapperName,
          importSource,
          route.file,
          src,
          rootDir,
          resolveOpts,
        );

        let evidence: WrapperEvidence = {
          authCallPresent: false,
          authEnforced: false,
          rateLimitCallPresent: false,
          rateLimitEnforced: false,
          authDetails: [],
          rateLimitDetails: [],
        };

        if (definition) {
          // Phase C: Analyze wrapper body
          evidence = analyzeWrapperBody(
            wrapperName,
            definition.src,
            authFunctions,
            rateLimitWrappers,
          );
        }

        entry = {
          name: wrapperName,
          definitionFile: definition?.file,
          resolved: definition !== undefined,
          evidence,
          usageCount: 0,
          usageFiles: [],
          mutationRouteCount: 0,
        };
        wrapperMap.set(wrapperName, entry);
      }

      // Aggregate usage
      entry.usageCount++;
      entry.usageFiles.push(route.file);
      if (
        route.signals.hasMutationEvidence ||
        route.signals.hasDbWriteEvidence ||
        route.signals.hasStripeWriteEvidence
      ) {
        entry.mutationRouteCount++;
      }
    }
  }

  return { wrappers: wrapperMap };
}

/**
 * Compute ProtectionSummary for a route based on wrapper evidence,
 * middleware coverage, and direct auth/rate-limit calls.
 */
export function computeProtection(
  route: NextRoute,
  wrapperIndex: WrapperIndex,
  middleware: NextMiddlewareIndex,
  hints: NextHints,
  rootDir: string,
): ProtectionSummary {
  const src = readSource(rootDir, route.file);
  const chain = src ? extractHofWrapperChain(src) : [];

  const auth = computeAuthProtection(route, chain, wrapperIndex, middleware, hints, src);
  const rateLimit = computeRateLimitProtection(route, chain, wrapperIndex, middleware, hints, src);

  return { auth, rateLimit };
}

// ---------------------------------------------------------------------------
// Wrapper Resolution (Phase B)
// ---------------------------------------------------------------------------

function resolveWrapper(
  wrapperName: string,
  importSource: string | undefined,
  routeFile: string,
  routeSrc: string,
  rootDir: string,
  resolveOpts: ResolveOptions,
): { file: string; src: string } | undefined {
  // 1. Same file — wrapper defined in the route file
  if (!importSource) {
    if (hasLocalDefinition(routeSrc, wrapperName)) {
      return { file: routeFile, src: routeSrc };
    }
    return undefined;
  }

  // 2. Resolve the import to a file
  const resolvedFile = resolveImportPath(routeFile, importSource, resolveOpts);
  if (!resolvedFile) return undefined;

  // 3. Follow re-exports (barrel pattern), up to 5 hops
  return followReExport(wrapperName, resolvedFile, resolveOpts, 5);
}

function hasLocalDefinition(src: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*[(<]|` +
    `(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*[=:]`,
    "m",
  ).test(src);
}

// ---------------------------------------------------------------------------
// Wrapper Body Analysis (Phase C) — TypeScript AST
// ---------------------------------------------------------------------------

export function analyzeWrapperBody(
  wrapperName: string,
  src: string,
  authFunctions: string[],
  rateLimitWrappers: string[],
): WrapperEvidence {
  const evidence: WrapperEvidence = {
    authCallPresent: false,
    authEnforced: false,
    rateLimitCallPresent: false,
    rateLimitEnforced: false,
    authDetails: [],
    rateLimitDetails: [],
  };

  // Parse with TypeScript
  const sourceFile = ts.createSourceFile(
    "wrapper.ts",
    src,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    ts.ScriptKind.TSX,
  );

  // Check for known imports at file level (imports are outside function bodies)
  checkKnownImports(src, evidence);

  // Find the wrapper function declaration
  const wrapperBody = findFunctionBody(sourceFile, wrapperName);
  if (!wrapperBody) {
    // Fallback: analyze the entire file if we can't isolate the function
    analyzeNodeForEvidence(sourceFile, authFunctions, rateLimitWrappers, evidence);
    return evidence;
  }

  analyzeNodeForEvidence(wrapperBody, authFunctions, rateLimitWrappers, evidence);
  return evidence;
}

function findFunctionBody(sourceFile: ts.SourceFile, name: string): ts.Node | undefined {
  let result: ts.Node | undefined;

  function visit(node: ts.Node): void {
    if (result) return;

    // function name(...) { ... }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) {
      result = node.body;
      return;
    }

    // const name = (...) => { ... } or const name = function(...) { ... }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          result = extractFunctionBodyFromExpression(decl.initializer);
          if (result) return;
        }
      }
    }

    // export function name(...) { ... } — also captured by FunctionDeclaration check above
    // export const name = ...
    if (ts.isExportAssignment(node) || ts.isExportDeclaration(node)) {
      // Skip — we handle exports via VariableStatement
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

function extractFunctionBodyFromExpression(expr: ts.Expression): ts.Node | undefined {
  // Arrow function: (...) => { ... } or (...) => expr
  if (ts.isArrowFunction(expr)) {
    return expr.body;
  }

  // Function expression: function(...) { ... }
  if (ts.isFunctionExpression(expr)) {
    return expr.body;
  }

  // Call expression returning a function: someHelper((...) => { ... })
  // This handles factory patterns like: const withWorkspace = createWrapper((req) => { ... })
  if (ts.isCallExpression(expr)) {
    // Check all arguments for function expressions
    for (const arg of expr.arguments) {
      const body = extractFunctionBodyFromExpression(arg as ts.Expression);
      if (body) return body;
    }
    // Also check the function itself if it's another call (chained)
    return extractFunctionBodyFromExpression(expr.expression as ts.Expression);
  }

  return undefined;
}

/**
 * Check for known package imports at the file level.
 * This runs against the full source, not just the function body,
 * since imports are always at the top of the file.
 */
function checkKnownImports(fileSrc: string, evidence: WrapperEvidence): void {
  if (/@upstash\/ratelimit/.test(fileSrc)) {
    evidence.rateLimitCallPresent = true;
    evidence.rateLimitDetails.push("imports @upstash/ratelimit");
  }
  if (/@arcjet\/next/.test(fileSrc)) {
    evidence.rateLimitCallPresent = true;
    evidence.rateLimitDetails.push("imports @arcjet/next");
  }
  if (/@unkey\/ratelimit/.test(fileSrc)) {
    evidence.rateLimitCallPresent = true;
    evidence.rateLimitDetails.push("imports @unkey/ratelimit");
  }
}

function analyzeNodeForEvidence(
  node: ts.Node,
  authFunctions: string[],
  rateLimitWrappers: string[],
  evidence: WrapperEvidence,
): void {
  const authSet = new Set(authFunctions);
  const rlSet = new Set(rateLimitWrappers);

  const src = node.getFullText();

  // Auth: check for known function calls
  for (const fn of authFunctions) {
    const pattern = new RegExp(`\\b${escapeRegex(fn)}\\s*\\(`, "m");
    if (pattern.test(src)) {
      evidence.authCallPresent = true;
      evidence.authDetails.push(`calls ${fn}()`);
    }
  }

  // Auth: built-in patterns (Supabase .auth.getUser(), .auth.getSession())
  if (/\.auth\.getUser\s*\(/.test(src)) {
    evidence.authCallPresent = true;
    evidence.authEnforced = true;
    evidence.authDetails.push("calls .auth.getUser()");
  }
  if (/\.auth\.getSession\s*\(/.test(src)) {
    evidence.authCallPresent = true;
    evidence.authEnforced = true;
    evidence.authDetails.push("calls .auth.getSession()");
  }

  // Auth: webhook/cron signature verification patterns
  if (/stripe\.webhooks\.constructEvent\s*\(/.test(src)) {
    evidence.authCallPresent = true;
    evidence.authEnforced = true;
    evidence.authDetails.push("verifies Stripe webhook signature");
  }
  if (/workos\.webhooks\.constructEvent\s*\(/.test(src)) {
    evidence.authCallPresent = true;
    evidence.authEnforced = true;
    evidence.authDetails.push("verifies WorkOS webhook signature");
  }
  if (/verifyVercelSignature\s*\(/.test(src)) {
    evidence.authCallPresent = true;
    evidence.authEnforced = true;
    evidence.authDetails.push("verifies Vercel cron signature");
  }
  if (/verifyQstashSignature\s*\(/.test(src)) {
    evidence.authCallPresent = true;
    evidence.authEnforced = true;
    evidence.authDetails.push("verifies QStash signature");
  }
  if (/createHmac\s*\(/.test(src) && /signature/i.test(src)) {
    evidence.authCallPresent = true;
    evidence.authEnforced = true;
    evidence.authDetails.push("HMAC signature verification");
  }
  if (/timingSafeEqual\s*\(/.test(src)) {
    evidence.authCallPresent = true;
    evidence.authEnforced = true;
    evidence.authDetails.push("timing-safe comparison (signature verification)");
  }

  // Rate limit: known wrappers
  for (const fn of rateLimitWrappers) {
    const pattern = new RegExp(`\\b${escapeRegex(fn)}\\s*[.(]`, "m");
    if (pattern.test(src)) {
      evidence.rateLimitCallPresent = true;
      evidence.rateLimitDetails.push(`calls ${fn}()`);
    }
  }

  // Check for enforcement via AST (don't overwrite if already proven by built-in patterns)
  if (evidence.authCallPresent && !evidence.authEnforced) {
    evidence.authEnforced = detectEnforcement(node, authSet, "auth");
    if (evidence.authEnforced) {
      evidence.authDetails.push("enforces: conditional throw/return on auth failure");
    }
  }

  if (evidence.rateLimitCallPresent && !evidence.rateLimitEnforced) {
    evidence.rateLimitEnforced = detectEnforcement(node, rlSet, "rateLimit");
    if (evidence.rateLimitEnforced) {
      evidence.rateLimitDetails.push("enforces: conditional throw/return on rate limit");
    }
  }
}

/**
 * Detect if auth/rate-limit calls are enforced (result checked + throw/return on failure).
 *
 * Heuristics:
 * 1. The result of the call is stored in a variable (or destructured)
 * 2. An if-statement or ternary checks the result (negation or falsy check)
 * 3. The consequent throws, returns, or redirects
 *
 * Also covers common patterns:
 * - `if (!session) throw/return`
 * - `if (!success) throw/return Response(...429)`
 * - `session ?? throw new Error()`
 * - Early return patterns
 */
function detectEnforcement(
  node: ts.Node,
  functionNames: Set<string>,
  kind: "auth" | "rateLimit",
): boolean {
  const src = node.getFullText();

  if (kind === "auth") {
    // Pattern: if (!session/!user/!token) throw/return/redirect
    if (/if\s*\(\s*!(?:session|user|token|currentUser|auth)\b/.test(src)) {
      if (/\bthrow\b|\breturn\b|NextResponse\.redirect|NextResponse\.json|Response\.json|new Response/.test(src)) {
        return true;
      }
    }
    // Pattern: session ?? throw / || throw
    if (/(?:session|user|token|auth)\s*(?:\?\?|\|\|)\s*(?:throw|null)/.test(src)) {
      return true;
    }
    // Pattern: throw or return right after the auth call (within a few lines)
    // This catches: const session = await auth(); if (!session) { return ... }
    if (/(?:auth|getSession|getServerSession|currentUser|getUser|validateRequest|getIronSession)\s*\([\s\S]{0,200}if\s*\(\s*!/.test(src)) {
      if (/\bthrow\b|\breturn\b|redirect/.test(src)) {
        return true;
      }
    }
  }

  if (kind === "rateLimit") {
    // Pattern: if (!success) or if (remaining <= 0) throw/return 429
    if (/if\s*\(\s*!success\b/.test(src) || /if\s*\(\s*remaining\s*<=?\s*0/.test(src)) {
      if (/\bthrow\b|\breturn\b|429|too\s*many/i.test(src)) {
        return true;
      }
    }
    // Pattern: destructure { success } and check
    if (/\{\s*success\s*\}/.test(src) && /!success/.test(src)) {
      return true;
    }
    // Pattern: .limit( followed by conditional throw/return
    if (/\.limit\s*\([\s\S]{0,200}(?:throw|return\s+(?:new\s+)?Response|429)/m.test(src)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Protection Computation
// ---------------------------------------------------------------------------

function computeAuthProtection(
  route: NextRoute,
  chain: string[],
  wrapperIndex: WrapperIndex,
  middleware: NextMiddlewareIndex,
  hints: NextHints,
  src: string | null,
): ProtectionStatus {
  const status: ProtectionStatus = {
    satisfied: false,
    enforced: false,
    sources: [],
    details: [],
    unverifiedWrappers: [],
  };

  // 1. Direct auth call in route (hint-based)
  if (src) {
    for (const fn of hints.auth.functions) {
      const pattern = new RegExp(`\\b${escapeRegex(fn)}\\s*\\(`, "m");
      if (pattern.test(src)) {
        status.satisfied = true;
        status.enforced = true; // Trust direct calls in-handler (same as before)
        status.sources.push("direct");
        status.details.push(`calls ${fn}()`);
        return status;
      }
    }

    // Hint-based HOF wrapping (explicit hint = hard allow)
    for (const fn of hints.auth.functions) {
      const escaped = escapeRegex(fn);
      const hofPattern = new RegExp(
        `export\\s+(?:const|let|var)\\s+(?:GET|POST|PUT|PATCH|DELETE)\\s*=\\s*${escaped}\\s*\\(`,
        "m",
      );
      if (hofPattern.test(src)) {
        status.satisfied = true;
        status.enforced = true;
        status.sources.push("hint");
        status.details.push(`wrapped by ${fn}() (in hints)`);
        return status;
      }
      const defaultPattern = new RegExp(`export\\s+default\\s+${escaped}\\s*\\(`, "m");
      if (defaultPattern.test(src)) {
        status.satisfied = true;
        status.enforced = true;
        status.sources.push("hint");
        status.details.push(`wrapped by ${fn}() (in hints)`);
        return status;
      }
    }
  }

  // 2. Wrapper evidence from introspection
  for (const wrapperName of chain) {
    const wrapper = wrapperIndex.wrappers.get(wrapperName);
    if (!wrapper) continue;

    if (wrapper.resolved && wrapper.evidence.authEnforced) {
      status.satisfied = true;
      status.enforced = true;
      status.sources.push("wrapper");
      status.details.push(`${wrapperName}() enforces auth: ${wrapper.evidence.authDetails.join(", ")}`);
      return status;
    }

    if (wrapper.resolved && wrapper.evidence.authCallPresent && !wrapper.evidence.authEnforced) {
      status.unverifiedWrappers.push(wrapperName);
      status.details.push(`${wrapperName}() calls auth but enforcement not proven`);
    } else if (wrapper.resolved && !wrapper.evidence.authCallPresent) {
      // Resolved wrapper with no auth at all — defer to WRAPPER-UNRECOGNIZED
      status.unverifiedWrappers.push(wrapperName);
      status.details.push(`${wrapperName}() resolved but has no auth evidence`);
    }

    if (!wrapper.resolved) {
      status.unverifiedWrappers.push(wrapperName);
      status.details.push(`${wrapperName}() could not be resolved`);
    }
  }

  // 3. Middleware coverage
  if (middleware.authLikely) {
    const pathname = route.pathname ?? "";
    const matchers = middleware.matcherPatterns;
    const covered = matchers.length === 0 || matchers.some((m) => pathnameMatchesMatcher(pathname, m));
    if (covered) {
      status.satisfied = true;
      status.enforced = true;
      status.sources.push("middleware");
      status.details.push("middleware.ts provides auth for this route");
      return status;
    }
  }

  return status;
}

function computeRateLimitProtection(
  route: NextRoute,
  chain: string[],
  wrapperIndex: WrapperIndex,
  middleware: NextMiddlewareIndex,
  hints: NextHints,
  src: string | null,
): ProtectionStatus {
  const status: ProtectionStatus = {
    satisfied: false,
    enforced: false,
    sources: [],
    details: [],
    unverifiedWrappers: [],
  };

  // 1. Direct rate-limit call in route (hint-based)
  if (src) {
    for (const fn of hints.rateLimit.wrappers) {
      const pattern = new RegExp(`\\b${escapeRegex(fn)}\\s*[.(]`, "m");
      if (pattern.test(src)) {
        status.satisfied = true;
        status.enforced = true;
        status.sources.push("direct");
        status.details.push(`calls ${fn}()`);
        return status;
      }
    }

    // Known RL package imports
    const rlImports = [/@upstash\/ratelimit/, /rate-limiter-flexible/, /@arcjet\/next/, /@unkey\/ratelimit/];
    for (const pat of rlImports) {
      if (pat.test(src)) {
        status.satisfied = true;
        status.enforced = true;
        status.sources.push("direct");
        status.details.push(`imports ${pat.source}`);
        return status;
      }
    }

    // Hint-based HOF wrapping (explicit hint = hard allow)
    for (const fn of hints.rateLimit.wrappers) {
      const escaped = escapeRegex(fn);
      const hofPattern = new RegExp(
        `export\\s+(?:const|let|var)\\s+(?:GET|POST|PUT|PATCH|DELETE)\\s*=\\s*${escaped}\\s*\\(`,
        "m",
      );
      if (hofPattern.test(src)) {
        status.satisfied = true;
        status.enforced = true;
        status.sources.push("hint");
        status.details.push(`wrapped by ${fn}() (in hints)`);
        return status;
      }
    }
  }

  // 2. Wrapper evidence from introspection
  for (const wrapperName of chain) {
    const wrapper = wrapperIndex.wrappers.get(wrapperName);
    if (!wrapper) continue;

    if (wrapper.resolved && wrapper.evidence.rateLimitEnforced) {
      status.satisfied = true;
      status.enforced = true;
      status.sources.push("wrapper");
      status.details.push(`${wrapperName}() enforces rate limiting: ${wrapper.evidence.rateLimitDetails.join(", ")}`);
      return status;
    }

    if (wrapper.resolved && wrapper.evidence.rateLimitCallPresent && !wrapper.evidence.rateLimitEnforced) {
      status.unverifiedWrappers.push(wrapperName);
      status.details.push(`${wrapperName}() calls rate limiter but enforcement not proven`);
    } else if (wrapper.resolved && !wrapper.evidence.rateLimitCallPresent) {
      // Resolved wrapper with no RL at all — defer to WRAPPER-UNRECOGNIZED
      status.unverifiedWrappers.push(wrapperName);
      status.details.push(`${wrapperName}() resolved but has no rate-limit evidence`);
    }

    if (!wrapper.resolved) {
      status.unverifiedWrappers.push(wrapperName);
      status.details.push(`${wrapperName}() could not be resolved`);
    }
  }

  // 3. Middleware coverage
  if (middleware.rateLimitLikely) {
    status.satisfied = true;
    status.enforced = true;
    status.sources.push("middleware");
    status.details.push("middleware.ts provides rate limiting");
    return status;
  }

  return status;
}

function pathnameMatchesMatcher(pathname: string, matcher: string): boolean {
  if (matcher.endsWith("/:path*")) {
    const prefix = matcher.replace("/:path*", "");
    return pathname.startsWith(prefix);
  }
  if (matcher.endsWith("(.*)")) {
    const prefix = matcher.replace("(.*)", "");
    return pathname.startsWith(prefix);
  }
  return pathname === matcher || pathname.startsWith(matcher + "/");
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function readSource(rootDir: string, file: string): string | null {
  try {
    return readFileSync(path.join(rootDir, file), "utf8");
  } catch {
    return null;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
