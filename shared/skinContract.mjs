import registry from './bottleSkins.json' with {type:'json'}

export const DEFAULT_SKIN=Object.freeze({...registry.defaultSkin})
export const SKIN_COMPATIBILITY=Object.freeze({...registry.compatibility})
export const SKIN_REGISTRY=registry
export function normaliseSkin(value){
  if(!value||typeof value!=='object'||typeof value.id!=='string'||typeof value.revision!=='string')throw new TypeError('Skin requires id and revision')
  if(!registry.skins.some(s=>s.id===value.id&&s.revision===value.revision))throw new TypeError('Unknown skin or revision')
  return {id:value.id,revision:value.revision}
}
export function skinDescriptor(value){
  const ref=normaliseSkin(value)
  return registry.skins.find(s=>s.id===ref.id&&s.revision===ref.revision)
}
export function sameSkin(a,b){return a.id===b.id&&a.revision===b.revision}
export function availableSkins(){return registry.skins.map(s=>({id:s.id,revision:s.revision,label:{...s.label}}))}
