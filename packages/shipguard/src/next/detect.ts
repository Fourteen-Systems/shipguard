import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";

export interface DetectResult {
  ok: boolean;
  reason?: string;
  hasRouteHandlers: boolean;
  hasServerActions: boolean;
  /** Resolved app directory relative to rootDir ("app" or "src/app") */
  appDir: string;
}

const NO_DETECT: Omit<DetectResult, "ok" | "reason"> = {
  hasRouteHandlers: false,
  hasServerActions: false,
  appDir: "app",
};

export function detectNextAppRouter(rootDir: string): DetectResult {
  const pkgPath = path.join(rootDir, "package.json");
  if (!existsSync(pkgPath)) {
    return { ok: false, reason: "package.json not found", ...NO_DETECT };
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (err) {
    return { ok: false, reason: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`, ...NO_DETECT };
  }
  const deps = { ...((pkg.dependencies as Record<string, string>) ?? {}), ...((pkg.devDependencies as Record<string, string>) ?? {}) };
  if (!deps["next"]) {
    return { ok: false, reason: "next dependency not found", ...NO_DETECT };
  }

  // Support both app/ and src/app/ (both are standard Next.js conventions)
  let appDir = "app";
  if (!existsSync(path.join(rootDir, "app"))) {
    if (existsSync(path.join(rootDir, "src/app"))) {
      appDir = "src/app";
    } else {
      return { ok: false, reason: "app/ directory not found (checked app/ and src/app/)", ...NO_DETECT };
    }
  }

  // Check for route handlers
  const routeFiles = fg.globSync(`${appDir}/**/route.{ts,js,tsx,jsx}`, { cwd: rootDir });
  const hasRouteHandlers = routeFiles.length > 0;

  // Check for server actions ("use server" directive)
  let hasServerActions = false;
  const tsFiles = fg.globSync(`${appDir}/**/*.{ts,tsx,js,jsx}`, { cwd: rootDir, ignore: ["**/node_modules/**"] });
  for (const f of tsFiles.slice(0, 100)) {
    try {
      const content = readFileSync(path.join(rootDir, f), "utf8");
      if (/["']use server["']/m.test(content)) {
        hasServerActions = true;
        break;
      }
    } catch {
      // Skip unreadable files (broken symlinks, permissions, etc.)
    }
  }

  // Valid Next.js App Router project even if no route handlers or server actions
  // (e.g., a pure pages app, or a blog with no API surface — produces 0 findings)
  return { ok: true, hasRouteHandlers, hasServerActions, appDir };
}
