import path from "node:path";
import { readFileSync } from "node:fs";
import fg from "fast-glob";
import type { NextRoute, MutationSignals } from "./types.js";

/**
 * Prisma write methods that indicate mutation.
 */
const PRISMA_WRITE_METHODS = [
  "create", "createMany", "createManyAndReturn",
  "update", "updateMany",
  "upsert",
  "delete", "deleteMany",
];

/**
 * Stripe write patterns (method chains that indicate mutation).
 */
const STRIPE_WRITE_PATTERNS = [
  /stripe\.\w+\.create\s*\(/,
  /stripe\.\w+\.update\s*\(/,
  /stripe\.\w+\.del\s*\(/,
  /stripe\.checkout\.sessions\.create\s*\(/,
  /stripe\.subscriptions\./,
];

/**
 * Admin-like path segments that suggest privileged operations.
 */
const ADMIN_PATH_SEGMENTS = /\/(admin|billing|invite|role|plan|sync|reindex|delete|remove)\//i;

export async function findRouteHandlers(
  rootDir: string,
  excludeGlobs: string[],
): Promise<NextRoute[]> {
  const files = fg.globSync("app/**/route.{ts,js,tsx,jsx}", {
    cwd: rootDir,
    ignore: ["**/node_modules/**", ...excludeGlobs],
  });

  const routes: NextRoute[] = [];

  for (const file of files) {
    const abs = path.join(rootDir, file);
    const src = readFileSync(abs, "utf8");

    const signals = detectMutationSignals(src);
    const method = detectExportedMethods(src);
    const pathname = fileToPathname(file);
    const isApi = file.startsWith("app/api/");

    routes.push({
      kind: "route-handler",
      file,
      method,
      pathname,
      isApi,
      isPublic: true, // conservative default; can be overridden by config
      signals,
    });
  }

  return routes;
}

export function classifyMutationRoutes(all: NextRoute[]): NextRoute[] {
  return all.filter(
    (r) =>
      r.signals.hasMutationEvidence ||
      r.signals.hasDbWriteEvidence ||
      r.signals.hasStripeWriteEvidence,
  );
}

function detectMutationSignals(src: string): MutationSignals {
  const details: string[] = [];

  // Prisma writes
  let hasDbWrite = false;
  for (const method of PRISMA_WRITE_METHODS) {
    const pattern = new RegExp(`\\.${method}\\s*\\(`, "g");
    if (pattern.test(src)) {
      hasDbWrite = true;
      details.push(`prisma.${method}`);
    }
  }

  // Stripe writes
  let hasStripeWrite = false;
  for (const pattern of STRIPE_WRITE_PATTERNS) {
    if (pattern.test(src)) {
      hasStripeWrite = true;
      details.push("stripe write operation");
      break;
    }
  }

  // Raw SQL writes
  const rawSqlWrite = /\$executeRaw|query\s*\(\s*["'`](?:INSERT|UPDATE|DELETE)/i.test(src);
  if (rawSqlWrite) {
    hasDbWrite = true;
    details.push("raw SQL write");
  }

  // General mutation signals: request body reading, admin path patterns
  const readBody = /request\.json\s*\(|request\.formData\s*\(|req\.body/.test(src);
  if (readBody) {
    details.push("reads request body");
  }

  const hasMutation = hasDbWrite || hasStripeWrite || readBody;

  return {
    hasMutationEvidence: hasMutation,
    hasDbWriteEvidence: hasDbWrite,
    hasStripeWriteEvidence: hasStripeWrite,
    mutationDetails: details,
  };
}

function detectExportedMethods(src: string): string | undefined {
  const methods: string[] = [];
  if (/export\s+(?:async\s+)?function\s+GET/m.test(src)) methods.push("GET");
  if (/export\s+(?:async\s+)?function\s+POST/m.test(src)) methods.push("POST");
  if (/export\s+(?:async\s+)?function\s+PUT/m.test(src)) methods.push("PUT");
  if (/export\s+(?:async\s+)?function\s+PATCH/m.test(src)) methods.push("PATCH");
  if (/export\s+(?:async\s+)?function\s+DELETE/m.test(src)) methods.push("DELETE");
  return methods.length > 0 ? methods.join(",") : undefined;
}

function fileToPathname(file: string): string {
  // app/api/users/[id]/route.ts → /api/users/[id]
  return "/" + file
    .replace(/^app\//, "")
    .replace(/\/route\.\w+$/, "")
    .replace(/\\/g, "/");
}
