import { NemiConfigurationError } from "./errors";
import { loadExpoSecureStore } from "./optional";

/**
 * Key/value storage for tokens. Implementations MUST be encrypted at rest
 * (Keychain, Keystore). Never back this with AsyncStorage: it is plain text.
 */
export interface TokenStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SecureStoreTokenStoreOptions {
  /** iOS Keychain accessibility. Defaults to AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY. */
  keychainAccessible?: number;
  /** iOS Keychain service name, for apps that share a keychain group. */
  keychainService?: string;
}

/** Default store, backed by `expo-secure-store` (Keychain on iOS, Keystore on Android). */
export class SecureStoreTokenStore implements TokenStore {
  private readonly store: typeof import("expo-secure-store");
  private readonly options: import("expo-secure-store").SecureStoreOptions;

  constructor(options: SecureStoreTokenStoreOptions = {}) {
    const store = loadExpoSecureStore();
    if (!store) {
      throw new NemiConfigurationError(
        "expo-secure-store is not installed. Run `npx expo install expo-secure-store`, or pass your own `tokenStore`.",
      );
    }
    this.store = store;
    this.options = {
      keychainAccessible: options.keychainAccessible ?? store.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      ...(options.keychainService ? { keychainService: options.keychainService } : {}),
    };
  }

  getItem(key: string): Promise<string | null> {
    return this.store.getItemAsync(key, this.options);
  }

  setItem(key: string, value: string): Promise<void> {
    return this.store.setItemAsync(key, value, this.options);
  }

  removeItem(key: string): Promise<void> {
    return this.store.deleteItemAsync(key, this.options);
  }
}

/** In-memory store. For tests, or for apps that want sign-in to last only for the process. */
export class MemoryTokenStore implements TokenStore {
  private readonly map = new Map<string, string>();
  async getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  async removeItem(key: string) {
    this.map.delete(key);
  }
}

/** SecureStore keys may only contain letters, digits, `.`, `-` and `_`. */
export function storageKey(prefix: string, clientId: string, name: string): string {
  return `${prefix}.${clientId}.${name}`.replace(/[^A-Za-z0-9._-]/g, "_");
}
