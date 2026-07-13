import { useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import StylistChat from '../components/StylistChat'

// ─── AskClaude ────────────────────────────────────────────────────────────────
// Thin orchestrator. Reads thread id from the URL param and piece/outfit handoff
// from router location.state (set by App's navigate() calls). Owns the active
// context shared across components.
// ──────────────────────────────────────────────────────────────────────────────

export default function AskClaude() {
  const { threadId } = useParams()         // undefined on /stylist, string on /stylist/:threadId
  const { state } = useLocation()          // { outfit, piece } set by sendOutfitToStylist / sendPieceToStylist
  const [activeContext, setActiveContext] = useState(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <StylistChat
        initialOutfit={state?.outfit ?? null}
        initialPiece={state?.piece ?? null}
        initialThreadId={threadId ?? null}
        activeContext={activeContext}
        onContextChange={setActiveContext}
      />
    </div>
  )
}
