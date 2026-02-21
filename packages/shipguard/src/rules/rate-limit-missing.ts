import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextIndex, NextRoute } from "../next/types.js";
import type { Finding, ShipguardConfig } from "../engine/types.js";
import type { Confidence, Severity } from "../next/types.js";
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
 * Matches any path containing "webhook" (e.g., /stripe-webhook, /webhooks/stripe).
 */
const WEBHOOK_PATH_PATTERNS = [
  /webhook/i,
];

/**
 * Login/signin paths — prime brute-force targets.
 * Missing rate limiting on these is always critical.
 */
const LOGIN_PATH_PATTERNS = [
  /\/login(\/|$)/i,
  /\/signin(\/|$)/i,
  /\/sign-in(\/|$)/i,
  /\/auth\/login(\/|$)/i,
  /\/auth\/signin(\/|$)/i,
];

/**
 * Framework-managed routes where rate limiting is handled by the framework
 * or is inappropriate (auth protocol flows, external callbacks, OG images).
 */
const FRAMEWORK_MANAGED_PATTERNS = [
  /\/auth\/\[\.{3}[^\]]*\]/,  // NextAuth catch-all: auth/[...nextauth], auth/[...params]
  /\/callback\//,              // Inbound callbacks from external services (OAuth, Stripe, Slack)
  /\/callback$/,               // Terminal callback path
  /\/oauth\//,                 // OAuth protocol endpoints (token, userinfo, authorize)
  /\/saml\//,                  // SAML SSO endpoints
  /\/og\//,                    // OG image generation routes (stateless, CDN-cached)
  /\/og$/,                     // Terminal OG path
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

    // Skip framework-managed routes (NextAuth, OAuth, SAML, callbacks, OG images)
    if (isFrameworkManaged(route.pathname)) continue;

    const result = checkRoute(route, index, config);
    if (result) {
      const isAuthed = route.protection?.auth.satisfied ?? false;

      // Severity bumps for high-value targets
      let severity = result.severity;
      let { confidence, confidenceRationale } = result;

      if (isLoginPath(route.pathname)) {
        severity = "critical";
        confidence = "high";
        confidenceRationale = "High: login/signin endpoint without rate limiting — prime brute-force target";
        result.evidence.push("login/signin endpoint — brute-force risk");
      } else if (hasFormDataUpload(route, index) && !isAuthed) {
        severity = "critical";
        confidence = "high";
        confidenceRationale = "High: public file upload endpoint without rate limiting — storage abuse risk";
        result.evidence.push("public formData upload — storage abuse risk");
      }

      findings.push({
        ruleId: RULE_ID,
        severity: capSeverity(severity, maxSeverity),
        confidence,
        message: isAuthed
          ? `Authenticated API route has no recognized rate limiting`
          : `Public API route has no recognized rate limiting`,
        file: route.file,
        line: result.line,
        snippet: result.snippet,
        evidence: result.evidence,
        confidenceRationale,
        remediation: isAuthed
          ? [
              "Consider adding rate limiting as defense-in-depth",
              "Authenticated routes are lower risk but can still be abused with stolen credentials",
              "If rate limiting is at the edge (Cloudflare, Vercel WAF), add a waiver",
            ]
          : [
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
  // Use ProtectionSummary if available (computed during index building)
  if (route.protection) {
    if (route.protection.rateLimit.satisfied) return null;

    // If wrapper introspection deferred this to WRAPPER-UNRECOGNIZED, don't emit per-route finding
    if (route.protection.rateLimit.unverifiedWrappers.length > 0) return null;
  }

  const src = readSource(index.rootDir, route.file);
  if (!src) return null;

  // Routes with webhook signature verification don't need rate limiting
  if (hasWebhookSignatureAuth(src)) return null;
  if (isWebhookPath(route.pathname)) return null;

  // Routes with cron key auth are server-to-server (no rate limiting needed)
  if (hasCronKeyAuth(src)) return null;

  // Determine auth status for severity modulation
  const isAuthed = route.protection?.auth.satisfied ?? false;

  const evidence: string[] = [];
  let severity: Severity;
  let confidence: Confidence;
  let confidenceRationale: string;

  const isMutation = route.signals.hasMutationEvidence || route.signals.hasDbWriteEvidence;

  if (isMutation) {
    if (isAuthed) {
      severity = "med";
      confidence = "med";
      confidenceRationale = "Medium: authenticated mutation route — abuse requires stolen credentials";
      evidence.push("route performs mutations");
      evidence.push(...route.signals.mutationDetails);
      evidence.push("route has auth boundary — rate limiting is secondary defense");
    } else {
      severity = "critical";
      confidence = "high";
      confidenceRationale = "High: mutation route without rate limiting (higher abuse risk)";
      evidence.push("route performs mutations (higher abuse risk)");
      evidence.push(...route.signals.mutationDetails);
    }
  } else if (hasBodyParsing(src)) {
    if (isAuthed) {
      severity = "low";
      confidence = "low";
      confidenceRationale = "Low: authenticated route with body parsing — abuse requires stolen credentials";
      evidence.push("route reads request body");
      evidence.push("route has auth boundary — rate limiting is secondary defense");
    } else {
      severity = "high";
      confidence = "high";
      confidenceRationale = "High: route reads request body without rate limiting";
      evidence.push("route reads request body");
    }
  } else {
    if (isAuthed) {
      severity = "low";
      confidence = "low";
      confidenceRationale = "Low: authenticated GET-only route — rate limiting is good hygiene but low risk";
      evidence.push("route has auth boundary — rate limiting is secondary defense");
    } else {
      severity = "med";
      confidence = "med";
      confidenceRationale = "Medium: public API route without rate limiting (GET-only, lower risk)";
      evidence.push("public API route without rate limiting");
    }
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

  // Upstash-style: ratelimit.limit(identifier) in route source
  if (/(?:ratelimit|rateLimit|rl|limiter|rateLimiter)\.limit\s*\(/i.test(src)) return true;

  return false;
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

function isFrameworkManaged(pathname?: string): boolean {
  if (!pathname) return false;
  return FRAMEWORK_MANAGED_PATTERNS.some((p) => p.test(pathname));
}

function hasBodyParsing(src: string): boolean {
  return /request\.json\s*\(|request\.formData\s*\(|request\.body\b|req\.body/.test(src);
}

function isExemptPath(pathname?: string): boolean {
  if (!pathname) return false;
  return EXEMPT_PATH_PATTERNS.some((p) => p.test(pathname));
}

function isLoginPath(pathname?: string): boolean {
  if (!pathname) return false;
  return LOGIN_PATH_PATTERNS.some((p) => p.test(pathname));
}

function hasFormDataUpload(route: NextRoute, index: NextIndex): boolean {
  const src = readSource(index.rootDir, route.file);
  if (!src) return false;
  // FormData upload or raw body stream to blob/object storage
  return /request\.formData\s*\(|req\.formData\s*\(/.test(src)
    || (/request\.body\b/.test(src) && /\bput\s*\(/.test(src));
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
