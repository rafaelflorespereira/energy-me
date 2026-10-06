import { type CheckIn } from './checkins'
import { addDays, type DateKey } from './dates'
import { FEELINGS, MAX_INTENSITY, type FeelingId, type Intensity, type Values } from './feelings'

// Início e fim da tendência de cada sentimento ao longo do período de exemplo.
const TREND: Record<FeelingId, [number, number]> = {
  raiva: [1.6, 1.2],
  frustracao: [2.4, 1.5],
  preocupacao: [3.1, 1.7],
  alegria: [1.4, 2.8],
  tristeza: [2, 1.3],
  culpa: [1.5, 1],
  medo: [1.1, 1.3],
}

/** Histórico de exemplo determinístico, terminando ontem, com alguns dias sem registro. */
export function sampleCheckIns(today: DateKey, days = 60): CheckIn[] {
  let seed = 11
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  const out: CheckIn[] = []
  for (let i = days; i >= 1; i--) {
    const t = (days - i) / days
    if (rnd() < 0.14) continue
    const values = {} as Values
    for (const f of FEELINGS) {
      const [a, b] = TREND[f.id]
      const n = Math.round(a + (b - a) * t + (rnd() - 0.5) * 2.2)
      values[f.id] = Math.max(0, Math.min(MAX_INTENSITY, n)) as Intensity
    }
    out.push({ date: addDays(today, -i), values })
  }
  return out
}
