import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  runScan,
  loadBaseline,
  diffBaseline,
  computeScore,
  confidenceLevel,
  severityLevel,
  scoreStatus,
  buildDetectedList,
  parseConfidence,
  parseSeverity,
  parseIntOrThrow,
  type BaselineDiff,
  type ScanResult,
  type Finding,
  type Severity,
} from "@fourteensystems/shipguard";

const COMMENT_MARKER = "<!-- shipguard-action -->";

async function run(): Promise<void> {
  try {
    const workingDir = core.getInput("working-directory");
    const rootDir = workingDir || process.cwd();
    const result = await runScan({ rootDir });

    // Read and validate inputs
    const minScore = parseIntOrThrow(core.getInput("min-score") || "70", "min-score");
    const failOn = parseSeverity(core.getInput("fail-on") || "critical");
    const minConfidence = parseConfidence(core.getInput("min-confidence") || "high");
    const maxNewCritical = parseIntOrThrow(core.getInput("max-new-critical") || "0", "max-new-critical");
    const maxNewHighInput = core.getInput("max-new-high");
    const maxNewHigh = maxNewHighInput ? parseIntOrThrow(maxNewHighInput, "max-new-high") : undefined;
    const baselinePath = core.getInput("baseline");
    const shouldComment = core.getInput("comment") !== "false";
    const shouldAnnotate = core.getInput("annotations") !== "false";

    // Filter findings by confidence and recalculate score
    const gatedFindings = result.findings.filter(
      (f) => confidenceLevel(f.confidence) >= confidenceLevel(minConfidence),
    );
    const gatedScore = computeScore(gatedFindings);

    // Baseline diff
    let diff: BaselineDiff | undefined;
    if (baselinePath) {
      const baseline = loadBaseline(baselinePath);
      if (baseline) {
        diff = diffBaseline(baseline, result);
      }
    }

    // Inline annotations
    if (shouldAnnotate) {
      createAnnotations(gatedFindings);
    }

    // PR comment
    if (shouldComment) {
      await postComment(result, gatedFindings, gatedScore, diff);
    }

    // Job summary
    await writeSummary(gatedScore, gatedFindings, diff);

    // Set outputs
    const status = scoreStatus(gatedScore);
    core.setOutput("score", gatedScore);
    core.setOutput("findings", gatedFindings.length);
    core.setOutput("result", status);

    // Evaluate gates
    const failures = evaluateGates(gatedScore, gatedFindings, diff, {
      minScore,
      failOn,
      maxNewCritical,
      maxNewHigh,
    });

    if (failures.length > 0) {
      core.setFailed(`Shipguard: ${failures.join("; ")}`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

// --- Annotations ---

function createAnnotations(findings: Finding[]): void {
  for (const f of findings) {
    const msg = `${f.ruleId}: ${f.message}`;
    const props = { file: f.file, startLine: f.line };
    if (f.severity === "critical") {
      core.error(msg, props);
    } else if (f.severity === "high") {
      core.warning(msg, props);
    } else {
      core.notice(msg, props);
    }
  }
}

// --- PR Comment ---

async function postComment(
  result: ScanResult,
  gatedFindings: Finding[],
  gatedScore: number,
  diff?: BaselineDiff,
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    core.warning("GITHUB_TOKEN not available — skipping PR comment");
    return;
  }

  const context = github.context;
  if (!context.payload.pull_request) {
    core.info("Not a pull request — skipping PR comment");
    return;
  }

  const octokit = github.getOctokit(token);
  const prNumber = context.payload.pull_request.number;
  const body = buildCommentBody(result, gatedFindings, gatedScore, diff);

  // Find existing comment to update
  const { data: comments } = await octokit.rest.issues.listComments({
    ...context.repo,
    issue_number: prNumber,
    per_page: 50,
  });

  const existing = comments.find(
    (c) => c.body?.includes(COMMENT_MARKER),
  );

  if (existing) {
    await octokit.rest.issues.updateComment({
      ...context.repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      ...context.repo,
      issue_number: prNumber,
      body,
    });
  }
}

function buildCommentBody(
  result: ScanResult,
  gatedFindings: Finding[],
  gatedScore: number,
  diff?: BaselineDiff,
): string {
  const lines: string[] = [COMMENT_MARKER];
  const status = scoreStatus(gatedScore);
  // Header — consistent shield branding, status in text
  lines.push(`## \u{1F6E1}\uFE0F Shipguard \u2014 Score: ${gatedScore} ${status}`);
  lines.push("");

  // Detected stack
  const detected = buildDetectedList(result);
  lines.push(`> ${detected.join(" \u00B7 ")}`);

  // No-auth warning
  const d = result.detected.deps;
  const hasAnyAuth = d.hasNextAuth || d.hasClerk || d.hasSupabase || d.hasKinde ||
    d.hasWorkOS || d.hasBetterAuth || d.hasLucia || d.hasAuth0 || d.hasIronSession ||
    d.hasFirebaseAuth;
  if (!hasAnyAuth && !result.detected.middleware) {
    lines.push(">");
    lines.push(`> \u26A0\uFE0F **No auth provider detected.** Public mutation endpoints will be treated as high risk.`);
  }

  lines.push("");

  if (gatedFindings.length === 0) {
    lines.push("No security findings \u2014 all mutation endpoints are protected.");
  } else {
    // Compact severity bar
    const counts = countBySeverity(gatedFindings);
    lines.push(`| ${sevIcon("critical")} Critical | ${sevIcon("high")} High | ${sevIcon("med")} Med | ${sevIcon("low")} Low |`);
    lines.push("|---|---|---|---|");
    lines.push(`| ${counts.critical || "\u2014"} | ${counts.high || "\u2014"} | ${counts.med || "\u2014"} | ${counts.low || "\u2014"} |`);
    lines.push("");

    // Findings table with severity icon and message
    lines.push("### Findings");
    lines.push("");
    lines.push("| | Rule | File | Message |");
    lines.push("|---|---|---|---|");
    for (const f of gatedFindings) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`| ${sevIcon(f.severity)} | ${f.ruleId} | \`${loc}\` | ${f.message} |`);
    }
    lines.push("");

    // Collapsible evidence & confidence
    lines.push("<details>");
    lines.push("<summary>Evidence & confidence</summary>");
    lines.push("");
    for (const f of gatedFindings) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`**${f.ruleId}** \u00B7 \`${loc}\` \u00B7 ${f.confidence} confidence`);
      for (const e of f.evidence) {
        lines.push(`- ${e}`);
      }
      lines.push(`- *${f.confidenceRationale}*`);
      lines.push("");
    }
    lines.push("</details>");
    lines.push("");

    // Collapsible remediation
    const remediations = collectRemediations(gatedFindings);
    if (remediations.length > 0) {
      lines.push("<details>");
      lines.push("<summary>Suggested fixes</summary>");
      lines.push("");
      for (const fix of remediations) {
        lines.push(`- ${fix}`);
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  // Baseline delta
  if (diff) {
    const delta = diff.scoreDelta >= 0 ? `+${diff.scoreDelta}` : `${diff.scoreDelta}`;
    lines.push(`> **Baseline:** Score delta **${delta}** \u00B7 ${diff.newFindings.length} new \u00B7 ${diff.resolvedKeys.length} resolved`);
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push(`<sub>Shipguard ${result.shipguardVersion}</sub>`);

  return lines.join("\n");
}

function sevIcon(severity: string): string {
  switch (severity) {
    case "critical": return "\uD83D\uDD34";
    case "high": return "\uD83D\uDFE0";
    case "med": return "\uD83D\uDFE1";
    case "low": return "\u26AA";
    default: return "\u26AA";
  }
}

// --- Job Summary ---

async function writeSummary(gatedScore: number, gatedFindings: Finding[], diff?: BaselineDiff): Promise<void> {
  const status = scoreStatus(gatedScore);
  const counts = countBySeverity(gatedFindings);

  core.summary
    .addHeading("Shipguard Report")
    .addRaw(`**Score: ${gatedScore} ${status}** | Findings: ${gatedFindings.length}`)
    .addEOL();

  if (gatedFindings.length > 0) {
    const parts: string[] = [];
    if (counts.critical > 0) parts.push(`${counts.critical} critical`);
    if (counts.high > 0) parts.push(`${counts.high} high`);
    if (counts.med > 0) parts.push(`${counts.med} med`);
    if (counts.low > 0) parts.push(`${counts.low} low`);
    core.summary.addRaw(parts.join(" \u00B7 "));
    core.summary.addEOL();
  }

  if (diff) {
    const delta = diff.scoreDelta >= 0 ? `+${diff.scoreDelta}` : `${diff.scoreDelta}`;
    core.summary.addRaw(`Baseline delta: ${delta} (${diff.newFindings.length} new, ${diff.resolvedKeys.length} resolved)`);
    core.summary.addEOL();
  }

  await core.summary.write();
}

// --- Gate Evaluation ---

interface GateConfig {
  minScore: number;
  failOn: Severity;
  maxNewCritical: number;
  maxNewHigh?: number;
}

function evaluateGates(
  gatedScore: number,
  gatedFindings: Finding[],
  diff: BaselineDiff | undefined,
  config: GateConfig,
): string[] {
  const failures: string[] = [];

  if (gatedScore < config.minScore) {
    failures.push(`Score ${gatedScore} below minimum ${config.minScore}`);
  }

  const failingSeverities = gatedFindings.filter(
    (f) => severityLevel(f.severity) >= severityLevel(config.failOn),
  );
  if (failingSeverities.length > 0) {
    failures.push(`${failingSeverities.length} finding(s) at ${config.failOn}+`);
  }

  if (diff) {
    const newCritical = diff.newFindings.filter((f) => f.severity === "critical").length;
    const newHigh = diff.newFindings.filter((f) => f.severity === "high").length;

    if (newCritical > config.maxNewCritical) {
      failures.push(`${newCritical} new critical finding(s)`);
    }
    if (config.maxNewHigh !== undefined && newHigh > config.maxNewHigh) {
      failures.push(`${newHigh} new high finding(s)`);
    }
  }

  return failures;
}

// --- Helpers ---

function countBySeverity(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = { critical: 0, high: 0, med: 0, low: 0 };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
  }
  return counts;
}

function collectRemediations(findings: Finding[]): string[] {
  const seen = new Set<string>();
  const fixes: string[] = [];
  for (const f of findings) {
    for (const r of f.remediation) {
      if (!seen.has(r)) {
        seen.add(r);
        fixes.push(r);
      }
    }
  }
  return fixes;
}

run();
