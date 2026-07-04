import { useEffect, useReducer } from 'react'
import { Dropdown } from './Dropdown'
import { Icon, type IconName } from './Icons'
import { NumberField } from './NumberField'
import { subscribeTheme, themedColor } from './theme'
import type { BoardRenderer } from '../canvas/renderer'
import type { Editor, AlignKind } from '../editor/Editor'
import {
  boundsOf,
  boundsUnion,
  canHaveText,
  isResizable,
  PALETTE,
  type ArrowHead,
  type ConnectorRoute,
  type ConnectorShape,
  type LineDash,
  type ShapeId,
  type TextAlign,
  type TextVAlign,
} from '../scene/types'

const ROW_HEIGHT = 52
const MARGIN = 12
const TOOLBAR_CLEARANCE = 72
const FONT_SIZES = [10, 12, 14, 16, 20, 24, 32, 48, 64]

const ALIGN_ACTIONS: { kind: AlignKind; icon: IconName; label: string }[] = [
  { kind: 'left', icon: 'alignLeft', label: 'Align left' },
  { kind: 'centerH', icon: 'alignCenterH', label: 'Align center' },
  { kind: 'right', icon: 'alignRight', label: 'Align right' },
  { kind: 'top', icon: 'alignTop', label: 'Align top' },
  { kind: 'middle', icon: 'alignMiddle', label: 'Align middle' },
  { kind: 'bottom', icon: 'alignBottom', label: 'Align bottom' },
]

const ROUTES: { value: ConnectorRoute; icon: IconName; label: string }[] = [
  { value: 'straight', icon: 'routeStraight', label: 'Straight' },
  { value: 'elbow', icon: 'routeElbow', label: 'Elbow' },
  { value: 'curve', icon: 'routeCurve', label: 'Curved' },
]

const DASHES: { value: LineDash; icon: IconName; label: string }[] = [
  { value: 'solid', icon: 'lineSolid', label: 'Solid' },
  { value: 'dashed', icon: 'lineDashed', label: 'Dashed' },
  { value: 'dotted', icon: 'lineDotted', label: 'Dotted' },
]

const HEADS: { value: ArrowHead; icon: IconName; label: string }[] = [
  { value: 'none', icon: 'headNone', label: 'None' },
  { value: 'arrow', icon: 'headArrow', label: 'Arrowhead' },
  { value: 'dot', icon: 'headDot', label: 'Dot' },
]

const TEXT_ALIGNS: { value: TextAlign; icon: IconName; label: string }[] = [
  { value: 'left', icon: 'textLeft', label: 'Text left' },
  { value: 'center', icon: 'textCenter', label: 'Text center' },
  { value: 'right', icon: 'textRight', label: 'Text right' },
]

const TEXT_VALIGNS: { value: TextVAlign; icon: IconName; label: string }[] = [
  { value: 'top', icon: 'textTop', label: 'Text top' },
  { value: 'middle', icon: 'textMiddle', label: 'Text middle' },
  { value: 'bottom', icon: 'textBottom', label: 'Text bottom' },
]

const ORDER_ACTIONS: { icon: IconName; label: string; run: (e: Editor) => void }[] = [
  { icon: 'bringToFront', label: 'Bring to front — Shift+]', run: (e) => e.bringToFront() },
  { icon: 'bringForward', label: 'Bring forward — ]', run: (e) => e.bringForward() },
  { icon: 'sendBackward', label: 'Send backward — [', run: (e) => e.sendBackward() },
  { icon: 'sendToBack', label: 'Send to back — Shift+[', run: (e) => e.sendToBack() },
]

/** Display color for a stored canonical value in the active theme. */
function hex(color: number): string {
  return `#${themedColor(color).toString(16).padStart(6, '0')}`
}

/**
 * Contextual style bar. Floats above the current selection (below it when
 * the selection is near the top of the screen); each chip opens a popover
 * so the bar itself stays a single compact row.
 */
export function StylePopup({
  editor,
  renderer,
}: {
  editor: Editor
  renderer: BoardRenderer
}) {
  const [, force] = useReducer((c: number) => c + 1, 0)
  useEffect(() => editor.subscribe(force), [editor])
  useEffect(() => renderer.subscribeCamera(force), [renderer])
  useEffect(() => subscribeTheme(force), [])

  const shapes = editor.getSelectedShapes()
  if (
    shapes.length === 0 ||
    editor.tool !== 'select' ||
    editor.editingId ||
    editor.sessionActive
  ) {
    return null
  }

  const get = (id: ShapeId) => editor.store.get(id)
  const bounds = boundsUnion(shapes.map((s) => boundsOf(s, get)))
  if (!bounds) return null

  const ref = shapes[0]
  const textRef = shapes.find(canHaveText)
  const connectorRef = shapes.find((s) => s.type === 'connector') as
    | ConnectorShape
    | undefined
  const alignable = shapes.filter(isResizable).length >= 2
  const distributable = shapes.filter(isResizable).length >= 3

  const chipCount =
    2 + (textRef ? 2 : 0) + (connectorRef ? 1 : 0) + (alignable ? 1 : 0)
  const width = 24 + chipCount * 48
  const height = ROW_HEIGHT

  const topLeft = renderer.camera.worldToScreen(bounds.x, bounds.y)
  const bottomRight = renderer.camera.worldToScreen(
    bounds.x + bounds.width,
    bounds.y + bounds.height,
  )
  const screen = renderer.app.screen
  let top = topLeft.y - height - MARGIN
  let opensDown = false
  if (top < TOOLBAR_CLEARANCE) {
    top = bottomRight.y + MARGIN
    opensDown = true
  }
  top = Math.min(top, screen.height - height - 8)
  const left = Math.min(
    Math.max((topLeft.x + bottomRight.x) / 2 - width / 2, 8),
    screen.width - width - 8,
  )

  const buttonGroup = <T extends string>(
    options: { value: T; icon: IconName; label: string }[],
    current: T,
    onPick: (v: T) => void,
    flip = false,
  ) =>
    options.map((o) => (
      <button
        key={o.value}
        className={
          (current === o.value ? 'popup-btn active' : 'popup-btn') +
          (flip ? ' flip' : '')
        }
        title={o.label}
        onClick={() => onPick(o.value)}
      >
        <Icon name={o.icon} />
      </button>
    ))

  const swatchGrid = (active: number, onPick: (color: number) => void) => (
    <div className="dd-row">
      {PALETTE.map((color) => (
        <button
          key={color}
          className={active === color ? 'swatch active' : 'swatch'}
          style={{ background: hex(color) }}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  )

  return (
    <div
      className={opensDown ? 'style-popup' : 'style-popup opens-up'}
      style={{ left, top }}
    >
      {textRef && (
        <Dropdown
          title="Fill"
          chip={<span className="color-chip-swatch" style={{ background: hex(ref.fillColor) }} />}
        >
          {swatchGrid(ref.fillColor, (c) => editor.applyStyle({ fillColor: c }))}
          <div className="dd-row">
            <span className="dd-caption">Opacity</span>
            <NumberField
              value={Math.round(ref.fillOpacity * 100)}
              min={0}
              max={100}
              step={10}
              suffix="%"
              title="Fill opacity"
              onChange={(v) => editor.applyStyle({ fillOpacity: v / 100 })}
            />
          </div>
        </Dropdown>
      )}
      <Dropdown
        title="Border"
        chip={
          <span
            className="color-chip-swatch ring"
            style={{ borderColor: hex(ref.strokeColor) }}
          />
        }
      >
        {swatchGrid(ref.strokeColor, (c) => editor.applyStyle({ strokeColor: c }))}
        <div className="dd-row">
          <span className="dd-caption">Opacity</span>
          <NumberField
            value={Math.round(ref.strokeOpacity * 100)}
            min={0}
            max={100}
            step={10}
            suffix="%"
            title="Border opacity"
            onChange={(v) => editor.applyStyle({ strokeOpacity: v / 100 })}
          />
        </div>
        <div className="dd-row">
          <span className="dd-caption">Width</span>
          <NumberField
            value={ref.strokeWidth}
            min={0}
            max={12}
            step={1}
            suffix="px"
            title="Border width"
            onChange={(v) => editor.applyStyle({ strokeWidth: v })}
          />
        </div>
      </Dropdown>
      {textRef && (
        <Dropdown title="Text formatting" chip={<span className="chip-aa">Aa</span>}>
          <div className="dd-row">
            {buttonGroup(TEXT_ALIGNS, textRef.textAlign ?? 'center', (v) =>
              editor.applyTextStyle({ textAlign: v }),
            )}
            <span className="divider" />
            {buttonGroup(TEXT_VALIGNS, textRef.textVAlign ?? 'middle', (v) =>
              editor.applyTextStyle({ textVAlign: v }),
            )}
          </div>
          <div className="dd-row">
            <span className="dd-caption">Size</span>
            <select
              className="popup-select"
              title="Font size"
              value={textRef.fontSize ?? 16}
              onChange={(e) =>
                editor.applyTextStyle({ fontSize: Number(e.target.value) })
              }
            >
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              className={textRef.bold ? 'popup-btn active' : 'popup-btn'}
              title="Bold"
              onClick={() => editor.applyTextStyle({ bold: !textRef.bold })}
            >
              <Icon name="bold" />
            </button>
          </div>
        </Dropdown>
      )}
      {connectorRef && (
        <Dropdown
          title="Arrow style"
          chip={<Icon name={ROUTES.find((r) => r.value === (connectorRef.route ?? 'straight'))!.icon} />}
        >
          <div className="dd-row">
            <span className="dd-caption">Line</span>
            {buttonGroup(DASHES, connectorRef.dash ?? 'solid', (v) =>
              editor.applyConnectorStyle({ dash: v }),
            )}
          </div>
          <div className="dd-row">
            <span className="dd-caption">Route</span>
            {buttonGroup(ROUTES, connectorRef.route ?? 'straight', (v) =>
              editor.applyConnectorStyle({ route: v }),
            )}
          </div>
          <div className="dd-row">
            <span className="dd-caption">Start</span>
            {buttonGroup(
              HEADS,
              connectorRef.startHead ?? 'none',
              (v) => editor.applyConnectorStyle({ startHead: v }),
              true,
            )}
          </div>
          <div className="dd-row">
            <span className="dd-caption">End</span>
            {buttonGroup(HEADS, connectorRef.endHead ?? 'arrow', (v) =>
              editor.applyConnectorStyle({ endHead: v }),
            )}
          </div>
        </Dropdown>
      )}
      <Dropdown title="Order" chip={<Icon name="bringToFront" />}>
        <div className="dd-row">
          {ORDER_ACTIONS.map((a) => (
            <button
              key={a.icon}
              className="popup-btn"
              title={a.label}
              onClick={() => a.run(editor)}
            >
              <Icon name={a.icon} />
            </button>
          ))}
        </div>
      </Dropdown>
      {alignable && (
        <Dropdown title="Arrange" chip={<Icon name="alignLeft" />}>
          <div className="dd-row">
            <span className="dd-caption">Align</span>
            {ALIGN_ACTIONS.map((a) => (
              <button
                key={a.kind}
                className="popup-btn"
                title={a.label}
                onClick={() => editor.align(a.kind)}
              >
                <Icon name={a.icon} />
              </button>
            ))}
          </div>
          <div className="dd-row">
            <span className="dd-caption">Distribute</span>
            <button
              className="popup-btn"
              title="Distribute horizontally"
              disabled={!distributable}
              onClick={() => editor.distribute('h')}
            >
              <Icon name="distributeH" />
            </button>
            <button
              className="popup-btn"
              title="Distribute vertically"
              disabled={!distributable}
              onClick={() => editor.distribute('v')}
            >
              <Icon name="distributeV" />
            </button>
          </div>
        </Dropdown>
      )}
    </div>
  )
}
