import { useFrame } from '@react-three/fiber'
import type { BuiltObject } from '../engine/objectEngine'
import { updateMaterialFrames } from '../materials/materialPipeline'

/** Кадровый шаг пула материалов: процессоры с onFrame (напр. блеск от угла камеры) получают камеру. */
export function MaterialFrames({ root }: { root: BuiltObject['root'] }) {
  useFrame(({ camera, size }) => updateMaterialFrames(root, { camera, size: { width: size.width, height: size.height } }))
  return null
}
