import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const COLOR_BG = {
  'black': '#2A2420', 'white': '#F0EDE8', 'navy': '#1E2D4A', 'cream': '#E8DFC8',
  'grey': '#8A8A8A', 'brown': '#7A5A3A', 'tan': '#C0A070', 'oatmeal': '#D8C8B0',
  'plum': '#5A3060', 'olive': '#5A6030', 'green': '#3A6A3A', 'orange': '#C86030',
  'red': '#A83A2A', 'mustard': '#B89020', 'charcoal': '#404040', 'amber': '#B07820',
  'mauve': '#A7798A', 'lavender': '#A99AC2', 'lilac': '#C4B2D8',
  'turquoise': '#2A8080', 'light blue': '#7AADCC', 'periwinkle': '#8888CC', 'multi': '#8A6848', 'dark blue': '#1A2040',
  'dark grey': '#484848', 'light grey': '#B0B0B0', 'pink': '#C07080',
}

function OutfitThumb({ outfit, onPreview }) {
  return (
    <button
      type="button"
      onClick={() => outfit.photo && onPreview({
        src: `/uploads/${outfit.photo}`,
        title: outfit.name || 'Outfit',
        meta: outfit.occasion || '',
      })}
      disabled={!outfit.photo}
      style={{
        flexShrink: 0,
        width: 80,
        border: 0,
        padding: 0,
        background: 'transparent',
        textAlign: 'left',
        cursor: outfit.photo ? 'zoom-in' : 'default',
      }}
      aria-label={outfit.photo ? `Open outfit ${outfit.name || ''}` : undefined}
    >
      <div style={{ width: 80, height: 106, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-light)', background: 'var(--surface-2)' }}>
        {outfit.photo
          ? <img src={`/uploads/${outfit.photo}`} alt={outfit.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: 'var(--text-light)' }}>✦</div>
        }
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textAlign: 'center', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {outfit.name}
      </div>
    </button>
  )
}

function SavedBoardThumb({ board, onPreview }) {
  if (!board?.image_url) return null
  const pieces = Array.isArray(board.pieces) ? board.pieces.map(p => p?.name).filter(Boolean) : []
  return (
    <button
      type="button"
      onClick={() => onPreview({
        src: board.image_url,
        title: board.title || 'Saved board',
        meta: pieces.length ? pieces.slice(0, 4).join(' + ') : (board.context_name || 'Saved board'),
      })}
      style={{
        flexShrink: 0,
        width: 118,
        border: 0,
        padding: 0,
        background: 'transparent',
        textAlign: 'left',
        cursor: 'zoom-in',
      }}
      aria-label={`Open saved board ${board.title || ''}`}
    >
      <div style={{ width: 118, height: 148, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-light)', background: 'var(--surface-2)' }}>
        <img src={board.image_url} alt={board.title || 'Saved board'} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {board.title || 'Saved board'}
      </div>
    </button>
  )
}

export default function PieceDetail({ piece, onEdit, onDelete, onClose, onSendToStylist, showManagementActions = true }) {
  const bg = piece.colors[0] ? (COLOR_BG[piece.colors[0].toLowerCase()] || '#9A8A78') : '#9A8A78'
  const [photoTab, setPhotoTab] = useState(piece.photo ? 'hanger' : piece.worn_photo ? 'worn' : null)
  const [previewImage, setPreviewImage] = useState(null)
  const [outfits,  setOutfits]  = useState([])
  const [savedBoards, setSavedBoards] = useState([])
  const sheetRef = useRef(null)

  useEffect(() => {
    fetch(`/api/pieces/${piece.id}/outfits`)
      .then(r => r.json()).then(setOutfits).catch(() => {})
  }, [piece.id])

  useEffect(() => {
    fetch(`/api/saved-boards?pieceId=${piece.id}&limit=80`)
      .then(r => r.json())
      .then(rows => setSavedBoards(Array.isArray(rows) ? rows.filter(row => row.image_url) : []))
      .catch(() => setSavedBoards([]))
  }, [piece.id])

  useEffect(() => {
    requestAnimationFrame(() => sheetRef.current?.scrollTo({ top: 0 }))
  }, [piece.id])

  const handleDelete = () => {
    if (confirm(`Delete "${piece.name}"? This can't be undone.`)) onDelete(piece)
  }

  const hasBoth   = piece.photo && piece.worn_photo
  const hasEither = piece.photo || piece.worn_photo
  const activePhoto = photoTab === 'worn' ? piece.worn_photo : piece.photo
  const activePhotoLabel = photoTab === 'worn' ? 'Worn photo' : 'Hanger photo'

  return createPortal(
    <div className="modal-overlay piece-detail-overlay" onClick={onClose}>
      <div ref={sheetRef} className="modal-sheet piece-detail-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />

        {/* Photo */}
        {hasEither ? (
          <div style={{ position: 'relative' }}>
            {hasBoth && (
              <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 2, display: 'flex', gap: 4, background: 'rgba(38,32,26,0.5)', borderRadius: 20, padding: 3, backdropFilter: 'blur(8px)' }}>
                {[['hanger','On hanger'],['worn','Worn']].map(([tab, label]) => (
                  <button key={tab} onClick={() => setPhotoTab(tab)} style={{
                    padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500,
                    background: photoTab === tab ? '#fff' : 'transparent',
                    color: photoTab === tab ? '#2A2420' : 'rgba(255,255,255,0.8)',
                    transition: 'all 0.15s'
                  }}>{label}</button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="detail-photo-button"
              onClick={() => activePhoto && setPreviewImage({ src: `/uploads/${activePhoto}`, title: piece.name, meta: activePhotoLabel })}
              aria-label={`Open larger ${activePhotoLabel.toLowerCase()} for ${piece.name}`}
            >
              <img className="detail-photo" src={`/uploads/${activePhoto}`} alt={piece.name} />
            </button>
          </div>
        ) : (
          <div className="detail-placeholder" style={{ background: bg }}>
            <span className="detail-placeholder-letter">{piece.name.charAt(0)}</span>
          </div>
        )}

        <div className="detail-body">
          <div className="detail-title">
            <span style={{ fontFamily: 'monospace', color: 'var(--text-light)', marginRight: 8, fontSize: '0.85em', fontWeight: 'normal' }}>#{piece.id}</span>
            {piece.name}
          </div>
          <div className="detail-category">{piece.category}</div>

          <div className="detail-tags">
            {piece.colors.map(c    => <span key={c} className="detail-tag">{c}</span>)}
            {piece.occasions.map(o => <span key={o} className="detail-tag">{o}</span>)}
            <span className="detail-tag">{piece.season}</span>
            {piece.status !== 'active' && (
              <span className="detail-tag" style={{
                background:  piece.status === 'needs-repair' ? 'var(--repair-bg)' : 'var(--donate-bg)',
                color:       piece.status === 'needs-repair' ? 'var(--repair)'    : 'var(--donate)',
                borderColor: 'transparent'
              }}>
                {piece.status === 'needs-repair' ? '⚠ Needs repair' : '◌ Consider donating'}
              </span>
            )}
            {piece.favorite && <span className="detail-tag" style={{ color: 'var(--accent)' }}>♥ Favorite</span>}
          </div>

          {piece.tag_state === 'provisional' && (
            <div style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--accent-light)', padding: '9px 11px', borderRadius: 8, marginBottom: 14, lineHeight: 1.45 }}>
              Provisional tag: Add a worn photo to fully tag fit and drape behavior.
            </div>
          )}

          {piece.notes && <div className="detail-notes">{piece.notes}</div>}

          {/* Styling rules */}
          {piece.styling_rules_learned?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="form-label" style={{ marginBottom: 8 }}>Styling rules</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {piece.styling_rules_learned.map((rule, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--accent-light)', padding: '5px 10px', borderRadius: 8, borderLeft: '3px solid var(--accent)', lineHeight: 1.4 }}>
                    {rule}
                  </div>
                ))}
              </div>
            </div>
          )}

          {piece.tried_and_rejected?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="form-label" style={{ marginBottom: 8, color: 'var(--repair)' }}>Tried & rejected</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {piece.tried_and_rejected.map((rule, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--repair)', background: 'var(--repair-bg)', padding: '5px 10px', borderRadius: 8, borderLeft: '3px solid var(--repair)', lineHeight: 1.4 }}>
                    {rule}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Saved boards */}
          {savedBoards.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="form-label" style={{ marginBottom: 10 }}>
                Saved boards with this piece
              </div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                {savedBoards.map(board => (
                  <SavedBoardThumb key={board.id} board={board} onPreview={setPreviewImage} />
                ))}
              </div>
            </div>
          )}

          {/* Ask Stylist */}
          {onSendToStylist && (
            <button
              onClick={() => onSendToStylist(piece)}
              style={{
                width: '100%', padding: '13px', marginBottom: 10,
                background: 'var(--accent-light)', color: 'var(--accent)',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)',
                fontSize: 14, fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              ◇ Ask stylist about this piece
            </button>
          )}

          {/* Appears in */}
          {outfits.length > 0 ? (
            <div style={{ marginBottom: 16 }}>
              <div className="form-label" style={{ marginBottom: 10 }}>
                Appears in {outfits.length} {outfits.length === 1 ? 'outfit' : 'outfits'}
              </div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                {outfits.map(o => <OutfitThumb key={o.id} outfit={o} onPreview={setPreviewImage} />)}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 16, fontStyle: 'italic' }}>
              Not linked to any outfits yet
            </div>
          )}

          {showManagementActions && (
            <div className="detail-actions">
              <button className="btn-danger" onClick={handleDelete}>Delete</button>
              <button className="btn-primary" onClick={() => onEdit(piece)}>Edit</button>
            </div>
          )}
        </div>
      </div>
      {previewImage && (
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
        </div>
      )}
    </div>,
    document.body
  )
}
