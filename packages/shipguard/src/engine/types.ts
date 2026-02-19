import type { Severity, Confidence } from "../next/types.js";

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

export interface Baseline {
  version: 1;
  createdAt: string;
  score: number;
  findingKeys: string[];
}

export interface ScanResult {
  version: 1;
  timestamp: string;
  framework: string;
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
    auth: { functions: string[]; middlewareFiles: string[] };
    rateLimit: { wrappers: string[] };
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
