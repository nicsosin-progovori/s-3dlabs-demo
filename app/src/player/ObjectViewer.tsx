import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MathUtils, Vector3 } from 'three'
import { loadObjectManifest, type LoadedObject } from './engine/objectLoader'
import { buildFromManifest, loadSkinBundle, type BuiltObject } from './engine/objectEngine'
import { loadSku } from './engine/skuLoader'
import { PLAYER_ROOT_ID, onLoad, readSku } from './engine/playerContract'
import { Backdrop } from './components/Backdrop'
import { Rig } from './components/Rig'
import { ShadowSlot } from './components/ShadowSlot'
import { CameraFilm } from './components/CameraFilm'
import { MaterialFrames } from './components/MaterialFrames'
import './objectViewer.css'

/* Зоны ответственности помечены "ЗО[...]" — легенда в objectEngine.ts.
 * Здесь render-оболочка плеера: окружение/фон, свет, тени, контролы, крен камеры. */

/** Размер области плеера (кадр считаем по контейнеру, а не по окну). */
function playerViewport() {
  const el = document.getElementById(PLAYER_ROOT_ID)
  return el && el.clientWidth && el.clientHeight ? { width: el.clientWidth, height: el.clientHeight } : undefined
}

/** ЗО[ОБЩЕЕ]: лимиты орбиты — математика студии (bottleOrbitLimits). ЗО[ПОЛИТИКА]: константы в мире ×worldScale. */
const FLOOR = 0.06
function orbitLimits(position: Vector3, target: Vector3) {
  const direction = position.clone().sub(target).normalize(), radius = position.distanceTo(target)
  const maxDistance = direction.y < 0
    ? Math.min(Math.max(12, radius * 3), Math.max(radius, (target.y - FLOOR) / -direction.y))
    : Math.max(12, radius * 3)
  const maxPolarAngle = Math.acos(MathUtils.clamp((FLOOR - target.y) / maxDistance, -1, 1))
  return { maxDistance, maxPolarAngle }
}

/* Плеер — ЧИСТЫЙ ПОТРЕБИТЕЛЬ: не владеет списком, не рисует управление, не трогает URL.
 * Что показывать — решает хост через публичный контракт (engine/playerContract.ts): SKU.
 * Плеер сам читает simple SKU → { object, skin } и сообщает только своё СОСТОЯНИЕ. */

/** Состояние плеера. Всё, что плеер о себе говорит, — это одно из них. */
type PlayerState =
  | { state: 'empty' }                                    // SKU не задан
  | { state: 'loading'; sku: string }
  | { state: 'ready'; sku: string; built: BuiltObject }
  | { state: 'error'; sku: string; reason: string }

/** Нейтральный вывод состояния — без UX-текстов и без отсылок к чему-либо вне плеера. */
function StateView({ s }: { s: Exclude<PlayerState, { state: 'ready' }> }) {
  const detail = s.state === 'empty' ? 'SKU не задан'
    : s.state === 'loading' ? s.sku
    : `${s.sku}: ${s.reason}`
  return <div className="player-state" data-state={s.state}>{s.state} — {detail}</div>
}

/** Что сейчас реально на сцене — чтобы при том же объекте менять только скин. */
interface Current { object: string; loaded: LoadedObject; built: BuiltObject }

function Viewer() {
  const [sel, setSel] = useState<string>(readSku)
  const [ps, setPs] = useState<PlayerState>({ state: 'empty' })
  const current = useRef<Current | null>(null)
  // ЗО[КОНТРАКТ]: слушаем команду «сверху». Пустой sku → очистить.
  useEffect(() => onLoad(sku => setSel(sku ?? '')), [])
  useEffect(() => {
    const drop = () => { current.current?.built.skin?.dispose(); current.current = null }
    if (!sel) { drop(); setPs({ state: 'empty' }); document.body.style.background = ''; return }
    const ctrl = new AbortController(), signal = ctrl.signal
    ;(async () => {
      const rec = await loadSku(sel, signal)
      if (rec.type !== 'simple') throw new Error(`SKU type "${rec.type}" — player accepts only simple`)
      const cur = current.current
      if (cur && cur.object === rec.object) {
        // тот же объект → только скин; геометрия, камера и холст остаются
        if (cur.built.skinKey !== rec.skin) {
          if (!cur.built.skin) throw new Error(`Object ${rec.object} has no skin binding`)
          const bundle = await loadSkinBundle(cur.loaded, rec.skin, signal)
          if (signal.aborted) { bundle.dispose(); return }
          cur.built.skin.apply(bundle)
          cur.built.note = cur.built.note.replace('скин ' + cur.built.skinKey, 'скин ' + rec.skin)
          cur.built.skinKey = rec.skin
        }
        setPs({ state: 'ready', sku: sel, built: cur.built })
        return
      }
      drop()
      setPs({ state: 'loading', sku: sel })
      const [id, rev] = rec.object.split('@')
      const loaded = await loadObjectManifest(id, rev)
      const built = await buildFromManifest(loaded, signal, playerViewport(), rec.skin)
      if (signal.aborted) { built.skin?.dispose(); return }
      current.current = { object: rec.object, loaded, built }
      setPs({ state: 'ready', sku: sel, built })
      const bg = built.scene?.background // ЗО[ОБЪЕКТ]: цвет страницы-подложки до/за сценой
      document.body.style.background = bg ? bg.bottom : ''
    })().catch(e => {
      if (signal.aborted) return
      drop()   // строго: после ошибки ничего «старого» не показываем
      setPs({ state: 'error', sku: sel, reason: e?.message ?? String(e) })
    })
    return () => ctrl.abort()
  }, [sel])
  // состояние наружу — атрибутом на корне (пригодится для обратной связи)
  useEffect(() => { const r = document.getElementById(PLAYER_ROOT_ID); if (r) r.dataset.state = ps.state }, [ps.state])
  // строго: тень не встала — показ объекта считается неудачным, ничего «старого» не оставляем
  const failShadow = useCallback((e: unknown) => {
    current.current?.built.skin?.dispose(); current.current = null
    setPs(prev => prev.state === 'ready' ? { state: 'error', sku: prev.sku, reason: 'shadow: ' + ((e as Error)?.message ?? String(e)) } : prev)
  }, [])
  const built = ps.state === 'ready' ? ps.built : null
  const limits = useMemo(() => built ? orbitLimits(new Vector3(...built.camera.position), new Vector3(...built.camera.target)) : null, [built])
  if (ps.state !== 'ready' || !built || !limits) return <StateView s={ps.state === 'ready' ? { state: 'loading', sku: ps.sku } : ps} />
  return (
    <>
      <div className="badge">{ps.sku} — {current.current?.object} · {built.note}</div>
      {/* alpha:false — непрозрачный холст, видимый фон даёт 3D-задник объекта */}
      <Canvas camera={{ position: built.camera.position, fov: built.camera.fov, near: built.camera.near, far: built.camera.far }} dpr={[1, 2]} gl={{ alpha: false }} shadows>
        <Backdrop bg={built.scene?.background} />
        <Rig p={built.scene} />
        <primitive object={built.root} />
        <MaterialFrames root={built.root} />
        <ShadowSlot built={built} onError={failShadow} />
        <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.13} rotateSpeed={0.65}
          minDistance={0.6} maxDistance={limits.maxDistance} minPolarAngle={0.08} maxPolarAngle={limits.maxPolarAngle}
          target={built.camera.target} />
        <CameraFilm cam={built.camera} />
      </Canvas>
    </>
  )
}
createRoot(document.getElementById(PLAYER_ROOT_ID)!).render(<Viewer />)
