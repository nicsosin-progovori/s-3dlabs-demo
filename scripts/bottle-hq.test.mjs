import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {Mesh} from 'three'
import {readGlbGeometry,printMesh,uvPoint} from './read-glb-geometry.mjs'
import {createBottleRig,sampleBottlePose,bottlePoseBounds} from '../src/bottleMotion.ts'

const file=path=>new URL(path,import.meta.url)
const bytes=await readFile(file('../public/models/bottle/bottle-hq-v01.glb'))
const referenceBytes=await readFile(file('../public/models/bottle/bottle.glb'))
const metadata=JSON.parse(await readFile(file('../models/bottle/hq-v01.json'),'utf8'))
const rig=createBottleRig(await readGlbGeometry(file('../public/models/bottle/bottle-hq-v01.glb')))
const reference=createBottleRig(await readGlbGeometry(file('../public/models/bottle/bottle.glb')))

test('optimized HQ stays below 1.5 MB with standard embedded PNGs and protected reference provenance',()=>{
  assert.ok(bytes.length<1_500_000)
  assert.ok(referenceBytes.length/bytes.length>4)
  assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.glbSha256)
  assert.equal(createHash('sha256').update(referenceBytes).digest('hex'),metadata.referenceGlbSha256)
  const length=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+length)),binary=bytes.subarray(28+length)
  const referenceDoc=JSON.parse(referenceBytes.subarray(20,20+referenceBytes.readUInt32LE(12)))
  assert.deepEqual(doc.extensionsRequired??[],referenceDoc.extensionsRequired??[])
  assert.ok(!(doc.extensionsUsed??[]).some(name=>/draco|meshopt|webp|basisu/i.test(name)))
  assert.equal(doc.images.length,7)
  for(const image of doc.images){
    assert.equal(image.mimeType,'image/png');assert.equal(image.uri,undefined)
    const view=doc.bufferViews[image.bufferView],png=binary.subarray(view.byteOffset,view.byteOffset+view.byteLength)
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    assert.ok(png.readUInt32BE(16)<=512&&png.readUInt32BE(20)<=512)
    if(image.name.startsWith('PowderCoat')){assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512)}
  }
})
test('optimized geometry retains valid normals, artwork surfaces and complete lid within 24000 triangles',()=>{
  let triangles=0
  rig.root.traverse(object=>{
    if(!(object instanceof Mesh))return
    const g=object.geometry,p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv
    triangles+=(g.index?.count??p.count)/3
    assert.ok(n&&uv)
    for(let i=0;i<p.count;i++){
      assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)))
      const length=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));assert.ok(length>.98&&length<1.02)
    }
  })
  assert.ok(triangles<24000);assert.equal(triangles,metadata.triangles)
  assert.ok(rig.lid.children.length);assert.ok(printMesh(rig.root,'body'));assert.ok(printMesh(rig.root,'lid'))
})
test('optimized poses retain state bounds and floor support within 0.06 mm of the reference',()=>{
  let bounds=0,support=0
  for(const from of ['closed','open','lying'])for(const to of ['closed','open','lying'])for(let i=0;i<=40;i++){
    const a=sampleBottlePose(rig,from,to,i/40),b=sampleBottlePose(reference,from,to,i/40)
    support=Math.max(support,a.position.distanceTo(b.position))
    const box=bottlePoseBounds(rig,a),original=bottlePoseBounds(reference,b)
    for(const key of ['min','max'])for(const axis of ['x','y','z'])bounds=Math.max(bounds,Math.abs(box[key][axis]-original[key][axis]))
  }
  console.log(`Optimized HQ bounds max ${bounds*1000} mm; support max ${support*1000} mm`)
  assert.ok(bounds<.00006);assert.ok(support<.00006)
})
test('optimized UV print placement retains the reference within 0.05 mm',()=>{
  for(const surface of ['body','lid'])for(const u of [.42,.46,.5,.54,.58])for(const v of [.2,.35,.5,.65,.8]){
    const a=uvPoint(printMesh(rig.root,surface),u,v),b=uvPoint(printMesh(reference.root,surface),u,v)
    assert.ok(a.point.distanceTo(b.point)<.00005,`${surface} UV ${u}/${v}`);assert.ok(a.normal.dot(b.normal)>.99)
  }
})
