export interface SceneSelection {id:string;revision:string}
export interface SceneRef extends SceneSelection {sha256:string}
export interface SceneLight {position:[number,number,number];target:[number,number,number];color:string;intensity:number}
export interface SceneSettings {
  exposure:number;toneMapping:'aces-filmic';shadowType:'basic'
  background:{top:string;bottom:string};ambient:number
  hemisphere:{intensity:number;sky:string;ground:string}
  key:SceneLight;fill:SceneLight
  environment:{resolution:number;intensity:number;surround:string;boxes:Array<{position:[number,number,number];scale:[number,number];intensity:number;color:string}>}
  shadow:{radius:number;contact:number;opacity:number;density:number;frames:number;resolution:number;position:[number,number,number];color:string;scale:number;compositionScale:number;areaSamples:number;contactSamples:number;lightMapSize:number}
  shadowMap:{productResolution:number;groundResolution:number;bias:number;normalBias:number}
  ao:{resolutionScale:number;intensity:number;radius:number;thickness:number;samples:number}
  revealMs:number
}
export interface SceneProfile extends SceneSelection {
  schemaVersion:1;engine:'source-studio-v01'
  coordinates:{modelUnits:'metres';worldScale:12;up:'Y';groundY:0;front:'+Z'}
  settings:SceneSettings
}
export interface SceneBundle {ref:SceneRef;profile:SceneProfile}
export const SCENE_SCHEMA:1
export const SCENE_MAX_BYTES:number
export const DEFAULT_SCENE:Readonly<SceneSelection>
export function normaliseSceneSelection(value:unknown):SceneSelection
export function normaliseSceneRef(value:unknown):SceneRef
export function sameScene(a:SceneRef,b:SceneRef):boolean
export function freezeScene<T>(value:T):T
export function validateSceneProfile(value:unknown):SceneProfile
