import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ProdcheckConfig } from "./types.js";

const CONFIG_FILES = [
  "prodcheck.config.ts",
  "prodcheck.config.js",
  "prodcheck.config.json",
];

export function findConfigFile(rootDir: string): string | undefined {
  for (const name of CONFIG_FILES) {
    const abs = path.join(rootDir, name);
    if (existsSync(abs)) return abs;
  }
  return undefined;
}

export function loadConfigIfExists(rootDir: string): ProdcheckConfig | undefined {
  const file = findConfigFile(rootDir);
  if (!file) return undefined;

  if (file.endsWith(".json")) {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as ProdcheckConfig;
    } catch (err) {
      throw new Error(`Failed to parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // TS/JS config requires a loader (tsx, jiti) — not yet supported.
  return undefined;
}

export const DEFAULT_CONFIG: ProdcheckConfig = {
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
    penalties: { critical: 15, high: 6, med: 3, low: 1 },
  },
  hints: {
    auth: {
      functions: [
        "auth", "getServerSession", "getSession", "currentUser",
        "requireUser", "requireAuth",
        "withAuth",                 // NextAuth v4 / WorkOS
        "getKindeServerSession",    // Kinde
        "validateRequest",          // Lucia
        "getIronSession",           // iron-session
        "withApiAuthRequired",      // Auth0
        "verifyIdToken",            // Firebase Admin
        "getTokens",               // next-firebase-auth-edge
      ],
      middlewareFiles: ["middleware.ts"],
      allowlistPaths: [],
    },
    rateLimit: {
      wrappers: [
        "rateLimit", "withRateLimit", "ratelimit", "limit",
        "checkRateLimitAndThrowError", "ratelimitOrThrow", "rateLimitOrThrow",
      ],
      allowlistPaths: [],
    },
    tenancy: {
      orgFieldNames: ["orgId", "tenantId", "workspaceId", "organizationId", "teamId", "accountId"],
    },
  },
  rules: {
    "AUTH-BOUNDARY-MISSING": { severity: "critical" },
    "RATE-LIMIT-MISSING": { severity: "critical" },
    "TENANCY-SCOPE-MISSING": { severity: "critical" },
    "INPUT-VALIDATION-MISSING": { severity: "high" },
    "WRAPPER-UNRECOGNIZED": { severity: "high" },
  },
  waiversFile: "prodcheck.waivers.json",
};

export function writeDefaultConfig(rootDir: string, opts: { force?: boolean }): void {
  const dest = path.join(rootDir, "prodcheck.config.json");
  if (existsSync(dest) && !opts.force) {
    return;
  }

  const config = {
    $schema: "https://prodcheck.dev/schema.json",
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
        functions: [
          "auth", "getServerSession", "getSession", "currentUser",
          "requireUser", "requireAuth",
          "withAuth", "getKindeServerSession", "validateRequest",
          "getIronSession", "withApiAuthRequired", "verifyIdToken", "getTokens"
        ],
        middlewareFiles: ["middleware.ts"],
        allowlistPaths: []
      },
      rateLimit: {
        wrappers: [
          "rateLimit", "withRateLimit", "limit",
          "checkRateLimitAndThrowError", "ratelimitOrThrow", "rateLimitOrThrow"
        ],
        allowlistPaths: []
      },
      tenancy: {
        orgFieldNames: ["orgId", "tenantId", "workspaceId", "organizationId", "teamId", "accountId"]
      },
    },
    rules: {
      "AUTH-BOUNDARY-MISSING": { severity: "critical" },
      "RATE-LIMIT-MISSING": { severity: "critical" },
      "TENANCY-SCOPE-MISSING": { severity: "critical" },
      "INPUT-VALIDATION-MISSING": { severity: "high" },
      "WRAPPER-UNRECOGNIZED": { severity: "high" },
    },
    scoring: {
      start: 100,
      penalties: { critical: 15, high: 6, med: 3, low: 1 },
    },
    waiversFile: "prodcheck.waivers.json",
  };

  writeFileSync(dest, JSON.stringify(config, null, 2) + "\n");
}
