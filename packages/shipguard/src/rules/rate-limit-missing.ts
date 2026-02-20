import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextIndex, NextRoute } from "../next/types.js";
import type { Finding, ShipguardConfig } from "../engine/types.js";
import type { Confidence } from "../next/types.js";
import { isAllowlisted } from "../util/paths.js";

export const RULE_ID = "RATE-LIMIT-MISSING";

/**
 * Paths commonly excluded from rate limiting.
 * Health checks, static assets, internal probes, cron/task routes.
 */
const EXEMPT_PATH_PATTERNS = [
  /\/health$/,
  /\/ping$/,
  /\/ready$/,
  /\/live$/,
  /\/_next\//,
  /\/cron\//,    // Cron routes are server-to-server
  /\/tasks\//,   // Task/job routes are server-to-server
];

/**
 * Webhook path patterns — rate limiting is inappropriate for inbound webhooks.
 * The calling service controls the call rate, and rejecting would miss events.
 */
const WEBHOOK_PATH_PATTERNS = [
  /\/webhooks?\//,   // /webhook/ or /webhooks/
  /\/webhooks?$/,    // /webhook or /webhooks (terminal)
];

export function run(index: NextIndex, config: ShipguardConfig): Finding[] {
  const findings: Finding[] = [];
  const maxSeverity = config.rules[RULE_ID]?.severity ?? "critical";

  for (const route of index.routes.all) {
    // Only check API routes
    if (!route.isApi) continue;

    // Skip exempt paths and user allowlisted paths
    if (isExemptPath(route.pathname)) continue;
    if (isAllowlisted(route.file, config.hints.rateLimit.allowlistPaths)) continue;

    // Skip tRPC proxy routes — rate limiting is checked at the procedure level
    if (index.trpc.detected && route.file === index.trpc.proxyFile) continue;

    const result = checkRoute(route, index, config);
    if (result) {
      findings.push({
        ruleId: RULE_ID,
        severity: capSeverity(result.severity, maxSeverity),
        confidence: result.confidence,
        message: `Public API route has no recognized rate limiting`,
        file: route.file,
        line: result.line,
        snippet: result.snippet,
        evidence: result.evidence,
        confidenceRationale: result.confidenceRationale,
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

  // Check tRPC mutation procedures (both public and protected)
  for (const proc of index.trpc.mutationProcedures) {
    if (isAllowlisted(proc.file, config.hints.rateLimit.allowlistPaths)) continue;

    // Check if the procedure's file has rate limit calls
    const src = readSource(index.rootDir, proc.file);
    if (src && hasRateLimitCall(src, config.hints.rateLimit.wrappers)) continue;

    const isProtected = proc.procedureType === "protected";
    findings.push({
      ruleId: RULE_ID,
      severity: capSeverity(isProtected ? "high" : "med", maxSeverity),
      confidence: "med",
      message: `tRPC ${proc.procedureType} mutation "${proc.name}" has no recognized rate limiting`,
      file: proc.file,
      line: proc.line,
      evidence: [
        `${proc.procedureType}Procedure.mutation() without rate limit wrapper`,
        ...(isProtected ? ["authenticated but still susceptible to abuse (cost, spam)"] : []),
      ],
      confidenceRationale: isProtected
        ? "Medium: authenticated mutation still needs rate limiting to prevent abuse"
        : "Medium: tRPC rate limiting may be handled at middleware or procedure level (not detected)",
      remediation: [
        "Add rate limiting middleware to the procedure chain",
        "If rate limiting is handled at the tRPC middleware level, add a waiver with reason",
        "If rate limiting is at the edge (Cloudflare, Vercel), add a waiver",
      ],
      tags: ["rate-limit", "trpc"],
    });
  }

  return findings;
}

import type { Severity } from "../next/types.js";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, med: 2, low: 1 };

function capSeverity(computed: Severity, max: string): Severity {
  const maxRank = SEVERITY_RANK[max] ?? 4;
  const computedRank = SEVERITY_RANK[computed] ?? 2;
  return computedRank > maxRank ? (max as Severity) : computed;
}

interface CheckResult {
  severity: Severity;
  confidence: Confidence;
  confidenceRationale: string;
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

  // Check for known rate limit wrappers (call inside handler body)
  if (hasRateLimitCall(src, config.hints.rateLimit.wrappers)) return null;

  // Check if handler is wrapped by a known rate-limit function (HOF pattern)
  if (isWrappedByKnownFunction(src, config.hints.rateLimit.wrappers)) return null;

  // Check if middleware handles rate limiting for this route
  if (index.middleware.rateLimitLikely) return null;

  // Routes with webhook signature verification don't need rate limiting
  if (hasWebhookSignatureAuth(src)) return null;
  if (isWebhookPath(route.pathname)) return null;

  // Routes with cron key auth are server-to-server (no rate limiting needed)
  if (hasCronKeyAuth(src)) return null;

  // No rate limiting found
  const evidence: string[] = [];
  evidence.push(`No rate limit wrapper calls matched: ${config.hints.rateLimit.wrappers.join(", ")}`);
  evidence.push("No middleware-level rate limiting detected");
  let severity: Severity;
  let confidence: Confidence;
  let confidenceRationale: string;

  const isMutation = route.signals.hasMutationEvidence || route.signals.hasDbWriteEvidence;

  if (isMutation) {
    severity = "critical";
    confidence = "high";
    confidenceRationale = "High: mutation route without rate limiting (higher abuse risk)";
    evidence.push("route performs mutations (higher abuse risk)");
    evidence.push(...route.signals.mutationDetails);
  } else if (hasBodyParsing(src)) {
    severity = "high";
    confidence = "high";
    confidenceRationale = "High: route reads request body without rate limiting";
    evidence.push("route reads request body");
  } else {
    severity = "med";
    confidence = "med";
    confidenceRationale = "Medium: public API route without rate limiting (GET-only, lower risk)";
    evidence.push("public API route without rate limiting");
  }

  // Downgrade if handler is exported via unknown HOF wrapper (may contain rate limiting)
  if (isWrappedByUnknownFunction(src)) {
    if (severity === "critical") severity = "high";
    if (confidence === "high") {
      confidence = "med";
      confidenceRationale = "Medium: handler is wrapped by a higher-order function (may contain rate limiting)";
    }
    evidence.push("handler exported via HOF wrapper (may contain rate limiting)");
  }

  return { severity, confidence, confidenceRationale, evidence };
}

function hasRateLimitCall(src: string, wrappers: string[]): boolean {
  for (const wrapper of wrappers) {
    const pattern = new RegExp(`\\b${escapeRegex(wrapper)}\\s*[.(]`, "m");
    if (pattern.test(src)) return true;
  }

  // Also check for common rate limit import patterns
  if (/@upstash\/ratelimit/.test(src)) return true;
  if (/rate-limiter-flexible/.test(src)) return true;
  if (/@arcjet\/next/.test(src)) return true;
  if (/@unkey\/ratelimit/.test(src)) return true;

  return false;
}

/**
 * Check if handler is wrapped by a known function (HOF pattern).
 * E.g.: export const GET = withWorkspace(async () => { ... })
 */
function isWrappedByKnownFunction(src: string, functions: string[]): boolean {
  for (const fn of functions) {
    const escaped = escapeRegex(fn);
    const hofPattern = new RegExp(
      `export\\s+(?:const|let|var)\\s+(?:GET|POST|PUT|PATCH|DELETE)\\s*=\\s*${escaped}\\s*\\(`,
      "m",
    );
    if (hofPattern.test(src)) return true;

    const defaultPattern = new RegExp(`export\\s+default\\s+${escaped}\\s*\\(`, "m");
    if (defaultPattern.test(src)) return true;
  }
  return false;
}

/**
 * Detect if handler is exported via any HOF wrapper (unknown function name).
 */
function isWrappedByUnknownFunction(src: string): boolean {
  return /export\s+(?:const|let|var)\s+(?:GET|POST|PUT|PATCH|DELETE)\s*=\s*[a-zA-Z_]\w*\s*\(/m.test(src);
}

/**
 * Webhook signature verification — these routes don't need rate limiting.
 */
function hasWebhookSignatureAuth(src: string): boolean {
  if (/stripe\.webhooks\.constructEvent\s*\(/m.test(src)) return true;
  if (/verifyQstashSignature\s*\(/m.test(src)) return true;
  if (/createHmac\s*\(/.test(src) && /signature/i.test(src)) return true;
  return false;
}

/**
 * Cron routes protected by API key are server-to-server.
 */
function hasCronKeyAuth(src: string): boolean {
  if (/process\.env\.CRON_(?:API_KEY|SECRET)/m.test(src)) return true;
  if (/verifyVercelSignature\s*\(/m.test(src)) return true;
  return false;
}

function isWebhookPath(pathname?: string): boolean {
  if (!pathname) return false;
  return WEBHOOK_PATH_PATTERNS.some((p) => p.test(pathname));
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
