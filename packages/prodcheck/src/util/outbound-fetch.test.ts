import { describe, it, expect } from "vitest";
import { detectOutboundFetcher } from "./outbound-fetch.js";

describe("detectOutboundFetcher", () => {
  it("detects fetch() with user-influenced URL", () => {
    const src = `
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("target");
  const response = await fetch(url);
  return Response.json(await response.json());
}`;
    const result = detectOutboundFetcher(src);
    expect(result.hasOutboundFetch).toBe(true);
    expect(result.hasUserInfluencedUrl).toBe(true);
    expect(result.isRisky).toBe(true);
    expect(result.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("detects axios with user-influenced URL", () => {
    const src = `
export async function POST(request: Request) {
  const body = await request.json();
  const response = await axios.get(body.url);
  return Response.json(response.data);
}`;
    const result = detectOutboundFetcher(src);
    expect(result.isRisky).toBe(true);
  });

  it("does NOT flag fetch with hardcoded URL", () => {
    const src = `
export async function GET() {
  const response = await fetch("https://api.example.com/data");
  return Response.json(await response.json());
}`;
    const result = detectOutboundFetcher(src);
    expect(result.hasOutboundFetch).toBe(true);
    expect(result.hasUserInfluencedUrl).toBe(false);
    expect(result.isRisky).toBe(false);
  });

  it("does NOT flag when no fetch present", () => {
    const src = `
export async function POST(request: Request) {
  const body = await request.json();
  await prisma.user.create({ data: body });
  return Response.json({ ok: true });
}`;
    const result = detectOutboundFetcher(src);
    expect(result.hasOutboundFetch).toBe(false);
    expect(result.isRisky).toBe(false);
    expect(result.evidence).toHaveLength(0);
  });

  it("does NOT match fetchUser() as outbound fetch", () => {
    const src = `
export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await fetchUser(url.searchParams.get("id"));
  return Response.json(user);
}`;
    const result = detectOutboundFetcher(src);
    expect(result.hasOutboundFetch).toBe(false);
  });

  it("detects got() with user input", () => {
    const src = `
import got from "got";
export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  const response = await got(target);
  return Response.json(response.body);
}`;
    const result = detectOutboundFetcher(src);
    expect(result.isRisky).toBe(true);
  });

  it("detects undici.request with user input", () => {
    const src = `
import { request as undiciRequest } from "undici";
export async function POST(req: Request) {
  const body = await req.json();
  const { body: responseBody } = await undici.request(body.endpoint);
  return Response.json(responseBody);
}`;
    const result = detectOutboundFetcher(src);
    expect(result.isRisky).toBe(true);
  });
});
