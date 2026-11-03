export const COMPOSITION_SCHEMA=1
export const MAX_COMPOSITION_ELEMENTS=8
const forbidden=new Set(['constructor','prototype','__proto__'])
const object=(value,keys,name)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw TypeError('Invalid '+name);return value}
const identifier=value=>{if(typeof value!=='string'||!/^[a-z][a-z0-9_-]{0,47}$/.test(value)||forbidden.has(value))throw TypeError('Invalid composition id');return value}
const vector=(value,fallback,min,max)=>{
  const v=value??fallback
  if(!Array.isArray(v)||v.length!==3||v.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<min||n>max))throw TypeError('Invalid composition transform')
  return [...v]
}
function transform(value={}){
  object(value,['position','rotation','scale'],'composition transform')
  return {position:vector(value.position,[0,0,0],-2,2),rotation:vector(value.rotation,[0,0,0],-360,360),scale:vector(value.scale,[1,1,1],.05,3)}
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
/** The camera core is product-independent. Only prepared delivery adapters may render. */
export function normaliseComposition(value){
  object(value,['schemaVersion','id','primary','root','elements'],'composition')
  if(value.schemaVersion!==COMPOSITION_SCHEMA||!Array.isArray(value.elements)||value.elements.length<1||value.elements.length>MAX_COMPOSITION_ELEMENTS)throw TypeError('Invalid composition elements')
  const seen=new Set(),elements=value.elements.map(raw=>{
    object(raw,['id','product','visible','transform'],'composition element')
    const id=identifier(raw.id)
    if(seen.has(id))throw TypeError('Duplicate composition element id')
    seen.add(id)
    if(raw.product!=='bottle')throw TypeError('No prepared delivery adapter for this composition product')
    if(raw.visible!==undefined&&typeof raw.visible!=='boolean')throw TypeError('Invalid composition visibility')
    return {id,product:'bottle',visible:raw.visible??true,transform:transform(raw.transform)}
  })
  const primary=identifier(value.primary)
  if(!elements.some(e=>e.id===primary&&e.visible))throw TypeError('Composition requires a visible primary element')
  return freeze({schemaVersion:COMPOSITION_SCHEMA,id:identifier(value.id),primary,root:transform(value.root),elements})
}
export const DEFAULT_COMPOSITION=normaliseComposition({schemaVersion:1,id:'main',primary:'bottle',elements:[{id:'bottle',product:'bottle'}]})
export const compositionKey=value=>JSON.stringify(normaliseComposition(value))
