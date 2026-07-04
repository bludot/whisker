import { useState, type ReactNode } from 'react'

/** A chip button that opens a popover with its controls. */
export function Dropdown({
  chip,
  title,
  children,
}: {
  chip: ReactNode
  title: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="dd">
      <button
        className={open ? 'popup-btn chip open' : 'popup-btn chip'}
        title={title}
        onClick={() => setOpen(!open)}
      >
        {chip}
        <span className="caret">▾</span>
      </button>
      {open && (
        <>
          <div className="dd-backdrop" onClick={() => setOpen(false)} />
          <div className="dd-menu">{children}</div>
        </>
      )}
    </div>
  )
}
