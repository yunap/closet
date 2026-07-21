/**
 * Shared shell for "work with this outfit/piece" landing screens in the
 * Stylist page. Header/footer content is fully custom per flow (the outfit
 * and piece flows place their "back to chat" control in different spots) —
 * this only owns the panel chrome, the section label, and spacing, so both
 * flows read as one visual system instead of two hand-maintained ones.
 */
export default function StylistLandingPanel({ header, sectionLabel, children, footer }) {
  return (
    <div className="stylist-landing-panel">
      {header && <div className="stylist-landing-header">{header}</div>}
      {sectionLabel && <div className="stylist-landing-section-label stylist-landing-section-label--divider">{sectionLabel}</div>}
      <div className="stylist-landing-body">{children}</div>
      {footer && <div className="stylist-landing-footer">{footer}</div>}
    </div>
  )
}
