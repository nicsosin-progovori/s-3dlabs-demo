import {test} from 'node:test'
import assert from 'node:assert/strict'
import {BasicShadowMap,Group,Mesh,BoxGeometry,MeshStandardMaterial,PerspectiveCamera} from 'three'
import {attachProcessor,materialProcessors,updateMaterialFrames} from '../src/player/materials/materialPipeline.ts'
import {attachEnhancement} from '../src/player/materials/skinEnhancement.ts'

const renderer={shadowMap:{type:BasicShadowMap},domElement:{dataset:{}}}
const compile=material=>{const shader={fragmentShader:'#include <shadowmap_pars_fragment>\n',vertexShader:'',uniforms:{}};material.onBeforeCompile(shader,renderer);return shader}
const mark=(id,stage,order)=>({id,stage,order,programKey:()=>id,patch(shader){shader.fragmentShader+='//'+id+'\n'}})

test('processors run in fixed stage order, not in attach order',()=>{
  const material=new MeshStandardMaterial()
  attachProcessor(material,mark('light','lighting'))
  attachProcessor(material,mark('logo','branding'))
  attachProcessor(material,mark('skin.b','skin',1))
  attachProcessor(material,mark('skin.a','skin',0))
  attachProcessor(material,mark('lod','lod'))
  const text=compile(material).fragmentShader,at=id=>text.indexOf('//'+id+'\n')
  assert.deepEqual(materialProcessors(material).map(p=>p.id),['skin.a','skin.b','lod','logo','light'])
  assert.ok(at('skin.a')<at('skin.b')&&at('skin.b')<at('lod')&&at('lod')<at('logo')&&at('logo')<at('light'))
  assert.equal(material.customProgramCacheKey(),'skin.a+skin.b+lod+logo+light')
})

test('same id replaces, detach removes, unknown stage is rejected',()=>{
  const material=new MeshStandardMaterial()
  attachProcessor(material,mark('light','lighting'));attachProcessor(material,{...mark('light','lighting'),programKey:()=>'light-v2'})
  assert.equal(materialProcessors(material).length,1)
  assert.equal(material.customProgramCacheKey(),'light-v2')
  const handle=attachProcessor(material,mark('x','skin'))
  handle.detach();handle.detach()
  assert.deepEqual(materialProcessors(material).map(p=>p.id),['light'])
  assert.throws(()=>attachProcessor(material,mark('y','scene')),/Unknown material stage/)
})

test('pool survives Material.copy (skin change), clone starts clean',()=>{
  const material=new MeshStandardMaterial()
  attachProcessor(material,mark('light','lighting'))
  material.copy(new MeshStandardMaterial({color:'red'}))
  assert.ok(compile(material).fragmentShader.includes('//light'))
  assert.equal(materialProcessors(material.clone()).length,0)
})

test('skin enhancement attaches only through the pool, at stage skin, and detaches fully',()=>{
  const a=new MeshStandardMaterial(),b=new MeshStandardMaterial()
  attachProcessor(a,mark('light','lighting'))
  let released=false
  const prepared={attach(target){
    target.use('body',mark('tint','lighting')) // стадию задаёт движок, а не модуль
    return {dispose(){released=true}}
  }}
  const attached=attachEnhancement(prepared,new Map([['body',[a,b]]]))
  assert.deepEqual(materialProcessors(a).map(p=>[p.id,p.stage]),[['skin.tint','skin'],['light','lighting']])
  assert.equal(materialProcessors(b)[0].id,'skin.tint')
  attached.dispose()
  assert.ok(released)
  assert.deepEqual(materialProcessors(a).map(p=>p.id),['light'])
  assert.equal(materialProcessors(b).length,0)
})

test('enhancement using an unknown slot fails strictly and leaves nothing attached',()=>{
  const a=new MeshStandardMaterial()
  const prepared={attach(target){target.use('body',mark('ok','skin'));target.use('lid',mark('bad','skin'))}}
  assert.throws(()=>attachEnhancement(prepared,new Map([['body',[a]]])),/unknown slot "lid"/)
  assert.equal(materialProcessors(a).length,0)
})

test('frame hook receives the camera of visible materials only',()=>{
  const camera=new PerspectiveCamera(),seen=[],root=new Group(),geometry=new BoxGeometry()
  const visible=new MeshStandardMaterial(),hidden=new MeshStandardMaterial()
  const meshHidden=new Mesh(geometry,hidden);meshHidden.visible=false
  root.add(new Mesh(geometry,visible),meshHidden)
  for(const m of [visible,hidden])attachProcessor(m,{id:'skin.glint',stage:'skin',programKey:()=>'g',onFrame(frame,material){seen.push([frame.camera,material])}})
  updateMaterialFrames(root,{camera,size:{width:1,height:1}})
  assert.deepEqual(seen,[[camera,visible]])
  geometry.dispose()
})
