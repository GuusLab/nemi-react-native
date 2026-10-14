// Manual parsing of redirect URLs. React Native's URL polyfill is incomplete
// and private-use schemes such as `com.example.app:/oauthredirect` parse
// inconsistently, so we do not rely on `new URL()` or `URLSearchParams`.

export interface ParsedRedirect {
  /** Everything before `?` or `#`. */
  base: string;
  params: Record<string, string>;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

export function parseRedirectUrl(url: string): ParsedRedirect {
  const hashAt = url.indexOf("#");
  const withoutHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const fragment = hashAt >= 0 ? url.slice(hashAt + 1) : "";
  const queryAt = withoutHash.indexOf("?");
  const base = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
  const query = queryAt >= 0 ? withoutHash.slice(queryAt + 1) : "";
  const params: Record<string, string> = {};
  // Query wins over fragment; the fragment is read only as a fallback.
  for (const part of [fragment, query]) {
    for (const pair of part.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const key = decode(eq >= 0 ? pair.slice(0, eq) : pair);
      params[key] = decode(eq >= 0 ? pair.slice(eq + 1) : "");
    }
  }
  return { base, params };
}

function normalizeBase(s: string): string {
  // `com.example.app:/cb`, `com.example.app:///cb` and `com.example.app://cb`
  // all reach the app; compare them on scheme plus path without slashes.
  const colon = s.indexOf(":");
  if (colon < 0) return s.toLowerCase();
  const scheme = s.slice(0, colon).toLowerCase();
  const rest = s.slice(colon + 1).replace(/^\/+/, "").replace(/\/+$/, "");
  return `${scheme}:${rest}`;
}

/** True when `url` is a redirect to `redirectUri` (ignoring query and fragment). */
export function matchesRedirectUri(url: string, redirectUri: string): boolean {
  return normalizeBase(parseRedirectUrl(url).base) === normalizeBase(parseRedirectUrl(redirectUri).base);
}

export function buildQuery(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((e): e is [string, string] => e[1] !== undefined && e[1] !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
