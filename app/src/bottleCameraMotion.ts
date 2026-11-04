import { Box3, MathUtils, Spherical, Vector3 } from 'three'
import { BOTTLE_SCALE } from './bottleMotion.ts'
import { compositionFrame,compositionFitDistance } from './compositionCamera.ts'
import type { FrameOptions } from './compositionCamera.ts'

export interface BottleFrame { position:Vector3; target:Vector3; fov?:number; roll?:number }
const smooth=(t:number)=>MathUtils.smootherstep(Math.max(0,Math.min(1,t)),0,1)
export function bottleFitDistance(box:Box3,target:Vector3,direction:Vector3,width:number,height:number,options:FrameOptions={}):number {
  return compositionFitDistance(box,target,direction,width,height,{...options,subject:[0,0]})
}
export function bottleFrame(boxMetres:Box3,azimuth:number,elevation:number,width:number,height:number,options:FrameOptions={}):BottleFrame {
  const box=boxMetres.clone();box.min.multiplyScalar(BOTTLE_SCALE);box.max.multiplyScalar(BOTTLE_SCALE)
  return compositionFrame(box,azimuth,elevation,width,height,options)
}
export function bottleCameraUp(frame:BottleFrame):Vector3 {
  return new Vector3(0,1,0).applyAxisAngle(frame.position.clone().sub(frame.target).normalize(),(frame.roll??0)*Math.PI/180)
}
export function bottleCameraRoll(position:Vector3,target:Vector3,up:Vector3):number {
  const direction=position.clone().sub(target).normalize(),base=new Vector3(0,1,0).projectOnPlane(direction).normalize(),actual=up.clone().projectOnPlane(direction).normalize()
  return Math.atan2(direction.dot(base.clone().cross(actual)),base.dot(actual))*180/Math.PI
}
/** Keep a low advertising angle and manual orbit above the floor at every zoom. */
export function bottleOrbitLimits(frame:BottleFrame) {
  const direction=frame.position.clone().sub(frame.target).normalize(),radius=frame.position.distanceTo(frame.target),floor=.06
  const maxDistance=direction.y<0?Math.min(Math.max(12,radius*3),Math.max(radius,(frame.target.y-floor)/-direction.y)):Math.max(12,radius*3)
  const maxPolarAngle=Math.acos(MathUtils.clamp((floor-frame.target.y)/maxDistance,-1,1))
  return {maxDistance,maxPolarAngle}
}
function blend(a:BottleFrame,b:BottleFrame,amount:number):BottleFrame {
  const from=new Spherical().setFromVector3(a.position.clone().sub(a.target)),to=new Spherical().setFromVector3(b.position.clone().sub(b.target))
  to.theta=from.theta+MathUtils.euclideanModulo(to.theta-from.theta+Math.PI,Math.PI*2)-Math.PI
  const target=a.target.clone().lerp(b.target,amount)
  const position=new Vector3().setFromSphericalCoords(MathUtils.lerp(from.radius,to.radius,amount),MathUtils.lerp(from.phi,to.phi,amount),MathUtils.lerp(from.theta,to.theta,amount)).add(target)
  return {target,position,fov:MathUtils.lerp(a.fov??35,b.fov??35,amount),roll:MathUtils.lerp(a.roll??0,b.roll??0,amount)}
}
export function bottleCameraTransition(start:BottleFrame,wide:BottleFrame,end:BottleFrame,time:number,currentBounds:Box3,width:number,height:number):BottleFrame {
  const t=Math.max(0,Math.min(1,time))
  const frame=t<.30?blend(start,wide,smooth(t/.30)):blend(wide,end,smooth((t-.48)/.52))
  frame.fov=MathUtils.lerp(start.fov??35,end.fov??35,smooth(t))
  frame.roll=MathUtils.lerp(start.roll??0,end.roll??0,smooth(t))
  // Spread the orbit across the whole action, even when leaving a rear view.
  // The early pullback must not become a fast camera whip around the product.
  const a=new Spherical().setFromVector3(start.position.clone().sub(start.target)),b=new Spherical().setFromVector3(end.position.clone().sub(end.target)),middle=new Spherical().setFromVector3(wide.position.clone().sub(wide.target))
  const short=(from:number,to:number)=>from+MathUtils.euclideanModulo(to-from+Math.PI,Math.PI*2)-Math.PI
  const theta=MathUtils.lerp(a.theta,short(a.theta,b.theta),smooth(t)),phi=MathUtils.lerp(a.phi,b.phi,smooth(t)),arc=Math.sin(Math.PI*t)**2*.18
  const orbitDirection=new Vector3().setFromSphericalCoords(1,MathUtils.lerp(phi,middle.phi,arc),MathUtils.lerp(theta,short(theta,middle.theta),arc))
  const plannedDistance=frame.position.distanceTo(frame.target)
  frame.position.copy(frame.target).addScaledVector(orbitDirection,plannedDistance)
  // Leave a detail view smoothly, then keep the entire moving assembly framed.
  const direction=frame.position.clone().sub(frame.target).normalize(),distance=frame.position.distanceTo(frame.target)
  const box=currentBounds.clone();box.min.multiplyScalar(BOTTLE_SCALE);box.max.multiplyScalar(BOTTLE_SCALE)
  // During flight reserve breathing room, then release it smoothly for the
  // tighter final advertisement. Keep a real 2% clipping guard at the endpoint.
  const settle=smooth((t-.72)/.28),safeArea:[number,number]=[MathUtils.lerp(.84,.98,settle),MathUtils.lerp(Math.max(.48,1-70/Math.max(1,height)),.98,settle)]
  const needed=bottleFitDistance(box,frame.target,direction,width,height,{fov:frame.fov,roll:frame.roll,margin:1,safeArea})
  frame.position.copy(frame.target).addScaledVector(direction,distance+Math.max(0,needed-distance)*smooth(t/.24))
  return frame
}
export const interpolateBottleFrame=(a:BottleFrame,b:BottleFrame,time:number)=>blend(a,b,smooth(time))
