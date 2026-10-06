import { type FeelingId } from '../domain/feelings'

/** Variável CSS de cada sentimento (cor do elemento na MTC). */
export const FEELING_COLOR: Record<FeelingId, string> = {
  raiva: 'var(--wood)',
  frustracao: 'var(--wood2)',
  preocupacao: 'var(--earth)',
  alegria: 'var(--fire)',
  tristeza: 'var(--metal)',
  culpa: 'var(--water2)',
  medo: 'var(--water)',
}
