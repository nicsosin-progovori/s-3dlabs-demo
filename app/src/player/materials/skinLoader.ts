import {DoubleSide,FrontSide,LinearFilter,LinearMipmapLinearFilter,LinearMipmapNearestFilter,LinearSRGBColorSpace,Mesh,MeshPhysicalMaterial,MeshStandardMaterial,MirroredRepeatWrapping,NearestFilter,NearestMipmapLinearFilter,NearestMipmapNearestFilter,NoColorSpace,RepeatWrapping,ClampToEdgeWrapping,SRGBColorSpace,Texture} from 'three'
// Копия загрузчика скинов ДЛЯ ПЛЕЕРА (старая студия — src/skinLoader.ts, не трогаем).
// Отличия: улучшение скина (код) через пул материалов; движок не вешает тени (тень — пакет, sockets/shadowSocket.ts).
// TODO(I-01): skinContract/bottleSkins.json и compatible() — привязка к бутылке, следующий шаг issue #1.
import {skinDescriptor,normaliseSkin,SKIN_COMPATIBILITY} from '../../../shared/skinContract.mjs'
import type {SkinRef,SkinCompatibility} from '../../../shared/skinContract.mjs'
import {SkinResourceCache,SkinFetchQueue} from '../../skinResources'
import type {ResourceLease} from '../../skinResources'
import {attachEnhancement,prepareEnhancement,validateEnhancementRef} from './skinEnhancement'
import type {PreparedSkinEnhancement,SkinEnhancementRef} from './skinEnhancement'
import type {Material} from 'three'
import type {Object3D} from 'three'
/** Что нужно привязке скина от модели: только корень сцены объекта. */
export interface SkinTargetModel {root:Object3D}

export type SkinQuality='low'|'final'
interface ImageAsset {name:string;file:string;sha256:string;bytes:number;width:number;height:number;mimeType:string}
interface Transform {offset?:[number,number];scale?:[number,number];rotation?:number;texCoord?:number}
interface TextureInfo {index:number;texCoord?:number;scale?:number;strength?:number;extensions?:{KHR_texture_transform?:Transform}}
interface MaterialDef {
  name:string;extras:{materialSlotId:string};doubleSided?:boolean;alphaMode?:string;alphaCutoff?:number
  pbrMetallicRoughness?:{baseColorFactor?:[number,number,number,number];metallicFactor?:number;roughnessFactor?:number;baseColorTexture?:TextureInfo;metallicRoughnessTexture?:TextureInfo}
  normalTexture?:TextureInfo;occlusionTexture?:TextureInfo;emissiveTexture?:TextureInfo;emissiveFactor?:[number,number,number]
  extensions?:{
    KHR_materials_clearcoat?:{clearcoatFactor?:number;clearcoatRoughnessFactor?:number;clearcoatTexture?:TextureInfo;clearcoatRoughnessTexture?:TextureInfo;clearcoatNormalTexture?:TextureInfo}
    KHR_materials_anisotropy?:{anisotropyStrength?:number;anisotropyRotation?:number;anisotropyTexture?:TextureInfo}
  }
}
interface Profile {images:ImageAsset[];textures:Array<{source:number;sampler?:number}>;samplers:Array<{wrapS?:number;wrapT?:number;magFilter?:number;minFilter?:number}>}
interface SkinManifest extends SkinRef {schemaVersion:number;compatibility:SkinCompatibility;materials:MaterialDef[];profiles:Record<SkinQuality,Profile>;enhancement?:SkinEnhancementRef}
/** Базовый скин (materials) всегда; улучшение (код) — только если объявлено в skin.json. */
export interface SkinBundle {ref:SkinRef;materials:Map<string,MeshStandardMaterial>;enhancement:PreparedSkinEnhancement|null;dispose:()=>void}
const manifests=new SkinResourceCache<SkinManifest>(16,16,()=>1,()=>{})
const images=new SkinResourceCache<ImageBitmap>(16*1024*1024,32,v=>v.width*v.height*4,v=>v.close())
interface OwnedTexture {texture:Texture;image:ResourceLease<ImageBitmap>;bytes:number}
const textures=new SkinResourceCache<OwnedTexture>(16*1024*1024,64,v=>v.bytes,v=>{v.texture.dispose();v.image.release()})
const fetchQueue=new SkinFetchQueue(2)
const digest=async(data:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('')
const url=(file:string,base:string=import.meta.env.BASE_URL)=>new URL(base+file,location.href).href
async function bytes(file:string,hash:string,size:number,signal:AbortSignal,priority:RequestPriority,base?:string){
  return fetchQueue.run(signal,priority,async()=>{
    const response=await fetch(url(file,base),{signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)]),priority})
    if(!response.ok)throw new Error('Skin resource HTTP '+response.status)
    const data=await response.arrayBuffer()
    if(data.byteLength!==size||await digest(data)!==hash)throw new Error('Skin resource integrity mismatch')
    signal.throwIfAborted();return data
  })
}
const compatible=(value:SkinCompatibility)=>value?.modelId===SKIN_COMPATIBILITY.modelId&&value?.uvLayout===SKIN_COMPATIBILITY.uvLayout&&value?.materialBindings===SKIN_COMPATIBILITY.materialBindings
function validateManifest(manifest:SkinManifest,ref:SkinRef){
  if(manifest.schemaVersion!==1||manifest.id!==ref.id||manifest.revision!==ref.revision||!compatible(manifest.compatibility))throw new Error('Incompatible skin manifest')
  if(!Array.isArray(manifest.materials)||manifest.materials.length!==7)throw new Error('Invalid material slots')
  const slots=new Set<string>()
  for(const m of manifest.materials){
    if(!m.extras?.materialSlotId||slots.has(m.extras.materialSlotId))throw new Error('Duplicate or missing material slot')
    slots.add(m.extras.materialSlotId)
    if(Object.keys(m.extensions??{}).some(k=>!['KHR_materials_clearcoat','KHR_materials_anisotropy'].includes(k)))throw new Error('Unsupported material extension')
  }
  if(manifest.enhancement!==undefined)validateEnhancementRef(manifest.enhancement)
  for(const profile of Object.values(manifest.profiles)){
    if(!Array.isArray(profile.images)||profile.images.length>32)throw new Error('Invalid texture profile')
    for(const im of profile.images)if(!/^[a-f0-9]{64}$/.test(im.sha256)||im.file!=='textures/'+im.sha256+'.png'||im.mimeType!=='image/png'||im.bytes<=0||im.bytes>2*1024*1024||im.width<1||im.height<1||im.width>2048||im.height>2048)throw new Error('Invalid skin image')
  }
}
const wrap=(value=10497)=>({10497:RepeatWrapping,33071:ClampToEdgeWrapping,33648:MirroredRepeatWrapping}[value]??RepeatWrapping)
const minFilter=(value=9987)=>({9728:NearestFilter,9729:LinearFilter,9984:NearestMipmapNearestFilter,9985:LinearMipmapNearestFilter,9986:NearestMipmapLinearFilter,9987:LinearMipmapLinearFilter}[value]??LinearMipmapLinearFilter)
async function textureLease(info:TextureInfo,profile:Profile,color:boolean,signal:AbortSignal,priority:RequestPriority,base?:string){
  const definition=profile.textures[info.index]
  if(!definition)throw new Error('Invalid skin texture index')
  const im=profile.images[definition.source],sampler=profile.samplers[definition.sampler??-1]??{},transform=info.extensions?.KHR_texture_transform??{}
  if(!im)throw new Error('Invalid skin image index')
  const key=JSON.stringify([im.sha256,sampler.wrapS??10497,sampler.wrapT??10497,sampler.magFilter??9729,sampler.minFilter??9987,transform.offset??[0,0],transform.scale??[1,1],transform.rotation??0,transform.texCoord??info.texCoord??0,color])
  return textures.acquire(key,async resourceSignal=>{
    const image=await images.acquire(im.sha256,async imageSignal=>{
      const data=await bytes(im.file,im.sha256,im.bytes,imageSignal,priority,base)
      const bitmap=await createImageBitmap(new Blob([data],{type:im.mimeType}),{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'})
      if(bitmap.width!==im.width||bitmap.height!==im.height){bitmap.close();throw new Error('Skin image dimensions mismatch')}
      return bitmap
    },resourceSignal)
    try{
      const texture=new Texture(image.value);texture.name=im.name;texture.flipY=false
      texture.colorSpace=color?SRGBColorSpace:NoColorSpace;texture.channel=transform.texCoord??info.texCoord??0
      texture.wrapS=wrap(sampler.wrapS);texture.wrapT=wrap(sampler.wrapT)
      texture.magFilter=sampler.magFilter===9728?NearestFilter:LinearFilter;texture.minFilter=minFilter(sampler.minFilter)
      texture.generateMipmaps=texture.minFilter!==NearestFilter&&texture.minFilter!==LinearFilter
      if(transform.offset)texture.offset.fromArray(transform.offset)
      if(transform.scale)texture.repeat.fromArray(transform.scale)
      texture.rotation=transform.rotation??0;texture.anisotropy=8;texture.needsUpdate=true
      return {texture,image,bytes:im.width*im.height*4}
    }catch(error){image.release();throw error}
  },signal)
}
export async function loadSkin(input:SkinRef,quality:SkinQuality,signal:AbortSignal,priority:RequestPriority='high',resources?:{basePath?:string;descriptor?:{file:string;sha256:string;bytes:number}}):Promise<SkinBundle>{
  const ref=normaliseSkin(input),base=resources?.basePath,descriptor=resources?.descriptor??skinDescriptor(ref)
  const manifestLease=await manifests.acquire(descriptor.sha256,async resourceSignal=>{
    const data=await bytes(descriptor.file,descriptor.sha256,descriptor.bytes,resourceSignal,priority,base)
    const manifest=JSON.parse(new TextDecoder().decode(data)) as SkinManifest;validateManifest(manifest,ref);return manifest
  },signal)
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]),leases:ResourceLease<OwnedTexture>[]=[],materials=new Map<string,MeshStandardMaterial>()
  const manifest=manifestLease.value,profile=manifest.profiles[quality]
  const jobs=manifest.materials.map(async definition=>{
    const pbr=definition.pbrMetallicRoughness??{},extension=definition.extensions
    const material=extension?new MeshPhysicalMaterial():new MeshStandardMaterial()
    material.name=definition.name;material.userData={materialSlotId:definition.extras.materialSlotId,externalSkin:true}
    materials.set(definition.extras.materialSlotId,material)
    const factor=pbr.baseColorFactor??[1,1,1,1]
    material.color.setRGB(factor[0],factor[1],factor[2],LinearSRGBColorSpace);material.opacity=factor[3]
    material.metalness=pbr.metallicFactor??1;material.roughness=pbr.roughnessFactor??1
    material.side=definition.doubleSided?DoubleSide:FrontSide
    material.transparent=definition.alphaMode==='BLEND';material.depthWrite=!material.transparent
    if(definition.alphaMode==='MASK')material.alphaTest=definition.alphaCutoff??.5
    material.envMapIntensity=1
    const assign=async(key:string,info:TextureInfo|undefined,color=false)=>{
      if(!info)return
      const lease=await textureLease(info,profile,color,combined,priority,base);leases.push(lease)
      ;(material as unknown as Record<string,unknown>)[key]=lease.value.texture
    }
    await Promise.all([
      assign('map',pbr.baseColorTexture,true),assign('metalnessMap',pbr.metallicRoughnessTexture),assign('roughnessMap',pbr.metallicRoughnessTexture),
      assign('normalMap',definition.normalTexture),assign('aoMap',definition.occlusionTexture),assign('emissiveMap',definition.emissiveTexture,true),
    ])
    if(definition.normalTexture)material.normalScale.setScalar(definition.normalTexture.scale??1)
    if(definition.occlusionTexture)material.aoMapIntensity=definition.occlusionTexture.strength??1
    if(definition.emissiveFactor)material.emissive.setRGB(...definition.emissiveFactor,LinearSRGBColorSpace)
    if(material instanceof MeshPhysicalMaterial){
      const clearcoat=extension?.KHR_materials_clearcoat,anisotropy=extension?.KHR_materials_anisotropy
      material.clearcoat=clearcoat?.clearcoatFactor??0;material.clearcoatRoughness=clearcoat?.clearcoatRoughnessFactor??0
      material.anisotropy=anisotropy?.anisotropyStrength??0;material.anisotropyRotation=anisotropy?.anisotropyRotation??0
      await Promise.all([assign('clearcoatMap',clearcoat?.clearcoatTexture),assign('clearcoatRoughnessMap',clearcoat?.clearcoatRoughnessTexture),assign('clearcoatNormalMap',clearcoat?.clearcoatNormalTexture),assign('anisotropyMap',anisotropy?.anisotropyTexture)])
      if(clearcoat?.clearcoatNormalTexture)material.clearcoatNormalScale.setScalar(clearcoat.clearcoatNormalTexture.scale??1)
    }
  })
  let disposed=false,enhancement:PreparedSkinEnhancement|null=null
  const dispose=()=>{if(disposed)return;disposed=true;enhancement?.dispose?.();materials.forEach(m=>m.dispose());leases.forEach(l=>l.release());manifestLease.release()}
  try{
    await Promise.all(jobs);combined.throwIfAborted()
    const extra=manifest.enhancement
    if(extra){
      // TODO(I-01, откат улучшения): сейчас СТРОГО — ошибка загрузки/подготовки улучшения = ошибка всего скина.
      //   Здесь можно не падать, а вернуть базовый скин без улучшения (enhancement=null) и громко залогировать.
      //   Решение владельца (7 ноя 2026): пока строго; откат — отдельным решением.
      enhancement=await prepareEnhancement(extra,ref,quality,await bytes(extra.file,extra.sha256,extra.bytes,combined,priority,base),combined)
    }
    return {ref,materials,enhancement,dispose}
  }
  catch(error){controller.abort();await Promise.allSettled(jobs);dispose();throw error}
}
export interface SkinBinding {
  ref:SkinRef
  apply:(bundle:SkinBundle)=>void
  preview:(bundle:SkinBundle)=>{root:Object3D;dispose:()=>void}
  dispose:()=>void
}
export function bindSkin(model:SkinTargetModel,initial:SkinBundle):SkinBinding{
  if(!compatible(model.root.userData.skinCompatibility))throw new Error('Geometry skin contract mismatch')
  type Features={derivativeTangents:boolean;vertexColors:boolean;flatShading:boolean}
  const features=(mesh:Mesh):Features=>({derivativeTangents:!mesh.geometry.attributes.tangent,vertexColors:!!mesh.geometry.attributes.color,flatShading:!mesh.geometry.attributes.normal})
  const adapt=(material:MeshStandardMaterial,flags:Features)=>{
    material.vertexColors=flags.vertexColors;material.flatShading=flags.flatShading
    // GLTFLoader.assignFinalMaterial applies the same convention when no
    // authored tangents exist. External maps must keep that normal handedness.
    if(flags.derivativeTangents){material.normalScale.y*=-1;if(material instanceof MeshPhysicalMaterial)material.clearcoatNormalScale.y*=-1}
    return material
  }
  const live=new Map<string,{slot:string;target:MeshStandardMaterial;flags:Features}>()
  // Улучшение скина подключается к ЖИВЫМ материалам слотов через пул (стадия 'skin').
  const bySlot=(targets:Iterable<{slot:string;target:Material}>)=>{const map=new Map<string,Material[]>();for(const {slot,target}of targets){const list=map.get(slot);if(list)list.push(target);else map.set(slot,[target])}return map}
  // TODO(I-01, откат улучшения): строго — ошибка attach() улучшения = ошибка сборки/смены скина.
  //   Здесь можно вместо падения оставить базовый скин без улучшения и громко залогировать.
  const enhance=(bundle:SkinBundle,targets:Iterable<{slot:string;target:Material}>)=>bundle.enhancement?attachEnhancement(bundle.enhancement,bySlot(targets)):null
  model.root.traverse(o=>{
    if(!(o instanceof Mesh))return
    const apply=(original:MeshStandardMaterial)=>{
      const slot=original.userData.materialSlotId,recipe=initial.materials.get(slot)
      if(!recipe)throw new Error('Missing material slot '+String(slot))
      const flags=features(o),key=slot+JSON.stringify(flags)
      if(!live.has(key))live.set(key,{slot,target:adapt(recipe.clone(),flags),flags})
      return live.get(key)!.target
    }
    o.material=Array.isArray(o.material)?o.material.map(m=>apply(m as MeshStandardMaterial)):apply(o.material as MeshStandardMaterial)
  })
  let enhanced:ReturnType<typeof enhance>
  try{enhanced=enhance(initial,live.values())}catch(error){live.forEach(m=>m.target.dispose());throw error}
  let current=initial,disposed=false
  const binding:SkinBinding={
    ref:{...initial.ref},
    apply(bundle){
      if(disposed)throw new Error('Skin binding closed')
      for(const {slot,target}of live.values()){const recipe=bundle.materials.get(slot);if(!recipe||target.type!==recipe.type)throw new Error('Incompatible material class')}
      enhanced?.dispose();enhanced=null
      for(const {slot,target,flags}of live.values()){target.copy(bundle.materials.get(slot)!);adapt(target,flags);target.needsUpdate=true}
      const previous=current;current=bundle;binding.ref={...bundle.ref};previous.dispose()
      enhanced=enhance(bundle,live.values())
    },
    preview(bundle){
      const root=model.root.clone(true),owned=new Map<string,{slot:string;target:MeshStandardMaterial}>()
      root.traverse(o=>{if(o instanceof Mesh){const apply=(m:MeshStandardMaterial)=>{
        const slot=m.userData.materialSlotId,recipe=bundle.materials.get(slot)
        if(!recipe)throw new Error('Missing preview slot')
        const flags=features(o),key=slot+JSON.stringify(flags)
        if(!owned.has(key))owned.set(key,{slot,target:adapt(recipe.clone(),flags)})
        return owned.get(key)!.target
      };o.material=Array.isArray(o.material)?o.material.map(m=>apply(m as MeshStandardMaterial)):apply(o.material as MeshStandardMaterial)}})
      let previewEnhanced:ReturnType<typeof enhance>=null
      try{previewEnhanced=enhance(bundle,owned.values())}catch(error){owned.forEach(m=>m.target.dispose());throw error}
      return {root,dispose:()=>{previewEnhanced?.dispose();owned.forEach(m=>m.target.dispose())}}
    },
    dispose(){if(disposed)return;disposed=true;enhanced?.dispose();live.forEach(m=>m.target.dispose());current.dispose()},
  }
  return binding
}
