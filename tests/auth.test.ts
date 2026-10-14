import { describe, expect, it } from "vitest";
import { NemiAccessDeniedError, NemiCancelledError, NemiStateMismatchError } from "../src/errors";
import { NemiError, NemiOAuthError } from "../src/core";
import { MemoryTokenStore } from "../src/storage";
import { webCryptoAdapter } from "../src/crypto";
import { createCodeChallenge } from "../src/core";
import { approvingBrowser, CLIENT_ID, createServer, json, makeAuth, REDIRECT } from "./helpers";
import { parseRedirectUrl } from "../src/redirect";

const crypto = webCryptoAdapter(globalThis.crypto);

describe("sign in", () => {
  it("runs the PKCE authorization code flow and signs the person in", async () => {
    const server = createServer();
    const browser = approvingBrowser(server);
    const store = new MemoryTokenStore();
    const auth = makeAuth({ server, browser, tokenStore: store });

    const user = await auth.signIn();

    expect(user).toMatchObject({ id: "pairwise-1", name: "Ada Lovelace", preferredUsername: "ada", email: "ada@example.com" });
    expect(auth.isSignedIn).toBe(true);
    expect(auth.getState().error).toBeNull();

    // Authorize request: public client, PKCE S256, state and nonce, no secret.
    const { base, params } = parseRedirectUrl(browser.urls[0]!);
    expect(base).toBe("https://nemilab.com/oauth/authorize");
    expect(params).toMatchObject({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      scope: "openid profile email offline_access gallery.read",
      code_challenge_method: "S256",
    });
    expect(params.state).toBeTruthy();
    expect(params.nonce).toBeTruthy();
    expect(params.client_secret).toBeUndefined();

    // Token request carries the verifier that matches the challenge, and no secret.
    const form = server.tokenRequests[0]!;
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code_123");
    expect(form.get("redirect_uri")).toBe(REDIRECT);
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.has("client_secret")).toBe(false);
    const verifier = form.get("code_verifier")!;
    expect(verifier).toHaveLength(43);
    expect(await createCodeChallenge(verifier, crypto)).toBe(params.code_challenge);

    // Tokens persisted, pending request cleaned up.
    const stored = JSON.parse((await store.getItem(`nemi.${CLIENT_ID}.tokens`))!);
    expect(stored).toMatchObject({ accessToken: "nemi_oat_1", refreshToken: "nemi_ort_1" });
    expect(await store.getItem(`nemi.${CLIENT_ID}.pending`)).toBeNull();
    // Stored payload is small enough for SecureStore and carries no id_token.
    expect(stored.idToken).toBeUndefined();
  });

  it("rejects with NemiCancelledError when the person closes the browser", async () => {
    const server = createServer();
    const store = new MemoryTokenStore();
    const auth = makeAuth({
      server,
      tokenStore: store,
      browser: { openAuthSession: async () => ({ type: "cancel" }) },
    });

    const err = await auth.signIn().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NemiCancelledError);
    expect(err).toBeInstanceOf(NemiError); // one base class with the core SDK
    expect(auth.getState()).toMatchObject({ status: "signedOut", error: null });
    expect(server.tokenRequests).toHaveLength(0);
    expect(await store.getItem(`nemi.${CLIENT_ID}.pending`)).toBeNull();

    // A dismissed sheet is a cancel too, and the next attempt works.
    const auth2 = makeAuth({ server, browser: { openAuthSession: async () => ({ type: "dismiss" }) } });
    await expect(auth2.signIn()).rejects.toBeInstanceOf(NemiCancelledError);
  });

  it("refuses a redirect whose state does not match", async () => {
    const server = createServer();
    const auth = makeAuth({ server, browser: approvingBrowser(server, (p) => ({ ...p, state: "forged" })) });

    await expect(auth.signIn()).rejects.toBeInstanceOf(NemiStateMismatchError);
    expect(server.tokenRequests).toHaveLength(0);
    expect(auth.isSignedIn).toBe(false);
    expect(auth.getState().error).toBeInstanceOf(NemiStateMismatchError);
  });

  it("refuses a redirect without state", async () => {
    const server = createServer();
    const auth = makeAuth({
      server,
      browser: approvingBrowser(server, (p) => {
        const { state: _s, ...rest } = p;
        return rest;
      }),
    });
    await expect(auth.signIn()).rejects.toBeInstanceOf(NemiStateMismatchError);
  });

  it("maps Deny on the consent screen to NemiAccessDeniedError", async () => {
    const server = createServer();
    const auth = makeAuth({
      server,
      browser: approvingBrowser(server, (p) => ({ error: "access_denied", state: p.state! })),
    });
    await expect(auth.signIn()).rejects.toBeInstanceOf(NemiAccessDeniedError);
    expect(server.tokenRequests).toHaveLength(0);
  });

  it("refuses a redirect from another issuer", async () => {
    const server = createServer();
    const auth = makeAuth({ server, browser: approvingBrowser(server, (p) => ({ ...p, iss: "https://evil.example" })) });
    await expect(auth.signIn()).rejects.toMatchObject({ error: "invalid_issuer" });
  });

  it("surfaces token endpoint errors as NemiOAuthError", async () => {
    const server = createServer();
    server.onToken = () => json({ error: "invalid_grant", error_description: "Code expired." }, 400);
    const auth = makeAuth({ server });
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NemiOAuthError);
    expect(err).toMatchObject({ error: "invalid_grant", status: 400 });
  });

  it("reports a failure before the browser opens (discovery down) in state.error", async () => {
    const server = createServer();
    const original = server.fetch.getMockImplementation() as (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    server.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("openid-configuration") ? json({ error: "server_error" }, 500) : original(input, init),
    );
    const opened: string[] = [];
    const store = new MemoryTokenStore();
    const auth = makeAuth({
      server,
      tokenStore: store,
      browser: { openAuthSession: async (u) => (opened.push(u), { type: "cancel" }) },
    });
    await expect(auth.signIn()).rejects.toBeTruthy();
    expect(opened).toHaveLength(0);
    expect(auth.getState().error).toBeInstanceOf(Error);
    expect(await store.getItem(`nemi.${CLIENT_ID}.pending`)).toBeNull();
  });

  it("completes a sign in after an Android cold start through the deep link", async () => {
    const server = createServer();
    const store = new MemoryTokenStore();
    // First process: the request is created and the browser opened, then the OS kills the app.
    const first = makeAuth({ server, tokenStore: store });
    const { url } = await first.createAuthorizationRequest();
    const { params } = parseRedirectUrl(url);
    server.lastNonce = params.nonce;

    // Second process: relaunched by the redirect.
    const second = makeAuth({ server, tokenStore: store });
    await second.initialize();
    expect(second.isSignedIn).toBe(false);
    const handled = await second.handleRedirectUrl(`${REDIRECT}?code=code_123&state=${params.state}`);
    expect(handled).toBe(true);
    expect(second.isSignedIn).toBe(true);
    expect(second.user?.preferredUsername).toBe("ada");
    expect(server.tokenRequests[0]!.get("code_verifier")).toBeTruthy();

    // The same link delivered again (Linking event after getInitialURL) is ignored.
    expect(await second.handleRedirectUrl(`${REDIRECT}?code=code_123&state=${params.state}`)).toBe(false);
    expect(server.tokenRequests).toHaveLength(1);
  });

  it("ignores links that are not the redirect URI", async () => {
    const auth = makeAuth({ server: createServer() });
    expect(await auth.handleRedirectUrl("com.example.app:/somewhere-else?x=1")).toBe(false);
    expect(await auth.handleRedirectUrl(null)).toBe(false);
  });
});
