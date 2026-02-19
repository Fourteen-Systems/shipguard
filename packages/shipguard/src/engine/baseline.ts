import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Baseline, Finding, ScanResult } from "./types.js";

export function findingKey(f: Finding): string {
  return `${f.ruleId}::${f.file}::${f.line ?? 0}`;
}

export function writeBaseline(rootDir: string, result: ScanResult, filePath?: string): string {
  const dest = filePath ?? path.join(rootDir, "shipguard.baseline.json");
  const baseline: Baseline = {
    version: 1,
    createdAt: new Date().toISOString(),
    score: result.score,
    findingKeys: result.findings.map(findingKey),
  };
  writeFileSync(dest, JSON.stringify(baseline, null, 2) + "\n");
  return dest;
}

export function loadBaseline(filePath: string): Baseline | undefined {
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as Baseline;
}

export interface BaselineDiff {
  newFindings: Finding[];
  resolvedKeys: string[];
  scoreDelta: number;
}

export function diffBaseline(
  baseline: Baseline,
  current: ScanResult,
): BaselineDiff {
  const currentKeys = new Set(current.findings.map(findingKey));
  const baselineKeys = new Set(baseline.findingKeys);

  const newFindings = current.findings.filter((f) => !baselineKeys.has(findingKey(f)));
  const resolvedKeys = baseline.findingKeys.filter((k) => !currentKeys.has(k));
  const scoreDelta = current.score - baseline.score;

  return { newFindings, resolvedKeys, scoreDelta };
}
