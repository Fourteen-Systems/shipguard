import path from "node:path";
import { existsSync } from "node:fs";
import type { NextIndex } from "./types.js";
import { detectNextAppRouter } from "./detect.js";
import { readDeps, defaultHintsFromDeps } from "./deps.js";
import { analyzeMiddleware } from "./middleware.js";
import { findRouteHandlers, classifyMutationRoutes } from "./routes.js";
import { findServerActions, classifyMutationActions } from "./server-actions.js";
import { buildTrpcIndex } from "./trpc.js";

export type { NextIndex } from "./types.js";
export { detectNextAppRouter } from "./detect.js";

export async function buildNextIndex(
  rootDir: string,
  exclude: string[],
): Promise<NextIndex> {
  const det = detectNextAppRouter(rootDir);
  if (!det.ok) {
    throw new Error(`Shipguard v1 supports Next.js App Router only: ${det.reason ?? "unknown reason"}`);
  }

  const { appDir } = det;
  const deps = readDeps(rootDir);

  // Check for middleware in standard locations
  const hasMiddlewareTs = existsSync(path.join(rootDir, "middleware.ts"))
    || existsSync(path.join(rootDir, "middleware.js"))
    || existsSync(path.join(rootDir, "src/middleware.ts"))
    || existsSync(path.join(rootDir, "src/middleware.js"));

  const hints = defaultHintsFromDeps(deps, hasMiddlewareTs);
  const middleware = analyzeMiddleware(rootDir);

  const allRoutes = await findRouteHandlers(rootDir, exclude, appDir);
  const mutationRoutes = classifyMutationRoutes(allRoutes);

  const allActions = await findServerActions(rootDir, exclude, appDir);
  const mutationActions = classifyMutationActions(allActions);

  const trpc = await buildTrpcIndex(rootDir, appDir, exclude);

  return {
    version: 1,
    framework: "next-app-router",
    rootDir,
    deps,
    hints,
    middleware,
    routes: { all: allRoutes, mutationRoutes },
    serverActions: { all: allActions, mutationActions: mutationActions },
    trpc,
  };
}
