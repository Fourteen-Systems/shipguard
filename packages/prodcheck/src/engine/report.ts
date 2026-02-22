import pc from "picocolors";
import type { ScanResult, Finding } from "./types.js";
import type { BaselineDiff } from "./baseline.js";
import { scoreStatus, buildDetectedList } from "./score.js";

export function formatPretty(result: ScanResult, diff?: BaselineDiff): string {
  const lines: string[] = [];
  const { score, findings, waivedFindings, summary } = result;

  // Header with detected stack
  const detected = buildDetectedList(result);
  const status = scoreStatus(score);
  const scoreColor = status === "PASS" ? pc.green : status === "WARN" ? pc.yellow : pc.red;
  lines.push("");
  lines.push(`  ${pc.bold("Prodcheck")} ${pc.dim(result.prodcheckVersion)}`);
  lines.push(`  ${pc.dim("Detected:")} ${detected.join(" · ")}`);
  // Score line with inline severity counts
  if (findings.length === 0) {
    lines.push(`  ${pc.dim("Score:")} ${scoreColor(String(score))} ${scoreColor(status)}`);
  } else {
    const parts: string[] = [];
    if (summary.critical > 0) parts.push(pc.red(`${summary.critical} critical`));
    if (summary.high > 0) parts.push(pc.yellow(`${summary.high} high`));
    if (summary.med > 0) parts.push(`${summary.med} med`);
    if (summary.low > 0) parts.push(pc.dim(`${summary.low} low`));
    lines.push(`  ${pc.dim("Score:")} ${scoreColor(String(score))} ${scoreColor(status)}  ${pc.dim("·")}  ${parts.join(pc.dim(" · "))}`);
  }

  // Banner: no auth provider detected
  const d = result.detected.deps;
  const hasAnyAuth = d.hasNextAuth || d.hasClerk || d.hasSupabase || d.hasKinde ||
    d.hasWorkOS || d.hasBetterAuth || d.hasLucia || d.hasAuth0 || d.hasIronSession ||
    d.hasFirebaseAuth;
  if (!hasAnyAuth && !result.detected.middleware) {
    lines.push("");
    lines.push(`  ${pc.yellow("⚠")} ${pc.yellow("No auth provider detected.")} Public mutation endpoints will be treated as high risk.`);
  }

  if (diff) {
    const deltaStr = diff.scoreDelta >= 0 ? `+${diff.scoreDelta}` : `${diff.scoreDelta}`;
    lines.push(`  Delta from baseline: ${diff.scoreDelta >= 0 ? pc.green(deltaStr) : pc.red(deltaStr)}`);
    if (diff.newFindings.length > 0) {
      lines.push(`  New findings: ${pc.red(String(diff.newFindings.length))}`);
    }
    if (diff.resolvedKeys.length > 0) {
      lines.push(`  Resolved: ${pc.green(String(diff.resolvedKeys.length))}`);
    }
  }

  lines.push("");

  // Group by severity
  const grouped = groupBySeverity(findings);

  for (const [severity, items] of Object.entries(grouped)) {
    if (items.length === 0) continue;
    const color = severity === "critical" ? pc.red : severity === "high" ? pc.yellow : pc.dim;
    lines.push(`  ${color(severity.toUpperCase())} (${items.length})`);

    for (const f of items) {
      const loc = f.line ? `:${f.line}` : "";
      const conf = pc.dim(`(${f.confidence} confidence)`);
      lines.push(`    ${f.ruleId} ${conf}`);
      lines.push(`      ${pc.dim(f.file + loc)}`);
      if (f.evidence.length > 0) {
        for (const e of f.evidence) {
          lines.push(`      - ${e}`);
        }
      }
      lines.push(`      ${pc.dim(`Why ${f.confidence}: ${f.confidenceRationale}`)}`);
      if (f.remediation.length > 0) {
        lines.push(`      ${pc.cyan("Fix:")} ${f.remediation[0]}`);
      }
    }
    lines.push("");
  }

  // Remediation
  const remediations = new Map<string, string[]>();
  for (const f of findings) {
    if (!remediations.has(f.ruleId)) {
      remediations.set(f.ruleId, f.remediation);
    }
  }

  if (remediations.size > 0) {
    lines.push("  Suggested fixes:");
    for (const [ruleId, fixes] of remediations) {
      for (const fix of fixes) {
        lines.push(`    - ${fix}`);
      }
    }
    lines.push("");
  }

  // Waivers
  if (waivedFindings.length > 0) {
    lines.push(`  ${pc.dim(`Waived: ${waivedFindings.length} finding(s)`)}`);
    lines.push("");
  }

  // Tip
  lines.push(pc.dim("  Tip: Use `prodcheck waive <RULE> --file <path> --reason \"...\"` to waive known exceptions."));
  lines.push(pc.dim("  Tip: Configure hints in prodcheck.config.json to reduce false positives."));
  lines.push("");

  return lines.join("\n");
}

export function formatJson(result: ScanResult): string {
  return JSON.stringify(result, null, 2);
}

function groupBySeverity(findings: Finding[]): Record<string, Finding[]> {
  const groups: Record<string, Finding[]> = {
    critical: [],
    high: [],
    med: [],
    low: [],
  };
  for (const f of findings) {
    groups[f.severity]?.push(f);
  }
  return groups;
}
