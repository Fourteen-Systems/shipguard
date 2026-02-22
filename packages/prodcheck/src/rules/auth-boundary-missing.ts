import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextIndex, NextRoute, NextServerAction } from "../next/types.js";
import type { Finding, ProdcheckConfig } from "../engine/types.js";
import type { Confidence, Severity } from "../next/types.js";
import { isAllowlisted } from "../util/paths.js";

export const RULE_ID = "AUTH-BOUNDARY-MISSING";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, med: 2, low: 1 };

function severityFromConfidence(confidence: Confidence, maxSeverity: string): Severity {
  const max = maxSeverity as Severity;
  const maxRank = SEVERITY_RANK[max] ?? 4;
  // high confidence → use max severity (typically critical)
  // med confidence → cap at high
  const computed: Severity = confidence === "high" ? max : "high";
  const computedRank = SEVERITY_RANK[computed] ?? 3;
  return computedRank > maxRank ? max : computed;
}

export function run(index: NextIndex, config: ProdcheckConfig): Finding[] {
  const findings: Finding[] = [];
  const maxSeverity = config.rules[RULE_ID]?.severity ?? "critical";

  const authAllowlist = config.hints.auth.allowlistPaths;

  // Check mutation route handlers
  for (const route of index.routes.mutationRoutes) {
    if (route.publicIntent) continue; // Auth absence is intentional — structured suppression
    if (isAllowlisted(route.file, authAllowlist)) continue;
    const result = checkRoute(route, index, config);
    if (result) {
      const pathname = route.pathname ?? route.file;
      const isWebhook = /webhook/i.test(pathname);
      findings.push({
        ruleId: RULE_ID,
        severity: severityFromConfidence(result.confidence, maxSeverity),
        confidence: result.confidence,
        message: isWebhook
          ? `Webhook endpoint processes payloads without signature verification`
          : `Route handler performs mutations without a recognized auth boundary`,
        file: route.file,
        line: result.line,
        snippet: result.snippet,
        evidence: result.evidence,
        confidenceRationale: result.confidenceRationale,
        remediation: isWebhook
          ? [
              "Verify the provider's webhook signature before processing the payload",
              "Examples: Stripe `constructEvent()`, GitHub HMAC, Google Pub/Sub JWT, Slack `verifyRequest()`",
              "Use `crypto.timingSafeEqual()` for HMAC comparisons to prevent timing attacks",
            ]
          : [
              "Add an auth check at the top of the handler (e.g., `const session = await auth()`)",
              "Ensure middleware.ts protects this route segment",
              "If using a custom auth wrapper, add it to hints.auth.functions in prodcheck.config.json",
            ],
        tags: isWebhook
          ? ["auth", "webhook", "server"]
          : ["auth", "server"],
      });
    }
  }

  // Check mutation server actions (deduplicate by file since auth check is file-level)
  const seenActionFiles = new Set<string>();
  for (const action of index.serverActions.mutationActions) {
    if (seenActionFiles.has(action.file)) continue;
    seenActionFiles.add(action.file);
    if (isAllowlisted(action.file, authAllowlist)) continue;
    const result = checkServerAction(action, index, config);
    if (result) {
      findings.push({
        ruleId: RULE_ID,
        severity: severityFromConfidence(result.confidence, maxSeverity),
        confidence: result.confidence,
        message: `Server action performs mutations without a recognized auth boundary`,
        file: action.file,
        line: result.line,
        snippet: result.snippet,
        evidence: result.evidence,
        confidenceRationale: result.confidenceRationale,
        remediation: [
          "Add an auth check at the top of the server action",
          "If using a custom auth wrapper, add it to hints.auth.functions in prodcheck.config.json",
        ],
        tags: ["auth", "server-action"],
      });
    }
  }

  // Check tRPC mutation procedures
  for (const proc of index.trpc.mutationProcedures) {
    if (proc.procedureType === "protected") continue;
    if (isAllowlisted(proc.file, authAllowlist)) continue;

    const confidence: Confidence = proc.procedureType === "public" ? "high" : "med";
    findings.push({
      ruleId: RULE_ID,
      severity: severityFromConfidence(confidence, maxSeverity),
      confidence,
      message: `tRPC mutation "${proc.name}" uses ${proc.procedureType}Procedure without auth boundary`,
      file: proc.file,
      line: proc.line,
      evidence: [`${proc.procedureType}Procedure.mutation()`, ...proc.signals.mutationDetails],
      confidenceRationale: proc.procedureType === "public"
        ? "High: public tRPC mutation with no auth boundary"
        : "Medium: unrecognized procedure type (may have auth middleware)",
      remediation: [
        "Use protectedProcedure instead of publicProcedure for mutations",
        "Add auth middleware to the procedure chain: publicProcedure.use(authMiddleware).mutation(...)",
        "If this mutation is intentionally public, add a waiver with reason",
      ],
      tags: ["auth", "trpc"],
    });
  }

  return findings;
}

interface CheckResult {
  confidence: Confidence;
  confidenceRationale: string;
  line?: number;
  snippet?: string;
  evidence: string[];
}

function checkRoute(
  route: NextRoute,
  index: NextIndex,
  config: ProdcheckConfig,
): CheckResult | null {
  // Use ProtectionSummary if available (computed during index building)
  if (route.protection) {
    if (route.protection.auth.satisfied) return null;

    // If wrapper introspection deferred this to WRAPPER-UNRECOGNIZED, don't emit per-route finding
    if (route.protection.auth.unverifiedWrappers.length > 0) return null;
  }

  const src = readSource(index.rootDir, route.file);
  if (!src) return null;

  // Check for built-in auth patterns (webhook signatures, cron keys, etc.)
  // These are always checked regardless of ProtectionSummary
  if (hasBuiltInAuthPattern(src)) return null;

  // No auth found — determine confidence
  const evidence: string[] = [...route.signals.mutationDetails];
  evidence.push(`No auth function calls matched: ${config.hints.auth.functions.join(", ")}`);
  evidence.push("No middleware auth covering this route");
  let confidence: Confidence = "high";
  let confidenceRationale = "High: mutation evidence + no auth calls + no middleware coverage";

  // Downgrade if we see any function calls that could be custom auth
  if (hasPossibleCustomAuth(src)) {
    confidence = "med";
    confidenceRationale = "Medium: mutation evidence present but possible custom auth wrapper detected (not in hints)";
    evidence.push("possible custom auth wrapper detected (not in hints)");
  }

  // Exempt callback/OAuth/OIDC/SSO/SCIM paths — public by protocol design.
  // The OAuth flow itself (state/PKCE/nonce) IS the auth boundary.
  const pathname = route.pathname ?? route.file;
  if (isCallbackPath(pathname)) {
    return null;
  }

  // Find the line of the first mutation evidence for precise reporting
  const line = findFirstMutationLine(src, route.signals);

  return { confidence, confidenceRationale, line, evidence };
}

function checkServerAction(
  action: NextServerAction,
  index: NextIndex,
  config: ProdcheckConfig,
): CheckResult | null {
  const src = readSource(index.rootDir, action.file);
  if (!src) return null;

  if (hasAuthCall(src, config.hints.auth.functions)) return null;
  if (hasBuiltInAuthPattern(src)) return null;

  const evidence: string[] = [...action.signals.mutationDetails];
  evidence.push(`No auth function calls matched: ${config.hints.auth.functions.join(", ")}`);
  let confidence: Confidence = "high";
  let confidenceRationale = "High: server action with mutation evidence + no auth calls";

  if (hasPossibleCustomAuth(src)) {
    confidence = "med";
    confidenceRationale = "Medium: mutation evidence present but possible custom auth wrapper detected (not in hints)";
    evidence.push("possible custom auth wrapper detected (not in hints)");
  }

  const line = findFirstMutationLine(src, action.signals);

  return { confidence, confidenceRationale, line, evidence };
}

function hasAuthCall(src: string, authFunctions: string[]): boolean {
  for (const fn of authFunctions) {
    const pattern = new RegExp(`\\b${escapeRegex(fn)}\\s*\\(`, "m");
    if (pattern.test(src)) return true;
  }
  return false;
}

/**
 * Built-in auth patterns that don't need to be in hints.
 * These are common enough to detect automatically.
 */
function hasBuiltInAuthPattern(src: string): boolean {
  // Stripe webhook signature verification
  if (/stripe\.webhooks\.constructEvent\s*\(/m.test(src)) return true;

  // WorkOS webhook signature verification
  if (/workos\.webhooks\.constructEvent\s*\(/m.test(src)) return true;

  // Vercel/QStash cron signature verification
  if (/verifyVercelSignature\s*\(/m.test(src)) return true;
  if (/verifyQstashSignature\s*\(/m.test(src)) return true;

  // HMAC webhook signature verification (crypto.createHmac + comparison)
  if (/createHmac\s*\(/.test(src) && /signature/i.test(src)) return true;

  // Cron API key / secret env var check
  if (/process\.env\.CRON_(?:API_KEY|SECRET)/m.test(src)) return true;

  // Shared secret header verification (common webhook pattern)
  if (/process\.env\.\w+SECRET\b/.test(src) && /headers\.get\s*\(/m.test(src)) return true;

  // Supabase auth boundary — call-based, not import-based.
  if (/\.auth\.getUser\s*\(/.test(src)) return true;
  if (/\.auth\.getSession\s*\(/.test(src)) return true;

  // --- Framework wrappers with built-in request signing ---

  // Upstash Workflow serve() — verifies request signatures automatically
  if (hasFrameworkServe(src, "@upstash/workflow")) return true;

  // Inngest serve() — verifies signing key on incoming requests
  if (hasFrameworkServe(src, "inngest")) return true;

  // --- Webhook verification libraries (import + call) ---

  // Svix webhook verification (used by Clerk, etc.)
  if (hasImportAndCall(src, "svix", /\.verify\s*\(/)) return true;

  // Octokit/GitHub webhook verification
  if (hasImportAndCall(src, "@octokit/webhooks", /\.verify\s*\(/)) return true;

  // --- Contextual webhook auth patterns ---

  // timingSafeEqual used with request-derived data + early 401/403
  if (hasWebhookTokenVerification(src)) return true;

  // --- JWT verification (jose / jsonwebtoken) ---

  // jose: jwtVerify() with token from headers/cookies + early deny
  if (hasImportAndCall(src, "jose", /jwtVerify\s*\(/)) return true;

  // jsonwebtoken: jwt.verify() / verify() with token from headers/cookies
  if (hasImportAndCall(src, "jsonwebtoken", /\.verify\s*\(/)) return true;

  // --- DB-backed API token lookup + early deny ---
  if (hasDbTokenLookup(src)) return true;

  // --- Auth-guard return: header/token/secret check → early 401/403 before mutation ---
  if (hasAuthGuardReturn(src)) return true;

  // --- Inline auth guard: common auth function name + null check + early return/throw ---
  if (hasInlineAuthGuard(src)) return true;

  return false;
}

/**
 * Detect framework `serve()` wrappers that have built-in request signing.
 * Checks both the import source and the serve() call in the source.
 */
function hasFrameworkServe(src: string, packagePrefix: string): boolean {
  const importPattern = new RegExp(`from\\s+["']${escapeRegex(packagePrefix)}[^"']*["']`);
  if (!importPattern.test(src)) return false;
  return /\bserve\s*[<(]/.test(src);
}

/**
 * Detect a known verification library by import source + method call.
 */
function hasImportAndCall(src: string, packageName: string, callPattern: RegExp): boolean {
  const importPattern = new RegExp(`from\\s+["']${escapeRegex(packageName)}[^"']*["']`);
  if (!importPattern.test(src)) return false;
  return callPattern.test(src);
}

/**
 * Detect webhook token verification: timingSafeEqual used with
 * request-derived data (headers/params/body) and early 401/403 on mismatch.
 *
 * NOT a blanket "any timingSafeEqual = auth" — requires:
 * 1. timingSafeEqual call present
 * 2. Reads from request (headers, searchParams, or body)
 * 3. Returns 401 or 403 on failure
 */
function hasWebhookTokenVerification(src: string): boolean {
  if (!/timingSafeEqual\s*\(/.test(src)) return false;
  const readsRequest = /headers\.get\s*\(/.test(src)
    || /searchParams\.get\s*\(/.test(src)
    || /request\.json\s*\(/.test(src)
    || /req\.json\s*\(/.test(src);
  if (!readsRequest) return false;
  // Accept explicit 401/403 or any throw (many apps throw custom errors)
  return /status:\s*40[13]\b/.test(src) || /\(\s*40[13]\s*\)/.test(src) || /\bthrow\s+new\b/.test(src);
}

/**
 * Detect DB-backed token lookup with early deny.
 *
 * Pattern: reads token from request (header, body, params) → looks it up in DB → returns 401/403 if missing.
 * Common in B2B SaaS for API key authentication, password reset flows, etc.
 *
 * Requires all three:
 * 1. Reads from request (headers, searchParams, body, or route params)
 * 2. DB lookup on a token/key-like table (prisma.apiToken, prisma.apiKey, etc.)
 * 3. Returns 401 or 403
 */
function hasDbTokenLookup(src: string): boolean {
  // DB lookup on a token/key-like table
  const hasTokenLookup = /\.(apiToken|apiKey|token|accessToken|api_key|access_token|passwordResetToken|verificationToken|resetToken)\.(findUnique|findFirst|findMany)\s*\(/i.test(src);
  if (!hasTokenLookup) return false;
  // Accept explicit 401/403, or any throw (custom error classes like DubApiError)
  // Route handlers always read from the request, so token lookup + deny is sufficient
  return /status:\s*40[13]\b/.test(src) || /\(\s*40[13]\s*\)/.test(src) || /\bthrow\s+new\b/.test(src);
}

/**
 * Detect auth-guard return patterns: an early 401/403 return whose guarding
 * condition references an auth signal, occurring BEFORE mutation evidence.
 *
 * We require ALL of:
 * 1. A return/throw producing 401 or 403
 * 2. The surrounding context references an auth-related signal
 * 3. The guard occurs before the first mutation evidence in the file
 *
 * Auth signals (the condition must reference at least one):
 * - headers.get(...) with auth-related header names
 * - Variables named token, apiKey, signature, secret, session, user, auth
 * - Comparison against process.env.* or config values
 *
 * This intentionally does NOT match:
 * - Feature flag checks (if (!enabled) return 403)
 * - Plan gating (if (!isPro) return 403)
 * - CSRF/bot checks without auth signals
 * - 401/403 returns AFTER mutation code (error handling, not guards)
 */
function hasAuthGuardReturn(src: string): boolean {
  // Must have a 401 or 403 status somewhere
  if (!/status:\s*40[13]\b/.test(src) && !/\(\s*40[13]\s*\)/.test(src)) return false;

  const lines = src.split("\n");

  // Find the first mutation evidence line
  const firstMutationLine = findFirstMutationLineIndex(lines);

  // Find lines with 401/403 returns and check nearby context for auth signals
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/40[13]/.test(line)) continue;
    if (!/status|Response|NextResponse|return|throw/i.test(line)) continue;

    // Guard must occur before mutation evidence (or if no mutation found, accept it)
    if (firstMutationLine !== undefined && i >= firstMutationLine) continue;

    // Look at the surrounding context (up to 10 lines before the 401/403)
    const contextStart = Math.max(0, i - 10);
    const context = lines.slice(contextStart, i + 1).join("\n");

    if (hasAuthSignalInContext(context)) return true;
  }

  return false;
}

/**
 * Detect inline auth guards using common auth function name patterns + null check.
 *
 * Matches function calls like getCurrentUser(), getUser(), requireSession(), checkAuth(), etc.
 * followed by a null/falsy check within 15 lines, with an early return/throw in the guard body.
 *
 * This catches auth patterns that aren't in hints (custom function names).
 */
const AUTH_FN_PATTERN = /\b(?:get|require|check|validate|verify|ensure|load|fetch|update)\w*(?:User|Session|Auth|Account|Identity|Token)\s*\(/i;

function hasInlineAuthGuard(src: string): boolean {
  if (!AUTH_FN_PATTERN.test(src)) return false;

  const lines = src.split("\n");

  // Find lines with auth function calls
  for (let i = 0; i < lines.length; i++) {
    if (!AUTH_FN_PATTERN.test(lines[i])) continue;

    // Look for a null/falsy check within 15 lines after the call
    const searchEnd = Math.min(lines.length, i + 15);
    for (let j = i; j < searchEnd; j++) {
      const line = lines[j];
      // Check for if (!variable) or if (variable == null) patterns
      if (!/if\s*\(\s*!|\s*==\s*null|\s*===\s*null/.test(line)) continue;

      // Check subsequent lines (the guard body) for throw/return/redirect
      const guardEnd = Math.min(lines.length, j + 5);
      const guardBody = lines.slice(j, guardEnd).join("\n");
      if (/\bthrow\b|\breturn\b|\bredirect\b|NextResponse\.redirect|NextResponse\.json/.test(guardBody)) {
        return true;
      }
    }
  }

  return false;
}

/** Find the 0-based line index of the first mutation evidence in source lines. */
function findFirstMutationLineIndex(lines: string[]): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (/\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\(/.test(lines[i])) {
      return i;
    }
    if (/stripe\.\w+\.(create|update|del)\s*\(/.test(lines[i])) {
      return i;
    }
  }
  return undefined;
}

/**
 * Auth signals that distinguish real auth guards from feature flags / plan gating.
 */
const AUTH_SIGNAL_PATTERNS: RegExp[] = [
  // Header reads with auth-related names
  /headers\.get\s*\(\s*["'](?:authorization|x-api-key|x-webhook-secret|x-signature|x-hub-signature)/i,
  // Any custom header read + secret/token/key comparison
  /headers\.get\s*\([^)]+\)[\s\S]{0,100}(?:secret|token|key|signature)\b/i,
  // Variable names that imply auth context
  /\b(?:const|let|var)\s+(?:token|apiKey|api_key|signature|webhookSecret|webhook_secret|headerValue)\b/i,
  // Comparison against env vars (secret/key/token)
  /process\.env\.\w*(?:SECRET|TOKEN|KEY|API_KEY|WEBHOOK)\w*/i,
  // Authorization / Bearer token patterns
  /\bauthorization\b/i,
  /\bbearer\b/i,
  // Known verification function names in the condition
  /\b(?:verify|validate|check)\w*(?:Token|Signature|Auth|Secret|Key)\s*\(/i,
];

/**
 * Check if a code context (a few lines around a 401/403 return)
 * contains at least one auth signal, distinguishing it from
 * feature-flag / plan-gating returns.
 */
function hasAuthSignalInContext(context: string): boolean {
  return AUTH_SIGNAL_PATTERNS.some((pattern) => pattern.test(context));
}

/**
 * Detect callback/OAuth/OIDC paths that are typically public by protocol design.
 * These get downgraded (not allowlisted) — they should still rely on
 * framework validation (state/PKCE) but are not auth-boundary issues.
 */
function isCallbackPath(pathname: string): boolean {
  return /\/(callback|oauth|oidc|sso|scim)(\/|$)/i.test(pathname);
}

function hasPossibleCustomAuth(src: string): boolean {
  if (/\b(verify|check|require|validate|ensure|guard|protect|get|fetch|load)\w*(Token|Auth|Session|User|Access|Secret|Signature|Permission)\s*\(/i.test(src)) {
    return true;
  }

  if (/headers?\S*\.get\s*\(\s*["']authorization["']\s*\)/i.test(src)) {
    return true;
  }

  return false;
}

function findFirstMutationLine(src: string, signals: { mutationDetails: string[] }): number | undefined {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\(/.test(lines[i])) {
      return i + 1;
    }
    if (/stripe\.\w+\.(create|update|del)\s*\(/.test(lines[i])) {
      return i + 1;
    }
  }
  return undefined;
}

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
