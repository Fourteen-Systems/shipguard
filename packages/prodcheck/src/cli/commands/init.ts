import pc from "picocolors";
import { findConfigFile, writeDefaultConfig } from "../../engine/config.js";
import { runScan } from "../../engine/run.js";
import { scoreStatus } from "../../engine/score.js";
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
    console.error(pc.red(`\n  Prodcheck v1 requires a Next.js App Router project.`));
    console.error(pc.dim(`  Reason: ${det.reason}`));
    console.error(pc.dim(`  Make sure you're in the project root with package.json and app/ directory.\n`));
    process.exit(1);
  }
  console.log(pc.green("  Detected Next.js App Router"));

  // 2. Detect dependencies and print what we found
  const deps = readDeps(rootDir);
  const detected: string[] = ["next-app-router"];
  if (deps.hasNextAuth) detected.push("next-auth");
  if (deps.hasClerk) detected.push("clerk");
  if (deps.hasSupabase) detected.push("supabase");
  if (deps.hasPrisma) detected.push("prisma");
  if (deps.hasDrizzle) detected.push("drizzle");
  if (deps.hasTrpc) detected.push("trpc");
  if (deps.hasUpstashRatelimit) detected.push("upstash-ratelimit");

  // Check for middleware
  const hasMiddleware = existsSync(path.join(rootDir, "middleware.ts"))
    || existsSync(path.join(rootDir, "middleware.js"))
    || existsSync(path.join(rootDir, "src/middleware.ts"))
    || existsSync(path.join(rootDir, "src/middleware.js"));
  if (hasMiddleware) detected.push("middleware.ts");

  console.log(pc.green(`  Detected: ${detected.join(" · ")}`));

  // 3. Write config (idempotent)
  const existingConfig = findConfigFile(rootDir);
  if (existingConfig && !opts.force) {
    console.log(pc.dim(`  Found existing config → skipping generation (${path.basename(existingConfig)})`));
  } else if (opts.dryRun) {
    console.log(pc.dim("  Would create prodcheck.config.json (--dry-run)"));
  } else {
    writeDefaultConfig(rootDir, { force: Boolean(opts.force) });
    console.log(pc.green("  Created prodcheck.config.json"));
  }

  // 4. Run scan
  console.log(pc.dim("\n  Running scan..."));
  try {
    const result = await runScan({ rootDir });

    const status = scoreStatus(result.score);
    const scoreColor = status === "PASS" ? pc.green : status === "WARN" ? pc.yellow : pc.red;
    console.log(`\n  Prodcheck Score: ${scoreColor(String(result.score))} ${scoreColor(status)}`);

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

    // Wrapper suggestions
    const wrapperFindings = result.findings.filter((f) => f.ruleId === "WRAPPER-UNRECOGNIZED");
    if (wrapperFindings.length > 0) {
      console.log(pc.yellow("\n  Wrapper hints needed:"));
      for (const f of wrapperFindings) {
        const nameMatch = f.message.match(/Wrapper "(\w+)"/);
        if (!nameMatch) continue;
        const name = nameMatch[1];

        // Determine suggestion based on evidence
        const hasAuth = f.evidence.some((e) => e.startsWith("Auth call detected:"));
        const hasRL = f.evidence.some((e) => e.startsWith("Rate-limit call detected:"));
        const isUnresolved = f.message.includes("could not be resolved");
        const isUnverified = f.message.includes("enforcement not proven");

        if (isUnresolved) {
          console.log(pc.dim(`    ${name} — wraps routes but could not be resolved`));
          console.log(pc.dim(`      If auth:       add "${name}" to hints.auth.functions`));
          console.log(pc.dim(`      If rate limit:  add "${name}" to hints.rateLimit.wrappers`));
        } else if (isUnverified) {
          if (hasAuth && !hasRL) {
            console.log(pc.dim(`    ${name} — calls auth but enforcement not proven`));
            console.log(pc.dim(`      Verify wrapper or add "${name}" to hints.auth.functions`));
          } else if (hasRL && !hasAuth) {
            console.log(pc.dim(`    ${name} — calls rate limiter but enforcement not proven`));
            console.log(pc.dim(`      Verify wrapper or add "${name}" to hints.rateLimit.wrappers`));
          } else {
            console.log(pc.dim(`    ${name} — missing protections`));
            console.log(pc.dim(`      If auth:       add "${name}" to hints.auth.functions`));
            console.log(pc.dim(`      If rate limit:  add "${name}" to hints.rateLimit.wrappers`));
          }
        }
      }
    }

    // Next steps
    console.log(pc.dim("\n  Next:"));
    console.log(pc.dim("    prodcheck baseline --write     Save current state as baseline"));
    console.log(pc.dim("    prodcheck explain <RULE>        Learn about a specific rule"));
    console.log(pc.dim("    prodcheck ci                    Run in CI mode"));
    console.log("");
  } catch (err) {
    console.error(pc.red(`  Scan failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}
