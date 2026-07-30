import {
  COLOR_TAXONOMY,
  colorTaxonomyEntry,
  normalizeColorName,
} from '../../lib/colorTaxonomy.js'

export const COLOR_OPTIONS = COLOR_TAXONOMY
export const COLOR_FAMILY_ORDER = [
  'black', 'white', 'grey', 'beige', 'brown',
  'red', 'pink', 'purple', 'blue', 'cyan', 'green',
  'yellow', 'orange', 'metallic', 'multi',
]

export const COLOR_FAMILY_LABELS = Object.freeze({
  black: 'Black',
  white: 'White & cream',
  grey: 'Grey',
  beige: 'Beige & tan',
  brown: 'Brown',
  red: 'Red',
  pink: 'Pink',
  purple: 'Purple',
  blue: 'Blue',
  cyan: 'Teal & turquoise',
  green: 'Green',
  yellow: 'Yellow',
  orange: 'Orange',
  metallic: 'Metallic',
  multi: 'Multi',
})

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

export { normalizeColorName, colorTaxonomyEntry }

export function colorsByFamily(values = COLOR_OPTIONS.map(color => color.name)) {
  const allowed = new Set(values.map(normalizeColorName))
  return COLOR_FAMILY_ORDER
    .map(family => ({
      family,
      label: COLOR_FAMILY_LABELS[family],
      colors: COLOR_OPTIONS.filter(color => color.family === family && allowed.has(color.name)),
    }))
    .filter(group => group.colors.length > 0)
}

export function getColorSwatch(value, fallback = '#C8C5C0') {
  return COLOR_HEX_MAP[normalizeColorName(value)] || fallback
}

export function sortColorNames(colors = []) {
  return [...colors].sort((left, right) =>
    normalizeColorName(left).localeCompare(normalizeColorName(right), undefined, { sensitivity: 'base' })
  )
}
