import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Scene,ShaderChunk} from 'three'
import {shadowDeclaration,sceneShadowLight,resolveShadowParams,attachShadow} from '../src/player/sockets/shadowSocket.ts'
import {materialProcessors} from '../src/player/materials/materialPipeline.ts'

const pkg=new URL('../../shadows/soft-pcss/v01/',import.meta.url)
const descriptor=JSON.parse(readFileSync(new URL('shadow.json',pkg)))

test('object must declare its shadow; null means explicitly none',()=>{
  assert.throws(()=>shadowDeclaration({}),/does not declare render.shadow/)
  assert.equal(shadowDeclaration({shadow:null}),null)
  assert.deepEqual(shadowDeclaration({shadow:{use:'soft-pcss@v01'}}),{use:'soft-pcss@v01'})
  assert.throws(()=>shadowDeclaration({shadow:{use:'soft-pcss'}}),/Invalid render.shadow/)
})

test('scene gives the shadow only direction and sharpness',()=>{
  const light=sceneShadowLight({key:{position:[-3.8,6.3,4.2],intensity:1.7},shadow:{radius:2.8,lightMapSize:1024,opacity:.48}})
  assert.deepEqual(light,{position:[-3.8,6.3,4.2],radius:2.8,mapSize:1024})
  assert.throws(()=>sceneShadowLight({shadow:{radius:1,lightMapSize:1024}}),/key light/)
})

test('params are checked against the shadow contract and completed with defaults',()=>{
  const p=resolveShadowParams(descriptor.params,{opacity:.48,position:[1,.002,0]})
  assert.equal(p.opacity,.48);assert.equal(p.frames,48);assert.deepEqual(p.position,[1,.002,0])
  assert.throws(()=>resolveShadowParams(descriptor.params,{opacity:2}),/out of contract/)
  assert.throws(()=>resolveShadowParams(descriptor.params,{frames:4.5}),/out of contract/)
  assert.throws(()=>resolveShadowParams(descriptor.params,{blur:1}),/not in the shadow contract/)
})

test('package code matches its descriptor (size + sha256)',()=>{
  const code=readFileSync(new URL(descriptor.entry.file,pkg))
  assert.equal(code.length,descriptor.entry.bytes)
  assert.equal(createHash('sha256').update(code).digest('hex'),descriptor.entry.sha256)
})

test('socket: object materials only through the pool (stage lighting), full release on dispose',()=>{
  const material=new MeshStandardMaterial(),subject=new Group(),geometry=new BoxGeometry()
  subject.add(new Mesh(geometry,material))
  const calls=[]
  const module={apiVersion:1,create(ctx){
    assert.deepEqual(ctx.light.position,[1,2,3])
    ctx.receivers.use({id:'pcss',programKey:()=>'k'})
    return {reset(){calls.push('reset')},update(){calls.push('update');return false},dispose(){calls.push('dispose')}}
  }}
  const prepared={key:'test@v01',descriptor:{id:'test'},params:{},module}
  const shadow=attachShadow(prepared,{renderer:{},scene:new Scene(),subject,light:{position:[1,2,3],radius:1,mapSize:512}})
  assert.deepEqual(materialProcessors(material).map(p=>[p.id,p.stage]),[['shadow.test.pcss','lighting']])
  shadow.update({camera:null});shadow.dispose();shadow.dispose()
  assert.deepEqual(calls,['update','dispose'])
  assert.equal(materialProcessors(material).length,0)
  geometry.dispose()
})

test('soft-pcss product filter patches the real three shadow chunk',async()=>{
  const {default:mod}=await import(new URL(descriptor.entry.file,pkg))
  assert.equal(mod.apiVersion,1)
  assert.ok(ShaderChunk.shadowmap_pars_fragment.includes('shadow = step( shadowCoord.z, depth );'))
})
