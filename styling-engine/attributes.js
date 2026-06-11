// Attributes Module
// Acts as the single entry point for interpreting garment text when structured metadata is not yet populated.

export function pieceTextBlob(p) {
  if (!p) return ''
  const colors = Array.isArray(p.colors) ? p.colors : []
  const occasions = Array.isArray(p.occasions) ? p.occasions : []
  const rules = Array.isArray(p.styling_rules_learned) ? p.styling_rules_learned : []
  const pairs = Array.isArray(p.pairs_well_with) ? p.pairs_well_with : []
  return [
    p.name || '',
    p.category || '',
    colors.join(' '),
    p.background_color || '',
    p.reads_as || '',
    occasions.join(' '),
    p.season || '',
    p.pattern_type || '',
    p.pattern_scale || '',
    p.pattern_complexity || '',
    p.silhouette || '',
    p.fabric_category || '',
    p.fabric_weight || '',
    p.fit_on_body || '',
    p.tuck_behavior || '',
    p.waistband_type || '',
    p.notes || '',
    p.engine_notes || '',
    rules.join(' '),
    pairs.join(' ')
  ].filter(Boolean).join(' ').toLowerCase()
}

export function textIncludesAny(value, words) {
  const haystack = String(value || '').toLowerCase()
  return words.some(w => haystack.includes(String(w).toLowerCase()))
}

export function fabricWeight(p) {
  // TODO: backfill fabric_weight
  if (p.fabric_weight) {
    const fw = String(p.fabric_weight).toLowerCase().trim()
    if (fw === 'heavy') return 'heavy'
    if (fw === 'light' || fw === 'lightweight') return 'light'
    if (fw === 'medium') return 'medium'
  }
  const text = `${p.name || ''} ${p.reads_as || ''}`.toLowerCase()
  if (/\b(wool|denim|corduroy|leather|fleece)\b/i.test(text)) {
    return 'heavy'
  }
  if (/\b(linen|gauze|crinkle|seersucker)\b/i.test(text)) {
    return 'light'
  }
  return 'medium'
}

export function bottomKind(p) {
  // TODO: backfill bottom_kind
  const category = String(p.category || '').toLowerCase().trim()
  if (category !== 'bottom') return null

  if (p.style_profile_json?.bottom_kind) {
    const bk = String(p.style_profile_json.bottom_kind).toLowerCase().trim()
    if (['pants', 'shorts', 'skirt-mini', 'skirt-midi', 'skirt-maxi'].includes(bk)) return bk
  }

  const name = String(p.name || '').toLowerCase()
  const readsAs = String(p.reads_as || '').toLowerCase()
  const combined = `${name} ${readsAs} ${p.length_hits_at || ''}`.toLowerCase()

  if (/\b(shorts?|skort|cut-offs?)\b/i.test(name) || /\b(shorts?|skort)\b/i.test(readsAs)) {
    return 'shorts'
  }

  if (/\b(skirt|skort)\b/i.test(name) || /\bskirt\b/i.test(readsAs)) {
    if (/\b(mini|knee-length|knee length|short|skort)\b/i.test(combined)) {
      return 'skirt-mini'
    }
    if (/\b(maxi|ankle|floor)\b/i.test(combined)) {
      return 'skirt-maxi'
    }
    return 'skirt-midi'
  }

  if (/\b(pants?|jeans?|trousers?|leggings?|tights?|culottes?)\b/i.test(combined)) {
    return 'pants'
  }

  return 'pants' // default bottom is pants
}

export function colorFamily(p) {
  // TODO: backfill color_family
  const colors = (p.colors || []).map(c => String(c).toLowerCase())
  const darkAnchorList = ['black', 'navy', 'denim', 'charcoal', 'dark grey', 'dark gray', 'deep navy', 'chocolate', 'dark blue', 'espresso']
  const warmEarthList = ['brown', 'tan', 'cognac', 'rust', 'terracotta', 'mustard', 'ochre', 'olive', 'amber', 'plum', 'burgundy']
  const softNeutralList = ['white', 'cream', 'beige', 'taupe', 'oatmeal', 'ivory', 'nude', 'light grey', 'light gray', 'soft white', 'sand']
  const accentList = ['coral', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'lavender', 'fuchsia', 'magenta', 'teal', 'turquoise', 'chartreuse', 'violet', 'lilac', 'red']

  if (colors.length > 0) {
    if (colors.some(c => darkAnchorList.includes(c))) return 'dark-anchor'
    if (colors.some(c => warmEarthList.includes(c))) return 'warm-earth'
    if (colors.some(c => softNeutralList.includes(c))) return 'soft-neutral'
    if (colors.some(c => accentList.includes(c))) return 'accent'
  }

  const text = `${p.name || ''} ${p.reads_as || ''}`.toLowerCase()
  if (new RegExp(`\\b(${darkAnchorList.join('|')}|dark denim)\\b`).test(text)) return 'dark-anchor'
  if (new RegExp(`\\b(${warmEarthList.join('|')})\\b`).test(text)) return 'warm-earth'
  if (new RegExp(`\\b(${softNeutralList.join('|')}|light)\\b`).test(text)) return 'soft-neutral'
  if (new RegExp(`\\b(${accentList.join('|')})\\b`).test(text)) return 'accent'

  return 'other'
}

export function patternLoudness(p) {
  // TODO: backfill pattern_complexity
  if (p.pattern_complexity) {
    const pc = String(p.pattern_complexity).toLowerCase().trim()
    if (pc === 'solid' || pc === 'plain') return 'solid'
    if (['quiet', 'medium', 'loud'].includes(pc)) return pc
  }
  const text = `${p.name || ''} ${p.reads_as || ''} ${p.pattern_type || ''}`.toLowerCase()
  if (/\b(solid|plain|monochrome|uniform)\b/.test(text)) return 'solid'
  if (/\b(graphic|bold|statement|loud|colorblock|multi|abstract|loud print|contrast stripe)\b/.test(text)) return 'loud'
  if (/\b(floral|print|pattern|stripe|stripes|striped|plaid|polka|check|checked|lace|embroidered|applique|crochet|patterned)\b/.test(text)) return 'medium'
  if (/\b(texture|textured|ribbed|knit|heather|quiet|subtle|marled|waffle|pointelle)\b/.test(text)) return 'quiet'
  return 'solid'
}

export function groundingLevel(p) {
  // Returns integer 0..3 representing how much visual grounding the garment provides.
  // 3: strong anchor, 2: moderate anchor, 1: light anchor, 0: floating/soft.
  const blob = pieceTextBlob(p)
  const colors = (p.colors || []).map(c => String(c).toLowerCase())
  const dark = colors.some(c => ['black','navy','denim','brown','charcoal','dark grey','dark gray','deep navy','chocolate'].includes(c)) || textIncludesAny(blob, ['black','navy','dark denim','dark blue','charcoal','brown','chocolate'])
  const light = colors.some(c => ['white','cream','beige','taupe','oatmeal','ivory','nude'].includes(c)) || textIncludesAny(blob, ['white','cream','beige','oatmeal','ivory','nude','light'])
  const denseTexture = textIncludesAny(blob, ['denim','corduroy','wool','twill','utility','canvas','leather','structured','pencil','maxi','crochet','heavy','substantial','ribbed'])
  const airyTexture = textIncludesAny(blob, ['lace','gauzy','chiffon','sheer','silk','satin','delicate','soft floral','airy','lightweight'])
  const longLine = textIncludesAny(blob, ['maxi','midi','full length','full-length','long','straight','flare','bootcut','wide-leg','wide leg','column','pencil'])
  const abrupt = textIncludesAny(blob, ['mini','short','cropped','crop','knee-length','knee length'])

  let grounding = 0
  if (dark) grounding += 3
  if (denseTexture) grounding += 2
  if (longLine) grounding += 2
  if (light) grounding -= 1
  if (airyTexture) grounding -= 2
  if (abrupt) grounding -= 2

  if (grounding >= 4) return 3
  if (grounding >= 2) return 2
  if (grounding >= 0) return 1
  return 0
}

export function styleLanes(p) {
  const blob = pieceTextBlob(p)
  const lanes = []
  if (textIncludesAny(blob, ['utility','olive','canvas','twill','cognac','linen','earthy'])) lanes.push('relaxed earthy')
  if (textIncludesAny(blob, ['tailored','trouser','button-up','button down','pencil','loafer','blazer'])) lanes.push('soft structured')
  if (textIncludesAny(blob, ['crochet','appliqué','applique','lace','embroidered','woven','artisan','textured'])) lanes.push('artistic textured')
  if (textIncludesAny(blob, ['pink','pastel','kawaii','mini','playful','bright floral'])) lanes.push('controlled playful')
  if (textIncludesAny(blob, ['navy','pinstripe','loafer','pencil','button-up','button down','preppy'])) lanes.push('modern preppy')
  return [...new Set(lanes)].slice(0, 3)
}

export function garmentKind(p) {
  const category = String(p.category || '').toLowerCase().trim()
  if (category === 'shoes') return 'shoes'
  if (category === 'accessory') return 'accessory'
  if (category === 'dress' || category === 'jumpsuit') return 'dress'

  const text = `${p.name || ''} ${p.reads_as || ''}`.toLowerCase()

  if (category === 'outerwear') {
    if (/\bcoat\b/.test(text)) return 'coat'
    if (/\bblazer\b/.test(text)) return 'blazer'
    if (/\bcardigan\b/.test(text)) return 'cardigan'
    if (/\bvest\b/.test(text)) return 'vest'
    if (/\b(jacket|bomber|trench|parka|windbreaker)\b/.test(text)) return 'jacket'
    return 'jacket'
  }

  if (category === 'top') {
    if (/\b(button-up|button-down|button shirt|buttonup|buttondown|button-front|button front|collared shirt)\b/.test(text)) return 'button-shirt'
    if (/\b(t-shirt|tee|graphic tee)\b/.test(text)) return 'tee'
    if (/\btunic\b/.test(text)) return 'tunic'
    if (/\b(tank|cami|camisole|shell|sleeveless top|halter)\b/.test(text)) return 'tank'
    if (/\b(sweater|knitwear|pullover|turtleneck)\b/.test(text)) return 'sweater'
    if (/\bcardigan\b/.test(text)) return 'cardigan'
    if (/\bhoodie\b/.test(text)) return 'hoodie'
    if (/\bsweatshirt\b/.test(text)) return 'sweatshirt'
    return 'tee'
  }

  return 'other'
}
