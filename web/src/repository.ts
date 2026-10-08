import { type CheckInsApi } from './checkinsApi'
import { upsertCheckIn, type CheckIn } from './domain/checkins'
import { loadCheckIns, saveCheckIns } from './storage'

/**
 * Onde os check-ins moram. Sem `VITE_CHECKINS_API_URL` o app usa o
 * armazenamento do aparelho, como antes; com ela, a nuvem é a fonte da verdade.
 */
export interface CheckInRepository {
  readonly remote: boolean
  load(): Promise<CheckIn[]>
  /** Salva um dia e devolve a lista atualizada só depois de confirmado. */
  save(list: readonly CheckIn[], entry: CheckIn): Promise<CheckIn[]>
  /** Só no modo local: dados de exemplo e apagar tudo não passam pela nuvem. */
  replaceAll?(list: CheckIn[]): void
}

export function localRepository(userId: string): CheckInRepository {
  return {
    remote: false,
    load: async () => loadCheckIns(userId),
    save: async (list, entry) => {
      const next = upsertCheckIn(list, entry)
      saveCheckIns(userId, next)
      return next
    },
    replaceAll: (list) => saveCheckIns(userId, list),
  }
}

export function remoteRepository(api: CheckInsApi): CheckInRepository {
  return {
    remote: true,
    load: () => api.list(),
    save: async (list, entry) => upsertCheckIn(list, await api.put(entry.date, entry.values)),
  }
}
