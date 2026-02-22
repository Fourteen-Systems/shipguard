import path from "node:path";
import { readFileSync } from "node:fs";
import fg from "fast-glob";
import type { NextRoute, MutationSignals, PublicIntent, MalformedPublicIntent } from "./types.js";

/**
 * Prisma write methods that indicate mutation.
 */
const PRISMA_WRITE_METHODS = [
  "create", "createMany", "createManyAndReturn",
  "update", "updateMany",
  "upsert",
  "delete", "deleteMany",
  "insert", "insertMany",  // Drizzle, Knex, MongoDB
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
 * Known non-DB objects whose .update()/.delete()/.create() are false positives.
 * Lowercase for case-insensitive matching.
 */
const NON_DB_CALLERS = new Set([
  // crypto / hashing
  "crypto", "hmac", "hash", "cipher", "decipher", "sign", "verify",
  "calculatedsignature", "signature", "digest",
  // state / UI
  "state", "setstate", "set", "ref", "context",
  // collections / cache / web APIs
  "cache", "map", "store", "headers", "params", "searchparams",
  "formdata", "cookies", "cookie", "cookiestore", "localstorage", "sessionstorage",
  // streams / events
  "socket", "stream", "emitter", "readable", "writable",
  // DOM
  "document", "element", "node",
  // React / Next
  "router", "response", "nextresponse", "summary",
]);

/**
 * Admin-like path segments that suggest privileged operations.
 */
const ADMIN_PATH_SEGMENTS = /\/(admin|billing|invite|role|plan|sync|reindex|delete|remove)\//i;

export async function findRouteHandlers(
  rootDir: string,
  excludeGlobs: string[],
  appDir: string = "app",
): Promise<NextRoute[]> {
  const files = fg.globSync(`${appDir}/**/route.{ts,js,tsx,jsx}`, {
    cwd: rootDir,
    ignore: ["**/node_modules/**", ...excludeGlobs],
  });

  const routes: NextRoute[] = [];

  for (const file of files) {
    const abs = path.join(rootDir, file);
    let src: string;
    try {
      src = readFileSync(abs, "utf8");
    } catch {
      continue; // Skip unreadable files
    }

    const signals = detectMutationSignals(src);
    const method = detectExportedMethods(src);
    const pathname = fileToPathname(file, appDir);
    const isApi = pathname.startsWith("/api/") || pathname === "/api";

    const intent = parsePublicIntent(src);
    const publicIntent = intent && "reason" in intent ? intent as PublicIntent : undefined;
    const malformedPublicIntent = intent && !("reason" in intent) ? intent as MalformedPublicIntent : undefined;

    routes.push({
      kind: "route-handler",
      file,
      method,
      pathname,
      isApi,
      isPublic: true, // conservative default; can be overridden by config
      signals,
      ...(publicIntent && { publicIntent }),
      ...(malformedPublicIntent && { malformedPublicIntent }),
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

export function detectMutationSignals(src: string): MutationSignals {
  const details: string[] = [];

  // Prisma / ORM writes
  let hasDbWrite = false;
  for (const method of PRISMA_WRITE_METHODS) {
    const pattern = new RegExp(`(\\w+)\\.${method}\\s*\\(`, "g");
    const matches = [...src.matchAll(pattern)];
    // Filter out known non-DB callers (crypto.update, cache.delete, etc.)
    const dbMatches = matches.filter((m) => !NON_DB_CALLERS.has(m[1].toLowerCase()));
    if (dbMatches.length > 0) {
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

/**
 * Parse `// prodcheck:public-intent reason="..."` directive from route source.
 * Returns valid PublicIntent, malformed indicator, or null if not present.
 */
export function parsePublicIntent(
  src: string,
): PublicIntent | MalformedPublicIntent | null {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/\/\/\s*prodcheck:public-intent\b(.*)/);
    if (!match) continue;
    const reasonMatch = match[1].match(/reason\s*=\s*["']([^"']+)["']/);
    if (reasonMatch && reasonMatch[1].trim()) {
      return { reason: reasonMatch[1].trim(), line: i + 1 };
    }
    return { line: i + 1, raw: lines[i].trim() };
  }
  return null;
}

function fileToPathname(file: string, appDir: string = "app"): string {
  // app/api/users/[id]/route.ts → /api/users/[id]
  // src/app/api/users/[id]/route.ts → /api/users/[id]
  const prefix = appDir.endsWith("/") ? appDir : appDir + "/";
  return "/" + file
    .replace(new RegExp(`^${prefix.replace(/[/]/g, "\\/")}`), "")
    .replace(/\/route\.\w+$/, "")
    .replace(/\\/g, "/");
}
