import { useState } from 'react'
import PieceInventory from './views/PieceInventory'
import OutfitLookbook from './views/OutfitLookbook'
import AskClaude from './views/AskClaude'
import TodoList from './views/TodoList'

const TABS = [
  { id: 'pieces',  label: 'Wardrobe', icon: '◈' },
  { id: 'outfits', label: 'Outfits',  icon: '✦' },
  { id: 'ask',     label: 'Stylist',  icon: '◇' },
  { id: 'todos',   label: 'To-Do',    icon: '○' },
]

export default function App() {
  const [tab, setTab]                     = useState('pieces')
  const [stylistOutfit, setStylistOutfit] = useState(null)
  const [stylistPiece,  setStylistPiece]  = useState(null)

  const sendOutfitToStylist = (outfit) => {
    setStylistPiece(null)
    setStylistOutfit(outfit)
    setTab('ask')
  }

  const sendPieceToStylist = (piece) => {
    setStylistOutfit(null)
    setStylistPiece(piece)
    setTab('ask')
  }

  return (
    <div className="app">
      <main className="app-main">
        {tab === 'pieces'  && <PieceInventory onSendToStylist={sendPieceToStylist} />}
        {tab === 'outfits' && <OutfitLookbook onSendToStylist={sendOutfitToStylist} />}
        {tab === 'ask'     && (
          <AskClaude
            initialOutfit={stylistOutfit}
            initialPiece={stylistPiece}
            onClearOutfit={() => setStylistOutfit(null)}
            onClearPiece={() => setStylistPiece(null)}
          />
        )}
        {tab === 'todos'   && <TodoList />}
      </main>

      <nav className="bottom-nav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`nav-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="nav-icon">{t.icon}</span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
