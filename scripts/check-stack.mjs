import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveBlender } from './blender.mjs'

const require = createRequire(import.meta.url)
const packages = ['react', 'react-dom', 'three', 'typescript', 'vite', '@react-three/fiber', '@react-three/drei']
for (const name of packages) {
  let directory = dirname(require.resolve(name))
  let manifest
  while (directory !== dirname(directory)) {
    const file = join(directory, 'package.json')
    if (existsSync(file)) {
      const candidate = JSON.parse(readFileSync(file, 'utf8'))
      if (candidate.name === name) { manifest = candidate; break }
    }
    directory = dirname(directory)
  }
  if (!manifest) throw new Error(`Package not found: ${name}`)
  console.log(`${name}: ${manifest.version}`)
}

// Load Three first: Node 22 cannot concurrently initialise its CJS/ESM bridge.
const { CanvasTexture } = await import('three')
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
const { Canvas } = await import('@react-three/fiber')
const { OrbitControls, Environment } = await import('@react-three/drei')
if (!Canvas || !OrbitControls || !Environment || !CanvasTexture || !GLTFLoader) throw new Error('Missing runtime exports')
console.log('Web runtime imports: OK')

const blender = spawnSync(resolveBlender(), ['--background', '--factory-startup', '--python-expr', 'import bpy; print("BLENDER_STACK_OK " + bpy.app.version_string); print("GLTF_EXPORT_OK " + bpy.ops.export_scene.gltf.get_rna_type().identifier)'], { encoding: 'utf8', timeout: 60_000 })
if (blender.status !== 0 || !blender.stdout.includes('GLTF_EXPORT_OK')) {
  console.error(blender.error?.message || blender.stderr || blender.stdout)
  process.exit(1)
}
console.log(blender.stdout.split('\n').filter((line) => line.startsWith('BLENDER_STACK_OK') || line.startsWith('GLTF_EXPORT_OK')).join('\n'))
console.log(`Node.js ${process.version}: STACK OK`)
