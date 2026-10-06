# Connect a new Expo project

## 1. Install the source package

Use an Expo SDK 54 app (Node.js 20.19.4 or later). The package's versions target
that SDK; upgrading the SDK requires aligning Expo packages with `expo install`
and rechecking native builds.

Copy the entire `aws-cognito-template/` directory into the new repository, for
example as `packages/aws-cognito-template/`. Do not copy the parent repository's
lockfile, `node_modules`, `.env`, app, or infrastructure.

For a single-app repository, from the **app root**:

```bash
npm install ./packages/aws-cognito-template
npx expo install expo-auth-session expo-crypto expo-secure-store expo-web-browser
```

This adds a local `file:` dependency named `@aws-cognito-template/auth`.
Keep the copied folder in version control alongside the app and commit the
app's generated lockfile. Do not depend on an absolute path to this repository.

For an npm monorepo instead, add `packages/*` (or the actual template directory)
to root `workspaces`, add `"@aws-cognito-template/auth": "*"` to the consuming
app's dependencies, and run `npm install` from the root. Install the Expo
modules above in the app workspace. Expo SDK 54's default Metro configuration
supports workspaces; custom Metro configs must allow access to the workspace
root and hoisted dependencies.

No files from `vs-helper`, `vs-shared`, or the VS backend are needed.

## 2. Configure this app's identity

Choose your own unique URL scheme, iOS bundle identifier, and Android package.
Merge these settings into the app's existing Expo config (do not discard other
plugins or settings):

```json
{
  "expo": {
    "scheme": "myapp",
    "ios": {
      "bundleIdentifier": "com.example.myapp",
      "usesAppleSignIn": true
    },
    "android": {
      "package": "com.example.myapp"
    },
    "plugins": ["expo-secure-store", "expo-apple-authentication"]
  }
}
```

If offering Apple sign-in, install its config plugin:

```bash
npx expo install expo-apple-authentication
```

Enable the same App ID capability in Apple Developer. Use Apple's native
`AppleAuthenticationButton` for the iOS sign-in button, calling the Cognito
browser flow from its `onPress`; do not call Apple's native credential flow
and pass its result to `exchangeCodeForTokens`.

Copy the template's `.env.example` into the **app root** as `.env`. Set the
new project's issuer/client ID and change the scheme/logout values:

```dotenv
EXPO_PUBLIC_COGNITO_ISSUER=https://cognito-idp.<region>.amazonaws.com/<pool-id>
EXPO_PUBLIC_USER_POOL_CLIENT_ID=<this-app-client-id>
EXPO_PUBLIC_APP_SCHEME=myapp
EXPO_PUBLIC_LOGOUT_URI=myapp://
```

Register `myapp://callback` and `myapp://` in this project's Cognito app client.
The library defaults to `cognitoapp` only when the scheme variable is absent;
set it explicitly in every app. Keep `.env` ignored. Environment variables are
inlined by Expo from the consuming app at bundle time, not read from the
library directory. Configure the same public values in your EAS build
environments, and restart Metro after changing them.

## 3. Add login to a screen

Call `WebBrowser.maybeCompleteAuthSession()` once in your app entry/root layout.
Use one request per provider so each request retains its own PKCE verifier.
The following minimal Google screen can be placed in `app/login.tsx` or used
as a component in a non-router app:

```tsx
import { useState } from "react";
import { Text, View } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import {
  issuer,
  cognitoConfig,
  cognitoIdentityProviders,
  getRedirectUri,
  exchangeCodeForTokens,
  parseIdToken,
  clearTokens,
  LoginButton,
  UserProfile,
  type AuthUser,
} from "@aws-cognito-template/auth";

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const discovery = AuthSession.useAutoDiscovery(issuer);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: cognitoConfig.clientId,
      scopes: cognitoConfig.scopes,
      redirectUri: getRedirectUri(),
      responseType: AuthSession.ResponseType.Code,
      codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
      extraParams: {
        identity_provider: cognitoIdentityProviders.google,
        prompt: "login",
      },
    },
    discovery,
  );

  async function signIn() {
    setError(null);
    setBusy(true);
    try {
      if (!request?.codeVerifier) throw new Error("Sign-in is not ready");
      const response = await promptAsync();
      if (response.type === "cancel" || response.type === "dismiss") return;
      if (response.type !== "success" || !response.params.code) {
        throw new Error(
          response.type === "error"
            ? response.error?.message ?? "Authorization failed"
            : "Authorization did not return a code",
        );
      }
      const tokens = await exchangeCodeForTokens(
        response.params.code,
        request.codeVerifier,
      );
      setUser(parseIdToken(tokens.idToken));
    } catch (cause) {
      console.error("[auth] sign-in failed", cause);
      setError(cause instanceof Error ? cause.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await clearTokens();
      setUser(null);
    } catch (cause) {
      console.error("[auth] local sign-out failed", cause);
      setError("Could not clear the session");
    }
  }

  return (
    <View>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {user ? (
        <UserProfile user={user} onSignOut={() => void signOut()} />
      ) : (
        <LoginButton
          label="Continue with Google"
          disabled={!request || !discovery || busy}
          loading={busy}
          onPress={() => void signIn()}
        />
      )}
    </View>
  );
}
```

For Apple, create a second `useAuthRequest` with
`identity_provider: cognitoIdentityProviders.apple`, and use that request's
`codeVerifier` when exchanging its response. Keep the hooks unconditional.
Show discovery/configuration failures in the UI as well: the minimal screen
above assumes valid configured issuer/client values. Do not log tokens,
authorization codes, or PKCE verifiers.

## 4. Wire the session lifecycle

The library does not automatically restore or refresh sessions. In your
app-level auth provider/root:

- On startup, call `getStoredTokens()`. If present, refresh with
  `refreshAccessToken(tokens.refreshToken)` before restoring the session when
  a refresh token exists. It saves renewed tokens and preserves/replaces the
  refresh token. If it returns `null`, surface the failed renewal, clear the
  unusable session, and show sign-in again. Handle storage/claim parsing errors
  explicitly. Do not treat the presence of stored tokens as proof of validity.
- Refresh before token expiry and retry an unauthorized API call at most once
  after successful refresh. Serialize refreshes in the app so concurrent
  requests do not race refresh-token rotation.
- `parseIdToken()` is for display only. Your backend must verify signatures,
  issuer, expiry, token use, and the intended app client. For new protected
  APIs, prefer an **access token** and configure its scopes/authorizer; don't
  copy an unrelated project's ID-token authorizer without understanding it.
- On account switching/sign-out, clear application caches and per-user state
  in addition to auth tokens. Identify users by verified `sub` on the backend,
  not by email. Linking Apple/Google accounts is a separate backend decision.

`clearTokens()` implements **local sign-out only**, as in the current consumer.
For browser-session sign-out, open the Cognito domain's `/logout` URL with
`client_id` and URL-encoded `logout_uri` (the registered
`cognitoConfig.logoutUri`). This does not sign out of Google/Apple themselves.
For refresh-token revocation, use the discovery `revocationEndpoint` /
Cognito `/oauth2/revoke` with the public client ID and refresh token.
Handle revocation/browser errors explicitly; neither action instantly
invalidates all previously issued JWTs at your custom backend.

## 5. Build and check the new integration

Install a native development build; **Expo Go is not suitable for OAuth**.
For example, from the consuming app:

```bash
npx expo install expo-dev-client
npx eas-cli build:configure
npx eas-cli build --profile development --platform ios
# Install the build, then:
npx expo start --dev-client
```

Use an EAS development profile with `developmentClient: true` and
`distribution: "internal"`; register an iOS device when prompted. Use
`--platform android` for Android. Create a new EAS project for the new app;
never copy another app's EAS project ID or store signing credentials.
Rebuild after changing the URL scheme, plugins, or native app identifiers.

Check both providers, cancellation/error UI, exact redirect URI, persisted
session after restart, refresh and renewal failure, local/browser sign-out,
and account switching before shipping. The app's build environment must use
the same pool/client/scheme values as the tested configuration.
