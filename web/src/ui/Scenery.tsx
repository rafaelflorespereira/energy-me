import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { type FeelingId } from '../domain/feelings'
import {
  intensityTreatment,
  loadSceneryPrefs,
  saveSceneryPrefs,
  sceneMedia,
  type Scene,
  type SceneryPrefs,
  type SceneryVariant,
} from './scenery'

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const sync = () => setMatch(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return match
}

function savesData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return Boolean(connection?.saveData) || window.matchMedia('(prefers-reduced-data: reduce)').matches
}

/** Preferências do cenário guardadas no aparelho. */
export function useSceneryPrefs(): [SceneryPrefs, (patch: Partial<SceneryPrefs>) => void] {
  const [prefs, setPrefs] = useState<SceneryPrefs>(loadSceneryPrefs)
  const update = useCallback((patch: Partial<SceneryPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      saveSceneryPrefs(next)
      return next
    })
  }, [])
  return [prefs, update]
}

/** Movimento só quando o sistema não pede menos movimento nem economia de dados. */
export function useSceneryMotion(): boolean {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [saveData] = useState(savesData)
  return !reduced && !saveData
}

interface Layer {
  key: string
  feeling: FeelingId
  variant: SceneryVariant
  ready: boolean
}

/**
 * Fundo decorativo atrás do resumo. Mostra a imagem da cena e, quando o movimento
 * é permitido, o vídeo em loop por cima. Troca de cena com um fade curto.
 * Não recebe toques nem foco, e não muda o tamanho de nada na página.
 */
export function Scenery({
  scene,
  visible,
  motion,
  paused,
}: {
  scene: Scene
  /** Falso faz o cenário sumir com fade antes de ser desmontado. */
  visible: boolean
  motion: boolean
  paused: boolean
}) {
  const desktop = useMediaQuery('(min-width: 760px)')
  const variant: SceneryVariant = desktop ? 'desktop' : 'mobile'
  const key = `${scene.feeling}-${variant}`
  const [layers, setLayers] = useState<Layer[]>(() => [{ key, feeling: scene.feeling, variant, ready: false }])

  useEffect(() => {
    setLayers((ls) =>
      ls[ls.length - 1]?.key === key ? ls : [...ls.slice(-1), { key, feeling: scene.feeling, variant, ready: false }],
    )
  }, [key, scene.feeling, variant])

  useEffect(() => {
    const top = layers[layers.length - 1]
    if (layers.length < 2 || !top.ready) return
    const t = window.setTimeout(() => setLayers((ls) => ls.slice(-1)), 900)
    return () => window.clearTimeout(t)
  }, [layers])

  const ready = useCallback((k: string) => {
    setLayers((ls) => ls.map((l) => (l.key === k && !l.ready ? { ...l, ready: true } : l)))
  }, [])

  const t = intensityTreatment(scene.intensity)
  const style = { '--scene-sat': t.saturate, '--scene-bri': t.brightness } as CSSProperties

  return (
    <div className={`scenery${visible ? '' : ' off'}`} aria-hidden="true" style={style}>
      {layers.map((l) => (
        <SceneLayer
          key={l.key}
          layer={l}
          motion={motion}
          play={motion && !paused && visible}
          rate={t.playbackRate}
          onReady={ready}
        />
      ))}
    </div>
  )
}

function SceneLayer({
  layer,
  motion,
  play,
  rate,
  onReady,
}: {
  layer: Layer
  motion: boolean
  play: boolean
  rate: number
  onReady: (key: string) => void
}) {
  const media = sceneMedia(layer.feeling, layer.variant)
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const v = video.current
    if (!v) return
    v.muted = true
    v.defaultMuted = true
    v.disableRemotePlayback = true
    v.defaultPlaybackRate = rate
    v.playbackRate = rate
    const sync = () => {
      if (play && document.visibilityState === 'visible') v.play().catch(() => undefined)
      else v.pause()
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [play, rate, failed])

  return (
    <div className={`scenery-layer${layer.ready ? ' on' : ''}`}>
      <img src={media.poster} alt="" decoding="async" onLoad={() => onReady(layer.key)} />
      {motion && !failed && (play || playing) ? (
        <video
          ref={video}
          className={playing ? 'playing' : undefined}
          muted
          loop
          playsInline
          preload="auto"
          poster={media.poster}
          tabIndex={-1}
          onPlaying={() => {
            setPlaying(true)
            onReady(layer.key)
          }}
        >
          <source src={media.webm} type="video/webm" />
          <source src={media.mp4} type="video/mp4" onError={() => setFailed(true)} />
        </video>
      ) : null}
    </div>
  )
}
