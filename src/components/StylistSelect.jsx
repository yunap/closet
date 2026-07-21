import { useEffect, useId, useRef, useState } from 'react'

export default function StylistSelect({ value, onChange, options, ariaLabel, side = 'bottom', triggerRef }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const listboxId = useId()
  const selectedIndex = Math.max(0, options.findIndex(([optionValue]) => optionValue === value))
  const selectedLabel = options[selectedIndex]?.[1] || ''

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const moveSelection = (direction) => {
    const nextIndex = (selectedIndex + direction + options.length) % options.length
    onChange(options[nextIndex][0])
  }

  return (
    <div ref={rootRef} className={`stylist-select ${open ? 'is-open' : ''}`}>
      <button
        ref={(node) => {
          buttonRef.current = node
          if (triggerRef) triggerRef.current = node
        }}
        type="button"
        className="stylist-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen(current => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (open) moveSelection(1)
            else setOpen(true)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            if (open) moveSelection(-1)
            else setOpen(true)
          }
        }}
      >
        <span>{selectedLabel}</span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div id={listboxId} className={`stylist-select-menu side-${side}`} role="listbox" aria-label={ariaLabel}>
          {options.map(([optionValue, label]) => {
            const selected = optionValue === value
            return (
              <button
                key={optionValue}
                type="button"
                className={`stylist-select-option ${selected ? 'is-selected' : ''}`}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(optionValue)
                  setOpen(false)
                  buttonRef.current?.focus()
                }}
              >
                <span>{label}</span>
                {selected && (
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="m3.5 8.2 2.7 2.7 6.3-6.3" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
