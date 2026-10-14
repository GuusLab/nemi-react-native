// Ambient declaration of the part of `@guuslab/nemi` this package uses, so
// the package typechecks before the core SDK is published. It mirrors the
// core's public API (verified against ../js/src). Delete this file once
// `@guuslab/nemi` is installed from the registry: its own types take over.
declare module "@guuslab/nemi" {
  export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

  export interface CryptoLike {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T;
    subtle: SubtleCrypto;
  }

  export interface PkcePair {
    codeVerifier: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
  }

  export function createPkcePair(crypto?: CryptoLike): Promise<PkcePair>;
  export function createCodeChallenge(codeVerifier: string, crypto?: CryptoLike): Promise<string>;

  export interface TokenSet {
    accessToken: string;
    tokenType: "Bearer" | (string & {});
    expiresIn?: number;
    expiresAt?: number;
    refreshToken?: string;
    scope?: string;
    idToken?: string;
  }

  export interface NemiUser {
    id: string;
    name?: string;
    username?: string;
    picture?: string;
    email?: string;
    emailVerified?: boolean;
  }

  export interface NemiUserInfo {
    sub: string;
    name?: string;
    preferredUsername?: string;
    picture?: string;
    email?: string;
    emailVerified?: boolean;
    [claim: string]: unknown;
  }

  export interface NemiDiscoveryDocument {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    revocation_endpoint?: string;
    userinfo_endpoint?: string;
    jwks_uri: string;
    [field: string]: unknown;
  }

  export interface NemiAuthOptions {
    clientId: string;
    clientSecret?: string;
    issuer?: string;
    apiBaseUrl?: string;
    fetch?: FetchLike;
    crypto?: CryptoLike;
    clockToleranceSeconds?: number;
  }

  export class NemiAuth {
    constructor(options: NemiAuthOptions);
    readonly clientId: string;
    readonly issuer: string;
    readonly apiBaseUrl: string;
    discover(): Promise<NemiDiscoveryDocument>;
    exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>;
    refresh(refreshToken: string, options?: { scope?: string | string[] }): Promise<TokenSet>;
    revoke(token: string, options?: { tokenTypeHint?: "access_token" | "refresh_token" }): Promise<void>;
    userInfo(accessToken: string): Promise<NemiUserInfo>;
  }

  export interface TokenProvider {
    getAccessToken(): Promise<string>;
  }

  export interface NemiClientOptions {
    accessToken?: string;
    tokenProvider?: TokenProvider;
    tokens?: TokenSet;
    auth?: NemiAuth;
    apiBaseUrl?: string;
    fetch?: FetchLike;
    maxRetries?: number;
  }

  export class NemiClient {
    constructor(auth: string | TokenProvider | NemiClientOptions);
  }

  export class NemiError extends Error {
    constructor(message: string, options?: { cause?: unknown });
  }

  export type NemiOAuthErrorCode =
    | "invalid_request"
    | "invalid_grant"
    | "access_denied"
    | "server_error"
    | "invalid_state"
    | "invalid_issuer"
    | "invalid_id_token"
    | (string & {});

  export class NemiOAuthError extends NemiError {
    constructor(error: NemiOAuthErrorCode, errorDescription?: string, init?: { status?: number; cause?: unknown });
    readonly error: NemiOAuthErrorCode;
    readonly errorDescription?: string;
    readonly status?: number;
  }

  export class NemiApiError extends NemiError {
    readonly status: number;
    readonly code: string;
  }

  export class NemiNetworkError extends NemiError {}
  export class NemiRateLimitError extends NemiApiError {}
}
