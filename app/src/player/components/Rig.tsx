import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { ACESFilmicToneMapping, BackSide, SRGBColorSpace } from 'three'

/** Свет + окружение для ОТРАЖЕНИЙ (IBL). ЗО[ОБЪЕКТ]: surround/boxes/resolution/intensity и
 *  свет — всё из сцены объекта. ЗО[СТУДИЯ?]: сама схема (surround-сфера + софтбоксы) — показ,
 *  та же, что в студийном StudioStage. ЗО[ВОПРОС]: tone mapping жёстко ACES (переопределяет scene.toneMapping). */
export function Rig({ p }: { p: any }) {
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
