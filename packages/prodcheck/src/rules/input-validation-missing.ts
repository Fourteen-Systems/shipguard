import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextIndex, NextRoute, NextServerAction } from "../next/types.js";
import type { Finding, ProdcheckConfig } from "../engine/types.js";
import type { Confidence, Severity } from "../next/types.js";
import { detectOutboundFetcher } from "../util/outbound-fetch.js";

export const RULE_ID = "INPUT-VALIDATION-MISSING";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, med: 2, low: 1 };

const SEVERITY_UP: Record<string, Severity> = { low: "med", med: "high", high: "high", critical: "critical" };

function bumpSeverityIfPublicIntent(severity: Severity, isPublicIntent: boolean): Severity {
  if (!isPublicIntent) return severity;
  return SEVERITY_UP[severity] ?? severity;
}

function severityFromConfidence(confidence: Confidence, maxSeverity: string): Severity {
  const max = maxSeverity as Severity;
  const maxRank = SEVERITY_RANK[max] ?? 3;
  // high confidence → use max severity (typically high)
  // med confidence → cap at med
  const computed: Severity = confidence === "high" ? max : "med";
  const computedRank = SEVERITY_RANK[computed] ?? 2;
  return computedRank > maxRank ? max : computed;
}

export function run(index: NextIndex, config: ProdcheckConfig): Finding[] {
  const findings: Finding[] = [];
  const maxSeverity = config.rules[RULE_ID]?.severity ?? "high";

  // Check mutation route handlers
  for (const route of index.routes.mutationRoutes) {
    const result = checkEndpoint(route, index);
    if (result) {
      let { confidence, confidenceRationale: rationale, evidence } = result;
      let tags = ["input-validation", "data-integrity"];

      // public-intent endpoints: bump severity (public + unvalidated = worse)
      if (route.publicIntent) {
        if (confidence === "med") confidence = "high";
        rationale += " — endpoint declared intentionally public (higher exposure)";
        evidence.push(`public-intent: "${route.publicIntent.reason}"`);
        tags = ["input-validation", "data-integrity", "public-intent"];

        // Combined SSRF note when outbound fetch detected
        let src: string | undefined;
        try { src = readFileSync(path.resolve(index.rootDir, route.file), "utf-8"); } catch {}
        if (src) {
          const fetcher = detectOutboundFetcher(src);
          if (fetcher.isRisky) {
            evidence.push("Public endpoint performs outbound fetch; missing validation increases SSRF risk");
            tags.push("ssrf-surface");
          }
        }
      }

      findings.push({
        ruleId: RULE_ID,
        severity: bumpSeverityIfPublicIntent(
          severityFromConfidence(confidence, maxSeverity),
          !!route.publicIntent,
        ),
        confidence,
        message: "Endpoint reads user input and performs writes without schema validation",
        file: route.file,
        line: result.line,
        snippet: result.snippet,
        evidence,
        confidenceRationale: rationale,
        remediation: [
          "Validate request body with a schema library before passing to DB/API calls",
          "Example: `const data = schema.parse(await request.json())`",
          "Recommended: zod, valibot, yup, or joi",
        ],
        tags,
      });
    }
  }

  // Check mutation server actions
  for (const action of index.serverActions.mutationActions) {
    const result = checkEndpoint(action, index);
    if (result) {
      findings.push({
        ruleId: RULE_ID,
        severity: severityFromConfidence(result.confidence, maxSeverity),
        confidence: result.confidence,
        message: "Server action performs writes without schema validation on input",
        file: action.file,
        line: result.line,
        snippet: result.snippet,
        evidence: result.evidence,
        confidenceRationale: result.confidenceRationale,
        remediation: [
          "Validate action input with a schema library before passing to DB/API calls",
          "Example: `const data = schema.parse(formData)`",
          "Recommended: zod, valibot, yup, or joi",
        ],
        tags: ["input-validation", "data-integrity"],
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
  confidenceRationale: string;
}

function checkEndpoint(
  endpoint: NextRoute | NextServerAction,
  index: NextIndex,
): CheckResult | null {
  let src: string;
  try {
    src = readFileSync(path.resolve(index.rootDir, endpoint.file), "utf-8");
  } catch {
    return null;
  }

  // Must read user input
  if (!readsUserInput(src)) return null;

  // Must have a write (DB or Stripe)
  if (!endpoint.signals.hasDbWriteEvidence && !endpoint.signals.hasStripeWriteEvidence) return null;

  // Check for validation patterns — if present, no finding
  // Strip comment lines to avoid false negatives from commented-out validation
  if (hasSchemaValidation(stripCommentLines(src))) return null;

  // Build evidence
  const evidence: string[] = [];

  if (readsJson(src)) evidence.push("Reads request.json() / req.json()");
  if (readsFormData(src)) evidence.push("Reads request.formData()");
  if (/req\.body/.test(src)) evidence.push("Reads req.body");

  for (const detail of endpoint.signals.mutationDetails) {
    if (detail !== "reads request body") {
      evidence.push(detail);
    }
  }

  evidence.push("No schema validation detected (z.parse, safeParse, validate, etc.)");

  // Confidence: high if clear DB write + body read + no validation
  // med if only general mutation evidence
  let confidence: Confidence = endpoint.signals.hasDbWriteEvidence ? "high" : "med";

  let rationale = confidence === "high"
    ? "Direct DB write with unvalidated user input — no schema parsing detected"
    : "Mutation endpoint with unvalidated input — no schema parsing detected";

  // Webhook-verified routes: signature verification provides some payload integrity
  // Downgrade — still flag because signatures don't validate schema structure
  if (hasWebhookSignature(src)) {
    confidence = "med";
    rationale = "Webhook signature verified but no schema validation — payload structure not enforced";
    evidence.push("webhook signature verification present (provides integrity, not schema validation)");
  }

  // Find the line of the first body read
  const line = findInputReadLine(src);

  return { confidence, line, evidence, confidenceRationale: rationale };
}

// --- Detection patterns ---

function readsUserInput(src: string): boolean {
  return readsJson(src) || readsFormData(src) || /req\.body\b/.test(src);
}

function readsJson(src: string): boolean {
  return /(?:request|req)\.json\s*\(/.test(src);
}

function readsFormData(src: string): boolean {
  return /(?:request|req)\.formData\s*\(/.test(src);
}

/**
 * Detect schema validation patterns.
 * Starts with Zod (.parse, .safeParse, z.object) and expands to common libs.
 */
function hasSchemaValidation(src: string): boolean {
  // Zod: z.object(), schema.parse(), schema.safeParse()
  if (/\bz\.\s*(?:object|string|number|array|enum|union|tuple|record|literal|nativeEnum|coerce)\s*\(/.test(src)) return true;
  // .parse() but NOT JSON.parse, URL.parse, path.parse, Date.parse, parseInt
  if (/\.parse\s*\(/.test(src) && !isOnlyBuiltinParse(src)) return true;
  if (/\.safeParse\s*\(/.test(src)) return true;

  // Valibot: v.parse(), v.safeParse(), parse(schema, ...)
  if (/\bv\.\s*(?:parse|safeParse)\s*\(/.test(src)) return true;

  // Yup: schema.validate(), schema.validateSync()
  if (/\.validate\s*\(/.test(src) && !isOnlyBuiltinValidate(src)) return true;
  if (/\.validateSync\s*\(/.test(src)) return true;

  // Joi: schema.validate()
  // (already covered by .validate above)

  // ArkType: type(...), already uses .parse
  // (covered by .parse above)

  // TypeBox + Ajv: Value.Check, ajv.validate — both use .validate
  // (covered above)

  // Next.js server action pattern: zod + useFormState
  // createSafeActionClient (next-safe-action)
  if (/createSafeActionClient|actionClient/.test(src)) return true;

  // tRPC input validation (z.object in .input())
  if (/\.input\s*\(\s*z\./.test(src)) return true;

  return false;
}

/**
 * Returns true if ALL .parse() calls in the source are from built-in objects
 * (JSON.parse, URL.parse, path.parse, Date.parse, etc.) — not schema validation.
 */
function isOnlyBuiltinParse(src: string): boolean {
  const allParseMatches = [...src.matchAll(/(\w+)\.parse\s*\(/g)];
  // No named callers found but .parse() exists → likely chained (e.g. getSchema().parse())
  // Treat as schema validation (safe default)
  if (allParseMatches.length === 0) return false;
  return allParseMatches.every((m) => BUILTIN_PARSE_CALLERS.has(m[1]));
}

const BUILTIN_PARSE_CALLERS = new Set([
  "JSON", "URL", "path", "Date", "Number", "BigInt",
  "Buffer", "querystring", "qs", "cookie", "cookieStore",
]);

/**
 * Returns true if ALL .validate() calls are from built-in/non-schema objects.
 */
function isOnlyBuiltinValidate(src: string): boolean {
  const allMatches = [...src.matchAll(/(\w+)\.validate\s*\(/g)];
  if (allMatches.length === 0) return true;
  return allMatches.every((m) => BUILTIN_VALIDATE_CALLERS.has(m[1]));
}

const BUILTIN_VALIDATE_CALLERS = new Set([
  "document", "form", "email", "url",
]);

/**
 * Remove full-line comments to avoid false negatives.
 * Only strips lines where first non-whitespace is // or lines inside block comments.
 * Deliberately simple — doesn't handle inline comments to avoid breaking strings.
 */
function stripCommentLines(src: string): string {
  let inBlock = false;
  return src.split("\n").filter((line) => {
    const trimmed = line.trimStart();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      return false;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      return false;
    }
    if (trimmed.startsWith("//")) return false;
    return true;
  }).join("\n");
}

/**
 * Detect webhook signature verification patterns.
 * Presence indicates payload integrity is verified (but not schema structure).
 */
function hasWebhookSignature(src: string): boolean {
  if (/constructEvent\s*\(/.test(src)) return true;
  if (/createHmac\s*\(/.test(src) && /signature/i.test(src)) return true;
  if (/timingSafeEqual\s*\(/.test(src)) return true;
  if (/verifySignature\s*\(/.test(src)) return true;
  if (/verifyWebhook\s*\(/i.test(src)) return true;
  if (/\.verify\s*\(/.test(src) && /webhook/i.test(src)) return true;
  return false;
}

function findInputReadLine(src: string): number | undefined {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/(?:request|req)\.json\s*\(/.test(lines[i]) ||
        /(?:request|req)\.formData\s*\(/.test(lines[i]) ||
        /req\.body\b/.test(lines[i])) {
      return i + 1;
    }
  }
  return undefined;
}
