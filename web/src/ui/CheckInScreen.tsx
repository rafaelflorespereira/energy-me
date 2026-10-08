import { useState } from 'react'
import { hasAnyFeeling } from '../domain/checkins'
import { FEELINGS, INTENSITY_LABELS, emptyValues, type FeelingId, type Intensity, type Values } from '../domain/feelings'
import { type DateKey } from '../domain/dates'
import { Circles } from './Circles'
import { FEELING_COLOR } from './colors'
import { longDate } from './copy'

interface Props {
  today: DateKey
  /** Check-in já registrado hoje, para poder ajustar. */
  existing: Values | null
  onSave: (values: Values) => void
  saving?: boolean
  saveError?: boolean
}

export function CheckInScreen({ today, existing, onSave, saving = false, saveError = false }: Props) {
  const [values, setValues] = useState<Values>(() => existing ?? emptyValues())
  const marked = FEELINGS.filter((f) => values[f.id] > 0).length

  const set = (id: FeelingId, v: Intensity) => setValues((cur) => ({ ...cur, [id]: v }))

  return (
    <>
      <header className="hd">
        <small>{longDate(today)}</small>
        <h1>O que você sente agora?</h1>
      </header>
      <div className="scale">
        <span>Toque na intensidade</span>
        <span>leve → intensa</span>
      </div>
      <div className="rows">
        {FEELINGS.map((f) => {
          const v = values[f.id]
          return (
            <div key={f.id} className={`row${v ? ' on' : ''}`} style={{ ['--c' as string]: FEELING_COLOR[f.id] }}>
              <div>
                <div className="row-name">{f.name}</div>
                <div className="row-meta">
                  {v ? (
                    INTENSITY_LABELS[v]
                  ) : (
                    <>
                      <i className="dot" />
                      {f.organ} · {f.element}
                    </>
                  )}
                </div>
              </div>
              <Circles feeling={f} value={v} onChange={(n) => set(f.id, n)} />
            </div>
          )
        })}
      </div>
      <button
        className="cta"
        type="button"
        disabled={!hasAnyFeeling(values) || saving}
        aria-busy={saving}
        onClick={() => onSave(values)}
      >
        {saving
          ? 'Salvando...'
          : marked
            ? `${existing ? 'Atualizar' : 'Registrar'} (${marked} ${marked > 1 ? 'sentimentos' : 'sentimento'})`
            : 'Toque em pelo menos um sentimento'}
      </button>
      {saveError ? (
        <p className="save-error" role="alert">
          Não foi possível salvar. Seus valores continuam aqui; tente de novo.
        </p>
      ) : null}
      <p className="hint">Tocar de novo no mesmo nível desmarca</p>
    </>
  )
}
