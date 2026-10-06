import { parseCheckIns, type CheckIn } from './domain/checkins'

const KEY = 'energy-me:checkins:v1'

export function loadCheckIns(): CheckIn[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parseCheckIns(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveCheckIns(list: readonly CheckIn[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Armazenamento cheio ou bloqueado: o app segue funcionando só na sessão.
  }
}
