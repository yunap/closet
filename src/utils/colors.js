import {
  COLOR_TAXONOMY,
  normalizeColorName,
} from '../../lib/colorTaxonomy.js'

export const COLOR_OPTIONS = COLOR_TAXONOMY

export const COLOR_HEX_MAP = {
  ...Object.fromEntries(COLOR_OPTIONS.map(color => [color.name, color.hex])),
  gray: '#8A8A8A',
  'light gray': '#B8B8B8',
  'dark gray': '#484848',
}

export const LIGHT_COLORS = [
  'white', 'cream', 'ivory', 'beige', 'greige', 'oatmeal', 'tan', 'camel',
  'khaki', 'silver', 'gold', 'light grey', 'light blue', 'lavender', 'lilac',
  'yellow', 'sage',
]

export { normalizeColorName }

export function getColorSwatch(value, fallback = '#C8C5C0') {
  return COLOR_HEX_MAP[normalizeColorName(value)] || fallback
}

export function sortColorNames(colors = []) {
  return [...colors].sort((left, right) =>
    normalizeColorName(left).localeCompare(normalizeColorName(right), undefined, { sensitivity: 'base' })
  )
}
