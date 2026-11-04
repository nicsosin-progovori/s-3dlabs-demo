import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {Bone,Box3,BufferAttribute,BufferGeometry,DoubleSide,Group,Matrix4,Mesh,MeshBasicMaterial,PerspectiveCamera,Raycaster,Skeleton,SkinnedMesh,Vector3} from 'three'
import {applyEndoPose,createEndoRig,ENDO_SCALE,ENDO_STATES,endoActualStrapLength,endoIndex,endoPose,endoRouteDuration,EndoTimeline} from '../src/endoMotion.ts'
import {ENDO_VIEWS,endoCameraFrame,endoFocus,endoMotionFrame} from '../src/endoViews.ts'
import {bottleCameraUp} from '../src/bottleCameraMotion.ts'

// Decode the actual self-contained GLB, including its real skin bindings.
// Texture decoding is deliberately omitted: geometry tests need no browser.
const bytes=await readFile(new URL('../public/models/endo/endo-rig-v02.glb',import.meta.url))
const jsonSize=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonSize)),binary=bytes.subarray(28+jsonSize)
const jointIds=new Set(gltf.skins.flatMap(s=>s.joints)),nodes=[],pending=[]
function accessor(id){
  const a=gltf.accessors[id],v=gltf.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type]
  const [type,step,read]={5126:[Float32Array,4,'readFloatLE'],5123:[Uint16Array,2,'readUInt16LE'],5121:[Uint8Array,1,'readUInt8'],5125:[Uint32Array,4,'readUInt32LE']}[a.componentType]
  const values=new type(a.count*size)
  for(let i=0;i<a.count;i++)for(let j=0;j<size;j++)values[i*size+j]=binary[read]((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??size*step)+j*step)
  return new BufferAttribute(values,size,a.normalized??false)
}
function node(index){
  const n=gltf.nodes[index],root=jointIds.has(index)?new Bone():new Group();nodes[index]=root
  root.name=n.name;root.userData={...n.extras}
  if(n.matrix){root.matrix.fromArray(n.matrix);root.matrix.decompose(root.position,root.quaternion,root.scale)}
  else {if(n.translation)root.position.fromArray(n.translation);if(n.rotation)root.quaternion.fromArray(n.rotation);if(n.scale)root.scale.fromArray(n.scale)}
  if(n.mesh!==undefined)for(const p of gltf.meshes[n.mesh].primitives){
    const geometry=new BufferGeometry();geometry.setAttribute('position',accessor(p.attributes.POSITION))
    if(p.indices!==undefined)geometry.setIndex(accessor(p.indices))
    const material=new MeshBasicMaterial({side:DoubleSide})
    const mesh=n.skin===undefined?new Mesh(geometry,material):new SkinnedMesh(geometry,material)
    if(n.skin!==undefined){geometry.setAttribute('skinIndex',accessor(p.attributes.JOINTS_0));geometry.setAttribute('skinWeight',accessor(p.attributes.WEIGHTS_0));pending.push([mesh,n.skin])}
    root.add(mesh)
  }
  for(const child of n.children??[])root.add(node(child))
  return root
}
const source=new Group();for(const i of gltf.scenes[gltf.scene??0].nodes)source.add(node(i))
source.updateMatrixWorld(true)
for(const [mesh,id]of pending){
  const s=gltf.skins[id],values=accessor(s.inverseBindMatrices).array
  mesh.bind(new Skeleton(s.joints.map(i=>nodes[i]),s.joints.map((_,i)=>new Matrix4().fromArray(values,i*16))),new Matrix4())
}
const rig=createEndoRig(source)
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`)
function actualBounds(root){
  const box=new Box3();root.updateWorldMatrix(true,true)
  root.traverseVisible(o=>{
    if(!(o instanceof Mesh)||o.userData.print_surface)return
    const a=o.geometry.attributes.position
    for(let i=0;i<a.count;i++){
      const p=new Vector3().fromBufferAttribute(a,i)
      if(o instanceof SkinnedMesh)o.applyBoneTransform(i,p)
      box.expandByPoint(p.applyMatrix4(o.matrixWorld))
    }
  });return box
}
function cameraFor(frame,width,height){
  const c=new PerspectiveCamera(frame.fov,width/height,.025,100)
  c.position.copy(frame.position);c.up.copy(bottleCameraUp(frame));c.lookAt(frame.target);c.updateMatrixWorld();return c
}
function fits(box,camera,message,limit=1){
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const p=new Vector3(x,y,z).multiplyScalar(ENDO_SCALE).project(camera)
    assert.ok(Math.abs(p.x)<limit&&Math.abs(p.y)<limit&&p.z>-1&&p.z<1,`${message}: clipped ${p.toArray()}`)
  }
}

test('actual GLB has one textile skin, rigid module and one hinged box; both materials deform',()=>{
  assert.equal(gltf.skins.length,1);assert.equal(rig.bones.length,129);assert.equal(rig.straps.length,2)
  assert.ok(!gltf.nodes.some(n=>n.extras?.product_state),'No model swaps between catalogue states')
  for(const q of [0,1,1.3,1.6,2,2.3,2.6,3]){
    const pose=endoPose(q);applyEndoPose(rig,pose)
    near(endoActualStrapLength(rig),.240)
    const real=actualBounds(rig.tracker),planned=pose.trackerBounds
    assert.ok(real.min.y>=-.00015,`Actual skinned vertices through floor at ${q}: ${real.min.y}`)
    for(const key of ['min','max'])assert.ok(real[key].distanceTo(planned[key])<.0035,`Actual GLB differs from physical envelope at ${q}: ${key} ${real[key].toArray()} / ${planned[key].toArray()}`)
  }
  const scaled=new Group();scaled.scale.setScalar(ENDO_SCALE);scaled.add(source)
  applyEndoPose(rig,endoPose(3));near(endoActualStrapLength(rig),.240)
  scaled.remove(source);source.updateWorldMatrix(true,true)
})

test('material length stays 240 mm; packed assembly fits the real box, unfolding clears the rim and floor',()=>{
  let previous
  for(let i=0;i<=1200;i++){
    const q=i/400,p=endoPose(q),length=p.points.slice(1).reduce((n,v,j)=>n+v.distanceTo(p.points[j]),0)
    near(length,.240);assert.ok(p.trackerBounds.min.y>=-1e-9)
    assert.ok(p.rotation.toArray().every(Number.isFinite))
    if(q<=1){assert.ok(p.trackerBounds.max.x<.0701&&p.trackerBounds.min.x>-.0701);assert.ok(p.trackerBounds.max.z<.0406&&p.trackerBounds.min.z>-.0406);assert.ok(p.trackerBounds.max.y<.0155);assert.ok(p.trackerBounds.min.y>.0022)}
    if(q>1.18&&q<1.76)assert.ok(p.trackerBounds.min.y>.017,'Clear the box rim before unfolding')
    if(previous)assert.ok(p.position.distanceTo(previous)<.003,'No jump at any phase boundary')
    previous=p.position
  }
  near(endoPose(2).trackerBounds.min.y,0);near(endoPose(3).trackerBounds.min.y,.014)
})

test('all twelve directed routes reach the same exact endpoints without a frame reset',()=>{
  for(const from of ENDO_STATES)for(const to of ENDO_STATES.filter(s=>s!==from)){
    const timeline=new EndoTimeline(from);timeline.request(to,1,10)
    const duration=endoRouteDuration(from,to)+timeline.lead
    let previous=endoIndex(from)
    for(let i=0;i<=Math.ceil(duration*120)+1;i++){
      const q=timeline.sample(10+i/120)
      assert.ok(Math.abs(q-previous)<.04,`${from} -> ${to}: teleport`);previous=q
    }
    assert.equal(timeline.active,false);near(timeline.coordinate,endoIndex(to));assert.equal(timeline.epoch,1)
  }
})

test('latest queued target turns at a safe anchor and reduced motion settles immediately',()=>{
  const timeline=new EndoTimeline('wrist');timeline.request('box-closed',1,0)
  timeline.sample(.9);const before=timeline.coordinate,started=timeline.started
  timeline.request('wrist',2,.9);near(timeline.coordinate,before);near(timeline.started,started)
  timeline.sample(1.6);assert.ok(timeline.coordinate>=2&&timeline.coordinate<2.1,'Turns at flat, without jumping back to wrist')
  timeline.sample(10);assert.equal(timeline.coordinate,3);assert.equal(timeline.active,false);assert.equal(timeline.id,2)
  timeline.request('box-open',3,11,true);assert.equal(timeline.coordinate,1);assert.equal(timeline.active,false)
})

test('thirteen endpoint views and the entire camera rail fit their subject on desktop and mobile',()=>{
  assert.equal(Object.values(ENDO_VIEWS).flat().length,13)
  for(const [w,h]of [[848,448],[354,290],[284,272]]){
    for(const state of ENDO_STATES)for(const view of ENDO_VIEWS[state]){
      const pose=endoPose(endoIndex(state)),frame=endoCameraFrame(state,view,w,h)
      assert.ok(frame.position.y>.06,'Camera stays above the studio floor')
      fits(endoFocus(pose,state,view),cameraFor(frame,w,h),`${state}/${view} ${w}px`)
    }
    for(let i=0;i<=600;i++){
      const pose=endoPose(i/200),frame=endoMotionFrame(pose,w,h)
      fits(pose.trackerBounds,cameraFor(frame,w,h),`motion ${i/200} ${w}px`)
      if(i<=200)fits(pose.boxBounds,cameraFor(frame,w,h),'Box opening')
    }
    for(const state of ENDO_STATES){
      const endpoint=endoMotionFrame(endoPose(endoIndex(state)),w,h),hero=endoCameraFrame(state,'overview',w,h)
      near(endpoint.position.distanceTo(hero.position),0);near(endpoint.target.distanceTo(hero.target),0);near(endpoint.roll,hero.roll)
    }
    const p=endoPose(1.99999),camera=cameraFor(endoMotionFrame(p,w,h),w,h),corners=[]
    for(const x of [p.boxBounds.min.x,p.boxBounds.max.x])for(const y of [p.boxBounds.min.y,p.boxBounds.max.y])for(const z of [p.boxBounds.min.z,p.boxBounds.max.z])corners.push(new Vector3(x,y,z).multiplyScalar(ENDO_SCALE).project(camera))
    assert.ok(corners.every(p=>p.x<-1),'The box leaves the frame physically before being culled')
  }
})

test('buckle bridges and optical sensor are visible through the actual deformed skin',()=>{
  applyEndoPose(rig,endoPose(3))
  rig.straps.forEach(m=>{m.computeBoundingBox();m.computeBoundingSphere()})
  const firstHit=(view,target)=>{
    const frame=endoCameraFrame('wrist',view,848,448),origin=frame.position.clone().divideScalar(ENDO_SCALE)
    const hits=new Raycaster(origin,target.clone().sub(origin).normalize()).intersectObject(rig.tracker,true)
    assert.ok(hits.length,'Camera ray hits the feature')
    return hits[0].object.parent.name
  }
  const bridges=rig.buckle.children.filter(o=>o.name.startsWith('BuckleBridge'))
  for(const bridge of bridges)assert.ok(firstHit('buckle',bridge.getWorldPosition(new Vector3())).startsWith('BuckleBridge'),'Free textile tail must thread beneath the adjustment buckle')
  let sensor;rig.tracker.traverse(o=>{if(o.name==='OpticalSensorWindow')sensor=o})
  assert.equal(firstHit('sensor',sensor.getWorldPosition(new Vector3())),'OpticalSensorWindow','Rear strap does not hide the sensor')
})
