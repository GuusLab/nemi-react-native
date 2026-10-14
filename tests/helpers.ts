import { vi } from "vitest";
import type { BrowserAdapter, BrowserResult } from "../src/browser";
import { webCryptoAdapter } from "../src/crypto";
import { NemiNativeAuth, type NemiNativeAuthConfig } from "../src/NemiNativeAuth";
import { parseRedirectUrl } from "../src/redirect";
import { MemoryTokenStore } from "../src/storage";

export const CLIENT_ID = "nemi_app_test1234567890abcdefgh";
export const REDIRECT = "com.example.app:/oauthredirect";
export const ISSUER = "https://nemilab.com/oauth";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function b64url(s: string) {
  return Buffer.from(s).toString("base64url");
}

export function fakeIdToken(claims: Record<string, unknown>) {
  return `${b64url(JSON.stringify({ alg: "ES256", kid: "k1" }))}.${b64url(JSON.stringify(claims))}.sig`;
}

export interface FakeServer {
  fetch: ReturnType<typeof vi.fn>;
  tokenRequests: URLSearchParams[];
  revokeRequests: URLSearchParams[];
  apiAuthHeaders: string[];
  discoveryRequests: number;
  /** Responds to the token endpoint. Default: issue tokens with rotation. */
  onToken?: (form: URLSearchParams) => Response | Promise<Response>;
  /** Responds to /api/v1 calls. Default: 200 with photos. */
  onApi?: (auth: string) => Response;
  lastChallenge?: string;
  lastNonce?: string;
}

export function createServer(): FakeServer {
  let n = 0;
  const server: FakeServer = {
    tokenRequests: [],
    revokeRequests: [],
    apiAuthHeaders: [],
    discoveryRequests: 0,
    fetch: vi.fn(),
  };
  server.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://nemilab.com/oauth/.well-known/openid-configuration") {
      server.discoveryRequests += 1;
      return json({
        issuer: ISSUER,
        authorization_endpoint: "https://nemilab.com/oauth/authorize",
        token_endpoint: "https://nemilab.com/api/oauth/token",
        revocation_endpoint: "https://nemilab.com/api/oauth/revoke",
        userinfo_endpoint: "https://nemilab.com/api/oauth/userinfo",
        jwks_uri: "https://nemilab.com/oauth/jwks",
      });
    }
    if (url === "https://nemilab.com/api/oauth/token") {
      const form = new URLSearchParams(String(init?.body));
      server.tokenRequests.push(form);
      if (server.onToken) return server.onToken(form);
      n += 1;
      return json({
        access_token: `nemi_oat_${n}`,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: `nemi_ort_${n}`,
        scope: "openid profile email offline_access gallery.read",
        id_token:
          form.get("grant_type") === "authorization_code"
            ? fakeIdToken({ iss: ISSUER, aud: CLIENT_ID, sub: "pairwise-1", nonce: server.lastNonce, name: "Ada" })
            : undefined,
      });
    }
    if (url === "https://nemilab.com/api/oauth/revoke") {
      server.revokeRequests.push(new URLSearchParams(String(init?.body)));
      return new Response(null, { status: 200 });
    }
    if (url === "https://nemilab.com/api/oauth/userinfo") {
      return json({ sub: "pairwise-1", name: "Ada Lovelace", preferred_username: "ada", email: "ada@example.com", email_verified: true });
    }
    if (url.startsWith("https://nemilab.com/api/v1/")) {
      const auth = new Headers(init?.headers).get("Authorization") ?? "";
      server.apiAuthHeaders.push(auth);
      if (server.onApi) return server.onApi(auth);
      return json({ photos: [{ id: "p1", thumbnail_url: "https://cdn/p1.jpg" }], next_cursor: null });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  return server;
}

/** A browser that "approves" by redirecting back with a code and the state it was given. */
export function approvingBrowser(server: FakeServer, tweak?: (params: Record<string, string>) => Record<string, string>): BrowserAdapter & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async openAuthSession(url, redirectUri): Promise<BrowserResult> {
      urls.push(url);
      const { params } = parseRedirectUrl(url);
      server.lastChallenge = params.code_challenge;
      server.lastNonce = params.nonce;
      let back: Record<string, string> = { code: "code_123", state: params.state!, iss: ISSUER };
      if (tweak) back = tweak(back);
      const q = Object.entries(back).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
      return { type: "success", url: `${redirectUri}?${q}` };
    },
  };
}

export function makeAuth(overrides: Partial<NemiNativeAuthConfig> & { server: FakeServer }) {
  const { server, ...rest } = overrides;
  return new NemiNativeAuth({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT,
    scopes: ["openid", "profile", "email", "offline_access", "gallery.read"],
    crypto: webCryptoAdapter(globalThis.crypto),
    tokenStore: new MemoryTokenStore(),
    fetch: server.fetch as unknown as typeof fetch,
    browser: approvingBrowser(server),
    ...rest,
  });
}
