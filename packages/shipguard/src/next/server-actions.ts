import path from "node:path";
import { readFileSync } from "node:fs";
import fg from "fast-glob";
import type { NextServerAction, MutationSignals } from "./types.js";

const PRISMA_WRITE_METHODS = [
  "create", "createMany", "update", "updateMany",
  "upsert", "delete", "deleteMany",
];

export async function findServerActions(
  rootDir: string,
  excludeGlobs: string[],
): Promise<NextServerAction[]> {
  const files = fg.globSync("app/**/*.{ts,tsx,js,jsx}", {
    cwd: rootDir,
    ignore: ["**/node_modules/**", "**/route.{ts,js,tsx,jsx}", ...excludeGlobs],
  });

  // Also check src/ for server actions
  const srcFiles = fg.globSync("src/**/*.{ts,tsx,js,jsx}", {
    cwd: rootDir,
    ignore: ["**/node_modules/**", ...excludeGlobs],
  });

  const allFiles = [...files, ...srcFiles];
  const actions: NextServerAction[] = [];

  for (const file of allFiles) {
    const abs = path.join(rootDir, file);
    const src = readFileSync(abs, "utf8");

    // Check for "use server" directive (file-level or inline)
    if (!/["']use server["']/m.test(src)) continue;

    const isFileLevel = /^["']use server["']/m.test(src);
    const exportNames = extractExportedFunctions(src, isFileLevel);

    for (const exportName of exportNames) {
      const signals = detectActionMutationSignals(src);
      actions.push({
        kind: "server-action",
        file,
        exportName,
        signals,
      });
    }
  }

  return actions;
}

export function classifyMutationActions(all: NextServerAction[]): NextServerAction[] {
  return all.filter(
    (a) =>
      a.signals.hasMutationEvidence ||
      a.signals.hasDbWriteEvidence ||
      a.signals.hasStripeWriteEvidence,
  );
}

function extractExportedFunctions(src: string, isFileLevel: boolean): string[] {
  const names: string[] = [];

  if (isFileLevel) {
    // All exported functions are server actions
    const exportMatches = src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g);
    for (const m of exportMatches) {
      names.push(m[1]);
    }
    // Also named exports: export const foo = async () => ...
    const constMatches = src.matchAll(/export\s+const\s+(\w+)\s*=/g);
    for (const m of constMatches) {
      names.push(m[1]);
    }
  } else {
    // Only functions after inline "use server" are actions
    // For v1, we approximate by finding async functions with "use server" inside
    const inlineMatches = src.matchAll(
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*?["']use server["']/g,
    );
    for (const m of inlineMatches) {
      names.push(m[1]);
    }
  }

  return names.length > 0 ? names : ["<anonymous>"];
}

function detectActionMutationSignals(src: string): MutationSignals {
  const details: string[] = [];

  let hasDbWrite = false;
  for (const method of PRISMA_WRITE_METHODS) {
    const pattern = new RegExp(`\\.${method}\\s*\\(`, "g");
    if (pattern.test(src)) {
      hasDbWrite = true;
      details.push(`prisma.${method}`);
    }
  }

  let hasStripeWrite = false;
  if (/stripe\.\w+\.(create|update|del)\s*\(/.test(src)) {
    hasStripeWrite = true;
    details.push("stripe write operation");
  }

  const hasMutation = hasDbWrite || hasStripeWrite;

  return {
    hasMutationEvidence: hasMutation,
    hasDbWriteEvidence: hasDbWrite,
    hasStripeWriteEvidence: hasStripeWrite,
    mutationDetails: details,
  };
}
