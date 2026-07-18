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
      className="garment-relation-tile outfit-relation-tile"
      type="button"
      onClick={() => outfit.photo && onPreview({
        src: `/uploads/${outfit.photo}`,
        title: outfit.name || 'Outfit',
        meta: outfit.occasion || '',
      })}
      disabled={!outfit.photo}
      aria-label={outfit.photo ? `Open outfit ${outfit.name || ''}` : undefined}
    >
      <div className="garment-relation-thumb outfit-relation-thumb">
        {outfit.photo
          ? <img src={`/uploads/${outfit.photo}`} alt={outfit.name} />
          : <div className="garment-relation-empty">✦</div>
        }
      </div>
      <div className="garment-relation-label">
        {outfit.name}
      </div>
    </button>
  )
}

function SavedBoardThumb({ board, onPreview }) {
  if (!board?.image_url) return null
  const pieces = Array.isArray(board.pieces) ? board.pieces.map(p => p?.name).filter(Boolean) : []
  const title = board.title || 'Saved board'
  return (
    <button
      className="garment-relation-tile saved-board-tile"
      type="button"
      onClick={() => onPreview({
        src: board.image_url,
        title,
        meta: pieces.length ? pieces.slice(0, 4).join(' + ') : (board.context_name || 'Saved board'),
      })}
      aria-label={`Open saved board ${title}`}
      title={title}
    >
      <div className="garment-relation-thumb saved-board-thumb">
        <img src={board.image_url} alt={title} />
      </div>
      <div className="garment-relation-label">
        {title}
      </div>
    </button>
  )
}

export default function PieceDetail({
  piece,
  onEdit,
  onDelete,
  onClose,
  onSendToStylist,
  showManagementActions = true,
  showDeleteAction = showManagementActions,
  showEditAction = showManagementActions
}) {
  const bg = piece.colors[0] ? (COLOR_BG[piece.colors[0].toLowerCase()] || '#9A8A78') : '#9A8A78'
  const [photoTab, setPhotoTab] = useState(piece.photo ? 'hanger' : piece.worn_photo ? 'worn' : null)
  const [previewImage, setPreviewImage] = useState(null)
  const [outfits,  setOutfits]  = useState([])
  const [savedBoards, setSavedBoards] = useState([])
  const [showAllBoards, setShowAllBoards] = useState(false)
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
    setShowAllBoards(false)
  }, [piece.id])

  const handleDelete = () => {
    if (confirm(`Delete "${piece.name}"? This can't be undone.`)) onDelete(piece)
  }

  const hasBoth   = piece.photo && piece.worn_photo
  const hasEither = piece.photo || piece.worn_photo
  const activePhoto = photoTab === 'worn' ? piece.worn_photo : piece.photo
  const activePhotoLabel = photoTab === 'worn' ? 'Worn photo' : 'Hanger photo'
  const formattedCategory = piece.category ? piece.category.charAt(0).toUpperCase() + piece.category.slice(1) : 'Piece'
  const visibleSavedBoards = showAllBoards ? savedBoards : savedBoards.slice(0, 4)
  const remainingSavedBoards = savedBoards.length - visibleSavedBoards.length

  return createPortal(
    <div className="modal-overlay piece-detail-overlay" onClick={onClose}>
      <div
        ref={sheetRef}
        className="modal-sheet piece-detail-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="garment-detail-title"
      >
        <button className="garment-detail-close" onClick={onClose} aria-label="Close garment detail">✕</button>

        {/* Photo */}
        {hasEither ? (
          <div className="garment-photo-section">
            {hasBoth && (
              <div className="garment-photo-toggle" role="group" aria-label="Garment photo view">
                {[['hanger','On hanger'],['worn','Worn']].map(([tab, label]) => (
                  <button
                    key={tab}
                    className={photoTab === tab ? 'active' : ''}
                    onClick={() => setPhotoTab(tab)}
                    aria-pressed={photoTab === tab}
                  >
                    {label}
                  </button>
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
          <div className="garment-identity">
            <div className="detail-title" id="garment-detail-title">
              {piece.name}
            </div>
            <div className="detail-category">#{piece.id} · {formattedCategory}</div>
          </div>

          <div className="garment-meta-groups" aria-label="Garment metadata">
            <div className="garment-meta-group">
              <div className="form-label">Colors</div>
              <div className="garment-meta-values">{piece.colors?.length ? piece.colors.join(' · ') : 'Not set'}</div>
            </div>
            <div className="garment-meta-group">
              <div className="form-label">Best for</div>
              <div className="garment-meta-values">{piece.occasions?.length ? piece.occasions.join(' · ') : 'Not set'}</div>
            </div>
            <div className="garment-meta-group">
              <div className="form-label">Season</div>
              <div className="garment-meta-values">{piece.season || 'Not set'}</div>
            </div>
          </div>

          <div className="detail-tags garment-status-tags">
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
            <div className="garment-provisional-note">
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
          <section className="garment-relationships" aria-label="Saved boards and linked outfits">
            {savedBoards.length > 0 && (
              <div className="garment-relationship-block">
                <div className="garment-section-heading">
                  Saved boards · {savedBoards.length}
                </div>
                <div className="garment-relation-strip">
                  {visibleSavedBoards.map(board => (
                    <SavedBoardThumb key={board.id} board={board} onPreview={setPreviewImage} />
                  ))}
                  {remainingSavedBoards > 0 && (
                    <button
                      className="garment-relation-more"
                      type="button"
                      onClick={() => setShowAllBoards(true)}
                      aria-label={`Show ${remainingSavedBoards} more saved boards`}
                    >
                      +{remainingSavedBoards}
                      <span>more</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {outfits.length > 0 ? (
              <div className="garment-relationship-block">
                <div className="garment-section-heading">
                  Linked outfits · {outfits.length}
                </div>
                <div className="garment-relation-strip">
                  {outfits.map(o => <OutfitThumb key={o.id} outfit={o} onPreview={setPreviewImage} />)}
                </div>
              </div>
            ) : (
              <div className="garment-relationship-block">
                <div className="garment-section-heading">
                  Linked outfits
                </div>
                <div className="garment-link-status">
                  Not linked to any outfits yet
                </div>
              </div>
            )}
          </section>

          {/* Ask Stylist */}
          {onSendToStylist && (
            <button
              className="garment-ask-stylist"
              onClick={() => onSendToStylist(piece)}
            >
              ◇ Ask stylist about this piece
            </button>
          )}

          {(showDeleteAction || showEditAction) && (
            <div className="detail-actions">
              {showDeleteAction && <button className="btn-danger" onClick={handleDelete}>Delete</button>}
              {showEditAction && <button className="btn-primary" onClick={() => onEdit(piece)}>Edit</button>}
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
