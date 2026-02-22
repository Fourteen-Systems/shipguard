import type { ScanResult, Finding } from "./types.js";
import { PRODCHECK_VERSION } from "./version.js";

interface SarifLog {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: { driver: { name: string; version: string; rules: SarifRule[] } };
  results: SarifResult[];
}

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: string };
}

interface SarifResult {
  ruleId: string;
  level: string;
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: { startLine: number; startColumn?: number };
    };
  }>;
  properties?: Record<string, unknown>;
}

const SEVERITY_TO_SARIF_LEVEL: Record<string, string> = {
  critical: "error",
  high: "warning",
  med: "note",
  low: "note",
};

export function formatSarif(result: ScanResult): string {
  const ruleMap = new Map<string, SarifRule>();

  for (const f of result.findings) {
    if (!ruleMap.has(f.ruleId)) {
      ruleMap.set(f.ruleId, {
        id: f.ruleId,
        shortDescription: { text: f.message },
        defaultConfiguration: { level: SEVERITY_TO_SARIF_LEVEL[f.severity] ?? "note" },
      });
    }
  }

  const sarifResults: SarifResult[] = result.findings.map(findingToSarif);

  const log: SarifLog = {
    $schema: "https://docs.oasis-open.org/sarif/sarif/v2.1.0/cos02/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Prodcheck",
            version: PRODCHECK_VERSION,
            rules: [...ruleMap.values()],
          },
        },
        results: sarifResults,
      },
    ],
  };

  return JSON.stringify(log, null, 2);
}

function findingToSarif(f: Finding): SarifResult {
  return {
    ruleId: f.ruleId,
    level: SEVERITY_TO_SARIF_LEVEL[f.severity] ?? "note",
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.file },
          ...(f.line ? { region: { startLine: f.line, ...(f.column ? { startColumn: f.column } : {}) } } : {}),
        },
      },
    ],
    properties: {
      confidence: f.confidence,
      evidence: f.evidence,
      remediation: f.remediation,
    },
  };
}
