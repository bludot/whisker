# 🐈 Whisker

An open-source collaborative whiteboard — an infinite canvas for diagrams,
sticky notes, and thinking out loud. In the spirit of Miro, built in the open.

## Quick start

```sh
npm install
npm run dev
```

Boards persist locally in your browser (IndexedDB) automatically.

### Connecting to a server

Whisker runs fully local by default. To sync boards through a
[whisker-server](https://github.com/bludot/whisker-server), configure the
URL at build/start time:

```sh
# .env.local
VITE_SERVER_URL=http://localhost:8787
```

With a server configured the app opens on a login page (email/password via
the server's Supabase auth); **Continue as guest** keeps boards on the
device instead. No `VITE_SERVER_URL` = no login page, local-only.

### Setup on macOS

```sh
# 1. Node 20+ (skip if you already have it)
brew install node          # or: nvm install --lts

# 2. Clone and run
git clone git@github.com:bludot/whisker.git
cd whisker
npm install
npm run dev                # http://localhost:5173
```

Useful variants:

```sh
npm run dev -- --host      # expose on your LAN (test from an iPad/phone)
npm run build              # type-check + production build into dist/
npm run preview            # serve the production build locally
```

To test on an iPad, run with `--host`, then open the `Network:` URL Vite
prints (Mac and iPad must be on the same Wi-Fi). Boards are stored per
browser — they don't follow you between devices yet (multiplayer is on
the roadmap).

## Tools & shortcuts

| Tool / action     | How                                                       |
| ----------------- | --------------------------------------------------------- |
| Select            | `V` — click, shift-click, or drag a marquee                |
| Move              | drag a selected shape (attached arrows follow)             |
| Resize            | drag any of the 8 selection handles; `Shift` keeps aspect ratio |
| Pan               | `H`, hold `Space`, middle/right-drag, or scroll            |
| Zoom              | `Ctrl`+scroll, the bottom-right controls, `Ctrl+0` = 100%  |
| Pen               | `P` — freehand drawing                                     |
| Sticky note       | `S` — click to place (or drag to size); starts editing immediately |
| Rectangle         | `R` — click to place, or drag to size in one motion        |
| Ellipse           | `O` — click to place, or drag to size in one motion        |
| Arrow             | hover a shape and drag from one of the four edge dots — or `C` to drag between any two points; endpoints click into corner/edge/center anchors or pin anywhere |
| Re-anchor         | select an arrow, drag either endpoint                      |
| Edit text         | double-click a sticky/rect/ellipse; `Esc`/`Ctrl+Enter` done |
| Style             | select shapes → context bar chips open popovers: fill, border, text, arrow style |
| Z-order           | Order popover, or `]`/`[` step forward/back, `Shift+]`/`Shift+[` to front/back |
| Arrow styles      | select an arrow → straight/elbow/curved, solid/dashed/dotted, per-end caps (none/arrow/dot) |
| Text formatting   | select a shape → align, vertical align, size, bold (defaults centered) |
| Align / distribute| in the selection popup with 2+ / 3+ shapes                 |
| Snap              | shapes snap to others' edges/centers and to equal spacing (gap guides) while dragging; hold `Alt` to disable |
| Nudge             | arrow keys (`Shift` = 16px)                                |
| Images            | paste (`Ctrl+V`) or drag-drop PNG/JPEG/SVG onto the board  |
| Touch / tablet    | two-finger pinch to zoom & pan; with a stylus, fingers pan while the pen draws |
| Shape recognition | pen strokes that look like a rectangle/ellipse/line become the real shape (toggle in settings); lines touching shapes become attached arrows |
| Theme             | toolbar settings → light / dark / follow system; every palette color has a per-theme variant, so boards adapt without changing the stored data |
| Export            | toolbar ⤓ → PNG / JPEG / PDF, or a re-importable `.whisker` file |
| Import            | toolbar ⤓ → Import, or drag a `.whisker` file onto the board (merges, fresh ids) |
| Style defaults    | toolbar settings → default fill/border for new shapes (persisted) |
| Delete            | `Del` (arrows attached to deleted shapes go too)           |
| Duplicate         | `Ctrl+D`                                                   |
| Select all        | `Ctrl+A`                                                   |
| Undo / redo       | `Ctrl+Z` / `Ctrl+Shift+Z`                                  |

## Architecture

The design principle: **the canvas is not React's job.** React renders the
chrome (toolbar, panels); the board itself is a WebGL scene that reads from
a CRDT document. This keeps rendering fast at thousands of objects and makes
real-time collaboration a transport problem rather than a rewrite.

```
src/
  scene/    Framework-agnostic shape model and geometry (hit testing,
            connector anchoring, bounds math). No React/Pixi/Yjs imports.
  collab/   BoardStore — all board state lives in a Yjs document, so every
            mutation is already collaboration-ready. Multiplayer = attaching
            a provider (y-websocket / y-webrtc); IndexedDB persistence
            already works this way.
  editor/   Editor — tool, selection, text-editing, color, and undo state.
            Lives outside React; both the canvas and the chrome subscribe.
  canvas/   BoardRenderer (PixiJS/WebGL), Camera, and InteractionController,
            the pointer/keyboard state machine (move/resize/marquee/draw/
            connect sessions).
  ui/       React chrome: toolbar, zoom controls.
```

| Layer     | Choice             | Why                                            |
| --------- | ------------------ | ---------------------------------------------- |
| UI chrome | React + TypeScript | Largest contributor pool in this problem space |
| Canvas    | PixiJS (WebGL)     | Scales to large boards; Canvas2D fallback free |
| Sync      | Yjs                | Battle-tested CRDT; undo + persistence for free |
| Tooling   | Vite               | Fast dev server and builds                     |

## Roadmap

- [x] Selection: click, shift-click, marquee, resize handles, delete
- [x] Text editing on sticky notes and shapes
- [x] Connectors/arrows that attach to shapes
- [x] Freehand drawing
- [x] Undo/redo (Yjs UndoManager)
- [x] Local persistence (y-indexeddb)
- [ ] Multiplayer via y-websocket + live cursors
- [ ] Incremental rendering (currently full-scene rebuild per change)
- [ ] Connector labels, elbow/curved routing
- [ ] Export (PNG/SVG)
- [ ] Mobile/touch gestures (pinch zoom)

## License

[MIT](LICENSE)
