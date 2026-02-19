import pc from "picocolors";
import { findConfigFile, writeDefaultConfig } from "../../engine/config.js";
import { runScan } from "../../engine/run.js";
import { readDeps, defaultHintsFromDeps } from "../../next/deps.js";
import { detectNextAppRouter } from "../../next/detect.js";
import { existsSync } from "node:fs";
import path from "node:path";

interface InitOptions {
  force?: boolean;
  dryRun?: boolean;
}

export async function cmdInit(opts: InitOptions): Promise<void> {
  const rootDir = process.cwd();

  // 1. Detect framework
  const det = detectNextAppRouter(rootDir);
  if (!det.ok) {
    console.error(pc.red(`\n  Shipguard v1 requires a Next.js App Router project.`));
    console.error(pc.dim(`  Reason: ${det.reason}`));
    console.error(pc.dim(`  Make sure you're in the project root with package.json and app/ directory.\n`));
    process.exit(1);
  }
  console.log(pc.green("  Detected Next.js App Router"));

  // 2. Detect dependencies and print hints
  const deps = readDeps(rootDir);
  if (deps.hasNextAuth) console.log(pc.green("  Detected next-auth → added auth hints"));
  if (deps.hasClerk) console.log(pc.green("  Detected @clerk/nextjs → added auth hints"));
  if (deps.hasUpstashRatelimit) console.log(pc.green("  Detected @upstash/ratelimit → added rate limit hints"));
  if (deps.hasPrisma) console.log(pc.green("  Detected Prisma → added tenancy hints"));

  // 3. Write config (idempotent)
  const existingConfig = findConfigFile(rootDir);
  if (existingConfig && !opts.force) {
    console.log(pc.dim(`  Found existing config → skipping generation (${path.basename(existingConfig)})`));
  } else if (opts.dryRun) {
    console.log(pc.dim("  Would create shipguard.config.json (--dry-run)"));
  } else {
    writeDefaultConfig(rootDir, { force: Boolean(opts.force) });
    console.log(pc.green("  Created shipguard.config.json"));
  }

  // 4. Run scan
  console.log(pc.dim("\n  Running scan..."));
  try {
    const result = await runScan({ rootDir });

    const scoreColor = result.score >= 80 ? pc.green : result.score >= 50 ? pc.yellow : pc.red;
    console.log(`\n  Shipguard Score: ${scoreColor(`${result.score}/100`)}`);

    if (result.findings.length === 0) {
      console.log(pc.green("  No findings — looking good!"));
    } else {
      // Show top 5 findings
      const top = result.findings.slice(0, 5);
      for (const f of top) {
        const loc = f.line ? `:${f.line}` : "";
        const conf = pc.dim(`(${f.confidence})`);
        console.log(`  ${pc.red(f.ruleId)} ${conf} ${pc.dim(f.file + loc)}`);
      }
      if (result.findings.length > 5) {
        console.log(pc.dim(`  ... and ${result.findings.length - 5} more`));
      }
    }

    // Next steps
    console.log(pc.dim("\n  Next:"));
    console.log(pc.dim("    shipguard baseline --write     Save current state as baseline"));
    console.log(pc.dim("    shipguard explain <RULE>        Learn about a specific rule"));
    console.log(pc.dim("    shipguard ci                    Run in CI mode"));
    console.log("");
  } catch (err) {
    console.error(pc.red(`  Scan failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}
