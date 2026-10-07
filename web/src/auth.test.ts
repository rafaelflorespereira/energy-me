import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserManager } from "oidc-client-ts";
import { AuthClient, authSettings } from "./auth";

const env = {
  VITE_COGNITO_ISSUER:
    "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example",
  VITE_COGNITO_CLIENT_ID: "public-client",
  VITE_COGNITO_DOMAIN: "https://energy.auth.us-east-1.amazoncognito.com",
};
const origin = "http://localhost:5173";

describe("Cognito settings", () => {
  it("uses Google authorization code login with renewal", () => {
    expect(authSettings(env, origin)).toMatchObject({
      response_type: "code",
      redirect_uri: `${origin}/auth/callback`,
      post_logout_redirect_uri: `${origin}/`,
      extraQueryParams: { identity_provider: "Google" },
      automaticSilentRenew: true,
    });
    expect(authSettings(env, origin).disablePKCE).not.toBe(true);
  });

  it("rejects missing configuration and unsafe URLs", () => {
    expect(() => authSettings({}, origin)).toThrow("Configure");
    expect(() =>
      authSettings(
        { ...env, VITE_COGNITO_DOMAIN: "http://example.com" },
        origin,
      ),
    ).toThrow("HTTPS");
    expect(() =>
      authSettings(
        { ...env, VITE_COGNITO_DOMAIN: `${env.VITE_COGNITO_DOMAIN}/login` },
        origin,
      ),
    ).toThrow("without a path");
    expect(() =>
      authSettings(
        {
          ...env,
          VITE_COGNITO_REDIRECT_URI: "https://other.app/auth/callback",
        },
        origin,
      ),
    ).toThrow("this app");
  });
});

describe("authentication lifecycle", () => {
  const user = { expired: false, profile: { sub: "alice" } };
  const manager = {
    settings: { redirect_uri: `${origin}/auth/callback` },
    getUser: vi.fn(),
    removeUser: vi.fn(),
    clearStaleState: vi.fn(),
    signinRedirectCallback: vi.fn(),
    signinSilent: vi.fn(),
    signinRedirect: vi.fn(),
    stopSilentRenew: vi.fn(),
  };
  const replaceState = vi.fn();
  const assign = vi.fn();
  const createClient = () =>
    new AuthClient(
      manager as unknown as UserManager,
      `${env.VITE_COGNITO_DOMAIN}/logout`,
      `${origin}/`,
    );

  beforeEach(() => {
    vi.resetAllMocks();
    manager.getUser.mockResolvedValue(user);
    manager.signinRedirectCallback.mockResolvedValue(user);
    vi.stubGlobal("window", {
      location: { href: `${origin}/`, assign },
      history: { replaceState },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("restores an existing session", async () => {
    expect(await createClient().initialize()).toBe(user);
    expect(manager.signinRedirectCallback).not.toHaveBeenCalled();
  });

  it("processes the callback only once, including under Strict Mode", async () => {
    window.location.href = `${origin}/auth/callback?code=code&state=state`;
    const client = createClient();
    const results = await Promise.all([
      client.initialize(),
      client.initialize(),
    ]);
    expect(results).toEqual([user, user]);
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, "", `${origin}/`);
  });

  it("delegates callback state validation and clears a rejected callback", async () => {
    window.location.href = `${origin}/auth/callback?code=code&state=invalid`;
    manager.signinRedirectCallback.mockRejectedValue(
      new Error("state mismatch"),
    );
    await expect(createClient().initialize()).rejects.toThrow("state mismatch");
    expect(manager.removeUser).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledOnce();
  });

  it("handles a denied Google login without restoring an old user", async () => {
    window.location.href = `${origin}/auth/callback?error=access_denied&state=state`;
    manager.signinRedirectCallback.mockRejectedValue(
      new Error("access_denied"),
    );
    await expect(createClient().initialize()).rejects.toThrow("access_denied");
    expect(manager.getUser).not.toHaveBeenCalled();
    expect(manager.removeUser).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledOnce();
  });

  it("renews an expired session with its refresh token", async () => {
    manager.getUser.mockResolvedValue({
      ...user,
      expired: true,
      refresh_token: "refresh",
    });
    manager.signinSilent.mockResolvedValue(user);
    expect(await createClient().initialize()).toBe(user);
    expect(manager.signinSilent).toHaveBeenCalledOnce();
  });

  it("discards a session when renewal fails", async () => {
    manager.getUser.mockResolvedValue({
      ...user,
      expired: true,
      refresh_token: "refresh",
    });
    manager.signinSilent.mockRejectedValue(new Error("expired refresh token"));
    expect(await createClient().initialize()).toBeNull();
    expect(manager.removeUser).toHaveBeenCalledOnce();
  });

  it("does not render an expired session without a refresh token", async () => {
    manager.getUser.mockResolvedValue({ ...user, expired: true });
    expect(await createClient().initialize()).toBeNull();
    expect(manager.removeUser).toHaveBeenCalledOnce();
  });

  it("starts Google login and clears the local user before hosted logout", async () => {
    const client = createClient();
    await client.signIn();
    expect(manager.signinRedirect).toHaveBeenCalledOnce();
    await client.signOut();
    expect(manager.stopSilentRenew).toHaveBeenCalledOnce();
    expect(manager.removeUser).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(`${env.VITE_COGNITO_DOMAIN}/logout`);
    expect(manager.removeUser.mock.invocationCallOrder[0]).toBeLessThan(
      assign.mock.invocationCallOrder[0],
    );
  });
});
