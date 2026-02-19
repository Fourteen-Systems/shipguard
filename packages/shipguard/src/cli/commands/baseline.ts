import pc from "picocolors";
import { runScan } from "../../engine/run.js";
import { writeBaseline } from "../../engine/baseline.js";

interface BaselineOptions {
  write?: boolean;
  output?: string;
}

export async function cmdBaseline(opts: BaselineOptions): Promise<void> {
  if (!opts.write) {
    console.log(pc.dim("  Use --write to save a baseline snapshot."));
    console.log(pc.dim("  Example: shipguard baseline --write"));
    return;
  }

  const rootDir = process.cwd();
  const result = await runScan({ rootDir });
  const dest = writeBaseline(rootDir, result, opts.output);

  console.log(pc.green(`  Baseline written to ${dest}`));
  console.log(pc.dim(`  Score: ${result.score}/100 | Findings: ${result.findings.length}`));
}
