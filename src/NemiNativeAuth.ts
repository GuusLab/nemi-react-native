import { base64UrlDecodeToString, bytesToBase64Url } from "./base64";
import { expoWebBrowserAdapter, type BrowserAdapter } from "./browser";
import {
  createCoreAuth,
  createCoreClient,
  createPkcePair,
  NemiOAuthError,
  type FetchLike,
  type NemiAuth,
  type NemiClient,
  type NemiUser,
  type NemiUserInfo,
  type TokenSet,
} from "./core";
import { expoCryptoAdapter, type CryptoAdapter } from "./crypto";
import { NemiAccessDeniedError, NemiCancelledError, NemiNotSignedInError, NemiStateMismatchError } from "./errors";
import { buildQuery, matchesRedirectUri, parseRedirectUrl } from "./redirect";
import { SecureStoreTokenStore, storageKey, type TokenStore } from "./storage";

export const DEFAULT_ISSUER = "https://nemilab.com/oauth";
export const DEFAULT_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

/** How long a started sign in may wait for its redirect (covers an Android cold start). */
const PENDING_TTL_MS = 10 * 60 * 1000;

export interface NemiNativeAuthConfig {
  /** `nemi_app_...` from dev.nemilab.com. Native apps are public clients: there is no secret. */
  clientId: string;
  /** A private-use scheme URI registered on the app, e.g. `com.example.app:/oauthredirect`. */
  redirectUri: string;
  /** Defaults to `openid profile email offline_access`. Keep `offline_access` to get a refresh token. */
  scopes?: readonly string[];
  /** OAuth issuer. Defaults to https://nemilab.com/oauth. */
  issuer?: string;
  /** REST API base. Defaults to `<issuer origin>/api/v1`. */
  apiBaseUrl?: string;
  /** Browser used for the consent screen. Defaults to `expoWebBrowserAdapter()`. */
  browser?: BrowserAdapter;
  /** Encrypted token storage. Defaults to `new SecureStoreTokenStore()`. */
  tokenStore?: TokenStore;
  /** Random bytes and SHA-256. Defaults to `expoCryptoAdapter()`. */
  crypto?: CryptoAdapter;
  /** Fetch implementation. Defaults to the global fetch. */
  fetch?: FetchLike;
  /** Refresh this many seconds before the access token expires. Default 60. */
  refreshLeewaySeconds?: number;
  /** Clock, for tests. */
  now?: () => number;
}

export interface SignInOptions {
  /** Extra or different scopes for this sign in. */
  scopes?: readonly string[];
  /** `consent` always shows the consent screen. */
  prompt?: "consent";
}

export type { NemiUser };

/** Stored tokens: the core `TokenSet` without the id_token (kept small for SecureStore). */
export type NemiTokens = Omit<TokenSet, "idToken">;

export type NemiAuthStatus = "loading" | "signedIn" | "signedOut";

export interface NemiAuthState {
  status: NemiAuthStatus;
  user: NemiUser | null;
  /** Last non-cancel error (sign in, redirect or refresh), or null. */
  error: Error | null;
}

interface PendingAuth {
  state: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  createdAt: number;
}

interface ActiveAttempt {
  pending: PendingAuth;
  /** A redirect that arrived through Linking while the browser was still open. */
  linkedUrl?: string;
}

/**
 * Framework-free "Sign in with Nemi" for React Native. `NemiProvider` wraps
 * one of these; use it directly outside React (background tasks, Redux, etc).
 */
export class NemiNativeAuth {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly issuer: string;
  readonly apiBaseUrl: string;
  /** The core SDK's OAuth client (discovery, token, revoke, userinfo). */
  readonly core: NemiAuth;

  private readonly browserOverride?: BrowserAdapter;
  private readonly cryptoOverride?: CryptoAdapter;
  private storeInstance?: TokenStore;
  private readonly fetchImpl: FetchLike;
  private readonly leewayMs: number;
  private readonly now: () => number;
  private readonly keys: { tokens: string; user: string; pending: string };

  private state: NemiAuthState = { status: "loading", user: null, error: null };
  private tokens: NemiTokens | null = null;
  private listeners = new Set<(state: NemiAuthState) => void>();
  private initPromise?: Promise<void>;
  private signInPromise?: Promise<NemiUser>;
  private refreshPromise?: Promise<NemiTokens>;
  private activeAttempt?: ActiveAttempt;
  private redirectInFlight?: Promise<boolean>;
  private clientInstance?: NemiClient;

  constructor(config: NemiNativeAuthConfig) {
    if (!config.clientId) throw new TypeError("NemiNativeAuth: clientId is required.");
    if (!config.redirectUri) throw new TypeError("NemiNativeAuth: redirectUri is required.");
    this.clientId = config.clientId;
    this.redirectUri = config.redirectUri;
    this.scopes = config.scopes ?? DEFAULT_SCOPES;
    this.issuer = (config.issuer ?? DEFAULT_ISSUER).replace(/\/+$/, "");
    const origin = this.issuer.replace(/\/oauth$/, "");
    this.apiBaseUrl = (config.apiBaseUrl ?? `${origin}/api/v1`).replace(/\/+$/, "");
    this.browserOverride = config.browser;
    this.cryptoOverride = config.crypto;
    this.storeInstance = config.tokenStore;
    const f = config.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) throw new TypeError("NemiNativeAuth: no fetch implementation available.");
    this.fetchImpl = (input, init) => f(input, init);
    this.core = createCoreAuth({
      clientId: this.clientId,
      issuer: this.issuer,
      apiBaseUrl: this.apiBaseUrl,
      fetch: this.fetchImpl,
      crypto: () => this.crypto,
    });
    this.leewayMs = (config.refreshLeewaySeconds ?? 60) * 1000;
    this.now = config.now ?? Date.now;
    this.keys = {
      tokens: storageKey("nemi", this.clientId, "tokens"),
      user: storageKey("nemi", this.clientId, "user"),
      pending: storageKey("nemi", this.clientId, "pending"),
    };
  }

  // Adapters are created lazily so that constructing the class never touches
  // a native module the app chose to replace.
  private get store(): TokenStore {
    return (this.storeInstance ??= new SecureStoreTokenStore());
  }
  private cryptoInstance?: CryptoAdapter;
  private get crypto(): CryptoAdapter {
    return (this.cryptoInstance ??= this.cryptoOverride ?? expoCryptoAdapter());
  }
  private get browser(): BrowserAdapter {
    return this.browserOverride ?? expoWebBrowserAdapter();
  }

  // ---------------------------------------------------------------- state

  getState(): NemiAuthState {
    return this.state;
  }

  get user(): NemiUser | null {
    return this.state.user;
  }

  get isSignedIn(): boolean {
    return this.state.status === "signedIn";
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: (state: NemiAuthState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(patch: Partial<NemiAuthState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /** Loads the stored session. Safe to call many times; every public method awaits it. */
  initialize(): Promise<void> {
    return (this.initPromise ??= this.load());
  }

  private async load(): Promise<void> {
    try {
      const [rawTokens, rawUser] = await Promise.all([
        this.store.getItem(this.keys.tokens),
        this.store.getItem(this.keys.user),
      ]);
      this.tokens = rawTokens ? (JSON.parse(rawTokens) as NemiTokens) : null;
      const user = rawUser ? (JSON.parse(rawUser) as NemiUser) : null;
      this.setState(this.tokens ? { status: "signedIn", user } : { status: "signedOut", user: null });
    } catch (err) {
      this.tokens = null;
      this.setState({ status: "signedOut", user: null, error: toError(err) });
    }
  }

  /** Current tokens, or null. Mostly for debugging; prefer `getAccessToken()`. */
  async getTokens(): Promise<NemiTokens | null> {
    await this.initialize();
    return this.tokens;
  }

  // -------------------------------------------------------------- sign in

  /**
   * Opens the consent screen and resolves with the signed-in person.
   * Rejects with `NemiCancelledError` when the person closes the browser,
   * `NemiAccessDeniedError` on Deny and `NemiStateMismatchError` when the
   * response does not belong to this request.
   */
  signIn(options: SignInOptions = {}): Promise<NemiUser> {
    if (!this.signInPromise) {
      this.signInPromise = this.runSignIn(options).finally(() => {
        this.signInPromise = undefined;
        this.activeAttempt = undefined;
      });
    }
    return this.signInPromise;
  }

  /** Builds the authorize URL and saves the PKCE verifier. Exposed for custom flows. */
  async createAuthorizationRequest(options: SignInOptions = {}): Promise<{ url: string; pending: PendingAuth }> {
    const crypto = this.crypto;
    // PKCE comes from the core SDK, running on the injected crypto adapter.
    const { codeVerifier: verifier, codeChallenge: challenge } = await createPkcePair(crypto);
    const pending: PendingAuth = {
      state: randomToken(crypto),
      nonce: randomToken(crypto),
      verifier,
      redirectUri: this.redirectUri,
      createdAt: this.now(),
    };
    // Persist before opening the browser: on Android the OS may kill the app
    // while the browser is in front, and the redirect then cold starts it.
    await this.store.setItem(this.keys.pending, JSON.stringify(pending));
    const scopes = options.scopes ?? this.scopes;
    const { authorization_endpoint } = await this.core.discover();
    const url =
      `${authorization_endpoint}${authorization_endpoint.includes("?") ? "&" : "?"}` +
      buildQuery({
        response_type: "code",
        client_id: this.clientId,
        redirect_uri: this.redirectUri,
        scope: scopes.join(" "),
        state: pending.state,
        nonce: scopes.includes("openid") ? pending.nonce : undefined,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: options.prompt,
      });
    return { url, pending };
  }

  private async runSignIn(options: SignInOptions): Promise<NemiUser> {
    await this.initialize();
    this.setState({ error: null });
    let request: Awaited<ReturnType<NemiNativeAuth["createAuthorizationRequest"]>>;
    try {
      // Discovery (network) and the token store can fail before the browser opens.
      request = await this.createAuthorizationRequest(options);
    } catch (err) {
      await this.clearPending();
      this.setState({ error: toError(err) });
      throw err;
    }
    const { url, pending } = request;
    const attempt: ActiveAttempt = { pending };
    this.activeAttempt = attempt;

    let result;
    try {
      result = await this.browser.openAuthSession(url, this.redirectUri);
    } catch (err) {
      await this.clearPending();
      this.setState({ error: toError(err) });
      throw err;
    }

    const redirectUrl = result.type === "success" ? result.url : attempt.linkedUrl;
    if (!redirectUrl) {
      await this.clearPending();
      throw new NemiCancelledError();
    }
    try {
      return await this.completeRedirect(redirectUrl, pending);
    } catch (err) {
      this.setState({ error: toError(err) });
      throw err;
    }
  }

  /**
   * Feed incoming deep links here (the provider does this for you). Returns
   * true when the URL was a Nemi redirect and was handled.
   *
   * This covers the Android cold start: the app was killed while the browser
   * was open and is relaunched by the redirect. The verifier saved by
   * `signIn()` is read back from the token store and the sign in completes.
   */
  async handleRedirectUrl(url: string | null | undefined): Promise<boolean> {
    if (!url || !matchesRedirectUri(url, this.redirectUri)) return false;
    if (this.activeAttempt) {
      // The browser session is still open in this process; let signIn() finish it.
      this.activeAttempt.linkedUrl ??= url;
      return true;
    }
    if (this.redirectInFlight) return this.redirectInFlight;
    this.redirectInFlight = (async () => {
      await this.initialize();
      const raw = await this.store.getItem(this.keys.pending);
      const pending = raw ? (JSON.parse(raw) as PendingAuth) : null;
      if (!pending || this.now() - pending.createdAt > PENDING_TTL_MS) {
        // Nothing is waiting for this redirect (already handled, or stale).
        if (pending) await this.clearPending();
        return false;
      }
      try {
        await this.completeRedirect(url, pending);
      } catch (err) {
        if (!(err instanceof NemiCancelledError)) this.setState({ error: toError(err) });
      }
      return true;
    })().finally(() => {
      this.redirectInFlight = undefined;
    });
    return this.redirectInFlight;
  }

  private async completeRedirect(url: string, pending: PendingAuth): Promise<NemiUser> {
    const { params } = parseRedirectUrl(url);
    // The code is single use, so the pending record goes whatever happens next.
    await this.clearPending();
    if (!params.state || params.state !== pending.state) throw new NemiStateMismatchError();
    if (params.error) {
      if (params.error === "access_denied") throw new NemiAccessDeniedError(params.error_description);
      throw new NemiOAuthError(params.error, params.error_description);
    }
    if (params.iss && params.iss !== this.issuer) {
      throw new NemiOAuthError("invalid_issuer", `Unexpected issuer ${params.iss}.`);
    }
    if (!params.code) throw new NemiOAuthError("invalid_request", "The redirect carried no code.");

    const set = await this.core.exchangeCode({
      code: params.code,
      codeVerifier: pending.verifier,
      redirectUri: pending.redirectUri,
    });
    const claims = set.idToken ? this.checkIdToken(set.idToken, pending.nonce) : null;
    const tokens = this.toTokens(set);
    await this.saveTokens(tokens);
    const user = (await this.fetchUser(tokens.accessToken)) ?? (claims ? claimsToUser(claims) : null);
    if (user) await this.store.setItem(this.keys.user, JSON.stringify(user));
    this.setState({ status: "signedIn", user, error: null });
    return user ?? { id: "" };
  }

  /**
   * Light id_token checks. The token comes straight from the token endpoint
   * over TLS (OIDC Core 3.1.3.7), so we check audience, issuer and nonce
   * without verifying the signature. (The core's `verifyIdToken` needs
   * WebCrypto ECDSA, which React Native does not have by default.)
   */
  private checkIdToken(idToken: string, nonce: string): Record<string, unknown> {
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(base64UrlDecodeToString(idToken.split(".")[1] ?? "")) as Record<string, unknown>;
    } catch {
      throw new NemiOAuthError("invalid_id_token", "The id_token could not be decoded.");
    }
    const aud = claims.aud;
    const audOk = Array.isArray(aud) ? aud.includes(this.clientId) : aud === this.clientId;
    if (!audOk) throw new NemiOAuthError("invalid_id_token", "The id_token audience is not this app.");
    if (claims.iss !== this.issuer) throw new NemiOAuthError("invalid_id_token", "The id_token issuer is wrong.");
    if (claims.nonce !== undefined && claims.nonce !== nonce) {
      throw new NemiOAuthError("invalid_id_token", "The id_token nonce does not match.");
    }
    return claims;
  }

  private async fetchUser(accessToken: string): Promise<NemiUser | null> {
    try {
      return userInfoToUser(await this.core.userInfo(accessToken));
    } catch {
      return null;
    }
  }

  /** Re-reads the profile from UserInfo and updates `user`. */
  async reloadUser(): Promise<NemiUser | null> {
    const token = await this.getAccessToken();
    if (!token) return null;
    const user = await this.fetchUser(token);
    if (user) {
      await this.store.setItem(this.keys.user, JSON.stringify(user));
      this.setState({ user });
    }
    return user;
  }

  // --------------------------------------------------------------- tokens

  /**
   * A valid access token, refreshed first when it is about to expire.
   * Null when nobody is signed in.
   */
  async getAccessToken(): Promise<string | null> {
    await this.initialize();
    if (!this.tokens) return null;
    const expiresAt = this.tokens.expiresAt ?? Number.POSITIVE_INFINITY;
    if (expiresAt - this.leewayMs <= this.now() && this.tokens.refreshToken) {
      return (await this.refresh()).accessToken;
    }
    return this.tokens.accessToken;
  }

  /**
   * Refreshes the tokens. Concurrent callers share one request: Nemi rotates
   * refresh tokens and treats a replayed one as theft, revoking the session.
   */
  refresh(): Promise<NemiTokens> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.runRefresh().finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async runRefresh(): Promise<NemiTokens> {
    await this.initialize();
    const current = this.tokens;
    if (!current?.refreshToken) throw new NemiNotSignedInError("There is no refresh token to use.");
    let set: TokenSet;
    try {
      set = await this.core.refresh(current.refreshToken);
    } catch (err) {
      if (err instanceof NemiOAuthError && (err.error === "invalid_grant" || err.status === 401)) {
        // The grant is gone (revoked, expired or rotated elsewhere): sign out locally.
        await this.clearSession();
        this.setState({ status: "signedOut", user: null, error: err });
      }
      throw err;
    }
    const next = this.toTokens(set, current.refreshToken);
    // Persist the rotated refresh token before anybody can use the new access token.
    await this.saveTokens(next);
    return next;
  }

  /**
   * `fetch` that adds `Authorization: Bearer ...`, refreshes ahead of expiry
   * and retries once after a refresh when the API answers 401. Only URLs under
   * `apiBaseUrl` get the token; anything else (for example a presigned upload
   * URL) is passed through untouched, so the token never leaves Nemi's API.
   */
  readonly fetch: FetchLike = async (input, init) => {
    if (!this.isApiUrl(input)) return this.fetchImpl(input, init);
    const token = await this.getAccessToken();
    if (!token) throw new NemiNotSignedInError();
    const res = await this.fetchImpl(input, withBearer(init, token));
    if (res.status !== 401 || !this.tokens?.refreshToken) return res;
    // Another request may already have refreshed while this one was in flight.
    const fresh = this.tokens.accessToken !== token ? this.tokens.accessToken : (await this.refresh()).accessToken;
    return this.fetchImpl(input, withBearer(init, fresh));
  };

  /** The core REST client (`@guuslab/nemi`), wired to this session with auto refresh. */
  get client(): NemiClient {
    return (this.clientInstance ??= createCoreClient({
      apiBaseUrl: this.apiBaseUrl,
      fetch: this.fetch,
      getAccessToken: async () => {
        const token = await this.getAccessToken();
        if (!token) throw new NemiNotSignedInError();
        return token;
      },
    }));
  }

  // ------------------------------------------------------------- sign out

  /** Revokes the refresh token at Nemi (ending the grant's session) and clears local storage. */
  async signOut(): Promise<void> {
    await this.initialize();
    const tokens = this.tokens;
    const token = tokens?.refreshToken ?? tokens?.accessToken;
    if (token) {
      try {
        await this.core.revoke(token, { tokenTypeHint: tokens?.refreshToken ? "refresh_token" : "access_token" });
      } catch {
        // Offline or server down: still forget the tokens on this device.
      }
    }
    await this.clearSession();
    this.setState({ status: "signedOut", user: null, error: null });
  }

  // -------------------------------------------------------------- helpers

  private isApiUrl(url: string): boolean {
    return url === this.apiBaseUrl || url.startsWith(`${this.apiBaseUrl}/`) || url.startsWith(`${this.apiBaseUrl}?`);
  }

  private toTokens(set: TokenSet, previousRefresh?: string): NemiTokens {
    // Expiry is recomputed with our clock so tests and `now` overrides agree.
    const tokens: NemiTokens = {
      accessToken: set.accessToken,
      tokenType: set.tokenType,
      expiresAt: this.now() + (set.expiresIn ?? 3600) * 1000,
    };
    const refreshToken = set.refreshToken ?? previousRefresh;
    if (refreshToken) tokens.refreshToken = refreshToken;
    if (set.scope) tokens.scope = set.scope;
    if (set.expiresIn !== undefined) tokens.expiresIn = set.expiresIn;
    return tokens;
  }

  private async saveTokens(tokens: NemiTokens) {
    await this.store.setItem(this.keys.tokens, JSON.stringify(tokens));
    this.tokens = tokens;
  }

  private async clearPending() {
    try {
      await this.store.removeItem(this.keys.pending);
    } catch {
      // Best effort.
    }
  }

  private async clearSession() {
    this.tokens = null;
    await Promise.all([
      this.store.removeItem(this.keys.tokens),
      this.store.removeItem(this.keys.user),
      this.store.removeItem(this.keys.pending),
    ]).catch(() => undefined);
  }
}

function randomToken(crypto: CryptoAdapter, byteCount = 16): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

function withBearer(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

function userInfoToUser(info: NemiUserInfo): NemiUser {
  const user: NemiUser = { id: info.sub };
  if (info.name) user.name = info.name;
  if (info.preferredUsername) user.username = info.preferredUsername;
  if (info.picture) user.picture = info.picture;
  if (info.email) user.email = info.email;
  if (typeof info.emailVerified === "boolean") user.emailVerified = info.emailVerified;
  return user;
}

function claimsToUser(c: Record<string, unknown>): NemiUser {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const user: NemiUser = { id: str(c.sub) ?? str(c.id) ?? "" };
  const name = str(c.name);
  const username = str(c.preferred_username) ?? str(c.username);
  const picture = str(c.picture);
  const email = str(c.email);
  if (name) user.name = name;
  if (username) user.username = username;
  if (picture) user.picture = picture;
  if (email) user.email = email;
  if (typeof c.email_verified === "boolean") user.emailVerified = c.email_verified;
  return user;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
