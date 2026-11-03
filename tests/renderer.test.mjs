import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import {PerspectiveCamera} from 'three'
import {createRenderer} from '../server/renderer.mjs'
import {validateRenderRequest} from '../shared/renderContract.mjs'
import {DEFAULT_COMPOSITION} from '../shared/compositionContract.mjs'
import {DEFAULT_DECORATION} from '../shared/bottleBrandingContract.mjs'

function job(){
  const camera=new PerspectiveCamera(28,1,.025,100);camera.position.set(0,1,5);camera.lookAt(0,1,0)
  return validateRenderRequest({version:5,product:'bottle',state:'closed',skin:{id:'bottle-black',revision:'v01'},scene:{id:'source-studio',revision:'v01',sha256:'a'.repeat(64)},composition:DEFAULT_COMPOSITION,decoration:DEFAULT_DECORATION,camera:{position:camera.position.toArray(),target:[0,1,0],quaternion:camera.quaternion.toArray(),projectionMatrix:camera.projectionMatrix.toArray(),aspect:1,fov:28,near:.025,far:100,zoom:1,roll:0},image:{width:64,height:64}})
}
function result(request){
  const png=Buffer.alloc(24);png.write('89504e470d0a1a0a',0,'hex');png.writeUInt32BE(request.image.width,16);png.writeUInt32BE(request.image.height,20)
  return {image:'data:image/png;base64,'+png.toString('base64'),camera:structuredClone(request.camera),skin:request.skin,scene:request.scene,composition:request.composition,decoration:request.decoration}
}
class Browser extends EventEmitter{
  closed=false;contexts=0;closedContexts=0
  constructor(draw=result,startContext){super();this.draw=draw;this.startContext=startContext}
  async newContext(){
    if(this.closed)throw Error('Browser disconnected')
    if(this.startContext)await this.startContext()
    this.contexts++;let released=false
    return {route:async()=>{},close:async()=>{if(!released){released=true;this.closedContexts++}},newPage:async()=>({on:()=>{},setDefaultTimeout:()=>{},goto:async()=>{},waitForFunction:async()=>{},evaluate:(_fn,request)=>this.draw(request)})}
  }
  async close(){if(this.closed)return;this.closed=true;this.emit('disconnected')}
}
const renderer=launchBrowser=>createRenderer({root:'.',origin:'http://local.invalid',launchBrowser})
test('a disconnected browser is replaced for the next valid job',async()=>{
  const browsers=[];const app=renderer(async()=>{const browser=new Browser();browsers.push(browser);return browser})
  try{await app.render(job());await browsers[0].close();await app.render(job());assert.equal(browsers.length,2);assert.equal(app.status().completed,2)}finally{await app.close()}
})
test('queue is bounded and shutdown rejects active/queued work without starting another browser',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);let calls=0
  const browser=new Browser(async request=>{await gate;return result(request)})
  const app=createRenderer({root:'.',origin:'http://local.invalid',maxJobs:2,launchBrowser:async()=>{calls++;return browser}})
  const first=app.render(job()),second=app.render(job()),failure1=assert.rejects(first,e=>e.status===503),failure2=assert.rejects(second,e=>e.status===503)
  await assert.rejects(app.render(job()),e=>e.status===429)
  await delay(5);await app.close();release();await Promise.all([failure1,failure2])
  assert.equal(calls,1);assert.equal(browser.closed,true);assert.equal(app.status().pending,0)
})
test('the deadline includes browser launch and a late browser is closed',async()=>{
  const browser=new Browser();let release;const gate=new Promise(resolve=>release=resolve)
  const app=createRenderer({root:'.',origin:'http://local.invalid',timeoutMs:15,launchBrowser:async()=>{await gate;return browser}})
  const keepAlive=delay(80)
  try{
    await assert.rejects(app.render(job()),e=>e.status===504)
    release();await delay(5);assert.equal(browser.closed,true);assert.equal(browser.contexts,0)
  }finally{release();await app.close();await keepAlive}
})
test('a context that arrives after cancellation is released',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),browser=new Browser(result,()=>gate)
  const app=createRenderer({root:'.',origin:'http://local.invalid',timeoutMs:15,launchBrowser:async()=>browser}),keepAlive=delay(80)
  try{await assert.rejects(app.render(job()),e=>e.status===504);release();await delay(5);assert.equal(browser.closedContexts,1)}finally{release();await app.close();await keepAlive}
})
test('incomplete camera reports are rejected and do not poison the next job',async()=>{
  let launch=0
  const app=renderer(async()=>new Browser(request=>{const value=result(request);if(++launch===1)value.camera.position=[];return value}))
  try{await assert.rejects(app.render(job()),e=>e.status===503);await app.render(job());assert.equal(app.status().completed,1)}finally{await app.close()}
})
