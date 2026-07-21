/**
 * Card used inside a StylistLandingPanel's option grid. `variant="button"`
 * fires `onClick` immediately (e.g. Critique outfit); `variant="radio"` just
 * toggles a selected state within a group (e.g. choosing a piece-builder mode)
 * and expects the caller to render whatever follows the choice.
 */
export default function OptionCard({ icon, title, description, variant = 'button', selected = false, accent = false, onClick }) {
  return (
    <button
      type="button"
      className={`stylist-option-card ${variant === 'radio' ? 'is-radio' : ''} ${selected ? 'is-selected' : ''} ${accent ? 'is-accent' : ''}`.trim()}
      onClick={onClick}
      aria-pressed={variant === 'radio' ? selected : undefined}
    >
      {variant === 'radio' ? (
        <span className="stylist-option-card-top-row">
          <span className="stylist-option-card-radio" aria-hidden="true" />
          {icon && <span className="stylist-option-card-icon" aria-hidden="true">{icon}</span>}
        </span>
      ) : (
        icon && <span className="stylist-option-card-icon" aria-hidden="true">{icon}</span>
      )}
      <span className="stylist-option-card-text">
        <span className="stylist-option-card-title">{title}</span>
        {description && <span className="stylist-option-card-desc">{description}</span>}
      </span>
    </button>
  )
}
