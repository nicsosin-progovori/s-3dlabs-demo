import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { CSSProperties } from 'react'
import { BottleVisualisation } from './BottleVisualisation'
import type { BottleViewerHandle, ViewerStatus } from './BottleVisualisation'
import { createBottlePublicApi } from './bottlePublicApi'
import type { BottleState } from './bottleViews'
import { createCameraViewsStore } from './cameraViews'
import {apiUrl} from './apiUrl'
import { cameraStateFor } from './bottleViewSettings'
import { Icon } from './Icon'
import { studioStyleFor } from './studioLook'
import { lookFromScene } from './studioScene'
import type { SceneBundle } from '../shared/sceneContract.mjs'
import { DEFAULT_DECORATION, normaliseDecoration } from '../shared/bottleBrandingContract.mjs'
import { DEFAULT_SKIN } from '../shared/skinContract.mjs'
import { BOTTLE, BOTTLE_METHODS, bottleText, bottleZone, methodDescription } from './bottle'
import { TECHNIQUES } from './sourceCatalog'
import type { TechniqueId } from './sourceCatalog'
import { messages, readLanguage, persistLanguage } from './i18n'
import type { Language } from './i18n'
import { LabError } from './errors'
import type { LabErrorCode } from './errors'
import type { LogoAsset } from './types'
import './bottle-api.css'

const pageText={
  de:{heading:'Ein Produkt. Jede Perspektive.',material:'Edelstahl & Bambus',image:'Produktansicht',controls:'Produkt gestalten',panel:'Deine Flasche',perspective:'Perspektive',picture:'Dein Bild',pictureHint:'Genau dein Blickwinkel. Als PNG.',creating:'Bild wird erstellt…',preparing:'Flasche wird vorbereitet…',exporting:'Dein Bild wird erstellt…',moving:'Zustand wird geändert…',busy:'Deine Auswahl wird vorbereitet…',idle:'Drehen, gestalten, festhalten.',failed:'Die Aktion ist fehlgeschlagen. Bitte erneut versuchen.',sceneError:'Die Studio-Szene konnte nicht geladen werden. Bitte die Seite neu laden.',viewerError:'Die 3D-Ansicht konnte nicht geladen werden. Bitte die Seite neu laden.',viewsLoading:'Ansichten werden geladen…',viewsError:'Die Ansichten konnten nicht geladen werden.',footer:'Eine Flasche. Dein Blickwinkel.',noPrint:'Ohne Veredelung',drop:'Logo hier ablegen',empty:'Kein Logo',colourSelected:'Ausgewählte Farbe'},
  en:{heading:'One product. Every perspective.',material:'Stainless steel & bamboo',image:'Product view',controls:'Customize your product',panel:'Your bottle',perspective:'Perspective',picture:'Your image',pictureHint:'Your exact angle. As a PNG.',creating:'Creating image…',preparing:'Preparing bottle…',exporting:'Creating your image…',moving:'Changing state…',busy:'Preparing your selection…',idle:'Rotate, customize, capture.',failed:'The action failed. Please try again.',sceneError:'The studio scene could not be loaded. Please reload the page.',viewerError:'The 3D view could not be loaded. Please reload the page.',viewsLoading:'Loading views…',viewsError:'The views could not be loaded.',footer:'One bottle. Your perspective.',noPrint:'No decoration',drop:'Drop your logo here',empty:'No logo',colourSelected:'Selected colour'},
}
function LogoThumbnail({logo,label}:{logo:LogoAsset;label:string}){
  const canvas=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const context=canvas.current!.getContext('2d')!,scale=Math.min(200/logo.width,60/logo.height)
    context.clearRect(0,0,220,80);context.drawImage(logo.image,(220-logo.width*scale)/2,(80-logo.height*scale)/2,logo.width*scale,logo.height*scale)
  },[logo])
  return <canvas ref={canvas} width={220} height={80} role="img" aria-label={label}/>
}
function BottleApiPage(){
  const viewer=useRef<BottleViewerHandle|null>(null),fileInput=useRef<HTMLInputElement>(null)
  const [language,setLanguage]=useState<Language>(readLanguage)
  const t=bottleText[language],p=pageText[language],common=messages[language]
  const [status,setStatus]=useState<ViewerStatus>({ready:false,state:'closed',view:null,moving:false,error:null,skin:{...DEFAULT_SKIN},decoration:normaliseDecoration(DEFAULT_DECORATION),logo:null})
  const [busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[error,setError]=useState<LabErrorCode|'action'|null>(null),[dragging,setDragging]=useState(false)
  const [studioStyle,setStudioStyle]=useState<CSSProperties>()
  const cameraViews=useMemo(()=>createCameraViewsStore(apiUrl('camera-views/bottle').href),[])
  const viewData=useSyncExternalStore(cameraViews.subscribe,cameraViews.getSnapshot)
  const controller=useMemo(()=>createBottlePublicApi(()=>viewer.current,setBusy,cameraViews),[cameraViews])
  useEffect(()=>{
    document.documentElement.lang=language;document.title=language==='en'?'Bottle · S. 3DLABS':'Flasche · S. 3DLABS'
    persistLanguage(language)
    document.querySelector('meta[name="description"]')?.setAttribute('content',common.description)
  },[language,common.description])
  useEffect(()=>{
    window.appName3DVisualisation=controller.api
    void cameraViews.reload().catch(()=>{})
    return()=>{cameraViews.dispose();if(window.appName3DVisualisation===controller.api)delete (window as Partial<Window>).appName3DVisualisation}
  },[controller,cameraViews])
  const onStatus=useCallback((next:ViewerStatus)=>{
    setStatus(next)
    if(next.ready)controller.resolveReady()
    if(next.error)controller.rejectReady(new Error(next.error))
  },[controller])
  const onScene=useCallback((scene:SceneBundle)=>{setStudioStyle(studioStyleFor(lookFromScene(scene)));controller.resolveSceneReady()},[controller])
  const onSceneError=useCallback((error:Error)=>controller.rejectSceneReady(error),[controller])
  const perform=(action:()=>Promise<unknown>)=>{
    setError(null)
    void Promise.resolve().then(action).catch(cause=>{if(cause?.name!=='AbortError')setError(cause instanceof LabError?cause.code:'action')})
  }
  const show=(id:string)=>perform(()=>{
    const preset=controller.api.getViews().find(view=>view.id===id)
    if(!preset)throw new Error('Camera is not ready')
    return window.appName3DVisualisation.setCamera(preset.camera)
  })
  const download=()=>perform(async()=>{
    setExporting(true)
    try{
      const blob=await window.appName3DVisualisation.getCurrentViewAsImage()
      const url=URL.createObjectURL(blob),link=document.createElement('a')
      link.href=url;link.download=`bottle-${controller.api.getState()}-${status.view??'free'}.png`;link.click()
      setTimeout(()=>URL.revokeObjectURL(url),60_000)
    }finally{setExporting(false)}
  })
  const disabled=!status.ready||busy||status.moving||!!status.error
  const {surface,technique,colors,enabled}=status.decoration,zone=bottleZone(surface,technique),tech=TECHNIQUES[technique]
  const colour=BOTTLE.colors.find(colour=>'bottle-'+colour.id===status.skin.id)!
  const message=status.error?(status.errorKind==='scene'?p.sceneError:status.errorKind==='model'?common.errors.modelRead:p.viewerError):error?error==='action'?p.failed:common.errors[error]:!status.ready?p.preparing:exporting?p.exporting:status.moving?p.moving:busy?p.busy:p.idle
  const upload=(file?:File)=>{if(file&&!disabled)perform(()=>window.appName3DVisualisation.setLogo(file))}
  return <div className="bottle-api-page" style={studioStyle}>
    <header className="bottle-page-header"><div className="bottle-brand" role="img" aria-label="S. 3DLABS"><span className="bottle-brand-mark"><Icon name="cube" size={23}/></span><strong>S<span>.</span></strong><i/><span className="bottle-brand-name">3DLABS</span></div><div className="bottle-header-tools"><span className="bottle-page-edition">PRODUCT VIEW</span><div className="bottle-language" role="group" aria-label={common.language}>{(['de','en'] as Language[]).map(value=><button key={value} lang={value} aria-label={value==='de'?'Deutsch':'English'} aria-pressed={language===value} onClick={()=>setLanguage(value)}>{value.toUpperCase()}</button>)}</div></div></header>
    <main className="bottle-page-main">
      <div className="bottle-page-heading"><div><p className="bottle-eyebrow">MO9431 · 500 ml</p><h1>{p.heading}</h1></div><span className="bottle-object-name">{t.title}<br/><small>{p.material}</small></span></div>
      <div className="bottle-page-layout">
        <section className="bottle-image-card" aria-label={p.image}><BottleVisualisation ref={viewer} onStatus={onStatus} cameraViews={cameraViews} onScene={onScene} onSceneError={onSceneError} label={t.scene} fallback={common.webgl}/><p className="bottle-orbit-hint"><Icon name="rotate" size={16}/>{common.orbit} <span>·</span> {common.zoom}</p></section>
        <aside className="bottle-control-panel" aria-label={p.controls}>
          <div className="bottle-panel-title"><span>{p.panel}</span><span className="bottle-panel-index">01 — 06</span></div>
          <div className="bottle-control-sections">
            <section className="bottle-control-section"><h2><span>01</span>{t.state}</h2><div className="bottle-states" role="group" aria-label={t.state}>{(['closed','open','lying'] as BottleState[]).map(id=><button key={id} aria-pressed={status.state===id} disabled={disabled} onClick={()=>perform(()=>window.appName3DVisualisation.setState(id))}>{t[id]}</button>)}</div></section>
            <section className="bottle-control-section bottle-views-section"><h2><span>02</span>{p.perspective}</h2><div className="bottle-cameras" role="group" aria-label={p.perspective} aria-busy={viewData.status==='loading'||viewData.status==='refreshing'} data-views-status={viewData.status} data-views-revision={viewData.catalog?.revision}>{(cameraStateFor(viewData.catalog,status.state,surface)?.views??[]).map(preset=><button key={preset.id} aria-pressed={status.view===preset.id} disabled={disabled} onClick={()=>show(preset.id)}>{preset.label[language]}</button>)}</div>{viewData.status==='loading'&&<p className="bottle-view-status" role="status">{p.viewsLoading}</p>}{viewData.error&&<p className="bottle-view-status is-error" role="alert">{p.viewsError}</p>}</section>
            <section className="bottle-control-section"><h2><span>03</span>{t.color}<small className="bottle-colour-name" aria-label={p.colourSelected}>{colour.label[language]}</small></h2><div className="bottle-colours" role="group" aria-label={t.color}>{BOTTLE.colors.map(colour=><button key={colour.id} style={{background:colour.hex,color:colour.id==='white'||colour.id==='silver'?'#44503b':'white'}} aria-label={colour.label[language]} title={colour.label[language]} aria-pressed={status.skin.id==='bottle-'+colour.id} disabled={disabled} onClick={()=>perform(()=>window.appName3DVisualisation.setSkin({id:'bottle-'+colour.id,revision:'v01'}))}>{status.skin.id==='bottle-'+colour.id&&<Icon name="check" size={15}/>}</button>)}</div></section>
            <section className="bottle-control-section"><h2><span>04</span>{t.logo}</h2><div className={'bottle-logo-picker'+(dragging?' is-dragging':'')} onDragOver={event=>{event.preventDefault();if(!disabled)setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);upload(event.dataTransfer.files[0])}}>
              <input className="bottle-file-input" ref={fileInput} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,.png,.jpg,.jpeg,.svg,.webp" aria-label={common.logoFile} disabled={disabled} onChange={event=>{upload(event.currentTarget.files?.[0]);event.currentTarget.value=''}}/>
              <button className="bottle-logo-upload" disabled={disabled} aria-label={status.logo&&!status.logo.sample?t.replace:t.upload} onClick={()=>fileInput.current?.click()}>{status.logo?<LogoThumbnail logo={status.logo} label={common.logoPreview}/>:<span className="bottle-logo-empty"><Icon name="upload" size={22}/>{p.drop}</span>}<span className="bottle-logo-action"><Icon name="upload" size={13}/>{status.logo&&!status.logo.sample?t.replace:t.upload}</span><span>{dragging?p.drop:status.logo?status.logo.sample?t.sample:status.logo.name:t.upload}</span></button>
              <div className="bottle-logo-actions"><span>{t.formats}</span><button disabled={disabled} onClick={()=>perform(()=>window.appName3DVisualisation.setLogo(status.logo?null:'sample'))}>{status.logo?t.remove:t.restore}</button></div>
            </div></section>
            <section className="bottle-control-section"><h2><span>05</span>{t.branding}</h2><div className="bottle-placement" role="group" aria-label={t.location}>{(['body','lid'] as const).map(value=><button key={value} aria-pressed={surface===value} disabled={disabled} onClick={()=>perform(()=>window.appName3DVisualisation.setDecoration({surface:value}))}>{t[value]}</button>)}</div>
              <label className="bottle-field"><span>{t.method}</span><select aria-label={t.method} disabled={disabled} value={enabled?technique:'none'} onChange={event=>{const value=event.currentTarget.value;perform(()=>window.appName3DVisualisation.setDecoration(value==='none'?{enabled:false}:{enabled:true,technique:value as TechniqueId}))}}><option value="none">{p.noPrint}</option>{BOTTLE_METHODS[surface].map(id=><option key={id} value={id}>{TECHNIQUES[id].label[language]}</option>)}</select></label>
              {enabled?<><p className="bottle-method-description">{methodDescription(technique,surface,language)}</p><p className="bottle-print-area">{t.area}: {zone.circle?'Ø '+zone.widthMm:`${zone.widthMm} × ${zone.heightMm}`} mm</p>{(tech.maxColors??1)>1&&<label className="bottle-field bottle-ink-count"><span>{t.colors}</span><select aria-label={t.colors} disabled={disabled} value={colors} onChange={event=>{const colors=Number(event.currentTarget.value);perform(()=>window.appName3DVisualisation.setDecoration({colors}))}}>{Array.from({length:tech.maxColors!},(_,index)=><option key={index+1} value={index+1}>{index+1}</option>)}</select></label>}</>:<p className="bottle-method-description">{t.hide}</p>}
            </section>

          </div>
          <div className="bottle-export-section"><h2><span>06</span>{p.picture}</h2><p>{p.pictureHint}</p><button className="bottle-download" disabled={disabled} aria-busy={exporting} onClick={download}><span>{exporting?p.creating:t.download}</span><Icon name="download" size={21}/></button><p className={'bottle-status '+(status.error||error?'is-error':'')} role={status.error||error?'alert':'status'} aria-live="polite">{message}</p></div>
        </aside>
      </div>
    </main>
    <footer className="bottle-page-footer"><span>S. 3DLABS</span><span>{p.footer}</span></footer>
  </div>
}
createRoot(document.getElementById('root')!).render(<BottleApiPage/> )
