export interface CompositionTransform {position:[number,number,number];rotation:[number,number,number];scale:[number,number,number]}
export interface CompositionElement {id:string;product:'bottle';visible:boolean;transform:CompositionTransform}
export interface Composition {schemaVersion:1;id:string;primary:string;root:CompositionTransform;elements:CompositionElement[]}
export interface CompositionBounds {min:[number,number,number];max:[number,number,number];center:[number,number,number];size:[number,number,number]}
export const COMPOSITION_SCHEMA:1
export const MAX_COMPOSITION_ELEMENTS:number
export const DEFAULT_COMPOSITION:Readonly<Composition>
export function normaliseComposition(value:unknown):Composition
export function compositionKey(value:Composition):string
