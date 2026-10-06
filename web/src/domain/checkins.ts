import { type DateKey } from './dates'
import { FEELING_IDS, MAX_INTENSITY, type Intensity, type Values } from './feelings'

/** Um registro por dia. Registrar de novo no mesmo dia substitui o anterior. */
export interface CheckIn {
  date: DateKey
  values: Values
}

export function upsertCheckIn(list: readonly CheckIn[], entry: CheckIn): CheckIn[] {
  return [...list.filter((c) => c.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date))
}

export function hasAnyFeeling(values: Values): boolean {
  return FEELING_IDS.some((id) => values[id] > 0)
}

/** Aceita só dados no formato esperado; descarta o que vier corrompido do armazenamento. */
export function parseCheckIns(raw: unknown): CheckIn[] {
  if (!Array.isArray(raw)) return []
  const out: CheckIn[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { date, values } = item as { date?: unknown; values?: unknown }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (!values || typeof values !== 'object') continue
    const v = values as Record<string, unknown>
    const clean = {} as Values
    let ok = true
    for (const id of FEELING_IDS) {
      const n = v[id]
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_INTENSITY) {
        ok = false
        break
      }
      clean[id] = n as Intensity
    }
    if (ok) out.push({ date, values: clean })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
