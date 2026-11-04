import { Box3, Euler, Group, Mesh, Quaternion, Vector3 } from 'three'
import type { Matrix4 } from 'three'
import type { BottleState } from './bottle'

export interface BottleMotionRequest { id:number; from:BottleState; to:BottleState; startedAt?:number }
export interface BottlePose {
  angle:number
  position:Vector3
  lidOffset:Vector3
  lidRotation:Euler
  phase:string
}
export interface BottleRig { root:Group; body:Group; lid:Group; bodyPoints:Vector3[]; lidPoints:Vector3[] }
type Key=readonly [number,number]
const Z=new Vector3(0,0,1),LID_PIVOT=new Vector3(0,.184,0)
export const BOTTLE_SCALE=12
export const BOTTLE_BASE_PIVOT=.0318
const DEG=Math.PI/180
const clamp=(t:number)=>Math.max(0,Math.min(1,t))

/** Shape-preserving cubic Hermite tracks: continuous speed, no spline overshoot. */
function track(keys:readonly Key[],time:number):number {
  const t=clamp(time)
  let i=1
  while(i<keys.length-1&&keys[i][0]<t)i++
  const slope=(a:number,b:number)=>(keys[b][1]-keys[a][1])/(keys[b][0]-keys[a][0])
  const tangent=(index:number)=>{
    if(index===0||index===keys.length-1)return 0
    const a=slope(index-1,index),b=slope(index,index+1)
    if(a*b<=0)return 0
    const before=keys[index][0]-keys[index-1][0],after=keys[index+1][0]-keys[index][0]
    const w1=2*after+before,w2=after+2*before
    return (w1+w2)/(w1/a+w2/b)
  }
  const [a,x]=keys[i-1],[b,y]=keys[i],h=b-a,u=(t-a)/h
  return (2*u**3-3*u**2+1)*x+(u**3-2*u**2+u)*h*tangent(i-1)+(-2*u**3+3*u**2)*y+(u**3-u**2)*h*tangent(i)
}

// Give the thread turn its own readable beat; keep the cap coaxial until free.
const LIFT:Key[]=[[0,0],[.10,.002],[.30,.012],[.42,.040],[.50,.056],[.61,.056],[.68,.030],[.88,-.157],[.94,-.161],[1,-.161]]
const CARRY:Key[]=[[0,0],[.42,0],[.67,.072],[1,.072]]
const DEPTH:Key[]=[[0,0],[.42,0],[.67,.012],[1,.012]]
const TURN:Key[]=[[0,0],[.10,-.35],[.30,-Math.PI*1.72],[.40,-Math.PI*2],[1,-Math.PI*2]]
const SWAY:Key[]=[[0,0],[.40,0],[.55,-4*DEG],[.75,-1.5*DEG],[.93,0],[1,0]]
// Accelerate towards contact, arrest the fall briefly, dissipate almost all rebound.
const TIP:Key[]=[[0,0],[.14,1.1*DEG],[.30,-6*DEG],[.44,-18*DEG],[.57,-39*DEG],[.69,-68*DEG],[.75,-86*DEG],[.78,-90*DEG],[.86,-89.4*DEG],[.94,-90.06*DEG],[1,-90*DEG]]
const STAND:Key[]=[[0,-90*DEG],[.11,-89.3*DEG],[.19,-90.2*DEG],[.36,-72*DEG],[.61,-24*DEG],[.83,.65*DEG],[.93,-.18*DEG],[1,0]]

function opening(t:number,reverse=false) {
  const p=clamp(t)
  return {angle:0,lidOffset:new Vector3(track(CARRY,p),track(LIFT,p),track(DEPTH,p)),lidRotation:new Euler(0,track(TURN,p),track(SWAY,p)),phase:reverse?(p>.68?'lift':p>.42?'align':'screw'):(p<.40?'unscrew':p<.50?'extract':p<.68?'carry':'land')}
}
function tipping(t:number,reverse=false) {
  return {angle:track(reverse?STAND:TIP,t),lidOffset:new Vector3(),lidRotation:new Euler(),phase:t>.78?'settle':reverse?'stand':'tip'}
}
function choreography(from:BottleState,to:BottleState,time:number) {
  const t=clamp(time)
  if(from===to)return to==='open'?opening(1):tipping(to==='lying'?1:0)
  if(from==='closed'&&to==='open')return opening(t)
  if(from==='open'&&to==='closed')return opening(1-t,true)
  if(from==='closed'&&to==='lying')return tipping(t)
  if(from==='lying'&&to==='closed')return tipping(t,true)
  if(from==='open'&&to==='lying')return t<.50?opening(1-t/.50,true):tipping((t-.50)/.50)
  return t<.44?tipping(t/.44,true):opening((t-.44)/.56)
}
export function bottleMotionDuration(from:BottleState,to:BottleState):number {
  if(from===to)return 0
  if(from==='open'&&to==='lying')return 1.64
  if(from==='lying'&&to==='open')return 1.68
  return to==='open'?1.28:from==='open'?1.18:1.12
}

/** Clone one assembly only. The three source poses and disk assets stay intact. */
export function createBottleRig(source:Group):BottleRig {
  const canonical=source.children.find(o=>o.userData.product_state==='closed')
  if(!canonical)throw new Error('Bottle requires a closed assembly')
  const body=canonical.clone(true) as Group
  body.visible=true
  delete body.userData.product_state
  body.name='AnimatedBottleAssembly'
  const originalLid=body.children.find(o=>o.name.startsWith('RemovableBambooLid'))
  if(!originalLid)throw new Error('Bottle requires a separate lid')
  body.updateWorldMatrix(true,true)
  const inverse=body.matrixWorld.clone().invert(),bodyPoints:Vector3[]=[],lidPoints:Vector3[]=[]
  body.traverse(object=>{
    if(!(object instanceof Mesh)||object.userData.print_surface)return
    let parent=object.parent,isLid=false
    while(parent&&parent!==body){if(parent===originalLid)isLid=true;parent=parent.parent}
    const matrix=inverse.clone().multiply(object.matrixWorld),p=object.geometry.getAttribute('position')
    for(let i=0;i<p.count;i++)(isLid?lidPoints:bodyPoints).push(new Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix))
  })
  const lid=new Group();lid.name='LidCentrePivot';lid.position.copy(LID_PIVOT)
  body.add(lid);lid.add(originalLid);originalLid.position.sub(LID_PIVOT)
  const root=new Group();root.name='ContinuousBottle';root.add(body)
  return {root,body,lid,bodyPoints,lidPoints}
}

/** Ground the real vertex support, including the cap during a tip. The cap has
 * its own support during landing, so a tilted cap never lifts the bottle. */
export function sampleBottlePose(rig:BottleRig,from:BottleState,to:BottleState,time:number):BottlePose {
  const curve=choreography(from,to,time),bodyRotation=new Quaternion().setFromAxisAngle(Z,curve.angle),capRotation=new Quaternion().setFromEuler(curve.lidRotation)
  const p=new Vector3()
  let bodyMin=Infinity,lidMin=Infinity
  for(const point of rig.bodyPoints)bodyMin=Math.min(bodyMin,p.copy(point).applyQuaternion(bodyRotation).y)
  for(const point of rig.lidPoints)lidMin=Math.min(lidMin,p.copy(point).sub(LID_PIVOT).applyQuaternion(capRotation).add(LID_PIVOT).add(curve.lidOffset).applyQuaternion(bodyRotation).y)
  let height=-bodyMin
  if(Math.abs(curve.angle)<1e-8)curve.lidOffset.y+=Math.max(0,-(lidMin+height))
  else height=Math.max(height,-lidMin)
  const x=-Math.sign(curve.angle)*BOTTLE_BASE_PIVOT*(1-Math.cos(curve.angle))
  return {...curve,position:new Vector3(x,height,0)}
}
export function applyBottlePose(rig:BottleRig,pose:BottlePose) {
  rig.body.position.copy(pose.position);rig.body.rotation.set(0,0,pose.angle)
  rig.lid.position.copy(LID_PIVOT).add(pose.lidOffset);rig.lid.rotation.copy(pose.lidRotation)
  rig.root.updateMatrixWorld(true)
}
export function bottlePoseBounds(rig:BottleRig,pose:BottlePose,part:'all'|'body'|'lid'='all',matrix?:Matrix4):Box3 {
  const bounds=new Box3(),p=new Vector3(),bodyRotation=new Quaternion().setFromAxisAngle(Z,pose.angle),capRotation=new Quaternion().setFromEuler(pose.lidRotation)
  if(part!=='lid')for(const point of rig.bodyPoints){p.copy(point).applyQuaternion(bodyRotation).add(pose.position);if(matrix)p.applyMatrix4(matrix);bounds.expandByPoint(p)}
  if(part!=='body')for(const point of rig.lidPoints){p.copy(point).sub(LID_PIVOT).applyQuaternion(capRotation).add(LID_PIVOT).add(pose.lidOffset).applyQuaternion(bodyRotation).add(pose.position);if(matrix)p.applyMatrix4(matrix);bounds.expandByPoint(p)}
  return bounds
}
export function bottleMotionEnvelope(rig:BottleRig,request:BottleMotionRequest):Box3 {
  const bounds=new Box3()
  for(let i=0;i<=64;i++)bounds.union(bottlePoseBounds(rig,sampleBottlePose(rig,request.from,request.to,i/64)))
  return bounds.expandByScalar(.003)
}
