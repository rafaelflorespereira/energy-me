import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type CheckIn } from "./domain/checkins";
import { toDateKey } from "./domain/dates";
import { type Values } from "./domain/feelings";
import { sampleCheckIns } from "./domain/sample";
import { type CheckInRepository } from "./repository";
import { CheckInScreen } from "./ui/CheckInScreen";
import { Scenery, useSceneryMotion, useSceneryPrefs } from "./ui/Scenery";
import { sceneForToday } from "./ui/scenery";
import { SummaryScreen } from "./ui/SummaryScreen";

type Tab = "checkin" | "resumo";

const CheckInIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="5" cy="12" r="1.6" fill="currentColor" />
    <circle cx="11" cy="12" r="2.6" />
    <circle cx="18.5" cy="12" r="3.6" />
  </svg>
);
const SummaryIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 19V5M4 19h16" />
    <path d="M7 15l4-4 3 2 5-6" />
  </svg>
);

export function App({
  repository: createRepository,
  accountHeader,
}: {
  /** Criado uma vez por conta; o sinal cancela pedidos ao sair ou trocar de conta. */
  repository: (signal: AbortSignal) => CheckInRepository;
  accountHeader: ReactNode;
}) {
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [tab, setTab] = useState<Tab>("checkin");
  const [toast, setToast] = useState(false);
  const today = useMemo(() => toDateKey(new Date()), []);
  const repo = useRef<CheckInRepository | null>(null);
  const signal = useRef<AbortSignal | null>(null);

  const load = useCallback(() => {
    const r = repo.current;
    const s = signal.current;
    if (!r || !s) return;
    setStatus("loading");
    r.load().then(
      (list) => {
        if (s.aborted) return;
        setCheckins(list);
        setStatus("ready");
      },
      () => {
        if (!s.aborted) setStatus("error");
      },
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    repo.current = createRepository(controller.signal);
    signal.current = controller.signal;
    load();
    return () => controller.abort();
  }, [createRepository, load]);

  const replaceAll = (list: CheckIn[]) => {
    setCheckins(list);
    repo.current?.replaceAll?.(list);
  };

  const todays = checkins.find((c) => c.date === today)?.values ?? null;
  const scene = useMemo(() => sceneForToday(checkins, today), [checkins, today]);
  const [sceneryPrefs, setSceneryPrefs] = useSceneryPrefs();
  const sceneryMotion = useSceneryMotion();
  const showScenery =
    tab === "resumo" && status === "ready" && sceneryPrefs.enabled && scene !== null;
  // Mantém o cenário montado por um instante ao sair, para ele sumir com fade.
  const [sceneryMounted, setSceneryMounted] = useState(showScenery);
  useEffect(() => {
    if (showScenery) {
      setSceneryMounted(true);
      return;
    }
    const t = window.setTimeout(() => setSceneryMounted(false), 700);
    return () => window.clearTimeout(t);
  }, [showScenery]);

  const save = async (values: Values) => {
    const r = repo.current;
    const s = signal.current;
    if (!r || !s || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const next = await r.save(checkins, { date: today, values });
      if (s.aborted) return;
      setCheckins(next);
      setTab("resumo");
      setToast(true);
      setTimeout(() => setToast(false), 1800);
    } catch {
      // O rascunho continua na tela para tentar de novo.
      if (!s.aborted) setSaveError(true);
    } finally {
      if (!s.aborted) setSaving(false);
    }
  };

  const local = repo.current ? !repo.current.remote : false;

  return (
    <div className="app">
      {accountHeader}
      <div className="stage">
        {sceneryMounted && scene ? (
          <Scenery
            scene={scene}
            visible={showScenery}
            motion={sceneryMotion}
            paused={sceneryPrefs.paused}
          />
        ) : null}
        <main
          className={`view view-${tab === "resumo" ? "summary" : "checkin"}${showScenery ? " with-scenery" : ""}`}
        >
          {status === "loading" ? (
            <section className="card empty" role="status" aria-busy="true">
              <p>Carregando seus check-ins...</p>
            </section>
          ) : status === "error" ? (
            <section className="card empty">
              <h2>Não foi possível carregar</h2>
              <p role="alert">
                Seus check-ins não foram carregados. Verifique a conexão.
              </p>
              <button className="cta" type="button" onClick={load}>
                Tentar de novo
              </button>
            </section>
          ) : tab === "checkin" ? (
            <CheckInScreen
              key={todays ? "edit" : "new"}
              today={today}
              existing={todays}
              onSave={save}
              saving={saving}
              saveError={saveError}
            />
          ) : (
            <SummaryScreen
              checkins={checkins}
              today={today}
              onGoCheckIn={() => setTab("checkin")}
              onLoadSample={
                local ? () => replaceAll(sampleCheckIns(today)) : undefined
              }
              onClear={local ? () => replaceAll([]) : undefined}
              scenery={
                scene
                  ? {
                      scene,
                      prefs: sceneryPrefs,
                      motion: sceneryMotion,
                      onChange: setSceneryPrefs,
                    }
                  : undefined
              }
            />
          )}
        </main>
      </div>
      <nav className="tabbar" role="tablist" aria-label="Telas">
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={tab === "checkin"}
          onClick={() => setTab("checkin")}
        >
          <CheckInIcon />
          Check-in
        </button>
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={tab === "resumo"}
          onClick={() => setTab("resumo")}
        >
          <SummaryIcon />
          Resumo
        </button>
      </nav>
      <div className={`toast${toast ? " on" : ""}`} role="status">
        {toast ? "Check-in registrado" : ""}
      </div>
    </div>
  );
}
