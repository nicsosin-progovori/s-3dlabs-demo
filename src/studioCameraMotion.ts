import { MathUtils, Spherical, Vector3 } from 'three'
import type { BottleFrame } from './bottleCameraMotion.ts'

// Target, logarithmic distance, azimuth, polar angle, lens and photographic roll.
// Log distance gives a steady change of apparent size instead of a last-second rush.
type Coordinates=number[]
export interface StudioCameraMove {
  start:BottleFrame;end:BottleFrame;duration:number;coefficients:number[][];bump:Coordinates
}
const clone=(f:BottleFrame):BottleFrame=>({...f,position:f.position.clone(),target:f.target.clone()})
export const studioReducedMotion=()=>typeof window!=='undefined'&&(window.matchMedia('(prefers-reduced-motion: reduce)').matches||(import.meta.env?.DEV&&new URLSearchParams(location.search).get('motionQa')==='reduced'))
const nearest=(value:number,reference:number,period:number)=>reference+MathUtils.euclideanModulo(value-reference+period/2,period)-period/2
function coordinates(f:BottleFrame,reference?:Coordinates):Coordinates {
  const s=new Spherical().setFromVector3(f.position.clone().sub(f.target))
  return [...f.target.toArray(),Math.log(Math.max(.001,s.radius)),reference?nearest(s.theta,reference[4],2*Math.PI):s.theta,s.phi,f.fov??28,reference?nearest(f.roll??0,reference[7],360):f.roll??0]
}
function frame(v:Coordinates):BottleFrame {
  const target=new Vector3(v[0],v[1],v[2])
  return {target,position:new Vector3().setFromSphericalCoords(Math.exp(v[3]),v[5],v[4]).add(target),fov:v[6],roll:v[7]}
}
function sample(move:StudioCameraMove,time:number,order=0):Coordinates {
  const t=MathUtils.clamp(time,0,1),T=move.duration
  const polynomial=(c:number[])=>c.reduce((sum,v,k)=>k<order?sum:sum+v*(order===0?1:order===1?k:k*(k-1))*t**(k-order),0)
  const bump=polynomial([0,0,0,64,-192,192,-64])
  return move.coefficients.map((c,i)=>(polynomial(c)+move.bump[i]*bump)/(order===0?1:T**order))
}
export function studioCameraDuration(start:BottleFrame,end:BottleFrame):number {
  const a=start.position.clone().sub(start.target),b=end.position.clone().sub(end.target)
  const angle=a.angleTo(b),zoom=Math.abs(Math.log(a.length()/b.length())),shift=start.target.distanceTo(end.target)/Math.min(a.length(),b.length()),roll=Math.abs(nearest(end.roll??0,start.roll??0,360)-(start.roll??0))
  if(angle<1e-5&&zoom<1e-5&&shift<1e-5&&roll<1e-4&&Math.abs((start.fov??28)-(end.fov??28))<1e-4)return 0
  return .66+.30*Math.min(1,angle/(Math.PI/2))+.22*Math.min(1,zoom/1.6)+.16*Math.min(1,roll/90)+.12*Math.min(1,shift)
}

/** One C2-continuous move, including when a new button interrupts a running move. */
export function studioCameraMove(start:BottleFrame,end:BottleFrame,options:{previous?:StudioCameraMove;elapsed?:number;midpoint?:BottleFrame;duration?:number}={}):StudioCameraMove {
  const previous=options.previous,t=previous&&previous.duration?MathUtils.clamp((options.elapsed??0)/previous.duration,0,1):1
  const a=coordinates(start,previous?sample(previous,t):undefined),b=coordinates(end,a)
  const velocity=previous&&t<1?sample(previous,t,1):a.map(()=>0),acceleration=previous&&t<1?sample(previous,t,2):a.map(()=>0)
  const duration=options.duration??Math.max(studioCameraDuration(start,end),previous&&t<1?.48:0)
  const coefficients=a.map((p,i)=>{
    const d=b[i]-p,v=velocity[i]*duration,h=acceleration[i]*duration*duration/2
    return [p,v,h,10*d-6*v-3*h,-15*d+8*v+3*h,6*d-3*v-h]
  })
  const move:StudioCameraMove={start:clone(start),end:clone(end),duration,coefficients,bump:a.map(()=>0)}
  if(options.midpoint){const middle=sample(move,.5),guide=coordinates(options.midpoint,middle);move.bump=guide.map((v,i)=>v-middle[i])}
  return move
}
export function studioCameraFrame(move:StudioCameraMove,time:number):BottleFrame {
  if(time<=0)return clone(move.start)
  if(time>=1||move.duration===0)return clone(move.end)
  return frame(sample(move,time))
}
