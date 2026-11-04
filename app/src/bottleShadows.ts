import { Material, ShaderChunk, ShaderMaterial } from 'three'

// Contact-hardening shadows for the bottle stage only. Based on the PCSS
// technique in three.js/examples/webgl_shadowmap_pcss.html (MIT, three.js).
// Orthographic depth is linear: convert blocker separation to world units.
const pcss=/* glsl */`
#if defined(USE_SHADOWMAP) && defined(SHADOWMAP_TYPE_BASIC)
vec2 bottleDisk(int i,int n,float phi) {
  float r=sqrt((float(i)+.5)/float(n));
  float a=float(i)*2.39996323+phi;
  return vec2(cos(a),sin(a))*r;
}
float bottlePCSS(sampler2D map,vec2 uv,float receiver,vec2 mapSize) {
  float phi=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)*6.2831853;
  float blockers=0.;float depthSum=0.;
  for(int i=0;i<16;i++) {
    vec2 offset=i==0?vec2(0.):bottleDisk(i,16,phi)*.025;
    float depth=texture2D(map,uv+offset).r;
    if(depth<receiver){blockers+=1.;depthSum+=depth;}
  }
  if(blockers==0.)return 1.;
  float separation=max(0.,receiver-depthSum/blockers)*24.9;
  float radius=clamp(separation*.14/9.,1.25/mapSize.x,.065);
  float visible=0.;
  for(int i=0;i<32;i++)visible+=step(receiver,texture2D(map,uv+bottleDisk(i,32,phi)*radius).r);
  return visible/32.;
}
#endif
`

export function bottleSoftShadows<T extends Material>(material:T,ground=false):T {
  const prior=material.onBeforeCompile.bind(material)
  material.onBeforeCompile=(shader,renderer)=>{
    prior(shader,renderer)
    const chunk=ShaderChunk.shadowmap_pars_fragment
    const replacement='shadow = bottlePCSS( shadowMap, shadowCoord.xy, shadowCoord.z, shadowMapSize );'
    // The distributed chunk has no comments. Anchor both receiver paths to
    // executable GLSL, so the product cannot silently retain an unfiltered edge.
    const custom=chunk.replace('shadow = step( shadowCoord.z, depth );',replacement)
    const filter=ground?pcss.replace('*.025','*.065').replace('separation*.14','separation*.20').replace(',.065)',',.10)'):pcss.replace('1.25/mapSize.x','2.0/mapSize.x')
    if(ground)material.userData.bottleShadowPatch={patched:custom.includes('shadow = bottlePCSS'),basicDefine:renderer.shadowMap.type,include:shader.fragmentShader.includes('#include <shadowmap_pars_fragment>')}
    else {
      material.userData.bottleShadowPatch={patched:custom.includes(replacement),basicDefine:renderer.shadowMap.type,include:shader.fragmentShader.includes('#include <shadowmap_pars_fragment>'),kernel:'product-pcss-v04',minimumRadiusTexels:2}
      renderer.domElement.dataset.productShadowKernel=JSON.stringify(material.userData.bottleShadowPatch)
    }
    shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',filter+custom)
  }
  material.customProgramCacheKey=()=>ground?'bottle-ground-pcss-v03':'bottle-pcss-v04'
  return material
}

/** Normalize by unoccluded texels, rather than an arbitrary alpha threshold.
 * This keeps the finite shadow catcher completely invisible outside shadows. */
export function bottleAreaShadow(material:ShaderMaterial,density=1) {
  if(material.uniforms.bottleShadowDensity)material.uniforms.bottleShadowDensity.value=density
  if(material.userData.bottleNormalizedShadow)return
  material.userData.bottleNormalizedShadow=true
  material.uniforms.bottleShadowDensity={value:density}
  material.fragmentShader='uniform float bottleShadowDensity;\n'+material.fragmentShader
  material.fragmentShader=material.fragmentShader.replace(
    'gl_FragColor = vec4(color * sampledDiffuseColor.r * blend, max(0.0, (1.0 - (sampledDiffuseColor.r + sampledDiffuseColor.g + sampledDiffuseColor.b) / alphaTest)) * opacity);',
    `float referenceLight=max(max(texture2D(map,vec2(.03,.03)).r,texture2D(map,vec2(.97,.03)).r),max(texture2D(map,vec2(.03,.97)).r,texture2D(map,vec2(.97,.97)).r));
     float visibility=clamp(sampledDiffuseColor.r/max(referenceLight,.0001),0.,1.);
     gl_FragColor=vec4(color,(1.-pow(visibility,bottleShadowDensity))*opacity);`
  )
  material.needsUpdate=true
}
