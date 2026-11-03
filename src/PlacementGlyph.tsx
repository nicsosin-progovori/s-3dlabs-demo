import type { ModelId, ZoneId } from './types'

export function PlacementGlyph({ product, zone }: { product: ModelId; zone: ZoneId }) {
  return <svg className="placement-glyph" width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {product === 'mug' ? <>
      <path d="M7 7h17v16a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3Z" />
      {zone === 'front' ? <path d="M7 10H5a5 5 0 0 0 0 10h2" /> : zone !== 'opposite' && <path d="M24 10h2a5 5 0 0 1 0 10h-2" />}
      {zone !== 'none' && <rect x={zone === 'side-ts' ? 9 : zone === 'roundscreen' ? 10 : 12} y={zone === 'side-ts' ? 9 : 12} width={zone === 'side-ts' ? 13 : zone === 'roundscreen' ? 11 : 7} height={zone === 'side-ts' ? 14 : 8} rx="1" fill="currentColor" fillOpacity="0.18" strokeWidth="1" />}
    </> : product === 'pen' ? <>
      <path d="m9 26 2-7L24 6a2.1 2.1 0 0 1 3 3L14 22Zm2-7 3 3M22 8l3 3M19 6l-5 5" />
      {zone !== 'none' && <path d="m16 17 5-5" strokeWidth="3.5" opacity="0.45" />}
    </> : <>
      <rect x="7" y="5" width="19" height="23" rx="2.5" />
      <path d="M11 5v23M23 5v23" />
      {zone !== 'none' && <rect x="14" y="11" width="6" height="10" rx="1" fill="currentColor" fillOpacity="0.18" strokeWidth="1" />}
    </>}
    {zone === 'none' && <path d="M5 27 28 4" strokeWidth="1.8" />}
  </svg>
}
