import { MeshStandardMaterial } from 'three'
import { bottleSoftShadows } from './bottleShadows.ts'
import { STUDIO_LOOK,studioRadiance } from './studioLook.ts'
import type { StudioLook } from './studioLook.ts'

/** Camera-invariant studio paper, with physical ground shadows on the sweep. */
export function studioBackdrop(look:StudioLook=STUDIO_LOOK){
  const liveShadow={value:1}
  const material=bottleSoftShadows(new MeshStandardMaterial({color:'white',roughness:1,metalness:0}),true)
  const prior=material.onBeforeCompile.bind(material)
  material.onBeforeCompile=(shader,renderer)=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>','#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
    prior(shader,renderer)
    shader.uniforms.studioLiveShadow=liveShadow
    shader.vertexShader='varying vec4 vStudioClip;\n'+shader.vertexShader
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvStudioClip=gl_Position;')
    const vector=(hex:string)=>'vec3('+studioRadiance(hex,look.exposure).toArray().map(v=>v.toFixed(9)).join(',')+')'
    shader.fragmentShader=[
      'varying vec4 vStudioClip;',
      'uniform float studioLiveShadow;',
      'vec3 studioSweep(){',
      '  float verticalUv=clamp(vStudioClip.y/vStudioClip.w*.5+.5,0.,1.);',
      '  return mix('+vector(look.background.bottom)+','+vector(look.background.top)+',verticalUv);',
      '}',
    ].join('\n')+'\n'+shader.fragmentShader
    shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmask_pars_fragment>',[
      '#include <shadowmask_pars_fragment>',
      'float studioGroundShadow(){',
      '#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 1',
      '  DirectionalLightShadow source=directionalLightShadows[1];',
      '  return receiveShadow?getShadow(directionalShadowMap[1],source.shadowMapSize,source.shadowIntensity,source.shadowBias,source.shadowRadius,vDirectionalShadowCoord[1]):1.;',
      '#else',
      '  return getShadowMask();',
      '#endif',
      '}',
    ].join('\n'))
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','outgoingLight=studioSweep()*mix(1.,mix(.36,1.,studioGroundShadow()),studioLiveShadow);\n#include <opaque_fragment>')
  }
  material.customProgramCacheKey=()=>look.id+'-backdrop'
  return {material,liveShadow}
}
