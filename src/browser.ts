import { NemiConfigurationError } from "./errors";
import { loadExpoWebBrowser } from "./optional";

/** Outcome of an in-app auth browser session. */
export type BrowserResult =
  | { type: "success"; url: string }
  | { type: "cancel" }
  | { type: "dismiss" };

/**
 * Opens the authorize URL in a system auth session (ASWebAuthenticationSession
 * on iOS, Custom Tabs on Android) and resolves when the browser comes back to
 * `redirectUri` or is closed.
 */
export interface BrowserAdapter {
  openAuthSession(authorizeUrl: string, redirectUri: string): Promise<BrowserResult>;
}

export interface ExpoWebBrowserAdapterOptions {
  /** iOS: do not share cookies with Safari. Default false. */
  preferEphemeralSession?: boolean;
}

/** Default adapter, backed by `expo-web-browser`. */
export function expoWebBrowserAdapter(options: ExpoWebBrowserAdapterOptions = {}): BrowserAdapter {
  const WebBrowser = loadExpoWebBrowser();
  if (!WebBrowser) {
    throw new NemiConfigurationError(
      "expo-web-browser is not installed. Run `npx expo install expo-web-browser`, or pass your own `browser` adapter.",
    );
  }
  return {
    async openAuthSession(url, redirectUri) {
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri, {
        preferEphemeralSession: options.preferEphemeralSession ?? false,
      });
      if (result.type === "success") return { type: "success", url: result.url };
      if (result.type === "cancel") return { type: "cancel" };
      return { type: "dismiss" };
    },
  };
}

/** The part of `react-native-inappbrowser-reborn` we use. */
export interface InAppBrowserLike {
  isAvailable(): Promise<boolean>;
  openAuth(
    url: string,
    redirectUrl: string,
    options?: Record<string, unknown>,
  ): Promise<{ type: string; url?: string }>;
}

/**
 * Adapter for bare React Native apps using `react-native-inappbrowser-reborn`:
 *
 * ```ts
 * import { InAppBrowser } from "react-native-inappbrowser-reborn";
 * browser: inAppBrowserAdapter(InAppBrowser)
 * ```
 */
export function inAppBrowserAdapter(
  InAppBrowser: InAppBrowserLike,
  options: Record<string, unknown> = { ephemeralWebSession: false, showTitle: false, enableUrlBarHiding: true },
): BrowserAdapter {
  return {
    async openAuthSession(url, redirectUri) {
      if (!(await InAppBrowser.isAvailable())) {
        throw new NemiConfigurationError("No in-app browser is available on this device.");
      }
      const result = await InAppBrowser.openAuth(url, redirectUri, options);
      if (result.type === "success" && result.url) return { type: "success", url: result.url };
      return result.type === "dismiss" ? { type: "dismiss" } : { type: "cancel" };
    },
  };
}
