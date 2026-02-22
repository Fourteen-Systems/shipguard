# Prodcheck

CI guardrail that blocks unprotected mutation routes in Next.js SaaS.

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
| RATE-LIMIT-MISSING | critical* | API routes without rate limiting (*auth-aware severity — see below) |
| TENANCY-SCOPE-MISSING | critical | Prisma queries without tenant scoping |
| WRAPPER-UNRECOGNIZED | high | HOF wrappers that couldn't be verified for auth/rate-limit enforcement |

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
4. **Apply**: routes using a verified wrapper are automatically cleared, no hints needed

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

### What It Skips

- Webhook routes (any path containing `webhook`) — exempt from rate-limit (still checked for signature verification)
- Cron routes (`/api/cron/*`) — exempt from rate-limit
- Framework-managed routes (NextAuth catch-all, OAuth/SAML endpoints, callbacks, OG images) — exempt from rate-limit
- `GET`-only route handlers — not mutation surfaces
- Routes covered by `middleware.ts` auth — no double-flagging
- Routes wrapped by verified HOF wrappers (`withWorkspace(handler)` where auth+RL enforcement is proven)
- Authenticated routes get lower rate-limit severity (see below)

### Auth-Aware Rate-Limit Severity

RATE-LIMIT-MISSING severity is modulated by auth status — unauthenticated endpoints are higher risk since anyone can abuse them:

| Auth status | Route type | Severity |
|-------------|-----------|----------|
| No auth | Mutation | critical |
| No auth | Body parsing | high |
| Has auth | Mutation | med |
| Has auth | Body parsing | low |

### No Auth Provider Warning

When no auth provider is detected in `package.json` and no `middleware.ts` is found, Prodcheck treats all public mutation endpoints as high risk and displays a warning in the CLI report and PR comment.

See [PATTERNS.md](PATTERNS.md) for full detection logic.

## GitHub Action

```yaml
name: Prodcheck
on: [pull_request]

permissions:
  contents: read
  pull-requests: write

jobs:
  prodcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - uses: Fourteen-Systems/prodcheck-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          min-score: 70
          fail-on: critical
          min-confidence: high
```

The action:
- Comments on PRs with score, severity breakdown, findings with human-readable messages, and collapsible evidence/remediation sections
- Adds inline annotations (error/warning/notice) on flagged files
- Shows score delta when a baseline is provided
- Warns when no auth provider is detected
- Updates the same comment on re-runs (no spam)

### Action Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `fail-on` | `critical` | Minimum severity to fail the check |
| `min-confidence` | `high` | Minimum confidence to include |
| `min-score` | `70` | Minimum passing score |
| `baseline` | — | Path to baseline file for regression detection |
| `max-new-critical` | `0` | Max new critical findings allowed |
| `max-new-high` | — | Max new high findings allowed |
| `comment` | `true` | Post a PR comment with findings |
| `annotations` | `true` | Add inline file annotations |
| `working-directory` | — | Directory to scan (for monorepos) |

### Action Outputs

| Output | Description |
|--------|-------------|
| `score` | Prodcheck score (0-100) |
| `findings` | Total number of findings |
| `result` | `PASS`, `WARN`, or `FAIL` |

## Monorepos

Prodcheck must be run from the Next.js app directory (the one with `package.json` and `app/`). In a monorepo like Turborepo or pnpm workspaces:

```bash
# CLI — cd into the app
cd apps/web && npx @fourteensystems/prodcheck scan

# GitHub Action — use working-directory
- uses: Fourteen-Systems/prodcheck-action@v1
  with:
    working-directory: apps/web
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

Most built-in patterns (Auth.js, Clerk, Supabase, Kinde, WorkOS, Lucia, Auth0, Firebase, tRPC, Upstash, Arcjet, Unkey) are detected automatically.

## Confidence Levels

Every finding has a confidence level:

- **high** — strong evidence (e.g., `publicProcedure.mutation()` with `prisma.create`)
- **med** — likely but uncertain (e.g., unrecognized procedure type)
- **low** — possible issue, may be false positive

Use `--min-confidence` in CI to control noise:

```bash
prodcheck ci --min-confidence high
```

## Scoring

Prodcheck computes a 0-100 security score. Higher is better.

Each finding deducts points based on severity **and** confidence. Base penalties are weighted by confidence (high=1.0, med=0.25, low=0.1):

| | high confidence | med confidence | low confidence |
|---|---|---|---|
| **critical** | -15 | -3.75 | -1.5 |
| **high** | -6 | -1.5 | -0.6 |
| **med** | -3 | -0.75 | -0.3 |
| **low** | -1 | -0.25 | -0.1 |

A single rule can deduct at most 35 points (preventing one noisy rule from tanking the score). This means even if you have many rate-limit findings, the score won't drop below 65 from that rule alone.

| Score | Status | Meaning |
|-------|--------|---------|
| 80-100 | PASS | Healthy — no critical gaps |
| 50-79 | WARN | Issues to address |
| 0-49 | FAIL | Critical gaps in protection |

## Compatibility

Prodcheck has no runtime dependency on Next.js, but it tracks evolving ecosystem patterns. Updates primarily add new detectors and improve confidence — not compatibility fixes.

Requires Next.js App Router (13.4+). Pages Router is not supported.

## License

MIT — see [LICENSE](LICENSE)
