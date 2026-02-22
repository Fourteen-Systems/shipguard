import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { findConfigFile, loadConfigIfExists, writeDefaultConfig, DEFAULT_CONFIG } from "./config.js";

describe("findConfigFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "prodcheck-config-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when no config exists", () => {
    expect(findConfigFile(tmpDir)).toBeUndefined();
  });

  it("finds prodcheck.config.json", () => {
    writeFileSync(path.join(tmpDir, "prodcheck.config.json"), "{}");
    expect(findConfigFile(tmpDir)).toBe(path.join(tmpDir, "prodcheck.config.json"));
  });

  it("finds prodcheck.config.ts", () => {
    writeFileSync(path.join(tmpDir, "prodcheck.config.ts"), "export default {}");
    expect(findConfigFile(tmpDir)).toBe(path.join(tmpDir, "prodcheck.config.ts"));
  });

  it("prefers ts over json", () => {
    writeFileSync(path.join(tmpDir, "prodcheck.config.ts"), "export default {}");
    writeFileSync(path.join(tmpDir, "prodcheck.config.json"), "{}");
    expect(findConfigFile(tmpDir)).toBe(path.join(tmpDir, "prodcheck.config.ts"));
  });
});

describe("loadConfigIfExists", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "prodcheck-config-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when no config exists", () => {
    expect(loadConfigIfExists(tmpDir)).toBeUndefined();
  });

  it("loads JSON config", () => {
    const config = { framework: "next-app-router", include: ["app/**"] };
    writeFileSync(path.join(tmpDir, "prodcheck.config.json"), JSON.stringify(config));
    const loaded = loadConfigIfExists(tmpDir);
    expect(loaded).toBeDefined();
    expect(loaded!.framework).toBe("next-app-router");
  });

  it("throws on malformed JSON", () => {
    writeFileSync(path.join(tmpDir, "prodcheck.config.json"), "not json");
    expect(() => loadConfigIfExists(tmpDir)).toThrow("Failed to parse");
  });

  it("returns undefined for TS config (not yet supported)", () => {
    writeFileSync(path.join(tmpDir, "prodcheck.config.ts"), "export default {}");
    expect(loadConfigIfExists(tmpDir)).toBeUndefined();
  });
});

describe("writeDefaultConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "prodcheck-config-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes config file", () => {
    writeDefaultConfig(tmpDir, {});
    expect(existsSync(path.join(tmpDir, "prodcheck.config.json"))).toBe(true);
  });

  it("does not overwrite existing without force", () => {
    writeFileSync(path.join(tmpDir, "prodcheck.config.json"), '{"custom": true}');
    writeDefaultConfig(tmpDir, {});
    const content = JSON.parse(require("node:fs").readFileSync(path.join(tmpDir, "prodcheck.config.json"), "utf8"));
    expect(content.custom).toBe(true);
  });

  it("overwrites existing with force", () => {
    writeFileSync(path.join(tmpDir, "prodcheck.config.json"), '{"custom": true}');
    writeDefaultConfig(tmpDir, { force: true });
    const content = JSON.parse(require("node:fs").readFileSync(path.join(tmpDir, "prodcheck.config.json"), "utf8"));
    expect(content.custom).toBeUndefined();
    expect(content.framework).toBe("next-app-router");
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has expected structure", () => {
    expect(DEFAULT_CONFIG.framework).toBe("next-app-router");
    expect(DEFAULT_CONFIG.scoring.start).toBe(100);
    expect(DEFAULT_CONFIG.scoring.penalties.critical).toBe(15);
    expect(DEFAULT_CONFIG.rules["AUTH-BOUNDARY-MISSING"]).toBeDefined();
    expect(DEFAULT_CONFIG.rules["RATE-LIMIT-MISSING"]).toBeDefined();
    expect(DEFAULT_CONFIG.rules["TENANCY-SCOPE-MISSING"]).toBeDefined();
  });

  it("has auth hint functions", () => {
    expect(DEFAULT_CONFIG.hints.auth.functions.length).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.hints.auth.functions).toContain("auth");
    expect(DEFAULT_CONFIG.hints.auth.functions).toContain("getServerSession");
  });

  it("has rate limit wrappers", () => {
    expect(DEFAULT_CONFIG.hints.rateLimit.wrappers.length).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.hints.rateLimit.wrappers).toContain("rateLimit");
  });

  it("has tenancy field names", () => {
    expect(DEFAULT_CONFIG.hints.tenancy.orgFieldNames).toContain("orgId");
    expect(DEFAULT_CONFIG.hints.tenancy.orgFieldNames).toContain("tenantId");
  });
});
