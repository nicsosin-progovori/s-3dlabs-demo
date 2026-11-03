import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {Mesh} from 'three'
import {readGlbGeometry,printMesh,uvPoint} from './read-glb-geometry.mjs'
import {createBottleRig,sampleBottlePose,bottlePoseBounds} from '../src/bottleMotion.ts'

const file=path=>new URL(path,import.meta.url)
const lowBytes=await readFile(file('../public/models/bottle/bottle-low-v01.glb'))
const highBytes=await readFile(file('../public/models/bottle/bottle.glb'))
const metadata=JSON.parse(await readFile(file('../models/bottle/low-v01.json'),'utf8'))
const low=await readGlbGeometry(file('../public/models/bottle/bottle-low-v01.glb'))
const high=await readGlbGeometry(file('../public/models/bottle/bottle.glb'))
const lowRig=createBottleRig(low),highRig=createBottleRig(high)

test('low GLB is under 200 kB, preserves source provenance, embeds small maps and needs no decoder',()=>{
  assert.ok(lowBytes.length<200_000)
  assert.ok(lowBytes.length<highBytes.length/30)
  assert.equal(createHash('sha256').update(highBytes).digest('hex'),metadata.highGlbSha256)
  assert.equal(createHash('sha256').update(lowBytes).digest('hex'),metadata.glbSha256)
  const length=lowBytes.readUInt32LE(12),json=JSON.parse(lowBytes.subarray(20,20+length))
  assert.ok(!json.extensionsRequired?.includes('KHR_draco_mesh_compression'))
  assert.equal(json.images.length,7)
  assert.ok(json.images.every(image=>image.bufferView!==undefined&&!image.uri))
  const binary=lowBytes.subarray(28+length)
  for(const image of json.images){
    const view=json.bufferViews[image.bufferView],data=binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength)
    assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    assert.ok(data.readUInt32BE(16)<=128&&data.readUInt32BE(20)<=128)
  }
})
test('the actual low assembly retains lid, print surfaces, valid normals and fewer than 6500 triangles',()=>{
  let triangles=0
  lowRig.root.traverse(object=>{
    if(!(object instanceof Mesh))return
    const g=object.geometry,p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv
    triangles+=(g.index?.count??p.count)/3
    assert.ok(n&&uv)
    for(let i=0;i<p.count;i++){
      assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)))
      const length=Math.hypot(n.getX(i),n.getY(i),n.getZ(i))
      assert.ok(length>.98&&length<1.02,`${object.parent.name}: normal ${length}`)
    }
  })
  assert.ok(triangles<6500)
  assert.ok(lowRig.lid.children.length)
  assert.ok(printMesh(lowRig.root,'body'));assert.ok(printMesh(lowRig.root,'lid'))
})
test('three low state bounds and pose support stay within 0.25 mm of the real HQ assembly',()=>{
  let maxBounds=0,maxSupport=0
  const states=['closed','open','lying']
  for(const from of states)for(const to of states)for(let i=0;i<=40;i++){
    const a=sampleBottlePose(lowRig,from,to,i/40),b=sampleBottlePose(highRig,from,to,i/40)
    maxSupport=Math.max(maxSupport,a.position.distanceTo(b.position))
    const lowBox=bottlePoseBounds(lowRig,a),highBox=bottlePoseBounds(highRig,b)
    for(const key of ['min','max'])for(const axis of ['x','y','z'])maxBounds=Math.max(maxBounds,Math.abs(lowBox[key][axis]-highBox[key][axis]))
  }
  console.log(`LOD bounds max ${maxBounds*1000} mm; pose support max ${maxSupport*1000} mm`)
  assert.ok(maxBounds<.00025,`Bounds drift ${maxBounds*1000} mm`)
  assert.ok(maxSupport<.00025,`Pose support drift ${maxSupport*1000} mm`)
})
test('body and lid artwork stays on the authored UV surface within 0.2 mm',()=>{
  for(const surface of ['body','lid']){
    const a=printMesh(lowRig.root,surface),b=printMesh(highRig.root,surface)
    for(const u of [.42,.46,.5,.54,.58])for(const v of [.2,.35,.5,.65,.8]){
      const lowPoint=uvPoint(a,u,v),highPoint=uvPoint(b,u,v)
      assert.ok(lowPoint.point.distanceTo(highPoint.point)<.0002,`${surface} UV ${u}/${v}`)
      assert.ok(lowPoint.normal.dot(highPoint.normal)>.97)
    }
  }
})
