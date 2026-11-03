import { Box3, Group, LoadingManager, Mesh, Texture, Vector3 } from 'three'
import type { Material } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { LabError } from './errors.ts'
import { downloadModel } from './download.ts'
import type {ModelDownloadOptions} from './download.ts'
import type { LoadedModel, Product } from './types'

export async function loadModel(product: Product,options:ModelDownloadOptions={}): Promise<LoadedModel> {
  const name = `${product.id}.glb`
  const manager = new LoadingManager()
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url
    throw new LabError('modelExternal')
  })
  const loader = new GLTFLoader(manager)
  let scene: Group
  let fileSize = 0
  try {
    const buffer = await downloadModel(product.assetUrl,options)
    options.signal?.throwIfAborted()
    fileSize = buffer.byteLength
    scene = (await loader.parseAsync(buffer, '')).scene
  } catch (error) {
    options.signal?.throwIfAborted()
    const message = error instanceof Error ? error.message : ''
    if (/draco|meshopt|ktx2|basisu/i.test(message)) {
      throw new LabError('modelCompression')
    }
    if (error instanceof LabError) throw error
    throw new LabError('modelRead')
  }

  const originals: LoadedModel['originals'] = new Map()
  let triangles = 0
  let meshCount = 0
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    meshCount++
    originals.set(object, object.material)
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0) / 3
  })

  let disposed=false
  const dispose = () => {
    if(disposed)return
    disposed=true
    const seen = new Set<object>()
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      if (!seen.has(object.geometry)) {
        seen.add(object.geometry)
        object.geometry.dispose()
      }
      const source = originals.get(object) ?? object.material
      for (const material of Array.isArray(source) ? source : [source]) {
        if (seen.has(material)) continue
        seen.add(material)
        for (const value of Object.values(material)) {
          if (value instanceof Texture && !seen.has(value)) {
            seen.add(value)
            value.dispose()
          }
        }
        material.dispose()
      }
    })
  }

  if(options.signal?.aborted){dispose();options.signal.throwIfAborted()}

  scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(scene)
  const size = box.getSize(new Vector3())
  const maxSize = Math.max(size.x, size.y, size.z)
  if (!meshCount || !Number.isFinite(maxSize) || maxSize <= 0) {
    dispose()
    throw new LabError('modelEmpty')
  }
  const root = new Group()
  root.add(scene)
  const scale = product.displaySize / (product.dimensionMm / 1000)
  root.scale.setScalar(scale)
  root.position.set(0, -(box.min.y + size.y / 2) * scale, 0)
  return {
    id: product.id, name, root, originals,
    triangles: Math.round(triangles), meshCount, fileSize, dispose,
  }
}

export function printableMaterial(source: Material, texture: Texture) {
  const material = source.clone()
  if ('map' in material) material.map = texture
  else { material.dispose(); return null }
  if ('color' in material && material.color && typeof material.color === 'object' && 'set' in material.color) {
    (material.color as { set: (value: string) => void }).set('#ffffff')
  }
  material.transparent = true
  material.opacity = 1
  material.depthWrite = false
  material.alphaTest = 0.001
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  material.polygonOffsetUnits = -2
  material.needsUpdate = true
  return material
}
