import { Bone, Box3, Group, MathUtils, Matrix4, Mesh, Object3D, Quaternion, SkinnedMesh, Texture, Vector3 } from 'three'

export const ENDO_STATES=['box-closed','box-open','flat','wrist'] as const
export type EndoState=typeof ENDO_STATES[number]
export const ENDO_SCALE=12.5
export const ENDO_STRAP_LENGTH=.240
export const ENDO_SEGMENTS=128
export const ENDO_CENTRE=72
export const ENDO_STEP=ENDO_STRAP_LENGTH/ENDO_SEGMENTS
const AXIS=new Vector3(1,0,0)
const flatRotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2)
const wristRotation=new Quaternion().setFromAxisAngle(AXIS,Math.PI/2)
const smooth=(v:number)=>MathUtils.smootherstep(MathUtils.clamp(v,0,1),0,1)
const ramp=(v:number,a:number,b:number)=>smooth((v-a)/(b-a))

export interface EndoPose {
  coordinate:number;points:Vector3[];angles:number[];rotation:Quaternion;position:Vector3
  boxPosition:Vector3;lidAngle:number;boxVisible:boolean;phase:'open'|'extract'|'wrap'|'rest'
  trackerBounds:Box3;boxBounds:Box3;frameBounds:Box3;packed:number;wrapped:number
}

function angleAt(s:number,packed:number,wrapped:number) {
  const sign=s<0?-1:1,a=Math.max(0,Math.abs(s)-.021)
  const flat=a<.017?.65*Math.sin(Math.PI*a/.017):0
  const folded=Math.min(Math.PI,Math.max(0,(Math.abs(s)-.057)/.0049))
  // The short buckle end is the outer layer; the long hook-and-loop tail
  // threads beneath it instead of covering the adjustment hardware.
  const r=.0188+(s<0?-.00055:.00055),cap=Math.PI*r
  const loop=a<cap?a/r:a<cap+.042?Math.PI:Math.PI+(a-cap-.042)/r
  return sign*MathUtils.lerp(MathUtils.lerp(flat,folded,packed),loop,wrapped)
}

/** Integrate unit-length segments. Curvature changes, material length does not. */
export function endoSpine(packed:number,wrapped:number) {
  const points=Array.from({length:129},()=>new Vector3()),angles:number[]=[]
  points[ENDO_CENTRE].set(0,.00265,0)
  for(let i=0;i<129;i++)angles.push(angleAt((i-ENDO_CENTRE)*ENDO_STEP,packed,wrapped))
  for(const direction of [-1,1])for(let k=1;;k++){
    const i=ENDO_CENTRE+direction*k,prior=i-direction
    if(i<0||i>128)break
    const phi=angleAt(((i+prior)/2-ENDO_CENTRE)*ENDO_STEP,packed,wrapped)
    points[i].copy(points[prior]).add(new Vector3(0,-Math.sin(phi),Math.cos(phi)).multiplyScalar(direction*ENDO_STEP))
  }
  return {points,angles}
}

export function endoMaterialPoint(points:Vector3[],angles:number[],s:number) {
  const at=MathUtils.clamp(s/ENDO_STEP+ENDO_CENTRE,0,128),i=Math.min(127,Math.floor(at)),t=at-i
  return {point:points[i].clone().lerp(points[i+1],t),angle:MathUtils.lerp(angles[i],angles[i+1],t)}
}

function expandPart(box:Box3,centre:Vector3,half:Vector3,rotation:Quaternion) {
  for(const x of [-half.x,half.x])for(const y of [-half.y,half.y])for(const z of [-half.z,half.z])box.expandByPoint(new Vector3(x,y,z).applyQuaternion(rotation).add(centre))
}

export function endoTrackerBounds(points:Vector3[],angles:number[],rotation:Quaternion,position=new Vector3()) {
  const box=new Box3(),width=new Vector3(.01055,0,0).applyQuaternion(rotation)
  for(let i=0;i<points.length;i++){
    const centre=points[i].clone().applyQuaternion(rotation).add(position)
    const normal=new Vector3(0,Math.cos(angles[i]),Math.sin(angles[i])).multiplyScalar(.00065).applyQuaternion(rotation)
    for(const a of [-1,1])for(const b of [-1,1])box.expandByPoint(centre.clone().addScaledVector(width,a).addScaledVector(normal,b))
  }
  expandPart(box,new Vector3(0,-.0003,0).applyQuaternion(rotation).add(position),new Vector3(.01355,.0046,.02105),rotation)
  const buckle=endoMaterialPoint(points,angles,.100),q=rotation.clone().multiply(new Quaternion().setFromAxisAngle(AXIS,buckle.angle))
  expandPart(box,buckle.point.applyQuaternion(rotation).add(position),new Vector3(.0131,.0013,.0051),q)
  return box
}

function packagingBounds(position:Vector3,lidAngle:number) {
  const box=new Box3(new Vector3(-.0715,0,-.042),new Vector3(.0715,.0173,.042)).translate(position)
  const q=new Quaternion().setFromAxisAngle(AXIS,-lidAngle),hinge=new Vector3(0,.0155,-.042).add(position)
  for(const x of [-.0715,.0715])for(const y of [0,.0018])for(const z of [0,.084])box.expandByPoint(new Vector3(x,y,z).applyQuaternion(q).add(hinge))
  return box
}

/** All four catalogue states are points on a single, reversible physical path. */
export function endoPose(coordinate:number):EndoPose {
  const q=MathUtils.clamp(coordinate,0,3),unpack=MathUtils.clamp(q-1,0,1),wrap=MathUtils.clamp(q-2,0,1)
  const packed=1-ramp(unpack,.18,.76),wrapped=ramp(wrap,.18,.86)
  const spine=endoSpine(packed,wrapped)
  const rotation=flatRotation.clone().slerp(wristRotation,ramp(wrap,.18,.86))
  const bare=endoTrackerBounds(spine.points,spine.angles,rotation)
  const flatY=-bare.min.y,hoverY=.014-bare.min.y
  let height:number,phase:EndoPose['phase']='rest'
  if(q<=1){height=Math.max(.0109,.0024-bare.min.y);phase='open'}
  else if(q<2){height=MathUtils.lerp(MathUtils.lerp(.0109,.120,ramp(unpack,0,.25)),flatY,ramp(unpack,.73,1));height=Math.max(height,-bare.min.y);phase='extract'}
  else {height=MathUtils.lerp(MathUtils.lerp(flatY,.145,ramp(wrap,0,.24)),hoverY,ramp(wrap,.73,1));height=Math.max(height,-bare.min.y);phase='wrap'}
  const position=new Vector3(0,height,0),trackerBounds=bare.clone().translate(position)
  const boxPosition=new Vector3(-.60,0,.05).multiplyScalar(ramp(unpack,.28,1))
  const lidAngle=Math.PI*.6*ramp(q,.02,1),boxBounds=packagingBounds(boxPosition,lidAngle)
  const full=trackerBounds.clone().union(boxBounds),leave=ramp(q,1.32,1.93)
  const frameBounds=q<=1?full:new Box3(full.min.clone().lerp(trackerBounds.min,leave),full.max.clone().lerp(trackerBounds.max,leave))
  return {coordinate:q,...spine,rotation,position,boxPosition,lidAngle,boxVisible:q<2,phase,trackerBounds,boxBounds,frameBounds,packed,wrapped}
}

export function endoIndex(state:EndoState){return ENDO_STATES.indexOf(state)}
const forward=[1.0,1.45,1.35],reverse=[.95,1.55,1.40]
export function endoEdgeDuration(from:number,to:number){return to>from?forward[from]:reverse[to]}
export function endoRouteDuration(from:EndoState,to:EndoState){let a=endoIndex(from),b=endoIndex(to),sum=0;while(a!==b){const next=a+Math.sign(b-a);sum+=endoEdgeDuration(a,next);a=next}return sum}

/** Retarget only at the next safe pose. Repeated clicks never reset geometry. */
export class EndoTimeline {
  coordinate:number;target:number;anchor:number;edgeFrom:number;edgeTo:number;edgeStart=0;edgeDuration=0
  active=false;epoch=0;id=0;started=0;frames=0;lead=.30
  constructor(state:EndoState){this.coordinate=this.target=this.anchor=this.edgeFrom=this.edgeTo=endoIndex(state)}
  request(state:EndoState,id:number,now:number,reduced=false){
    this.target=endoIndex(state);this.id=id
    if(reduced){if(this.coordinate!==this.target)this.epoch++;this.coordinate=this.anchor=this.edgeFrom=this.edgeTo=this.target;this.started=now;this.frames=0;this.active=false;return}
    if(this.active||this.anchor===this.target)return
    this.active=true;this.epoch++;this.started=now;this.frames=0
    this.edgeFrom=this.anchor;this.edgeTo=this.anchor+Math.sign(this.target-this.anchor)
    this.edgeDuration=endoEdgeDuration(this.edgeFrom,this.edgeTo);this.edgeStart=now+this.lead
  }
  sample(now:number){
    if(!this.active)return this.coordinate
    this.frames++
    while(now>=this.edgeStart+this.edgeDuration){
      this.coordinate=this.anchor=this.edgeTo
      if(this.anchor===this.target){this.active=false;return this.coordinate}
      this.edgeFrom=this.anchor;this.edgeTo=this.anchor+Math.sign(this.target-this.anchor)
      this.edgeStart+=this.edgeDuration;this.edgeDuration=endoEdgeDuration(this.edgeFrom,this.edgeTo)
    }
    this.coordinate=MathUtils.lerp(this.edgeFrom,this.edgeTo,smooth((now-this.edgeStart)/this.edgeDuration))
    return this.coordinate
  }
}

export interface EndoRig {
  root:Group;tracker:Object3D;box:Object3D;lid:Object3D;buckle:Object3D;strap:SkinnedMesh
  straps:SkinnedMesh[];bones:Bone[];restRotations:Quaternion[];pose:EndoPose
}

// updateWorldMatrix alone bypasses SkinnedMesh's bind-matrix override.
function updateRigWorld(root:Group){root.updateWorldMatrix(true,false);root.updateMatrixWorld(true)}

export function createEndoRig(root:Group):EndoRig {
  updateRigWorld(root)
  const part=(name:string)=>{let result:Object3D|undefined;root.traverse(o=>{if(o.userData.endo_part===name)result=o});if(!result)throw new Error('Missing Endo rig part: '+name);return result}
  const tracker=part('tracker'),straps:SkinnedMesh[]=[]
  part('strap').traverse(o=>{if(o instanceof SkinnedMesh)straps.push(o)})
  const strap=straps[0]
  if(!strap)throw new Error('Endo strap must contain a skinned mesh')
  const inverse=tracker.matrixWorld.clone().invert()
  const bones=strap.skeleton.bones.slice().sort((a,b)=>Number(a.userData.material_s)-Number(b.userData.material_s))
  if(bones.length!==129)throw new Error('Endo material coordinate contract requires 129 joints')
  const restRotations=bones.map(b=>new Quaternion().setFromRotationMatrix(inverse.clone().multiply(b.matrixWorld)))
  const rig={root,tracker,box:part('box'),lid:part('lid'),buckle:part('buckle'),strap,straps,bones,restRotations,pose:endoPose(3)}
  root.traverse(o=>{if(o instanceof Mesh){o.frustumCulled=false;for(const m of Array.isArray(o.material)?o.material:[o.material])for(const value of Object.values(m))if(value instanceof Texture)value.anisotropy=8}})
  return rig
}

const goalMatrix=new Matrix4(),parentMatrix=new Matrix4(),jointRotation=new Quaternion(),one=new Vector3(1,1,1)
export function applyEndoPose(rig:EndoRig,pose:EndoPose){
  rig.pose=pose;rig.tracker.position.copy(pose.position);rig.tracker.quaternion.copy(pose.rotation)
  rig.box.position.copy(pose.boxPosition);rig.box.visible=pose.boxVisible
  rig.lid.quaternion.setFromAxisAngle(AXIS,-pose.lidAngle)
  updateRigWorld(rig.root)
  parentMatrix.copy(rig.bones[0].parent!.matrixWorld).invert().multiply(rig.tracker.matrixWorld)
  for(let i=0;i<rig.bones.length;i++){
    const bone=rig.bones[i]
    jointRotation.setFromAxisAngle(AXIS,pose.angles[i]).multiply(rig.restRotations[i])
    goalMatrix.compose(pose.points[i],jointRotation,one).premultiply(parentMatrix)
    goalMatrix.decompose(bone.position,bone.quaternion,bone.scale);bone.updateMatrix()
  }
  const buckle=endoMaterialPoint(pose.points,pose.angles,.100)
  rig.buckle.position.copy(buckle.point);rig.buckle.quaternion.setFromAxisAngle(AXIS,buckle.angle)
  updateRigWorld(rig.root);rig.straps.forEach(mesh=>mesh.skeleton.update())
}

export function endoActualStrapLength(rig:EndoRig){
  updateRigWorld(rig.root)
  const inverse=rig.tracker.matrixWorld.clone().invert(),positions=rig.bones.map(b=>b.getWorldPosition(new Vector3()).applyMatrix4(inverse))
  return positions.slice(1).reduce((sum,p,i)=>sum+p.distanceTo(positions[i]),0)
}
