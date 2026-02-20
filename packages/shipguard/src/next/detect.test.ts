import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectNextAppRouter } from "./detect.js";

describe("detectNextAppRouter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shipguard-detect-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fails when package.json is missing", () => {
    const result = detectNextAppRouter(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("package.json not found");
  });

  it("fails when next is not a dependency", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { react: "18" } }));
    const result = detectNextAppRouter(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("next dependency not found");
  });

  it("fails when app/ directory is missing", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
    const result = detectNextAppRouter(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("app/ directory not found");
  });

  it("detects app/ directory", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
    mkdirSync(path.join(tmpDir, "app"));
    const result = detectNextAppRouter(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.appDir).toBe("app");
  });

  it("detects src/app/ directory", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
    mkdirSync(path.join(tmpDir, "src", "app"), { recursive: true });
    const result = detectNextAppRouter(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.appDir).toBe("src/app");
  });

  it("detects next in devDependencies", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ devDependencies: { next: "14" } }));
    mkdirSync(path.join(tmpDir, "app"));
    const result = detectNextAppRouter(tmpDir);
    expect(result.ok).toBe(true);
  });

  it("detects route handlers", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
    mkdirSync(path.join(tmpDir, "app", "api", "test"), { recursive: true });
    writeFileSync(path.join(tmpDir, "app", "api", "test", "route.ts"), "export async function GET() {}");
    const result = detectNextAppRouter(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.hasRouteHandlers).toBe(true);
  });

  it("detects server actions", () => {
    writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
    mkdirSync(path.join(tmpDir, "app", "actions"), { recursive: true });
    writeFileSync(path.join(tmpDir, "app", "actions", "create.ts"), '"use server"\nexport async function create() {}');
    const result = detectNextAppRouter(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.hasServerActions).toBe(true);
  });

  it("handles malformed package.json", () => {
    writeFileSync(path.join(tmpDir, "package.json"), "not json");
    const result = detectNextAppRouter(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Failed to parse package.json");
  });
});
