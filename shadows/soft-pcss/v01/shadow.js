// shadows/soft-pcss/v01 — мягкая студийная тень. Пакет тени: движок его не содержит,
// а получает по ссылке из манифеста объекта (render.shadow) и вставляет в гнездо тени.
// Контракт: docs/architecture/shadow.md. three приходит от движка (ctx.three), своих импортов нет.
//
// Две части:
//   1) ПОЛ — накопительная мягкая тень на плоскости-приёмнике (progressive light map).
//      Основано на drei AccumulativeShadows/RandomizedLight (MIT) и «Progressive Light Map
//      Accumulator» by zalo. Отличие: вместо Math.random — детерминированный генератор,
//      чтобы PNG был повторяемым.
//   2) ОБЪЕКТ — PCSS-фильтр теней на материалах объекта (процессор пула, стадия lighting).
//      Работает, когда свет сцены даёт карту теней в основном проходе; иначе не влияет.
//
// Направление и чёткость тени — НЕ здесь: их задаёт свет сцены (ctx.light).

const PCSS = /* glsl */`
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
  float radius=clamp(separation*.14/9.,MIN_TEXELS/mapSize.x,.065);
  float visible=0.;
  for(int i=0;i<32;i++)visible+=step(receiver,texture2D(map,uv+bottleDisk(i,32,phi)*radius).r);
  return visible/32.;
}
#endif
`

function receiverProcessor(three, minTexels) {
  const texels = Number(minTexels).toFixed(2)
  return {
    id: 'pcss',
    programKey: () => 'soft-pcss-v01:product:' + texels,
    patch(shader) {
      const replacement = 'shadow = bottlePCSS( shadowMap, shadowCoord.xy, shadowCoord.z, shadowMapSize );'
      const custom = three.ShaderChunk.shadowmap_pars_fragment.replace('shadow = step( shadowCoord.z, depth );', replacement)
      if (!custom.includes(replacement)) throw new Error('soft-pcss@v01: shadowmap chunk does not match this three version')
      shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', PCSS.replace('MIN_TEXELS', texels) + custom)
    },
  }
}

/** Детерминированный генератор (mulberry32): один и тот же кадр → одна и та же тень. */
function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function softShadowMaterial(three, color, toneMapped) {
  return new three.ShaderMaterial({
    name: 'soft-pcss@v01:ground',
    transparent: true, depthWrite: false, toneMapped,
    uniforms: { color: { value: new three.Color(color) }, blend: { value: 2 }, alphaTest: { value: 0 }, opacity: { value: 0 }, map: { value: null } },
    vertexShader: `varying vec2 vUv;
      void main(){ gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); vUv = uv; }`,
    fragmentShader: `varying vec2 vUv;
      uniform sampler2D map; uniform vec3 color; uniform float opacity; uniform float alphaTest; uniform float blend;
      void main(){
        vec4 sampled = texture2D(map, vUv);
        gl_FragColor = vec4(color * sampled.r * blend, max(0.0, (1.0 - (sampled.r + sampled.g + sampled.b) / alphaTest)) * opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

/** Накопитель карты освещённости пола: два буфера, усреднение по кадрам. */
function lightMap(three, renderer, scene, resolution) {
  const options = { type: three.HalfFloatType, magFilter: three.NearestFilter, minFilter: three.NearestFilter }
  const a = new three.WebGLRenderTarget(resolution, resolution, options)
  const b = new three.WebGLRenderTarget(resolution, resolution, options)
  const discard = new three.ShaderMaterial({ vertexShader: 'void main(){ gl_Position = vec4(0.); }', fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); discard; }' })
  const previous = { value: a.texture }, window = { value: 100 }
  const target = new three.MeshLambertMaterial({ fog: false })
  target.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 vUv;\n' + shader.vertexShader.slice(0, -1) + 'vUv = uv; gl_Position = vec4((uv - 0.5) * 2.0, 1.0, 1.0); }'
    const body = shader.fragmentShader.indexOf('void main() {')
    shader.fragmentShader = 'varying vec2 vUv;\n' + shader.fragmentShader.slice(0, body) + 'uniform sampler2D previousShadowMap;\nuniform float averagingWindow;\n' +
      shader.fragmentShader.slice(body - 1, -1) + '\nvec3 texelOld = texture2D(previousShadowMap, vUv).rgb;\ngl_FragColor.rgb = mix(texelOld, gl_FragColor.rgb, 1.0 / averagingWindow);\n}'
    shader.uniforms.previousShadowMap = previous
    shader.uniforms.averagingWindow = window
  }
  let first = false, lights = [], meshes = [], plane = null
  const clearColor = new three.Color()
  return {
    output: b.texture,
    configure(mesh) { plane = mesh },
    clear() {
      renderer.getClearColor(clearColor)
      const alpha = renderer.getClearAlpha()
      renderer.setClearColor('black', 1)
      for (const t of [a, b]) { renderer.setRenderTarget(t); renderer.clear() }
      renderer.setRenderTarget(null)
      renderer.setClearColor(clearColor, alpha)
      lights = []; meshes = []
      scene.traverse(o => { if (o.geometry) meshes.push({ o, m: o.material }); else if (o.isLight) lights.push({ o, i: o.intensity }) })
    },
    prepare() { lights.forEach(l => { l.o.intensity = 0 }); meshes.forEach(m => { m.o.material = discard }) },
    finish() { lights.forEach(l => { l.o.intensity = l.i }); meshes.forEach(m => { m.o.material = m.m }) },
    update(camera, blend) {
      if (!plane) return
      window.value = blend
      plane.material = target
      const active = first ? a : b, inactive = first ? b : a
      const background = scene.background, environment = scene.environment
      scene.background = null; scene.environment = null
      renderer.setRenderTarget(active)
      previous.value = inactive.texture
      first = !first
      renderer.render(scene, camera)
      renderer.setRenderTarget(null)
      scene.background = background; scene.environment = environment
    },
    dispose() { a.dispose(); b.dispose(); discard.dispose(); target.dispose() },
  }
}

/** Группа направленных лучей вокруг позиции света; каждый кадр — новые позиции. */
function randomizedLight(three, group, { amount, intensity, position, radius, ambient, mapSize, size = 5, near = 0.1, far = 25, bias = 0.0002 }) {
  const holder = new three.Group()
  const base = new three.Vector3(...position), length = base.length()
  for (let i = 0; i < amount; i++) {
    const light = new three.DirectionalLight(0xffffff, intensity / amount)
    light.castShadow = true
    light.shadow.bias = bias
    light.shadow.mapSize.set(mapSize, mapSize)
    light.shadow.camera = new three.OrthographicCamera(-size, size, size, -size, near, far)
    holder.add(light)
  }
  group.add(holder)
  return {
    update(rand) {
      for (const light of holder.children) {
        if (rand() > ambient) {
          light.position.set(base.x + (rand() - 0.5) * radius, base.y + (rand() - 0.5) * radius, base.z + (rand() - 0.5) * radius)
        } else {
          const lambda = Math.acos(2 * rand() - 1) - Math.PI / 2, phi = 2 * Math.PI * rand()
          light.position.set(Math.cos(lambda) * Math.cos(phi) * length, Math.abs(Math.cos(lambda) * Math.sin(phi) * length), Math.sin(lambda) * length)
        }
      }
    },
    dispose() { for (const light of holder.children) light.dispose() },
  }
}

export default {
  apiVersion: 1,
  /** @param ctx {three, renderer, scene, subject, light, params, receivers} — см. ShadowContext */
  create(ctx) {
    const { three, renderer, scene, light, params } = ctx
    // 2) объект: PCSS на материалах объекта (через пул движка)
    ctx.receivers.use(receiverProcessor(three, params.productMinTexels))

    // 1) пол: приёмник + накопительные лучи
    const root = new three.Group()
    root.name = 'shadow:soft-pcss@v01'
    root.position.set(...params.position)
    const lightsGroup = new three.Group()
    lightsGroup.traverse = () => {} // накопитель не должен «гасить» собственные лучи
    lightsGroup.visible = false
    root.add(lightsGroup)
    const plane = new three.Mesh(new three.PlaneGeometry(), softShadowMaterial(three, params.color, true))
    plane.name = 'shadow-receiver'
    plane.receiveShadow = true
    plane.scale.setScalar(params.scale)
    plane.rotation.x = -Math.PI / 2
    root.add(plane)
    scene.add(root)

    const map = lightMap(three, renderer, scene, params.resolution)
    map.configure(plane)
    plane.material.uniforms.map.value = map.output
    const shown = plane.material
    const contact = params.contact
    const rays = [
      // ключевой свет сцены: направление и чёткость (radius, mapSize) — от сцены
      randomizedLight(three, lightsGroup, { amount: params.areaSamples, ambient: 0, intensity: Math.PI * (1 - contact), position: light.position, radius: light.radius, mapSize: light.mapSize }),
      // «контакт» — мягкое затемнение под объектом, вид тени
      randomizedLight(three, lightsGroup, { amount: params.contactSamples, ambient: 1, intensity: Math.PI * contact, position: [0, 6, 0], radius: 1, mapSize: light.mapSize }),
    ]
    const frames = Math.max(2, params.frames), blend = frames
    let count = 0, rand = random(1)

    const instance = {
      reset() {
        map.clear()
        shown.uniforms.opacity.value = 0
        shown.uniforms.alphaTest.value = 0
        count = 0
        rand = random(1)
      },
      /** Один шаг накопления. true — нужен ещё кадр. */
      update(frame) {
        if (count >= frames) return false
        shown.uniforms.opacity.value = Math.min(params.opacity, shown.uniforms.opacity.value + params.opacity / blend)
        shown.uniforms.alphaTest.value = Math.min(0.75, shown.uniforms.alphaTest.value + 0.75 / blend)
        lightsGroup.visible = true
        map.prepare()
        for (const r of rays) r.update(rand)
        map.update(frame.camera, blend)
        lightsGroup.visible = false
        map.finish()
        plane.material = shown
        count++
        return count < frames
      },
      dispose() {
        scene.remove(root)
        rays.forEach(r => r.dispose())
        map.dispose()
        plane.geometry.dispose()
        shown.dispose()
      },
    }
    instance.reset()
    return instance
  },
}
