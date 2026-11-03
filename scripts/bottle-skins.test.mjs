import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {SkinResourceCache,SkinFetchQueue} from '../src/skinResources.ts'
import {SKIN_REGISTRY,normaliseSkin} from '../shared/skinContract.mjs'
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,Texture} from 'three'
import {bottleAppearanceUpgrade} from '../src/bottleLodAppearance.ts'

const file=p=>new URL('../'+p,import.meta.url)
const sha=b=>createHash('sha256').update(b).digest('hex')
const parse=b=>{const size=b.readUInt32LE(12);return {doc:JSON.parse(b.subarray(20,20+size)),binary:b.subarray(28+size)}}
const tick=()=>new Promise(r=>setTimeout(r,0))
test('geometry-only GLBs retain every source geometry buffer, accessor, node and material binding',async()=>{
  for(const [quality,tier]of [['low','low'],['final','hq']]){
    const original=parse(await readFile(file('public/models/bottle/bottle-'+tier+'-v01.glb')))
    const bytes=await readFile(file('public/'+SKIN_REGISTRY.geometry[quality].file)),core=parse(bytes)
    assert.equal(sha(bytes),SKIN_REGISTRY.geometry[quality].sha256)
    assert.equal(core.doc.images,undefined);assert.equal(core.doc.textures,undefined);assert.equal(core.doc.samplers,undefined)
    assert.deepEqual(core.doc.nodes,original.doc.nodes)
    const images=new Set(original.doc.images.map(i=>i.bufferView))
    const views=original.doc.bufferViews.filter((_,i)=>!images.has(i))
    assert.equal(core.doc.bufferViews.length,views.length)
    for(let i=0;i<views.length;i++){
      const a=views[i],b=core.doc.bufferViews[i]
      assert.deepEqual(core.binary.subarray(b.byteOffset??0,(b.byteOffset??0)+b.byteLength),original.binary.subarray(a.byteOffset??0,(a.byteOffset??0)+a.byteLength))
    }
    assert.equal(core.doc.accessors.length,original.doc.accessors.length)
    for(let i=0;i<core.doc.accessors.length;i++){
      const a={...original.doc.accessors[i]},b={...core.doc.accessors[i]};delete a.bufferView;delete b.bufferView;assert.deepEqual(a,b)
    }
    assert.equal(new Set(core.doc.materials.map(m=>m.extras.materialSlotId)).size,7)
    assert.deepEqual(core.doc.scenes[core.doc.scene??0].extras.skinCompatibility,SKIN_REGISTRY.compatibility)
  }
})
test('all nine skins have valid immutable images, matching slots and shared maps within full delivery budgets',async()=>{
  let first
  for(const descriptor of SKIN_REGISTRY.skins){
    const bytes=await readFile(file('public/'+descriptor.file));assert.equal(bytes.length,descriptor.bytes);assert.equal(sha(bytes),descriptor.sha256)
    const skin=JSON.parse(bytes);assert.deepEqual(skin.compatibility,SKIN_REGISTRY.compatibility)
    assert.equal(skin.materials.length,7)
    if(first)assert.deepEqual(skin.profiles,first.profiles);else first=skin
    for(const profile of Object.values(skin.profiles)){
      for(const image of profile.images){
        const data=await readFile(file('public/'+image.file))
        assert.equal(data.length,image.bytes);assert.equal(sha(data),image.sha256);assert.equal(image.file,'textures/'+image.sha256+'.png')
        assert.equal(data.readUInt32BE(16),image.width);assert.equal(data.readUInt32BE(20),image.height)
      }
    }
    const low=SKIN_REGISTRY.geometry.low.bytes+descriptor.bytes+skin.profiles.low.images.reduce((n,i)=>n+i.bytes,0)
    const final=SKIN_REGISTRY.geometry.final.bytes+descriptor.bytes+skin.profiles.final.images.reduce((n,i)=>n+i.bytes,0)
    assert.ok(low<200000,'Full low delivery exceeds budget');assert.ok(final<1500000,'Full final delivery exceeds budget')
  }
  assert.throws(()=>normaliseSkin({id:'__proto__',revision:'v01'}));assert.throws(()=>normaliseSkin({id:'bottle-red',revision:'v99'}))
})
test('a cancelled consumer does not abort another consumer of the same pending image',async()=>{
  let finish,created=0,resourceSignal
  const cache=new SkinResourceCache(10,2,()=>1,()=>{})
  const create=signal=>{created++;resourceSignal=signal;return new Promise(r=>{finish=r})}
  const a=new AbortController(),b=new AbortController()
  const first=cache.acquire('image',create,a.signal),second=cache.acquire('image',create,b.signal)
  const failed=assert.rejects(first,{name:'AbortError'});await tick();a.abort();await failed
  assert.equal(resourceSignal.aborted,false);assert.equal(created,1)
  finish({pixel:1})
  const lease=await second;assert.deepEqual(lease.value,{pixel:1});assert.equal(cache.stats().leased,1)
  lease.release();lease.release();assert.equal(cache.stats().leased,0)
})
test('cancelling the last consumer disposes a late decode and does not retain a failed resource',async()=>{
  const disposed=[];let finish
  const cache=new SkinResourceCache(1,1,()=>1,v=>disposed.push(v)),controller=new AbortController()
  const pending=cache.acquire('late',()=>new Promise(r=>{finish=r}),controller.signal),failure=assert.rejects(pending,{name:'AbortError'})
  await tick();controller.abort();await failure;finish('bitmap');await tick()
  assert.deepEqual(disposed,['bitmap']);assert.equal(cache.stats().entries,0)
  await assert.rejects(cache.acquire('retry',async()=>{throw Error('offline')},new AbortController().signal))
  const lease=await cache.acquire('retry',async()=>'ok',new AbortController().signal);assert.equal(lease.value,'ok');lease.release()
})
test('LRU eviction disposes only unused resources and preserves active references',async()=>{
  const disposed=[],cache=new SkinResourceCache(10,2,v=>v.bytes,v=>disposed.push(v.id)),signal=new AbortController().signal
  const a=await cache.acquire('a',async()=>({id:'a',bytes:6}),signal)
  const b=await cache.acquire('b',async()=>({id:'b',bytes:6}),signal)
  assert.deepEqual(disposed,[]);a.release();assert.deepEqual(disposed,['a']);assert.equal(b.value.id,'b')
  b.release();assert.equal(cache.stats().leased,0);assert.ok(cache.stats().weight<=10)
})
test('network queue prioritizes interactive work and removes cancelled queued requests',async()=>{
  const queue=new SkinFetchQueue(1),order=[],signal=new AbortController().signal,cancelled=new AbortController()
  let finish
  const first=queue.run(signal,'low',async()=>{order.push('active');await new Promise(r=>{finish=r})})
  const low=queue.run(signal,'low',async()=>{order.push('background')})
  const high=queue.run(signal,'high',async()=>{order.push('interactive')})
  const removed=queue.run(cancelled.signal,'high',async()=>{order.push('cancelled')})
  const failed=assert.rejects(removed,{name:'AbortError'})
  await tick();cancelled.abort();await failed;finish();await Promise.all([first,low,high])
  assert.deepEqual(order,['active','interactive','background'])
})
test('a pending LOD shader retains its texture snapshot when a newer skin changes the low material',()=>{
  const texture=new Texture(),geometry=new BoxGeometry(),a=new MeshStandardMaterial({normalMap:texture}),b=new MeshStandardMaterial({normalMap:new Texture()})
  const low=new Group(),high=new Group();low.add(new Mesh(geometry,a));high.add(new Mesh(geometry,b))
  const upgrade=bottleAppearanceUpgrade({root:low},{root:high}),key=b.customProgramCacheKey()
  a.normalMap=null
  assert.equal(b.customProgramCacheKey(),key)
  const shader={uniforms:{},fragmentShader:'#include <normal_fragment_maps>'}
  b.onBeforeCompile(shader,{})
  assert.equal(shader.uniforms.bottleLow_normalMap.value,texture)
  upgrade.restore();a.dispose();b.normalMap.dispose();b.dispose();texture.dispose();geometry.dispose()
})
