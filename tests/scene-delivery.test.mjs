import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {fileURLToPath} from 'node:url'
import {BasicShadowMap,OrthographicCamera,Vector3} from 'three'
import {DEFAULT_SCENE,normaliseSceneRef,normaliseSceneSelection,validateSceneProfile} from '../shared/sceneContract.mjs'
import {readScene,readDefaultScene,serveScene} from '../server/scenes.mjs'
import {loadScene} from '../src/sceneLoader.ts'
import {lookFromScene} from '../src/studioScene.ts'
import {STUDIO_LOOK,STUDIO_STYLE,studioStyleFor,studioBackdropHex} from '../src/studioLook.ts'
import {studioBackdrop} from '../src/studioBackdrop.ts'
import {BOTTLE_SCALE,createBottleRig,bottlePoseBounds,sampleBottlePose} from '../src/bottleMotion.ts'
import {readGlbGeometry} from '../scripts/read-glb-geometry.mjs'

const root=fileURLToPath(new URL('../config/scenes',import.meta.url))
const bytes=await readFile(new URL('../config/scenes/source-studio/v01/scene.json',import.meta.url)),raw=JSON.parse(bytes)
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const bundle=await readScene(root,DEFAULT_SCENE)
const response=(body=bytes,hash=sha(body))=>new Response(body,{headers:{'X-Scene-SHA256':hash,'Content-Type':'application/json'}})

test('external v01 preserves the accepted studio, background shader and CSS exactly',()=>{
  const look=lookFromScene(bundle)
  for(const key of Object.keys(STUDIO_LOOK)){
    if(key==='id')continue
    if(['key','fill','shadow'].includes(key))for(const property of Object.keys(STUDIO_LOOK[key]))assert.deepEqual(look[key][property],STUDIO_LOOK[key][property])
    else assert.deepEqual(look[key],STUDIO_LOOK[key])
  }
  assert.deepEqual(studioStyleFor(look),STUDIO_STYLE)
  const shader=look=>{
    const {material}=studioBackdrop(look),s={fragmentShader:'#include <shadowmap_pars_fragment>\n#include <opaque_fragment>',vertexShader:'#include <project_vertex>',uniforms:{}}
    material.onBeforeCompile(s,{shadowMap:{type:BasicShadowMap},domElement:{dataset:{}}});material.dispose();return s
  }
  assert.deepEqual(shader(look),shader(STUDIO_LOOK))
  assert.ok(Object.isFrozen(bundle.profile.settings.key.position))
})
test('profile rejects unsupported engines, coordinate mismatch, executable fields and resource overruns',()=>{
  for(const change of [c=>c.engine='other',c=>c.coordinates.worldScale=1,c=>c.coordinates.up='Z',c=>c.settings.exposure=NaN,c=>c.settings.exposure=Infinity,c=>c.settings.toneMapping='none',c=>c.settings.environment.url='https://untrusted.invalid',c=>c.settings.shadow.frames=100000,c=>c.settings.shadowMap.productResolution=8192,c=>c.settings.key.position=[0],c=>c.settings.key.callback='eval()',c=>c.settings.shadow.position[1]=1]){
    const value=structuredClone(raw);change(value);assert.throws(()=>validateSceneProfile(value))
  }
  for(const value of [{id:'../scene',revision:'v01'},{id:'source-studio',revision:'../v01'},{id:'constructor',revision:'v01'},{id:'source-studio',revision:'v01',url:'x'}])assert.throws(()=>normaliseSceneSelection(value))
  assert.throws(()=>normaliseSceneRef({...DEFAULT_SCENE,sha256:'no'}))
})
test('scene revisions are delivered from files without build/restart; fingerprints prevent changed revisions',async()=>{
  const dir=fileURLToPath(new URL('../.cache/qa/bottle-scenes-v01/unit/scenes',import.meta.url)),folder=dir+'/source-studio/v02'
  await mkdir(folder,{recursive:true})
  const value=structuredClone(raw);value.revision='v02';value.settings.key.intensity=.75
  await writeFile(folder+'/scene.json',JSON.stringify(value))
  const first=await readScene(dir,{id:value.id,revision:'v02'})
  assert.equal(first.profile.settings.key.intensity,.75)
  value.settings.key.intensity=.95;await writeFile(folder+'/scene.json',JSON.stringify(value))
  assert.equal((await readScene(dir,{id:value.id,revision:'v02'})).profile.settings.key.intensity,.95)
  await assert.rejects(readScene(dir,first.ref),error=>error.status===409)
  await assert.rejects(readScene(dir,{id:value.id,revision:'missing'}),error=>error.status===404)
  await writeFile(folder+'/scene.json','x'.repeat(65537));await assert.rejects(readScene(dir,{id:value.id,revision:'v02'}),error=>error.status===503)
})
test('metadata HTTP serves raw verified bytes, HEAD/ETag/304 and method restrictions independently',async()=>{
  const server=createServer((req,res)=>void serveScene(req,res,root,DEFAULT_SCENE))
  server.listen(0,'127.0.0.1');await once(server,'listening')
  try{
    const url='http://127.0.0.1:'+server.address().port
    const get=await fetch(url),etag=get.headers.get('etag')
    assert.equal(get.status,200);assert.equal(get.headers.get('X-Scene-SHA256'),sha(bytes));assert.equal(await get.text(),bytes.toString())
    const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0)
    assert.equal((await fetch(url,{headers:{'If-None-Match':etag}})).status,304)
    assert.equal((await fetch(url,{method:'POST'})).status,405)
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})
test('runtime default pointer selects a new immutable revision without changing the JS entry point',async()=>{
  const dir=fileURLToPath(new URL('../.cache/qa/bottle-scenes-v01/unit/default',import.meta.url))
  await mkdir(dir+'/source-studio/v02',{recursive:true});await mkdir(dir+'/source-studio/v01',{recursive:true})
  await writeFile(dir+'/source-studio/v01/scene.json',bytes)
  const next=structuredClone(raw);next.revision='v02';next.settings.key.intensity=.65
  await writeFile(dir+'/source-studio/v02/scene.json',JSON.stringify(next))
  await writeFile(dir+'/default.json',JSON.stringify(DEFAULT_SCENE))
  assert.equal((await readDefaultScene(dir)).ref.revision,'v01')
  await writeFile(dir+'/default.json',JSON.stringify({...DEFAULT_SCENE,revision:'v02'}))
  const current=await readDefaultScene(dir);assert.equal(current.ref.revision,'v02')
  const loaded=await loadScene(null,new AbortController().signal,async url=>{assert.equal(url.pathname,'/api/scenes/default');return response(current.bytes,current.ref.sha256)},'http://localhost/bottle.html')
  assert.equal(loaded.ref.revision,'v02');assert.equal(loaded.profile.settings.key.intensity,.65)
  await writeFile(dir+'/default.json','{broken');await assert.rejects(readDefaultScene(dir),error=>error.status===503)
})
test('loader verifies actual bytes, server fingerprint, profile identity and immutable data before returning',async()=>{
  const loaded=await loadScene(DEFAULT_SCENE,new AbortController().signal,async()=>response(),'http://localhost/bottle.html')
  assert.deepEqual(loaded.ref,bundle.ref);assert.deepEqual(loaded.profile,bundle.profile)
  assert.throws(()=>{loaded.profile.settings.exposure=2},TypeError)
  for(const fetcher of [async()=>response(bytes,'0'.repeat(64)),async()=>response(Buffer.from('{broken')),async()=>response(Buffer.alloc(65537)),async()=>new Response('',{status:503}),async()=>response(Buffer.from(JSON.stringify({...raw,revision:'other'})))]){
    await assert.rejects(loadScene(DEFAULT_SCENE,new AbortController().signal,fetcher,'http://localhost/bottle.html'))
  }
  await assert.rejects(loadScene({...DEFAULT_SCENE,sha256:'0'.repeat(64)},new AbortController().signal,async()=>response(),'http://localhost/'))
})
test('loader cannot publish a late response after its consumer was cancelled',async()=>{
  const controller=new AbortController();let finish
  const pending=loadScene(DEFAULT_SCENE,controller.signal,()=>new Promise(resolve=>finish=resolve),'http://localhost/')
  const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();finish(response());await rejected
})
test('custom delivered background and exposure preserve CSS/render agreement',()=>{
  const profile=structuredClone(bundle.profile)
  profile.revision='custom';profile.settings.exposure=1.7;profile.settings.background={top:'#aaaabb',bottom:'#ccddee'}
  const look=lookFromScene({profile,ref:{id:profile.id,revision:profile.revision,sha256:'b'.repeat(64)}})
  assert.equal(studioBackdropHex(1,look),'#aaaabb');assert.equal(studioBackdropHex(0,look),'#ccddee')
  assert.equal(studioStyleFor(look)['--studio-background-top'],'#aaaabb')
})
test('accepted scene coordinate scale and shadow camera contain the actual bottle in every pose',async()=>{
  assert.equal(bundle.profile.coordinates.worldScale,BOTTLE_SCALE)
  const rig=createBottleRig(await readGlbGeometry(new URL('../public/models/bottle/bottle-geometry-low-v01.glb',import.meta.url)))
  const camera=new OrthographicCamera(-4.5,4.5,4.5,-4.5,.1,25)
  camera.position.fromArray(bundle.profile.settings.key.position);camera.lookAt(new Vector3(...bundle.profile.settings.key.target));camera.updateMatrixWorld()
  for(const from of ['closed','open','lying'])for(const to of ['closed','open','lying'])for(const t of [0,.25,.5,.75,1]){
    const bounds=bottlePoseBounds(rig,sampleBottlePose(rig,from,to,t))
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
      const p=new Vector3(x,y,z).multiplyScalar(BOTTLE_SCALE).project(camera)
      assert.ok(Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&Math.abs(p.z)<=1,'Shadow frustum clips pose '+from+' → '+to)
    }
  }
})
