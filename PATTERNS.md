# Shipguard — Supported Patterns & Limitations

## AUTH-BOUNDARY-MISSING

### What Shipguard detects (v1)

Flags **route handlers** (`app/api/**/route.ts`) and **server actions** (files with `"use server"` or functions with inline `"use server"`) that:
1. Perform mutations (Prisma writes, Stripe calls, request body parsing)
2. Have no recognized auth boundary

Server actions are discovered by scanning `.ts`/`.tsx` files under the app directory for `"use server"` directives (file-level or inline). Both named and const-exported async functions are detected.

### Recognized auth patterns

**Hint-based (configurable via `hints.auth.functions`):**
- `auth()` (NextAuth v5 / Auth.js / Better Auth)
- `getServerSession()` (NextAuth v4)
- `getSession()` (common variant / Auth0)
- `currentUser()` (Clerk)
- `clerkClient()` (Clerk)
- `requireUser()`, `requireAuth()` (custom, commonly used)
- `withAuth()` (NextAuth v4 middleware / WorkOS AuthKit)
- `getKindeServerSession()` (Kinde)
- `validateRequest()` (Lucia)
- `getIronSession()` (iron-session)
- `withApiAuthRequired()` (Auth0)
- `verifyIdToken()` (Firebase Admin)
- `getTokens()` (next-firebase-auth-edge)
- Any function name added to `hints.auth.functions`

**Auto-detected from dependencies (merged with defaults):**
- Clerk: `currentUser`, `auth`, `clerkClient`
- NextAuth: `auth`, `getServerSession`, `withAuth`
- Kinde: `getKindeServerSession`
- WorkOS: `withAuth`, `getUser`, `authkitMiddleware`
- Better Auth: `auth`
- Lucia: `validateRequest`, `validateSession`
- Auth0: `getSession`, `withApiAuthRequired`, `withPageAuthRequired`
- iron-session: `getIronSession`
- Firebase: `verifyIdToken`, `getTokens`, `verifySessionCookie`

**Built-in patterns (always detected, not configurable):**
- Stripe webhook signature: `stripe.webhooks.constructEvent()`
- Vercel cron signature: `verifyVercelSignature()`
- QStash signature: `verifyQstashSignature()`
- HMAC webhook verification: `createHmac()` + `signature` in same file
- Cron API key: `process.env.CRON_API_KEY` / `process.env.CRON_SECRET`
- Shared secret header: `process.env.*SECRET` + `headers.get()`
- Supabase auth: `.auth.getUser()` / `.auth.getSession()` (call-based, not import-based)

**Inline auth guard detection (clears the route, no hints needed):**
- Common auth function name patterns: `get*User`, `require*Session`, `check*Auth`, `verify*Token`, `fetch*Account`, `update*Session`, etc.
- Combined with a null/falsy check within 15 lines (`if (!user)`, `if (session == null)`)
- Guard body must contain `throw`, `return`, or `redirect`
- DB-backed token lookup: Prisma queries on token/key tables (`apiToken`, `passwordResetToken`, etc.) with deny on failure (401/403 or `throw new`)
- Webhook token verification: `timingSafeEqual()` with request data and deny on failure (401/403 or `throw new`)

**Custom auth heuristic (downgrades confidence to medium):**
- Verb patterns: `verify*`, `check*`, `require*`, `validate*`, `ensure*`, `guard*`, `protect*`, `get*`, `fetch*`, `load*`, `update*`
- Combined with: `Token`, `Auth`, `Session`, `User`, `Access`, `Secret`, `Signature`, `Permission`
- Direct `Authorization` header reading

**HOF wrapper introspection (automatic, no hints needed):**
- Shipguard resolves wrapper imports (tsconfig paths, barrel re-exports, up to 5 hops)
- Parses wrapper implementation with TypeScript AST
- Detects auth function calls (`getSession()`, `auth()`, etc.) in wrapper body
- Verifies enforcement: checks that the call result is used in a conditional with throw/return/redirect
- `authCallPresent` vs `authEnforced` — calling `getSession()` for logging (without checking) is NOT an auth boundary
- Chained wrappers supported: `withWorkspace(withErrorBoundary(handler))` — if any wrapper in chain enforces auth, route passes
- Unresolvable wrappers (npm packages, failed resolution) produce a grouped WRAPPER-UNRECOGNIZED finding

**HOF wrapper detection (hint-based fallback):**
- `export const POST = withAuth(handler)` — recognized if `withAuth` is in auth hints (hard allow)
- Hints override introspection — use for wrappers that can't be resolved

**Middleware auth detection:**
- `getToken`, `auth()`, `clerkMiddleware()`, `authMiddleware()`, `withAuth()`, `getServerSession()`
- `.auth.getUser()`, `createMiddlewareClient()`
- `authkitMiddleware()` (WorkOS), `kindeMiddleware()` (Kinde)
- `withMiddlewareAuthRequired()` (Auth0), `validateRequest()` (Lucia), `getIronSession()` (iron-session)

**Supabase: auth boundary requires a check, not a client.**
- `.auth.getUser()` or `.auth.getSession()` counts as an auth boundary
- `createServerClient()` alone does NOT — creating a Supabase client without checking the session is still flagged

**tRPC procedures:**
- `protectedProcedure` (and variants: `authedProcedure`, `adminProcedure`) → recognized as auth boundary
- `publicProcedure.mutation()` → flagged as missing auth at high confidence
- Unknown procedure types → flagged at medium confidence

### Known limitations

- **Wrapper introspection resolves most cases automatically** — hints are only needed when resolution fails
- Wrappers from npm packages (bare specifiers) cannot be resolved — add to hints or use waivers
- Auth enforced via API gateway or reverse proxy is not detectable — use waivers
- OAuth/OIDC/SSO/SCIM callback paths are fully exempt (public by protocol design)
- Inline `if (!session)` checks are now detected when combined with common auth function names
- tRPC middleware chain auth is not modeled — use `protectedProcedure` or add a waiver
- Wrapper enforcement detection uses heuristics (checking for `if (!session) throw/return`) — unusual enforcement patterns (e.g., middleware-style `next()` delegation) may not be recognized

---

## RATE-LIMIT-MISSING

### What Shipguard detects (v1)

Flags API route handlers under `app/api/` and tRPC mutation procedures that have no recognized rate limiting. Routes with strongly enforced auth (proven throw/return on failure) are suppressed — only public and weakly-authed routes are flagged.

### Recognized rate limit patterns

**Direct detection (in route file):**
- `@upstash/ratelimit` (import detection)
- `rate-limiter-flexible` (import detection)
- `@arcjet/next` (import detection)
- `@unkey/ratelimit` (import detection)
- Any wrapper name in `hints.rateLimit.wrappers` (call detection)
- `ratelimit.limit()`, `rl.limit()`, `limiter.limit()` (Upstash-style method calls)
- General function name pattern: any function with `rateLimit`, `ratelimit`, or `rate_limit` in the name — catches `ratelimitOrThrow()`, `checkRateLimit()`, `rateLimitMiddleware()`, etc.
- Middleware-level rate limiting (heuristic on middleware.ts content)

**Wrapper introspection (automatic):**
- HOF wrapper imports resolved via tsconfig paths and barrel re-exports
- Wrapper body analyzed for rate-limit calls (`rateLimit()`, `ratelimit.limit()`, `aj.protect()`)
- Enforcement verified: checks for `if (!success)` or destructured `{ success }` with throw/return 429
- Known RL package imports (`@upstash/ratelimit`, `@arcjet/next`, `@unkey/ratelimit`) detected at file level
- General function name pattern also applied inside wrapper bodies

**Auto-detected from dependencies:**
- Upstash: `Ratelimit`, `ratelimit`
- Arcjet: `aj.protect`, `fixedWindow`, `slidingWindow`, `tokenBucket`
- Unkey: `withUnkey`, `verifyKey`

### Auth-aware suppression

Routes with **strongly enforced auth** are fully suppressed from RATE-LIMIT-MISSING. "Strongly enforced" means `auth.satisfied && auth.enforced` — the auth call is proven to throw or return on failure (e.g., `if (!session) throw new Error(401)`).

Routes with weak or optional auth (call present but no proven enforcement) are treated as unauthenticated and still flagged.

| Auth status | Route type | Severity | Confidence |
|-------------|-----------|----------|------------|
| No auth / weak auth | Mutation | **critical** | high |
| No auth / weak auth | Body parsing | **high** | high |
| No auth / weak auth | GET-only | **med** | med |
| **Strong auth** | **Any** | **suppressed** | — |
| Any | Login/signin path | **critical** | high |
| No auth | File upload (formData/body+put) | **critical** | high |

### `shipguard:public-intent` interaction

Routes annotated with `// shipguard:public-intent reason="..."`:
- RL severity is **floored at HIGH** (public by design = rate limiting mandatory)
- If the route performs outbound fetch with user-influenced URLs, severity escalates to **CRITICAL** with `ssrf-surface` and `outbound-fetch` tags
- Evidence includes the developer's stated reason
- Hardcoded fetch URLs (e.g., `fetch("https://api.example.com/health")`) do NOT trigger SSRF escalation

### Automatic exemptions

**Infrastructure routes:**
- Health/readiness: `/health`, `/ping`, `/ready`, `/live`
- Internal: `/_next/`
- Server-to-server: `/cron/`, `/tasks/`

**Webhook routes:**
- Any path containing `webhook` (e.g., `/webhook`, `/webhooks/stripe`, `/billing/stripe-webhook`)
- Stripe/HMAC/QStash signature verification (code-based)
- Cron routes with `process.env.CRON_API_KEY` / `verifyVercelSignature()`

**Framework-managed routes:**
- NextAuth catch-all: `/api/auth/[...nextauth]`, `/api/auth/[...params]`
- OAuth protocol endpoints: `/api/oauth/*` (token, userinfo, authorize)
- SAML SSO endpoints: `/api/*/saml/*`
- External callbacks: `/api/callback/*`, `/api/*/callback/*` (OAuth, Stripe, Slack)
- OG image generation: `/api/og/*` (stateless, typically CDN-cached)
- tRPC proxy routes (rate limiting checked at procedure level instead)

### tRPC rate limiting

- `publicProcedure.mutation()` without rate limiting → flagged at medium confidence
- `protectedProcedure` mutations without rate limiting → flagged at lower severity (authenticated users can still abuse cost/spam)
- tRPC middleware-level rate limiting is not modeled — use waivers if handled there

### Known limitations

- Edge/CDN rate limiting (Cloudflare, Vercel) is invisible to static analysis — use waivers
- Wrapper introspection resolves most wrapper-based rate limiting automatically
- Wrappers from npm packages that can't be resolved need hints or waivers

---

## WRAPPER-UNRECOGNIZED

### What Shipguard detects (v1)

Emits a single grouped finding per HOF wrapper that could not be fully verified for auth or rate-limit enforcement. This replaces what would otherwise be N identical per-route findings.

### When this rule fires

A wrapper triggers this rule when **any** of these conditions hold:
- **Unresolved**: the wrapper's import couldn't be followed (npm package, broken path)
- **Resolved, auth not enforced**: wrapper calls an auth function but doesn't check the result (e.g., `getSession()` for logging only)
- **Resolved, RL not enforced**: wrapper calls a rate-limit function but doesn't branch on the result
- **Resolved, no evidence**: wrapper is a utility (logging, error boundary) that doesn't perform auth or rate limiting

### What the finding includes

- **`wouldHaveTriggered`**: which rules this wrapper suppressed (AUTH-BOUNDARY-MISSING, RATE-LIMIT-MISSING)
- **Route count**: how many route handlers use this wrapper, how many are mutation routes
- **Evidence**: auth/rate-limit calls detected (if any), enforcement status
- **Remediation**: add wrapper name to hints if it performs auth/rate-limiting, or verify the implementation

### Severity

- **high**: wrapper wraps mutation routes (would have triggered AUTH-BOUNDARY-MISSING)
- **med**: wrapper wraps non-mutation API routes only (rate-limit concern)

### Resolution cascade

Shipguard resolves wrapper imports in this order:
1. **Same file**: wrapper function defined in the route file itself
2. **Direct import**: resolve import path via tsconfig paths, `@/`/`~/` conventions, relative paths
3. **Barrel re-export**: follow `export { X } from "./other"` and `export * from "./other"` up to 5 hops with cycle detection
4. **Extension probing**: `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`, plus `index.*` variants

### tsconfig path resolution

- Reads `tsconfig.json` (or `tsconfig.app.json`) with JSONC support (comments, trailing commas)
- Follows `extends` chains (e.g., `"extends": "tsconfig/nextjs.json"` in monorepos)
- Resolves `compilerOptions.paths` patterns (e.g., `"@/lib/*": ["lib/*"]`)
- Respects `baseUrl` for bare-path resolution

### Known limitations

- Wrappers from npm packages (bare specifiers like `import { withAuth } from "some-package"`) cannot be resolved
- Factory-generated wrappers with dynamic configuration may not have their body extracted correctly
- Enforcement detection is heuristic-based — unusual patterns may not be recognized
- `init` command suggests adding wrappers to hints when resolution or enforcement fails

---

## TENANCY-SCOPE-MISSING

### What Shipguard detects (v1)

Flags Prisma calls on tenant-owned models that lack a tenant field in the where clause.

### How tenant models are identified

- Schema introspection: if `prisma/schema.prisma` contains any of the recognized org field names on a model
- Default field names: `orgId`, `tenantId`, `workspaceId`, `organizationId`, `teamId`, `accountId`
- Custom field names via `hints.tenancy.orgFieldNames`

### Recognized scoping patterns

- Inline where clause: `where: { id: x, orgId: session.orgId }`
- Prisma middleware/extension with `$use()` or `$extends()` referencing org fields

### ORM support

- **Prisma**: fully supported (query detection, schema introspection, middleware detection)
- **Drizzle**: detected but not supported — tenancy rule skips gracefully (no false positives)
- Other ORMs: tenancy rule does not run

### Known limitations

- Row-Level Security (RLS) in Postgres is not detectable — use waivers
- Repository pattern wrapping Prisma calls may not be detected
- Deeply nested where clauses far from the Prisma call site may not be detected
- Reads (findMany, findFirst) flagged at medium confidence; writes at high confidence
- Prisma middleware in a separate file (`prisma.ts`) is detected only if in standard locations

---

## INPUT-VALIDATION-MISSING

### What Shipguard detects

Flags mutation endpoints that read user input (`request.json()`, `request.formData()`, `req.body`) and perform database writes or payment operations without schema validation.

### Recognized validation patterns

- **Zod**: `z.object()`, `.parse()`, `.safeParse()`, `zValidator()`
- **Valibot**: `v.object()`, `parse()`, `safeParse()`
- **Yup**: `yup.object()`, `.validate()`, `.validateSync()`
- **Joi**: `Joi.object()`, `.validate()`
- **ArkType**: `type()` from `arktype`
- **tRPC input**: `.input(z.object(...))` on procedure chains

### Severity

- **med/med** for standard mutation routes
- Bumped when `shipguard:public-intent` is present (public + unvalidated = higher exposure)

### Known limitations

- Custom validation functions not using a recognized library are not detected
- Validation in a separate utility file may not be detected unless imported and called in the handler

---

## PUBLIC-INTENT-MISSING-REASON

### What Shipguard detects

Flags `shipguard:public-intent` directives that lack a required `reason` string.

### Directive format

```ts
// shipguard:public-intent reason="Public URL health checker"
```

- Single-line comment anywhere in the route module
- `reason` is required (non-empty string)
- Supports double or single quotes
- Missing or empty reason produces this finding and the directive is ignored

### Effect

When a valid `public-intent` directive is present:
- **AUTH-BOUNDARY-MISSING** is suppressed (auth absence is intentional)
- **RATE-LIMIT-MISSING** severity is floored at HIGH
- **INPUT-VALIDATION-MISSING** severity is bumped
- SSRF escalation applies if outbound fetch with user-influenced URL is detected

When the directive is malformed (missing reason):
- All rules behave as if the directive doesn't exist
- A `PUBLIC-INTENT-MISSING-REASON` finding is emitted at med/high

---

## Detected Ecosystem

Shipguard auto-detects the following from `package.json`:

| Category | Libraries |
|----------|-----------|
| **Auth** | next-auth / Auth.js, Clerk, Supabase, Kinde, WorkOS, Better Auth, Lucia, Auth0, iron-session, Firebase Auth |
| **Rate Limiting** | @upstash/ratelimit, Arcjet, Unkey |
| **ORM** | Prisma, Drizzle |
| **Framework** | tRPC |

When a library is detected, Shipguard automatically adds the appropriate auth function names and rate limit wrapper names to hints — no manual configuration needed.

### Wrapper Introspection

Beyond library detection, Shipguard performs **wrapper introspection** on every HOF wrapper found in route exports:

| Step | What happens |
|------|-------------|
| **Discover** | Extract `withX(handler)` chains from route exports |
| **Resolve** | Follow imports through tsconfig paths, barrel re-exports (up to 5 hops) |
| **Analyze** | Parse wrapper body with TypeScript AST, find auth/RL calls |
| **Verify** | Check that call results are used in conditionals with throw/return/redirect |
| **Apply** | Routes using verified wrappers are automatically cleared |
| **Group** | Unverified wrappers produce a single WRAPPER-UNRECOGNIZED finding |

This means most codebases need **zero configuration** — Shipguard reads your wrapper implementations and understands them.

### Monorepo Support

Shipguard reads dependencies from both the app's `package.json` and the workspace root (detected via `pnpm-workspace.yaml`, `turbo.json`, or `package.json` workspaces). Middleware is checked at both levels. tsconfig `extends` chains are followed for path alias resolution.
