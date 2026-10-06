import { useCallback, useMemo, useState } from "react";
import { upsertCheckIn, type CheckIn } from "./domain/checkins";
import { toDateKey } from "./domain/dates";
import { type Values } from "./domain/feelings";
import { sampleCheckIns } from "./domain/sample";
import { loadCheckIns, saveCheckIns } from "./storage";
import { CheckInScreen } from "./ui/CheckInScreen";
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

export function App() {
  const [checkins, setCheckins] = useState<CheckIn[]>(loadCheckIns);
  const [tab, setTab] = useState<Tab>("checkin");
  const [toast, setToast] = useState(false);
  const today = useMemo(() => toDateKey(new Date()), []);

  const commit = useCallback((next: CheckIn[]) => {
    setCheckins(next);
    saveCheckIns(next);
  }, []);

  const todays = checkins.find((c) => c.date === today)?.values ?? null;

  const save = (values: Values) => {
    commit(upsertCheckIn(checkins, { date: today, values }));
    setTab("resumo");
    setToast(true);
    setTimeout(() => setToast(false), 1800);
  };

  return (
    <div className="app">
      <main className={`view view-${tab === "resumo" ? "summary" : "checkin"}`}>
        {tab === "checkin" ? (
          <CheckInScreen
            key={todays ? "edit" : "new"}
            today={today}
            existing={todays}
            onSave={save}
          />
        ) : (
          <SummaryScreen
            checkins={checkins}
            today={today}
            onGoCheckIn={() => setTab("checkin")}
            onLoadSample={() => commit(sampleCheckIns(today))}
            onClear={() => commit([])}
          />
        )}
      </main>
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
