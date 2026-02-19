import { writeFileSync } from "node:fs";
import pc from "picocolors";
import { runScan } from "../../engine/run.js";
import { formatPretty, formatJson } from "../../engine/report.js";
import { formatSarif } from "../../engine/sarif.js";
import { loadBaseline, diffBaseline } from "../../engine/baseline.js";
import type { Confidence, Severity } from "../../next/types.js";

interface CiOptions {
  failOn: string;
  minConfidence: string;
  minScore: string;
  baseline?: string;
  maxNewCritical: string;
  maxNewHigh?: string;
  format: string;
  output?: string;
}

export async function cmdCi(opts: CiOptions): Promise<void> {
  const rootDir = process.cwd();
  const result = await runScan({ rootDir });

  const minConf = (opts.minConfidence ?? "high") as Confidence;
  const failOnSeverity = (opts.failOn ?? "critical") as Severity;
  const minScore = parseInt(opts.minScore ?? "70", 10);
  const maxNewCritical = parseInt(opts.maxNewCritical ?? "0", 10);
  const maxNewHigh = opts.maxNewHigh !== undefined ? parseInt(opts.maxNewHigh, 10) : undefined;

  // Filter findings by confidence for failure evaluation
  const gatedFindings = result.findings.filter(
    (f) => confidenceLevel(f.confidence) >= confidenceLevel(minConf),
  );

  // Check baseline
  let diff;
  if (opts.baseline) {
    const baseline = loadBaseline(opts.baseline);
    if (baseline) {
      diff = diffBaseline(baseline, result);
    }
  }

  // Output report
  let output: string;
  switch (opts.format) {
    case "json":
      output = formatJson(result);
      break;
    case "sarif":
      output = formatSarif(result);
      break;
    default:
      output = formatPretty(result, diff);
  }

  if (opts.output) {
    writeFileSync(opts.output, output);
  }
  console.log(output);

  // Evaluate gates
  const failures: string[] = [];

  // Score gate
  if (result.score < minScore) {
    failures.push(`Score ${result.score} is below minimum ${minScore}`);
  }

  // Severity gate: any findings at or above fail-on severity with sufficient confidence
  const failingSeverities = gatedFindings.filter(
    (f) => severityLevel(f.severity) >= severityLevel(failOnSeverity),
  );
  if (failingSeverities.length > 0) {
    failures.push(`${failingSeverities.length} finding(s) at ${failOnSeverity} or above (${minConf}+ confidence)`);
  }

  // New findings gate (baseline)
  if (diff) {
    const newCritical = diff.newFindings.filter((f) => f.severity === "critical").length;
    const newHigh = diff.newFindings.filter((f) => f.severity === "high").length;

    if (newCritical > maxNewCritical) {
      failures.push(`${newCritical} new critical finding(s) exceeds max ${maxNewCritical}`);
    }
    if (maxNewHigh !== undefined && newHigh > maxNewHigh) {
      failures.push(`${newHigh} new high finding(s) exceeds max ${maxNewHigh}`);
    }
  }

  if (failures.length > 0) {
    console.log(pc.red("\n  CI FAILED:"));
    for (const f of failures) {
      console.log(pc.red(`    - ${f}`));
    }
    console.log("");
    process.exit(1);
  } else {
    console.log(pc.green("\n  CI PASSED\n"));
  }
}

function confidenceLevel(c: Confidence): number {
  switch (c) {
    case "high": return 3;
    case "med": return 2;
    case "low": return 1;
  }
}

function severityLevel(s: Severity): number {
  switch (s) {
    case "critical": return 4;
    case "high": return 3;
    case "med": return 2;
    case "low": return 1;
  }
}
