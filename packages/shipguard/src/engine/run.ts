import type { ShipguardConfig, ScanResult, Finding } from "./types.js";
import { DEFAULT_CONFIG, loadConfigIfExists } from "./config.js";
import { buildNextIndex } from "../next/index.js";
import { runAllRules } from "../rules/index.js";
import { loadWaivers, applyWaivers } from "./waivers.js";
import { computeScore, summarizeFindings } from "./score.js";
import { SHIPGUARD_VERSION, INDEX_VERSION, hashConfig } from "./version.js";

export interface RunOptions {
  rootDir: string;
  configOverrides?: Partial<ShipguardConfig>;
  /** Additional exclude globs appended to config excludes (not replacing) */
  additionalExclude?: string[];
}

export async function runScan(opts: RunOptions): Promise<ScanResult> {
  const userConfig = loadConfigIfExists(opts.rootDir);
  const config: ShipguardConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    ...opts.configOverrides,
    scoring: {
      ...DEFAULT_CONFIG.scoring,
      ...userConfig?.scoring,
      ...opts.configOverrides?.scoring,
      penalties: {
        ...DEFAULT_CONFIG.scoring.penalties,
        ...userConfig?.scoring?.penalties,
        ...opts.configOverrides?.scoring?.penalties,
      },
    },
    hints: {
      auth: {
        functions: userConfig?.hints?.auth?.functions ?? DEFAULT_CONFIG.hints.auth.functions,
        middlewareFiles: userConfig?.hints?.auth?.middlewareFiles ?? DEFAULT_CONFIG.hints.auth.middlewareFiles,
        allowlistPaths: userConfig?.hints?.auth?.allowlistPaths ?? DEFAULT_CONFIG.hints.auth.allowlistPaths,
      },
      rateLimit: {
        wrappers: userConfig?.hints?.rateLimit?.wrappers ?? DEFAULT_CONFIG.hints.rateLimit.wrappers,
        allowlistPaths: userConfig?.hints?.rateLimit?.allowlistPaths ?? DEFAULT_CONFIG.hints.rateLimit.allowlistPaths,
      },
      tenancy: {
        orgFieldNames: userConfig?.hints?.tenancy?.orgFieldNames ?? DEFAULT_CONFIG.hints.tenancy.orgFieldNames,
      },
    },
    ci: {
      ...DEFAULT_CONFIG.ci,
      ...userConfig?.ci,
      ...opts.configOverrides?.ci,
    },
    rules: {
      ...DEFAULT_CONFIG.rules,
      ...userConfig?.rules,
      ...opts.configOverrides?.rules,
    },
  };

  // Merge additional excludes from CLI flags
  if (opts.additionalExclude?.length) {
    config.exclude = [...config.exclude, ...opts.additionalExclude];
  }

  // Build Next.js index
  const index = await buildNextIndex(opts.rootDir, config.exclude);

  // Merge auto-detected hints with user config
  const mergedHints = mergeHints(config.hints, index.hints);

  // Run rules
  const rawFindings = runAllRules(index, { ...config, hints: mergedHints });

  // Apply waivers
  const waivers = loadWaivers(opts.rootDir, config.waiversFile);
  const { active, waived } = applyWaivers(rawFindings, waivers);

  // Score
  const score = computeScore(active, config.scoring);
  const counts = summarizeFindings(active);

  return {
    version: 1,
    shipguardVersion: SHIPGUARD_VERSION,
    configHash: hashConfig(config),
    indexVersion: INDEX_VERSION,
    timestamp: new Date().toISOString(),
    framework: index.framework,
    detected: {
      deps: index.deps,
      trpc: index.trpc.detected,
      middleware: index.middleware.authLikely || index.middleware.rateLimitLikely,
    },
    score,
    findings: active,
    waivedFindings: waived,
    summary: {
      total: active.length,
      ...counts,
      waived: waived.length,
    },
  };
}

function mergeHints(
  userHints: ShipguardConfig["hints"],
  detectedHints: ShipguardConfig["hints"],
): ShipguardConfig["hints"] {
  return {
    auth: {
      functions: [...new Set([...(userHints.auth?.functions ?? []), ...(detectedHints.auth?.functions ?? [])])],
      middlewareFiles: [...new Set([...(userHints.auth?.middlewareFiles ?? []), ...(detectedHints.auth?.middlewareFiles ?? [])])],
      allowlistPaths: [...new Set([...(userHints.auth?.allowlistPaths ?? []), ...(detectedHints.auth?.allowlistPaths ?? [])])],
    },
    rateLimit: {
      wrappers: [...new Set([...(userHints.rateLimit?.wrappers ?? []), ...(detectedHints.rateLimit?.wrappers ?? [])])],
      allowlistPaths: [...new Set([...(userHints.rateLimit?.allowlistPaths ?? []), ...(detectedHints.rateLimit?.allowlistPaths ?? [])])],
    },
    tenancy: {
      orgFieldNames: [...new Set([...(userHints.tenancy?.orgFieldNames ?? []), ...(detectedHints.tenancy?.orgFieldNames ?? [])])],
    },
  };
}
