import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { bytesToBase64, base64UrlDecodeToString } from "../src/base64";
import { createCodeChallenge, createPkcePair } from "../src/core";
import { expoCryptoAdapter, webCryptoAdapter } from "../src/crypto";
import { matchesRedirectUri, parseRedirectUrl } from "../src/redirect";
import { storageKey } from "../src/storage";

// A stand-in for expo-crypto, backed by Node, so the real expoCryptoAdapter runs.
vi.mock("../src/optional", async (orig) => ({
  ...(await orig<typeof import("../src/optional")>()),
  loadExpoCrypto: () => ({
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
    digest: async (_alg: string, data: ArrayBufferView) => {
      const buf = createHash("sha256").update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest();
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  }),
}));

const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("PKCE through the core SDK", () => {
  it("matches the RFC 7636 Appendix B vector with the expo-crypto adapter", async () => {
    expect(await createCodeChallenge(RFC_VERIFIER, expoCryptoAdapter())).toBe(RFC_CHALLENGE);
  });

  it("matches the RFC 7636 Appendix B vector with the WebCrypto adapter", async () => {
    expect(await createCodeChallenge(RFC_VERIFIER, webCryptoAdapter(globalThis.crypto))).toBe(RFC_CHALLENGE);
  });

  it("creates a 43 character base64url verifier with the expo-crypto adapter", async () => {
    const pair = await createPkcePair(expoCryptoAdapter());
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.codeChallenge).toBe(await createCodeChallenge(pair.codeVerifier, webCryptoAdapter(globalThis.crypto)));
    expect(pair.codeChallengeMethod).toBe("S256");
  });

  it("encodes and decodes base64 like the platform", () => {
    for (const len of [0, 1, 2, 3, 31, 32]) {
      const bytes = new Uint8Array(Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff));
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
    expect(base64UrlDecodeToString(Buffer.from('{"name":"Zoë ✓"}').toString("base64url"))).toBe('{"name":"Zoë ✓"}');
  });
});

describe("redirect parsing", () => {
  it("parses private-use scheme redirects without URL()", () => {
    const r = parseRedirectUrl("com.example.app:/oauthredirect?code=a%2Bb&state=xyz&iss=https%3A%2F%2Fnemilab.com%2Foauth");
    expect(r.base).toBe("com.example.app:/oauthredirect");
    expect(r.params).toEqual({ code: "a+b", state: "xyz", iss: "https://nemilab.com/oauth" });
  });

  it("matches the redirect URI across slash variants and ignores other paths", () => {
    expect(matchesRedirectUri("com.example.app:/oauthredirect?code=1", "com.example.app:/oauthredirect")).toBe(true);
    expect(matchesRedirectUri("com.example.app:///oauthredirect?code=1", "com.example.app:/oauthredirect")).toBe(true);
    expect(matchesRedirectUri("com.example.app:/other", "com.example.app:/oauthredirect")).toBe(false);
    expect(matchesRedirectUri("com.evil.app:/oauthredirect", "com.example.app:/oauthredirect")).toBe(false);
  });

  it("builds SecureStore-safe keys", () => {
    expect(storageKey("nemi", "nemi_app_abc:/x", "tokens")).toBe("nemi.nemi_app_abc__x.tokens");
  });
});
