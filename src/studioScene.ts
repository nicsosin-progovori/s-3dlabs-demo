import {ACESFilmicToneMapping,BasicShadowMap} from 'three'
import type {SceneBundle} from '../shared/sceneContract.mjs'
import type {StudioLook} from './studioLook.ts'

/** Strings in the data contract map to the supported, pinned renderer engine. */
export function lookFromScene(scene:SceneBundle):StudioLook{
  return Object.freeze({...scene.profile.settings,id:`${scene.ref.id}-${scene.ref.revision}-${scene.ref.sha256.slice(0,12)}`,toneMapping:ACESFilmicToneMapping,shadowType:BasicShadowMap})
}
