import { useEffect, useState } from 'react'

const SHOW_ELAPSED_AFTER_MS = 8000
const LONG_TURN_AFTER_MS = 60000
const DONE_STEPS_SHOWN = 3

// What the chat shows while a turn works, in the stylist's reply position (owner, 2026-11-04). The
// reply replaces it; there is no "ready" line, since the outfits arriving says that.
export default function TurnProgress({ progress }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsedMs = Math.max(0, now - (progress?.startedAt || now))
  const seconds = Math.round(elapsedMs / 1000)
  const done = (progress?.done || []).slice(-DONE_STEPS_SHOWN)
  return (
    <div className="ai-message assistant turn-progress">
      {progress?.chips?.length > 0 && (
        <div className="turn-progress-chips" aria-label="How your request was read">
          {progress.chips.map(chip => <span key={chip} className="turn-progress-chip">{chip}</span>)}
        </div>
      )}
      {done.map((step, index) => (
        <div key={`${index}-${step.text}`} className={`turn-progress-done${step.warn ? ' is-warning' : ''}`}>
          <span aria-hidden="true">{step.warn ? '!' : '✓'}</span> {step.text}
        </div>
      ))}
      <div className="turn-progress-current" role="status" aria-live="polite">
        <span className="typing-dots" aria-hidden="true"><span /><span /><span /></span>
        <span>{progress?.current}…</span>
      </div>
      {elapsedMs >= SHOW_ELAPSED_AFTER_MS && (
        <div className="turn-progress-elapsed">
          {seconds} s{elapsedMs >= LONG_TURN_AFTER_MS ? ' · Longer requests can take a couple of minutes' : ''}
        </div>
      )}
    </div>
  )
}
