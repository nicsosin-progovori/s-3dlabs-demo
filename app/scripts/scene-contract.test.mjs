import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseSceneKey,sceneDeclaration,objectToMetres,validateSceneProfile,sceneValue} from '../src/player/scenes/sceneContract.ts'
import {checkShadowNeeds} from '../src/player/sockets/shadowSocket.ts'

// #4: сцена — отдельная сущность (scenes/<id>/<rev>/), объект её выбирает, объект масштабируется в сцену.
const scene=JSON.parse(readFileSync(new URL('../../scenes/source-studio/v02/scene.json',import.meta.url)))
const copy=()=>structuredClone(scene)

test('scene key is "<id>@<rev>"',()=>{
  assert.deepEqual(parseSceneKey('source-studio@v02'),{id:'source-studio',revision:'v02'})
  for(const bad of ['source-studio','scene/source-studio/v02/scene.json','../x@v1','',null])assert.throws(()=>parseSceneKey(bad),/Invalid scene key/)
})

test('object must name its scenes; order is priority',()=>{
  assert.deepEqual(sceneDeclaration({scenes:['a@v1','b@v2']}),['a@v1','b@v2'])
  assert.throws(()=>sceneDeclaration({}),/does not declare render.scenes/)
  assert.throws(()=>sceneDeclaration({scenes:[]}),/does not declare render.scenes/)
  assert.throws(()=>sceneDeclaration({scene:'scene/x.json'}),/does not declare render.scenes/)
  assert.throws(()=>sceneDeclaration({scenes:['a@v1','a@v1']}),/duplicates/)
  assert.throws(()=>sceneDeclaration({scenes:['a']}),/Invalid scene key/)
})

test('object brings its units and scale correction; the scene does not change',()=>{
  assert.equal(objectToMetres({units:'metres'}),1)
  assert.equal(objectToMetres({units:'metres',scale:1.04}),1.04)
  assert.equal(objectToMetres({units:'millimetres'}),.001)
  assert.equal(objectToMetres({units:'centimetres',scale:2}),.02)
  assert.throws(()=>objectToMetres({}),/render.units/)
  assert.throws(()=>objectToMetres({units:'inches'}),/render.units/)
  for(const scale of [0,-1,'2',Infinity])assert.throws(()=>objectToMetres({units:'metres',scale}),/render.scale/)
})

test('a real scene passes and is frozen; worldScale belongs to the scene',()=>{
  const p=validateSceneProfile(scene,{id:'source-studio',revision:'v02'})
  assert.equal(p.coordinates.worldScale,12)
  assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.settings.key.position))
  const other=copy();other.coordinates.worldScale=1
  assert.equal(validateSceneProfile(other).coordinates.worldScale,1)
})

test('scene contract is strict',()=>{
  const cases=[
    [s=>{s.id='other'},/identity mismatch/],
    [s=>{s.engine='other'},/not supported/],
    [s=>{s.extra=1},/unknown extra/],
    [s=>{s.coordinates.up='Z'},/Incompatible scene coordinates/],
    [s=>{s.coordinates.worldScale=0},/worldScale/],
    [s=>{s.settings.exposure=9},/exposure/],
    [s=>{delete s.settings.key},/missing key/],
    [s=>{s.settings.environment.boxes=[]},/softboxes/],
    [s=>{s.settings.background.top='red'},/color/],
  ]
  for(const [mutate,error] of cases){const s=copy();mutate(s);assert.throws(()=>validateSceneProfile(s,{id:'source-studio',revision:'v02'}),error)}
})

test('shadow needs from the scene are checked against the scene',()=>{
  const p=validateSceneProfile(scene)
  assert.deepEqual(sceneValue(p.settings,'key.position'),[-3.8,6.3,4.2])
  assert.equal(sceneValue(p.settings,'key.nothing'),undefined)
  checkShadowNeeds({id:'soft-pcss',revision:'v01',needsFromScene:['key.position','shadow.radius','shadow.lightMapSize']},p.settings)
  assert.throws(()=>checkShadowNeeds({id:'x',revision:'v1',needsFromScene:['key.position','sky.sun']},p.settings),/Shadow x@v1 needs from the scene: sky.sun/)
})
