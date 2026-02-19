import type { ShipguardConfig, ScanResult, Finding } from "./types.js";
import { DEFAULT_CONFIG, loadConfigIfExists } from "./config.js";
import { buildNextIndex } from "../next/index.js";
import { runAllRules } from "../rules/index.js";
import { loadWaivers, applyWaivers } from "./waivers.js";
import { computeScore, summarizeFindings } from "./score.js";

export interface RunOptions {
  rootDir: string;
  configOverrides?: Partial<ShipguardConfig>;
}

export async function runScan(opts: RunOptions): Promise<ScanResult> {
  const userConfig = loadConfigIfExists(opts.rootDir);
  const config: ShipguardConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    ...opts.configOverrides,
    hints: {
      ...DEFAULT_CONFIG.hints,
      ...userConfig?.hints,
      ...opts.configOverrides?.hints,
    },
    ci: {
      ...DEFAULT_CONFIG.ci,
      ...userConfig?.ci,
      ...opts.configOverrides?.ci,
    },
  };

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
    timestamp: new Date().toISOString(),
    framework: index.framework,
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
      functions: [...new Set([...userHints.auth.functions, ...detectedHints.auth.functions])],
      middlewareFiles: [...new Set([...userHints.auth.middlewareFiles, ...detectedHints.auth.middlewareFiles])],
    },
    rateLimit: {
      wrappers: [...new Set([...userHints.rateLimit.wrappers, ...detectedHints.rateLimit.wrappers])],
    },
    tenancy: {
      orgFieldNames: [...new Set([...userHints.tenancy.orgFieldNames, ...detectedHints.tenancy.orgFieldNames])],
    },
  };
}
