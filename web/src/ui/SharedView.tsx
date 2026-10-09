import { useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { fetchSharedView, tokenFromHash } from "../checkinsApi";
import { type CheckIn } from "../domain/checkins";
import { toDateKey } from "../domain/dates";
import { Scenery, useSceneryMotion } from "./Scenery";
import { sceneForToday } from "./scenery";
import { SummaryScreen } from "./SummaryScreen";
import { longDate } from "./copy";

const API_URL = import.meta.env.VITE_CHECKINS_API_URL?.trim() || "";

type State =
  | { kind: "loading" }
  | { kind: "gone" }
  | { kind: "error" }
  | { kind: "ready"; checkins: CheckIn[]; expiresAt: string | null };

/**
 * O que quem recebeu o link vê: o resumo e o cenário do dia, sem login e sem
 * nada que altere os dados. Não mostra nome nem e-mail de quem compartilhou.
 */
export function SharedView() {
  const token = useMemo(() => tokenFromHash(window.location.hash), []);
  const [state, setState] = useState<State>(
    token && API_URL ? { kind: "loading" } : { kind: "gone" },
  );
  const [attempt, setAttempt] = useState(0);
  const today = useMemo(() => toDateKey(new Date()), []);
  const motion = useSceneryMotion();

  useEffect(() => {
    if (!token || !API_URL) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchSharedView(API_URL, token, { signal: controller.signal }).then(
      (view) => {
        if (controller.signal.aborted) return;
        setState(view ? { kind: "ready", ...view } : { kind: "gone" });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      },
    );
    return () => controller.abort();
  }, [token, attempt]);

  const scene =
    state.kind === "ready" ? sceneForToday(state.checkins, today) : null;

  return (
    <div className="app shared">
      <header className="account-bar">
        <span className="account-brand">
          <span className="account-brand-name">Energy Me</span>
        </span>
        <span className="shared-badge">
          <Eye size={16} aria-hidden="true" />
          Somente leitura
        </span>
      </header>
      <div className="stage">
        {scene ? (
          <Scenery scene={scene} visible motion={motion} paused={false} />
        ) : null}
        <main className={`view view-summary${scene ? " with-scenery" : ""}`}>
          {state.kind === "loading" ? (
            <section className="card empty" role="status" aria-busy="true">
              <p>Carregando...</p>
            </section>
          ) : state.kind === "gone" ? (
            <section className="card empty">
              <h2>Link indisponível</h2>
              <p>
                Este link foi desativado, venceu ou está incompleto. Peça um
                novo a quem compartilhou com você.
              </p>
            </section>
          ) : state.kind === "error" ? (
            <section className="card empty">
              <h2>Não foi possível carregar</h2>
              <p role="alert">Verifique a conexão e tente de novo.</p>
              <button
                className="cta"
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Tentar de novo
              </button>
            </section>
          ) : (
            <>
              <SummaryScreen
                checkins={state.checkins}
                today={today}
                title="Resumo compartilhado"
              />
              <p className="footer shared-note">
                Compartilhado com você para leitura
                {state.expiresAt
                  ? `, até ${longDate(toDateKey(new Date(state.expiresAt)))}`
                  : ""}
                . Mostra os últimos 60 dias.
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
