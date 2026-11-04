import { useRef } from 'react'
import { useFrame,useThree } from '@react-three/fiber'
import type { Light } from 'three'

/** Passive, opt-in local QA of the actual output pixel and visible light rig. */
export function StudioAudit(){
  const {gl,scene}=useThree(),frames=useRef<object[]>([]),count=useRef(0),pixel=useRef(new Uint8Array(4))
  useFrame(()=>{
    const index=count.current++
    if(index>90&&index%8!==0)return
    const samples=[[.03,.10],[.97,.10],[.03,.50],[.97,.50],[.03,.90],[.97,.90]],uv=samples[index%samples.length]
    const canvas=gl.domElement,x=Math.floor(uv[0]*(canvas.width-1)),y=Math.floor(uv[1]*(canvas.height-1)),context=gl.getContext()
    context.readPixels(x,y,1,1,context.RGBA,context.UNSIGNED_BYTE,pixel.current)
    const lights:object[]=[]
    scene.traverseVisible(o=>{if((o as Light).isLight){const light=o as Light;lights.push({type:light.type,color:light.color.getHexString(),intensity:light.intensity,position:light.position.toArray()})}})
    const section=canvas.closest('.viewport')
    const cover=section?.querySelector('.product-handoff')
    frames.current.push({time:performance.now(),frame:index,product:section?.getAttribute('data-testid'),state:section?.getAttribute('data-state'),view:section?.getAttribute('data-view'),profile:canvas.dataset.studioProfile,instance:canvas.dataset.studioInstance,presentation:canvas.dataset.presentationKey,switching:section?.getAttribute('data-switching'),ready:canvas.dataset.studioReady,opacity:getComputedStyle(canvas).opacity,coverOpacity:cover?getComputedStyle(cover).opacity:null,aoScale:canvas.dataset.aoScale,environment:!!scene.environment,environmentIntensity:scene.environmentIntensity,exposure:gl.toneMappingExposure,lights,uv:[(x+.5)/canvas.width,(y+.5)/canvas.height],rgba:Array.from(pixel.current)})
    if(frames.current.length>240)frames.current.splice(0,60)
    canvas.dataset.studioAudit=JSON.stringify(frames.current)
  },2)
  return null
}
