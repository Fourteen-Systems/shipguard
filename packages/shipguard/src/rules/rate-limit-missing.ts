import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextIndex, NextRoute } from "../next/types.js";
import type { Finding, ShipguardConfig } from "../engine/types.js";
import type { Confidence } from "../next/types.js";

export const RULE_ID = "RATE-LIMIT-MISSING";

/**
 * Paths commonly excluded from rate limiting.
 * Health checks, static assets, internal probes.
 */
const EXEMPT_PATH_PATTERNS = [
  /\/health$/,
  /\/ping$/,
  /\/ready$/,
  /\/live$/,
  /\/_next\//,
];

export function run(index: NextIndex, config: ShipguardConfig): Finding[] {
  const findings: Finding[] = [];
  const severity = config.rules[RULE_ID]?.severity ?? "critical";

  for (const route of index.routes.all) {
    // Only check API routes
    if (!route.isApi) continue;

    // Skip exempt paths
    if (isExemptPath(route.pathname)) continue;

    const result = checkRoute(route, index, config);
    if (result) {
      findings.push({
        ruleId: RULE_ID,
        severity,
        confidence: result.confidence,
        message: `Public API route has no recognized rate limiting`,
        file: route.file,
        line: result.line,
        snippet: result.snippet,
        evidence: result.evidence,
        remediation: [
          "Add rate limiting middleware or wrapper to this route",
          "If using @upstash/ratelimit, wrap the handler with a rate limit check",
          "If rate limiting is handled at the edge (Cloudflare, Vercel), add a waiver with reason",
          "Add custom wrapper names to hints.rateLimit.wrappers in config",
        ],
        tags: ["rate-limit", "server"],
      });
    }
  }

  return findings;
}

interface CheckResult {
  confidence: Confidence;
  line?: number;
  snippet?: string;
  evidence: string[];
}

function checkRoute(
  route: NextRoute,
  index: NextIndex,
  config: ShipguardConfig,
): CheckResult | null {
  const src = readSource(index.rootDir, route.file);
  if (!src) return null;

  // Check for known rate limit wrappers
  if (hasRateLimitCall(src, config.hints.rateLimit.wrappers)) return null;

  // Check if middleware handles rate limiting for this route
  if (index.middleware.rateLimitLikely) return null;

  // No rate limiting found
  const evidence: string[] = [];
  let confidence: Confidence;

  if (route.signals.hasMutationEvidence || route.signals.hasDbWriteEvidence) {
    // Mutation route without rate limiting = high confidence
    confidence = "high";
    evidence.push("route performs mutations (higher abuse risk)");
    evidence.push(...route.signals.mutationDetails);
  } else if (hasBodyParsing(src)) {
    // Route parses request body = high confidence (accepts input)
    confidence = "high";
    evidence.push("route reads request body");
  } else {
    // Simple GET route = medium confidence (could still be abused)
    confidence = "med";
    evidence.push("public API route without rate limiting");
  }

  return { confidence, evidence };
}

function hasRateLimitCall(src: string, wrappers: string[]): boolean {
  for (const wrapper of wrappers) {
    const pattern = new RegExp(`\\b${escapeRegex(wrapper)}\\s*[.(]`, "m");
    if (pattern.test(src)) return true;
  }

  // Also check for common rate limit import patterns
  if (/@upstash\/ratelimit/.test(src)) return true;
  if (/rate-limiter-flexible/.test(src)) return true;

  return false;
}

function hasBodyParsing(src: string): boolean {
  return /request\.json\s*\(|request\.formData\s*\(|req\.body/.test(src);
}

function isExemptPath(pathname?: string): boolean {
  if (!pathname) return false;
  return EXEMPT_PATH_PATTERNS.some((p) => p.test(pathname));
}

function readSource(rootDir: string, file: string): string | null {
  try {
    return readFileSync(path.join(rootDir, file), "utf8");
  } catch {
    return null;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
