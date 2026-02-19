# Shipguard — Internal Strategy (North Stars)

These are locked. Reference them before any product decision.

## Positioning

- **Semgrep is a platform. Shipguard is a product.**
- We ship opinionated production-readiness standards, not a generic rule engine.
- Category: **code-level operational maturity analysis**.

## Compliance Framing

- Shipguard = **pre-audit readiness**
- Vanta/Drata = compliance systems of record
- Shipguard's job: find the stuff auditors flag before you pay compliance SaaS.

## Monetization Model

- Users buy **governance unlocks**, not npm packages.
- A license key unlocks:
  - Policy enforcement
  - Team standards
  - Waiver governance (required reason/expiry, approval flow)
  - Compliance mapping
  - Pre-audit readiness reports

## Product Language

Use these phrases verbatim:

- "Pre-audit readiness"
- "Find what auditors flag before you pay Vanta."
- "Semgrep is a platform. Shipguard is a product."
- "Linting catches bad code. Shipguard catches missing production systems."

## Anti-Drift Rules

- Do NOT build a generic rule platform.
- Do NOT compete with Snyk/SonarQube on CVE scanning.
- Do NOT build runtime instrumentation.
- Do NOT add rules without ground-truth fixtures first.
- Do NOT ship rules with >10% false positive rate on supported patterns.
