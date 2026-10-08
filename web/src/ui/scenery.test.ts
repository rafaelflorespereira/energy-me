import { describe, expect, it } from 'vitest'
import { type CheckIn } from '../domain/checkins'
import { FEELING_IDS, emptyValues, type Values } from '../domain/feelings'
import {
  DEFAULT_SCENERY_PREFS,
  intensityTreatment,
  parseSceneryPrefs,
  sceneForToday,
  sceneMedia,
} from './scenery'

const TODAY = '2026-10-08'
const make = (date: string, patch: Partial<Values> = {}): CheckIn => ({ date, values: { ...emptyValues(), ...patch } })

describe('cenário do resumo', () => {
  it('usa só o check-in de hoje', () => {
    const list = [make('2026-10-07', { tristeza: 4 }), make(TODAY, { medo: 2 })]
    expect(sceneForToday(list, TODAY)).toEqual({ feeling: 'medo', intensity: 2 })
  })

  it('fica neutro sem check-in hoje ou com tudo em "não sinto"', () => {
    expect(sceneForToday([], TODAY)).toBeNull()
    expect(sceneForToday([make('2026-10-07', { raiva: 4 })], TODAY)).toBeNull()
    expect(sceneForToday([make(TODAY)], TODAY)).toBeNull()
  })

  it('escolhe o sentimento mais intenso, inclusive alegria', () => {
    expect(sceneForToday([make(TODAY, { tristeza: 2, alegria: 4, culpa: 1 })], TODAY)).toEqual({
      feeling: 'alegria',
      intensity: 4,
    })
  })

  it('no empate segue a ordem dos sentimentos do app', () => {
    expect(sceneForToday([make(TODAY, { frustracao: 4, raiva: 4 })], TODAY)?.feeling).toBe('raiva')
    expect(sceneForToday([make(TODAY, { medo: 3, culpa: 3 })], TODAY)?.feeling).toBe('culpa')
  })

  it('intensidade muda cor e velocidade, e 4 é a cena como foi desenhada', () => {
    const levels = ([1, 2, 3, 4] as const).map(intensityTreatment)
    expect(levels[3]).toEqual({ saturate: 1, brightness: 1, playbackRate: 1 })
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].saturate).toBeGreaterThan(levels[i - 1].saturate)
      expect(levels[i].playbackRate).toBeGreaterThan(levels[i - 1].playbackRate)
    }
  })

  it('preferências inválidas voltam ao padrão', () => {
    expect(parseSceneryPrefs(null)).toEqual(DEFAULT_SCENERY_PREFS)
    expect(parseSceneryPrefs('x')).toEqual(DEFAULT_SCENERY_PREFS)
    expect(parseSceneryPrefs({ enabled: 'sim', paused: true })).toEqual({ enabled: true, paused: true })
    expect(parseSceneryPrefs({ enabled: false })).toEqual({ enabled: false, paused: false })
  })

  it('todo sentimento tem imagem e vídeo em retrato e paisagem', () => {
    const files = new Set(
      Object.keys(import.meta.glob('../../public/scenery/*.{webp,webm,mp4}')).map((f) => f.replace('../../public', '')),
    )
    for (const id of FEELING_IDS) {
      for (const variant of ['mobile', 'desktop'] as const) {
        for (const url of Object.values(sceneMedia(id, variant))) {
          expect(files.has(url.split('?')[0]), url).toBe(true)
        }
      }
    }
  })
})
