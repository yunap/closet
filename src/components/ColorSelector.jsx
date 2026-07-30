import { useEffect, useId, useMemo, useState } from 'react'
import { COLOR_FAMILY_LABELS, colorsByFamily, getColorSwatch } from '../utils/colors.js'

function Swatch({ color }) {
  return <span className="color-selector-swatch" style={{ background: getColorSwatch(color) }} aria-hidden="true" />
}

export function ColorEditor({ value = [], onChange, labelledBy }) {
  const selected = new Set(value)
  const [expandedFamily, setExpandedFamily] = useState(() => colorsByFamily(value)[0]?.family || '')
  const groups = useMemo(() => colorsByFamily(), [])
  const controlId = useId()
  const toggleColor = color => {
    const next = selected.has(color)
      ? value.filter(item => item !== color)
      : [...value, color]
    onChange(next)
  }

  return (
    <div className="color-editor" role="group" aria-labelledby={labelledBy}>
      <div className="color-selected-summary" role="group" aria-label="Selected colors">
        <span className="color-selected-label">Selected</span>
        {value.length ? value.map(color => (
          <button key={color} type="button" className="color-selected-chip" onClick={() => toggleColor(color)} aria-label={`Remove ${color}`}>
            <Swatch color={color} /> <span>{color}</span><span aria-hidden="true">×</span>
          </button>
        )) : <span className="color-selected-empty">None yet</span>}
      </div>
      <div className="color-editor-family-grid" role="group" aria-label="Color families">
        {groups.map(group => {
          const isOpen = expandedFamily === group.family
          const selectedCount = group.colors.filter(color => selected.has(color.name)).length
          return (
            <button key={group.family} type="button" className={`color-editor-family-btn ${isOpen ? 'active' : ''}`} onClick={() => setExpandedFamily(group.family)} aria-pressed={isOpen} aria-controls={`${controlId}-${group.family}-shades`}>
              <Swatch color={group.colors[0].name} />
              <span>{group.label}</span>
              {selectedCount > 0 && <span className="color-family-badge">{selectedCount}</span>}
            </button>
          )
        })}
      </div>
      {groups.map(group => expandedFamily === group.family && (
        <div id={`${controlId}-${group.family}-shades`} key={group.family} className="color-shade-grid" role="group" aria-label={`${group.label} shades`}>
          {group.colors.map(color => (
            <button key={color.name} type="button" className={`color-shade-option ${selected.has(color.name) ? 'active' : ''}`} aria-pressed={selected.has(color.name)} onClick={() => toggleColor(color.name)}>
              <Swatch color={color.name} /><span>{color.name}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export function ColorFamilyFilter({
  availableColors = [],
  familyCounts = {},
  valueFamily = '',
  valueColor = '',
  onChange,
  compact = false,
  collapsible = false,
}) {
  const groups = useMemo(() => colorsByFamily(availableColors), [availableColors])
  const [expandedFamily, setExpandedFamily] = useState(valueFamily || '')
  const [pickerOpen, setPickerOpen] = useState(!collapsible)
  const controlId = useId()
  useEffect(() => setExpandedFamily(valueFamily || ''), [valueFamily])

  const chooseFamily = family => {
    const next = family === valueFamily && !valueColor ? '' : family
    setExpandedFamily(next)
    onChange({ family: next, color: '' })
  }

  return (
    <div className={`color-family-filter ${compact ? 'compact' : ''}`}>
      {collapsible && (
        <button type="button" className="color-picker-trigger" onClick={() => setPickerOpen(open => !open)} aria-expanded={pickerOpen}>
          <span>Color</span>
          <span>{valueColor ? `${COLOR_FAMILY_LABELS[valueFamily]} · ${valueColor}` : valueFamily ? COLOR_FAMILY_LABELS[valueFamily] : 'Any color'} <span aria-hidden="true">⌄</span></span>
        </button>
      )}
      {pickerOpen && <>
      <button type="button" className={`color-family-any ${!valueFamily && !valueColor ? 'active' : ''}`} onClick={() => { setExpandedFamily(''); onChange({ family: '', color: '' }) }} aria-pressed={!valueFamily && !valueColor}>
        Any color
      </button>
      <div className="color-family-filter-list" role="group" aria-label="Color families">
        {groups.map(group => {
          const isOpen = expandedFamily === group.family
          const active = valueFamily === group.family
          return (
            <div className="color-filter-family" key={group.family}>
              <button type="button" className={`color-filter-family-btn ${active ? 'active' : ''}`} onClick={() => { setExpandedFamily(isOpen ? '' : group.family); if (!active) chooseFamily(group.family) }} aria-expanded={group.colors.length > 1 ? isOpen : undefined} aria-current={active ? 'true' : undefined} aria-controls={group.colors.length > 1 ? `${controlId}-${group.family}-filter-shades` : undefined}>
                <span className="color-family-name"><Swatch color={group.colors[0].name} />{COLOR_FAMILY_LABELS[group.family]}</span>
                <span className="color-family-meta">{familyCounts[group.family] ?? ''} <span aria-hidden="true">›</span></span>
              </button>
              {isOpen && group.colors.length > 1 && (
                <div id={`${controlId}-${group.family}-filter-shades`} className="color-filter-shades" role="group" aria-label={`${group.label} exact shades`}>
                  <button type="button" className={!valueColor && active ? 'active' : ''} onClick={() => onChange({ family: group.family, color: '' })} aria-pressed={!valueColor && active}>
                    All {group.label.toLowerCase()}
                  </button>
                  {group.colors.map(color => (
                    <button key={color.name} type="button" className={valueColor === color.name ? 'active' : ''} onClick={() => { onChange({ family: group.family, color: color.name }); if (collapsible) setPickerOpen(false) }} aria-pressed={valueColor === color.name}>
                      <Swatch color={color.name} /><span>{color.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      </>}
    </div>
  )
}
