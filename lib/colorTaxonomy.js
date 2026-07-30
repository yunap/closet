export const COLOR_TAXONOMY = Object.freeze([
  { name: 'black', hex: '#2A2420', family: 'black', neutrality: 'neutral' },
  { name: 'white', hex: '#F5F2EC', family: 'white', neutrality: 'neutral' },
  { name: 'cream', hex: '#E8DFC8', family: 'white', neutrality: 'neutral' },
  { name: 'ivory', hex: '#EFE7D3', family: 'white', neutrality: 'neutral' },
  { name: 'beige', hex: '#D6C3A3', family: 'beige', neutrality: 'neutral' },
  { name: 'greige', hex: '#B8AA99', family: 'beige', neutrality: 'neutral' },
  { name: 'taupe', hex: '#9C8B78', family: 'beige', neutrality: 'neutral' },
  { name: 'oatmeal', hex: '#D8C8B0', family: 'beige', neutrality: 'neutral' },
  { name: 'tan', hex: '#C0A070', family: 'beige', neutrality: 'neutral' },
  { name: 'camel', hex: '#B88A55', family: 'beige', neutrality: 'neutral' },
  { name: 'khaki', hex: '#A89B72', family: 'beige', neutrality: 'neutral' },
  { name: 'brown', hex: '#7A5A3A', family: 'brown', neutrality: 'neutral-adjacent' },
  { name: 'amber', hex: '#C28A25', family: 'yellow', neutrality: 'accent' },
  { name: 'mustard', hex: '#C09A20', family: 'yellow', neutrality: 'accent' },
  { name: 'yellow', hex: '#D8C75A', family: 'yellow', neutrality: 'accent' },
  { name: 'orange', hex: '#C86030', family: 'orange', neutrality: 'accent' },
  { name: 'rust', hex: '#A85A3A', family: 'orange', neutrality: 'accent' },
  { name: 'red', hex: '#A83A2A', family: 'red', neutrality: 'accent' },
  { name: 'burgundy', hex: '#6B2D3A', family: 'red', neutrality: 'accent' },
  { name: 'pink', hex: '#C07080', family: 'pink', neutrality: 'accent' },
  { name: 'mauve', hex: '#A7798A', family: 'pink', neutrality: 'accent' },
  { name: 'coral', hex: '#D87568', family: 'pink', neutrality: 'accent' },
  { name: 'lavender', hex: '#A99AC2', family: 'purple', neutrality: 'accent' },
  { name: 'lilac', hex: '#C4B2D8', family: 'purple', neutrality: 'accent' },
  { name: 'plum', hex: '#5A3060', family: 'purple', neutrality: 'accent' },
  { name: 'purple', hex: '#704B78', family: 'purple', neutrality: 'accent' },
  { name: 'green', hex: '#3A6A3A', family: 'green', neutrality: 'accent' },
  { name: 'sage', hex: '#96A08A', family: 'green', neutrality: 'neutral-adjacent' },
  { name: 'olive', hex: '#5A6030', family: 'green', neutrality: 'neutral-adjacent' },
  { name: 'turquoise', hex: '#2A8080', family: 'cyan', neutrality: 'accent' },
  { name: 'teal', hex: '#2D7070', family: 'cyan', neutrality: 'accent' },
  { name: 'light blue', hex: '#7AADCC', family: 'blue', neutrality: 'accent' },
  { name: 'blue', hex: '#557899', family: 'blue', neutrality: 'accent' },
  { name: 'denim', hex: '#4F6F8F', family: 'blue', neutrality: 'neutral-adjacent' },
  { name: 'navy', hex: '#1E2D4A', family: 'blue', neutrality: 'neutral' },
  { name: 'dark blue', hex: '#1A2040', family: 'blue', neutrality: 'neutral' },
  { name: 'light grey', hex: '#B8B8B8', family: 'grey', neutrality: 'neutral' },
  { name: 'grey', hex: '#8A8A8A', family: 'grey', neutrality: 'neutral' },
  { name: 'dark grey', hex: '#484848', family: 'grey', neutrality: 'neutral' },
  { name: 'charcoal', hex: '#3F4142', family: 'grey', neutrality: 'neutral' },
  { name: 'silver', hex: '#A8A9AD', family: 'metallic', neutrality: 'metallic' },
  { name: 'gold', hex: '#C5A253', family: 'metallic', neutrality: 'metallic' },
  {
    name: 'multi',
    hex: 'conic-gradient(#A85A3A, #C09A20, #3A6A3A, #557899, #704B78, #A85A3A)',
    family: 'multi',
    neutrality: 'multi',
  },
].map(entry => Object.freeze(entry)))

export const COLOR_NAMES = Object.freeze(COLOR_TAXONOMY.map(entry => entry.name))
export const ACCENT_COLOR_NAMES = Object.freeze(
  COLOR_TAXONOMY.filter(entry => entry.neutrality === 'accent').map(entry => entry.name)
)

export const UNKNOWN_COLOR = Object.freeze({
  name: null,
  hex: null,
  family: 'unknown',
  neutrality: 'unknown',
})

const COLOR_BY_NAME = new Map(COLOR_TAXONOMY.map(entry => [entry.name, entry]))

export function normalizeColorName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function colorTaxonomyEntry(value) {
  return COLOR_BY_NAME.get(normalizeColorName(value)) || UNKNOWN_COLOR
}

export function colorTaggerInstruction() {
  return `only from: ${COLOR_NAMES.join(', ')}`
}

export function colorFamilies(values = []) {
  return [...new Set(values.map(value => colorTaxonomyEntry(value).family))]
}

export function colorsArePaletteNeutral(values = []) {
  if (!Array.isArray(values) || values.length === 0) return false
  return values.every(value => {
    const { neutrality } = colorTaxonomyEntry(value)
    return neutrality === 'neutral' || neutrality === 'neutral-adjacent'
  })
}

export function unknownColorNames(values = []) {
  return [...new Set(values
    .map(normalizeColorName)
    .filter(Boolean)
    .filter(value => colorTaxonomyEntry(value).family === 'unknown'))]
}
