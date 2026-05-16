import { useState } from 'react'

const COLOR_BG = {
  'black':       '#2A2420',
  'white':       '#F0EDE8',
  'navy':        '#1E2D4A',
  'cream':       '#E8DFC8',
  'grey':        '#8A8A8A',
  'gray':        '#8A8A8A',
  'brown':       '#7A5A3A',
  'tan':         '#C0A070',
  'oatmeal':     '#D8C8B0',
  'plum':        '#5A3060',
  'olive':       '#5A6030',
  'green':       '#3A6A3A',
  'orange':      '#C86030',
  'red':         '#A83A2A',
  'yellow':      '#C0A030',
  'mustard':     '#B89020',
  'charcoal':    '#404040',
  'amber':       '#B07820',
  'turquoise':   '#2A8080',
  'light blue':  '#7AADCC',
  'periwinkle':  '#8888CC',
  'multi':       '#8A6848',
  'dark blue':   '#1A2040',
  'dark grey':   '#484848',
  'light grey':  '#B0B0B0',
  'pink':        '#C07080',
}

function getPlaceholderBg(colors = []) {
  const first = colors[0]?.toLowerCase()
  if (first && COLOR_BG[first]) return COLOR_BG[first]
  return '#9A8A78'
}

export default function PieceCard({ piece, onTap, onFavorite }) {
  const bg = getPlaceholderBg(piece.colors)
  const [imageFailed, setImageFailed] = useState(false)

  const handleFav = (e) => {
    e.stopPropagation()
    onFavorite(piece)
  }

  return (
    <div className="piece-card" onClick={() => onTap(piece)}>
      {/* Photo or placeholder */}
      {piece.photo && !imageFailed ? (
        <img
          className="piece-photo"
          src={`/uploads/${piece.photo}`}
          alt={piece.name}
          loading="lazy"
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

      {/* Badges */}
      <div className="piece-card-badges">
        <span className="badge badge-category">{piece.category}</span>
        {piece.status === 'needs-repair' && <span className="badge badge-repair">repair</span>}
        {piece.status === 'consider-donating' && <span className="badge badge-donate">donate?</span>}
      </div>

      {/* Favorite */}
      <button className="fav-btn" onClick={handleFav} aria-label="Toggle favorite">
        {piece.favorite ? '♥' : '♡'}
      </button>

      {/* Info */}
      <div className="piece-card-body">
        <div className="piece-card-name">{piece.name}</div>
        <div className="piece-card-meta">
          {piece.colors.slice(0, 2).join(' · ')}
        </div>
      </div>
    </div>
  )
}
