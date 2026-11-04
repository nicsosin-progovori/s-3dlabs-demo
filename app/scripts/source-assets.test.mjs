import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Box3, Matrix4, Quaternion, Vector3 } from 'three'

async function asset(id) {
  const file=await readFile(new URL(`../public/models/${id}/${id}.glb`,import.meta.url))
  assert.equal(file.readUInt32LE(0),0x46546c67)
  assert.equal(file.readUInt32LE(4),2)
  assert.equal(file.readUInt32LE(8),file.length)
  const json=JSON.parse(file.subarray(20,20+file.readUInt32LE(12)).toString())
  const meta=JSON.parse(await readFile(new URL(`../models/${id}/geometry.json`,import.meta.url),'utf8'))
  assert.equal(createHash('sha256').update(file).digest('hex'),meta.glbSha256)
  for(const image of json.images??[]) assert.ok(image.bufferView!==undefined,'Every texture is embedded')
  for(const buffer of json.buffers) assert.equal(buffer.uri,undefined)
  function bounds(index,parent=new Matrix4(),result=new Box3()) {
    const n=json.nodes[index]
    const local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3(...n.translation??[0,0,0]),new Quaternion(...n.rotation??[0,0,0,1]),new Vector3(...n.scale??[1,1,1]))
    const matrix=parent.clone().multiply(local)
    if(n.mesh!==undefined&&!n.extras?.print_surface) for(const p of json.meshes[n.mesh].primitives) {
      const a=json.accessors[p.attributes.POSITION]
      assert.ok(a.min.every(Number.isFinite)&&a.max.every(Number.isFinite))
      result.union(new Box3(new Vector3(...a.min),new Vector3(...a.max)).applyMatrix4(matrix))
    }
    for(const child of n.children??[])bounds(child,matrix,result)
    return result
  }
  const states=Object.fromEntries(json.nodes.flatMap((n,i)=>n.extras?.product_state?[[n.extras.product_state,bounds(i).getSize(new Vector3()).multiplyScalar(1000).toArray()]]:[]))
  const near=(actual,expected,tolerance=.6)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} ≠ ${expected}`)
  return {states,json,near,file}
}

test('metre-scale bottle: three real geometries and removable lid bounds',async()=>{
  const {states,json,near}=await asset('bottle')
  assert.deepEqual(Object.keys(states).sort(),['closed','lying','open'])
  near(states.closed[0],70);near(states.closed[1],210);near(states.closed[2],70)
  near(states.lying[0],210);near(states.lying[1],70)
  assert.ok(states.open[0]>130,'Detached lid must be included in footprint')
  assert.equal(json.nodes.filter(n=>n.extras?.print_surface==='lid').length,3)
})
test('bottle PBR survives export with dielectric coating, brushed metal, normal maps and valid normals',async()=>{
  const {json,file}=await asset('bottle')
  const coat=json.materials.find(m=>m.name==='BottleCoating'),steel=json.materials.find(m=>m.name.startsWith('BrushedStainlessSteel')),wood=json.materials.find(m=>m.name==='NaturalBamboo')
  assert.equal(coat.pbrMetallicRoughness.metallicFactor,0,'A powder coating is dielectric')
  for(const material of [coat,steel,wood]){
    assert.ok(material.normalTexture&&material.pbrMetallicRoughness.metallicRoughnessTexture,'Macro detail must survive GLB export')
  }
  assert.ok(steel.extensions.KHR_materials_anisotropy.anisotropyStrength>0,'Brushed steel must retain its directional reflection')
  const binaryOffset=28+file.readUInt32LE(12)
  for(const mesh of json.meshes)for(const primitive of mesh.primitives){
    const a=json.accessors[primitive.attributes.NORMAL],view=json.bufferViews[a.bufferView],offset=binaryOffset+(view.byteOffset??0)+(a.byteOffset??0)
    for(let i=0;i<a.count;i++){
      const at=offset+i*(view.byteStride??12),length=Math.hypot(file.readFloatLE(at),file.readFloatLE(at+4),file.readFloatLE(at+8))
      assert.ok(Number.isFinite(length)&&length>.98&&length<1.02,'Finite unit normals prevent corrupt shading and anisotropy')
    }
  }
})
test('Endo: a fabric tracker, 240 mm open strap, gift box and expanded open lid',async()=>{
  const {states,json,near}=await asset('endo')
  assert.deepEqual(Object.keys(states).sort(),['box-closed','box-open','flat','wrist'])
  near(states.flat[0],240)
  near(states['box-closed'][0],143);near(states['box-closed'][2],84)
  assert.ok(states['box-open'][1]>90&&states['box-open'][2]>100)
  assert.ok(states.wrist[1]>70&&states.wrist[1]<85)
  assert.ok(json.materials.some(m=>m.name.startsWith('EndoStrap')&&m.normalTexture))
  assert.ok(!json.nodes.some(n=>/display|screen/i.test(n.name??'')))
})
test('pillow: full 220 mm two-tone cover, straps and curved decoration surface',async()=>{
  const {states,json,near}=await asset('pillow')
  assert.deepEqual(Object.keys(states),['ready'])
  assert.ok(states.ready[0]>=240&&states.ready[2]>=250,'Include loose straps, not only nominal body size')
  near(states.ready[1],109)
  assert.ok(json.materials.filter(m=>/Pillow.*Polyester/.test(m.name)).every(m=>m.normalTexture))
  const body=json.meshes.find(m=>m.name==='TwoToneMemoryFoamCover')
  assert.equal(body.primitives.length,2)
  const position=json.accessors[body.primitives[0].attributes.POSITION]
  near((position.max[0]-position.min[0])*1000,220)
  // The two primitives can share a single accessor covering the complete cover.
  assert.ok(json.nodes.some(n=>n.extras?.print_surface==='side'))
})
