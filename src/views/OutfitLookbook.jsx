import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { getColorSwatch, sortColorNames } from '../utils/colors'
import { uploadThumbnailSrc } from '../utils/uploadThumbnails.js'

const OCCASIONS = [
  { value: '',             label: 'All Occasions' },
  { value: 'casual',       label: 'Casual' },
  { value: 'city',         label: 'City' },
  { value: 'evening',      label: 'Evening' },
  { value: 'smart-casual', label: 'Smart Casual' },
  { value: 'outdoor',      label: 'Outdoor' },
  { value: 'home',         label: 'Home' },
  { value: 'walking',      label: 'Walking' },
]
const SEASONS = [
  { value: '',           label: 'All Seasons' },
  { value: 'warm',       label: '☀️ Warm Climate' },
  { value: 'cool',       label: '❄️ Cool Climate' },
  { value: 'year-round', label: '🔄 Year-Round' },
  { value: 'indoor',     label: '🏠 Indoor / Any Weather' },
]
const OUTFIT_SEASONS = [
  { value: 'warm',       label: 'warm' },
  { value: 'cool',       label: 'cool' },
  { value: 'year-round', label: 'year-round' },
  // Indoor is intentionally preserved as an outfit season/environment value for existing saved outfits.
  { value: 'indoor',     label: 'indoor' },
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
  casual: '☀', city: '◈', evening: '◇', 'smart-casual': '✦', outdoor: '◎', home: '○', walking: '👣'
}

const markOutfitImageOrientation = (event) => {
  const image = event.currentTarget
  image.classList.toggle('is-landscape', image.naturalWidth > image.naturalHeight * 1.08)
}

const formatGeneratedOutfitType = (value) => String(value || 'AI generated')
  .replace(/_board$/i, '')
  .replaceAll('_', ' ')
const FEEDBACK_LABELS_MAP = {
  signature: 'Signature',
  works: 'Works',
  not_me: 'Not Me',
  too_safe: 'Too Safe',
  too_soft: 'Too Soft',
  too_generic: 'Too Generic',
  wrong_proportions: 'Wrong Proportions',
  wrong_silhouette: 'Wrong Silhouette',
  catalog_drift: 'Catalog Drift',
  weak_structure: 'Weak Structure',
  weak_contrast: 'Weak Contrast',
  bad_grounding: 'Bad Grounding',
}

const resolveUploadImageSrc = (photo) => {
  const value = String(photo || '').trim()
  if (!value) return null
  const dedupedUploads = value.replace(/^\/uploads\/+uploads\//, '/uploads/')
  if (dedupedUploads !== value) return dedupedUploads
  if (/^(https?:\/\/|data:|blob:|\/uploads\/)/i.test(value)) return value
  const uploadsIndex = value.indexOf('/uploads/')
  if (uploadsIndex >= 0) return value.slice(uploadsIndex)
  if (value.startsWith('/generated-boards/')) return `/uploads${value}`
  if (value.startsWith('generated-boards/')) return `/uploads/${value}`
  if (value.startsWith('uploads/')) return `/${value}`
  if (value.startsWith('/')) return value
  return `/uploads/${value}`
}

const resolveUploadThumbnailSrc = (photo, variant) => uploadThumbnailSrc(resolveUploadImageSrc(photo), variant)

// ── Piece Selector Modal ───────────────────────────────────────────────────────
// ── Piece Selector Modal ───────────────────────────────────────────────────────
function PieceSelector({ outfitId, linkedPieceIds, mainPieceId = null, onSave, onCancel, singleSelect = false, initialCategory = '' }) {
  const [allPieces, setAllPieces] = useState([])
  const initialLinkedIds = linkedPieceIds.map(Number).filter(Boolean)
  const initialMainId = Number(mainPieceId) && initialLinkedIds.includes(Number(mainPieceId)) ? Number(mainPieceId) : null
  const [selected, setSelected]   = useState(new Set(initialLinkedIds))
  const [mainId, setMainId]       = useState(initialMainId)
  const [search, setSearch]       = useState('')
  const [filterCat, setFilterCat] = useState(initialCategory)
  const [filterColor, setFilterColor] = useState('')
  const [saving, setSaving]       = useState(false)

  const CATEGORIES = [
    { value: '',          label: 'All' },
    { value: 'top',       label: 'Tops' },
    { value: 'bottom',    label: 'Bottoms' },
    { value: 'dress',     label: 'Dresses' },
    { value: 'outerwear', label: 'Outerwear' },
    { value: 'shoes',     label: 'Shoes' },
    { value: 'accessory', label: 'Accessories' },
  ]

  useEffect(() => {
    fetch('/api/pieces').then(r => r.json()).then(setAllPieces)
  }, [])

  const toggle = (rawId) => setSelected(prev => {
    const id = Number(rawId)
    const next = new Set(prev)
    if (singleSelect) {
      if (next.has(id)) {
        next.clear()
        setMainId(null)
      } else {
        next.clear()
        next.add(id)
      }
    } else {
      if (next.has(id)) {
        next.delete(id)
        if (mainId === id) setMainId(null)
      } else {
        next.add(id)
      }
    }
    return next
  })

  // Colors available in the fetched pieces list
  const availableColors = sortColorNames(Array.from(
    new Set(allPieces.flatMap(p => p.colors || []))
  ).filter(Boolean))

  const filtered = allPieces.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
                          (p.reads_as || '').toLowerCase().includes(search.toLowerCase())
    const matchesCat = !filterCat || (p.category || '').toLowerCase() === filterCat.toLowerCase()
    const matchesColor = !filterColor || (p.colors || []).map(c => c.toLowerCase()).includes(filterColor.toLowerCase())
    return matchesSearch && matchesCat && matchesColor
  })

  const linkedPieces = allPieces.filter(p => selected.has(Number(p.id)))

  const handleSave = async () => {
    const selectedIds = [...selected]
    const nextMainId = selected.has(mainId) ? mainId : null
    if (outfitId) {
      setSaving(true)
      await fetch(`/api/outfits/${outfitId}/pieces`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pieceIds: selectedIds, mainPieceId: nextMainId })
      })
      setSaving(false)
    }
    onSave(selectedIds, nextMainId)
  }

  const getSwatchBg = (p) => {
    if (!p) return '#9A8A78'
    const color = p.colors?.[0] || ''
    return getColorSwatch(color, '#9A8A78')
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 300 }}>
      <div className="modal-sheet outfit-piece-selector" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <span className="modal-title">Link pieces</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        {/* Filters Panel */}
        <div className="outfit-piece-selector-filters">
          <div className="search-bar" style={{ marginBottom: 0 }}>
            <span className="search-icon">◎</span>
            <input
              type="search"
              placeholder="Search pieces…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Categories - Hide if locked to one via singleSelect */}
          {!singleSelect && (
            <div className="filter-row outfit-piece-categories">
              {CATEGORIES.map(c => (
                <button
                  key={c.value}
                  type="button"
                  className={`chip ${filterCat === c.value ? 'active' : ''}`}
                  onClick={() => setFilterCat(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {/* Colors */}
          {availableColors.length > 0 && (
            <div className="outfit-piece-colors" aria-label="Filter pieces by color">
              <button
                type="button"
                className={`outfit-color-filter ${!filterColor ? 'active' : ''}`}
                onClick={() => setFilterColor('')}
              >
                Any color
              </button>
              {availableColors.map(color => {
                const hex = getColorSwatch(color)
                const active = filterColor === color
                return (
                  <button
                    key={color}
                    type="button"
                    className={`outfit-color-filter ${active ? 'active' : ''}`}
                    onClick={() => setFilterColor(active ? '' : color)}
                  >
                    <span className="outfit-color-swatch" style={{ background: hex }} aria-hidden="true" />
                    <span>{color}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Scrollable Grid View */}
        <div className="outfit-piece-selector-body">
          {/* Linked Section */}
          {linkedPieces.length > 0 && (
            <div className="outfit-linked-selection">
              <div className="outfit-selector-section-title">
                Linked Pieces ({linkedPieces.length})
              </div>
              <div className="piece-grid outfit-selector-grid">
                {linkedPieces.map(piece => {
                  const bg = getSwatchBg(piece)
                  const pieceId = Number(piece.id)
                  const isMain = mainId === pieceId
                  return (
                    <div
                      key={piece.id}
                      onClick={() => toggle(pieceId)}
                      className="piece-card"
                      style={{
                        position: 'relative',
                        border: '1.5px solid var(--accent)',
                        boxShadow: '0 0 0 1px var(--accent-light)',
                        cursor: 'pointer'
                      }}
                    >
                      {piece.photo ? (
                        <img src={resolveUploadThumbnailSrc(piece.photo, 'outfit-piece')} className="piece-photo" alt="" loading="lazy" decoding="async" />
                      ) : (
                        <div className="piece-placeholder" style={{ background: bg }}>
                          <span className="piece-placeholder-letter">{piece.name.charAt(0)}</span>
                        </div>
                      )}
                      
                      {/* Selection overlay / indicator */}
                      <div style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: 'var(--accent)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 'bold',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.15)'
                      }}>
                        ✕
                      </div>

                      <div className="piece-card-body" style={{ padding: '8px 8px 10px' }}>
                        <div className="piece-card-name" style={{ fontSize: 11, margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{piece.name}</div>
                        <div className="piece-card-meta" style={{ fontSize: 10, marginTop: 2 }}>{piece.category}</div>
                        {!singleSelect && (
                          <button
                            type="button"
                            onClick={e => {
                              e.preventDefault()
                              e.stopPropagation()
                              setMainId(isMain ? null : pieceId)
                            }}
                            style={{
                              marginTop: 6,
                              padding: '3px 8px',
                              borderRadius: 999,
                              border: `1px solid ${isMain ? 'var(--accent)' : 'var(--border)'}`,
                              background: isMain ? 'var(--accent)' : 'var(--surface)',
                              color: isMain ? '#fff' : 'var(--accent)',
                              fontSize: 10,
                              fontWeight: 700,
                              lineHeight: 1,
                              cursor: 'pointer'
                            }}
                            title={isMain ? 'Main piece for variants' : 'Use as main piece for variants'}
                          >
                            {isMain ? 'Main piece' : 'Make main'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Divider if both sections exist */}
          {linkedPieces.length > 0 && <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '20px 0' }} />}

          {/* All Pieces Section */}
          <div>
            <div className="outfit-selector-section-title">
              All Pieces ({filtered.length})
            </div>
            {filtered.length === 0 ? (
              <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No pieces match the current filters.
              </div>
            ) : (
              <div className="piece-grid outfit-selector-grid">
                {filtered.map(piece => {
                  const isSelected = selected.has(Number(piece.id))
                  const bg = getSwatchBg(piece)
                  return (
                    <div
                      key={piece.id}
                      onClick={() => toggle(piece.id)}
                      className="piece-card"
                      style={{
                        position: 'relative',
                        border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border-light)',
                        boxShadow: isSelected ? '0 0 0 1px var(--accent-light)' : 'none',
                        cursor: 'pointer',
                        opacity: isSelected ? 0.85 : 1
                      }}
                    >
                      {piece.photo ? (
                        <img src={resolveUploadThumbnailSrc(piece.photo, 'outfit-piece')} className="piece-photo" alt="" loading="lazy" decoding="async" />
                      ) : (
                        <div className="piece-placeholder" style={{ background: bg }}>
                          <span className="piece-placeholder-letter">{piece.name.charAt(0)}</span>
                        </div>
                      )}

                      {/* Selection checkbox overlay */}
                      <div style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        border: `1.5px solid ${isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.7)'}`,
                        background: isSelected ? 'var(--accent)' : 'rgba(0,0,0,0.3)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 9,
                        fontWeight: 'bold',
                        backdropFilter: 'blur(2px)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}>
                        {isSelected && '✓'}
                      </div>

                      <div className="piece-card-body" style={{ padding: '8px 8px 10px' }}>
                        <div className="piece-card-name" style={{ fontSize: 11, margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{piece.name}</div>
                        <div className="piece-card-meta" style={{ fontSize: 10, marginTop: 2 }}>{piece.category}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="form-actions outfit-piece-selector-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : singleSelect ? 'Link selected piece' : `Save ${selected.size} ${selected.size === 1 ? 'piece' : 'pieces'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Similarity & Matching Helpers ─────────────────────────────────────────────
function computeTokenSimilarity(str1, str2) {
  if (!str1 || !str2) return 0
  const getTokens = (str) => {
    return str.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1 && !['and', 'with', 'the', 'for', 'in', 'of', 'on', 'at', 'to', 'piece'].includes(w))
  }
  const tokens1 = getTokens(str1)
  const tokens2 = getTokens(str2)
  if (tokens1.length === 0 || tokens2.length === 0) return 0
  const set1 = new Set(tokens1)
  const set2 = new Set(tokens2)
  const intersection = new Set([...set1].filter(x => set2.has(x)))
  const union = new Set([...set1, ...set2])
  return intersection.size / union.size
}

function findBestMatchForExtracted(extractedPiece, wardrobePieces) {
  if (!wardrobePieces || wardrobePieces.length === 0) return { piece: null, confidence: 'none', score: 0 }
  const extCat = (extractedPiece.category || '').toLowerCase()
  const extColors = (extractedPiece.colors || []).map(c => c.toLowerCase())
  const extName = (extractedPiece.name_suggestion || '').toLowerCase()
  const extReadsAs = (extractedPiece.reads_as || '').toLowerCase()

  let bestPiece = null
  let maxScore = -1

  for (const wp of wardrobePieces) {
    if ((wp.category || '').toLowerCase() !== extCat) continue

    // Color overlap check
    const wpColors = (wp.colors || []).map(c => c.toLowerCase())
    const hasColorOverlap = extColors.some(c => wpColors.includes(c))
    
    const sim = Math.max(
      computeTokenSimilarity(extName, wp.name),
      computeTokenSimilarity(extName, wp.reads_as),
      computeTokenSimilarity(extReadsAs, wp.name),
      computeTokenSimilarity(extReadsAs, wp.reads_as)
    )

    let score = sim
    if (hasColorOverlap) {
      score += 0.2
    } else if (extColors.length > 0 && wpColors.length > 0) {
      score -= 0.3
    }

    if (score > maxScore) {
      maxScore = score
      bestPiece = wp
    }
  }

  const confidence = maxScore >= 0.45 ? 'high' : (maxScore >= 0.2 ? 'low' : 'none')
  return { piece: confidence !== 'none' ? bestPiece : null, confidence, score: maxScore }
}

// ── Extracted piece row (for scan flow) ───────────────────────────────────────
function ExtractedPieceRow({ piece, actionState, wardrobePieces, onChange }) {
  const { action, linkedPieceId, bestMatch } = actionState
  const [name, setName] = useState(piece.name_suggestion || '')
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    onChange({ ...piece, name_suggestion: name }, null)
  }, [name])

  const currentLinkedPiece = wardrobePieces.find(wp => wp.id === linkedPieceId) || bestMatch

  const handleActionChange = (newAction) => {
    let newLinkedId = linkedPieceId
    if (newAction === 'link' && !linkedPieceId && bestMatch) {
      newLinkedId = bestMatch.id
    }
    onChange(null, { action: newAction, linkedPieceId: newLinkedId })
  }

  const handleLinkSelect = (id) => {
    const selectedPiece = wardrobePieces.find(wp => wp.id === id)
    onChange(null, { action: 'link', linkedPieceId: id, bestMatch: selectedPiece })
  }

  const getSwatchBg = (p) => {
    if (!p) return '#9A8A78'
    const color = p.colors?.[0] || ''
    return getColorSwatch(color, '#9A8A78')
  }

  const isLinkActive = action === 'link'
  const isCreateActive = action === 'create'
  const isSkipActive = action === 'skip'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: '12px 0',
      borderBottom: '1px solid var(--border-light)',
      opacity: isSkipActive ? 0.5 : 1,
      transition: 'opacity 0.15s'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
              {piece.category.charAt(0).toUpperCase() + piece.category.slice(1)}
            </span>
            {piece.colors && piece.colors.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--surface-3)', padding: '2px 8px', borderRadius: 10 }}>
                {piece.colors.join('/')}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            Reads as: {piece.reads_as || 'unknown'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, background: 'var(--surface-3)', padding: 3, borderRadius: 8 }}>
          <button
            type="button"
            onClick={() => handleActionChange('link')}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 500,
              border: 'none',
              borderRadius: 6,
              background: isLinkActive ? 'var(--accent)' : 'transparent',
              color: isLinkActive ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            Link
          </button>
          <button
            type="button"
            onClick={() => handleActionChange('create')}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 500,
              border: 'none',
              borderRadius: 6,
              background: isCreateActive ? 'var(--accent)' : 'transparent',
              color: isCreateActive ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => handleActionChange('skip')}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 500,
              border: 'none',
              borderRadius: 6,
              background: isSkipActive ? 'var(--accent)' : 'transparent',
              color: isSkipActive ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            Skip
          </button>
        </div>
      </div>

      {isLinkActive && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--surface-3)',
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid var(--border-light)'
        }}>
          <div style={{
            width: 32,
            height: 42,
            borderRadius: 4,
            overflow: 'hidden',
            flexShrink: 0,
            background: getSwatchBg(currentLinkedPiece)
          }}>
            {currentLinkedPiece?.photo && (
              <img
                src={resolveUploadThumbnailSrc(currentLinkedPiece.photo, 'outfit-piece')}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {currentLinkedPiece ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {currentLinkedPiece.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Match confidence: <span style={{ fontWeight: 600, color: actionState.confidence === 'high' ? 'var(--accent)' : 'var(--text-light)' }}>{actionState.confidence}</span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                No matching item found
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              padding: '4px 8px'
            }}
          >
            Change
          </button>
        </div>
      )}

      {isCreateActive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              fontSize: 13,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface-3)',
              color: 'var(--text)',
              fontFamily: 'var(--font-sans)',
              outline: 'none'
            }}
            placeholder="Name this piece..."
          />
        </div>
      )}

      {showPicker && (
        <PieceSelector
          linkedPieceIds={currentLinkedPiece ? [currentLinkedPiece.id] : []}
          singleSelect={true}
          initialCategory={piece.category}
          onSave={(ids) => {
            const id = ids[0]
            if (id) {
              handleLinkSelect(id)
            } else {
              onChange(null, { action: 'link', linkedPieceId: null, bestMatch: null })
            }
            setShowPicker(false)
          }}
          onCancel={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

// ── Outfit Form ────────────────────────────────────────────────────────────────
function OutfitForm({ outfit = null, onSave, onCancel }) {
  const isEdit = Boolean(outfit)
  const [name, setName]           = useState(outfit?.name || '')
  const [occasion, setOccasion]   = useState(outfit?.occasion || 'casual')
  const [season, setSeason]       = useState(outfit?.season || 'year-round')
  const [notes, setNotes]         = useState(outfit?.notes || '')
  const [status, setStatus]       = useState(outfit?.status || 'confirmed')
  const [photoFile, setPhotoFile] = useState(null)
  const [preview, setPreview]     = useState(outfit?.photo ? `/uploads/${outfit.photo}` : null)
  const [scanning, setScanning]   = useState(false)
  const [extracted, setExtracted] = useState([])
  const [extractedActions, setExtractedActions] = useState([])
  const [wardrobePieces, setWardrobePieces] = useState([])
  const [linkedPieceIds]          = useState(() => (outfit?.pieces || []).map(p => p.id))
  const [scanError, setScanError] = useState(null)
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    fetch('/api/pieces')
      .then(r => r.json())
      .then(setWardrobePieces)
      .catch(err => console.error('Error fetching wardrobe pieces:', err))
  }, [])

  const handlePhoto = (e) => {
    const f = e.target.files[0]; if (!f) return
    setPhotoFile(f); setPreview(URL.createObjectURL(f))
    setExtracted([]); setExtractedActions([]); setScanError(null)
  }

  const handleScan = async () => {
    if (!photoFile) return
    setScanning(true); setScanError(null)
    try {
      const fd = new FormData(); fd.append('photo', photoFile)
      const res  = await fetch('/api/ai/extract-pieces', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      
      const pieces = data.pieces || []
      setExtracted(pieces)

      const actions = pieces.map(piece => {
        const { piece: match, confidence } = findBestMatchForExtracted(piece, wardrobePieces)
        if (match && confidence === 'high') {
          return { action: 'link', linkedPieceId: match.id, bestMatch: match, confidence }
        } else {
          return { action: 'create', linkedPieceId: match ? match.id : null, bestMatch: match, confidence }
        }
      })
      setExtractedActions(actions)
    } catch { setScanError('Scan failed — add pieces manually later') }
    finally { setScanning(false) }
  }

  const updatePiece = (index, updatedPieceFields, updatedActionFields) => {
    if (updatedPieceFields) {
      setExtracted(prev => prev.map((p, i) => i === index ? { ...p, ...updatedPieceFields } : p))
    }
    if (updatedActionFields) {
      setExtractedActions(prev => prev.map((a, i) => i === index ? { ...a, ...updatedActionFields } : a))
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const pieceIds = [...linkedPieceIds]
      let piecesAdded = 0
      for (let i = 0; i < extracted.length; i++) {
        const piece = extracted[i]
        const actionState = extractedActions[i] || { action: 'create', linkedPieceId: null }

        if (actionState.action === 'skip') {
          continue
        }

        if (actionState.action === 'link') {
          if (actionState.linkedPieceId) {
            pieceIds.push(actionState.linkedPieceId)
          }
          continue
        }

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
        piecesAdded++
      }
      const fd = new FormData()
      fd.append('name', name); fd.append('occasion', occasion)
      fd.append('season', season); fd.append('notes', notes)
      fd.append('status', status); fd.append('pieceIds', JSON.stringify(pieceIds))
      if (outfit?.main_piece_id && pieceIds.map(Number).includes(Number(outfit.main_piece_id))) {
        fd.append('mainPieceId', String(outfit.main_piece_id))
      }
      if (isEdit) fd.append('favorite', String(Boolean(outfit?.favorite)))
      if (photoFile) fd.append('photo', photoFile)
      const res = await fetch(isEdit ? `/api/outfits/${outfit.id}` : '/api/outfits', {
        method: isEdit ? 'PUT' : 'POST',
        body: fd
      })
      onSave(await res.json(), piecesAdded)
    } finally { setSaving(false) }
  }

  const createCount = extractedActions.filter(a => a.action === 'create').length
  const linkCount = extractedActions.filter(a => a.action === 'link').length
  const skipCount = extractedActions.filter(a => a.action === 'skip').length

  return (
    <div className="modal-overlay">
      <div
        className="modal-sheet outfit-form-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="outfit-form-title"
      >
        <div className="modal-handle outfit-form-handle" />
        <div className="modal-header">
          <span className="modal-title" id="outfit-form-title">{isEdit ? 'Edit outfit' : 'Add outfit'}</span>
          <button className="modal-close" onClick={onCancel} aria-label="Close outfit form">✕</button>
        </div>
        <div className="form-body outfit-form-layout">
          <div className="outfit-form-media-column">
          {preview ? (
            <div className="photo-preview outfit-form-preview">
              <img src={photoFile ? preview : resolveUploadThumbnailSrc(preview, 'lookbook-display')} alt="Outfit preview" decoding="async" />
              <label className="outfit-photo-replace">
                <input type="file" accept="image/*" onChange={handlePhoto} />
                {photoFile ? 'Choose another' : 'Replace photo'}
              </label>
              {photoFile && (
                <button className="photo-preview-remove" onClick={() => { setPhotoFile(null); setPreview(outfit?.photo ? `/uploads/${outfit.photo}` : null); setExtracted([]); setExtractedActions([]) }}>✕</button>
              )}
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
                  : extracted.length > 0 ? `◇ Rescan (${createCount + linkCount} of ${extracted.length} selected)` : '◇ Scan for pieces in this photo'}
              </button>
              {scanError && <div style={{ fontSize: 11, color: 'var(--repair)', marginTop: 4 }}>{scanError}</div>}
            </div>
          )}
          <div className="outfit-form-photo-guidance">
            <span>Photo guidance</span>
            Full-length, evenly lit photos make the outfit easier to recognize later.
          </div>
          </div>

          <div className="outfit-form-fields-column">
          <div className="outfit-form-section-intro">
            <span>{isEdit ? 'Outfit details' : 'Describe the look'}</span>
            {isEdit ? 'Keep the details that make this outfit useful to find again.' : 'Add just enough context to make this look easy to revisit.'}
          </div>

          {extracted.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label">Found in photo — add or link</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ fontSize: 11, color: 'var(--accent)' }} onClick={() => setExtractedActions(extracted.map(p => {
                    const { piece: match, confidence } = findBestMatchForExtracted(p, wardrobePieces)
                    return { action: match ? 'link' : 'create', linkedPieceId: match ? match.id : null, bestMatch: match, confidence }
                  }))}>
                    Reset matches
                  </button>
                  <button style={{ fontSize: 11, color: 'var(--accent)' }} onClick={() => setExtractedActions(extractedActions.map(a => ({ ...a, action: 'skip' })))}>
                    Skip all
                  </button>
                </div>
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', padding: '0 12px', border: '1px solid var(--border-light)' }}>
                {extracted.map((piece, i) => (
                  <ExtractedPieceRow
                    key={i}
                    piece={piece}
                    actionState={extractedActions[i] || { action: 'create', linkedPieceId: null, bestMatch: null, confidence: 'none' }}
                    wardrobePieces={wardrobePieces}
                    onChange={(uPiece, uAction) => updatePiece(i, uPiece, uAction)}
                  />
                ))}
              </div>
              {(createCount > 0 || linkCount > 0) && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
                  {createCount > 0 && `${createCount} new ${createCount === 1 ? 'piece' : 'pieces'} will be created`}
                  {createCount > 0 && linkCount > 0 && ' and '}
                  {linkCount > 0 && `${linkCount} ${linkCount === 1 ? 'piece' : 'pieces'} will be linked`}
                </div>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Outfit name</label>
            <input className="form-input" placeholder="e.g. Weekend market look" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <div className="form-field-heading">
              <label className="form-label">Occasion</label>
            </div>
            <div className="chip-grid">
              {OCCASIONS.filter(o => o.value).map(o => (
                <button key={o.value} className={`chip-toggle ${occasion === o.value ? 'active' : ''}`} onClick={() => setOccasion(o.value)}>{o.label}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <div className="form-field-heading">
              <label className="form-label">Season</label>
            </div>
            <div className="radio-row">
              {OUTFIT_SEASONS.map(s => (
                <button key={s.value} className={`radio-btn ${season === s.value ? 'active' : ''}`} onClick={() => setSeason(s.value)}>{s.label}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <div className="form-field-heading">
              <label className="form-label">Status</label>
            </div>
            <div className="chip-grid">
              {['confirmed','trying','archived'].map(s => <button key={s} className={`chip-toggle ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)} style={{ textTransform: 'capitalize' }}>{s}</button>)}
            </div>
          </div>
          <div className="form-group">
            <div className="form-field-heading">
              <label className="form-label">Styling notes</label>
              <span className="form-helper">Optional</span>
            </div>
            <textarea className="form-textarea" placeholder="e.g. Works best with the amber pendant…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : createCount > 0 ? `Save outfit + ${createCount} new pieces` : 'Save outfit'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Outfit Detail ──────────────────────────────────────────────────────────────
function OutfitDetail({ outfit, onClose, onEdit, onDelete, onSendToStylist, onPiecesUpdated }) {
  const [pieces, setPieces]           = useState(outfit.pieces || [])
  const [mainPieceId, setMainPieceId] = useState(outfit.main_piece_id || null)
  const [showSelector, setShowSelector] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [isMoreOpen, setIsMoreOpen] = useState(false)

  const handleDelete = () => {
    if (confirm(`Delete "${outfit.name}"?`)) onDelete(outfit)
  }

  const handlePiecesSaved = async (selectedIds, nextMainPieceId = null) => {
    setShowSelector(false)
    // Refresh pieces list
    const res  = await fetch(`/api/outfits`)
    const data = await res.json()
    const updated = data.find(o => o.id === outfit.id)
    if (updated) {
      setPieces(updated.pieces || [])
      setMainPieceId(updated.main_piece_id || nextMainPieceId || null)
      onPiecesUpdated?.()
    }
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-sheet outfit-detail-sheet" onClick={e => e.stopPropagation()}>
          <div className="modal-handle" />
          <button
            type="button"
            className="outfit-detail-close"
            onClick={onClose}
            aria-label="Close outfit details"
          >
            ✕
          </button>
          <div className="outfit-detail-layout">
          <div className="outfit-detail-visual">
          {outfit.photo ? (
            <button
              type="button"
              className="detail-photo-button"
              onClick={() => setPreviewImage({
                src: `/uploads/${outfit.photo}`,
                title: outfit.name || 'Outfit',
                meta: `${outfit.occasion} · ${outfit.season}`
              })}
              aria-label={`Open larger photo for ${outfit.name}`}
            >
              <img className="detail-photo" src={resolveUploadThumbnailSrc(outfit.photo, 'lookbook-display')} alt={outfit.name} decoding="async" />
            </button>
          ) : (
            <div className="outfit-placeholder outfit-detail-placeholder">{OCCASION_ICONS[outfit.occasion] || '✦'}</div>
          )}
          <span className="outfit-photo-hint">Open full photo</span>
          </div>
          <div className="detail-body outfit-detail-body">
            <section className="outfit-detail-section outfit-identity-section" aria-label="Outfit identity">
              <div className="outfit-identity-header">
                <div>
                  <div className="detail-title">{outfit.name}</div>
                  <div className="detail-category" style={{ textTransform: 'capitalize' }}>{outfit.occasion} · {outfit.season}</div>
                </div>
                <div className="outfit-overflow">
                  <button
                    type="button"
                    className="outfit-overflow-btn"
                    onClick={() => setIsMoreOpen(open => !open)}
                    aria-haspopup="menu"
                    aria-expanded={isMoreOpen}
                    aria-label="More outfit actions"
                  >
                    ⋯
                  </button>
                  {isMoreOpen && (
                    <div className="outfit-overflow-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsMoreOpen(false)
                          onEdit({ ...outfit, pieces, main_piece_id: mainPieceId })
                        }}
                      >
                        Edit outfit
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                          setIsMoreOpen(false)
                          handleDelete()
                        }}
                      >
                        Delete outfit
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="detail-tags outfit-status-tags">
                <span className="detail-tag" style={{ textTransform: 'capitalize' }}>{outfit.status}</span>
                {outfit.favorite && <span className="detail-tag" style={{ color: 'var(--accent)' }}>♥ Favorite</span>}
              </div>
              {outfit.notes && <div className="detail-notes">{outfit.notes}</div>}
            </section>

            <section className="outfit-detail-section outfit-composition-section" aria-label="Outfit composition">
              <div className="outfit-section-header">
                <div className="form-label">
                  {pieces.length > 0 ? `${pieces.length} linked ${pieces.length === 1 ? 'piece' : 'pieces'}` : 'No pieces linked'}
                </div>
                <button
                  type="button"
                  className="outfit-text-action"
                  onClick={() => setShowSelector(true)}
                >
                  {pieces.length > 0 ? 'Edit pieces' : '+ Link pieces'}
                </button>
              </div>

              {pieces.length > 0 && (
                <div className="outfit-linked-pieces">
                  {pieces.map(p => {
                    const bg = getColorSwatch(p.colors?.[0], '#9A8A78')
                    return (
                      <div key={p.id} className="outfit-linked-piece">
                        <button
                          type="button"
                          disabled={!p.photo}
                          onClick={() => p.photo && setPreviewImage({
                            src: `/uploads/${p.photo}`,
                            title: p.name || 'Garment',
                            meta: p.category || ''
                          })}
                          className="outfit-linked-piece-photo"
                          style={{ background: bg }}
                          aria-label={p.photo ? `Open preview for ${p.name}` : p.name}
                        >
                          {p.photo
                            ? <img src={resolveUploadThumbnailSrc(p.photo, 'outfit-piece')} alt={p.name} loading="lazy" decoding="async" />
                            : <div className="outfit-linked-piece-initial">{p.name.charAt(0)}</div>
                          }
                        </button>
                        <div className="outfit-linked-piece-name">
                          {p.name}
                        </div>
                        {Number(p.id) === Number(mainPieceId) && (
                          <div className="outfit-linked-piece-role">Main piece</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="outfit-detail-section outfit-styling-actions" aria-label="Styling actions">
              <button
                type="button"
                className="garment-ask-stylist"
                onClick={() => onSendToStylist({ ...outfit, pieces, main_piece_id: mainPieceId })}
              >
                ◇ Ask stylist about this outfit
              </button>
            </section>
          </div>
          </div>
        </div>
      </div>

      {showSelector && (
        <PieceSelector
          outfitId={outfit.id}
          linkedPieceIds={pieces.map(p => p.id)}
          mainPieceId={mainPieceId}
          onSave={handlePiecesSaved}
          onCancel={() => setShowSelector(false)}
        />
      )}

      {previewImage && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="image-preview-overlay"
          onClick={e => {
            e.stopPropagation()
            setPreviewImage(null)
          }}
        >
          <div className="image-preview-dialog" onClick={e => e.stopPropagation()}>
            <div className="image-preview-header">
              <div style={{ minWidth: 0 }}>
                <div className="image-preview-title">{previewImage.title}</div>
                {previewImage.meta && <div className="image-preview-meta">{previewImage.meta}</div>}
              </div>
              <button className="chip" onClick={() => setPreviewImage(null)}>Close</button>
            </div>
            <img className="image-preview-img" src={previewImage.src} alt={previewImage.title} />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ── Board Detail ──────────────────────────────────────────────────────────────
function BoardDetail({ board, onClose, onDelete, onSendToStylist, onGoToThread }) {
  const [previewImage, setPreviewImage] = useState(null)
  const boardImageSrc = resolveUploadImageSrc(board.image_url)

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-sheet board-detail-sheet" onClick={e => e.stopPropagation()}>
          <div className="modal-handle" />
          <button
            type="button"
            className="outfit-detail-close"
            onClick={onClose}
            aria-label="Close generated outfit details"
          >
            ✕
          </button>
          <div className="board-detail-layout">
          <div className="board-detail-visual">
          {boardImageSrc ? (
            <button
              type="button"
              className="detail-photo-button"
              onClick={() => setPreviewImage({
                src: boardImageSrc,
                title: board.title || 'Generated outfit',
                meta: board.context_name || ''
              })}
              aria-label={`Open larger photo for ${board.title}`}
            >
              <img className="detail-photo" src={resolveUploadThumbnailSrc(boardImageSrc, 'lookbook-display')} alt={board.title} decoding="async" />
            </button>
          ) : (
            <div className="outfit-placeholder board-detail-placeholder">✦</div>
          )}
          <span className="outfit-photo-hint">Open full image</span>
          </div>
          <div className="detail-body board-detail-body">
            <section className="board-detail-section board-identity-section" aria-label="Generated outfit identity">
              <div className="detail-title">{board.title}</div>
              {board.context_name && (
                <div className="detail-category board-context">
                  {board.context_name}
                </div>
              )}
              <div className="detail-tags board-status-tags">
                <span className="detail-tag">{formatGeneratedOutfitType(board.board_type)}</span>
                {board.favorite && <span className="detail-tag" style={{ color: 'var(--accent)' }}>♥ Favorite</span>}
              </div>
              {board.reason && (
                <div className="board-story">
                  <div className="board-section-eyebrow">Why this works</div>
                  <div className="board-story-copy">{board.reason}</div>
                </div>
              )}
            </section>

            {board.watch_for && (
              <section className="board-detail-section board-watch-section" aria-label="Things to watch for">
                <div className="board-section-eyebrow">Keep an eye on</div>
                <div className="board-watch-copy">
                  {board.watch_for}
                </div>
              </section>
            )}

            {/* Pieces section */}
            {board.pieces?.length > 0 && (
              <section className="board-detail-section board-pieces-section" aria-label="Garment references">
                <div className="board-section-eyebrow">
                  {board.pieces.length} {board.pieces.length === 1 ? 'garment reference' : 'garment references'}
                </div>
                <div className="board-piece-list">
                  {board.pieces.map((p, idx) => {
                    const bg = getColorSwatch(p.colors?.[0], '#9A8A78')
                    const photoPath = p.photo ? `/uploads/${p.photo}` : null
                    return (
                      <div key={p.id || idx} className="board-piece-card">
                        <button
                          type="button"
                          disabled={!photoPath}
                          onClick={() => photoPath && setPreviewImage({
                            src: photoPath,
                            title: p.name || 'Garment',
                            meta: p.category || ''
                          })}
                          className="board-piece-photo"
                          style={{ background: bg }}
                          aria-label={photoPath ? `Open preview for ${p.name}` : undefined}
                        >
                          {photoPath
                            ? <img src={resolveUploadThumbnailSrc(photoPath, 'outfit-piece')} alt={p.name} loading="lazy" decoding="async" />
                            : <div className="outfit-linked-piece-initial">{(p.name || '').charAt(0)}</div>
                          }
                        </button>
                        <div className="board-piece-name">
                          {p.name}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Missing pieces section */}
            {board.missing_pieces?.length > 0 && (
              <section className="board-detail-section">
                <div className="board-section-eyebrow">Ideal additions</div>
                <div className="board-addition-list">
                  {board.missing_pieces.map((p, idx) => (
                    <span key={idx} className="detail-tag board-addition-tag">
                      + {p}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Stylist feedback tags */}
            {board.payload?.feedback_labels?.length > 0 && (
              <section className="board-detail-section">
                <div className="board-section-eyebrow">Stylist feedback</div>
                <div className="board-feedback-list">
                  {board.payload.feedback_labels.map(lbl => (
                    <span key={lbl} className="detail-tag board-feedback-tag">
                      {FEEDBACK_LABELS_MAP[lbl] || lbl}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="board-detail-section board-actions-section" aria-label="Generated outfit actions">
              <button type="button" onClick={() => onSendToStylist(board)} className="garment-ask-stylist board-stylist-action">
                ◇ Ask stylist about this outfit
              </button>

              <div className="board-utility-actions">
                {board.payload?.threadId && board.payload.threadId !== 'new_chat' && (
                <button
                  type="button"
                  onClick={() => {
                    onClose?.()
                    onGoToThread?.(board.payload.threadId)
                  }}
                  className="board-source-action"
                >
                  View source chat →
                </button>
                )}
                <button className="board-remove-action" onClick={() => {
                if (confirm(`Remove "${board.title || 'this generated outfit'}" from Lookbook?`)) onDelete(board)
              }}>Remove</button>
              </div>
            </section>
          </div>
          </div>
          </div>
        </div>

      {previewImage && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="image-preview-overlay"
          onClick={e => {
            e.stopPropagation()
            setPreviewImage(null)
          }}
        >
          <div className="image-preview-dialog" onClick={e => e.stopPropagation()}>
            <div className="image-preview-header">
              <div style={{ minWidth: 0 }}>
                <div className="image-preview-title">{previewImage.title}</div>
                {previewImage.meta && <div className="image-preview-meta">{previewImage.meta}</div>}
              </div>
              <button className="chip" onClick={() => setPreviewImage(null)}>Close</button>
            </div>
            <img className="image-preview-img" src={previewImage.src} alt={previewImage.title} />
          </div>
        </div>,
        document.body
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
export default function OutfitLookbook({ onSendToStylist, onGoToThread }) {
  const [searchParams, setSearchParams] = useSearchParams()

  // Filter/tab state — URL-backed so state survives tab switches.
  const VALID_VIEWS = ['my-outfits', 'generated-outfits']
  const rawView    = searchParams.get('view')
  const activeSubTab   = VALID_VIEWS.includes(rawView) ? rawView : 'my-outfits'
  const search         = searchParams.get('q')        ?? ''
  const filterOcc      = searchParams.get('occasion') ?? ''
  const filterSeason   = searchParams.get('season')   ?? ''
  const sortBy         = searchParams.get('sort')     ?? 'newest'
  const pinFavs        = searchParams.get('pin') !== '0'  // default true; only written when false

  const setFilter = useCallback((updates) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(updates)) {
        // Omit default values to keep URLs clean
        const isDefault =
          (key === 'view'     && (value === 'my-outfits' || !value)) ||
          (key === 'sort'     && (value === 'newest'     || !value)) ||
          (key === 'q'        && !value) ||
          (key === 'occasion' && !value) ||
          (key === 'season'   && !value)
        if (isDefault) {
          next.delete(key)
        } else if (key === 'pin') {
          // pin only written when explicitly false (default is true)
          if (value === false || value === '0') { next.set('pin', '0') } else { next.delete('pin') }
        } else {
          next.set(key, String(value))
        }
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [outfits, setOutfits]           = useState([])
  const [loading, setLoading]           = useState(true)
  const [isSortOpen, setIsSortOpen]     = useState(false)
  const [openFilterMenu, setOpenFilterMenu] = useState(null)

  const [showForm, setShowForm]         = useState(false)
  const [editOutfit, setEditOutfit]     = useState(null)
  const [detail, setDetail]             = useState(null)
  const outfitCardFocusRef              = useRef(null)
  const [toast, setToast]               = useState(null)

  const [savedBoards, setSavedBoards]   = useState([])
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [boardDetail, setBoardDetail]   = useState(null)

  const fetchOutfits = async () => {
    setLoading(true)
    const res = await fetch('/api/outfits')
    setOutfits(await res.json())
    setLoading(false)
  }

  const fetchSavedBoards = async () => {
    setLoadingBoards(true)
    try {
      const res = await fetch('/api/saved-boards?limit=100&excludeHidden=true')
      const data = await res.json()
      setSavedBoards(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Error fetching saved boards:', err)
    } finally {
      setLoadingBoards(false)
    }
  }

  useEffect(() => {
    fetchOutfits()
    fetchSavedBoards()
  }, [])

  // Deep link from elsewhere in the app (e.g. the Stylist outfit landing) straight
  // into this outfit's detail card. One-shot: the param is consumed and cleared so
  // closing the modal and reloading doesn't reopen it.
  useEffect(() => {
    const outfitId = searchParams.get('outfitId')
    if (!outfitId || !outfits.length) return
    const match = outfits.find(o => String(o.id) === String(outfitId))
    if (match) setDetail(match)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('outfitId')
      if (match) next.delete('view')
      return next
    }, { replace: true })
  }, [outfits, searchParams, setSearchParams])

  const handleFav = async (outfit) => {
    await fetch(`/api/outfits/${outfit.id}/favorite`, { method: 'PATCH' })
    fetchOutfits()
  }

  const handleDelete = async (outfit) => {
    await fetch(`/api/outfits/${outfit.id}`, { method: 'DELETE' })
    setDetail(null)
    fetchOutfits()
  }

  const handleBoardFav = async (board) => {
    await fetch(`/api/saved-boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !board.favorite })
    })
    fetchSavedBoards()
  }

  const handleBoardDelete = async (board) => {
    await fetch(`/api/saved-boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden_from_lookbook: true })
    })
    setBoardDetail(null)
    fetchSavedBoards()
  }

  const handleCardKeyDown = (event, openDetail) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openDetail()
    }
  }

  const openOutfitDetail = (outfit, event) => {
    outfitCardFocusRef.current = event?.currentTarget || null
    setDetail(outfit)
  }

  const closeOutfitDetail = () => {
    setDetail(null)
    requestAnimationFrame(() => outfitCardFocusRef.current?.focus?.())
  }

  const handleSave = (outfit, piecesAdded) => {
    setShowForm(false)
    setEditOutfit(null)
    fetchOutfits()
    if (piecesAdded > 0) {
      setToast(`Outfit saved · ${piecesAdded} ${piecesAdded === 1 ? 'piece' : 'pieces'} added to wardrobe`)
    }
  }

  const seasonMatchesFilter = (outfitSeason, selectedSeason) => {
    if (!selectedSeason) return true
    if (selectedSeason === 'indoor') return outfitSeason === 'indoor'
    if (selectedSeason === 'year-round') return outfitSeason === 'year-round' || outfitSeason === 'indoor'
    return outfitSeason === selectedSeason || outfitSeason === 'year-round' || outfitSeason === 'indoor'
  }

  // Client-side filtering & sorting logic (Zero Latency)
  const filteredAndSorted = outfits.filter(o => {
    // 1. Occasion Filter
    if (filterOcc && o.occasion !== filterOcc) return false

    // 2. Climate / Season Filter
    if (filterSeason) {
      if (!seasonMatchesFilter(o.season, filterSeason)) return false
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

  const filteredAndSortedBoards = savedBoards.filter(b => {
    if (b.hidden_from_lookbook) return false
    // 1. Occasion Filter
    if (filterOcc) {
      const qOcc = filterOcc.toLowerCase().replace(/[-_]+/g, ' ')
      const titleMatch = b.title?.toLowerCase().includes(qOcc)
      const reasonMatch = b.reason?.toLowerCase().includes(qOcc)
      const watchMatch = b.watch_for?.toLowerCase().includes(qOcc)
      const contextMatch = b.context_name?.toLowerCase().includes(qOcc)
      const piecesMatch = b.pieces?.some(p => 
        Array.isArray(p.occasions) && p.occasions.some(occ => occ.toLowerCase().replace(/[-_]+/g, ' ').includes(qOcc))
      )
      if (!titleMatch && !reasonMatch && !watchMatch && !contextMatch && !piecesMatch) return false
    }

    // 2. Climate / Season Filter
    if (filterSeason) {
      const qSeason = filterSeason.toLowerCase()
      const titleMatch = b.title?.toLowerCase().includes(qSeason)
      const reasonMatch = b.reason?.toLowerCase().includes(qSeason)
      const watchMatch = b.watch_for?.toLowerCase().includes(qSeason)
      const piecesMatch = b.pieces?.some(p => seasonMatchesFilter(p.season, filterSeason))
      if (!titleMatch && !reasonMatch && !watchMatch && !piecesMatch) return false
    }

    // 3. Garment-Aware Search
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      const matchTitle = b.title?.toLowerCase().includes(q)
      const matchReason = b.reason?.toLowerCase().includes(q)
      const matchWatch = b.watch_for?.toLowerCase().includes(q)
      const matchContext = b.context_name?.toLowerCase().includes(q)
      
      const matchPieces = b.pieces?.some(p => {
        const matchPieceName = p.name?.toLowerCase().includes(q)
        const matchPieceCat = p.category?.toLowerCase().includes(q)
        const matchPieceColors = Array.isArray(p.colors) && p.colors.some(c => c.toLowerCase().includes(q))
        const matchPieceFab = p.fabric_category?.toLowerCase().includes(q)
        return matchPieceName || matchPieceCat || matchPieceColors || matchPieceFab
      })

      if (!matchTitle && !matchReason && !matchWatch && !matchContext && !matchPieces) return false
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
      return b.id - a.id
    }
    if (sortBy === 'oldest') {
      return a.id - b.id
    }
    if (sortBy === 'a-z') {
      return (a.title || '').localeCompare(b.title || '')
    }
    if (sortBy === 'z-a') {
      return (b.title || '').localeCompare(a.title || '')
    }
    if (sortBy === 'most-pieces') {
      return (b.pieces?.length || 0) - (a.pieces?.length || 0)
    }
    if (sortBy === 'least-pieces') {
      return (a.pieces?.length || 0) - (b.pieces?.length || 0)
    }
    return 0
  })

  const selectedOccasion = OCCASIONS.find(o => o.value === filterOcc)
  const selectedSeason = SEASONS.find(s => s.value === filterSeason)
  const activeFilterChips = [
    selectedOccasion?.value ? { key: 'occasion', label: selectedOccasion.label, clear: () => setFilter({ occasion: '' }) } : null,
    selectedSeason?.value ? { key: 'season', label: selectedSeason.label.replace(/^[^\w]+?\s*/, ''), clear: () => setFilter({ season: '' }) } : null,
  ].filter(Boolean)

  return (
    <div>
      <div className="view-header sticky-header lookbook-view-header">
        <div className="view-header-top lookbook-header-primary">
          <div>
            <div className="view-title">Lookbook</div>
            <div className="view-subtitle">
              {activeSubTab === 'my-outfits' ? (
                filteredAndSorted.length === outfits.length
                  ? `${outfits.length} outfits`
                  : `${filteredAndSorted.length} of ${outfits.length} outfits`
              ) : (
                filteredAndSortedBoards.length === savedBoards.length
                  ? `${savedBoards.length} generated outfits`
                  : `${filteredAndSortedBoards.length} of ${savedBoards.length} generated outfits`
              )}
            </div>
          </div>
          {activeSubTab === 'my-outfits' && (
            <button
              type="button"
              className="lookbook-add-outfit"
              onClick={() => { setEditOutfit(null); setShowForm(true) }}
            >
              <span className="lookbook-add-icon" aria-hidden="true">+</span>
              <span>Add outfit</span>
            </button>
          )}
        </div>

        <div className="subtab-container">
          <button
            type="button"
            className={`subtab-btn ${activeSubTab === 'my-outfits' ? 'active' : ''}`}
            onClick={() => setFilter({ view: 'my-outfits' })}
          >
            <span>My Outfits</span>
            <span className="subtab-count">{outfits.length}</span>
          </button>
          <button
            type="button"
            className={`subtab-btn ${activeSubTab === 'generated-outfits' ? 'active' : ''}`}
            onClick={() => setFilter({ view: 'generated-outfits' })}
          >
            <span>Generated Outfits</span>
            <span className="subtab-count">{savedBoards.length}</span>
          </button>
        </div>

        <div className="search-sort-row lookbook-search-row">
          <div className="search-bar search-bar-lookbook">
            <span className="search-icon">◎</span>
            <input 
              type="search" 
              placeholder="Search outfits..." 
              value={search} 
              onChange={e => setFilter({ q: e.target.value })}
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
                        setFilter({ sort: opt.value })
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

        <div className="lookbook-filter-toolbar" aria-label="Outfit filters">
          <div className="lookbook-filter-menu">
            <button
              type="button"
              className={`filter-menu-btn ${filterOcc ? 'active' : ''}`}
              onClick={e => {
                e.stopPropagation()
                setOpenFilterMenu(openFilterMenu === 'occasion' ? null : 'occasion')
              }}
            >
              <span>{selectedOccasion?.value ? selectedOccasion.label : 'Occasion'}</span>
              <span className="custom-select-arrow">▾</span>
            </button>
            {openFilterMenu === 'occasion' && (
              <>
                <div className="custom-select-backdrop" onClick={() => setOpenFilterMenu(null)} />
                <div className="filter-menu-popover">
                  {OCCASIONS.map(o => (
                    <button
                      key={o.value}
                      type="button"
                      className={`custom-select-option ${filterOcc === o.value ? 'active' : ''}`}
                      onClick={() => {
                        setFilter({ occasion: o.value })
                        setOpenFilterMenu(null)
                      }}
                    >
                      {o.value && <span aria-hidden="true">{OCCASION_ICONS[o.value] || '✦'} </span>}
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="lookbook-filter-menu">
            <button
              type="button"
              className={`filter-menu-btn ${filterSeason ? 'active' : ''}`}
              onClick={e => {
                e.stopPropagation()
                setOpenFilterMenu(openFilterMenu === 'season' ? null : 'season')
              }}
            >
              <span>{selectedSeason?.value ? selectedSeason.label : 'Season'}</span>
              <span className="custom-select-arrow">▾</span>
            </button>
            {openFilterMenu === 'season' && (
              <>
                <div className="custom-select-backdrop" onClick={() => setOpenFilterMenu(null)} />
                <div className="filter-menu-popover">
                  {SEASONS.map(s => (
                    <button
                      key={s.value}
                      type="button"
                      className={`custom-select-option ${filterSeason === s.value ? 'active' : ''}`}
                      onClick={() => {
                        setFilter({ season: s.value })
                        setOpenFilterMenu(null)
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="lookbook-pin-toggle" aria-label="Pinned outfit filter">
            <button
              type="button"
              className={!pinFavs ? 'active' : ''}
              onClick={() => setFilter({ pin: false })}
            >
              All
            </button>
            <button
              type="button"
              className={pinFavs ? 'active' : ''}
              onClick={() => setFilter({ pin: true })}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 20.2 4.6 13a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6a4.8 4.8 0 0 1 6.8 6.8L12 20.2Z" />
              </svg>
              Pinned
            </button>
          </div>
        </div>

        {activeFilterChips.length > 0 && (
          <div className="active-filter-row" aria-label="Active filters">
            {activeFilterChips.map(chip => (
              <button
                key={chip.key}
                type="button"
                className="active-filter-chip"
                onClick={chip.clear}
                aria-label={`Remove ${chip.label} filter`}
              >
                {chip.label} <span aria-hidden="true">×</span>
              </button>
            ))}
            {activeFilterChips.length >= 2 && (
              <button
                type="button"
                className="clear-filters-btn"
                onClick={() => setFilter({ occasion: '', season: '' })}
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {activeSubTab === 'my-outfits' ? (
        loading ? (
          <div className="loading">Loading outfits…</div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✦</div>
            <div className="empty-state-title">No outfits found</div>
            <div className="empty-state-text">Try adjusting your filters or search terms</div>
          </div>
        ) : (
          <div className="outfit-grid animate-grid">
            {filteredAndSorted.map(o => (
              <div
                key={o.id}
                className="outfit-card"
                style={{ position: 'relative' }}
                onClick={event => openOutfitDetail(o, event)}
                onKeyDown={event => handleCardKeyDown(event, () => openOutfitDetail(o, event))}
                role="button"
                tabIndex={0}
                aria-label={`Open ${o.name || 'outfit'} outfit`}
              >
                {o.photo
                  ? <img className="outfit-photo" src={resolveUploadThumbnailSrc(o.photo, 'lookbook-display')} alt={o.name} loading="lazy" decoding="async" onLoad={markOutfitImageOrientation} />
                  : <div className="outfit-placeholder">{OCCASION_ICONS[o.occasion] || '✦'}</div>
                }
                <button
                  type="button"
                  className="outfit-card-fav"
                  onClick={e => { e.stopPropagation(); handleFav(o) }}
                  aria-label={`${o.favorite ? 'Remove' : 'Add'} ${o.name || 'outfit'} ${o.favorite ? 'from' : 'to'} favorites`}
                  aria-pressed={Boolean(o.favorite)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 20.2 4.6 13a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6a4.8 4.8 0 0 1 6.8 6.8L12 20.2Z" />
                  </svg>
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
      ) : (
        loadingBoards ? (
          <div className="loading">Loading generated outfits…</div>
        ) : filteredAndSortedBoards.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✦</div>
            <div className="empty-state-title">No generated outfits found</div>
            <div className="empty-state-text">Try adjusting your filters or search terms</div>
          </div>
        ) : (
          <div className="outfit-grid animate-grid">
            {filteredAndSortedBoards.map(b => (
              <div
                key={b.id}
                className="outfit-card"
                style={{ position: 'relative' }}
                onClick={() => setBoardDetail(b)}
                onKeyDown={event => handleCardKeyDown(event, () => setBoardDetail(b))}
                role="button"
                tabIndex={0}
                aria-label={`Open ${b.title || 'generated outfit'}`}
              >
                {resolveUploadImageSrc(b.image_url) ? (
                  <img className="outfit-photo" src={resolveUploadThumbnailSrc(b.image_url, 'lookbook-display')} alt={b.title} loading="lazy" decoding="async" onLoad={markOutfitImageOrientation} />
                ) : (
                  <div className="outfit-placeholder">✦</div>
                )}
                <button
                  type="button"
                  className="outfit-card-fav"
                  onClick={e => { e.stopPropagation(); handleBoardFav(b) }}
                  aria-label={`${b.favorite ? 'Remove' : 'Add'} ${b.title || 'generated outfit'} ${b.favorite ? 'from' : 'to'} favorites`}
                  aria-pressed={Boolean(b.favorite)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 20.2 4.6 13a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6a4.8 4.8 0 0 1 6.8 6.8L12 20.2Z" />
                  </svg>
                </button>
                <div className="outfit-card-body">
                  <div className="outfit-card-name">{b.title || 'Generated outfit'}</div>
                  <div className="outfit-card-occasion">
                    {b.context_name || 'AI Composition'}
                    {b.pieces?.length > 0 && ` · ${b.pieces.length} ${b.pieces.length === 1 ? 'piece' : 'pieces'}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
 
      {showForm && <OutfitForm outfit={editOutfit} onSave={handleSave} onCancel={() => { setShowForm(false); setEditOutfit(null) }} />}
      {detail && (
        <OutfitDetail
          outfit={detail}
          onClose={closeOutfitDetail}
          onEdit={outfit => { setDetail(null); setEditOutfit(outfit); setShowForm(true) }}
          onDelete={handleDelete}
          onSendToStylist={outfit => { setDetail(null); onSendToStylist(outfit) }}
          onPiecesUpdated={fetchOutfits}
        />
      )}
      {boardDetail && (
        <BoardDetail
          board={boardDetail}
          onClose={() => setBoardDetail(null)}
          onDelete={handleBoardDelete}
          onGoToThread={onGoToThread}
          onSendToStylist={board => {
            setBoardDetail(null)
            // Extract real piece IDs from board.pieces (shape: {id, name, category, missing}).
            // resolveOutfitEvaluationPieces reads outfit.pieceIds, not outfit.pieces,
            // so we must extract them explicitly at the handoff boundary.
            const boardPieceIds = (board.pieces || [])
              .map(p => p?.id)
              .filter(id => id != null && Number(id) > 0)
              .map(Number)
            onSendToStylist({
              id: null,
              name: board.title,
              title: board.title,
              label: board.title,
              photo: resolveUploadImageSrc(board.image_url),
              pieceIds: boardPieceIds,
              pieces: board.pieces,
              occasion: board.context_name || '',
              notes: board.reason,
              autoSend: true,
              stylistPrompt: 'Evaluate this styling direction. Tell me whether the pieces work together, what feels risky, and what I should change first.'
            })
          }}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
