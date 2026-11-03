import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {applyApiCors,parseAllowedOrigins,API_EXPOSE_HEADERS} from '../server/cors.mjs'
import {assertRequestOrigin} from '../server/http.mjs'

test('CORS configuration accepts explicit origins and rejects wildcards, paths and credentials',()=>{
  assert.equal(parseAllowedOrigins().size,0)
  assert.deepEqual([...parseAllowedOrigins(' https://pages.invalid, http://127.0.0.1:5183 ')],['https://pages.invalid','http://127.0.0.1:5183'])
  for(const input of ['*','https://pages.invalid/','https://pages.invalid/path','https://user:secret@pages.invalid','https://pages.invalid?x=1','null'])assert.throws(()=>parseAllowedOrigins(input))
})
test('a separate frontend receives preflight, fingerprint headers and bounded origin access',async t=>{
  const allowed=parseAllowedOrigins('https://pages.invalid')
  const server=createServer((req,res)=>{
    try{
      if(applyApiCors(req,res,allowed))return
      if(req.method==='POST')assertRequestOrigin(req,allowed)
      res.writeHead(200,{'Content-Type':'application/json','X-Scene-SHA256':'a'.repeat(64)});res.end('{}')
    }catch(error){res.writeHead(error.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}))}
  })
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()})
  const url='http://127.0.0.1:'+server.address().port+'/api/render'
  const preflight=await fetch(url,{method:'OPTIONS',headers:{Origin:'https://pages.invalid','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type'}})
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://pages.invalid');assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/content-type/)
  const response=await fetch(url,{method:'POST',headers:{Origin:'https://pages.invalid','Content-Type':'application/json'},body:'{}'})
  assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://pages.invalid')
  for(const name of API_EXPOSE_HEADERS)assert.ok(response.headers.get('Access-Control-Expose-Headers').includes(name))
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(response.headers.get('Vary'),'Origin')
  for(const method of ['POST','OPTIONS']){
    const denied=await fetch(url,{method,headers:{Origin:'https://untrusted.invalid'}})
    assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null)
  }
  const deniedHeader=await fetch(url,{method:'OPTIONS',headers:{Origin:'https://pages.invalid','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'X-Untrusted'}})
  assert.equal(deniedHeader.status,403)
  assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,200)
})
