export const CAMERA_VIEWS_SCHEMA=3
export const CAMERA_VIEWS_MAX_BYTES=64*1024
export const CAMERA_VIEW_STATES=Object.freeze(['closed','open','lying'])
const compatibility={poseContract:'bottle-poses-v01',focusUnits:'millimetres',up:'Y',front:'+Z'}
function object(value,name,keys){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid '+name)
  if(Object.keys(value).some(key=>!keys.includes(key)))throw new TypeError('Unknown field in '+name)
  return value
}
function number(value,name,min,max){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new TypeError('Invalid '+name)
  return value
}
function identifier(value,name){
  if(typeof value!=='string'||!/^[a-z][a-z0-9_-]{0,47}$/.test(value)||['constructor','prototype','__proto__'].includes(value))throw new TypeError('Invalid '+name)
  return value
}
function tuple(value,size,name,min,max){
  if(!Array.isArray(value)||value.length!==size)throw new TypeError('Invalid '+name)
  return value.map(v=>number(v,name,min,max))
}
function label(value){
  object(value,'label',['de','en'])
  const result={}
  for(const language of ['de','en']){
    const text=value[language]
    if(typeof text!=='string'||!text.trim()||text.length>80||/[\u0000-\u001f]/.test(text))throw new TypeError('Invalid view label')
    result[language]=text.trim()
  }
  return result
}
function camera(value,schema){
  object(value,'camera',['azimuth','elevation','fov','roll','subject','margin','focusMm','near','far','zoom',...(schema>=2?['frameTarget']:[])])
  const near=number(value.near??.025,'near',.001,5),far=number(value.far??100,'far',near+.01,500)
  const result={
    azimuth:number(value.azimuth,'azimuth',-360,360),elevation:number(value.elevation,'elevation',-5,5),
    fov:number(value.fov??28,'fov',5,100),roll:number(value.roll??0,'roll',-180,180),
    subject:tuple(value.subject??[0,0],2,'subject',-.4,.4),margin:number(value.margin??1.12,'margin',.5,2),
    near,far,zoom:number(value.zoom??1,'zoom',.25,4),
  }
  if(value.focusMm!==undefined&&value.focusMm!==null){
    object(value.focusMm,'focusMm',['min','max'])
    const min=tuple(value.focusMm.min,3,'focus min',-5000,5000),max=tuple(value.focusMm.max,3,'focus max',-5000,5000)
    if(min.some((n,i)=>n>max[i])||min.every((n,i)=>n===max[i]))throw new TypeError('Invalid focus bounds')
    result.focusMm={min,max}
  }
  if(schema>=2){
    const target=value.frameTarget??(result.focusMm?'primary':'composition')
    if(!['composition','primary'].includes(target)||target==='composition'&&result.focusMm)throw TypeError('Invalid camera composition target')
    result.frameTarget=target
  }
  return result
}
function freeze(value){
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}
  return value
}
/** Data only: no URL, expression or executable camera callback is accepted. */
function statesFor(raw,schema){
  object(raw,'camera states',CAMERA_VIEW_STATES)
  const states={}
  for(const state of CAMERA_VIEW_STATES){
    const source=object(raw[state],'state '+state,['defaultView','views'])
    if(!Array.isArray(source.views)||source.views.length>32)throw new TypeError('Invalid camera view list')
    const seen=new Set(),views=source.views.map(raw=>{
      object(raw,'view',['id','label','camera'])
      const id=identifier(raw.id,'view id')
      if(seen.has(id))throw new TypeError('Duplicate camera view id')
      seen.add(id)
      return {id,label:label(raw.label),camera:camera(raw.camera,schema)}
    })
    const defaultView=source.defaultView===null?null:identifier(source.defaultView,'default view')
    if(defaultView!==null&&!seen.has(defaultView))throw new TypeError('Default camera view is missing')
    states[state]={defaultView,views}
  }
  return states
}
export function validateCameraViews(value){
  object(value,'camera catalog',['schemaVersion','modelId','revision','compatibility','states',...(value?.schemaVersion===3?['lidStates']:[])])
  if(![1,2,CAMERA_VIEWS_SCHEMA].includes(value.schemaVersion)||value.modelId!=='bottle')throw new TypeError('Unsupported camera catalog')
  if(typeof value.revision!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.revision))throw new TypeError('Invalid camera catalog revision')
  object(value.compatibility,'compatibility',Object.keys(compatibility))
  if(Object.entries(compatibility).some(([key,expected])=>value.compatibility[key]!==expected))throw new TypeError('Incompatible camera coordinate contract')
  const states=statesFor(value.states,value.schemaVersion)
  const lidStates=value.schemaVersion===3?{lidStates:statesFor(value.lidStates,value.schemaVersion)}:{}
  return freeze({schemaVersion:value.schemaVersion,modelId:'bottle',revision:value.revision,compatibility:{...compatibility},states,...lidStates})
}
