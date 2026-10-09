import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { User } from "oidc-client-ts";
import { getAuthClient, type AuthClient } from "../auth";
import { App } from "../App";
import { AccountMenu } from "./AccountMenu";
import { createCheckInsApi } from "../checkinsApi";
import {
  localRepository,
  remoteRepository,
  type CheckInRepository,
} from "../repository";

const API_URL = import.meta.env.VITE_CHECKINS_API_URL?.trim() || "";

export function AuthGate() {
  const [client, setClient] = useState<AuthClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let auth: AuthClient;
    try {
      auth = getAuthClient();
      setClient(auth);
    } catch {
      setError("O login está indisponível no momento.");
      setLoading(false);
      return;
    }
    const removeLoaded = auth.manager.events.addUserLoaded((next) => {
      if (active) setUser(next.expired ? null : next);
    });
    const removeUnloaded = auth.manager.events.addUserUnloaded(() => {
      if (active) setUser(null);
    });
    const removeExpired = auth.manager.events.addAccessTokenExpired(() => {
      if (!active) return;
      setUser(null);
      setError("Sua sessão expirou. Entre novamente.");
      void auth.manager.removeUser().catch(() => {
        if (active)
          setError("Não foi possível limpar a sessão. Recarregue a página.");
      });
    });
    void auth
      .initialize()
      .then((restored) => {
        if (active) setUser(restored);
      })
      .catch(() => {
        if (active)
          setError("Não foi possível entrar. Tente novamente com o Google.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      removeLoaded();
      removeUnloaded();
      removeExpired();
    };
  }, []);

  const signIn = async () => {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.signIn();
    } catch {
      setError("Não foi possível abrir o Google. Tente novamente.");
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.signOut();
    } catch {
      setUser(null);
      setError("Não foi possível concluir a saída. Tente entrar novamente.");
      setBusy(false);
    }
  };

  const userId = user?.profile.sub ?? "";
  const repository = useCallback(
    (signal: AbortSignal): CheckInRepository => {
      if (!API_URL || !client) return localRepository(userId);
      const manager = client.manager;
      return remoteRepository(
        createCheckInsApi({
          baseUrl: API_URL,
          signal,
          getToken: async (renew) => {
            try {
              const current = renew
                ? await manager.signinSilent()
                : await manager.getUser();
              if (!current || current.expired) return null;
              // Garante que o token é da conta que abriu esta tela.
              return current.profile.sub === userId
                ? current.access_token
                : null;
            } catch {
              return null;
            }
          },
        }),
      );
    },
    [client, userId],
  );

  if (loading) {
    return (
      <main className="auth-screen" aria-busy="true">
        <div className="auth-content auth-loading" role="status">
          <LoaderCircle className="auth-spinner" size={24} aria-hidden="true" />
          <p>Verificando sessão...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <div className="auth-content">
          <p className="auth-eyebrow">Energy Me</p>
          <h1>Quem sou eu como energia</h1>
          <p className="auth-subtitle">Sua energia, hoje.</p>
          <button
            className="google-signin"
            type="button"
            onClick={signIn}
            disabled={!client || busy}
          >
            {busy ? (
              <LoaderCircle
                className="auth-spinner"
                size={20}
                aria-hidden="true"
              />
            ) : (
              <img
                src="https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png"
                width="20"
                height="20"
                alt=""
              />
            )}
            {busy ? "Conectando..." : "Continuar com o Google"}
          </button>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <App
      key={user.profile.sub}
      repository={repository}
      accountHeader={
        <header className="account-bar">
          <span className="account-brand">Energy Me</span>
          <AccountMenu
            name={user.profile.name || user.profile.email || "Minha conta"}
            email={user.profile.email}
            remote={Boolean(API_URL && client)}
            busy={busy}
            onSignOut={signOut}
          />
        </header>
      }
    />
  );
}
