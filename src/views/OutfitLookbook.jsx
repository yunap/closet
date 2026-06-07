import { useState, useEffect } from 'react'

const OCCASIONS = [
  { value: '',             label: 'All Occasions' },
  { value: 'casual',       label: 'Casual' },
  { value: 'city',         label: 'City' },
  { value: 'evening',      label: 'Evening' },
  { value: 'smart-casual', label: 'Smart Casual' },
  { value: 'outdoor',      label: 'Outdoor' },
  { value: 'home',         label: 'Home' },
]
const SEASONS = [
  { value: '',           label: 'All Seasons' },
  { value: 'warm',       label: '☀️ Warm Climate' },
  { value: 'cool',       label: '❄️ Cool Climate' },
  { value: 'year-round', label: '🔄 Year-Round' },
]
const SORT_OPTIONS = [
  { value: 'newest',       label: 'Newest First' },
  { value: 'oldest',       label: 'Oldest First' },
  { value: 'a-z',          label: 'Alphabetical (A-Z)' },
  { value: 'z-a',          label: 'Alphabetical (Z-A)' },
  { value: 'most-pieces',  label: 'Wardrobe Density (High)' },
  { value: 'least-pieces', label: 'Wardrobe Density (Low)' },
]
const OCCASION_ICONS = {
  casual: '☀', city: '◈', evening: '◇', 'smart-casual': '✦', outdoor: '◎', home: '○'
}
const COLOR_BG = {
  'black': '#2A2420', 'white': '#F0EDE8', 'navy': '#1E2D4A', 'cream': '#E8DFC8',
  'grey': '#8A8A8A', 'brown': '#7A5A3A', 'tan': '#C0A070', 'oatmeal': '#D8C8B0',
  'plum': '#5A3060', 'olive': '#5A6030', 'green': '#3A6A3A', 'orange': '#C86030',
  'red': '#A83A2A', 'mustard': '#B89020', 'charcoal': '#404040', 'amber': '#B07820',
  'mauve': '#A7798A', 'lavender': '#A99AC2', 'lilac': '#C4B2D8',
  'turquoise': '#2A8080', 'light blue': '#7AADCC', 'periwinkle': '#8888CC', 'multi': '#8A6848', 'dark blue': '#1A2040',
  'dark grey': '#484848', 'light grey': '#B0B0B0', 'pink': '#C07080',
}

// ── Piece Selector Modal ───────────────────────────────────────────────────────
function PieceSelector({ outfitId, linkedPieceIds, onSave, onCancel }) {
  const [allPieces, setAllPieces] = useState([])
  const [selected, setSelected]   = useState(new Set(linkedPieceIds))
  const [search, setSearch]       = useState('')
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    fetch('/api/pieces').then(r => r.json()).then(setAllPieces)
  }, [])

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const filtered = allPieces.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleSave = async () => {
    setSaving(true)
    await fetch(`/api/outfits/${outfitId}/pieces`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pieceIds: [...selected] })
    })
    onSave([...selected])
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={onCancel} style={{ zIndex: 300 }}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '88dvh' }}>
        <div className="modal-handle" />
        <div className="modal-header">
          <span className="modal-title">Link pieces</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-light)' }}>
          <div className="search-bar" style={{ marginBottom: 0 }}>
            <span className="search-icon">◎</span>
            <input
              type="search"
              placeholder="Search pieces…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.map(piece => {
            const isSelected = selected.has(piece.id)
            const bg = piece.colors[0] ? (COLOR_BG[piece.colors[0].toLowerCase()] || '#9A8A78') : '#9A8A78'
            return (
              <div
                key={piece.id}
                onClick={() => toggle(piece.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 20px', cursor: 'pointer',
                  background: isSelected ? 'var(--accent-light)' : 'transparent',
                  borderBottom: '1px solid var(--border-light)',
                  transition: 'background 0.15s',
                }}
              >
                {/* Tiny photo or color swatch */}
                <div style={{ width: 40, height: 52, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: bg }}>
                  {piece.photo && (
                    <img src={`/uploads/${piece.photo}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{piece.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {piece.category} · {piece.colors.slice(0,2).join('/')}
                  </div>
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  color: '#fff', fontSize: 11,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}>
                  {isSelected && '✓'}
                </div>
              </div>
            )
          })}
        </div>

        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : `Save ${selected.size} ${selected.size === 1 ? 'piece' : 'pieces'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Extracted piece row (for scan flow) ───────────────────────────────────────
function ExtractedPieceRow({ piece, checked, onChange }) {
  const [name, setName] = useState(piece.name_suggestion || '')
  useEffect(() => { onChange({ ...piece, name_suggestion: name }) }, [name])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
      <button
        onClick={() => onChange(null, !checked)}
        style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
          background: checked ? 'var(--accent)' : 'transparent',
          color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
        }}
      >{checked && '✓'}</button>
      <input
        value={name} onChange={e => setName(e.target.value)} disabled={!checked}
        style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, color: checked ? 'var(--text)' : 'var(--text-light)', outline: 'none', fontFamily: 'var(--font-sans)' }}
        placeholder="Name this piece…"
      />
      <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 10, flexShrink: 0, textTransform: 'capitalize' }}>
        {piece.category}
      </span>
    </div>
  )
}

// ── Outfit Form ────────────────────────────────────────────────────────────────
function OutfitForm({ onSave, onCancel }) {
  const [name, setName]           = useState('')
  const [occasion, setOccasion]   = useState('casual')
  const [season, setSeason]       = useState('year-round')
  const [notes, setNotes]         = useState('')
  const [status, setStatus]       = useState('confirmed')
  const [photoFile, setPhotoFile] = useState(null)
  const [preview, setPreview]     = useState(null)
  const [scanning, setScanning]   = useState(false)
  const [extracted, setExtracted] = useState([])
  const [selected, setSelected]   = useState([])
  const [scanError, setScanError] = useState(null)
  const [saving, setSaving]       = useState(false)

  const handlePhoto = (e) => {
    const f = e.target.files[0]; if (!f) return
    setPhotoFile(f); setPreview(URL.createObjectURL(f))
    setExtracted([]); setSelected([]); setScanError(null)
  }

  const handleScan = async () => {
    if (!photoFile) return
    setScanning(true); setScanError(null)
    try {
      const fd = new FormData(); fd.append('photo', photoFile)
      const res  = await fetch('/api/ai/extract-pieces', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setExtracted(data.pieces || [])
      setSelected((data.pieces || []).map(() => true))
    } catch { setScanError('Scan failed — add pieces manually later') }
    finally { setScanning(false) }
  }

  const updatePiece = (index, updated, checkedOverride) => {
    if (updated !== null) setExtracted(prev => prev.map((p, i) => i === index ? { ...p, ...updated } : p))
    if (checkedOverride !== undefined) setSelected(prev => prev.map((c, i) => i === index ? checkedOverride : c))
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const pieceIds = []
      for (const piece of extracted.filter((_, i) => selected[i])) {
        const fd = new FormData()
        fd.append('name', piece.name_suggestion || piece.category)
        fd.append('category', piece.category || 'top')
        fd.append('colors', JSON.stringify(piece.colors || []))
        fd.append('occasions', JSON.stringify(piece.occasions || []))
        fd.append('season', piece.season || 'year-round')
        fd.append('notes', piece.notes_suggestion || '')
        fd.append('status', 'active')

        // Include extracted visual attributes
        ;[
          'background_color', 'pattern_type', 'pattern_scale', 'pattern_complexity',
          'reads_as', 'hem_finish', 'neckline', 'sleeve_type', 'length_hits_at',
          'silhouette', 'fabric_category', 'fabric_weight'
        ].forEach(key => {
          if (piece[key] !== undefined && piece[key] !== null) {
            fd.append(key, piece[key])
          }
        })
        if (piece.style_profile_json) {
          fd.append('style_profile_json', JSON.stringify(piece.style_profile_json))
        }

        const res = await fetch('/api/pieces', { method: 'POST', body: fd })
        pieceIds.push((await res.json()).id)
      }
      const fd = new FormData()
      fd.append('name', name); fd.append('occasion', occasion)
      fd.append('season', season); fd.append('notes', notes)
      fd.append('status', status); fd.append('pieceIds', JSON.stringify(pieceIds))
      if (photoFile) fd.append('photo', photoFile)
      const res = await fetch('/api/outfits', { method: 'POST', body: fd })
      onSave(await res.json(), pieceIds.length)
    } finally { setSaving(false) }
  }

  const selectedCount = selected.filter(Boolean).length

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <span className="modal-title">Add outfit</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="form-body">
          {preview ? (
            <div className="photo-preview">
              <img src={preview} alt="preview" style={{ maxHeight: 280 }} />
              <button className="photo-preview-remove" onClick={() => { setPhotoFile(null); setPreview(null); setExtracted([]); setSelected([]) }}>✕</button>
            </div>
          ) : (
            <label className="photo-upload">
              <input type="file" accept="image/*" onChange={handlePhoto} />
              <div className="photo-upload-icon">📷</div>
              <div className="photo-upload-text">Add outfit photo</div>
              <div className="photo-upload-hint">A full-length photo works best</div>
            </label>
          )}

          {photoFile && (
            <div>
              <button onClick={handleScan} disabled={scanning} style={{
                width: '100%', padding: '11px',
                background: scanning ? 'var(--surface-2)' : 'var(--accent-light)',
                color: 'var(--accent)', border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                cursor: scanning ? 'default' : 'pointer', transition: 'all 0.15s',
              }}>
                {scanning ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Scanning…</>
                  : extracted.length > 0 ? `◇ Rescan (${selectedCount} of ${extracted.length} selected)` : '◇ Scan for pieces in this photo'}
              </button>
              {scanError && <div style={{ fontSize: 11, color: 'var(--repair)', marginTop: 4 }}>{scanError}</div>}
            </div>
          )}

          {extracted.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label">Found in photo — add to wardrobe</label>
                <button style={{ fontSize: 11, color: 'var(--accent)' }} onClick={() => setSelected(extracted.map(() => !selected.every(Boolean)))}>
                  {selected.every(Boolean) ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', padding: '0 12px', border: '1px solid var(--border-light)' }}>
                {extracted.map((piece, i) => (
                  <ExtractedPieceRow key={i} piece={piece} checked={selected[i]} onChange={(u, c) => updatePiece(i, u, c)} />
                ))}
              </div>
              {selectedCount > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
                  {selectedCount} {selectedCount === 1 ? 'piece' : 'pieces'} will be added and linked
                </div>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Outfit name</label>
            <input className="form-input" placeholder="e.g. Weekend market look" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Occasion</label>
            <div className="chip-grid">
              {OCCASIONS.filter(o => o.value).map(o => (
                <button key={o.value} className={`chip-toggle ${occasion === o.value ? 'active' : ''}`} onClick={() => setOccasion(o.value)}>{o.label}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Season</label>
            <div className="radio-row">
              {['warm','cool','year-round'].map(s => <button key={s} className={`radio-btn ${season === s ? 'active' : ''}`} onClick={() => setSeason(s)}>{s}</button>)}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <div className="chip-grid">
              {['confirmed','trying','archived'].map(s => <button key={s} className={`chip-toggle ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)} style={{ textTransform: 'capitalize' }}>{s}</button>)}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Styling notes</label>
            <textarea className="form-textarea" placeholder="e.g. Works best with the amber pendant…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : selectedCount > 0 ? `Save outfit + ${selectedCount} pieces` : 'Save outfit'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Outfit Detail ──────────────────────────────────────────────────────────────
function OutfitDetail({ outfit, onClose, onDelete, onSendToStylist, onPiecesUpdated }) {
  const [pieces, setPieces]           = useState(outfit.pieces || [])
  const [showSelector, setShowSelector] = useState(false)

  const handleDelete = () => {
    if (confirm(`Delete "${outfit.name}"?`)) onDelete(outfit)
  }

  const handlePiecesSaved = async (selectedIds) => {
    setShowSelector(false)
    // Refresh pieces list
    const res  = await fetch(`/api/outfits`)
    const data = await res.json()
    const updated = data.find(o => o.id === outfit.id)
    if (updated) { setPieces(updated.pieces || []); onPiecesUpdated?.() }
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-sheet" onClick={e => e.stopPropagation()}>
          <div className="modal-handle" />
          {outfit.photo
            ? <img className="detail-photo" src={`/uploads/${outfit.photo}`} alt={outfit.name} />
            : <div className="outfit-placeholder" style={{ height: 260, aspectRatio: 'auto', borderRadius: 0 }}>{OCCASION_ICONS[outfit.occasion] || '✦'}</div>
          }
          <div className="detail-body">
            <div className="detail-title">{outfit.name}</div>
            <div className="detail-category" style={{ textTransform: 'capitalize' }}>{outfit.occasion} · {outfit.season}</div>
            <div className="detail-tags">
              <span className="detail-tag" style={{ textTransform: 'capitalize' }}>{outfit.status}</span>
              {outfit.favorite && <span className="detail-tag" style={{ color: 'var(--accent)' }}>♥ Favorite</span>}
            </div>
            {outfit.notes && <div className="detail-notes">{outfit.notes}</div>}

            {/* Pieces section */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div className="form-label">
                  {pieces.length > 0 ? `${pieces.length} linked ${pieces.length === 1 ? 'piece' : 'pieces'}` : 'No pieces linked'}
                </div>
                <button
                  onClick={() => setShowSelector(true)}
                  style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}
                >
                  {pieces.length > 0 ? 'Edit pieces' : '+ Link pieces'}
                </button>
              </div>

              {pieces.length > 0 && (
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                  {pieces.map(p => {
                    const bg = p.colors?.[0] ? (COLOR_BG[p.colors[0].toLowerCase()] || '#9A8A78') : '#9A8A78'
                    return (
                      <div key={p.id} style={{ flexShrink: 0, width: 64 }}>
                        <div style={{ width: 64, height: 84, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-light)', background: bg }}>
                          {p.photo
                            ? <img src={`/uploads/${p.photo}`} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-serif)', fontSize: 22, fontStyle: 'italic', opacity: 0.5, color: 'rgba(255,255,255,0.9)' }}>{p.name.charAt(0)}</div>
                          }
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3, textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          {p.name}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 8 }}>
              <button onClick={() => onSendToStylist({
                ...outfit,
                autoSend: true,
                stylistPrompt: 'Evaluate this outfit. Tell me whether the pieces work together, what feels risky, and what I should change first.'
              })} style={{
                padding: '12px', background: 'var(--accent)', color: '#fff',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)',
                fontSize: 13, fontWeight: 500,
              }}>
                Critique outfit
              </button>
              <button onClick={() => onSendToStylist({
                ...outfit,
                autoSend: true,
                imageGenerationMode: true,
                variantMode: 'similar',
                stylistPrompt: 'Generate similar variants from this saved outfit photo and linked garment references.'
              })} style={{
                padding: '12px', background: 'var(--surface)', color: 'var(--accent)',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)',
                fontSize: 13, fontWeight: 500,
              }}>
                Similar variants
              </button>
              <button onClick={() => onSendToStylist({
                ...outfit,
                autoSend: true,
                imageGenerationMode: true,
                variantMode: 'creative',
                stylistPrompt: 'Generate creative alternatives from this saved outfit photo and linked garment references.'
              })} style={{
                padding: '12px', background: 'var(--surface)', color: 'var(--accent)',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)',
                fontSize: 13, fontWeight: 500,
              }}>
                Creative alternatives
              </button>
            </div>

            <button onClick={() => onSendToStylist(outfit)} style={{
              width: '100%', padding: '11px', marginBottom: 10,
              background: 'var(--accent-light)', color: 'var(--accent)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              ◇ Ask a custom question
            </button>

            <div className="detail-actions">
              <button className="btn-danger" onClick={handleDelete}>Delete</button>
              <button className="btn-secondary" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>

      {showSelector && (
        <PieceSelector
          outfitId={outfit.id}
          linkedPieceIds={pieces.map(p => p.id)}
          onSave={handlePiecesSaved}
          onCancel={() => setShowSelector(false)}
        />
      )}
    </>
  )
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t) }, [])
  return (
    <div style={{
      position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--text)', color: '#fff', padding: '10px 20px',
      borderRadius: 24, fontSize: 13, fontWeight: 500, zIndex: 400,
      boxShadow: 'var(--shadow-lg)', whiteSpace: 'nowrap',
    }}>{message}</div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function OutfitLookbook({ onSendToStylist }) {
  const [outfits, setOutfits]           = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [filterOcc, setFilterOcc]       = useState('')
  const [filterSeason, setFilterSeason] = useState('')
  const [sortBy, setSortBy]             = useState('newest')
  const [pinFavs, setPinFavs]           = useState(true)
  const [isSortOpen, setIsSortOpen]     = useState(false)
  
  const [showForm, setShowForm]         = useState(false)
  const [detail, setDetail]             = useState(null)
  const [toast, setToast]               = useState(null)

  const fetchOutfits = async () => {
    setLoading(true)
    const res = await fetch('/api/outfits')
    setOutfits(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    fetchOutfits()
  }, [])

  const handleFav = async (outfit) => {
    await fetch(`/api/outfits/${outfit.id}/favorite`, { method: 'PATCH' })
    fetchOutfits()
  }

  const handleDelete = async (outfit) => {
    await fetch(`/api/outfits/${outfit.id}`, { method: 'DELETE' })
    setDetail(null)
    fetchOutfits()
  }

  const handleSave = (outfit, piecesAdded) => {
    setShowForm(false)
    fetchOutfits()
    if (piecesAdded > 0) {
      setToast(`Outfit saved · ${piecesAdded} ${piecesAdded === 1 ? 'piece' : 'pieces'} added to wardrobe`)
    }
  }

  // Client-side filtering & sorting logic (Zero Latency)
  const filteredAndSorted = outfits.filter(o => {
    // 1. Occasion Filter
    if (filterOcc && o.occasion !== filterOcc) return false

    // 2. Climate / Season Filter
    if (filterSeason) {
      if (filterSeason === 'year-round') {
        if (o.season !== 'year-round') return false
      } else {
        // 'warm' or 'cool' matches exact season OR 'year-round'
        if (o.season !== filterSeason && o.season !== 'year-round') return false
      }
    }

    // 3. Garment-Aware Search
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      const matchName = o.name?.toLowerCase().includes(q)
      const matchNotes = o.notes?.toLowerCase().includes(q)
      
      const matchPieces = o.pieces?.some(p => {
        const matchPieceName = p.name?.toLowerCase().includes(q)
        const matchPieceCat = p.category?.toLowerCase().includes(q)
        const matchPieceColors = p.colors?.some(c => c.toLowerCase().includes(q))
        const matchPieceFab = p.fabric_category?.toLowerCase().includes(q)
        return matchPieceName || matchPieceCat || matchPieceColors || matchPieceFab
      })

      if (!matchName && !matchNotes && !matchPieces) return false
    }

    return true
  }).sort((a, b) => {
    // 1. Favorites Pinned (highest priority if enabled)
    if (pinFavs) {
      if (a.favorite && !b.favorite) return -1
      if (!a.favorite && b.favorite) return 1
    }

    // 2. Chosen sort key
    if (sortBy === 'newest') {
      return new Date(b.date_added || 0) - new Date(a.date_added || 0)
    }
    if (sortBy === 'oldest') {
      return new Date(a.date_added || 0) - new Date(b.date_added || 0)
    }
    if (sortBy === 'a-z') {
      return (a.name || '').localeCompare(b.name || '')
    }
    if (sortBy === 'z-a') {
      return (b.name || '').localeCompare(a.name || '')
    }
    if (sortBy === 'most-pieces') {
      return (b.pieces?.length || 0) - (a.pieces?.length || 0)
    }
    if (sortBy === 'least-pieces') {
      return (a.pieces?.length || 0) - (b.pieces?.length || 0)
    }
    return 0
  })

  return (
    <div>
      <div className="view-header sticky-header">
        <div className="view-header-top">
          <div>
            <div className="view-title">Lookbook</div>
            <div className="view-subtitle">
              {filteredAndSorted.length === outfits.length
                ? `${outfits.length} outfits`
                : `${filteredAndSorted.length} of ${outfits.length} outfits`}
            </div>
          </div>
          <button 
            className={`chip fav-pin-btn ${pinFavs ? 'active' : ''}`} 
            onClick={() => setPinFavs(f => !f)}
          >
            {pinFavs ? '♥ Pinned' : '♡ Pin Favs'}
          </button>
        </div>

        {/* Search and Sort row */}
        <div className="search-sort-row">
          <div className="search-bar search-bar-lookbook">
            <span className="search-icon">◎</span>
            <input 
              type="search" 
              placeholder="Search outfits, garments, colors…" 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>

          <div className="custom-select-container">
            <button 
              className={`custom-select-btn ${isSortOpen ? 'active' : ''}`} 
              onClick={(e) => { e.stopPropagation(); setIsSortOpen(!isSortOpen); }}
            >
              <span>⇅ {SORT_OPTIONS.find(o => o.value === sortBy)?.label}</span>
              <span className="custom-select-arrow">▾</span>
            </button>
            {isSortOpen && (
              <>
                <div className="custom-select-backdrop" onClick={() => setIsSortOpen(false)} />
                <div className="custom-select-dropdown">
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`custom-select-option ${sortBy === opt.value ? 'active' : ''}`}
                      onClick={() => {
                        setSortBy(opt.value)
                        setIsSortOpen(false)
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Double-row filters */}
        <div className="filter-row occ-filter-row" style={{ marginBottom: 8 }}>
          {OCCASIONS.map(o => (
            <button 
              key={o.value} 
              className={`chip ${filterOcc === o.value ? 'active' : ''}`} 
              onClick={() => setFilterOcc(o.value)}
            >
              {o.value && (OCCASION_ICONS[o.value] || '✦')} {o.label}
            </button>
          ))}
        </div>

        <div className="filter-row season-filter-row">
          {SEASONS.map(s => (
            <button 
              key={s.value} 
              className={`chip ${filterSeason === s.value ? 'active' : ''}`} 
              onClick={() => setFilterSeason(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="loading">Loading outfits…</div>
        : filteredAndSorted.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✦</div>
            <div className="empty-state-title">No outfits found</div>
            <div className="empty-state-text">Try adjusting your filters or search terms</div>
          </div>
        ) : (
          <div className="outfit-grid animate-grid">
            {filteredAndSorted.map(o => (
              <div key={o.id} className="outfit-card" style={{ position: 'relative' }} onClick={() => setDetail(o)}>
                {o.photo
                  ? <img className="outfit-photo" src={`/uploads/${o.photo}`} alt={o.name} loading="lazy" />
                  : <div className="outfit-placeholder">{OCCASION_ICONS[o.occasion] || '✦'}</div>
                }
                <button
                  className="outfit-card-action btn-critique"
                  onClick={e => {
                    e.stopPropagation()
                    onSendToStylist({
                      ...o,
                      autoSend: true,
                      stylistPrompt: 'Evaluate this outfit. Tell me whether the pieces work together, what feels risky, and what I should change first.'
                    })
                  }}
                >
                  Critique
                </button>
                <button
                  className="outfit-card-action btn-variant btn-similar"
                  onClick={e => {
                    e.stopPropagation()
                    onSendToStylist({
                      ...o,
                      autoSend: true,
                      imageGenerationMode: true,
                      variantMode: 'similar',
                      stylistPrompt: 'Generate similar variants from this saved outfit photo and linked garment references.'
                    })
                  }}
                >
                  Similar
                </button>
                <button
                  className="outfit-card-action btn-variant btn-creative"
                  onClick={e => {
                    e.stopPropagation()
                    onSendToStylist({
                      ...o,
                      autoSend: true,
                      imageGenerationMode: true,
                      variantMode: 'creative',
                      stylistPrompt: 'Generate creative alternatives from this saved outfit photo and linked garment references.'
                    })
                  }}
                >
                  Creative
                </button>
                <button
                  className="outfit-card-fav"
                  onClick={e => { e.stopPropagation(); handleFav(o) }}
                >
                                  {o.favorite ? '♥' : '♡'}
                </button>
                <div className="outfit-card-body">
                  <div className="outfit-card-name">{o.name}</div>
                  <div className="outfit-card-occasion">
                    {o.occasion}
                    {o.pieces?.length > 0 && ` · ${o.pieces.length} ${o.pieces.length === 1 ? 'piece' : 'pieces'}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      }

      <button className="fab" onClick={() => setShowForm(true)}>+</button>
      {showForm && <OutfitForm onSave={handleSave} onCancel={() => setShowForm(false)} />}
      {detail && (
        <OutfitDetail
          outfit={detail}
          onClose={() => setDetail(null)}
          onDelete={handleDelete}
          onSendToStylist={outfit => { setDetail(null); onSendToStylist(outfit) }}
          onPiecesUpdated={fetchOutfits}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
