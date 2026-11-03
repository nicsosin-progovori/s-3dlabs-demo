import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ComponentRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { BackSide, Box3, LatheGeometry, MathUtils, PCFShadowMap, PerspectiveCamera, Spherical, Vector2, Vector3 } from 'three'
import type { Group, Material } from 'three'
import { createPrintTexture, drawPrintTexture } from './logo'
import { printableMaterial } from './model'
import type { LoadedModel, LogoAsset, PrintZone, Product } from './types'

interface Props {
  product: Product
  model: LoadedModel | null
  zone: PrintZone
  logo: LogoAsset | null
  onReady: (capture: (filename: string) => void, version: string) => void
  onGrounded: (gap: number) => void
  viewResetKey: number
  fallbackMessage: string
}

const FLOOR_Y = -1.35
const SURFACE_LAYER = 1
const STUDIO_COLOR = '#eae9e4'
const MAX_CAMERA_DISTANCE = 12
const INITIAL_CAMERA_DIRECTION = new Vector3(0, 0.32, 1).normalize()

interface CameraTransition {
  from: Spherical
  radius: number
  angle: number
  polarAngle: number
  target: Vector3
  elapsed: number | null
  duration: number
}

function Cyclorama() {
  const geometry = useMemo(() => {
    const profile = [new Vector2(0, 0), new Vector2(4, 0), new Vector2(8, 0)]
    for (let step = 1; step <= 40; step++) {
      const angle = step / 40 * Math.PI / 2
      profile.push(new Vector2(8 + 5 * Math.sin(angle), 5 * (1 - Math.cos(angle))))
    }
    profile.push(new Vector2(13, 25))
    return new LatheGeometry(profile.reverse(), 128)
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh name="StudioCyclorama" geometry={geometry} position={[0, FLOOR_Y, 0]} layers-mask={1 << SURFACE_LAYER} receiveShadow><meshLambertMaterial color={STUDIO_COLOR} /></mesh>
}

const ProductContactShadow = memo(function ProductContactShadow({ model }: { model: LoadedModel | null }) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  useLayoutEffect(() => {
    // Offscreen shadow pixels outside the body must be transparent.
    // The main canvas stays opaque because its scene has a background color.
    gl.setClearAlpha(0)
    // The main camera sees both layers; the depth camera sees only the body.
    camera.layers.enable(SURFACE_LAYER)
  }, [camera, gl, model])
  const enabled = !!model && model.id !== 'mug'
  // Reuse the render targets; a new model rerenders this component and rebakes once.
  return <ContactShadows name="ProductContactShadow" position={[0, FLOOR_Y + 0.001, 0]} scale={7} far={3} resolution={1024} opacity={0.6} blur={1.6} color="#332f28" frames={enabled ? 1 : 0} visible={enabled} />
})

function ProductModel({ model, product, zone, logo, onGrounded }: Props & { model: LoadedModel }) {
  const group = useRef<Group>(null)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const texture = useMemo(() => createPrintTexture(product), [product])

  useLayoutEffect(() => {
    drawPrintTexture(texture, product, zone, logo)
    invalidate()
  }, [texture, product, zone, logo, invalidate])
  useEffect(() => () => texture.dispose(), [texture])

  useLayoutEffect(() => {
    const owned: Material[] = []
    for (const [mesh, original] of model.originals) {
      const isPrintSurface = mesh.name === product.printMeshName
      if (isPrintSurface) {
        const replace = (source: Material) => {
          const next = printableMaterial(source, texture)
          if (!next) return source
          owned.push(next)
          return next
        }
        mesh.material = Array.isArray(original) ? original.map(replace) : replace(original)
        mesh.renderOrder = 2
      }
      mesh.layers.set(isPrintSurface ? SURFACE_LAYER : 0)
      mesh.castShadow = !isPrintSurface
      mesh.receiveShadow = true
    }
    return () => {
      for (const [mesh, material] of model.originals) {
        mesh.material = material
        mesh.layers.set(0)
      }
      owned.forEach((material) => material.dispose())
    }
  }, [model, product, texture])

  useLayoutEffect(() => {
    for (const mesh of model.originals.keys()) {
      if (mesh.name === product.printMeshName) mesh.visible = !!logo && zone.id !== 'none'
    }
    invalidate()
  }, [model, product, logo, zone, invalidate])

  useLayoutEffect(() => {
    const object = group.current!
    object.position.y = 0
    object.updateWorldMatrix(true, true)
    const box = new Box3().setFromObject(object, true)
    object.position.y = FLOOR_Y - box.min.y
    object.updateWorldMatrix(true, true)
    onGrounded(new Box3().setFromObject(object, true).min.y - FLOOR_Y)
    gl.shadowMap.needsUpdate = true
    invalidate()
    return () => { gl.shadowMap.needsUpdate = true; invalidate() }
  }, [model, onGrounded, gl, invalidate])

  return <group ref={group} name="GroundedProduct"><primitive object={model.root} dispose={null} /></group>
}

function PlacementCamera({ zone, model, product, viewResetKey }: Pick<Props, 'zone' | 'model' | 'product' | 'viewResetKey'>) {
  const { camera, invalidate } = useThree()
  const orbitRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const activeModel = useRef<LoadedModel | null>(null)
  const lastResetKey = useRef(viewResetKey)
  const transition = useRef<CameraTransition | null>(null)

  useLayoutEffect(() => {
    const orbit = orbitRef.current
    if (!model || !orbit || !(camera instanceof PerspectiveCamera)) return
    transition.current = null
    const resetting = lastResetKey.current !== viewResetKey
    lastResetKey.current = viewResetKey
    const viewZone = zone.id === 'none' ? product.zones.find((item) => item.id === product.defaultZone)! : zone
    const angle = Math.PI / 2 - viewZone.angleDeg * Math.PI / 180
    const polarAngle = Math.atan2(1, product.viewElevation)

    if (activeModel.current !== model) {
      activeModel.current = model
      const pivot = product.orbitPivotMm
        ? model.root.localToWorld(new Vector3().fromArray(product.orbitPivotMm).multiplyScalar(0.001))
        : new Box3().setFromObject(model.root, true).getCenter(new Vector3())
      orbit.target.copy(pivot)
      camera.position.setFromSpherical(new Spherical(product.maxCameraDistance ?? MAX_CAMERA_DISTANCE, polarAngle, angle)).add(pivot)
      orbit.update()
      invalidate()
      return
    }

    if (zone.id === 'none' && !resetting) return

    const target = orbit.target.clone()
    const from = new Spherical().setFromVector3(camera.position.clone().sub(target))
    // Flush drag inertia without changing the last visible pose.
    const damping = orbit.enableDamping
    orbit.enableDamping = false
    orbit.update()
    orbit.target.copy(target)
    camera.position.setFromSpherical(from).add(target)
    orbit.update()
    orbit.enableDamping = damping

    const turn = MathUtils.euclideanModulo(angle - from.theta + Math.PI, Math.PI * 2) - Math.PI
    transition.current = {
      from,
      radius: resetting ? product.maxCameraDistance ?? MAX_CAMERA_DISTANCE : from.radius,
      angle: from.theta + turn,
      polarAngle,
      target,
      elapsed: null,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380 + Math.max(Math.abs(turn), Math.abs(polarAngle - from.phi)) / Math.PI * 220,
    }
    invalidate()
  }, [camera, invalidate, model, product, zone, viewResetKey])

  useFrame((_state, delta) => {
    const next = transition.current
    const orbit = orbitRef.current
    if (!next || !orbit) return
    // A slow texture upload or a resumed tab must not skip the whole turn.
    next.elapsed = next.elapsed === null ? 0 : next.elapsed + Math.min(delta, 0.05) * 1000
    const progress = next.duration === 0 ? 1 : Math.min(next.elapsed / next.duration, 1)
    const eased = MathUtils.smootherstep(progress, 0, 1)
    camera.position.setFromSphericalCoords(
      MathUtils.lerp(next.from.radius, next.radius, eased),
      MathUtils.lerp(next.from.phi, next.polarAngle, eased),
      MathUtils.lerp(next.from.theta, next.angle, eased),
    ).add(next.target)
    orbit.target.copy(next.target)
    orbit.update()
    if (progress === 1) transition.current = null
    else invalidate()
  })

  const flatProduct = product.id !== 'mug'
  return <OrbitControls ref={orbitRef} makeDefault enablePan={false} minDistance={3} maxDistance={product.maxCameraDistance ?? MAX_CAMERA_DISTANCE} minPolarAngle={flatProduct ? Math.PI / 12 : 0.1} maxPolarAngle={flatProduct ? Math.PI * 5 / 12 : Math.PI / 2} rotateSpeed={flatProduct ? 0.65 : 1} dampingFactor={flatProduct ? 0.12 : 0.05} zoomSpeed={flatProduct ? 0.9 : 1} onStart={() => { transition.current = null }} />
}

export function Scene(props: Props) {
  return (
    <Canvas
      shadows={{ type: PCFShadowMap }}
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: INITIAL_CAMERA_DIRECTION.clone().multiplyScalar(MAX_CAMERA_DISTANCE).toArray(), fov: 35, near: 0.1, far: 60 }}
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      fallback={<div className="scene-error">{props.fallbackMessage}</div>}
      onCreated={({ gl, scene, camera }) => {
        gl.shadowMap.autoUpdate = false
        camera.layers.enable(SURFACE_LAYER)
        const context = gl.getContext()
        props.onReady((filename) => {
          gl.render(scene, camera)
          const anchor = document.createElement('a')
          anchor.download = filename
          anchor.href = gl.domElement.toDataURL('image/png')
          anchor.click()
        }, context.getParameter(context.VERSION) as string)
      }}
    >
      <color attach="background" args={[STUDIO_COLOR]} />
      <fog attach="fog" args={[STUDIO_COLOR, 18, 38]} />
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[-3.5, 7, 5]} intensity={2.6} color="#fffaf3" castShadow
        shadow-mapSize={[2048, 2048]} shadow-radius={6}
        shadow-bias={-0.00005} shadow-normalBias={0.005}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5}
        shadow-camera-near={0.1} shadow-camera-far={25}
      />
      <directionalLight position={[4, 3, -2]} intensity={0.8} />
      <Environment key={props.product.id} resolution={128}>
        {props.product.id === 'pen' && <mesh scale={30}><sphereGeometry args={[1, 32, 16]} /><meshBasicMaterial color="#b0b0b0" side={BackSide} toneMapped={false} /></mesh>}
        <Lightformer form="rect" intensity={3} position={[0, 4, 1]} scale={props.product.id === 'pen' ? [12, 12, 1] : [8, 4, 1]} rotation={[Math.PI / 2, 0, 0]} />
        <Lightformer form="rect" intensity={2} position={[-4, 2, 3]} scale={[4, 6, 1]} rotation={[0, Math.PI / 3, 0]} />
        <Lightformer form="rect" intensity={1.5} position={[4, 1, -3]} scale={[4, 6, 1]} rotation={[0, -Math.PI / 3, 0]} />
      </Environment>
      {props.model && <ProductModel {...props} model={props.model} />}
      <Cyclorama />
      <ProductContactShadow model={props.model} />
      <PlacementCamera zone={props.zone} model={props.model} product={props.product} viewResetKey={props.viewResetKey} />
    </Canvas>
  )
}
