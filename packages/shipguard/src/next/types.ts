export type Framework = "next-app-router";

export type Severity = "low" | "med" | "high" | "critical";
export type Confidence = "low" | "med" | "high";

export type RouteKind = "route-handler" | "server-action";

export type EvidenceSource = "direct" | "wrapper" | "middleware" | "hint";

export interface ProtectionStatus {
  satisfied: boolean;
  enforced: boolean;
  sources: EvidenceSource[];
  details: string[];
  unverifiedWrappers: string[];
}

export interface ProtectionSummary {
  auth: ProtectionStatus;
  rateLimit: ProtectionStatus;
}

export interface NextRoute {
  kind: "route-handler";
  file: string;
  method?: string;
  pathname?: string;
  isApi: boolean;
  isPublic: boolean;
  signals: MutationSignals;
  protection?: ProtectionSummary;
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
  hasSupabase: boolean;
  hasKinde: boolean;
  hasWorkOS: boolean;
  hasBetterAuth: boolean;
  hasLucia: boolean;
  hasAuth0: boolean;
  hasIronSession: boolean;
  hasFirebaseAuth: boolean;
  hasUpstashRatelimit: boolean;
  hasArcjet: boolean;
  hasUnkey: boolean;
  hasPrisma: boolean;
  hasDrizzle: boolean;
  hasTrpc: boolean;
}

export interface NextHints {
  auth: { functions: string[]; middlewareFiles: string[]; allowlistPaths: string[] };
  rateLimit: { wrappers: string[]; allowlistPaths: string[] };
  tenancy: { orgFieldNames: string[] };
}

export interface TrpcProcedure {
  kind: "trpc-procedure";
  /** Dotted name, e.g. "post.add" */
  name: string;
  /** Router file where procedure is defined */
  file: string;
  line?: number;
  procedureType: "public" | "protected" | "unknown";
  procedureKind: "mutation" | "query" | "subscription" | "unknown";
  signals: MutationSignals;
  routerName?: string;
}

export interface TrpcIndex {
  detected: boolean;
  proxyFile?: string;
  rootRouterFile?: string;
  procedures: TrpcProcedure[];
  mutationProcedures: TrpcProcedure[];
}

export interface WrapperEvidence {
  authCallPresent: boolean;
  authEnforced: boolean;
  rateLimitCallPresent: boolean;
  rateLimitEnforced: boolean;
  authDetails: string[];
  rateLimitDetails: string[];
}

export interface WrapperAnalysis {
  name: string;
  definitionFile?: string;
  resolved: boolean;
  evidence: WrapperEvidence;
  usageCount: number;
  usageFiles: string[];
  mutationRouteCount: number;
}

export interface WrapperIndex {
  wrappers: Map<string, WrapperAnalysis>;
}

export interface NextIndex {
  version: 1;
  framework: Framework;
  rootDir: string;
  deps: NextDepsIndex;
  hints: NextHints;
  middleware: NextMiddlewareIndex;
  wrappers: WrapperIndex;
  routes: {
    all: NextRoute[];
    mutationRoutes: NextRoute[];
  };
  serverActions: {
    all: NextServerAction[];
    mutationActions: NextServerAction[];
  };
  trpc: TrpcIndex;
}
