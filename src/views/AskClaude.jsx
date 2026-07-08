import { useState } from 'react'
import StylistChat from '../components/StylistChat'

// ─── AskClaude ────────────────────────────────────────────────────────────────
// Thin orchestrator. Owns the active context shared across components.
// ──────────────────────────────────────────────────────────────────────────────

export default function AskClaude({ initialOutfit, initialPiece, initialThreadId, onClearOutfit, onClearPiece, onClearThreadId }) {
  const [activeContext, setActiveContext] = useState(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <StylistChat
        initialOutfit={initialOutfit}
        initialPiece={initialPiece}
        initialThreadId={initialThreadId}
        onClearOutfit={onClearOutfit}
        onClearPiece={onClearPiece}
        onClearThreadId={onClearThreadId}
        activeContext={activeContext}
        onContextChange={setActiveContext}
      />
    </div>
  )
}
