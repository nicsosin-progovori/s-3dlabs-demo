import {readLogo,sampleLogo} from './logo'
import {LabError} from './errors'
import type {LogoAsset} from './types'
import {LOGO_MAX_EDGE,normaliseLogoRef} from '../shared/bottleBrandingContract.mjs'
import type {LogoRef} from '../shared/bottleBrandingContract.mjs'
import {apiUrl} from './apiUrl'

const digest=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('')
export const logoUrl=(sha256:string)=>apiUrl('logos/'+sha256+'.png').href
export async function prepareLogo(input:File|'sample'|null):Promise<{asset:LogoAsset|null;ref:LogoRef}>{
  if(input===null)return {asset:null,ref:{kind:'none'}}
  if(input==='sample')return {asset:sampleLogo(true),ref:{kind:'sample'}}
  if(!(input instanceof File))throw new LabError('logoType')
  const original=await readLogo(input),scale=Math.min(1,LOGO_MAX_EDGE/Math.max(original.width,original.height))
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(original.width*scale));canvas.height=Math.max(1,Math.round(original.height*scale))
  const context=canvas.getContext('2d')!
  context.drawImage(original.image,0,0,canvas.width,canvas.height)
  let blob:Blob|null
  try{blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'))}catch{throw new LabError('logoRead')}
  if(!blob)throw new LabError('logoRead')
  const sha256=await digest(await blob.arrayBuffer())
  try{
    const response=await fetch(apiUrl('logos'),{method:'POST',headers:{'Content-Type':'image/png'},body:blob,signal:AbortSignal.timeout(30_000)})
    if(!response.ok)throw Error('Upload failed')
    const ref=normaliseLogoRef(await response.json())
    if(ref.kind!=='uploaded'||ref.sha256!==sha256||ref.width!==canvas.width||ref.height!==canvas.height)throw Error('Logo upload mismatch')
    return {asset:{name:original.name,image:canvas,width:canvas.width,height:canvas.height,sample:false},ref}
  }catch{throw new LabError('logoUpload')}
}
export async function loadDeliveredLogo(input:LogoRef,signal:AbortSignal):Promise<LogoAsset|null>{
  const ref=normaliseLogoRef(input)
  if(ref.kind==='none')return null
  if(ref.kind==='sample')return sampleLogo(true)
  const response=await fetch(logoUrl(ref.sha256),{signal})
  if(!response.ok||!response.headers.get('Content-Type')?.startsWith('image/png'))throw Error('Uploaded logo is unavailable')
  const bytes=await response.arrayBuffer()
  if(await digest(bytes)!==ref.sha256)throw Error('Uploaded logo fingerprint mismatch')
  const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}))
  try{
    const image=new Image();image.src=url;await image.decode();signal.throwIfAborted()
    if(image.width!==ref.width||image.height!==ref.height)throw Error('Uploaded logo dimensions mismatch')
    return {name:ref.sha256+'.png',image,width:ref.width,height:ref.height,sample:false}
  }finally{URL.revokeObjectURL(url)}
}
