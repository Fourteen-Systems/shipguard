# Shipguard Roadmap

**Identity: Backend production-readiness enforcement for modern TypeScript SaaS.**

## v1.0 — Next.js App Router Only

- 3 rules done extremely well:
  - AUTH-BOUNDARY-MISSING
  - RATE-LIMIT-MISSING
  - TENANCY-SCOPE-MISSING (Prisma only)
- Confidence scoring + CI gating
- Waivers + baselines
- `shipguard init` onboarding
- JSON + SARIF output
- GitHub Action

## v1.1 — Detection Hardening

Bug fixes to existing rules. No new features. No announcement.

1. **Prisma middleware cross-file detection** — `prisma.$use(...)` in a separate `prisma.ts`. Trace one level to find global tenant middleware. Reduces TENANCY-SCOPE-MISSING false positives.
2. **One-level import following for mutation signals** — `withAuth(createInvoiceHandler)` where mutations live in the imported handler. Currently a false negative. Follow one import level.
3. **Monorepo auto-detection in `init`** — Walk up/down to find nearest `package.json` with `next`. Currently requires running from the correct subdirectory.
4. **Edge rate-limit messaging** — Document in `init` output and README that Vercel/Cloudflare/API gateway rate limiting is invisible to static analysis. Waiver is the escape hatch.

## v1.2 — tRPC Support (Distribution Unlock)

The T3 stack audience (tRPC + Next.js + Prisma) is the highest-value segment. Without tRPC support, Shipguard produces **false negatives** — the proxy route has no mutations, so nothing gets flagged. The tool looks broken by being silent.

Scope:
- Detect `app/api/trpc/[trpc]/route.ts` as a tRPC proxy
- Follow import to tRPC router definition
- Treat `protectedProcedure` as auth boundary (do NOT flag for AUTH-BOUNDARY-MISSING)
- Treat `publicProcedure` as public
- Treat `.mutation()` as mutation surface
- Flag `publicProcedure.mutation()` without rate limiting

Do NOT:
- Full AST tracing across files
- Middleware chain modeling
- Procedure-level rate limit modeling
- Pages Router tRPC support

## v1.x — User-Pulled Rules

Only add rules that users explicitly request:

- WEBHOOK-SIGNATURE-NOT-VERIFIED (demand-driven, could become premium)
- ENV-VARS-NOT-VALIDATED
- AUDIT-LOG-MISSING
- SECRET-USED-IN-CLIENT

## v2 — Express/Fastify Support

New engine, not an extension. Requires:
- Route graph builder (`app.get()`, `router.post()`)
- Middleware chain modeling (`app.use()` tracing)
- Router nesting analysis

Only ship when Next.js support is dominant and paying users ask for it.

## vX — Governance Unlocks

- License-gated governance features
- Policy enforcement mode
- Waiver governance (required expiry/reason)
- Pre-audit readiness reports
- Cross-repo baselines

## Not Planned

- CVE/vulnerability scanning (use Snyk)
- Infrastructure readiness (use Cortex/OpsLevel)
- Generic rule authoring platform (use Semgrep)
- Runtime instrumentation
- React client checks (low signal, wrong audience)
- Auto-fixing (maybe "suggest patch" later)
