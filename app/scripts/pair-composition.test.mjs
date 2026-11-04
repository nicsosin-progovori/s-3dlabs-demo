import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Box3,BoxGeometry,Group,Matrix4,Mesh,MeshStandardMaterial,PerspectiveCamera,Texture,Vector3} from 'three'
import {readGlbGeometry} from './read-glb-geometry.mjs'
import {createBottleRig,bottlePoseBounds,bottleMotionEnvelope,sampleBottlePose} from '../src/bottleMotion.ts'
import {createEndoRig,applyEndoPose,endoPose,endoIndex,ENDO_STATES,endoActualStrapLength} from '../src/endoMotion.ts'
import {createPillowSubject} from '../src/pillowViews.ts'
import {PAIR_SCALE,PAIR_GAP,PAIR_VIEWS,pairBounds,pairCameraFrame,pairEndoBounds,placePair,reservePair} from '../src/pairLayout.ts'
import {bottleCameraUp} from '../src/bottleCameraMotion.ts'
import {studioInstance} from '../src/studioInstance.ts'

const roots=await Promise.all(['bottle/bottle.glb','endo/endo-rig-v02.glb','pillow/pillow-v02.glb'].map(p=>readGlbGeometry(new URL('../public/models/'+p,import.meta.url))))
const bottle=createBottleRig(roots[0]),pillow=createPillowSubject(roots[2]),yaw=-Math.PI/3,rotation=new Matrix4().makeRotationY(yaw)
const variants=[...['closed','open','lying'].map(state=>({id:'bottle',state})),...ENDO_STATES.map(state=>({id:'endo',state})),{id:'pillow',state:'ready'}]
const bounds=(v,slot)=>v.id==='bottle'?bottlePoseBounds(bottle,sampleBottlePose(bottle,v.state,v.state,1)):v.id==='endo'?pairEndoBounds(endoIndex(v.state),slot).frame:pillow.full.clone().applyMatrix4(rotation)
const near=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`)
const corners=b=>[b.min.x,b.max.x].flatMap(x=>[b.min.y,b.max.y].flatMap(y=>[b.min.z,b.max.z].map(z=>new Vector3(x,y,z))))
const points=(v,box,position)=>v.id==='pillow'?pillow.fullSupport.map(p=>p.clone().applyMatrix4(rotation).add(position)):corners(box).map(p=>p.add(position))

test('actual source dimensions and Endo strap remain in metres before the single shared scene scale',()=>{
  const b=bounds(variants[0],0).getSize(new Vector3()),p=pillow.body.getSize(new Vector3())
  near(b.y*1000,210,.5);near(b.x*1000,70,.01);near(p.y*1000,109,1);near(p.x*1000,220,2)
  const endo=createEndoRig(roots[1]);applyEndoPose(endo,endoPose(3));near(endoActualStrapLength(endo)*1000,240,.01)
  near((b.y*PAIR_SCALE)/(p.y*PAIR_SCALE),b.y/p.y);assert.ok(b.y/p.y>1.9&&b.y/p.y<2)
})

test('all 64 ordered state pairs retain physical bounds, floor positions and a real 40 mm gap',()=>{
  for(const a of variants)for(const b of variants){const boxes=[bounds(a,0),bounds(b,1)],placed=placePair(boxes)
    near(placed.positions[0].y,0);near(placed.positions[1].y,0)
    near(boxes[1].min.x+placed.positions[1].x-boxes[0].max.x-placed.positions[0].x,PAIR_GAP)
    for(let i=0;i<2;i++){near(boxes[i].clone().translate(placed.positions[i]).getSize(new Vector3()).distanceTo(boxes[i].getSize(new Vector3())),0);assert.ok(boxes[i].min.y>=-.00001)}
  }
})

test('all pair cameras fit both actual subjects in desktop, phone and narrow phone viewports',()=>{
  for(const a of variants)for(const b of variants){const boxes=[bounds(a,0),bounds(b,1)],placed=placePair(boxes),support=[...points(a,boxes[0],placed.positions[0]),...points(b,boxes[1],placed.positions[1])]
    for(const view of PAIR_VIEWS)for(const [width,height]of [[831,462],[348,330],[278,300]]){
      const f=pairCameraFrame(placed.bounds,view,width,height,support),c=new PerspectiveCamera(f.fov,width/height,.025,100);c.position.copy(f.position);c.up.copy(bottleCameraUp(f));c.lookAt(f.target);c.updateMatrixWorld()
      assert.ok(c.position.y>.06)
      for(const point of support){const p=point.clone().multiplyScalar(PAIR_SCALE).project(c);assert.ok(Math.abs(p.x)<.95&&Math.abs(p.y)<.93&&p.z>-1&&p.z<1,`${a.id}/${a.state} + ${b.id}/${b.state}, ${view}, ${width}: ${p.toArray()}`)}
    }
  }
})

test('pre-positioning, all bottle motions and compaction cannot pass through the second product',()=>{
  for(const from of ['closed','open','lying'])for(const to of ['closed','open','lying'])if(from!==to)for(const other of variants)for(const slot of [0,1]){
    const moving={id:'bottle',state:from},start=slot?[bounds(other,0),bounds(moving,1)]:[bounds(moving,0),bounds(other,1)],initial=placePair(start),envelopes=start.map(b=>b.clone());envelopes[slot]=bottleMotionEnvelope(bottle,{id:1,from,to})
    const reserved=reservePair(initial.positions,envelopes),endBoxes=start.map(b=>b.clone());endBoxes[slot]=bounds({id:'bottle',state:to},slot);const final=placePair(endBoxes)
    for(let i=0;i<=96;i++){
      const t=i/96,live=start.map(b=>b.clone());live[slot]=bottlePoseBounds(bottle,sampleBottlePose(bottle,from,to,t))
      assert.ok(live[1].min.x+reserved[1].x-live[0].max.x-reserved[0].x>=PAIR_GAP-1e-6)
      for(const [boxes,a,b]of [[start,initial.positions,reserved],[endBoxes,reserved,final.positions]]){const p=a.map((v,j)=>v.clone().lerp(b[j],t));assert.ok(boxes[1].min.x+p[1].x-boxes[0].max.x-p[0].x>=PAIR_GAP-1e-6)}
    }
  }
})

test('Endo packaging exits outwards and all 192 unpacking pair cases keep their neighbour clear',()=>{
  for(const slot of [0,1]){const p=pairEndoBounds(1.7,slot);assert.ok(slot?p.box.getCenter(new Vector3()).x>0:p.box.getCenter(new Vector3()).x<0)}
  for(const from of ENDO_STATES)for(const to of ENDO_STATES)if(from!==to)for(const other of variants)for(const slot of [0,1]){
    const moving={id:'endo',state:from},start=slot?[bounds(other,0),bounds(moving,1)]:[bounds(moving,0),bounds(other,1)],initial=placePair(start),envelopes=start.map(b=>b.clone()),env=new Box3(),a=endoIndex(from),b=endoIndex(to)
    for(let i=0;i<=96;i++)env.union(pairEndoBounds(a+(b-a)*i/96,slot).collision)
    envelopes[slot]=env.expandByScalar(.003);const reserved=reservePair(initial.positions,envelopes)
    for(let i=0;i<=193;i++){const live=start.map(box=>box.clone());live[slot]=pairEndoBounds(a+(b-a)*i/193,slot).collision;assert.ok(live[1].min.x+reserved[1].x-live[0].max.x-reserved[0].x>=PAIR_GAP-1e-6,`${from} -> ${to}, slot ${slot}, next to ${other.id}/${other.state}`)}
  }
})

test('two copies own their paint and skeleton while retaining shared geometry and image maps',()=>{
  const root=new Group(),texture=new Texture(),material=new MeshStandardMaterial({color:'#e24930',map:texture}),geometry=new BoxGeometry();root.add(new Mesh(geometry,material))
  const source={root,productId:'bottle',dispose:()=>assert.fail('Do not dispose cached source')},first=studioInstance(source),second=studioInstance(source)
  const one=first.root.children[0],two=second.root.children[0]
  assert.notEqual(one.material,two.material);assert.notEqual(one.material,material);assert.equal(one.material.map,two.material.map);assert.equal(one.geometry,two.geometry)
  one.material.color.set('#176c54');assert.notEqual(one.material.color.getHexString(),two.material.color.getHexString());assert.equal(material.color.getHexString(),'e24930')
  let imageDisposed=false,geometryDisposed=false;texture.addEventListener('dispose',()=>{imageDisposed=true});geometry.addEventListener('dispose',()=>{geometryDisposed=true});first.dispose();first.dispose();assert.equal(imageDisposed,false);assert.equal(geometryDisposed,false);second.dispose()
  const canonical={root:roots[1],productId:'endo',dispose:()=>{}},a=studioInstance(canonical),b=studioInstance(canonical),rigA=createEndoRig(a.root),rigB=createEndoRig(b.root)
  assert.notEqual(rigA.strap.skeleton,rigB.strap.skeleton);assert.notEqual(rigA.bones[32],rigB.bones[32]);applyEndoPose(rigA,endoPose(2));applyEndoPose(rigB,endoPose(3));near(endoActualStrapLength(rigA),.24);near(endoActualStrapLength(rigB),.24);a.dispose();b.dispose()
})
