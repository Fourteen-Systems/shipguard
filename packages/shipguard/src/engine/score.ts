import type { Finding, ScoringConfig } from "./types.js";
import type { Severity } from "../next/types.js";

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
