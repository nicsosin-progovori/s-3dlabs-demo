import { Box3, Group, LoadingManager, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three'
import type { Material } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { downloadModel } from './download.ts'
import type { ModelDownloadOptions } from './download'
import { bottleSoftShadows } from './bottleShadows.ts'
import {LabError} from './errors.ts'
import type { SourceProduct, SourceSettings } from './sourceCatalog'

export interface SourceModel { root: Group; productId: string; dispose: () => void }

export async function loadSourceModel(product: SourceProduct,options:ModelDownloadOptions={}): Promise<SourceModel> {
  const manager = new LoadingManager()
  manager.setURLModifier(url => {
    if (/^(data:|blob:)/.test(url)) return url
    throw new Error('The GLB must be self-contained')
  })
  const buffer = await downloadModel(product.assetUrl,options)
  options.signal?.throwIfAborted()
  const root = (await new GLTFLoader(manager).parseAsync(buffer, '')).scene
  const geometries = new Set<Mesh['geometry']>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse(object => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    const copy = (material: Material) => {
      const next = material.clone()
      bottleSoftShadows(next)
      if(next instanceof MeshStandardMaterial)next.envMapIntensity=1
      materials.add(next)
      for (const value of Object.values(next)) if (value instanceof Texture) {textures.add(value);if(product.id==='bottle')value.anisotropy=8}
      return next
    }
    object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material)
    if (object.userData.print_surface) object.visible = false
    object.castShadow = !object.userData.print_surface
    object.receiveShadow = true
  })
  let disposed=false
  const result={ root, productId: product.id, dispose: () => {
    if(disposed)return
    disposed=true
    geometries.forEach(g => g.dispose())
    materials.forEach(m => m.dispose())
    textures.forEach(t => t.dispose())
  } }
  if(options.signal?.aborted){result.dispose();options.signal.throwIfAborted()}
  const size=visibleBounds(root).getSize(new Vector3())
  if(!geometries.size||![size.x,size.y,size.z].every(Number.isFinite)||Math.max(size.x,size.y,size.z)<=0){result.dispose();throw new LabError('modelEmpty')}
  return result
}

/** Unlike Box3.setFromObject, hidden state roots do not contribute to bounds. */
export function visibleBounds(root: Group, excludePrint = true): Box3 {
  root.updateWorldMatrix(true, true)
  const bounds = new Box3()
  const inverse = root.matrixWorld.clone().invert()
  root.traverseVisible(object => {
    if (!(object instanceof Mesh) || (excludePrint && object.userData.print_surface)) return
    object.geometry.computeBoundingBox()
    if (object.geometry.boundingBox) bounds.union(object.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld)))
  })
  return bounds
}

export function configureSourceModel(model: SourceModel, product: SourceProduct, settings: SourceSettings) {
  const color = product.colors.find(c => c.id === settings.color) ?? product.colors[0]
  model.root.traverse(object => {
    if (object.userData.product_state) object.visible = object.userData.product_state === settings.state
    if (!(object instanceof Mesh)) return
    if (object.userData.print_surface) return
    for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(mat instanceof MeshStandardMaterial)) continue
      if (mat.userData.externalSkin) continue
      if (mat.name.startsWith('BottleCoating')) {
        mat.color.set(color.hex)
        mat.metalness = color.metalness ?? 0
        // The GLB already stores the authored roughness in its map; multiplying
        // by .49 again would turn a powder coat into glossy plastic.
        mat.roughness = (color.roughness ?? .49)/(mat.roughnessMap?.49:1)
      } else if (mat.name.startsWith('EndoStrap')) mat.color.set(color.hex)
      else if (mat.name.startsWith('EndoFrame')) mat.color.set(color.frame ?? color.hex)
    }
  })
}

export interface LayoutEntry { index: number; position: [number, number, number]; bounds: Box3; sizeMm: number[] }
/** Preserve physical scale, ground every state (or its explicit hover), centre each
 * visible footprint and keep a real 30 mm gap. No packaging-volume metadata. */
export function arrangeSources(models: SourceModel[], settings: SourceSettings[], products: SourceProduct[], axis = new Vector3(1,0,0)): LayoutEntry[] {
  const entries = models.map((model, index) => {
    const p = products[index]
    const s = settings[index]
    configureSourceModel(model, p, s)
    model.root.position.set(0,0,0)
    const bounds = visibleBounds(model.root)
    const size = bounds.getSize(new Vector3())
    return { index, position: [0,0,0] as [number,number,number], bounds, sizeMm: size.toArray().map(v => Math.round(v * 1000)) }
  })
  const span = (entry: LayoutEntry) => {
    const size=entry.bounds.getSize(new Vector3())
    return size.x*Math.abs(axis.x)+size.z*Math.abs(axis.z)
  }
  const width = entries.reduce((n,e) => n + span(e), 0) + Math.max(0, entries.length-1)*.030
  let cursor = -width/2
  for (const entry of entries) {
    const width = span(entry)
    const centre = entry.bounds.getCenter(new Vector3())
    const hover = (products[entry.index].states.find(s => s.id === settings[entry.index].state)?.hoverMm ?? 0)/1000
    const midpoint=cursor+width/2
    entry.position = [axis.x*midpoint-centre.x, -entry.bounds.min.y + hover, axis.z*midpoint-centre.z]
    entry.bounds.translate(new Vector3(...entry.position))
    cursor += width + .030
  }
  return entries
}
