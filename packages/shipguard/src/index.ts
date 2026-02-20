// Public API for programmatic usage
export { runScan } from "./engine/run.js";
export { buildNextIndex } from "./next/index.js";
export { RULE_REGISTRY, runAllRules } from "./rules/index.js";
export { computeScore, confidenceLevel, severityLevel, scoreStatus, buildDetectedList, parseConfidence, parseSeverity, parseIntOrThrow } from "./engine/score.js";
export { formatPretty, formatJson } from "./engine/report.js";
export { formatSarif } from "./engine/sarif.js";
export { writeBaseline, loadBaseline, diffBaseline, type BaselineDiff } from "./engine/baseline.js";
export { loadWaivers, applyWaivers, addWaiver } from "./engine/waivers.js";
export { DEFAULT_CONFIG } from "./engine/config.js";

// Types
export type { ShipguardConfig, ScanResult, Finding, Waiver, Baseline } from "./engine/types.js";
export type { NextIndex, NextRoute, NextServerAction, Severity, Confidence } from "./next/types.js";
