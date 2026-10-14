import { type CryptoLike } from "./core";
import { NemiConfigurationError } from "./errors";
import { loadExpoCrypto } from "./optional";

/**
 * The WebCrypto subset the core SDK needs (`getRandomValues` and
 * `subtle.digest("SHA-256")`). React Native does not ship `crypto.subtle`,
 * so this is injectable and is handed to the core SDK as its `crypto`.
 */
export type CryptoAdapter = CryptoLike;

/** Default adapter, backed by `expo-crypto` (`getRandomBytes` and `digest`). */
export function expoCryptoAdapter(): CryptoAdapter {
  const ExpoCrypto = loadExpoCrypto();
  if (!ExpoCrypto) {
    throw new NemiConfigurationError(
      "expo-crypto is not installed. Run `npx expo install expo-crypto`, or pass `crypto: webCryptoAdapter()` with a WebCrypto polyfill.",
    );
  }
  const subtle = {
    async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
      const name = typeof algorithm === "string" ? algorithm : algorithm.name;
      if (name.toUpperCase() !== "SHA-256") {
        throw new NemiConfigurationError(`expoCryptoAdapter only supports SHA-256, not ${name}.`);
      }
      return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
    },
  };
  return {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (!array) return array;
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      view.set(ExpoCrypto.getRandomBytes(array.byteLength));
      return array;
    },
    // Only `digest` is implemented: enough for PKCE. The core's id_token
    // signature check (ECDSA) is not used on device.
    subtle: subtle as unknown as SubtleCrypto,
  };
}

/**
 * Adapter for a runtime with full WebCrypto, for example after installing a
 * polyfill such as `react-native-quick-crypto`. Defaults to `globalThis.crypto`.
 */
export function webCryptoAdapter(webCrypto?: {
  subtle: SubtleCrypto;
  getRandomValues(array: never): unknown;
}): CryptoAdapter {
  // Typed loosely: Node's, the DOM's and polyfills' `getRandomValues` signatures differ slightly.
  const c = (webCrypto ?? (globalThis as { crypto?: unknown }).crypto) as CryptoLike | undefined;
  if (!c?.subtle || typeof c.getRandomValues !== "function") {
    throw new NemiConfigurationError("WebCrypto (crypto.subtle) is not available in this runtime.");
  }
  return c;
}
