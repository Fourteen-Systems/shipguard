import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ShipguardConfig } from "./types.js";

const CONFIG_FILES = [
  "shipguard.config.ts",
  "shipguard.config.js",
  "shipguard.config.json",
];

export function findConfigFile(rootDir: string): string | undefined {
  for (const name of CONFIG_FILES) {
    const abs = path.join(rootDir, name);
    if (existsSync(abs)) return abs;
  }
  return undefined;
}

export function loadConfigIfExists(rootDir: string): ShipguardConfig | undefined {
  const file = findConfigFile(rootDir);
  if (!file) return undefined;

  // For v1, only support JSON config natively.
  // TS/JS config requires a loader (tsx, jiti, etc.) — add in v1.1.
  if (file.endsWith(".json")) {
    return JSON.parse(readFileSync(file, "utf8")) as ShipguardConfig;
  }

  // For .ts/.js, do a basic regex extraction of the config object.
  // This is a placeholder — replace with proper TS config loading.
  // For now, return defaults if we detect a TS/JS config exists.
  return undefined;
}

export const DEFAULT_CONFIG: ShipguardConfig = {
  framework: "next-app-router",
  include: ["app/**", "src/**"],
  exclude: ["**/*.test.*", "**/*.spec.*", "**/node_modules/**"],
  ci: {
    failOn: "critical",
    minConfidence: "high",
    minScore: 70,
    maxNewCritical: 0,
  },
  scoring: {
    start: 100,
    penalties: { critical: 25, high: 10, med: 3, low: 1 },
  },
  hints: {
    auth: {
      functions: ["auth", "getServerSession", "currentUser", "requireUser"],
      middlewareFiles: ["middleware.ts"],
    },
    rateLimit: {
      wrappers: ["rateLimit", "withRateLimit", "ratelimit", "limit"],
    },
    tenancy: {
      orgFieldNames: ["orgId", "tenantId", "workspaceId"],
    },
  },
  rules: {
    "AUTH-BOUNDARY-MISSING": { severity: "critical" },
    "RATE-LIMIT-MISSING": { severity: "critical" },
    "TENANCY-SCOPE-MISSING": { severity: "critical" },
  },
  waiversFile: "shipguard.waivers.json",
};

export function writeDefaultConfig(rootDir: string, opts: { force?: boolean }): void {
  const dest = path.join(rootDir, "shipguard.config.json");
  if (existsSync(dest) && !opts.force) {
    return;
  }

  const config = {
    $schema: "https://shipguard.dev/schema.json",
    framework: "next-app-router",
    include: ["app/**", "src/**"],
    exclude: ["**/*.test.*", "**/*.spec.*"],
    ci: {
      failOn: "critical",
      minConfidence: "high",
      minScore: 70,
      maxNewCritical: 0,
    },
    hints: {
      auth: {
        functions: ["auth", "getServerSession", "currentUser", "requireUser"],
        middlewareFiles: ["middleware.ts"],
      },
      rateLimit: {
        wrappers: ["rateLimit", "withRateLimit", "limit"],
      },
      tenancy: {
        orgFieldNames: ["orgId", "tenantId", "workspaceId"],
      },
    },
    waiversFile: "shipguard.waivers.json",
  };

  writeFileSync(dest, JSON.stringify(config, null, 2) + "\n");
}
