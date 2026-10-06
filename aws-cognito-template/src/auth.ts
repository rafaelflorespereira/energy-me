import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import {
  cognitoConfig,
  cognitoIdentityProviders,
  getDiscovery,
  getRedirectUri,
  type CognitoIdentityProvider,
} from "./cognito";

const KEYS = {
  idToken: "auth.id_token",
  accessToken: "auth.access_token",
  refreshToken: "auth.refresh_token",
};

export interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
}

export interface AuthUser {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  identityProvider?: CognitoIdentityProvider;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<AuthTokens> {
  const redirectUri = getRedirectUri();
  const discovery = await getDiscovery();
  const result = await AuthSession.exchangeCodeAsync(
    {
      clientId: cognitoConfig.clientId,
      code,
      redirectUri,
      extraParams: { code_verifier: codeVerifier },
    },
    discovery,
  );

  if (!result.idToken) {
    throw new Error("Cognito token response did not include an ID token");
  }

  const tokens: AuthTokens = {
    idToken: result.idToken,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken ?? null,
  };

  await saveTokens(tokens);
  return tokens;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<AuthTokens | null> {
  try {
    const discovery = await getDiscovery();
    const result = await AuthSession.refreshAsync(
      { clientId: cognitoConfig.clientId, refreshToken },
      discovery,
    );
    if (!result.idToken) {
      throw new Error("Cognito refresh response did not include an ID token");
    }
    const tokens: AuthTokens = {
      idToken: result.idToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken ?? refreshToken,
    };
    await saveTokens(tokens);
    return tokens;
  } catch {
    return null;
  }
}

export async function getStoredTokens(): Promise<AuthTokens | null> {
  const [idToken, accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(KEYS.idToken),
    SecureStore.getItemAsync(KEYS.accessToken),
    SecureStore.getItemAsync(KEYS.refreshToken),
  ]);

  if (!idToken || !accessToken) return null;
  return { idToken, accessToken, refreshToken };
}

export async function clearTokens(): Promise<void> {
  await Promise.all(
    Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)),
  );
}

export function parseIdToken(idToken: string): AuthUser {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("Invalid Cognito ID token");

  const decoded = decodeJwtPayload(payload);
  if (typeof decoded.sub !== "string" || typeof decoded.email !== "string") {
    throw new Error("Cognito ID token is missing required user claims");
  }

  return {
    sub: decoded.sub,
    email: decoded.email,
    name: typeof decoded.name === "string" ? decoded.name : undefined,
    picture: typeof decoded.picture === "string" ? decoded.picture : undefined,
    identityProvider: getIdentityProvider(decoded.identities),
  };
}

function decodeJwtPayload(payload: string): Record<string, unknown> {
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const percentEncoded = Array.from(binary, (char) =>
    `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
  ).join("");
  const decoded: unknown = JSON.parse(decodeURIComponent(percentEncoded));

  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid Cognito ID token payload");
  }
  return decoded as Record<string, unknown>;
}

function getIdentityProvider(
  identities: unknown,
): CognitoIdentityProvider | undefined {
  if (!Array.isArray(identities)) return undefined;

  for (const identity of identities) {
    if (typeof identity !== "object" || identity === null) continue;
    const providerName = Reflect.get(identity, "providerName");
    if (
      providerName === cognitoIdentityProviders.google ||
      providerName === cognitoIdentityProviders.apple
    ) {
      return providerName;
    }
  }

  return undefined;
}

async function saveTokens(tokens: AuthTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.idToken, tokens.idToken),
    SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken),
    tokens.refreshToken
      ? SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken)
      : SecureStore.deleteItemAsync(KEYS.refreshToken),
  ]);
}
