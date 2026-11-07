import { createRoot } from 'react-dom/client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, Lightformer, AccumulativeShadows, RandomizedLight } from '@react-three/drei'
import { ACESFilmicToneMapping, BackSide, Color, DataTexture, LinearFilter, MathUtils, PerspectiveCamera, RGBAFormat, SRGBColorSpace, Vector3 } from 'three'
import { loadObjectManifest } from './objectLoader'
import { buildFromManifest, type BuiltObject } from './objectEngine'

/* Зоны ответственности помечены "ЗО[...]" — легенда в objectEngine.ts.
 * Здесь render-оболочка плеера: окружение/фон, свет, тени, контролы, крен камеры. */

async function buildObject(id: string, rev: string, signal: AbortSignal): Promise<BuiltObject> {
  return buildFromManifest(await loadObjectManifest(id, rev), signal)
}

/** Вертикальный градиент top↔bottom в текстуру (sRGB) для видимого задника. */
function gradientTexture(bottom: string, top: string) {
  const n = 256, data = new Uint8Array(n * 4), b = new Color(bottom), t = new Color(top), c = new Color()
  for (let i = 0; i < n; i++) { c.copy(b).lerp(t, i / (n - 1)); const o = i * 4; data[o] = c.r * 255; data[o + 1] = c.g * 255; data[o + 2] = c.b * 255; data[o + 3] = 255 }
  const tex = new DataTexture(data, 1, n, RGBAFormat); tex.colorSpace = SRGBColorSpace
  tex.flipY = false; tex.minFilter = tex.magFilter = LinearFilter; tex.needsUpdate = true
  return tex
}

/** Видимый задник: большая сфера-циклорама с градиентом из background ОБЪЕКТА.
 *  ЗО[ОБЪЕКТ]: цвета top/bottom — из сцены объекта. ЗО[СТУДИЯ?]: сама «бесшовная бумага»
 *  (сфера-градиент) — способ показа, кандидат в слой «студия». Дешёвая замена студийной
 *  циклорамы (studioBackdrop завязан на весь студийный пайплайн — его сюда не тащим). */
function Backdrop({ bg }: { bg?: { top: string; bottom: string } }) {
  const tex = useMemo(() => bg ? gradientTexture(bg.bottom, bg.top) : null, [bg])
  useEffect(() => () => { tex?.dispose() }, [tex])
  if (!tex) return null
  return (
    <mesh scale={60} renderOrder={-1}>
      <sphereGeometry args={[1, 32, 16]} />
      <meshBasicMaterial map={tex} side={BackSide} depthWrite={false} />
    </mesh>
  )
}

/** Свет + окружение для ОТРАЖЕНИЙ (IBL). ЗО[ОБЪЕКТ]: surround/boxes/resolution/intensity и
 *  свет — всё из сцены объекта. ЗО[СТУДИЯ?]: сама схема (surround-сфера + софтбоксы) — показ,
 *  та же, что в студийном StudioStage. ЗО[ВОПРОС]: tone mapping жёстко ACES (переопределяет scene.toneMapping). */
function Rig({ p }: { p: any }) {
  const gl = useThree(s => s.gl)
  useLayoutEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping            // ЗО[ВОПРОС]: игнорит p.toneMapping
    gl.toneMappingExposure = p?.exposure ?? 1          // ЗО[ОБЪЕКТ]
    gl.outputColorSpace = SRGBColorSpace               // ЗО[ОБЩЕЕ]
  }, [gl, p])
  const env = p?.environment ?? {}
  const boxes: any[] = env.boxes ?? []
  return (
    <>
      <ambientLight intensity={p?.ambient ?? 0.4} />
      {p?.hemisphere && <hemisphereLight args={[p.hemisphere.sky, p.hemisphere.ground, p.hemisphere.intensity]} />}
      {p?.key && <directionalLight position={p.key.position} intensity={p.key.intensity} color={p.key.color} />}
      {p?.fill && <directionalLight position={p.fill.position} intensity={p.fill.intensity} color={p.fill.color} />}
      <Environment resolution={env.resolution ?? 256} environmentIntensity={env.intensity ?? 1} frames={1}>
        {/* ЗО[ОБЪЕКТ]: surround объекта — окружение для отражений металла (как в студии). */}
        <mesh scale={40}><sphereGeometry args={[1, 32, 16]} /><meshBasicMaterial color={env.surround ?? '#42413e'} side={BackSide} toneMapped={false} /></mesh>
        {boxes.map((b, i) => (
          <Lightformer key={i} form="rect" intensity={b.intensity} color={b.color}
            position={b.position} scale={[b.scale?.[0] ?? 2, b.scale?.[1] ?? 2, 1]} target={[0, 0, 0]} />
        ))}
        {boxes.length === 0 && <Lightformer form="rect" intensity={2} position={[0, 4, 2]} scale={[6, 6, 1]} />}
      </Environment>
    </>
  )
}

/** Студийные тени. ЗО[ОБЪЕКТ]: все параметры из scene.shadow. ЗО[СТУДИЯ?]: сама схема. */
function StudioShadows({ s, keyPos }: { s: any; keyPos?: [number, number, number] }) {
  if (!s) return null
  const contact = s.contact ?? 0.22
  return (
    <AccumulativeShadows temporal frames={s.frames ?? 48} scale={s.scale ?? 12}
      position={s.position ?? [0, 0.002, 0]} resolution={s.resolution ?? 1024}
      opacity={s.opacity ?? 0.5} color={s.color ?? '#242526'}>
      <RandomizedLight amount={s.areaSamples ?? 8} radius={s.radius ?? 2.8} ambient={0}
        intensity={Math.PI * (1 - contact)} position={keyPos ?? [-3.8, 6.3, 4.2]}
        size={5} near={0.1} far={25} mapSize={s.lightMapSize ?? 1024} bias={0.0002} />
      <RandomizedLight amount={s.contactSamples ?? 4} ambient={1}
        intensity={Math.PI * contact} position={[0, 6, 0]}
        size={5} near={0.1} far={25} mapSize={s.lightMapSize ?? 1024} bias={0.0002} />
    </AccumulativeShadows>
  )
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

/** ЗО[ОБЩЕЕ]: film-roll — поворот up вокруг оси взгляда; орбита всегда с вертикальным up. */
const DEG = Math.PI / 180
function CameraFilm({ cam }: { cam: BuiltObject['camera'] }) {
  const camera = useThree(s => s.camera)
  const target = useRef(new Vector3(...cam.target))
  useLayoutEffect(() => {
    target.current.set(...cam.target)
    if (camera instanceof PerspectiveCamera) { camera.near = cam.near; camera.far = cam.far; camera.fov = cam.fov; camera.updateProjectionMatrix() }
  }, [camera, cam])
  useFrame(() => {
    const dir = camera.position.clone().sub(target.current).normalize()
    camera.up.set(0, 1, 0).applyAxisAngle(dir, (cam.roll ?? 0) * DEG)
    camera.lookAt(target.current)
    camera.up.set(0, 1, 0)
  })
  return null
}

/* ───────────────────────────────────────────────────────────────────────────
 * ПУБЛИЧНЫЙ КОНТРАКТ host ↔ player (кандидат в публичный API).
 * Плеер — ЧИСТЫЙ ПОТРЕБИТЕЛЬ: НЕ владеет списком, НЕ рисует переключатель,
 * НЕ трогает URL и НЕ знает никакого «дефолтного» объекта.
 * Что грузить — решает «кто-то сверху» (host):
 *   • начальный объект — атрибут #root[data-object] = "<id>@<rev>"
 *                        (нет атрибута / иначе ?object= / иначе — пусто);
 *   • смена объекта    — событие window `s3d:load`, detail { object: "<id>@<rev>" | null }.
 * Если объект не задан — плеер показывает пустую страницу с просьбой выбрать. */

function hostKey(): string {
  const fromAttr = document.getElementById('root')?.dataset.object
  const fromUrl = new URLSearchParams(location.search).get('object')
  return fromAttr || fromUrl || ''
}

function Viewer() {
  const [sel, setSel] = useState<string>(hostKey)
  const [built, setBuilt] = useState<BuiltObject | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  // ЗО[КОНТРАКТ]: слушаем команду «сверху». Пустой object → очистить.
  useEffect(() => {
    const onLoad = (e: Event) => {
      const key = (e as CustomEvent).detail?.object
      setSel(typeof key === 'string' ? key : '')
    }
    window.addEventListener('s3d:load', onLoad)
    return () => window.removeEventListener('s3d:load', onLoad)
  }, [])
  useEffect(() => {
    setError(null)
    if (!sel) { setBuilt(null); setNote(''); document.body.style.background = ''; return }
    setBuilt(null); setNote('Загрузка…')
    const ctrl = new AbortController()
    const [id, rev = 'v01'] = sel.split('@')
    buildObject(id, rev, ctrl.signal)
      .then(b => {
        setBuilt(b); setNote(`${id}@${rev} — ${b.note}`)
        const bg = b.scene?.background // ЗО[ОБЪЕКТ]: цвет страницы-подложки до/за сценой
        if (bg) document.body.style.background = bg.bottom
      })
      .catch(e => { if (!ctrl.signal.aborted) setError(e?.message ?? String(e)) })
    return () => ctrl.abort()
  }, [sel])
  const limits = useMemo(() => built ? orbitLimits(new Vector3(...built.camera.position), new Vector3(...built.camera.target)) : null, [built])
  if (!sel) return <div className="msg empty">Выберите объект на панели сверху.</div>
  if (error) return <div className="msg err">Объект не загрузился: {error}</div>
  if (!built || !limits) return <div className="msg">{note}</div>
  return (
    <>
      <div className="badge">{note}</div>
      {/* alpha:false — непрозрачный холст, видимый фон даёт 3D-задник объекта */}
      <Canvas camera={{ position: built.camera.position, fov: built.camera.fov, near: built.camera.near, far: built.camera.far }} dpr={[1, 2]} gl={{ alpha: false }} shadows>
        <Backdrop bg={built.scene?.background} />
        <Rig p={built.scene} />
        <primitive object={built.root} />
        <StudioShadows s={built.scene?.shadow} keyPos={built.scene?.key?.position} />
        <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.13} rotateSpeed={0.65}
          minDistance={0.6} maxDistance={limits.maxDistance} minPolarAngle={0.08} maxPolarAngle={limits.maxPolarAngle}
          target={built.camera.target} />
        <CameraFilm cam={built.camera} />
      </Canvas>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Viewer />)
