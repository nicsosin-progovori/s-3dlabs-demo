import {HttpError} from './http.mjs'

export const API_EXPOSE_HEADERS=['ETag','X-Camera-Views-Revision','X-Scene-SHA256','X-Scene-Revision','X-Render-Engine','X-Render-Id','X-Render-Skin','X-Render-Camera-SHA256','X-Render-Scene','X-Render-Scene-SHA256','X-Render-Composition-SHA256','X-Render-Decoration-SHA256']
const methods=['GET','HEAD','POST'],headers=['content-type','accept','if-none-match']
export function parseAllowedOrigins(input=''){
  return new Set(input.split(',').map(value=>value.trim()).filter(Boolean).map(value=>{
    const url=new URL(value)
    if(!['http:','https:'].includes(url.protocol)||url.origin!==value)throw new TypeError('BOTTLE_ALLOWED_ORIGINS must contain exact HTTP(S) origins')
    return url.origin
  }))
}
/** Returns true only when this function has completed an allowed preflight. */
export function applyApiCors(request,response,allowed){
  response.setHeader('Vary','Origin')
  const origin=request.headers.origin
  if(!origin||!allowed.has(origin)){
    if(request.method==='OPTIONS')throw new HttpError(403,'Origin is not allowed')
    return false
  }
  response.setHeader('Access-Control-Allow-Origin',origin)
  response.setHeader('Access-Control-Expose-Headers',API_EXPOSE_HEADERS.join(', '))
  if(request.method!=='OPTIONS')return false
  const requested=(request.headers['access-control-request-headers']??'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean)
  if(!methods.includes(request.headers['access-control-request-method'])||requested.some(value=>!headers.includes(value)))throw new HttpError(403,'CORS request is not allowed')
  response.writeHead(204,{'Access-Control-Allow-Methods':methods.join(', '),'Access-Control-Allow-Headers':headers.join(', '),'Access-Control-Max-Age':'600','Cache-Control':'no-store'})
  response.end();return true
}
