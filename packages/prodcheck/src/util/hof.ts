/**
 * Shared Higher-Order Function (HOF) detection utilities.
 * Used by wrapper analysis and rules.
 */

const HTTP_METHODS = "GET|POST|PUT|PATCH|DELETE";

/**
 * Extract the ordered chain of HOF wrapper names from route source.
 * E.g., `export const POST = withWorkspace(withErrorBoundary(handler))` → ["withWorkspace", "withErrorBoundary"]
 * E.g., `export default withAuth(handler)` → ["withAuth"]
 * Returns empty array if no HOF wrapper detected.
 */
export function extractHofWrapperChain(src: string): string[] {
  const chains: string[] = [];

  // Pattern 1: export const METHOD = wrapper(...)
  const constPattern = new RegExp(
    `export\\s+(?:const|let|var)\\s+(?:${HTTP_METHODS})\\s*=\\s*(.+)`,
    "gm",
  );
  for (const m of src.matchAll(constPattern)) {
    chains.push(...extractCallChain(m[1]));
  }

  // Pattern 2: export default wrapper(...)
  const defaultPattern = /export\s+default\s+([a-zA-Z_]\w*)\s*\(/gm;
  for (const m of src.matchAll(defaultPattern)) {
    // Only add if not already captured
    if (!chains.includes(m[1])) {
      chains.push(m[1]);
    }
  }

  return [...new Set(chains)];
}

/**
 * Extract function names from a call chain expression.
 * E.g., "withWorkspace(withErrorBoundary(handler))" → ["withWorkspace", "withErrorBoundary"]
 * E.g., "withAuth(async (req) => { ... })" → ["withAuth"]
 *
 * Only extracts the leading nested call chain — stops at the first
 * non-wrapper token (e.g., `async`, handler body) to avoid picking
 * up identifiers deep inside the handler.
 */
function extractCallChain(expr: string): string[] {
  const names: string[] = [];
  let pos = 0;

  while (pos < expr.length) {
    // Skip whitespace
    while (pos < expr.length && /\s/.test(expr[pos])) pos++;

    // Try to match identifier(
    const remaining = expr.slice(pos);
    const match = remaining.match(/^([a-zA-Z_]\w*)\s*\(/);
    if (!match) break;

    const name = match[1];
    if (SKIP_IDENTIFIERS.has(name)) break; // Not a wrapper, stop

    names.push(name);
    pos += match[0].length;
  }

  return names;
}

const SKIP_IDENTIFIERS = new Set([
  "async", "await", "function", "return", "new", "typeof", "void",
  "if", "else", "for", "while", "switch", "case", "try", "catch",
  "throw", "const", "let", "var", "class", "import", "export",
  "console", "Error", "Promise", "Array", "Object", "String", "Number",
  "Boolean", "JSON", "Math", "Date", "RegExp", "Map", "Set",
  "Response", "Request", "Headers", "NextResponse", "NextRequest",
]);

/**
 * Check if route source is exported via a specific known function (HOF pattern).
 * E.g., `export const POST = withAuth(handler)` with functionName="withAuth" → true
 */
export function isWrappedByFunction(src: string, functionName: string): boolean {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // export const METHOD = fn(...)
  const hofPattern = new RegExp(
    `export\\s+(?:const|let|var)\\s+(?:${HTTP_METHODS})\\s*=\\s*${escaped}\\s*\\(`,
    "m",
  );
  if (hofPattern.test(src)) return true;

  // export default fn(...)
  const defaultPattern = new RegExp(`export\\s+default\\s+${escaped}\\s*\\(`, "m");
  return defaultPattern.test(src);
}

/**
 * Find the import source for a given identifier in the source.
 * Returns the module specifier or undefined if not imported (same-file definition).
 */
export function findImportSource(src: string, identifierName: string): string | undefined {
  const escaped = identifierName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Named import: import { name } from "source" or import { other as name } from "source"
  const namedPattern = new RegExp(
    `import\\s*\\{[^}]*\\b(?:${escaped}|\\w+\\s+as\\s+${escaped})\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`,
  );
  const namedMatch = src.match(namedPattern);
  if (namedMatch) return namedMatch[1];

  // Default import: import name from "source"
  const defaultPattern = new RegExp(
    `import\\s+${escaped}\\s+from\\s*["']([^"']+)["']`,
  );
  const defaultMatch = src.match(defaultPattern);
  if (defaultMatch) return defaultMatch[1];

  // Namespace import + property access won't match here — that's fine for v1

  return undefined;
}
