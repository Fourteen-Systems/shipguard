# Shipguard — Supported Patterns & Limitations

## AUTH-BOUNDARY-MISSING

### What Shipguard detects (v1)

Flags route handlers and server actions that:
1. Perform mutations (Prisma writes, Stripe calls, request body parsing)
2. Have no recognized auth boundary

### Recognized auth patterns

- `auth()` (NextAuth v5 / Auth.js)
- `getServerSession()` (NextAuth v4)
- `currentUser()` (Clerk)
- `clerkClient()` (Clerk)
- `requireUser()` (custom, commonly used)
- Middleware with auth patterns (`clerkMiddleware()`, `withAuth()`, `getToken()`)
- Any function name added to `hints.auth.functions`

### Known limitations

- Custom auth wrappers with non-standard names (e.g., `checkPermissions()`) need hints config
- Auth enforced via API gateway or reverse proxy is not detectable — use waivers
- Inline `if (!session)` checks without calling a known auth function may be missed

---

## RATE-LIMIT-MISSING

### What Shipguard detects (v1)

Flags API route handlers under `app/api/` that have no recognized rate limiting.

### Recognized rate limit patterns

- `@upstash/ratelimit` (import detection)
- `rate-limiter-flexible` (import detection)
- Any wrapper name in `hints.rateLimit.wrappers` (call detection)
- Middleware-level rate limiting (heuristic on middleware.ts content)

### Known limitations

- Edge/CDN rate limiting (Cloudflare, Vercel) is invisible to static analysis — use waivers
- Rate limiting in a shared middleware wrapper may not be detected if function name is not in hints
- Health check endpoints (`/health`, `/ping`, `/ready`, `/live`) are automatically exempted

---

## TENANCY-SCOPE-MISSING

### What Shipguard detects (v1)

Flags Prisma calls on tenant-owned models that lack a tenant field in the where clause.

### How tenant models are identified

- Schema introspection: if `prisma/schema.prisma` contains `orgId`, `tenantId`, or `workspaceId` on a model
- Custom field names via `hints.tenancy.orgFieldNames`

### Recognized scoping patterns

- Inline where clause: `where: { id: x, orgId: session.orgId }`
- Prisma middleware/extension with `$use()` or `$extends()` referencing org fields

### Known limitations

- Row-Level Security (RLS) in Postgres is not detectable — use waivers
- Repository pattern wrapping Prisma calls may not be detected
- Only checks 15 lines of context after each Prisma call (may miss deeply nested where clauses)
- Reads (findMany, findFirst) flagged at medium confidence; writes at high confidence
