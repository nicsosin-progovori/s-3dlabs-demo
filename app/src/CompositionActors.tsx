import {BottleAssembly} from './BottleScene'
import type {ComponentProps} from 'react'
import {BOTTLE_SCALE} from './bottleMotion'
import type {Composition,CompositionTransform} from '../shared/compositionContract.mjs'

type Props=ComponentProps<typeof BottleAssembly>&{composition:Composition}
const ignore=()=>{}
function transformProps(value:CompositionTransform){return {position:value.position.map(n=>n*BOTTLE_SCALE) as [number,number,number],rotation:value.rotation.map(n=>n*Math.PI/180) as [number,number,number],scale:value.scale}}
/** Each instance owns its rig and decoration; geometry and skin resources are shared. */
export function BottleComposition({composition,cameraEnabled=true,...props}:Props){
  return <group name={'composition:'+composition.id} userData={{compositionRoot:true}} {...transformProps(composition.root)}>
    {composition.elements.filter(element=>element.visible).map(element=>{
      const primary=element.id===composition.primary
      return <group key={primary?'@primary':element.id} name={'element:'+element.id} userData={{compositionElement:element.id}} {...transformProps(element.transform)}>
        <BottleAssembly {...props} composition={composition} cameraEnabled={cameraEnabled&&primary} onLayout={primary?props.onLayout:ignore} onCamera={primary?props.onCamera:ignore} onMotion={primary?props.onMotion:ignore} onInteraction={primary?props.onInteraction:undefined} onInteract={primary?props.onInteract:ignore}/>
      </group>
    })}
  </group>
}
