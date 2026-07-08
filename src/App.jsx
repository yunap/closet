import { useState, useEffect, useCallback } from 'react'
import PieceInventory from './views/PieceInventory'
import OutfitLookbook from './views/OutfitLookbook'
import AskClaude from './views/AskClaude'
import VisualLab from './components/VisualLab'

const TABS = [
  { id: 'pieces',  label: 'Wardrobe', icon: '◈' },
  { id: 'outfits', label: 'Outfits',  icon: '✦' },
  { id: 'ask',     label: 'Stylist',  icon: '◇' },
  { id: 'vislab',  label: 'Visual Lab', icon: '⌾' },
]

export default function App() {
  const [tab, setTab]                     = useState('pieces')
  const [stylistOutfit, setStylistOutfit] = useState(null)
  const [stylistPiece,  setStylistPiece]  = useState(null)
  const [pendingTodoCount, setPendingTodoCount] = useState(0)

  const fetchPendingCount = useCallback(async () => {
    try {
      const res = await fetch('/api/todos')
      if (res.ok) {
        const data = await res.json()
        setPendingTodoCount(data.filter(t => !t.completed).length)
      }
    } catch {}
  }, [])

  useEffect(() => {
    fetchPendingCount()
    window.addEventListener('todos-changed', fetchPendingCount)
    return () => window.removeEventListener('todos-changed', fetchPendingCount)
  }, [fetchPendingCount])

  const [stylistThreadId, setStylistThreadId] = useState(null)

  const sendOutfitToStylist = (outfit) => {
    setStylistPiece(null)
    setStylistThreadId(null)
    setStylistOutfit(outfit ? { ...outfit, actionId: Date.now() } : null)
    setTab('ask')
  }

  const sendPieceToStylist = (piece) => {
    setStylistOutfit(null)
    setStylistThreadId(null)
    setStylistPiece(piece)
    setTab('ask')
  }

  const goToThread = (threadId) => {
    setStylistOutfit(null)
    setStylistPiece(null)
    setStylistThreadId(threadId)
    setTab('ask')
  }

  return (
    <div className="app">
      <main className="app-main">
        {tab === 'pieces'  && <PieceInventory onSendToStylist={sendPieceToStylist} />}
        {tab === 'outfits' && <OutfitLookbook onSendToStylist={sendOutfitToStylist} onGoToThread={goToThread} />}
        {tab === 'ask'     && (
          <AskClaude
            initialOutfit={stylistOutfit}
            initialPiece={stylistPiece}
            initialThreadId={stylistThreadId}
            onClearOutfit={() => setStylistOutfit(null)}
            onClearPiece={() => setStylistPiece(null)}
            onClearThreadId={() => setStylistThreadId(null)}
          />
        )}
        {tab === 'vislab'  && <VisualLab onGoToThread={goToThread} />}
      </main>

      <nav className="bottom-nav">
        {TABS.map(t => {
          const isWardrobe = t.id === 'pieces'
          return (
            <button
              key={t.id}
              className={`nav-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              style={{ position: 'relative' }}
            >
              <span className="nav-icon">{t.icon}</span>
              <span className="nav-label">{t.label}</span>
              {isWardrobe && pendingTodoCount > 0 && (
                <span className="badge-count nav-badge">{pendingTodoCount}</span>
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
