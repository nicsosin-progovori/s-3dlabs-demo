import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {Box3,BufferAttribute,BufferGeometry,DoubleSide,Group,Matrix4,Mesh,MeshBasicMaterial,PerspectiveCamera,Raycaster,Vector3} from 'three'
import {createPillowSubject,PILLOW_SCALE,PILLOW_VIEWS,pillowCameraDuration,pillowCameraFrame,pillowCameraPlan,pillowCameraTransition,pillowFocusPoints} from '../src/pillowViews.ts'
import {bottleCameraUp} from '../src/bottleCameraMotion.ts'

const bytes=await readFile(new URL('../public/models/pillow/pillow-v02.glb',import.meta.url))
const metadata=JSON.parse(await readFile(new URL('../models/pillow/geometry-v02.json',import.meta.url)))
const jsonSize=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonSize)),binary=bytes.subarray(28+jsonSize)
function accessor(id){
  const a=gltf.accessors[id],v=gltf.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type]
  const [Type,step,read]={5126:[Float32Array,4,'readFloatLE'],5123:[Uint16Array,2,'readUInt16LE'],5125:[Uint32Array,4,'readUInt32LE']}[a.componentType],values=new Type(a.count*size)
  for(let i=0;i<a.count;i++)for(let j=0;j<size;j++)values[i*size+j]=binary[read]((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??size*step)+j*step)
  return new BufferAttribute(values,size)
}
function node(index){
  const n=gltf.nodes[index],root=new Group();root.name=n.name;root.userData={...n.extras}
  if(n.matrix){root.matrix.fromArray(n.matrix);root.matrix.decompose(root.position,root.quaternion,root.scale)}
  else {if(n.translation)root.position.fromArray(n.translation);if(n.rotation)root.quaternion.fromArray(n.rotation);if(n.scale)root.scale.fromArray(n.scale)}
  if(n.mesh!==undefined)for(const p of gltf.meshes[n.mesh].primitives){
    const g=new BufferGeometry();g.setAttribute('position',accessor(p.attributes.POSITION));g.setAttribute('normal',accessor(p.attributes.NORMAL));if(p.attributes.TEXCOORD_0!==undefined)g.setAttribute('uv',accessor(p.attributes.TEXCOORD_0));if(p.indices!==undefined)g.setIndex(accessor(p.indices))
    const mat=new MeshBasicMaterial({side:DoubleSide});mat.name=gltf.materials[p.material].name
    const mesh=new Mesh(g,mat);mesh.userData={...n.extras};root.add(mesh)
  }
  for(const i of n.children??[])root.add(node(i));return root
}
const source=new Group();for(const i of gltf.scenes[gltf.scene??0].nodes)source.add(node(i))
const subject=createPillowSubject(source)
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`)
function find(name){let found;source.traverse(o=>{if(o.name===name)found=o});assert.ok(found,'Missing '+name);return found}
function points(part){
  const output=[];const add=o=>o.traverse(v=>{if(!(v instanceof Mesh)||(!part&&v.userData.print_surface))return;const p=v.geometry.attributes.position;for(let i=0;i<p.count;i++)output.push(new Vector3().fromBufferAttribute(p,i).applyMatrix4(v.matrixWorld))})
  if(part)source.traverse(o=>{if(o.userData.pillow_part===part&&o instanceof Group)add(o)})
  else add(source)
  return output
}
const allPoints=points(),bodyPoints=points('body')
function camera(frame,w,h){const c=new PerspectiveCamera(frame.fov,w/h,.025,100);c.position.copy(frame.position);c.up.copy(bottleCameraUp(frame));c.lookAt(frame.target);c.updateMatrixWorld();return c}
function assertFits(list,c,message){for(const p of list){const v=p.clone().multiplyScalar(PILLOW_SCALE).project(c);assert.ok(Math.abs(v.x)<1&&Math.abs(v.y)<1&&v.z>-1&&v.z<1,`${message}: ${v.toArray()}`)}}

test('saved V02 has the 220 x 220 x 109 mm body, grounded PU loops and separated hardware',()=>{
  assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.glbSha256)
  const size=subject.body.getSize(new Vector3());near(size.x,.220,1e-5);near(size.y,.109,1e-5);near(size.z,.220,1e-5)
  assert.ok(subject.full.min.y>=-1e-6,`Actual vertex below floor: ${subject.full.min.y}`)
  assert.ok(subject.full.getSize(new Vector3()).x>.30,'Include the actual loose loops in the footprint')
  assert.ok(new Box3().setFromObject(find('OpenBuckleRail')).max.x<0);assert.ok(new Box3().setFromObject(find('ReleaseBuckleBody')).min.x>0)
  assert.equal(gltf.skins?.length??0,0);assert.equal(gltf.animations?.length??0,0)
})

test('both woven fabrics and the PU grain have embedded PBR data, valid smooth normals and physical UV repeats',()=>{
  assert.ok(gltf.buffers.every(b=>!b.uri));assert.ok(gltf.images.every(i=>i.bufferView!==undefined))
  for(const name of ['PillowBlackPolyesterV02','PillowGreyPolyesterV02','PUStrapCoated']){
    const m=gltf.materials.find(m=>m.name===name);assert.equal(m.pbrMetallicRoughness.metallicFactor,0);assert.ok(m.normalTexture);assert.ok(m.pbrMetallicRoughness.metallicRoughnessTexture)
  }
  source.traverse(o=>{if(o instanceof Mesh){const n=o.geometry.attributes.normal;for(let i=0;i<n.count;i++){const v=new Vector3().fromBufferAttribute(n,i);assert.ok(v.toArray().every(Number.isFinite));assert.ok(Math.abs(v.length()-1)<.003)}}})
  assert.ok(find('PillowContinuousCover').children.some(o=>o instanceof Mesh&&Array.from(o.geometry.attributes.uv.array).some(v=>v>=40)),'Textile UVs repeat in small physical tiles')
})

test('curved logo rows measure 80 mm, height is 40 mm, and the UV faces outward without mirroring',()=>{
  const object=find('PillowCurvedDecoration'),m=object.children.find(c=>c instanceof Mesh),p=m.geometry.attributes.position,uv=m.geometry.attributes.uv,n=m.geometry.attributes.normal
  const row=v=>{const items=[];for(let i=0;i<uv.count;i++)if(Math.abs(uv.getY(i)-v)<1e-6)items.push({u:uv.getX(i),p:new Vector3().fromBufferAttribute(p,i)});return items.sort((a,b)=>a.u-b.u)}
  for(const v of [0,.25,.5,.75,1]){const r=row(v),length=r.slice(1).reduce((s,q,i)=>s+q.p.distanceTo(r[i].p),0);near(length,.080,.0002)}
  const mid=row(.5),bottom=row(0),top=row(1),du=mid.at(-1).p.clone().sub(mid[0].p),dv=top[40].p.clone().sub(bottom[40].p)
  near(new Box3().setFromObject(object).getSize(new Vector3()).y,.040,.0002)
  let middle=0,best=Infinity;for(let i=0;i<uv.count;i++){const d=(uv.getX(i)-.5)**2+(uv.getY(i)-.5)**2;if(d<best){best=d;middle=i}}
  const uvFacing=new Vector3().crossVectors(du,dv).normalize().dot(new Vector3().fromBufferAttribute(n,middle))
  assert.ok(uvFacing<-.98&&du.z<0&&dv.y<0,'glTF U points right and V points down on the outward-facing surface')
})

test('all six advertising views fit actual geometry on desktop and narrow mobile',()=>{
  for(const [w,h]of [[846,452],[349,295],[279,295]])for(const view of PILLOW_VIEWS){
    const frame=pillowCameraFrame(subject,view,w,h),c=camera(frame,w,h)
    assert.ok(frame.position.y>.065)
    assertFits(view==='overview'?allPoints:view==='top'||view==='profile'?bodyPoints:pillowFocusPoints(subject,view),c,`${view} ${w}px`)
  }
})

test('all 30 camera routes remain continuous, above the floor and outside the cushion',()=>{
  const body=subject.body.clone();body.min.multiplyScalar(PILLOW_SCALE);body.max.multiplyScalar(PILLOW_SCALE)
  for(const [w,h]of [[846,452],[279,295]])for(const from of PILLOW_VIEWS)for(const to of PILLOW_VIEWS.filter(v=>v!==from)){
    const start=pillowCameraFrame(subject,from,w,h),end=pillowCameraFrame(subject,to,w,h),duration=pillowCameraDuration(start,end),plan=pillowCameraPlan(start,end,subject,w,h);assert.ok(duration>=.66&&duration<1.5)
    let prev=start.position;const maxRadius=Math.max(start.position.distanceTo(start.target),end.position.distanceTo(end.target),plan.wideStart.position.distanceTo(plan.wideStart.target))
    for(let i=0;i<=120;i++){
      const t=i/120,f=pillowCameraTransition(start,end,subject,t,w,h,plan)
      assert.ok(f.position.y>=.065);assert.ok(!body.containsPoint(f.position),`${from} -> ${to} intersects body`)
      assert.ok(f.position.distanceTo(prev)<maxRadius*.14,`${from} -> ${to}: discontinuous camera step`);prev=f.position
      if(i===60)assertFits(allPoints,camera(f,w,h),`${from} -> ${to}: middle pullback`)
      if(i===120){near(f.position.distanceTo(end.position),0);near(f.target.distanceTo(end.target),0)}
    }
    assert.ok(pillowCameraTransition(start,end,subject,.0001,w,h).position.distanceTo(start.position)<1e-5)
    for(const boundary of [.30,.70]){const a=pillowCameraTransition(start,end,subject,boundary-.000001,w,h,plan),b=pillowCameraTransition(start,end,subject,boundary+.000001,w,h,plan);assert.ok(a.position.distanceTo(b.position)<.0001,'No cut at the pullback / orbit boundaries')}
  }
})

test('logo, controls and both fastener halves are visible on the real mesh; scale does not alter framing data',()=>{
  const hit=(view,target)=>{
    const f=pillowCameraFrame(subject,view,846,452),origin=f.position.clone().divideScalar(PILLOW_SCALE),hits=new Raycaster(origin,target.clone().sub(origin).normalize()).intersectObject(source,true)
    assert.ok(hits.length,'Feature ray hits the model');return hits[0].object.parent.name
  }
  assert.equal(hit('branding',subject.branding.getCenter(new Vector3())),'PillowCurvedDecoration')
  assert.equal(hit('controls',new Box3().setFromObject(find('SiliconeControlPanel')).getCenter(new Vector3())),'SiliconeControlPanel')
  assert.ok(hit('buckle',new Box3().setFromObject(find('ReleaseButton')).getCenter(new Vector3())).startsWith('Release'))
  const bridgeHit=hit('buckle',new Box3().setFromObject(find('OpenBuckleBridge')).getCenter(new Vector3()))
  assert.ok(bridgeHit.startsWith('OpenBuckle')||bridgeHit==='BuckleDivider','The left buckle is not covered by a strap')
  const parent=new Group();parent.scale.setScalar(PILLOW_SCALE);parent.add(source);const scaled=createPillowSubject(source)
  for(const key of ['full','body','branding','controls','buckle','fabric','rollers']){near(scaled[key].min.distanceTo(subject[key].min),0);near(scaled[key].max.distanceTo(subject[key].max),0)}
  parent.remove(source);source.updateWorldMatrix(true,true)
})
