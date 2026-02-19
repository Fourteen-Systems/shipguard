import * as core from "@actions/core";
import { runScan } from "shipguard";

async function run(): Promise<void> {
  try {
    const rootDir = process.cwd();
    const result = await runScan({ rootDir });

    const minScore = parseInt(core.getInput("min-score") || "70", 10);
    const failOn = core.getInput("fail-on") || "critical";
    const minConfidence = core.getInput("min-confidence") || "high";
    const maxNewCritical = parseInt(core.getInput("max-new-critical") || "0", 10);

    // Set outputs
    core.setOutput("score", result.score);
    core.setOutput("findings", result.findings.length);
    core.setOutput("critical", result.summary.critical);

    // Create annotations for each finding
    for (const f of result.findings) {
      const annotation = `${f.ruleId}: ${f.message}`;
      if (f.severity === "critical") {
        core.error(annotation, { file: f.file, startLine: f.line });
      } else if (f.severity === "high") {
        core.warning(annotation, { file: f.file, startLine: f.line });
      } else {
        core.notice(annotation, { file: f.file, startLine: f.line });
      }
    }

    // Summary
    core.summary
      .addHeading("Shipguard Report")
      .addRaw(`Score: ${result.score}/100 | Findings: ${result.findings.length}`)
      .write();

    // Check gates
    if (result.score < minScore) {
      core.setFailed(`Shipguard score ${result.score} is below minimum ${minScore}`);
    }

    const criticalCount = result.summary.critical;
    if (criticalCount > maxNewCritical) {
      core.setFailed(`${criticalCount} critical finding(s) found`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
