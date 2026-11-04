/** Only bottle.html carries an optional public API origin; render.html stays local. */
export function apiUrl(route:string,baseUrl=location.href,configuredOrigin=typeof document==='undefined'?'':document.querySelector<HTMLMetaElement>('meta[name="s3dlabs-api-origin"]')?.content??''):URL{
  if(!/^[a-z0-9-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(route)||route.split('/').some(part=>part==='.'||part==='..'))throw new TypeError('Invalid API route')
  if(!configuredOrigin.trim())return new URL('./api/'+route,baseUrl)
  const origin=new URL(configuredOrigin.trim())
  const local=origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname)
  if((origin.protocol!=='https:'&&!local)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new TypeError('Invalid API origin')
  return new URL('/api/'+route,origin)
}
