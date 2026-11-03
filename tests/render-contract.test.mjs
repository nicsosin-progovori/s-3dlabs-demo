import test from 'node:test'
import assert from 'node:assert/strict'
import {PerspectiveCamera} from 'three'
import {normaliseState,validateCamera,validateRenderRequest} from '../shared/renderContract.mjs'
import {DEFAULT_COMPOSITION} from '../shared/compositionContract.mjs'

function job(){
  const camera=new PerspectiveCamera(28,1.5,.025,100)
  camera.position.set(3,2,8);camera.lookAt(0,1.2,0)
  return {version:1,product:'bottle',state:'closed',camera:{position:camera.position.toArray(),target:[0,1.2,0],quaternion:camera.quaternion.toArray(),fov:camera.fov,roll:0,aspect:camera.aspect,near:camera.near,far:camera.far,zoom:camera.zoom,projectionMatrix:camera.projectionMatrix.toArray()},image:{width:1200,height:800}}
}
test('render contract preserves the actual camera and strips non-contract data',()=>{
  const input=job();input.url='https://untrusted.invalid';input.camera.html='<script>bad</script>'
  const parsed=validateRenderRequest(input)
  assert.deepEqual(parsed.camera.position,input.camera.position)
  assert.deepEqual(parsed.camera.quaternion,input.camera.quaternion)
  assert.deepEqual(parsed.camera.projectionMatrix,input.camera.projectionMatrix)
  assert.equal('url'in parsed,false);assert.equal('html'in parsed.camera,false)
})
test('known states and console example aliases are accepted; invalid input is rejected',()=>{
  assert.deepEqual(['a','b','c'].map(normaliseState),['closed','open','lying'])
  for(const state of ['unknown',null,{},['a'],['b'],'constructor','__proto__'])assert.throws(()=>normaliseState(state))
})
test('camera rejects NaN, infinity, missing target, zero distance and invalid optics',()=>{
  const camera=job().camera
  for(const override of [{position:[NaN,0,1]},{position:[0,Infinity,1]},{target:undefined},{position:camera.target},{fov:0},{near:0},{far:.01},{zoom:0}])assert.throws(()=>validateCamera({...camera,...override}))
})
test('render rejects excessive dimensions, wrong aspect, non-unit orientation and invalid matrices',()=>{
  for(const mutate of [j=>j.image.width=4096,j=>j.image.height=801.5,j=>j.image.height=1200,j=>j.camera.quaternion=[0,0,0,0],j=>j.camera.projectionMatrix=[0],j=>j.camera.projectionMatrix[0]=Infinity,j=>j.version=999,j=>j.product='endo']){
    const input=job();mutate(input);assert.throws(()=>validateRenderRequest(input))
  }
})
test('v1 keeps the fixed black skin; v2 requires a known explicit skin and revision',()=>{
  assert.deepEqual(validateRenderRequest(job()).skin,{id:'bottle-black',revision:'v01'})
  assert.equal(validateRenderRequest(job()).version,5)
  const input={...job(),version:2,skin:{id:'bottle-red',revision:'v01'}}
  assert.deepEqual(validateRenderRequest(input).skin,input.skin)
  for(const skin of [undefined,{},'bottle-red',{id:'bottle-red',revision:'unknown'},{id:'constructor',revision:'v01'},{id:'bottle-red',revision:'v01',url:'https://untrusted.invalid'}]){
    if(skin?.id==='bottle-red'&&skin.revision==='v01'){assert.deepEqual(validateRenderRequest({...input,skin}).skin,input.skin)}
    else assert.throws(()=>validateRenderRequest({...input,skin}))
  }
  assert.throws(()=>validateRenderRequest({...job(),skin:input.skin}))
})
test('v3 binds PNG to an explicit scene fingerprint; legacy contracts cannot inject a scene',()=>{
  const scene={id:'source-studio',revision:'v01',sha256:'a'.repeat(64)}
  const input={...job(),version:3,skin:{id:'bottle-red',revision:'v01'},scene}
  assert.deepEqual(validateRenderRequest(input).scene,scene)
  assert.equal(validateRenderRequest(job()).scene,null)
  for(const bad of [undefined,null,{...scene,sha256:'x'},{...scene,id:'../other'},{...scene,url:'https://untrusted.invalid'}])assert.throws(()=>validateRenderRequest({...input,scene:bad}))
  assert.throws(()=>validateRenderRequest({...input,version:2}));assert.throws(()=>validateRenderRequest({...job(),scene}))
})
test('v4 carries a validated composition; v1–v3 remain one bottle and cannot inject members',()=>{
  const scene={id:'source-studio',revision:'v01',sha256:'a'.repeat(64)},skin={id:'bottle-black',revision:'v01'}
  const input={...job(),version:4,scene,skin,composition:DEFAULT_COMPOSITION}
  assert.deepEqual(validateRenderRequest(input).composition,DEFAULT_COMPOSITION)
  assert.deepEqual(validateRenderRequest(job()).composition,DEFAULT_COMPOSITION)
  for(const composition of [undefined,null,{...DEFAULT_COMPOSITION,elements:[]},{...DEFAULT_COMPOSITION,url:'x'}])assert.throws(()=>validateRenderRequest({...input,composition}))
  assert.throws(()=>validateRenderRequest({...input,version:3}))
})

test('impossible perspective projections are rejected; a valid off-axis snapshot is preserved',()=>{
  for(const change of [matrix=>matrix.fill(0),matrix=>matrix[11]=0,matrix=>matrix[0]=0,matrix=>matrix[14]=1,matrix=>matrix[3]=1]){
    const value=job();change(value.camera.projectionMatrix);assert.throws(()=>validateRenderRequest(value),/projection/i)
  }
  const value=job();value.camera.projectionMatrix[8]=.15;value.camera.projectionMatrix[9]=-.08
  assert.deepEqual(validateRenderRequest(value).camera.projectionMatrix,value.camera.projectionMatrix)
})
