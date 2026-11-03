import { Box3, Group, Mesh, Vector3 } from 'three'
import { bottleFitDistance, bottleFrame, interpolateBottleFrame } from './bottleCameraMotion.ts'
import type { BottleFrame } from './bottleCameraMotion.ts'
import { studioCameraDuration, studioCameraFrame, studioCameraMove } from './studioCameraMotion.ts'
import type { StudioCameraMove } from './studioCameraMotion.ts'

export const PILLOW_SCALE=12.5
export const PILLOW_VIEWS=['overview','top','profile','branding','buckle','fabric'] as const
// Technical targets remain available for geometry QA, outside the customer set.
export type PillowView=typeof PILLOW_VIEWS[number]|'controls'|'rollers'
export interface PillowViewRequest {id:PillowView;serial:number}
export interface PillowSubject {full:Box3;body:Box3;branding:Box3;controls:Box3;buckle:Box3;fabric:Box3;rollers:Box3;fullSupport:Vector3[];bodySupport:Vector3[]}

export function createPillowSubject(root:Group):PillowSubject {
  root.updateWorldMatrix(true,true)
  const inverse=root.matrixWorld.clone().invert()
  const points=(part?:string)=>{
    const all:Vector3[]=[]
    const add=(o:Group|Mesh)=>o.traverse(child=>{
      if(!(child instanceof Mesh)||child.userData.print_surface)return
      const matrix=inverse.clone().multiply(child.matrixWorld),a=child.geometry.attributes.position
      for(let i=0;i<a.count;i++)all.push(new Vector3().fromBufferAttribute(a,i).applyMatrix4(matrix))
    })
    if(part)root.traverse(o=>{if(o.userData.pillow_part===part)add(o as Group)})
    else add(root)
    const support=new Set<Vector3>()
    for(let i=0;i<102;i++){
      const y=i<6?0:1-2*(i-6+.5)/96,r=Math.sqrt(1-y*y),angle=i*2.399963229728653
      const d=i<6?new Vector3(...([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]][i] as [number,number,number])):new Vector3(r*Math.cos(angle),y,r*Math.sin(angle))
      let best=all[0],score=-Infinity
      for(const p of all){const next=p.dot(d);if(next>score){score=next;best=p}}
      support.add(best)
    }
    return [...support]
  }
  const bounds=(part?:string)=>{
    const box=new Box3()
    const add=(o:Group|Mesh)=>o.traverse(child=>{
      if(!(child instanceof Mesh)||(!part&&child.userData.print_surface))return
      child.geometry.computeBoundingBox()
      if(child.geometry.boundingBox)box.union(child.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(child.matrixWorld)))
    })
    if(part)root.traverse(o=>{if(o.userData.pillow_part===part)add(o as Group)})
    else add(root)
    if(box.isEmpty())throw Error('Missing pillow geometry: '+part)
    return box
  }
  const markers:Partial<Record<'fabric'|'rollers',Box3>>={}
  root.traverse(o=>{if(o.userData.pillow_focus==='fabric'||o.userData.pillow_focus==='rollers'){
    const centre=o.getWorldPosition(new Vector3()).applyMatrix4(inverse),half=new Vector3(...o.userData.half_m as [number,number,number])
    markers[o.userData.pillow_focus as 'fabric'|'rollers']=new Box3(centre.clone().sub(half),centre.clone().add(half))
  }})
  if(!markers.fabric||!markers.rollers)throw Error('Missing pillow focus marker')
  return {full:bounds(),body:bounds('body'),branding:bounds('decoration'),controls:bounds('controls').expandByScalar(.003),buckle:bounds('buckle').expandByScalar(.004),fabric:markers.fabric,rollers:markers.rollers,fullSupport:points(),bodySupport:points('body')}
}

export function pillowFocus(subject:PillowSubject,view:PillowView) {
  if(view==='buckle'){
    // One foreground fastener plus the print, rather than the nearly full
    // footprint of both fasteners that duplicated Hero on a narrow screen.
    const right=subject.buckle.clone();right.min.x=right.getCenter(new Vector3()).x
    return right.union(subject.branding).expandByScalar(.002)
  }
  if(view==='fabric')return subject.fabric.clone().union(subject.branding).expandByScalar(.002)
  return (view==='overview'?subject.full:view==='top'||view==='profile'?subject.body:subject[view]).clone()
}
export function pillowFocusPoints(subject:PillowSubject,view:PillowView){
  if(view==='overview')return subject.fullSupport
  if(view==='top'||view==='profile')return subject.bodySupport
  const box=pillowFocus(subject,view),points:Vector3[]=[]
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new Vector3(x,y,z))
  return points
}
const parameters={
  overview:{azimuth:52,elevation:.50,fov:28,roll:-7},
  top:{azimuth:80,elevation:1.1,fov:28,roll:24},
  profile:{azimuth:122,elevation:.25,fov:28,roll:-3},
  branding:{azimuth:88,elevation:.20,fov:27,roll:-6},
  controls:{azimuth:-80,elevation:.22,fov:27,roll:5},
  buckle:{azimuth:48,elevation:.38,fov:28,roll:-12},
  fabric:{azimuth:108,elevation:1.1,fov:27,roll:-8},
  rollers:{azimuth:0,elevation:1.1,fov:28,roll:-4},
}
export function pillowCameraFrame(subject:PillowSubject,view:PillowView,width:number,height:number) {
  const p=parameters[view]
  const frame=bottleFrame(pillowFocus(subject,view),p.azimuth,p.elevation,width,height,{...p,margin:view==='branding'?1.09:1.08,subject:view==='overview'?[.025,-.01]:[0,0]})
  if(view==='overview'||view==='top'||view==='profile'){
    // Loose straps occupy the floor, while the tall cushion is narrower.
    // Fit the actual silhouette rather than the empty top corners of its AABB.
    const direction=frame.position.clone().sub(frame.target).normalize(),right=new Vector3(direction.z,0,-direction.x).normalize().applyAxisAngle(direction,p.roll*Math.PI/180),up=new Vector3().crossVectors(direction,right).normalize()
    const tan=Math.tan(p.fov*Math.PI/360),aspect=width/Math.max(1,height),vertical=Math.max(.48,1-70/Math.max(1,height))
    let distance=.6
    for(const v of view==='overview'?subject.fullSupport:subject.bodySupport){
      const at=v.clone().multiplyScalar(PILLOW_SCALE).sub(frame.target)
      distance=Math.max(distance,at.dot(direction)+Math.max(Math.abs(at.dot(right))/(tan*aspect*.84),Math.abs(at.dot(up))/(tan*vertical)))
    }
    frame.position.copy(frame.target).addScaledVector(direction,distance*1.065)
  }
  return frame
}
export const pillowCameraDuration=studioCameraDuration

export interface PillowCameraPlan {wideStart:BottleFrame;wideEnd:BottleFrame;move:StudioCameraMove}
export function pillowCameraPlan(start:BottleFrame,end:BottleFrame,subject:PillowSubject,width:number,height:number,previous?:PillowCameraPlan,elapsed?:number):PillowCameraPlan{
  const centre=subject.full.getCenter(new Vector3()).multiplyScalar(PILLOW_SCALE)
  const wide=(frame:BottleFrame):BottleFrame=>{
    const d=frame.position.clone().sub(frame.target).normalize();d.y=Math.max(.15,d.y);d.normalize()
    return {position:centre.clone().add(d),target:centre.clone(),fov:28,roll:frame.roll}
  }
  const wideStart=wide(start),wideEnd=wide(end),full=subject.full.clone();full.min.multiplyScalar(PILLOW_SCALE);full.max.multiplyScalar(PILLOW_SCALE)
  let radius=.6
  for(let i=0;i<=20;i++){
    const f=interpolateBottleFrame(wideStart,wideEnd,i/20),d=f.position.clone().sub(f.target).normalize()
    radius=Math.max(radius,bottleFitDistance(full,centre,d,width,height,{fov:28,roll:f.roll,margin:1.04,safeArea:[.88,Math.max(.48,1-70/Math.max(1,height))]}))
  }
  for(const f of [wideStart,wideEnd])f.position.sub(centre).setLength(radius).add(centre)
  const midpoint=interpolateBottleFrame(wideStart,wideEnd,.5)
  const move=studioCameraMove(start,end,{midpoint,previous:previous?.move,elapsed})
  return {wideStart,wideEnd,move}
}

/** One continuous reveal, with no stops between the pullback, orbit and detail. */
export function pillowCameraTransition(start:BottleFrame,end:BottleFrame,subject:PillowSubject,t:number,width:number,height:number,plan=pillowCameraPlan(start,end,subject,width,height)):BottleFrame {
  return studioCameraFrame(plan.move,t)
}
