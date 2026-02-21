import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { run, RULE_ID } from "./input-validation-missing.js";
import type { NextIndex, NextRoute, NextServerAction, MutationSignals, ProtectionSummary } from "../next/types.js";
import type { ShipguardConfig } from "../engine/types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const DB_WRITE_SIGNALS: MutationSignals = {
  hasMutationEvidence: true,
  hasDbWriteEvidence: true,
  hasStripeWriteEvidence: false,
  mutationDetails: ["prisma.create", "reads request body"],
};

const STRIPE_WRITE_SIGNALS: MutationSignals = {
  hasMutationEvidence: true,
  hasDbWriteEvidence: false,
  hasStripeWriteEvidence: true,
  mutationDetails: ["stripe write operation", "reads request body"],
};

const BODY_ONLY_SIGNALS: MutationSignals = {
  hasMutationEvidence: true,
  hasDbWriteEvidence: false,
  hasStripeWriteEvidence: false,
  mutationDetails: ["reads request body"],
};

function protectionSummary(): ProtectionSummary {
  return {
    auth: { satisfied: false, enforced: false, sources: [], details: [], unverifiedWrappers: [] },
    rateLimit: { satisfied: false, enforced: false, sources: [], details: [], unverifiedWrappers: [] },
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join("/tmp", `shipguard-input-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function createRoute(
  relPath: string,
  source: string,
  signals: MutationSignals = DB_WRITE_SIGNALS,
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
    isApi: pathname.startsWith("/api/"),
    isPublic: true,
    pathname,
    signals,
    protection: protectionSummary(),
  };
}

function createAction(
  relPath: string,
  source: string,
  signals: MutationSignals = DB_WRITE_SIGNALS,
): NextServerAction {
  const fullPath = path.join(tmpDir, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, source);

  return {
    kind: "server-action",
    file: relPath,
    signals,
  };
}

function makeIndex(
  routes: NextRoute[] = [],
  actions: NextServerAction[] = [],
): NextIndex {
  return {
    version: 1,
    framework: "next-app-router",
    rootDir: tmpDir,
    deps: {
      hasNextAuth: false, hasClerk: false, hasSupabase: false,
      hasKinde: false, hasWorkOS: false, hasBetterAuth: false,
      hasLucia: false, hasAuth0: false, hasIronSession: false,
      hasFirebaseAuth: false, hasUpstashRatelimit: false, hasArcjet: false,
      hasUnkey: false, hasPrisma: true, hasDrizzle: false, hasTrpc: false,
    },
    hints: {
      auth: { functions: [], middlewareFiles: [], allowlistPaths: [] },
      rateLimit: { wrappers: [], allowlistPaths: [] },
      tenancy: { orgFieldNames: [] },
    },
    middleware: { authLikely: false, rateLimitLikely: false, matcherPatterns: [] },
    wrappers: { wrappers: new Map() },
    routes: { all: routes, mutationRoutes: routes },
    serverActions: { all: actions, mutationActions: actions },
    trpc: { detected: false, procedures: [], mutationProcedures: [] },
  };
}

function makeConfig(): ShipguardConfig {
  return {
    framework: "next-app-router",
    include: ["app/**"],
    exclude: [],
    ci: { failOn: "critical", minConfidence: "high", minScore: 70, maxNewCritical: 0 },
    scoring: { start: 100, penalties: { critical: 25, high: 10, med: 3, low: 1 } },
    hints: {
      auth: { functions: [], middlewareFiles: [], allowlistPaths: [] },
      rateLimit: { wrappers: [], allowlistPaths: [] },
      tenancy: { orgFieldNames: [] },
    },
    rules: { "INPUT-VALIDATION-MISSING": { severity: "high" } },
    waiversFile: "shipguard.waivers.json",
  };
}

/* ------------------------------------------------------------------ */
/*  Tests: should flag                                                 */
/* ------------------------------------------------------------------ */

describe("INPUT-VALIDATION-MISSING", () => {
  describe("flags unvalidated input", () => {
    it("request.json() + prisma.create without validation", () => {
      const route = createRoute("app/api/users/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  await prisma.user.create({ data: body });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe(RULE_ID);
      expect(findings[0].confidence).toBe("high");
    });

    it("request.formData() + prisma.update without validation", () => {
      const route = createRoute("app/api/profile/route.ts", `
export async function POST(request: Request) {
  const data = await request.formData();
  const name = data.get("name");
  await prisma.user.update({ where: { id }, data: { name } });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe(RULE_ID);
    });

    it("req.body + prisma.create without validation", () => {
      const route = createRoute("app/api/items/route.ts", `
export async function POST(req: NextRequest) {
  const data = req.body;
  await prisma.item.create({ data });
  return NextResponse.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
    });

    it("request.json() + Stripe write without validation", () => {
      const route = createRoute("app/api/billing/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  await stripe.subscriptions.create({ customer: body.customerId, items: [{ price: body.priceId }] });
  return Response.json({ ok: true });
}
`, STRIPE_WRITE_SIGNALS);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
    });

    it("server action with unvalidated input + DB write", () => {
      const action = createAction("app/actions/create-post.ts", `
"use server";
export async function createPost(formData: FormData) {
  const title = formData.get("title");
  const body = await request.json();
  await prisma.post.create({ data: { title } });
}
`);
      const findings = run(makeIndex([], [action]), makeConfig());
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain("Server action");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tests: should NOT flag (validation present)                       */
  /* ------------------------------------------------------------------ */

  describe("does NOT flag when validation present", () => {
    it("zod z.object() + .parse()", () => {
      const route = createRoute("app/api/users/route.ts", `
import { z } from "zod";
const schema = z.object({ name: z.string(), email: z.string().email() });
export async function POST(request: Request) {
  const body = await request.json();
  const data = schema.parse(body);
  await prisma.user.create({ data });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(0);
    });

    it("zod .safeParse()", () => {
      const route = createRoute("app/api/users/route.ts", `
import { z } from "zod";
const schema = z.object({ name: z.string() });
export async function POST(request: Request) {
  const body = await request.json();
  const result = schema.safeParse(body);
  if (!result.success) return Response.json({ error: result.error }, { status: 400 });
  await prisma.user.create({ data: result.data });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(0);
    });

    it("valibot v.parse()", () => {
      const route = createRoute("app/api/users/route.ts", `
import * as v from "valibot";
const schema = v.object({ name: v.string() });
export async function POST(request: Request) {
  const body = await request.json();
  const data = v.parse(schema, body);
  await prisma.user.create({ data });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(0);
    });

    it("yup .validate()", () => {
      const route = createRoute("app/api/users/route.ts", `
import * as yup from "yup";
const schema = yup.object({ name: yup.string().required() });
export async function POST(request: Request) {
  const body = await request.json();
  const data = await schema.validate(body);
  await prisma.user.create({ data });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(0);
    });

    it("next-safe-action createSafeActionClient", () => {
      const route = createRoute("app/api/users/route.ts", `
import { createSafeActionClient } from "next-safe-action";
const action = createSafeActionClient();
export async function POST(request: Request) {
  const body = await request.json();
  await prisma.user.create({ data: body });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(0);
    });

    it("tRPC .input(z.object(...))", () => {
      const route = createRoute("app/api/trpc/route.ts", `
import { z } from "zod";
const router = t.router({
  create: t.procedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      const body = await request.json();
      await prisma.user.create({ data: input });
    }),
});
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tests: JSON.parse is NOT schema validation                         */
  /* ------------------------------------------------------------------ */

  describe("JSON.parse does NOT suppress findings", () => {
    it("JSON.parse is not schema validation", () => {
      const route = createRoute("app/api/users/route.ts", `
export async function POST(request: Request) {
  const text = await request.json();
  const config = JSON.parse(process.env.CONFIG);
  await prisma.user.create({ data: text });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
    });

    it("URL.parse is not schema validation", () => {
      const route = createRoute("app/api/users/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = URL.parse(body.url);
  await prisma.user.create({ data: body });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
    });

    it("schema.parse alongside JSON.parse still suppresses", () => {
      const route = createRoute("app/api/users/route.ts", `
import { z } from "zod";
const schema = z.object({ name: z.string() });
export async function POST(request: Request) {
  const raw = await request.json();
  const config = JSON.parse(process.env.CONFIG);
  const data = schema.parse(raw);
  await prisma.user.create({ data });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Edge cases                                                         */
  /* ------------------------------------------------------------------ */

  describe("edge cases", () => {
    it("chained .parse() like getSchema().parse(body) suppresses finding", () => {
      const route = createRoute("app/api/users/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  const data = getSchema("user").parse(body);
  await prisma.user.create({ data });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(0);
    });

    it("commented-out schema.parse does NOT suppress finding", () => {
      const route = createRoute("app/api/users/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  // TODO: add validation
  // const data = schema.parse(body);
  await prisma.user.create({ data: body });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
    });

    it("block-commented schema.parse does NOT suppress finding", () => {
      const route = createRoute("app/api/users/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  /*
  const data = schema.parse(body);
  */
  await prisma.user.create({ data: body });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tests: should NOT flag (no write or no body read)                  */
  /* ------------------------------------------------------------------ */

  describe("does NOT flag when conditions incomplete", () => {
    it("reads body but no DB/Stripe write", () => {
      const route = createRoute("app/api/echo/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json(body);
}
`, BODY_ONLY_SIGNALS);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(0);
    });

    it("DB write but no body read", () => {
      const route = createRoute("app/api/cron/route.ts", `
export async function POST() {
  await prisma.job.create({ data: { ran: new Date() } });
  return Response.json({ ok: true });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  public-intent severity bump                                        */
  /* ------------------------------------------------------------------ */

  describe("public-intent severity bump", () => {
    it("bumps severity when public-intent present (med → high)", () => {
      const route = createRoute("app/api/ingest/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  await stripe.subscriptions.create({ items: body.items });
}
`, STRIPE_WRITE_SIGNALS);
      (route as any).publicIntent = { reason: "Public ingest endpoint", line: 1 };
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
      // Stripe-only would be med confidence → med severity, but public-intent bumps to high
      expect(findings[0].severity).toBe("high");
      expect(findings[0].tags).toContain("public-intent");
      expect(findings[0].evidence).toContain('public-intent: "Public ingest endpoint"');
    });

    it("bumps confidence to high when public-intent present", () => {
      const route = createRoute("app/api/ingest/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  await stripe.subscriptions.create({ items: body.items });
}
`, STRIPE_WRITE_SIGNALS);
      (route as any).publicIntent = { reason: "Public endpoint", line: 1 };
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
      // Stripe-only would be med confidence, but public-intent bumps to high
      expect(findings[0].confidence).toBe("high");
    });

    it("does NOT bump when publicIntent is absent", () => {
      const route = createRoute("app/api/ingest/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  await stripe.subscriptions.create({ items: body.items });
}
`, STRIPE_WRITE_SIGNALS);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe("med");
      expect(findings[0].tags).not.toContain("public-intent");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Confidence levels                                                  */
  /* ------------------------------------------------------------------ */

  describe("confidence levels", () => {
    it("high confidence with DB write evidence", () => {
      const route = createRoute("app/api/users/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  await prisma.user.create({ data: body });
}
`);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings[0].confidence).toBe("high");
      expect(findings[0].severity).toBe("high");
    });

    it("med confidence with Stripe write only (no DB)", () => {
      const route = createRoute("app/api/billing/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  await stripe.subscriptions.create({ items: body.items });
}
`, STRIPE_WRITE_SIGNALS);
      const findings = run(makeIndex([route]), makeConfig());
      expect(findings[0].confidence).toBe("med");
      expect(findings[0].severity).toBe("med");
    });
  });
});
