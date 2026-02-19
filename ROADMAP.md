# Shipguard Roadmap

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

## v1.x — User-Pulled Rules

Only add rules that users explicitly request:

- ENV-VARS-NOT-VALIDATED
- WEBHOOK-SIGNATURE-NOT-VERIFIED
- AUDIT-LOG-MISSING
- SECRET-USED-IN-CLIENT

## v2 — Node/Express Support

- When it's not embarrassing.
- Express/Fastify route detection.
- Middleware pattern recognition.

## v3 — React Client Checks

- Only if high-signal.
- NO-ERROR-BOUNDARY
- CLIENT-SECRET-EXPOSURE

## vX — Governance Unlocks

- License-gated governance features.
- Policy enforcement mode.
- Waiver governance (required expiry/reason).
- Pre-audit readiness reports.
- Cross-repo baselines.

## Not Planned

- CVE/vulnerability scanning (use Snyk)
- Infrastructure readiness (use Cortex/OpsLevel)
- Generic rule authoring platform (use Semgrep)
- Runtime instrumentation
- Auto-fixing (maybe "suggest patch" later)
