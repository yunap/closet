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
  side = 'bottom',
  size = 'md',
  width = 260,
  className = '',
  // A bare "ⓘ" is easy to miss when the popover behind it is substantial (several short
  // sections, not one line) — pass triggerText to render a labeled pill instead, so the
  // affordance itself hints there's real content behind it.
  triggerText = '',
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
    if (!open) return undefined
    const handlePointerDown = (e) => {
      if (popoverRef.current?.contains(e.target)) return
      if (buttonRef.current?.contains(e.target)) return
      if (onToggle) onToggle(false)
      if (!isControlled) setInternalOpen(false)
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (onToggle) onToggle(false)
        if (!isControlled) setInternalOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isControlled, onToggle, open])

  return (
    <div className={`info-tooltip ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        className={`info-tooltip-trigger size-${size} ${triggerText ? 'has-text' : ''} ${open ? 'active' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-label={label}
        aria-controls={idRef.current}
      >
        <svg viewBox="0 0 16 16" width={triggerText ? 14 : '70%'} height={triggerText ? 14 : '70%'} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="8" cy="4.9" r="1.05" fill="currentColor" />
          <path d="M8 7.3V12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {triggerText && <span className="info-tooltip-trigger-text">{triggerText}</span>}
      </button>
      {open && (
        <div
          ref={popoverRef}
          id={idRef.current}
          className={`info-tooltip-popover align-${align} side-${side}`}
          role="tooltip"
          style={{ width }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
