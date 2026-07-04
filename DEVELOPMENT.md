# Development history

How Whisker went from an empty directory to a working whiteboard, in one
(long) build session on 2026-07-04. Useful as a map of what exists, why it
is shaped the way it is, and where the bodies are buried.

## Architecture decisions (made up front, still true)

- **The canvas is not React's job.** React renders chrome (toolbar,
  context bar, popovers); the board is a PixiJS/WebGL scene. Shapes are
  never React components.
- **All board state lives in a Yjs document** (`BoardStore`). Undo/redo
  (`Y.UndoManager`), local persistence (`y-indexeddb`) and future
  multiplayer (attach `y-websocket`) all fall out of that one choice.
- **Scene model is framework-agnostic** (`src/scene/`): plain data +
  geometry, no React/Pixi/Yjs imports.
- **Editor session state lives outside React** (`src/editor/Editor.ts`):
  tool, selection, defaults, text editing. Both the canvas layer and the
  React chrome subscribe to it.
- **Input is a pointer state machine** (`src/canvas/interactions.ts`):
  sessions for move / resize / marquee / draw / connect / create / pan /
  pinch. One instance per mounted canvas.

## Build order (roughly chronological)

1. **Scaffold** — Vite + React + TS, PixiJS, Yjs. Infinite canvas with
   pan/zoom, dot grid, sticky notes, rectangles, drag-to-move.
2. **Full editor** — selection (click / shift / marquee), 8-handle
   resize, connectors that attach to shapes, ellipse + freehand pen
   tools, double-click text editing, delete/duplicate, undo/redo, zoom
   controls, IndexedDB persistence, keyboard shortcuts.
3. **Design pass** — square-cornered shapes (deliberate), fill & border
   as separate styles with color/opacity/width, snap-to-align guides,
   align/distribute commands, arrow-key nudge.
4. **Contextual UI** — the fixed style panel became a floating context
   bar anchored to the selection, then compressed into chips that open
   popovers (fill, border, text, arrow style, order, arrange). Sliders
   became number steppers and dropdowns. All floating chrome restyled
   dark and rounded.
5. **Connector depth** — magnetic anchors (9 spots per shape: corners,
   edge midpoints, center; center floats, others pin), draggable
   endpoints for re-anchoring, routing (straight/elbow/curve), line
   styles (solid/dashed/dotted — hand-rolled dashing, Pixi has none),
   per-end caps (none/arrow/dot), drag-out arrow handles on hover so
   arrows start without switching tools.
6. **Text formatting** — per-shape alignment (h + v), size, bold;
   defaults center/center; the inline editor is WYSIWYG (same
   line-height, dynamic vertical-align padding); new shapes inherit the
   last-used text style.
7. **More board features** — image paste/drag-drop (data URLs in the
   doc), drag-to-size shape creation with ghost preview, z-order
   commands (`[`/`]` + popover), equal-spacing snap with gap guides,
   shift-resize aspect lock, style defaults editable in settings.
8. **Theming** — light/dark/system (persisted, live), themed canvas +
   chrome via CSS variables, and per-color theme variants: shapes store
   canonical (light) colors; rendering resolves a dark variant so boards
   adapt non-destructively. Label text picks dark/light by blended
   luminance.
9. **Tablet support** — two-finger pinch zoom/pan, `pointercancel`
   handling, stylus detection (`pointerType === 'pen'`): once a pen is
   seen, fingers pan (tap still selects; toggle in settings), stylus
   draws directly on empty canvas even with the select tool, palm
   rejection (touches ignored while the pen is mid-stroke, sessions
   locked to their initiating pointer).
10. **Shape recognition** — pen strokes become real shapes
    (`src/scene/recognize.ts`): uniform arc-length resampling, then
    line / ellipse / rectangle fits scored comparatively (ordering alone
    misclassified rounded-corner boxes as ellipses). Lines whose ends
    touch shapes become attached arrows. Toggle in settings.

## Bugs worth remembering

- **Sticky text editor died instantly**: opening a textarea during
  `pointerdown` let the browser's `mousedown` default action refocus the
  body and blur it. Creation moved to `pointerup`.
- **Legacy style migration**: per-shape style fields default
  independently; gating all defaults on one field left partially-patched
  shapes broken.
- **Safari < 15.4 (older iPads)**: `crypto.randomUUID` and
  `structuredClone` don't exist — every shape creation/move threw,
  which looked like "drawing does nothing". Both have fallbacks now;
  previews also clear before creation so a failure can't leave ghost ink.
- **Palm rejection**: a resting palm counted as a second touch and
  cancelled pen strokes into pinch gestures.
- **Test-harness traps** (WSLg headed Chromium): clipped screenshots
  mid-drag synthesize a bogus pointermove that corrupts the drag;
  `location.reload()` right after mutating the doc can race IndexedDB's
  debounced save; Vite HMR timestamps mean dynamically importing a
  module in tests can yield a second instance.

## Known limitations / next steps

- **Multiplayer**: the data model is ready; needs a `y-websocket`
  provider + tiny relay server, live cursors via awareness.
- **Rendering**: full scene rebuild per change — fine at hundreds of
  shapes, needs keyed incremental updates for thousands.
- **Images**: stored as data URLs inside the Yjs doc; large boards will
  bloat. Wants a hashed asset store once a backend exists.
- **Export** (PNG/SVG), **arrow labels**, richer text (lists, links).
- Everything is client-side; there is no backend at all today.
