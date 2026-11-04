export const SCENE_SCHEMA=1
export const SCENE_MAX_BYTES=64*1024
export const DEFAULT_SCENE=Object.freeze({id:'source-studio',revision:'v01'})
const coordinates={modelUnits:'metres',worldScale:12,up:'Y',groundY:0,front:'+Z'}
const object=(v,name,keys)=>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw TypeError('Invalid '+name)
  return v
}
const number=(v,name,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw TypeError('Invalid '+name);return v}
const integer=(v,name,min,max)=>{number(v,name,min,max);if(!Number.isInteger(v))throw TypeError('Invalid '+name);return v}
const vector=(v,name,min=-50,max=50)=>{if(!Array.isArray(v)||v.length!==3)throw TypeError('Invalid '+name);return v.map(n=>number(n,name,min,max))}
const color=v=>{if(typeof v!=='string'||!/^#[a-fA-F0-9]{6}$/.test(v))throw TypeError('Invalid scene color');return v.toLowerCase()}
const resolution=(v,max=4096)=>{if(![128,256,512,1024,2048,4096].includes(v)||v>max)throw TypeError('Invalid scene resolution');return v}
function id(v){if(typeof v!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(v)||['constructor','prototype'].includes(v))throw TypeError('Invalid scene id');return v}
function revision(v){if(typeof v!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(v)||['constructor','prototype','__proto__'].includes(v))throw TypeError('Invalid scene revision');return v}
export function normaliseSceneSelection(value){object(value,'scene selection',['id','revision']);return {id:id(value.id),revision:revision(value.revision)}}
export function normaliseSceneRef(value){
  object(value,'scene reference',['id','revision','sha256'])
  if(typeof value.sha256!=='string'||!(/^[a-f0-9]{64}$/).test(value.sha256))throw TypeError('Invalid scene hash')
  return {id:id(value.id),revision:revision(value.revision),sha256:value.sha256}
}
export const sameScene=(a,b)=>a.id===b.id&&a.revision===b.revision&&a.sha256===b.sha256
export function freezeScene(value){if(value&&typeof value==='object'){Object.values(value).forEach(freezeScene);Object.freeze(value)}return value}
function light(value){
  object(value,'light',['position','target','color','intensity'])
  return {position:vector(value.position,'light position'),target:vector(value.target,'light target'),color:color(value.color),intensity:number(value.intensity,'light intensity',0,20)}
}
export function validateSceneProfile(value){
  object(value,'scene profile',['schemaVersion','id','revision','engine','coordinates','settings'])
  if(value.schemaVersion!==SCENE_SCHEMA||value.engine!=='source-studio-v01')throw TypeError('Unsupported scene engine')
  const selection=normaliseSceneSelection({id:value.id,revision:value.revision})
  object(value.coordinates,'scene coordinates',Object.keys(coordinates))
  if(Object.entries(coordinates).some(([k,v])=>value.coordinates[k]!==v))throw TypeError('Incompatible scene coordinates')
  const s=object(value.settings,'scene settings',['exposure','toneMapping','shadowType','background','ambient','hemisphere','key','fill','environment','shadow','shadowMap','ao','revealMs'])
  if(s.toneMapping!=='aces-filmic'||s.shadowType!=='basic')throw TypeError('Unsupported studio color/shadow pipeline')
  const background=object(s.background,'background',['top','bottom']),hemi=object(s.hemisphere,'hemisphere',['intensity','sky','ground'])
  const env=object(s.environment,'environment',['resolution','intensity','surround','boxes'])
  if(!Array.isArray(env.boxes)||env.boxes.length<1||env.boxes.length>12)throw TypeError('Invalid studio softboxes')
  const sh=object(s.shadow,'shadow',['radius','contact','opacity','density','frames','resolution','position','color','scale','compositionScale','areaSamples','contactSamples','lightMapSize'])
  const map=object(s.shadowMap,'shadow maps',['productResolution','groundResolution','bias','normalBias'])
  const ao=object(s.ao,'ambient occlusion',['resolutionScale','intensity','radius','thickness','samples'])
  const settings={
    exposure:number(s.exposure,'exposure',.1,4),toneMapping:'aces-filmic',shadowType:'basic',
    background:{top:color(background.top),bottom:color(background.bottom)},ambient:number(s.ambient,'ambient light',0,5),
    hemisphere:{intensity:number(hemi.intensity,'hemisphere intensity',0,5),sky:color(hemi.sky),ground:color(hemi.ground)},
    key:light(s.key),fill:light(s.fill),
    environment:{resolution:resolution(env.resolution,1024),intensity:number(env.intensity,'environment intensity',0,5),surround:color(env.surround),boxes:env.boxes.map(box=>{
      object(box,'softbox',['position','scale','intensity','color'])
      if(!Array.isArray(box.scale)||box.scale.length!==2)throw TypeError('Invalid softbox scale')
      return {position:vector(box.position,'softbox position'),scale:box.scale.map(n=>number(n,'softbox scale',.01,30)),intensity:number(box.intensity,'softbox intensity',0,20),color:color(box.color)}
    })},
    shadow:{radius:number(sh.radius,'shadow radius',0,10),contact:number(sh.contact,'shadow contact',0,1),opacity:number(sh.opacity,'shadow opacity',0,1),density:number(sh.density,'shadow density',0,4),frames:integer(sh.frames,'shadow frames',1,128),resolution:resolution(sh.resolution,2048),position:vector(sh.position,'shadow receiver',-30,30),color:color(sh.color),scale:number(sh.scale,'shadow scale',4,40),compositionScale:number(sh.compositionScale,'composition shadow scale',4,40),areaSamples:integer(sh.areaSamples,'area light samples',1,8),contactSamples:integer(sh.contactSamples,'contact light samples',1,4),lightMapSize:resolution(sh.lightMapSize,1024)},
    shadowMap:{productResolution:resolution(map.productResolution),groundResolution:resolution(map.groundResolution),bias:number(map.bias,'shadow bias',-.01,.01),normalBias:number(map.normalBias,'shadow normal bias',0,.1)},
    ao:{resolutionScale:number(ao.resolutionScale,'AO resolution',.5,1),intensity:number(ao.intensity,'AO intensity',0,2),radius:number(ao.radius,'AO radius',.001,2),thickness:number(ao.thickness,'AO thickness',.001,1),samples:integer(ao.samples,'AO samples',1,32)},
    revealMs:integer(s.revealMs,'scene reveal duration',0,1000),
  }
  // The accepted engine uses a Y-up horizontal receiver just above the floor.
  if(Math.abs(settings.shadow.position[1]-.002)>.000001)throw TypeError('Incompatible shadow receiver height')
  return freezeScene({schemaVersion:SCENE_SCHEMA,...selection,engine:'source-studio-v01',coordinates:{...coordinates},settings})
}
