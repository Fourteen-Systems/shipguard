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
    console.log(pc.dim("  Example: prodcheck baseline --write"));
    return;
  }

  try {
    const rootDir = process.cwd();
    const result = await runScan({ rootDir });
    const dest = writeBaseline(rootDir, result, opts.output);

    console.log(pc.green(`  Baseline written to ${dest}`));
    console.log(pc.dim(`  Score: ${result.score} | Findings: ${result.findings.length}`));
  } catch (err) {
    console.error(pc.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}
