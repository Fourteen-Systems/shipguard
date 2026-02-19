# Shipguard

Code-level operational maturity analysis for Next.js projects.

Shipguard statically analyzes your Next.js App Router codebase for missing production primitives — auth boundaries, rate limiting, and tenant scoping — and outputs a readiness score. It fails CI on regressions so you ship with confidence.

## Quick Start

```bash
npx shipguard init
```

This detects your framework, generates a config, and runs your first scan.

## Usage

```bash
# Scan and print report
shipguard

# CI mode (fail on critical findings)
shipguard ci --fail-on critical --min-confidence high

# Save baseline
shipguard baseline --write

# Waive a finding
shipguard waive RATE-LIMIT-MISSING --file app/api/foo/route.ts --reason "Handled by Cloudflare WAF"

# List rules
shipguard rules

# Explain a rule
shipguard explain AUTH-BOUNDARY-MISSING
```

## Rules (v1)

| Rule | Default Severity | What it checks |
|------|-----------------|----------------|
| AUTH-BOUNDARY-MISSING | critical | Mutation endpoints without auth |
| RATE-LIMIT-MISSING | critical | Public API routes without rate limiting |
| TENANCY-SCOPE-MISSING | critical | Prisma queries without tenant scoping |

See [PATTERNS.md](PATTERNS.md) for full detection logic and known limitations.

## Configuration

Create `shipguard.config.json` (or run `shipguard init`):

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
      "functions": ["auth", "getServerSession", "currentUser", "requireUser"],
      "middlewareFiles": ["middleware.ts"]
    },
    "rateLimit": {
      "wrappers": ["rateLimit", "withRateLimit", "limit"]
    },
    "tenancy": {
      "orgFieldNames": ["orgId", "tenantId", "workspaceId"]
    }
  },
  "waiversFile": "shipguard.waivers.json"
}
```

### Hints

Hints are how you make Shipguard accurate for your codebase. If you use a custom auth wrapper or rate limiting function, add it to hints so Shipguard recognizes it.

## GitHub Action

```yaml
- uses: shipguard/action@v1
  with:
    min-score: 70
    fail-on: critical
    min-confidence: high
```

## Confidence Levels

Every finding has a confidence level (high, med, low). In CI mode, use `--min-confidence` to control noise:

```bash
# Only fail on high-confidence criticals
shipguard ci --fail-on critical --min-confidence high
```

## License

MIT
