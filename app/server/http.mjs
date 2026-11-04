export class HttpError extends Error {
  constructor(status,message){super(message);this.name=new.target.name;this.status=status}
}

export function assertRequestOrigin(request,allowed=new Set()){
  if(request.headers.origin===undefined)return
  try{
    const origin=new URL(request.headers.origin)
    if(!['http:','https:'].includes(origin.protocol)||(origin.host!==request.headers.host&&!allowed.has(origin.origin)))throw Error('Different host')
  }catch{throw new HttpError(403,'Cross-origin requests are not allowed')}
}

/** Do not destroy the socket on a size rejection: the caller must still send 413. */
export async function readRequestBody(request,limit){
  const declared=request.headers['content-length']
  if(declared!==undefined&&(!Number.isSafeInteger(Number(declared))||Number(declared)<0))throw new HttpError(400,'Invalid Content-Length')
  if(Number(declared)>limit)throw new HttpError(413,'Request body is too large')
  const chunks=[];let length=0
  for await(const chunk of request.iterator({destroyOnReturn:false})){
    length+=chunk.length
    if(length>limit)throw new HttpError(413,'Request body is too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks,length)
}
