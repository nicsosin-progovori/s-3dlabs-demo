import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {BufferGeometry,Float32BufferAttribute,Vector3} from 'three'
import {domingGeometry} from '../src/decorationGeometry.ts'

test('resin badge follows each actual bottle lid UV plane and has physical relief',async()=>{
  const file=await readFile(new URL('../public/models/bottle/bottle.glb',import.meta.url))
  const jsonLength=file.readUInt32LE(12)
  const gltf=JSON.parse(file.subarray(20,20+jsonLength).toString())
  const binary=file.subarray(28+jsonLength)
  function values(id,size){
    const accessor=gltf.accessors[id],view=gltf.bufferViews[accessor.bufferView]
    assert.equal(accessor.componentType,5126)
    const output=[]
    for(let i=0;i<accessor.count;i++)for(let j=0;j<size;j++)output.push(binary.readFloatLE((view.byteOffset??0)+(accessor.byteOffset??0)+i*(view.byteStride??size*4)+j*4))
    return new Float32BufferAttribute(output,size)
  }
  const lids=gltf.nodes.filter(n=>n.extras?.print_surface==='lid')
  assert.equal(lids.length,3)
  for(const lid of lids){
    const attributes=gltf.meshes[lid.mesh].primitives[0].attributes
    const base=new BufferGeometry()
    base.setAttribute('position',values(attributes.POSITION,3))
    base.setAttribute('normal',values(attributes.NORMAL,3))
    base.setAttribute('uv',values(attributes.TEXCOORD_0,2))
    const dome=domingGeometry(base),p=dome.getAttribute('position'),n=dome.getAttribute('normal')
    const normal=new Vector3().fromBufferAttribute(base.getAttribute('normal'),0)
    const origin=new Vector3().fromBufferAttribute(base.getAttribute('position'),0)
    let lowest=Infinity,highest=-Infinity
    for(let i=0;i<p.count;i++){
      const lift=new Vector3().fromBufferAttribute(p,i).sub(origin).dot(normal)
      lowest=Math.min(lowest,lift);highest=Math.max(highest,lift)
      assert.ok(Number.isFinite(n.getX(i))&&Number.isFinite(n.getY(i))&&Number.isFinite(n.getZ(i)))
    }
    assert.ok(Math.abs(lowest-.0002)<1e-6)
    assert.ok(Math.abs(highest-.0012)<1e-6)
    assert.ok(new Vector3().fromBufferAttribute(n,Math.floor(n.count/2)).dot(normal)>.99)
    assert.equal(p.count,49*49)
    dome.dispose();base.dispose()
  }
})
