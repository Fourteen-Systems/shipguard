# Prodcheck

Static analysis guardrail for Next.js SaaS — flags unprotected routes, missing rate limiting, and SSRF surfaces.

Prodcheck statically analyzes your Next.js App Router codebase and flags mutation endpoints missing auth boundaries, rate limiting, or tenant scoping. It understands your stack — Auth.js, Clerk, Supabase, tRPC, Prisma — resolves your wrapper implementations, and stays quiet when protections are in place.

Zero config for most projects. Prodcheck auto-detects your auth library, rate limiter, ORM, middleware, tsconfig path aliases, and HOF wrappers. No manual hints needed unless you're doing something exotic.

## Quick Start

```bash
npx @fourteensystems/prodcheck init
```

Detects your framework and dependencies, generates a config, and runs your first scan.

```
  Prodcheck 0.3.2
  Detected: next-app-router · next-auth · prisma · upstash-ratelimit · middleware.ts
  Score: 85 PASS
```

## Usage

```bash
# Scan and print report
prodcheck

# Only run specific rules
prodcheck scan --only AUTH-BOUNDARY-MISSING,RATE-LIMIT-MISSING

# Exclude paths
prodcheck scan --exclude "app/api/internal/**"

# JSON or SARIF output
prodcheck scan --format json
prodcheck scan --format sarif --output report.sarif

# CI mode (fail on critical findings)
prodcheck ci --fail-on critical --min-confidence high

# Save baseline for regression detection
prodcheck baseline --write

# Waive a finding
prodcheck waive RATE-LIMIT-MISSING --file app/api/foo/route.ts --reason "Handled by Cloudflare WAF"

# List rules
prodcheck rules

# Explain a rule
prodcheck explain AUTH-BOUNDARY-MISSING
```

## What It Detects

### Rules

| Rule | Severity | What it catches |
|------|----------|----------------|
| AUTH-BOUNDARY-MISSING | critical | Mutation endpoints without auth checks |
| RATE-LIMIT-MISSING | critical | Public API routes without rate limiting |
| TENANCY-SCOPE-MISSING | critical | Prisma queries without tenant scoping |
| INPUT-VALIDATION-MISSING | med | Mutation endpoints accepting input without schema validation |
| WRAPPER-UNRECOGNIZED | high | HOF wrappers that couldn't be verified for auth/rate-limit enforcement |
| PUBLIC-INTENT-MISSING-REASON | med | `prodcheck:public-intent` directives missing a required reason |

### Auth-Aware Rate Limiting

Prodcheck suppresses RATE-LIMIT-MISSING findings on routes with **strongly enforced auth** — where the auth call is proven to throw/return on failure (e.g., `if (!session) throw new Error(401)`). Routes with weak or optional auth (call present but no enforcement) are still flagged.

This means authenticated routes behind `withWorkspace()`, `protectedProcedure`, or `requireAuth()` with verified enforcement won't produce rate-limit noise. Public routes and weakly-authed routes still get full RL findings.

### `prodcheck:public-intent` Annotation

For routes that are **intentionally public** (no auth by design), add a directive:

```ts
// prodcheck:public-intent reason="Public URL health checker"
export async function GET(request: Request) { ... }
```

This tells Prodcheck:
- **AUTH-BOUNDARY-MISSING** is suppressed (auth absence is intentional)
- **RATE-LIMIT-MISSING** severity is floored at HIGH (public by design = rate limiting mandatory)
- If the route performs outbound fetch with user-influenced URLs, severity escalates to CRITICAL with `ssrf-surface` tag
- **INPUT-VALIDATION-MISSING** severity is bumped (public + unvalidated = higher exposure)

Missing or empty `reason` produces a `PUBLIC-INTENT-MISSING-REASON` finding and the directive is ignored.

### Wrapper Introspection

The dominant pattern in real-world Next.js codebases is HOF wrappers:

```ts
export const POST = withWorkspace(async (req) => {
  await prisma.user.create({ data: { name: "test" } });
  return Response.json({});
});
```

Prodcheck doesn't just detect the wrapper name — it **follows the import, reads the implementation, and verifies enforcement**:

1. **Resolve**: follows `import { withWorkspace } from "@/lib/auth"` through tsconfig path aliases (`@/lib/*` → `lib/*`), barrel re-exports (`index.ts` → `export * from "./workspace"`), up to 5 hops with cycle detection
2. **Analyze**: parses the wrapper body with TypeScript AST to find auth/rate-limit calls
3. **Verify enforcement**: checks that the call result is used in a conditional (`if (!session) throw`) — calling `getSession()` without checking the result is NOT an auth boundary
4. **Built-in patterns**: recognizes webhook signature verification (`stripe.webhooks.constructEvent`, `verifyVercelSignature`, `verifyQstashSignature`, HMAC + `timingSafeEqual`) as auth enforcement
5. **Apply**: routes using a verified wrapper are automatically cleared, no hints needed

When a wrapper can't be resolved (npm package) or enforcement can't be proven, Prodcheck emits a single grouped `WRAPPER-UNRECOGNIZED` finding instead of N identical per-route alerts.

### Stack Support

Prodcheck auto-detects your stack and adjusts detection accordingly:

| Stack | What Prodcheck understands |
|-------|---------------------------|
| **Auth.js / NextAuth** | `auth()`, `getServerSession()`, `withAuth()`, middleware auth |
| **Clerk** | `auth()`, `currentUser()`, `clerkMiddleware()` |
| **Supabase** | `.auth.getUser()`, `.auth.getSession()` (call-based, not import-based) |
| **Kinde** | `getKindeServerSession()` |
| **WorkOS / AuthKit** | `withAuth()`, `getUser()`, `authkitMiddleware()` |
| **Better Auth** | `auth()` |
| **Lucia** | `validateRequest()`, `validateSession()` |
| **Auth0** | `getSession()`, `withApiAuthRequired()` |
| **iron-session** | `getIronSession()` |
| **Firebase Auth** | `verifyIdToken()`, `getTokens()`, `verifySessionCookie()` |
| **tRPC** | `protectedProcedure` vs `publicProcedure`, `.mutation()` surfaces |
| **Prisma** | `.create()`, `.update()`, `.delete()` as mutation evidence, tenant scoping |
| **Drizzle** | Detected but gracefully degraded (tenancy rule skips) |
| **Upstash** | `Ratelimit`, `ratelimit.limit()` as rate-limit evidence |
| **Arcjet** | `fixedWindow()`, `slidingWindow()`, `tokenBucket()` |
| **Unkey** | `withUnkey()`, `verifyKey()` |
| **Zod / Valibot / Yup** | Schema validation in mutation handlers (INPUT-VALIDATION-MISSING) |
| **Webhook signatures** | Stripe, WorkOS, Vercel cron, QStash signature verification as auth |

### What It Skips

- Webhook routes (any path containing `webhook`) — exempt from rate-limit
- Cron routes (`/api/cron/*`) — exempt from rate-limit
- Framework-managed routes (NextAuth catch-all, OAuth/SAML endpoints, callbacks, OG images) — exempt from rate-limit
- OAuth/OIDC/SSO/SCIM callback paths — exempt from auth (public by protocol design)
- `GET`-only route handlers — not mutation surfaces
- Routes covered by `middleware.ts` auth — no double-flagging
- Routes wrapped by verified HOF wrappers (`withWorkspace(handler)` where auth+RL enforcement is proven)
- DB-backed token lookups with deny on failure (password reset tokens, API keys)
- Inline auth guards (`getCurrentUser()` + null check + throw/return)
- **Strongly authenticated routes** — RL findings suppressed when auth is enforced (proven throw/return on failure)
- Login/signin endpoints get critical severity for missing rate limiting (brute-force risk)
- Public file upload endpoints get critical severity for missing rate limiting (storage abuse risk)

### Rate Limit Detection

Prodcheck recognizes rate limiting through multiple patterns:

- **Package imports**: `@upstash/ratelimit`, `rate-limiter-flexible`, `@arcjet/next`, `@unkey/ratelimit`
- **Method calls**: `ratelimit.limit()`, `rl.limit()`, `limiter.limit()`, `rateLimiter.limit()`
- **General function pattern**: any function with `rateLimit`, `ratelimit`, or `rate_limit` in the name — catches `ratelimitOrThrow()`, `checkRateLimit()`, `rateLimitMiddleware()`, etc.
- **Wrapper introspection**: follows imports and verifies RL calls in wrapper bodies

See [PATTERNS.md](../../PATTERNS.md) for full detection logic.

## Scoring

Prodcheck computes a 0-100 security score. Each finding deducts points based on severity **and** confidence:

| | high confidence | med confidence | low confidence |
|---|---|---|---|
| **critical** | -15 | -3.75 | -1.5 |
| **high** | -6 | -1.5 | -0.6 |
| **med** | -3 | -0.75 | -0.3 |
| **low** | -1 | -0.25 | -0.1 |

A single rule can deduct at most 35 points (preventing one noisy rule from tanking the score).

| Score | Status | Meaning |
|-------|--------|---------|
| 80-100 | PASS | Healthy — no critical gaps |
| 50-79 | WARN | Issues to address |
| 0-49 | FAIL | Critical gaps in protection |

## Confidence Levels

Every finding has a confidence level:

- **high** — strong evidence (e.g., `publicProcedure.mutation()` with `prisma.create`)
- **med** — likely but uncertain (e.g., unrecognized procedure type)
- **low** — possible issue, may be false positive

Use `--min-confidence` in CI to control noise:

```bash
prodcheck ci --min-confidence high
```

## Monorepos

Prodcheck must be run from the Next.js app directory (the one with `package.json` and `app/`). In a monorepo like Turborepo or pnpm workspaces:

```bash
cd apps/web && npx @fourteensystems/prodcheck scan
```

Prodcheck automatically reads dependencies from both the app's `package.json` and the workspace root, and checks for `middleware.ts` at both levels. tsconfig `extends` chains (e.g., `"extends": "tsconfig/nextjs.json"`) and monorepo path aliases are resolved automatically.

## Configuration

Most teams do not need to configure Prodcheck. Run `prodcheck init` and commit the generated config.

With wrapper introspection, Prodcheck resolves and analyzes your custom wrappers automatically. Hints are only needed for edge cases where the wrapper can't be resolved (e.g., auth handled by an API gateway, rate limiting at the CDN edge).

For advanced use cases, create `prodcheck.config.json`:

```json
{
  "framework": "next-app-router",
  "include": ["app/**", "src/**"],
  "exclude": ["**/*.test.*", "**/*.spec.*"],
  "ci": {
    "failOn": "critical",
    "minConfidence": "high",
    "minScore": 70,
    "maxNewCritical": 0
  },
  "hints": {
    "auth": {
      "functions": ["auth", "getServerSession", "currentUser"],
      "middlewareFiles": ["middleware.ts"],
      "allowlistPaths": ["app/api/public/**"]
    },
    "rateLimit": {
      "wrappers": ["rateLimit", "withRateLimit"],
      "allowlistPaths": ["app/api/webhooks/**"]
    },
    "tenancy": {
      "orgFieldNames": ["orgId", "tenantId", "workspaceId"]
    }
  }
}
```

### Hints

Hints are the "hard allow" escape hatch. Add function names when Prodcheck can't verify protection automatically:

- **Wrapper introspection handles most cases** — if your wrapper calls `getSession()` and throws on failure, Prodcheck detects this without hints
- **Unresolvable wrappers** (npm packages, API gateway auth) need hints: add to `hints.auth.functions` or `hints.rateLimit.wrappers`
- **CDN/edge rate limiting** (Cloudflare, Vercel) is invisible to static analysis — use waivers or allowlist paths

## License

MIT
