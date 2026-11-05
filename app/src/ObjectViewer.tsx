import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Group } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { loadObjectManifest, pickGeometryUrl, skinResource } from './objectLoader'
import { loadSkin, bindSkin } from './skinLoader'

/** Движок интерпретирует объект по манифесту: геометрия + скин (далее сцена/камера). */
async function buildObject(id: string, rev: string, signal: AbortSignal): Promise<{ root: Group; note: string }> {
  const o = await loadObjectManifest(id, rev)
  const geoUrl = pickGeometryUrl(o)
  const gltf = await new GLTFLoader().loadAsync(geoUrl)
  const root = gltf.scene
  root.traverse(obj => { if (obj.userData.print_surface) obj.visible = false })
  const compat = o.manifest.render?.compatibility
  if (compat) root.userData.skinCompatibility = compat
  let note = 'геометрия + скин'
  const skinKey = o.manifest.render?.defaultSkin
  if (skinKey) {
    try {
      const r = skinResource(o, skinKey)
      const bundle = await loadSkin({ id: r.id, revision: r.revision }, 'final', signal, 'high', { basePath: r.basePath, descriptor: r.descriptor })
      bindSkin({ root, productId: o.manifest.id, dispose: () => {} }, bundle)
      note = `скин ${skinKey} применён`
    } catch (e) {
      note = 'геометрия (скин не применился: ' + ((e as Error)?.message ?? e) + ')'
    }
  }
  return { root, note }
}

function Viewer() {
  const [root, setRoot] = useState<Group | null>(null)
  const [note, setNote] = useState('Загрузка…')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    const q = new URLSearchParams(location.search).get('object') ?? 'bottle@v01'
    const [id, rev = 'v01'] = q.split('@')
    buildObject(id, rev, ctrl.signal)
      .then(r => { setRoot(r.root); setNote(`${id}@${rev} — ${r.note}`) })
      .catch(e => setError(e?.message ?? String(e)))
    return () => ctrl.abort()
  }, [])
  if (error) return <div className="msg err">Объект не загрузился: {error}</div>
  return (
    <>
      <div className="badge">{note}</div>
      <Canvas camera={{ position: [0.45, 0.3, 0.5], fov: 35 }} dpr={[1, 2]}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[2, 3, 2]} intensity={2.2} />
        <directionalLight position={[-2, 1, -2]} intensity={0.7} />
        {root && <primitive object={root} />}
        <OrbitControls target={[0, 0.1, 0]} />
      </Canvas>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Viewer />)
