import { describe, it, expect } from "vitest";
import {
  computeScore,
  summarizeFindings,
  parseConfidence,
  parseSeverity,
  parseIntOrThrow,
  confidenceLevel,
  severityLevel,
  scoreStatus,
  buildDetectedList,
} from "./score.js";
import type { Finding, ScanResult } from "./types.js";
import type { NextDepsIndex } from "../next/types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "TEST-RULE",
    severity: "high",
    confidence: "high",
    message: "test finding",
    file: "test.ts",
    evidence: [],
    confidenceRationale: "",
    remediation: [],
    tags: [],
    ...overrides,
  };
}

describe("computeScore", () => {
  it("returns 100 with no findings", () => {
    expect(computeScore([])).toBe(100);
  });

  it("subtracts penalty for each finding", () => {
    const findings = [makeFinding({ severity: "critical" })];
    expect(computeScore(findings)).toBe(75);
  });

  it("applies correct penalties per severity", () => {
    expect(computeScore([makeFinding({ severity: "critical" })])).toBe(75);
    expect(computeScore([makeFinding({ severity: "high" })])).toBe(90);
    expect(computeScore([makeFinding({ severity: "med" })])).toBe(97);
    expect(computeScore([makeFinding({ severity: "low" })])).toBe(99);
  });

  it("accumulates multiple findings from different rules", () => {
    const findings = [
      makeFinding({ ruleId: "RULE-A", severity: "critical" }),
      makeFinding({ ruleId: "RULE-B", severity: "critical" }),
      makeFinding({ ruleId: "RULE-C", severity: "high" }),
    ];
    expect(computeScore(findings)).toBe(40);
  });

  it("caps deduction per rule at 40% of start", () => {
    // 10 critical findings from same rule = 250 raw penalty, capped at 40
    const findings = Array.from({ length: 10 }, () =>
      makeFinding({ severity: "critical" }),
    );
    expect(computeScore(findings)).toBe(60);
  });

  it("floors at 0 with enough different rules", () => {
    const findings = [
      makeFinding({ ruleId: "RULE-A", severity: "critical" }),
      makeFinding({ ruleId: "RULE-A", severity: "critical" }),
      makeFinding({ ruleId: "RULE-B", severity: "critical" }),
      makeFinding({ ruleId: "RULE-B", severity: "critical" }),
      makeFinding({ ruleId: "RULE-C", severity: "critical" }),
      makeFinding({ ruleId: "RULE-C", severity: "critical" }),
    ];
    // Each rule: 50 raw, capped at 40. 3 rules * 40 = 120 > 100 → floors at 0
    expect(computeScore(findings)).toBe(0);
  });

  it("uses custom scoring config", () => {
    const config = { start: 50, penalties: { critical: 10, high: 5, med: 2, low: 1 } };
    expect(computeScore([makeFinding({ severity: "critical" })], config)).toBe(40);
  });

  it("respects custom maxPenaltyPerRule", () => {
    const config = {
      start: 100,
      penalties: { critical: 25, high: 10, med: 3, low: 1 },
      maxPenaltyPerRule: 25,
    };
    // 5 critical from same rule = 125 raw, capped at 25
    const findings = Array.from({ length: 5 }, () =>
      makeFinding({ severity: "critical" }),
    );
    expect(computeScore(findings, config)).toBe(75);
  });

  it("applies cap independently per rule", () => {
    // Two rules, each with findings that exceed the cap
    const findings = [
      makeFinding({ ruleId: "AUTH", severity: "critical" }),
      makeFinding({ ruleId: "AUTH", severity: "critical" }),
      makeFinding({ ruleId: "AUTH", severity: "critical" }),
      makeFinding({ ruleId: "RATE", severity: "critical" }),
      makeFinding({ ruleId: "RATE", severity: "critical" }),
      makeFinding({ ruleId: "RATE", severity: "critical" }),
    ];
    // AUTH: 75 raw, capped at 40. RATE: 75 raw, capped at 40. Total: 80 → score 20
    expect(computeScore(findings)).toBe(20);
  });
});

describe("summarizeFindings", () => {
  it("returns zero counts with no findings", () => {
    expect(summarizeFindings([])).toEqual({ critical: 0, high: 0, med: 0, low: 0 });
  });

  it("counts by severity", () => {
    const findings = [
      makeFinding({ severity: "critical" }),
      makeFinding({ severity: "critical" }),
      makeFinding({ severity: "high" }),
      makeFinding({ severity: "low" }),
    ];
    expect(summarizeFindings(findings)).toEqual({ critical: 2, high: 1, med: 0, low: 1 });
  });
});

describe("parseConfidence", () => {
  it("parses valid values", () => {
    expect(parseConfidence("high")).toBe("high");
    expect(parseConfidence("med")).toBe("med");
    expect(parseConfidence("low")).toBe("low");
  });

  it("throws on invalid values", () => {
    expect(() => parseConfidence("invalid")).toThrow("Invalid confidence");
    expect(() => parseConfidence("")).toThrow("Invalid confidence");
  });
});

describe("parseSeverity", () => {
  it("parses valid values", () => {
    expect(parseSeverity("critical")).toBe("critical");
    expect(parseSeverity("high")).toBe("high");
    expect(parseSeverity("med")).toBe("med");
    expect(parseSeverity("low")).toBe("low");
  });

  it("throws on invalid values", () => {
    expect(() => parseSeverity("medium")).toThrow("Invalid severity");
    expect(() => parseSeverity("")).toThrow("Invalid severity");
  });
});

describe("parseIntOrThrow", () => {
  it("parses valid integers", () => {
    expect(parseIntOrThrow("42", "test")).toBe(42);
    expect(parseIntOrThrow("0", "test")).toBe(0);
    expect(parseIntOrThrow("-1", "test")).toBe(-1);
  });

  it("throws on non-numbers", () => {
    expect(() => parseIntOrThrow("abc", "test")).toThrow("Invalid test");
    expect(() => parseIntOrThrow("", "test")).toThrow("Invalid test");
  });
});

describe("confidenceLevel", () => {
  it("maps confidence to numeric level", () => {
    expect(confidenceLevel("high")).toBe(3);
    expect(confidenceLevel("med")).toBe(2);
    expect(confidenceLevel("low")).toBe(1);
  });
});

describe("severityLevel", () => {
  it("maps severity to numeric level", () => {
    expect(severityLevel("critical")).toBe(4);
    expect(severityLevel("high")).toBe(3);
    expect(severityLevel("med")).toBe(2);
    expect(severityLevel("low")).toBe(1);
  });
});

describe("scoreStatus", () => {
  it("returns PASS for scores >= 80", () => {
    expect(scoreStatus(100)).toBe("PASS");
    expect(scoreStatus(80)).toBe("PASS");
  });

  it("returns WARN for scores 50-79", () => {
    expect(scoreStatus(79)).toBe("WARN");
    expect(scoreStatus(50)).toBe("WARN");
  });

  it("returns FAIL for scores < 50", () => {
    expect(scoreStatus(49)).toBe("FAIL");
    expect(scoreStatus(0)).toBe("FAIL");
  });
});

describe("buildDetectedList", () => {
  function makeEmptyDeps(): NextDepsIndex {
    return {
      hasNextAuth: false, hasClerk: false, hasSupabase: false,
      hasKinde: false, hasWorkOS: false, hasBetterAuth: false,
      hasLucia: false, hasAuth0: false, hasIronSession: false,
      hasFirebaseAuth: false, hasPrisma: false, hasDrizzle: false,
      hasTrpc: false, hasUpstashRatelimit: false, hasArcjet: false,
      hasUnkey: false,
    };
  }

  it("always includes next-app-router", () => {
    const result = {
      detected: { deps: makeEmptyDeps(), trpc: false, middleware: false },
    } as ScanResult;
    expect(buildDetectedList(result)).toEqual(["next-app-router"]);
  });

  it("includes detected deps", () => {
    const deps = makeEmptyDeps();
    deps.hasClerk = true;
    deps.hasPrisma = true;
    const result = {
      detected: { deps, trpc: false, middleware: true },
    } as ScanResult;
    const list = buildDetectedList(result);
    expect(list).toContain("clerk");
    expect(list).toContain("prisma");
    expect(list).toContain("middleware");
  });
});
