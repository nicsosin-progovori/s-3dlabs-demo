import {Box3,Matrix4,Vector3} from 'three'
import {BOTTLE_BASE_PIVOT,BOTTLE_SCALE,bottlePoseBounds,sampleBottlePose} from './bottleMotion.ts'
import type {BottlePose,BottleRig} from './bottleMotion.ts'
import {compositionBounds,compositionMatrices} from './compositionCamera.ts'
import {DEFAULT_COMPOSITION} from '../shared/compositionContract.mjs'
import type {Composition,CompositionBounds} from '../shared/compositionContract.mjs'
import type {BottleState,CameraView} from './bottleViews.ts'

const identity=new Matrix4()
/** Canonical low supports keep the frame invariant when final replaces geometry. */
export function bottleCompositionBounds(rig:BottleRig,pose:BottlePose,composition:Composition=DEFAULT_COMPOSITION):Box3{
  return compositionBounds(compositionMatrices(composition).map(({element,matrix})=>({id:element.id,bounds:bottlePoseBounds(rig,pose,'all',matrix.equals(identity)?undefined:matrix)})))
}
export function bottleViewBounds(rig:BottleRig,state:BottleState,view:Pick<CameraView,'focusMm'|'frameTarget'>,composition:Composition=DEFAULT_COMPOSITION):Box3{
  const pose=sampleBottlePose(rig,state,state,1),target=view.frameTarget??(view.focusMm?'primary':'composition')
  if(target==='composition')return bottleCompositionBounds(rig,pose,composition)
  const matrix=compositionMatrices(composition).find(({element})=>element.id===composition.primary)!.matrix
  if(!view.focusMm)return bottlePoseBounds(rig,pose,'all',matrix.equals(identity)?undefined:matrix)
  const offset=new Vector3(state==='lying'?BOTTLE_BASE_PIVOT:0,0,0)
  return new Box3(new Vector3(...view.focusMm.min).multiplyScalar(.001).add(offset),new Vector3(...view.focusMm.max).multiplyScalar(.001).add(offset)).applyMatrix4(matrix)
}
export function bottleCompositionMetrics(rig:BottleRig,state:BottleState,composition:Composition):CompositionBounds{
  const box=bottleCompositionBounds(rig,sampleBottlePose(rig,state,state,1),composition)
  box.min.multiplyScalar(BOTTLE_SCALE);box.max.multiplyScalar(BOTTLE_SCALE)
  return {min:box.min.toArray(),max:box.max.toArray(),center:box.getCenter(new Vector3()).toArray(),size:box.getSize(new Vector3()).toArray()}
}
export function compositionNeedsWideStage(composition:Composition):boolean{
  const matrices=compositionMatrices(composition)
  return matrices.length>1||matrices.some(({matrix})=>!matrix.equals(identity))
}
