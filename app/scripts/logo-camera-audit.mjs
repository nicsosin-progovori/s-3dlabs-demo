import {readFile,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {Box3,PerspectiveCamera,Raycaster,Vector3} from 'three'
import {readGlbGeometry,printMesh,uvPoint,physicalMeshes} from './read-glb-geometry.mjs'
import {bottleViews,bottleCamera} from '../src/bottleViews.ts'
import {applyBottlePose,BOTTLE_BASE_PIVOT,BOTTLE_SCALE,bottlePoseBounds,createBottleRig,sampleBottlePose} from '../src/bottleMotion.ts'
import {bottleCameraUp,bottleFrame} from '../src/bottleCameraMotion.ts'
import {applyEndoPose,createEndoRig,ENDO_SCALE,ENDO_STATES,endoIndex,endoPose} from '../src/endoMotion.ts'
import {ENDO_VIEWS,endoCameraFrame} from '../src/endoViews.ts'
import {createPillowSubject,PILLOW_SCALE,PILLOW_VIEWS,pillowCameraFrame} from '../src/pillowViews.ts'

export async function logoCameraAudit(snapshots){
  const result=[]
  const matches=(r,product,state,view,surface)=>r.product===product&&r.state===state&&r.view===view&&r.surface===surface
  const sizes=(product,state,view,surface)=>snapshots?[...new Map(snapshots.filter(r=>matches(r,product,state,view,surface)).map(r=>[r.viewport.join('/'),r.viewport])).values()]:[[848,452],[284,320]]
  function measure(product,state,view,surface,root,frame,scale,width,height,span){
    const observed=snapshots?.findLast(r=>matches(r,product,state,view,surface)&&r.viewport[0]===width&&r.viewport[1]===height)
    let cameraError=0
    if(observed){
      const p=new Vector3().fromArray(observed.camera.position),target=new Vector3().fromArray(observed.camera.target)
      cameraError=Math.max(p.distanceTo(frame.position),target.distanceTo(frame.target))
      frame={position:p,target,fov:observed.camera.fov,roll:observed.camera.roll}
    }
    const c=new PerspectiveCamera(frame.fov,width/height,.025,100);c.position.copy(frame.position);c.up.copy(bottleCameraUp(frame));c.lookAt(frame.target);c.updateMatrixWorld()
    const mesh=printMesh(root,surface),objects=physicalMeshes(root),origin=frame.position.clone().divideScalar(scale),samples=[]
    for(const u of [-.5,-.375,-.25,-.125,0,.125,.25,.375,.5])for(const v of [-.5,-.25,0,.25,.5]){
      const {point,normal}=uvPoint(mesh,.5+u*span[0],.5+v*span[1]),toward=origin.clone().sub(point),p=point.clone().multiplyScalar(scale).project(c)
      const ray=new Raycaster(origin,point.clone().sub(origin).normalize(),0,toward.length()-.00002),hits=ray.intersectObjects(objects,false)
      samples.push({u,v,point:point.toArray(),projected:p.toArray(),facing:normal.dot(toward.normalize()),occluder:hits[0]?.object.parent.name,visible:p.z>-1&&p.z<1&&Math.abs(p.x)<.98&&Math.abs(p.y)<.98&&!hits.length})
    }
    const at=(u,v)=>samples.find(s=>s.u===u&&s.v===v),centre=at(0,0),px=(a,b)=>Math.hypot((a.projected[0]-b.projected[0])*width/2,(a.projected[1]-b.projected[1])*height/2)
    result.push({product,state,view,surface,viewport:[width,height],cameraError,camera:{position:frame.position.toArray(),target:frame.target.toArray(),fov:frame.fov,roll:frame.roll},visible:samples.filter(s=>s.visible).length/samples.length,facing:centre.facing,widthPx:px(at(-.5,0),at(.5,0)),heightPx:px(at(0,-.5),at(0,.5)),samples})
  }
  const bottle=createBottleRig(await readGlbGeometry(new URL('../public/models/bottle/bottle.glb',import.meta.url)))
  for(const state of ['closed','open','lying']){
    const pose=sampleBottlePose(bottle,state,state,1);applyBottlePose(bottle,pose)
    for(const surface of ['body','lid'])for(const id of bottleViews(state,surface))for(const [w,h]of sizes('bottle',state,id,surface)){
      const view=bottleCamera(state,id,surface,1),offset=new Vector3(state==='lying'?BOTTLE_BASE_PIVOT:0,0,0)
      const box=view.focusMm?new Box3(new Vector3(...view.focusMm.min).multiplyScalar(.001).add(offset),new Vector3(...view.focusMm.max).multiplyScalar(.001).add(offset)):bottlePoseBounds(bottle,pose)
      measure('bottle',state,id,surface,bottle.root,bottleFrame(box,view.azimuth,view.elevation,w,h,view),BOTTLE_SCALE,w,h,surface==='body'?[.92*40/225,.92*40*220/640/142]:[.80,.80*220/640])
    }
  }
  const endo=createEndoRig(await readGlbGeometry(new URL('../public/models/endo/endo-rig-v02.glb',import.meta.url)))
  for(const state of ENDO_STATES){
    applyEndoPose(endo,endoPose(endoIndex(state)))
    for(const id of ENDO_VIEWS[state])for(const [w,h]of sizes('endo',state,id,'front'))measure('endo',state,id,'front',endo.root,endoCameraFrame(state,id,w,h),ENDO_SCALE,w,h,[.92*3*640/220/18,.92])
  }
  const pillow=await readGlbGeometry(new URL('../public/models/pillow/pillow-v02.glb',import.meta.url)),subject=createPillowSubject(pillow)
  for(const id of PILLOW_VIEWS)for(const [w,h]of sizes('pillow','ready',id,'side'))measure('pillow','ready',id,'side',pillow,pillowCameraFrame(subject,id,w,h),PILLOW_SCALE,w,h,[.86,.86*80*220/640/40])
  return result
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await logoCameraAudit(process.argv[3]?JSON.parse(await readFile(process.argv[3])):undefined)
  if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result.filter(r=>r.viewport[0]===848).map(({product,state,view,surface,visible,facing,widthPx,heightPx})=>({product,state,view,surface,visible:+visible.toFixed(2),facing:+facing.toFixed(2),px:[+widthPx.toFixed(1),+heightPx.toFixed(1)]})),null,2))
}
