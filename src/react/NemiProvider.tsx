import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NemiClient } from "../core";
import { NemiCancelledError } from "../errors";
import {
  NemiNativeAuth,
  type NemiAuthState,
  type NemiNativeAuthConfig,
  type NemiUser,
  type SignInOptions,
} from "../NemiNativeAuth";
import { loadReactNativeLinking } from "../optional";

/** The subset of React Native's `Linking` the provider needs. Injectable for tests. */
export interface LinkingLike {
  getInitialURL(): Promise<string | null>;
  addEventListener(type: "url", handler: (event: { url: string }) => void): { remove(): void };
}

export type NemiProviderProps =
  | (NemiNativeAuthConfig & { children?: ReactNode; auth?: undefined; linking?: LinkingLike | null })
  | { auth: NemiNativeAuth; children?: ReactNode; linking?: LinkingLike | null };

export interface UseNemiResult {
  user: NemiUser | null;
  /** True until the stored session has been read, and while a sign in is running. */
  isLoading: boolean;
  isSignedIn: boolean;
  /** Resolves with the user, or null when the person cancelled or it failed (see `error`). Never throws. */
  signIn(options?: SignInOptions): Promise<NemiUser | null>;
  signOut(): Promise<void>;
  /** The core REST client with automatic token refresh. */
  client: NemiClient;
  /** Last error, or null. A cancelled sign in is not an error. */
  error: Error | null;
  /** The underlying non-React instance. */
  auth: NemiNativeAuth;
}

const NemiContext = createContext<NemiNativeAuth | null>(null);

/**
 * Holds the Nemi session for the app. Pass the config (clientId, redirectUri,
 * scopes) or a ready `NemiNativeAuth` instance as `auth`.
 */
export function NemiProvider(props: NemiProviderProps) {
  const { children, linking } = props;
  const configRef = useRef(props);
  const [auth] = useState<NemiNativeAuth>(() => {
    const p = configRef.current;
    if (p.auth) return p.auth;
    const { children: _c, linking: _l, auth: _a, ...config } = p;
    return new NemiNativeAuth(config);
  });

  useEffect(() => {
    void auth.initialize();
    const Linking = linking === undefined ? loadReactNativeLinking() : linking;
    if (!Linking) return;
    let active = true;
    // Android cold start: the redirect relaunched the app.
    Linking.getInitialURL()
      .then((url) => (active ? auth.handleRedirectUrl(url) : false))
      .catch(() => undefined);
    const sub = Linking.addEventListener("url", ({ url }) => {
      void auth.handleRedirectUrl(url);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [auth, linking]);

  return <NemiContext.Provider value={auth}>{children}</NemiContext.Provider>;
}

/** Returns the instance from the nearest `NemiProvider`, or null outside one. */
export function useNemiAuthInstance(): NemiNativeAuth | null {
  return useContext(NemiContext);
}

export function useNemi(): UseNemiResult {
  const auth = useContext(NemiContext);
  if (!auth) throw new Error("useNemi() must be used inside <NemiProvider>.");
  const [state, setState] = useState<NemiAuthState>(() => auth.getState());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setState(auth.getState());
    return auth.subscribe(setState);
  }, [auth]);

  const signIn = useCallback(
    async (options?: SignInOptions) => {
      setBusy(true);
      try {
        return await auth.signIn(options);
      } catch (err) {
        if (!(err instanceof NemiCancelledError)) console.warn("[nemi] sign in failed:", err);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [auth],
  );

  const signOut = useCallback(() => auth.signOut(), [auth]);

  return useMemo(
    () => ({
      user: state.user,
      isLoading: state.status === "loading" || busy,
      isSignedIn: state.status === "signedIn",
      signIn,
      signOut,
      client: auth.client,
      error: state.error,
      auth,
    }),
    [state, busy, signIn, signOut, auth],
  );
}
