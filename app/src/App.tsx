import { Component, useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { DEFAULT_ZONES, getProduct, getZone, PRODUCTS } from './catalog'
import { LabError } from './errors'
import type { LabErrorCode } from './errors'
import { Icon } from './Icon'
import { messages, zoneSize, readLanguage, persistLanguage } from './i18n'
import type { Language } from './i18n'
import { readLogo, sampleLogo } from './logo'
import { loadModel } from './model'
import { PlacementGlyph } from './PlacementGlyph'
import { Scene } from './Scene'
import { SourceStudio } from './SourceStudio'
import { ProductStudio } from './ProductStudio'
import { isSourceId, SOURCE_PRODUCTS } from './sourceCatalog'
import type { SourceId } from './sourceCatalog'
import type { LoadedModel, LogoAsset, ModelId, ZoneId } from './types'

class SceneBoundary extends Component<{ children: ReactNode; message: string }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() {
    return this.state.error
      ? <div className="scene-error" role="alert">{this.props.message}</div>
      : this.props.children
  }
}

function LogoPreview({ logo, label }: { logo: LogoAsset | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = ref.current!.getContext('2d')!
    context.clearRect(0, 0, 240, 120)
    if (!logo) return
    const scale = Math.min(210 / logo.width, 90 / logo.height)
    context.drawImage(logo.image, (240 - logo.width * scale) / 2, (120 - logo.height * scale) / 2, logo.width * scale, logo.height * scale)
  }, [logo])
  return <canvas ref={ref} width={240} height={120} className="logo-preview" aria-label={label} />
}

export function App() {
  const [sourceId, setSourceId] = useState<SourceId | null>(() => {
    const id = new URLSearchParams(location.search).get('model')
    return !id || id==='bottle' ? 'bottle' : isSourceId(id) ? id : null
  })
  const selectSource = (id: SourceId) => {
    const url = new URL(location.href)
    url.searchParams.set('model', id)
    url.searchParams.delete('second')
    history.replaceState(null, '', url)
    setSourceId(id)
  }
  return sourceId&&(new URLSearchParams(location.search).get('mode')==='pair'||sourceId==='bottle'||[null,'none'].includes(new URLSearchParams(location.search).get('second')))
    ? <ProductStudio initialId={sourceId}/>
    : sourceId
    ? <SourceStudio initialId={sourceId} onLegacy={id => {
      const url = new URL(location.href)
      url.searchParams.set('model', id)
      url.searchParams.delete('second')
      history.replaceState(null, '', url)
      setSourceId(null)
    }} />
    : <LegacyApp onSourceSelect={selectSource} />
}

function LegacyApp({ onSourceSelect }: { onSourceSelect: (id: SourceId) => void }) {
  const [language, setLanguage] = useState<Language>(readLanguage)
  const [productId, setProductId] = useState<ModelId>(() => PRODUCTS.find((product) => product.id === new URLSearchParams(window.location.search).get('model'))?.id ?? 'mug')
  const [zones, setZones] = useState<Record<ModelId, ZoneId>>(DEFAULT_ZONES)
  const [logo, setLogo] = useState<LogoAsset | null>(sampleLogo)
  const [model, setModel] = useState<LoadedModel | null>(null)
  const [modelError, setModelError] = useState<LabErrorCode | null>(null)
  const [logoError, setLogoError] = useState<LabErrorCode | null>(null)
  const [renderer, setRenderer] = useState('')
  const [groundGap, setGroundGap] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [viewResetKey, setViewResetKey] = useState(0)
  const capture = useRef<((filename: string) => void) | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const uploadRequest = useRef(0)
  const dragDepth = useRef(0)
  const t = messages[language]
  const product = getProduct(productId)
  const zoneId = zones[productId] ?? product.defaultZone
  const zone = getZone(product, zoneId)
  const currentModel = model?.id === productId ? model : null

  useEffect(() => {
    document.documentElement.lang = language
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.description)
    persistLanguage(language)
  }, [language, t])

  useEffect(() => {
    let cancelled = false
    let owned: LoadedModel | undefined
    const controller=new AbortController()
    setModel(null)
    setModelError(null)
    setGroundGap(null)
    void loadModel(product,{signal:controller.signal}).then((asset) => {
      if (cancelled) { asset.dispose(); return }
      owned = asset
      setModel(asset)
    }).catch((error: unknown) => {
      if (!cancelled) setModelError(error instanceof LabError ? error.code : 'modelRead')
    })
    return () => { cancelled = true; controller.abort(); owned?.dispose() }
  }, [product])

  function selectProduct(id: ModelId) {
    setProductId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('model', id)
    window.history.replaceState(null, '', url)
  }

  const onReady = useCallback((save: (filename: string) => void, version: string) => {
    capture.current = save
    setRenderer(version)
  }, [])
  const onGrounded = useCallback((gap: number) => setGroundGap(gap), [])

  async function uploadLogo(file: File) {
    const request = ++uploadRequest.current
    setUploading(true)
    setLogoError(null)
    try {
      const next = await readLogo(file)
      if (uploadRequest.current === request) setLogo(next)
    } catch (error) {
      if (uploadRequest.current === request) setLogoError(error instanceof LabError ? error.code : 'logoRead')
    } finally {
      if (uploadRequest.current === request) setUploading(false)
    }
  }

  function dropLogo(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void uploadLogo(file)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="S. 3DLABS">
          <span className="brand-icon"><Icon name="cube" size={23} /></span>
          <h1 className="brand-name"><span className="brand-initial">S<span className="brand-dot">.</span></span><span className="brand-rule" aria-hidden="true" /><span className="brand-labs">3DLABS</span></h1>
        </div>
        <div className="language-picker" role="group" aria-label={t.language}>
          <button lang="de" aria-label="Deutsch" aria-pressed={language === 'de'} onClick={() => setLanguage('de')}><span className="locale-full">Deutsch</span><span className="locale-short">DE</span></button>
          <button lang="en" aria-label="English" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}><span className="locale-full">English</span><span className="locale-short">EN</span></button>
        </div>
      </header>

      <main className="lab">
        <section className="viewport" aria-label={`${t.products[productId]} ${t.scene}`} data-testid="scene" data-product={productId} data-renderer={renderer || undefined} data-model-ready={!!currentModel} data-model-meshes={currentModel?.meshCount} data-ground-gap={currentModel ? groundGap ?? undefined : undefined} data-zone={zoneId}>
          <div className="scene-canvas"><SceneBoundary message={t.webgl}><Scene product={product} model={currentModel} zone={zone} logo={logo} onReady={onReady} onGrounded={onGrounded} viewResetKey={viewResetKey} fallbackMessage={t.webgl} /></SceneBoundary></div>
          <div className="viewer-heading"><h2>{t.products[productId]}</h2><span className="viewer-badge"><span aria-hidden="true" />360°</span></div>
          {!currentModel && !modelError && <div className="scene-message" role="status"><span className="loading-ring" aria-hidden="true" />{t.loading}</div>}
          {modelError && <div className="scene-message error" role="alert">{t.errors[modelError]}</div>}
          <div className="viewer-footer">
            <div className="viewer-hint"><Icon name="rotate" size={16} /><span className="desktop-hint">{t.orbit}<span className="hint-dot">·</span>{t.zoom}</span><span className="touch-hint">{t.touch}</span></div>
            <button className="reset-view" aria-label={t.resetView} title={t.resetView} disabled={!currentModel || !renderer} onClick={() => setViewResetKey((current) => current + 1)}><Icon name="reset" size={18} /></button>
          </div>
        </section>

        <aside className="controls" aria-label={t.controls}>
          <section className="control-section">
            <div className="section-heading"><span className="step-number" aria-hidden="true">01</span><h2 id="product-label">{t.product}</h2></div>
            <div className="product-picker" role="group" aria-labelledby="product-label">{PRODUCTS.map((item) => <button key={item.id} aria-pressed={productId === item.id} onClick={() => selectProduct(item.id)}><Icon name={item.id} size={23} /><span>{t.products[item.id]}</span></button>)}</div>
            <div className="product-picker source-entry" role="group" aria-label={language === 'de' ? 'SOURCE Produkte' : 'SOURCE products'}>{SOURCE_PRODUCTS.map((item) => <button key={item.id} aria-pressed={false} onClick={() => onSourceSelect(item.id)}><Icon name={item.id} size={23} /><span>{item.label[language]}</span></button>)}</div>
          </section>

          <section className="control-section logo-controls">
            <div className="section-heading"><span className="step-number" aria-hidden="true">02</span><h2>{t.logo}</h2></div>
            <input ref={logoInput} className="visually-hidden" type="file" tabIndex={-1} accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label={t.logoFile} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadLogo(file) }} />
            <div className={dragging ? 'upload-area dragging' : 'upload-area'} onDragEnter={(event) => { event.preventDefault(); dragDepth.current++; setDragging(true) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDragLeave={(event) => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }} onDrop={dropLogo}>
              <button className="upload" disabled={uploading} aria-busy={uploading} onClick={() => logoInput.current?.click()} aria-label={t.upload}>
                <span className="upload-symbol">{uploading ? <span className="loading-ring" /> : <Icon name="upload" size={20} />}</span>
                <span className="upload-copy"><span>{uploading ? t.loading : dragging ? t.drop : t.upload}</span><span className="file-formats">{t.formats}</span></span>
              </button>
            </div>
            <div className="logo-file"><LogoPreview logo={logo} label={t.logoPreview} /><span className="logo-filename" title={logo?.sample ? t.sample : logo?.name}>{logo ? logo.sample ? t.sample : logo.name : t.noLogo}</span><button className="clear-logo" aria-label={logo ? t.removeLogo : t.restoreLogo} title={logo ? t.removeLogo : t.restoreLogo} onClick={() => { uploadRequest.current++; setUploading(false); setLogo(logo ? null : sampleLogo()); setLogoError(null) }}><Icon name={logo ? 'close' : 'reset'} size={16} /></button></div>
            {logoError && <p className="inline-error" role="alert">{t.errors[logoError]}</p>}
          </section>

          <section className="control-section zone-controls">
            <div className="section-heading"><span className="step-number" aria-hidden="true">03</span><h2 id="placement-label">{t.placement}</h2>{productId !== 'mug' && <span className="print-technique">{productId === 'pen' ? t.laser : t.color}</span>}</div>
            <div className="zone-grid" role="radiogroup" aria-labelledby="placement-label">{product.zones.map((item) => {
              const size = zoneSize(product, item)
              return <label className={zoneId === item.id ? 'zone-option selected' : 'zone-option'} key={item.id}>
                <input type="radio" name="placement" value={item.id} aria-label={size ? `${t.zones[item.id]}, ${size}` : t.zones[item.id]} checked={zoneId === item.id} onChange={() => setZones((current) => ({ ...current, [productId]: item.id }))} />
                <PlacementGlyph product={productId} zone={item.id} /><span className="zone-text"><span className="zone-name">{t.zones[item.id]}</span>{size && <span className="zone-size">{size}</span>}</span><span className="radio-mark" aria-hidden="true"><Icon name="check" size={9} /></span>
              </label>
            })}</div>
          </section>

          <div className="panel-footer"><button className="save" disabled={!renderer || !currentModel || uploading} onClick={() => { try { capture.current?.(`${productId}-${zoneId}.png`) } catch { setLogoError('pngSave') } }}><span>{t.download}</span><Icon name="download" size={19} /></button></div>
        </aside>
      </main>
    </div>
  )
}
