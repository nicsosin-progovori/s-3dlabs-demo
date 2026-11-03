export type CameraViewState='closed'|'open'|'lying'
export interface FitCameraSettings {
  azimuth:number;elevation:number;fov:number;roll:number;subject:[number,number];margin:number
  near:number;far:number;zoom:number
  focusMm?:{min:[number,number,number];max:[number,number,number]}
  frameTarget?:'composition'|'primary'
}
export interface CameraViewPreset {id:string;label:{de:string;en:string};camera:FitCameraSettings}
export interface CameraViewCatalog {
  schemaVersion:1|2|3;modelId:'bottle';revision:string
  compatibility:{poseContract:'bottle-poses-v01';focusUnits:'millimetres';up:'Y';front:'+Z'}
  states:Record<CameraViewState,{defaultView:string|null;views:CameraViewPreset[]}>
  lidStates?:CameraViewCatalog['states']
}
export const CAMERA_VIEWS_SCHEMA:3
export const CAMERA_VIEWS_MAX_BYTES:number
export const CAMERA_VIEW_STATES:ReadonlyArray<CameraViewState>
export function validateCameraViews(value:unknown):CameraViewCatalog
