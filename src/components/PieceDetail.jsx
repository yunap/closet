import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { uploadThumbnailSrc } from '../utils/uploadThumbnails.js'
import { getCachedGarmentRelationships, loadGarmentRelationships } from '../utils/garmentRelationships.js'
import { getColorSwatch } from '../utils/colors'

function OutfitThumb({ outfit, onPreview, prioritize = false }) {
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
          ? <img src={outfit.thumbnail_url || `/uploads/${outfit.photo}`} alt={outfit.name} loading={prioritize ? 'eager' : 'lazy'} decoding="async" fetchPriority={prioritize ? 'high' : 'auto'} />
          : <div className="garment-relation-empty">✦</div>
        }
      </div>
      <div className="garment-relation-label">
        {outfit.name}
      </div>
    </button>
  )
}

function SavedBoardThumb({ board, onPreview, prioritize = false }) {
  if (!board?.image_url) return null
  const pieces = Array.isArray(board.pieces) ? board.pieces.map(p => p?.name).filter(Boolean) : []
  const title = board.title || 'Generated outfit'
  return (
    <button
      className="garment-relation-tile saved-board-tile"
      type="button"
      onClick={() => onPreview({
        src: board.image_url,
        title,
        meta: pieces.length ? pieces.slice(0, 4).join(' + ') : (board.context_name || 'Generated outfit'),
      })}
      aria-label={`Open generated outfit ${title}`}
      title={title}
    >
      <div className="garment-relation-thumb saved-board-thumb">
        <img src={board.thumbnail_url || board.image_url} alt={title} loading={prioritize ? 'eager' : 'lazy'} decoding="async" fetchPriority={prioritize ? 'high' : 'auto'} />
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
  const bg = getColorSwatch(piece.colors[0], '#9A8A78')
  const [photoTab, setPhotoTab] = useState(piece.photo ? 'hanger' : piece.worn_photo ? 'worn' : null)
  const [previewImage, setPreviewImage] = useState(null)
  const cachedRelationships = getCachedGarmentRelationships(piece.id)
  const [outfits, setOutfits] = useState(() => cachedRelationships?.outfits || [])
  const [savedBoards, setSavedBoards] = useState(() => cachedRelationships?.savedBoards || [])
  const [showAllBoards, setShowAllBoards] = useState(false)
  const sheetRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const cached = getCachedGarmentRelationships(piece.id)
    setOutfits(cached?.outfits || [])
    setSavedBoards(cached?.savedBoards || [])
    loadGarmentRelationships(piece.id, { refresh: Boolean(cached) })
      .then(relationships => {
        if (cancelled) return
        setOutfits(relationships.outfits)
        setSavedBoards(relationships.savedBoards)
      })
      .catch(() => {
        if (!cancelled && !cached) {
          setOutfits([])
          setSavedBoards([])
        }
      })
    return () => { cancelled = true }
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

        <div className="piece-detail-layout">
        <div className="piece-detail-visual">

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
              <img className="detail-photo" src={uploadThumbnailSrc(`/uploads/${activePhoto}`, 'garment-display')} alt={piece.name} decoding="async" />
            </button>
          </div>
        ) : (
          <div className="detail-placeholder piece-detail-placeholder" style={{ background: bg }}>
            <span className="detail-placeholder-letter">{piece.name.charAt(0)}</span>
          </div>
        )}
        <span className="outfit-photo-hint">Open full photo</span>
        </div>

        <div className="detail-body piece-detail-body">
          <div className="piece-detail-scroll-content">
          <section className="piece-detail-section garment-identity" aria-label="Garment identity">
            <div className="detail-title" id="garment-detail-title">
              {piece.name}
            </div>
            <div className="detail-category">#{piece.id} · {formattedCategory}</div>
          </section>

          <section className="piece-detail-section garment-meta-groups" aria-label="Garment metadata">
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
          </section>

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

          {piece.notes && (
            <section className="piece-detail-section piece-fit-section" aria-label="Fit and wear notes">
              <div className="garment-section-heading">Fit & wear</div>
              <div className="detail-notes">{piece.notes}</div>
            </section>
          )}

          {/* Styling rules */}
          {piece.styling_rules_learned?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="form-label" style={{ marginBottom: 8 }}>Styling rules</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {piece.styling_rules_learned.map((rule, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--accent-light)', padding: '5px 10px', borderRadius: 8, lineHeight: 1.4 }}>
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
                  <div key={i} style={{ fontSize: 12, color: 'var(--repair)', background: 'var(--repair-bg)', padding: '5px 10px', borderRadius: 8, lineHeight: 1.4 }}>
                    {rule}
                  </div>
                ))}
              </div>
            </div>
          )}
          <section className="piece-detail-section garment-relationships" aria-label="Generated and linked outfits">
            {savedBoards.length > 0 && (
              <div className="garment-relationship-block">
                <div className="garment-section-heading">
                  Generated outfits · {savedBoards.length}
                </div>
                <div className="garment-relation-strip">
                  {visibleSavedBoards.map((board, index) => (
                    <SavedBoardThumb key={board.id} board={board} onPreview={setPreviewImage} prioritize={index < 4} />
                  ))}
                  {remainingSavedBoards > 0 && (
                    <button
                      className="garment-relation-more"
                      type="button"
                      onClick={() => setShowAllBoards(true)}
                      aria-label={`Show ${remainingSavedBoards} more generated outfits`}
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
                  {outfits.map((outfit, index) => <OutfitThumb key={outfit.id} outfit={outfit} onPreview={setPreviewImage} prioritize={index < 4} />)}
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
          </div>

          <div className="piece-detail-action-dock">
            {!!piece.retag_suggestions?.length && (
              <div className="piece-retag-suggestion">
                <strong>Retag suggested</strong>
                {piece.retag_suggestions.map(suggestion => <span key={suggestion.id}>{suggestion.description}</span>)}
              </div>
            )}
            {onSendToStylist && (
              <button
                className="garment-ask-stylist"
                onClick={() => onSendToStylist(piece)}
              >
                ◇ Ask stylist about this piece
              </button>
            )}

            {(showDeleteAction || showEditAction) && (
              <div className="detail-actions piece-detail-actions">
                {showDeleteAction && <button className="piece-delete-action" onClick={handleDelete}>Delete piece</button>}
                {showEditAction && <button className="btn-primary" onClick={() => onEdit(piece)}>Edit piece</button>}
              </div>
            )}
          </div>
        </div>
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
