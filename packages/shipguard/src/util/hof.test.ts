import { describe, it, expect } from "vitest";
import { extractHofWrapperChain, isWrappedByFunction, findImportSource } from "./hof.js";

describe("extractHofWrapperChain", () => {
  it("extracts single wrapper from const export", () => {
    const src = `export const POST = withWorkspace(async (req) => { return Response.json({}); });`;
    expect(extractHofWrapperChain(src)).toEqual(["withWorkspace"]);
  });

  it("extracts chained wrappers", () => {
    const src = `export const POST = withWorkspace(withErrorBoundary(async (req) => { return Response.json({}); }));`;
    expect(extractHofWrapperChain(src)).toEqual(["withWorkspace", "withErrorBoundary"]);
  });

  it("extracts from export default", () => {
    const src = `export default withAuth(handler);`;
    expect(extractHofWrapperChain(src)).toEqual(["withAuth"]);
  });

  it("extracts from multiple method exports", () => {
    const src = `
      export const GET = withWorkspace(getHandler);
      export const POST = withWorkspace(postHandler);
    `;
    // Should deduplicate
    expect(extractHofWrapperChain(src)).toEqual(["withWorkspace"]);
  });

  it("returns empty for regular function exports", () => {
    const src = `export async function POST(req: Request) { return Response.json({}); }`;
    expect(extractHofWrapperChain(src)).toEqual([]);
  });

  it("skips JavaScript keywords", () => {
    const src = `export const POST = async function(req) { return new Response(); };`;
    // "async" and "Response" should be filtered out
    const chain = extractHofWrapperChain(src);
    expect(chain).not.toContain("async");
    expect(chain).not.toContain("Response");
  });
});

describe("isWrappedByFunction", () => {
  it("matches const export pattern", () => {
    const src = `export const POST = withAuth(async (req) => {});`;
    expect(isWrappedByFunction(src, "withAuth")).toBe(true);
  });

  it("matches default export pattern", () => {
    const src = `export default withAuth(handler);`;
    expect(isWrappedByFunction(src, "withAuth")).toBe(true);
  });

  it("does not match different function", () => {
    const src = `export const POST = withAuth(handler);`;
    expect(isWrappedByFunction(src, "withRateLimit")).toBe(false);
  });

  it("does not match function call inside handler", () => {
    const src = `export async function POST(req: Request) { withAuth(); }`;
    expect(isWrappedByFunction(src, "withAuth")).toBe(false);
  });
});

describe("findImportSource", () => {
  it("finds named import source", () => {
    const src = `import { withWorkspace } from "@/lib/auth";`;
    expect(findImportSource(src, "withWorkspace")).toBe("@/lib/auth");
  });

  it("finds default import source", () => {
    const src = `import withAuth from "@/lib/auth";`;
    expect(findImportSource(src, "withAuth")).toBe("@/lib/auth");
  });

  it("returns undefined for same-file definition", () => {
    const src = `
      function withAuth(handler: any) { return handler; }
      export const POST = withAuth(handler);
    `;
    expect(findImportSource(src, "withAuth")).toBeUndefined();
  });

  it("handles aliased imports", () => {
    const src = `import { myAuth as withAuth } from "@/lib/auth";`;
    expect(findImportSource(src, "withAuth")).toBe("@/lib/auth");
  });

  it("handles multiple named imports", () => {
    const src = `import { foo, withWorkspace, bar } from "@/lib/auth";`;
    expect(findImportSource(src, "withWorkspace")).toBe("@/lib/auth");
  });
});
