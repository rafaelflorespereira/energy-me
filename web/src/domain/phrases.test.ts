import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { FEELING_IDS } from './feelings'
import { PHRASES, phraseOfTheDay } from './phrases'

describe('frase do dia', () => {
  it('tem 10 frases diferentes para cada sentimento', () => {
    for (const id of FEELING_IDS) {
      expect(PHRASES[id]).toHaveLength(10)
      expect(new Set(PHRASES[id]).size).toBe(10)
    }
  })

  it('fica a mesma durante o dia e vem da lista do sentimento', () => {
    const a = phraseOfTheDay('medo', '2026-10-12')
    expect(phraseOfTheDay('medo', '2026-10-12')).toBe(a)
    expect(PHRASES.medo).toContain(a)
  })

  it('varia ao longo dos dias', () => {
    const seen = new Set<string>()
    let day = '2026-10-01'
    for (let i = 0; i < 30; i++, day = addDays(day, 1)) seen.add(phraseOfTheDay('tristeza', day))
    expect(seen.size).toBeGreaterThan(5)
  })
})
