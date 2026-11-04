import { Mesh, MeshStandardMaterial, ShaderChunk } from 'three'
import type { SourceModel } from './sourceModel'

export interface BottleAppearanceUpgrade {mix:{value:number};restore:()=>void}
const slots=[['map','map_fragment','vMapUv'],['normalMap','normal_fragment_maps','vNormalMapUv'],['roughnessMap','roughnessmap_fragment','vRoughnessMapUv']] as const

/** Blend the original low/high maps on the prepared HQ geometry. The opaque
 * object remains continuous; no canvas snapshot or transparent double is used. */
export function bottleAppearanceUpgrade(low:SourceModel,high:SourceModel):BottleAppearanceUpgrade{
  const previous=new Map<string,MeshStandardMaterial>(),seen=new Set<MeshStandardMaterial>()
  const key=(material:MeshStandardMaterial)=>material.userData.materialSlotId??material.name.replace(/\.\d+$/,'')
  low.root.traverse(object=>{if(object instanceof Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])if(material instanceof MeshStandardMaterial)previous.set(key(material),material)})
  const mix={value:0},restore:Array<()=>void>=[]
  high.root.traverse(object=>{
    if(!(object instanceof Mesh))return
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(!(material instanceof MeshStandardMaterial)||seen.has(material))continue
      seen.add(material)
      const old=previous.get(key(material))
      if(!old)continue
      const pairs=slots.filter(([slot])=>material[slot]&&old[slot])
      if(!pairs.length)continue
      const lowMaps=new Map(pairs.map(([slot])=>[slot,old[slot]!]))
      const compile=material.onBeforeCompile,cache=material.customProgramCacheKey,cacheKey=cache.call(material)
      material.onBeforeCompile=function(shader,renderer){
        compile.call(this,shader,renderer)
        shader.uniforms.bottleLodMix=mix
        let declarations='uniform float bottleLodMix;\n'
        for(const [slot,chunk,uv] of pairs){
          const uniform='bottleLow_'+slot
          declarations+=`uniform sampler2D ${uniform};\n`
          shader.uniforms[uniform]={value:lowMaps.get(slot)}
          const sample=`texture2D( ${slot}, ${uv} )`
          const original=ShaderChunk[chunk]
          if(!original.includes(sample)||!shader.fragmentShader.includes(`#include <${chunk}>`))throw new Error('LOD texture blend does not match renderer shader')
          shader.fragmentShader=shader.fragmentShader.replace(`#include <${chunk}>`,original.replaceAll(sample,`mix( texture2D( ${uniform}, ${uv} ), ${sample}, bottleLodMix )`))
        }
        shader.fragmentShader=declarations+shader.fragmentShader
      }
      // Custom uniforms retain references inside the cached material program.
      // A different low texture needs a fresh variant, even with the same slots.
      const mapKey=pairs.map(([slot])=>slot+':'+lowMaps.get(slot)!.uuid).join(',')
      material.customProgramCacheKey=()=>cacheKey+':bottle-lod-maps-v2:'+mapKey
      material.needsUpdate=true
      restore.push(()=>{material.onBeforeCompile=compile;material.customProgramCacheKey=cache;material.needsUpdate=true})
    }
  })
  let restored=false
  return {mix,restore(){if(restored)return;restored=true;restore.forEach(fn=>fn())}}
}
