import { useEffect, useMemo } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom'
import PieceInventory from './views/PieceInventory'
import OutfitLookbook from './views/OutfitLookbook'
import AskClaude from './views/AskClaude'
import VisualLab from './components/VisualLab'
import Onboarding from './views/Onboarding'
import StylistSettings from './views/StylistSettings'
import usePendingWardrobeTaskCount from './utils/usePendingWardrobeTaskCount'

function NavIcon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }
  if (name === 'wardrobe') {
    return (
      <svg {...common}>
        <path d="M12 6.5c0-1.4 1-2.5 2.4-2.5 1.2 0 2.1.8 2.3 1.9" />
        <path d="M12 7v3" />
        <path d="M5 20h14l-7-10-7 10Z" />
      </svg>
    )
  }
  if (name === 'outfits') {
    return (
      <svg {...common}>
        <rect x="6" y="4" width="11" height="14" rx="2" />
        <path d="M9 4c.5 1.3 1.4 2 2.5 2S13.5 5.3 14 4" />
        <path d="M4 8h3" />
        <path d="M17 8h3" />
        <path d="M9 14h5" />
      </svg>
    )
  }
  if (name === 'stylist') {
    return (
      <svg {...common}>
        <path d="M5 6.5h9.5a3.5 3.5 0 0 1 0 7H10l-4.5 4v-4H5a3.5 3.5 0 0 1 0-7Z" />
        <path d="M18 4v4" />
        <path d="M16 6h4" />
      </svg>
    )
  }
  if (name === 'settings') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="4" y="5" width="12" height="12" rx="2" />
      <path d="M8 17h10a2 2 0 0 0 2-2V8" />
      <path d="M7.5 13.5 10 11l2 2 1.5-1.5" />
      <path d="M8 8.5h.01" />
    </svg>
  )
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const pendingTodoCount = usePendingWardrobeTaskCount()
  const isStylistRoute = location.pathname === '/stylist' || location.pathname.startsWith('/stylist/')
  const isOnboardingRoute = location.pathname === '/onboarding'

  // Spec 32 Part 3: a fresh instance routes to the wizard until onboarding completes or is
  // skipped. Pre-existing (legacy-seeded) instances never see it — the server decides.
  // Redirect only from a FRESH server answer for the current route — never from held
  // state. A stale needsOnboarding=true in a state-driven redirect effect bounces the
  // user back into the wizard on the very navigation that completes it (live-found bug:
  // the reset-then-refetch variant still lost the race within a single effect flush).
  useEffect(() => {
    if (isOnboardingRoute) return
    let cancelled = false
    fetch('/api/settings/onboarding-status')
      .then(r => r.json())
      .then(status => {
        if (!cancelled && status?.needsOnboarding) navigate('/onboarding', { replace: true })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [location.pathname, isOnboardingRoute, navigate])
  const navItems = useMemo(() => ([
    { id: 'wardrobe', label: 'Wardrobe', icon: 'wardrobe', to: '/wardrobe', badgeCount: pendingTodoCount },
    { id: 'outfits', label: 'Outfits', icon: 'outfits', to: '/outfits' },
    { id: 'stylist', label: 'Stylist', icon: 'stylist', to: '/stylist' },
    { id: 'visual_lab', label: 'Visual Lab', icon: 'visual_lab', to: '/visual-lab' },
    { id: 'settings', label: 'Settings', icon: 'settings', to: '/settings' },
  ]), [pendingTodoCount])

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
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/settings"   element={<StylistSettings />} />
        </Routes>
      </main>

      {!isOnboardingRoute && <nav className="primary-nav" aria-label="Primary">
        <ul className="primary-nav__list">
          {navItems.map(item => {
            const badgeCount = Number(item.badgeCount || 0)
            const badgeLabel = badgeCount > 99 ? '99+' : String(badgeCount)
            return (
              <li className="primary-nav__list-item" key={item.id}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) => `primary-nav__item${isActive ? ' active' : ''}`}
                  data-label={item.label}
                  title={item.label}
                >
                  <span className="primary-nav__icon">
                    <NavIcon name={item.icon} />
                  </span>
                  <span className="primary-nav__label">{item.label}</span>
                  {badgeCount > 0 && (
                    <span
                      className="badge-count primary-nav__badge"
                      aria-label={`${badgeCount} wardrobe ${badgeCount === 1 ? 'task' : 'tasks'}`}
                      title={`${badgeCount} wardrobe ${badgeCount === 1 ? 'task' : 'tasks'}`}
                    >
                      {badgeLabel}
                    </span>
                  )}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>}
    </div>
  )
}
