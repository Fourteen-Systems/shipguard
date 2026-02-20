import path from "node:path";
import { readFileSync } from "node:fs";
import fg from "fast-glob";
import type { TrpcIndex, TrpcProcedure, MutationSignals } from "./types.js";
import { detectMutationSignals } from "./routes.js";
import { resolveImportPath as sharedResolveImportPath } from "../util/resolve.js";

/** Known tRPC handler markers in the proxy route file */
const TRPC_PROXY_MARKERS = [
  "fetchRequestHandler",
  "createNextApiHandler",
  "@trpc/server",
  "trpcNext",
];

/** Procedure names that indicate authenticated access */
const PROTECTED_PROCEDURE_NAMES = [
  "protectedProcedure",
  "authedProcedure",
  "adminProcedure",
  "privateProcedure",
  "authenticatedProcedure",
];

const EMPTY_INDEX: TrpcIndex = {
  detected: false,
  procedures: [],
  mutationProcedures: [],
};

export async function buildTrpcIndex(
  rootDir: string,
  appDir: string,
  _excludeGlobs: string[],
): Promise<TrpcIndex> {
  // Stage 1: Find tRPC proxy route
  const proxyFile = findTrpcProxy(rootDir, appDir);
  if (!proxyFile) return EMPTY_INDEX;

  const proxySrc = readSource(rootDir, proxyFile);
  if (!proxySrc) return EMPTY_INDEX;

  // Stage 2: Resolve root router file
  const rootRouterFile = resolveRootRouter(proxySrc, proxyFile, rootDir);
  if (!rootRouterFile) {
    return { detected: true, proxyFile, procedures: [], mutationProcedures: [] };
  }

  // Stage 3: Extract procedures from root router and sub-routers
  const procedures = extractAllProcedures(rootDir, rootRouterFile);
  const mutationProcedures = procedures.filter(
    (p) => p.procedureKind === "mutation",
  );

  return {
    detected: true,
    proxyFile,
    rootRouterFile,
    procedures,
    mutationProcedures,
  };
}

// ---------------------------------------------------------------------------
// Stage 1: Find tRPC proxy route
// ---------------------------------------------------------------------------

function findTrpcProxy(rootDir: string, appDir: string): string | undefined {
  // Look for App Router tRPC proxy: app/api/trpc/[trpc]/route.ts (or similar)
  const candidates = fg.globSync(
    `${appDir}/**/api/trpc/**/route.{ts,js,tsx,jsx}`,
    { cwd: rootDir, ignore: ["**/node_modules/**"] },
  );

  for (const file of candidates) {
    const src = readSource(rootDir, file);
    if (!src) continue;
    if (TRPC_PROXY_MARKERS.some((m) => src.includes(m))) {
      return file;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Stage 2: Resolve root router from proxy import
// ---------------------------------------------------------------------------

function resolveRootRouter(
  proxySrc: string,
  proxyFile: string,
  rootDir: string,
): string | undefined {
  // Pattern 1: import { appRouter } from '...'
  // Pattern 2: import { someRouter as appRouter } from '...'
  // Pattern 3: import appRouter from '...'
  const importPatterns = [
    /import\s+\{[^}]*appRouter[^}]*\}\s+from\s+['"]([^'"]+)['"]/,
    /import\s+\{[^}]*\w+Router[^}]*\}\s+from\s+['"]([^'"]+)['"]/,
    /import\s+(\w+Router)\s+from\s+['"]([^'"]+)['"]/,
  ];

  for (const pattern of importPatterns) {
    const match = pattern.exec(proxySrc);
    if (match) {
      // Last capture group is always the path
      const importPath = match[match.length - 1] ?? match[1];
      if (importPath) {
        const resolved = resolveImportPath(proxyFile, importPath, rootDir);
        if (resolved) return resolved;
      }
    }
  }

  // Pattern 4: router: appRouter — find the import that defines appRouter
  const routerPropMatch = /router\s*:\s*(\w+)/.exec(proxySrc);
  if (routerPropMatch) {
    const routerName = routerPropMatch[1];
    const importForRouter = new RegExp(
      `import\\s+\\{[^}]*\\b${routerName}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`,
    );
    const m = importForRouter.exec(proxySrc);
    if (m?.[1]) {
      const resolved = resolveImportPath(proxyFile, m[1], rootDir);
      if (resolved) return resolved;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Stage 3: Extract procedures from router files
// ---------------------------------------------------------------------------

function extractAllProcedures(
  rootDir: string,
  rootRouterFile: string,
): TrpcProcedure[] {
  const rootSrc = readSource(rootDir, rootRouterFile);
  if (!rootSrc) return [];

  const procedures: TrpcProcedure[] = [];

  // Extract inline procedures from root router (e.g., healthcheck: publicProcedure.query(...))
  const rootEntries = extractRouterEntries(rootSrc);

  for (const entry of rootEntries) {
    if (entry.type === "procedure") {
      procedures.push(
        buildProcedure(entry.name, entry.name, rootRouterFile, entry, rootSrc),
      );
    } else if (entry.type === "sub-router") {
      // Resolve sub-router import and extract its procedures
      const subRouterFile = resolveSubRouterImport(
        rootSrc,
        entry.importName,
        rootRouterFile,
        rootDir,
      );
      if (subRouterFile) {
        const subSrc = readSource(rootDir, subRouterFile);
        if (subSrc) {
          const subEntries = extractRouterEntries(subSrc);
          for (const sub of subEntries) {
            if (sub.type === "procedure") {
              procedures.push(
                buildProcedure(
                  `${entry.name}.${sub.name}`,
                  sub.name,
                  subRouterFile,
                  sub,
                  subSrc,
                ),
              );
            }
            // We don't follow nested sub-routers (one level only per spec)
          }
        }
      }
    }
  }

  return procedures;
}

interface RouterEntry {
  name: string;
  type: "procedure" | "sub-router";
  /** For procedures: "public" | "protected" | "unknown" */
  procedureType?: "public" | "protected" | "unknown";
  /** For procedures: "mutation" | "query" | "subscription" | "unknown" */
  procedureKind?: "mutation" | "query" | "subscription" | "unknown";
  /** Line number of the entry */
  line?: number;
  /** The full source text of this procedure definition */
  procedureSrc?: string;
  /** For sub-routers: the import identifier to resolve */
  importName: string;
}

function extractRouterEntries(src: string): RouterEntry[] {
  const entries: RouterEntry[] = [];
  const lines = src.split("\n");

  // Find the router({ ... }) block
  // Match: router({ or createTRPCRouter({
  const routerBlockStart = lines.findIndex(
    (l) => /(?:router|createTRPCRouter)\s*\(\s*\{/.test(l),
  );
  if (routerBlockStart === -1) return entries;

  // Walk through lines inside the router block looking for entries
  // Pattern: `name: someIdentifier` (sub-router) or `name: publicProcedure.query(...)` (procedure)
  let braceDepth = 0;
  let insideRouter = false;

  for (let i = routerBlockStart; i < lines.length; i++) {
    const line = lines[i];

    // Track brace depth
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }

    // Start tracking after the opening brace of router({
    if (i === routerBlockStart) {
      insideRouter = true;
      // The opening { might be on this line — it's already counted above
    }

    // Stop when we close the router block
    if (insideRouter && braceDepth <= 0) break;

    // Only look at entries at the top level of the router object (depth ~2: router({ entry: ... }))
    // Match: `identifier: something`
    const entryMatch = /^\s*(\w+)\s*:\s*(.+)/.exec(line);
    if (!entryMatch) continue;

    const name = entryMatch[1];
    const value = entryMatch[2].trim();

    // Check if it's a procedure definition
    if (isProcedureLine(value)) {
      // Gather the full procedure text (may span multiple lines until the closing)
      const procSrc = gatherProcedureSource(lines, i);

      entries.push({
        name,
        type: "procedure",
        procedureType: classifyProcedureType(procSrc),
        procedureKind: classifyProcedureKind(procSrc),
        line: i + 1,
        procedureSrc: procSrc,
        importName: name,
      });
    } else {
      // It's a sub-router reference (e.g., `post: postRouter` or `post: postRouter,`)
      const identMatch = /^(\w+)/.exec(value);
      if (identMatch) {
        entries.push({
          name,
          type: "sub-router",
          importName: identMatch[1],
          line: i + 1,
        });
      }
    }
  }

  return entries;
}

function isProcedureLine(value: string): boolean {
  // Matches: publicProcedure.query(...), protectedProcedure.input(...).mutation(...), etc.
  return /(?:public|protected|authed|admin|private|authenticated)?[Pp]rocedure\b/.test(value);
}

function gatherProcedureSource(lines: string[], startLine: number): string {
  // Collect lines from the entry start until we hit the next router entry
  // or the closing of the router block.
  // tRPC procedures are method chains that can span many lines:
  //   name: publicProcedure
  //     .input(z.object({...}))
  //     .mutation(async ({input}) => {
  //       ...
  //     }),
  const collected: string[] = [lines[startLine]];
  const entryIndent = lines[startLine].search(/\S/);

  for (let i = startLine + 1; i < lines.length && i < startLine + 100; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Stop at closing of router block
    if (trimmed.startsWith("});") || trimmed === "})") break;

    // Stop if we hit the next entry at the same indent level
    // (a line like `  nextEntry: ...` at similar indentation)
    const lineIndent = line.search(/\S/);
    if (lineIndent >= 0 && lineIndent <= entryIndent && /^\s*\w+\s*:/.test(line)) {
      break;
    }

    collected.push(line);

    // Stop after a trailing `),` at entry-level indentation (procedure chain ended)
    if (trimmed === "),") break;
  }

  return collected.join("\n");
}

function classifyProcedureType(
  src: string,
): "public" | "protected" | "unknown" {
  if (/\bpublicProcedure\b/.test(src)) return "public";
  for (const name of PROTECTED_PROCEDURE_NAMES) {
    if (src.includes(name)) return "protected";
  }
  // Bare `procedure` without prefix — could be either, mark unknown
  if (/\bprocedure\b/.test(src) && !/Procedure\b/.test(src)) return "unknown";
  return "unknown";
}

function classifyProcedureKind(
  src: string,
): "mutation" | "query" | "subscription" | "unknown" {
  if (/\.mutation\s*\(/.test(src)) return "mutation";
  if (/\.query\s*\(/.test(src)) return "query";
  if (/\.subscription\s*\(/.test(src)) return "subscription";
  return "unknown";
}

function buildProcedure(
  fullName: string,
  _localName: string,
  file: string,
  entry: RouterEntry,
  fileSrc: string,
): TrpcProcedure {
  // Detect mutation signals from the procedure's source (handler body)
  const procSrc = entry.procedureSrc ?? "";
  const signals = detectMutationSignals(procSrc);

  // If the procedure is a mutation, that's also mutation evidence
  if (entry.procedureKind === "mutation" && !signals.hasMutationEvidence) {
    signals.hasMutationEvidence = true;
    signals.mutationDetails.push("tRPC .mutation() endpoint");
  }

  return {
    kind: "trpc-procedure",
    name: fullName,
    file,
    line: entry.line,
    procedureType: entry.procedureType ?? "unknown",
    procedureKind: entry.procedureKind ?? "unknown",
    signals,
    routerName: entry.importName,
  };
}

function resolveSubRouterImport(
  routerSrc: string,
  importName: string,
  routerFile: string,
  rootDir: string,
): string | undefined {
  // Find the import statement that defines this identifier
  const importPattern = new RegExp(
    `import\\s+\\{[^}]*\\b${escapeRegex(importName)}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`,
  );
  const match = importPattern.exec(routerSrc);
  if (match?.[1]) {
    return resolveImportPath(routerFile, match[1], rootDir);
  }

  // Default import: import postRouter from './post'
  const defaultImport = new RegExp(
    `import\\s+${escapeRegex(importName)}\\s+from\\s+['"]([^'"]+)['"]`,
  );
  const m2 = defaultImport.exec(routerSrc);
  if (m2?.[1]) {
    return resolveImportPath(routerFile, m2[1], rootDir);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Import resolution (delegates to shared resolver)
// ---------------------------------------------------------------------------

function resolveImportPath(
  fromFile: string,
  importPath: string,
  rootDir: string,
): string | undefined {
  return sharedResolveImportPath(fromFile, importPath, { rootDir });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
