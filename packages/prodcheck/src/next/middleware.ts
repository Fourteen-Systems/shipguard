import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { NextMiddlewareIndex } from "./types.js";
import { findWorkspaceRoot } from "../util/monorepo.js";

export function analyzeMiddleware(rootDir: string): NextMiddlewareIndex {
  // Next.js middleware can be at root or src/
  const candidates = ["middleware.ts", "middleware.js", "src/middleware.ts", "src/middleware.js"];
  let file: string | undefined;
  let src = "";

  for (const candidate of candidates) {
    const abs = path.join(rootDir, candidate);
    if (existsSync(abs)) {
      file = candidate;
      src = readFileSync(abs, "utf8");
      break;
    }
  }

  // In monorepos, middleware may be at the workspace root
  if (!file) {
    const wsRoot = findWorkspaceRoot(rootDir);
    if (wsRoot) {
      for (const candidate of candidates) {
        const abs = path.join(wsRoot, candidate);
        if (existsSync(abs)) {
          file = candidate;
          src = readFileSync(abs, "utf8");
          break;
        }
      }
    }
  }

  if (!file) {
    return { authLikely: false, rateLimitLikely: false, matcherPatterns: [] };
  }

  // Best-effort heuristics (keep conservative)
  const authLikely = /getToken\s*\(|auth\s*\(|clerkMiddleware\s*\(|authMiddleware\s*\(|withAuth\s*\(|getServerSession\s*\(|\.auth\.getUser\s*\(|createMiddlewareClient\s*\(|authkitMiddleware\s*\(|kindeMiddleware\s*\(|withMiddlewareAuthRequired\s*\(|validateRequest\s*\(|getIronSession\s*\(/.test(src);
  const rateLimitLikely = /ratelimit|rateLimit|upstash/i.test(src);

  // Extract matcher config if present
  const matcherPatterns: string[] = [];
  const matcherMatch = src.match(/matcher\s*:\s*(\[[\s\S]*?\])/);
  if (matcherMatch) {
    const literals = matcherMatch[1].matchAll(/"([^"]+)"|'([^']+)'/g);
    for (const m of literals) {
      matcherPatterns.push(m[1] ?? m[2]);
    }
  }

  return { file, authLikely, rateLimitLikely, matcherPatterns };
}
