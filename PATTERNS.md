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

**Custom auth heuristic (downgrades confidence to medium):**
- Verb patterns: `verify*`, `check*`, `require*`, `validate*`, `ensure*`, `guard*`, `protect*`
- Combined with: `Token`, `Auth`, `Session`, `User`, `Access`, `Secret`, `Signature`, `Permission`
- Direct `Authorization` header reading

**HOF wrapper detection:**
- `export const POST = withAuth(handler)` — recognized if `withAuth` is in auth hints
- Unknown wrappers (`export const POST = someFunction(handler)`) downgrade confidence to medium

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

- Custom auth wrappers with non-standard names need hints config (unless matching heuristic verbs)
- Auth enforced via API gateway or reverse proxy is not detectable — use waivers
- Inline `if (!session)` checks without calling a known auth function may be missed
- tRPC middleware chain auth is not modeled — use `protectedProcedure` or add a waiver

---

## RATE-LIMIT-MISSING

### What Shipguard detects (v1)

Flags API route handlers under `app/api/` and tRPC public mutation procedures that have no recognized rate limiting.

### Recognized rate limit patterns

- `@upstash/ratelimit` (import detection)
- `rate-limiter-flexible` (import detection)
- `@arcjet/next` (import detection)
- `@unkey/ratelimit` (import detection)
- Any wrapper name in `hints.rateLimit.wrappers` (call detection)
- HOF wrapper: `export const POST = withRateLimit(handler)`
- Middleware-level rate limiting (heuristic on middleware.ts content)

**Auto-detected from dependencies:**
- Upstash: `Ratelimit`, `ratelimit`
- Arcjet: `aj.protect`, `fixedWindow`, `slidingWindow`, `tokenBucket`
- Unkey: `withUnkey`, `verifyKey`

### Automatic exemptions

- Health/readiness: `/health`, `/ping`, `/ready`, `/live`
- Internal: `/_next/`
- Server-to-server: `/cron/`, `/tasks/`
- Webhooks: `/webhook`, `/webhooks` (path-based) or Stripe/HMAC signature verification (code-based)
- Cron routes with `process.env.CRON_API_KEY` / `verifyVercelSignature()`
- tRPC proxy routes (rate limiting checked at procedure level instead)

### tRPC rate limiting

- `publicProcedure.mutation()` without rate limiting → flagged at medium confidence
- `protectedProcedure` mutations without rate limiting → flagged at lower severity (authenticated users can still abuse cost/spam)
- tRPC middleware-level rate limiting is not modeled — use waivers if handled there

### Known limitations

- Edge/CDN rate limiting (Cloudflare, Vercel) is invisible to static analysis — use waivers
- Rate limiting in a shared middleware wrapper may not be detected if function name is not in hints

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

## Detected Ecosystem

Shipguard auto-detects the following from `package.json`:

| Category | Libraries |
|----------|-----------|
| **Auth** | next-auth / Auth.js, Clerk, Supabase, Kinde, WorkOS, Better Auth, Lucia, Auth0, iron-session, Firebase Auth |
| **Rate Limiting** | @upstash/ratelimit, Arcjet, Unkey |
| **ORM** | Prisma, Drizzle |
| **Framework** | tRPC |

When a library is detected, Shipguard automatically adds the appropriate auth function names and rate limit wrapper names to hints — no manual configuration needed.
