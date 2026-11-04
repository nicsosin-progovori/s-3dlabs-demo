import { Mesh, SkinnedMesh } from 'three'
import type { Material } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { bottleSoftShadows } from './bottleShadows.ts'
import type { SourceModel } from './sourceModel.ts'

/** Geometry and image maps are cached; each displayed product owns its paint and skeleton. */
export function studioInstance(source:SourceModel):SourceModel {
  const root=clone(source.root) as SourceModel['root'],materials=new Map<Material,Material>(),skeletons=new Set<SkinnedMesh['skeleton']>()
  const material=(original:Material)=>{
    let owned=materials.get(original)
    if(!owned){owned=bottleSoftShadows(original.clone());materials.set(original,owned)}
    return owned
  }
  root.traverse(object=>{
    if(object instanceof Mesh)object.material=Array.isArray(object.material)?object.material.map(material):material(object.material)
    if(object instanceof SkinnedMesh)skeletons.add(object.skeleton)
  })
  let disposed=false
  return {root,productId:source.productId,dispose:()=>{
    if(disposed)return;disposed=true
    materials.forEach(m=>m.dispose());skeletons.forEach(s=>s.dispose())
  }}
}
