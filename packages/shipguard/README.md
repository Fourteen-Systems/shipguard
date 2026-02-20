# Shipguard

CI guardrail that blocks unprotected mutation routes in Next.js SaaS.

Shipguard statically analyzes your Next.js App Router codebase and flags mutation endpoints missing auth boundaries, rate limiting, or tenant scoping. It understands your stack — Auth.js, Clerk, Supabase, tRPC, Prisma — and stays quiet when protections are in place.

## Quick Start

```bash
npx @fourteensystems/shipguard init
```

Detects your framework and dependencies, generates a config, and runs your first scan.

```
  Shipguard 0.1.0
  Detected: next-app-router · clerk · prisma · trpc · middleware
  Score: 85 PASS
```

## Usage

```bash
# Scan and print report
shipguard

# Only run specific rules
shipguard scan --only AUTH-BOUNDARY-MISSING,RATE-LIMIT-MISSING

# Exclude paths
shipguard scan --exclude "app/api/internal/**"

# JSON or SARIF output
shipguard scan --format json
shipguard scan --format sarif --output report.sarif

# CI mode (fail on critical findings)
shipguard ci --fail-on critical --min-confidence high

# Save baseline for regression detection
shipguard baseline --write

# Waive a finding
shipguard waive RATE-LIMIT-MISSING --file app/api/foo/route.ts --reason "Handled by Cloudflare WAF"

# List rules
shipguard rules

# Explain a rule
shipguard explain AUTH-BOUNDARY-MISSING
```

## What It Detects

### Rules

| Rule | Severity | What it catches |
|------|----------|----------------|
| AUTH-BOUNDARY-MISSING | critical | Mutation endpoints without auth checks |
| RATE-LIMIT-MISSING | critical | Public API routes without rate limiting |
| TENANCY-SCOPE-MISSING | critical | Prisma queries without tenant scoping |

### Stack Support

Shipguard auto-detects your stack and adjusts detection accordingly:

| Stack | What Shipguard understands |
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

- Webhook routes (`/api/webhooks/*`) — exempt from rate-limit
- Cron routes (`/api/cron/*`) — exempt from rate-limit
- `GET`-only route handlers — not mutation surfaces
- Routes covered by `middleware.ts` auth — no double-flagging
- HOF-wrapped handlers (`withAuth(handler)`) — detected as auth boundary

## GitHub Action

```yaml
name: Shipguard
on: [pull_request]

permissions:
  contents: read
  pull-requests: write

jobs:
  shipguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - uses: Fourteen-Systems/shipguard-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          min-score: 70
          fail-on: critical
          min-confidence: high
```

The action:
- Comments on PRs with findings, score, and detected stack
- Adds inline annotations on flagged files
- Shows score delta when a baseline is provided
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
| `score` | Shipguard score (0-100) |
| `findings` | Total number of findings |
| `result` | `PASS`, `WARN`, or `FAIL` |

## Configuration

Most teams do not need to configure Shipguard. Run `shipguard init` and commit the generated config.

For advanced use cases, create `shipguard.config.json`:

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

Hints tell Shipguard about your codebase-specific patterns. If you use a custom auth wrapper like `requireAuth()` or a rate limiting function like `withRateLimit()`, add it to hints so Shipguard recognizes it and doesn't flag protected routes.

Most built-in patterns (Auth.js, Clerk, Supabase, Kinde, WorkOS, Lucia, Auth0, Firebase, tRPC, Upstash, Arcjet, Unkey) are detected automatically — hints are for your custom wrappers.

## Confidence Levels

Every finding has a confidence level:

- **high** — strong evidence (e.g., `publicProcedure.mutation()` with `prisma.create`)
- **med** — likely but uncertain (e.g., unrecognized procedure type)
- **low** — possible issue, may be false positive

Use `--min-confidence` in CI to control noise:

```bash
shipguard ci --min-confidence high
```

## Compatibility

Shipguard has no runtime dependency on Next.js, but it tracks evolving ecosystem patterns. Updates primarily add new detectors and improve confidence — not compatibility fixes.

Requires Next.js App Router (13.4+). Pages Router is not supported.

## License

MIT — see [LICENSE](LICENSE)
