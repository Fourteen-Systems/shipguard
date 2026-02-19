import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";

export interface DetectResult {
  ok: boolean;
  reason?: string;
  hasRouteHandlers: boolean;
  hasServerActions: boolean;
}

export function detectNextAppRouter(rootDir: string): DetectResult {
  const pkgPath = path.join(rootDir, "package.json");
  if (!existsSync(pkgPath)) {
    return { ok: false, reason: "package.json not found", hasRouteHandlers: false, hasServerActions: false };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (!deps["next"]) {
    return { ok: false, reason: "next dependency not found", hasRouteHandlers: false, hasServerActions: false };
  }

  const appDir = path.join(rootDir, "app");
  if (!existsSync(appDir)) {
    return { ok: false, reason: "app/ directory not found", hasRouteHandlers: false, hasServerActions: false };
  }

  // Check for route handlers
  const routeFiles = fg.globSync("app/**/route.{ts,js,tsx,jsx}", { cwd: rootDir });
  const hasRouteHandlers = routeFiles.length > 0;

  // Check for server actions ("use server" directive)
  let hasServerActions = false;
  if (!hasRouteHandlers) {
    // Only do the more expensive check if no route handlers found
    const tsFiles = fg.globSync("app/**/*.{ts,tsx,js,jsx}", { cwd: rootDir, ignore: ["**/node_modules/**"] });
    for (const f of tsFiles.slice(0, 50)) {
      const content = readFileSync(path.join(rootDir, f), "utf8");
      if (/^["']use server["']/m.test(content)) {
        hasServerActions = true;
        break;
      }
    }
  }

  if (!hasRouteHandlers && !hasServerActions) {
    return {
      ok: false,
      reason: "No route handlers or server actions found in app/",
      hasRouteHandlers: false,
      hasServerActions: false,
    };
  }

  return { ok: true, hasRouteHandlers, hasServerActions };
}
