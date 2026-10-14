# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- README: an unregistered redirect URI shows a Nemi error page in the browser
  and never redirects (RFC 6749 section 4.1.2.1); closing it surfaces as
  `NemiCancelledError`, not `invalid_request`.
- `NemiUser.username` is now `preferredUsername`, matching the core SDK.
- `SignInOptions.prompt` accepts `"consent"` and `"none"`, the values Nemi supports.

## [0.1.0] - 2026-10-14

### Added

- `NemiNativeAuth`: "Sign in with Nemi" for React Native as a public client.
  Authorization code flow with PKCE S256, `state` and `nonce`, private-use
  scheme redirect URIs (RFC 8252), no client secret.
- Token exchange, refresh, revocation and UserInfo through the core
  `@guuslab/nemi` SDK; the REST API through its `NemiClient`, wired to
  refresh tokens automatically (single-flight, rotation-safe) and retry once
  on a 401.
- `NemiProvider`, `useNemi()` and `<SignInWithNemiButton />`.
- Pluggable adapters: `BrowserAdapter` (default `expo-web-browser`, plus
  `inAppBrowserAdapter` for `react-native-inappbrowser-reborn`), `TokenStore`
  (default `SecureStoreTokenStore` on `expo-secure-store`) and
  `CryptoAdapter` (default `expo-crypto`, or `webCryptoAdapter` with a
  WebCrypto polyfill), handed to the core SDK, whose `createPkcePair` makes
  the PKCE pair.
- `auth.fetch` only attaches the token to URLs under `apiBaseUrl`, so
  presigned upload URLs never see it.
- Distinct errors: `NemiCancelledError`, `NemiStateMismatchError`,
  `NemiAccessDeniedError`, `NemiNotSignedInError`, `NemiConfigurationError`.
- Android cold start: the pending sign in is saved before the browser opens
  and completed from the deep link that relaunches the app.
- Example Expo app with sign in, profile and a gallery grid.
