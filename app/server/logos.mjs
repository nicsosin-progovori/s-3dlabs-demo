import {createHash,randomUUID} from 'node:crypto'
import {mkdir,readFile,readdir,stat,writeFile,rename} from 'node:fs/promises'
import path from 'node:path'
import {inflateSync} from 'node:zlib'
import {LOGO_MAX_BYTES,LOGO_MAX_EDGE,normaliseLogoRef} from '../shared/bottleBrandingContract.mjs'
import {HttpError as RenderError,readRequestBody} from './http.mjs'

const signature=Buffer.from('89504e470d0a1a0a','hex')
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0})
const crc=bytes=>{let n=0xffffffff;for(const byte of bytes)n=table[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0}
/** Accept only bounded, non-interlaced RGB/RGBA PNGs produced by browser canvas. */
export function inspectLogoPng(bytes){
  if(bytes.length>LOGO_MAX_BYTES||bytes.length<57||!bytes.subarray(0,8).equals(signature))throw new RenderError(400,'Invalid logo PNG')
  let offset=8,width,height,channels,ended=false,seenData=false,dataEnded=false
  const data=[]
  while(offset<bytes.length){
    if(offset+12>bytes.length)throw new RenderError(400,'Truncated logo PNG')
    const length=bytes.readUInt32BE(offset),end=offset+12+length,type=bytes.toString('ascii',offset+4,offset+8)
    if(end>bytes.length||crc(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))throw new RenderError(400,'Invalid logo PNG chunk')
    const chunk=bytes.subarray(offset+8,end-4)
    if(offset===8&&type!=='IHDR')throw new RenderError(400,'Missing logo dimensions')
    if(type==='IHDR'){
      if(width||length!==13)throw new RenderError(400,'Invalid logo header')
      width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);channels=chunk[9]===6?4:chunk[9]===2?3:0
      if(!width||!height||width>LOGO_MAX_EDGE||height>LOGO_MAX_EDGE||!channels||chunk[8]!==8||chunk[10]||chunk[11]||chunk[12])throw new RenderError(400,'Unsupported logo PNG format or size')
    }else if(type==='IDAT'){
      if(dataEnded)throw new RenderError(400,'Invalid logo image stream')
      seenData=true;data.push(chunk)
    }else if(type==='IEND'){
      if(length||!seenData||end!==bytes.length)throw new RenderError(400,'Invalid logo PNG ending')
      ended=true
    }else{
      if(seenData)dataEnded=true
      if(!/^[a-zA-Z]{4}$/.test(type)||type[0]===type[0].toUpperCase()&&type!=='PLTE')throw new RenderError(400,'Unsupported logo PNG chunk')
    }
    offset=end
  }
  if(!ended)throw new RenderError(400,'Incomplete logo PNG')
  const stride=width*channels+1,expected=stride*height
  let pixels
  try{pixels=inflateSync(Buffer.concat(data),{maxOutputLength:expected})}catch{throw new RenderError(400,'Invalid logo image data')}
  if(pixels.length!==expected)throw new RenderError(400,'Invalid logo pixel count')
  for(let y=0;y<height;y++)if(pixels[y*stride]>4)throw new RenderError(400,'Invalid logo PNG filter')
  return {kind:'uploaded',sha256:createHash('sha256').update(bytes).digest('hex'),width,height}
}

export function createLogoStore({root,maxFiles=64,maxBytes=64*1024*1024}){
  const directory=path.join(root,'.cache/uploads/logos')
  // Fail closed if the project's mounted filesystem changes while the server runs.
  const device=stat(root).then(info=>info.dev)
  let queue=Promise.resolve()
  async function read(ref){
    const value=normaliseLogoRef(ref)
    if(value.kind!=='uploaded')return null
    let bytes
    try{bytes=await readFile(path.join(directory,value.sha256+'.png'))}catch{throw new RenderError(404,'Uploaded logo was not found')}
    const actual=inspectLogoPng(bytes)
    if(actual.sha256!==value.sha256||actual.width!==value.width||actual.height!==value.height)throw new RenderError(409,'Uploaded logo does not match its reference')
    return bytes
  }
  async function save(bytes){
    const ref=inspectLogoPng(bytes)
    if((await stat(root)).dev!==await device)throw new RenderError(503,'Logo storage is unavailable')
    await mkdir(directory,{recursive:true,mode:0o700})
    const filename=path.join(directory,ref.sha256+'.png')
    try{const existing=await readFile(filename);if(!existing.equals(bytes))throw new RenderError(409,'Logo hash collision');return ref}catch(error){if(error.code!=='ENOENT')throw error}
    const names=(await readdir(directory)).filter(name=>/^[a-f0-9]{64}\.png$/.test(name))
    const sizes=await Promise.all(names.map(name=>stat(path.join(directory,name)).then(info=>info.size)))
    if(names.length>=maxFiles||sizes.reduce((a,b)=>a+b,0)+bytes.length>maxBytes)throw new RenderError(507,'Logo storage quota reached')
    const temp=path.join(directory,'.'+randomUUID()+'.tmp')
    await writeFile(temp,bytes,{flag:'wx',mode:0o600});await rename(temp,filename)
    return ref
  }
  return {
    read,
    async upload(request){
      if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='image/png')throw new RenderError(415,'Content-Type must be image/png')
      const bytes=await readRequestBody(request,LOGO_MAX_BYTES),job=queue.then(()=>save(bytes));queue=job.catch(()=>{});return job
    },
    async serve(request,response,sha256){
      if(!['GET','HEAD'].includes(request.method)){response.setHeader('Allow','GET, HEAD');throw new RenderError(405,'Method not allowed')}
      let bytes
      try{bytes=await readFile(path.join(directory,sha256+'.png'))}catch{throw new RenderError(404,'Uploaded logo was not found')}
      if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw new RenderError(409,'Logo fingerprint mismatch')
      response.writeHead(200,{'Content-Type':'image/png','Content-Length':bytes.length,'Cache-Control':'private, max-age=31536000, immutable','ETag':'"'+sha256+'"','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'})
      response.end(request.method==='HEAD'?undefined:bytes)
    },
  }
}
