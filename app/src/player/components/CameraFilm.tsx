import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import type { PlayerCamera } from '../engine/objectEngine'

/** ЗО[ОБЩЕЕ]: film-roll — поворот up вокруг оси взгляда; орбита всегда с вертикальным up.
 *  Кадр приходит от placeInScene: меняется при новом объекте и при смене сцены (не при смене скина). */
const DEG = Math.PI / 180
export function CameraFilm({ cam }: { cam: PlayerCamera }) {
  const camera = useThree(s => s.camera)
  const target = useRef(new Vector3(...cam.target))
  useLayoutEffect(() => {
    target.current.set(...cam.target)
    // новый кадр (новый объект или смена сцены) — камера встаёт в его позицию
    camera.position.set(...cam.position)
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
