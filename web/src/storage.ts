import { parseCheckIns, type CheckIn } from "./domain/checkins";

const KEY = "energy-me:checkins:v1";

export function loadCheckIns(userId: string): CheckIn[] {
  try {
    const raw = localStorage.getItem(`${KEY}:${encodeURIComponent(userId)}`);
    return raw ? parseCheckIns(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveCheckIns(userId: string, list: readonly CheckIn[]): void {
  try {
    localStorage.setItem(
      `${KEY}:${encodeURIComponent(userId)}`,
      JSON.stringify(list),
    );
  } catch {
    // Armazenamento cheio ou bloqueado: o app segue funcionando só na sessão.
  }
}
