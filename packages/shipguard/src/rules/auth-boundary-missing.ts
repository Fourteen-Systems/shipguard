import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextIndex, NextRoute, NextServerAction } from "../next/types.js";
import type { Finding, ShipguardConfig } from "../engine/types.js";
import type { Confidence } from "../next/types.js";

export const RULE_ID = "AUTH-BOUNDARY-MISSING";

export function run(index: NextIndex, config: ShipguardConfig): Finding[] {
  const findings: Finding[] = [];
  const severity = config.rules[RULE_ID]?.severity ?? "critical";

  // Check mutation route handlers
  for (const route of index.routes.mutationRoutes) {
    const result = checkRoute(route, index, config);
    if (result) {
      findings.push({
        ruleId: RULE_ID,
        severity,
        confidence: result.confidence,
        message: `Route handler performs mutations without a recognized auth boundary`,
        file: route.file,
        line: result.line,
        snippet: result.snippet,
        evidence: result.evidence,
        remediation: [
          "Add an auth check at the top of the handler (e.g., `const session = await auth()`)",
          "Ensure middleware.ts protects this route segment",
          "If using a custom auth wrapper, add it to hints.auth.functions in shipguard.config.json",
        ],
        tags: ["auth", "server"],
      });
    }
  }

  // Check mutation server actions
  for (const action of index.serverActions.mutationActions) {
    const result = checkServerAction(action, index, config);
    if (result) {
      findings.push({
        ruleId: RULE_ID,
        severity,
        confidence: result.confidence,
        message: `Server action "${action.exportName ?? "<anonymous>"}" performs mutations without a recognized auth boundary`,
        file: action.file,
        line: result.line,
        snippet: result.snippet,
        evidence: result.evidence,
        remediation: [
          "Add an auth check at the top of the server action",
          "If using a custom auth wrapper, add it to hints.auth.functions in shipguard.config.json",
        ],
        tags: ["auth", "server-action"],
      });
    }
  }

  return findings;
}

interface CheckResult {
  confidence: Confidence;
  line?: number;
  snippet?: string;
  evidence: string[];
}

function checkRoute(
  route: NextRoute,
  index: NextIndex,
  config: ShipguardConfig,
): CheckResult | null {
  const src = readSource(index.rootDir, route.file);
  if (!src) return null;

  // Check if auth boundary exists
  if (hasAuthCall(src, config.hints.auth.functions)) return null;

  // Check if middleware covers this route
  if (isProtectedByMiddleware(route, index)) return null;

  // No auth found — determine confidence
  const evidence: string[] = [...route.signals.mutationDetails];
  let confidence: Confidence = "high";

  // Downgrade if we see any function calls that could be custom auth
  if (hasPossibleCustomAuth(src)) {
    confidence = "med";
    evidence.push("possible custom auth wrapper detected (not in hints)");
  }

  // Find the line of the first mutation evidence for precise reporting
  const line = findFirstMutationLine(src, route.signals);

  return { confidence, line, evidence };
}

function checkServerAction(
  action: NextServerAction,
  index: NextIndex,
  config: ShipguardConfig,
): CheckResult | null {
  const src = readSource(index.rootDir, action.file);
  if (!src) return null;

  if (hasAuthCall(src, config.hints.auth.functions)) return null;

  const evidence: string[] = [...action.signals.mutationDetails];
  let confidence: Confidence = "high";

  if (hasPossibleCustomAuth(src)) {
    confidence = "med";
    evidence.push("possible custom auth wrapper detected (not in hints)");
  }

  const line = findFirstMutationLine(src, action.signals);

  return { confidence, line, evidence };
}

function hasAuthCall(src: string, authFunctions: string[]): boolean {
  for (const fn of authFunctions) {
    // Match: fn(), await fn(), const x = fn(), const x = await fn()
    const pattern = new RegExp(`\\b${escapeRegex(fn)}\\s*\\(`, "m");
    if (pattern.test(src)) return true;
  }
  return false;
}

function isProtectedByMiddleware(route: NextRoute, index: NextIndex): boolean {
  if (!index.middleware.authLikely) return false;

  // If middleware has no matcher, it applies to all routes
  if (index.middleware.matcherPatterns.length === 0) return true;

  // Check if any matcher pattern covers this route
  const pathname = route.pathname ?? "";
  for (const pattern of index.middleware.matcherPatterns) {
    if (pathnameMatchesMatcher(pathname, pattern)) return true;
  }

  return false;
}

function pathnameMatchesMatcher(pathname: string, matcher: string): boolean {
  // Simple matcher check: does the matcher pattern cover this path?
  // Next.js matchers use a regex-like syntax; for v1, do prefix matching
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

function hasPossibleCustomAuth(src: string): boolean {
  // Heuristic: looks for patterns like `verifyToken(`, `checkAuth(`, `requireAuth(`
  // that could be custom auth wrappers we don't know about
  return /\b(verify|check|require|validate)(Token|Auth|Session|User|Access)\s*\(/i.test(src);
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
