/** Shared structural shell for every Stylist entry point. */
export default function StylistLandingPanel({
  header,
  primary,
  sectionLabel,
  children,
  footer,
  variant = 'panel',
  className = '',
}) {
  const isPanel = variant === 'panel'

  return (
    <div className={`stylist-entry-layout ${isPanel ? 'stylist-landing-panel' : 'stylist-entry-layout--plain'} ${className}`.trim()}>
      {header && <div className={`stylist-entry-header ${isPanel ? 'stylist-landing-header' : ''}`.trim()}>{header}</div>}
      {primary && <div className="stylist-entry-primary">{primary}</div>}
      {sectionLabel && <div className="stylist-entry-section-label stylist-landing-section-label stylist-landing-section-label--divider">{sectionLabel}</div>}
      {children && <div className={`stylist-entry-body ${isPanel ? 'stylist-landing-body' : ''}`.trim()}>{children}</div>}
      {footer && <div className={`stylist-entry-footer ${isPanel ? 'stylist-landing-footer' : ''}`.trim()}>{footer}</div>}
    </div>
  )
}
