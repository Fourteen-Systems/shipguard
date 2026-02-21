import path from "node:path";
import { existsSync } from "node:fs";
import type { NextIndex } from "./types.js";
import { detectNextAppRouter } from "./detect.js";
import { readDeps, defaultHintsFromDeps } from "./deps.js";
import { analyzeMiddleware } from "./middleware.js";
import { findRouteHandlers, classifyMutationRoutes } from "./routes.js";
import { findServerActions, classifyMutationActions } from "./server-actions.js";
import { buildTrpcIndex } from "./trpc.js";
import { buildWrapperIndex, computeProtection } from "./wrappers.js";
import { loadTsconfigPaths } from "../util/resolve.js";

export type { NextIndex } from "./types.js";
export { detectNextAppRouter } from "./detect.js";

export async function buildNextIndex(
  rootDir: string,
  exclude: string[],
  onProgress?: (step: string) => void,
): Promise<NextIndex> {
  const progress = onProgress ?? (() => {});
  const det = detectNextAppRouter(rootDir);
  if (!det.ok) {
    throw new Error(`Shipguard v1 supports Next.js App Router only: ${det.reason ?? "unknown reason"}`);
  }

  const { appDir } = det;
  progress("Reading dependencies");
  const deps = readDeps(rootDir);

  // Check for middleware in standard locations
  const hasMiddlewareTs = existsSync(path.join(rootDir, "middleware.ts"))
    || existsSync(path.join(rootDir, "middleware.js"))
    || existsSync(path.join(rootDir, "src/middleware.ts"))
    || existsSync(path.join(rootDir, "src/middleware.js"));

  const hints = defaultHintsFromDeps(deps, hasMiddlewareTs);
  progress("Analyzing middleware");
  const middleware = analyzeMiddleware(rootDir);

  progress("Discovering routes");
  const allRoutes = await findRouteHandlers(rootDir, exclude, appDir);
  const mutationRoutes = classifyMutationRoutes(allRoutes);

  progress("Discovering server actions");
  const allActions = await findServerActions(rootDir, exclude, appDir);
  const mutationActions = classifyMutationActions(allActions);

  progress("Analyzing tRPC procedures");
  const trpc = await buildTrpcIndex(rootDir, appDir, exclude);

  // Wrapper introspection: resolve, analyze, compute protection
  progress("Resolving wrappers");
  const tsconfigPaths = loadTsconfigPaths(rootDir);
  const resolveOpts = { rootDir, tsconfigPaths };
  const wrappers = buildWrapperIndex(
    allRoutes,
    rootDir,
    resolveOpts,
    hints.auth.functions,
    hints.rateLimit.wrappers,
  );

  // Compute protection summary for each route
  for (const route of allRoutes) {
    route.protection = computeProtection(route, wrappers, middleware, hints, rootDir);
  }

  return {
    version: 1,
    framework: "next-app-router",
    rootDir,
    deps,
    hints,
    middleware,
    wrappers,
    routes: { all: allRoutes, mutationRoutes },
    serverActions: { all: allActions, mutationActions: mutationActions },
    trpc,
  };
}
