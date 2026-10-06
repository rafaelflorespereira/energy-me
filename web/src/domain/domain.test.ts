import { describe, expect, it } from 'vitest'
import { hasAnyFeeling, parseCheckIns, upsertCheckIn, type CheckIn } from './checkins'
import { addDays, fromDateKey, toDateKey } from './dates'
import { emptyValues, type Values } from './feelings'
import { sampleCheckIns } from './sample'
import { analyze, periodStats, series } from './stats'

const TODAY = '2026-10-05'
const make = (date: string, patch: Partial<Values> = {}): CheckIn => ({ date, values: { ...emptyValues(), ...patch } })

describe('datas', () => {
  it('ida e volta de chave de data, inclusive na virada de mês e de horário de verão', () => {
    expect(toDateKey(fromDateKey('2026-03-01'))).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-10-05', -6)).toBe('2026-09-29')
  })
})

describe('check-ins', () => {
  it('registrar de novo no mesmo dia substitui e mantém a ordem', () => {
    const a = make('2026-10-03', { medo: 1 })
    const b = make('2026-10-01')
    const c = make('2026-10-03', { medo: 4 })
    const list = upsertCheckIn(upsertCheckIn([a], b), c)
    expect(list.map((x) => x.date)).toEqual(['2026-10-01', '2026-10-03'])
    expect(list[1].values.medo).toBe(4)
  })

  it('detecta se há algum sentimento marcado', () => {
    expect(hasAnyFeeling(emptyValues())).toBe(false)
    expect(hasAnyFeeling({ ...emptyValues(), culpa: 1 })).toBe(true)
  })

  it('descarta dados corrompidos ao ler do armazenamento', () => {
    const good = make('2026-10-02', { raiva: 3 })
    const parsed = parseCheckIns([
      good,
      { date: '2026-10-03', values: { ...good.values, raiva: 9 } },
      { date: 'ontem', values: good.values },
      { date: '2026-10-04', values: { raiva: 1 } },
      null,
      'x',
    ])
    expect(parsed).toEqual([good])
    expect(parseCheckIns({ not: 'a list' })).toEqual([])
  })
})

describe('período', () => {
  it('janela da semana cobre 7 dias terminando hoje e a anterior vem logo antes', () => {
    const s = periodStats([], TODAY, 7, 0)
    const p = periodStats([], TODAY, 7, 1)
    expect([s.start, s.end]).toEqual(['2026-09-29', '2026-10-05'])
    expect([p.start, p.end]).toEqual(['2026-09-22', '2026-09-28'])
  })

  it('média considera só os dias com check-in', () => {
    const s = periodStats([make('2026-10-05', { raiva: 4 }), make('2026-10-04', { raiva: 2 })], TODAY, 7)
    expect(s.count).toBe(2)
    expect(s.avg.raiva).toBe(3)
  })
})

describe('análise', () => {
  const prev = ['2026-09-28', '2026-09-27', '2026-09-26'].map((d) => make(d, { raiva: 4, alegria: 1 }))

  it('semana mais leve quando os sentimentos difíceis caem; alegria subindo conta como melhora', () => {
    const cur = ['2026-10-05', '2026-10-04'].map((d) => make(d, { raiva: 2, alegria: 3 }))
    const a = analyze([...prev, ...cur], TODAY, 'semana')
    expect(a.hasPrevious).toBe(true)
    expect(a.trend).toBe('lighter')
    expect(a.better.map((c) => c.feeling.id)).toEqual(expect.arrayContaining(['raiva', 'alegria']))
    expect(a.worse).toEqual([])
    expect(a.top.id).toBe('raiva')
  })

  it('semana mais pesada quando a raiva sobe e a alegria cai', () => {
    const cur = ['2026-10-05'].map((d) => make(d, { raiva: 3, medo: 2, alegria: 0 }))
    const lowPrev = ['2026-09-28'].map((d) => make(d, { raiva: 1, medo: 1, alegria: 3 }))
    const a = analyze([...lowPrev, ...cur], TODAY, 'semana')
    expect(a.trend).toBe('heavier')
    expect(a.worse[0].feeling.id).toBe('alegria')
  })

  it('sem período anterior não compara nada', () => {
    const a = analyze([make('2026-10-05', { raiva: 3 })], TODAY, 'semana')
    expect(a.hasPrevious).toBe(false)
    expect(a.trend).toBe('similar')
    expect(a.loadChange).toBeNull()
    expect(a.better).toEqual([])
    expect(a.worse).toEqual([])
  })

  it('funciona sem nenhum check-in', () => {
    const a = analyze([], TODAY, 'mes')
    expect(a.current.count).toBe(0)
    expect(a.top.positive).toBe(false)
  })
})

describe('série', () => {
  it('um ponto por dia, nulo quando não há check-in', () => {
    const s = series([make('2026-10-05', { medo: 2 })], TODAY, 7, 'medo')
    expect(s).toHaveLength(7)
    expect(s[6]).toEqual({ date: '2026-10-05', value: 2 })
    expect(s[0].value).toBeNull()
  })
})

describe('dados de exemplo', () => {
  it('são determinísticos, válidos e não incluem hoje', () => {
    const a = sampleCheckIns(TODAY)
    expect(sampleCheckIns(TODAY)).toEqual(a)
    expect(parseCheckIns(a)).toHaveLength(a.length)
    expect(a.every((c) => c.date < TODAY)).toBe(true)
    expect(a.length).toBeGreaterThan(40)
  })
})
