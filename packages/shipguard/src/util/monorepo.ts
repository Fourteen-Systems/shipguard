import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

/**
 * Walk up from startDir to find a monorepo workspace root.
 * Returns null if no workspace root is found (i.e., not a monorepo).
 */
export function findWorkspaceRoot(startDir: string): string | null {
  let dir = path.dirname(startDir);
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    if (existsSync(path.join(dir, "turbo.json"))) return dir;
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.workspaces) return dir;
      } catch {
        // Ignore parse errors in parent package.json
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}
