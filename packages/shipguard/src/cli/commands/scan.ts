import { writeFileSync } from "node:fs";
import { runScan } from "../../engine/run.js";
import { formatPretty, formatJson } from "../../engine/report.js";
import { formatSarif } from "../../engine/sarif.js";
import type { Confidence } from "../../next/types.js";

interface ScanOptions {
  format: string;
  output?: string;
  only?: string;
  exclude?: string;
  minConfidence?: string;
}

export async function cmdScan(opts: ScanOptions): Promise<void> {
  const rootDir = process.cwd();

  const result = await runScan({ rootDir });

  // Filter by confidence if specified
  if (opts.minConfidence) {
    const minConf = opts.minConfidence as Confidence;
    result.findings = result.findings.filter(
      (f) => confidenceLevel(f.confidence) >= confidenceLevel(minConf),
    );
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
}

function confidenceLevel(c: Confidence): number {
  switch (c) {
    case "high": return 3;
    case "med": return 2;
    case "low": return 1;
  }
}
