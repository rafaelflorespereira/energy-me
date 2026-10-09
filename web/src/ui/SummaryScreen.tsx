import { useState } from 'react'
import { Image, ImageOff, Pause, Play } from 'lucide-react'
import { type CheckIn } from '../domain/checkins'
import { type DateKey } from '../domain/dates'
import { FEELINGS, INTENSITY_LABELS, type FeelingId, feelingById } from '../domain/feelings'
import { PERIOD_DAYS, analyze, series, type PeriodKind } from '../domain/stats'
import { Bars, Line } from './Charts'
import { FEELING_COLOR } from './colors'
import { changeLine, longDate, periodWords, shortDate, verdict, verdictSub } from './copy'
import { type Scene, type SceneryPrefs } from './scenery'

interface SceneryControls {
  /** Cena do check-in de hoje; o cenário nunca representa a semana ou o mês. */
  scene: Scene
  prefs: SceneryPrefs
  /** Falso quando o sistema pede menos movimento ou economia de dados. */
  motion: boolean
  onChange: (patch: Partial<SceneryPrefs>) => void
}

interface Props {
  checkins: readonly CheckIn[]
  today: DateKey
  onGoCheckIn: () => void
  /** Ausentes quando os dados estão na nuvem: exemplo e apagar tudo são só locais. */
  onLoadSample?: () => void
  onClear?: () => void
  /** Ausente quando não há check-in hoje com algum sentimento marcado. */
  scenery?: SceneryControls
}

export function SummaryScreen({ checkins, today, onGoCheckIn, onLoadSample, onClear, scenery }: Props) {
  const [period, setPeriod] = useState<PeriodKind>('semana')
  const [picked, setPicked] = useState<FeelingId | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const a = analyze(checkins, today, period)
  const w = periodWords(period)
  const selected = feelingById(picked ?? a.top.id)
  const topColor = FEELING_COLOR[a.top.id]
  const joy = INTENSITY_LABELS[Math.round(a.current.avg.alegria)]

  return (
    <>
      <header className="hd">
        <small>Hoje, {longDate(today)}</small>
        <h1>Seu resumo</h1>
      </header>

      <div className="period" role="group" aria-label="Período">
        {(['semana', 'mes'] as const).map((p) => (
          <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
            {p === 'semana' ? 'Semana' : 'Mês'}
          </button>
        ))}
      </div>

      {scenery ? <SceneryBar {...scenery} /> : null}

      {checkins.length === 0 ? (
        <section className="card empty">
          <h2>Nenhum registro ainda</h2>
          <p>Faça o primeiro check-in para ver aqui a análise da semana e do mês.</p>
          <button className="cta" type="button" onClick={onGoCheckIn}>
            Fazer check-in
          </button>
          {onLoadSample ? (
            <button className="link" type="button" onClick={onLoadSample}>
              Ver com dados de exemplo
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <section className="card analysis" aria-live="polite">
            <h2>
              Análise {w.of} · {shortDate(a.current.start)} a {shortDate(a.current.end)}
            </h2>
            <p className="verdict">{verdict(a)}</p>
            <p className="verdict-sub">{verdictSub(a)}</p>
            <div className="kpis">
              <div className="kpi">
                <span>Check-ins</span>
                <b>
                  {a.current.count} de {PERIOD_DAYS[period]}
                </b>
              </div>
              <div className="kpi">
                <span>Mais presente</span>
                <b style={{ color: topColor }}>{a.current.count ? a.top.name : '–'}</b>
              </div>
              <div className="kpi">
                <span>Alegria</span>
                <b>{a.current.count ? joy : '–'}</b>
              </div>
            </div>
            {(a.better.length > 0 || a.worse.length > 0) && (
              <ul className="insights">
                {[...a.better.map((c) => ({ c, good: true })), ...a.worse.map((c) => ({ c, good: false }))].map(
                  ({ c, good }) => {
                    const line = changeLine(c, period)
                    return (
                      <li key={c.feeling.id}>
                        <span className={`ar ${good ? 'good' : 'bad'}`}>{line.arrow}</span>
                        <span>
                          <b>{c.feeling.name}</b> {line.text}
                        </span>
                      </li>
                    )
                  },
                )}
              </ul>
            )}
            {a.current.count > 0 && (
              <p className="mtc">
                Na MTC, {a.top.name.toLowerCase()} se relaciona ao {a.top.organ} ({a.top.element}). É o ponto para
                observar {w.this}.
              </p>
            )}
          </section>

          <Bars current={a.current} previous={a.previous} />

          <section className="card">
            <h2>Evolução no período</h2>
            <div className="chips">
              {FEELINGS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="chip"
                  style={{ ['--c' as string]: FEELING_COLOR[f.id] }}
                  aria-pressed={f.id === selected.id}
                  onClick={() => setPicked(f.id)}
                >
                  <i className="dot" />
                  {f.name}
                </button>
              ))}
            </div>
            <Line
              feeling={selected}
              points={series(checkins, today, PERIOD_DAYS[period], selected.id)}
              period={period}
            />
          </section>

          {onClear ? (
          <div className="footer">
            {confirmClear ? (
              <>
                <span>Apagar todos os registros deste aparelho?</span>
                <button
                  className="link danger"
                  type="button"
                  onClick={() => {
                    onClear?.()
                    setConfirmClear(false)
                  }}
                >
                  Apagar
                </button>
                <button className="link" type="button" onClick={() => setConfirmClear(false)}>
                  Cancelar
                </button>
              </>
            ) : (
              <button className="link" type="button" onClick={() => setConfirmClear(true)}>
                Apagar histórico
              </button>
            )}
          </div>
          ) : null}
        </>
      )}
    </>
  )
}

function SceneryBar({ scene, prefs, motion, onChange }: SceneryControls) {
  const feeling = feelingById(scene.feeling)
  return (
    <div className="scenery-bar" role="group" aria-label="Cenário do resumo">
      <span className="scenery-what">
        Hoje: <b>{feeling.name}</b>, {INTENSITY_LABELS[scene.intensity]}
      </span>
      <div className="scenery-actions">
        {prefs.enabled && motion ? (
          <button
            type="button"
            className="scenery-btn icon"
            aria-pressed={prefs.paused}
            aria-label="Pausar animação"
            title={prefs.paused ? 'Retomar animação' : 'Pausar animação'}
            onClick={() => onChange({ paused: !prefs.paused })}
          >
            {prefs.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          </button>
        ) : null}
        <button
          type="button"
          className="scenery-btn"
          aria-pressed={prefs.enabled}
          onClick={() => onChange({ enabled: !prefs.enabled })}
        >
          {prefs.enabled ? <Image aria-hidden="true" /> : <ImageOff aria-hidden="true" />}
          Cenário
        </button>
      </div>
    </div>
  )
}
