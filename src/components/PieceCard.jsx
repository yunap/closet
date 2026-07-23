import { useEffect, useRef, useState } from 'react'
import { getColorSwatch } from '../utils/colors'
import { uploadThumbnailSrc } from '../utils/uploadThumbnails.js'
import { prefetchGarmentRelationships } from '../utils/garmentRelationships.js'

function getPlaceholderBg(colors = []) {
  return getColorSwatch(colors[0], '#9A8A78')
}

export default function PieceCard({ piece, onTap, onFavorite }) {
  const bg = getPlaceholderBg(piece.colors)
  const [imageFailed, setImageFailed] = useState(false)
  const [photoOrientation, setPhotoOrientation] = useState('landscape')
  const relationshipPrefetchTimer = useRef(null)

  useEffect(() => () => clearTimeout(relationshipPrefetchTimer.current), [])

  const queueRelationshipPrefetch = () => {
    clearTimeout(relationshipPrefetchTimer.current)
    relationshipPrefetchTimer.current = setTimeout(() => prefetchGarmentRelationships(piece.id), 120)
  }

  const cancelRelationshipPrefetch = () => clearTimeout(relationshipPrefetchTimer.current)

  const openPiece = () => onTap(piece)
  const handleFav = (e) => {
    e.stopPropagation()
    onFavorite(piece)
  }

  return (
    <div className="piece-card">
      <button
        type="button"
        className="piece-card-hit"
        onClick={openPiece}
        onMouseEnter={queueRelationshipPrefetch}
        onMouseLeave={cancelRelationshipPrefetch}
        onFocus={() => prefetchGarmentRelationships(piece.id)}
        aria-label={`Open ${piece.name} wardrobe card`}
      >
        {/* Photo or placeholder */}
        <div className={`piece-photo-stage is-${photoOrientation}`}>
          {piece.photo && !imageFailed ? (
            <img
              className="piece-photo"
              src={uploadThumbnailSrc(`/uploads/${piece.photo}`, 'garment-display')}
              alt={piece.name}
              loading="lazy"
              decoding="async"
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget
                setPhotoOrientation(naturalHeight > naturalWidth * 1.08 ? 'portrait' : 'landscape')
              }}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="piece-placeholder" style={{ background: bg }}>
              <span className="piece-placeholder-letter">
                {piece.name.charAt(0)}
              </span>
              {piece.photo && <span className="piece-placeholder-note">Photo unavailable</span>}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="piece-card-body">
          <div className="piece-card-heading">
            <div className="piece-card-name">{piece.name}</div>
          </div>
          <div className="piece-card-meta">
            {!!piece.colors?.length && (
              <span className="piece-card-colors">
                <span className="piece-card-swatches" aria-hidden="true">
                  {piece.colors.slice(0, 2).map(color => <span key={color} style={{ background: getColorSwatch(color, '#9A8A78') }} />)}
                </span>
                {piece.colors.slice(0, 2).join(' · ')}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Badges */}
      <div className="piece-card-badges">
        {!!piece.retag_suggestions?.length && <span className="badge badge-retag">Retag suggested</span>}
        {piece.status === 'needs-repair' && <span className="badge badge-repair">repair</span>}
        {piece.status === 'consider-donating' && <span className="badge badge-donate">donate?</span>}
      </div>
      <button
        type="button"
        className={`fav-btn ${piece.favorite ? 'is-favorite' : ''}`}
        onClick={handleFav}
        aria-label={`${piece.favorite ? 'Remove' : 'Add'} ${piece.name} ${piece.favorite ? 'from' : 'to'} favorites`}
        aria-pressed={Boolean(piece.favorite)}
      >
        <svg viewBox="0 0 24 24" fill={piece.favorite ? 'currentColor' : 'none'} aria-hidden="true">
          <path d="M20.8 5.9c-1.9-2-5-2-6.9 0L12 7.8l-1.9-1.9a4.8 4.8 0 0 0-6.9 6.7L12 21l8.8-8.4a4.8 4.8 0 0 0 0-6.7Z" />
        </svg>
      </button>
    </div>
  )
}
