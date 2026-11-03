import test from 'node:test'
import assert from 'node:assert/strict'
import {Mesh} from 'three'
import {loadModel} from '../src/model.ts'
import {loadSourceModel} from '../src/sourceModel.ts'

function glb(empty=false){
  const data={asset:{version:'2.0'},scene:0,scenes:[{nodes:empty?[]:[0,1]}],nodes:empty?[]:[{mesh:0},{mesh:0,translation:[2,0,0]}]}
  const binary=Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer)
  if(!empty)Object.assign(data,{buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:binary.length}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}]})
  let json=Buffer.from(JSON.stringify(data));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)])
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+(empty?0:8+binary.length),8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16)
  if(empty)return Buffer.concat([header,json])
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length);binHeader.writeUInt32LE(0x004e4942,4)
  return Buffer.concat([header,json,binHeader,binary])
}
const product={id:'bottle',assetUrl:'http://model.invalid/fixture.glb',dimensionMm:1000,displaySize:1}
for(const [name,load] of [['legacy',loadModel],['source',loadSourceModel]]){
  test(name+' loader rejects a valid but empty GLB before exposing a ready model',async t=>{
    t.mock.method(globalThis,'fetch',async()=>new Response(glb(true)))
    await assert.rejects(load(product),error=>error.code==='modelEmpty')
  })
  test(name+' loader honours cancellation without reporting it as a broken model',async t=>{
    const controller=new AbortController()
    t.mock.method(globalThis,'fetch',async()=>{queueMicrotask(()=>controller.abort());return new Response(glb())})
    await assert.rejects(load(product,{signal:controller.signal}),error=>error.name==='AbortError')
  })
  test(name+' loader disposes shared geometry only once, including repeated cleanup',async t=>{
    t.mock.method(globalThis,'fetch',async()=>new Response(glb()))
    const model=await load(product),geometries=new Set();model.root.traverse(object=>{if(object instanceof Mesh)geometries.add(object.geometry)})
    let disposed=0;geometries.forEach(geometry=>geometry.addEventListener('dispose',()=>disposed++))
    model.dispose();model.dispose();assert.equal(disposed,geometries.size)
  })
}
