import {
  UserManager,
  WebStorageStateStore,
  type User,
  type UserManagerSettings,
} from "oidc-client-ts";

type AuthEnvironment = Record<string, string | undefined>;

export function authSettings(
  env: AuthEnvironment,
  origin: string,
): UserManagerSettings {
  const authority = env.VITE_COGNITO_ISSUER?.trim();
  const clientId = env.VITE_COGNITO_CLIENT_ID?.trim();
  const domain = env.VITE_COGNITO_DOMAIN?.trim();
  if (!authority || !clientId || !domain) {
    throw new Error(
      "Configure VITE_COGNITO_ISSUER, VITE_COGNITO_CLIENT_ID and VITE_COGNITO_DOMAIN.",
    );
  }
  for (const value of [authority, domain]) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "Cognito URLs must use HTTPS without credentials, query strings or fragments.",
      );
    }
  }
  if (new URL(domain).pathname !== "/") {
    throw new Error(
      "VITE_COGNITO_DOMAIN must be the managed login origin, without a path.",
    );
  }
  const redirectUri =
    env.VITE_COGNITO_REDIRECT_URI || `${origin}/auth/callback`;
  const logoutUri = env.VITE_COGNITO_LOGOUT_URI || `${origin}/`;
  for (const value of [redirectUri, logoutUri]) {
    const url = new URL(value);
    if (
      url.origin !== origin ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "Callback and logout URLs must belong to this app and have no query or fragment.",
      );
    }
  }
  return {
    authority,
    client_id: clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: logoutUri,
    response_type: "code",
    scope: "openid email profile",
    automaticSilentRenew: true,
    validateSubOnSilentRenew: true,
    loadUserInfo: false,
    monitorSession: false,
    extraQueryParams: { identity_provider: "Google" },
  };
}

export class AuthClient {
  private initialization: Promise<User | null> | undefined;

  constructor(
    readonly manager: UserManager,
    private readonly logoutUrl: string,
    private readonly homeUrl: string,
  ) {}

  initialize(): Promise<User | null> {
    this.initialization ??= this.restoreSession();
    return this.initialization;
  }

  private async restoreSession(): Promise<User | null> {
    const url = new URL(window.location.href);
    const callbackPath = new URL(this.manager.settings.redirect_uri).pathname;
    if (url.pathname === callbackPath) {
      try {
        return await this.manager.signinRedirectCallback(url.href);
      } catch (error) {
        await this.manager.removeUser();
        throw error;
      } finally {
        window.history.replaceState(null, "", this.homeUrl);
      }
    }
    await this.manager.clearStaleState();
    const user = await this.manager.getUser();
    if (!user) return null;
    if (!user.expired) return user;
    if (user.refresh_token) {
      try {
        return await this.manager.signinSilent();
      } catch {
        await this.manager.removeUser();
        return null;
      }
    }
    await this.manager.removeUser();
    return null;
  }

  async signIn(): Promise<void> {
    await this.manager.clearStaleState();
    await this.manager.signinRedirect();
  }

  async signOut(): Promise<void> {
    this.manager.stopSilentRenew();
    await this.manager.removeUser();
    window.location.assign(this.logoutUrl);
  }
}

let client: AuthClient | undefined;

export function getAuthClient(): AuthClient {
  if (client) return client;
  const settings = authSettings(import.meta.env, window.location.origin);
  const logoutUrl = new URL("/logout", import.meta.env.VITE_COGNITO_DOMAIN);
  logoutUrl.search = new URLSearchParams({
    client_id: settings.client_id,
    logout_uri: settings.post_logout_redirect_uri!,
  }).toString();
  const manager = new UserManager({
    ...settings,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
  client = new AuthClient(
    manager,
    logoutUrl.href,
    settings.post_logout_redirect_uri!,
  );
  return client;
}
