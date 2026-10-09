import { type CSSProperties } from 'react'
import { Image, ImageOff, Pause, Play } from 'lucide-react'
import { INTENSITY_LABELS, feelingById } from '../domain/feelings'
import { FEELING_COLOR } from './colors'
import { type Scene, type SceneryPrefs } from './scenery'

interface Props {
  /** Cena mostrada agora: a de hoje no resumo, a prévia do que está marcado no check-in. */
  scene: Scene
  prefs: SceneryPrefs
  /** Falso quando o sistema pede menos movimento ou economia de dados. */
  motion: boolean
  onChange: (patch: Partial<SceneryPrefs>) => void
}

/** Legenda compacta do cenário no cabeçalho, com os controles de ligar e pausar. */
export function SceneryChip({ scene, prefs, motion, onChange }: Props) {
  const feeling = feelingById(scene.feeling)
  const level = INTENSITY_LABELS[scene.intensity]
  return (
    <div
      className="scenery-chip"
      role="group"
      aria-label="Cenário"
      style={{ '--c': FEELING_COLOR[scene.feeling] } as CSSProperties}
    >
      <span className="scenery-what" title={`Hoje: ${feeling.name}, ${level}`}>
        <span className="scenery-today">Hoje: </span>
        <b>{feeling.name}</b>, {level}
      </span>
      {prefs.enabled && motion ? (
        <button
          type="button"
          className="scenery-btn"
          aria-pressed={prefs.paused}
          aria-label="Pausar animação"
          title={prefs.paused ? 'Retomar animação' : 'Pausar animação'}
          onClick={() => onChange({ paused: !prefs.paused })}
        >
          {prefs.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        </button>
      ) : null}
      <button
        type="button"
        className="scenery-btn"
        aria-pressed={prefs.enabled}
        aria-label="Mostrar cenário"
        title={prefs.enabled ? 'Esconder cenário' : 'Mostrar cenário'}
        onClick={() => onChange({ enabled: !prefs.enabled })}
      >
        {prefs.enabled ? <Image aria-hidden="true" /> : <ImageOff aria-hidden="true" />}
      </button>
    </div>
  )
}
