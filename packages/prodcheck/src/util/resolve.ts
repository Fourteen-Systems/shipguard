import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";

export interface TsconfigPaths {
  baseUrl?: string;
  paths: Record<string, string[]>;
}

export interface ResolveOptions {
  rootDir: string;
  tsconfigPaths?: TsconfigPaths;
}

/**
 * Load tsconfig.json (with extends chain) and extract compilerOptions.paths + baseUrl.
 * Falls back to tsconfig.app.json if tsconfig.json not found.
 */
export function loadTsconfigPaths(rootDir: string): TsconfigPaths | undefined {
  const candidates = ["tsconfig.json", "tsconfig.app.json"];
  for (const name of candidates) {
    const abs = path.join(rootDir, name);
    if (existsSync(abs)) {
      return parseTsconfigChain(abs);
    }
  }
  return undefined;
}

function parseTsconfigChain(configPath: string): TsconfigPaths | undefined {
  let merged: TsconfigPaths = { paths: {} };

  // Walk extends chain (child overrides parent)
  const chain: string[] = [];
  let current = configPath;
  const visited = new Set<string>();

  while (current && !visited.has(current)) {
    visited.add(current);
    if (!existsSync(current)) break;

    let raw: Record<string, unknown>;
    try {
      const text = readFileSync(current, "utf8");
      raw = JSON.parse(stripJsonComments(text));
    } catch {
      break;
    }

    chain.unshift(current);
    const ext = raw.extends as string | undefined;
    if (ext) {
      current = resolveExtendsPath(current, ext);
    } else {
      break;
    }
  }

  // Apply in order: parent first, child overrides
  for (const file of chain) {
    let raw: Record<string, unknown>;
    try {
      const text = readFileSync(file, "utf8");
      raw = JSON.parse(stripJsonComments(text));
    } catch {
      continue;
    }

    const opts = raw.compilerOptions as Record<string, unknown> | undefined;
    if (!opts) continue;

    if (typeof opts.baseUrl === "string") {
      // baseUrl is relative to the config file
      const configDir = path.dirname(file);
      merged.baseUrl = path.relative(
        path.dirname(configPath), // relative to the original rootDir's tsconfig
        path.resolve(configDir, opts.baseUrl),
      ) || ".";
    }

    if (opts.paths && typeof opts.paths === "object") {
      merged = {
        ...merged,
        paths: { ...merged.paths, ...(opts.paths as Record<string, string[]>) },
      };
    }
  }

  if (Object.keys(merged.paths).length === 0 && !merged.baseUrl) {
    return undefined;
  }

  return merged;
}

function resolveExtendsPath(fromConfig: string, extendsValue: string): string {
  const configDir = path.dirname(fromConfig);
  if (extendsValue.startsWith(".")) {
    const resolved = path.resolve(configDir, extendsValue);
    return resolved.endsWith(".json") ? resolved : resolved + ".json";
  }
  // Package-style extends (e.g., "tsconfig/nextjs.json", "@tsconfig/next")
  // If the value already ends in .json, it's a file inside a package
  if (extendsValue.endsWith(".json")) {
    return path.resolve(configDir, "node_modules", extendsValue);
  }
  // Otherwise it's a package name — look for tsconfig.json inside it
  return path.resolve(configDir, "node_modules", extendsValue, "tsconfig.json");
}

/**
 * Strip JSONC comments (// and /* * /) while respecting string literals.
 * Also removes trailing commas before } and ] for JSON5-like tolerance.
 */
function stripJsonComments(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    // String literal — skip to end
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") {
          result += text[i] + (text[i + 1] ?? "");
          i += 2;
        } else {
          result += text[i];
          i++;
        }
      }
      if (i < text.length) {
        result += '"';
        i++;
      }
    }
    // Line comment
    else if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    }
    // Block comment
    else if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    }
    // Normal character
    else {
      result += text[i];
      i++;
    }
  }
  // Strip trailing commas
  return result.replace(/,\s*([}\]])/g, "$1");
}

/** Extensions to probe, in priority order. .d.ts is last resort. */
const PROBE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx",
  ".mts", ".cts", ".mjs", ".cjs",
];

const INDEX_NAMES = ["index"];

/**
 * Resolve an import specifier to a relative file path within rootDir.
 * Returns the relative path (e.g., "src/lib/auth.ts") or undefined if unresolvable.
 */
export function resolveImportPath(
  fromFile: string,
  importPath: string,
  opts: ResolveOptions,
): string | undefined {
  // 1. Relative imports
  if (importPath.startsWith(".")) {
    const fromDir = path.dirname(fromFile);
    const resolved = path.join(fromDir, importPath);
    return probeFile(resolved, opts.rootDir);
  }

  // 2. tsconfig paths (highest priority for non-relative)
  if (opts.tsconfigPaths) {
    const result = resolveTsconfigPath(importPath, opts.tsconfigPaths, opts.rootDir);
    if (result) return result;
  }

  // 3. ~/ and @/ convention fallback (maps to src/)
  if (importPath.startsWith("~/") || importPath.startsWith("@/")) {
    const stripped = importPath.slice(2);
    const resolved = path.join("src", stripped);
    return probeFile(resolved, opts.rootDir);
  }

  // 4. baseUrl resolution
  if (opts.tsconfigPaths?.baseUrl) {
    const resolved = path.join(opts.tsconfigPaths.baseUrl, importPath);
    return probeFile(resolved, opts.rootDir);
  }

  // Bare specifier (npm package) — can't resolve
  return undefined;
}

function resolveTsconfigPath(
  importPath: string,
  tsconfig: TsconfigPaths,
  rootDir: string,
): string | undefined {
  for (const [pattern, targets] of Object.entries(tsconfig.paths)) {
    const match = matchTsconfigPattern(importPath, pattern);
    if (match === undefined) continue;

    for (const target of targets) {
      const resolved = target.replace("*", match);
      // If baseUrl is set, resolve relative to it
      const base = tsconfig.baseUrl ?? ".";
      const full = path.join(base, resolved);
      const result = probeFile(full, rootDir);
      if (result) return result;
    }
  }
  return undefined;
}

function matchTsconfigPattern(importPath: string, pattern: string): string | undefined {
  if (pattern.includes("*")) {
    const [prefix, suffix] = pattern.split("*");
    if (importPath.startsWith(prefix) && importPath.endsWith(suffix ?? "")) {
      return importPath.slice(prefix.length, suffix ? importPath.length - suffix.length : undefined);
    }
  } else if (importPath === pattern) {
    return "";
  }
  return undefined;
}

/**
 * Probe a resolved path for actual files (with extension and index variants).
 * Returns the relative path if found, undefined otherwise.
 */
function probeFile(resolved: string, rootDir: string): string | undefined {
  // Exact match (already has extension)
  if (existsSync(path.join(rootDir, resolved)) && !isDirectory(path.join(rootDir, resolved))) {
    // Skip .d.ts unless explicitly imported
    if (resolved.endsWith(".d.ts")) return undefined;
    return resolved;
  }

  // Try extensions
  for (const ext of PROBE_EXTENSIONS) {
    const candidate = resolved + ext;
    if (existsSync(path.join(rootDir, candidate))) {
      return candidate;
    }
  }

  // Try index files (directory import)
  for (const indexName of INDEX_NAMES) {
    for (const ext of PROBE_EXTENSIONS) {
      const candidate = path.join(resolved, indexName + ext);
      if (existsSync(path.join(rootDir, candidate))) {
        return candidate;
      }
    }
  }

  return undefined;
}

function isDirectory(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Follow barrel re-exports to find the actual definition file.
 * E.g., index.ts → export { withWorkspace } from "./workspace" → workspace.ts
 *
 * Returns the final file path and source, or undefined if not found.
 * Follows up to maxHops (default 5) with cycle detection.
 */
export function followReExport(
  symbolName: string,
  startFile: string,
  opts: ResolveOptions,
  maxHops: number = 5,
): { file: string; src: string } | undefined {
  const visited = new Set<string>();
  let currentFile = startFile;

  for (let i = 0; i < maxHops; i++) {
    if (visited.has(currentFile)) return undefined; // cycle
    visited.add(currentFile);

    let src: string;
    try {
      src = readFileSync(path.join(opts.rootDir, currentFile), "utf8");
    } catch {
      return undefined;
    }

    // Check if symbol is defined here (not just re-exported)
    if (hasLocalDefinition(src, symbolName)) {
      return { file: currentFile, src };
    }

    // Check for re-export: export { symbolName } from "./other"
    const reExportMatch = src.match(
      new RegExp(
        `export\\s*\\{[^}]*\\b${escapeRegex(symbolName)}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`,
      ),
    );

    if (reExportMatch) {
      const importPath = reExportMatch[1];
      const nextFile = resolveImportPath(currentFile, importPath, opts);
      if (!nextFile) return undefined;
      currentFile = nextFile;
      continue;
    }

    // Check for: export * from "./other" (wildcard re-export)
    const starReExports = [...src.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)];
    for (const m of starReExports) {
      const nextFile = resolveImportPath(currentFile, m[1], opts);
      if (!nextFile) continue;
      try {
        const nextSrc = readFileSync(path.join(opts.rootDir, nextFile), "utf8");
        if (hasLocalDefinition(nextSrc, symbolName)) {
          return { file: nextFile, src: nextSrc };
        }
      } catch {
        continue;
      }
    }

    // No re-export found — symbol is defined here (or not found)
    return { file: currentFile, src };
  }

  return undefined;
}

function hasLocalDefinition(src: string, name: string): boolean {
  const escaped = escapeRegex(name);
  // function name(, const name =, let name =, var name =, export function name(, etc.
  return new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*[(<]|` +
    `(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*[=:]`,
    "m",
  ).test(src);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
