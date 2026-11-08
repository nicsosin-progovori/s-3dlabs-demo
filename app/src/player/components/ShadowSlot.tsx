import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { BuiltObject } from '../engine/objectEngine'
import { attachShadow, type ShadowInstance } from '../sockets/shadowSocket'

/** ГНЕЗДО ТЕНИ. Плеер теней не рисует: он вставляет пакет тени, который выбрал объект
 *  (render.shadow), и даёт ему сцену, объект и свет сцены. Контракт — sockets/shadowSocket.ts, app/contracts/shadow.schema.json.
 *  Строго: ошибка тени = ошибка показа (onError → состояние плеера error). */
export function ShadowSlot({ built, onError }: { built: BuiltObject; onError: (e: unknown) => void }) {
  const gl = useThree(s => s.gl), scene = useThree(s => s.scene), invalidate = useThree(s => s.invalidate)
  const live = useRef<ShadowInstance | null>(null)
  useEffect(() => {
    if (!built.shadow) return
    let instance: ShadowInstance
    try { instance = attachShadow(built.shadow.prepared, { renderer: gl, scene, subject: built.root, light: built.shadow.light }) }
    catch (e) { onError(e); return }
    live.current = instance
    invalidate()
    return () => { live.current = null; instance.dispose() }
  }, [built, gl, scene, invalidate, onError])
  useFrame(({ camera }) => {
    try { if (live.current?.update({ camera })) invalidate() }
    catch (e) { live.current = null; onError(e) }
  })
  return null
}
