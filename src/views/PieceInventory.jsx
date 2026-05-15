import { useState, useEffect, useCallback } from 'react'
import PieceCard from '../components/PieceCard'
import PieceForm from '../components/PieceForm'
import PieceDetail from '../components/PieceDetail'
import BatchAdd from '../components/BatchAdd'

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
]

export default function PieceInventory({ onSendToStylist }) {
  const [pieces, setPieces]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [filterCat, setFilterCat]     = useState('')
  const [filterOcc, setFilterOcc]     = useState('')
  const [favOnly, setFavOnly]         = useState(false)
  const [showForm, setShowForm]       = useState(false)
  const [showBatch, setShowBatch]     = useState(false)
  const [editPiece, setEditPiece]     = useState(null)
  const [detailPiece, setDetailPiece] = useState(null)

  const fetchPieces = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterCat) params.set('category', filterCat)
    if (filterOcc) params.set('occasion', filterOcc)
    if (search)    params.set('search', search)
    if (favOnly)   params.set('favorites', 'true')
    const res  = await fetch(`/api/pieces?${params}`)
    setPieces(await res.json())
    setLoading(false)
  }, [filterCat, filterOcc, search, favOnly])

  useEffect(() => { fetchPieces() }, [fetchPieces])
  useEffect(() => { const t = setTimeout(fetchPieces, 300); return () => clearTimeout(t) }, [search])

  const handleFavorite = async (piece) => {
    await fetch(`/api/pieces/${piece.id}/favorite`, { method: 'PATCH' })
    fetchPieces()
  }
  const handleSave = () => { setShowForm(false); setEditPiece(null); setDetailPiece(null); fetchPieces() }
  const handleDelete = async (piece) => { await fetch(`/api/pieces/${piece.id}`, { method: 'DELETE' }); setDetailPiece(null); fetchPieces() }
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
              onClick={() => setShowBatch(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              ⊕ Batch
            </button>
          </div>
        </div>

        <div className="search-bar">
          <span className="search-icon">◎</span>
          <input type="search" placeholder="Search pieces…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="filter-row" style={{ marginBottom: 8 }}>
          {CATEGORIES.map(c => (
            <button key={c.value} className={`chip ${filterCat === c.value ? 'active' : ''}`} onClick={() => setFilterCat(c.value)}>{c.label}</button>
          ))}
        </div>

        <div className="filter-row">
          {OCCASIONS.map(o => (
            <button key={o.value} className={`chip ${filterOcc === o.value ? 'active' : ''}`} onClick={() => setFilterOcc(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="loading">Loading your wardrobe…</div>
      ) : pieces.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◈</div>
          <div className="empty-state-title">Nothing here yet</div>
          <div className="empty-state-text">
            {search || filterCat || filterOcc ? 'Try adjusting your filters' : 'Tap + to add a piece, or use Batch to add many at once'}
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
    </div>
  )
}
