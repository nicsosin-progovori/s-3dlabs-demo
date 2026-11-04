export type IconName = 'cube' | 'mug' | 'pen' | 'notebook' | 'bottle' | 'endo' | 'pillow' | 'upload' | 'rotate' | 'reset' | 'download' | 'check' | 'close' | 'image' | 'move' | 'info' | 'mouse' | 'arrow' | 'pause'

const paths: Record<IconName, React.ReactNode> = {
  cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9M12 3v9" /></>,
  mug: <><path d="M4 5h12v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3ZM16 7h2a3 3 0 0 1 0 6h-2M3 22h15" /></>,
  pen: <><path d="m15 3 6 6L9 21H3v-6ZM13 5l6 6M3 15l6 6M16 2l6 6" /></>,
  notebook: <><rect x="5" y="3" width="15" height="18" rx="2" /><path d="M9 3v18M3 7h4m-4 5h4m-4 5h4m6-9h4m-4 4h4" /></>,
  bottle: <><path d="M8 7h8v2l2 3v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8l2-3ZM8 3h8v4H8ZM8 4a4 4 0 0 1 8 0M10 15h4" /></>,
  endo: <><path d="M8 6C8 1 16 1 16 6M8 18c0 5 8 5 8 0" /><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 8v7m4-7v7M8 16h8"/></>,
  pillow: <><path d="M7 21c-5 0-6-6-5-11C3 4 7 2 12 2s9 2 10 8c1 5 0 11-5 11l-2-4c2-2 3-7 0-9a5 5 0 0 0-6 0c-3 2-2 7 0 9Z"/><path d="m7 21 3 1h4l3-1M8 14H5"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
  rotate: <><path d="M20 8a8 8 0 1 0 .5 7M20 3v5h-5" /></>,
  reset: <><path d="M4 8a8 8 0 1 1-.5 7M4 3v5h5" /></>,
  download: <><path d="M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-5 5 6" /></>,
  move: <><path d="M12 2v20M2 12h20m-7-7-3-3-3 3m6 14-3 3-3-3M5 9l-3 3 3 3m14-6 3 3-3 3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></>,
  mouse: <><rect x="6" y="2" width="12" height="20" rx="6" /><path d="M12 6v4" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
}

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
