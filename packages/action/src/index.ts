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
} from "shipguard";

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
  const icon = status === "PASS" ? "\u2705" : status === "WARN" ? "\u26A0\uFE0F" : "\uD83D\uDEA8";

  // Header
  lines.push(`## ${icon} Shipguard`);
  lines.push("");
  lines.push(`**Score: ${gatedScore} ${status}**`);

  // Detected stack
  const detected = buildDetectedList(result);
  lines.push(`Detected: ${detected.join(" \u00B7 ")}`);
  lines.push("");

  if (gatedFindings.length === 0) {
    lines.push("No findings.");
  } else {
    // Severity summary table
    const counts = countBySeverity(gatedFindings);
    lines.push("| Severity | Count |");
    lines.push("|----------|-------|");
    if (counts.critical > 0) lines.push(`| Critical | ${counts.critical} |`);
    if (counts.high > 0) lines.push(`| High | ${counts.high} |`);
    if (counts.med > 0) lines.push(`| Med | ${counts.med} |`);
    if (counts.low > 0) lines.push(`| Low | ${counts.low} |`);
    lines.push("");

    // Findings table
    lines.push("### Findings");
    lines.push("");
    lines.push("| Rule | File | Confidence |");
    lines.push("|------|------|------------|");
    for (const f of gatedFindings) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`| ${f.ruleId} | \`${loc}\` | ${f.confidence} |`);
    }
    lines.push("");

    // Remediation
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
    lines.push(`> Score delta from baseline: **${delta}** (${diff.newFindings.length} new, ${diff.resolvedKeys.length} resolved)`);
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push(`*Shipguard ${result.shipguardVersion}*`);

  return lines.join("\n");
}

// --- Job Summary ---

async function writeSummary(gatedScore: number, gatedFindings: Finding[], diff?: BaselineDiff): Promise<void> {
  const status = scoreStatus(gatedScore);

  core.summary
    .addHeading("Shipguard Report")
    .addRaw(`**Score: ${gatedScore} ${status}** | Findings: ${gatedFindings.length}`)
    .addEOL();

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
