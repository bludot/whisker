import type { ReactNode } from 'react'

/** Stroke-based 16px icon set. One visual language for all chrome. */
const ICONS: Record<string, ReactNode> = {
  select: (
    <path d="M4 2l9.5 5.8-4.2 1L7 13.5z" fill="currentColor" stroke="none" />
  ),
  hand: (
    <>
      <path d="M8 2.5v11M2.5 8h11" />
      <path d="M8 2.5L6.3 4.2M8 2.5l1.7 1.7M8 13.5l-1.7-1.7M8 13.5l1.7-1.7M2.5 8l1.7-1.7M2.5 8l1.7 1.7M13.5 8l-1.7-1.7M13.5 8l-1.7 1.7" />
    </>
  ),
  pen: <path d="M3 13l.8-3L10.5 3.3l2.2 2.2L6 12.2 3 13z" />,
  sticky: (
    <>
      <path d="M3 3h10v6.5L9.5 13H3z" />
      <path d="M13 9.5H9.5V13" />
    </>
  ),
  rect: <rect x="2.5" y="4" width="11" height="8" />,
  ellipse: <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />,
  connector: (
    <>
      <path d="M3 13L12.5 3.5" />
      <path d="M12.5 3.5H7.8M12.5 3.5v4.7" />
    </>
  ),
  undo: (
    <>
      <path d="M5.5 3.5L2.5 6.5l3 3" />
      <path d="M2.5 6.5H10a3.5 3.5 0 013.5 3.5v2.5" />
    </>
  ),
  redo: (
    <>
      <path d="M10.5 3.5l3 3-3 3" />
      <path d="M13.5 6.5H6A3.5 3.5 0 002.5 10v2.5" />
    </>
  ),
  duplicate: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" />
      <path d="M10.5 3H2.5v8" />
    </>
  ),
  trash: (
    <>
      <path d="M2.5 4.5h11" />
      <path d="M6 4.5V3h4v1.5" />
      <path d="M4 4.5l.7 9h6.6l.7-9" />
    </>
  ),
  alignLeft: (
    <>
      <path d="M2.5 2v12" />
      <rect x="4.5" y="4" width="9" height="2.5" fill="currentColor" stroke="none" />
      <rect x="4.5" y="9.5" width="5.5" height="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  alignCenterH: (
    <>
      <path d="M8 2v12" />
      <rect x="3" y="4" width="10" height="2.5" fill="currentColor" stroke="none" />
      <rect x="5.2" y="9.5" width="5.6" height="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  alignRight: (
    <>
      <path d="M13.5 2v12" />
      <rect x="2.5" y="4" width="9" height="2.5" fill="currentColor" stroke="none" />
      <rect x="6" y="9.5" width="5.5" height="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  alignTop: (
    <>
      <path d="M2 2.5h12" />
      <rect x="4" y="4.5" width="2.5" height="9" fill="currentColor" stroke="none" />
      <rect x="9.5" y="4.5" width="2.5" height="5.5" fill="currentColor" stroke="none" />
    </>
  ),
  alignMiddle: (
    <>
      <path d="M2 8h12" />
      <rect x="4" y="3" width="2.5" height="10" fill="currentColor" stroke="none" />
      <rect x="9.5" y="5.2" width="2.5" height="5.6" fill="currentColor" stroke="none" />
    </>
  ),
  alignBottom: (
    <>
      <path d="M2 13.5h12" />
      <rect x="4" y="2.5" width="2.5" height="9" fill="currentColor" stroke="none" />
      <rect x="9.5" y="6" width="2.5" height="5.5" fill="currentColor" stroke="none" />
    </>
  ),
  distributeH: (
    <>
      <rect x="2" y="4" width="2.5" height="8" fill="currentColor" stroke="none" />
      <rect x="6.75" y="4" width="2.5" height="8" fill="currentColor" stroke="none" />
      <rect x="11.5" y="4" width="2.5" height="8" fill="currentColor" stroke="none" />
    </>
  ),
  distributeV: (
    <>
      <rect x="4" y="2" width="8" height="2.5" fill="currentColor" stroke="none" />
      <rect x="4" y="6.75" width="8" height="2.5" fill="currentColor" stroke="none" />
      <rect x="4" y="11.5" width="8" height="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  routeStraight: <path d="M3 13L13 3" />,
  routeElbow: <path d="M3 13V8h10V3" />,
  routeCurve: <path d="M3 13C3 6 13 10 13 3" />,
  lineSolid: <path d="M2 8h12" />,
  lineDashed: <path d="M2 8h3M6.5 8h3M11 8h3" />,
  lineDotted: (
    <>
      <circle cx="3" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="13" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  headNone: <path d="M2 8h12" />,
  headArrow: (
    <>
      <path d="M2 8h7.5" />
      <path d="M9.5 4.8L14 8l-4.5 3.2z" fill="currentColor" stroke="none" />
    </>
  ),
  headDot: (
    <>
      <path d="M2 8h8" />
      <circle cx="12" cy="8" r="2.3" fill="currentColor" stroke="none" />
    </>
  ),
  textLeft: <path d="M2 4h12M2 8h8M2 12h10" />,
  textCenter: <path d="M2 4h12M4 8h8M3 12h10" />,
  textRight: <path d="M2 4h12M6 8h8M4 12h10" />,
  textTop: <path d="M2 2.5h12M4 6h8M4 9.5h8" />,
  textMiddle: <path d="M4 4.5h8M2 8h12M4 11.5h8" />,
  textBottom: <path d="M4 6.5h8M4 10h8M2 13.5h12" />,
  bold: (
    <path
      d="M5 3h4a2.5 2.5 0 010 5H5zM5 8h4.8a2.5 2.5 0 010 5H5z"
      strokeWidth="1.8"
    />
  ),
  download: (
    <>
      <path d="M8 2v7.5M4.8 6.5L8 9.7l3.2-3.2" />
      <path d="M2.5 13h11" />
    </>
  ),
  upload: (
    <>
      <path d="M8 9.7V2.2M4.8 5.4L8 2.2l3.2 3.2" />
      <path d="M2.5 13h11" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3" />
    </>
  ),
  moon: <path d="M9.5 2.5a5.5 5.5 0 103.8 8.6A6.2 6.2 0 019.5 2.5z" />,
  monitor: (
    <>
      <rect x="2" y="3" width="12" height="8.5" />
      <path d="M6 14h4M8 11.5V14" />
    </>
  ),
  magic: (
    <>
      <path d="M6.5 2.5l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1z" />
      <path
        d="M12 9.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  bringToFront: <path d="M4 8.5l4-4 4 4M4 13l4-4 4 4" />,
  bringForward: <path d="M4 11l4-4 4 4" />,
  sendBackward: <path d="M4 5l4 4 4-4" />,
  sendToBack: <path d="M4 3l4 4 4-4M4 7.5l4 4 4-4" />,
}

export type IconName = keyof typeof ICONS

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}
