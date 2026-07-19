import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import PieceCard from '../components/PieceCard'
import PieceForm from '../components/PieceForm'
import PieceDetail from '../components/PieceDetail'
import BatchAdd from '../components/BatchAdd'
import TodoList from './TodoList'
import usePendingWardrobeTaskCount from '../utils/usePendingWardrobeTaskCount'

const CATEGORIES = [
  { value: '',          label: 'All' },
  { value: 'top',       label: 'Tops' },
  { value: 'bottom',    label: 'Bottoms' },
  { value: 'dress',     label: 'Dresses' },
  { value: 'outerwear', label: 'Outerwear' },
  { value: 'shoes',     label: 'Shoes' },
  { value: 'accessory', label: 'Accessories' },
]

const OCCASIONS = [
  { value: '',             label: 'All occasions' },
  { value: 'casual',       label: 'Casual' },
  { value: 'city',         label: 'City' },
  { value: 'evening',      label: 'Evening' },
  { value: 'smart-casual', label: 'Smart Casual' },
  { value: 'outdoor',      label: 'Outdoor' },
  { value: 'home',         label: 'Home' },
  { value: 'walking',      label: 'Walking' },
]

const SEASONS = [
  { value: '',           label: 'All seasons' },
  { value: 'warm',       label: 'Warm / Summer' },
  { value: 'cool',       label: 'Cool / Winter' },
  { value: 'year-round', label: 'Year-Round' },
]

const COLOR_HEX_MAP = {
  black: '#2A2420', white: '#F5F2EC', cream: '#E8DFC8', beige: '#D6C3A3',
  taupe: '#9C8B78', grey: '#9A9A9A', charcoal: '#484848', navy: '#1E2D4A',
  denim: '#4F6F8F', brown: '#7A5A3A', tan: '#C0A070', oatmeal: '#D8C8B0',
  amber: '#B07820', mustard: '#B89020', orange: '#C86030', red: '#A83A2A',
  pink: '#C07080', mauve: '#A7798A', lavender: '#A99AC2', lilac: '#C4B2D8',
  plum: '#5A3060', green: '#3A6A3A', olive: '#5A6030', turquoise: '#2A8080',
  'light blue': '#7AADCC', periwinkle: '#8888CC', 'dark blue': '#1A2040',
  'dark grey': '#484848', 'light grey': '#B8B8B8', multi: '#8A6848'
}

export default function PieceInventory({ onSendToStylist }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // Filter state — backed by URL query params so state survives tab switches.
  // Reads fall back to the same defaults as the old useState initialisers.
  const search       = searchParams.get('q')        ?? ''
  const filterCat    = searchParams.get('category') ?? ''
  const filterOcc    = searchParams.get('occasion') ?? ''
  const filterSeason = searchParams.get('season')   ?? ''
  const filterColor  = searchParams.get('color')    ?? ''
  const filterFabric = searchParams.get('fabric')   ?? ''
  const favOnly      = searchParams.get('fav') === '1'

  // Helper: write one or more params, omitting defaults to keep URLs clean.
  // Always uses replace:true — filter changes are not history entries.
  const setFilter = useCallback((updates) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === false || value === '0') {
          next.delete(key)
        } else {
          next.set(key, value === true ? '1' : String(value))
        }
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [pieces, setPieces]           = useState([])
  const [loading, setLoading]         = useState(true)
  // showTodo is a modal-open flag — intentionally NOT URL-backed (modal should open fresh each visit)
  const [showTodo, setShowTodo]       = useState(false)
  const [showForm, setShowForm]       = useState(false)
  const [showBatch, setShowBatch]     = useState(false)
  const [editPiece, setEditPiece]     = useState(null)
  const [detailPiece, setDetailPiece] = useState(null)
  const [openFilterMenu, setOpenFilterMenu] = useState(null)
  const [fabricSearch, setFabricSearch] = useState('')
  const compactFilterRef = useRef(null)
  const [availableColors, setAvailableColors]   = useState([])
  const [availableFabrics, setAvailableFabrics] = useState([])
  const pendingCount = usePendingWardrobeTaskCount()

  const fetchMeta = useCallback(async () => {
    try {
      const res = await fetch('/api/pieces/meta')
      const data = await res.json()
      setAvailableColors(data.colors || [])
      setAvailableFabrics(data.fabrics || [])
    } catch {}
  }, [])

  useEffect(() => { fetchMeta() }, [fetchMeta])

  const fetchPieces = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterCat)    params.set('category', filterCat)
    if (filterOcc)    params.set('occasion', filterOcc)
    if (filterSeason) params.set('season', filterSeason)
    if (filterColor)  params.set('color', filterColor)
    if (filterFabric) params.set('fabric', filterFabric)
    if (search)       params.set('search', search)
    if (favOnly)      params.set('favorites', 'true')
    const res  = await fetch(`/api/pieces?${params}`)
    setPieces(await res.json())
    setLoading(false)
  }, [filterCat, filterOcc, filterSeason, filterColor, filterFabric, search, favOnly])

  useEffect(() => { fetchPieces() }, [fetchPieces])
  useEffect(() => { const t = setTimeout(fetchPieces, 300); return () => clearTimeout(t) }, [search])
  useEffect(() => {
    if (!openFilterMenu) return undefined
    const handlePointerDown = (event) => {
      if (!compactFilterRef.current?.contains(event.target)) {
        setOpenFilterMenu(null)
        setFabricSearch('')
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpenFilterMenu(null)
        setFabricSearch('')
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openFilterMenu])

  const handleFavorite = async (piece) => {
    await fetch(`/api/pieces/${piece.id}/favorite`, { method: 'PATCH' })
    fetchPieces()
  }
  const handleSave = () => { setShowForm(false); setEditPiece(null); setDetailPiece(null); fetchPieces(); fetchMeta() }
  const handleDelete = async (piece) => { await fetch(`/api/pieces/${piece.id}`, { method: 'DELETE' }); setDetailPiece(null); fetchPieces(); fetchMeta() }
  const handleEdit = (piece) => { setDetailPiece(null); setEditPiece(piece); setShowForm(true) }
  const activeCompactFilters = [
    filterColor ? { key: 'color', label: filterColor, clear: () => setFilter({ color: '' }) } : null,
    filterFabric ? { key: 'fabric', label: filterFabric, clear: () => setFilter({ fabric: '' }) } : null,
  ].filter(Boolean)
  const visibleFabrics = availableFabrics.filter(fabric => fabric.toLowerCase().includes(fabricSearch.trim().toLowerCase()))
  const addPiece = () => { setEditPiece(null); setShowForm(true) }

  return (
    <div>
      {/* Header */}
      <div className="view-header">
        <div className="view-header-top">
          <div>
            <div className="view-title">The Wardrobe Room</div>
            <div className="view-subtitle">{pieces.length} pieces{favOnly ? ' · favorites' : ''}</div>
          </div>
          <div className="wardrobe-header-actions">
            <button className="chip wardrobe-add-piece" onClick={addPiece}>
              Add piece
            </button>
            <button className="chip" onClick={() => navigate('/import')}>
              Import
            </button>
            <button
              className="chip"
              onClick={() => setShowTodo(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              📋 Tasks {pendingCount > 0 && <span className="badge-count">{pendingCount}</span>}
            </button>
            <button
              className="chip"
              onClick={() => setShowBatch(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              ⊕ Batch
            </button>
          </div>
        </div>

        <div className="search-bar">
          <span className="search-icon">◎</span>
          <input type="search" placeholder="Search pieces by name, tags, or ID…" value={search} onChange={e => setFilter({ q: e.target.value })} />
        </div>

        <div className="wardrobe-filter-group">
          <div className="wardrobe-filter-label">Category</div>
          <div className="filter-row">
            {CATEGORIES.map(c => (
              <button key={c.value} className={`chip ${filterCat === c.value ? 'active' : ''}`} onClick={() => setFilter({ category: c.value })}>{c.label}</button>
            ))}
          </div>
        </div>

        <div className="wardrobe-filter-group">
          <div className="wardrobe-filter-label">Occasion</div>
          <div className="filter-row">
            {OCCASIONS.map(o => (
              <button key={o.value} className={`chip ${filterOcc === o.value ? 'active' : ''}`} onClick={() => setFilter({ occasion: o.value })}>{o.label}</button>
            ))}
          </div>
        </div>

        <div className="wardrobe-filter-group">
          <div className="wardrobe-filter-label">Season</div>
          <div className="filter-row">
            {SEASONS.map(s => (
              <button key={s.value} className={`chip ${filterSeason === s.value ? 'active' : ''}`} onClick={() => setFilter({ season: s.value })}>{s.label}</button>
            ))}
          </div>
        </div>

        <div className="wardrobe-compact-filter-row" ref={compactFilterRef}>
          {availableColors.length > 0 && (
            <div className="wardrobe-filter-menu">
              <button
                className={`filter-menu-btn ${openFilterMenu === 'color' || filterColor ? 'active' : ''}`}
                onClick={() => { setFabricSearch(''); setOpenFilterMenu(openFilterMenu === 'color' ? null : 'color') }}
                aria-expanded={openFilterMenu === 'color'}
                aria-haspopup="menu"
              >
                <span>{filterColor ? 'Color · 1' : 'Color'}</span>
                <span className="filter-menu-chevron">⌄</span>
              </button>
              {openFilterMenu === 'color' && (
                <div className="filter-menu-popover wardrobe-color-popover" role="menu">
                  <button
                    className={`custom-select-option ${!filterColor ? 'active' : ''}`}
                    onClick={() => { setFilter({ color: '' }); setOpenFilterMenu(null) }}
                    role="menuitem"
                  >
                    <span>All</span>
                    {!filterColor && <span aria-hidden="true">✓</span>}
                  </button>
                  <div className="wardrobe-color-grid">
                    {availableColors.map(color => {
                      const hex = COLOR_HEX_MAP[color] || '#ccc'
                      const active = filterColor === color
                      const isLight = ['white', 'cream', 'beige', 'oatmeal', 'light grey', 'light blue', 'lavender', 'lilac'].includes(color)
                      return (
                        <button
                          key={color}
                          className={`wardrobe-color-swatch ${active ? 'active' : ''}`}
                          onClick={() => { setFilter({ color: active ? '' : color }); setOpenFilterMenu(null) }}
                          style={{ background: hex }}
                          title={color}
                          aria-label={`${active ? 'Clear' : 'Filter by'} ${color}`}
                          role="menuitem"
                        >
                          {active && <span style={{ color: isLight ? '#333' : '#fff' }}>✓</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {availableFabrics.length > 0 && (
            <div className="wardrobe-filter-menu">
              <button
                className={`filter-menu-btn ${openFilterMenu === 'fabric' || filterFabric ? 'active' : ''}`}
                onClick={() => setOpenFilterMenu(openFilterMenu === 'fabric' ? null : 'fabric')}
                aria-expanded={openFilterMenu === 'fabric'}
                aria-haspopup="menu"
              >
                <span>{filterFabric ? 'Fabric · 1' : 'Fabric'}</span>
                <span className="filter-menu-chevron">⌄</span>
              </button>
              {openFilterMenu === 'fabric' && (
                <div className="filter-menu-popover wardrobe-fabric-popover" role="menu">
                  <div className="wardrobe-fabric-search-shell">
                    <input
                      className="wardrobe-fabric-search"
                      type="search"
                      placeholder="Search fabrics..."
                      value={fabricSearch}
                      onChange={event => setFabricSearch(event.target.value)}
                    />
                  </div>
                  <button
                    className={`custom-select-option ${!filterFabric ? 'active' : ''}`}
                    onClick={() => { setFilter({ fabric: '' }); setOpenFilterMenu(null); setFabricSearch('') }}
                    role="menuitem"
                  >
                    <span>All</span>
                    {!filterFabric && <span aria-hidden="true">✓</span>}
                  </button>
                  {visibleFabrics.map(fabric => (
                    <button
                      key={fabric}
                      className={`custom-select-option ${filterFabric === fabric ? 'active' : ''}`}
                      onClick={() => { setFilter({ fabric: filterFabric === fabric ? '' : fabric }); setOpenFilterMenu(null); setFabricSearch('') }}
                      role="menuitem"
                      style={{ textTransform: 'capitalize' }}
                    >
                      <span>{fabric}</span>
                      {filterFabric === fabric && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            className={`chip wardrobe-favorite-filter ${favOnly ? 'active' : ''}`}
            onClick={() => setFilter({ fav: !favOnly })}
            title="Show favorite pieces"
            aria-label="Show favorite pieces"
            aria-pressed={favOnly}
          >
            {favOnly ? '♥ Favorites' : '♡ Favorites'}
          </button>
        </div>

        {activeCompactFilters.length > 0 && (
          <div className="active-filter-row wardrobe-active-filter-row">
            {activeCompactFilters.map(filter => (
              <button key={filter.key} className="active-filter-chip" onClick={filter.clear}>
                {filter.label} ×
              </button>
            ))}
            {activeCompactFilters.length >= 2 && (
              <button className="clear-filters-btn" onClick={() => setFilter({ color: '', fabric: '' })}>
                Clear all
              </button>
            )}
          </div>
        )}

      </div>

      {/* Grid */}
      {loading ? (
        <div className="loading">Loading your wardrobe…</div>
      ) : pieces.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◈</div>
          <div className="empty-state-title">Nothing here yet</div>
          <div className="empty-state-text">
            {search || filterCat || filterOcc || filterSeason || filterColor || filterFabric ? 'Try adjusting your filters' : 'Tap + to add a piece, or use Batch to add many at once'}
          </div>
        </div>
      ) : (
        <div className="piece-grid">
          {pieces.map(p => (
            <PieceCard key={p.id} piece={p} onTap={setDetailPiece} onFavorite={handleFavorite} />
          ))}
        </div>
      )}

      {/* FAB */}
      <button className="fab wardrobe-mobile-fab" onClick={addPiece}>+</button>

      {/* Modals */}
      {showForm && <PieceForm piece={editPiece} onSave={handleSave} onCancel={() => { setShowForm(false); setEditPiece(null) }} />}
      {detailPiece && !showForm && <PieceDetail piece={detailPiece} onEdit={handleEdit} onDelete={handleDelete} onClose={() => setDetailPiece(null)} onSendToStylist={(piece) => { setDetailPiece(null); onSendToStylist(piece) }} />}
      {showBatch && <BatchAdd onDone={() => { setShowBatch(false); fetchPieces() }} />}
      {showTodo && (
        <div className="modal-overlay" onClick={() => setShowTodo(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '88dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-handle" />
            <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 24 }}>
              <TodoList
                isModal={true}
                onClose={() => setShowTodo(false)}
                onPieceClick={async (pieceId) => {
                  const res = await fetch(`/api/pieces/${pieceId}`)
                  if (res.ok) {
                    const piece = await res.json()
                    setShowTodo(false)
                    setDetailPiece(piece)
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
