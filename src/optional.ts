// Optional native modules are loaded lazily with a literal `require(...)`
// inside try/catch. Metro treats such requires as optional dependencies, so an
// app that passes its own adapters does not need the Expo module installed.
declare const require: (id: string) => unknown;

export function loadExpoCrypto(): typeof import("expo-crypto") | null {
  try {
    return require("expo-crypto") as typeof import("expo-crypto");
  } catch {
    return null;
  }
}

export function loadExpoSecureStore(): typeof import("expo-secure-store") | null {
  try {
    return require("expo-secure-store") as typeof import("expo-secure-store");
  } catch {
    return null;
  }
}

export function loadExpoWebBrowser(): typeof import("expo-web-browser") | null {
  try {
    return require("expo-web-browser") as typeof import("expo-web-browser");
  } catch {
    return null;
  }
}

export function loadReactNativeLinking(): typeof import("react-native").Linking | null {
  try {
    return (require("react-native") as typeof import("react-native")).Linking;
  } catch {
    return null;
  }
}
