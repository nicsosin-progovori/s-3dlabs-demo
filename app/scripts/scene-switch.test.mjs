import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Scene} from 'three'
import {validateSceneProfile} from '../src/player/scenes/sceneContract.ts'
import {placeInScene} from '../src/player/engine/placement.ts'
import {sceneOnLoad,sceneCommandApplies} from '../src/player/engine/scenePolicy.ts'
import {attachScene,checkSceneModule,loadSceneCode} from '../src/player/sockets/sceneSocket.ts'
import {PLAYER_COMMANDS,PLAYER_EVENTS,setScene,onScene,reportScene,readScene,onSceneChanged} from '../src/player/engine/playerContract.ts'

// #4: смена сцены у показанного объекта — без перезагрузки объекта.
// Объект: «бутылка» 7×21×7 см в метрах; сцены: настоящая source-studio@v02 (×12) и тестовая (×6, другой свет).
const raw=JSON.parse(readFileSync(new URL('../../scenes/source-studio/v02/scene.json',import.meta.url)))
const sceneA={key:'source-studio@v02',profile:validateSceneProfile(raw),code:null}
const rawB=structuredClone(raw);rawB.id='test-b';rawB.revision='v01';rawB.coordinates.worldScale=6;rawB.settings.key.position=[3,5,2]
const sceneB={key:'test-b@v01',profile:validateSceneProfile(rawB),code:null}
const needs=['key.position','shadow.radius','shadow.lightMapSize']
const viewport={width:1200,height:800}

function bottle(extra={}){
  const root=new Group(),geometry=new BoxGeometry(.07,.20968,.07)
  geometry.translate(0,.20968/2,0)
  root.add(new Mesh(geometry,new MeshStandardMaterial()))
  return {root,scenes:['source-studio@v02','test-b@v01'],toMetres:1,bounds:{min:[-.035,0,-.035],max:[.035,.20968,.035]},floorDeclared:true,view:null,skin:null,skinKey:null,
    shadow:{key:'soft-pcss@v01',descriptor:{id:'soft-pcss',revision:'v01',needsFromScene:needs},params:{},module:null},note:'',...extra}
}
const close=(a,b,eps=1e-9)=>a.every((v,i)=>Math.abs(v-b[i])<eps)

test('placing in a scene: the scene scales the object, not the other way round',()=>{
  const built=bottle(),p=placeInScene(built,sceneA,viewport)
  assert.equal(p.scene,sceneA);assert.equal(p.worldScale,12);assert.equal(built.root.scale.x,12)
  assert.deepEqual(p.shadowLight,{position:[-3.8,6.3,4.2],radius:2.8,mapSize:1024})
  assert.equal(sceneA.profile.coordinates.worldScale,12,'scene data is not touched')
})

test('switching the scene re-places the same object: scale, frame and shadow light follow the new scene',()=>{
  const built=bottle(),root=built.root
  const a=placeInScene(built,sceneA,viewport)
  const b=placeInScene(built,sceneB,viewport)
  assert.equal(built.root,root,'the object is not rebuilt')
  assert.equal(root.scale.x,6);assert.equal(b.worldScale,6)
  // кадр подобен: объект вдвое меньше — камера вдвое ближе, тот же ракурс и fov
  assert.ok(close(b.camera.position,a.camera.position.map(v=>v/2),1e-6),'camera scales with the scene')
  assert.ok(close(b.camera.target,a.camera.target.map(v=>v/2),1e-6))
  assert.equal(b.camera.fov,a.camera.fov)
  assert.deepEqual(b.shadowLight.position,[3,5,2],'shadow direction comes from the new scene light')
  // назад — ровно тот же кадр
  const a2=placeInScene(built,sceneA,viewport)
  assert.equal(root.scale.x,12)
  assert.ok(close(a2.camera.position,a.camera.position)&&close(a2.camera.target,a.camera.target))
})

test('object correction: render.scale multiplies, the scene stays the same',()=>{
  const p=placeInScene(bottle({toMetres:1.5}),sceneA,viewport)
  assert.equal(p.worldScale,18)
})

test('a scene that does not give the shadow what it needs is an error, and the object stays where it was',()=>{
  const built=bottle();placeInScene(built,sceneA,viewport)
  const before=built.root.scale.x
  const bad={...built,shadow:{...built.shadow,descriptor:{id:'x',revision:'v1',needsFromScene:['key.position','sky.sun']}}}
  assert.throws(()=>placeInScene(bad,sceneB,viewport),/needs from the scene: sky.sun/)
  assert.equal(built.root.scale.x,before)
})

test('an object without a shadow needs no light from the scene',()=>{
  assert.equal(placeInScene(bottle({shadow:null}),sceneB,viewport).shadowLight,null)
})

test('policy: on load the object leads; the host switches only a shown object and only to another scene',()=>{
  assert.equal(sceneOnLoad(['b@v1','a@v1']),'b@v1')
  assert.throws(()=>sceneOnLoad([]),/no scenes/)
  assert.equal(sceneCommandApplies(null,'a@v1'),false,'no object — the object will choose on load')
  assert.equal(sceneCommandApplies('a@v1','a@v1'),false,'same scene — nothing to do')
  assert.equal(sceneCommandApplies('a@v1','b@v1'),true)
})

test('public contract: host command s3d:scene, player report data-scene + s3d:scene-changed',()=>{
  const root={dataset:{}}
  const saved={window:globalThis.window,document:globalThis.document}
  globalThis.window=new EventTarget();globalThis.document={getElementById:id=>id==='root'?root:null}
  try{
    assert.equal(PLAYER_COMMANDS.scene,'s3d:scene');assert.equal(PLAYER_EVENTS.sceneChanged,'s3d:scene-changed')
    const got=[],seen=[]
    const off=onScene(s=>got.push(s)),offSeen=onSceneChanged(s=>seen.push(s))
    setScene('test-b@v01');off();setScene('ignored@v1')
    assert.deepEqual(got,['test-b@v01'])
    reportScene('test-b@v01');assert.equal(readScene(),'test-b@v01')
    reportScene(null);assert.equal(readScene(),'');offSeen();reportScene('x@v1')
    assert.deepEqual(seen,['test-b@v01',null])
  }finally{globalThis.window=saved.window;globalThis.document=saved.document}
})

/* ── код сцены (слот) ─────────────────────────────────────────────────────── */

const codeText='export default {apiVersion:1,create(){return {dispose(){}}}}'
const codeBytes=Buffer.from(codeText),codeSha=createHash('sha256').update(codeBytes).digest('hex')
const withCode=(code)=>{const s=structuredClone(raw);s.code=code;return s}

test('scene may bring code: contract is strict',()=>{
  const ok=validateSceneProfile(withCode({apiVersion:1,entry:{file:'scene.js',sha256:codeSha,bytes:codeBytes.length},params:{ao:.5}}))
  assert.deepEqual(ok.code,{apiVersion:1,entry:{file:'scene.js',sha256:codeSha,bytes:codeBytes.length},params:{ao:.5}})
  assert.ok(Object.isFrozen(ok.code.params))
  assert.equal(validateSceneProfile(raw).code,undefined,'no code — scene is data only')
  const bad=[
    [{apiVersion:2,entry:{file:'scene.js',sha256:codeSha,bytes:1}},/API 2 is not supported/],
    [{apiVersion:1,entry:{file:'../x.js',sha256:codeSha,bytes:1}},/code entry/],
    [{apiVersion:1,entry:{file:'scene.js',sha256:'nope',bytes:1}},/code entry/],
    [{apiVersion:1,entry:{file:'scene.js',sha256:codeSha,bytes:1},params:[]},/code params/],
    [{apiVersion:1,entry:{file:'scene.js',sha256:codeSha,bytes:1},extra:1},/unknown extra/],
  ]
  for(const [code,error] of bad)assert.throws(()=>validateSceneProfile(withCode(code)),error)
})

test('scene code is checked by size and sha256 before it runs',async()=>{
  const profile=validateSceneProfile(withCode({apiVersion:1,entry:{file:'scene.js',sha256:codeSha,bytes:codeBytes.length}}))
  const saved=globalThis.fetch;const urls=[]
  globalThis.fetch=async url=>{urls.push(String(url));return new Response(Buffer.from(codeText+' '))}
  try{await assert.rejects(loadSceneCode(profile,undefined,'http://x/'),/integrity mismatch/)}
  finally{globalThis.fetch=saved}
  assert.deepEqual(urls,['http://x/scenes/source-studio/v02/scene.js'])
  assert.equal(await loadSceneCode(validateSceneProfile(raw),undefined,'http://x/'),null)
  assert.throws(()=>checkSceneModule({apiVersion:1},'s@v1'),/does not implement scene API 1/)
  assert.throws(()=>checkSceneModule(undefined,'s@v1'),/does not implement/)
})

test('slot: code gets the scene, not the object; switching the scene disposes the old code',()=>{
  const three=new Scene(),log=[]
  const module=name=>({apiVersion:1,create(ctx){
    assert.equal(ctx.scene,three);assert.ok(ctx.three.Mesh);assert.ok(!('subject' in ctx),'scene code does not see the object')
    ctx.params.touched=true   // копия: профиль не меняется
    const mesh=new ctx.three.Group();mesh.name=name;ctx.scene.add(mesh);log.push('create '+name+' '+ctx.profile.id)
    return {update(){log.push('update '+name);return false},render(){log.push('render '+name)},dispose(){ctx.scene.remove(mesh);log.push('dispose '+name)}}
  }})
  const profileA=validateSceneProfile(withCode({apiVersion:1,entry:{file:'scene.js',sha256:codeSha,bytes:9},params:{ao:1}}))
  const a=attachScene(module('A'),{renderer:{},scene:three,profile:profileA,size:{width:10,height:10}})
  assert.equal(a.renders,true);assert.equal(profileA.code.params.touched,undefined)
  a.update({});a.render({})
  a.dispose();a.dispose();assert.equal(a.update({}),false);a.render({})
  const b=attachScene(module('B'),{renderer:{},scene:three,profile:sceneB.profile,size:{width:10,height:10}})
  assert.deepEqual(three.children.map(c=>c.name),['B'],'old scene code left nothing behind')
  b.dispose()
  assert.deepEqual(log,['create A source-studio','update A','render A','dispose A','create B test-b','dispose B'])
  assert.equal(three.children.length,0)
})

test('slot: create() must return dispose; optional hooks must be functions',()=>{
  const host={renderer:{},scene:new Scene(),profile:sceneA.profile,size:{width:1,height:1}}
  assert.throws(()=>attachScene({apiVersion:1,create:()=>({})},host),/must return/)
  assert.throws(()=>attachScene({apiVersion:1,create:()=>({dispose(){},render:1})},host),/render must be a function/)
  assert.equal(attachScene({apiVersion:1,create:()=>({dispose(){}})},host).renders,false,'no render — the player draws the frame')
})
