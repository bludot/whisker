import { useEffect, useReducer } from 'react'
import { Dropdown } from './Dropdown'
import { Icon, type IconName } from './Icons'
import { NumberField } from './NumberField'
import {
  getPreference,
  setPreference,
  subscribeTheme,
  themedColor,
  type ThemePreference,
} from './theme'
import { PALETTE, type LineDash, type Tool } from '../scene/types'
import type { Editor } from '../editor/Editor'

const DASH_OPTIONS: { value: LineDash; icon: IconName; label: string }[] = [
  { value: 'solid', icon: 'lineSolid', label: 'Solid' },
  { value: 'dashed', icon: 'lineDashed', label: 'Dashed' },
  { value: 'dotted', icon: 'lineDotted', label: 'Dotted' },
]

const THEME_OPTIONS: { value: ThemePreference; icon: IconName; label: string }[] = [
  { value: 'light', icon: 'sun', label: 'Light' },
  { value: 'dark', icon: 'moon', label: 'Dark' },
  { value: 'system', icon: 'monitor', label: 'Follow system' },
]

const TOOLS: { id: Tool; label: string; icon: IconName }[] = [
  { id: 'select', label: 'Select — V', icon: 'select' },
  { id: 'hand', label: 'Pan — H (or hold Space)', icon: 'hand' },
  { id: 'pen', label: 'Pen — P', icon: 'pen' },
  { id: 'sticky', label: 'Sticky note — S', icon: 'sticky' },
  { id: 'rect', label: 'Rectangle — R', icon: 'rect' },
  { id: 'ellipse', label: 'Ellipse — O', icon: 'ellipse' },
  { id: 'connector', label: 'Arrow: drag between shapes — C', icon: 'connector' },
]

export function Toolbar({
  editor,
  onHome,
}: {
  editor: Editor
  onHome?: () => void
}) {
  const [, force] = useReducer((c: number) => c + 1, 0)
  useEffect(() => editor.subscribe(force), [editor])
  useEffect(() => subscribeTheme(force), [])

  const hasSelection = editor.selection.size > 0
  const themePref = getPreference()

  return (
    <div className="toolbar">
      <button
        className="toolbar-logo"
        title="All boards"
        onClick={() => onHome?.()}
      >
        🐈
      </button>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={editor.tool === t.id ? 'tool active' : 'tool'}
          title={t.label}
          onClick={() => editor.setTool(t.id)}
        >
          <Icon name={t.icon} />
        </button>
      ))}
      <span className="divider" />
      <button className="tool" title="Undo — Ctrl+Z" onClick={() => editor.undo()}>
        <Icon name="undo" />
      </button>
      <button className="tool" title="Redo — Ctrl+Shift+Z" onClick={() => editor.redo()}>
        <Icon name="redo" />
      </button>
      <button
        className="tool"
        title="Duplicate selection — Ctrl+D"
        disabled={!hasSelection}
        onClick={() => editor.duplicateSelection()}
      >
        <Icon name="duplicate" />
      </button>
      <button
        className="tool danger"
        title="Delete selection — Del"
        disabled={!hasSelection}
        onClick={() => editor.deleteSelection()}
      >
        <Icon name="trash" />
      </button>
      <span className="divider" />
      <Dropdown title="Settings" chip={<Icon name="settings" />}>
        <div className="dd-row">
          <span className="dd-caption">Theme</span>
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={themePref === o.value ? 'popup-btn active' : 'popup-btn'}
              title={o.label}
              onClick={() => setPreference(o.value)}
            >
              <Icon name={o.icon} />
            </button>
          ))}
        </div>
        <div className="dd-separator" />
        <div className="dd-row">
          <span className="dd-caption">Drawing</span>
          <button
            className={editor.recognizeShapes ? 'popup-btn active' : 'popup-btn'}
            title="Auto-convert drawn rectangles, ellipses and lines into real shapes"
            onClick={() => editor.setRecognizeShapes(!editor.recognizeShapes)}
          >
            <Icon name="magic" />
          </button>
          <button
            className={
              editor.fingerPansWithStylus ? 'popup-btn active' : 'popup-btn'
            }
            title="While using a stylus: fingers pan, tap selects"
            onClick={() =>
              editor.setFingerPansWithStylus(!editor.fingerPansWithStylus)
            }
          >
            <Icon name="hand" />
          </button>
        </div>
        <div className="dd-separator" />
        <div className="dd-row">
          <span className="dd-caption">Pen</span>
          <NumberField
            value={editor.penDefaults.width}
            min={1}
            max={24}
            step={1}
            suffix="px"
            title="Pen stroke width"
            onChange={(v) => editor.setPenDefaults({ width: v })}
          />
          {DASH_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={
                editor.penDefaults.dash === o.value
                  ? 'popup-btn active'
                  : 'popup-btn'
              }
              title={`${o.label} pen stroke`}
              onClick={() => editor.setPenDefaults({ dash: o.value })}
            >
              <Icon name={o.icon} />
            </button>
          ))}
        </div>
        <div className="dd-separator" />
        <div className="dd-row">
          <span className="dd-caption">Fill</span>
          {PALETTE.map((color) => (
            <button
              key={`f${color}`}
              className={
                editor.styleDefaults.fillColor === color
                  ? 'swatch active'
                  : 'swatch'
              }
              title="Default fill color for new shapes"
              style={{ background: `#${themedColor(color).toString(16).padStart(6, "0")}` }}
              onClick={() => editor.setStyleDefaults({ fillColor: color })}
            />
          ))}
        </div>
        <div className="dd-row">
          <span className="dd-caption">Opacity</span>
          <NumberField
            value={Math.round(editor.styleDefaults.fillOpacity * 100)}
            min={0}
            max={100}
            step={10}
            suffix="%"
            title="Default fill opacity for new shapes"
            onChange={(v) => editor.setStyleDefaults({ fillOpacity: v / 100 })}
          />
        </div>
        <div className="dd-separator" />
        <div className="dd-row">
          <span className="dd-caption">Border</span>
          {PALETTE.map((color) => (
            <button
              key={`s${color}`}
              className={
                editor.styleDefaults.strokeColor === color
                  ? 'swatch active'
                  : 'swatch'
              }
              title="Default border color for new shapes"
              style={{ background: `#${themedColor(color).toString(16).padStart(6, "0")}` }}
              onClick={() => editor.setStyleDefaults({ strokeColor: color })}
            />
          ))}
        </div>
        <div className="dd-row">
          <span className="dd-caption">Opacity</span>
          <NumberField
            value={Math.round(editor.styleDefaults.strokeOpacity * 100)}
            min={0}
            max={100}
            step={10}
            suffix="%"
            title="Default border opacity for new shapes"
            onChange={(v) => editor.setStyleDefaults({ strokeOpacity: v / 100 })}
          />
          <NumberField
            value={editor.styleDefaults.strokeWidth}
            min={0}
            max={12}
            step={1}
            suffix="px"
            title="Default border width for new shapes"
            onChange={(v) => editor.setStyleDefaults({ strokeWidth: v })}
          />
        </div>
        <div className="dd-row">
          <span className="dd-caption">Style</span>
          {DASH_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={
                (editor.styleDefaults.dash ?? 'solid') === o.value
                  ? 'popup-btn active'
                  : 'popup-btn'
              }
              title={`${o.label} border for new shapes`}
              onClick={() => editor.setStyleDefaults({ dash: o.value })}
            >
              <Icon name={o.icon} />
            </button>
          ))}
        </div>
      </Dropdown>
    </div>
  )
}
