export const COLOR_OPTIONS = [
  { name: 'black', hex: '#2A2420' },
  { name: 'white', hex: '#F5F2EC' },
  { name: 'cream', hex: '#E8DFC8' },
  { name: 'ivory', hex: '#EFE7D3' },
  { name: 'beige', hex: '#D6C3A3' },
  { name: 'taupe', hex: '#9C8B78' },
  { name: 'oatmeal', hex: '#D8C8B0' },
  { name: 'tan', hex: '#C0A070' },
  { name: 'brown', hex: '#7A5A3A' },
  { name: 'amber', hex: '#C28A25' },
  { name: 'mustard', hex: '#C09A20' },
  { name: 'yellow', hex: '#D8C75A' },
  { name: 'orange', hex: '#C86030' },
  { name: 'rust', hex: '#A85A3A' },
  { name: 'red', hex: '#A83A2A' },
  { name: 'burgundy', hex: '#6B2D3A' },
  { name: 'pink', hex: '#C07080' },
  { name: 'mauve', hex: '#A7798A' },
  { name: 'lavender', hex: '#A99AC2' },
  { name: 'lilac', hex: '#C4B2D8' },
  { name: 'plum', hex: '#5A3060' },
  { name: 'purple', hex: '#704B78' },
  { name: 'green', hex: '#3A6A3A' },
  { name: 'sage', hex: '#96A08A' },
  { name: 'olive', hex: '#5A6030' },
  { name: 'turquoise', hex: '#2A8080' },
  { name: 'teal', hex: '#2D7070' },
  { name: 'light blue', hex: '#7AADCC' },
  { name: 'blue', hex: '#557899' },
  { name: 'denim', hex: '#4F6F8F' },
  { name: 'periwinkle', hex: '#8888CC' },
  { name: 'navy', hex: '#1E2D4A' },
  { name: 'dark blue', hex: '#1A2040' },
  { name: 'light grey', hex: '#B8B8B8' },
  { name: 'grey', hex: '#8A8A8A' },
  { name: 'dark grey', hex: '#484848' },
  { name: 'charcoal', hex: '#3F4142' },
  { name: 'multi', hex: 'conic-gradient(#A85A3A, #C09A20, #3A6A3A, #557899, #704B78, #A85A3A)' },
]

export const COLOR_HEX_MAP = {
  ...Object.fromEntries(COLOR_OPTIONS.map(color => [color.name, color.hex])),
  gray: '#8A8A8A',
  'light gray': '#B8B8B8',
  'dark gray': '#484848',
}

export const LIGHT_COLORS = [
  'white', 'cream', 'ivory', 'beige', 'oatmeal', 'light grey', 'light blue',
  'lavender', 'lilac', 'yellow', 'sage',
]

export function normalizeColorName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function getColorSwatch(value, fallback = '#C8C5C0') {
  return COLOR_HEX_MAP[normalizeColorName(value)] || fallback
}

export function sortColorNames(colors = []) {
  return [...colors].sort((left, right) =>
    normalizeColorName(left).localeCompare(normalizeColorName(right), undefined, { sensitivity: 'base' })
  )
}
