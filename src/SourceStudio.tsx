import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { Language } from './i18n'
import { messages, readLanguage, persistLanguage } from './i18n'
import { readLogo, sampleLogo } from './logo'
import { initialSettings, isSourceId, SOURCE_PRODUCTS, sourceMessages, sourceProduct, TECHNIQUES } from './sourceCatalog'
import type { SourceId, SourceSettings, TechniqueId } from './sourceCatalog'
import { loadSourceModel } from './sourceModel'
import type { SourceModel } from './sourceModel'
import { SourceScene } from './SourceScene'
import type { LayoutReport, StudioItem } from './SourceScene'
import type { LogoAsset, ModelId } from './types'

class StudioBoundary extends Component<{children:ReactNode;message:string},{error:boolean}> {
  state={error:false}
  static getDerivedStateFromError(){return {error:true}}
  render(){return this.state.error?<div className="scene-error" role="alert">{this.props.message}</div>:this.props.children}
}

function useModel(id: SourceId | null, retry: number) {
  const [model,setModel]=useState<SourceModel|null>(null)
  const [error,setError]=useState(false)
  useEffect(()=>{
    let cancelled=false,owned:SourceModel|undefined
    const controller=new AbortController()
    setModel(null);setError(false)
    if(id) void loadSourceModel(sourceProduct(id),{signal:controller.signal}).then(next=>{
      if(cancelled){next.dispose();return}
      owned=next;setModel(next)
    }).catch(()=>{if(!cancelled)setError(true)})
    return()=>{cancelled=true;controller.abort();owned?.dispose()}
  },[id,retry])
  return {model:model?.productId===id?model:null,error}
}

const allSettings=():Record<SourceId,SourceSettings>=>({bottle:initialSettings('bottle'),endo:initialSettings('endo'),pillow:initialSettings('pillow')})

function Preview({logo}:{logo:LogoAsset|null}) {
  const ref=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const ctx=ref.current!.getContext('2d')!
    ctx.clearRect(0,0,240,100)
    if(!logo)return
    const f=Math.min(220/logo.width,80/logo.height)
    ctx.drawImage(logo.image,(240-logo.width*f)/2,(100-logo.height*f)/2,logo.width*f,logo.height*f)
  },[logo])
  return <canvas ref={ref} width={240} height={100} className="logo-preview"/>
}

export function SourceStudio({initialId,onLegacy}:{initialId:SourceId;onLegacy:(id:ModelId)=>void}) {
  const [language,setLanguage]=useState<Language>(readLanguage)
  const [ids,setIds]=useState<[SourceId,SourceId|null]>(()=>{
    const second=new URLSearchParams(location.search).get('second')
    return [initialId,second==='none'?null:isSourceId(second)?second:initialId==='endo'?'bottle':'endo']
  })
  const [settings,setSettings]=useState<[Record<SourceId,SourceSettings>,Record<SourceId,SourceSettings>]>(()=>[allSettings(),allSettings()])
  const lastSecond=useRef<SourceId>(ids[1]??(initialId==='endo'?'bottle':'endo'))
  const [logos,setLogos]=useState<[LogoAsset|null,LogoAsset|null]>(()=>[sampleLogo(),sampleLogo()])
  const [active,setActive]=useState(0)
  const [retry,setRetry]=useState(0)
  const [resetKey,setResetKey]=useState(0)
  const [renderer,setRenderer]=useState('')
  const [report,setReport]=useState<LayoutReport|null>(null)
  const [uploading,setUploading]=useState(false)
  const [logoError,setLogoError]=useState('')
  const save=useRef<((name:string)=>void)|null>(null)
  const input=useRef<HTMLInputElement>(null)
  const requests=useRef([0,0])
  const first=useModel(ids[0],retry),second=useModel(ids[1],retry)
  const s0=settings[0][ids[0]],s1=ids[1]?settings[1][ids[1]]:null
  const ready=!!first.model&&(!ids[1]||!!second.model)
  const items=useMemo<StudioItem[]>(()=>{
    if(!first.model || (ids[1]&&!second.model))return []
    const a:StudioItem[]=[{key:0,model:first.model,settings:s0,logo:logos[0]}]
    if(second.model&&s1) a.push({key:1,model:second.model,settings:s1,logo:logos[1]})
    return a
  },[first.model,second.model,s0,s1,logos,ids])
  const index=active===1&&ids[1]?1:0
  const product=sourceProduct(ids[index]!)
  const current=settings[index][product.id]
  const zone=product.zones.find(z=>z.id===current.decoration.zone)??product.zones[0]
  const technique=TECHNIQUES[current.decoration.technique]
  const t=sourceMessages[language]
  const common=messages[language]
  const logo=logos[index]
  const bounds=report?.items.find(i=>i.key===index)

  useEffect(()=>{
    document.documentElement.lang=language
    document.querySelector('meta[name="description"]')?.setAttribute('content',common.description)
    persistLanguage(language)
  },[language,common.description])
  useEffect(()=>{
    const url=new URL(location.href)
    url.searchParams.set('model',ids[0]);url.searchParams.set('second',ids[1]??'none')
    history.replaceState(null,'',url)
  },[ids])
  const onReady=useCallback((capture:(name:string)=>void,version:string)=>{save.current=capture;setRenderer(version)},[])
  const onLayout=useCallback((next:LayoutReport)=>setReport(next),[])
  const onSelect=useCallback((key:number)=>setActive(key),[])

  function patch(update:Partial<SourceSettings>) {
    setSettings(previous=>{
      const next=[...previous] as typeof previous
      next[index]={...next[index],[product.id]:{...current,...update}}
      return next
    })
  }
  function chooseProduct(id:SourceId) {
    if(index===1)lastSecond.current=id
    setIds(previous=>{const next=[...previous] as typeof previous;next[index]=id;return next})
    setLogoError('')
  }
  function toggleSecond() {
    if(ids[1]){lastSecond.current=ids[1];setIds([ids[0],null]);setActive(0)}
    else{setIds([ids[0],lastSecond.current]);setActive(1)}
  }
  async function upload(file:File) {
    const slot=index,request=++requests.current[slot]
    setUploading(true);setLogoError('')
    try {
      const next=await readLogo(file)
      if(requests.current[slot]===request)setLogos(previous=>{const a=[...previous] as typeof previous;a[slot]=next;return a})
    } catch {if(requests.current[slot]===request)setLogoError(common.errors.logoRead)}
    finally {if(requests.current[slot]===request)setUploading(false)}
  }

  return <div className="app-shell source-studio">
    <header className="topbar">
      <div className="brand" aria-label="S. 3DLABS"><span className="brand-icon"><Icon name="cube" size={23}/></span><h1 className="brand-name"><span className="brand-initial">S<span className="brand-dot">.</span></span><span className="brand-rule"/><span className="brand-labs">3DLABS</span></h1></div>
      <div className="language-picker" role="group" aria-label={common.language}>{(['de','en'] as const).map(lang=><button key={lang} lang={lang} aria-label={lang==='de'?'Deutsch':'English'} aria-pressed={language===lang} onClick={()=>setLanguage(lang)}>{lang.toUpperCase()}</button>)}</div>
    </header>
    <main className="lab">
      <section className="viewport" aria-label={t.scene} data-testid="source-scene" data-model-ready={ready} data-renderer={renderer||undefined} data-layout={ready&&report?JSON.stringify(report):undefined} data-config={JSON.stringify(ids.map((id,i)=>id?settings[i][id]:null))}>
        <div className="scene-canvas"><StudioBoundary message={common.webgl}><SourceScene items={items} active={index} onSelect={onSelect} resetKey={resetKey} onReady={onReady} onLayout={onLayout} fallback={common.webgl}/></StudioBoundary></div>
        <div className="viewer-heading"><h2>{ids.map(id=>id?sourceProduct(id).label[language]:null).filter(Boolean).join(' + ')}</h2><span className="viewer-badge"><span/>360°</span></div>
        {!ready&&!first.error&&!second.error&&<div className="scene-message" role="status"><span className="loading-ring"/>{t.loading}</div>}
        {(first.error||second.error)&&<div className="scene-message error" role="alert">{t.error}<button onClick={()=>setRetry(n=>n+1)}>{t.retry}</button></div>}
        <div className="composition-slots">{ids.map((id,i)=>id&&<button key={i} className={index===i?'active':''} aria-pressed={index===i} aria-label={i===0?t.product1:t.product2} onClick={()=>setActive(i)}><span className="slot-number">0{i+1}</span><span>{sourceProduct(id).label[language]}<small>{sourceProduct(id).states.find(s=>s.id===settings[i][id].state)?.label[language]}</small></span><span className="slot-swatch" style={{background:sourceProduct(id).colors.find(c=>c.id===settings[i][id].color)?.hex}}/></button>)}</div>
        <div className="viewer-footer"><div className="viewer-hint"><Icon name="rotate" size={16}/><span className="desktop-hint">{t.hint}</span><span className="touch-hint">{t.touch}</span></div><button className="reset-view" aria-label={t.reset} title={t.reset} disabled={!ready} onClick={()=>setResetKey(n=>n+1)}><Icon name="reset" size={18}/></button></div>
      </section>
      <aside className="controls" aria-label={common.controls}>
        <section className="control-section">
          <div className="section-heading"><span className="step-number">0{index+1}</span><h2>{index===0?t.product1:t.product2}</h2><button className="pair-toggle" aria-label={ids[1]?t.remove:t.add} title={ids[1]?t.remove:t.add} onClick={toggleSecond}>{ids[1]?<Icon name="close" size={16}/>:<span>＋ 2</span>}</button></div>
          <div className="product-picker" role="group" aria-label={t.product}>{SOURCE_PRODUCTS.map(p=><button key={p.id} aria-pressed={product.id===p.id} onClick={()=>chooseProduct(p.id)}><Icon name={p.id} size={23}/><span>{p.label[language]}</span></button>)}</div>
          <div className="product-caption"><span>{product.code}</span><a href={product.source} target="_blank" rel="noreferrer" aria-label={t.source} title={t.source}><Icon name="arrow" size={13}/></a></div>
        </section>
        <section className="control-section variant-controls">
          <div className="field-heading"><h3>{t.state}</h3><span>{product.size}</span></div>
          <div className="state-picker" role="group" aria-label={t.state}>{product.states.map(s=><button key={s.id} aria-pressed={current.state===s.id} onClick={()=>patch({state:s.id})}>{s.label[language]}</button>)}</div>
          <div className="field-heading color-heading"><h3>{t.color}</h3><span>{product.colors.find(c=>c.id===current.color)?.label[language]}</span></div>
          <div className="color-picker" role="group" aria-label={t.color}>{product.colors.map(c=><button key={c.id} aria-label={c.label[language]} title={c.label[language]} aria-pressed={current.color===c.id} onClick={()=>patch({color:c.id})}><span style={{background:c.hex}}/>{current.color===c.id&&<Icon name="check" size={11}/>}</button>)}</div>
          {bounds&&ready&&<p className="bounds-note"><span>{t.actualBounds}</span><strong>{bounds.sizeMm.join(' × ')} mm</strong></p>}
        </section>
        <section className="control-section logo-controls">
          <div className="section-heading"><h2>{t.logo}</h2><span className="print-technique">{index===0?t.product1:t.product2}</span></div>
          <input ref={input} type="file" className="visually-hidden" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label={common.logoFile} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file)}}/>
          <div className="upload-area" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)void upload(f)}}><button className="upload" disabled={uploading} onClick={()=>input.current?.click()}><span className="upload-symbol"><Icon name="upload" size={20}/></span><span className="upload-copy"><span>{logo&&!logo.sample?t.replace:t.upload}</span><span className="file-formats">{common.formats}</span></span></button></div>
          <div className="logo-file"><Preview logo={logo}/><span className="logo-filename">{logo?logo.sample?common.sample:logo.name:common.noLogo}</span><button className="clear-logo" aria-label={logo?t.removeLogo:t.restore} onClick={()=>{requests.current[index]++;setUploading(false);setLogos(a=>{const b=[...a] as typeof a;b[index]=logo?null:sampleLogo();return b})}}><Icon name={logo?'close':'reset'} size={16}/></button></div>
          {logoError&&<p role="alert" className="inline-error">{logoError}</p>}
        </section>
        <section className="control-section source-decoration-controls">
          <div className="section-heading"><h2>{t.technique}</h2><label className="no-decoration"><input type="checkbox" checked={!current.enabled} onChange={e=>patch({enabled:!e.target.checked})}/>{t.noPrint}</label></div>
          <label className="select-field"><span>{t.placement}</span><select aria-label={t.placement} value={zone.id} disabled={!current.enabled} onChange={e=>{const z=product.zones.find(z=>z.id===e.target.value)!;patch({decoration:{...current.decoration,zone:z.id,technique:z.techniques.includes(current.decoration.technique)?current.decoration.technique:z.techniques[0]}})}}>{product.zones.map(z=><option key={z.id} value={z.id}>{z.label[language]} · {z.widthMm} × {z.heightMm} mm</option>)}</select></label>
          <label className="select-field"><span>{t.technique}</span><select aria-label={t.technique} disabled={!current.enabled} value={current.decoration.technique} onChange={e=>patch({decoration:{...current.decoration,technique:e.target.value as TechniqueId,colors:1}})}>{zone.techniques.map(id=><option key={id} value={id}>{TECHNIQUES[id].label[language]}</option>)}</select></label>
          {technique.maxColors&&<div className="ink-controls"><span>{t.colors}</span><div role="group" aria-label={t.colors}>{Array.from({length:technique.maxColors},(_,i)=><button key={i} disabled={!current.enabled} aria-pressed={current.decoration.colors===i+1} onClick={()=>patch({decoration:{...current.decoration,colors:i+1}})}>{i+1}</button>)}</div></div>}
          {current.state==='box-closed'&&current.enabled&&<p className="closed-box-note">{t.closedBox}</p>}
        </section>
        <div className="panel-footer"><button className="save" disabled={!ready||!renderer||uploading} onClick={()=>{try{save.current?.(`scene-${ids.map((id,i)=>id?`${id}-${settings[i][id].state}`:null).filter(Boolean).join('__')}.png`)}catch{setLogoError(common.errors.pngSave)}}}><span>{t.download}</span><Icon name="download" size={19}/></button><nav className="legacy-products" aria-label={t.legacy}>{(['mug','pen','notebook'] as const).map(id=><button key={id} onClick={()=>onLegacy(id)}>{common.products[id]}</button>)}</nav></div>
      </aside>
    </main>
  </div>
}
