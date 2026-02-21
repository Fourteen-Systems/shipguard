import type { NextIndex } from "../next/types.js";
import type { Finding, ShipguardConfig } from "../engine/types.js";
import * as authBoundary from "./auth-boundary-missing.js";
import * as rateLimit from "./rate-limit-missing.js";
import * as tenancyScope from "./tenancy-scope-missing.js";
import * as wrapperUnrecognized from "./wrapper-unrecognized.js";
import * as inputValidation from "./input-validation-missing.js";

export interface RuleMeta {
  id: string;
  name: string;
  description: string;
  defaultSeverity: string;
  docs: string;
}

export const RULE_REGISTRY: RuleMeta[] = [
  {
    id: "AUTH-BOUNDARY-MISSING",
    name: "Auth Boundary Missing",
    description: "Flags server-side mutation endpoints that lack a recognized authentication boundary.",
    defaultSeverity: "critical",
    docs: "Shipguard checks for calls to known auth functions (auth(), getServerSession(), currentUser(), etc.) in route handlers and server actions that perform database writes or Stripe operations. Configure additional auth function names in hints.auth.functions.",
  },
  {
    id: "RATE-LIMIT-MISSING",
    name: "Rate Limit Missing",
    description: "Flags public API routes without recognized rate limiting.",
    defaultSeverity: "critical",
    docs: "Shipguard checks for calls to known rate limiting wrappers (@upstash/ratelimit, rate-limiter-flexible, etc.) in API route handlers. If rate limiting is handled at the edge (Cloudflare WAF, Vercel), add a waiver. Configure custom wrappers in hints.rateLimit.wrappers.",
  },
  {
    id: "TENANCY-SCOPE-MISSING",
    name: "Tenancy Scope Missing",
    description: "Flags Prisma queries on tenant-owned models that lack tenant field in the where clause.",
    defaultSeverity: "critical",
    docs: "Shipguard checks that Prisma queries include a tenant scoping field (orgId, tenantId, workspaceId) in their where clause. Only runs when Prisma is detected and the schema contains tenant fields. Configure field names in hints.tenancy.orgFieldNames.",
  },
  {
    id: "INPUT-VALIDATION-MISSING",
    name: "Input Validation Missing",
    description: "Flags endpoints that read user input and perform writes without schema validation.",
    defaultSeverity: "high",
    docs: "Shipguard checks that endpoints reading request.json(), formData(), or req.body validate input through a schema library (zod, valibot, yup, joi) before passing data to database writes or payment operations. Only flags when both body reading and writes are detected without validation.",
  },
  {
    id: "WRAPPER-UNRECOGNIZED",
    name: "Wrapper Unrecognized",
    description: "Flags HOF wrappers that could not be analyzed for auth or rate-limit enforcement.",
    defaultSeverity: "high",
    docs: "Shipguard resolves and analyzes HOF wrapper implementations to detect auth and rate-limit enforcement. When a wrapper cannot be resolved or its enforcement cannot be verified, this rule emits a single grouped finding. Add the wrapper name to hints.auth.functions or hints.rateLimit.wrappers to suppress.",
  },
  {
    id: "PUBLIC-INTENT-MISSING-REASON",
    name: "Public Intent Missing Reason",
    description: "Flags shipguard:public-intent directives that lack a required reason string.",
    defaultSeverity: "med",
    docs: "The shipguard:public-intent directive requires a reason for auditability. Without a reason, the directive is ignored and AUTH findings are NOT suppressed. Format: // shipguard:public-intent reason=\"description\"",
  },
];

export function runAllRules(index: NextIndex, config: ShipguardConfig): Finding[] {
  const findings: Finding[] = [];

  // Only run rules that are configured (all 3 are on by default)
  if (config.rules["AUTH-BOUNDARY-MISSING"]) {
    findings.push(...authBoundary.run(index, config));
  }
  if (config.rules["RATE-LIMIT-MISSING"]) {
    findings.push(...rateLimit.run(index, config));
  }
  if (config.rules["TENANCY-SCOPE-MISSING"]) {
    findings.push(...tenancyScope.run(index, config));
  }
  if (config.rules["INPUT-VALIDATION-MISSING"]) {
    findings.push(...inputValidation.run(index, config));
  }
  // WRAPPER-UNRECOGNIZED is always enabled unless explicitly configured out
  if (config.rules["WRAPPER-UNRECOGNIZED"] !== undefined ? config.rules["WRAPPER-UNRECOGNIZED"] : true) {
    findings.push(...wrapperUnrecognized.run(index, config));
  }

  // PUBLIC-INTENT-MISSING-REASON: flag malformed directives
  for (const route of index.routes.all) {
    if (route.malformedPublicIntent) {
      findings.push({
        ruleId: "PUBLIC-INTENT-MISSING-REASON",
        severity: "med",
        confidence: "high",
        message: "shipguard:public-intent requires a reason for auditability",
        file: route.file,
        line: route.malformedPublicIntent.line,
        snippet: route.malformedPublicIntent.raw,
        evidence: [
          "Directive found without valid reason=\"...\" — treated as not public-intent",
          "AUTH findings are NOT suppressed and RL severity is NOT floored",
        ],
        confidenceRationale: "High: directive syntax is deterministic",
        remediation: [
          'Add a reason: // shipguard:public-intent reason="Public URL health checker"',
          "Without a reason, the directive is ignored for all rule behavior",
        ],
        tags: ["misconfig", "public-intent"],
      });
    }
  }

  return findings;
}
