import {test} from 'node:test'
import assert from 'node:assert/strict'
import {BasicShadowMap,Color,PerspectiveCamera,ShaderChunk,Vector3} from 'three'
import {STUDIO_LOOK,STUDIO_STYLE,studioBackdropHex,studioBackdropRadiance,studioDisplay,studioRadiance,studioStageSignature} from '../src/studioLook.ts'
import {studioBackdrop} from '../src/studioBackdrop.ts'
import {bottleBackdrop} from '../src/bottleBackdrop.ts'

test('one immutable lighting, exposure and shadow profile is shared by all consumers',()=>{
  const signature=studioStageSignature()
  assert.throws(()=>{STUDIO_LOOK.exposure=2},TypeError)
  assert.throws(()=>{STUDIO_LOOK.key.position[2]=-4.2},TypeError)
  assert.equal(studioStageSignature(),signature)
  assert.equal(STUDIO_LOOK.ao.resolutionScale,1,'Never reallocate AO or change its brightness at motion start')
  assert.equal(STUDIO_LOOK.environment.intensity,1)
})

test('HDR background endpoint colours match the CSS loading surface after actual Three.js ACES',()=>{
  for(const hex of [STUDIO_LOOK.background.top,STUDIO_LOOK.background.bottom]){
    const result=studioDisplay(studioRadiance(hex))
    assert.equal('#'+result.getHexString(),hex)
    assert.ok(studioRadiance(hex).toArray().every(v=>Number.isFinite(v)&&v>0))
  }
  assert.equal(studioBackdropHex(1),STUDIO_STYLE['--studio-background-top'])
  assert.equal(studioBackdropHex(0),STUDIO_STYLE['--studio-background-bottom'])
})

test('CSS reveal gradient and the HDR sweep differ by at most one display code value',()=>{
  const encoded=hex=>new Color(hex).convertLinearToSRGB().toArray()
  for(let i=0;i<=160;i++){
    const y=i/160,index=Math.min(7,Math.floor(y*8)),fraction=y*8-index
    const a=encoded(studioBackdropHex(index/8)),b=encoded(studioBackdropHex((index+1)/8)),actual=studioDisplay(studioBackdropRadiance(y)).convertLinearToSRGB().toArray()
    assert.ok(actual.every((v,k)=>Math.abs(v-(a[k]+(b[k]-a[k])*fraction))*255<=1),'Loading must not flash when the rendered backdrop is revealed')
  }
})

test('the background shader uses normalized clip coordinates and has no model or pose inputs',()=>{
  assert.equal(bottleBackdrop,studioBackdrop,'Compatibility imports must not revive the old product-dependent paper')
  const {material}=studioBackdrop(),shader={fragmentShader:'#include <shadowmap_pars_fragment>\n#include <opaque_fragment>',vertexShader:'#include <project_vertex>',uniforms:{}}
  material.onBeforeCompile(shader,{shadowMap:{type:BasicShadowMap},domElement:{dataset:{}}})
  assert.ok(shader.vertexShader.includes('vStudioClip=gl_Position'))
  assert.ok(shader.fragmentShader.includes('vStudioClip.y/vStudioClip.w'))
  assert.ok(!/BackdropOpen|BackdropLying|vBottleBackdrop/.test(shader.fragmentShader))
  assert.ok(shader.fragmentShader.includes('studioGroundShadow()'),'Keep physical shadows on the shared paper')
  assert.deepEqual(Object.keys(shader.uniforms),['studioLiveShadow'])
  assert.equal(material.customProgramCacheKey(),STUDIO_LOOK.id+'-backdrop')
})

test('screen coordinates are invariant under perspective, camera roll and distance',()=>{
  const pixel=new Vector3(.7,.35,.1)
  for(const [aspect,fov,position,roll]of [[1.8,26,[3,2,8],0],[1,28,[-4,8,3],-.4],[.9,30,[1,.3,5],.5]]){
    const c=new PerspectiveCamera(fov,aspect,.025,100);c.position.fromArray(position);c.lookAt(0,0,0);c.rotateZ(roll);c.updateMatrixWorld()
    const world=pixel.clone().unproject(c),clip=world.clone().project(c)
    assert.ok(Math.abs(clip.y-pixel.y)<1e-10)
    assert.equal(studioBackdropHex(clip.y*.5+.5),studioBackdropHex(pixel.y*.5+.5))
  }
})

test('ACES constants stay aligned with the pinned renderer implementation',()=>{
  assert.ok(ShaderChunk.tonemapping_pars_fragment.includes('0.0245786'))
  assert.ok(ShaderChunk.tonemapping_pars_fragment.includes('0.983729'))
  assert.ok(ShaderChunk.tonemapping_pars_fragment.includes('toneMappingExposure / 0.6'))
})
