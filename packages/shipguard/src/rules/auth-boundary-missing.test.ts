import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { run, RULE_ID } from "./auth-boundary-missing.js";
import type { NextIndex, NextRoute, ProtectionSummary } from "../next/types.js";
import type { ShipguardConfig } from "../engine/types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MUTATION_SIGNALS = {
  hasMutationEvidence: true,
  hasDbWriteEvidence: true,
  hasStripeWriteEvidence: false,
  mutationDetails: ["prisma.create"],
};

function protectionSummary(opts: {
  authSatisfied?: boolean;
  unverifiedWrappers?: string[];
}): ProtectionSummary {
  return {
    auth: {
      satisfied: opts.authSatisfied ?? false,
      enforced: false,
      sources: opts.authSatisfied ? ["direct"] : [],
      details: [],
      unverifiedWrappers: opts.unverifiedWrappers ?? [],
    },
    rateLimit: {
      satisfied: false,
      enforced: false,
      sources: [],
      details: [],
      unverifiedWrappers: [],
    },
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join("/tmp", `shipguard-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

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
    signals: MUTATION_SIGNALS,
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
      auth: { functions: ["auth", "getServerSession"], middlewareFiles: [], allowlistPaths: [] },
      rateLimit: { wrappers: ["rateLimit"], allowlistPaths: [] },
      tenancy: { orgFieldNames: [] },
    },
    middleware: { authLikely: false, rateLimitLikely: false, matcherPatterns: [] },
    wrappers: { wrappers: new Map() },
    routes: { all: routes, mutationRoutes: routes },
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
      auth: { functions: ["auth", "getServerSession"], middlewareFiles: [], allowlistPaths: [] },
      rateLimit: { wrappers: ["rateLimit"], allowlistPaths: [] },
      tenancy: { orgFieldNames: [] },
    },
    rules: { "AUTH-BOUNDARY-MISSING": { severity: "critical" } },
    waiversFile: "shipguard.waivers.json",
    ...overrides,
  };
}

const config = makeConfig();

/* ------------------------------------------------------------------ */
/*  1. Upstash Workflow serve() — should suppress finding              */
/* ------------------------------------------------------------------ */

describe("Upstash Workflow serve() recognition", () => {
  it("suppresses finding for @upstash/workflow serve()", () => {
    const route = createRoute("app/api/workflows/process/route.ts", `
import { serve } from "@upstash/workflow/nextjs";
import { MemoryExtractionExecutor } from "@/server/services/memory";

export const { POST } = serve(async (context) => {
  const executor = await MemoryExtractionExecutor.create();
  await prisma.memory.create({ data: { userId: "test" } });
  return { done: true };
});
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("suppresses finding for serve with generic type param", () => {
    const route = createRoute("app/api/workflows/extract/route.ts", `
import { serve } from "@upstash/workflow/nextjs";

export const { POST } = serve<PayloadInput>(async (context) => {
  await prisma.topic.create({ data: context.requestPayload });
});
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("does NOT suppress for serve() from unknown package", () => {
    const route = createRoute("app/api/unknown/route.ts", `
import { serve } from "some-other-package";

export const { POST } = serve(async (context) => {
  await prisma.user.create({ data: { name: "test" } });
});
`);
    expect(run(makeIndex([route]), config)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  1b. Inngest serve() — should suppress finding                     */
/* ------------------------------------------------------------------ */

describe("Inngest serve() recognition", () => {
  it("suppresses finding for inngest/next serve()", () => {
    const route = createRoute("app/api/inngest/route.ts", `
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";

export const { GET, POST, PUT } = serve({ client: inngest, functions: [myFn] });
`);
    // No mutation signals in this source, override to force mutation
    const routeWithMutation = createRoute("app/api/inngest/route.ts", `
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";

export const { POST } = serve({ client: inngest, functions: [myFn] });
// hypothetical mutation
await prisma.job.create({ data: {} });
`);
    expect(run(makeIndex([routeWithMutation]), config)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  2. Svix webhook verification — should suppress finding             */
/* ------------------------------------------------------------------ */

describe("Svix webhook verification", () => {
  it("suppresses finding for svix Webhook.verify()", () => {
    const route = createRoute("app/api/webhooks/clerk/route.ts", `
import { Webhook } from "svix";

export async function POST(req: Request) {
  const body = await req.text();
  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!);
  const payload = wh.verify(body, Object.fromEntries(req.headers));
  await prisma.user.create({ data: payload });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  3. timingSafeEqual — contextual webhook verification               */
/* ------------------------------------------------------------------ */

describe("timingSafeEqual webhook verification", () => {
  it("suppresses when timingSafeEqual + headers.get + 401", () => {
    const route = createRoute("app/api/webhooks/video/route.ts", `
import { timingSafeEqual } from "node:crypto";

export const POST = async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expected = metadata?.webhookToken;
  if (!expected || !token || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.asyncTask.update({ where: { id }, data: { status: "success" } });
  return NextResponse.json({ success: true });
};
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("does NOT suppress timingSafeEqual without request-derived data", () => {
    const route = createRoute("app/api/compare/route.ts", `
import { timingSafeEqual } from "node:crypto";

export const POST = async (req: Request) => {
  // timingSafeEqual used for non-auth comparison
  const match = timingSafeEqual(Buffer.from("a"), Buffer.from("b"));
  await prisma.user.create({ data: { name: "test" } });
  return Response.json({ match });
};
`);
    expect(run(makeIndex([route]), config)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  4. Auth-guard return detection (safe version)                      */
/* ------------------------------------------------------------------ */

describe("auth-guard return detection", () => {
  it("suppresses for x-api-key header check + env comparison + 401 before mutation", () => {
    const route = createRoute("app/api/internal/route.ts", `
export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (apiKey !== process.env.API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.job.create({ data: { type: "sync" } });
  return NextResponse.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("suppresses for authorization header + Bearer token check + 403", () => {
    const route = createRoute("app/api/protected/route.ts", `
export async function POST(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return new Response("Forbidden", { status: 403 });
  }
  await prisma.user.update({ where: { id }, data: body });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("does NOT suppress for feature flag check + 403", () => {
    const route = createRoute("app/api/gated/route.ts", `
export async function POST(req: Request) {
  const enabled = await isFeatureEnabled("new-flow");
  if (!enabled) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }
  await prisma.user.create({ data: { name: "test" } });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(1);
  });

  it("does NOT suppress for plan gating + 403", () => {
    const route = createRoute("app/api/billing/route.ts", `
export async function POST(req: Request) {
  const isPro = await checkPlan(userId);
  if (!isPro) {
    return NextResponse.json({ error: "Upgrade required" }, { status: 403 });
  }
  await prisma.subscription.create({ data: { userId } });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(1);
  });

  it("does NOT suppress for 401/403 AFTER mutation (error handling, not guard)", () => {
    const route = createRoute("app/api/late-check/route.ts", `
export async function POST(req: Request) {
  await prisma.audit.create({ data: { action: "attempt" } });
  const token = req.headers.get("authorization");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(1);
  });

  it("suppresses for webhook header secret verification + 403", () => {
    const route = createRoute("app/api/webhooks/memory/route.ts", `
export const POST = async (req: Request) => {
  const { webhook } = parseConfig();
  if (webhook.headers && Object.keys(webhook.headers).length > 0) {
    for (const [key, value] of Object.entries(webhook.headers)) {
      const headerValue = req.headers.get(key);
      if (headerValue !== value) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 403 },
        );
      }
    }
  }
  const executor = await MemoryExtractionExecutor.create();
  const result = await executor.runDirect(params);
  return NextResponse.json({ result }, { status: 200 });
};
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  5. JWT verification (jose / jsonwebtoken)                          */
/* ------------------------------------------------------------------ */

describe("JWT verification", () => {
  it("suppresses for jose jwtVerify()", () => {
    const route = createRoute("app/api/secure/route.ts", `
import { jwtVerify } from "jose";

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.split(" ")[1];
  const { payload } = await jwtVerify(token, secret);
  await prisma.action.create({ data: { userId: payload.sub } });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("suppresses for jsonwebtoken verify()", () => {
    const route = createRoute("app/api/jwt/route.ts", `
import jwt from "jsonwebtoken";

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.split(" ")[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET!);
  await prisma.user.update({ where: { id: decoded.sub }, data: { lastSeen: new Date() } });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("does NOT suppress for verify() without jsonwebtoken import", () => {
    const route = createRoute("app/api/fake-verify/route.ts", `
import { verify } from "./my-utils";

export async function POST(req: Request) {
  verify(someData);
  await prisma.user.create({ data: { name: "test" } });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  6. DB-backed API token lookup                                      */
/* ------------------------------------------------------------------ */

describe("DB-backed API token lookup", () => {
  it("suppresses for header + prisma.apiKey.findUnique + 401", () => {
    const route = createRoute("app/api/external/route.ts", `
export async function POST(req: Request) {
  const key = req.headers.get("x-api-key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 401 });
  const apiKey = await prisma.apiKey.findUnique({ where: { key } });
  if (!apiKey) return NextResponse.json({ error: "Invalid key" }, { status: 403 });
  await prisma.event.create({ data: { source: "api", keyId: apiKey.id } });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("suppresses for header + prisma.apiToken.findFirst + 403", () => {
    const route = createRoute("app/api/integration/route.ts", `
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const apiToken = await prisma.apiToken.findFirst({ where: { token, active: true } });
  if (!apiToken) {
    return new Response("Forbidden", { status: 403 });
  }
  await prisma.webhook.create({ data: { tokenId: apiToken.id } });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  7. Callback path downgrade                                         */
/* ------------------------------------------------------------------ */

describe("callback path downgrade", () => {
  it("downgrades /oidc/callback to med confidence (not suppressed)", () => {
    const route = createRoute("app/oidc/callback/desktop/route.ts", `
export const GET = async (req: Request) => {
  const code = new URL(req.url).searchParams.get("code");
  const state = new URL(req.url).searchParams.get("state");
  await prisma.oauthHandoff.create({ client: "desktop", id: state, payload: { code } });
  return NextResponse.redirect(successUrl);
};
`, { pathname: "/oidc/callback/desktop" });

    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("med");
    expect(findings[0].tags).toContain("callback");
    expect(findings[0].message).toContain("Callback");
    expect(findings[0].remediation?.[0]).toContain("framework validation");
  });

  it("downgrades /oauth/callback path to med confidence", () => {
    const route = createRoute("app/api/oauth/callback/route.ts", `
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  await prisma.session.create({ data: { code } });
  return Response.redirect("/dashboard");
}
`, { pathname: "/api/oauth/callback" });

    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("med");
  });

  it("does NOT downgrade regular API routes", () => {
    const route = createRoute("app/api/users/route.ts", `
export async function POST(req: Request) {
  const body = await req.json();
  await prisma.user.create({ data: body });
  return Response.json({ ok: true });
}
`);

    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("high");
  });
});

/* ------------------------------------------------------------------ */
/*  8. Existing patterns still work                                    */
/* ------------------------------------------------------------------ */

describe("existing patterns still work", () => {
  it("suppresses for Stripe constructEvent", () => {
    const route = createRoute("app/api/webhooks/stripe/route.ts", `
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const event = stripe.webhooks.constructEvent(body, sig, secret);
  await prisma.payment.create({ data: event.data });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("suppresses for Supabase .auth.getUser()", () => {
    const route = createRoute("app/api/posts/route.ts", `
export async function POST(req: Request) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await supabase.from("posts").insert({ title: "test", author: user.id });
  return Response.json({ ok: true });
}
`);
    expect(run(makeIndex([route]), config)).toHaveLength(0);
  });

  it("flags unprotected mutation route", () => {
    const route = createRoute("app/api/unprotected/route.ts", `
export async function POST(req: Request) {
  const body = await req.json();
  await prisma.user.create({ data: body });
  return Response.json({ ok: true });
}
`);
    const findings = run(makeIndex([route]), config);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("AUTH-BOUNDARY-MISSING");
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].confidence).toBe("high");
  });
});
