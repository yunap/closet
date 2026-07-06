// Attributes Module
// Acts as the single entry point for interpreting garment text when structured metadata is not yet populated.
import { confidenceFromProfile } from './taggerMerge.js'

export const FIBER_VALUES = ['wool', 'merino', 'cashmere', 'alpaca', 'mohair', 'fleece', 'down',
  'cotton', 'linen', 'silk', 'tencel', 'modal', 'rayon', 'viscose', 'polyester', 'nylon',
  'acrylic', 'spandex', 'leather', 'suede', 'denim', 'unknown']
export const INSULATING_FIBERS = new Set(['wool', 'merino', 'cashmere', 'alpaca', 'mohair', 'fleece', 'down'])
export const FORMALITY_VALUES = ['lounge', 'everyday', 'elevated', 'dressy']
export const HEEL_HEIGHT_VALUES = ['flat', 'low', 'mid', 'high']
export const WALK_SUPPORT_VALUES = ['high', 'medium', 'low']

const STRUCTURE_FIT_CONFIDENCE_FIELDS = new Set([
  'silhouette',
  'fit_on_body',
  'tuck_behavior',
  'waistband_type',
  'sleeve_type'
])

export function getFieldConfidence(piece, field) {
  const confidence = String(confidenceFromProfile(piece, field) || '').toLowerCase()
  if (['manual', 'high', 'medium', 'low'].includes(confidence)) return confidence
  return piece?.tag_state === 'provisional' && STRUCTURE_FIT_CONFIDENCE_FIELDS.has(field) ? 'low' : 'medium'
}

function trustedField(piece, field) {
  const confidence = getFieldConfidence(piece, field)
  return confidence === 'manual' || confidence === 'high' || confidence === 'medium'
}

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
    trustedField(p, 'silhouette') ? p.silhouette || '' : '',
    p.fabric_category || '',
    p.fabric_weight || '',
    ...(Array.isArray(p.fiber_content) ? p.fiber_content : []),
    trustedField(p, 'fit_on_body') ? p.fit_on_body || '' : '',
    trustedField(p, 'tuck_behavior') ? p.tuck_behavior || '' : '',
    trustedField(p, 'waistband_type') ? p.waistband_type || '' : '',
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
  if (p.fabric_weight) {
    const fw = String(p.fabric_weight).toLowerCase().trim()
    if (fw === 'heavy') return 'heavy'
    if (fw === 'ultralight' || fw === 'light' || fw === 'lightweight') return 'light'
    if (fw === 'medium') return 'medium'
  }
  return null
}

export const pieceFabricWeight = fabricWeight

export function formalityRank(value) {
  const normalized = String(value || '').toLowerCase().trim()
  const idx = FORMALITY_VALUES.indexOf(normalized)
  return idx === -1 ? null : idx
}

export function pieceFormality(p) {
  const normalized = String(p?.formality || '').toLowerCase().trim()
  return formalityRank(normalized) !== null ? normalized : null
}

export function pieceHeelHeight(p) {
  const normalized = String(p?.heel_height || '').toLowerCase().trim()
  return HEEL_HEIGHT_VALUES.includes(normalized) ? normalized : null
}

export function pieceWalkSupport(p) {
  const normalized = String(p?.walk_support || '').toLowerCase().trim()
  return WALK_SUPPORT_VALUES.includes(normalized) ? normalized : null
}

export function pieceBareness(p) {
  if (p?.style_profile_json?.bareness) {
    return String(p.style_profile_json.bareness).toLowerCase().trim()
  }
  if (p?.sleeve_type && /\b(sleeveless|tank|strapless|halter|camisole)\b/i.test(p.sleeve_type)) {
    return 'high'
  }
  if (p?.length_hits_at && /\b(mini|short|mid-thigh|upper-thigh)\b/i.test(p.length_hits_at)) {
    return 'high'
  }
  return null
}

export function pieceCoverage(p) {
  if (p?.style_profile_json?.coverage) {
    return String(p.style_profile_json.coverage).toLowerCase().trim()
  }
  if (p?.sleeve_type && /\b(long)\b/i.test(p.sleeve_type)) {
    return 'full-insulating'
  }
  if (p?.length_hits_at && /\b(full|ankle|floor|maxi)\b/i.test(p.length_hits_at)) {
    return 'full-insulating'
  }
  return null
}

export function pieceHasInsulatingFiber(p) {
  const fibers = Array.isArray(p?.fiber_content) ? p.fiber_content : []
  return fibers.some(f => INSULATING_FIBERS.has(String(f).toLowerCase().trim()))
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

export function isExpressiveForAnchor(p) {
  const loudness = patternLoudness(p)
  if (loudness === 'loud' || loudness === 'medium') {
    // Exclude knit casual basics (tees, sweatshirts, hoodies) from anchor-gate expressiveness
    const kind = garmentKind(p)
    if (kind === 'tee' || kind === 'sweatshirt' || kind === 'hoodie') {
      return false
    }
    return pieceSoftness(p) >= 1
  }
  return false
}

export function pieceSoftness(p) {
  const readsAs = String(p.reads_as || '').toLowerCase()
  const name = String(p.name || '').toLowerCase()
  const profile = p.style_profile_json || {}
  const bestUse = String(profile.style_notes?.best_use || '').toLowerCase()
  const lanes = profile.style_lanes || {}
  const drapeNotes = String(profile.real_wear_notes?.drape || '').toLowerCase()
  const fitNotes = String(profile.real_wear_notes?.fit || '').toLowerCase()

  const delicacyKeywords = ['sheer', 'lace', 'silk', 'chiffon', 'gauze', 'drapey', 'drape', 'satin', 'delicate', 'romantic']
  const hasDelicacySignal = 
    textIncludesAny(readsAs, delicacyKeywords) ||
    textIncludesAny(name, delicacyKeywords) ||
    textIncludesAny(bestUse, delicacyKeywords) ||
    (lanes.romantic_soft > 0) ||
    (lanes.boho_romantic > 0) ||
    textIncludesAny(drapeNotes, ['drape', 'fluid', 'soft', 'flow', 'flowing']) ||
    textIncludesAny(fitNotes, ['drape', 'fluid', 'soft', 'flow', 'flowing'])

  let softnessScore = 0
  if (hasDelicacySignal) {
    softnessScore += 2
  }

  // Fabric weight as a secondary contributor
  if (fabricWeight(p) === 'light') {
    softnessScore += 1
  }

  // If there are general softness keywords in reads_as or name but no primary delicacy signal
  if (!hasDelicacySignal) {
    if (textIncludesAny(readsAs, ['relaxed', 'loose', 'soft']) || textIncludesAny(name, ['relaxed', 'loose', 'soft'])) {
      softnessScore += 1
    }
  }

  return softnessScore
}

export function pieceGroundingValue(p) {
  const blob = pieceTextBlob(p)
  const colors = (p.colors || []).map(c => String(c).toLowerCase())
  const dark = colors.some(c => ['black','navy','denim','brown','charcoal','dark grey','dark gray','deep navy','chocolate'].includes(c)) || textIncludesAny(blob, ['black','navy','dark denim','dark blue','charcoal','brown','chocolate'])
  const light = colors.some(c => ['white','cream','beige','taupe','oatmeal','ivory','nude'].includes(c)) || textIncludesAny(blob, ['white','cream','beige','oatmeal','ivory','nude','light'])
  const denseTexture = fabricWeight(p) === 'heavy' || textIncludesAny(blob, ['denim','corduroy','wool','twill','utility','canvas','leather','structured','pencil','maxi','crochet','heavy','substantial','ribbed'])
  const airyTexture = fabricWeight(p) === 'light' || textIncludesAny(blob, ['lace','gauzy','chiffon','sheer','silk','satin','delicate','soft floral','airy','lightweight'])

  const bKind = bottomKind(p)
  const isMini = bKind === 'skirt-mini' || bKind === 'shorts'
  const isMaxi = bKind === 'skirt-maxi'
  const isMidi = bKind === 'skirt-midi'

  const longLine = isMaxi || isMidi || textIncludesAny(blob, ['maxi','midi','full length','full-length','long','straight','flare','bootcut','wide-leg','wide leg','column','pencil'])
  const abrupt = isMini || textIncludesAny(blob, ['mini','short','cropped','crop','knee-length','knee length'])

  let grounding = 0
  if (dark) grounding += 3
  if (denseTexture) grounding += 2
  if (longLine) grounding += 2
  if (light) grounding -= 1
  if (airyTexture) grounding -= 2
  if (abrupt) grounding -= 2

  // Fix B: Grounding accounts for garment length/coverage
  // Shorts and mini-length bottoms cap at 2 regardless of fabric density
  if (p.category === 'bottom' && isMini) {
    return Math.min(grounding, 2)
  }

  return grounding
}

export function pieceStructureValue(p) {
  const blob = pieceTextBlob(p)
  const denseTexture = fabricWeight(p) === 'heavy' || textIncludesAny(blob, ['denim','corduroy','wool','twill','utility','canvas','leather','structured','pencil','maxi','crochet','heavy','substantial','ribbed'])
  return (denseTexture ? 2 : 0) + (textIncludesAny(blob, ['tailored','structured','utility','straight','pencil','crisp','button-up','button down','button-down']) ? 1 : 0)
}

export function groundingLevel(p) {
  const grounding = pieceGroundingValue(p)
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

export function wardrobeCategoryGroup(pieceOrCategory = '') {
  const raw = typeof pieceOrCategory === 'string'
    ? pieceOrCategory
    : (pieceOrCategory?.category || pieceOrCategory?.type || pieceOrCategory?.name || '')
  const value = String(raw || '').toLowerCase().trim()
  if (/\b(top|shirt|blouse|tee|t-shirt|tank|shell|sweater|knit|cardigan as top|tunic|hoodie|sweatshirt)\b/.test(value) || /tops?/.test(value)) return 'top'
  if (/\b(bottom|pant|trouser|jean|skirt|short|culotte|legging)\b/.test(value) || /bottoms?/.test(value)) return 'bottom'
  if (/\b(dress|jumpsuit)\b/.test(value) || /dresses/.test(value)) return 'dress'
  if (/\b(outerwear|jacket|cardigan|coat|blazer|vest|overshirt|kimono)\b/.test(value)) return 'outerwear'
  if (/\b(shoe|boot|flat|loafer|sandal|sneaker|heel|mule|clog)\b/.test(value) || /shoes/.test(value)) return 'shoes'
  if (/\b(accessor|necklace|pendant|earring|bracelet|bag|tote|belt|scarf|watch|ring)\b/.test(value)) return 'accessory'
  return value || 'other'
}

export function isAccessory(p) {
  return wardrobeCategoryGroup(p) === 'accessory'
}

export function isOuterwear(p) {
  return wardrobeCategoryGroup(p) === 'outerwear'
}

export function isTop(p) {
  return wardrobeCategoryGroup(p) === 'top'
}

function getOccasionConfidence(piece, occasion) {
  try {
    const profile = typeof piece?.style_profile_json === 'string'
      ? JSON.parse(piece.style_profile_json)
      : piece?.style_profile_json
    const info = profile?.garment_intelligence || {}
    const confMap = info.occasion_confidence || {}
    return String(confMap[occasion] || '').toLowerCase().trim()
  } catch (err) {
    return ''
  }
}

export function pieceOccasionScore(piece = {}, occasion = '') {
  const requested = String(occasion || '').toLowerCase().trim()
  if (!requested) return 0
  
  const occasions = Array.isArray(piece.occasions) 
    ? piece.occasions.map(o => String(o).toLowerCase()) 
    : []
  const confidence = getOccasionConfidence(piece, requested)
  
  if (confidence === 'high') return 15
  if (occasions.includes(requested) && confidence !== 'low') return 12
  if (confidence === 'medium') return 10
  if (confidence === 'low') return -15
  return 0
}

export function isDarkPiece(p) {
  if (!p) return false
  const colors = (p.colors || []).map(c => String(c).toLowerCase())
  const lightColors = ['white', 'cream', 'beige', 'taupe', 'oatmeal', 'ivory', 'nude', 'light grey', 'light gray', 'soft white', 'sand', 'light blue']
  if (colors.some(c => lightColors.includes(c))) return false

  const blob = pieceTextBlob(p)
  if (/\b(white|cream|beige|taupe|oatmeal|ivory|nude|light|pale|sand)\b/i.test(blob)) return false

  const darkColors = ['black', 'navy', 'denim', 'charcoal', 'dark grey', 'dark gray', 'deep navy', 'chocolate', 'dark blue', 'espresso', 'brown']
  if (colors.some(c => darkColors.includes(c))) return true

  return /\b(black|navy|dark|charcoal|brown|chocolate|espresso)\b/i.test(blob)
}

export function pieceMatchesMaterial(p, material) {
  const blob = pieceTextBlob(p)
  const cleanMat = material.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
  const regex = new RegExp(`\\b${cleanMat}\\b`, 'i')
  return regex.test(blob)
}

export function pieceMatchesFootwear(p, footwear) {
  const blob = pieceTextBlob(p)
  const cleanFw = footwear.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
  const regex = new RegExp(`\\b${cleanFw}\\b`, 'i')
  return regex.test(blob)
}

export function pieceMatchesPieceName(p, name) {
  const blob = pieceTextBlob(p)
  const cleanName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
  const regex = new RegExp(`\\b${cleanName}\\b`, 'i')
  return regex.test(blob)
}

export function necklineWarmth(p) {
  if (!p) return 'neutral'
  const neck = String(p.neckline || '').toLowerCase().trim()
  if (/\b(mock|cowl|turtle)\b/i.test(neck)) return 'warm'
  return 'neutral'
}

export function sleeveCoverage(p) {
  if (!p || !p.sleeve_type) return null
  if (getFieldConfidence(p, 'sleeve_type') === 'low') return null
  const s = String(p.sleeve_type || '').toLowerCase().trim()
  if (/\b(3\/4|long)\b/i.test(s)) return 'long'
  if (/\b(short|cap|elbow)\b/i.test(s)) return 'short'
  if (/\b(none|sleeveless|strap|tank|cami|camisole|halter)\b/i.test(s)) return 'none'
  return null
}
