const PART_SIZE = 1024 * 1024
const MAX_SIZE = 128 * 1024 * 1024
export interface ModelDownloadOptions {signal?:AbortSignal;priority?:RequestPriority;partSize?:number;timeoutMs?:number;concurrency?:number}

async function readBody(response:Response,limit:number):Promise<ArrayBuffer> {
  // Fetch exposes decoded bytes, while Content-Length may describe gzip/br bytes.
  const encoding=response.headers.get('Content-Encoding')?.trim().toLowerCase()
  const declared=!encoding||encoding==='identity'?response.headers.get('Content-Length'):null
  if(declared!==null&&(!Number.isSafeInteger(Number(declared))||Number(declared)<1||Number(declared)>limit))throw Error('Invalid model response size')
  if(!response.body)throw Error('Empty model response')
  const reader=response.body.getReader(),parts:Uint8Array[]=[]
  let length=0
  try{
    for(;;){
      const {value,done}=await reader.read()
      if(done)break
      length+=value.byteLength
      if(length>limit)throw Error('Model response exceeds its byte limit')
      parts.push(value)
    }
    if(!length||declared!==null&&length!==Number(declared))throw Error('Incomplete model response')
    const buffer=new Uint8Array(length);let offset=0
    for(const part of parts){buffer.set(part,offset);offset+=part.byteLength}
    return buffer.buffer
  }catch(error){await reader.cancel().catch(()=>{});throw error}
  finally{reader.releaseLock()}
}
async function readPart(url:string,start:number,end:number,expectedSize:number|undefined,options:ModelDownloadOptions) {
  for(let attempt=0;;attempt++){
    options.signal?.throwIfAborted()
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),options.timeoutMs)
    const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal
    let response:Response|undefined
    try{
      response=await fetch(url,{headers:{Range:`bytes=${start}-${end}`},signal,priority:options.priority})
      if(!response.ok)throw Error(`HTTP ${response.status}`)
      if(response.status===200&&start===0){
        const buffer=await readBody(response,MAX_SIZE)
        return {buffer,size:buffer.byteLength,whole:true}
      }
      const range=response.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
      if(response.status!==206||!range)throw Error('Invalid model range')
      const [,from,to,total]=range.map(Number)
      if(!Number.isSafeInteger(total)||total<=0||total>MAX_SIZE||from!==start||to!==Math.min(end,total-1)||(expectedSize!==undefined&&total!==expectedSize))throw Error('Incomplete model range')
      const buffer=await readBody(response,to-from+1)
      if(buffer.byteLength!==to-from+1)throw Error('Incomplete model range')
      return {buffer,size:total,whole:false}
    }catch(error){
      await response?.body?.cancel().catch(()=>{})
      options.signal?.throwIfAborted()
      if(attempt>=1)throw error
    }finally{clearTimeout(timeout)}
  }
}

// Short transfers survive the response deadline of temporary HTTP tunnels.
export async function downloadModel(url:string,input:ModelDownloadOptions={}):Promise<ArrayBuffer> {
  const partSize=input.partSize??PART_SIZE,concurrency=input.concurrency??2,timeoutMs=input.timeoutMs??20_000
  for(const [key,value,max] of [['partSize',partSize,MAX_SIZE],['concurrency',concurrency,8],['timeoutMs',timeoutMs,2_147_483_647]] as const){
    if(!Number.isSafeInteger(value)||value<1||value>max)throw new RangeError('Invalid model download '+key)
  }
  const controller=new AbortController(),signal=input.signal?AbortSignal.any([input.signal,controller.signal]):controller.signal
  const options={...input,partSize,concurrency,timeoutMs,signal}
  try{
    const first=await readPart(url,0,partSize-1,undefined,options)
    if(first.whole||first.buffer.byteLength===first.size)return first.buffer
    const result=new Uint8Array(first.size);result.set(new Uint8Array(first.buffer))
    let next=first.buffer.byteLength
    await Promise.all(Array.from({length:concurrency},async()=>{
      while(next<first.size){
        const start=next;next+=partSize
        const part=await readPart(url,start,Math.min(start+partSize,first.size)-1,first.size,options)
        result.set(new Uint8Array(part.buffer),start)
      }
    }))
    return result.buffer
  }catch(error){controller.abort(error);throw error}
}
