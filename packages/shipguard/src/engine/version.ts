import { createHash } from "node:crypto";
import type { ShipguardConfig } from "./types.js";

export const SHIPGUARD_VERSION = "0.2.3";
export const INDEX_VERSION = 1;

export function hashConfig(config: ShipguardConfig): string {
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
