import { SKIN_REGISTRY } from '../shared/skinContract.mjs'
import { BOTTLE } from './bottle'

/** The original catalogue asset remains the reference for the older studio. */
export const BOTTLE_HQ={...BOTTLE,assetUrl:import.meta.env.BASE_URL+SKIN_REGISTRY.geometry.final.file+'?v='+SKIN_REGISTRY.geometry.final.sha256.slice(0,12)}
