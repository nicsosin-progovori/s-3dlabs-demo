import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {Box3,BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshBasicMaterial,PerspectiveCamera,Vector3} from 'three'
import {BOTTLE_BASE_PIVOT,BOTTLE_SCALE,applyBottlePose,bottleMotionDuration,bottleMotionEnvelope,bottlePoseBounds,createBottleRig,sampleBottlePose} from '../src/bottleMotion.ts'
import {bottleCameraRoll,bottleCameraTransition,bottleCameraUp,bottleFrame,bottleOrbitLimits} from '../src/bottleCameraMotion.ts'
import {BOTTLE_VIEWS,bottleViews,bottleCamera} from '../src/bottleViews.ts'

// Actual asset vertices and hierarchy, without a browser or a texture decoder.
const bytes=await readFile(new URL('../public/models/bottle/bottle.glb',import.meta.url))
const length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+length)),binary=bytes.subarray(28+length)
function node(index){
  const n=gltf.nodes[index],root=new Group()
  root.name=n.name;root.userData={...n.extras}
  if(n.matrix){root.matrix.fromArray(n.matrix);root.matrix.decompose(root.position,root.quaternion,root.scale)}
  else {if(n.translation)root.position.fromArray(n.translation);if(n.rotation)root.quaternion.fromArray(n.rotation);if(n.scale)root.scale.fromArray(n.scale)}
  if(n.mesh!==undefined)for(const primitive of gltf.meshes[n.mesh].primitives){
    const a=gltf.accessors[primitive.attributes.POSITION],b=gltf.bufferViews[a.bufferView],values=[]
    for(let i=0;i<a.count;i++)for(let j=0;j<3;j++)values.push(binary.readFloatLE((b.byteOffset??0)+(a.byteOffset??0)+i*(b.byteStride??12)+j*4))
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(values,3))
    const mesh=new Mesh(geometry,new MeshBasicMaterial());mesh.userData={...n.extras};root.add(mesh)
  }
  for(const child of n.children??[])root.add(node(child))
  return root
}
const source=new Group();for(const index of gltf.scenes[gltf.scene??0].nodes)source.add(node(index))
const rig=createBottleRig(source),states=['closed','open','lying'],pairs=states.flatMap(from=>states.filter(to=>to!==from).map(to=>({id:1,from,to})))
const near=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`)
function realBounds(root){
  const bounds=new Box3();root.updateWorldMatrix(true,true)
  root.traverse(o=>{if(o instanceof Mesh&&!o.userData.print_surface){o.geometry.computeBoundingBox();bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld))}})
  return bounds
}

test('one cloned bottle reaches all three actual GLB endpoints and leaves source poses intact',()=>{
  const canonical=source.children.find(o=>o.userData.product_state==='closed')
  canonical.visible=false
  assert.equal(createBottleRig(source).body.visible,true,'The rig also works when the source was last displaying an open pose')
  canonical.visible=true
  const before=source.children.map(n=>({position:n.position.toArray(),rotation:n.quaternion.toArray(),children:n.children.length}))
  for(const state of states){
    const pose=sampleBottlePose(rig,state,state,1);applyBottlePose(rig,pose)
    const expected=realBounds(source.children.find(o=>o.userData.product_state===state))
    if(state==='lying')expected.translate(new Vector3(BOTTLE_BASE_PIVOT,0,0))
    const actual=bottlePoseBounds(rig,pose)
    for(const key of ['min','max'])for(const axis of ['x','y','z'])near(actual[key][axis],expected[key][axis])
    const rendered=realBounds(rig.root)
    for(const key of ['min','max'])for(const axis of ['x','y','z'])near(rendered[key][axis],actual[key][axis])
  }
  assert.deepEqual(source.children.map(n=>({position:n.position.toArray(),rotation:n.quaternion.toArray(),children:n.children.length})),before)
  assert.equal(rig.root.children.length,1)
})

test('all six retimed motions stay grounded, clear the neck before carrying, and remain continuous',()=>{
  for(const {from,to}of pairs){
    assert.ok(bottleMotionDuration(from,to)>=1&&bottleMotionDuration(from,to)<=1.8)
    let previous
    for(let i=0;i<=240;i++){
      const pose=sampleBottlePose(rig,from,to,i/240),body=bottlePoseBounds(rig,pose,'body'),lid=bottlePoseBounds(rig,pose,'lid'),centre=lid.getCenter(new Vector3())
      assert.ok(body.min.y>=-1e-8,`${from} → ${to}: bottle through floor`)
      assert.ok(lid.min.y>=-1e-8,`${from} → ${to}: lid through floor`)
      assert.ok(body.min.y<1e-6,'Bottle retains physical floor contact')
      if(Math.abs(pose.angle)>1e-6)assert.ok(pose.lidOffset.length()<1e-8,'Close the cap before tipping')
      if(pose.lidOffset.x>.001&&pose.lidOffset.x<.05)assert.ok(lid.min.y>.187,'Lift the thread plug above the neck before moving sideways')
      if(previous)assert.ok(centre.distanceTo(previous)<.016,'No frame-to-frame teleport at phase boundaries')
      previous=centre
    }
    const end=bottlePoseBounds(rig,sampleBottlePose(rig,from,to,1)),settled=bottlePoseBounds(rig,sampleBottlePose(rig,to,to,1))
    near(end.min.distanceTo(settled.min),0);near(end.max.distanceTo(settled.max),0)
  }
})

test('unthreading is readable and landing gains speed then dissipates the rebound',()=>{
  const duration=bottleMotionDuration('closed','open')
  let unthreadedAt
  for(let i=0;i<=1000;i++){
    const t=i/1000,pose=sampleBottlePose(rig,'closed','open',t)
    if(Math.abs(pose.lidRotation.y)<Math.PI*1.98){
      near(pose.lidOffset.x,0);near(pose.lidOffset.z,0);near(pose.lidRotation.z,0)
    }else if(unthreadedAt===undefined)unthreadedAt=t*duration
  }
  assert.ok(unthreadedAt>=.45&&unthreadedAt<=.65,'Allow about half a second to read the unscrewing turn')
  const angle=t=>sampleBottlePose(rig,'closed','lying',t).angle
  const earlySpeed=Math.abs(angle(.50)-angle(.34))/.16
  const lateSpeed=Math.abs(angle(.74)-angle(.63))/.11
  assert.ok(lateSpeed>earlySpeed*1.8,'A weighted fall accelerates before contact')
  let largestRebound=0,peakReboundSpeed=0,previous=angle(.78)
  for(let i=781;i<=1000;i++){
    const next=angle(i/1000)
    largestRebound=Math.max(largestRebound,Math.abs(next+Math.PI/2))
    peakReboundSpeed=Math.max(peakReboundSpeed,Math.abs(next-previous)*1000)
    previous=next
  }
  assert.ok(largestRebound<.7*Math.PI/180,'Heavy contact leaves a small residual rock')
  assert.ok(peakReboundSpeed<lateSpeed*.10,'Recoil loses most of the incoming angular speed')
})

test('cinematic camera keeps the moving assembly in frame on desktop and narrow mobile after the initial pullback',()=>{
  const views={closed:[22,.28],open:[-18,.55],lying:[0,.38]}
  for(const request of pairs)for(const [width,height]of [[848,486],[366,322],[296,282]]){
    const start=bottleFrame(bottlePoseBounds(rig,sampleBottlePose(rig,request.from,request.from,1)),...views[request.from],width,height)
    const end=bottleFrame(bottlePoseBounds(rig,sampleBottlePose(rig,request.to,request.to,1)),...views[request.to],width,height)
    const envelope=bottleMotionEnvelope(rig,request),wide=bottleFrame(envelope,request.to==='open'?-12:request.to==='lying'?18:26,request.to==='open'?.55:.46,width,height)
    const camera=new PerspectiveCamera(35,width/height,.01,200)
    for(let i=0;i<=60;i++){
      const t=i/60,bounds=bottlePoseBounds(rig,sampleBottlePose(rig,request.from,request.to,t)),frame=bottleCameraTransition(start,wide,end,t,bounds,width,height)
      camera.position.copy(frame.position);camera.lookAt(frame.target);camera.updateMatrixWorld()
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
        const p=new Vector3(x,y,z).multiplyScalar(BOTTLE_SCALE).project(camera)
        assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>-1&&p.z<1,`${request.from} → ${request.to} ${width}px @ ${t}: clipped`)
      }
      if(i===60){near(frame.position.distanceTo(end.position),0);near(frame.target.distanceTo(end.target),0)}
    }
  }
})

test('leaving a lid closeup or rear view pulls back without a camera whip or clipping the cap flight',()=>{
  const request={id:1,from:'closed',to:'open'},width=848,height=486
  const closed=sampleBottlePose(rig,'closed','closed',1),open=sampleBottlePose(rig,'open','open',1)
  const end=bottleFrame(bottlePoseBounds(rig,open),-18,.55,width,height),wide=bottleFrame(bottleMotionEnvelope(rig,request),-12,.55,width,height)
  const starts=[bottleFrame(bottlePoseBounds(rig,closed,'lid'),15,1.05,width,height),bottleFrame(bottlePoseBounds(rig,closed),180,.28,width,height)]
  for(const start of starts){
    let previous
    const camera=new PerspectiveCamera(35,width/height,.01,200)
    for(let i=0;i<=60;i++){
      const t=i/60,bounds=bottlePoseBounds(rig,sampleBottlePose(rig,'closed','open',t)),frame=bottleCameraTransition(start,wide,end,t,bounds,width,height),direction=frame.position.clone().sub(frame.target).normalize()
      if(previous)assert.ok(direction.angleTo(previous)<.23,'Spread the orbit over the action, not just the early pullback')
      previous=direction
      if(t<.24)continue
      camera.position.copy(frame.position);camera.lookAt(frame.target);camera.updateMatrixWorld()
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
        const p=new Vector3(x,y,z).multiplyScalar(BOTTLE_SCALE).project(camera)
        assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1,'The cap and bottle fit once the initial detail pullback finishes')
      }
    }
  }
})

function advertisingBox(state,view){
  if(!view.focusMm)return bottlePoseBounds(rig,sampleBottlePose(rig,state,state,1))
  const offset=new Vector3(state==='lying'?BOTTLE_BASE_PIVOT:0,0,0)
  return new Box3(new Vector3(...view.focusMm.min).multiplyScalar(.001).add(offset),new Vector3(...view.focusMm.max).multiplyScalar(.001).add(offset))
}
function applyAdvertisingFrame(camera,frame){
  camera.fov=frame.fov;camera.updateProjectionMatrix()
  camera.position.copy(frame.position);camera.up.copy(bottleCameraUp(frame));camera.lookAt(frame.target);camera.updateMatrixWorld()
}
function assertBoxFits(camera,box,message){
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const p=new Vector3(x,y,z).multiplyScalar(BOTTLE_SCALE).project(camera)
    assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>-1&&p.z<1,message)
  }
}
test('advertising views preserve focus bounds and deliberate composition with real lens and camera roll',()=>{
  for(const state of states)for(const surface of ['body','lid'])for(const id of bottleViews(state,surface))for(const [width,height]of [[848,486],[366,322],[296,282]]){
    const view=bottleCamera(state,id,surface,1),box=advertisingBox(state,view),frame=bottleFrame(box,view.azimuth,view.elevation,width,height,view)
    assert.ok(frame.fov>=20&&frame.fov<=30)
    if(state==='lying'&&id==='branding'&&surface==='body')near(frame.roll,-90)
    else assert.ok(Math.abs(frame.roll)<=(surface==='lid'?90:35))
    const camera=new PerspectiveCamera(frame.fov,width/height,.01,200)
    applyAdvertisingFrame(camera,frame)
    assertBoxFits(camera,box,`${state} / ${id} / ${surface}: detail cropped at ${width}px`)
    const centre=box.getCenter(new Vector3()).multiplyScalar(BOTTLE_SCALE).project(camera)
    if(width/height>=1.5)near(centre.x,view.subject[0])
    else {assert.ok(Math.abs(centre.x)<=Math.abs(view.subject[0])+1e-7);if(view.subject[0])assert.ok(centre.x*view.subject[0]>0,'Narrow framing retains the composition direction')}
    near(centre.y,view.subject[1])
    near(bottleCameraRoll(frame.position,frame.target,camera.up),view.roll)
    if(state!=='closed'&&(id==='lid'||(id==='branding'&&surface==='lid')))assertBoxFits(camera,bottlePoseBounds(rig,sampleBottlePose(rig,state,state,1),'lid'),'The real detached / lying cap stays complete in its macro shot')
  }
})

test('low hero angles survive orbit limits and manual zoom cannot cross the floor',()=>{
  for(const state of states)for(const id of BOTTLE_VIEWS[state])for(const [width,height]of [[848,486],[366,280],[296,240]]){
    const view=bottleCamera(state,id,'body',1),frame=bottleFrame(advertisingBox(state,view),view.azimuth,view.elevation,width,height,view),limits=bottleOrbitLimits(frame)
    const radius=frame.position.distanceTo(frame.target),polar=Math.acos(frame.position.clone().sub(frame.target).normalize().y)
    assert.ok(frame.position.y>=.06,'A fixed photograph remains above the floor')
    assert.ok(radius<=limits.maxDistance+1e-7&&polar<=limits.maxPolarAngle+1e-7,'OrbitControls must not move the selected camera')
    for(const distance of [.6,radius,limits.maxDistance])for(const angle of [.08,Math.PI/2,limits.maxPolarAngle]){
      if(angle>limits.maxPolarAngle)continue
      assert.ok(frame.target.y+distance*Math.cos(angle)>=.06-1e-7,'Manual drag and zoom stay above the physical floor')
    }
  }
})

test('state transitions retain the new lens, diagonal and final advertising composition without clipping',()=>{
  for(const request of pairs)for(const surface of ['body','lid'])for(const [width,height]of [[848,486],[366,322],[296,282]]){
    const startView=bottleCamera(request.from,'overview',surface,1),endView=bottleCamera(request.to,'overview',surface,2)
    const start=bottleFrame(advertisingBox(request.from,startView),startView.azimuth,startView.elevation,width,height,startView)
    const end=bottleFrame(advertisingBox(request.to,endView),endView.azimuth,endView.elevation,width,height,endView)
    const wide=bottleFrame(bottleMotionEnvelope(rig,request),request.to==='open'?-12:request.to==='lying'?18:26,request.to==='open'?.55:.46,width,height,{fov:Math.min(endView.fov,24)})
    const camera=new PerspectiveCamera(start.fov,width/height,.01,200)
    for(let i=0;i<=60;i++){
      const t=i/60,box=bottlePoseBounds(rig,sampleBottlePose(rig,request.from,request.to,t)),frame=bottleCameraTransition(start,wide,end,t,box,width,height)
      applyAdvertisingFrame(camera,frame)
      assertBoxFits(camera,box,`${request.from} → ${request.to}: artistic framing clipped at ${t}`)
      if(i===60){near(frame.fov,end.fov);near(frame.roll,end.roll);near(frame.position.distanceTo(end.position),0);near(frame.target.distanceTo(end.target),0)}
    }
  }
})
