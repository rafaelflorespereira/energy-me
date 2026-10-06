import { type Analysis, type FeelingChange, type PeriodKind } from '../domain/stats'
import { fromDateKey, type DateKey } from '../domain/dates'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

export function shortDate(key: DateKey): string {
  const d = fromDateKey(key)
  return `${d.getDate()} ${MESES[d.getMonth()]}`
}

export function longDate(key: DateKey): string {
  const d = fromDateKey(key)
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`
}

export function weekdayShort(key: DateKey): string {
  return DIAS[fromDateKey(key).getDay()].slice(0, 3)
}

export const decimal = (n: number) => n.toFixed(1).replace('.', ',')
export const percent = (n: number) => `${Math.round(Math.abs(n) * 100)}%`

const WORDS: Record<PeriodKind, { name: string; article: 'a' | 'o'; of: string; this: string }> = {
  semana: { name: 'semana', article: 'a', of: 'da semana', this: 'nesta semana' },
  mes: { name: 'mês', article: 'o', of: 'do mês', this: 'neste mês' },
}

export const periodWords = (p: PeriodKind) => WORDS[p]

export function verdict(a: Analysis): string {
  const w = WORDS[a.period]
  const noun = w.name[0].toUpperCase() + w.name.slice(1)
  if (!a.hasPrevious) return `Primeiros registros ${w.of}`
  if (a.trend === 'lighter') return `${noun} mais leve que ${w.article} anterior`
  if (a.trend === 'heavier') return `${noun} mais ${w.article === 'a' ? 'pesada' : 'pesado'} que ${w.article} anterior`
  return `${noun} ${w.article === 'a' ? 'parecida' : 'parecido'} com ${w.article} anterior`
}

export function verdictSub(a: Analysis): string {
  if (a.current.count === 0) return `Nenhum check-in ${WORDS[a.period].this}.`
  if (!a.hasPrevious || a.loadChange === null) {
    return `Ainda não há ${WORDS[a.period].name} anterior para comparar.`
  }
  if (a.trend === 'similar') return 'A intensidade média dos sentimentos difíceis ficou estável.'
  return `A intensidade média dos sentimentos difíceis ${a.loadChange < 0 ? 'caiu' : 'subiu'} ${percent(a.loadChange)}.`
}

export function changeLine(c: FeelingChange, period: PeriodKind): { arrow: string; text: string } {
  const w = WORDS[period]
  const up = c.delta > 0
  const rel = c.relative === null ? '' : ` ${percent(c.relative)}`
  return {
    arrow: up ? '↑' : '↓',
    text: `${up ? 'subiu' : 'caiu'}${rel} em relação ${w.article === 'a' ? 'à' : 'ao'} ${w.name} anterior`,
  }
}
