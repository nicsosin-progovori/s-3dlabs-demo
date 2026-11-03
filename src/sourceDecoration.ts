import { CanvasTexture, SRGBColorSpace } from 'three'
import type { LogoAsset } from './types'
import { TECHNIQUES } from './sourceCatalog'
import type { SourceSettings, SourceZone } from './sourceCatalog'

/** Restrict spot-print previews to the requested number of image-derived inks.
 * Alpha is retained: a transparent logo never becomes a rectangular sticker. */
function spotColours(image: ImageData, count: number) {
  const histogram = new Map<number, { color: number[]; count: number }>()
  for (let i=0; i<image.data.length; i+=32) {
    if (image.data[i+3]<100) continue
    const rgb=[image.data[i],image.data[i+1],image.data[i+2]]
    const key=(rgb[0]>>4)*256+(rgb[1]>>4)*16+(rgb[2]>>4)
    const bucket=histogram.get(key)
    if (bucket) bucket.count++
    else histogram.set(key,{color:rgb,count:1})
  }
  const candidates=[...histogram.values()].sort((a,b)=>b.count-a.count)
  const palette=candidates.slice(0,1).map(c=>c.color)
  const distance=(a:number[],b:number[])=>a.reduce((n,v,i)=>n+(v-b[i])**2,0)
  while (palette.length<count && candidates.length>palette.length) {
    let best=candidates[0], score=-1
    for (const c of candidates) {
      const next=Math.min(...palette.map(p=>distance(c.color,p)))*Math.sqrt(c.count)
      if (next>score) { best=c; score=next }
    }
    if (score<=0) break
    palette.push(best.color)
  }
  if (!palette.length) return
  for (let i=0;i<image.data.length;i+=4) {
    if (!image.data[i+3]) continue
    const rgb=[image.data[i],image.data[i+1],image.data[i+2]]
    let best=palette[0], score=Infinity
    for (const p of palette) { const d=distance(rgb,p); if(d<score){score=d;best=p} }
    image.data[i]=best[0]; image.data[i+1]=best[1]; image.data[i+2]=best[2]
  }
}

export function decorationTextures(zone: SourceZone, settings: SourceSettings, logo: LogoAsset | null) {
  const canvas=document.createElement('canvas')
  const resolution=settings.decoration.technique==='embroidery'?2048:1536
  canvas.width=Math.round(resolution*Math.min(1,zone.surfaceWidthMm/zone.surfaceHeightMm))
  canvas.height=Math.round(canvas.width*zone.surfaceHeightMm/zone.surfaceWidthMm)
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!
  const w=canvas.width*zone.widthMm/zone.surfaceWidthMm
  const h=canvas.height*zone.heightMm/zone.surfaceHeightMm
  const cx=canvas.width*zone.center[0], cy=canvas.height*(1-zone.center[1])
  if (logo && settings.enabled) {
    ctx.save()
    ctx.beginPath()
    if (zone.circle) ctx.ellipse(cx,cy,w/2,h/2,0,0,Math.PI*2)
    else ctx.rect(cx-w/2,cy-h/2,w,h)
    ctx.clip()
    if (TECHNIQUES[settings.decoration.technique].kind === 'doming') {
      ctx.fillStyle = '#fcfcf7'
      ctx.fillRect(0,0,canvas.width,canvas.height)
    }
    // Keep the comparison sample the same physical size across body methods;
    // uploaded artwork still uses the selected technique's full print area.
    const previewWidth=logo.colorfulSample&&zone.surface==='body'?Math.min(w,canvas.width*40/zone.surfaceWidthMm):w
    const scale=Math.min(previewWidth/logo.width,h/logo.height)*.92
    ctx.drawImage(logo.image,cx-logo.width*scale/2,cy-logo.height*scale/2,logo.width*scale,logo.height*scale)
    const kind=TECHNIQUES[settings.decoration.technique].kind
    if (kind==='metal' || kind==='reflective' || (logo.sample && !logo.colorfulSample && kind!=='doming')) {
      ctx.globalCompositeOperation='source-in'
      ctx.fillStyle=kind==='metal' ? zone.wood?'#653c20':'#d2d6d9' : '#f1efdf'
      ctx.fillRect(0,0,canvas.width,canvas.height)
    }
    ctx.restore()
  }
  const image=ctx.getImageData(0,0,canvas.width,canvas.height)
  const tech=TECHNIQUES[settings.decoration.technique]
  if (tech.maxColors && tech.kind==='ink') spotColours(image,Math.min(settings.decoration.colors,tech.maxColors))
  const relief=document.createElement('canvas')
  relief.width=canvas.width; relief.height=canvas.height
  const rc=relief.getContext('2d')!
  const normal=rc.createImageData(canvas.width,canvas.height)
  const stitchPx=canvas.width/zone.surfaceWidthMm*.6
  for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
    const i=(y*canvas.width+x)*4
    normal.data[i]=128; normal.data[i+1]=128; normal.data[i+2]=255; normal.data[i+3]=255
    if (tech.kind==='thread' && image.data[i+3]>0) {
      const row=Math.floor(y/stitchPx)
      const phase=(x+.4*y+(row%2)*stitchPx*.6)/stitchPx*Math.PI*2
      const ridge=Math.sin(phase), shade=.88+.12*ridge
      image.data[i]*=shade; image.data[i+1]*=shade; image.data[i+2]*=shade
      normal.data[i]=128+Math.cos(phase)*55
      normal.data[i+1]=128+Math.sin(y/stitchPx*Math.PI*2)*30
      normal.data[i+2]=240
    }
  }
  ctx.putImageData(image,0,0)
  rc.putImageData(normal,0,0)
  const map=new CanvasTexture(canvas)
  map.colorSpace=SRGBColorSpace; map.flipY=false
  const normalMap=new CanvasTexture(relief)
  normalMap.flipY=false
  return {map,normalMap,dispose:()=>{map.dispose();normalMap.dispose()}}
}
