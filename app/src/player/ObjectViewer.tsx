import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MathUtils, Vector3 } from 'three'
import { loadObjectManifest, type LoadedObject } from './engine/objectLoader'
import { buildFromManifest, loadSkinBundle, type BuiltObject } from './engine/objectEngine'
import { placeInScene, type Placement } from './engine/placement'
import { sceneCommandApplies, sceneOnLoad } from './engine/scenePolicy'
import { loadSku } from './engine/skuLoader'
import { PLAYER_ROOT_ID, onLoad, onScene, readSku, reportScene } from './engine/playerContract'
import { loadScene } from './scenes/sceneLoader'
import { Backdrop } from './components/Backdrop'
import { Rig } from './components/Rig'
import { ShadowSlot } from './components/ShadowSlot'
import { SceneSlot } from './components/SceneSlot'
import { CameraFilm } from './components/CameraFilm'
import { MaterialFrames } from './components/MaterialFrames'
import './objectViewer.css'

/* Зоны ответственности помечены "ЗО[...]" — легенда в objectEngine.ts.
 * Здесь render-оболочка плеера: окружение/фон, свет, тени, контролы, крен камеры.
 * Сцена (#4) — отдельная сущность scenes/<id>/<rev>/: её выбирает объект (render.scenes),
 * хост может сменить её у показанного объекта (playerContract: s3d:scene). */

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
  | { state: 'ready'; sku: string; built: BuiltObject; placed: Placement }
  | { state: 'error'; sku: string; reason: string }

/** Нейтральный вывод состояния — без UX-текстов и без отсылок к чему-либо вне плеера. */
function StateView({ s }: { s: Exclude<PlayerState, { state: 'ready' }> }) {
  const detail = s.state === 'empty' ? 'SKU не задан'
    : s.state === 'loading' ? s.sku
    : `${s.sku}: ${s.reason}`
  return <div className="player-state" data-state={s.state}>{s.state} — {detail}</div>
}

/** Что сейчас реально на сцене — чтобы при том же объекте менять только скин, а сцену — без перезагрузки объекта. */
interface Current { object: string; loaded: LoadedObject; built: BuiltObject; placed: Placement }

/** Цвет страницы-подложки до/за 3D — из сцены. */
function pageBackground(placed: Placement | null) {
  document.body.style.background = placed ? placed.scene.profile.settings.background.bottom : ''
}

function Viewer() {
  const [sel, setSel] = useState<string>(readSku)
  const [ps, setPs] = useState<PlayerState>({ state: 'empty' })
  /** последняя команда хоста «смени сцену»; n — чтобы повтор той же сцены тоже считался командой */
  const [sceneReq, setSceneReq] = useState<{ key: string; n: number } | null>(null)
  const current = useRef<Current | null>(null)
  // ЗО[КОНТРАКТ]: слушаем команды «сверху». Пустой sku → очистить.
  useEffect(() => onLoad(sku => setSel(sku ?? '')), [])
  useEffect(() => onScene(key => setSceneReq(r => ({ key, n: (r?.n ?? 0) + 1 }))), [])
  // строго: после ошибки ничего «старого» не показываем
  const drop = useCallback(() => { current.current?.built.skin?.dispose(); current.current = null; reportScene(null); pageBackground(null) }, [])
  const show = useCallback((sku: string, cur: Current) => {
    setPs({ state: 'ready', sku, built: cur.built, placed: cur.placed })
    reportScene(cur.placed.scene.key)
    pageBackground(cur.placed)
  }, [])

  // ── объект (SKU) ──
  useEffect(() => {
    if (!sel) { drop(); setPs({ state: 'empty' }); return }
    const ctrl = new AbortController(), signal = ctrl.signal
    ;(async () => {
      const rec = await loadSku(sel, signal)
      if (rec.type !== 'simple') throw new Error(`SKU type "${rec.type}" — player accepts only simple`)
      const cur = current.current
      if (cur && cur.object === rec.object) {
        // тот же объект → только скин; геометрия, сцена, камера и холст остаются
        if (cur.built.skinKey !== rec.skin) {
          if (!cur.built.skin) throw new Error(`Object ${rec.object} has no skin binding`)
          const bundle = await loadSkinBundle(cur.loaded, rec.skin, signal)
          if (signal.aborted) { bundle.dispose(); return }
          cur.built.skin.apply(bundle)
          cur.built.note = cur.built.note.replace('скин ' + cur.built.skinKey, 'скин ' + rec.skin)
          cur.built.skinKey = rec.skin
        }
        show(sel, cur)
        return
      }
      drop()
      setPs({ state: 'loading', sku: sel })
      const [id, rev] = rec.object.split('@')
      const loaded = await loadObjectManifest(id, rev)
      const built = await buildFromManifest(loaded, signal, rec.skin)
      if (signal.aborted) { built.skin?.dispose(); return }
      // ЗО[ОБЪЕКТ]: сцену выбирает объект (engine/scenePolicy.ts): при загрузке ведёт объект.
      let placed: Placement
      try {
        const scene = await loadScene(sceneOnLoad(built.scenes), signal)
        if (signal.aborted) { built.skin?.dispose(); return }
        placed = placeInScene(built, scene, playerViewport())
      } catch (e) { built.skin?.dispose(); throw e }
      const next: Current = { object: rec.object, loaded, built, placed }
      current.current = next
      show(sel, next)
    })().catch(e => {
      if (signal.aborted) return
      drop()
      setPs({ state: 'error', sku: sel, reason: e?.message ?? String(e) })
    })
    return () => ctrl.abort()
  }, [sel, drop, show])

  // ── смена сцены хостом у показанного объекта ──
  useEffect(() => {
    if (!sceneReq) return
    const cur = current.current
    if (!cur || !sceneCommandApplies(cur.placed.scene.key, sceneReq.key)) return   // объекта нет — сцену при загрузке выберет объект
    const ctrl = new AbortController(), signal = ctrl.signal
    const stale = () => signal.aborted || current.current !== cur
    ;(async () => {
      const scene = await loadScene(sceneReq.key, signal)
      if (stale()) return
      cur.placed = placeInScene(cur.built, scene, playerViewport())
      setPs(prev => prev.state === 'ready' && prev.built === cur.built ? { ...prev, placed: cur.placed } : prev)
      reportScene(cur.placed.scene.key)
      pageBackground(cur.placed)
    })().catch(e => {
      if (stale()) return
      drop()   // строго: сцена не встала — показ неудачен
      setPs(prev => ({ state: 'error', sku: 'sku' in prev ? prev.sku : '', reason: 'scene: ' + (e?.message ?? String(e)) }))
    })
    return () => ctrl.abort()
  }, [sceneReq, drop])

  // состояние наружу — атрибутом на корне (пригодится для обратной связи)
  useEffect(() => { const r = document.getElementById(PLAYER_ROOT_ID); if (r) r.dataset.state = ps.state }, [ps.state])
  // строго: тень или код сцены не встали — показ объекта считается неудачным, ничего «старого» не оставляем
  const fail = useCallback((what: string, e: unknown) => {
    drop()
    setPs(prev => prev.state === 'ready' ? { state: 'error', sku: prev.sku, reason: what + ': ' + ((e as Error)?.message ?? String(e)) } : prev)
  }, [drop])
  const failShadow = useCallback((e: unknown) => fail('shadow', e), [fail])
  const failScene = useCallback((e: unknown) => fail('scene', e), [fail])
  const built = ps.state === 'ready' ? ps.built : null
  const placed = ps.state === 'ready' ? ps.placed : null
  const limits = useMemo(() => placed ? orbitLimits(new Vector3(...placed.camera.position), new Vector3(...placed.camera.target)) : null, [placed])
  if (ps.state !== 'ready' || !built || !placed || !limits) return <StateView s={ps.state === 'ready' ? { state: 'loading', sku: ps.sku } : ps} />
  const settings = placed.scene.profile.settings, sceneKey = placed.scene.key
  return (
    <>
      <div className="badge">{ps.sku} — {current.current?.object} · {built.note} · сцена {sceneKey}{placed.scene.code ? ' + код' : ''}</div>
      {/* alpha:false — непрозрачный холст, видимый фон даёт 3D-задник сцены */}
      <Canvas camera={{ position: placed.camera.position, fov: placed.camera.fov, near: placed.camera.near, far: placed.camera.far }} dpr={[1, 2]} gl={{ alpha: false }} shadows>
        <Backdrop bg={settings.background} />
        {/* key: окружение для отражений запекается один раз — при смене сцены пересоздаём */}
        <Rig key={sceneKey} p={settings} />
        <primitive object={built.root} />
        <MaterialFrames root={built.root} />
        {built.shadow && placed.shadowLight && <ShadowSlot subject={built.root} prepared={built.shadow} light={placed.shadowLight} onError={failShadow} />}
        <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.13} rotateSpeed={0.65}
          minDistance={0.6} maxDistance={limits.maxDistance} minPolarAngle={0.08} maxPolarAngle={limits.maxPolarAngle}
          target={placed.camera.target} />
        <CameraFilm cam={placed.camera} />
        {/* слот сцены: её код (если есть) — поверх встроенного адаптера; по ключу — пересоздаётся при смене сцены */}
        <SceneSlot key={sceneKey} scene={placed.scene} onError={failScene} />
      </Canvas>
    </>
  )
}
createRoot(document.getElementById(PLAYER_ROOT_ID)!).render(<Viewer />)
