import { createHash } from "node:crypto";
import type { ProdcheckConfig } from "./types.js";

export const PRODCHECK_VERSION = "0.2.7";
export const INDEX_VERSION = 1;

export function hashConfig(config: ProdcheckConfig): string {
  const normalized = JSON.stringify({
    framework: config.framework,
    include: config.include,
    exclude: config.exclude,
    hints: config.hints,
    rules: config.rules,
    scoring: config.scoring,
  });
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}
