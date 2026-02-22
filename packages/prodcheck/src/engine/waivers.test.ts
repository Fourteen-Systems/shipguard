import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadWaivers, saveWaivers, addWaiver, applyWaivers } from "./waivers.js";
import type { Finding, Waiver } from "./types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "TEST-RULE",
    severity: "high",
    confidence: "high",
    message: "test",
    file: "test.ts",
    evidence: [],
    confidenceRationale: "",
    remediation: [],
    tags: [],
    ...overrides,
  };
}

describe("loadWaivers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "prodcheck-waivers-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when file does not exist", () => {
    expect(loadWaivers(tmpDir, "waivers.json")).toEqual([]);
  });

  it("loads legacy array format", () => {
    const waivers = [{ ruleId: "R1", file: "a.ts", reason: "ok", createdAt: "2024-01-01" }];
    writeFileSync(path.join(tmpDir, "waivers.json"), JSON.stringify(waivers));
    expect(loadWaivers(tmpDir, "waivers.json")).toEqual(waivers);
  });

  it("loads versioned format", () => {
    const file = { version: 1, waivers: [{ ruleId: "R1", file: "a.ts", reason: "ok", createdAt: "2024-01-01" }] };
    writeFileSync(path.join(tmpDir, "waivers.json"), JSON.stringify(file));
    expect(loadWaivers(tmpDir, "waivers.json")).toHaveLength(1);
  });

  it("throws on malformed JSON", () => {
    writeFileSync(path.join(tmpDir, "waivers.json"), "not json");
    expect(() => loadWaivers(tmpDir, "waivers.json")).toThrow("Failed to parse");
  });
});

describe("saveWaivers / addWaiver", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "prodcheck-waivers-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads roundtrip", () => {
    const waivers: Waiver[] = [{ ruleId: "R1", file: "a.ts", reason: "ok", createdAt: "2024-01-01" }];
    saveWaivers(tmpDir, "w.json", waivers);

    const loaded = loadWaivers(tmpDir, "w.json");
    expect(loaded).toEqual(waivers);
  });

  it("saves in versioned format", () => {
    saveWaivers(tmpDir, "w.json", []);
    const raw = JSON.parse(readFileSync(path.join(tmpDir, "w.json"), "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.waivers).toEqual([]);
  });

  it("addWaiver appends and sets createdAt", () => {
    const waiver = addWaiver(tmpDir, "w.json", { ruleId: "R1", file: "a.ts", reason: "test" });
    expect(waiver.createdAt).toBeDefined();
    expect(waiver.ruleId).toBe("R1");

    const loaded = loadWaivers(tmpDir, "w.json");
    expect(loaded).toHaveLength(1);
  });

  it("addWaiver accumulates waivers", () => {
    addWaiver(tmpDir, "w.json", { ruleId: "R1", file: "a.ts", reason: "first" });
    addWaiver(tmpDir, "w.json", { ruleId: "R2", file: "b.ts", reason: "second" });

    const loaded = loadWaivers(tmpDir, "w.json");
    expect(loaded).toHaveLength(2);
  });
});

describe("applyWaivers", () => {
  it("returns all findings as active when no waivers", () => {
    const findings = [makeFinding({ ruleId: "R1", file: "a.ts" })];
    const { active, waived } = applyWaivers(findings, []);
    expect(active).toHaveLength(1);
    expect(waived).toHaveLength(0);
  });

  it("waives matching findings", () => {
    const findings = [
      makeFinding({ ruleId: "R1", file: "a.ts" }),
      makeFinding({ ruleId: "R2", file: "b.ts" }),
    ];
    const waivers: Waiver[] = [
      { ruleId: "R1", file: "a.ts", reason: "ok", createdAt: "2024-01-01" },
    ];

    const { active, waived } = applyWaivers(findings, waivers);
    expect(active).toHaveLength(1);
    expect(active[0].ruleId).toBe("R2");
    expect(waived).toHaveLength(1);
    expect(waived[0].ruleId).toBe("R1");
  });

  it("does not waive when ruleId differs", () => {
    const findings = [makeFinding({ ruleId: "R1", file: "a.ts" })];
    const waivers: Waiver[] = [
      { ruleId: "R2", file: "a.ts", reason: "ok", createdAt: "2024-01-01" },
    ];
    const { active, waived } = applyWaivers(findings, waivers);
    expect(active).toHaveLength(1);
    expect(waived).toHaveLength(0);
  });

  it("does not waive when file differs", () => {
    const findings = [makeFinding({ ruleId: "R1", file: "a.ts" })];
    const waivers: Waiver[] = [
      { ruleId: "R1", file: "b.ts", reason: "ok", createdAt: "2024-01-01" },
    ];
    const { active, waived } = applyWaivers(findings, waivers);
    expect(active).toHaveLength(1);
    expect(waived).toHaveLength(0);
  });

  it("ignores expired waivers", () => {
    const findings = [makeFinding({ ruleId: "R1", file: "a.ts" })];
    const waivers: Waiver[] = [
      { ruleId: "R1", file: "a.ts", reason: "ok", expiry: "2020-01-01", createdAt: "2019-01-01" },
    ];
    const { active, waived } = applyWaivers(findings, waivers);
    expect(active).toHaveLength(1);
    expect(waived).toHaveLength(0);
  });

  it("applies non-expired waivers", () => {
    const findings = [makeFinding({ ruleId: "R1", file: "a.ts" })];
    const waivers: Waiver[] = [
      { ruleId: "R1", file: "a.ts", reason: "ok", expiry: "2099-01-01", createdAt: "2024-01-01" },
    ];
    const { active, waived } = applyWaivers(findings, waivers);
    expect(active).toHaveLength(0);
    expect(waived).toHaveLength(1);
  });

  it("applies waivers without expiry", () => {
    const findings = [makeFinding({ ruleId: "R1", file: "a.ts" })];
    const waivers: Waiver[] = [
      { ruleId: "R1", file: "a.ts", reason: "ok", createdAt: "2024-01-01" },
    ];
    const { active, waived } = applyWaivers(findings, waivers);
    expect(active).toHaveLength(0);
    expect(waived).toHaveLength(1);
  });
});
