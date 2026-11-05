import { createRoot } from 'react-dom/client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, Lightformer, ContactShadows } from '@react-three/drei'
import { ACESFilmicToneMapping, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three'
import { loadObjectManifest } from './objectLoader'
import { buildFromManifest, type BuiltObject } from './objectEngine'

/* Зоны ответственности помечены "ЗО[...]" — та же легенда, что в objectEngine.ts.
 * Здесь живёт render-оболочка плеера: свет-рига, тени, контролы, крен камеры. */

async function buildObject(id: string, rev: string, signal: AbortSignal): Promise<BuiltObject> {
  return buildFromManifest(await loadObjectManifest(id, rev), signal)
}

/** Свет/окружение. ЗО[ОБЪЕКТ]: ВСЕ значения (exposure, ambient, hemisphere, key/fill, боксы
 *  окружения) берутся из сцены объекта. ЗО[СТУДИЯ?]: но САМА обвязка (какой рига, Environment
 *  как софтбоксы, фон '#111', resolution 256) — выбор плеера/студии, не объекта.
 *  ЗО[ВОПРОС]: tone mapping здесь ЖЁСТКО ACESFilmic — это переопределяет scene.toneMapping объекта.
 *  Кто владеет тонмаппингом: объект, студия или плеер? Сейчас — плеер молча ставит ACES. */
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
        {/* ЗО[ПОЛИТИКА]: запасной софтбокс, если объект не привёз окружение. */}
        {boxes.length === 0 && <Lightformer form="rect" intensity={2} position={[0, 4, 2]} scale={[6, 6, 1]} />}
      </Environment>
    </>
  )
}

/** ЗО[ОБЩЕЕ]: film-roll (крен) — общая математика: поворот up вокруг оси взгляда на roll°.
 *  Орбита всегда с вертикальным up (0,1,0). ЗО[ОБЪЕКТ]: сам угол roll и near/far — из ракурса объекта. */
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
    // ЗО[ПОЛИТИКА]: дефолтный объект 'bottle@v01', если не задан ?object= — это удобство плеера.
    const q = new URLSearchParams(location.search).get('object') ?? 'bottle@v01'
    const [id, rev = 'v01'] = q.split('@')
    buildObject(id, rev, ctrl.signal)
      .then(b => {
        setBuilt(b); setNote(`${id}@${rev} — ${b.note}`)
        // ЗО[ОБЪЕКТ]: фон страницы — из background сцены объекта. ЗО[ВОПРОС]: фон = объект или студия?
        const bg = b.scene?.background
        if (bg) document.body.style.background = `linear-gradient(180deg, ${bg.top} 0%, ${bg.bottom} 100%)`
      })
      .catch(e => setError(e?.message ?? String(e)))
    return () => ctrl.abort()
  }, [])
  if (error) return <div className="msg err">Объект не загрузился: {error}</div>
  if (!built) return <div className="msg">{note}</div>
  return (
    <>
      <div className="badge">{note}</div>
      {/* ЗО[ПОЛИТИКА]: dpr [1,2], alpha, shadows — настройки рендера плеера. */}
      <Canvas camera={{ position: built.camera.position, fov: built.camera.fov, near: built.camera.near, far: built.camera.far }} dpr={[1, 2]} gl={{ alpha: true }} shadows>
        <Rig p={built.scene} />
        <primitive object={built.root} />
        {/* ЗО[ОБЪЕКТ]: opacity/color тени — из сцены. ЗО[ПОЛИТИКА]: scale/blur/resolution — эвристики плеера. */}
        <ContactShadows position={[built.camera.target[0], 0.001, built.camera.target[2]]} opacity={built.scene?.shadow?.opacity ?? 0.5} scale={built.shadowScale} blur={2.5} far={built.shadowScale} resolution={1024} color={built.scene?.shadow?.color ?? '#000000'} />
        {/* ЗО[ПОЛИТИКА]: свободная орбита без лимитов — выбор плеера (в студии лимиты другие). */}
        <OrbitControls makeDefault target={built.camera.target} />
        <CameraFilm cam={built.camera} />
      </Canvas>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Viewer />)
