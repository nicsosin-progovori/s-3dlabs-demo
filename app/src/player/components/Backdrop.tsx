import { useEffect, useMemo } from 'react'
import { BackSide, Color, DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace } from 'three'

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
export function Backdrop({ bg }: { bg?: { top: string; bottom: string } }) {
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
