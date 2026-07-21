import { useEffect, useRef, useState } from 'react'

let idCounter = 0

/**
 * Small "ⓘ" trigger + anchored popover, used for short inline explanations
 * (e.g. what a sort option or form field means). Self-manages open/close
 * state (outside click, Escape, focus return) unless `open`/`onToggle` are
 * passed, in which case a parent component drives it — useful when several
 * of these share one "which menu is open" state, like a filter toolbar.
 */
export default function InfoTooltip({
  label,
  children,
  open: openProp,
  onToggle,
  align = 'right',
  size = 'md',
  width = 260,
}) {
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? openProp : internalOpen
  const buttonRef = useRef(null)
  const popoverRef = useRef(null)
  const idRef = useRef(null)
  if (!idRef.current) idRef.current = `info-tooltip-${++idCounter}`

  const toggle = () => {
    const next = !open
    if (onToggle) onToggle(next)
    if (!isControlled) setInternalOpen(next)
  }

  useEffect(() => {
    if (isControlled || !open) return undefined
    const handlePointerDown = (e) => {
      if (popoverRef.current?.contains(e.target)) return
      if (buttonRef.current?.contains(e.target)) return
      setInternalOpen(false)
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setInternalOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isControlled, open])

  return (
    <div className="info-tooltip">
      <button
        ref={buttonRef}
        type="button"
        className={`info-tooltip-trigger size-${size} ${open ? 'active' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-label={label}
        aria-controls={idRef.current}
      >
        ⓘ
      </button>
      {open && (
        <div
          ref={popoverRef}
          id={idRef.current}
          className={`info-tooltip-popover align-${align}`}
          role="tooltip"
          style={{ width }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
