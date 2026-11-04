import { STUDIO_STYLE } from './studioLook'
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { messages, readLanguage, persistLanguage } from './i18n'
import type { Language } from './i18n'
import { LabError } from './errors'
import type { LabErrorCode } from './errors'
import { readLogo, sampleLogo } from './logo'
import type { LogoAsset } from './types'
import { initialSettings, TECHNIQUES } from './sourceCatalog'
import type { TechniqueId } from './sourceCatalog'
import { loadSourceModel } from './sourceModel'
import type { SourceModel } from './sourceModel'
import { BottleScene } from './BottleScene'
import type { BottleMotionSnapshot } from './BottleScene'
import type { BottleMotionRequest } from './bottleMotion'
import type { LayoutReport, StudioItem } from './SourceScene'
import { BOTTLE, BOTTLE_METHODS, VIEW_LABELS, bottleCamera, bottleText, bottleZone, methodDescription } from './bottle'
import { bottleViews } from './bottleViews'
import type { BottleState, BottleView } from './bottle'

class BottleBoundary extends Component<{children:ReactNode;message:string},{error:boolean}>{
  state={error:false}
  static getDerivedStateFromError(){return {error:true}}
  render(){return this.state.error?<div className="scene-error" role="alert">{this.props.message}</div>:this.props.children}
}
function LogoThumbnail({logo,label}:{logo:LogoAsset|null;label:string}){
  const canvas=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const c=canvas.current!.getContext('2d')!
    c.clearRect(0,0,240,100)
    if(logo){const s=Math.min(220/logo.width,80/logo.height);c.drawImage(logo.image,(240-logo.width*s)/2,(100-logo.height*s)/2,logo.width*s,logo.height*s)}
  },[logo])
  return <canvas ref={canvas} className="logo-preview" width={240} height={100} aria-label={label}/>
}
export function BottleStudio(){
  const [language,setLanguage]=useState<Language>(readLanguage)
  const [settings,setSettings]=useState(()=>initialSettings('bottle'))
  const [logo,setLogo]=useState<LogoAsset|null>(()=>sampleLogo(true))
  const [model,setModel]=useState<SourceModel|null>(null)
  const [error,setError]=useState<LabErrorCode|null>(null)
  const [modelError,setModelError]=useState(false)
  const [retry,setRetry]=useState(0)
  const [uploading,setUploading]=useState(false)
  const [selectedView,setSelectedView]=useState<BottleView|null>('overview')
  const [cameraRequest,setCameraRequest]=useState(()=>({state:'closed' as BottleState,view:'overview' as BottleView,surface:'body' as 'body'|'lid',serial:0}))
  const [cameraSnapshot,setCameraSnapshot]=useState<{moving?:boolean}|null>(null)
  const [motion,setMotion]=useState<BottleMotionRequest|null>(null)
  const [motionSnapshot,setMotionSnapshot]=useState<BottleMotionSnapshot|null>(null)
  const [animating,setAnimating]=useState(false)
  const motionId=useRef(0),motionLocked=useRef(false)
  const [renderer,setRenderer]=useState('')
  const [report,setReport]=useState<LayoutReport|null>(null)
  const input=useRef<HTMLInputElement>(null),uploadId=useRef(0),save=useRef<((filename:string)=>void)|null>(null)
  const state=settings.state as BottleState
  const zone=BOTTLE.zones.find(z=>z.id===settings.decoration.zone)!
  const surface=zone.surface as 'body'|'lid'
  const t=bottleText[language],common=messages[language]
  const color=BOTTLE.colors.find(c=>c.id===settings.color)!
  const method=settings.decoration.technique,methodInfo=TECHNIQUES[method]
  const movingLabel=motion?.to==='lying'?(motion.from==='open'?t.closeLay:t.laying):motion?.to==='open'?(motion.from==='lying'?t.standOpen:t.opening):motion?.from==='open'?t.closing:t.standing
  const items=useMemo<StudioItem[]>(()=>model?[{key:0,model,settings,logo}]:[],[model,settings,logo])
  const camera=useMemo(()=>bottleCamera(cameraRequest.state,cameraRequest.view,cameraRequest.surface,cameraRequest.serial),[cameraRequest])
  useEffect(()=>{
    document.documentElement.lang=language
    persistLanguage(language)
    document.querySelector('meta[name="description"]')?.setAttribute('content',common.description)
  },[language,common.description])
  useEffect(()=>{
    const url=new URL(location.href);url.searchParams.set('model','bottle');url.searchParams.delete('second');history.replaceState(null,'',url)
  },[])
  useEffect(()=>{
    let cancelled=false,owned:SourceModel|undefined
    setModelError(false)
    void loadSourceModel(BOTTLE).then(asset=>{if(cancelled){asset.dispose();return}owned=asset;setModel(asset)}).catch(()=>{if(!cancelled)setModelError(true)})
    return()=>{cancelled=true;owned?.dispose()}
  },[retry])
  const onReady=useCallback((capture:(filename:string)=>void,version:string)=>{save.current=capture;setRenderer(version)},[])
  const onLayout=useCallback((next:LayoutReport)=>setReport(next),[])
  const onCamera=useCallback((next:object)=>setCameraSnapshot(next),[])
  const onInteract=useCallback(()=>setSelectedView(null),[])
  const onMotion=useCallback((next:BottleMotionSnapshot)=>{
    if(next.id!==motionId.current)return
    setMotionSnapshot(next);setAnimating(next.active);motionLocked.current=next.active
  },[])
  function show(view:BottleView,nextState=state,nextSurface=surface){
    setSelectedView(view)
    setCameraRequest(old=>({state:nextState,view,surface:nextSurface,serial:old.serial+1}))
  }
  useEffect(()=>{if(!bottleViews(cameraRequest.state,cameraRequest.surface).includes(cameraRequest.view))show('overview',cameraRequest.state,cameraRequest.surface)},[cameraRequest.state,cameraRequest.view,cameraRequest.surface])
  function chooseState(next:BottleState){
    if(motionLocked.current||!model)return
    if(next!==state){motionLocked.current=true;setAnimating(true);setMotion({id:++motionId.current,from:state,to:next})}
    setSettings(s=>({...s,state:next}));show('overview',next)
  }
  function chooseSurface(next:'body'|'lid'){
    const technique=BOTTLE_METHODS[next].includes(method)?method:'laser'
    setSettings(s=>({...s,decoration:{...s.decoration,zone:bottleZone(next,technique).id,technique}}))
    show('branding',state,next)
  }
  function chooseMethod(value:string){
    if(value==='none'){setSettings(s=>({...s,enabled:false}));return}
    const technique=value as TechniqueId
    setSettings(s=>({...s,enabled:true,decoration:{zone:bottleZone(surface,technique).id,technique,colors:Math.min(s.decoration.colors,TECHNIQUES[technique].maxColors??4)}}))
  }
  async function upload(file:File){
    const id=++uploadId.current;setUploading(true);setError(null)
    try{const next=await readLogo(file);if(uploadId.current===id)setLogo(next)}
    catch(e){if(uploadId.current===id)setError(e instanceof LabError?e.code:'logoRead')}
    finally{if(uploadId.current===id)setUploading(false)}
  }
  return <div style={STUDIO_STYLE} className="app-shell source-studio bottle-studio" data-animating={animating}>
    <header className="topbar"><div className="brand" aria-label="S. 3DLABS"><span className="brand-icon"><Icon name="cube" size={23}/></span><h1 className="brand-name"><span className="brand-initial">S<span className="brand-dot">.</span></span><span className="brand-rule"/><span className="brand-labs">3DLABS</span></h1></div><div className="language-picker" role="group" aria-label={common.language}>{(['de','en'] as const).map(lang=><button key={lang} lang={lang} aria-label={lang==='de'?'Deutsch':'English'} aria-pressed={language===lang} onClick={()=>setLanguage(lang)}>{lang.toUpperCase()}</button>)}</div></header>
    <main className="lab">
      <section className="viewport" aria-label={t.scene} aria-busy={animating} data-testid="bottle-scene" data-model-ready={!!model} data-product="bottle" data-state={state} data-view={selectedView??'free'} data-camera-request={cameraRequest.serial} data-color={settings.color} data-method={settings.enabled?method:'none'} data-surface={surface} data-renderer={renderer||undefined} data-layout={report?JSON.stringify(report):undefined} data-camera={cameraSnapshot?JSON.stringify(cameraSnapshot):undefined} data-transitioning={animating} data-motion={motionSnapshot?JSON.stringify(motionSnapshot):undefined}>
        <div className="scene-canvas"><BottleBoundary message={common.webgl}><BottleScene item={items[0]} onReady={onReady} onLayout={onLayout} fallback={common.webgl} view={camera} motion={motion} onMotion={onMotion} onInteract={onInteract} onCamera={onCamera}/></BottleBoundary></div>
        <div className="viewer-heading bottle-heading"><div><h2>{t.title}</h2><p>{t.subtitle}</p></div><span className="viewer-badge">360°</span></div>
        {(!model||!renderer)&&!modelError&&<div className="scene-message" role="status"><span className="loading-ring"/>{t.loading}</div>}
        {modelError&&<div className="scene-message error" role="alert">{common.errors.modelRead}<button onClick={()=>setRetry(n=>n+1)}>{t.retry}</button></div>}
        <div className="bottle-view-controls"><div className="view-label" aria-live="polite">{animating?movingLabel:selectedView?t.views:t.free}</div><div className="view-buttons" role="group" aria-label={t.views}>{bottleViews(state,surface).map(view=><button key={view} aria-pressed={selectedView===view} disabled={!model||!renderer||animating} onClick={()=>show(view)}>{view==='top'&&surface==='lid'?'Detail':VIEW_LABELS[view][language]}</button>)}</div></div>
        <div className="viewer-footer"><div className="viewer-hint"><Icon name="rotate" size={16}/><span className="desktop-hint">{common.orbit}<span className="hint-dot">·</span>{common.zoom}</span><span className="touch-hint">{common.touch}</span></div><button className="reset-view" aria-label={t.reset} title={t.reset} disabled={!model||!renderer||animating} onClick={()=>show('overview')}><Icon name="reset" size={18}/></button></div>
      </section>
      <aside className="controls bottle-controls" aria-label={common.controls}>
        <div className="bottle-settings">
        <section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">01</span><h2>{t.state}</h2></div><div className="bottle-state-picker" role="group" aria-label={t.state}>{(['closed','open','lying'] as const).map(id=><button key={id} aria-pressed={state===id} disabled={!model||!renderer||animating} onClick={()=>chooseState(id)}>{t[id]}</button>)}</div></section>
        <section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">02</span><h2>{t.color}</h2><span className="chosen-color">{color.label[language]}</span></div><div className="color-picker" role="group" aria-label={t.color}>{BOTTLE.colors.map(c=><button key={c.id} aria-label={c.label[language]} title={c.label[language]} aria-pressed={settings.color===c.id} onClick={()=>setSettings(s=>({...s,color:c.id}))}><span style={{background:c.hex}}/>{settings.color===c.id&&<Icon name="check" size={11}/>}</button>)}</div></section>
        <section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">03</span><h2>{t.logo}</h2></div><input ref={input} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" aria-label={common.logoFile} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file)}}/><div className="bottle-logo-upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file)void upload(file)}}><button className="bottle-logo-choice" disabled={uploading} aria-busy={uploading} aria-label={logo&&!logo.sample?t.replace:t.upload} onClick={()=>input.current?.click()}><LogoThumbnail logo={logo} label={common.logoPreview}/><span><strong>{uploading?common.loading:logo?logo.sample?t.sample:logo.name:common.noLogo}</strong><small>{logo&&!logo.sample?t.replace:t.upload}</small></span><Icon name="upload" size={17}/></button><button className="clear-logo" aria-label={logo?t.remove:t.restore} title={logo?t.remove:t.restore} onClick={()=>{uploadId.current++;setUploading(false);setLogo(logo?null:sampleLogo(true));setError(null)}}><Icon name={logo?'close':'reset'} size={15}/></button></div><p className="logo-formats">{t.formats}</p>{error&&<p className="inline-error" role="alert">{common.errors[error]}</p>}</section>
        <section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">04</span><h2>{t.branding}</h2>{settings.enabled&&<span className="print-area-label" title={t.area} aria-label={`${t.area}: ${zone.widthMm} × ${zone.heightMm} mm`}>{zone.widthMm} × {zone.heightMm} mm</span>}</div><div className="bottle-placement" role="group" aria-label={t.location}>{(['body','lid'] as const).map(id=><button key={id} aria-pressed={surface===id} disabled={!renderer||animating} onClick={()=>chooseSurface(id)}>{t[id]}</button>)}</div><label className="select-field method-field"><span className="visually-hidden">{t.method}</span><select aria-label={t.method} value={settings.enabled?method:'none'} onChange={e=>chooseMethod(e.target.value)}><option value="none">{t.none}</option>{BOTTLE_METHODS[surface].map(id=><option key={id} value={id}>{TECHNIQUES[id].label[language]}</option>)}</select></label><div className="decoration-meta" aria-live="polite">{settings.enabled?<><p>{methodDescription(method,surface,language)}</p></>:<p>{t.hide}</p>}</div>{settings.enabled&&methodInfo.maxColors&&methodInfo.maxColors>1&&<div className="ink-controls"><span>{t.colors}</span><div role="group" aria-label={t.colors}>{Array.from({length:methodInfo.maxColors},(_,i)=><button key={i} aria-pressed={settings.decoration.colors===i+1} onClick={()=>setSettings(s=>({...s,decoration:{...s.decoration,colors:i+1}}))}>{i+1}</button>)}</div></div>}</section>
        </div>
        <div className="panel-footer"><button className="save" disabled={!model||!renderer||uploading||animating||!!cameraSnapshot?.moving} onClick={()=>{try{save.current?.(`bottle-${state}-${selectedView??'free'}-${settings.enabled?method:'plain'}.png`)}catch{setError('pngSave')}}}><span>{t.download}</span><Icon name="download" size={19}/></button><a className="bottle-reference" href={BOTTLE.source} target="_blank" rel="noreferrer">{t.source} · MO9431 <Icon name="arrow" size={12}/></a></div>
      </aside>
    </main>
  </div>
}
