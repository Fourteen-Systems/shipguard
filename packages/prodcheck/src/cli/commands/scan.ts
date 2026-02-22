import { writeFileSync } from "node:fs";
import pc from "picocolors";
import { runScan } from "../../engine/run.js";
import { formatPretty, formatJson } from "../../engine/report.js";
import { formatSarif } from "../../engine/sarif.js";
import { computeScore, summarizeFindings, confidenceLevel, parseConfidence } from "../../engine/score.js";
import type { Severity } from "../../next/types.js";
import type { ProdcheckConfig } from "../../engine/types.js";

interface ScanOptions {
  format: string;
  output?: string;
  only?: string;
  exclude?: string;
  minConfidence?: string;
}

export async function cmdScan(opts: ScanOptions): Promise<void> {
  try {
    const rootDir = process.cwd();

    // Build config overrides from CLI flags
    const configOverrides: Partial<ProdcheckConfig> = {};

    if (opts.only) {
      const onlyRules = opts.only.split(",").map((r) => r.trim().toUpperCase());
      const rules: Record<string, { severity: Severity }> = {};
      for (const ruleId of onlyRules) {
        rules[ruleId] = { severity: "critical" };
      }
      configOverrides.rules = rules;
    }

    const additionalExclude = opts.exclude
      ? opts.exclude.split(",").map((g) => g.trim())
      : undefined;

    // Progress indicator for interactive terminals
    const isTTY = process.stderr.isTTY;
    const onProgress = isTTY
      ? (step: string) => {
          process.stderr.write(`\r  ${pc.dim("⏳")} ${pc.dim(step)}${"".padEnd(20)}\r`);
        }
      : undefined;

    const result = await runScan({ rootDir, configOverrides, additionalExclude, onProgress });

    // Clear progress line
    if (isTTY) process.stderr.write("\r".padEnd(60) + "\r");

    // Filter by confidence if specified, recalculate score and summary
    if (opts.minConfidence) {
      const minConf = parseConfidence(opts.minConfidence);
      result.findings = result.findings.filter(
        (f) => confidenceLevel(f.confidence) >= confidenceLevel(minConf),
      );
      result.score = computeScore(result.findings);
      const counts = summarizeFindings(result.findings);
      result.summary = { total: result.findings.length, ...counts, waived: result.summary.waived };
    }

    let output: string;
    switch (opts.format) {
      case "json":
        output = formatJson(result);
        break;
      case "sarif":
        output = formatSarif(result);
        break;
      default:
        output = formatPretty(result);
    }

    if (opts.output) {
      writeFileSync(opts.output, output);
    } else {
      console.log(output);
    }
  } catch (err) {
    console.error(pc.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}
