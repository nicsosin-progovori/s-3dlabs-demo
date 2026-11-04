import {bottleZone} from './bottle'
import {initialSettings} from './sourceCatalog'
import type {BottleState} from './bottleViews'
import type {BottleDecoration} from '../shared/bottleBrandingContract.mjs'

export function bottleSettings(state:BottleState,color:string,decoration:BottleDecoration){
  return {...initialSettings('bottle'),state,color,enabled:decoration.enabled,decoration:{zone:bottleZone(decoration.surface,decoration.technique).id,technique:decoration.technique,colors:decoration.colors}}
}
