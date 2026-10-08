import { parseCheckIns, type CheckIn } from './domain/checkins'
import { type DateKey } from './domain/dates'
import { FEELING_IDS, type FeelingId, type Values } from './domain/feelings'

// A API e o DynamoDB usam chaves em inglês (docs/checkin-persistence.md).
// A tradução acontece só aqui; o resto do app continua com os IDs em português.
const TO_API: Record<FeelingId, string> = {
  raiva: 'anger',
  frustracao: 'frustration',
  preocupacao: 'worry',
  alegria: 'joy',
  tristeza: 'sadness',
  culpa: 'guilt',
  medo: 'fear',
}

export function toApiValues(values: Values): Record<string, number> {
  return Object.fromEntries(FEELING_IDS.map((id) => [TO_API[id], values[id]]))
}

export function fromApiValues(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  return Object.fromEntries(FEELING_IDS.map((id) => [id, input[TO_API[id]]]))
}

/** Converte itens da API para o formato do app; descarta o que vier inválido. */
function toCheckIns(items: unknown): CheckIn[] {
  if (!Array.isArray(items)) throw new ApiError(0, 'BAD_RESPONSE')
  return parseCheckIns(
    items.map((item) => {
      const { date, values } = (item ?? {}) as { date?: unknown; values?: unknown }
      return { date, values: fromApiValues(values) }
    }),
  )
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

export interface ApiDeps {
  baseUrl: string
  /** Access token atual; `renew` pede um novo depois de um 401. */
  getToken: (renew: boolean) => Promise<string | null>
  fetch?: typeof fetch
  signal?: AbortSignal
}

export function createCheckInsApi({ baseUrl, getToken, fetch: doFetch = fetch, signal }: ApiDeps) {
  const base = baseUrl.replace(/\/+$/, '')

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    for (const renew of [false, true]) {
      const token = await getToken(renew)
      if (!token) throw new ApiError(401, 'SIGNED_OUT')
      let res: Response
      try {
        res = await doFetch(`${base}${path}`, {
          ...init,
          signal,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
        })
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') throw err
        throw new ApiError(0, 'NETWORK')
      }
      if (res.status === 401 && !renew) continue
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null
        throw new ApiError(res.status, typeof body?.error === 'string' ? body.error : 'HTTP_ERROR')
      }
      return res.json()
    }
    throw new ApiError(401, 'UNAUTHORIZED')
  }

  return {
    /** Lê o histórico inteiro, página por página, antes de devolver. */
    async list(): Promise<CheckIn[]> {
      const all: CheckIn[] = []
      let cursor: string | null = null
      do {
        const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
        const page = (await request(`/checkins${query}`)) as { items?: unknown; nextCursor?: unknown }
        all.push(...toCheckIns(page?.items))
        cursor = typeof page?.nextCursor === 'string' ? page.nextCursor : null
      } while (cursor)
      return all.sort((a, b) => a.date.localeCompare(b.date))
    },

    async put(date: DateKey, values: Values): Promise<CheckIn> {
      const saved = await request(`/checkins/${encodeURIComponent(date)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: toApiValues(values) }),
      })
      const [entry] = toCheckIns([saved])
      if (!entry || entry.date !== date) throw new ApiError(0, 'BAD_RESPONSE')
      return entry
    },
  }
}

export type CheckInsApi = ReturnType<typeof createCheckInsApi>
