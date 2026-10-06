import { INTENSITY_LABELS, type Feeling, type Intensity } from '../domain/feelings'

interface Props {
  feeling: Feeling
  value: Intensity
  onChange: (value: Intensity) => void
}

/** Quatro círculos crescentes; tocar de novo no nível atual desmarca. */
export function Circles({ feeling, value, onChange }: Props) {
  return (
    <div className="lv" role="group" aria-label={`Intensidade de ${feeling.name}`}>
      {([1, 2, 3, 4] as const).map((level) => (
        <button
          key={level}
          type="button"
          className={level <= value ? 'fill' : ''}
          aria-label={`${feeling.name}: ${INTENSITY_LABELS[level]}`}
          aria-pressed={level === value}
          onClick={() => onChange(level === value ? 0 : level)}
        >
          <i />
        </button>
      ))}
    </div>
  )
}
