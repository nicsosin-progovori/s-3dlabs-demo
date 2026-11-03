import specification from '../models/bottle/specification.json' with {type:'json'}

export const LOGO_MAX_EDGE=2048
export const LOGO_MAX_BYTES=17*1024*1024
export const DEFAULT_DECORATION=Object.freeze({enabled:true,surface:'body',technique:'laser',colors:1,logo:Object.freeze({kind:'sample'})})
function object(value,keys,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw TypeError('Invalid '+name)
  return value
}
export function normaliseLogoRef(value){
  object(value,['kind','sha256','width','height'],'logo reference')
  if(['sample','none'].includes(value.kind)){
    if(Object.keys(value).length!==1)throw TypeError('Unexpected logo metadata')
    return {kind:value.kind}
  }
  if(value.kind!=='uploaded'||!/^[a-f0-9]{64}$/.test(value.sha256)||![value.width,value.height].every(n=>Number.isInteger(n)&&n>=1&&n<=LOGO_MAX_EDGE))throw TypeError('Invalid uploaded logo reference')
  return {kind:'uploaded',sha256:value.sha256,width:value.width,height:value.height}
}
export function decorationZone(surface,technique){return specification.zones.find(zone=>zone.surface===surface&&zone.techniques.includes(technique))}
export function maxPrintColors(technique){return technique==='pad'?4:1}
export function normaliseDecoration(value){
  object(value,['enabled','surface','technique','colors','logo'],'decoration')
  if(typeof value.enabled!=='boolean'||!['body','lid'].includes(value.surface)||!decorationZone(value.surface,value.technique))throw TypeError('Unsupported bottle decoration')
  if(!Number.isInteger(value.colors)||value.colors<1||value.colors>maxPrintColors(value.technique))throw TypeError('Invalid print colour count')
  return {enabled:value.enabled,surface:value.surface,technique:value.technique,colors:value.colors,logo:normaliseLogoRef(value.logo)}
}
/** A placement change keeps a compatible method, otherwise returns to engraving. */
export function patchDecoration(current,patch){
  object(patch,['enabled','surface','technique','colors'],'decoration patch')
  const next={...normaliseDecoration(current),...patch}
  if(patch.surface!==undefined&&patch.technique===undefined&&!decorationZone(next.surface,next.technique))next.technique='laser'
  if(patch.colors===undefined)next.colors=Math.min(next.colors,maxPrintColors(next.technique))
  return normaliseDecoration(next)
}
export const decorationKey=value=>JSON.stringify(normaliseDecoration(value))
