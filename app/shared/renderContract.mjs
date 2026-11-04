import {DEFAULT_SKIN,normaliseSkin} from './skinContract.mjs'
import {normaliseSceneRef} from './sceneContract.mjs'
import {DEFAULT_COMPOSITION,normaliseComposition} from './compositionContract.mjs'
import {DEFAULT_DECORATION,normaliseDecoration} from './bottleBrandingContract.mjs'
export const RENDER_VERSION = 5
export const MAX_EDGE = 2048
export const MAX_PIXELS = 2048 * 2048
export const STATES = ['closed', 'open', 'lying']

function number(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new TypeError(`Invalid ${name}`)
  return value
}
function vector(value, length, name, limit = 100) {
  if (!Array.isArray(value) || value.length !== length) throw new TypeError(`Invalid ${name}`)
  return value.map(v => number(v, name, -limit, limit))
}
export function normaliseState(value) {
  if(typeof value!=='string')throw new TypeError('State must be a string')
  const state = ({ a: 'closed', b: 'open', c: 'lying' })[value] ?? value
  if (!STATES.includes(state)) throw new TypeError('State must be closed, open, lying (or a, b, c)')
  return state
}
export function validateCamera(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Camera must be an object')
  const position = vector(value.position, 3, 'camera.position'), target = vector(value.target, 3, 'camera.target')
  const distance = Math.hypot(...position.map((p, i) => p - target[i]))
  number(distance, 'camera distance', .05, 80)
  const near = number(value.near ?? .025, 'camera.near', .001, 5)
  const far = number(value.far ?? 100, 'camera.far', near + .01, 500)
  return { position, target, fov: number(value.fov ?? 28, 'camera.fov', 5, 100), roll: number(value.roll ?? 0, 'camera.roll', -180, 180), near, far, zoom: number(value.zoom ?? 1, 'camera.zoom', .25, 4) }
}
export function validateRenderRequest(value) {
  if (!value || ![1,2,3,4,RENDER_VERSION].includes(value.version) || value.product !== 'bottle') throw new TypeError('Unsupported render request')
  if(value.version===1&&value.skin!==undefined)throw new TypeError('Skin requires render contract version 2')
  if(value.version<3&&value.scene!==undefined)throw new TypeError('Scene requires render contract version 3')
  if(value.version<4&&value.composition!==undefined)throw new TypeError('Composition requires render contract version 4')
  const skin=value.version===1?{...DEFAULT_SKIN}:normaliseSkin(value.skin)
  const scene=value.version>=3?normaliseSceneRef(value.scene):null
  if(value.version<5&&value.decoration!==undefined)throw new TypeError('Decoration requires render contract version 5')
  const composition=value.version>=4?normaliseComposition(value.composition):DEFAULT_COMPOSITION
  const decoration=value.version>=5?normaliseDecoration(value.decoration):normaliseDecoration(DEFAULT_DECORATION)
  const state = normaliseState(value.state), base = validateCamera(value.camera)
  const aspect = number(value.camera.aspect, 'camera.aspect', .15, 6)
  const quaternion = vector(value.camera.quaternion, 4, 'camera.quaternion', 1)
  number(Math.hypot(...quaternion), 'camera quaternion length', .9999, 1.0001)
  const projectionMatrix = vector(value.camera.projectionMatrix, 16, 'camera.projectionMatrix', 10000)
  if([1,2,3,4,6,7,12,13,15].some(i=>Math.abs(projectionMatrix[i])>1e-10)||Math.abs(projectionMatrix[11]+1)>1e-10||projectionMatrix[0]<=0||projectionMatrix[5]<=0||projectionMatrix[10]>=-1||projectionMatrix[14]>=0)throw new TypeError('Invalid perspective projection matrix')
  if (!value.image) throw new TypeError('Missing image dimensions')
  const width = number(value.image.width, 'image.width', 64, MAX_EDGE), height = number(value.image.height, 'image.height', 64, MAX_EDGE)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width * height > MAX_PIXELS || Math.abs(width / height - aspect) > 2 / height) throw new TypeError('Invalid image aspect or size')
  return { version: RENDER_VERSION, product: 'bottle', state, skin, scene, composition, decoration, camera: { ...base, quaternion, aspect, projectionMatrix }, image: { width, height } }
}
