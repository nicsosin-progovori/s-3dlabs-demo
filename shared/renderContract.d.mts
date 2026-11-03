export type BottleState = 'closed' | 'open' | 'lying'
export type Vec3 = [number, number, number]
export interface CameraInput {position:Vec3;target:Vec3;fov?:number;roll?:number;near?:number;far?:number;zoom?:number}
export type CameraSettings = Required<CameraInput>
export interface CameraSnapshot extends CameraSettings {quaternion:[number,number,number,number];aspect:number;projectionMatrix:number[]}
export interface RenderRequest {version:5;product:'bottle';state:BottleState;skin:SkinRef;scene:SceneRef|null;composition:Composition;decoration:BottleDecoration;camera:CameraSnapshot;image:{width:number;height:number}}
export const RENDER_VERSION:5
export const MAX_EDGE:2048
export const MAX_PIXELS:number
export const STATES:BottleState[]
export function normaliseState(value:unknown):BottleState
export function validateCamera(value:unknown):CameraSettings
export function validateRenderRequest(value:unknown):RenderRequest
import type {SkinRef} from './skinContract.mjs'
import type {SceneRef} from './sceneContract.mjs'
import type {Composition} from './compositionContract.mjs'
import type {BottleDecoration} from './bottleBrandingContract.mjs'
