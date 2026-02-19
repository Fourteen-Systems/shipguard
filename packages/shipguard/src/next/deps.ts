import path from "node:path";
import { readFileSync } from "node:fs";
import type { NextDepsIndex, NextHints } from "./types.js";

export function readDeps(rootDir: string): NextDepsIndex {
  const pkgPath = path.join(rootDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  return {
    hasNextAuth: Boolean(deps["next-auth"] || deps["@auth/core"] || deps["@auth/nextjs"]),
    hasClerk: Boolean(deps["@clerk/nextjs"]),
    hasUpstashRatelimit: Boolean(deps["@upstash/ratelimit"]),
    hasPrisma: Boolean(deps["prisma"] || deps["@prisma/client"]),
  };
}

export function defaultHintsFromDeps(deps: NextDepsIndex, hasMiddlewareTs: boolean): NextHints {
  const authFns = new Set<string>(["requireUser", "auth", "getServerSession"]);

  if (deps.hasNextAuth) {
    authFns.add("auth");
    authFns.add("getServerSession");
  }
  if (deps.hasClerk) {
    authFns.add("currentUser");
    authFns.add("auth");
    authFns.add("clerkClient");
  }

  const rl = new Set<string>(["rateLimit", "withRateLimit", "limit"]);
  if (deps.hasUpstashRatelimit) {
    rl.add("Ratelimit");
    rl.add("ratelimit");
  }

  return {
    auth: {
      functions: [...authFns],
      middlewareFiles: hasMiddlewareTs ? ["middleware.ts"] : [],
    },
    rateLimit: { wrappers: [...rl] },
    tenancy: { orgFieldNames: ["orgId", "tenantId", "workspaceId"] },
  };
}
