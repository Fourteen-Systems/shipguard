export type Framework = "next-app-router";

export type Severity = "low" | "med" | "high" | "critical";
export type Confidence = "low" | "med" | "high";

export type RouteKind = "route-handler" | "server-action";

export interface NextRoute {
  kind: "route-handler";
  file: string;
  method?: string;
  pathname?: string;
  isApi: boolean;
  isPublic: boolean;
  signals: MutationSignals;
}

export interface NextServerAction {
  kind: "server-action";
  file: string;
  exportName?: string;
  signals: MutationSignals;
}

export interface MutationSignals {
  hasMutationEvidence: boolean;
  hasDbWriteEvidence: boolean;
  hasStripeWriteEvidence: boolean;
  mutationDetails: string[];
}

export interface NextMiddlewareIndex {
  file?: string;
  authLikely: boolean;
  rateLimitLikely: boolean;
  matcherPatterns: string[];
}

export interface NextDepsIndex {
  hasNextAuth: boolean;
  hasClerk: boolean;
  hasUpstashRatelimit: boolean;
  hasPrisma: boolean;
}

export interface NextHints {
  auth: { functions: string[]; middlewareFiles: string[] };
  rateLimit: { wrappers: string[] };
  tenancy: { orgFieldNames: string[] };
}

export interface NextIndex {
  version: 1;
  framework: Framework;
  rootDir: string;
  deps: NextDepsIndex;
  hints: NextHints;
  middleware: NextMiddlewareIndex;
  routes: {
    all: NextRoute[];
    mutationRoutes: NextRoute[];
  };
  serverActions: {
    all: NextServerAction[];
    mutationActions: NextServerAction[];
  };
}
