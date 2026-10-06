import * as AuthSession from "expo-auth-session";

/**
 * These map 1:1 to the "OIDC properties" on the Cognito console page
 * "Add the example code to your application":
 *
 *   issuer      -> EXPO_PUBLIC_COGNITO_ISSUER
 *   clientID    -> EXPO_PUBLIC_USER_POOL_CLIENT_ID
 *   redirectURI -> resolved automatically from the app scheme (getRedirectUri)
 *   logoutURL   -> EXPO_PUBLIC_LOGOUT_URI (optional)
 *
 * The env vars are provided (and inlined at build time) by the consuming app.
 * The hosted-UI (managed login) authorize / token / revoke endpoints are
 * discovered from the issuer, so you never hardcode the domain prefix.
 */
export const issuer = process.env.EXPO_PUBLIC_COGNITO_ISSUER ?? "";
const clientId = process.env.EXPO_PUBLIC_USER_POOL_CLIENT_ID ?? "";
const scheme = process.env.EXPO_PUBLIC_APP_SCHEME ?? "cognitoapp";

export const cognitoIdentityProviders = {
  google: "Google",
  apple: "SignInWithApple",
} as const;

export type CognitoIdentityProvider =
  (typeof cognitoIdentityProviders)[keyof typeof cognitoIdentityProviders];

export const cognitoConfig = {
  clientId,
  scopes: ["openid", "email", "profile"],
  logoutUri: process.env.EXPO_PUBLIC_LOGOUT_URI ?? "",
};

// Cached discovery for the non-hook code paths (token exchange / refresh).
// Components should use AuthSession.useAutoDiscovery(issuer) instead.
let discoveryPromise: Promise<AuthSession.DiscoveryDocument> | null = null;
export function getDiscovery(): Promise<AuthSession.DiscoveryDocument> {
  if (!issuer) {
    return Promise.reject(
      new Error("EXPO_PUBLIC_COGNITO_ISSUER is not configured"),
    );
  }

  if (!discoveryPromise) {
    discoveryPromise = AuthSession.fetchDiscoveryAsync(issuer).catch((error) => {
      discoveryPromise = null;
      throw error;
    });
  }
  return discoveryPromise;
}

// makeRedirectUri resolves to:
//  - Expo Go (simulator): exp://localhost:8081
//  - Expo Go (device):    exp://<local-ip>:8081
//  - Development / standalone build: <app-scheme>://callback
export function getRedirectUri() {
  return AuthSession.makeRedirectUri({
    scheme,
    path: "callback",
  });
}
