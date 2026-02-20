import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadTsconfigPaths, resolveImportPath, followReExport } from "./resolve.js";

describe("loadTsconfigPaths", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shipguard-resolve-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when no tsconfig exists", () => {
    expect(loadTsconfigPaths(tmpDir)).toBeUndefined();
  });

  it("reads paths from tsconfig.json", () => {
    writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
        },
      }),
    );
    const result = loadTsconfigPaths(tmpDir);
    expect(result).toBeDefined();
    expect(result!.paths["@/*"]).toEqual(["./src/*"]);
    expect(result!.baseUrl).toBe(".");
  });

  it("falls back to tsconfig.app.json", () => {
    writeFileSync(
      path.join(tmpDir, "tsconfig.app.json"),
      JSON.stringify({
        compilerOptions: {
          paths: { "~/*": ["./src/*"] },
        },
      }),
    );
    const result = loadTsconfigPaths(tmpDir);
    expect(result).toBeDefined();
    expect(result!.paths["~/*"]).toEqual(["./src/*"]);
  });

  it("handles extends chain", () => {
    writeFileSync(
      path.join(tmpDir, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@base/*": ["./base/*"] },
        },
      }),
    );
    writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: {
          paths: { "@/*": ["./src/*"] },
        },
      }),
    );
    const result = loadTsconfigPaths(tmpDir);
    expect(result).toBeDefined();
    // Child paths override/merge with parent
    expect(result!.paths["@/*"]).toEqual(["./src/*"]);
    expect(result!.paths["@base/*"]).toEqual(["./base/*"]);
  });

  it("handles JSONC comments", () => {
    writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      `{
        // This is a comment
        "compilerOptions": {
          /* block comment */
          "paths": { "@/*": ["./src/*"] }
        }
      }`,
    );
    const result = loadTsconfigPaths(tmpDir);
    expect(result).toBeDefined();
    expect(result!.paths["@/*"]).toEqual(["./src/*"]);
  });
});

describe("resolveImportPath", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shipguard-resolve-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves relative imports", () => {
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(path.join(tmpDir, "src", "lib", "auth.ts"), "export function withAuth() {}");

    const result = resolveImportPath("src/routes/route.ts", "../lib/auth", { rootDir: tmpDir });
    expect(result).toBe("src/lib/auth.ts");
  });

  it("resolves @/ convention to src/", () => {
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(path.join(tmpDir, "src", "lib", "auth.ts"), "export function withAuth() {}");

    const result = resolveImportPath("app/api/route.ts", "@/lib/auth", { rootDir: tmpDir });
    expect(result).toBe("src/lib/auth.ts");
  });

  it("resolves ~/ convention to src/", () => {
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(path.join(tmpDir, "src", "lib", "auth.ts"), "export function withAuth() {}");

    const result = resolveImportPath("app/api/route.ts", "~/lib/auth", { rootDir: tmpDir });
    expect(result).toBe("src/lib/auth.ts");
  });

  it("resolves tsconfig paths", () => {
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(path.join(tmpDir, "src", "lib", "auth.ts"), "export function withAuth() {}");

    const result = resolveImportPath("app/api/route.ts", "@/lib/auth", {
      rootDir: tmpDir,
      tsconfigPaths: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    });
    expect(result).toBe("src/lib/auth.ts");
  });

  it("probes index files for directory imports", () => {
    mkdirSync(path.join(tmpDir, "src", "lib", "auth"), { recursive: true });
    writeFileSync(path.join(tmpDir, "src", "lib", "auth", "index.ts"), "export function withAuth() {}");

    const result = resolveImportPath("app/api/route.ts", "@/lib/auth", { rootDir: tmpDir });
    expect(result).toBe("src/lib/auth/index.ts");
  });

  it("probes .tsx extension", () => {
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(path.join(tmpDir, "src", "lib", "auth.tsx"), "export function withAuth() {}");

    const result = resolveImportPath("app/api/route.ts", "@/lib/auth", { rootDir: tmpDir });
    expect(result).toBe("src/lib/auth.tsx");
  });

  it("probes .mts extension", () => {
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(path.join(tmpDir, "src", "lib", "auth.mts"), "export function withAuth() {}");

    const result = resolveImportPath("app/api/route.ts", "@/lib/auth", { rootDir: tmpDir });
    expect(result).toBe("src/lib/auth.mts");
  });

  it("returns undefined for bare specifiers (npm packages)", () => {
    const result = resolveImportPath("app/api/route.ts", "lodash", { rootDir: tmpDir });
    expect(result).toBeUndefined();
  });

  it("resolves with baseUrl", () => {
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(path.join(tmpDir, "src", "lib", "auth.ts"), "export function withAuth() {}");

    const result = resolveImportPath("app/api/route.ts", "lib/auth", {
      rootDir: tmpDir,
      tsconfigPaths: { baseUrl: "src", paths: {} },
    });
    expect(result).toBe("src/lib/auth.ts");
  });
});

describe("followReExport", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shipguard-resolve-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds symbol defined in the start file", () => {
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "src", "lib", "auth.ts"),
      `export function withAuth(handler: any) { return handler; }`,
    );

    const result = followReExport("withAuth", "src/lib/auth.ts", { rootDir: tmpDir });
    expect(result).toBeDefined();
    expect(result!.file).toBe("src/lib/auth.ts");
  });

  it("follows named re-export one hop", () => {
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "src", "lib", "index.ts"),
      `export { withAuth } from "./auth";`,
    );
    writeFileSync(
      path.join(tmpDir, "src", "lib", "auth.ts"),
      `export function withAuth(handler: any) { return handler; }`,
    );

    const result = followReExport("withAuth", "src/lib/index.ts", { rootDir: tmpDir });
    expect(result).toBeDefined();
    expect(result!.file).toBe("src/lib/auth.ts");
  });

  it("follows multiple hops", () => {
    mkdirSync(path.join(tmpDir, "src", "lib", "deep"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "src", "index.ts"),
      `export { withAuth } from "./lib";`,
    );
    writeFileSync(
      path.join(tmpDir, "src", "lib", "index.ts"),
      `export { withAuth } from "./deep";`,
    );
    writeFileSync(
      path.join(tmpDir, "src", "lib", "deep", "index.ts"),
      `export function withAuth(handler: any) { return handler; }`,
    );

    const result = followReExport("withAuth", "src/index.ts", { rootDir: tmpDir });
    expect(result).toBeDefined();
    expect(result!.file).toBe("src/lib/deep/index.ts");
  });

  it("detects cycles and returns undefined", () => {
    mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "src", "a.ts"),
      `export { withAuth } from "./b";`,
    );
    writeFileSync(
      path.join(tmpDir, "src", "b.ts"),
      `export { withAuth } from "./a";`,
    );

    const result = followReExport("withAuth", "src/a.ts", { rootDir: tmpDir });
    expect(result).toBeUndefined();
  });

  it("follows star re-exports", () => {
    mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "src", "lib", "index.ts"),
      `export * from "./auth";`,
    );
    writeFileSync(
      path.join(tmpDir, "src", "lib", "auth.ts"),
      `export function withAuth(handler: any) { return handler; }`,
    );

    const result = followReExport("withAuth", "src/lib/index.ts", { rootDir: tmpDir });
    expect(result).toBeDefined();
    expect(result!.file).toBe("src/lib/auth.ts");
  });
});
