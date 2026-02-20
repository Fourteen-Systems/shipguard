import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { findingKey, writeBaseline, loadBaseline, diffBaseline } from "./baseline.js";
import type { Finding, ScanResult, Baseline } from "./types.js";

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

function makeScanResult(findings: Finding[], score = 100): ScanResult {
  return {
    version: 1,
    shipguardVersion: "0.1.0",
    configHash: "abc",
    indexVersion: 1,
    timestamp: new Date().toISOString(),
    framework: "next-app-router",
    detected: {
      deps: {} as any,
      trpc: false,
      middleware: false,
    },
    score,
    findings,
    waivedFindings: [],
    summary: { total: findings.length, critical: 0, high: 0, med: 0, low: 0, waived: 0 },
  };
}

describe("findingKey", () => {
  it("generates key from ruleId, file, and line", () => {
    const f = makeFinding({ ruleId: "AUTH-BOUNDARY-MISSING", file: "app/api/route.ts", line: 13 });
    expect(findingKey(f)).toBe("AUTH-BOUNDARY-MISSING::app/api/route.ts::13");
  });

  it("uses 0 when line is undefined", () => {
    const f = makeFinding({ ruleId: "RATE-LIMIT-MISSING", file: "app/api/route.ts" });
    expect(findingKey(f)).toBe("RATE-LIMIT-MISSING::app/api/route.ts::0");
  });
});

describe("writeBaseline / loadBaseline", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shipguard-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes and loads baseline roundtrip", () => {
    const findings = [makeFinding({ ruleId: "R1", file: "a.ts", line: 1 })];
    const result = makeScanResult(findings, 90);
    const dest = writeBaseline(tmpDir, result);

    const loaded = loadBaseline(dest);
    expect(loaded).toBeDefined();
    expect(loaded!.score).toBe(90);
    expect(loaded!.findingKeys).toEqual(["R1::a.ts::1"]);
    expect(loaded!.version).toBe(1);
  });

  it("writes to custom path", () => {
    const customPath = path.join(tmpDir, "custom-baseline.json");
    const result = makeScanResult([]);
    writeBaseline(tmpDir, result, customPath);

    expect(loadBaseline(customPath)).toBeDefined();
  });

  it("returns undefined for missing file", () => {
    expect(loadBaseline("/nonexistent/path.json")).toBeUndefined();
  });

  it("throws on malformed JSON", () => {
    const badFile = path.join(tmpDir, "bad.json");
    require("node:fs").writeFileSync(badFile, "not json");
    expect(() => loadBaseline(badFile)).toThrow("Failed to parse baseline");
  });
});

describe("diffBaseline", () => {
  it("identifies new findings", () => {
    const baseline: Baseline = {
      version: 1,
      shipguardVersion: "0.1.0",
      configHash: "abc",
      indexVersion: 1,
      createdAt: new Date().toISOString(),
      score: 90,
      findingKeys: ["R1::a.ts::1"],
    };

    const newFinding = makeFinding({ ruleId: "R2", file: "b.ts", line: 5 });
    const existing = makeFinding({ ruleId: "R1", file: "a.ts", line: 1 });
    const current = makeScanResult([existing, newFinding], 80);

    const diff = diffBaseline(baseline, current);
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0].ruleId).toBe("R2");
    expect(diff.resolvedKeys).toHaveLength(0);
    expect(diff.scoreDelta).toBe(-10);
  });

  it("identifies resolved findings", () => {
    const baseline: Baseline = {
      version: 1,
      shipguardVersion: "0.1.0",
      configHash: "abc",
      indexVersion: 1,
      createdAt: new Date().toISOString(),
      score: 80,
      findingKeys: ["R1::a.ts::1", "R2::b.ts::5"],
    };

    const current = makeScanResult([makeFinding({ ruleId: "R1", file: "a.ts", line: 1 })], 90);

    const diff = diffBaseline(baseline, current);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolvedKeys).toEqual(["R2::b.ts::5"]);
    expect(diff.scoreDelta).toBe(10);
  });

  it("handles empty baseline and empty current", () => {
    const baseline: Baseline = {
      version: 1,
      shipguardVersion: "0.1.0",
      configHash: "abc",
      indexVersion: 1,
      createdAt: new Date().toISOString(),
      score: 100,
      findingKeys: [],
    };

    const current = makeScanResult([], 100);
    const diff = diffBaseline(baseline, current);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolvedKeys).toHaveLength(0);
    expect(diff.scoreDelta).toBe(0);
  });
});
