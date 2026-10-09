// Cenário do resumo: escolhe a cena a partir do check-in de hoje e define como a
// intensidade aparece. Fica na camada de UI: nada aqui é gravado nos check-ins.

import { type CheckIn } from '../domain/checkins'
import { type DateKey } from '../domain/dates'
import { FEELINGS, type FeelingId, type Intensity, type Values } from '../domain/feelings'

export type SceneIntensity = Exclude<Intensity, 0>

export interface Scene {
  feeling: FeelingId
  /** Intensidade do sentimento escolhido no check-in de hoje (1–4). */
  intensity: SceneIntensity
}

/**
 * Cena de hoje: o sentimento mais intenso do check-in de hoje.
 * Empate fica com o que vem primeiro na ordem do app (FEELINGS).
 * Sem check-in hoje, ou com tudo em "não sinto", não há cena (fundo neutro).
 * Nunca usa médias do período: o cenário não representa a semana nem o mês.
 */
export function sceneForToday(checkins: readonly CheckIn[], today: DateKey): Scene | null {
  const todays = checkins.find((c) => c.date === today)
  return todays ? sceneForValues(todays.values) : null
}

/**
 * A mesma regra aplicada a valores soltos: usada no resumo (check-in salvo) e como
 * prévia na tela de check-in, enquanto a pessoa ainda escolhe as intensidades.
 */
export function sceneForValues(values: Values): Scene | null {
  let best: Scene | null = null
  for (const f of FEELINGS) {
    const v = values[f.id]
    if (v > 0 && (!best || v > best.intensity)) best = { feeling: f.id, intensity: v as SceneIntensity }
  }
  return best
}

export type SceneryVariant = 'mobile' | 'desktop'

/** Muda quando os arquivos forem gerados de novo (os assets ficam em cache por muito tempo). */
export const SCENERY_VERSION = '1'

/** Arquivos servidos pelo próprio app (web/public/scenery), gerados por tools/scenery. */
export function sceneMedia(feeling: FeelingId, variant: SceneryVariant) {
  const base = `/scenery/${feeling}-${variant}`
  const v = `?v=${SCENERY_VERSION}`
  return { poster: `${base}.webp${v}`, webm: `${base}.webm${v}`, mp4: `${base}.mp4${v}` }
}

export interface Treatment {
  saturate: number
  brightness: number
  playbackRate: number
}

/**
 * Intensidade de hoje -> vivacidade das cores e velocidade da animação.
 * Cada cena foi desenhada na intensidade 4; as menores ficam mais suaves e lentas.
 */
export function intensityTreatment(intensity: SceneIntensity): Treatment {
  const t = (intensity - 1) / 3
  return {
    saturate: round2(0.55 + 0.45 * t),
    brightness: round2(0.95 + 0.05 * t),
    playbackRate: round2(0.7 + 0.3 * t),
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Preferências visuais do aparelho, separadas dos registros emocionais. */
export interface SceneryPrefs {
  /** Falso volta ao resumo neutro. */
  enabled: boolean
  /** Verdadeiro para o movimento e mantém a imagem. */
  paused: boolean
}

export const DEFAULT_SCENERY_PREFS: SceneryPrefs = { enabled: true, paused: false }

export function parseSceneryPrefs(raw: unknown): SceneryPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_SCENERY_PREFS
  const { enabled, paused } = raw as Record<string, unknown>
  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_SCENERY_PREFS.enabled,
    paused: typeof paused === 'boolean' ? paused : DEFAULT_SCENERY_PREFS.paused,
  }
}

const PREFS_KEY = 'energy-me:scenery:v1'

export function loadSceneryPrefs(): SceneryPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return parseSceneryPrefs(raw ? JSON.parse(raw) : null)
  } catch {
    return DEFAULT_SCENERY_PREFS
  }
}

export function saveSceneryPrefs(prefs: SceneryPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Armazenamento bloqueado: a preferência vale só nesta sessão.
  }
}
