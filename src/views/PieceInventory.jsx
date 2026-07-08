import { useState, useEffect, useCallback } from 'react'
import PieceCard from '../components/PieceCard'
import PieceForm from '../components/PieceForm'
import PieceDetail from '../components/PieceDetail'
import BatchAdd from '../components/BatchAdd'
import TodoList from './TodoList'

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
  const [pieces, setPieces]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [filterCat, setFilterCat]     = useState('')
  const [filterOcc, setFilterOcc]     = useState('')
  const [filterSeason, setFilterSeason] = useState('')
  const [filterColor, setFilterColor]   = useState('')
  const [filterFabric, setFilterFabric] = useState('')
  const [availableColors, setAvailableColors]   = useState([])
  const [availableFabrics, setAvailableFabrics] = useState([])
  const [favOnly, setFavOnly]         = useState(false)
  const [showTodo, setShowTodo]       = useState(false)
  const [showForm, setShowForm]       = useState(false)
  const [showBatch, setShowBatch]     = useState(false)
  const [editPiece, setEditPiece]     = useState(null)
  const [detailPiece, setDetailPiece] = useState(null)
  const [pendingCount, setPendingCount] = useState(0)

  const fetchPendingCount = useCallback(async () => {
    try {
      const res = await fetch('/api/todos')
      if (res.ok) {
        const data = await res.json()
        setPendingCount(data.filter(t => !t.completed).length)
      }
    } catch {}
  }, [])

  useEffect(() => {
    fetchPendingCount()
    window.addEventListener('todos-changed', fetchPendingCount)
    return () => window.removeEventListener('todos-changed', fetchPendingCount)
  }, [fetchPendingCount])

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

  const handleFavorite = async (piece) => {
    await fetch(`/api/pieces/${piece.id}/favorite`, { method: 'PATCH' })
    fetchPieces()
  }
  const handleSave = () => { setShowForm(false); setEditPiece(null); setDetailPiece(null); fetchPieces(); fetchMeta() }
  const handleDelete = async (piece) => { await fetch(`/api/pieces/${piece.id}`, { method: 'DELETE' }); setDetailPiece(null); fetchPieces(); fetchMeta() }
  const handleEdit = (piece) => { setDetailPiece(null); setEditPiece(piece); setShowForm(true) }

  return (
    <div>
      {/* Header */}
      <div className="view-header">
        <div className="view-header-top">
          <div>
            <div className="view-title">My Wardrobe</div>
            <div className="view-subtitle">{pieces.length} pieces{favOnly ? ' · favorites' : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <button className={`chip ${favOnly ? 'active' : ''}`} onClick={() => setFavOnly(f => !f)}>
              {favOnly ? '♥' : '♡'}
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
          <input type="search" placeholder="Search pieces by name, tags, or ID…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="filter-row" style={{ marginBottom: 8 }}>
          {CATEGORIES.map(c => (
            <button key={c.value} className={`chip ${filterCat === c.value ? 'active' : ''}`} onClick={() => setFilterCat(c.value)}>{c.label}</button>
          ))}
        </div>

        <div className="filter-row" style={{ marginBottom: 8 }}>
          {OCCASIONS.map(o => (
            <button key={o.value} className={`chip ${filterOcc === o.value ? 'active' : ''}`} onClick={() => setFilterOcc(o.value)}>{o.label}</button>
          ))}
        </div>

        <div className="filter-row" style={{ marginBottom: 8 }}>
          {SEASONS.map(s => (
            <button key={s.value} className={`chip ${filterSeason === s.value ? 'active' : ''}`} onClick={() => setFilterSeason(s.value)}>{s.label}</button>
          ))}
        </div>

        {availableColors.length > 0 && (
          <div className="filter-row" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 52, flexShrink: 0 }}>Colors:</span>
            <button
              className={`chip ${!filterColor ? 'active' : ''}`}
              onClick={() => setFilterColor('')}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              All
            </button>
            {availableColors.map(color => {
              const hex = COLOR_HEX_MAP[color] || '#ccc'
              const active = filterColor === color
              const isLight = ['white', 'cream', 'beige', 'oatmeal', 'light grey', 'light blue', 'lavender', 'lilac'].includes(color)
              return (
                <button
                  key={color}
                  onClick={() => setFilterColor(active ? '' : color)}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: hex,
                    border: active ? '2px solid var(--accent)' : '1px solid rgba(0,0,0,0.15)',
                    boxShadow: active ? '0 0 0 1px var(--accent-light)' : 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    position: 'relative',
                    transition: 'all 0.15s ease'
                  }}
                  title={color}
                >
                  {active && (
                    <span style={{
                      color: isLight ? '#333' : '#fff',
                      fontSize: 10,
                      fontWeight: 'bold',
                      lineHeight: 1
                    }}>✓</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {availableFabrics.length > 0 && (
          <div className="filter-row" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 52, flexShrink: 0 }}>Fabrics:</span>
            <button
              className={`chip ${!filterFabric ? 'active' : ''}`}
              onClick={() => setFilterFabric('')}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              All
            </button>
            {availableFabrics.map(fabric => (
              <button
                key={fabric}
                className={`chip ${filterFabric === fabric ? 'active' : ''}`}
                onClick={() => setFilterFabric(filterFabric === fabric ? '' : fabric)}
                style={{ fontSize: 11, padding: '3px 8px', textTransform: 'capitalize' }}
              >
                {fabric}
              </button>
            ))}
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
      <button className="fab" onClick={() => { setEditPiece(null); setShowForm(true) }}>+</button>

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
