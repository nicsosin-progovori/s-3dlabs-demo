import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {Box3,Vector3} from 'three'
import {validateCameraViews} from '../shared/cameraViewsContract.mjs'
import {readCameraViews} from '../server/cameraViews.mjs'
import {createCameraViewsStore} from '../src/cameraViews.ts'
import {automaticBottleView,cameraRequestFor,cameraViewsFor} from '../src/bottleViewSettings.ts'
import {bottleCamera,bottleViews} from '../src/bottleViews.ts'
import {BOTTLE_BASE_PIVOT,createBottleRig,bottlePoseBounds,sampleBottlePose} from '../src/bottleMotion.ts'
import {bottleFrame} from '../src/bottleCameraMotion.ts'
import {readGlbGeometry} from '../scripts/read-glb-geometry.mjs'

const raw=JSON.parse(await readFile(new URL('../config/camera-views/bottle.json',import.meta.url),'utf8'))
const copy=()=>structuredClone(raw)
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))

test('catalogue accepts independent names, arbitrary view IDs, ordering and empty per-state lists',()=>{
  const value=copy(),state=value.states.closed
  state.views.reverse();state.views[0].id='custom-angle';state.views[0].label={de:'Eigene Kamera',en:'Custom camera'};state.defaultView='custom-angle'
  value.states.open={defaultView:null,views:[]}
  const catalog=validateCameraViews(value)
  assert.equal(catalog.states.closed.views[0].id,'custom-angle')
  assert.equal(catalog.states.open.views.length,0)
  assert.ok(Object.isFrozen(catalog.states.closed.views[0].camera.subject))
  assert.throws(()=>{catalog.states.closed.views[0].camera.fov=99},TypeError)
})
test('invalid or incompatible catalogue is rejected atomically',()=>{
  for(const change of [
    c=>{c.schemaVersion=99},c=>{c.modelId='other'},c=>{c.compatibility.up='Z'},
    c=>{delete c.states.open},c=>{c.states.closed.defaultView='absent'},
    c=>{c.states.closed.views[1].id='overview'},c=>{c.states.closed.views[0].id='__proto__'},
    c=>{c.states.closed.views[0].camera.fov=NaN},c=>{c.states.closed.views[0].camera.fov=120},
    c=>{c.states.closed.views[0].camera.near=3;c.states.closed.views[0].camera.far=2},
    c=>{c.states.closed.views[0].camera.focusMm={min:[1,1,1],max:[0,0,0]}},
    c=>{c.states.closed.views[0].camera.callback='alert(1)'},c=>{c.states.closed.views[0].label.de=''},
  ]){const value=copy();change(value);assert.throws(()=>validateCameraViews(value))}
})
test('runtime config is read anew without a module reload or frontend build',async()=>{
  const dir=new URL('../.cache/qa/bottle-cameras-v01/unit/',import.meta.url)
  await mkdir(dir,{recursive:true})
  const file=new URL('live-catalog.json',dir),value=copy()
  await writeFile(file,JSON.stringify(value));assert.equal((await readCameraViews(file)).revision,raw.revision)
  value.revision='v02';value.states.closed.views[0].label.de='Neuer Name'
  await writeFile(file,JSON.stringify(value))
  assert.equal((await readCameraViews(file)).states.closed.views[0].label.de,'Neuer Name')
  await writeFile(file,'x'.repeat(65537));await assert.rejects(readCameraViews(file),/too large/)
})
test('catalogue loader is independent, exposes readiness and retains valid data after a failed refresh',async()=>{
  let fail=false,calls=0
  const store=createCameraViewsStore('https://local.invalid/cameras',async()=>{calls++;return fail?new Response('',{status:503}):response(raw)})
  const initial=store.ready;await store.reload();await initial
  assert.equal(calls,1);assert.equal(store.getSnapshot().status,'ready')
  const previous=store.getSnapshot().catalog
  fail=true;const refresh=store.reload();assert.equal(store.getSnapshot().status,'refreshing')
  assert.equal(store.ready,refresh);await assert.rejects(refresh)
  assert.equal(store.getSnapshot().status,'error');assert.equal(store.getSnapshot().catalog,previous)
  fail=false;await store.reload();assert.equal(store.getSnapshot().status,'ready');store.dispose()
})
test('initial invalid/oversized responses reject readiness without inventing compiled camera presets',async()=>{
  for(const body of ['broken',JSON.stringify({...raw,schemaVersion:99}),' '.repeat(65537)]){
    const store=createCameraViewsStore('unused',async()=>new Response(body))
    await assert.rejects(store.reload());assert.equal(store.getSnapshot().catalog,null);assert.equal(store.getSnapshot().status,'error');store.dispose()
  }
})
test('a stale refresh cannot replace the latest response, even when fetch ignores cancellation',async()=>{
  const pending=[]
  const store=createCameraViewsStore('unused',()=>new Promise(resolve=>pending.push(resolve)))
  const first=store.reload(),failed=assert.rejects(first,{name:'AbortError'}),second=store.reload()
  const newer=copy();newer.revision='race-new'
  pending[1](response(newer));await second
  pending[0](response(raw));await failed
  assert.equal(store.getSnapshot().catalog.revision,'race-new');store.dispose()
})
test('disposing aborts an in-flight request and publishes no late catalogue',async()=>{
  let signal
  const store=createCameraViewsStore('unused',(_,options)=>new Promise((_,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true})}))
  const failure=assert.rejects(store.reload());store.dispose();await failure;await tick()
  assert.equal(signal.aborted,true);assert.equal(store.getSnapshot().catalog,null);await assert.rejects(store.reload(),/closed/)
})
test('the delivered v01 catalogue preserves all twelve existing fitted cameras across viewport sizes',async()=>{
  const rig=createBottleRig(await readGlbGeometry(new URL('../public/models/bottle/bottle-geometry-low-v01.glb',import.meta.url)))
  const catalog=validateCameraViews(raw)
  for(const state of ['closed','open','lying'])for(const width of [320,390,768,1440]){
    const size={width,height:1000},box=bottlePoseBounds(rig,sampleBottlePose(rig,state,state,1)),offset=new Vector3(state==='lying'?BOTTLE_BASE_PIVOT:0,0,0)
    const actual=cameraViewsFor(catalog,rig,state,size)
    assert.deepEqual(actual.map(view=>view.id),bottleViews(state,'body'))
    for(const entry of actual){
      const legacy=bottleCamera(state,entry.id,'body',0)
      const bounds=legacy.focusMm?new Box3(new Vector3(...legacy.focusMm.min).multiplyScalar(.001).add(offset),new Vector3(...legacy.focusMm.max).multiplyScalar(.001).add(offset)):box
      const expected=bottleFrame(bounds,legacy.azimuth,legacy.elevation,width,1000,legacy)
      assert.deepEqual(entry.camera,{position:expected.position.toArray(),target:expected.target.toArray(),fov:expected.fov??28,roll:expected.roll??0,near:.025,far:100,zoom:1})
    }
  }
  assert.deepEqual(cameraViewsFor(null,rig,'closed',{width:320,height:1000}),[])
  const custom=copy();custom.states.closed.defaultView='front'
  custom.states.closed.views[1].camera.zoom=1.2
  assert.equal(cameraRequestFor(validateCameraViews(custom),'closed',7).id,'front')
  assert.equal(cameraRequestFor(validateCameraViews(custom),'closed',7).projection.zoom,1.2)
  assert.equal(automaticBottleView().id,'automatic')
})

test('external v03 lid catalogue preserves all nine former lid cameras for every pose and viewport',async()=>{
  const rig=createBottleRig(await readGlbGeometry(new URL('../public/models/bottle/bottle-geometry-low-v01.glb',import.meta.url))),catalog=validateCameraViews(raw)
  assert.equal(catalog.schemaVersion,3)
  for(const state of ['closed','open','lying'])for(const width of [320,390,768,1440]){
    const size={width,height:1000},box=bottlePoseBounds(rig,sampleBottlePose(rig,state,state,1)),offset=new Vector3(state==='lying'?BOTTLE_BASE_PIVOT:0,0,0)
    const actual=cameraViewsFor(catalog,rig,state,size,undefined,'lid')
    assert.deepEqual(actual.map(view=>view.id),bottleViews(state,'lid'))
    for(const entry of actual){
      const legacy=bottleCamera(state,entry.id,'lid',0),bounds=legacy.focusMm?new Box3(new Vector3(...legacy.focusMm.min).multiplyScalar(.001).add(offset),new Vector3(...legacy.focusMm.max).multiplyScalar(.001).add(offset)):box
      const expected=bottleFrame(bounds,legacy.azimuth,legacy.elevation,width,1000,legacy)
      assert.deepEqual(entry.camera,{position:expected.position.toArray(),target:expected.target.toArray(),fov:expected.fov??28,roll:expected.roll??0,near:.025,far:100,zoom:1})
    }
  }
  const invalid=copy();invalid.lidStates.open.views[0].camera.url='https://external.invalid';assert.throws(()=>validateCameraViews(invalid))
  delete invalid.lidStates;assert.throws(()=>validateCameraViews(invalid))
})
