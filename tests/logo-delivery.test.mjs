import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,readdir} from 'node:fs/promises'
import {Readable} from 'node:stream'
import {deflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {createLogoStore,inspectLogoPng} from '../server/logos.mjs'
import {DEFAULT_DECORATION,normaliseDecoration,normaliseLogoRef,patchDecoration} from '../shared/bottleBrandingContract.mjs'
import {validateRenderRequest} from '../shared/renderContract.mjs'
import {PerspectiveCamera} from 'three'

function chunk(type,data){
  const kind=Buffer.from(type),bytes=Buffer.concat([kind,data]);let n=0xffffffff
  for(const byte of bytes){n^=byte;for(let i=0;i<8;i++)n=n&1?(n>>>1)^0xedb88320:n>>>1}
  const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);bytes.copy(out,4);out.writeUInt32BE((n^0xffffffff)>>>0,out.length-4);return out
}
function png(width=2,height=1,pixels=Buffer.from([0,255,0,0,255,0,255,0,0])){
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])
}
const request=bytes=>{const stream=Readable.from([bytes]);stream.headers={'content-type':'image/png','content-length':String(bytes.length)};return stream}
const bytes=png(),ref=inspectLogoPng(bytes)
test('uploaded logo has an immutable hash reference and preserves transparent pixels',()=>{
  assert.deepEqual(ref,{kind:'uploaded',sha256:createHash('sha256').update(bytes).digest('hex'),width:2,height:1})
  assert.deepEqual(normaliseLogoRef(ref),ref)
  assert.throws(()=>normaliseLogoRef({...ref,url:'https://external.invalid'}))
  for(const invalid of [{kind:'sample',url:'x'},{kind:'uploaded',sha256:'x',width:1,height:1},{...ref,width:2049}])assert.throws(()=>normaliseLogoRef(invalid))
})
test('PNG parser rejects disguised SVG, bad CRC, oversized dimensions, excess inflated pixels and trailing data',()=>{
  const broken=Buffer.from(bytes);broken[45]^=1
  for(const invalid of [Buffer.from('<svg/>'),broken,png(2049),png(2,1,Buffer.alloc(1_000_000)),Buffer.concat([bytes,Buffer.from('<script/>')])])assert.throws(()=>inspectLogoPng(invalid))
})
test('decoration contract matches the bottle specification, compatible placement, ink limits and explicit none',async()=>{
  const spec=JSON.parse(await readFile(new URL('../models/bottle/specification.json',import.meta.url),'utf8'))
  for(const zone of spec.zones)for(const technique of zone.techniques)assert.equal(normaliseDecoration({...DEFAULT_DECORATION,surface:zone.surface,technique}).technique,technique)
  const pad=patchDecoration(DEFAULT_DECORATION,{technique:'pad',colors:4})
  assert.equal(patchDecoration(pad,{surface:'lid'}).colors,4)
  assert.equal(patchDecoration(pad,{technique:'screen'}).colors,1)
  assert.equal(patchDecoration({...DEFAULT_DECORATION,technique:'digital'},{surface:'lid'}).technique,'laser')
  assert.equal(patchDecoration(pad,{enabled:false}).enabled,false)
  for(const patch of [{surface:'unknown'},{surface:'lid',technique:'digital'},{colors:0},{colors:2},{logo:{kind:'none'}},{url:'x'}])assert.throws(()=>patchDecoration(DEFAULT_DECORATION,patch))
})
test('content-addressed store deduplicates uploads, survives restart and refuses unknown references/quota without deleting files',async()=>{
  const root=await mkdtemp(new URL('../.cache/qa/logo-store-',import.meta.url).pathname),store=createLogoStore({root,maxFiles:1})
  assert.deepEqual(await store.upload(request(bytes)),ref)
  assert.deepEqual(await store.upload(request(bytes)),ref)
  assert.deepEqual(await createLogoStore({root}).read(ref),bytes)
  await assert.rejects(store.read({...ref,sha256:'a'.repeat(64)}),error=>error.status===404)
  await assert.rejects(store.read({...ref,width:1}),error=>error.status===409)
  const other=png(1,1,Buffer.from([0,4,5,6,255]))
  await assert.rejects(store.upload(request(other)),error=>error.status===507)
  assert.deepEqual(await store.read(ref),bytes)
  assert.equal((await readdir(root+'/.cache/uploads/logos')).length,1)
})
test('render v5 requires decoration; v1–v4 preserve the sample and reject branding injection',()=>{
  const camera=new PerspectiveCamera(28,1.5,.025,100);camera.position.set(3,2,8);camera.lookAt(0,1.2,0)
  const base={version:1,product:'bottle',state:'closed',camera:{position:camera.position.toArray(),target:[0,1.2,0],quaternion:camera.quaternion.toArray(),fov:28,roll:0,aspect:1.5,near:.025,far:100,zoom:1,projectionMatrix:camera.projectionMatrix.toArray()},image:{width:1200,height:800}}
  assert.deepEqual(validateRenderRequest(base).decoration,DEFAULT_DECORATION)
  const normalized=validateRenderRequest(base);normalized.scene={id:'source-studio',revision:'v01',sha256:'a'.repeat(64)}
  const current={...normalized,decoration:{...DEFAULT_DECORATION,logo:ref,technique:'digital'}}
  assert.deepEqual(validateRenderRequest(current).decoration.logo,ref)
  assert.throws(()=>validateRenderRequest({...current,decoration:undefined}))
  for(const version of [1,2,3,4])assert.throws(()=>validateRenderRequest({...current,version}))
})
