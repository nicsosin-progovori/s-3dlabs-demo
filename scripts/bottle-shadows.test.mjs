import {test} from 'node:test'
import assert from 'node:assert/strict'
import {BasicShadowMap,MeshStandardMaterial,ShaderChunk} from 'three'
import {bottleSoftShadows} from '../src/bottleShadows.ts'

function compile(ground=false,prior){
  const material=new MeshStandardMaterial(),renderer={shadowMap:{type:BasicShadowMap},domElement:{dataset:{}}}
  if(prior)material.onBeforeCompile=prior
  bottleSoftShadows(material,ground)
  const shader={fragmentShader:'#include <shadowmap_pars_fragment>',vertexShader:'',uniforms:{}}
  material.onBeforeCompile(shader,renderer)
  return {material,shader,renderer}
}

test('product PCSS replaces the actual distributed BasicShadowMap comparison',()=>{
  assert.ok(!ShaderChunk.shadowmap_pars_fragment.includes('#else // SHADOWMAP_TYPE_BASIC'),'Regression fixture must exercise the comment-free distribution')
  const {material,shader,renderer}=compile()
  assert.equal(shader.fragmentShader.split('shadow = bottlePCSS( shadowMap, shadowCoord.xy, shadowCoord.z, shadowMapSize );').length-1,1)
  assert.ok(!shader.fragmentShader.includes('shadow = step( shadowCoord.z, depth );'))
  assert.equal(material.userData.bottleShadowPatch.patched,true)
  assert.equal(JSON.parse(renderer.domElement.dataset.productShadowKernel).basicDefine,BasicShadowMap)
})

test('product edges use a two-texel minimum filter with contact hardening',()=>{
  const {shader}=compile()
  assert.ok(shader.fragmentShader.includes('2.0/mapSize.x'))
  assert.ok(shader.fragmentShader.includes('separation*.14'))
  assert.ok(shader.fragmentShader.includes('i<16')&&shader.fragmentShader.includes('i<32'))
  assert.ok(shader.fragmentShader.includes('defined(SHADOWMAP_TYPE_BASIC)'))
})

test('ground keeps its accepted wider contact-hardening kernel and program identity',()=>{
  const {shader,material,renderer}=compile(true)
  assert.ok(shader.fragmentShader.includes('1.25/mapSize.x'))
  assert.ok(shader.fragmentShader.includes('separation*.20'))
  assert.ok(shader.fragmentShader.includes('bottleDisk(i,16,phi)*.065'))
  assert.equal(material.customProgramCacheKey(),'bottle-ground-pcss-v03')
  assert.equal(renderer.domElement.dataset.productShadowKernel,undefined)
})

test('patching is material-local, preserves prior callbacks and invalidates the old product shader cache',()=>{
  const original=ShaderChunk.shadowmap_pars_fragment
  const {material,shader}=compile(false,s=>{s.fragmentShader='// prior material customization\n'+s.fragmentShader})
  assert.ok(shader.fragmentShader.startsWith('// prior material customization'))
  assert.equal(ShaderChunk.shadowmap_pars_fragment,original)
  assert.equal(material.customProgramCacheKey(),'bottle-pcss-v04')
})
