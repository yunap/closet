import { useState } from 'react'
import StylistChat from '../components/StylistChat'
import VisualLab from '../components/VisualLab'

// ─── AskClaude ────────────────────────────────────────────────────────────────
// Thin orchestrator. Owns the two pieces of state shared across both children:
//   activeContext  — which piece or outfit the conversation is about
//   calibrationLibraryOpen — whether the VisualLab panel is visible
//
// Everything else lives in the child that actually uses it.
// ──────────────────────────────────────────────────────────────────────────────

export default function AskClaude({ initialOutfit, initialPiece, onClearOutfit, onClearPiece }) {
  const [activeContext, setActiveContext]               = useState(null)
  const [calibrationLibraryOpen, setCalibrationLibraryOpen] = useState(false)

  // Incremented by StylistChat whenever a board is saved, so VisualLab knows
  // to refresh its saved-boards list if it's currently open.
  const [boardSaveCount, setBoardSaveCount]             = useState(0)

  const handleToggleCalibration = (nextOpen) => {
    setCalibrationLibraryOpen(v => typeof nextOpen === 'boolean' ? nextOpen : !v)
  }

  const handleResetVisuals = () => {
    setCalibrationLibraryOpen(false)
    setBoardSaveCount(0)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* VisualLab sits above the chat thread when open */}
      {calibrationLibraryOpen && (
        <VisualLab
          activeContext={activeContext}
          boardSaveCount={boardSaveCount}
          onClose={() => setCalibrationLibraryOpen(false)}
        />
      )}

      <StylistChat
        initialOutfit={initialOutfit}
        initialPiece={initialPiece}
        onClearOutfit={onClearOutfit}
        onClearPiece={onClearPiece}
        activeContext={activeContext}
        onContextChange={setActiveContext}
        calibrationLibraryOpen={calibrationLibraryOpen}
        onToggleCalibration={handleToggleCalibration}
        onBoardSaved={() => setBoardSaveCount(c => c + 1)}
        onResetVisuals={handleResetVisuals}
      />

    </div>
  )
}
