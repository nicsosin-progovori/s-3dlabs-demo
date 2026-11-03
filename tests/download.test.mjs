import test from 'node:test'
import assert from 'node:assert/strict'
import {downloadModel} from '../src/download.ts'

const part=(bytes,start,end,total)=>new Response(bytes,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${total}`}})
test('invalid download limits are rejected before starting network work',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Network should not start')})
  for(const options of [{partSize:0},{partSize:1.5},{partSize:Infinity},{partSize:128*1024*1024+1},{concurrency:0},{concurrency:9},{concurrency:NaN},{timeoutMs:0},{timeoutMs:Infinity}])await assert.rejects(downloadModel('unused',options),/Invalid model download/)
  assert.equal(calls,0)
})
test('a failed range cancels other workers instead of downloading an abandoned model',async t=>{
  const lifetime=new AbortController();let siblingSignal,attempts=0
  t.mock.method(globalThis,'fetch',async(_,options)=>{
    const start=Number(/bytes=(\d+)/.exec(options.headers.Range)[1])
    if(start===0)return part(new Uint8Array([1,2,3,4]),0,3,12)
    if(start===4){attempts++;throw Error('Range connection lost')}
    siblingSignal=options.signal
    return new Promise((_,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})})
  })
  try{
    await assert.rejects(downloadModel('unused',{partSize:4,concurrency:2,signal:lifetime.signal}),/Range connection lost/)
    assert.equal(attempts,2);assert.ok(siblingSignal);assert.equal(siblingSignal.aborted,true)
  }finally{lifetime.abort()}
})
test('range body is bounded while streaming and is cancelled when the server sends excess data',async t=>{
  let cancelled=0
  t.mock.method(globalThis,'fetch',async()=>part(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(5));controller.enqueue(new Uint8Array(64));controller.close();},cancel(){cancelled++}}),0,3,4))
  await assert.rejects(downloadModel('unused',{partSize:4}),/model/i)
  assert.equal(cancelled,2)
})
test('an excessive full-response Content-Length is rejected without accepting a short misleading body',async t=>{
  let cancelled=0
  t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.close()},cancel(){cancelled++}}),{headers:{'Content-Length':String(128*1024*1024+1)}}))
  await assert.rejects(downloadModel('unused'),/model/i)
  assert.equal(cancelled,2)
})
test('valid ranges and whole-response compatibility preserve every byte',async t=>{
  const bytes=Uint8Array.from({length:19},(_,i)=>i+1);let whole=false
  t.mock.method(globalThis,'fetch',async(_,options)=>{
    if(whole)return new Response(bytes)
    const [,from,to]=/bytes=(\d+)-(\d+)/.exec(options.headers.Range),start=Number(from),end=Math.min(Number(to),bytes.length-1)
    return part(bytes.slice(start,end+1),start,end,bytes.length)
  })
  assert.deepEqual(new Uint8Array(await downloadModel('unused',{partSize:4})),bytes)
  whole=true;assert.deepEqual(new Uint8Array(await downloadModel('unused')),bytes)
})

test('decoded gzip/br responses are bounded by decoded bytes rather than their compressed Content-Length',async t=>{
  const bytes=new Uint8Array([1,2,3,4,5,6])
  t.mock.method(globalThis,'fetch',async()=>new Response(bytes,{headers:{'Content-Encoding':'gzip','Content-Length':'3'}}))
  assert.deepEqual(new Uint8Array(await downloadModel('unused')),bytes)
})
