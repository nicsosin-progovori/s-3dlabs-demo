import type {TechniqueId} from '../src/sourceCatalog'
export type LogoRef={kind:'sample'}|{kind:'none'}|{kind:'uploaded';sha256:string;width:number;height:number}
export interface BottleDecoration {enabled:boolean;surface:'body'|'lid';technique:TechniqueId;colors:number;logo:LogoRef}
export type DecorationPatch=Partial<Omit<BottleDecoration,'logo'>>
export const LOGO_MAX_EDGE:2048
export const LOGO_MAX_BYTES:number
export const DEFAULT_DECORATION:Readonly<BottleDecoration>
export function normaliseLogoRef(value:unknown):LogoRef
export function decorationZone(surface:string,technique:string):{id:string}|undefined
export function maxPrintColors(technique:string):number
export function normaliseDecoration(value:unknown):BottleDecoration
export function patchDecoration(current:BottleDecoration,patch:DecorationPatch):BottleDecoration
export function decorationKey(value:BottleDecoration):string
