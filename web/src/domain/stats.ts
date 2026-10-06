import { type CheckIn } from './checkins'
import { addDays, type DateKey } from './dates'
import { FEELINGS, type Feeling, type FeelingId } from './feelings'

export type PeriodKind = 'semana' | 'mes'
export const PERIOD_DAYS: Record<PeriodKind, number> = { semana: 7, mes: 30 }

export interface PeriodStats {
  /** Primeiro e último dia da janela (inclusive). */
  start: DateKey
  end: DateKey
  days: number
  /** Quantos dias da janela têm check-in. */
  count: number
  /** Média por sentimento, na escala 0–4. Zero quando não há check-in. */
  avg: Record<FeelingId, number>
  /** Média dos sentimentos difíceis (todos menos alegria). */
  load: number
}

/** Janela de `days` dias terminando em `today`, deslocada `offset` janelas para trás. */
export function periodStats(
  checkins: readonly CheckIn[],
  today: DateKey,
  days: number,
  offset = 0,
): PeriodStats {
  const end = addDays(today, -days * offset)
  const start = addDays(end, -(days - 1))
  const rows = checkins.filter((c) => c.date >= start && c.date <= end)
  const avg = {} as Record<FeelingId, number>
  for (const f of FEELINGS) {
    avg[f.id] = rows.length ? rows.reduce((s, r) => s + r.values[f.id], 0) / rows.length : 0
  }
  const hard = FEELINGS.filter((f) => !f.positive)
  const load = hard.reduce((s, f) => s + avg[f.id], 0) / hard.length
  return { start, end, days, count: rows.length, avg, load }
}

export type Trend = 'lighter' | 'heavier' | 'similar'

export interface FeelingChange {
  feeling: Feeling
  /** Diferença de média em relação ao período anterior (positivo = subiu). */
  delta: number
  /** Variação relativa ao período anterior; null quando o anterior era zero. */
  relative: number | null
  /** Positivo = melhorou (alegria subiu ou sentimento difícil caiu). */
  score: number
}

export interface Analysis {
  period: PeriodKind
  current: PeriodStats
  previous: PeriodStats
  /** Falso quando o período anterior não tem nenhum check-in para comparar. */
  hasPrevious: boolean
  trend: Trend
  /** Variação relativa da carga dos sentimentos difíceis; null sem comparação. */
  loadChange: number | null
  better: FeelingChange[]
  worse: FeelingChange[]
  /** Sentimento difícil mais intenso no período. */
  top: Feeling
}

const SIMILAR_BAND = 0.05
const MIN_SCORE = 0.15

export function analyze(checkins: readonly CheckIn[], today: DateKey, period: PeriodKind): Analysis {
  const days = PERIOD_DAYS[period]
  const current = periodStats(checkins, today, days, 0)
  const previous = periodStats(checkins, today, days, 1)
  const hasPrevious = previous.count > 0

  const loadChange = hasPrevious && previous.load > 0 ? (current.load - previous.load) / previous.load : null
  const trend: Trend =
    loadChange === null || Math.abs(loadChange) <= SIMILAR_BAND
      ? 'similar'
      : loadChange < 0
        ? 'lighter'
        : 'heavier'

  const changes: FeelingChange[] = hasPrevious
    ? FEELINGS.map((feeling) => {
        const delta = current.avg[feeling.id] - previous.avg[feeling.id]
        const prev = previous.avg[feeling.id]
        return {
          feeling,
          delta,
          relative: prev > 0 ? delta / prev : null,
          score: feeling.positive ? delta : -delta,
        }
      })
    : []

  const better = changes
    .filter((c) => c.score > MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
  const worse = changes
    .filter((c) => c.score < -MIN_SCORE)
    .sort((a, b) => a.score - b.score)
    .slice(0, 1)

  const hard = FEELINGS.filter((f) => !f.positive)
  const top = [...hard].sort((a, b) => current.avg[b.id] - current.avg[a.id])[0]

  return { period, current, previous, hasPrevious, trend, loadChange, better, worse, top }
}

export interface SeriesPoint {
  date: DateKey
  /** Null nos dias sem check-in. */
  value: number | null
}

/** Um ponto por dia dos últimos `days` dias, terminando em `today`. */
export function series(
  checkins: readonly CheckIn[],
  today: DateKey,
  days: number,
  id: FeelingId,
): SeriesPoint[] {
  const byDate = new Map(checkins.map((c) => [c.date, c]))
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, -(days - 1 - i))
    const c = byDate.get(date)
    return { date, value: c ? c.values[id] : null }
  })
}
