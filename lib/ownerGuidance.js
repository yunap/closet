import {
  OWNER_CONSTRAINT_ACTIVITY_VALUES,
  OWNER_CONSTRAINT_CATEGORY_VALUES,
  OWNER_CONSTRAINT_FOOTWEAR_VALUES,
  OWNER_CONSTRAINT_OCCASION_VALUES,
  OWNER_CONSTRAINT_SEASON_VALUES,
  OWNER_CONSTRAINT_WEATHER_VALUES,
} from './ownerConstraints.js'
import { pieceMatchesFootwear } from '../styling-engine/attributes.js'

export const OWNER_GUIDANCE_MATERIAL_VALUES = ['canvas', 'leather', 'tweed']
export const OWNER_GUIDANCE_SITUATION_VALUES = ['office', 'client']
const GUIDANCE_MATERIALS = OWNER_GUIDANCE_MATERIAL_VALUES

const normalized = value => String(value || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
const unique = values => [...new Set((Array.isArray(values) ? values : [values]).map(normalized).filter(Boolean))]
const hasTerm = (text, term) => new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i').test(text)

const pluralTerms = {
  dress: ['dress', 'dresses'],
  shoes: ['shoe', 'shoes'],
  outerwear: ['outerwear'],
  accessory: ['accessory', 'accessories'],
  top: ['top', 'tops'],
  bottom: ['bottom', 'bottoms'],
}

const contextAliases = {
  occasion: {
    'smart casual': ['smart casual'],
    'gallery / art event': ['gallery', 'art event'],
    'outdoor daytime social': ['outdoor daytime social'],
    travel: ['travel', 'trip', 'trips'],
    concert: ['concert', 'concerts'],
    evening: ['evening', 'evenings'],
    city: ['city'],
    casual: ['casual'],
  },
  activity: {
    hiking: ['hiking', 'hike', 'hikes'],
    walking: ['walking', 'walk', 'walks'],
  },
  season: {
    spring: ['spring'], summer: ['summer'], fall: ['fall', 'autumn'], winter: ['winter'],
  },
  weather: {
    hot: ['hot weather', 'heat'],
    cold: ['cold weather', 'cold'],
    rainy: ['rainy', 'rain'],
    wet_exposure: ['wet weather', 'wet conditions', 'mud', 'muddy'],
  },
  situation: {
    office: ['office', 'work'],
    client: ['client', 'clients'],
  },
}

const allowedContexts = {
  occasion: new Set(OWNER_CONSTRAINT_OCCASION_VALUES),
  activity: new Set(OWNER_CONSTRAINT_ACTIVITY_VALUES),
  season: new Set(OWNER_CONSTRAINT_SEASON_VALUES),
  weather: new Set(OWNER_CONSTRAINT_WEATHER_VALUES),
}

export function validateOwnerGuidanceApplicability(raw = {}) {
  if (!raw || Number(raw.version || 1) !== 1) return null
  const reach = String(raw.reach || raw.scope || '')
  if (!['universal', 'garment', 'context', 'garment_context', 'unresolved'].includes(reach)) return null
  const garment = raw.garment || {}
  const context = raw.context || {}
  const value = {
    version: 1,
    reach,
    garment: {
      piece_ids: [...new Set((garment.piece_ids || []).map(Number).filter(id => Number.isInteger(id) && id > 0))],
      categories: unique(garment.categories).filter(item => OWNER_CONSTRAINT_CATEGORY_VALUES.includes(item)),
      footwear: unique(garment.footwear).filter(item => OWNER_CONSTRAINT_FOOTWEAR_VALUES.includes(item)),
      materials: unique(garment.materials).filter(item => GUIDANCE_MATERIALS.includes(item)),
    },
    context: {
      occasions: unique(context.occasions).filter(item => allowedContexts.occasion.has(item)),
      activities: unique(context.activities).filter(item => allowedContexts.activity.has(item)),
      seasons: unique(context.seasons).filter(item => allowedContexts.season.has(item)),
      weather: unique(context.weather).map(item => item.replaceAll(' ', '_')).filter(item => allowedContexts.weather.has(item)),
      situations: unique(context.situations).filter(item => OWNER_GUIDANCE_SITUATION_VALUES.includes(item)),
    },
    source: String(raw.source || 'model_explicit').slice(0, 60),
  }
  const hasGarment = Boolean(value.garment.piece_ids.length || value.garment.categories.length || value.garment.footwear.length || value.garment.materials.length)
  const hasContext = Boolean(value.context.occasions.length || value.context.activities.length || value.context.seasons.length || value.context.weather.length || value.context.situations.length)
  if (reach === 'garment' && !hasGarment) return null
  if (reach === 'context' && !hasContext) return null
  if (reach === 'garment_context' && (!hasGarment || !hasContext)) return null
  if (reach === 'unresolved') return { ...value, garment: { piece_ids: [], categories: [], footwear: [], materials: [] }, context: { occasions: [], activities: [], seasons: [], weather: [], situations: [] } }
  return value
}

export function extractOwnerGuidanceApplicability(note, { firmRuleProposal = null } = {}) {
  const text = normalized(note)
  if (firmRuleProposal) {
    const selectorType = firmRuleProposal.selectorType || firmRuleProposal.selector_type
    const selectorValues = firmRuleProposal.selectorValues || firmRuleProposal.selector_values || []
    const dimension = firmRuleProposal.contextDimension || firmRuleProposal.context_dimension
    const contextValues = firmRuleProposal.contextValues || firmRuleProposal.context_values || []
    const garment = { piece_ids: [], categories: [], footwear: [], materials: [] }
    if (selectorType === 'category') garment.categories = selectorValues
    if (selectorType === 'footwear') garment.footwear = selectorValues
    const context = { occasions: [], activities: [], seasons: [], weather: [], situations: [] }
    const field = { occasion: 'occasions', activity: 'activities', season: 'seasons', weather: 'weather' }[dimension]
    if (field) context[field] = contextValues
    const fromProposal = validateOwnerGuidanceApplicability({ version: 1, reach: 'garment_context', garment, context, source: 'validated_firm_proposal' })
    if (fromProposal) return fromProposal
  }

  const footwear = OWNER_CONSTRAINT_FOOTWEAR_VALUES.filter(value => hasTerm(text, value))
  const categories = OWNER_CONSTRAINT_CATEGORY_VALUES.filter(value => (pluralTerms[value] || []).some(term => hasTerm(text, term)))
  const materials = GUIDANCE_MATERIALS.filter(value => hasTerm(text, value))
  const context = { occasions: [], activities: [], seasons: [], weather: [], situations: [] }
  for (const [dimension, aliases] of Object.entries(contextAliases)) {
    const field = { occasion: 'occasions', activity: 'activities', season: 'seasons', weather: 'weather', situation: 'situations' }[dimension]
    context[field] = Object.entries(aliases).filter(([, terms]) => terms.some(term => hasTerm(text, term))).map(([value]) => value)
  }
  const hasGarment = Boolean(footwear.length || categories.length || materials.length)
  const hasContext = Object.values(context).some(values => values.length)
  return validateOwnerGuidanceApplicability({
    version: 1,
    reach: hasGarment && hasContext ? 'garment_context' : hasGarment ? 'garment' : hasContext ? 'context' : 'unresolved',
    garment: { piece_ids: [], categories, footwear, materials },
    context,
    source: hasGarment || hasContext ? 'deterministic_explicit_text' : 'unresolved',
  })
}

// Item 12's deferred fast path (feedback-routing-proposal.md): "I never wear sandals for hiking",
// typed inside an existing trip thread, measured at five provider iterations re-reading trip and
// shoe context before the sentence was even stored — the model turn was pure overhead for a
// sentence extractOwnerGuidanceApplicability can already resolve deterministically on its own.
//
// The trigger list is deliberately narrow, and "never"/"always" is not a style choice — it is the
// signal that separates a durable standing rule from a momentary correction about the outfit on
// screen. A 2026-07-12 guardrail (see the 'freeform ask correction turns do NOT auto-store the raw
// question as a preference' test) exists precisely because auto-storing raw text as a global
// preference mis-filed plain requests and in-context corrections in production — "I do not wear
// flats", said mid-conversation about an active outfit, resolves through this same controlled
// vocabulary (garment: flats) but does NOT carry an explicit durability marker, so it is exactly
// the ambiguous case that must keep going through the model. Do not widen this list with weaker
// negations ("don't wear", "won't wear", "avoid wearing") without re-checking that guardrail test.
const EXPLICIT_PROHIBITION_PATTERNS = [
  /\bnever wear\b/i,
  /\balways avoid wearing\b/i,
]

export function detectExplicitProhibition(note) {
  const text = String(note || '').trim()
  if (!text || !EXPLICIT_PROHIBITION_PATTERNS.some(pattern => pattern.test(text))) return null
  const applicability = extractOwnerGuidanceApplicability(text)
  if (!applicability || applicability.reach === 'unresolved') return null
  return applicability
}

// Plain-language "Used when: …" text. The owner never sees reach/dimension names — she sees the
// terms themselves, in the order a person would say them.
export function describeOwnerGuidanceScope(value) {
  if (!value || value.reach === 'unresolved') return ''
  if (value.reach === 'universal') return 'every request'
  // Material before type, the way a person says it: "canvas sneakers", not "sneakers canvas".
  const garment = [...value.garment.materials, ...value.garment.footwear, ...value.garment.categories]
  const context = [
    ...value.context.occasions,
    ...value.context.activities,
    ...value.context.seasons,
    ...value.context.weather.map(item => `${item.replaceAll('_', ' ')} weather`),
    ...value.context.situations,
  ]
  // Garment and context both have to match, so join them with "and" rather than a separator that
  // could be read as a list of alternatives. Values inside one dimension really are alternatives.
  return [garment.join(' '), context.join(', ')].filter(Boolean).join(' and ')
}

export function ownerGuidanceApplicabilityForFeedback(row = {}) {
  let payload = row.payload || {}
  if (typeof payload === 'string') { try { payload = JSON.parse(payload || '{}') || {} } catch { payload = {} } }
  return validateOwnerGuidanceApplicability(payload.ownerGuidanceApplicability) || null
}

// Accepted synthesis lessons predate direct-guidance routing and keep their public payload shape.
// Adapt that shape here so both sources use one executable relevance matcher.
export function ownerGuidanceApplicabilityFromSynthesis(raw = {}) {
  const scope = String(raw?.scope || '')
  const reach = { piece: 'garment', context: 'context', piece_context: 'garment_context' }[scope]
  if (!reach) return null
  return validateOwnerGuidanceApplicability({
    version: raw.version,
    reach,
    garment: { piece_ids: raw.piece_ids, categories: [], footwear: [], materials: [] },
    context: {
      occasions: raw.occasions,
      activities: raw.activities,
      seasons: raw.seasons,
      weather: raw.weather_terms,
      situations: [],
    },
    source: 'accepted_synthesis',
  })
}

const contextMatches = (wanted, request = {}) => {
  const weather = request.weather || {}
  const requestValues = {
    occasions: normalized(request.occasion),
    activities: normalized(request.activity),
    seasons: normalized(request.season),
  }
  for (const field of ['occasions', 'activities', 'seasons']) {
    if (wanted[field].length && !wanted[field].includes(requestValues[field])) return false
  }
  if (wanted.weather.length) {
    const weatherText = normalized(typeof weather === 'string' ? weather : request.weatherText)
    if (!wanted.weather.some(value => Boolean(weather?.[value]) || hasTerm(weatherText, value.replaceAll('_', ' ')))) return false
  }
  if (wanted.situations.length) {
    const requestText = normalized(request.requestText)
    if (!wanted.situations.some(value => hasTerm(requestText, value))) return false
  }
  return true
}

const garmentMatches = (wanted, pieces = []) => pieces.some(piece => {
  const source = piece.piece || piece
  const materials = [source.fabric_category, ...(Array.isArray(source.fiber_content) ? source.fiber_content : [])].map(normalized)
  const tests = []
  if (wanted.piece_ids.length) tests.push(wanted.piece_ids.includes(Number(piece.id)))
  if (wanted.categories.length) tests.push(wanted.categories.includes(normalized(source.category)))
  if (wanted.footwear.length) tests.push(wanted.footwear.some(value => pieceMatchesFootwear(source, value)))
  if (wanted.materials.length) tests.push(wanted.materials.some(value => materials.includes(value)))
  return tests.length > 0 && tests.every(Boolean)
})

export function ownerGuidanceApplies(applicability, { requestContext = {}, requestContexts = [], pieces = [] } = {}) {
  const value = validateOwnerGuidanceApplicability(applicability)
  if (!value || value.reach === 'unresolved') return false
  if (value.reach === 'universal') return true
  const garmentOkay = garmentMatches(value.garment, pieces)
  const contexts = requestContexts.length ? requestContexts : [requestContext]
  const contextOkay = contexts.some(context => contextMatches(value.context, context))
  if (value.reach === 'garment') return garmentOkay
  if (value.reach === 'context') return contextOkay
  return garmentOkay && contextOkay
}
