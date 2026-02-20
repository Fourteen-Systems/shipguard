import type { Severity, Confidence, NextDepsIndex } from "../next/types.js";

export interface Finding {
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  message: string;
  file: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  snippet?: string;
  evidence: string[];
  confidenceRationale: string;
  remediation: string[];
  tags: string[];
}

export interface Waiver {
  ruleId: string;
  file: string;
  reason: string;
  expiry?: string; // ISO date, optional in OSS, required in governance
  createdAt: string;
}

export interface WaiversFile {
  version: 1;
  waivers: Waiver[];
}

export interface Baseline {
  version: 1;
  shipguardVersion: string;
  configHash: string;
  indexVersion: number;
  createdAt: string;
  score: number;
  findingKeys: string[];
}

export interface ScanResult {
  version: 1;
  shipguardVersion: string;
  configHash: string;
  indexVersion: number;
  timestamp: string;
  framework: string;
  detected: {
    deps: NextDepsIndex;
    trpc: boolean;
    middleware: boolean;
  };
  score: number;
  findings: Finding[];
  waivedFindings: Finding[];
  summary: {
    total: number;
    critical: number;
    high: number;
    med: number;
    low: number;
    waived: number;
  };
}

export interface ScoringConfig {
  start: number;
  penalties: Record<Severity, number>;
  /** Max deduction any single rule can impose. Defaults to start * 0.4 */
  maxPenaltyPerRule?: number;
}

export interface ShipguardConfig {
  framework: "next-app-router";
  include: string[];
  exclude: string[];
  ci: {
    failOn: Severity;
    minConfidence: Confidence;
    minScore: number;
    maxNewCritical: number;
    maxNewHigh?: number;
  };
  scoring: ScoringConfig;
  hints: {
    auth: { functions: string[]; middlewareFiles: string[]; allowlistPaths: string[] };
    rateLimit: { wrappers: string[]; allowlistPaths: string[] };
    tenancy: { orgFieldNames: string[] };
  };
  rules: Record<string, { severity: Severity }>;
  waiversFile: string;
  license?: { key?: string };

  /** Reserved for governance module. Ignored by OSS core if governance not loaded. */
  governance?: {
    enabled?: boolean;
    requiredRules?: string[];
    waiver?: {
      requireReason?: boolean;
      requireExpiry?: boolean;
      maxDays?: number;
    };
    thresholds?: {
      minScore?: number;
      maxCritical?: number;
    };
    report?: {
      preAudit?: boolean;
      format?: "md" | "json" | "pdf";
      outputDir?: string;
    };
  };
}
