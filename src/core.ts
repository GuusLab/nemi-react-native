// The only file that imports the core SDK. If the core API changes, this is
// the one place to update.
import { NemiAuth, NemiClient, type CryptoLike, type FetchLike } from "@guuslab/nemi";

export {
  NemiAuth,
  NemiClient,
  NemiError,
  NemiOAuthError,
  NemiApiError,
  NemiNetworkError,
  NemiRateLimitError,
  createPkcePair,
  createCodeChallenge,
  type CryptoLike,
  type FetchLike,
  type PkcePair,
  type TokenSet,
  type NemiUser,
  type NemiUserInfo,
} from "@guuslab/nemi";

export function createCoreAuth(options: {
  clientId: string;
  issuer: string;
  apiBaseUrl: string;
  fetch: FetchLike;
  crypto: () => CryptoLike;
}) {
  // Native apps are public clients: never a clientSecret here.
  return new NemiAuth({
    clientId: options.clientId,
    issuer: options.issuer,
    apiBaseUrl: options.apiBaseUrl,
    fetch: options.fetch,
    // The injected native crypto adapter (expo-crypto by default).
    crypto: options.crypto(),
  });
}

/**
 * The core REST client. The fetch we pass already attaches the access token
 * and refreshes plus retries once on a 401, and the token provider refreshes
 * ahead of expiry, so the core client needs no knowledge of native storage.
 */
export function createCoreClient(options: {
  apiBaseUrl: string;
  fetch: FetchLike;
  getAccessToken: () => Promise<string>;
}): NemiClient {
  return new NemiClient({
    tokenProvider: { getAccessToken: options.getAccessToken },
    apiBaseUrl: options.apiBaseUrl,
    fetch: options.fetch,
  });
}
