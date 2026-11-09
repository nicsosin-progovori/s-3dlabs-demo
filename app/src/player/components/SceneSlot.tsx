import { useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { attachScene, type SceneInstance } from '../sockets/sceneSocket'
import type { LoadedScene } from '../scenes/sceneLoader'

type Attached = SceneInstance & { renders: boolean }

/** СЛОТ СЦЕНЫ. Если сцена привезла код (scene.json → code), плеер вставляет его сюда —
 *  поверх встроенного адаптера (Rig, Backdrop). Контракт — sockets/sceneSocket.ts.
 *  Смена сцены = снять старый код, вставить новый (компонент монтируется по ключу сцены).
 *  Строго: ошибка кода сцены = ошибка показа (onError → состояние плеера error). */
export function SceneSlot({ scene, onError }: { scene: LoadedScene; onError: (e: unknown) => void }) {
  const gl = useThree(s => s.gl), three = useThree(s => s.scene), size = useThree(s => s.size), invalidate = useThree(s => s.invalidate)
  const [live, setLive] = useState<Attached | null>(null)
  useEffect(() => {
    if (!scene.code) return
    let instance: Attached
    try { instance = attachScene(scene.code, { renderer: gl, scene: three, profile: scene.profile, size: { width: size.width, height: size.height } }) }
    catch (e) { onError(e); return }
    setLive(instance)
    invalidate()
    return () => { setLive(null); instance.dispose() }
    // size — не повод пересоздавать код: для этого resize ниже
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, gl, three, invalidate, onError])
  useEffect(() => {
    try { live?.resize?.({ width: size.width, height: size.height }) } catch (e) { onError(e) }
  }, [live, size.width, size.height, onError])
  useFrame(({ camera, size }, delta) => {
    if (!live) return
    try { if (live.update?.({ camera, size: { width: size.width, height: size.height }, delta })) invalidate() }
    catch (e) { setLive(null); onError(e) }
  })
  return live?.renders ? <SceneRender live={live} onError={onError} /> : null
}

/** Код сцены рисует кадр сам (постобработка). useFrame с приоритетом > 0 отключает отрисовку плеера. */
function SceneRender({ live, onError }: { live: Attached; onError: (e: unknown) => void }) {
  useFrame(({ camera, size }, delta) => {
    try { live.render?.({ camera, size: { width: size.width, height: size.height }, delta }) }
    catch (e) { onError(e) }
  }, 1)
  return null
}
