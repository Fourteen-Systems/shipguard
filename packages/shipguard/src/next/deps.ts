import path from "node:path";
import { readFileSync } from "node:fs";
import type { NextDepsIndex, NextHints } from "./types.js";
import { findWorkspaceRoot } from "../util/monorepo.js";

export function readDeps(rootDir: string): NextDepsIndex {
  const pkgPath = path.join(rootDir, "package.json");
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const deps = { ...((pkg.dependencies as Record<string, string>) ?? {}), ...((pkg.devDependencies as Record<string, string>) ?? {}) };

  // Merge workspace root deps for monorepo support
  const wsRoot = findWorkspaceRoot(rootDir);
  if (wsRoot) {
    try {
      const rootPkg = JSON.parse(readFileSync(path.join(wsRoot, "package.json"), "utf8"));
      const rootDeps = { ...((rootPkg.dependencies as Record<string, string>) ?? {}), ...((rootPkg.devDependencies as Record<string, string>) ?? {}) };
      for (const [k, v] of Object.entries(rootDeps)) {
        if (!(k in deps)) deps[k] = v;
      }
    } catch {
      // Ignore errors reading workspace root package.json
    }
  }

  return {
    hasNextAuth: Boolean(deps["next-auth"] || deps["@auth/core"] || deps["@auth/nextjs"]),
    hasClerk: Boolean(deps["@clerk/nextjs"]),
    hasSupabase: Boolean(deps["@supabase/ssr"] || deps["@supabase/auth-helpers-nextjs"]),
    hasKinde: Boolean(deps["@kinde-oss/kinde-auth-nextjs"]),
    hasWorkOS: Boolean(deps["@workos-inc/authkit-nextjs"] || deps["@workos-inc/node"]),
    hasBetterAuth: Boolean(deps["better-auth"]),
    hasLucia: Boolean(deps["lucia"]),
    hasAuth0: Boolean(deps["@auth0/nextjs-auth0"]),
    hasIronSession: Boolean(deps["iron-session"]),
    hasFirebaseAuth: Boolean(deps["firebase-admin"] || deps["next-firebase-auth-edge"]),
    hasUpstashRatelimit: Boolean(deps["@upstash/ratelimit"]),
    hasArcjet: Boolean(deps["@arcjet/next"]),
    hasUnkey: Boolean(deps["@unkey/ratelimit"] || deps["@unkey/nextjs"]),
    hasPrisma: Boolean(deps["prisma"] || deps["@prisma/client"]),
    hasDrizzle: Boolean(deps["drizzle-orm"]),
    hasTrpc: Boolean(deps["@trpc/server"]),
  };
}

export function defaultHintsFromDeps(deps: NextDepsIndex, hasMiddlewareTs: boolean): NextHints {
  const authFns = new Set<string>(["requireUser", "requireAuth", "auth", "getServerSession", "getSession"]);

  if (deps.hasNextAuth) {
    authFns.add("auth");
    authFns.add("getServerSession");
    authFns.add("withAuth");
  }
  if (deps.hasClerk) {
    authFns.add("currentUser");
    authFns.add("auth");
    authFns.add("clerkClient");
  }
  if (deps.hasKinde) {
    authFns.add("getKindeServerSession");
  }
  if (deps.hasWorkOS) {
    authFns.add("withAuth");
    authFns.add("getUser");
    authFns.add("authkitMiddleware");
  }
  if (deps.hasBetterAuth) {
    authFns.add("auth");
  }
  if (deps.hasLucia) {
    authFns.add("validateRequest");
    authFns.add("validateSession");
  }
  if (deps.hasAuth0) {
    authFns.add("getSession");
    authFns.add("withApiAuthRequired");
    authFns.add("withPageAuthRequired");
  }
  if (deps.hasIronSession) {
    authFns.add("getIronSession");
  }
  if (deps.hasFirebaseAuth) {
    authFns.add("verifyIdToken");
    authFns.add("getTokens");
    authFns.add("verifySessionCookie");
  }

  const rl = new Set<string>([
    "rateLimit", "withRateLimit", "limit",
    "checkRateLimitAndThrowError",  // cal.com pattern
    "ratelimitOrThrow",             // dub pattern
    "rateLimitOrThrow",             // common variant
  ]);
  if (deps.hasUpstashRatelimit) {
    rl.add("Ratelimit");
    rl.add("ratelimit");
  }
  if (deps.hasArcjet) {
    rl.add("aj.protect");
    rl.add("fixedWindow");
    rl.add("slidingWindow");
    rl.add("tokenBucket");
  }
  if (deps.hasUnkey) {
    rl.add("withUnkey");
    rl.add("verifyKey");
  }

  return {
    auth: {
      functions: [...authFns],
      middlewareFiles: hasMiddlewareTs ? ["middleware.ts"] : [],
      allowlistPaths: [],
    },
    rateLimit: { wrappers: [...rl], allowlistPaths: [] },
    tenancy: { orgFieldNames: ["orgId", "tenantId", "workspaceId", "organizationId", "teamId", "accountId"] },
  };
}
