import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readDeps, defaultHintsFromDeps } from "./deps.js";
import type { NextDepsIndex } from "./types.js";

describe("readDeps", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shipguard-deps-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when package.json is missing", () => {
    expect(() => readDeps(tmpDir)).toThrow("Failed to parse");
  });

  it("throws on malformed package.json", () => {
    writeFileSync(path.join(tmpDir, "package.json"), "not json");
    expect(() => readDeps(tmpDir)).toThrow("Failed to parse");
  });

  it("returns all false for empty dependencies", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: {} }));
    const deps = readDeps(tmpDir);
    expect(deps.hasNextAuth).toBe(false);
    expect(deps.hasClerk).toBe(false);
    expect(deps.hasPrisma).toBe(false);
    expect(deps.hasTrpc).toBe(false);
  });

  it("detects next-auth", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "next-auth": "5" } }));
    expect(readDeps(tmpDir).hasNextAuth).toBe(true);
  });

  it("detects @auth/core", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@auth/core": "1" } }));
    expect(readDeps(tmpDir).hasNextAuth).toBe(true);
  });

  it("detects @clerk/nextjs", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@clerk/nextjs": "5" } }));
    expect(readDeps(tmpDir).hasClerk).toBe(true);
  });

  it("detects @supabase/ssr", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@supabase/ssr": "0.1" } }));
    expect(readDeps(tmpDir).hasSupabase).toBe(true);
  });

  it("detects @supabase/auth-helpers-nextjs", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@supabase/auth-helpers-nextjs": "0.8" } }));
    expect(readDeps(tmpDir).hasSupabase).toBe(true);
  });

  it("detects @kinde-oss/kinde-auth-nextjs", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@kinde-oss/kinde-auth-nextjs": "2" } }));
    expect(readDeps(tmpDir).hasKinde).toBe(true);
  });

  it("detects @workos-inc/authkit-nextjs", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@workos-inc/authkit-nextjs": "1" } }));
    expect(readDeps(tmpDir).hasWorkOS).toBe(true);
  });

  it("detects better-auth", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "better-auth": "1" } }));
    expect(readDeps(tmpDir).hasBetterAuth).toBe(true);
  });

  it("detects lucia", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { lucia: "3" } }));
    expect(readDeps(tmpDir).hasLucia).toBe(true);
  });

  it("detects @auth0/nextjs-auth0", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@auth0/nextjs-auth0": "3" } }));
    expect(readDeps(tmpDir).hasAuth0).toBe(true);
  });

  it("detects iron-session", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "iron-session": "8" } }));
    expect(readDeps(tmpDir).hasIronSession).toBe(true);
  });

  it("detects firebase-admin", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "firebase-admin": "12" } }));
    expect(readDeps(tmpDir).hasFirebaseAuth).toBe(true);
  });

  it("detects @upstash/ratelimit", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@upstash/ratelimit": "1" } }));
    expect(readDeps(tmpDir).hasUpstashRatelimit).toBe(true);
  });

  it("detects @arcjet/next", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@arcjet/next": "1" } }));
    expect(readDeps(tmpDir).hasArcjet).toBe(true);
  });

  it("detects @unkey/ratelimit", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@unkey/ratelimit": "1" } }));
    expect(readDeps(tmpDir).hasUnkey).toBe(true);
  });

  it("detects @prisma/client", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@prisma/client": "5" } }));
    expect(readDeps(tmpDir).hasPrisma).toBe(true);
  });

  it("detects drizzle-orm", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "drizzle-orm": "0.30" } }));
    expect(readDeps(tmpDir).hasDrizzle).toBe(true);
  });

  it("detects @trpc/server", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { "@trpc/server": "11" } }));
    expect(readDeps(tmpDir).hasTrpc).toBe(true);
  });

  it("reads from devDependencies", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ devDependencies: { prisma: "5" } }));
    expect(readDeps(tmpDir).hasPrisma).toBe(true);
  });

  it("detects multiple deps together", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      dependencies: { "@clerk/nextjs": "5", "@prisma/client": "5", "@trpc/server": "11", "@upstash/ratelimit": "1" },
    }));
    const deps = readDeps(tmpDir);
    expect(deps.hasClerk).toBe(true);
    expect(deps.hasPrisma).toBe(true);
    expect(deps.hasTrpc).toBe(true);
    expect(deps.hasUpstashRatelimit).toBe(true);
  });

  it("merges deps from monorepo workspace root (pnpm-workspace.yaml)", () => {
    // Simulate monorepo: tmpDir/apps/web with pnpm-workspace.yaml at tmpDir
    const webDir = path.join(tmpDir, "apps", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - apps/*");
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      devDependencies: { "@prisma/client": "5", "next-auth": "5" },
    }));
    writeFileSync(path.join(webDir, "package.json"), JSON.stringify({
      dependencies: { "next": "14" },
    }));
    const deps = readDeps(webDir);
    expect(deps.hasPrisma).toBe(true);
    expect(deps.hasNextAuth).toBe(true);
  });

  it("merges deps from monorepo workspace root (turbo.json)", () => {
    const webDir = path.join(tmpDir, "apps", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(path.join(tmpDir, "turbo.json"), "{}");
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      dependencies: { "@trpc/server": "11" },
    }));
    writeFileSync(path.join(webDir, "package.json"), JSON.stringify({
      dependencies: { "next": "14" },
    }));
    const deps = readDeps(webDir);
    expect(deps.hasTrpc).toBe(true);
  });

  it("local deps take precedence over workspace root deps", () => {
    const webDir = path.join(tmpDir, "apps", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - apps/*");
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      dependencies: { "@clerk/nextjs": "4" },
    }));
    writeFileSync(path.join(webDir, "package.json"), JSON.stringify({
      dependencies: { "@clerk/nextjs": "5" },
    }));
    const deps = readDeps(webDir);
    expect(deps.hasClerk).toBe(true);
  });
});

describe("defaultHintsFromDeps", () => {
  const baseDeps: NextDepsIndex = {
    hasNextAuth: false, hasClerk: false, hasSupabase: false, hasKinde: false,
    hasWorkOS: false, hasBetterAuth: false, hasLucia: false, hasAuth0: false,
    hasIronSession: false, hasFirebaseAuth: false, hasUpstashRatelimit: false,
    hasArcjet: false, hasUnkey: false, hasPrisma: false, hasDrizzle: false, hasTrpc: false,
  };

  it("returns base auth functions with no deps", () => {
    const hints = defaultHintsFromDeps(baseDeps, false);
    expect(hints.auth.functions).toContain("auth");
    expect(hints.auth.functions).toContain("getServerSession");
    expect(hints.auth.functions).toContain("requireAuth");
  });

  it("adds Clerk auth functions", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasClerk: true }, false);
    expect(hints.auth.functions).toContain("currentUser");
    expect(hints.auth.functions).toContain("clerkClient");
  });

  it("adds NextAuth auth functions", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasNextAuth: true }, false);
    expect(hints.auth.functions).toContain("withAuth");
    expect(hints.auth.functions).toContain("getServerSession");
  });

  it("adds Kinde auth functions", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasKinde: true }, false);
    expect(hints.auth.functions).toContain("getKindeServerSession");
  });

  it("adds WorkOS auth functions", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasWorkOS: true }, false);
    expect(hints.auth.functions).toContain("authkitMiddleware");
    expect(hints.auth.functions).toContain("getUser");
  });

  it("adds Lucia auth functions", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasLucia: true }, false);
    expect(hints.auth.functions).toContain("validateRequest");
    expect(hints.auth.functions).toContain("validateSession");
  });

  it("adds Auth0 auth functions", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasAuth0: true }, false);
    expect(hints.auth.functions).toContain("withApiAuthRequired");
    expect(hints.auth.functions).toContain("withPageAuthRequired");
  });

  it("adds iron-session auth functions", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasIronSession: true }, false);
    expect(hints.auth.functions).toContain("getIronSession");
  });

  it("adds Firebase auth functions", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasFirebaseAuth: true }, false);
    expect(hints.auth.functions).toContain("verifyIdToken");
    expect(hints.auth.functions).toContain("getTokens");
    expect(hints.auth.functions).toContain("verifySessionCookie");
  });

  it("adds Upstash rate limit wrappers", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasUpstashRatelimit: true }, false);
    expect(hints.rateLimit.wrappers).toContain("Ratelimit");
    expect(hints.rateLimit.wrappers).toContain("ratelimit");
  });

  it("adds Arcjet rate limit wrappers", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasArcjet: true }, false);
    expect(hints.rateLimit.wrappers).toContain("aj.protect");
    expect(hints.rateLimit.wrappers).toContain("fixedWindow");
    expect(hints.rateLimit.wrappers).toContain("slidingWindow");
    expect(hints.rateLimit.wrappers).toContain("tokenBucket");
  });

  it("adds Unkey rate limit wrappers", () => {
    const hints = defaultHintsFromDeps({ ...baseDeps, hasUnkey: true }, false);
    expect(hints.rateLimit.wrappers).toContain("withUnkey");
    expect(hints.rateLimit.wrappers).toContain("verifyKey");
  });

  it("includes base rate limit wrappers always", () => {
    const hints = defaultHintsFromDeps(baseDeps, false);
    expect(hints.rateLimit.wrappers).toContain("rateLimit");
    expect(hints.rateLimit.wrappers).toContain("withRateLimit");
  });

  it("includes middleware file when present", () => {
    const hints = defaultHintsFromDeps(baseDeps, true);
    expect(hints.auth.middlewareFiles).toEqual(["middleware.ts"]);
  });

  it("excludes middleware file when absent", () => {
    const hints = defaultHintsFromDeps(baseDeps, false);
    expect(hints.auth.middlewareFiles).toEqual([]);
  });

  it("has tenancy org field names", () => {
    const hints = defaultHintsFromDeps(baseDeps, false);
    expect(hints.tenancy.orgFieldNames).toContain("orgId");
    expect(hints.tenancy.orgFieldNames).toContain("tenantId");
    expect(hints.tenancy.orgFieldNames).toContain("workspaceId");
    expect(hints.tenancy.orgFieldNames).toContain("organizationId");
    expect(hints.tenancy.orgFieldNames).toContain("teamId");
    expect(hints.tenancy.orgFieldNames).toContain("accountId");
  });
});
