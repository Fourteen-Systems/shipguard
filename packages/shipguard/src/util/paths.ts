/**
 * Check if a file path matches any of the allowlist glob patterns.
 * Used by rules to skip files/routes that the user has marked as exempt.
 */
export function isAllowlisted(filePath: string, allowlistPaths: string[]): boolean {
  if (allowlistPaths.length === 0) return false;
  return allowlistPaths.some((pattern) => matchGlob(filePath, pattern));
}

function matchGlob(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${regexStr}$`).test(filePath);
}
