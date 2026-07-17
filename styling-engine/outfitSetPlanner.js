// Outfit-set planning engine — multi-outfit composition under shared constraints.
//
// Step 6 of the freeform re-architecture (docs/flows/freeform-stylist-chat.md,
// "Step 6 resolution — the planning engine"): the model composes outfits
// itself from a per-slot piece roster this file builds (buildPlanSlotWorkbench),
// then calls submit_plan_outfits; validateSubmittedPlanOutfits and
// assembleSubmittedPlanOutfits check and assemble the result. Deterministic code
// guarantees only garment truth and structural/register/weather/footwear
// correctness (validateSlotOutfitConstraints, describeOutfitStructureGap,
// filterWholeWardrobePiecesForGeneration's gates) — taste and composition are
// the model's job. (Spec 14, 2026-07-16: retired the prior engine-composed path,
// composeOutfitSet, and its taste-scorer layer — see
// docs/freeform-rearchitecture-handoff.md.)
//
// Per-slot live weather is wired: each slot resolves its own forecast from
// slot.location + slot.date (or the plan date_range) via
// getWeatherProfileForPlan, so a 60°F coast day on an otherwise-hot inland trip
// composes for the coast. User-stated per-slot weather still wins over the
// forecast. The signed reuse dial + per-category repeat rules + the anchor
// exemption are wired too: constraints.reuse ('maximize'|'diversify'|'none'),
// constraints.no_repeat / allow_repeat (per category group), and
// constraints.shared_anchor_ids (soft-pinned across slots and exempt from
// no_repeat). The plan report is objective-driven: a piece_budget leads with
// the roster + combination count, a diversified / no_repeat plan leads with the
// repeat schedule, everything else keeps the packing-reuse headline (see
// buildPlanReport).

import { getWeatherProfileForPlan } from './weather.js'
import {
  filterWholeWardrobePiecesForGeneration,
  isOutfitStructurallyValid,
  weatherProfileFromContext,
  wardrobeCategoryGroup,
  footwearComfortVerdict
} from './rules.js'
import { bottomKind, fabricWeight, garmentKind, formalityRank, pieceFormality } from './attributes.js'
import { resolveActivityProfile } from './footwear-comfort.js'
import { normalizeOccasion, normalizeActivity } from './stylingIntent.js'
import { resolveOccasionProfile } from './occasions.js'

export function normalizeTripPieceName(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function annotateTripOutfit(outfit, slot, index = 0, { slotIndex = 0, slotTotal = 1, source = 'trip_precompose', weatherLabel = '' } = {}) {
  if (!outfit || !slot) return outfit
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const pieceIds = pieces.map(piece => Number(piece.id)).filter(Boolean)
  const existingReason = String(outfit.reason || '').trim()
  const existingWatch = String(outfit.watchFor || '').trim()
  return {
    ...outfit,
    pieces: pieces.length ? pieces : outfit.pieces,
    pieceIds: pieceIds.length ? pieceIds : outfit.pieceIds,
    label: slot.label,
    title: slot.label,
    bestFor: slot.bestFor,
    occasion: slot.occasion,
    activity: slot.activity,
    tripSlot: slot.id,
    tripNote: slot.planNote || '',
    coverage: slot.coverage || slot.bestFor,
    targetOutfits: slot.targetOutfits || 1,
    tripSummary: slot.tripSummary || null,
    coveragePosition: `${slot.label} · ${slotIndex + 1} of ${slotTotal}`,
    slotWeather: weatherLabel,
    source,
    strength: '',
    mission: '',
    missionId: '',
    missionLabel: '',
    dominantDirection: '',
    silhouette: '',
    reason: existingReason,
    watchFor: existingWatch && !/^none$/i.test(existingWatch) ? existingWatch : ''
  }
}

function describeTripPieceReuse(outfits = []) {
  const byPiece = new Map()
  for (const outfit of outfits || []) {
    const slotLabel = outfit?.label || outfit?.title || outfit?.bestFor || 'look'
    for (const piece of outfit?.pieces || []) {
      const id = Number(piece?.id)
      const key = id || normalizeTripPieceName(piece?.name || '')
      if (!key) continue
      if (!byPiece.has(key)) {
        byPiece.set(key, {
          name: piece?.name || 'Garment',
          labels: new Set(),
          count: 0
        })
      }
      const entry = byPiece.get(key)
      entry.count += 1
      entry.labels.add(slotLabel)
    }
  }
  const repeated = [...byPiece.values()]
    .filter(entry => entry.count > 1)
    .map(entry => ({
      name: entry.name,
      count: entry.count,
      where: [...entry.labels].slice(0, 3).join(', ')
    }))
  return {
    distinctPieces: byPiece.size,
    repeated,
    summary: repeated.length
      ? `${byPiece.size} distinct pieces; repeats: ${repeated.slice(0, 4).map(entry => `${entry.name} -> ${entry.where}`).join('; ')}`
      : `${byPiece.size} distinct pieces; no repeated pieces needed.`
  }
}

function collectPieceRoster(outfits = []) {
  const seen = new Set()
  const names = []
  for (const outfit of outfits || []) {
    for (const piece of outfit?.pieces || []) {
      const key = Number(piece?.id) || normalizeTripPieceName(piece?.name || '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      names.push(piece?.name || 'Garment')
    }
  }
  return names
}

// Objective-driven plan report (build step 5). The report sections are chosen
// by what the set is FOR, not hardcoded to packing: a capsule (piece_budget)
// leads with the roster + how many outfits it yields; a diversified plan or one
// with a no_repeat rule leads with the repeat schedule (its success is "nothing
// repeats"); everything else keeps the packing-reuse headline. Returns the
// report lines to append to the shared plan lines.
function buildPlanReport(pieceReuse, tripOutfits = [], { reuseMode = '', noRepeatCats = new Set(), pieceBudget = 0 } = {}) {
  const outfitCount = tripOutfits.length
  const lines = []
  if (pieceBudget > 0) {
    const roster = collectPieceRoster(tripOutfits)
    const shown = roster.slice(0, 12).join(', ')
    lines.push(`Piece roster (${pieceReuse.distinctPieces}): ${shown}${roster.length > 12 ? ', …' : ''}`)
    lines.push(`${pieceReuse.distinctPieces} pieces → ${outfitCount} ${outfitCount === 1 ? 'outfit' : 'outfits'}`)
    lines.push(pieceReuse.distinctPieces <= pieceBudget
      ? `Within the ${pieceBudget}-piece budget.`
      : `Over the ${pieceBudget}-piece budget by ${pieceReuse.distinctPieces - pieceBudget} — tighten a slot or allow more repeats.`)
    return lines
  }
  if (reuseMode === 'diversify' || noRepeatCats.size) {
    if (!pieceReuse.repeated.length) {
      lines.push(`Every look is distinct — no piece repeats across the ${outfitCount} ${outfitCount === 1 ? 'outfit' : 'outfits'}.`)
    } else {
      lines.push(`Repeat schedule: ${pieceReuse.repeated.slice(0, 4).map(entry => `${entry.name} (${entry.where})`).join('; ')}`)
    }
    return lines
  }
  if (pieceReuse.summary) lines.push(`Packing reuse: ${pieceReuse.summary}`)
  return lines
}

function buildWeatherLine(slotWeather = []) {
  const parts = (Array.isArray(slotWeather) ? slotWeather : [])
    .filter(entry => entry?.label && entry?.weather)
    .map(entry => `${entry.label} — ${entry.weather}`)
  return parts.length ? `Weather used: ${parts.join('; ')}` : ''
}

// Per-slot coverage gaps (capsule review Point 2): when the wardrobe can't
// fill a slot's requested count, that used to just be a thin/missing card with
// no explanation — the model had no deterministic signal to notice or explain
// it. Uses data the composer already computed (how many distinct outfits
// passed the gates vs how many candidates existed at all) rather than
// guessing WHICH category is missing, matching the "flag, don't guess"
// discipline: a wrong specific guess (e.g. "missing shoes" when the real
// issue was weather) would be worse than an honest, general gap note.
function describeSlotCoverageGap(slot = {}, { requestedCount = 0, composedCount = 0, candidateCount = 0, exhaustedByUsedCombos = false, compatibleCombinationCount = 0, ceilingRank = null, composedBy = 'engine' } = {}) {
  if (composedCount >= requestedCount) return ''
  const label = slot?.label || slot?.bestFor || 'this use case'
  const ceilingLabel = ['lounge', 'everyday', 'elevated', 'dressy'][ceilingRank] || 'compatible'
  if (composedBy === 'model') {
    const submittedWord = composedCount === 1 ? 'outfit was' : 'outfits were'
    return `[coverage gap: "${label}" needed ${requestedCount} look${requestedCount === 1 ? '' : 's'} but only ${composedCount} valid ${submittedWord} submitted — the other attempts failed validation]`
  }
  if (exhaustedByUsedCombos) {
    const supported = Math.max(composedCount, compatibleCombinationCount)
    return `[missing wardrobe gap: "${label}" needed ${requestedCount} distinct look${requestedCount === 1 ? '' : 's'} but the capsule roster only supports ${supported} before repeating — not enough distinct ${ceilingLabel}-compatible combinations for the full rotation]`
  }
  if (composedCount === 0) {
    return candidateCount > 0
      ? `[missing wardrobe gap: "${label}" — no outfit passed the ${slot.occasion || 'occasion'}/weather/register gates; the wardrobe may be missing a category (top, bottom, dress, or shoes) suited to this use case]`
      : `[missing wardrobe gap: "${label}" — no candidate outfit could be assembled for ${slot.occasion || 'this occasion'}; the wardrobe may be missing a category (top, bottom, dress, or shoes) for this use case]`
  }
  return `[missing wardrobe gap: "${label}" needed ${requestedCount} distinct look${requestedCount === 1 ? '' : 's'} but the wardrobe only supports ${composedCount} — not enough variety for the full rotation]`
}

// Distinct from describeSlotCoverageGap: that one fires when the WARDROBE
// can't fill a slot's requested count. This one fires when the PLAN itself
// asked for more outfits than PLAN_TOTAL_OUTFIT_CAP allows across the whole
// set, so normalizePlanSlots silently trimmed the slot's count before the
// wardrobe was ever asked — a live capsule test asked for 10 outfits across 5
// slots and got 8 with no signal anywhere that 2 were dropped. Both can fire
// for the same slot (the cap trims it AND the wardrobe still can't fill the
// reduced count) — they describe different causes and are both true.
function describePlanCapTrim(slot = {}) {
  const requested = Number(slot?.requestedOutfits) || 0
  const actual = Number(slot?.targetOutfits) || 0
  if (!requested || requested <= actual) return ''
  const label = slot?.label || slot?.bestFor || 'this use case'
  const cap = Number(slot?.totalOutfitCap) || PLAN_TOTAL_OUTFIT_CAP
  return `[plan trimmed: "${label}" reduced from ${requested} to ${actual} look${actual === 1 ? '' : 's'} — the plan asked for more outfits than the ${cap}-outfit total across the set allows]`
}

function buildCoverageGapLines(coverageGaps = []) {
  return (Array.isArray(coverageGaps) ? coverageGaps : []).filter(Boolean)
}

function attachTripPlanMetadata(outfits = [], { source = 'trip_precompose', composedBy = 'engine', slotWeather = [], reuseMode = '', noRepeatCats = new Set(), pieceBudget = 0, coverageGaps = [] } = {}) {
  const tripOutfits = outfits.filter(outfit => outfit?.source === source)
  if (!tripOutfits.length) return outfits
  const durationLabel = source === 'plan_outfit_set' ? 'Plan length' : 'Trip length'
  const pieceReuse = describeTripPieceReuse(tripOutfits)
  const reportLines = buildPlanReport(pieceReuse, tripOutfits, { reuseMode, noRepeatCats, pieceBudget })
  const weatherLine = buildWeatherLine(slotWeather)
  const gapLines = buildCoverageGapLines(coverageGaps)
  const bySlot = new Map()
  for (const outfit of tripOutfits) {
    const key = outfit.tripSlot || outfit.label || outfit.bestFor
    if (!bySlot.has(key)) bySlot.set(key, [])
    bySlot.get(key).push(outfit)
  }
  const coverageBySlot = new Map()
  for (const [key, group] of bySlot.entries()) {
    const first = group[0] || {}
    const count = group.length
    const lookWord = count === 1 ? 'look covers' : 'looks cover'
    coverageBySlot.set(key, `${count} ${first.label || first.title || 'trip'} ${lookWord} ${first.coverage || first.bestFor || 'this use case'}`)
  }
  return outfits.map(outfit => {
    if (outfit?.source !== source) return outfit
    const key = outfit.tripSlot || outfit.label || outfit.bestFor
    return {
      ...outfit,
      composedBy,
      pieceReuse,
      coverageLine: coverageBySlot.get(key) || '',
      tripPlanLines: [
        outfit.tripSummary?.durationText ? `${durationLabel}: ${outfit.tripSummary.durationText}` : '',
        outfit.tripSummary?.dayBreakdown ? `Coverage: ${outfit.tripSummary.dayBreakdown}` : '',
        coverageBySlot.get(key) || '',
        weatherLine,
        ...reportLines,
        ...gapLines
      ].filter(Boolean)
    }
  })
}

function tripOutfitKey(outfit = {}) {
  const ids = (outfit.pieceIds || outfit.pieces?.map(p => p.id) || []).map(Number).filter(Boolean)
  return ids.slice().sort((a, b) => a - b).join('|')
}


function isSmartCasualPlanSlot(slot = {}) {
  const text = [
    slot?.label,
    slot?.bestFor,
    slot?.coverage,
    slot?.planNote,
    slot?.occasion
  ].filter(Boolean).join(' ').toLowerCase()
  return /\bsmart[- ]?casual\b/.test(text) // ratchet-allow: slot-register classifier, not garment matching
}

function textLooksLikeEveningPlanSlot(text = '') {
  return /\b(dinners?|dining|restaurants?|drinks|wine bars?|night out|date night|evenings?)\b/i.test(String(text || '')) // ratchet-allow: slot-use-case classifier, not garment matching
}

function textLooksLikeCoastalPlanSlot(text = '') {
  return /\b(beach(?:es)?|pool(?:side)?|swim(?:ming)?|coast(?:al)?|seaside|oceanfront|shore|sand)\b/i.test(String(text || '')) // ratchet-allow: slot-use-case classifier, not garment matching
}

function normalizePlanSlotEnvironment({ label = '', bestFor = '', coverage = '', planNote = '', location = '' } = {}) {
  const text = [label, bestFor, coverage, planNote, location].filter(Boolean).join(' ')
  return textLooksLikeCoastalPlanSlot(text) ? 'beach_coastal' : ''
}

function normalizePlanEnvironment(rawEnvironment = '') {
  const value = String(rawEnvironment || '').trim().toLowerCase()
  return ['indoor', 'outdoor', 'beach_coastal'].includes(value) ? value : ''
}

function normalizePlanSlotOccasion(rawOccasion = '', { label = '', bestFor = '', coverage = '', planNote = '', environment = '' } = {}) {
  const occasion = normalizeOccasion(rawOccasion)
  const text = [label, bestFor, coverage, planNote].filter(Boolean).join(' ')
  if (occasion === 'outdoor_daytime_social' && environment === 'beach_coastal') return 'casual'
  if ((occasion === 'casual' || occasion === 'city') && textLooksLikeEveningPlanSlot(text)) return 'evening'
  return occasion
}

function slotWantsElevatedShoe(slot = {}) {
  const text = [slot?.label, slot?.bestFor, slot?.coverage, slot?.planNote, slot?.occasion].filter(Boolean).join(' ')
  const occasion = normalizeOccasion(slot?.occasion)
  return occasion === 'evening' ||
    occasion === 'gallery / art event' ||
    isSmartCasualPlanSlot(slot) ||
    textLooksLikeEveningPlanSlot(text)
}

// Slot-level register escalation (the step-6 contract's `slot.register`): an
// event weekend wants the marquee slot dressiest — rehearsal 'dressy', ceremony
// 'formal', brunch 'elevated'. Without it the wedding ceremony composed in denim
// flares + a leather zip jacket (the evening scorer credits any dark layer as
// "elevated" and never penalizes denim). Only escalates at dressy+ so everyday /
// elevated slots keep the existing occasion scorers untouched.
const REGISTER_LEVELS = { everyday: 0, elevated: 1, dressy: 2, formal: 3 }

function normalizeRegisterLevel(value = '') {
  const normalized = String(value || '').toLowerCase().trim()
  return normalized in REGISTER_LEVELS ? normalized : ''
}

function beachCoastalStatedWeather(explicitWeather = '', { environment = '' } = {}) {
  const weather = String(explicitWeather || '').trim()
  if (!weather) return ''
  // Models sometimes mark a beach slot as `weather:"indoor"` because they are
  // thinking "trip day" rather than physical environment. For a beach/coastal
  // slot, that is contradictory; let the plan-level weather or live forecast
  // drive the slot instead.
  if (environment === 'beach_coastal' && /^indoor$/i.test(weather)) return ''
  return weather
}

function describeWeatherProfile(profile = {}) {
  if (profile.isHot && profile.isCold) return 'hot days, cold nights'
  if (profile.isHot) return 'hot'
  if (profile.isCold) return 'cold'
  return 'mild'
}

function isGenericSeason(season = '') {
  const value = String(season || '').trim().toLowerCase()
  return !value || value === 'current season' || value === 'current' || value === 'year-round'
}

function isIndoorPlanSlot(slot = {}, { occasion = '', activity = '' } = {}) {
  const text = [
    slot?.label,
    slot?.best_for,
    slot?.bestFor,
    slot?.coverage,
    slot?.plan_note,
    slot?.planNote,
    occasion
  ].filter(Boolean).join(' ').toLowerCase()
  if (!text || activity === 'walking' || activity === 'hiking') return false
  if (/\b(outdoor|outside|patio|garden|hike|hiking|walk|walking|sightseeing|winery|wineries|coast|beach)\b/.test(text)) return false // ratchet-allow: slot-place classifier, not garment matching
  return /\b(office|work\s*(day|days|week)?|workday|client[- ]?facing|client|meeting|restaurants?|indoor)\b/.test(text) // ratchet-allow: slot-place classifier, not garment matching
}

function hasDeclaredPlanSlotActivity(slot = {}) {
  return slot?.activity !== undefined && slot?.activity !== null && String(slot.activity).trim() !== ''
}

function inferPlanSlotActivityFromProse(slot = {}) {
  const text = [
    slot?.label,
    slot?.best_for,
    slot?.bestFor,
    slot?.coverage,
    slot?.plan_note,
    slot?.planNote
  ].filter(Boolean).join(' ').toLowerCase()
  if (/\b(hike|hiking|trail|trek|trekking)\b/.test(text)) return 'hiking' // ratchet-allow: slot activity classifier, not garment matching
  if (!/\b(gallery|museum|dinner|restaurant|wedding|ceremony)\b/.test(text) && // ratchet-allow: slot activity classifier, not garment matching
      /\b(walk|walking|stroll|strolling|explore|exploring|sightsee|sightseeing|market)\b/.test(text)) { // ratchet-allow: slot activity classifier, not garment matching
    return 'walking'
  }
  return ''
}

function inferPlanSlotActivity(slot = {}, fallbackActivity = 'none') {
  const explicit = normalizeActivity(String(slot?.activity || 'none'))
  if (hasDeclaredPlanSlotActivity(slot)) return explicit || 'none'
  const fallback = normalizeActivity(String(fallbackActivity || 'none'))
  return inferPlanSlotActivityFromProse(slot) || fallback || explicit || 'none'
}

// Per-slot weather resolution (build step 3). Precedence: user-stated per-slot
// weather wins outright (the model set slot.weather because it knows something
// the forecast can't — e.g. an indoor event); otherwise the slot's own live
// forecast is fetched from slot.location + slot.date (or the plan date_range),
// which is what catches microclimates like a cool coast day on a hot inland
// trip; and getWeatherProfileForPlan itself falls back to the heuristic when no
// location/date is available or the fetch fails. The returned `label` is what
// the plan lines state back to the user so they can correct it conversationally.
async function resolveSlotWeather(slot = {}, { mood = '', question = '', dateRange = {}, fetchImpl } = {}) {
  const moodText = mood || question
  if (slot.statedWeather) {
    return {
      profile: { ...weatherProfileFromContext({ mood: moodText, season: slot.statedWeather }), weatherSource: 'stated' },
      label: slot.statedWeather
    }
  }
  // Fall back to `undefined` (not '') when no date is known: getWeatherProfileForPlan
  // threads the start date into the heuristic as currentDate, and only `undefined`
  // lets weatherProfileFromContext default to today for its "current season"
  // calendar guess — an empty string reads as a provided-but-invalid Date and
  // silently disables it, which would regress the keyword pre-route's weather.
  const day = slot.date || undefined
  const profile = await getWeatherProfileForPlan({
    dateRange: { start: day || dateRange.start || undefined, end: day || dateRange.end || dateRange.start || undefined },
    location: slot.location || '',
    season: slot.season,
    mood: moodText,
    ...(fetchImpl ? { fetchImpl } : {})
  })
  const descriptor = describeWeatherProfile(profile)
  if (profile.weatherSource === 'live') {
    const where = slot.location ? `, ${slot.location}` : ''
    return { profile, label: `${descriptor} (live forecast${where})` }
  }
  // Heuristic: prefer the user's own weather phrasing when they gave one, since
  // it is more informative than the coarse hot/cold/mild descriptor.
  return { profile, label: isGenericSeason(slot.season) ? descriptor : slot.season }
}

const REUSE_MODES = new Set(['maximize', 'diversify', 'none'])
const REPEAT_CATEGORY_GROUPS = new Set(['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'])

// Map the model's per-category repeat words onto the engine's category groups.
// wardrobeCategoryGroup already folds plurals ('tops' -> 'top', 'shoes' -> 'shoes')
// and most garment nouns; 'layers' is the one planning word it doesn't cover.
function normalizeRepeatCategory(value = '') {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  if (/^layers?$/.test(raw)) return 'outerwear'
  const group = wardrobeCategoryGroup(raw)
  return REPEAT_CATEGORY_GROUPS.has(group) ? group : ''
}

function toCategorySet(list = []) {
  const set = new Set()
  for (const value of Array.isArray(list) ? list : []) {
    const group = normalizeRepeatCategory(value)
    if (group) set.add(group)
  }
  return set
}

// Shared-constraint parsing (build step 4). The signed reuse dial + per-category
// repeat rules + the anchor exemption — the dimensions the multi-scenario shape
// validation surfaced (packing wants maximum reuse; a work week wants tops
// diversified but shoes may repeat; a pinned new piece must be exempt from
// no_repeat or the two constraints contradict).
export function normalizePlanConstraints(raw = {}) {
  const reuseRaw = String(raw?.reuse || '').trim().toLowerCase()
  const reuse = REUSE_MODES.has(reuseRaw) ? reuseRaw : ''
  const noRepeat = toCategorySet(raw?.no_repeat)
  const allowRepeat = toCategorySet(raw?.allow_repeat)
  // A category listed in both is a contradiction; explicit permission wins.
  for (const category of allowRepeat) noRepeat.delete(category)
  const anchorIds = new Set(
    (Array.isArray(raw?.shared_anchor_ids) ? raw.shared_anchor_ids : [])
      .map(id => Number(id))
      .filter(Boolean)
  )
  const budgetRaw = Number.parseInt(raw?.piece_budget, 10)
  const pieceBudget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : 0
  return { reuse, noRepeat, allowRepeat, anchorIds, pieceBudget }
}

function outfitCategoryPairs(outfit = {}) {
  return (Array.isArray(outfit.pieces) ? outfit.pieces : [])
    .map(piece => ({ id: Number(piece?.id), group: wardrobeCategoryGroup(piece) }))
    .filter(pair => pair.id)
}

function outfitDressId(outfit = {}) {
  const dress = (Array.isArray(outfit.pieces) ? outfit.pieces : [])
    .find(piece => wardrobeCategoryGroup(piece) === 'dress')
  return Number(dress?.id) || null
}

// Real capsule builder (path 1): when the plan carries a piece_budget, don't
// just REPORT the roster — enforce it. Pre-select ~budget versatile pieces with
// category coverage (a summer capsule must include shorts), then compose the
// slots ONLY from those, so the distinct-piece count actually lands within the
// budget. Below this floor a "capsule" can't cover top+bottom+shoes, so we keep
// the soft-report behavior instead.
const MIN_ENFORCED_CAPSULE_BUDGET = 6
const PLAN_WORKBENCH_PIECE_LIMIT = 40

const CAPSULE_NEUTRAL_COLORS = ['black', 'white', 'ivory', 'cream', 'navy', 'blue', 'grey', 'gray', 'charcoal', 'beige', 'tan', 'khaki', 'stone', 'olive', 'denim', 'brown', 'camel']

function capsuleVersatilityScore(piece = {}, { isSummer = false } = {}) {
  let score = 0
  const colors = (Array.isArray(piece.colors) ? piece.colors : []).map(color => String(color).toLowerCase())
  if (colors.some(color => CAPSULE_NEUTRAL_COLORS.some(neutral => color.includes(neutral)))) score += 12
  // A versatile capsule piece mixes across many occasions and reads as a solid.
  score += Math.min(4, (Array.isArray(piece.occasions) ? piece.occasions : []).length) * 4
  if (['solid', 'none', ''].includes(String(piece.pattern_type || '').toLowerCase())) score += 8
  const weight = fabricWeight(piece)
  if (isSummer) {
    const fabricCategory = String(piece.fabric_category || '').toLowerCase().trim()
    const fibers = (Array.isArray(piece.fiber_content) ? piece.fiber_content : []).map(f => String(f).toLowerCase().trim())
    const hasFiberOrFabric = (values) => values.includes(fabricCategory) || fibers.some(f => values.includes(f))
    if (weight === 'light') score += 10
    if (weight === 'heavy' || hasFiberOrFabric(['wool', 'cashmere', 'fleece', 'corduroy', 'tweed', 'flannel'])) score -= 24
    if (hasFiberOrFabric(['linen', 'cotton', 'viscose', 'tencel', 'gauze'])) score += 6
  }
  if (piece.recommendation_status === 'trusted') score += 4
  return score
}

// Category quotas for a ~budget-piece day capsule. Kept proportional so a bigger
// budget widens tops/bottoms rather than piling on shoes.
function capsuleQuotas(budget = 10, { isSummer = false } = {}) {
  const shoes = budget >= 30 ? 5 : budget >= 24 ? 4 : budget >= 12 ? 3 : Math.min(3, Math.max(2, Math.round(budget * 0.2)))
  const outerwear = budget >= 8 && (!isSummer || budget < 12) ? 1 : 0
  const dress = budget >= 6 ? 1 : 0
  const remaining = Math.max(0, budget - shoes - outerwear - dress)
  const bottom = Math.max(2, Math.round(remaining * 0.45))
  const top = Math.max(2, remaining - bottom)
  return { top, bottom, dress, outerwear, shoes }
}

// A coarse "these two read as the same garment" signature for capsule
// de-duplication: category + dominant color + garment kind + pattern. Two black
// solid crew tees collapse to one key; a black tee and a white tee do not.
function capsuleSimilarityKey(piece = {}) {
  const group = wardrobeCategoryGroup(piece)
  const color = String((Array.isArray(piece.colors) ? piece.colors : [])[0] || '').toLowerCase()
  const kind = group === 'bottom' ? bottomKind(piece) : garmentKind(piece)
  const pattern = String(piece.pattern_type || '').toLowerCase()
  return `${group}:${color}:${kind}:${pattern}`
}

// 'formal' isn't one of the FORMALITY_VALUES pieces are actually tagged with
// (the ceiling is 'dressy' — there's nothing above it), but the model may
// still declare a slot 'formal'. Treat it as dressy-and-up everywhere a slot's
// declared register maps to a rank, so floor derivation and ceiling
// reconciliation (Part 2, spec 19) always agree on what 'formal' means — a
// single source of truth for the ceiling >= floor invariant.
function slotRegisterRank(slot = {}) {
  return String(slot?.register || '').toLowerCase() === 'formal'
    ? formalityRank('dressy')
    : formalityRank(slot?.register)
}

// The strictest (lowest-rank) register ceiling across every occasion the plan
// actually asked for. `capsuleVersatilityScore`'s generic "neutral color, wide
// occasion tagging, solid, lightweight" formula has no idea what registers the
// plan needs, so a roster it curates can score high on "versatility" while
// still reading uniformly `elevated` — which then fails outright any slot
// whose occasion (e.g. `casual`) enforces an `everyday` ceiling. Live-tested
// 2026-07-14: an 8-slot capsule's roster was 5/6 `elevated` pieces plus 1
// `everyday` shoe; `casual`-occasion slots (Beach Day, City Outing) got zero
// outfits because only shoes cleared the ceiling — no top/bottom/dress did.
//
// Part 2 (spec 19): a declared `slot.register` ABOVE the occasion's ceiling is
// an explicit escalation ("occasion: casual, register: elevated" = "casual
// event, dressed up a notch" — the exact mechanism this field exists for) and
// must win over the occasion default, or the slot is self-contradictory: a
// floor the ceiling forbids. Only ever LIFTS the ceiling — a declared register
// at or below the occasion's own ceiling changes nothing, so undeclared and
// non-escalating slots keep today's occasion ceilings exactly.
function effectiveSlotRegisterCeilingRank(slot = {}) {
  const occasionRank = formalityRank(resolveOccasionProfile(slot?.occasion)?.register_ceiling)
  const slotRank = slotRegisterRank(slot)
  if (occasionRank === null) return slotRank
  if (slotRank === null) return occasionRank
  return Math.max(occasionRank, slotRank)
}

function strictestRegisterCeilingRank(occasions = []) {
  const ranks = occasions
    .map(occasion => formalityRank(resolveOccasionProfile(occasion)?.register_ceiling))
    .filter(rank => rank !== null)
  return ranks.length ? Math.min(...ranks) : null
}

function capsuleDemandReserve(slots = [], quotas = {}) {
  const demandByRank = new Map()
  for (const slot of Array.isArray(slots) ? slots : []) {
    const rank = effectiveSlotRegisterCeilingRank(slot)
    if (rank === null) continue
    const looks = Math.max(1, Number(slot?.targetOutfits) || 1)
    demandByRank.set(rank, (demandByRank.get(rank) || 0) + looks)
  }
  const ranks = [...demandByRank.keys()].sort((a, b) => a - b)
  if (!ranks.length) return null
  const rank = ranks[0]
  const looks = demandByRank.get(rank) || 0
  const mainReserve = looks <= 1 ? 1 : (looks >= 4 && Math.min(quotas.top || 0, quotas.bottom || 0) >= 4 ? 3 : 2)
  return {
    rank,
    looks,
    byGroup: {
      top: Math.min(quotas.top || 0, mainReserve),
      bottom: Math.min(quotas.bottom || 0, mainReserve),
      dress: Math.min(quotas.dress || 0, 1),
      outerwear: Math.min(quotas.outerwear || 0, looks >= 3 ? 1 : 0),
      shoes: Math.min(quotas.shoes || 0, looks <= 1 ? 1 : 2)
    }
  }
}

function pieceClearsCeilingRank(piece = {}, ceilingRank = null) {
  if (ceilingRank === null) return false
  const rank = formalityRank(pieceFormality(piece))
  return rank !== null && rank <= ceilingRank
}

function pieceMeetsFloorRank(piece = {}, floorRank = null) {
  if (floorRank === null) return false
  const rank = formalityRank(pieceFormality(piece))
  return rank !== null && rank >= floorRank
}

// Part 1 (spec 19), updated by spec 23 Part 2: arithmetic over tags already
// held on the pending plan — does ANY main-category (non-shoe, non-accessory)
// roster piece clear the register floor, and does the roster have shoes at
// all? Used to tell a genuinely unfillable floor ("no combination can meet
// it") apart from a floor the model just hasn't hit yet with its current
// picks. Anchor-based to match the anchor-based floor check itself — a single
// floor-clearing top, bottom, dress, or outerwear piece is enough; shoes never
// needed to clear the floor themselves (they're bounded by the ceiling
// elsewhere), only to exist in the roster.
function slotFloorViability(gateAllowedIds = new Set(), piecesById = new Map(), floorRank = null) {
  if (floorRank === null) return { hasMainPath: true, hasShoes: true }
  let hasMainPath = false
  let hasShoes = false
  for (const id of gateAllowedIds) {
    const piece = piecesById.get(id)
    if (!piece) continue
    const group = wardrobeCategoryGroup(piece)
    if (group === 'shoes') { hasShoes = true; continue }
    if (['dress', 'top', 'bottom', 'outerwear'].includes(group) && pieceMeetsFloorRank(piece, floorRank)) hasMainPath = true
  }
  return { hasMainPath, hasShoes }
}

function ensureCapsuleGroupReserve(roster = [], groups = {}, group = '', required = 0, ceilingRank = null, scoreOf = new Map()) {
  if (!(required > 0)) return roster
  let nextRoster = roster
  const selectedInGroup = () => nextRoster.filter(piece => wardrobeCategoryGroup(piece) === group)
  const compliantSelected = () => selectedInGroup().filter(piece => pieceClearsCeilingRank(piece, ceilingRank))
  while (compliantSelected().length < required) {
    const selected = selectedInGroup()
    if (!selected.length) break
    const candidate = (groups[group] || []).find(piece =>
      !nextRoster.includes(piece) &&
      pieceClearsCeilingRank(piece, ceilingRank) &&
      !compliantSelected().some(selectedPiece => capsuleSimilarityKey(selectedPiece) === capsuleSimilarityKey(piece))
    ) || (groups[group] || []).find(piece =>
      !nextRoster.includes(piece) &&
      pieceClearsCeilingRank(piece, ceilingRank)
    )
    if (!candidate) break
    const swapTarget = selected
      .filter(piece => !pieceClearsCeilingRank(piece, ceilingRank))
      .sort((a, b) => (scoreOf.get(a) || 0) - (scoreOf.get(b) || 0))[0]
    if (!swapTarget) break
    const swapIndex = nextRoster.indexOf(swapTarget)
    if (swapIndex === -1) break
    nextRoster = nextRoster.map((piece, index) => index === swapIndex ? candidate : piece)
  }
  return nextRoster
}

function footwearPassesActivityProfile(piece = {}, activityProfile = null) {
  if (!activityProfile?.rules) return true
  const verdict = footwearComfortVerdict(
    piece,
    activityProfile.rules.excluded_heel_heights || [],
    activityProfile.rules.excluded_walk_support || []
  )
  return verdict.verdict === 'pass'
}

function demandingActivityProfilesForSlots(slots = []) {
  const profiles = new Map()
  for (const slot of Array.isArray(slots) ? slots : []) {
    const profile = resolveActivityProfile({
      activity: slot.activity,
      occasion: slot.occasion,
      request: slot.slotRequestText || slot.bestFor || slot.label || ''
    })
    const rules = profile?.rules || {}
    if (!profile?.id) continue
    if (!(rules.excluded_heel_heights?.length || rules.excluded_walk_support?.length)) continue
    profiles.set(profile.id, profile)
  }
  return [...profiles.values()]
}

export function selectCapsuleRoster(pool = [], { budget = 10, isSummer = false, occasions = [], slots = [] } = {}) {
  const quotas = capsuleQuotas(budget, { isSummer })
  const groups = { top: [], bottom: [], dress: [], outerwear: [], shoes: [] }
  const scoreOf = new Map()
  for (const piece of pool) {
    const group = wardrobeCategoryGroup(piece)
    if (!groups[group]) continue
    scoreOf.set(piece, capsuleVersatilityScore(piece, { isSummer }))
    groups[group].push(piece)
  }
  for (const group of Object.keys(groups)) groups[group].sort((a, b) => scoreOf.get(b) - scoreOf.get(a))
  // A summer capsule should carry shorts: float the best pair to the front of
  // the bottoms so the quota picks it up.
  if (isSummer) {
    const shortsIndex = groups.bottom.findIndex(piece => bottomKind(piece) === 'shorts')
    if (shortsIndex > 0) groups.bottom.unshift(...groups.bottom.splice(shortsIndex, 1))
  }
  const roster = []
  for (const [group, count] of Object.entries(quotas)) {
    // Non-redundancy: fill each category with DISTINCT pieces first (a capsule
    // of three near-identical black tees is dead weight), backfilling a
    // near-duplicate only when the quota can't be met with distinct ones.
    const seen = new Set()
    const distinct = []
    const backfill = []
    for (const piece of groups[group]) {
      const key = capsuleSimilarityKey(piece)
      if (seen.has(key)) backfill.push(piece)
      else { seen.add(key); distinct.push(piece) }
    }
    for (const piece of [...distinct, ...backfill].slice(0, count)) roster.push(piece)
  }
  // Register-floor guarantee: for every category the plan actually needs a
  // quota for, make sure at least one selected piece clears the strictest
  // occasion's ceiling — swapping in the best such candidate from the pool
  // for the category's LOWEST-scoring pick if none of the quota-selected
  // pieces already qualify. Skipped entirely when the plan's occasions don't
  // resolve to a ceiling (preserves prior behavior) — this only tightens an
  // otherwise-blind selection, never loosens anything.
  const ceilingRank = strictestRegisterCeilingRank(occasions)
  if (ceilingRank !== null) {
    for (const [group, count] of Object.entries(quotas)) {
      if (!count) continue
      const selectedInGroup = roster.filter(piece => wardrobeCategoryGroup(piece) === group)
      const alreadyCompliant = selectedInGroup.some(piece => {
        return pieceClearsCeilingRank(piece, ceilingRank)
      })
      if (alreadyCompliant || !selectedInGroup.length) continue
      const compliantCandidate = groups[group].find(piece => {
        if (selectedInGroup.includes(piece)) return false
        return pieceClearsCeilingRank(piece, ceilingRank)
      })
      if (!compliantCandidate) continue
      const worst = selectedInGroup.reduce((min, piece) =>
        scoreOf.get(piece) < scoreOf.get(min) ? piece : min, selectedInGroup[0])
      const swapIndex = roster.indexOf(worst)
      if (swapIndex !== -1) roster[swapIndex] = compliantCandidate
    }
  }
  const reserve = capsuleDemandReserve(slots, quotas)
  if (reserve) {
    for (const [group, required] of Object.entries(reserve.byGroup)) {
      const updated = ensureCapsuleGroupReserve(roster, groups, group, required, reserve.rank, scoreOf)
      roster.splice(0, roster.length, ...updated)
    }
  }
  if (quotas.shoes > 0) {
    const demands = shoeReserveDemands(slots, quotas)
    const { roster: guaranteedRoster, gaps } = ensureCapsuleShoeDemands(roster, groups, demands, scoreOf, quotas.shoes)
    roster.splice(0, roster.length, ...guaranteedRoster)
    if (gaps.length) {
      const finalRoster = roster.slice(0, budget)
      finalRoster.shoeReserveGaps = describeShoeReserveGaps(gaps, budget)
      return finalRoster
    }
  }
  return roster.slice(0, budget)
}

// One demand per "the shoe roster must guarantee something" reason: a
// demanding activity profile (hiking's excluded heel/support rules) needs at
// least one passing shoe, and an elevated-look floor needs enough polished
// shoes for the plan's dressier slots. Each has a human label for the
// coverage-gap disclosure if the quota can't hold all of them.
function shoeReserveDemands(slots = [], quotas = {}) {
  const demands = []
  for (const profile of demandingActivityProfilesForSlots(slots)) {
    demands.push({
      label: profile.label || profile.id,
      required: 1,
      predicate: piece => footwearPassesActivityProfile(piece, profile),
    })
  }
  const elevatedRank = formalityRank('elevated')
  const elevatedShoeLooks = (Array.isArray(slots) ? slots : [])
    .filter(slot => slotWantsElevatedShoe(slot))
    .reduce((sum, slot) => sum + Math.max(1, Number(slot?.targetOutfits) || 1), 0)
  if (elevatedShoeLooks > 0 && quotas.shoes > 1) {
    demands.push({
      label: 'a dressy/elevated look',
      required: Math.min(quotas.shoes, Math.max(1, Math.ceil(elevatedShoeLooks / 2))),
      predicate: piece => pieceMeetsFloorRank(piece, elevatedRank),
    })
  }
  return demands
}

// Guarantee every shoe demand together in one pass instead of sequential
// blind swaps. The Part 6 bug: the elevated-shoe floor reserve ran AFTER the
// activity reserve and chose its swap target as the lowest-versatility
// non-elevated shoe — which was exactly the hiking shoe the activity reserve
// had just installed — silently destroying that guarantee. Fix: a swap
// target must satisfy ZERO of the demands currently on the table; only if no
// such shoe exists do we evict one whose own demand(s) are still covered by
// another selected shoe. A shoe satisfying multiple demands (an athletic
// sneaker: hiking + walking) counts for all of them automatically, since
// each demand's "is it satisfied" check scans every currently selected shoe.
function ensureCapsuleShoeDemands(roster = [], groups = {}, demands = [], scoreOf = new Map(), quotaShoes = 0) {
  if (!demands.length || !(quotaShoes > 0)) return { roster, gaps: [] }
  let nextRoster = roster
  const gaps = []
  const selectedShoes = () => nextRoster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')
  const demandSatisfiedCount = demand => selectedShoes().filter(piece => demand.predicate(piece)).length
  const demandsSatisfiedBy = piece => demands.filter(demand => demand.predicate(piece))

  for (const demand of demands) {
    let guard = 0
    while (demandSatisfiedCount(demand) < demand.required && guard < quotaShoes) {
      guard += 1
      const selected = selectedShoes()
      const candidatePool = (groups.shoes || []).filter(piece => !nextRoster.includes(piece) && demand.predicate(piece))
      const candidate = candidatePool.find(piece =>
        !selected.some(selectedPiece => capsuleSimilarityKey(selectedPiece) === capsuleSimilarityKey(piece))
      ) || candidatePool[0]
      if (!candidate) { gaps.push(demand); break }
      if (selected.length < quotaShoes) {
        nextRoster = [...nextRoster, candidate]
        continue
      }
      // Roster is full: prefer evicting a shoe that satisfies NO demand at
      // all; only if none exists, evict one whose every demand is still
      // covered by another selected shoe once it's gone.
      const zeroDemandTargets = selected.filter(piece => demandsSatisfiedBy(piece).length === 0)
      const safeToEvictTargets = selected.filter(piece => {
        const own = demandsSatisfiedBy(piece)
        return own.length > 0 && own.every(ownDemand =>
          selected.some(other => other !== piece && ownDemand.predicate(other)))
      })
      const swapTarget = [...zeroDemandTargets, ...safeToEvictTargets]
        .sort((a, b) => (scoreOf.get(a) || 0) - (scoreOf.get(b) || 0))[0]
      if (!swapTarget) { gaps.push(demand); break }
      const swapIndex = nextRoster.indexOf(swapTarget)
      if (swapIndex === -1) { gaps.push(demand); break }
      nextRoster = nextRoster.map((piece, index) => index === swapIndex ? candidate : piece)
    }
  }
  return { roster: nextRoster, gaps }
}

function describeShoeReserveGaps(gaps = [], budget = 0) {
  if (gaps.length < 2) {
    return gaps.map(gap => `[missing wardrobe gap: the ${budget}-piece capsule's shoe quota cannot cover ${gap.label} — keep the best assignment and pack around it]`)
  }
  const labels = gaps.map(gap => gap.label)
  const joined = labels.length === 2
    ? `${labels[0]} and ${labels[1]}`
    : `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
  return [`[missing wardrobe gap: the shoe quota under this ${budget}-piece budget cannot cover both ${joined}]`]
}

function planWorkbenchPieceLine(piece = {}) {
  const colors = Array.isArray(piece.colors) && piece.colors.length ? piece.colors.join('/') : ''
  const occasions = Array.isArray(piece.occasions) && piece.occasions.length ? piece.occasions.slice(0, 4).join('/') : ''
  const bits = [
    `ID ${piece.id}`,
    piece.name || 'Garment',
    wardrobeCategoryGroup(piece) || piece.category || '',
    colors ? `colors:${colors}` : '',
    occasions ? `occasions:${occasions}` : '',
    piece.formality ? `formality:${piece.formality}` : '',
    piece.fabric_weight ? `weight:${piece.fabric_weight}` : '',
    piece.heel_height ? `heel:${piece.heel_height}` : '',
    piece.walk_support ? `support:${piece.walk_support}` : '',
    piece.reads_as ? `reads:${String(piece.reads_as).slice(0, 80)}` : ''
  ].filter(Boolean)
  return bits.join(' | ')
}

function idSetForPieces(pieces = []) {
  return new Set((Array.isArray(pieces) ? pieces : []).map(piece => Number(piece?.id)).filter(Boolean))
}

function pieceMapForPieces(pieces = []) {
  return new Map((Array.isArray(pieces) ? pieces : []).map(piece => [Number(piece?.id), piece]).filter(([id]) => Boolean(id)))
}

function suppressedReasonMap(suppressedPieces = []) {
  const map = new Map()
  for (const piece of Array.isArray(suppressedPieces) ? suppressedPieces : []) {
    const id = Number(piece?.id)
    if (!id) continue
    const reasons = Array.isArray(piece?.reasons) && piece.reasons.length
      ? piece.reasons.map(reason => String(reason || '').trim()).filter(Boolean)
      : ['failed register/weather/footwear gates']
    map.set(id, reasons)
  }
  return map
}

export function describeOutfitStructureGap(pieces = [], { requireShoes = true } = {}) {
  const groups = (Array.isArray(pieces) ? pieces : []).map(piece => wardrobeCategoryGroup(piece))
  const shoeCount = groups.filter(group => group === 'shoes').length
  const bottomCount = groups.filter(group => group === 'bottom').length
  const dressCount = groups.filter(group => group === 'dress').length
  const topCount = groups.filter(group => group === 'top').length

  if (requireShoes && shoeCount === 0) return 'missing shoes'
  if (shoeCount > 1) return 'more than one shoe option was submitted'
  if (bottomCount > 1) return 'more than one bottom was submitted'
  if (dressCount > 1) return 'more than one dress was submitted'
  if (dressCount === 1 && bottomCount > 0) return 'dress and bottom were both submitted'
  if (dressCount === 0 && topCount < 1) return 'missing top or dress'
  if (dressCount === 0 && bottomCount !== 1) {
    if (topCount > 1 && bottomCount === 0) return `${topCount} tops were submitted without a bottom`
    return 'missing bottom'
  }
  return ''
}

function planWorkbenchPieceScore(piece = {}, slot = {}, { anchorIds = new Set() } = {}) {
  const id = Number(piece.id)
  let score = 0
  if (anchorIds.has(id)) score += 100000
  const group = wardrobeCategoryGroup(piece)
  if (['top', 'bottom', 'dress', 'shoes'].includes(group)) score += 80
  if (['outerwear', 'accessory'].includes(group)) score += 30
  if (piece.recommendation_status === 'trusted') score += 50
  if (piece.fit_confidence === 'high') score += 30
  if (piece.role_permission === 'hero' || piece.role_permission === 'auto') score += 20
  const occasions = Array.isArray(piece.occasions) ? piece.occasions.map(occ => String(occ || '').toLowerCase()) : []
  const slotOccasion = String(slot?.occasion || '').toLowerCase()
  if (slotOccasion && occasions.includes(slotOccasion)) score += 35
  const slotFloor = slotRegisterRank(slot)
  const pieceRank = formalityRank(pieceFormality(piece))
  if (slotFloor !== null && pieceRank !== null) {
    score += Math.max(0, 20 - Math.abs(pieceRank - slotFloor) * 5)
  }
  if (fabricWeight(piece) === 'light') score += 5
  return score
}

function selectPlanWorkbenchPieces(allowedPieces = [], slot = {}, { anchorIds = new Set(), limit = PLAN_WORKBENCH_PIECE_LIMIT } = {}) {
  const scored = allowedPieces
    .map((piece, index) => ({ piece, index, score: planWorkbenchPieceScore(piece, slot, { anchorIds }) }))
    .sort((a, b) => b.score - a.score || Number(b.piece.id || 0) - Number(a.piece.id || 0) || a.index - b.index)
  const selected = []
  const seen = new Set()
  const add = item => {
    if (!item || selected.length >= limit) return
    const id = Number(item.piece.id)
    if (!id || seen.has(id)) return
    seen.add(id)
    selected.push(item.piece)
  }

  for (const item of scored) {
    if (anchorIds.has(Number(item.piece.id))) add(item)
  }

  const coverageGroups = ['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory']
  for (const group of coverageGroups) {
    const quota = group === 'accessory' || group === 'outerwear' ? 4 : 8
    let taken = selected.filter(piece => wardrobeCategoryGroup(piece) === group).length
    for (const item of scored) {
      if (taken >= quota || selected.length >= limit) break
      if (wardrobeCategoryGroup(item.piece) !== group) continue
      const before = selected.length
      add(item)
      if (selected.length > before) taken += 1
    }
  }

  for (const item of scored) add(item)
  return selected
}

function registerRankName(rank = null) {
  return ['lounge', 'everyday', 'elevated', 'dressy', 'formal'][rank] || ''
}

function modelPlanPool({ allPieces = [], slots = [], constraints = {}, question = '', mood = '' } = {}) {
  const { pieceBudget } = normalizePlanConstraints(constraints)
  const weatherContextText = slots.map(slot => `${slot?.season || ''} ${slot?.weather || ''} ${slot?.slotWeather || ''}`).join(' ')
  const isSummerContext = /\b(summer|warm|hot|80|90|heat)\b/i.test(`${question} ${mood} ${weatherContextText}`) // ratchet-allow: plan weather context, not garment matching
  return pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET
    ? selectCapsuleRoster(allPieces, { budget: pieceBudget, isSummer: isSummerContext, occasions: slots.map(slot => slot.occasion), slots })
    : allPieces
}

export async function buildPlanSlotWorkbench(slots = [], { constraints = {}, allPieces = [], dateRange = {}, mood = '', question = '', fetchImpl, ownerRules = [] } = {}) {
  const { reuse: reuseMode, noRepeat: noRepeatCats, allowRepeat, anchorIds, pieceBudget } = normalizePlanConstraints(constraints)
  const composePool = modelPlanPool({ allPieces, slots, constraints, question, mood })
  const piecesById = pieceMapForPieces(composePool)
  const catalogById = new Map()
  const slotWeather = []
  const workbenchSlots = []
  const droppedSlotLabels = Array.isArray(slots?.droppedSlotLabels) ? slots.droppedSlotLabels : []
  const coverageGaps = []
  if (droppedSlotLabels.length) {
    coverageGaps.push(`[plan trimmed: ${droppedSlotLabels.length} use case${droppedSlotLabels.length === 1 ? '' : 's'} dropped — ${droppedSlotLabels.map(label => `"${label}"`).join(', ')} — a plan can only include up to ${slots.length} use-case slots at once; ask again with the dropped one${droppedSlotLabels.length === 1 ? '' : 's'} as a follow-up]`)
  }
  if (Array.isArray(composePool.shoeReserveGaps)) coverageGaps.push(...composePool.shoeReserveGaps)
  for (const [index, slot] of slots.entries()) {
    const slotRequestText = [slot.label, slot.bestFor, slot.coverage, slot.planNote].filter(Boolean).join('. ') || question
    const { profile: weatherProfile, label: weatherLabel } = await resolveSlotWeather(slot, { mood, question: slotRequestText, dateRange, fetchImpl })
    slotWeather.push({ label: slot.label, weather: weatherLabel, order: index })
    // Part 2 (spec 19): the piece-level gate below resolves its own occasion/
    // activity-text ceiling and never saw the slot's structured `register`
    // field, so a declared escalation above the occasion ceiling was silently
    // ignored at the actual gate even though the workbench label (below)
    // showed the raised ceiling. Only overrides in the genuine escalation
    // case; an undeclared or non-escalating register leaves the gate's own
    // occasion/activity ceiling logic untouched.
    const ceilingRank = effectiveSlotRegisterCeilingRank(slot)
    const occasionCeilingRank = formalityRank(resolveOccasionProfile(slot?.occasion)?.register_ceiling)
    const registerCeilingOverride = (ceilingRank !== null && occasionCeilingRank !== null && ceilingRank > occasionCeilingRank)
      ? registerRankName(ceilingRank)
      : null
    const { allowedPieces, suppressedPieces } = filterWholeWardrobePiecesForGeneration(composePool, {
      occasion: slot.occasion,
      explorationMode: 'moderate',
      weatherProfile,
      mood: mood || slotRequestText,
      activity: slot.activity,
      request: slotRequestText,
      ...(registerCeilingOverride ? { registerCeiling: registerCeilingOverride } : {})
    })
    const shownPieces = selectPlanWorkbenchPieces(allowedPieces, slot, { anchorIds })
    for (const piece of shownPieces) {
      const id = Number(piece?.id)
      if (id && !catalogById.has(id)) catalogById.set(id, piece)
    }
    const floorRank = slotRegisterRank(slot)
    workbenchSlots.push({
      id: slot.id,
      label: slot.label,
      occasion: slot.occasion,
      activity: slot.activity,
      environment: slot.environment || '',
      register: slot.register || '',
      target_outfits: Math.min(3, Math.max(1, Number(slot.targetOutfits) || 1)),
      weather_used: weatherLabel,
      register_ceiling: registerRankName(ceilingRank),
      register_floor: registerRankName(floorRank),
      allowed_piece_ids: shownPieces.map(piece => Number(piece.id)).filter(Boolean),
      suppressed_note: `${Array.isArray(suppressedPieces) ? suppressedPieces.length : 0} pieces excluded by register/weather/footwear gates${allowedPieces.length > shownPieces.length ? `; showing ${shownPieces.length} prioritized of ${allowedPieces.length} allowed pieces` : ''}`
    })
    slot._modelWorkbench = {
      weatherProfile,
      weatherLabel,
      allowedPieces: shownPieces,
      rosterIds: new Set(shownPieces.map(piece => Number(piece.id)).filter(Boolean)),
      gateAllowedIds: idSetForPieces(allowedPieces),
      suppressedReasonsById: suppressedReasonMap(suppressedPieces),
      originalIndex: index,
      slotRequestText
    }
  }
  const pieceCatalog = [...catalogById.values()]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(planWorkbenchPieceLine)
  const workbenchInstructions = [
    'Compose the outfits yourself and submit ALL slots in ONE submit_plan_outfits call. Use piece_catalog for garment details and pick only from each slot allowed_piece_ids. Do not call view_pieces for roster pieces; make at most one small view_pieces call only if genuinely needed. If validation accepts some outfits and rejects others, resubmit only the failed slots.',
    // Part 4 (spec 18): the spec-15 watch item's agreed escalation, now past
    // its 3-run threshold (16/18/20 distinct pieces across live maximize-reuse
    // packing runs, only accessories repeating).
    // Part 3 (spec 23): the vibe-based instruction ("aim to repeat bottoms
    // and shoes") measured 16/18/20 distinct pieces across live maximize-
    // reuse runs — trending the wrong way, and a live re-run still produced
    // five different pairs of footwear across five outfits. A checkable
    // number replaces the vibe.
    reuseMode === 'maximize'
      ? 'Reuse is set to maximize: pack at most 2 pairs of shoes across the whole set — a third only if a demanding activity (hiking, trail) requires it — and aim to repeat bottoms across slots. Every reused piece is one fewer to pack. Accessories alone do not count as reuse.'
      : '',
    // Part 5 (spec 18): live miss — a card described the Tropical pants
    // (catalog: pattern floral, six colors) as "solid-base... muted print",
    // fabricating past the catalog truth it already had in piece_catalog.
    'The catalog\'s pattern and color fields are the truth about prints — never describe a piece as solid, muted, or subtle unless its line says so.',
    // Part 3 (spec 19): live miss — a submitted card's reason said "Actually
    // revising: emerald v-neck top + oatmeal textured elastic waist pants..."
    // while piece_ids still carried the abstract midi dress the prose had just
    // rejected. Same family as spec 18 Part 5 (instruction against an observed
    // fabrication shape, zero mechanism — prose-vs-IDs consistency isn't
    // mechanically checkable without the keyword-matching this codebase has
    // repeatedly ruled out).
    'The piece_ids ARE the outfit. If you change your mind while writing the reason, update piece_ids to match — never submit a reason describing pieces you did not include.',
    // Part 4 (spec 24): third confirmed occurrence of cardigan+shawl stacking
    // on the same outfit. Stays a string — layer COUNT is judgment (a ski
    // plan legitimately doubles up), unlike Part 1's packing count.
    'At most one layer (cardigan, jacket, or shawl) per outfit unless cold or rain genuinely demands two.',
    // Part 2 (spec 25): a stored owner rule (e.g. "office/client days:
    // structured silhouettes, no maxi skirts or shawls") was present in the
    // system-prompt tail but got out-composed by an unrelated praise corpus
    // sitting in the same flat feedback list, ~40k tokens further from
    // composition-time attention than this workbench. Deterministic
    // pass-through of the same rows getStylistFeedbackMemory renders under
    // "Owner rules" — still prompt guidance, never a mechanical gate (#44).
    Array.isArray(ownerRules) && ownerRules.length
      ? `OWNER RULES — apply to every outfit you compose: ${ownerRules.map(rule => `"${rule}"`).join('; ')}`
      : ''
  ].filter(Boolean).join(' ')
  return {
    status: 'slot_rosters',
    instructions: workbenchInstructions,
    piece_catalog: pieceCatalog,
    slots: workbenchSlots,
    constraints: {
      reuse: reuseMode,
      no_repeat: [...noRepeatCats],
      allow_repeat: [...allowRepeat],
      shared_anchor_ids: [...anchorIds],
      piece_budget: pieceBudget
    },
    pendingPlan: {
      slots: slots.map((slot, index) => ({
        ...slot,
        originalIndex: index,
        weatherProfile: slot._modelWorkbench?.weatherProfile || null,
        weatherLabel: slot._modelWorkbench?.weatherLabel || '',
        allowedPieces: slot._modelWorkbench?.allowedPieces || [],
        rosterIds: slot._modelWorkbench?.rosterIds || new Set(),
        gateAllowedIds: slot._modelWorkbench?.gateAllowedIds || new Set(),
        suppressedReasonsById: slot._modelWorkbench?.suppressedReasonsById || new Map(),
        slotRequestText: slot._modelWorkbench?.slotRequestText || ''
      })),
      piecesById,
      constraints: { reuse: reuseMode, noRepeat: noRepeatCats, allowRepeat, anchorIds, pieceBudget },
      slotWeather,
      coverageGaps,
      heldOutfits: [],
      resubmits: 0
    }
  }
}

// Spec 23 Part 1: a plan_outfit_set call made while a plan is already in
// progress this turn (held outfits from an earlier submit_plan_outfits round,
// and/or already-assembled cards from an earlier fully-succeeded round) is a
// PARTIAL RE-PLAN, not a new plan — the spec-19 hatch instruction ("re-call
// plan_outfit_set with just this slot") predates the merge semantics below
// and previously caused the new call's fresh, single-slot pendingPlan to
// unconditionally overwrite the one holding everything already accepted this
// turn, silently destroying it. Merges the new workbench's slot(s) into the
// prior plan: slots not being re-planned (and their held outfits) carry
// forward at their original position so Mon-Fri order survives; a slot being
// re-planned supersedes only its own prior held outfits, disclosed via a
// plan line; constraints inherit from the prior plan unless this call
// explicitly restates them.
export function mergePendingPlanForReplan(priorPendingPlan, newPendingPlan, {
  explicitConstraintsProvided = false,
  priorAssembledOutfits = []
} = {}) {
  const priorSlots = Array.isArray(priorPendingPlan?.slots) ? priorPendingPlan.slots : []
  const priorHeld = Array.isArray(priorPendingPlan?.heldOutfits) ? priorPendingPlan.heldOutfits : []
  const newSlots = Array.isArray(newPendingPlan?.slots) ? newPendingPlan.slots : []
  const newSlotIds = new Set(newSlots.map(slot => slot.id))
  const priorSlotById = new Map(priorSlots.map(slot => [slot.id, slot]))

  const keptPriorSlots = priorSlots.filter(slot => !newSlotIds.has(slot.id))
  const maxPriorIndex = priorSlots.reduce((max, slot) => Math.max(max, Number(slot.originalIndex) || 0), -1)
  let nextAppendIndex = maxPriorIndex + 1
  const positionedNewSlots = newSlots.map(slot => {
    const priorMatch = priorSlotById.get(slot.id)
    // A re-planned slot (label/id matches a prior slot) takes that slot's
    // original position; a genuinely new slot appends after the existing set.
    const originalIndex = priorMatch ? priorMatch.originalIndex : nextAppendIndex++
    return { ...slot, originalIndex }
  })
  const mergedSlots = [...keptPriorSlots, ...positionedNewSlots]
    .sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0))

  // Fold in already-assembled cards from an earlier fully-succeeded
  // submit_plan_outfits round this turn (their tripSlot field, set by
  // annotateTripOutfit, is the original slot id) alongside the still-pending
  // plan's heldOutfits — either or both may be present.
  const combinedPriorHeld = [
    ...priorHeld,
    ...priorAssembledOutfits.map(outfit => ({ ...outfit, _slotId: outfit._slotId || outfit.tripSlot }))
  ]
  const supersededCounts = new Map()
  const keptHeld = []
  for (const outfit of combinedPriorHeld) {
    const slotId = outfit?._slotId || outfit?.slot_id || outfit?.tripSlot
    if (slotId && newSlotIds.has(slotId)) {
      supersededCounts.set(slotId, (supersededCounts.get(slotId) || 0) + 1)
    } else {
      keptHeld.push(outfit)
    }
  }

  const coverageGaps = [
    ...(Array.isArray(priorPendingPlan?.coverageGaps) ? priorPendingPlan.coverageGaps : []),
    ...(Array.isArray(newPendingPlan?.coverageGaps) ? newPendingPlan.coverageGaps : [])
  ]
  for (const [slotId, count] of supersededCounts.entries()) {
    const label = priorSlotById.get(slotId)?.label || slotId
    coverageGaps.push(`[slot re-planned: "${label}" — ${count} earlier look${count === 1 ? '' : 's'} replaced]`)
  }

  const mergedConstraints = explicitConstraintsProvided
    ? (newPendingPlan?.constraints || {})
    : (priorPendingPlan?.constraints || newPendingPlan?.constraints || {})

  const mergedPiecesById = new Map([
    ...(priorPendingPlan?.piecesById instanceof Map ? priorPendingPlan.piecesById : []),
    ...(newPendingPlan?.piecesById instanceof Map ? newPendingPlan.piecesById : [])
  ])

  // Each slot already carries its own resolved weatherLabel; rebuilding
  // slotWeather from the merged slot list (rather than trying to splice two
  // order-indexed arrays from different workbench calls) keeps the ordinal
  // `order` field consistent with the merged slots' originalIndex.
  const mergedSlotWeather = mergedSlots.map(slot => ({
    label: slot.label,
    weather: slot.weatherLabel || '',
    order: slot.originalIndex
  }))

  return {
    slots: mergedSlots,
    piecesById: mergedPiecesById,
    constraints: mergedConstraints,
    slotWeather: mergedSlotWeather,
    coverageGaps,
    heldOutfits: keptHeld,
    resubmits: 0
  }
}

export function validateSlotOutfitConstraints(outfit = {}, slot = {}, { weatherProfile = {} } = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const reasons = []
  const mainPieces = pieces.filter(piece => ['top', 'bottom', 'dress'].includes(wardrobeCategoryGroup(piece)))
  const layer = pieces.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  const top = pieces.find(piece => wardrobeCategoryGroup(piece) === 'top')
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  if (weatherProfile?.isCold) {
    const hasWarmLayer = Boolean(layer) || (top && fabricWeight(top) === 'heavy') || (dress && fabricWeight(dress) === 'heavy')
    if (!hasWarmLayer) reasons.push('no warm layer for cold weather')
  }
  if (weatherProfile?.isHot) {
    for (const piece of mainPieces) {
      if (fabricWeight(piece) === 'heavy') reasons.push(`${piece.name || piece.id} is a heavy main for hot weather`)
    }
  }
  const floorRank = slotRegisterRank(slot)
  if (floorRank !== null && floorRank >= formalityRank('dressy')) {
    // Spec 23 Part 2: the floor demands an ANCHOR, not uniformity — the
    // outfit passes if at least one non-shoe, non-accessory piece (dress,
    // top, bottom, or outerwear) clears the floor. Per-piece rejection threw
    // out real dressed-up outfits built on quiet basics (dressy blouse +
    // everyday trousers), which the capsule-era "elevated-or-better non-shoe
    // anchor" precedent already established for smart-casual.
    const floorAnchorCandidates = pieces.filter(piece => ['top', 'bottom', 'dress', 'outerwear'].includes(wardrobeCategoryGroup(piece)))
    const hasFloorAnchor = floorAnchorCandidates.some(piece => {
      const rank = formalityRank(pieceFormality(piece))
      return rank !== null && rank >= floorRank
    })
    if (!hasFloorAnchor) {
      reasons.push(`no piece meets the ${slot.register} register floor — include at least one ${slot.register}-or-better main piece (top, bottom, dress, or outerwear), or re-call this slot at a lower register`)
    }
  }
  const activityProfile = resolveActivityProfile({ activity: slot.activity, occasion: slot.occasion, request: slot.slotRequestText || slot.bestFor || slot.label || '' })
  if (activityProfile) {
    for (const piece of pieces.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')) {
      const verdict = footwearComfortVerdict(
        piece,
        activityProfile.rules?.excluded_heel_heights || [],
        activityProfile.rules?.excluded_walk_support || []
      )
      if (verdict.verdict === 'exclude') {
        const label = verdict.dimension === 'heel' ? `${verdict.value} heel unsuitable` : `${verdict.value} support unsuitable`
        reasons.push(`${piece.name || piece.id}: ${label} for ${activityProfile.id}`)
      }
      if (verdict.verdict === 'unknown') reasons.push(`${piece.name || piece.id}: footwear comfort not tagged for ${activityProfile.id}`)
    }
  }
  return reasons
}

function modelPlanNoRepeatViolation(outfit = {}, usedPieceIdsByCategory = new Map(), noRepeatCats = new Set(), anchorIds = new Set()) {
  if (!noRepeatCats.size) return ''
  for (const { id, group } of outfitCategoryPairs(outfit)) {
    if (!noRepeatCats.has(group) || anchorIds.has(id)) continue
    if (usedPieceIdsByCategory.get(group)?.has(id)) return `${group} piece ${id} repeats despite no_repeat`
  }
  return ''
}

function recordModelPlanUse(outfit = {}, usedPieceIds = new Set(), usedPieceIdsByCategory = new Map()) {
  for (const { id, group } of outfitCategoryPairs(outfit)) {
    usedPieceIds.add(id)
    if (!usedPieceIdsByCategory.has(group)) usedPieceIdsByCategory.set(group, new Set())
    usedPieceIdsByCategory.get(group).add(id)
  }
}

export function validateSubmittedPlanOutfits(pendingPlan = {}, submissions = [], { visuallySeenPieceIds = new Set() } = {}) {
  const slots = Array.isArray(pendingPlan?.slots) ? pendingPlan.slots : []
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const planPiecesById = pendingPlan?.piecesById instanceof Map
    ? pendingPlan.piecesById
    : pieceMapForPieces(slots.flatMap(slot => slot.allowedPieces || []))
  const heldOutfits = Array.isArray(pendingPlan?.heldOutfits) ? pendingPlan.heldOutfits : []
  const { reuse: reuseMode = '', noRepeat = new Set(), anchorIds = new Set(), pieceBudget = 0 } = pendingPlan?.constraints || {}
  const seenPieceIds = visuallySeenPieceIds instanceof Set ? visuallySeenPieceIds : new Set()
  const isEnforcedCapsule = pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET
  const usedKeys = new Set(heldOutfits.map(outfit => tripOutfitKey(outfit)).filter(Boolean))
  const usedPieceIds = new Set()
  const usedPieceIdsByCategory = new Map()
  heldOutfits.forEach(outfit => recordModelPlanUse(outfit, usedPieceIds, usedPieceIdsByCategory))
  const accepted = []
  const failures = []
  const submitted = Array.isArray(submissions) ? submissions : []
  for (const [index, raw] of submitted.entries()) {
    const slot = slotById.get(String(raw?.slot_id || ''))
    const label = slot?.label || raw?.slot_id || `outfit ${index + 1}`
    const reasons = []
    if (!slot) {
      failures.push({ slot_id: raw?.slot_id || '', label, reasons: [`unknown slot_id ${raw?.slot_id || '(missing)'}`] })
      continue
    }
    const pieceIds = (Array.isArray(raw?.piece_ids) ? raw.piece_ids : []).map(id => Number(id)).filter(Boolean)
    const seenIds = new Set()
    const dedupedIds = pieceIds.filter(id => {
      if (seenIds.has(id)) return false
      seenIds.add(id)
      return true
    })
    if (!dedupedIds.length) reasons.push('piece_ids is required')
    const gateAllowedIds = slot.gateAllowedIds instanceof Set ? slot.gateAllowedIds : (slot.rosterIds || new Set())
    const suppressedReasonsById = slot.suppressedReasonsById instanceof Map ? slot.suppressedReasonsById : new Map()
    const unresolvedPieceIds = []
    for (const id of dedupedIds) {
      if (gateAllowedIds.has(id)) continue
      if (suppressedReasonsById.has(id)) {
        reasons.push(`piece ${id} failed this slot's gates: ${suppressedReasonsById.get(id).join('; ')}`)
      } else {
        // In an enforced capsule, a piece missing from gateAllowedIds is
        // almost always active but simply outside the curated budget roster
        // (the model may have just verified it via search) — "not active"
        // reads as a false contradiction there.
        reasons.push(isEnforcedCapsule
          ? `piece ${id} is outside this capsule's curated ${pieceBudget}-piece roster`
          : `piece ${id} is not an active wardrobe piece for this plan`)
      }
      unresolvedPieceIds.push(id)
    }
    const pieces = dedupedIds
      .filter(id => gateAllowedIds.has(id))
      .map(id => planPiecesById.get(id))
      .filter(Boolean)
    const outfit = {
      title: String(raw?.title || slot.label || '').trim(),
      reason: String(raw?.reason || '').trim(),
      pieces,
      pieceIds: dedupedIds,
      source: 'plan_outfit_set',
      composedBy: 'model'
    }
    if (!unresolvedPieceIds.length) {
      const structureGap = describeOutfitStructureGap(pieces, { requireShoes: true })
      if (structureGap || !isOutfitStructurallyValid(pieces, { requireShoes: true })) {
        reasons.push(structureGap || 'outfit is structurally incomplete or has duplicate core roles')
      }
      const constraintReasons = validateSlotOutfitConstraints(outfit, slot, { weatherProfile: slot.weatherProfile || {} })
      const floorRejected = constraintReasons.some(reason => reason.includes('register floor'))
      reasons.push(...constraintReasons)
      if (floorRejected) {
        // Part 1 (spec 19): a floor rejection had no legal move inside
        // submit_plan_outfits — resubmitting different pieces cannot raise a
        // slot's floor, only a fresh plan_outfit_set call with a lower
        // register can. Always name that escape hatch, and when the roster
        // genuinely cannot clear the floor, say the stronger truth instead of
        // leaving the model to discover it by trial and error (live evidence:
        // three blind resubmits against an unfillable dressy floor).
        reasons.push('If this slot\'s register should be lower, re-call plan_outfit_set with just this slot at a lower register (or omit register) — resubmitting different pieces cannot change the floor.')
        const floorRank = slotRegisterRank(slot)
        const { hasMainPath, hasShoes } = slotFloorViability(gateAllowedIds, planPiecesById, floorRank)
        if (!hasMainPath || !hasShoes) {
          reasons.push(`no combination in this slot's roster can meet the ${slot.register} floor — lower the register via a fresh plan_outfit_set call for this slot, or accept the disclosed gap.`)
        }
      }
      const key = tripOutfitKey(outfit)
      if (key && usedKeys.has(key)) reasons.push('duplicate outfit already accepted in this plan')
      const repeatReason = modelPlanNoRepeatViolation(outfit, usedPieceIdsByCategory, noRepeat, anchorIds)
      if (repeatReason) reasons.push(repeatReason)
      const nextDistinctPieceCount = new Set([...usedPieceIds, ...outfitCategoryPairs(outfit).map(pair => pair.id)]).size
      if (pieceBudget > 0 && nextDistinctPieceCount > pieceBudget) reasons.push(`would exceed the ${pieceBudget}-piece budget`)
      // Part 1 (spec 24, owner ruling: enforce): reuse:maximize is a packing
      // directive, not a taste judgment — under-reuse means the directive
      // wasn't followed. Only blocks a 3rd+ distinct pair when an
      // already-used pair is gate-eligible for THIS slot (the activity
      // exemption — a hiking slot's athletic shoe, a dressy slot's heels —
      // falls out of gate eligibility with no activity-specific code). Never
      // blocks the first or second distinct pair.
      if (reuseMode === 'maximize') {
        const shoePair = outfitCategoryPairs(outfit).find(pair => pair.group === 'shoes')
        if (shoePair) {
          const usedShoes = usedPieceIdsByCategory.get('shoes') || new Set()
          if (!usedShoes.has(shoePair.id) && usedShoes.size >= 2) {
            const eligibleUsedShoeIds = [...usedShoes].filter(id => gateAllowedIds.has(id))
            if (eligibleUsedShoeIds.length) {
              const names = eligibleUsedShoeIds.map(id => planPiecesById.get(id)?.name || `piece ${id}`).join(', ')
              reasons.push(`this would be a 3rd pair of shoes under reuse:maximize — reuse one of: ${names} (they pass this slot's gates), or drop reuse:maximize if packing light isn't the goal.`)
            }
          }
        }
      }
      // Part 3 (spec 24): parity with propose_outfit's founding-incident rule
      // (layer pieces must be SEEN, not just verified) — submit_plan_outfits
      // was the one composition path that escaped it, and it let a top get
      // layered blind over a dress. Does not ban top-over-dress, only
      // requires the model to have actually looked at both pieces first.
      const dressPair = outfitCategoryPairs(outfit).find(pair => pair.group === 'dress')
      const topPair = outfitCategoryPairs(outfit).find(pair => pair.group === 'top')
      if (dressPair && topPair) {
        const unseenIds = [dressPair.id, topPair.id].filter(id => !seenPieceIds.has(id))
        if (unseenIds.length) {
          reasons.push(`this outfit layers a top over a dress — call view_pieces on [${unseenIds.join(', ')}] first, then resubmit; layering is a sight-required decision.`)
        }
      }
    }
    if (reasons.length) {
      failures.push({ slot_id: slot.id, label, reasons })
      continue
    }
    const key = tripOutfitKey(outfit)
    usedKeys.add(key)
    recordModelPlanUse(outfit, usedPieceIds, usedPieceIdsByCategory)
    accepted.push({ ...outfit, _slotId: slot.id })
  }
  const anchorAllowedSlots = anchorIds.size
    ? slots.filter(slot => [...anchorIds].some(id => (slot.gateAllowedIds || slot.rosterIds)?.has(id))).map(slot => slot.label)
    : []
  const allAccepted = [...heldOutfits, ...accepted]
  if (anchorIds.size && anchorAllowedSlots.length && !allAccepted.some(outfit => outfitCategoryPairs(outfit).some(({ id }) => anchorIds.has(id)))) {
    failures.push({
      slot_id: '',
      label: 'Shared anchor',
      reasons: [`include at least one shared anchor piece; it is allowed in: ${anchorAllowedSlots.join(', ')}`]
    })
  }
  return { accepted, failures }
}

export function assembleSubmittedPlanOutfits(pendingPlan = {}, acceptedOutfits = [], { source = 'plan_outfit_set' } = {}) {
  const slots = Array.isArray(pendingPlan?.slots) ? pendingPlan.slots : []
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const groupedBySlot = new Map()
  for (const outfit of acceptedOutfits || []) {
    const slotId = outfit?._slotId || outfit?.slot_id || outfit?.tripSlot
    if (!slotId) continue
    if (!groupedBySlot.has(slotId)) groupedBySlot.set(slotId, [])
    groupedBySlot.get(slotId).push(outfit)
  }
  const coverageGaps = [...(Array.isArray(pendingPlan?.coverageGaps) ? pendingPlan.coverageGaps : [])]
  const picked = []
  for (const slot of slots) {
    const group = groupedBySlot.get(slot.id) || []
    const target = Math.min(3, Math.max(1, Number(slot.targetOutfits) || 1))
    if (group.length < target) {
      coverageGaps.push(describeSlotCoverageGap(slot, {
        requestedCount: target,
        composedCount: group.length,
        candidateCount: slot.gateAllowedIds?.size || slot.allowedPieces?.length || 0,
        composedBy: 'model'
      }))
    }
    const trimMessage = describePlanCapTrim(slot)
    if (trimMessage) coverageGaps.push(trimMessage)
    group.forEach((outfit, slotIndex) => {
      picked.push({
        ...annotateTripOutfit(outfit, slot, picked.length, {
          slotIndex,
          slotTotal: group.length,
          source,
          weatherLabel: slot.weatherLabel || ''
        }),
        composedBy: 'model',
        _planOrder: slot.originalIndex
      })
    })
  }
  const orderedPicked = picked
    .sort((a, b) => (a._planOrder ?? 0) - (b._planOrder ?? 0) || (a.coveragePosition || '').localeCompare(b.coveragePosition || ''))
    .map(({ _planOrder, _slotId, ...outfit }) => outfit)
  const { reuse: reuseMode, noRepeat: noRepeatCats, pieceBudget } = pendingPlan?.constraints || {}
  const orderedSlotWeather = [...(pendingPlan?.slotWeather || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return attachTripPlanMetadata(orderedPicked, { source, composedBy: 'model', slotWeather: orderedSlotWeather, reuseMode, noRepeatCats, pieceBudget, coverageGaps })
}

export const PLAN_TOTAL_OUTFIT_CAP = 8

export function planTotalOutfitCapForBudget(budget = 0) {
  const numericBudget = Number(budget) || 0
  if (numericBudget >= 30) return 20
  if (numericBudget >= 24) return 16
  if (numericBudget >= 18) return 12
  return PLAN_TOTAL_OUTFIT_CAP
}

export function normalizePlanSlots(rawSlots = [], {
  fallbackWeather = '',
  fallbackOccasion = 'city',
  fallbackActivity = 'none',
  fallbackLocation = '',
  maxSlots = PLAN_TOTAL_OUTFIT_CAP,
  maxTotalOutfits = PLAN_TOTAL_OUTFIT_CAP,
  tripSummary = null,
  onDiagnostic = null
} = {}) {
  const allRawSlots = Array.isArray(rawSlots) ? rawSlots : []
  // A separate slot-count cap keeps the model from opening more use cases than
  // the set can render. Default it to the same 8 as PLAN_TOTAL_OUTFIT_CAP so an
  // 8 one-look capsule is not silently split, while 9+ use cases still get a
  // deterministic disclosure via droppedSlotLabels.
  const droppedRawSlots = allRawSlots.slice(maxSlots)
  const normalized = allRawSlots
    .slice(0, maxSlots)
    .map((slot, index) => {
      const label = String(slot?.label || '').trim()
      const bestFor = String(slot?.best_for || slot?.bestFor || label).trim()
      const coverage = String(slot?.coverage || bestFor || label).trim()
      const planNote = String(slot?.plan_note || slot?.planNote || '').trim()
      const location = String(slot?.location || fallbackLocation || '').trim()
      const declaredActivity = hasDeclaredPlanSlotActivity(slot)
      const proseActivity = declaredActivity ? '' : inferPlanSlotActivityFromProse(slot)
      const activity = declaredActivity
        ? inferPlanSlotActivity(slot, fallbackActivity)
        : (proseActivity || inferPlanSlotActivity(slot, fallbackActivity))
      if (!declaredActivity && proseActivity && typeof onDiagnostic === 'function') onDiagnostic('planSlotActivityInferred')
      const rawExplicitWeather = String(slot?.weather || slot?.stated_weather || '').trim()
      const weatherAsEnvironment = normalizePlanEnvironment(rawExplicitWeather)
      const explicitEnvironment = normalizePlanEnvironment(slot?.environment)
      const proseEnvironment = explicitEnvironment ? '' : normalizePlanSlotEnvironment({ label, bestFor, coverage, planNote, location })
      const declaredEnvironment = explicitEnvironment || (weatherAsEnvironment && (weatherAsEnvironment === 'beach_coastal' || !proseEnvironment) ? weatherAsEnvironment : '')
      const inferredEnvironment = declaredEnvironment ? '' : proseEnvironment
      const environment = declaredEnvironment || inferredEnvironment
      if (!declaredEnvironment && inferredEnvironment && typeof onDiagnostic === 'function') onDiagnostic('planSlotEnvironmentInferred')
      const occasion = normalizePlanSlotOccasion(String(slot?.occasion || fallbackOccasion || 'city'), { label, bestFor, coverage, planNote, environment })
      // statedWeather is ONLY the model's explicit per-slot weather — it wins
      // over the live forecast. The trip-level fallbackWeather is not "stated"
      // for this purpose: it feeds season/heuristic but must let a slot's own
      // forecast override it (that is the coastal-microclimate case).
      const normalizedExplicitWeather = rawExplicitWeather.toLowerCase().replace(/\s+/g, ' ')
      const normalizedFallbackWeather = String(fallbackWeather || '').trim().toLowerCase().replace(/\s+/g, ' ')
      const explicitWeather = normalizedExplicitWeather && !weatherAsEnvironment && normalizedExplicitWeather !== normalizedFallbackWeather
        ? rawExplicitWeather
        : ''
      const statedWeather = beachCoastalStatedWeather(explicitWeather, { environment }) || (
        environment === 'indoor'
          ? 'indoor'
          : environment
            ? ''
            : (isIndoorPlanSlot(slot, { occasion, activity }) ? 'indoor' : '')
      )
      return {
        id: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `slot_${index + 1}`,
        label,
        occasion,
        activity,
        season: String(statedWeather || slot?.season || fallbackWeather || 'current season').trim(),
        statedWeather,
        location,
        environment,
        date: String(slot?.date || '').trim(),
        bestFor,
        coverage,
        targetOutfits: Math.min(3, Math.max(1, Number.parseInt(slot?.count, 10) || 1)),
        totalOutfitCap: maxTotalOutfits,
        register: normalizeRegisterLevel(slot?.register),
        tripSummary,
        planNote
      }
    })
    .filter(slot => slot.label && slot.bestFor)
  let total = normalized.reduce((sum, slot) => sum + slot.targetOutfits, 0)
  for (let index = normalized.length - 1; index >= 0 && total > maxTotalOutfits; index -= 1) {
    const slot = normalized[index]
    const trim = Math.min(slot.targetOutfits - 1, total - maxTotalOutfits)
    if (trim > 0) {
      // Record what was actually asked for before trimming — this cap runs
      // silently (a live capsule test asked for 10 outfits across 5 slots and
      // got 8, with zero signal anywhere that 2 were dropped). requestedOutfits
      // only gets set on a slot that was actually trimmed, so the caller can
      // tell "the wardrobe couldn't fill this" (the coverage-gap case) apart
      // from "the plan never even asked the wardrobe for the full count."
      slot.requestedOutfits = slot.targetOutfits
      slot.targetOutfits -= trim
      total -= trim
    }
  }
  // Arrays can carry extra properties; attach here rather than changing the
  // return shape so every existing caller keeps working with a plain slot
  // array, and callers that care can opt in.
  normalized.droppedSlotLabels = droppedRawSlots
    .map(slot => String(slot?.label || slot?.best_for || slot?.bestFor || '').trim())
    .filter(Boolean)
  return normalized
}
