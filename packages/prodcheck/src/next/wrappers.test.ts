import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildWrapperIndex, analyzeWrapperBody, computeProtection } from "./wrappers.js";
import type { NextRoute, NextMiddlewareIndex, NextHints, WrapperIndex } from "./types.js";

function makeRoute(overrides: Partial<NextRoute> = {}): NextRoute {
  return {
    kind: "route-handler",
    file: "app/api/test/route.ts",
    isApi: true,
    isPublic: true,
    signals: {
      hasMutationEvidence: true,
      hasDbWriteEvidence: true,
      hasStripeWriteEvidence: false,
      mutationDetails: ["prisma.create"],
    },
    ...overrides,
  };
}

const DEFAULT_HINTS: NextHints = {
  auth: { functions: ["auth", "getSession", "getServerSession"], middlewareFiles: [], allowlistPaths: [] },
  rateLimit: { wrappers: ["rateLimit", "withRateLimit"], allowlistPaths: [] },
  tenancy: { orgFieldNames: [] },
};

const DEFAULT_MIDDLEWARE: NextMiddlewareIndex = {
  authLikely: false,
  rateLimitLikely: false,
  matcherPatterns: [],
};

describe("buildWrapperIndex", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "prodcheck-wrapper-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers wrapper from route file", () => {
    mkdirSync(path.join(tmpDir, "app", "api", "test"), { recursive: true });
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });

    writeFileSync(
      path.join(tmpDir, "app", "api", "test", "route.ts"),
      `import { withWorkspace } from "@/lib/auth";
       export const POST = withWorkspace(async (req) => {
         await prisma.user.create({ data: { name: "test" } });
         return Response.json({});
       });`,
    );

    writeFileSync(
      path.join(tmpDir, "src", "lib", "auth.ts"),
      `export function withWorkspace(handler: any) {
         return async (req: any) => {
           const session = await getSession();
           if (!session) throw new Error("Unauthorized");
           return handler(req, { session });
         };
       }`,
    );

    const routes = [makeRoute({ file: "app/api/test/route.ts" })];
    const result = buildWrapperIndex(routes, tmpDir, { rootDir: tmpDir }, ["auth", "getSession"], ["rateLimit"]);

    expect(result.wrappers.size).toBe(1);
    const wrapper = result.wrappers.get("withWorkspace");
    expect(wrapper).toBeDefined();
    expect(wrapper!.resolved).toBe(true);
    expect(wrapper!.evidence.authCallPresent).toBe(true);
    expect(wrapper!.evidence.authEnforced).toBe(true);
    expect(wrapper!.usageCount).toBe(1);
    expect(wrapper!.mutationRouteCount).toBe(1);
  });

  it("detects unresolvable npm package wrapper", () => {
    mkdirSync(path.join(tmpDir, "app", "api", "test"), { recursive: true });

    writeFileSync(
      path.join(tmpDir, "app", "api", "test", "route.ts"),
      `import { withAuth } from "some-npm-package";
       export const POST = withAuth(async (req) => {
         return Response.json({});
       });`,
    );

    const routes = [makeRoute({ file: "app/api/test/route.ts" })];
    const result = buildWrapperIndex(routes, tmpDir, { rootDir: tmpDir }, ["auth"], ["rateLimit"]);

    const wrapper = result.wrappers.get("withAuth");
    expect(wrapper).toBeDefined();
    expect(wrapper!.resolved).toBe(false);
  });

  it("aggregates usage across multiple routes", () => {
    mkdirSync(path.join(tmpDir, "app", "api", "a"), { recursive: true });
    mkdirSync(path.join(tmpDir, "app", "api", "b"), { recursive: true });
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });

    const routeContent = `import { withWorkspace } from "@/lib/auth";
       export const POST = withWorkspace(async (req) => {
         await prisma.user.create({ data: {} });
         return Response.json({});
       });`;

    writeFileSync(path.join(tmpDir, "app", "api", "a", "route.ts"), routeContent);
    writeFileSync(path.join(tmpDir, "app", "api", "b", "route.ts"), routeContent);

    writeFileSync(
      path.join(tmpDir, "src", "lib", "auth.ts"),
      `export function withWorkspace(handler: any) { return handler; }`,
    );

    const routes = [
      makeRoute({ file: "app/api/a/route.ts" }),
      makeRoute({ file: "app/api/b/route.ts" }),
    ];
    const result = buildWrapperIndex(routes, tmpDir, { rootDir: tmpDir }, ["auth"], ["rateLimit"]);

    const wrapper = result.wrappers.get("withWorkspace");
    expect(wrapper!.usageCount).toBe(2);
    expect(wrapper!.mutationRouteCount).toBe(2);
  });

  it("handles same-file wrapper definition", () => {
    mkdirSync(path.join(tmpDir, "app", "api", "test"), { recursive: true });

    writeFileSync(
      path.join(tmpDir, "app", "api", "test", "route.ts"),
      `function withAuth(handler: any) {
         return async (req: any) => {
           const session = await auth();
           if (!session) throw new Error("Unauthorized");
           return handler(req);
         };
       }
       export const POST = withAuth(async (req) => {
         return Response.json({});
       });`,
    );

    const routes = [makeRoute({ file: "app/api/test/route.ts" })];
    const result = buildWrapperIndex(routes, tmpDir, { rootDir: tmpDir }, ["auth"], ["rateLimit"]);

    const wrapper = result.wrappers.get("withAuth");
    expect(wrapper).toBeDefined();
    expect(wrapper!.resolved).toBe(true);
    expect(wrapper!.evidence.authCallPresent).toBe(true);
  });
});

describe("analyzeWrapperBody", () => {
  it("detects auth call + enforcement", () => {
    const src = `
      export function withAuth(handler: any) {
        return async (req: any) => {
          const session = await getSession();
          if (!session) {
            throw new Error("Unauthorized");
          }
          return handler(req, { session });
        };
      }
    `;
    const evidence = analyzeWrapperBody("withAuth", src, ["getSession"], []);
    expect(evidence.authCallPresent).toBe(true);
    expect(evidence.authEnforced).toBe(true);
  });

  it("detects auth call without enforcement", () => {
    const src = `
      export function withLogging(handler: any) {
        return async (req: any) => {
          const session = await getSession();
          console.log("User:", session?.user?.name);
          return handler(req);
        };
      }
    `;
    const evidence = analyzeWrapperBody("withLogging", src, ["getSession"], []);
    expect(evidence.authCallPresent).toBe(true);
    expect(evidence.authEnforced).toBe(false);
  });

  it("detects rate-limit call + enforcement", () => {
    const src = `
      export function withRateLimiting(handler: any) {
        return async (req: any) => {
          const { success } = await rateLimit(req);
          if (!success) {
            return new Response("Too many requests", { status: 429 });
          }
          return handler(req);
        };
      }
    `;
    const evidence = analyzeWrapperBody("withRateLimiting", src, [], ["rateLimit"]);
    expect(evidence.rateLimitCallPresent).toBe(true);
    expect(evidence.rateLimitEnforced).toBe(true);
  });

  it("detects both auth and rate-limit", () => {
    const src = `
      import { getSession } from "next-auth";
      import { Ratelimit } from "@upstash/ratelimit";

      export function withWorkspace(handler: any) {
        return async (req: any) => {
          const session = await getSession();
          if (!session) return new Response("Unauthorized", { status: 401 });

          const { success } = await rateLimit.limit(session.user.id);
          if (!success) return new Response("Rate limited", { status: 429 });

          return handler(req, { session });
        };
      }
    `;
    const evidence = analyzeWrapperBody("withWorkspace", src, ["getSession"], ["rateLimit"]);
    expect(evidence.authCallPresent).toBe(true);
    expect(evidence.authEnforced).toBe(true);
    expect(evidence.rateLimitCallPresent).toBe(true);
    expect(evidence.rateLimitEnforced).toBe(true);
  });

  it("detects Supabase auth pattern in wrapper", () => {
    const src = `
      export function withAuth(handler: any) {
        return async (req: any) => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Unauthorized");
          return handler(req, { user });
        };
      }
    `;
    const evidence = analyzeWrapperBody("withAuth", src, [], []);
    expect(evidence.authCallPresent).toBe(true);
    expect(evidence.authEnforced).toBe(true);
  });

  it("detects upstash ratelimit import as RL evidence", () => {
    const src = `
      import { Ratelimit } from "@upstash/ratelimit";
      const ratelimit = new Ratelimit({ ... });

      export function withRL(handler: any) {
        return async (req: any) => {
          const { success } = await ratelimit.limit("key");
          if (!success) throw new Error("Rate limited");
          return handler(req);
        };
      }
    `;
    const evidence = analyzeWrapperBody("withRL", src, [], []);
    expect(evidence.rateLimitCallPresent).toBe(true);
    expect(evidence.rateLimitEnforced).toBe(true);
  });

  it("returns no evidence for generic wrapper", () => {
    const src = `
      export function withErrorBoundary(handler: any) {
        return async (req: any) => {
          try {
            return handler(req);
          } catch (e) {
            return new Response("Error", { status: 500 });
          }
        };
      }
    `;
    const evidence = analyzeWrapperBody("withErrorBoundary", src, ["auth", "getSession"], ["rateLimit"]);
    expect(evidence.authCallPresent).toBe(false);
    expect(evidence.rateLimitCallPresent).toBe(false);
  });
});

describe("computeProtection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "prodcheck-prot-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks satisfied when wrapper has auth enforcement", () => {
    mkdirSync(path.join(tmpDir, "app", "api", "test"), { recursive: true });

    writeFileSync(
      path.join(tmpDir, "app", "api", "test", "route.ts"),
      `import { withWorkspace } from "@/lib/auth";
       export const POST = withWorkspace(async (req) => {});`,
    );

    const wrapperIndex: WrapperIndex = {
      wrappers: new Map([
        ["withWorkspace", {
          name: "withWorkspace",
          definitionFile: "src/lib/auth.ts",
          resolved: true,
          evidence: {
            authCallPresent: true,
            authEnforced: true,
            rateLimitCallPresent: true,
            rateLimitEnforced: true,
            authDetails: ["calls getSession()"],
            rateLimitDetails: ["calls rateLimit()"],
          },
          usageCount: 1,
          usageFiles: ["app/api/test/route.ts"],
          mutationRouteCount: 1,
        }],
      ]),
    };

    const route = makeRoute({ file: "app/api/test/route.ts" });
    const protection = computeProtection(route, wrapperIndex, DEFAULT_MIDDLEWARE, DEFAULT_HINTS, tmpDir);

    expect(protection.auth.satisfied).toBe(true);
    expect(protection.auth.enforced).toBe(true);
    expect(protection.auth.sources).toContain("wrapper");
    expect(protection.rateLimit.satisfied).toBe(true);
  });

  it("marks unverified when wrapper calls auth but doesn't enforce", () => {
    mkdirSync(path.join(tmpDir, "app", "api", "test"), { recursive: true });

    writeFileSync(
      path.join(tmpDir, "app", "api", "test", "route.ts"),
      `import { withLogging } from "@/lib/logging";
       export const POST = withLogging(async (req) => {});`,
    );

    const wrapperIndex: WrapperIndex = {
      wrappers: new Map([
        ["withLogging", {
          name: "withLogging",
          definitionFile: "src/lib/logging.ts",
          resolved: true,
          evidence: {
            authCallPresent: true,
            authEnforced: false,
            rateLimitCallPresent: false,
            rateLimitEnforced: false,
            authDetails: ["calls getSession()"],
            rateLimitDetails: [],
          },
          usageCount: 1,
          usageFiles: ["app/api/test/route.ts"],
          mutationRouteCount: 1,
        }],
      ]),
    };

    const route = makeRoute({ file: "app/api/test/route.ts" });
    const protection = computeProtection(route, wrapperIndex, DEFAULT_MIDDLEWARE, DEFAULT_HINTS, tmpDir);

    expect(protection.auth.satisfied).toBe(false);
    expect(protection.auth.unverifiedWrappers).toContain("withLogging");
  });

  it("marks satisfied when direct auth call in route", () => {
    mkdirSync(path.join(tmpDir, "app", "api", "test"), { recursive: true });

    writeFileSync(
      path.join(tmpDir, "app", "api", "test", "route.ts"),
      `export async function POST(req: Request) {
         const session = await auth();
         return Response.json({});
       }`,
    );

    const emptyWrappers: WrapperIndex = { wrappers: new Map() };
    const route = makeRoute({ file: "app/api/test/route.ts" });
    const protection = computeProtection(route, emptyWrappers, DEFAULT_MIDDLEWARE, DEFAULT_HINTS, tmpDir);

    expect(protection.auth.satisfied).toBe(true);
    expect(protection.auth.sources).toContain("direct");
  });

  it("marks satisfied when middleware covers route", () => {
    mkdirSync(path.join(tmpDir, "app", "api", "test"), { recursive: true });

    writeFileSync(
      path.join(tmpDir, "app", "api", "test", "route.ts"),
      `export async function POST(req: Request) {
         return Response.json({});
       }`,
    );

    const middleware: NextMiddlewareIndex = {
      authLikely: true,
      rateLimitLikely: false,
      matcherPatterns: ["/api/:path*"],
    };

    const emptyWrappers: WrapperIndex = { wrappers: new Map() };
    const route = makeRoute({ file: "app/api/test/route.ts", pathname: "/api/test" });
    const protection = computeProtection(route, emptyWrappers, middleware, DEFAULT_HINTS, tmpDir);

    expect(protection.auth.satisfied).toBe(true);
    expect(protection.auth.sources).toContain("middleware");
  });

  it("marks unverified when wrapper is unresolved", () => {
    mkdirSync(path.join(tmpDir, "app", "api", "test"), { recursive: true });

    writeFileSync(
      path.join(tmpDir, "app", "api", "test", "route.ts"),
      `import { withUnknown } from "some-package";
       export const POST = withUnknown(async (req) => {});`,
    );

    const wrapperIndex: WrapperIndex = {
      wrappers: new Map([
        ["withUnknown", {
          name: "withUnknown",
          resolved: false,
          evidence: {
            authCallPresent: false,
            authEnforced: false,
            rateLimitCallPresent: false,
            rateLimitEnforced: false,
            authDetails: [],
            rateLimitDetails: [],
          },
          usageCount: 1,
          usageFiles: ["app/api/test/route.ts"],
          mutationRouteCount: 1,
        }],
      ]),
    };

    const route = makeRoute({ file: "app/api/test/route.ts" });
    const protection = computeProtection(route, wrapperIndex, DEFAULT_MIDDLEWARE, DEFAULT_HINTS, tmpDir);

    expect(protection.auth.satisfied).toBe(false);
    expect(protection.auth.unverifiedWrappers).toContain("withUnknown");
  });
});
