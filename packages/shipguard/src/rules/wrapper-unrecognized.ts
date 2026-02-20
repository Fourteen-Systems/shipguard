import type { NextIndex } from "../next/types.js";
import type { Finding, ShipguardConfig } from "../engine/types.js";
import type { Severity } from "../next/types.js";

export const RULE_ID = "WRAPPER-UNRECOGNIZED";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, med: 2, low: 1 };

function capSeverity(computed: Severity, max: string): Severity {
  const maxRank = SEVERITY_RANK[max] ?? 4;
  const computedRank = SEVERITY_RANK[computed] ?? 2;
  return computedRank > maxRank ? (max as Severity) : computed;
}

export function run(index: NextIndex, config: ShipguardConfig): Finding[] {
  const findings: Finding[] = [];
  const maxSeverity = config.rules[RULE_ID]?.severity ?? "high";

  for (const [name, wrapper] of index.wrappers.wrappers) {
    // Skip fully resolved wrappers where both auth AND rate-limit are enforced
    if (wrapper.resolved && wrapper.evidence.authEnforced && wrapper.evidence.rateLimitEnforced) {
      continue;
    }

    // Determine what this wrapper WOULD have triggered
    const wouldTrigger: string[] = [];

    // Check if any wrapped routes are mutation routes (need auth)
    const mutationFileSet = new Set(index.routes.mutationRoutes.map((r) => r.file));
    const wrappedMutationFiles = wrapper.usageFiles.filter((f) => mutationFileSet.has(f));

    if (wrappedMutationFiles.length > 0) {
      if (!wrapper.resolved || !wrapper.evidence.authEnforced) {
        wouldTrigger.push("AUTH-BOUNDARY-MISSING");
      }
    }

    // Check if any wrapped routes are API routes (need rate limiting)
    const apiFileSet = new Set(
      index.routes.all.filter((r) => r.isApi).map((r) => r.file),
    );
    const wrappedApiFiles = wrapper.usageFiles.filter((f) => apiFileSet.has(f));

    if (wrappedApiFiles.length > 0) {
      if (!wrapper.resolved || !wrapper.evidence.rateLimitEnforced) {
        wouldTrigger.push("RATE-LIMIT-MISSING");
      }
    }

    if (wouldTrigger.length === 0) continue;

    // Severity = high if wrapping mutation routes, med otherwise
    const computedSeverity: Severity = wrappedMutationFiles.length > 0 ? "high" : "med";

    const status = !wrapper.resolved
      ? "could not be resolved"
      : wrapper.evidence.authCallPresent && !wrapper.evidence.authEnforced
        ? "calls auth but enforcement not proven"
        : wrapper.evidence.rateLimitCallPresent && !wrapper.evidence.rateLimitEnforced
          ? "calls rate limiter but enforcement not proven"
          : "missing protections";

    const evidence: string[] = [
      `${name}() wraps ${wrapper.usageCount} route handler(s) (${wrapper.mutationRouteCount} mutation)`,
      `Would have triggered: ${wouldTrigger.join(", ")}`,
      `Top routes: ${wrapper.usageFiles.slice(0, 5).join(", ")}${wrapper.usageCount > 5 ? ` (+${wrapper.usageCount - 5} more)` : ""}`,
    ];

    if (wrapper.evidence.authCallPresent) {
      evidence.push(`Auth call detected: ${wrapper.evidence.authDetails.join(", ")}`);
    }
    if (wrapper.evidence.rateLimitCallPresent) {
      evidence.push(`Rate-limit call detected: ${wrapper.evidence.rateLimitDetails.join(", ")}`);
    }

    findings.push({
      ruleId: RULE_ID,
      severity: capSeverity(computedSeverity, maxSeverity),
      confidence: "high",
      message: `Wrapper "${name}" wraps ${wrapper.usageCount} handler(s); ${status}`,
      file: wrapper.usageFiles[0],
      evidence,
      confidenceRationale: "High: wrapper usage is certain, but protection cannot be verified",
      remediation: [
        `If ${name} enforces auth: add "${name}" to hints.auth.functions`,
        `If ${name} enforces rate limiting: add "${name}" to hints.rateLimit.wrappers`,
        ...(wrapper.definitionFile
          ? [`Verify wrapper implementation at ${wrapper.definitionFile}`]
          : [`Wrapper definition could not be found — check import paths`]),
      ],
      tags: ["wrapper", "config"],
    });
  }

  return findings;
}
