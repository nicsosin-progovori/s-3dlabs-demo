import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,request as httpRequest} from 'node:http'
import {once} from 'node:events'
import {HttpError,readRequestBody} from '../server/http.mjs'

test('oversized fixed/chunked requests return 413 without destroying the response socket',async t=>{
  const server=createServer(async(req,res)=>{
    try{const bytes=await readRequestBody(req,8);res.writeHead(200);res.end(bytes)}
    catch(error){if(error instanceof HttpError&&error.status===413){res.setHeader('Connection','close');req.resume()}res.writeHead(error.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}))}
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(()=>{server.closeAllConnections();server.close()})
  const send=(chunks,headers)=>new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:'/',method:'POST',headers},res=>{const body=[];res.on('data',c=>body.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(body).toString()}))})
    req.on('error',reject);for(const chunk of chunks)req.write(chunk);req.end()
  })
  assert.deepEqual(await send(['1234','5678'],{}),{status:200,body:'12345678'})
  for(const headers of [{},{'Content-Length':'12'}]){
    const response=await send(['123456','789012'],headers);assert.equal(response.status,413);assert.match(response.body,/too large/)
  }
})

test('origin checks reject malformed/opaque headers with 403 instead of an internal error',async()=>{
  const {assertRequestOrigin}=await import('../server/http.mjs')
  for(const origin of ['not a url','null','file://local.invalid','http://external.invalid'])assert.throws(()=>assertRequestOrigin({headers:{host:'local.invalid',origin}}),error=>error.status===403)
  assert.doesNotThrow(()=>assertRequestOrigin({headers:{host:'local.invalid',origin:'http://local.invalid'}}))
  assert.doesNotThrow(()=>assertRequestOrigin({headers:{host:'local.invalid'}}))
})
