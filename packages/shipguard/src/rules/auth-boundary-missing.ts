import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextIndex, NextRoute, NextServerAction } from "../next/types.js";
import type { Finding, ShipguardConfig } from "../engine/types.js";
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

export function run(index: NextIndex, config: ShipguardConfig): Finding[] {
  const findings: Finding[] = [];
  const maxSeverity = config.rules[RULE_ID]?.severity ?? "critical";

  const authAllowlist = config.hints.auth.allowlistPaths;

  // Check mutation route handlers
  for (const route of index.routes.mutationRoutes) {
    if (isAllowlisted(route.file, authAllowlist)) continue;
    const result = checkRoute(route, index, config);
    if (result) {
      findings.push({
        ruleId: RULE_ID,
        severity: severityFromConfidence(result.confidence, maxSeverity),
        confidence: result.confidence,
        message: `Route handler performs mutations without a recognized auth boundary`,
        file: route.file,
        line: result.line,
        snippet: result.snippet,
        evidence: result.evidence,
        confidenceRationale: result.confidenceRationale,
        remediation: [
          "Add an auth check at the top of the handler (e.g., `const session = await auth()`)",
          "Ensure middleware.ts protects this route segment",
          "If using a custom auth wrapper, add it to hints.auth.functions in shipguard.config.json",
        ],
        tags: ["auth", "server"],
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
          "If using a custom auth wrapper, add it to hints.auth.functions in shipguard.config.json",
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
  config: ShipguardConfig,
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

  // Find the line of the first mutation evidence for precise reporting
  const line = findFirstMutationLine(src, route.signals);

  return { confidence, confidenceRationale, line, evidence };
}

function checkServerAction(
  action: NextServerAction,
  index: NextIndex,
  config: ShipguardConfig,
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

  return false;
}

function hasPossibleCustomAuth(src: string): boolean {
  if (/\b(verify|check|require|validate|ensure|guard|protect)\w*(Token|Auth|Session|User|Access|Secret|Signature|Permission)\s*\(/i.test(src)) {
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
