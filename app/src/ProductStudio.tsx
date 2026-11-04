import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { messages, readLanguage, persistLanguage } from './i18n'
import type { Language } from './i18n'
import { LabError } from './errors'
import type { LabErrorCode } from './errors'
import { readLogo, sampleLogo } from './logo'
import type { LogoAsset } from './types'
import { initialSettings, isSourceId, TECHNIQUES } from './sourceCatalog'
import type { SourceId, SourceSettings, TechniqueId } from './sourceCatalog'
import { loadSourceModel } from './sourceModel'
import type { SourceModel } from './sourceModel'
import type { LayoutReport, StudioItem } from './SourceScene'
import { StudioStage } from './StudioStage'
import { STUDIO_STYLE } from './studioLook'
import { studioReducedMotion } from './studioCameraMotion'
import { studioInstance } from './studioInstance'
import { PairScene } from './PairScene'
import type { PairMotionSnapshot } from './PairScene'
import { PAIR_VIEWS } from './pairLayout'
import type { PairView } from './pairLayout'
import { BottleAssembly } from './BottleScene'
import type { BottleMotionSnapshot } from './BottleScene'
import { EndoAssembly } from './EndoScene'
import type { EndoMotionSnapshot } from './EndoScene'
import { PillowAssembly } from './PillowScene'
import { BOTTLE, BOTTLE_METHODS, VIEW_LABELS, bottleCamera, bottleText, bottleZone, methodDescription } from './bottle'
import type { BottleState, BottleView, CameraView } from './bottle'
import type { BottleMotionRequest } from './bottleMotion'
import { bottleViews } from './bottleViews'
import { ENDO, ENDO_STATE_LABELS, ENDO_VIEW_LABELS, endoText } from './endo'
import { ENDO_STATES } from './endoMotion'
import type { EndoState } from './endoMotion'
import { ENDO_VIEWS } from './endoViews'
import type { EndoView, EndoViewRequest } from './endoViews'
import { PILLOW, PILLOW_METHODS, PILLOW_VIEW_LABELS, pillowText } from './pillow'
import type { PillowMethod } from './pillow'
import { PILLOW_VIEWS } from './pillowViews'
import type { PillowView, PillowViewRequest } from './pillowViews'
import './endo.css'
import './pillow.css'

const IDS:SourceId[]=['bottle','endo','pillow']
const PRODUCTS={bottle:BOTTLE,endo:ENDO,pillow:PILLOW}
const CODES={bottle:'MO9431',endo:'P330.90',pillow:'MO3154'}
const PICKER={de:{title:'Produkt',label:'Produkt wählen',bottle:'Flasche',endo:'Endo',pillow:'Kissen'},en:{title:'Product',label:'Choose product',bottle:'Bottle',endo:'Endo',pillow:'Pillow'}}
interface Session {settings:SourceSettings;logo:LogoAsset|null;view:string;free:boolean}
type Sessions=Record<SourceId,Session>
type Slot=0|1
type Banks=[Sessions,Sessions]
interface Configuration {mode:'single'|'pair';slot:Slot;ids:[SourceId,SourceId]}
const sceneKey=(c:Configuration)=>c.mode==='pair'?'pair:'+c.ids.join(':'):`single:${c.slot}:${c.ids[c.slot]}`
const initialSessions=():Sessions=>Object.fromEntries(IDS.map(id=>[id,{settings:initialSettings(id),logo:sampleLogo(true),view:'overview',free:false}])) as Sessions
const PAIR_TEXT={
  de:{mode:'Szene',single:'1 Produkt',pair:'2 Produkte',slot:'Produkt',slots:'Produkt zum Gestalten wählen',scale:'Reale Proportionen',hint:'Beide Produkte behalten ihr echtes Größenverhältnis.',loading:'Komposition wird geladen…',spacing:'Produkte werden ausgerichtet…',motion:'Zustand wird geändert…',settling:'Komposition wird ausgerichtet…',overview:'Hero',front:'Größenvergleich',top:'Von oben'},
  en:{mode:'Scene',single:'1 product',pair:'2 products',slot:'Product',slots:'Choose a product to customize',scale:'True relative scale',hint:'Both products keep their actual size relative to each other.',loading:'Loading composition…',spacing:'Arranging products…',motion:'Changing state…',settling:'Arranging composition…',overview:'Hero',front:'Size comparison',top:'Top'},
}
type CameraSnapshot={moving?:boolean;[key:string]:unknown}
type MotionSnapshot=BottleMotionSnapshot|EndoMotionSnapshot
class ProductBoundary extends Component<{children:ReactNode;message:string},{error:boolean}>{
  state={error:false}
  static getDerivedStateFromError(){return {error:true}}
  render(){return this.state.error?<div className="scene-error" role="alert">{this.props.message}</div>:this.props.children}
}
function LogoThumbnail({logo,label}:{logo:LogoAsset|null;label:string}){
  const canvas=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{const c=canvas.current!.getContext('2d')!;c.clearRect(0,0,240,100);if(logo){const s=Math.min(220/logo.width,80/logo.height);c.drawImage(logo.image,(240-logo.width*s)/2,(100-logo.height*s)/2,logo.width*s,logo.height*s)}},[logo])
  return <canvas ref={canvas} className="logo-preview" width={240} height={100} aria-label={label}/>
}

/** Keep cached transforms in the authored rest pose, especially Endo's skin. */
function ProductAssembly({item,bottleView,endoView,pillowView,bottleMotion,endoRequest,onCamera,onMotion,onLayout,onInteract}:{item:StudioItem;bottleView:CameraView;endoView:EndoViewRequest;pillowView:PillowViewRequest;bottleMotion:BottleMotionRequest|null;endoRequest:{id:number;to:EndoState};onCamera:(next:object)=>void;onMotion:(next:MotionSnapshot)=>void;onLayout:(next:LayoutReport)=>void;onInteract:()=>void}){
  const instance=useMemo(()=>studioInstance(item.model),[item.model])
  const rendered=useMemo(()=>({...item,model:instance}),[item,instance])
  useEffect(()=>()=>instance.dispose(),[instance])
  if(item.settings.productId==='bottle')return <BottleAssembly item={rendered} view={bottleView} motion={bottleMotion} onCamera={onCamera} onMotion={onMotion} onLayout={onLayout} onInteract={onInteract}/>
  if(item.settings.productId==='endo')return <EndoAssembly item={rendered} view={endoView} request={endoRequest} onCamera={onCamera} onMotion={onMotion} onInteract={onInteract}/>
  return <PillowAssembly item={rendered} view={pillowView} onCamera={onCamera} onInteract={onInteract}/>
}

export function ProductStudio({initialId}:{initialId:SourceId}){
  const [language,setLanguage]=useState<Language>(readLanguage)
  const [config,setConfig]=useState<Configuration>(()=>{
    const query=new URLSearchParams(location.search),second=query.get('second')
    return {mode:query.get('mode')==='pair'?'pair':'single',slot:0,ids:[initialId,isSourceId(second)?second:initialId==='bottle'?'pillow':'bottle']}
  })
  const [requestedConfig,setRequestedConfig]=useState(config),[switching,setSwitching]=useState(false)
  const pair=config.mode==='pair',slot=config.slot,active=config.ids[slot],requested=requestedConfig.ids[slot]
  const [switchError,setSwitchError]=useState<SourceId|null>(null)
  const [banks,setBanks]=useState<Banks>(()=>[initialSessions(),initialSessions()])
  const sessions=banks[slot]
  const [models,setModels]=useState<Partial<Record<SourceId,SourceModel>>>({}),[modelErrors,setModelErrors]=useState<Partial<Record<SourceId,boolean>>>({})
  const [errors,setErrors]=useState<Record<string,LabErrorCode|null>>({}),[uploading,setUploading]=useState<Record<string,boolean>>({})
  const [camera,setCamera]=useState<CameraSnapshot|null>(null),[motionInfo,setMotionInfo]=useState<MotionSnapshot|null>(null),[layout,setLayout]=useState<LayoutReport|null>(null)
  const [bottleMotion,setBottleMotion]=useState<BottleMotionRequest|null>(null),[endoRequest,setEndoRequest]=useState({id:0,to:sessions.endo.settings.state as EndoState})
  const [pairMotion,setPairMotion]=useState<PairMotionSnapshot|null>(null),[pairView,setPairView]=useState<PairView>('overview'),[pairFree,setPairFree]=useState(false)
  const [serial,setSerial]=useState(0),[renderer,setRenderer]=useState(''),[cover,setCover]=useState<{src:string;fading:boolean}|null>(null)
  const sourceCache=useRef(new Map<SourceId,SourceModel>()),loads=useRef(new Map<SourceId,Promise<SourceModel>>()),loadAbort=useRef(new Map<SourceId,AbortController>()),alive=useRef(true)
  const current=useRef(active),currentConfig=useRef(config),wanted=useRef(config),failedConfig=useRef<Configuration|null>(null),busy=useRef(false),sessionRef=useRef(banks),motionId=useRef(0),motionLocked=useRef(false)
  const presented=useRef<(()=>void)|null>(null),save=useRef<((name:string)=>void)|null>(null),input=useRef<HTMLInputElement>(null),canvasHost=useRef<HTMLDivElement>(null)
  const uploadIds=useRef<Record<string,number>>({})
  sessionRef.current=banks
  const session=sessions[active],settings=session.settings,logo=session.logo,product=PRODUCTS[active],model=models[active]
  const t=active==='bottle'?bottleText[language]:active==='endo'?endoText[language]:pillowText[language],common=messages[language],picker=PICKER[language],pairText=PAIR_TEXT[language],contextKey=`${slot}:${active}`
  const state=settings.state,method=settings.decoration.technique,zone=product.zones.find(z=>z.id===settings.decoration.zone)!,surface=zone.surface as 'body'|'lid'
  const pairItems=useMemo<[StudioItem,StudioItem]|null>(()=>{
    if(!models[config.ids[0]]||!models[config.ids[1]])return null
    return config.ids.map((id,i)=>({key:i,model:models[id]!,settings:banks[i][id].settings,logo:banks[i][id].logo})) as [StudioItem,StudioItem]
  },[config.ids,models,banks])
  const moving=pair?(pairMotion?.active??false):(motionInfo?.active??false),ready=pair?!!pairItems:!!model,locked=switching||!ready||!renderer,selectedView=pair?(pairFree?null:pairView):session.free?null:session.view
  const item=useMemo<StudioItem|undefined>(()=>model?{key:0,model,settings,logo}:undefined,[model,settings,logo])
  const bottleSurface=BOTTLE.zones.find(z=>z.id===sessions.bottle.settings.decoration.zone)!.surface as 'body'|'lid'
  const bottleView=useMemo(()=>bottleCamera(sessions.bottle.settings.state as BottleState,sessions.bottle.view as BottleView,bottleSurface,serial),[sessions.bottle.settings.state,sessions.bottle.view,bottleSurface,serial])
  const endoView=useMemo<EndoViewRequest>(()=>({id:sessions.endo.view as EndoView,state:sessions.endo.settings.state as EndoState,serial}),[sessions.endo.view,sessions.endo.settings.state,serial])
  const pillowView=useMemo<PillowViewRequest>(()=>({id:sessions.pillow.view as PillowView,serial}),[sessions.pillow.view,serial])
  const load=useCallback((id:SourceId):Promise<SourceModel>=>{
    const existing=sourceCache.current.get(id);if(existing)return Promise.resolve(existing)
    const pending=loads.current.get(id);if(pending)return pending
    setModelErrors(e=>({...e,[id]:false}))
    const controller=new AbortController();loadAbort.current.set(id,controller)
    const promise=loadSourceModel(PRODUCTS[id],{signal:controller.signal}).then(asset=>{if(!alive.current){asset.dispose();throw Error('Studio closed')}sourceCache.current.set(id,asset);setModels(m=>({...m,[id]:asset}));return asset}).catch(error=>{loads.current.delete(id);if(alive.current)setModelErrors(e=>({...e,[id]:true}));throw error}).finally(()=>loadAbort.current.delete(id))
    loads.current.set(id,promise);return promise
  },[])
  useEffect(()=>{alive.current=true;(currentConfig.current.mode==='pair'?currentConfig.current.ids:[initialId]).forEach(id=>{void load(id).catch(()=>{})});return()=>{alive.current=false;presented.current?.();loadAbort.current.forEach(controller=>controller.abort());sourceCache.current.forEach(asset=>asset.dispose());sourceCache.current.clear();loads.current.clear();loadAbort.current.clear()}},[initialId,load])
  useEffect(()=>{if(!renderer)return;const timer=setTimeout(()=>{IDS.filter(id=>id!==current.current).forEach(id=>{void load(id).catch(()=>{})})},200);return()=>clearTimeout(timer)},[renderer,load])
  useEffect(()=>{document.documentElement.lang=language;persistLanguage(language);document.querySelector('meta[name="description"]')?.setAttribute('content',common.description)},[language,common.description])
  useEffect(()=>{const url=new URL(location.href);url.searchParams.set('model',pair?config.ids[0]:active);if(pair){url.searchParams.set('mode','pair');url.searchParams.set('second',config.ids[1])}else{url.searchParams.delete('mode');url.searchParams.delete('second')}history.replaceState(null,'',url)},[pair,config.ids,active])
  const editAt=(index:Slot,id:SourceId,update:(previous:Session)=>Session)=>setBanks(old=>{const next=[...old] as Banks;next[index]={...old[index],[id]:update(old[index][id])};return next})
  const edit=(id:SourceId,update:(previous:Session)=>Session)=>editAt(slot,id,update)
  const onReady=useCallback((capture:(name:string)=>void,version:string)=>{save.current=capture;setRenderer(version);setCover(null);const resolve=presented.current;presented.current=null;resolve?.()},[])
  const onPrepared=useCallback(()=>setCover(old=>old?{...old,fading:true}:null),[])
  const onCamera=useCallback((next:object)=>setCamera(next as CameraSnapshot),[])
  const onLayout=useCallback((next:LayoutReport)=>setLayout(next),[])
  const onMotion=useCallback((next:MotionSnapshot)=>{if(currentConfig.current.mode==='pair'||current.current==='bottle'&&next.id!==motionId.current)return;motionLocked.current=next.active;setMotionInfo(next)},[])
  const onPairMotion=useCallback((next:PairMotionSnapshot)=>{if(currentConfig.current.mode!=='pair')return;motionLocked.current=next.active;setPairMotion(next)},[])
  const onInteract=useCallback(()=>{if(currentConfig.current.mode==='pair')setPairFree(true);else{const c=currentConfig.current;editAt(c.slot,c.ids[c.slot],s=>({...s,free:true}))}},[])
  const chooseSlot=useCallback((value:number)=>{if(busy.current||currentConfig.current.mode!=='pair')return;const next={...currentConfig.current,slot:value as Slot};currentConfig.current=next;wanted.current=next;current.current=next.ids[next.slot];setConfig(next);setRequestedConfig(next)},[])

  async function chooseConfiguration(nextConfig:Configuration){
    wanted.current=nextConfig;setRequestedConfig(nextConfig);setSwitchError(null)
    if(busy.current||sceneKey(nextConfig)===sceneKey(currentConfig.current))return
    busy.current=true;setSwitching(true)
    try{
      while(alive.current&&sceneKey(wanted.current)!==sceneKey(currentConfig.current)){
        const next=wanted.current
        const required=next.mode==='pair'?next.ids:[next.ids[next.slot]]
        try{await Promise.all(required.map(load))}catch{if(!alive.current)return;if(next===wanted.current){failedConfig.current=next;setSwitchError(next.ids[next.slot]);setRequestedConfig(currentConfig.current);wanted.current=currentConfig.current;break}continue}
        if(sceneKey(next)!==sceneKey(wanted.current))continue
        let src:string|undefined
        try{const canvas=canvasHost.current?.querySelector('canvas');if(canvas){src=canvas.toDataURL('image/png');const image=new Image();image.src=src;await image.decode()}}catch{/* The prepared CSS background still covers a failed snapshot. */}
        if(!alive.current)return
        if(sceneKey(next)!==sceneKey(wanted.current))continue
        const nextId=next.ids[next.slot]
        if(next.mode==='single'&&sessionRef.current[next.slot][nextId].free)editAt(next.slot,nextId,s=>({...s,free:false,view:'overview'}))
        const complete=new Promise<void>(resolve=>{presented.current=resolve})
        if(src)setCover({src,fading:false})
        currentConfig.current=next;current.current=nextId;motionLocked.current=false;setMotionInfo(null);setPairMotion(null);setCamera(null);setLayout(null);setBottleMotion(null);setPairFree(false)
        setEndoRequest(old=>({id:old.id+1,to:sessionRef.current[next.slot].endo.settings.state as EndoState}))
        setConfig(next);setSerial(n=>n+1)
        await complete
      }
    }finally{busy.current=false;if(alive.current)setSwitching(false)}
  }
  function chooseProduct(id:SourceId){const next={...wanted.current,ids:[...wanted.current.ids] as Configuration['ids']};next.ids[next.slot]=id;return chooseConfiguration(next)}
  function chooseMode(mode:Configuration['mode']){return chooseConfiguration({...wanted.current,mode})}
  function show(view:string){if(pair){setPairView(view as PairView);setPairFree(false)}else edit(active,s=>({...s,view,free:false}));setSerial(n=>n+1)}
  function chooseState(next:string){
    if(locked||(pair||active==='bottle')&&motionLocked.current||next===state)return
    if(pair){motionLocked.current=true;setPairView('overview');setPairFree(false)}
    else if(active==='bottle'){motionLocked.current=true;setBottleMotion({id:++motionId.current,from:state as BottleState,to:next as BottleState})}
    else if(active==='endo')setEndoRequest(old=>({id:old.id+1,to:next as EndoState}))
    edit(active,s=>({...s,settings:{...s.settings,state:next},view:'overview',free:false}));setSerial(n=>n+1)
  }
  function chooseSurface(next:'body'|'lid'){
    const technique=BOTTLE_METHODS[next].includes(method)?method:'laser'
    edit(active,s=>({...s,settings:{...s.settings,decoration:{...s.settings.decoration,zone:bottleZone(next,technique).id,technique}},view:'branding',free:false}));setSerial(n=>n+1)
    if(pair){setPairView(next==='lid'?'top':'overview');setPairFree(false)}
  }
  function chooseMethod(value:string){
    if(value==='none'){edit(active,s=>({...s,settings:{...s.settings,enabled:false}}));return}
    const technique=value as TechniqueId,nextZone=active==='bottle'?bottleZone(surface,technique):active==='endo'?ENDO.zones.find(z=>z.id===(technique==='pad'?'pad-front':'front'))!:PILLOW.zones[0]
    edit(active,s=>({...s,settings:{...s.settings,enabled:true,decoration:{zone:nextZone.id,technique,colors:Math.min(s.settings.decoration.colors,TECHNIQUES[technique].maxColors??8)}}}))
  }
  async function upload(file:File){
    const id=active,index=slot,key=contextKey,token=(uploadIds.current[key]??0)+1;uploadIds.current[key]=token;setUploading(old=>({...old,[key]:true}));setErrors(old=>({...old,[key]:null}))
    try{const next=await readLogo(file);if(uploadIds.current[key]===token)editAt(index,id,s=>({...s,logo:next}))}catch(e){if(uploadIds.current[key]===token)setErrors(old=>({...old,[key]:e instanceof LabError?e.code:'logoRead'}))}finally{if(uploadIds.current[key]===token)setUploading(old=>({...old,[key]:false}))}
  }
  function download(){
    try{save.current?.(pair?`scene-${config.ids.map((id,i)=>id+'-'+banks[i][id].settings.state).join('__')}-${selectedView??'free'}.png`:`${active}-${state}-${selectedView??'free'}-${settings.enabled?method:'plain'}.png`)}catch{setErrors(old=>({...old,[contextKey]:'pngSave'}))}
  }
  const views=pair?PAIR_VIEWS:active==='bottle'?bottleViews(state as BottleState,surface):active==='endo'?ENDO_VIEWS[state as EndoState]:PILLOW_VIEWS
  const methods:readonly TechniqueId[]=active==='bottle'?BOTTLE_METHODS[surface]:active==='endo'?['laser','pad']:PILLOW_METHODS
  const viewLabel=(id:string)=>pair?pairText[id as PairView]:active==='bottle'?(id==='top'&&surface==='lid'?'Detail':VIEW_LABELS[id as BottleView][language]):active==='endo'?ENDO_VIEW_LABELS[state==='box-closed'?'package':id as EndoView][language]:PILLOW_VIEW_LABELS[id as PillowView][language]
  let movementLabel=''
  if(active==='bottle'&&bottleMotion){const b=bottleText[language],m=bottleMotion;movementLabel=m.to==='lying'?(m.from==='open'?b.closeLay:b.laying):m.to==='open'?(m.from==='lying'?b.standOpen:b.opening):m.from==='open'?b.closing:b.standing}
  if(active==='endo'&&motionInfo){const e=endoText[language];movementLabel=(motionInfo.phase==='open'?e.open:motionInfo.phase==='extract'?e.extract:e.wrap)+' · '+e.queued+': '+ENDO_STATE_LABELS[state as EndoState][language]}
  if(pair&&pairMotion?.active)movementLabel=pairText[pairMotion.phase as 'spacing'|'motion'|'settling']
  const description=active==='bottle'?methodDescription(method,surface,language):active==='endo'?(method==='laser'?endoText[language].laser:endoText[language].pad):pillowText[language][method as PillowMethod]
  const colourLabel=active==='bottle'?bottleText[language].color:endoText[language].colour
  const colour=product.colors.find(c=>c.id===settings.color)!
  const shadowEpoch=pair?pairMotion?.id??0:motionInfo&&'epoch'in motionInfo?motionInfo.epoch:motionInfo?.id??0
  const presentation=sceneKey(config),shadowState=pair?config.ids.map((id,i)=>banks[i][id].settings.state).join(':'):state
  const hasModelError=pair?config.ids.some(id=>modelErrors[id]):modelErrors[active]
  return <div style={STUDIO_STYLE} className={`app-shell source-studio bottle-studio product-studio ${pair?'pair-studio':active==='bottle'?'':active+'-studio'}`} data-animating={moving} data-mode={config.mode} data-active-slot={slot} data-active-product={active} data-requested-product={requested} data-switching={switching}>
    <header className="topbar"><div className="brand" aria-label="S. 3DLABS"><span className="brand-icon"><Icon name="cube" size={23}/></span><h1 className="brand-name"><span className="brand-initial">S<span className="brand-dot">.</span></span><span className="brand-rule"/><span className="brand-labs">3DLABS</span></h1></div><div className="language-picker" role="group" aria-label={common.language}>{(['de','en'] as const).map(lang=><button key={lang} lang={lang} aria-label={lang==='de'?'Deutsch':'English'} aria-pressed={language===lang} onClick={()=>setLanguage(lang)}>{lang.toUpperCase()}</button>)}</div></header>
    <main className="lab">
      <section className="viewport" aria-label={pair?config.ids.map(id=>picker[id]).join(" + "):t.scene} aria-busy={moving||switching} data-testid={pair?'pair-scene':active+'-scene'} data-model-ready={ready} data-config={JSON.stringify(pair?config.ids:[active])} data-mode={config.mode} data-items={JSON.stringify((pair?config.ids:[active]).map((id,i)=>{const session=banks[pair?i:slot][id];return {slot:pair?i:slot,id,state:session.settings.state,color:session.settings.color,technique:session.settings.decoration.technique,logo:session.logo?.name}}))} data-product={active} data-state={state} data-view={selectedView??'free'} data-surface={active==='bottle'?surface:undefined} data-color={settings.color} data-method={settings.enabled?method:'none'} data-ink-count={settings.decoration.colors} data-renderer={renderer||undefined} data-camera={camera?JSON.stringify(camera):undefined} data-camera-request={serial} data-motion={motionInfo?JSON.stringify(motionInfo):undefined} data-layout={layout?JSON.stringify(layout):undefined} data-transitioning={moving||!!camera?.moving} data-switching={switching}>
        <div className="scene-canvas" ref={canvasHost}><ProductBoundary message={common.webgl}><StudioStage ready={ready} moving={moving} composition={pair} shadowKey={`${presentation}:${shadowState}:${shadowEpoch}`} presentationKey={presentation} onPrepared={onPrepared} onReady={onReady} fallback={common.webgl}>{pair?pairItems&&<PairScene key={presentation} items={pairItems} view={{id:pairView,serial}} onCamera={onCamera} onMotion={onPairMotion} onLayout={onLayout} onInteract={onInteract} onSelect={chooseSlot}/>:item&&<ProductAssembly key={presentation} item={item} bottleView={bottleView} endoView={endoView} pillowView={pillowView} bottleMotion={bottleMotion} endoRequest={endoRequest} onCamera={onCamera} onMotion={onMotion} onLayout={onLayout} onInteract={onInteract}/>}</StudioStage></ProductBoundary>{cover&&<img className="product-handoff" data-fading={cover.fading} data-reduced-motion={studioReducedMotion()} src={cover.src} alt="" aria-hidden="true"/>}</div>
        <div className="viewer-heading bottle-heading"><div><h2>{pair?config.ids.map(id=>picker[id]).join(' + '):t.title}</h2><p>{pair?pairText.scale:t.subtitle}</p></div><span className="viewer-badge">360°</span></div>
        {(!ready||!renderer)&&!hasModelError&&<div className="scene-message" role="status"><span className="loading-ring"/>{pair?pairText.loading:t.loading}</div>}
        {hasModelError&&<div className="scene-message error" role="alert">{common.errors.modelRead}<button onClick={()=>{(pair?config.ids:[active]).forEach(id=>{void load(id).catch(()=>{})})}}>{t.retry}</button></div>}
        <div className="bottle-view-controls"><div className="view-label" aria-live="polite">{switching?(pair?pairText.loading:requested==='bottle'?bottleText[language].loading:requested==='endo'?endoText[language].loading:pillowText[language].loading):moving?movementLabel:!pair&&active==='endo'&&state==='box-closed'?endoText[language].hidden:selectedView?t.views:t.free}</div><div className="view-buttons" role="group" aria-label={t.views}>{views.map(id=><button key={id} aria-pressed={selectedView===id} disabled={locked||moving} onClick={()=>show(id)}>{viewLabel(id)}</button>)}</div></div>
        <div className="viewer-footer"><div className="viewer-hint"><Icon name="rotate" size={16}/><span className="desktop-hint">{common.orbit}<span className="hint-dot">·</span>{common.zoom}</span><span className="touch-hint">{common.touch}</span></div><button className="reset-view" aria-label={t.reset} title={t.reset} disabled={locked||moving} onClick={()=>show('overview')}><Icon name="reset" size={18}/></button></div>
      </section>
      <aside className="controls bottle-controls" aria-label={common.controls}>
        <section className="studio-product-selector"><div className="studio-mode-picker" role="group" aria-label={pairText.mode}>{(['single','pair'] as const).map(mode=><button key={mode} data-mode={mode} aria-pressed={requestedConfig.mode===mode} disabled={!renderer&&!hasModelError} onClick={()=>{void chooseMode(mode)}}>{pairText[mode]}</button>)}</div>{pair&&<div className="studio-slot-picker" role="group" aria-label={pairText.slots}>{config.ids.map((id,i)=><button key={i} data-slot={i} aria-label={`${pairText.slot} ${i+1}: ${picker[id]}`} aria-pressed={slot===i} disabled={switching} onClick={()=>chooseSlot(i)}><span className="studio-slot-number">{i+1}</span><Icon name={id} size={17}/><span>{picker[id]}</span></button>)}</div>}<h2>{pair?`${pairText.slot} ${slot+1}`:picker.title}</h2><div className="studio-product-buttons" role="group" aria-label={picker.label}>{IDS.map(id=><button key={id} data-product={id} aria-pressed={requested===id} aria-busy={switching&&requested===id} disabled={!renderer&&!hasModelError} onClick={()=>{void chooseProduct(id)}}><Icon name={id} size={23}/><span>{picker[id]}</span></button>)}</div>{pair&&<p className="studio-scale-note">{pairText.hint}</p>}{switchError&&<p className="inline-error" role="alert">{picker[switchError]}: {common.errors.modelRead} <button onClick={()=>{if(failedConfig.current)void chooseConfiguration(failedConfig.current)}}>{t.retry}</button></p>}</section>
        <div className="bottle-settings" key={contextKey}><fieldset className="studio-product-fields" disabled={switching}>
          {active!=='pillow'?<><section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">01</span><h2>{active==='bottle'?bottleText[language].state:endoText[language].state}</h2></div><div className={'bottle-state-picker '+(active==='endo'?'endo-state-picker':'')} role="group" aria-label={active==='bottle'?bottleText[language].state:endoText[language].state}>{(active==='bottle'?['closed','open','lying']:ENDO_STATES).map(id=><button key={id} aria-pressed={state===id} disabled={locked||(pair||active==='bottle')&&moving} onClick={()=>chooseState(id)}>{active==='bottle'?bottleText[language][id as BottleState]:ENDO_STATE_LABELS[id as EndoState][language]}</button>)}</div></section><section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">02</span><h2>{colourLabel}</h2><span className="chosen-color">{colour.label[language]}</span></div><div className="color-picker" role="group" aria-label={colourLabel}>{product.colors.map(c=><button key={c.id} aria-label={c.label[language]} title={c.label[language]} aria-pressed={settings.color===c.id} onClick={()=>edit(active,s=>({...s,settings:{...s.settings,color:c.id}}))}><span style={{background:c.hex}}/>{settings.color===c.id&&<Icon name="check" size={11}/>}</button>)}</div></section></>:<section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">01</span><h2>{language==='de'?'Farbe & Material':'Colour & material'}</h2></div><div className="pillow-product-info"><span className="pillow-colour-swatch" aria-hidden="true"/><div><strong>{pillowText[language].colour}</strong><p>{pillowText[language].material}</p></div></div></section>}
          <section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">{active==='pillow'?'02':'03'}</span><h2>{t.logo}</h2></div><input ref={input} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" aria-label={common.logoFile} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file)}}/><div className="bottle-logo-upload" onDragOver={e=>{if(!switching)e.preventDefault()}} onDrop={e=>{e.preventDefault();if(!switching){const file=e.dataTransfer.files[0];if(file)void upload(file)}}}><button className="bottle-logo-choice" disabled={uploading[contextKey]} aria-busy={uploading[contextKey]} aria-label={logo&&!logo.sample?t.replace:t.upload} onClick={()=>input.current?.click()}><LogoThumbnail logo={logo} label={common.logoPreview}/><span><strong>{uploading[contextKey]?common.loading:logo?logo.sample?t.sample:logo.name:common.noLogo}</strong><small>{logo&&!logo.sample?t.replace:t.upload}</small></span><Icon name="upload" size={17}/></button><button className="clear-logo" aria-label={logo?t.remove:t.restore} title={logo?t.remove:t.restore} onClick={()=>{uploadIds.current[contextKey]=(uploadIds.current[contextKey]??0)+1;setUploading(old=>({...old,[contextKey]:false}));edit(active,s=>({...s,logo:s.logo?null:sampleLogo(true)}));setErrors(old=>({...old,[contextKey]:null}))}}><Icon name={logo?'close':'reset'} size={15}/></button></div><p className="logo-formats">{t.formats}</p>{errors[contextKey]&&<p className="inline-error" role="alert">{common.errors[errors[contextKey]!]}</p>}</section>
          <section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">{active==='pillow'?'03':'04'}</span><h2>{t.branding}</h2>{settings.enabled&&<span className="print-area-label" aria-label={`${t.area}: ${zone.widthMm} × ${zone.heightMm} mm`}>{zone.widthMm} × {zone.heightMm} mm</span>}</div>{active==='bottle'&&<div className="bottle-placement" role="group" aria-label={bottleText[language].location}>{(['body','lid'] as const).map(id=><button key={id} aria-pressed={surface===id} disabled={locked||moving} onClick={()=>chooseSurface(id)}>{bottleText[language][id]}</button>)}</div>}<label className="select-field method-field"><span className="visually-hidden">{t.method}</span><select aria-label={t.method} value={settings.enabled?method:'none'} onChange={e=>chooseMethod(e.target.value)}><option value="none">{t.none}</option>{methods.map(id=><option key={id} value={id}>{TECHNIQUES[id].label[language]}</option>)}</select></label><div className="decoration-meta" aria-live="polite"><p>{settings.enabled?description:t.hide}</p>{active==='endo'&&state==='box-closed'&&settings.enabled&&<p>{endoText[language].hidden}</p>}</div>{settings.enabled&&(TECHNIQUES[method].maxColors??0)>1&&<div className="ink-controls"><span>{active==='bottle'?bottleText[language].colors:endoText[language].colours}</span><div role="group" aria-label={active==='bottle'?bottleText[language].colors:endoText[language].colours}>{Array.from({length:TECHNIQUES[method].maxColors!},(_,i)=>i+1).map(n=><button key={n} aria-pressed={settings.decoration.colors===n} onClick={()=>edit(active,s=>({...s,settings:{...s.settings,decoration:{...s.settings.decoration,colors:n}}}))}>{n}</button>)}</div></div>}</section>
        </fieldset></div>
        <div className="panel-footer"><button className="save" disabled={locked||uploading[contextKey]||moving||!!camera?.moving} onClick={download}><span>{t.download}</span><Icon name="download" size={19}/></button><a className="bottle-reference" href={product.source} target="_blank" rel="noreferrer">{t.source} · {CODES[active]}<Icon name="arrow" size={12}/></a></div>
      </aside>
    </main>
  </div>
}
