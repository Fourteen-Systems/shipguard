import { describe, it, expect } from "vitest";
import { formatSarif } from "./sarif.js";
import { PRODCHECK_VERSION } from "./version.js";
import type { ScanResult, Finding } from "./types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "AUTH-BOUNDARY-MISSING",
    severity: "critical",
    confidence: "high",
    message: "No auth check found",
    file: "app/api/users/route.ts",
    line: 13,
    evidence: ["no auth() call"],
    confidenceRationale: "No auth function detected",
    remediation: ["Add auth() check"],
    tags: ["auth"],
    ...overrides,
  };
}

function makeScanResult(findings: Finding[]): ScanResult {
  return {
    version: 1,
    prodcheckVersion: PRODCHECK_VERSION,
    configHash: "abc123",
    indexVersion: 1,
    timestamp: "2025-01-01T00:00:00.000Z",
    framework: "next-app-router",
    detected: {
      deps: {
        hasNextAuth: false, hasClerk: true, hasSupabase: false, hasKinde: false,
        hasWorkOS: false, hasBetterAuth: false, hasLucia: false, hasAuth0: false,
        hasIronSession: false, hasFirebaseAuth: false, hasUpstashRatelimit: false,
        hasArcjet: false, hasUnkey: false, hasPrisma: true, hasDrizzle: false, hasTrpc: false,
      },
      trpc: false,
      middleware: true,
    },
    score: 75,
    findings,
    waivedFindings: [],
    summary: {
      total: findings.length,
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      med: findings.filter((f) => f.severity === "med").length,
      low: findings.filter((f) => f.severity === "low").length,
      waived: 0,
    },
  };
}

describe("formatSarif", () => {
  it("produces valid SARIF 2.1.0 structure", () => {
    const result = makeScanResult([makeFinding()]);
    const sarif = JSON.parse(formatSarif(result));
    expect(sarif.$schema).toContain("sarif-schema-2.1.0");
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs).toHaveLength(1);
  });

  it("includes tool driver info", () => {
    const result = makeScanResult([makeFinding()]);
    const sarif = JSON.parse(formatSarif(result));
    const driver = sarif.runs[0].tool.driver;
    expect(driver.name).toBe("Prodcheck");
    expect(driver.version).toBe(PRODCHECK_VERSION);
  });

  it("maps findings to results", () => {
    const findings = [
      makeFinding({ ruleId: "AUTH-BOUNDARY-MISSING", file: "app/api/users/route.ts", line: 13 }),
      makeFinding({ ruleId: "RATE-LIMIT-MISSING", severity: "high", file: "app/api/posts/route.ts", line: 5 }),
    ];
    const result = makeScanResult(findings);
    const sarif = JSON.parse(formatSarif(result));
    expect(sarif.runs[0].results).toHaveLength(2);
    expect(sarif.runs[0].results[0].ruleId).toBe("AUTH-BOUNDARY-MISSING");
    expect(sarif.runs[0].results[1].ruleId).toBe("RATE-LIMIT-MISSING");
  });

  it("deduplicates rules in driver", () => {
    const findings = [
      makeFinding({ ruleId: "AUTH-BOUNDARY-MISSING", file: "a.ts" }),
      makeFinding({ ruleId: "AUTH-BOUNDARY-MISSING", file: "b.ts" }),
      makeFinding({ ruleId: "RATE-LIMIT-MISSING", severity: "high", file: "c.ts" }),
    ];
    const result = makeScanResult(findings);
    const sarif = JSON.parse(formatSarif(result));
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(2);
  });

  it("maps critical severity to error level", () => {
    const result = makeScanResult([makeFinding({ severity: "critical" })]);
    const sarif = JSON.parse(formatSarif(result));
    expect(sarif.runs[0].results[0].level).toBe("error");
    expect(sarif.runs[0].tool.driver.rules[0].defaultConfiguration.level).toBe("error");
  });

  it("maps high severity to warning level", () => {
    const result = makeScanResult([makeFinding({ severity: "high" })]);
    const sarif = JSON.parse(formatSarif(result));
    expect(sarif.runs[0].results[0].level).toBe("warning");
  });

  it("maps med severity to note level", () => {
    const result = makeScanResult([makeFinding({ severity: "med" })]);
    const sarif = JSON.parse(formatSarif(result));
    expect(sarif.runs[0].results[0].level).toBe("note");
  });

  it("maps low severity to note level", () => {
    const result = makeScanResult([makeFinding({ severity: "low" })]);
    const sarif = JSON.parse(formatSarif(result));
    expect(sarif.runs[0].results[0].level).toBe("note");
  });

  it("includes physical location with line", () => {
    const result = makeScanResult([makeFinding({ file: "app/api/test/route.ts", line: 42 })]);
    const sarif = JSON.parse(formatSarif(result));
    const loc = sarif.runs[0].results[0].locations[0].physicalLocation;
    expect(loc.artifactLocation.uri).toBe("app/api/test/route.ts");
    expect(loc.region.startLine).toBe(42);
  });

  it("includes column when present", () => {
    const result = makeScanResult([makeFinding({ file: "a.ts", line: 10, column: 5 })]);
    const sarif = JSON.parse(formatSarif(result));
    const loc = sarif.runs[0].results[0].locations[0].physicalLocation;
    expect(loc.region.startColumn).toBe(5);
  });

  it("omits region when no line", () => {
    const result = makeScanResult([makeFinding({ file: "a.ts", line: undefined })]);
    const sarif = JSON.parse(formatSarif(result));
    const loc = sarif.runs[0].results[0].locations[0].physicalLocation;
    expect(loc.region).toBeUndefined();
  });

  it("includes properties with confidence and evidence", () => {
    const result = makeScanResult([makeFinding({ confidence: "high", evidence: ["no auth()"], remediation: ["add auth()"] })]);
    const sarif = JSON.parse(formatSarif(result));
    const props = sarif.runs[0].results[0].properties;
    expect(props.confidence).toBe("high");
    expect(props.evidence).toEqual(["no auth()"]);
    expect(props.remediation).toEqual(["add auth()"]);
  });

  it("handles empty findings", () => {
    const result = makeScanResult([]);
    const sarif = JSON.parse(formatSarif(result));
    expect(sarif.runs[0].results).toEqual([]);
    expect(sarif.runs[0].tool.driver.rules).toEqual([]);
  });

  it("returns valid JSON string", () => {
    const result = makeScanResult([makeFinding()]);
    const output = formatSarif(result);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("formats with indentation", () => {
    const result = makeScanResult([makeFinding()]);
    const output = formatSarif(result);
    expect(output).toContain("\n");
    expect(output).toContain("  ");
  });
});
