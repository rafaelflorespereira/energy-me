// Os sete sentimentos e a associação com os Cinco Elementos da MTC.
// Sem dependência de React ou do navegador: esta pasta é a especificação
// que a versão iOS deve reproduzir.

export type FeelingId =
  | 'raiva'
  | 'frustracao'
  | 'preocupacao'
  | 'alegria'
  | 'tristeza'
  | 'culpa'
  | 'medo'

export type Element = 'Madeira' | 'Fogo' | 'Terra' | 'Metal' | 'Água'

export interface Feeling {
  id: FeelingId
  name: string
  organ: string
  element: Element
  /** Para alegria, subir é melhora; para os demais, descer é melhora. */
  positive: boolean
}

export const FEELINGS: readonly Feeling[] = [
  { id: 'raiva', name: 'Raiva', organ: 'Fígado', element: 'Madeira', positive: false },
  { id: 'frustracao', name: 'Frustração', organ: 'Fígado', element: 'Madeira', positive: false },
  { id: 'preocupacao', name: 'Preocupação', organ: 'Baço', element: 'Terra', positive: false },
  { id: 'alegria', name: 'Alegria', organ: 'Coração', element: 'Fogo', positive: true },
  { id: 'tristeza', name: 'Tristeza', organ: 'Pulmão', element: 'Metal', positive: false },
  { id: 'culpa', name: 'Culpa', organ: 'Rim', element: 'Água', positive: false },
  { id: 'medo', name: 'Medo', organ: 'Rim', element: 'Água', positive: false },
]

export const FEELING_IDS: readonly FeelingId[] = FEELINGS.map((f) => f.id)

export function feelingById(id: FeelingId): Feeling {
  const f = FEELINGS.find((x) => x.id === id)
  if (!f) throw new Error(`Sentimento desconhecido: ${id}`)
  return f
}

/** 0 = não sinto, 1 = leve, 2 = moderada, 3 = forte, 4 = intensa. */
export type Intensity = 0 | 1 | 2 | 3 | 4

export const INTENSITY_LABELS: readonly string[] = ['não sinto', 'leve', 'moderada', 'forte', 'intensa']
export const MAX_INTENSITY = 4

export type Values = Record<FeelingId, Intensity>

export function emptyValues(): Values {
  return Object.fromEntries(FEELING_IDS.map((id) => [id, 0])) as Values
}
