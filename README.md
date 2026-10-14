# @guuslab/nemi-react-native

"Sign in with Nemi" for React Native and Expo. It runs the OAuth 2.0
authorization code flow with PKCE in the system browser, keeps tokens in the
Keychain or Keystore, refreshes them for you and hands you the
[`@guuslab/nemi`](https://www.npmjs.com/package/@guuslab/nemi) REST client,
already signed in.

- Native apps are **public clients**: PKCE S256 always, no client secret,
  a private-use scheme redirect URI such as `com.example.app:/oauthredirect`
  (RFC 8252).
- Default adapters use Expo modules (`expo-web-browser`, `expo-secure-store`,
  `expo-crypto`). They work in Expo apps and in bare React Native apps with
  Expo modules installed. Each one can be swapped for your own.
- Refresh tokens are never written to AsyncStorage.

Docs and app registration: [dev.nemilab.com](https://dev.nemilab.com).

## Install

```sh
npx expo install @guuslab/nemi-react-native @guuslab/nemi expo-web-browser expo-secure-store expo-crypto
```

## Expo quick start

### 1. Pick a scheme and set it in `app.json`

Use a reverse domain name you own. The scheme is also your redirect URI's
scheme.

```json
{
  "expo": {
    "scheme": "com.example.app",
    "ios": { "bundleIdentifier": "com.example.app" },
    "android": { "package": "com.example.app" },
    "plugins": ["expo-secure-store", "expo-web-browser"]
  }
}
```

### 2. Register the redirect URI

At [dev.nemilab.com](https://dev.nemilab.com), create a **public** app and add
the redirect URI exactly as you will send it, for example:

```
com.example.app:/oauthredirect
```

Redirect URIs are matched exactly. Allow the scopes you need, and include
`offline_access` if you want a refresh token (without it the person has to
sign in again after an hour).

### 3. Wrap your app

```tsx
import { NemiProvider, SignInWithNemiButton, useNemi } from "@guuslab/nemi-react-native";

export default function App() {
  return (
    <NemiProvider
      clientId="nemi_app_..."
      redirectUri="com.example.app:/oauthredirect"
      scopes={["openid", "profile", "email", "offline_access", "gallery.read"]}
    >
      <Home />
    </NemiProvider>
  );
}

function Home() {
  const { user, isLoading, isSignedIn, signIn, signOut, client, error } = useNemi();

  if (!isSignedIn) return <SignInWithNemiButton />;

  const loadPhotos = async () => {
    const { photos } = await client.gallery.photos.list({ limit: 30 });
    // photos[i].thumbnailUrl expires after 15 minutes: fetch again, do not store it.
  };
  // ...
}
```

A dev build (`npx expo run:ios` / `run:android`) or a store build is needed:
Expo Go cannot use your own scheme.

The full example lives in [`example/`](./example): sign in, the profile and a
grid of gallery photos. Run `npm run build` in this folder first (the example
links the SDK's `dist`), then `npm install` and `npx expo run:ios` in
`example/`.

## API

### `<NemiProvider>`

Props are the `NemiNativeAuth` config, or `auth={instance}` to share an
instance you created yourself.

| Prop | Default | Notes |
| --- | --- | --- |
| `clientId` | required | `nemi_app_...` |
| `redirectUri` | required | e.g. `com.example.app:/oauthredirect` |
| `scopes` | `openid profile email offline_access` | Must be allowed on the app. |
| `browser` | `expoWebBrowserAdapter()` | See [Browser adapters](#browser-adapters). |
| `tokenStore` | `new SecureStoreTokenStore()` | See [Token storage](#token-storage). |
| `crypto` | `expoCryptoAdapter()` | See [Crypto](#crypto). |
| `issuer` | `https://nemilab.com/oauth` | |
| `apiBaseUrl` | `https://nemilab.com/api/v1` | |
| `fetch` | global `fetch` | |
| `linking` | React Native `Linking` | Pass `null` to handle deep links yourself. |

The provider listens for deep links (`Linking.getInitialURL()` and `url`
events) so a sign in still completes when Android killed the app while the
browser was open.

### `useNemi()`

| Field | Type |
| --- | --- |
| `user` | `NemiUser \| null` (`id`, `name`, `preferredUsername`, `picture`, `email`, `emailVerified`) |
| `isLoading` | `true` while the stored session loads or a sign in runs |
| `isSignedIn` | `boolean` |
| `signIn(options?)` | Resolves with the user, or `null` when cancelled or failed. Never throws. Options: `scopes`, `prompt` (`"consent"` or `"none"`). |
| `signOut()` | Revokes the refresh token at Nemi and clears the store |
| `client` | `NemiClient` from `@guuslab/nemi`, with automatic refresh |
| `error` | Last error, or `null`. A cancel is not an error. |
| `auth` | The underlying `NemiNativeAuth` |

### `<SignInWithNemiButton />`

A pill shaped `Pressable` with the Nemi wordmark, `accessibilityRole="button"`.
Without `onPress` it calls `signIn()` of the nearest provider and shows a
spinner while it runs.

| Prop | Default |
| --- | --- |
| `theme` | `"dark"` (black pill). Use `"light"` on dark backgrounds. |
| `size` | `"medium"` (`"small"`, `"medium"`, `"large"`) |
| `loading`, `disabled`, `fullWidth` | `false` |
| `label` | `"Sign in with"` |
| `onPress`, `style`, `testID` | |

### `NemiNativeAuth` (no React)

```ts
import { NemiNativeAuth, NemiCancelledError } from "@guuslab/nemi-react-native";
import { Linking } from "react-native";

const nemi = new NemiNativeAuth({ clientId: "nemi_app_...", redirectUri: "com.example.app:/oauthredirect" });
await nemi.initialize();

// Cold start and late deep links:
Linking.getInitialURL().then((url) => nemi.handleRedirectUrl(url));
Linking.addEventListener("url", ({ url }) => nemi.handleRedirectUrl(url));

try {
  const user = await nemi.signIn();
} catch (err) {
  if (err instanceof NemiCancelledError) {
    // The person closed the browser. Nothing to report.
  }
}

const me = await nemi.client.me();
const token = await nemi.getAccessToken(); // refreshed when about to expire
nemi.subscribe((state) => console.log(state.status));
await nemi.signOut();
```

Also available: `refresh()`, `reloadUser()`, `getTokens()`, `getState()`,
`fetch` (adds the bearer token and retries once after a refresh, but only for
URLs under `apiBaseUrl`; anything else, such as a presigned upload URL, goes
out without the token) and `core` (the core SDK's `NemiAuth`).

`prompt` supports only `"consent"` (always show the consent screen) and
`"none"` (never show any screen: when the person would have to sign in or
consent, the redirect carries an error and `signIn()` rejects with a
`NemiOAuthError`).

### Errors

| Error | When |
| --- | --- |
| `NemiCancelledError` | The person closed the browser or swiped the sheet away. |
| `NemiAccessDeniedError` | The person pressed Deny. |
| `NemiStateMismatchError` | The redirect's `state` does not match the request (or is missing). |
| `NemiOAuthError` (core) | Token endpoint or redirect error, e.g. `invalid_grant`, `invalid_issuer`. |
| `NemiNetworkError` (core) | Nemi could not be reached. The session is kept. |
| `NemiNotSignedInError` | An API call was made with nobody signed in. |
| `NemiConfigurationError` | A default adapter's Expo module is not installed. |

All of them extend the core `NemiError`. When a refresh is refused
(`invalid_grant`), the session is cleared and `isSignedIn` becomes `false`.

## Adapters

### Browser adapters

The default, `expoWebBrowserAdapter()`, calls
`WebBrowser.openAuthSessionAsync` (ASWebAuthenticationSession on iOS, Custom
Tabs on Android). Pass `expoWebBrowserAdapter({ preferEphemeralSession: true })`
to keep Safari cookies out of the session.

Bare React Native without Expo modules, using
[`react-native-inappbrowser-reborn`](https://github.com/proyecto26/react-native-inappbrowser):

```ts
import { InAppBrowser } from "react-native-inappbrowser-reborn";
import { inAppBrowserAdapter } from "@guuslab/nemi-react-native";

<NemiProvider browser={inAppBrowserAdapter(InAppBrowser)} ... />
```

Any other library (for example one built on ASWebAuthenticationSession)
works through the interface:

```ts
interface BrowserAdapter {
  openAuthSession(authorizeUrl: string, redirectUri: string): Promise<
    { type: "success"; url: string } | { type: "cancel" } | { type: "dismiss" }
  >;
}
```

### Token storage

The default `SecureStoreTokenStore` keeps tokens in the iOS Keychain
(`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) and the Android Keystore. Keys look
like `nemi.<clientId>.tokens`. For something else, implement:

```ts
interface TokenStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```

for example on `react-native-keychain` or `react-native-encrypted-storage`.
Do **not** back it with AsyncStorage: it is unencrypted, and a stolen refresh
token is a 90 day session. `MemoryTokenStore` exists for tests.

### Crypto

React Native has no `crypto.subtle`. PKCE needs random bytes and SHA-256, so
the default `expoCryptoAdapter()` wraps `expo-crypto` (`getRandomBytes` and
`digest` with SHA-256) as the WebCrypto subset the core SDK expects, and is
passed to the core `NemiAuth` as its `crypto`. PKCE itself is the core's
`createPkcePair`. Without Expo modules, install a
WebCrypto polyfill such as `react-native-quick-crypto` and pass:

```ts
import { webCryptoAdapter } from "@guuslab/nemi-react-native";
<NemiProvider crypto={webCryptoAdapter()} ... />
```

## Bare React Native setup

Install the Expo modules first (`npx install-expo-modules@latest`), or use the
adapters above. Then register the scheme natively.

**iOS**, `ios/<App>/Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.example.app</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.example.app</string>
    </array>
  </dict>
</array>
```

and forward URLs to React Native in `AppDelegate` (`RCTLinkingManager`
`application:openURL:options:`), as described in the React Native
[Linking docs](https://reactnative.dev/docs/linking).

**Android**, `android/app/src/main/AndroidManifest.xml`, inside your main
`<activity>` (keep `android:launchMode="singleTask"` so the redirect returns
to the running app):

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="com.example.app" />
</intent-filter>
```

## How it works

1. `signIn()` creates a PKCE verifier (32 random bytes), `state` and `nonce`,
   and saves them in the token store **before** the browser opens.
2. The browser shows the Nemi consent screen and returns to your redirect URI
   with `code`, `state` and `iss`.
3. `state` and `iss` are checked, the code is exchanged (public client, no
   secret) through the core SDK and the id_token's `aud`, `iss` and `nonce`
   are checked. It comes straight from the token endpoint over TLS, so its
   signature is not verified on the device.
4. Tokens are stored; the profile comes from UserInfo.
5. Access tokens are refreshed 60 seconds before they expire. Refreshes are
   single-flight: Nemi rotates refresh tokens and revokes the whole session
   when an old one is replayed, so two parallel refreshes must never happen.
6. `signOut()` revokes the refresh token (ending the grant's session) and
   clears local storage even when the device is offline.

## Troubleshooting

**The sheet shows a Nemi error page and only closing it gets you out
(`NemiCancelledError`).** The redirect URI (or the client ID) is not
registered. Nemi never redirects to an unregistered redirect URI (RFC 6749
section 4.1.2.1), so it shows the error in the browser instead, the sheet
stays on that page and closing it reads as a cancel. The redirect URI must
match the registered one character for character, including `:/` versus
`://`. If sign in "cancels" every time without the consent screen ever
appearing, check this first.

**The browser opens, I approve, and nothing happens.** The scheme is not
registered with the OS. Check `scheme` in `app.json` (and rebuild), or the
iOS URL types and Android intent-filter. Expo Go cannot receive custom
schemes; use a dev build.

**`signIn()` rejects with `NemiCancelledError`.** The person closed the
browser (or an error page; see above). `useNemi().signIn()` turns this into `null`, so only handle it when
you call `NemiNativeAuth` directly.

**Android: the app restarts after approving.** Low memory devices may kill
the app while the browser is open. Keep `NemiProvider` mounted at the root
(or call `handleRedirectUrl` with `Linking.getInitialURL()`): the sign in
completes from the saved verifier. Pending sign ins expire after 10 minutes.

**`NemiStateMismatchError`.** The redirect does not belong to the latest
sign in, for example a stale link or two sign ins started at once. Start
again.

**Signed out after a while.** Request `offline_access`, or the session lasts
only as long as the one hour access token. A refresh token refused with
`invalid_grant` (revoked in Settings, Connected apps, or unused for 90 days)
also signs the person out.

**`expo-secure-store is not installed`.** Install it with
`npx expo install expo-secure-store` or pass your own `tokenStore`. The same
goes for `expo-web-browser` (`browser`) and `expo-crypto` (`crypto`).

**Metro cannot resolve an Expo module you do not use.** The optional modules
are loaded with `require` inside `try`/`catch`, which Metro treats as an
optional dependency. If your Metro config sets
`transformer.allowOptionalDependencies` to `false`, install the modules or
turn it back on.

## Development

```sh
npm install --legacy-peer-deps
npm run typecheck
npm test
npm run build
```

`--legacy-peer-deps` skips the `expo` peer of the Expo modules, which are dev
dependencies here for their types only.

Package build: [tsup](https://tsup.egoist.dev). The package is TypeScript only
(no native code), so `react-native-builder-bob` adds nothing here. Metro uses
the CommonJS build, which keeps the optional `require` calls visible to it.

## License

MIT, see [LICENSE](./LICENSE).
