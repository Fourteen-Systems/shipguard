import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { run, RULE_ID } from "./rate-limit-missing.js";
import type { NextIndex, NextRoute, ProtectionSummary } from "../next/types.js";
import type { ShipguardConfig } from "../engine/types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const NO_SIGNALS = {
  hasMutationEvidence: false,
  hasDbWriteEvidence: false,
  hasStripeWriteEvidence: false,
  mutationDetails: [] as string[],
};

const MUTATION_SIGNALS = {
  hasMutationEvidence: true,
  hasDbWriteEvidence: true,
  hasStripeWriteEvidence: false,
  mutationDetails: ["prisma.create"],
};

function protectionSummary(opts: {
  authSatisfied?: boolean;
  rlSatisfied?: boolean;
  unverifiedWrappers?: string[];
}): ProtectionSummary {
  return {
    auth: {
      satisfied: opts.authSatisfied ?? false,
      enforced: false,
      sources: opts.authSatisfied ? ["direct"] : [],
      details: [],
      unverifiedWrappers: [],
    },
    rateLimit: {
      satisfied: opts.rlSatisfied ?? false,
      enforced: false,
      sources: [],
      details: [],
      unverifiedWrappers: opts.unverifiedWrappers ?? [],
    },
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join("/tmp", `shipguard-rl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a route file on disk and return a NextRoute pointing to it */
function createRoute(
  relPath: string,
  source: string,
  overrides: Partial<NextRoute> = {},
): NextRoute {
  const fullPath = path.join(tmpDir, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, source);

  const pathname = "/" + relPath
    .replace(/\/route\.(ts|tsx|js|jsx)$/, "")
    .replace(/^app\//, "");

  return {
    kind: "route-handler",
    file: relPath,
    isApi: pathname.startsWith("/api/") || pathname === "/api",
    isPublic: true,
    pathname,
    signals: NO_SIGNALS,
    protection: protectionSummary({}),
    ...overrides,
  };
}

function makeIndex(routes: NextRoute[]): NextIndex {
  return {
    version: 1,
    framework: "next-app-router",
    rootDir: tmpDir,
    deps: {
      hasNextAuth: false, hasClerk: false, hasSupabase: false,
      hasKinde: false, hasWorkOS: false, hasBetterAuth: false,
      hasLucia: false, hasAuth0: false, hasIronSession: false,
      hasFirebaseAuth: false, hasUpstashRatelimit: false, hasArcjet: false,
      hasUnkey: false, hasPrisma: false, hasDrizzle: false, hasTrpc: false,
    },
    hints: {
      auth: { functions: ["auth"], middlewareFiles: [], allowlistPaths: [] },
      rateLimit: { wrappers: ["rateLimit"], allowlistPaths: [] },
      tenancy: { orgFieldNames: [] },
    },
    middleware: { authLikely: false, rateLimitLikely: false, matcherPatterns: [] },
    wrappers: { wrappers: new Map() },
    routes: { all: routes, mutationRoutes: routes.filter(r => r.signals.hasMutationEvidence) },
    serverActions: { all: [], mutationActions: [] },
    trpc: { detected: false, procedures: [], mutationProcedures: [] },
  };
}

function makeConfig(overrides: Partial<ShipguardConfig> = {}): ShipguardConfig {
  return {
    framework: "next-app-router",
    include: ["app/**"],
    exclude: [],
    ci: { failOn: "critical", minConfidence: "high", minScore: 70, maxNewCritical: 0 },
    scoring: { start: 100, penalties: { critical: 25, high: 10, med: 3, low: 1 } },
    hints: {
      auth: { functions: ["auth"], middlewareFiles: [], allowlistPaths: [] },
      rateLimit: { wrappers: ["rateLimit"], allowlistPaths: [] },
      tenancy: { orgFieldNames: [] },
    },
    rules: { "RATE-LIMIT-MISSING": { severity: "critical" } },
    waiversFile: "shipguard.waivers.json",
    ...overrides,
  };
}

const BASIC_HANDLER = `export async function GET(request: Request) { return Response.json({ ok: true }); }`;
const MUTATION_HANDLER = `export async function POST(request: Request) {
  const body = await request.json();
  await prisma.user.create({ data: body });
  return Response.json({ ok: true });
}`;
const BODY_HANDLER = `export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ received: true });
}`;

/* ------------------------------------------------------------------ */
/*  Framework-managed exemptions                                       */
/* ------------------------------------------------------------------ */

describe("framework-managed route exemptions", () => {
  const config = makeConfig();

  it("exempts NextAuth catch-all route", () => {
    const route = createRoute("app/api/auth/[...nextauth]/route.ts", BASIC_HANDLER);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("exempts NextAuth with different param name", () => {
    const route = createRoute("app/api/auth/[...params]/route.ts", BASIC_HANDLER);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("exempts OAuth token endpoint", () => {
    const route = createRoute("app/api/oauth/token/route.ts", BASIC_HANDLER);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("exempts SAML callback route", () => {
    const route = createRoute("app/api/auth/saml/callback/route.ts", BASIC_HANDLER);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("exempts callback routes from external services", () => {
    const route = createRoute("app/api/callback/stripe/route.ts", BASIC_HANDLER);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("exempts nested callback routes", () => {
    const route = createRoute("app/api/slack/callback/route.ts", BASIC_HANDLER, {
      pathname: "/api/slack/callback",
    });
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("exempts OG image routes", () => {
    const route = createRoute("app/api/og/analytics/route.tsx", BASIC_HANDLER);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("exempts terminal OG path", () => {
    const route = createRoute("app/api/og/route.tsx", BASIC_HANDLER, {
      pathname: "/api/og",
    });
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("does NOT exempt regular API routes", () => {
    const route = createRoute("app/api/users/route.ts", BASIC_HANDLER);
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Improved webhook detection                                         */
/* ------------------------------------------------------------------ */

describe("webhook path detection", () => {
  const config = makeConfig();

  it("exempts /webhook path", () => {
    const route = createRoute("app/api/webhook/route.ts", BASIC_HANDLER, {
      pathname: "/api/webhook",
    });
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("exempts compound webhook path like /stripe-webhook", () => {
    const route = createRoute("app/api/billing/stripe-webhook/route.ts", BASIC_HANDLER, {
      pathname: "/api/billing/stripe-webhook",
    });
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("exempts /webhooks/stripe nested path", () => {
    const route = createRoute("app/api/webhooks/stripe/route.ts", BASIC_HANDLER, {
      pathname: "/api/webhooks/stripe",
    });
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Existing exemptions still work                                     */
/* ------------------------------------------------------------------ */

describe("existing exemptions", () => {
  const config = makeConfig();

  it("exempts health check routes", () => {
    const route = createRoute("app/api/health/route.ts", BASIC_HANDLER, {
      pathname: "/api/health",
    });
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("exempts cron routes", () => {
    const route = createRoute("app/api/cron/daily/route.ts", BASIC_HANDLER, {
      pathname: "/api/cron/daily",
    });
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("skips non-API routes", () => {
    const route = createRoute("app/dashboard/route.ts", BASIC_HANDLER, {
      pathname: "/dashboard",
      isApi: false,
    });
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("skips routes with rate-limit protection satisfied", () => {
    const route = createRoute("app/api/users/route.ts", BASIC_HANDLER, {
      protection: protectionSummary({ rlSatisfied: true }),
    });
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("defers to WRAPPER-UNRECOGNIZED for unverified wrappers", () => {
    const route = createRoute("app/api/users/route.ts", BASIC_HANDLER, {
      protection: protectionSummary({ unverifiedWrappers: ["withCustom"] }),
    });
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Auth-aware severity: public routes (unchanged behavior)            */
/* ------------------------------------------------------------------ */

describe("severity: public routes (no auth)", () => {
  const config = makeConfig();

  it("public mutation route → critical/high", () => {
    const route = createRoute("app/api/users/route.ts", MUTATION_HANDLER, {
      signals: MUTATION_SIGNALS,
      protection: protectionSummary({ authSatisfied: false }),
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].confidence).toBe("high");
  });

  it("public body-parsing route → high/high", () => {
    const route = createRoute("app/api/upload/route.ts", BODY_HANDLER, {
      protection: protectionSummary({ authSatisfied: false }),
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].confidence).toBe("high");
  });

  it("public GET-only route → med/med", () => {
    const route = createRoute("app/api/data/route.ts", BASIC_HANDLER, {
      protection: protectionSummary({ authSatisfied: false }),
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("med");
    expect(findings[0].confidence).toBe("med");
  });
});

/* ------------------------------------------------------------------ */
/*  Auth-aware severity: authed routes (new behavior)                  */
/* ------------------------------------------------------------------ */

describe("severity: authenticated routes", () => {
  const config = makeConfig();

  it("authed mutation route → med/med (downgraded from critical)", () => {
    const route = createRoute("app/api/users/route.ts", MUTATION_HANDLER, {
      signals: MUTATION_SIGNALS,
      protection: protectionSummary({ authSatisfied: true }),
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("med");
    expect(findings[0].confidence).toBe("med");
    expect(findings[0].evidence).toContain("route has auth boundary — rate limiting is secondary defense");
  });

  it("authed body-parsing route → low/low (downgraded from high)", () => {
    const route = createRoute("app/api/upload/route.ts", BODY_HANDLER, {
      protection: protectionSummary({ authSatisfied: true }),
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("low");
    expect(findings[0].confidence).toBe("low");
  });

  it("authed GET-only route → low/low (downgraded from med)", () => {
    const route = createRoute("app/api/data/route.ts", BASIC_HANDLER, {
      protection: protectionSummary({ authSatisfied: true }),
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("low");
    expect(findings[0].confidence).toBe("low");
    expect(findings[0].evidence).toContain("route has auth boundary — rate limiting is secondary defense");
  });

  it("authed route gets different message and remediation than public", () => {
    const authedRoute = createRoute("app/api/data/route.ts", BASIC_HANDLER, {
      protection: protectionSummary({ authSatisfied: true }),
    });
    const publicRoute = createRoute("app/api/other/route.ts", BASIC_HANDLER, {
      protection: protectionSummary({ authSatisfied: false }),
    });

    const authedFindings = run(makeIndex([authedRoute]), config);
    const publicFindings = run(makeIndex([publicRoute]), config);

    expect(authedFindings[0].message).toContain("Authenticated");
    expect(publicFindings[0].message).toContain("Public");
    expect(authedFindings[0].remediation).not.toEqual(publicFindings[0].remediation);
  });
});

/* ------------------------------------------------------------------ */
/*  Severity cap                                                       */
/* ------------------------------------------------------------------ */

describe("severity cap", () => {
  it("caps severity at rule max from config", () => {
    const config = makeConfig({
      rules: { "RATE-LIMIT-MISSING": { severity: "high" } },
    });
    const route = createRoute("app/api/users/route.ts", MUTATION_HANDLER, {
      signals: MUTATION_SIGNALS,
      protection: protectionSummary({ authSatisfied: false }),
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    // Would be critical but capped to high
    expect(findings[0].severity).toBe("high");
  });
});

/* ------------------------------------------------------------------ */
/*  public-intent severity floor + SSRF escalation                     */
/* ------------------------------------------------------------------ */

describe("public-intent", () => {
  const config = makeConfig();

  it("floors RL severity to HIGH for GET-only public-intent route", () => {
    const route = createRoute("app/api/status/route.ts", BASIC_HANDLER, {
      protection: protectionSummary({ authSatisfied: false }),
      publicIntent: { reason: "Public status page", line: 1 },
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    // Would be med for GET-only, but floored to high by public-intent
    expect(findings[0].severity).toBe("high");
    expect(findings[0].confidence).toBe("high");
    expect(findings[0].tags).toContain("public-intent");
    expect(findings[0].evidence).toContain('public-intent: "Public status page"');
  });

  it("escalates to CRITICAL when outbound fetch + user-influenced URL detected", () => {
    const route = createRoute("app/api/proxy/route.ts", `
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("target");
  const response = await fetch(url);
  return Response.json(await response.json());
}
`, {
      protection: protectionSummary({ authSatisfied: false }),
      publicIntent: { reason: "Public URL checker", line: 1 },
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].tags).toContain("ssrf-surface");
    expect(findings[0].tags).toContain("outbound-fetch");
  });

  it("does NOT floor severity when publicIntent is missing (malformed directive)", () => {
    const route = createRoute("app/api/data/route.ts", BASIC_HANDLER, {
      protection: protectionSummary({ authSatisfied: false }),
      malformedPublicIntent: { line: 1, raw: "// shipguard:public-intent" },
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    // Normal GET-only severity, no floor
    expect(findings[0].severity).toBe("med");
    expect(findings[0].tags).not.toContain("public-intent");
  });

  it("message says 'Intentionally public' for public-intent routes", () => {
    const route = createRoute("app/api/check/route.ts", BASIC_HANDLER, {
      protection: protectionSummary({ authSatisfied: false }),
      publicIntent: { reason: "Intentional", line: 1 },
    });
    const findings = run(makeIndex([route]), config);
    expect(findings[0].message).toContain("Intentionally public");
  });

  it("does NOT escalate to CRITICAL for fetch with hardcoded URL", () => {
    const route = createRoute("app/api/external/route.ts", `
export async function GET(request: Request) {
  const response = await fetch("https://api.example.com/health");
  return Response.json(await response.json());
}
`, {
      protection: protectionSummary({ authSatisfied: false }),
      publicIntent: { reason: "Health aggregator", line: 1 },
    });
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    // Floored to high, but NOT critical (no user-influenced URL)
    expect(findings[0].severity).toBe("high");
    expect(findings[0].tags).not.toContain("ssrf-surface");
  });
});
