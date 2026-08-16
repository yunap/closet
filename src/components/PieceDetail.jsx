import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { uploadThumbnailSrc } from '../utils/uploadThumbnails.js'
import { getCachedGarmentRelationships, loadGarmentRelationships } from '../utils/garmentRelationships.js'
import { getColorSwatch } from '../utils/colors'

function presentMemoryRule(rule) {
  const source = String(rule || '').trim()
  const withoutMachineTag = source.replace(/^\[[^\]]+\]\s*/, '')
  const withoutEmbeddedImages = withoutMachineTag
    .replace(/!\[[^\]]*]\([^)]+\)\s*/g, '')
    .trim()
  const titled = withoutEmbeddedImages.match(/^\(([^)]+)\)\s*(.*)$/)
  const rawTitle = titled?.[1]?.trim() || ''
  const title = /^(works?|avoid|rejected?)$/i.test(rawTitle) ? '' : rawTitle
  return {
    title,
    body: (titled?.[2] || withoutEmbeddedImages).trim(),
  }
}

function OutfitThumb({ outfit, onPreview, prioritize = false }) {
  return (
    <button
      className="garment-relation-tile outfit-relation-tile"
      type="button"
      onClick={event => outfit.photo && onPreview({
        src: `/uploads/${outfit.photo}`,
        title: outfit.name || 'Outfit',
        meta: outfit.occasion || '',
      }, event.currentTarget)}
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
      onClick={event => onPreview({
        src: board.image_url,
        title,
        meta: pieces.length ? pieces.slice(0, 4).join(' + ') : (board.context_name || 'Generated outfit'),
      }, event.currentTarget)}
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
  const [relationshipsLoading, setRelationshipsLoading] = useState(() => !cachedRelationships)
  const [showAllBoards, setShowAllBoards] = useState(false)
  const sheetRef = useRef(null)
  const scrollContentRef = useRef(null)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const previewDialogRef = useRef(null)
  const previewCloseRef = useRef(null)
  const previewReturnFocusRef = useRef(null)
  const previewImageRef = useRef(previewImage)
  const closePreview = () => {
    const returnTarget = previewReturnFocusRef.current
    setPreviewImage(null)
    previewReturnFocusRef.current = null
    requestAnimationFrame(() => returnTarget?.focus())
  }

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    previewImageRef.current = previewImage
    if (previewImage) requestAnimationFrame(() => previewCloseRef.current?.focus())
  }, [previewImage])

  useEffect(() => {
    let cancelled = false
    const cached = getCachedGarmentRelationships(piece.id)
    setOutfits(cached?.outfits || [])
    setSavedBoards(cached?.savedBoards || [])
    setRelationshipsLoading(!cached)
    loadGarmentRelationships(piece.id, { refresh: Boolean(cached) })
      .then(relationships => {
        if (cancelled) return
        setOutfits(relationships.outfits)
        setSavedBoards(relationships.savedBoards)
        setRelationshipsLoading(false)
      })
      .catch(() => {
        if (!cancelled && !cached) {
          setOutfits([])
          setSavedBoards([])
        }
        if (!cancelled) setRelationshipsLoading(false)
      })
    return () => { cancelled = true }
  }, [piece.id])

  useEffect(() => {
    requestAnimationFrame(() => {
      sheetRef.current?.scrollTo({ top: 0 })
      scrollContentRef.current?.scrollTo({ top: 0 })
    })
    setShowAllBoards(false)
  }, [piece.id])

  useEffect(() => {
    const previouslyFocused = document.activeElement
    requestAnimationFrame(() => closeRef.current?.focus())

    const handleDialogKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (previewImageRef.current) closePreview()
        else onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') return
      const focusScope = previewImageRef.current ? previewDialogRef.current : sheetRef.current
      if (!focusScope) return
      const focusable = [...focusScope.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleDialogKeyDown)
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [])

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
  const openPreview = (image, trigger = document.activeElement) => {
    previewReturnFocusRef.current = trigger
    setPreviewImage(image)
  }

  return createPortal(
    <div className="modal-overlay piece-detail-overlay" onClick={onClose}>
      <div
        ref={sheetRef}
        className="modal-sheet piece-detail-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="garment-detail-title"
        aria-hidden={previewImage ? 'true' : undefined}
      >
        <button ref={closeRef} className="garment-detail-close" onClick={onClose} aria-label="Close garment detail">✕</button>

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
              onClick={event => activePhoto && openPreview({ src: `/uploads/${activePhoto}`, title: piece.name, meta: activePhotoLabel }, event.currentTarget)}
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
        {hasEither && <span className="outfit-photo-hint">View full-size photo</span>}
        </div>

        <div className="detail-body piece-detail-body">
          <div className="piece-detail-scroll-content" ref={scrollContentRef}>
          <section className="piece-detail-section garment-identity" aria-label="Garment identity">
            {/* The piece ID is shown deliberately (owner ruling, 2026-08-16): it is how a garment
                is referred to in the stylist, in feedback rows and in diagnostics, so it has to be
                readable from the garment itself. It was dropped by the V1 surface audit (d10f49a)
                and restored here. */}
            <div className="garment-detail-eyebrow">#{piece.id} · {formattedCategory}</div>
            <div className="detail-title" id="garment-detail-title">
              {piece.name}
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

          {piece.tag_state === 'provisional' && (
            <div className="garment-provisional-note">
              <strong>Fit details are incomplete.</strong>
              <span>
                {piece.worn_photo
                  ? 'Review the worn photo and garment details to complete fit guidance.'
                  : 'Add a worn photo to assess fit and drape.'}
              </span>
              {showEditAction && (
                <button type="button" onClick={() => onEdit(piece)}>
                  {piece.worn_photo ? 'Review fit details' : 'Add worn photo'}
                </button>
              )}
            </div>
          )}

          {piece.notes && (
            <section className="piece-detail-section piece-fit-section" aria-label="Garment notes">
              <div className="garment-section-heading">Garment notes</div>
              <div className="detail-notes">{piece.notes}</div>
            </section>
          )}

          {(piece.styling_rules_learned?.length > 0 || piece.tried_and_rejected?.length > 0) && (
            <section className="piece-detail-section garment-memory" aria-labelledby="garment-memory-title">
              <div>
                <div className="garment-section-heading" id="garment-memory-title">Styling memory</div>
                <p className="garment-section-intro">What your stylist has learned about using this piece.</p>
              </div>
              {piece.styling_rules_learned?.length > 0 && (
                <div className="garment-memory-group">
                  <div className="garment-memory-label">Works well</div>
                  <div className="garment-memory-list">
                    {piece.styling_rules_learned.map((rule, i) => {
                      const presented = presentMemoryRule(rule)
                      return (
                        <div className="garment-memory-item" key={i}>
                          {presented.title && <strong>{presented.title}</strong>}
                          <span>{presented.body}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {piece.tried_and_rejected?.length > 0 && (
                <div className="garment-memory-group garment-memory-avoid">
                  <div className="garment-memory-label">Avoid or reconsider</div>
                  <div className="garment-memory-list">
                    {piece.tried_and_rejected.map((rule, i) => {
                      const presented = presentMemoryRule(rule)
                      return (
                        <div className="garment-memory-item" key={i}>
                          {presented.title && <strong>{presented.title}</strong>}
                          <span>{presented.body}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>
          )}
          <section className="piece-detail-section garment-relationships" aria-label="Linked and generated outfits">
            {relationshipsLoading ? (
              <div className="garment-link-status" role="status">Loading outfit relationships…</div>
            ) : outfits.length > 0 ? (
              <div className="garment-relationship-block">
                <div className="garment-section-heading">
                  Linked outfits · {outfits.length}
                </div>
                <div className="garment-relation-strip">
                  {outfits.map((outfit, index) => <OutfitThumb key={outfit.id} outfit={outfit} onPreview={openPreview} prioritize={index < 4} />)}
                </div>
              </div>
            ) : (
              <div className="garment-relationship-block">
                <div className="garment-section-heading">Linked outfits</div>
                <div className="garment-link-status">
                  Not linked to any outfits yet
                </div>
              </div>
            )}

            {!relationshipsLoading && savedBoards.length > 0 && (
              <div className="garment-relationship-block">
                <div className="garment-section-heading">
                  Generated outfits · {savedBoards.length}
                </div>
                <div className="garment-relation-strip">
                  {visibleSavedBoards.map((board, index) => (
                    <SavedBoardThumb key={board.id} board={board} onPreview={openPreview} prioritize={index < 4} />
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
                {showEditAction && <button className="btn-secondary piece-edit-action" onClick={() => onEdit(piece)}>Edit piece</button>}
                {showDeleteAction && <button className="piece-delete-action" onClick={handleDelete}>Delete piece</button>}
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
          aria-labelledby="garment-preview-title"
          ref={previewDialogRef}
          className="image-preview-overlay"
          onClick={e => {
            e.stopPropagation()
            closePreview()
          }}
        >
          <div
            className="image-preview-dialog"
            onClick={e => e.stopPropagation()}
          >
            <div className="image-preview-header">
              <div style={{ minWidth: 0 }}>
                <div className="image-preview-title" id="garment-preview-title">{previewImage.title}</div>
                {previewImage.meta && <div className="image-preview-meta">{previewImage.meta}</div>}
              </div>
              <button ref={previewCloseRef} className="chip" onClick={closePreview}>Close</button>
            </div>
            <img className="image-preview-img" src={previewImage.src} alt={previewImage.title} />
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
