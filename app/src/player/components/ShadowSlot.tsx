import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Object3D } from 'three'
import { attachShadow, type PreparedShadow, type SceneShadowLight, type ShadowInstance } from '../sockets/shadowSocket'

/** ГНЕЗДО ТЕНИ. Плеер теней не рисует: он вставляет пакет тени, который выбрал объект
 *  (render.shadow), и даёт ему сцену, объект и свет СЦЕНЫ. Контракт — sockets/shadowSocket.ts, app/contracts/shadow.schema.json.
 *  Сменилась сцена (другой свет) — тень вставляется заново.
 *  Строго: ошибка тени = ошибка показа (onError → состояние плеера error). */
export function ShadowSlot({ subject, prepared, light, onError }: { subject: Object3D; prepared: PreparedShadow; light: SceneShadowLight; onError: (e: unknown) => void }) {
  const gl = useThree(s => s.gl), scene = useThree(s => s.scene), invalidate = useThree(s => s.invalidate)
  const live = useRef<ShadowInstance | null>(null)
  useEffect(() => {
    let instance: ShadowInstance
    try { instance = attachShadow(prepared, { renderer: gl, scene, subject, light }) }
    catch (e) { onError(e); return }
    live.current = instance
    invalidate()
    return () => { live.current = null; instance.dispose() }
  }, [subject, prepared, light, gl, scene, invalidate, onError])
  useFrame(({ camera }) => {
    try { if (live.current?.update({ camera })) invalidate() }
    catch (e) { live.current = null; onError(e) }
  })
  return null
}
