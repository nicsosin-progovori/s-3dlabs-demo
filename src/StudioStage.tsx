import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ComponentRef, ReactNode, RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { AccumulativeShadows, Environment, Lightformer, RandomizedLight } from '@react-three/drei'
import { BackSide, DataTexture, HalfFloatType, LatheGeometry, NoColorSpace, Object3D, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector2, WebGLRenderTarget } from 'three'
import type { DirectionalLight, Texture } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { bottleAreaShadow } from './bottleShadows'
import { studioBackdrop } from './studioBackdrop'
import { STUDIO_LOOK,studioRadiance,studioStageSignature } from './studioLook'
import type { StudioLook } from './studioLook'
import { MotionAudit } from './MotionAudit'
import { StudioAudit } from './StudioAudit'
import { studioReducedMotion } from './studioCameraMotion'

export interface StudioStageProps {children:ReactNode;onReady:(save:(filename:string)=>void,renderer:string)=>void;fallback:string;moving:boolean;shadowKey:string;ready:boolean;presentationKey?:string;onPrepared?:()=>void;composition?:boolean;pixelRatio?:number;look?:StudioLook;imageRender?:boolean}
const tuple3=(v:number[])=>[v[0],v[1],v[2]] as [number,number,number]

// A worker renders one immutable job. Once its lightmap is complete, the
// randomized lights' shadow targets are no longer needed by the final image.
// Walk children directly: Drei hides this subtree from Object3D.traverse.
function prepareImageShadowMaps(object:Object3D,baking=false) {
  const isBaking=baking||object.userData.studioBakeLights===true
  if(isBaking&&(object as DirectionalLight).isDirectionalLight){
    const light=object as DirectionalLight
    light.shadow.map?.dispose();light.shadow.map=null
    light.shadow.mapPass?.dispose();light.shadow.mapPass=null
    light.castShadow=false
  }
  if(object.userData.studioProductShadow){
    const light=object as DirectionalLight
    light.castShadow=true;light.shadow.needsUpdate=true
  }
  for(const child of object.children)prepareImageShadowMaps(child,isBaking)
}

function softboxTexture() {
  const size=256,data=new Uint8Array(size*size*4)
  const edge=(v:number)=>{const t=Math.max(0,Math.min(1,v/.19));return t*t*(3-2*t)}
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const v=edge(1-Math.abs(2*x/(size-1)-1))*edge(1-Math.abs(2*y/(size-1)-1)),at=(y*size+x)*4
    data[at]=data[at+1]=data[at+2]=Math.round(255*v);data[at+3]=255
  }
  const texture=new DataTexture(data,size,size,RGBAFormat,UnsignedByteType)
  texture.colorSpace=NoColorSpace;texture.needsUpdate=true
  return texture
}

const Studio=memo(function Studio({moving,shadowKey,ready,composition,look:profile,imageRender}:{moving:boolean;shadowKey:string;ready:boolean;composition:boolean;look:StudioLook;imageRender:boolean}) {
  const gl=useThree(s=>s.gl),scene=useThree(s=>s.scene),invalidate=useThree(s=>s.invalidate),shadow=useRef<ComponentRef<typeof AccumulativeShadows>>(null),decorationVersion=useRef(-1)
  const floor=useMemo(()=>studioBackdrop(profile),[profile]),look=profile.shadow
  const signature=useMemo(()=>studioStageSignature(profile),[profile]),clear=useMemo(()=>studioRadiance(profile.background.top,profile.exposure),[profile])
  const keyTarget=useMemo(()=>{const target=new Object3D();target.position.fromArray(profile.key.target??[0,0,0]);return target},[profile])
  const fillTarget=useMemo(()=>{const target=new Object3D();target.position.fromArray(profile.fill.target??[0,0,0]);return target},[profile])
  const maps=profile.shadowMap??{productResolution:4096,groundResolution:2048,bias:-.00003,normalBias:.004}
  useLayoutEffect(()=>{gl.toneMapping=profile.toneMapping;gl.toneMappingExposure=profile.exposure;gl.outputColorSpace=SRGBColorSpace;gl.domElement.dataset.studioProfile=profile.id;invalidate()},[profile,gl,invalidate])
  useLayoutEffect(()=>{decorationVersion.current=-1;gl.domElement.dataset.shadowFrames='0';if(shadow.current){const mesh=shadow.current.getMesh();mesh.userData.bottleShadowReceiver=true;bottleAreaShadow(mesh.material,look.density)}},[shadowKey,moving,gl,look])
  useFrame(()=>{
    const version=scene.userData.bottleDecorationVersion??0
    if(shadow.current&&decorationVersion.current!==version){shadow.current.reset();decorationVersion.current=version;invalidate()}
    floor.liveShadow.value=moving?1:Math.max(0,1-(shadow.current?.count??0)/look.frames)
    gl.domElement.dataset.renderQuality=profile.id
    gl.domElement.dataset.shadowFrames=String(moving?0:shadow.current?.count??0)
    gl.domElement.dataset.shadowKey=shadowKey
    gl.domElement.dataset.motionActive=String(moving)
    gl.domElement.dataset.backdropProfile='common'
    gl.domElement.dataset.backdropVersion=profile.id
    gl.domElement.dataset.studioSignature=signature
    gl.domElement.dataset.groundShadowKernel=JSON.stringify(floor.material.userData.bottleShadowPatch??null)
    gl.domElement.dataset.backdropSettled='true'
    gl.shadowMap.autoUpdate=moving||(shadow.current?.count??0)<look.frames
  },-.25)
  const extent=composition?8:4.5
  const texture=useMemo(softboxTexture,[])
  const geometry=useMemo(()=>{
    const points=[new Vector2(0,-.008),new Vector2(20,-.008)]
    for(let i=1;i<=64;i++){const a=i/64*Math.PI/2;points.push(new Vector2(20+10*Math.sin(a),10-10*Math.cos(a)-.008))}
    points.push(new Vector2(30,35))
    const result=new LatheGeometry(points,128),index=result.index!
    for(let i=0;i<index.count;i+=3){const b=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,b)}
    result.computeVertexNormals();return result
  },[])
  useEffect(()=>()=>{texture.dispose();geometry.dispose()},[texture,geometry])
  useEffect(()=>()=>floor.material.dispose(),[floor])
  return <>
    <color attach="background" args={[clear.x,clear.y,clear.z]}/>
    <primitive object={keyTarget}/><primitive object={fillTarget}/>
    <ambientLight intensity={profile.ambient}/>
    <hemisphereLight intensity={profile.hemisphere.intensity} color={profile.hemisphere.sky} groundColor={profile.hemisphere.ground}/>
    <directionalLight key={"key:"+profile.id} target={keyTarget} position={tuple3(profile.key.position)} intensity={profile.key.intensity} color={profile.key.color} castShadow={!imageRender} userData={{studioProductShadow:true}} shadow-mapSize={[maps.productResolution,maps.productResolution]} shadow-bias={maps.bias} shadow-normalBias={maps.normalBias} shadow-camera-near={.1} shadow-camera-far={25} shadow-camera-left={-extent} shadow-camera-right={extent} shadow-camera-top={extent} shadow-camera-bottom={-extent} onUpdate={light=>light.shadow.camera.updateProjectionMatrix()}/>
    <directionalLight key={"ground:"+profile.id} target={keyTarget} position={tuple3(profile.key.position)} intensity={0} castShadow={!imageRender} userData={{studioProductShadow:true}} shadow-mapSize={[maps.groundResolution,maps.groundResolution]} shadow-bias={maps.bias} shadow-normalBias={maps.normalBias} shadow-camera-near={.1} shadow-camera-far={25} shadow-camera-left={-extent} shadow-camera-right={extent} shadow-camera-top={extent} shadow-camera-bottom={-extent} onUpdate={light=>light.shadow.camera.updateProjectionMatrix()}/>
    <directionalLight target={fillTarget} position={tuple3(profile.fill.position)} intensity={profile.fill.intensity} color={profile.fill.color}/>
    <Environment key={'environment:'+profile.id} resolution={profile.environment.resolution} frames={1} environmentIntensity={profile.environment.intensity}>
      <mesh scale={40}><sphereGeometry args={[1,32,16]}/><meshBasicMaterial color={profile.environment.surround} side={BackSide} toneMapped={false}/></mesh>
      {profile.environment.boxes.map((box,i)=><Lightformer key={i} map={texture} intensity={box.intensity} color={box.color} position={tuple3(box.position)} scale={[box.scale[0],box.scale[1]]} target={[0,0,0]}/>)}
    </Environment>
    <mesh geometry={geometry} material={floor.material} receiveShadow userData={{bottleBackdrop:true}}/>
    {ready&&<AccumulativeShadows key={'accumulative:'+profile.id} ref={shadow} visible={!moving} temporal frames={moving?2:look.frames} scale={composition?(look.compositionScale??20):(look.scale??12)} position={tuple3(look.position)} resolution={look.resolution} opacity={look.opacity} color={look.color??'#242526'}>
      <RandomizedLight userData={{studioBakeLights:true}} amount={look.areaSamples??8} radius={look.radius} ambient={0} intensity={Math.PI*(1-look.contact)} position={tuple3(profile.key.position)} size={5} near={.1} far={25} mapSize={look.lightMapSize??1024} bias={.0002}/>
      <RandomizedLight userData={{studioBakeLights:true}} amount={look.contactSamples??4} ambient={1} intensity={Math.PI*look.contact} position={[0,6,0]} size={5} near={.1} far={25} mapSize={look.lightMapSize??1024} bias={.0002}/>
    </AccumulativeShadows>}
  </>
})

/** HDR + geometry AO + one output transform. PNG export uses this same chain. */
function Beauty({renderExport,ready,onReady,presentationKey,onPrepared,look,imageRender}:{renderExport:RefObject<(()=>void)|null>;ready:boolean;onReady:StudioStageProps['onReady'];presentationKey:string;onPrepared?:()=>void;look:StudioLook;imageRender:boolean}) {
  const {gl,scene,camera,size,invalidate}=useThree()
  const frames=useRef(0),revealed=useRef(false),revealTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),readyCallback=useRef(onReady),preparedCallback=useRef(onPrepared)
  const preparedEnvironment=useRef<{texture:Texture;version:number}|null>(null),bakeReleased=useRef(false)
  readyCallback.current=onReady
  preparedCallback.current=onPrepared
  useEffect(()=>()=>clearTimeout(revealTimer.current),[])
  useLayoutEffect(()=>{
    clearTimeout(revealTimer.current);revealed.current=false
    gl.domElement.dataset.studioReady='false';gl.domElement.dataset.studioVisible='false';gl.domElement.dataset.presentationKey=presentationKey
  },[gl,presentationKey])
  useLayoutEffect(()=>{clearTimeout(revealTimer.current);revealed.current=false;gl.domElement.dataset.studioReady='false';invalidate()},[look,gl,invalidate])
  const pipeline=useMemo(()=>{
    const target=new WebGLRenderTarget(1,1,{type:HalfFloatType,samples:4})
    const composer=new EffectComposer(gl,target);composer.addPass(new RenderPass(scene,camera))
    const ao=new GTAOPass(scene,camera,1,1)
    ao.blendIntensity=look.ao.intensity
    ao.updateGtaoMaterial({radius:look.ao.radius,thickness:look.ao.thickness,distanceExponent:1.3,distanceFallOff:.8,scale:1,samples:look.ao.samples,screenSpaceRadius:false})
    ao.updatePdMaterial({radius:6,samples:16,rings:2,lumaPhi:8,depthPhi:2,normalPhi:3})
    // Broader proximity shading belongs to the floor, especially under the
    // horizontal cylinder. Keep the approved object's AO parameters intact.
    ao.gtaoMaterial.fragmentShader=ao.gtaoMaterial.fragmentShader
      .replace('float radiusToUse = radius;',`vec3 studioWorldPos=(cameraWorldMatrix*vec4(viewPos,1.)).xyz;
        float studioFloor=1.-smoothstep(-.006,-.002,studioWorldPos.y);
        float radiusToUse=mix(radius,.7,studioFloor);
        float thicknessToUse=mix(thickness,.55,studioFloor);`)
      .replaceAll('abs(viewDelta.z) < thickness','abs(viewDelta.z) < thicknessToUse')
      .replace('ao = pow(ao, scale);','ao = pow(ao,mix(scale,2.,studioFloor));')
    const original=ao.render.bind(ao)
    ao.render=(...args)=>{
      const hidden:{visible:boolean}[]=[]
      scene.traverseVisible(object=>{if(object.userData.print_surface||object.userData.bottleShadowReceiver){object.visible=false;hidden.push(object)}})
      const auto=gl.shadowMap.autoUpdate,dirty=gl.shadowMap.needsUpdate
      gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=false
      try {original(...args)} finally {gl.shadowMap.autoUpdate=auto;gl.shadowMap.needsUpdate=dirty;hidden.forEach(object=>{object.visible=true})}
    }
    const output=new OutputPass();composer.addPass(ao);composer.addPass(output)
    return {composer,ao,output}
  },[gl,scene,camera,look])
  const renderBeauty=useCallback((delta=0)=>{
    // Drei's baking lights start visible before its first frame subscription.
    // Keep them out of the beauty pass, including that first frame and PNGs.
    const hidden:Object3D[]=[]
    scene.traverseVisible(object=>{if(object.userData.studioBakeLights){object.visible=false;hidden.push(object)}})
    try{
      const environment=scene.environment,prepared=preparedEnvironment.current
      if(environment&&(prepared?.texture!==environment||prepared.version!==environment.pmremVersion)){
        // Prepare PMREM outside renderBufferDirect. A lazy nested PMREM render
        // can restore texture-unit counters left by the previous shadow pass.
        gl.compile(scene,camera)
        preparedEnvironment.current={texture:environment,version:environment.pmremVersion}
      }
      pipeline.composer.render(delta)
    }finally{hidden.forEach(object=>{object.visible=true})}
  },[pipeline,scene,gl,camera])
  useLayoutEffect(()=>{
    pipeline.composer.setPixelRatio(gl.getPixelRatio());pipeline.composer.setSize(size.width,size.height)
    const scale=look.ao.resolutionScale,dpr=gl.getPixelRatio()
    pipeline.ao.setSize(Math.round(size.width*dpr*scale),Math.round(size.height*dpr*scale))
    gl.domElement.dataset.aoScale=String(scale)
    renderExport.current=renderBeauty;invalidate()
    return()=>{renderExport.current=null}
  },[pipeline,gl,size.width,size.height,invalidate,renderExport,look,renderBeauty])
  useEffect(()=>()=>{pipeline.ao.dispose();pipeline.output.dispose();pipeline.composer.dispose()},[pipeline])
  useFrame((_,delta)=>{
    if(gl.getContext().isContextLost())return
    const settled=ready&&scene.environment&&Number(gl.domElement.dataset.shadowFrames)>=look.shadow.frames
    // The interactive preview needs intermediate images; a PNG job only needs
    // the final one. AccumulativeShadows still performs all configured frames.
    if(imageRender){
      if(!settled||revealed.current)return
      if(!bakeReleased.current){prepareImageShadowMaps(scene);gl.shadowMap.needsUpdate=true;bakeReleased.current=true}
    }
    renderBeauty(delta)
    gl.domElement.dataset.renderFrames=String(++frames.current)
    gl.domElement.dataset.gpuTextures=String(gl.info.memory.textures)
    gl.domElement.dataset.gpuGeometries=String(gl.info.memory.geometries)
    gl.domElement.dataset.frameMs=String(Math.round(delta*1000))
    if(!revealed.current&&settled){
      revealed.current=true
      gl.domElement.dataset.studioReady='true'
      const reduced=studioReducedMotion()
      gl.domElement.dataset.reducedMotion=String(reduced)
      gl.domElement.dataset.studioReadyAt=String(performance.now())
      preparedCallback.current?.()
      revealTimer.current=setTimeout(()=>{
        gl.domElement.dataset.studioVisible='true'
        readyCallback.current(filename=>{renderBeauty();const a=document.createElement('a');a.download=filename;a.href=gl.domElement.toDataURL('image/png');a.click()},gl.getContext().getParameter(gl.getContext().VERSION) as string)
      },reduced?0:look.revealMs+34)
    }
  },1)
  return null
}

export function StudioStage({children,onReady,fallback,moving,shadowKey,ready,presentationKey='initial',onPrepared,composition=false,pixelRatio,look=STUDIO_LOOK,imageRender=false}:StudioStageProps) {
  const renderExport=useRef<(()=>void)|null>(null)
  // Geometry already has 4x MSAA in the HDR composer. The worker's default
  // framebuffer receives only OutputPass's fullscreen triangle.
  return <Canvas camera={{position:[0,3,10],fov:35,near:.025,far:100}} dpr={pixelRatio??[1.5,2]} shadows={{type:look.shadowType}} frameloop="demand" gl={{antialias:!imageRender,depth:!imageRender,stencil:false,preserveDrawingBuffer:true,alpha:false,powerPreference:'high-performance'}} fallback={<div className="scene-error">{fallback}</div>}
    onCreated={({gl})=>{
      gl.outputColorSpace=SRGBColorSpace;gl.toneMapping=look.toneMapping;gl.toneMappingExposure=look.exposure
      gl.domElement.dataset.studioProfile=look.id;gl.domElement.dataset.studioReady='false';gl.domElement.dataset.studioVisible='false'
      gl.domElement.dataset.studioInstance=crypto.randomUUID()
    }}>
    <Studio moving={moving} shadowKey={shadowKey} ready={ready} composition={composition} look={look} imageRender={imageRender}/>{children}{import.meta.env.DEV&&new URLSearchParams(location.search).has('motionQa')&&<MotionAudit/>}<Beauty renderExport={renderExport} ready={ready} onReady={onReady} presentationKey={presentationKey} onPrepared={onPrepared} look={look} imageRender={imageRender}/>{import.meta.env.DEV&&new URLSearchParams(location.search).has('studioQa')&&<StudioAudit/>}
  </Canvas>
}
