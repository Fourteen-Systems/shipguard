import { readFileSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { NextIndex } from "../next/types.js";
import type { Finding, ProdcheckConfig } from "../engine/types.js";
import type { Confidence } from "../next/types.js";

export const RULE_ID = "TENANCY-SCOPE-MISSING";

/**
 * Prisma methods that modify or read data and should be tenant-scoped.
 */
const PRISMA_SCOPED_METHODS = [
  "findUnique", "findFirst", "findMany",
  "update", "updateMany",
  "delete", "deleteMany",
  "upsert",
];

export function run(index: NextIndex, config: ProdcheckConfig): Finding[] {
  // Only run if the repo uses Prisma
  if (!index.deps.hasPrisma) return [];

  // Only run if we can confirm the repo has tenant fields
  const orgFields = config.hints.tenancy.orgFieldNames;
  if (!repoHasTenancy(index.rootDir)) return [];

  const findings: Finding[] = [];
  const severity = config.rules[RULE_ID]?.severity ?? "critical";

  // Check for Prisma middleware that enforces tenancy globally
  if (hasPrismaMiddlewareScoping(index.rootDir, orgFields)) {
    // If middleware handles it, skip — or add a low-confidence informational finding
    return [];
  }

  // Scan all files in include paths for Prisma calls
  const files = fg.globSync(config.include, {
    cwd: index.rootDir,
    ignore: ["**/node_modules/**", ...config.exclude],
  });

  for (const file of files) {
    const src = readSource(index.rootDir, file);
    if (!src) continue;

    const unscopedCalls = findUnscopedPrismaCalls(src, orgFields);
    for (const call of unscopedCalls) {
      findings.push({
        ruleId: RULE_ID,
        severity,
        confidence: call.confidence,
        confidenceRationale: call.confidenceRationale,
        message: `Prisma ${call.method}() call may lack tenant scoping`,
        file,
        line: call.line,
        snippet: call.snippet,
        evidence: call.evidence,
        remediation: [
          `Add ${orgFields[0] ?? "orgId"} to the where clause`,
          "Use a tenant-aware repository helper or Prisma extension",
          "If tenancy is enforced via Prisma middleware or RLS, add a waiver",
        ],
        tags: ["tenancy", "prisma"],
      });
    }
  }

  return findings;
}

interface UnscopedCall {
  method: string;
  line: number;
  confidence: Confidence;
  confidenceRationale: string;
  snippet: string;
  evidence: string[];
}

function findUnscopedPrismaCalls(
  src: string,
  orgFields: string[],
): UnscopedCall[] {
  const results: UnscopedCall[] = [];
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const method of PRISMA_SCOPED_METHODS) {
      const pattern = new RegExp(`\\.(${method})\\s*\\(`);
      const match = pattern.exec(line);
      if (!match) continue;

      // Look at surrounding context (current line + next 10 lines) for the where clause
      const context = lines.slice(i, Math.min(i + 15, lines.length)).join("\n");

      // Check if any org field appears in the where clause context
      const hasOrgField = orgFields.some((field) => {
        const fieldPattern = new RegExp(`\\b${field}\\b`);
        return fieldPattern.test(context);
      });

      if (hasOrgField) continue; // Scoped — skip

      // Determine confidence
      const evidence: string[] = [`prisma.*.${method}() without ${orgFields.join("/")} in where clause`];
      let confidence: Confidence;
      let confidenceRationale: string;

      if (method === "delete" || method === "deleteMany" || method === "update" || method === "updateMany") {
        confidence = "high";
        confidenceRationale = `High: ${method}() is a write operation without tenant scoping field in where clause`;
        evidence.push("write operation without tenant scoping is high risk");
      } else {
        confidence = "med";
        confidenceRationale = `Medium: ${method}() is a read without tenant scoping (could be intentional for admin views)`;
      }

      const snippet = line.trim().slice(0, 120);

      results.push({
        method,
        line: i + 1,
        confidence,
        confidenceRationale,
        snippet,
        evidence,
      });
    }
  }

  return results;
}

/**
 * Check if the Prisma schema or codebase has evidence of multi-tenancy.
 */
function repoHasTenancy(rootDir: string): boolean {
  // Check Prisma schema for tenant fields
  const schemaFiles = fg.globSync("prisma/schema.prisma", { cwd: rootDir });
  if (schemaFiles.length > 0) {
    const schema = readSource(rootDir, schemaFiles[0]);
    if (schema && /orgId|tenantId|workspaceId|organizationId/i.test(schema)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if Prisma middleware enforces tenancy globally.
 */
function hasPrismaMiddlewareScoping(rootDir: string, orgFields: string[]): boolean {
  // Look for Prisma middleware or extension files
  const candidates = fg.globSync(
    ["**/prisma/**/*.{ts,js}", "**/lib/prisma*.{ts,js}", "**/db*.{ts,js}"],
    { cwd: rootDir, ignore: ["**/node_modules/**"] },
  );

  for (const file of candidates) {
    const src = readSource(rootDir, file);
    if (!src) continue;

    // Look for $use() middleware or $extends() with query extensions
    const hasMiddleware = /\$use\s*\(/.test(src) || /\$extends\s*\(/.test(src);
    if (!hasMiddleware) continue;

    // Check if it references org fields
    const hasOrgFieldRef = orgFields.some((f) => src.includes(f));
    if (hasOrgFieldRef) return true;
  }

  return false;
}

function readSource(rootDir: string, file: string): string | null {
  try {
    return readFileSync(path.join(rootDir, file), "utf8");
  } catch {
    return null;
  }
}
