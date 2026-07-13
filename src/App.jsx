import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom'
import PieceInventory from './views/PieceInventory'
import OutfitLookbook from './views/OutfitLookbook'
import AskClaude from './views/AskClaude'
import VisualLab from './components/VisualLab'

const TABS = [
  { id: 'pieces',  label: 'Wardrobe',    icon: '◈', to: '/wardrobe'   },
  { id: 'outfits', label: 'Outfits',     icon: '✦', to: '/outfits'    },
  { id: 'ask',     label: 'Stylist',     icon: '◇', to: '/stylist'    },
  { id: 'vislab',  label: 'Visual Lab',  icon: '⌾', to: '/visual-lab' },
]

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [pendingTodoCount, setPendingTodoCount] = useState(0)
  const isStylistRoute = location.pathname === '/stylist' || location.pathname.startsWith('/stylist/')

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

  // Handoff: piece → stylist. Thin wrapper so PieceInventory/OutfitLookbook call-sites are unchanged.
  const sendPieceToStylist = (piece) => {
    navigate('/stylist', { state: { piece, outfit: null } })
  }

  // Handoff: outfit → stylist. actionId nonce preserved exactly (fixes lastAutoOutfitActionRef staleness).
  const sendOutfitToStylist = (outfit) => {
    navigate('/stylist', { state: { outfit: outfit ? { ...outfit, actionId: Date.now() } : null, piece: null } })
  }

  // Thread navigation from Lookbook / Visual Lab boards.
  const goToThread = (threadId) => {
    navigate('/stylist/' + threadId)
  }

  return (
    <div className="app">
      <main className={`app-main${isStylistRoute ? ' stylist-app-main' : ''}`}>
        <Routes>
          <Route path="/" element={<Navigate to="/wardrobe" replace />} />
          <Route path="/wardrobe"   element={<PieceInventory onSendToStylist={sendPieceToStylist} />} />
          <Route path="/outfits"    element={<OutfitLookbook onSendToStylist={sendOutfitToStylist} onGoToThread={goToThread} />} />
          {/* /stylist and /stylist/:threadId intentionally share the same <AskClaude /> element
              with NO key prop — React reuses the same component instance when only the param
              changes, preserving all thread state without a remount. */}
          <Route path="/stylist"           element={<AskClaude />} />
          <Route path="/stylist/:threadId" element={<AskClaude />} />
          <Route path="/visual-lab" element={<VisualLab onGoToThread={goToThread} />} />
        </Routes>
      </main>

      <nav className="bottom-nav">
        {TABS.map(t => {
          const isWardrobe = t.id === 'pieces'
          return (
            <NavLink
              key={t.id}
              to={t.to}
              // end=false so /stylist/:threadId also highlights the Stylist tab
              end={t.id !== 'ask'}
              className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
              style={{ position: 'relative' }}
            >
              <span className="nav-icon">{t.icon}</span>
              <span className="nav-label">{t.label}</span>
              {isWardrobe && pendingTodoCount > 0 && (
                <span className="badge-count nav-badge">{pendingTodoCount}</span>
              )}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
