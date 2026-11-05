import { createRoot } from 'react-dom/client'
import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { loadObjectManifest, pickGeometryUrl } from './objectLoader'

function Model({ url }: { url: string }) {
  const gltf = useGLTF(url)
  return <primitive object={gltf.scene} />
}

function Viewer() {
  const [url, setUrl] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('object') ?? 'bottle@v01'
    const [id, rev = 'v01'] = q.split('@')
    loadObjectManifest(id, rev)
      .then(o => { setUrl(pickGeometryUrl(o)); setLabel(`${o.manifest.id}@${o.manifest.revision}`) })
      .catch(e => setError(e?.message ?? String(e)))
  }, [])
  if (error) return <div className="msg err">Объект не загрузился: {error}</div>
  return (
    <>
      <div className="badge">object: {label || '…'} — грузится по ID из /objects/</div>
      <Canvas camera={{ position: [0.45, 0.3, 0.5], fov: 35 }} dpr={[1, 2]}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 2]} intensity={2} />
        <directionalLight position={[-2, 1, -2]} intensity={0.6} />
        <Suspense fallback={null}>{url && <Model url={url} />}</Suspense>
        <OrbitControls target={[0, 0.1, 0]} />
      </Canvas>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Viewer />)
