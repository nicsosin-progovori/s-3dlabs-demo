export interface SkinRef {id:string;revision:string}
export interface SkinDescriptor extends SkinRef {file:string;sha256:string;bytes:number;label:{de:string;en:string}}
export interface SkinCompatibility {modelId:string;uvLayout:string;materialBindings:string}
export interface GeometryDescriptor {file:string;sha256:string;bytes:number;triangles:number}
export const DEFAULT_SKIN:Readonly<SkinRef>
export const SKIN_COMPATIBILITY:Readonly<SkinCompatibility>
export const SKIN_REGISTRY:{schemaVersion:number;defaultSkin:SkinRef;compatibility:SkinCompatibility;geometry:{low:GeometryDescriptor;final:GeometryDescriptor};skins:SkinDescriptor[]}
export function normaliseSkin(value:unknown):SkinRef
export function skinDescriptor(value:unknown):SkinDescriptor
export function sameSkin(a:SkinRef,b:SkinRef):boolean
export function availableSkins():Array<SkinRef&{label:{de:string;en:string}}>
