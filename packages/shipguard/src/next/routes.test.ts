import { describe, it, expect } from "vitest";
import { detectMutationSignals, classifyMutationRoutes, parsePublicIntent } from "./routes.js";
import type { NextRoute } from "./types.js";

describe("detectMutationSignals", () => {
  it("detects prisma create", () => {
    const src = `await prisma.user.create({ data: { name } })`;
    const signals = detectMutationSignals(src);
    expect(signals.hasDbWriteEvidence).toBe(true);
    expect(signals.hasMutationEvidence).toBe(true);
    expect(signals.mutationDetails).toContain("prisma.create");
  });

  it("detects prisma update", () => {
    const src = `await db.post.update({ where: { id }, data: { title } })`;
    const signals = detectMutationSignals(src);
    expect(signals.hasDbWriteEvidence).toBe(true);
  });

  it("detects prisma delete", () => {
    const src = `await prisma.user.delete({ where: { id } })`;
    const signals = detectMutationSignals(src);
    expect(signals.hasDbWriteEvidence).toBe(true);
  });

  it("detects prisma upsert", () => {
    const src = `await prisma.user.upsert({ where: { email }, create: {}, update: {} })`;
    const signals = detectMutationSignals(src);
    expect(signals.hasDbWriteEvidence).toBe(true);
  });

  it("detects stripe write operations", () => {
    const src = `await stripe.customers.create({ email })`;
    const signals = detectMutationSignals(src);
    expect(signals.hasStripeWriteEvidence).toBe(true);
    expect(signals.hasMutationEvidence).toBe(true);
  });

  it("detects stripe checkout session", () => {
    const src = `await stripe.checkout.sessions.create({ mode: "payment" })`;
    const signals = detectMutationSignals(src);
    expect(signals.hasStripeWriteEvidence).toBe(true);
  });

  it("detects request body reading", () => {
    const src = `const body = await request.json()`;
    const signals = detectMutationSignals(src);
    expect(signals.hasMutationEvidence).toBe(true);
    expect(signals.mutationDetails).toContain("reads request body");
  });

  it("detects formData reading", () => {
    const src = `const data = await request.formData()`;
    const signals = detectMutationSignals(src);
    expect(signals.hasMutationEvidence).toBe(true);
  });

  it("detects raw SQL writes", () => {
    const src = `await prisma.$executeRaw\`DELETE FROM users\``;
    const signals = detectMutationSignals(src);
    expect(signals.hasDbWriteEvidence).toBe(true);
  });

  it("ignores crypto .update() — not a DB write", () => {
    const src = `
      const sig = crypto.createHmac("sha256", secret).update(text).digest();
    `;
    const signals = detectMutationSignals(src);
    expect(signals.hasDbWriteEvidence).toBe(false);
  });

  it("ignores headers.delete() — not a DB write", () => {
    const src = `headers.delete('content-length');`;
    const signals = detectMutationSignals(src);
    expect(signals.hasDbWriteEvidence).toBe(false);
  });

  it("ignores optional chaining span?.update() — not a DB write", () => {
    const src = `span?.update({ parentObservationId: tracePayload?.observationId });`;
    const signals = detectMutationSignals(src);
    expect(signals.hasDbWriteEvidence).toBe(false);
  });

  it("still detects model.update() as DB write", () => {
    const src = `await asyncTaskModel.update(taskId, { status: "done" });`;
    const signals = detectMutationSignals(src);
    expect(signals.hasDbWriteEvidence).toBe(true);
  });

  it("detects Drizzle db.insert() as DB write", () => {
    const src = `await db.insert(users).values({ name, email });`;
    const signals = detectMutationSignals(src);
    expect(signals.hasDbWriteEvidence).toBe(true);
  });

  it("returns no signals for GET-only route", () => {
    const src = `
      export async function GET() {
        const users = await prisma.user.findMany();
        return NextResponse.json(users);
      }
    `;
    const signals = detectMutationSignals(src);
    expect(signals.hasMutationEvidence).toBe(false);
    expect(signals.hasDbWriteEvidence).toBe(false);
    expect(signals.hasStripeWriteEvidence).toBe(false);
  });

  it("detects multiple signals", () => {
    const src = `
      const body = await request.json();
      await prisma.user.create({ data: body });
      await stripe.customers.create({ email: body.email });
    `;
    const signals = detectMutationSignals(src);
    expect(signals.hasMutationEvidence).toBe(true);
    expect(signals.hasDbWriteEvidence).toBe(true);
    expect(signals.hasStripeWriteEvidence).toBe(true);
    expect(signals.mutationDetails.length).toBeGreaterThanOrEqual(3);
  });
});

describe("classifyMutationRoutes", () => {
  function makeRoute(overrides: Partial<NextRoute> = {}): NextRoute {
    return {
      kind: "route-handler",
      file: "app/api/test/route.ts",
      pathname: "/api/test",
      isApi: true,
      isPublic: true,
      signals: {
        hasMutationEvidence: false,
        hasDbWriteEvidence: false,
        hasStripeWriteEvidence: false,
        mutationDetails: [],
      },
      ...overrides,
    };
  }

  it("filters to mutation routes only", () => {
    const routes = [
      makeRoute({ file: "a.ts", signals: { hasMutationEvidence: true, hasDbWriteEvidence: false, hasStripeWriteEvidence: false, mutationDetails: [] } }),
      makeRoute({ file: "b.ts" }),
      makeRoute({ file: "c.ts", signals: { hasMutationEvidence: false, hasDbWriteEvidence: true, hasStripeWriteEvidence: false, mutationDetails: [] } }),
    ];
    const mutations = classifyMutationRoutes(routes);
    expect(mutations).toHaveLength(2);
    expect(mutations.map((r) => r.file)).toEqual(["a.ts", "c.ts"]);
  });

  it("returns empty for no mutation routes", () => {
    const routes = [makeRoute(), makeRoute()];
    expect(classifyMutationRoutes(routes)).toHaveLength(0);
  });
});

describe("parsePublicIntent", () => {
  it("parses valid directive with double quotes", () => {
    const src = `// shipguard:public-intent reason="Public URL checker"
export async function GET(req: Request) {}`;
    const result = parsePublicIntent(src);
    expect(result).toEqual({ reason: "Public URL checker", line: 1 });
  });

  it("parses valid directive with single quotes", () => {
    const src = `// some code
// shipguard:public-intent reason='Webhook receiver; auth is Stripe signature'
export async function POST(req: Request) {}`;
    const result = parsePublicIntent(src);
    expect(result).toEqual({ reason: "Webhook receiver; auth is Stripe signature", line: 2 });
  });

  it("returns malformed when reason is missing", () => {
    const src = `// shipguard:public-intent
export async function GET(req: Request) {}`;
    const result = parsePublicIntent(src);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("raw");
    expect(result).not.toHaveProperty("reason");
  });

  it("returns malformed when reason is empty", () => {
    const src = `// shipguard:public-intent reason=""`;
    const result = parsePublicIntent(src);
    expect(result).toHaveProperty("raw");
    expect(result).not.toHaveProperty("reason");
  });

  it("returns null when no directive present", () => {
    const src = `export async function GET(req: Request) { return Response.json({}); }`;
    expect(parsePublicIntent(src)).toBeNull();
  });

  it("handles whitespace after //", () => {
    const src = `//   shipguard:public-intent reason="test"`;
    const result = parsePublicIntent(src);
    expect(result).toEqual({ reason: "test", line: 1 });
  });
});
