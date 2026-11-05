import { createRoot } from 'react-dom/client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, Lightformer, AccumulativeShadows, RandomizedLight } from '@react-three/drei'
import { ACESFilmicToneMapping, MathUtils, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three'
import { loadObjectManifest } from './objectLoader'
import { buildFromManifest, type BuiltObject } from './objectEngine'

/* Зоны ответственности помечены "ЗО[...]" — легенда в objectEngine.ts.
 * Здесь render-оболочка плеера: свет-рига, тени, контролы, крен камеры. */

async function buildObject(id: string, rev: string, signal: AbortSignal): Promise<BuiltObject> {
  return buildFromManifest(await loadObjectManifest(id, rev), signal)
}

/** Свет/окружение. ЗО[ОБЪЕКТ]: значения из сцены объекта. ЗО[СТУДИЯ?]: сама обвязка — показ.
 *  ЗО[ВОПРОС]: tone mapping жёстко ACESFilmic (переопределяет scene.toneMapping объекта). */
function Rig({ p }: { p: any }) {
  const gl = useThree(s => s.gl)
  useLayoutEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping            // ЗО[ВОПРОС]: игнорит p.toneMapping
    gl.toneMappingExposure = p?.exposure ?? 1          // ЗО[ОБЪЕКТ]
    gl.outputColorSpace = SRGBColorSpace               // ЗО[ОБЩЕЕ]
  }, [gl, p])
  const boxes: any[] = p?.environment?.boxes ?? []
  return (
    <>
      <ambientLight intensity={p?.ambient ?? 0.4} />
      {p?.hemisphere && <hemisphereLight args={[p.hemisphere.sky, p.hemisphere.ground, p.hemisphere.intensity]} />}
      {p?.key && <directionalLight position={p.key.position} intensity={p.key.intensity} color={p.key.color} />}
      {p?.fill && <directionalLight position={p.fill.position} intensity={p.fill.intensity} color={p.fill.color} />}
      {/* ЗО[СТУДИЯ?]: Environment-софтбоксы как «студийное окружение» — оформление показа. */}
      <Environment resolution={256} environmentIntensity={p?.environment?.intensity ?? 1} frames={1}>
        <color attach="background" args={['#111']} />
        {boxes.map((b, i) => (
          <Lightformer key={i} form="rect" intensity={b.intensity} color={b.color}
            position={b.position} scale={[b.scale?.[0] ?? 2, b.scale?.[1] ?? 2, 1]} />
        ))}
        {boxes.length === 0 && <Lightformer form="rect" intensity={2} position={[0, 4, 2]} scale={[6, 6, 1]} />}
      </Environment>
    </>
  )
}

/** Студийные тени. ЗО[ОБЪЕКТ]: ВСЕ параметры (frames, scale, position, opacity, color, radius,
 *  contact, area/contactSamples) — из сцены объекта (scene.shadow). ЗО[СТУДИЯ?]: сама схема
 *  (AccumulativeShadows + 2 RandomizedLight: «area» по направлению key + «contact» сверху) —
 *  способ показа; тот же, что в студии (StudioStage). Запекается один раз, при орбите камеры
 *  не пересчитывается (тень зависит от объекта и света, не от камеры). */
function StudioShadows({ s, keyPos }: { s: any; keyPos?: number[] }) {
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

/** ЗО[ОБЩЕЕ]: лимиты орбиты — та же математика, что в студии (bottleOrbitLimits).
 *  Держит камеру над полом и ограничивает отдаление. Константы (пол .06, кэп 12) — в системе
 *  мира ×worldScale. ЗО[ПОЛИТИКА]: это политика плеера (кандидат в слой «студия»). */
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

function Viewer() {
  const [built, setBuilt] = useState<BuiltObject | null>(null)
  const [note, setNote] = useState('Загрузка…')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    // ЗО[ПОЛИТИКА]: дефолтный объект 'bottle@v01', если не задан ?object= — удобство плеера.
    const q = new URLSearchParams(location.search).get('object') ?? 'bottle@v01'
    const [id, rev = 'v01'] = q.split('@')
    buildObject(id, rev, ctrl.signal)
      .then(b => {
        setBuilt(b); setNote(`${id}@${rev} — ${b.note}`)
        const bg = b.scene?.background // ЗО[ВОПРОС]: фон = объект или студия?
        if (bg) document.body.style.background = `linear-gradient(180deg, ${bg.top} 0%, ${bg.bottom} 100%)`
      })
      .catch(e => setError(e?.message ?? String(e)))
    return () => ctrl.abort()
  }, [])
  const limits = useMemo(() => built ? orbitLimits(new Vector3(...built.camera.position), new Vector3(...built.camera.target)) : null, [built])
  if (error) return <div className="msg err">Объект не загрузился: {error}</div>
  if (!built || !limits) return <div className="msg">{note}</div>
  return (
    <>
      <div className="badge">{note}</div>
      <Canvas camera={{ position: built.camera.position, fov: built.camera.fov, near: built.camera.near, far: built.camera.far }} dpr={[1, 2]} gl={{ alpha: true }} shadows>
        <Rig p={built.scene} />
        <primitive object={built.root} />
        <StudioShadows s={built.scene?.shadow} keyPos={built.scene?.key?.position} />
        {/* ЗО[ПОЛИТИКА]: лимиты орбиты как в студии — pan выкл., приближение/отдаление и угол над полом ограничены. */}
        <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.13} rotateSpeed={0.65}
          minDistance={0.6} maxDistance={limits.maxDistance} minPolarAngle={0.08} maxPolarAngle={limits.maxPolarAngle}
          target={built.camera.target} />
        <CameraFilm cam={built.camera} />
      </Canvas>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Viewer />)
