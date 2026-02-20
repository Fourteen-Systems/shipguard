import type { Finding, ScoringConfig, ScanResult } from "./types.js";
import type { Severity, Confidence } from "../next/types.js";

const DEFAULT_SCORING: ScoringConfig = {
  start: 100,
  penalties: { critical: 25, high: 10, med: 3, low: 1 },
};

export function computeScore(
  findings: Finding[],
  config: ScoringConfig = DEFAULT_SCORING,
): number {
  let score = config.start;

  for (const f of findings) {
    const penalty = config.penalties[f.severity] ?? 0;
    score -= penalty;
  }

  return Math.max(0, score);
}

export function summarizeFindings(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, med: 0, low: 0 };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

const VALID_CONFIDENCES = new Set<string>(["high", "med", "low"]);
const VALID_SEVERITIES = new Set<string>(["critical", "high", "med", "low"]);

export function parseConfidence(input: string): Confidence {
  if (VALID_CONFIDENCES.has(input)) return input as Confidence;
  throw new Error(`Invalid confidence level: "${input}". Valid values: high, med, low`);
}

export function parseSeverity(input: string): Severity {
  if (VALID_SEVERITIES.has(input)) return input as Severity;
  throw new Error(`Invalid severity level: "${input}". Valid values: critical, high, med, low`);
}

export function parseIntOrThrow(input: string, name: string): number {
  const n = parseInt(input, 10);
  if (isNaN(n)) throw new Error(`Invalid ${name}: "${input}" is not a number`);
  return n;
}

export function confidenceLevel(c: Confidence): number {
  switch (c) {
    case "high": return 3;
    case "med": return 2;
    case "low": return 1;
    default: return 1;
  }
}

export function severityLevel(s: Severity): number {
  switch (s) {
    case "critical": return 4;
    case "high": return 3;
    case "med": return 2;
    case "low": return 1;
    default: return 1;
  }
}

export type ScoreStatus = "PASS" | "WARN" | "FAIL";

export function scoreStatus(score: number): ScoreStatus {
  return score >= 80 ? "PASS" : score >= 50 ? "WARN" : "FAIL";
}

export function buildDetectedList(result: ScanResult): string[] {
  const detected: string[] = ["next-app-router"];
  const d = result.detected.deps;
  if (d.hasNextAuth) detected.push("next-auth");
  if (d.hasClerk) detected.push("clerk");
  if (d.hasSupabase) detected.push("supabase");
  if (d.hasKinde) detected.push("kinde");
  if (d.hasWorkOS) detected.push("workos");
  if (d.hasBetterAuth) detected.push("better-auth");
  if (d.hasLucia) detected.push("lucia");
  if (d.hasAuth0) detected.push("auth0");
  if (d.hasIronSession) detected.push("iron-session");
  if (d.hasFirebaseAuth) detected.push("firebase-auth");
  if (d.hasPrisma) detected.push("prisma");
  if (d.hasDrizzle) detected.push("drizzle");
  if (d.hasTrpc) detected.push("trpc");
  if (d.hasUpstashRatelimit) detected.push("upstash");
  if (d.hasArcjet) detected.push("arcjet");
  if (d.hasUnkey) detected.push("unkey");
  if (result.detected.middleware) detected.push("middleware");
  return detected;
}
