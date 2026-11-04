import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import {Color} from 'three'

const root=fileURLToPath(new URL('../',import.meta.url))
const sha=b=>createHash('sha256').update(b).digest('hex')
const json=async p=>JSON.parse(await readFile(path.join(root,p),'utf8'))
const save=async(p,b)=>{const target=path.join(root,p);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,b)}
const compact=j=>JSON.stringify(j)+'\n'
const compatibility={modelId:'bottle',uvLayout:'bottle-uv-v01',materialBindings:'bottle-materials-v01'}
const slotNames={'SoftBlackABS':'body.plastic','TransparentDecoration':'decoration','BrushedStainlessSteel':'steel.brushed','PolishedHandleSteel':'steel.handle','NaturalBamboo':'lid.bamboo','Silicone':'lid.seal','BottleCoating':'body.coating'}
const originals=[],geometry={},profiles={}
let definitions
for(const [quality,tier] of [['low','low'],['final','hq']]){
  const input='public/models/bottle/bottle-'+tier+'-v01.glb',bytes=await readFile(path.join(root,input))
  const metadata=await json('models/bottle/'+tier+'-v01.json')
  assert.equal(sha(bytes),metadata.glbSha256,'Protected input changed')
  const size=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+size)),binary=bytes.subarray(28+size)
  assert.ok((doc.extensionsUsed??[]).every(e=>['KHR_materials_clearcoat','KHR_materials_anisotropy','KHR_texture_transform'].includes(e)))
  const imageViews=new Set(),images=[]
  for(const im of doc.images){
    assert.ok(im.bufferView!==undefined&&!im.uri)
    const view=doc.bufferViews[im.bufferView],data=binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength),hash=sha(data)
    imageViews.add(im.bufferView)
    const file='textures/'+hash+'.png'
    await save('public/'+file,data)
    images.push({name:im.name,file,sha256:hash,bytes:data.length,width:data.readUInt32BE(16),height:data.readUInt32BE(20),mimeType:im.mimeType})
  }
  const materials=doc.materials.map(m=>({...m,extras:{...m.extras,materialSlotId:slotNames[m.name.replace(/\.\d+$/,'')]}}))
  assert.ok(materials.every(m=>m.extras.materialSlotId))
  if(definitions)assert.deepEqual(materials,definitions)
  else definitions=materials
  profiles[quality]={images,textures:doc.textures,samplers:doc.samplers??[]}
  doc.materials=materials.map(m=>({name:m.name,extras:{materialSlotId:m.extras.materialSlotId},doubleSided:!!m.doubleSided,pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:1}}))
  doc.scenes[doc.scene??0].extras={...doc.scenes[doc.scene??0].extras,skinCompatibility:compatibility}
  delete doc.images;delete doc.textures;delete doc.samplers;delete doc.extensionsUsed;delete doc.extensionsRequired
  const remap=new Map(),views=[],chunks=[]
  let offset=0
  for(const [i,view] of doc.bufferViews.entries()){
    if(imageViews.has(i))continue
    const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding}
    const data=binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength)
    remap.set(i,views.length);views.push({...view,byteOffset:offset});chunks.push(data);offset+=data.length
  }
  const viewId=i=>{assert.ok(remap.has(i),'Unexpected reference to an image bufferView');return remap.get(i)}
  for(const a of doc.accessors){
    if(a.bufferView!==undefined)a.bufferView=viewId(a.bufferView)
    if(a.sparse){a.sparse.indices.bufferView=viewId(a.sparse.indices.bufferView);a.sparse.values.bufferView=viewId(a.sparse.values.bufferView)}
  }
  doc.bufferViews=views;doc.buffers=[{byteLength:offset}]
  const raw=Buffer.concat(chunks),body=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4)])
  const text=Buffer.from(JSON.stringify(doc)),padded=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)])
  const header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8)
  header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+body.length,8)
  jh.writeUInt32LE(padded.length);jh.write('JSON',4);bh.writeUInt32LE(body.length);bh.write('BIN\0',4)
  const output=Buffer.concat([header,jh,padded,bh,body]),file='models/bottle/bottle-geometry-'+quality+'-v01.glb'
  await save('public/'+file,output)
  geometry[quality]={file,sha256:sha(output),bytes:output.length,triangles:metadata.triangles}
  originals.push({file:input,sha256:sha(bytes),bytes:bytes.length})
}
const spec=await json('models/bottle/specification.json'),skins=[]
for(const color of spec.colors){
  const materials=structuredClone(definitions),coat=materials.find(m=>m.extras.materialSlotId==='body.coating')
  coat.pbrMetallicRoughness.baseColorFactor=[...new Color(color.hex).toArray(),1]
  coat.pbrMetallicRoughness.metallicFactor=color.metalness??0
  coat.pbrMetallicRoughness.roughnessFactor=(color.roughness??.49)/.49
  const skin={schemaVersion:1,id:'bottle-'+color.id,revision:'v01',compatibility,materials,profiles}
  const text=compact(skin),file='skins/bottle/'+skin.id+'/'+skin.revision+'/skin.json'
  await save('public/'+file,text)
  skins.push({id:skin.id,revision:skin.revision,label:color.label,file,sha256:sha(Buffer.from(text)),bytes:Buffer.byteLength(text)})
}
const registry={schemaVersion:1,defaultSkin:{id:'bottle-black',revision:'v01'},compatibility,geometry,skins}
await save('shared/bottleSkins.json',compact(registry))
const report={schemaVersion:1,compatibility,originals,geometry,skins,profiles,materials:definitions,geometryBuffersCopiedWithoutReencoding:true}
await save('models/bottle/skin-delivery-v01.json',JSON.stringify(report,null,2)+'\n')
for(const input of originals)assert.equal(sha(await readFile(path.join(root,input.file))),input.sha256)
console.log(JSON.stringify({geometry,skins:skins.length,images:profiles.low.images.length+profiles.final.images.length,manifestBytes:skins[0].bytes}))
