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
import { loadSourceModel } from './sourceModel'
import type { SourceModel } from './sourceModel'
import type { StudioItem } from './SourceScene'
import { PillowScene } from './PillowScene'
import type { PillowCameraSnapshot } from './PillowScene'
import { PILLOW, PILLOW_METHODS, PILLOW_VIEW_LABELS, pillowText } from './pillow'
import type { PillowMethod } from './pillow'
import { PILLOW_VIEWS } from './pillowViews'
import type { PillowView, PillowViewRequest } from './pillowViews'
import './pillow.css'

class PillowBoundary extends Component<{children:ReactNode;message:string},{error:boolean}>{
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

export function PillowStudio(){
  const [language,setLanguage]=useState<Language>(readLanguage)
  const [settings,setSettings]=useState(()=>initialSettings('pillow'))
  const [logo,setLogo]=useState<LogoAsset|null>(()=>sampleLogo(true))
  const [model,setModel]=useState<SourceModel|null>(null),[modelError,setModelError]=useState(false),[retry,setRetry]=useState(0)
  const [error,setError]=useState<LabErrorCode|null>(null),[uploading,setUploading]=useState(false)
  const [selectedView,setSelectedView]=useState<PillowView|null>('overview')
  const [view,setView]=useState<PillowViewRequest>({id:'overview',serial:0})
  const [camera,setCamera]=useState<PillowCameraSnapshot|null>(null),[renderer,setRenderer]=useState('')
  const input=useRef<HTMLInputElement>(null),uploadId=useRef(0),save=useRef<((filename:string)=>void)|null>(null),trace=useRef<PillowCameraSnapshot[]>([])
  const t=pillowText[language],common=messages[language],method=settings.decoration.technique as PillowMethod
  const moving=camera?.moving??false
  const item=useMemo<StudioItem|undefined>(()=>model?{key:0,model,settings,logo}:undefined,[model,settings,logo])
  useEffect(()=>{document.documentElement.lang=language;persistLanguage(language)},[language])
  useEffect(()=>{
    let cancelled=false,owned:SourceModel|undefined
    setModelError(false)
    void loadSourceModel(PILLOW).then(asset=>{if(cancelled){asset.dispose();return}owned=asset;setModel(asset)}).catch(()=>{if(!cancelled)setModelError(true)})
    return()=>{cancelled=true;owned?.dispose()}
  },[retry])
  const onReady=useCallback((capture:(filename:string)=>void,version:string)=>{save.current=capture;setRenderer(version)},[])
  const onCamera=useCallback((next:PillowCameraSnapshot)=>{if(trace.current.at(-1)?.serial!==next.serial)trace.current=[];trace.current.push(next);if(trace.current.length>60)trace.current.shift();setCamera(next)},[])
  const onInteract=useCallback(()=>setSelectedView(null),[])
  function show(id:PillowView){setSelectedView(id);setView(old=>({id,serial:old.serial+1}))}
  useEffect(()=>{if(!PILLOW_VIEWS.some(id=>id===view.id))show('overview')},[view.id])
  function chooseMethod(value:string){
    if(value==='none'){setSettings(s=>({...s,enabled:false}));return}
    if(!PILLOW_METHODS.includes(value as PillowMethod))return
    const technique=value as PillowMethod
    setSettings(s=>({...s,enabled:true,decoration:{...s.decoration,technique,colors:Math.min(s.decoration.colors,TECHNIQUES[technique].maxColors??8)}}))
  }
  async function upload(file:File){
    const id=++uploadId.current;setUploading(true);setError(null)
    try{const next=await readLogo(file);if(uploadId.current===id)setLogo(next)}
    catch(e){if(uploadId.current===id)setError(e instanceof LabError?e.code:'logoRead')}
    finally{if(uploadId.current===id)setUploading(false)}
  }
  return <div style={STUDIO_STYLE} className="app-shell source-studio bottle-studio pillow-studio">
    <header className="topbar"><div className="brand" aria-label="S. 3DLABS"><span className="brand-icon"><Icon name="cube" size={23}/></span><h1 className="brand-name"><span className="brand-initial">S<span className="brand-dot">.</span></span><span className="brand-rule"/><span className="brand-labs">3DLABS</span></h1></div><div className="language-picker" role="group" aria-label={common.language}>{(['de','en'] as const).map(lang=><button key={lang} lang={lang} aria-label={lang==='de'?'Deutsch':'English'} aria-pressed={language===lang} onClick={()=>setLanguage(lang)}>{lang.toUpperCase()}</button>)}</div></header>
    <main className="lab">
      <section className="viewport" aria-label={t.scene} data-testid="pillow-scene" data-model-ready={!!model} data-state="ready" data-view={selectedView??'free'} data-camera-view={camera?.viewId} data-camera-request={view.serial} data-color="black" data-method={settings.enabled?method:'none'} data-ink-count={settings.decoration.colors} data-renderer={renderer||undefined} data-camera={camera?JSON.stringify(camera):undefined} data-transitioning={moving} data-camera-trace={JSON.stringify(trace.current)}>
        <div className="scene-canvas"><PillowBoundary key={retry} message={common.webgl}><PillowScene item={item} onReady={onReady} fallback={common.webgl} view={view} onCamera={onCamera} onInteract={onInteract}/></PillowBoundary></div>
        <div className="viewer-heading bottle-heading"><div><h2>{t.title}</h2><p>{t.subtitle}</p></div><span className="viewer-badge">360°</span></div>
        {(!model||!renderer)&&!modelError&&<div className="scene-message" role="status"><span className="loading-ring"/>{t.loading}</div>}
        {modelError&&<div className="scene-message error" role="alert">{common.errors.modelRead}<button onClick={()=>setRetry(n=>n+1)}>{t.retry}</button></div>}
        <div className="bottle-view-controls"><div className="view-label">{selectedView?t.views:t.free}</div><div className="view-buttons" role="group" aria-label={t.views}>{PILLOW_VIEWS.map(id=><button key={id} aria-pressed={selectedView===id} disabled={!model||!renderer} onClick={()=>show(id)}>{PILLOW_VIEW_LABELS[id][language]}</button>)}</div></div>
        <div className="viewer-footer"><div className="viewer-hint"><Icon name="rotate" size={16}/><span className="desktop-hint">{common.orbit}<span className="hint-dot">·</span>{common.zoom}</span><span className="touch-hint">{common.touch}</span></div><button className="reset-view" aria-label={t.reset} title={t.reset} disabled={!model||!renderer} onClick={()=>show('overview')}><Icon name="reset" size={18}/></button></div>
      </section>
      <aside className="controls bottle-controls" aria-label={common.controls}>
        <div className="bottle-settings">
          <section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">01</span><h2>{t.product}</h2></div><div className="pillow-product-info"><span className="pillow-colour-swatch" aria-hidden="true"/><div><strong>{t.colour}</strong><p>{t.material}</p></div></div></section>
          <section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">02</span><h2>{t.logo}</h2></div><input ref={input} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" aria-label={common.logoFile} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file)}}/><div className="bottle-logo-upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file)void upload(file)}}><button className="bottle-logo-choice" disabled={uploading} aria-busy={uploading} aria-label={logo&&!logo.sample?t.replace:t.upload} onClick={()=>input.current?.click()}><LogoThumbnail logo={logo} label={common.logoPreview}/><span><strong>{uploading?common.loading:logo?logo.sample?t.sample:logo.name:common.noLogo}</strong><small>{logo&&!logo.sample?t.replace:t.upload}</small></span><Icon name="upload" size={17}/></button><button className="clear-logo" aria-label={logo?t.remove:t.restore} title={logo?t.remove:t.restore} onClick={()=>{uploadId.current++;setUploading(false);setLogo(logo?null:sampleLogo(true));setError(null)}}><Icon name={logo?'close':'reset'} size={15}/></button></div><p className="logo-formats">{t.formats}</p>{error&&<p className="inline-error" role="alert">{common.errors[error]}</p>}</section>
          <section className="control-section"><div className="section-heading"><span className="step-number" aria-hidden="true">03</span><h2>{t.branding}</h2>{settings.enabled&&<span className="print-area-label" aria-label={`${t.area}: 80 × 40 mm`}>80 × 40 mm</span>}</div><label className="select-field method-field"><span className="visually-hidden">{t.method}</span><select aria-label={t.method} value={settings.enabled?method:'none'} onChange={e=>chooseMethod(e.target.value)}><option value="none">{t.none}</option>{PILLOW_METHODS.map(id=><option key={id} value={id}>{TECHNIQUES[id].label[language]}</option>)}</select></label><div className="decoration-meta" aria-live="polite"><p>{settings.enabled?t[method]:t.hide}</p></div>{settings.enabled&&method==='screen-transfer'&&<div className="ink-controls"><span>{t.colours}</span><div role="group" aria-label={t.colours}>{[1,2,3,4,5,6,7,8].map(n=><button key={n} aria-pressed={settings.decoration.colors===n} onClick={()=>setSettings(s=>({...s,decoration:{...s.decoration,colors:n}}))}>{n}</button>)}</div></div>}</section>
        </div>
        <div className="panel-footer"><button className="save" disabled={!model||!renderer||uploading||moving} onClick={()=>{try{save.current?.(`pillow-${selectedView??'free'}-${settings.enabled?method:'plain'}.png`)}catch{setError('pngSave')}}}><span>{t.download}</span><Icon name="download" size={19}/></button><a className="bottle-reference" href={PILLOW.source} target="_blank" rel="noreferrer">{t.source} · MO3154 <Icon name="arrow" size={12}/></a></div>
      </aside>
    </main>
  </div>
}
