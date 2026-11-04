import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {Box3,Matrix4,Mesh,PerspectiveCamera,Vector3} from 'three'
import {DEFAULT_COMPOSITION,normaliseComposition,compositionKey} from '../shared/compositionContract.mjs'
import {validateCameraViews} from '../shared/cameraViewsContract.mjs'
import {compositionBounds,compositionFrame,compositionMatrices,transformMatrix} from '../src/compositionCamera.ts'
import {bottleCompositionBounds,bottleCompositionMetrics,bottleViewBounds} from '../src/bottleComposition.ts'
import {BOTTLE_SCALE,applyBottlePose,bottlePoseBounds,createBottleRig,sampleBottlePose} from '../src/bottleMotion.ts'
import {bottleCameraUp,bottleFrame} from '../src/bottleCameraMotion.ts'
import {bottleCamera} from '../src/bottleViews.ts'
import {cameraViewsFor} from '../src/bottleViewSettings.ts'
import {pairEndoBounds} from '../src/pairLayout.ts'
import {readGlbGeometry} from '../scripts/read-glb-geometry.mjs'

const rig=createBottleRig(await readGlbGeometry(new URL('../public/models/bottle/bottle-geometry-low-v01.glb',import.meta.url)))
const source=JSON.parse(await readFile(new URL('../config/camera-views/bottle.json',import.meta.url),'utf8'))
const group=()=>normaliseComposition({schemaVersion:1,id:'group',primary:'left',root:{position:[.04,.06,-.02],rotation:[0,15,0],scale:[1.1,1,1]},elements:[{id:'left',product:'bottle',transform:{position:[-.12,0,0],rotation:[0,23,0],scale:[1,.8,1.2]}},{id:'right',product:'bottle',transform:{position:[.1,.03,.02],rotation:[3,-17,0],scale:[.8,1.1,1]}}]})
const near=(a,b,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`)

test('composition contract is immutable, bounded and only accepts prepared render adapters',()=>{
  const definition=group();assert.equal(definition.elements.length,2);assert.ok(Object.isFrozen(definition.elements[0].transform.position))
  assert.equal(compositionKey(definition),compositionKey(structuredClone(definition)))
  for(const change of [c=>c.elements=[],c=>c.primary='missing',c=>c.elements[0].visible=false,c=>c.elements[1].id='left',c=>c.elements[0].product='endo',c=>c.elements[0].url='https://untrusted.invalid',c=>c.root.scale=[0,1,1],c=>c.root.position=[NaN,0,0],c=>c.root.rotation=[0,Infinity,0],c=>c.elements=Array.from({length:9},(_,i)=>({...c.elements[0],id:'copy-'+i})),c=>c.id='__proto__']){
    const value=structuredClone(definition);change(value);assert.throws(()=>normaliseComposition(value))
  }
})
test('the common center is the union of visible bounds, not an average of object origins',()=>{
  const box=compositionBounds([{id:'small',bounds:new Box3(new Vector3(-1,0,-1),new Vector3(1,2,1))},{id:'large',bounds:new Box3(new Vector3(4,0,-2),new Vector3(10,4,2))},{id:'hidden',visible:false,bounds:new Box3(new Vector3(-100,-100,-100),new Vector3(100,100,100))}])
  assert.deepEqual(box.getCenter(new Vector3()).toArray(),[4.5,2,0])
  assert.deepEqual(box.getSize(new Vector3()).toArray(),[11,4,4])
  assert.throws(()=>compositionBounds([]))
})
test('world matrices combine the root with each member including rotations and nonuniform scale',()=>{
  const definition=group(),matrices=compositionMatrices(definition)
  assert.equal(matrices.length,2)
  for(const {element,matrix}of matrices){
    const point=new Vector3(.2,.3,.4),expected=point.clone().applyMatrix4(transformMatrix(element.transform)).applyMatrix4(transformMatrix(definition.root))
    near(point.applyMatrix4(matrix).distanceTo(expected),0)
  }
})
test('the default one-element composition includes both bottle and detached cap and preserves the accepted views',()=>{
  const catalog=validateCameraViews(source)
  for(const state of ['closed','open','lying']){
    const pose=sampleBottlePose(rig,state,state,1),original=bottlePoseBounds(rig,pose),actual=bottleCompositionBounds(rig,pose)
    assert.deepEqual(actual,original)
    const views=cameraViewsFor(catalog,rig,state,{width:980,height:562})
    for(const view of views){
      const legacy=bottleCamera(state,view.id,'body',0)
      const box=legacy.focusMm?new Box3(new Vector3(...legacy.focusMm.min).multiplyScalar(.001).add(new Vector3(state==='lying'?.0318:0,0,0)),new Vector3(...legacy.focusMm.max).multiplyScalar(.001).add(new Vector3(state==='lying'?.0318:0,0,0))):original
      const expected=bottleFrame(box,legacy.azimuth,legacy.elevation,980,562,legacy)
      near(new Vector3(...view.camera.position).distanceTo(expected.position),0)
      near(new Vector3(...view.camera.target).distanceTo(expected.target),0)
    }
  }
  const closed=bottleCompositionMetrics(rig,'closed',DEFAULT_COMPOSITION),open=bottleCompositionMetrics(rig,'open',DEFAULT_COMPOSITION)
  assert.ok(open.size[0]>closed.size[0]);assert.ok(open.center[0]>closed.center[0])
})
test('transformed composition bounds agree with every actual visible low vertex in all poses',()=>{
  const definition=group()
  for(const state of ['closed','open','lying']){
    const pose=sampleBottlePose(rig,state,state,1);applyBottlePose(rig,pose);rig.root.updateWorldMatrix(true,true)
    const expected=new Box3()
    for(const {matrix}of compositionMatrices(definition))rig.root.traverse(object=>{
      if(!(object instanceof Mesh)||object.userData.print_surface)return
      const positions=object.geometry.getAttribute('position')
      for(let i=0;i<positions.count;i++)expected.expandByPoint(new Vector3().fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld).applyMatrix4(matrix))
    })
    const actual=bottleCompositionBounds(rig,pose,definition)
    near(actual.min.distanceTo(expected.min),0);near(actual.max.distanceTo(expected.max),0)
  }
})
test('frame fitting is independent of product type and fits a bottle plus tracker on mobile and desktop',()=>{
  const pose=sampleBottlePose(rig,'open','open',1),bottle=bottlePoseBounds(rig,pose),tracker=pairEndoBounds(2,1).frame
  const box=compositionBounds([{id:'bottle',bounds:bottle,matrix:new Matrix4().makeTranslation(-.15,0,0)},{id:'tracker',bounds:tracker,matrix:new Matrix4().makeTranslation(.13,0,.03)}])
  box.min.multiplyScalar(BOTTLE_SCALE);box.max.multiplyScalar(BOTTLE_SCALE)
  for(const [width,height]of [[320,740],[390,844],[768,1000],[1440,900]])for(const [azimuth,elevation,roll,zoom]of [[0,.2,0,1],[-42,.4,-15,1],[25,1.1,23,1.4]]){
    const frame=compositionFrame(box,azimuth,elevation,width,height,{fov:28,roll,margin:1.12,subject:[0,0],zoom})
    near(frame.target.distanceTo(box.getCenter(new Vector3())),0)
    const camera=new PerspectiveCamera(frame.fov,width/height,.025,100);camera.position.copy(frame.position);camera.up.copy(bottleCameraUp(frame));camera.lookAt(frame.target);camera.zoom=zoom;camera.updateProjectionMatrix();camera.updateMatrixWorld()
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const projected=new Vector3(x,y,z).project(camera);assert.ok(Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&Math.abs(projected.z)<1)
    }
  }
})
test('local detail framing follows the primary element transform while general views include the group',()=>{
  const definition=group(),detail=bottleViewBounds(rig,'open',{frameTarget:'primary',focusMm:{min:[-35,30,-38],max:[35,126,38]}},definition)
  const all=bottleViewBounds(rig,'open',{frameTarget:'composition'},definition)
  assert.ok(all.getSize(new Vector3()).x>detail.getSize(new Vector3()).x)
  const moved=structuredClone(definition);moved.root.position[0]+=.2
  const shifted=bottleViewBounds(rig,'open',{frameTarget:'primary',focusMm:{min:[-35,30,-38],max:[35,126,38]}},normaliseComposition(moved))
  near(shifted.getCenter(new Vector3()).x-detail.getCenter(new Vector3()).x,.2)
})
test('camera catalogue v2 delivers explicit composition/primary targets and v1 remains readable',()=>{
  const current=structuredClone(source);current.schemaVersion=2;delete current.lidStates
  for(const state of Object.values(current.states))for(const view of state.views)view.camera.frameTarget=view.camera.focusMm?'primary':'composition'
  const catalog=validateCameraViews(current);assert.equal(catalog.states.closed.views[0].camera.frameTarget,'composition')
  const legacy=structuredClone(current);legacy.schemaVersion=1
  for(const state of Object.values(legacy.states))for(const view of state.views)delete view.camera.frameTarget
  assert.equal(validateCameraViews(legacy).schemaVersion,1)
  const invalid=structuredClone(current);invalid.states.closed.views[0].camera.frameTarget='scene';assert.throws(()=>validateCameraViews(invalid))
  invalid.states.closed.views[0].camera.frameTarget='composition';invalid.states.closed.views[0].camera.focusMm={min:[0,0,0],max:[1,1,1]};assert.throws(()=>validateCameraViews(invalid))
})
