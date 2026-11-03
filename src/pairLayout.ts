import { Box3, MathUtils, Vector3 } from 'three'
import { bottleFrame } from './bottleCameraMotion.ts'
import { endoPose } from './endoMotion.ts'

export const PAIR_SCALE=12
export const PAIR_GAP=.040
export const PAIR_VIEWS=['overview','front','top'] as const
export type PairView=typeof PAIR_VIEWS[number]

export function placePair(boxes:readonly Box3[]) {
  const total=boxes.reduce((n,b)=>n+b.max.x-b.min.x,0)+PAIR_GAP
  let cursor=-total/2
  const positions=boxes.map(box=>{
    const position=new Vector3(cursor-box.min.x,0,-box.getCenter(new Vector3()).z)
    cursor+=box.max.x-box.min.x+PAIR_GAP
    return position
  })
  return {positions,bounds:pairBounds(boxes,positions)}
}

export function pairBounds(boxes:readonly Box3[],positions:readonly Vector3[]) {
  const bounds=new Box3()
  boxes.forEach((box,i)=>bounds.union(box.clone().translate(positions[i])))
  return bounds
}

/** Only grow the separation before motion. A box exiting outwards cannot move its neighbour. */
export function reservePair(positions:readonly Vector3[],envelopes:readonly Box3[]) {
  const result=positions.map(p=>p.clone())
  const gap=envelopes[1].min.x+result[1].x-envelopes[0].max.x-result[0].x
  const grow=Math.max(0,PAIR_GAP-gap)
  result[0].x-=grow/2;result[1].x+=grow/2
  return result
}

/** The accepted unpacking path exits on the outside of its slot, away from the other product. */
export function pairEndoBounds(coordinate:number,slot:number) {
  const pose=endoPose(coordinate),box=pose.boxBounds.clone()
  if(slot===1)box.translate(new Vector3(-2*pose.boxPosition.x,0,0))
  const collision=pose.trackerBounds.clone()
  if(pose.boxVisible)collision.union(box)
  const leave=MathUtils.smootherstep(coordinate,1.32,1.93),frame=pose.trackerBounds.clone().union(box)
  if(coordinate>1){frame.min.lerp(pose.trackerBounds.min,leave);frame.max.lerp(pose.trackerBounds.max,leave)}
  return {pose,box,frame,collision}
}

export function pairCameraFrame(bounds:Box3,view:PairView,width:number,height:number,points?:readonly Vector3[]) {
  const preset=view==='front'?{azimuth:0,elevation:.16,fov:24,roll:0}:view==='top'?{azimuth:28,elevation:1.1,fov:30,roll:0}:{azimuth:22,elevation:.42,fov:28,roll:-4}
  const vertical=Math.max(.60,1-110/Math.max(1,height)),frame=bottleFrame(bounds,preset.azimuth,preset.elevation,width,height,{fov:preset.fov,roll:preset.roll,margin:1.08,subject:[0,-.035],safeArea:[.88,vertical]})
  if(points){
    const direction=frame.position.clone().sub(frame.target).normalize(),right=new Vector3(direction.z,0,-direction.x).normalize().applyAxisAngle(direction,preset.roll*Math.PI/180),up=new Vector3().crossVectors(direction,right).normalize(),tan=Math.tan(preset.fov*Math.PI/360),aspect=width/Math.max(1,height)
    const screenX=points.map(p=>p.dot(right)*PAIR_SCALE),screenY=points.map(p=>p.dot(up)*PAIR_SCALE)
    frame.target.addScaledVector(right,(Math.min(...screenX)+Math.max(...screenX))/2-frame.target.dot(right))
    frame.target.addScaledVector(up,(Math.min(...screenY)+Math.max(...screenY))/2-frame.target.dot(up))
    let distance=.6
    for(const point of points){const p=point.clone().multiplyScalar(PAIR_SCALE).sub(frame.target);distance=Math.max(distance,p.dot(direction)+Math.max(Math.abs(p.dot(right))/(tan*aspect*.88),Math.abs(p.dot(up))/(tan*vertical)))}
    frame.position.copy(frame.target).addScaledVector(direction,distance*1.08)
  }
  return frame
}
