import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeMiddleware } from "./middleware.js";

describe("analyzeMiddleware", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "prodcheck-mw-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no middleware file exists", () => {
    const result = analyzeMiddleware(tmpDir);
    expect(result.file).toBeUndefined();
    expect(result.authLikely).toBe(false);
    expect(result.rateLimitLikely).toBe(false);
    expect(result.matcherPatterns).toEqual([]);
  });

  it("finds middleware.ts at root", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), "export function middleware() {}");
    const result = analyzeMiddleware(tmpDir);
    expect(result.file).toBe("middleware.ts");
  });

  it("finds middleware.js at root", () => {
    writeFileSync(path.join(tmpDir, "middleware.js"), "export function middleware() {}");
    const result = analyzeMiddleware(tmpDir);
    expect(result.file).toBe("middleware.js");
  });

  it("finds src/middleware.ts", () => {
    mkdirSync(path.join(tmpDir, "src"));
    writeFileSync(path.join(tmpDir, "src", "middleware.ts"), "export function middleware() {}");
    const result = analyzeMiddleware(tmpDir);
    expect(result.file).toBe("src/middleware.ts");
  });

  it("prefers root middleware.ts over src/middleware.ts", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), "// root");
    mkdirSync(path.join(tmpDir, "src"));
    writeFileSync(path.join(tmpDir, "src", "middleware.ts"), "// src");
    const result = analyzeMiddleware(tmpDir);
    expect(result.file).toBe("middleware.ts");
  });

  it("detects Clerk auth", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      import { clerkMiddleware } from "@clerk/nextjs/server";
      export default clerkMiddleware();
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.authLikely).toBe(true);
  });

  it("detects NextAuth getToken", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      import { getToken } from "next-auth/jwt";
      const token = await getToken({ req });
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.authLikely).toBe(true);
  });

  it("detects NextAuth auth()", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      import { auth } from "./auth";
      export default auth((req) => {});
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.authLikely).toBe(true);
  });

  it("detects Supabase createMiddlewareClient", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      const supabase = createMiddlewareClient({ req, res });
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.authLikely).toBe(true);
  });

  it("detects WorkOS authkitMiddleware", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
      export default authkitMiddleware();
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.authLikely).toBe(true);
  });

  it("detects Kinde middleware", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      import { kindeMiddleware } from "@kinde-oss/kinde-auth-nextjs";
      export default kindeMiddleware();
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.authLikely).toBe(true);
  });

  it("detects Auth0 withMiddlewareAuthRequired", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      import { withMiddlewareAuthRequired } from "@auth0/nextjs-auth0";
      export default withMiddlewareAuthRequired();
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.authLikely).toBe(true);
  });

  it("detects iron-session getIronSession", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      const session = await getIronSession(req, res, config);
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.authLikely).toBe(true);
  });

  it("does not flag auth for generic middleware", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      export function middleware(req) {
        return NextResponse.next();
      }
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.authLikely).toBe(false);
  });

  it("detects rate limiting with upstash", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      import { Ratelimit } from "@upstash/ratelimit";
      const ratelimit = new Ratelimit({ redis });
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.rateLimitLikely).toBe(true);
  });

  it("detects rateLimit keyword (camelCase)", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      const { success } = await rateLimit(req);
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.rateLimitLikely).toBe(true);
  });

  it("does not flag rate limit for generic middleware", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      export function middleware(req) { return NextResponse.next(); }
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.rateLimitLikely).toBe(false);
  });

  it("extracts matcher patterns", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      export const config = {
        matcher: ["/api/:path*", "/dashboard/:path*"]
      };
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.matcherPatterns).toEqual(["/api/:path*", "/dashboard/:path*"]);
  });

  it("extracts single-quoted matcher patterns", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      export const config = {
        matcher: ['/api/:path*']
      };
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.matcherPatterns).toEqual(["/api/:path*"]);
  });

  it("returns empty matcher when no config", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      export function middleware(req) { return NextResponse.next(); }
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.matcherPatterns).toEqual([]);
  });

  it("detects auth and rate limit together", () => {
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      import { clerkMiddleware } from "@clerk/nextjs/server";
      import { Ratelimit } from "@upstash/ratelimit";
      export default clerkMiddleware();
    `);
    const result = analyzeMiddleware(tmpDir);
    expect(result.authLikely).toBe(true);
    expect(result.rateLimitLikely).toBe(true);
  });

  it("finds middleware at monorepo workspace root (pnpm-workspace.yaml)", () => {
    // Simulate monorepo: tmpDir/apps/web with middleware at tmpDir
    const webDir = path.join(tmpDir, "apps", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - apps/*");
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({}));
    writeFileSync(path.join(webDir, "package.json"), JSON.stringify({}));
    writeFileSync(path.join(tmpDir, "middleware.ts"), `
      import { auth } from "./auth";
      export default auth((req) => {});
    `);
    const result = analyzeMiddleware(webDir);
    expect(result.file).toBe("middleware.ts");
    expect(result.authLikely).toBe(true);
  });

  it("prefers local middleware over workspace root middleware", () => {
    const webDir = path.join(tmpDir, "apps", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - apps/*");
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({}));
    writeFileSync(path.join(webDir, "package.json"), JSON.stringify({}));
    writeFileSync(path.join(tmpDir, "middleware.ts"), "// root middleware");
    writeFileSync(path.join(webDir, "middleware.ts"), `
      import { clerkMiddleware } from "@clerk/nextjs/server";
      export default clerkMiddleware();
    `);
    const result = analyzeMiddleware(webDir);
    expect(result.file).toBe("middleware.ts");
    expect(result.authLikely).toBe(true);
  });
});
