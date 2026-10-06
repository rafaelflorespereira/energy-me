import { FEELINGS, INTENSITY_LABELS, MAX_INTENSITY, type Feeling } from '../domain/feelings'
import { type PeriodKind, type PeriodStats, type SeriesPoint } from '../domain/stats'
import { FEELING_COLOR } from './colors'
import { decimal, shortDate, weekdayShort } from './copy'

export function Bars({ current, previous }: { current: PeriodStats; previous: PeriodStats }) {
  return (
    <section className="card">
      <h2>Intensidade média</h2>
      <div className="bars">
        {FEELINGS.map((f) => (
          <div key={f.id} className="bar" style={{ ['--c' as string]: FEELING_COLOR[f.id] }}>
            <span className="bar-name">{f.name}</span>
            <div className="track">
              <div className="f" style={{ width: `${(current.avg[f.id] / MAX_INTENSITY) * 100}%` }} />
              {previous.count > 0 && (
                <div className="prev" style={{ left: `calc(${(previous.avg[f.id] / MAX_INTENSITY) * 100}% - 1px)` }} />
              )}
            </div>
            <span className="bar-v">{decimal(current.avg[f.id])}</span>
          </div>
        ))}
      </div>
      <div className="legend">
        <span>
          <i className="lg-now" />
          Este período
        </span>
        {previous.count > 0 && (
          <span>
            <i className="lg-prev" />
            Período anterior
          </span>
        )}
      </div>
    </section>
  )
}

interface LineProps {
  feeling: Feeling
  points: SeriesPoint[]
  period: PeriodKind
}

const W = 300
const H = 140
const L = 58
const R = 10
const T = 10
const B = 22

export function Line({ feeling, points, period }: LineProps) {
  const n = points.length
  const iw = W - L - R
  const ih = H - T - B
  const x = (i: number) => L + (i * iw) / (n - 1)
  const y = (v: number) => T + ih - (v * ih) / MAX_INTENSITY
  const color = FEELING_COLOR[feeling.id]

  const dots = points.flatMap((p, i) => (p.value === null ? [] : [{ i, x: x(i), y: y(p.value) }]))
  const path = dots.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' ')

  const labels =
    period === 'semana'
      ? points.map((p, i) => ({ i, text: i === n - 1 ? 'hoje' : weekdayShort(p.date), anchor: 'middle' as const }))
      : [
          { i: 0, text: shortDate(points[0].date), anchor: 'start' as const },
          { i: Math.floor(n / 2), text: shortDate(points[Math.floor(n / 2)].date), anchor: 'middle' as const },
          { i: n - 1, text: 'hoje', anchor: 'end' as const },
        ]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Evolução de ${feeling.name} ${period === 'semana' ? 'na semana' : 'no mês'}`}>
      {[1, 2, 3, 4].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" />
          <text x={L - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)">
            {INTENSITY_LABELS[v]}
          </text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--line)" />
      {labels.map((l) => (
        <text key={l.i} x={x(l.i)} y={H - 6} textAnchor={l.anchor} fontSize="10" fill="var(--muted)">
          {l.text}
        </text>
      ))}
      {dots.length > 1 && (
        <>
          <polygon points={`${dots[0].x},${y(0)} ${path} ${dots[dots.length - 1].x},${y(0)}`} fill={color} fillOpacity=".12" />
          <polyline points={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}
      {dots.map((d, k) =>
        k === dots.length - 1 ? (
          <circle key={d.i} cx={d.x} cy={d.y} r="4.5" fill="var(--card)" stroke={color} strokeWidth="2.5" />
        ) : (
          <circle key={d.i} cx={d.x} cy={d.y} r={period === 'semana' ? 3.2 : 2} fill={color} />
        ),
      )}
    </svg>
  )
}
