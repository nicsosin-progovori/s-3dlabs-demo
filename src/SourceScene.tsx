import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ComponentRef, ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { BackSide, Box3, DoubleSide, MathUtils, Mesh, MeshPhysicalMaterial, PCFShadowMap, PerspectiveCamera, Spherical, Vector2, Vector3 } from 'three'
import { domingGeometry } from './decorationGeometry'
import { bottleSoftShadows } from './bottleShadows'
import type { CameraView } from './bottle'
import { decorationTextures } from './sourceDecoration'
import { sourceProduct, TECHNIQUES } from './sourceCatalog'
import type { SourceSettings } from './sourceCatalog'
import { arrangeSources } from './sourceModel'
import type { LayoutEntry, SourceModel } from './sourceModel'
import type { LogoAsset } from './types'

export interface StudioItem { key: number; model: SourceModel; settings: SourceSettings; logo: LogoAsset | null }
export interface LayoutReport { items: { key: number; sizeMm: number[]; min: number[]; max: number[] }[]; gapMm: number; axis: number[] }
interface Props {
  items: StudioItem[]; active: number; onSelect: (key: number)=>void; resetKey: number
  onLayout: (report: LayoutReport)=>void
  onReady: (save:(name:string)=>void,renderer:string)=>void
  fallback: string
  view?: CameraView
  onInteract?: ()=>void
  onCamera?: (snapshot:{position:number[];target:number[];projected:number[][];moving:boolean;request?:number;viewId?:string})=>void
}
const SCALE=12
const BG='#eae9e4'

export function DecoratedModel({item,position,onSelect}:{item:StudioItem;position:[number,number,number];onSelect:Props['onSelect']}) {
  const invalidate=useThree(s=>s.invalidate)
  const scene=useThree(s=>s.scene)
  const gl=useThree(s=>s.gl)
  const product=sourceProduct(item.settings.productId)
  const zone=product.zones.find(z=>z.id===item.settings.decoration.zone)??product.zones[0]
  const settings=item.settings
  const textures=useMemo(()=>decorationTextures(zone,settings,item.logo),[zone,settings.enabled,settings.decoration.technique,settings.decoration.colors,item.logo])
  const material=useMemo(()=>{
    const kind=TECHNIQUES[settings.decoration.technique].kind
    const result=new MeshPhysicalMaterial({
      map:textures.map, normalMap:kind==='thread'?textures.normalMap:null,
      normalScale:new Vector2(.8,.8), side:DoubleSide, transparent:true, alphaTest:.02,
      depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2,
      roughness:kind==='thread'?.74:kind==='doming'?.12:kind==='metal'?.4:kind==='reflective'?.22:.55,
      metalness:kind==='metal'&&!zone.wood?.75:kind==='reflective'?.65:0,
      clearcoat:kind==='doming'?1:kind==='reflective'?.6:0, clearcoatRoughness:.1,
      sheen:kind==='thread'?1:0, sheenRoughness:.8, sheenColor:'#e8e4dd',
    })
    return bottleSoftShadows(result)
  },[textures,settings.decoration.technique,zone.wood])
  useEffect(()=>()=>textures.dispose(),[textures])
  useEffect(()=>()=>material.dispose(),[material])
  useLayoutEffect(()=>{
    const geometryChanges: {mesh:Mesh;original:Mesh['geometry'];owned:Mesh['geometry']}[]=[]
    item.model.root.traverse(o=>{
      if (!(o instanceof Mesh) || !o.userData.print_surface) return
      o.visible=o.userData.print_surface===zone.surface && !!item.logo && settings.enabled
      o.material=material
      o.renderOrder=2
      o.castShadow=false
      if(settings.decoration.technique==='doming'&&o.userData.print_surface===zone.surface){
        const original=o.geometry,owned=domingGeometry(original)
        o.geometry=owned
        geometryChanges.push({mesh:o,original,owned})
      }
    })
    if(product.id==='bottle'){scene.userData.bottleDecorationVersion=(scene.userData.bottleDecorationVersion??0)+1;gl.domElement.dataset.shadowFrames='0'}
    invalidate()
    return()=>geometryChanges.forEach(change=>{change.mesh.geometry=change.original;change.owned.dispose()})
  },[item.model,zone,item.logo,settings.enabled,material,invalidate])
  return <group position={position} onClick={e=>{e.stopPropagation();onSelect(item.key)}}><primitive object={item.model.root} dispose={null}/></group>
}

function CompositionCamera({items,layout,active,resetKey,view,onInteract,onCamera}:Pick<Props,'items'|'active'|'resetKey'|'view'|'onInteract'|'onCamera'>&{layout:LayoutEntry[]}) {
  const {camera,size,invalidate}=useThree()
  const controls=useRef<ComponentRef<typeof OrbitControls>>(null)
  const transition=useRef<{from:Spherical;to:Spherical;targetFrom:Vector3;targetTo:Vector3;elapsed:number}|null>(null)
  const initialized=useRef(false)
  const framing=useMemo(()=>{
    const box=new Box3()
    layout.forEach(e=>box.union(e.bounds))
    if(view?.focusMm){
      const offset=new Vector3(...layout[0].position)
      box.min.fromArray(view.focusMm.min).multiplyScalar(.001).add(offset)
      box.max.fromArray(view.focusMm.max).multiplyScalar(.001).add(offset)
    }
    box.min.multiplyScalar(SCALE); box.max.multiplyScalar(SCALE)
    const target=box.getCenter(new Vector3())
    const item=items.find(i=>i.key===active)??items[0]
    const p=sourceProduct(item.settings.productId)
    const zone=p.zones.find(z=>z.id===item.settings.decoration.zone)??p.zones[0]
    const state=p.states.find(s=>s.id===item.settings.state)??p.states[0]
    const yaw=(view?.azimuth??zone.azimuth)*Math.PI/180
    const elevation=view?.elevation??zone.elevation??state.elevation
    const direction=new Vector3(Math.sin(yaw),elevation,Math.cos(yaw)).normalize()
    const right=new Vector3(direction.z,0,-direction.x).normalize()
    const up=new Vector3().crossVectors(direction,right).normalize()
    const tan=Math.tan(35*Math.PI/360)
    // Reserve enough vertical space for the heading and footer at every viewport.
    const aspect=size.width/Math.max(1,size.height)
    const usable=Math.max(.48,1-(view?70:135)/Math.max(1,size.height))
    let distance=1
    for(const x of [box.min.x,box.max.x]) for(const y of [box.min.y,box.max.y]) for(const z of [box.min.z,box.max.z]) {
      const point=new Vector3(x,y,z).sub(target)
      distance=Math.max(distance,point.dot(direction)+Math.max(Math.abs(point.dot(right))/(tan*aspect*.84),Math.abs(point.dot(up))/(tan*usable)))
    }
    distance*=1.12
    return {target,position:target.clone().addScaledVector(direction,distance),distance,box}
  },[layout,items,active,size.width,size.height,view])
  // Colour and logo changes keep the current view; state / placement changes fit
  // the whole composition, including the other product, from the selected side.
  const viewKey=items.map(i=>`${i.key}:${i.settings.productId}:${i.settings.state}:${view?'':i.settings.decoration.zone}`).join('|')+`:${active}:${resetKey}:${size.width}:${size.height}:${view?.request??''}`
  const report=()=>{
    const orbit=controls.current
    if(!orbit)return
    camera.updateMatrixWorld()
    const projected:number[][]=[]
    for(const x of [framing.box.min.x,framing.box.max.x])for(const y of [framing.box.min.y,framing.box.max.y])for(const z of [framing.box.min.z,framing.box.max.z])projected.push(new Vector3(x,y,z).project(camera).toArray())
    onCamera?.({position:camera.position.toArray(),target:orbit.target.toArray(),projected,moving:false,request:view?.request,viewId:view?.id})
  }
  useLayoutEffect(()=>{
    const orbit=controls.current
    if(!orbit || !(camera instanceof PerspectiveCamera)) return
    orbit.maxDistance=Math.max(12,framing.distance*3)
    if(!initialized.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      camera.position.copy(framing.position);orbit.target.copy(framing.target);orbit.update()
      initialized.current=true
      transition.current=null
      report()
    } else {
      const from=new Spherical().setFromVector3(camera.position.clone().sub(orbit.target))
      const to=new Spherical().setFromVector3(framing.position.clone().sub(framing.target))
      to.theta=from.theta+MathUtils.euclideanModulo(to.theta-from.theta+Math.PI,Math.PI*2)-Math.PI
      transition.current={from,to,targetFrom:orbit.target.clone(),targetTo:framing.target,elapsed:0}
      onCamera?.({position:camera.position.toArray(),target:orbit.target.toArray(),projected:[],moving:true,request:view?.request,viewId:view?.id})
    }
    invalidate()
    // Framing is intentionally keyed to geometric / view changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[viewKey,camera,invalidate])
  useFrame((_,delta)=>{
    const t=transition.current,orbit=controls.current
    if(!t||!orbit) return
    t.elapsed+=Math.min(delta,.05)
    const amount=MathUtils.smootherstep(Math.min(1,t.elapsed/.42),0,1)
    orbit.target.lerpVectors(t.targetFrom,t.targetTo,amount)
    camera.position.setFromSphericalCoords(MathUtils.lerp(t.from.radius,t.to.radius,amount),MathUtils.lerp(t.from.phi,t.to.phi,amount),MathUtils.lerp(t.from.theta,t.to.theta,amount)).add(orbit.target)
    orbit.update()
    if(amount===1){transition.current=null;report()}
    else invalidate()
  })
  return <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={.6} maxDistance={30} minPolarAngle={.08} maxPolarAngle={Math.PI/2-.015} rotateSpeed={.65} dampingFactor={.13} onStart={()=>{transition.current=null;onInteract?.()}} onEnd={()=>{if(!transition.current)report()}}/>
}

function Composition(props:Props) {
  const {gl,invalidate}=useThree()
  const activeItem=props.items.find(i=>i.key===props.active)??props.items[0]
  const activeProduct=sourceProduct(activeItem.settings.productId)
  const activeZone=activeProduct.zones.find(z=>z.id===activeItem.settings.decoration.zone)??activeProduct.zones[0]
  const yaw=activeZone.azimuth*Math.PI/180
  const axis=useMemo(()=>new Vector3(Math.cos(yaw),0,-Math.sin(yaw)),[yaw])
  const layout=useMemo(()=>arrangeSources(props.items.map(i=>i.model),props.items.map(i=>i.settings),props.items.map(i=>sourceProduct(i.settings.productId)),axis),[props.items,axis])
  const shapeKey=props.items.map(i=>`${i.key}:${i.settings.productId}:${i.settings.state}`).join('|')+`:${yaw}`
  useLayoutEffect(()=>{
    gl.shadowMap.needsUpdate=true
    props.onLayout({items:layout.map((e,i)=>({key:props.items[i].key,sizeMm:e.sizeMm,min:e.bounds.min.toArray(),max:e.bounds.max.toArray()})),gapMm:layout.length===2?30:0,axis:axis.toArray()})
    invalidate()
  },[layout,props.onLayout,gl,invalidate])
  return <>
    <group scale={SCALE}>{props.items.map((item,i)=><DecoratedModel key={item.key+':'+item.model.productId} item={item} position={layout[i].position} onSelect={props.onSelect}/>)}</group>
    <mesh rotation={[-Math.PI/2,0,0]} receiveShadow position={[0,-.008,0]}><planeGeometry args={[200,200]}/><meshStandardMaterial color={BG} roughness={1}/></mesh>
    <ContactShadows key={shapeKey} position={[0,.001,0]} scale={20} far={5} resolution={1024} opacity={.45} blur={2.1} frames={1} color="#4b4842"/>
    <CompositionCamera items={props.items} active={props.active} layout={layout} resetKey={props.resetKey} view={props.view} onInteract={props.onInteract} onCamera={props.onCamera}/>
  </>
}

export function SourceStage({children,onReady,fallback}:{children:ReactNode;onReady:Props['onReady'];fallback:string}) {
  return <Canvas camera={{position:[0,3,10],fov:35,near:.01,far:200}} dpr={[1,2]} shadows={{type:PCFShadowMap}} frameloop="demand" gl={{antialias:true,preserveDrawingBuffer:true,alpha:false}} fallback={<div className="scene-error">{fallback}</div>}
    onCreated={({gl,scene,camera})=>{
      gl.setClearAlpha(0)
      onReady(name=>{gl.render(scene,camera);const a=document.createElement('a');a.download=name;a.href=gl.domElement.toDataURL('image/png');a.click()},gl.getContext().getParameter(gl.getContext().VERSION) as string)
    }}>
    <color attach="background" args={[BG]}/><fog attach="fog" args={[BG,35,100]}/>
    <ambientLight intensity={.7}/>
    <directionalLight position={[-4,8,6]} intensity={2.4} color="#fff9ed" castShadow shadow-mapSize={[2048,2048]} shadow-bias={-.00007} shadow-normalBias={.003} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9}/>
    <directionalLight position={[5,3,-4]} intensity={1}/>
    <Environment resolution={128}>
      <mesh scale={30}><sphereGeometry args={[1,32,16]}/><meshBasicMaterial color="#b8b9b3" side={BackSide} toneMapped={false}/></mesh>
      <Lightformer form="rect" intensity={3} position={[0,5,2]} scale={[8,4,1]} rotation={[Math.PI/2,0,0]}/>
      <Lightformer form="rect" intensity={2.2} position={[-4,2,3]} scale={[3,6,1]} rotation={[0,Math.PI/3,0]}/>
      <Lightformer form="rect" intensity={1.8} position={[4,2,-3]} scale={[4,6,1]} rotation={[0,-Math.PI/3,0]}/>
    </Environment>
    {children}
  </Canvas>
}

export function SourceScene(props:Props) {
  return <SourceStage onReady={props.onReady} fallback={props.fallback}>{!!props.items.length&&<Composition {...props}/>}</SourceStage>
}
