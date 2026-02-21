/**
 * Detect outbound HTTP fetch calls with user-influenced URLs.
 * Used by RL and INPUT-VALIDATION rules to identify SSRF surface
 * on public-intent endpoints.
 */

export interface OutboundFetchResult {
  hasOutboundFetch: boolean;
  hasUserInfluencedUrl: boolean;
  /** True when both outbound fetch AND user-influenced URL are present */
  isRisky: boolean;
  evidence: string[];
}

/**
 * Outbound fetch patterns — HTTP client calls that make external requests.
 * Excludes false positives like fetchUser(), fetchData() by requiring
 * non-word char or start-of-line before "fetch".
 */
const OUTBOUND_FETCH_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /(?:^|[^.\w])fetch\s*\(/, label: "fetch()" },
  { pattern: /axios\s*[.(]/, label: "axios" },
  { pattern: /(?:^|[^.\w])got\s*[.(]/, label: "got()" },
  { pattern: /undici\.request\s*\(/, label: "undici.request()" },
  { pattern: /https?\.(?:get|request)\s*\(/, label: "http.get/request()" },
];

/**
 * User-influenced URL patterns — evidence that the fetch target
 * is constructed from user-supplied request data.
 */
const USER_INPUT_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /searchParams\.get\s*\(/, label: "reads searchParams" },
  { pattern: /searchParams\.\w/, label: "accesses searchParams" },
  { pattern: /new\s+URL\s*\(\s*(?:request|req)\.url/, label: "parses request URL" },
  { pattern: /(?:request|req)\.url\b/, label: "reads request.url" },
  { pattern: /(?:request|req)\.json\s*\(/, label: "reads request body" },
  { pattern: /req\.body\b/, label: "reads req.body" },
  { pattern: /req\.query\b/, label: "reads req.query" },
  { pattern: /params\.\w/, label: "reads route params" },
];

export function detectOutboundFetcher(src: string): OutboundFetchResult {
  const evidence: string[] = [];
  let hasOutboundFetch = false;
  let hasUserInfluencedUrl = false;

  for (const { pattern, label } of OUTBOUND_FETCH_PATTERNS) {
    if (pattern.test(src)) {
      hasOutboundFetch = true;
      evidence.push(`outbound HTTP call: ${label}`);
      break; // one is enough
    }
  }

  if (hasOutboundFetch) {
    for (const { pattern, label } of USER_INPUT_PATTERNS) {
      if (pattern.test(src)) {
        hasUserInfluencedUrl = true;
        evidence.push(`user-controlled input: ${label}`);
        break; // one is enough
      }
    }
  }

  return {
    hasOutboundFetch,
    hasUserInfluencedUrl,
    isRisky: hasOutboundFetch && hasUserInfluencedUrl,
    evidence,
  };
}
