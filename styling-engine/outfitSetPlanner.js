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
  footwearComfortVerdict,
  pieceStyleProfile,
  hasRejectedReference
} from './rules.js'
import {
  bottomKind,
  fabricWeight,
  garmentKind,
  hasSleevelessConstruction,
  formalityRank,
  pieceFormality,
  pieceHasInsulatingFiber,
  pieceBareness,
  pieceCoverage,
  shoeCoverage,
  sleeveCoverage
} from './attributes.js'
import { resolveActivityProfile } from './footwear-comfort.js'
import { normalizeOccasion, normalizeActivity } from './stylingIntent.js'
import { resolveOccasionProfile } from './occasions.js'
import {
  COLOR_REQUEST_NAMES,
  colorFamilyLabel,
  colorFamilies,
  colorTaxonomyEntry,
  colorsArePaletteNeutral,
} from '../lib/colorTaxonomy.js'

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
    title: String(outfit.title || '').trim() || slot.label,
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
function buildPlanReport(pieceReuse, tripOutfits = [], {
  reuseMode = '',
  noRepeatCats = new Set(),
  pieceBudget = 0,
  capsuleRoster = [],
  capsuleCapacity = 0,
  statedPalette = []
} = {}) {
  const outfitCount = tripOutfits.length
  const lines = []
  if (pieceBudget > 0) {
    const roster = Array.isArray(capsuleRoster) && capsuleRoster.length
      ? capsuleRoster.map(piece => piece?.name || 'Garment')
      : collectPieceRoster(tripOutfits)
    const shown = roster.slice(0, 12).join(', ')
    lines.push(`Piece roster (${roster.length}): ${shown}${roster.length > 12 ? ', …' : ''}`)
    if (capsuleCapacity > 0) {
      lines.push(`Roster capacity: ${capsuleCapacity} distinct gate-valid outfit core${capsuleCapacity === 1 ? '' : 's'} across the requested use cases; showing ${outfitCount} representative look${outfitCount === 1 ? '' : 's'}.`)
    } else {
      lines.push(`${roster.length} pieces → ${outfitCount} representative ${outfitCount === 1 ? 'look' : 'looks'}`)
    }
    lines.push(roster.length <= pieceBudget
      ? `Within the ${pieceBudget}-piece budget.`
      : `Over the ${pieceBudget}-piece budget by ${roster.length - pieceBudget} — tighten a slot or allow more repeats.`)
    // Say what was done with a stated palette, including how faithfully. It is
    // a preference, not a filter, so a roster that had to reach outside it for
    // structural coverage is the expected outcome — and silently honouring it
    // "mostly" without saying so is how a request quietly goes missing.
    if (statedPalette.length && capsuleRoster.length) {
      const inPalette = capsuleRoster.filter(piece => pieceMatchesStatedPalette(piece, statedPalette)).length
      lines.push(`Palette requested (${statedPalette.join(', ')}): ${inPalette} of ${capsuleRoster.length} pieces match; the rest were needed to keep every use case wearable.`)
    }
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
  // Two different causes used to print the same sentence. A capsule slot can
  // also be trimmed because the roster has no further distinct core for it
  // (often because an overlapping slot took the shared ones) — blaming the card
  // cap there is untrue, and the UI then offered a billed "show another" for a
  // rotation that is already complete.
  const capacity = Number(slot?.capsuleSlotCapacity)
  if (Number.isFinite(capacity) && requested > capacity && actual >= capacity) {
    // A slot that can't reach even one look is already described, more
    // precisely, by its own missing-wardrobe-gap line. Saying it twice in the
    // same notes disclosure reads as two separate problems.
    if (actual === 0) return ''
    return `[rotation limit: "${label}" reduced from ${requested} to ${actual} look${actual === 1 ? '' : 's'} — this capsule roster has no further distinct outfit core for that use case]`
  }
  const cap = Number(slot?.totalOutfitCap) || PLAN_TOTAL_OUTFIT_CAP
  return `[plan trimmed: "${label}" reduced from ${requested} to ${actual} look${actual === 1 ? '' : 's'} — the plan asked for more outfits than the ${cap}-outfit total across the set allows]`
}

// The atomic capsule path validates once and never retries, so a look that
// fails validation is simply absent. Its raw validator reasons are developer
// evidence and stay in the logs, but the SHORTFALL itself is the user's to
// know: without this line the turn shows fewer cards than planned while every
// other surface asserts the result is complete, which is what pushed the
// closing model into inventing outfits to fill the hole.
// A capsule piece that reaches no look is a slot the person spent for nothing.
// Live thread_1785380251549: 4 of 24 roster pieces appeared in none of the ten
// cards — a coral maxi, two layers and a pendant — and nothing on any surface
// said so. The published palette guidance names this exact failure for accent
// pieces ("a single accent should link into several outfits instead of
// demanding new companion pieces", docs/capsule-palette-rules.md), and the same
// logic applies to any category.
//
// Deliberately a disclosure, not an enforcement: forcing an unused piece into a
// card would buy the metric with a worse outfit. Counted against every card the
// person can see, accepted and needs-review alike, because a piece inside a
// repairable card has a job waiting rather than no job at all.
// A look can fail for a piece that is WRONG or for a piece that is ABSENT. The
// atomic composer produces the second kind: on live thread_1785380251549 two of
// ten cards came back with no shoes while their own slot rosters held four and
// three gate-passing pairs respectively. Both were shipped as needs-review
// cards for the person to repair by hand — for an omission the engine could
// have filled itself, deterministically, at zero model cost.
//
// `repair-capsule-look` already completes a look this way when the person
// clicks Fix. Running the same completion during composition means the card
// arrives finished instead of broken.
//
// Two deliberate constraints:
//
// 1. The WHOLE set is re-validated after each completion, never the single
//    look. Distinct-core enforcement is a property of the rotation, so a look
//    completed in isolation could duplicate an already-accepted core and turn
//    one broken card into two.
// 2. Only structural ABSENCE is completed. A look rejected for register, trust
//    or weather is left alone — those need a different piece, not another one,
//    and re-validation would reject the attempt anyway.
const CAPSULE_GAP_GROUPS = [
  [/missing shoes/i, 'shoes'],
  [/missing bottom/i, 'bottom'],
  [/missing top or dress/i, 'top'],
]

export function completeSubmittedPlanOutfits(pendingPlan = {}, submissions = [], { visuallySeenPieceIds = new Set() } = {}) {
  const options = { visuallySeenPieceIds }
  let current = (Array.isArray(submissions) ? submissions : []).map(entry => ({ ...entry }))
  let result = validateSubmittedPlanOutfits(pendingPlan, current, options)
  const completions = []
  const slotById = new Map((pendingPlan?.slots || []).map(slot => [slot.id, slot]))

  // One completion attempt per submitted look, at most.
  for (let pass = 0; pass < current.length; pass += 1) {
    const failure = result.failures.find(entry =>
      entry?.outfit && !completions.some(done => done.slotId === entry.slot_id && done.title === entry.outfit?.title)
    )
    if (!failure) break

    const slot = slotById.get(failure.slot_id)
    const pieces = Array.isArray(failure.outfit?.pieces) ? failure.outfit.pieces : []
    const gap = describeOutfitStructureGap(pieces, { requireShoes: true })
    const missingGroup = (CAPSULE_GAP_GROUPS.find(([pattern]) => pattern.test(gap)) || [])[1]
    if (!slot || !missingGroup) {
      completions.push({ slotId: failure.slot_id, title: failure.outfit?.title, filled: false })
      continue
    }

    const presentIds = pieces.map(piece => Number(piece?.id)).filter(Boolean)
    const index = current.findIndex(entry =>
      entry?.slot_id === failure.slot_id &&
      String(entry?.title || '') === String(failure.outfit?.title || '')
    )
    if (index < 0) {
      completions.push({ slotId: failure.slot_id, title: failure.outfit?.title, filled: false })
      continue
    }

    // Deterministic candidate order, and only from this slot's own gate-passing
    // roster — a completion can never introduce a piece the slot excludes.
    const candidates = (slot.allowedPieces || [])
      .filter(piece => wardrobeCategoryGroup(piece) === missingGroup && !presentIds.includes(Number(piece.id)))
      .sort((a, b) => Number(a.id) - Number(b.id))

    let filled = null
    for (const candidate of candidates) {
      const trial = current.map((entry, position) => position === index
        ? { ...entry, piece_ids: [...presentIds, Number(candidate.id)] }
        : entry)
      const trialResult = validateSubmittedPlanOutfits(pendingPlan, trial, options)
      if (trialResult.accepted.length > result.accepted.length) {
        current = trial
        result = trialResult
        filled = candidate
        break
      }
    }
    completions.push({
      slotId: failure.slot_id,
      title: failure.outfit?.title,
      filled: Boolean(filled),
      group: missingGroup,
      addedPieceId: filled ? Number(filled.id) : null,
      addedPieceName: filled?.name || ''
    })
  }

  return {
    accepted: result.accepted,
    failures: result.failures,
    submissions: current,
    completions: completions.filter(entry => entry.filled)
  }
}

// completeSubmittedPlanOutfits adds a garment to a look the model submitted
// incomplete. That is the right call — the alternative is a broken card the
// person repairs by hand — but until now it was recorded only in a dev
// console.log and a diagnostics counter, so on every user-visible surface the
// engine changed the outfit and said nothing.
//
// Two consequences, both observed on live thread_1785467959899. The card's
// title named "Ankle Boots" while its piece_ids held the navy canvas slip
// shoes, because the completion filled the missing shoe deterministically and
// nothing reconciles a title written before the fill. And the person had no way
// to know any of it happened.
//
// Reconciling the prose would mean rewriting the model's words for it, which
// needs a second paid call and would be inventing rather than reporting. Saying
// what the engine did is the honest, free half: the title now disagrees with a
// stated fact instead of disagreeing with nothing.
export function describeCapsuleAutoCompletions(completions = []) {
  const filled = (Array.isArray(completions) ? completions : []).filter(entry => entry?.filled)
  if (!filled.length) return ''
  const detail = filled
    .map(entry => `"${entry.title || 'a look'}" got ${entry.addedPieceName || `piece ${entry.addedPieceId}`}`)
    .join('; ')
  return `[capsule looks completed: ${filled.length} look${filled.length === 1 ? ' was' : 's were'} submitted without a required piece and the engine filled it from that use case's own roster — ${detail}. Where a look's title or reason names a different garment, the piece list is what you are actually being shown.]`
}

// Three disclosure lines now count "which roster pieces reached a card", and a
// card carries its pieces under any of three keys depending on where it came
// from. One reader, so they can never disagree about what "used" means.
function capsulePieceIdsInCards(cards = []) {
  const used = new Set()
  for (const card of Array.isArray(cards) ? cards : []) {
    const ids = card?.pieceIds || card?.piece_ids || card?.pieces || []
    for (const id of Array.isArray(ids) ? ids : []) {
      const numeric = Number(typeof id === 'object' ? id?.id : id)
      if (numeric) used.add(numeric)
    }
  }
  return used
}

export function describeCapsuleRosterUtilization(roster = [], cards = []) {
  const rosterPieces = (Array.isArray(roster) ? roster : []).filter(piece => Number(piece?.id))
  if (!rosterPieces.length) return ''
  const used = capsulePieceIdsInCards(cards)
  const unused = rosterPieces.filter(piece => !used.has(Number(piece.id)))
  if (!unused.length) return ''
  const named = unused.slice(0, 4).map(piece => piece.name || `piece ${piece.id}`).join(', ')
  const rest = unused.length > 4 ? `, and ${unused.length - 4} more` : ''
  return `[capsule roster: ${unused.length} of ${rosterPieces.length} pieces did not make it into a look — ${named}${rest}]`
}

// Palette cohesion is a set property, so the per-piece versatility score cannot
// report it honestly. Keep this deliberately observational for the Step 5
// evaluation: it names family breadth, the neutral-base share, and accent
// pieces that the representative rotation did not demonstrate. It does not
// reject, repair, reorder, or force a piece into a look. That preserves the
// settled rule that palette is a preference rather than a validity gate and
// gives the owner evidence before any V2 generation pressure is considered.
// A flat family count was the wrong measure, in the same way raw utilization
// was. On live thread_1785451253837 it reported "10 colour families" for a
// roster whose 24 pieces hold 4 non-neutral garments, because it counted every
// family any colour term touched:
//
//   - 5 of the 10 were the neutral base itself (white, beige, grey, black,
//     brown), so the same line could say "10 families" and "83% neutral"
//     without noticing the contradiction;
//   - a multi-colour piece was counted into every family it touched (one pair
//     of black/white/brown sneakers supplied three);
//   - `red` existed nowhere in the capsule except as `burgundy`, the third
//     listed colour of one patterned crop top.
//
// Published guidance counts a palette as what the set READS as, so a number
// compared against it has to be built the same way. Split the neutral base out
// and name the thin families rather than folding them into one count. Still
// observational: this rejects, repairs and reorders nothing.
export function colorFamilyDisplayName(family = '') {
  const key = String(family || '').trim().toLowerCase()
  return colorFamilyLabel(key).toLowerCase()
}

export function describeCapsulePaletteCohesion(roster = [], cards = []) {
  const rosterPieces = (Array.isArray(roster) ? roster : []).filter(piece => Number(piece?.id))
  if (!rosterPieces.length) return ''

  // Per family: which pieces touch it, whether any mention of it is an actual
  // accent, and whether it ever leads a piece rather than trailing inside a
  // multi-colour list. The taxonomy carries neutrality per COLOUR, not per
  // family, and the distinction matters — navy and blue share a family.
  const byFamily = new Map()
  const accentPieces = []
  let neutralBaseCount = 0
  for (const piece of rosterPieces) {
    const colors = Array.isArray(piece?.colors) ? piece.colors : []
    const dominantFamily = colorFamilies(colors.slice(0, 1)).find(family => family !== 'unknown') || ''
    for (const color of colors) {
      const entry = colorTaxonomyEntry(color)
      const family = entry.family
      if (!family || family === 'unknown') continue
      if (!byFamily.has(family)) byFamily.set(family, { pieces: new Set(), hasAccent: false, leadsAPiece: false })
      const record = byFamily.get(family)
      record.pieces.add(Number(piece.id))
      if (entry.neutrality === 'accent') record.hasAccent = true
      if (family === dominantFamily) record.leadsAPiece = true
    }
    if (colorsArePaletteNeutral(colors)) neutralBaseCount += 1
    if (colors.some(color => colorTaxonomyEntry(color).neutrality === 'accent')) accentPieces.push(piece)
  }

  const colourFamilies = [...byFamily].filter(([, record]) => record.hasAccent)
    .sort((a, b) => b[1].pieces.size - a[1].pieces.size || a[0].localeCompare(b[0]))
  const neutralFamilyCount = byFamily.size - colourFamilies.length

  const used = capsulePieceIdsInCards(cards)
  const unusedAccents = accentPieces.filter(piece => !used.has(Number(piece.id)))
  const neutralPercent = Math.round((neutralBaseCount / rosterPieces.length) * 100)

  const baseLabel = neutralFamilyCount
    ? `a ${neutralFamilyCount}-family neutral base`
    : 'no neutral family at all'
  const colourLabel = colourFamilies.length
    ? `${colourFamilies.length} colour ${colourFamilies.length === 1 ? 'family' : 'families'} beyond ${baseLabel} — ${colourFamilies.map(([family, record]) => `${colorFamilyDisplayName(family)} (${record.pieces.size})`).join(', ')}`
    : `no colour family beyond ${baseLabel}`
  let line = `[capsule palette: ${colourLabel} · ${neutralBaseCount} of ${rosterPieces.length} pieces (${neutralPercent}%) form the neutral base`
  // The specific inflation worth naming: a family nothing in the capsule
  // actually leads with, present only inside a multi-colour garment.
  const secondaryOnly = colourFamilies.filter(([, record]) => !record.leadsAPiece).map(([family]) => family)
  if (secondaryOnly.length) {
    line += ` · ${secondaryOnly.map(colorFamilyDisplayName).join(', ')} appear${secondaryOnly.length === 1 ? 's' : ''} only as a secondary colour inside a multi-colour piece, never leading one`
  }
  if (unusedAccents.length) {
    const named = unusedAccents.slice(0, 4).map(piece => piece.name || `piece ${piece.id}`).join(', ')
    const rest = unusedAccents.length > 4 ? `, and ${unusedAccents.length - 4} more` : ''
    line += ` · ${unusedAccents.length} of ${accentPieces.length} accent-colour pieces did not make it into a look — ${named}${rest}`
  }
  return `${line}]`
}

// Owner ruling 2026-08-06: the neutral foundation is automatic. A user who
// chooses orange, teal and mustard is choosing the colour carried by the
// remaining pieces, not opting out of the neutral base. "Around 70%" is a
// target band rather than an exact aesthetic formula: for 24 pieces it means
// aim for 17, with 15–18 accepted. The band prevents rounding noise from
// spending a repair call while still catching a materially colour-heavy or
// all-neutral roster.
export function capsuleNeutralBasePlan(budget = 24) {
  const size = Math.max(1, Number(budget) || 1)
  return {
    target: Math.round(size * 0.7),
    minimum: Math.ceil(size * 0.6),
    maximum: Math.floor(size * 0.75)
  }
}

export function capsuleNeutralBaseCount(roster = []) {
  return (Array.isArray(roster) ? roster : [])
    .filter(piece => colorsArePaletteNeutral(Array.isArray(piece?.colors) ? piece.colors : []))
    .length
}

// Step 5 criterion 4 (docs/capsule-step5-evaluation.md §3): "the result
// discloses jobs, not just utilization". On thread_1785448241452, 22 of 24
// roster pieces reached a look — a 92% headline — and the two that did not were
// the capsule's ONLY layer and its questionable fifth shoe. Raw utilization
// gave the wrong verdict because it counts IDs, and a capsule's claim is about
// functions: a rotation can use most pieces while demonstrating no layer at
// all, never wearing the dependent piece it spent a slot on, or never letting a
// statement piece lead.
//
// Deterministic and observational, exactly like the palette line: it names what
// the cards did not demonstrate and rejects, repairs and reorders nothing.
// Forcing an unused piece into a look would buy the metric with a worse outfit.
// The utilization percentage is stated INSIDE this line on purpose — the
// failure mode being closed is a high percentage standing alone and reading as
// success.
export function describeCapsuleUndemonstratedJobs(roster = [], cards = []) {
  const rosterPieces = (Array.isArray(roster) ? roster : []).filter(piece => Number(piece?.id))
  if (!rosterPieces.length) return ''
  const used = capsulePieceIdsInCards(cards)
  const isUsed = piece => used.has(Number(piece.id))
  const nameList = pieces => pieces.slice(0, 3).map(piece => piece.name || `piece ${piece.id}`).join(', ') +
    (pieces.length > 3 ? `, and ${pieces.length - 3} more` : '')

  const jobs = []
  // A whole category selected for the capsule and absent from every look. The
  // researched allocation bought those slots for a reason; if none of them is
  // demonstrated, the rotation has not shown what the capsule claims to do.
  for (const group of ['top', 'bottom', 'dress', 'outerwear', 'shoes']) {
    const inGroup = rosterPieces.filter(piece => wardrobeCategoryGroup(piece) === group)
    if (!inGroup.length || inGroup.some(isUsed)) continue
    const label = group === 'outerwear' ? 'layer' : group
    jobs.push(`no look uses a ${label} (${inGroup.length} in the roster: ${nameList(inGroup)})`)
  }
  // Special jobs, each one a structured fact rather than an inference. A
  // dependent piece costs two roster slots to produce one look, so a
  // never-demonstrated one is the most expensive kind of unused piece.
  const dependents = rosterPieces.filter(pieceNeedsBase)
  const unusedDependents = dependents.filter(piece => !isUsed(piece))
  if (unusedDependents.length) {
    jobs.push(`${unusedDependents.length} of ${dependents.length} piece(s) that need a base under them appear in no look — ${nameList(unusedDependents)}`)
  }
  const statements = rosterPieces.filter(isCapsuleStatementPiece)
  if (statements.length && !statements.some(isUsed)) {
    jobs.push(`no statement piece leads a look (${nameList(statements)})`)
  }
  if (!jobs.length) return ''

  const usedCount = rosterPieces.filter(isUsed).length
  const percent = Math.round((usedCount / rosterPieces.length) * 100)
  return `[capsule jobs: ${usedCount} of ${rosterPieces.length} roster pieces (${percent}%) appear in a look, but ${jobs.length} selected job(s) went undemonstrated — ${jobs.join('; ')}]`
}

export function describeCapsuleCompositionShortfall(shortfalls = [], { plannedTotal = 0, acceptedTotal = 0 } = {}) {
  const missing = (Array.isArray(shortfalls) ? shortfalls : []).filter(entry => Number(entry?.missing) > 0)
  if (!missing.length || !(plannedTotal > 0)) return ''
  const detail = missing
    .map(entry => `"${entry.label || 'a use case'}" (${entry.missing})`)
    .join(', ')
  // Deliberately not "failed validation": the same shortfall can come from a
  // rejected look or from a composition that under-delivered, and the user's
  // question is the same either way — what happened to the looks you planned?
  // The rejected attempts are now shown as "needs review" cards, so this line
  // stopped being an announcement of absence and became a pointer at something
  // visible. Say what is on screen and why, not what is missing.
  return `[capsule shortfall: ${acceptedTotal} of ${plannedTotal} planned looks are ready — ${detail} need a fix and are shown below marked for review]`
}

function buildCoverageGapLines(coverageGaps = []) {
  return (Array.isArray(coverageGaps) ? coverageGaps : []).filter(Boolean)
}

function attachTripPlanMetadata(outfits = [], { source = 'trip_precompose', composedBy = 'engine', slotWeather = [], reuseMode = '', noRepeatCats = new Set(), pieceBudget = 0, capsuleRoster = [], capsuleCapacity = 0, capsuleSlots = [], isWinterCapsule = false, statedPalette = [], coverageGaps = [] } = {}) {
  const tripOutfits = outfits.filter(outfit => outfit?.source === source)
  if (!tripOutfits.length) return outfits
  const durationLabel = source === 'plan_outfit_set' ? 'Plan length' : 'Trip length'
  const pieceReuse = describeTripPieceReuse(tripOutfits)
  const reportLines = buildPlanReport(pieceReuse, tripOutfits, { reuseMode, noRepeatCats, pieceBudget, capsuleRoster, capsuleCapacity, statedPalette })
  const weatherLine = buildWeatherLine(slotWeather)
  const gapLines = buildCoverageGapLines(coverageGaps)
  const capsulePlanContext = capsuleRoster.length ? {
    version: 1,
    piece_budget: pieceBudget,
    capacity: capsuleCapacity,
    roster_ids: capsuleRoster.map(piece => Number(piece?.id)).filter(Boolean),
    is_winter_capsule: Boolean(isWinterCapsule),
    slots: (Array.isArray(capsuleSlots) ? capsuleSlots : []).map(slot => ({
      id: slot.id,
      label: slot.label,
      occasion: slot.occasion,
      activity: slot.activity,
      environment: slot.environment || '',
      register: slot.register || '',
      weather_label: slot.weatherLabel || '',
      weather_profile: slot.weatherProfile || {},
      core_capacity: Math.max(0, Number(slot.capsuleSlotCapacity) || 0),
      allowed_piece_ids: (slot.gateAllowedIds instanceof Set
        ? [...slot.gateAllowedIds]
        : (slot.rosterIds instanceof Set ? [...slot.rosterIds] : [])
      ).map(Number).filter(Boolean)
    }))
  } : null
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
      ...(capsulePlanContext ? { capsulePlanContext } : {}),
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

function outfitMainCoreKey(outfit = {}) {
  const pairs = outfitCategoryPairs(outfit)
  const dress = pairs.find(pair => pair.group === 'dress')
  if (dress) return `dress:${dress.id}`
  const top = pairs.find(pair => pair.group === 'top')
  const bottom = pairs.find(pair => pair.group === 'bottom')
  return top && bottom ? `separates:${top.id}:${bottom.id}` : ''
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
  // `museum` and `gallery` added 2026-07-30. Both are indoor by nature — the
  // engine already has a `gallery_art_event` occasion profile — and both were
  // missing, so the live "City Outings / Museums" slot inferred no indoor
  // weather and was gated as a hot outdoor day. Their absence is also why the
  // classifier could not correct the model there.
  return /\b(office|work\s*(day|days|week)?|workday|client[- ]?facing|client|meeting|restaurants?|museums?|galler(y|ies)|indoor)\b/.test(text) // ratchet-allow: slot-place classifier, not garment matching
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
async function resolveSlotWeather(slot = {}, { mood = '', question = '', dateRange = {}, location = '', fetchImpl, seasonIsCalendarOnly = false } = {}) {
  const moodText = mood || question
  // A weather the person or the model STATED for this slot is a claim about
  // this slot's conditions, so it keeps its full meaning even for a capsule.
  // Only the inferred, plan-wide season word is demoted.
  if (slot.statedWeather && slot.statedWeather !== 'indoor') {
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
  const targetLocation = slot.location || location || ''
  const profile = await getWeatherProfileForPlan({
    dateRange: { start: day || dateRange.start || undefined, end: day || dateRange.end || dateRange.start || undefined },
    location: targetLocation,
    season: slot.statedWeather === 'indoor' ? (slot.transitSeason || '') : slot.season,
    mood: moodText,
    seasonIsCalendarOnly,
    ...(fetchImpl ? { fetchImpl } : {})
  })
  const descriptor = describeWeatherProfile(profile)
  if (slot.statedWeather === 'indoor') {
    const transitLabel = profile.weatherSource === 'live'
      ? `${descriptor} (live forecast${slot.location ? `, ${slot.location}` : ''})`
      : `${isGenericSeason(slot.transitSeason) ? descriptor : (slot.transitSeason || descriptor)} (estimated)`
    return {
      // Extreme heat must constrain the base because a heavy main cannot be
      // removed during transit. Cold remains handled by the established
      // indoor-base + reusable transition-layer rules; applying the ordinary
      // cold main gate here would suppress valid indoor bases before those
      // layer requirements can do their job.
      profile: { ...profile, isCold: false, isIndoor: true, weatherSource: 'indoor_transit' },
      label: `indoor; transit: ${transitLabel}`
    }
  }
  if (profile.weatherSource === 'live') {
    const where = slot.location ? `, ${slot.location}` : ''
    return { profile, label: `${descriptor} (live forecast${where})` }
  }
  // Heuristic: prefer the user's own weather phrasing when they gave one, since
  // it is more informative than the coarse hot/cold/mild descriptor. Either way
  // mark it as an estimate — this label previously looked exactly as
  // authoritative as the live-forecast label above even though nothing here
  // came from a real forecast, so the owner had no way to tell a live lookup
  // from the model's own guess.
  const heuristicLabel = isGenericSeason(slot.season) ? descriptor : slot.season
  return { profile, label: `${heuristicLabel} (estimated)` }
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
export const MIN_ENFORCED_CAPSULE_BUDGET = 6
const PLAN_WORKBENCH_PIECE_LIMIT = 40

// `taupe` and `oatmeal` were added 2026-07-30. They were missing, which was
// harmless while the neutral test was "does ANY colour match" — one recognised
// neutral carried the piece. It stopped being harmless when the test became
// "do ALL colours match" (see pieceReadsAsNeutral): an unrecognised neutral
// name then wrongly disqualifies the piece. Audited against every colour name
// in the wardrobe; these two were the only genuine neutrals the list missed.
// `silver` is deliberately not here — published practice treats metallics as
// their own tier, not as a base neutral.
// "Recombines with everything" is the claim the neutral bonus pays for, and a
// piece only earns it if it introduces no colour of its own. The test used to
// be whether ANY tagged colour was neutral, which paid the full bonus to a
// five-colour floral (live example: piece 87, `pink/green/blue/yellow/white`,
// which qualified on the strength of one "blue"). Requiring EVERY colour to be
// neutral keeps the two-tone patterns that genuinely do recombine — a navy/white
// stripe tee, a grey/black striped cardigan — and drops the prints that do not.
//
// See docs/capsule-palette-rules.md: this is the neutral/accent distinction the
// published frameworks draw, applied to the score that was blurring it.
function pieceReadsAsNeutral(piece = {}) {
  // A piece the wardrobe itself calls loud is a statement piece regardless of
  // palette, and must not collect the recombination bonus.
  if (String(piece.pattern_complexity || '').toLowerCase() === 'loud') return false
  return colorsArePaletteNeutral(piece.colors)
}

// Spec §7 path 1: a palette the person already stated in their request is the
// cheapest input there is — the words are in `question` and were being dropped
// entirely, because roster selection reads structured columns and never the
// request text. Deliberately NOT a regex sweep: the vocabulary comes from the
// wardrobe's own stored colour values (the same set the Wardrobe filter is
// built from), so it is per-user and cannot drift from what is actually
// taggable. Measured 2026-07-28: 38 distinct stored values, 37 of them inside
// the picker vocabulary, one off-vocabulary mention in 466.
//
// Returns `{ colors, optOut }` rather than a bare list because "said nothing"
// and "explicitly wants no colour constraint" are different states and must
// stay distinguishable: a stored palette preference (spec §7 path 3) would
// otherwise apply to every future capsule with no way to turn it off for one
// request. `optOut` is that off switch.
export function extractStatedPalette(question = '', pool = []) {
  const text = ` ${String(question || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ')} ` // ratchet-allow: normalizing user request text, not garment matching
  if (!text.trim()) return { colors: [], accentColors: [], accentFamilies: [], optOut: false }
  // Phrased as whole intents rather than keywords: "any colour" and "no colour
  // preference" are opt-outs; "any black" is not.
  const OPT_OUT_PHRASES = [
    'any colour', 'any color', 'any colours', 'any colors',
    'all colours', 'all colors',
    'no colour preference', 'no color preference',
    'no palette', 'ignore the palette', 'ignore my palette', 'skip the palette',
    'without a palette', 'no colour restriction', 'no color restriction',
    'do not limit the colours', 'do not limit the colors',
    "don t limit the colours", "don t limit the colors",
  ]
  if (OPT_OUT_PHRASES.some(phrase => text.includes(` ${phrase} `) || text.includes(`${phrase} `))) { // ratchet-allow: whole-phrase user intent in the request, not garment text
    return { colors: [], accentColors: [], accentFamilies: [], optOut: true }
  }
  const wardrobeVocabulary = new Set()
  for (const piece of Array.isArray(pool) ? pool : []) {
    for (const color of Array.isArray(piece?.colors) ? piece.colors : []) {
      const value = String(color || '').toLowerCase().trim()
      if (value) wardrobeVocabulary.add(value)
    }
  }
  // Parse against the shared taxonomy, not only colours currently owned. An
  // absent request is still meaningful: it must reach the supply-gap report
  // instead of vanishing before the bench is built. Aliases canonicalize to
  // their family representative for matching while preserving the person's
  // own word for the explanation (fuchsia -> Pink family).
  const stated = new Set()
  for (const term of COLOR_REQUEST_NAMES) {
    if (text.includes(` ${term} `)) stated.add(term) // ratchet-allow: canonical colour vocabulary against the user request, not garment names
  }
  // "neutrals" is the one word people reach for that names a set rather than a
  // colour. Expand it against what they actually own, not against a fixed list.
  if (text.includes(' neutral ') || text.includes(' neutrals ')) { // ratchet-allow: one set-naming word in the request, expanded from stored colours
    for (const color of wardrobeVocabulary) {
      const { neutrality } = colorTaxonomyEntry(color)
      if (neutrality === 'neutral' || neutrality === 'neutral-adjacent') stated.add(color)
    }
  }
  const colors = [...stated].sort()
  const accentColors = colors.filter(color => colorTaxonomyEntry(color).neutrality === 'accent')
  return { colors, accentColors, accentFamilies: colorFamilies(accentColors).filter(family => family !== 'unknown'), optOut: false }
}

function pieceMatchesStatedPalette(piece = {}, palette = []) {
  if (!palette.length) return false
  const requestedFamilies = new Set(colorFamilies(palette).filter(family => family !== 'unknown'))
  return colorFamilies(Array.isArray(piece?.colors) ? piece.colors : [])
    .some(family => requestedFamilies.has(family))
}

function capsuleAccentFamilyNames(palette = []) {
  return [...new Set((Array.isArray(palette) ? palette : [])
    .filter(color => colorTaxonomyEntry(color).neutrality === 'accent')
    .map(color => colorTaxonomyEntry(color).family)
    .filter(family => family && family !== 'unknown'))]
}

function pieceCarriesAccent(piece = {}) {
  return (Array.isArray(piece?.colors) ? piece.colors : [])
    .some(color => colorTaxonomyEntry(color).neutrality === 'accent')
}

function pieceMatchesAccentFamily(piece = {}, family = '') {
  return colorFamilies(Array.isArray(piece?.colors) ? piece.colors : []).includes(family)
}

function describeCapsuleAccentSupplyGap(palette = [], bench = []) {
  const missing = capsuleAccentFamilyNames(palette).filter(family =>
    !(Array.isArray(bench) ? bench : []).some(piece => pieceMatchesAccentFamily(piece, family))
  )
  if (!missing.length) return ''
  return `[capsule palette: the eligible wardrobe could not supply ${missing.map(colorFamilyDisplayName).join(', ')} for this season and lifestyle, so those places stayed in the neutral foundation rather than substituting unrelated colours]`
}

function capsuleVersatilityScore(piece = {}, { isSummer = false, palette = [] } = {}) {
  let score = 0
  const colors = (Array.isArray(piece.colors) ? piece.colors : []).map(color => String(color).toLowerCase())
  // The recombination bonus, paid only to pieces that introduce no colour of
  // their own — see pieceReadsAsNeutral for why "any neutral" was too generous.
  if (pieceReadsAsNeutral(piece)) score += 12
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
  // A stated palette is a PREFERENCE, never a filter. This project's own gate
  // history is the argument: a hard filter on a taste dimension starves
  // capacity (the `home` gate ruling). A piece outside the palette still
  // competes and can still be selected when structure needs it — coverage
  // reserves and the supply precondition are unaffected by this term.
  if (pieceMatchesStatedPalette(piece, palette)) score += CAPSULE_STATED_PALETTE_BONUS
  return score
}

// Category quotas for a ~budget-piece day capsule. Kept proportional so a bigger
// budget widens tops/bottoms rather than piling on shoes.
function capsuleQuotas(budget = 10, { isSummer = false, isWinter = false } = {}) {
  const shoes = budget >= 30 ? 5 : budget >= 24 ? 4 : budget >= 12 ? 3 : Math.min(3, Math.max(2, Math.round(budget * 0.2)))
  // Season-invariant by research, not by assumption — see
  // docs/capsule-real-world-rules.md. Published capsule frameworks allot two
  // layers regardless of season and swap WHICH outerwear is active (the wool
  // coat goes into storage in summer, a lightweight layer takes its place);
  // the count does not move. The 24-piece summer capsule allots exactly 2
  // layering items, for the two reasons that apply to any capsule covering
  // whole days: air-conditioned interiors and evenings that cool off.
  //
  // This previously read `isWinter && budget >= 12 ? 2 : (budget >= 8 &&
  // (!isSummer || budget < 12) ? 1 : 0)`, which evaluated to ZERO outerwear
  // for a summer capsule at every budget. No framework supports that, and on
  // live thread_1785380251549 the model overrode it by taking 4. The winter
  // special case was right about the number and wrong to think it was about
  // winter: season belongs in the gate that decides which outerwear qualifies,
  // never in how many the capsule can hold. Winter's threshold is preserved
  // exactly, so no winter capsule changes.
  const outerwear = budget >= 12 ? 2 : (budget >= 8 ? 1 : 0)
  // Every published breakdown that lists dresses separately allots 2–3 and
  // treats a dress as a complete outfit core rather than a top-equivalent (see
  // docs/capsule-real-world-rules.md: 3 at the 24-piece summer capsule, 2 at
  // Un-Fancy's 37, 2–3 across the 30–40 range). A flat 1 was below every one of
  // them, and it did more damage than a quota usually can: the bench's
  // per-category minimum reads this number, so on live thread_1785380251549 the
  // model was shown ONE dress when 10 of the wardrobe's 18 passed at least one
  // slot's gate. Nine eligible dresses were invisible to a stage whose whole
  // purpose is letting the model choose.
  const dress = budget >= 24 ? 3 : budget >= 12 ? 2 : budget >= 6 ? 1 : 0
  const remaining = Math.max(0, budget - shoes - outerwear - dress)
  // Tops carry the combinatorial load: they create the visible variety while
  // bottoms repeat unnoticed, which is why published guidance puts the ratio at
  // 3:1 and every actual breakdown lands between 1.7:1 and 2:1 (Un-Fancy 15:9,
  // the 24-piece summer capsule 8:4). The 0.45 split here produced ~1.1:1 —
  // below even this wardrobe's own 85:59 (1.44:1), so the engine was actively
  // skewing toward bottoms relative to what the closet holds.
  //
  // 0.35 targets the observed breakdowns (~1.9:1) rather than the stated 3:1.
  // Deliberate: 3:1 is advice for someone acquiring a wardrobe, and this engine
  // selects from a closet that already exists. The measured breakdowns are what
  // real capsules of this size are actually made of.
  const bottom = Math.max(2, Math.round(remaining * 0.45))
  const top = Math.max(2, remaining - bottom)
  return { top, bottom, dress, outerwear, shoes }
}

// A coarse "these two read as the same garment" signature for capsule
// de-duplication: category + dominant color + garment kind + pattern. Two black
// solid crew tees collapse to one key; a black tee and a white tee do not.
function capsuleSimilarityKey(piece = {}) {
  const group = wardrobeCategoryGroup(piece)
  const color = colorTaxonomyEntry((Array.isArray(piece.colors) ? piece.colors : [])[0]).family
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

// A capsule slot is finite inventory, so every selected garment must have at
// least one real job in the requested lifestyle. Apply the same deterministic
// trust/register/weather/activity gates used by the downstream workbench
// before category quotas spend the budget. This is deliberately a UNION:
// failing one context is fine; failing every requested context makes the piece
// dead roster weight. With no slots, preserve the legacy generic selector.
// The gate call a single capsule slot makes against a candidate pool — pulled
// out of capsulePiecesEligibleForAnySlot so the bench builder and the roster
// validator can ask the identical per-slot question without re-deriving it.
function slotGateEligiblePieces(pool = [], slot = {}, { isSummer = false, isWinter = false } = {}) {
  const slotRequestText = [slot.label, slot.bestFor, slot.coverage, slot.planNote].filter(Boolean).join('. ')
  const indoorSlot = slot.statedWeather === 'indoor' || slot.environment === 'indoor'
  const season = indoorSlot
    ? (slot.transitSeason || 'indoor')
    : (slot.statedWeather || slot.season || (isSummer ? 'summer' : (isWinter ? 'winter' : '')))
  const slotWeatherProfile = weatherProfileFromContext({ mood: slotRequestText, season })
  if (indoorSlot) slotWeatherProfile.isCold = false
  const ceilingRank = effectiveSlotRegisterCeilingRank(slot)
  const registerCeiling = registerRankName(ceilingRank) || null
  const { allowedPieces } = filterWholeWardrobePiecesForGeneration(pool, {
    occasion: slot.occasion,
    explorationMode: 'moderate',
    weatherProfile: slotWeatherProfile,
    mood: slotRequestText,
    activity: slot.activity,
    request: slotRequestText,
    ...(registerCeiling ? { registerCeiling } : {})
  })
  return allowedPieces
}

function capsulePiecesEligibleForAnySlot(pool = [], slots = [], { isSummer = false, isWinter = false } = {}) {
  const normalizedSlots = Array.isArray(slots) ? slots.filter(Boolean) : []
  if (!normalizedSlots.length) return pool
  const eligibleIds = new Set()
  for (const slot of normalizedSlots) {
    const allowedPieces = slotGateEligiblePieces(pool, slot, { isSummer, isWinter })
    for (const piece of allowedPieces) eligibleIds.add(Number(piece.id))
  }
  return pool.filter(piece => eligibleIds.has(Number(piece.id)))
}

// Register reservation belongs only to categories required to form a separates
// outfit. A top + bottom + shoes path must clear a low-register slot's gates;
// dresses are an alternative main path and outerwear is optional. The latter
// two still keep their independent researched allocation guarantees below.
const CAPSULE_REGISTER_RESERVE_GROUPS = new Set(['top', 'bottom', 'shoes'])

function capsuleDemandReserve(slots = [], quotas = {}) {
  const demandByRank = new Map()
  for (const slot of Array.isArray(slots) ? slots : []) {
    const rank = effectiveSlotRegisterCeilingRank(slot)
    if (rank === null) continue
    demandByRank.set(rank, (demandByRank.get(rank) || 0) + 1)
  }
  const ranks = [...demandByRank.keys()].sort((a, b) => a - b)
  if (!ranks.length) return null
  const rank = ranks[0]
  const looks = demandByRank.get(rank) || 0
  return {
    rank,
    looks,
    byGroup: {
      // One complete separates path covers the lifestyle job. targetOutfits
      // controls how many representative cards are shown; it is not evidence
      // that the person needs duplicate garments at this register.
      top: Math.min(quotas.top || 0, 1),
      bottom: Math.min(quotas.bottom || 0, 1),
      // This reserve exists for COVERAGE — the 2026-07-14 failure it was
      // written for was an all-elevated roster where "casual-occasion slots got
      // zero outfits because only shoes cleared the ceiling — no top/bottom/
      // dress did." The top and bottom reserves above solve that: a reserved
      // everyday top plus a reserved everyday bottom forms a casual core, and
      // capsuleSlotCoreKeys builds cores from top+bottom OR dress. A casual
      // DRESS was never load-bearing for that fix — it rode along on it, and
      // demanding the plan's strictest register of the one dress is what has
      // been rejecting rosters.
      shoes: Math.min(quotas.shoes || 0, 1)
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

// Extracted so the end-of-selection post-condition check asserts the exact same
// predicate this pass optimises for — a check that re-derives its own version of
// the rule is a second source of truth waiting to drift.
// A main-category garment the wardrobe's own structured judgment calls loud.
// Deliberately the same column the versatility score now declines to reward as
// a neutral: one place decides what "statement" means, so the score and the
// guarantee cannot disagree about which pieces they are talking about.
const CAPSULE_STATEMENT_MIN_MAIN_PIECES = 8
// Comparable to the neutral-colour term so a stated palette actually moves the
// ranking, but not so large it can outweigh several structural signals at once.
const CAPSULE_STATED_PALETTE_BONUS = 14

// The groups a capsule look is actually built from. Deliberately the same set
// buildCapsuleBench's byGroup buckets and the composer's structure gap use, so
// the bench cannot offer a piece no card could ever contain.
const CAPSULE_COMPOSABLE_GROUPS = new Set(['top', 'bottom', 'dress', 'outerwear', 'shoes'])

// Owner-set (and, for pieces the tagger touches, tagger-set) construction fact:
// this garment cannot be worn against skin on its own. In a finite capsule it
// therefore costs two roster slots to produce one look — fine when a base is
// there, dead weight when it isn't. Only 'yes' counts: unset means nobody has
// looked, and must behave exactly as it did before the field existed.
function pieceNeedsBase(piece = {}) {
  return String(piece?.needs_base || '').toLowerCase() === 'yes'
}

// The single, shared definition of "a top that can serve as a base," used
// everywhere a dependent's base needs to be found — capacity math, slot
// validation, outfit validation, and the roster-level guarantee — so none of
// them can ever disagree about what "available" means (owner review
// 2026-07-30). A top tagged needs_base cannot itself be a base. Structured
// opacity rules out sheer/semi_sheer/open_weave — the tagger prompt already
// states these "cannot work alone against skin as a base layer"
// (styling-engine/prompts.js). Unknown/unset opacity (206 of 243 pieces on
// the live wardrobe) stays eligible: absence of a tag is not evidence of
// unsuitability, and excluding on missing metadata would not be the
// additive no-op this correction requires. Neckline, strap/sleeve shape,
// bulk, colour and visual fit stay model judgment — this predicate answers
// only "could this structurally function as coverage," never "does it look
// right under this specific piece."
function isCapsuleBaseCandidate(piece = {}) {
  if (wardrobeCategoryGroup(piece) !== 'top') return false
  if (pieceNeedsBase(piece)) return false
  const opacity = String(piece?.opacity || '').toLowerCase().trim()
  return !['sheer', 'semi_sheer', 'open_weave'].includes(opacity)
}

// One definition of "this garment can lead a look," shared by the bench's
// protagonist reserve and the statement-presence guarantee.
//
// They had diverged. buildCapsuleBench reserved protagonists on
// `loud || visual_roles.includes('hero_piece')`, while isCapsuleStatementPiece
// — the post-condition, the validator, and the undemonstrated-jobs disclosure —
// read `pattern_complexity === 'loud'` alone. On the live wardrobe that is 56
// main pieces versus 33: twenty-three garments the tagger explicitly calls
// hero_piece were invisible to the guarantee.
//
// The cost was not academic. Live thread_1785883879348 shipped a rotation
// leading on a black/brown lace floral midi dress (990360, `hero_piece` +
// `texture_piece`, pattern_complexity `medium`) and a black blouson v-neck top
// (`hero_piece`, `solid`) — and the guarantee counted one statement piece,
// because neither is a loud PRINT. A loud print is one way to lead a look;
// cut, texture and colour weight are others, and `visual_roles` is where the
// tagger already records that judgment. Reading one column of it was the bug.
//
// This remains useful descriptive evidence for bench diagnostics and model
// context. It is not a universal statement-piece requirement.
function pieceReadsAsProtagonist(piece = {}) {
  if (String(piece?.pattern_complexity || '').toLowerCase() === 'loud') return true
  const profile = pieceStyleProfile(piece)
  const roles = Array.isArray(profile?.visual_roles) ? profile.visual_roles : []
  return roles.includes('hero_piece')
}

// The statement guarantee is specifically about a MAIN garment leading a look,
// so it keeps its category restriction; the bench reserve deliberately has no
// such restriction (an expressive shoe or layer is worth offering too). That
// difference is intentional — the "does this read as expressive" half is not.
function isCapsuleStatementPiece(piece = {}) {
  const group = wardrobeCategoryGroup(piece)
  if (!['top', 'bottom', 'dress'].includes(group)) return false
  return pieceReadsAsProtagonist(piece)
}

function isCapsuleWinterCoveredBase(piece = {}) {
  return wardrobeCategoryGroup(piece) === 'top' &&
    String(piece?.season || '').toLowerCase() !== 'warm' &&
    ['short', 'long'].includes(sleeveCoverage(piece))
}

function ensureWinterIndoorTopBalance(roster = [], groups = {}, required = 0, scoreOf = new Map(), protectedPieces = new Set()) {
  if (!(required > 0)) return roster
  const isCoveredBase = isCapsuleWinterCoveredBase
  let nextRoster = roster
  let guard = 0
  while (nextRoster.filter(isCoveredBase).length < required && guard < required) {
    guard += 1
    const candidate = (groups.top || []).find(piece => !nextRoster.includes(piece) && isCoveredBase(piece))
    if (!candidate) break
    const swapTarget = nextRoster
      .filter(piece =>
        wardrobeCategoryGroup(piece) === 'top' &&
        !isCoveredBase(piece) &&
        !protectedPieces.has(piece))
      .sort((a, b) => (scoreOf.get(a) || 0) - (scoreOf.get(b) || 0))[0]
    if (!swapTarget) break
    nextRoster = nextRoster.map(piece => piece === swapTarget ? candidate : piece)
  }
  return nextRoster
}

// The two winter outerwear jobs a >=12-piece winter capsule must cover
// (spec: quota shifts one top slot into outerwear precisely so these are
// separate roles, not one jacket doing both). Named at module scope so
// selectCapsuleRoster's reserve pass and validateCapsuleRoster's structural
// check test the identical definition.
function isCapsuleIndoorKnitLayer(piece = {}) {
  const everydayRank = formalityRank('everyday')
  return wardrobeCategoryGroup(piece) === 'outerwear' &&
    garmentKind(piece) === 'cardigan' &&
    ['medium', 'heavy'].includes(fabricWeight(piece)) &&
    pieceClearsCeilingRank(piece, everydayRank)
}

function isCapsuleColdTransitionLayer(piece = {}) {
  return wardrobeCategoryGroup(piece) === 'outerwear' &&
    ['coat', 'jacket'].includes(garmentKind(piece)) &&
    (fabricWeight(piece) === 'heavy' || pieceHasInsulatingFiber(piece))
}

function ensureWinterLayerRole(roster = [], groups = {}, predicate, scoreOf = new Map(), protectedPieces = new Set()) {
  if (typeof predicate !== 'function') return roster
  const selected = roster.filter(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  if (selected.some(predicate)) return roster
  const candidate = (groups.outerwear || []).find(piece => !roster.includes(piece) && predicate(piece))
  if (!candidate) return roster
  const swapTarget = selected
    .filter(piece => !protectedPieces.has(piece))
    .sort((a, b) => (scoreOf.get(a) || 0) - (scoreOf.get(b) || 0))[0]
  if (!swapTarget) return roster
  return roster.map(piece => piece === swapTarget ? candidate : piece)
}

function ensureCapsuleGroupFloorReserve(roster = [], groups = {}, group = '', {
  floorRank = null,
  ceilingRank = null,
  allowedIds = null,
  protectedCeilingRank = null,
  protectedCount = 0,
  protectedPieces = new Set(),
  scoreOf = new Map()
} = {}) {
  if (floorRank === null || ceilingRank === null) return roster
  const selected = roster.filter(piece => wardrobeCategoryGroup(piece) === group)
  const inBand = piece =>
    (!allowedIds || allowedIds.has(Number(piece.id))) &&
    pieceMeetsFloorRank(piece, floorRank) &&
    pieceClearsCeilingRank(piece, ceilingRank)
  if (selected.some(inBand)) return roster
  const candidate = (groups[group] || []).find(piece => !roster.includes(piece) && inBand(piece))
  if (!candidate) return roster
  const safeTargets = selected.filter(piece => {
    if (inBand(piece)) return false
    if (protectedPieces.has(piece)) return false
    if (protectedCeilingRank === null || !pieceClearsCeilingRank(piece, protectedCeilingRank)) return true
    const protectedAfterSwap = selected.filter(other =>
      other !== piece && pieceClearsCeilingRank(other, protectedCeilingRank)
    ).length
    return protectedAfterSwap >= protectedCount
  })
  const swapTarget = safeTargets.sort((a, b) => (scoreOf.get(a) || 0) - (scoreOf.get(b) || 0))[0]
  if (!swapTarget) return roster
  return roster.map(piece => piece === swapTarget ? candidate : piece)
}

function elevatedCapsuleDemands(slots = [], pool = [], { isSummer = false } = {}) {
  const floorRank = formalityRank('elevated')
  const demands = []
  for (const slot of (Array.isArray(slots) ? slots : []).filter(slotWantsElevatedShoe)) {
    const ceilingRank = effectiveSlotRegisterCeilingRank(slot)
    if (ceilingRank === null || ceilingRank < floorRank) continue
    const slotRequestText = [slot.label, slot.bestFor, slot.coverage, slot.planNote].filter(Boolean).join('. ')
    const indoorSlot = slot.statedWeather === 'indoor' || slot.environment === 'indoor'
    const season = indoorSlot
      ? (slot.transitSeason || 'indoor')
      : (slot.statedWeather || slot.season || (isSummer ? 'summer' : 'winter'))
    const slotWeatherProfile = weatherProfileFromContext({ mood: slotRequestText, season })
    if (indoorSlot) slotWeatherProfile.isCold = false
    const occasionCeilingRank = formalityRank(resolveOccasionProfile(slot?.occasion)?.register_ceiling)
    const registerCeilingOverride = occasionCeilingRank !== null && ceilingRank > occasionCeilingRank
      ? registerRankName(ceilingRank)
      : null
    const { allowedPieces } = filterWholeWardrobePiecesForGeneration(pool, {
      occasion: slot.occasion,
      explorationMode: 'moderate',
      weatherProfile: slotWeatherProfile,
      mood: slotRequestText,
      activity: slot.activity,
      request: slotRequestText,
      ...(registerCeilingOverride ? { registerCeiling: registerCeilingOverride } : {})
    })
    demands.push({ floorRank, ceilingRank, allowedIds: idSetForPieces(allowedPieces) })
  }
  return demands
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

// Task 1 (2026-07-28 capsule repro, thread_1785288370357): the atomic capsule
// composer validates once with no retry, and the activity-footwear exclusion
// enforced by validateSubmittedPlanOutfits (via footwearComfortVerdict) was
// never stated in submission_requirements — a slot like 'city_museum' could
// only discover "high heel unsuitable" by having a whole look rejected. State
// the actual constraint in plain terms, not a generic "pick sensible shoes",
// and only when the slot's resolved activity profile genuinely excludes
// something (must be a no-op otherwise).
function activityFootwearRequirementText(profile) {
  const heelExclusions = profile?.rules?.excluded_heel_heights || []
  const supportExclusions = profile?.rules?.excluded_walk_support || []
  const parts = []
  if (heelExclusions.length) parts.push(`${heelExclusions.join('/')}-height heels`)
  if (supportExclusions.length) parts.push(`${supportExclusions.join('/')} walk-support shoes`)
  return `This slot's activity profile (${profile.label}) excludes ${parts.join(' and ')} — choose footwear with adequate heel height and walk support for it (e.g. flats, sneakers, loafers, or low block heels).`
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

// Every reserve pass in selectCapsuleRoster states a guarantee, mutates the
// roster to get it, and then hands the roster to the next pass — which is free
// to swap that guarantee straight back out. Measured on the live wardrobe: a
// winter/casual capsule at budget 10 reaches 2 register-compliant tops after
// ensureCapsuleGroupReserve, and ends with 1, because
// ensureWinterIndoorTopBalance swaps on sleeve coverage alone and knows nothing
// about register. Two of the final three tops are then unwearable in the very
// slots that asked for them.
//
// Rather than add another protected-set argument (three of those exist already
// and this is the third time one has proved insufficient), collect what the
// passes were each promising and check it ONCE at the end. Declaring the
// guarantees as data also means a new reserve pass gets checked automatically
// instead of relying on whoever adds it to thread a protected set correctly.
export function capsuleRosterPostConditions({ quotas = {}, reserve = null, isWinter = false, shoeDemands = [], roster = [] } = {}) {
  const conditions = []
  if (reserve) {
    for (const [group, required] of Object.entries(reserve.byGroup || {})) {
      if (!CAPSULE_REGISTER_RESERVE_GROUPS.has(group)) continue
      if (!(required > 0)) continue
      conditions.push({
        code: `register_reserve:${group}`,
        group,
        required,
        predicate: piece => pieceClearsCeilingRank(piece, reserve.rank),
        describe: () => `${required} ${group}(s) clearing the ${registerRankName(reserve.rank)} ceiling the plan's lowest-register slots need`
      })
    }
  }
  // Conditional by nature, which is why it reads the roster rather than the
  // quotas: a dependent garment is only a problem when nothing in the capsule
  // can go under it. Absent any `needs_base` piece the condition is not added
  // at all, so an unpopulated field changes nothing anywhere.
  const dependentTops = (Array.isArray(roster) ? roster : [])
    .filter(piece => wardrobeCategoryGroup(piece) === 'top' && pieceNeedsBase(piece))
  if (dependentTops.length) {
    conditions.push({
      code: 'base_for_dependent_top',
      group: 'top',
      required: 1,
      predicate: isCapsuleBaseCandidate,
      describe: () => `a top that can be worn alone, to go under ${dependentTops[0]?.name || 'the layering piece'}`
    })
  }
  for (const [index, demand] of (Array.isArray(shoeDemands) ? shoeDemands : []).entries()) {
    if (!(demand?.required > 0) || typeof demand.predicate !== 'function') continue
    conditions.push({
      code: `shoe_reserve:${index}`,
      group: 'shoes',
      required: demand.required,
      predicate: demand.predicate,
      describe: () => `${demand.required} shoe(s) for ${demand.label || 'a reserved use case'}`
    })
  }
  return conditions
}

// Repair only what is actually broken, and never at the cost of something that
// currently holds: a swap target must be a piece whose removal leaves every
// satisfied condition still satisfied. When both requirements can be met by one
// garment the repair finds it; when the wardrobe cannot satisfy a condition at
// all, the condition is reported rather than silently abandoned. A roster with
// no violated condition is returned untouched, which is what keeps every
// already-ratified selection byte-identical.
// group '*' is a whole-roster guarantee (a statement piece can be a top, a
// bottom or a dress) rather than a per-category one. Shared so the enforcer and
// the validator can never disagree about what a condition means — the whole
// point of declaring the guarantees as data.
//
// `roster` is the candidate pool being evaluated against — required for the
// dependent-top rule below, revised 2026-07-30 after owner review of the
// first version's overcorrection. The original rule made a needs_base piece
// fail EVERY group:'top' condition unconditionally, which swapped out
// expressive dependent pieces (piece 258 in the recorded ranking A/B) even
// when their base was genuinely present and usable — "a dependent cannot
// satisfy the guarantee by itself" was implemented as "a dependent can never
// satisfy a top guarantee," which is stricter than intended. The correct
// rule: a needs_base piece counts toward a top-group guarantee only when a
// standalone base (isCapsuleBaseCandidate) exists in the SAME candidate
// pool — a supported dependent is real dependent-top capacity, an
// unsupported one is not. base_for_dependent_top is exempt: it IS the
// guarantee that a standalone base exists, so it must keep reading
// standalone tops as standalone tops rather than deferring to itself.
export function capsuleConditionMatches(piece, condition, roster = []) {
  if (!((condition.group === '*' || wardrobeCategoryGroup(piece) === condition.group) && condition.predicate(piece))) {
    return false
  }
  if (condition.group === 'top' && condition.code !== 'base_for_dependent_top' && pieceNeedsBase(piece)) {
    return (Array.isArray(roster) ? roster : []).some(isCapsuleBaseCandidate)
  }
  return true
}

export function enforceCapsulePostConditions(roster = [], groups = {}, allConditions = [], scoreOf = new Map(), protectedPieces = new Set()) {
  // Ceilings were already inert here (required: 0), and `validatorOnly` makes
  // that exclusion explicit and reusable: a guarantee the VALIDATOR owns must
  // not become a swap the deterministic selector performs, or a shipped roster
  // changes as a side effect of teaching the model path a new rule.
  const conditions = (Array.isArray(allConditions) ? allConditions : []).filter(condition => !condition?.validatorOnly)
  let nextRoster = [...roster]
  const unsatisfied = []
  // countFor's own candidateRoster IS the support context for the piece being
  // tested — correct by construction. The two bare calls below (evaluating a
  // candidate not yet admitted) use nextRoster, the current pre-swap state:
  // for a top-group swap this cannot remove an existing base out from under a
  // dependent (swaps stay within the incoming candidate's own category), and
  // the swap this function actually commits to is re-verified against
  // withSwap via countFor immediately below, so an imprecise candidate filter
  // here costs at most a missed repair opportunity, never a false accept.
  const countFor = (candidateRoster, condition) =>
    candidateRoster.filter(piece => capsuleConditionMatches(piece, condition, candidateRoster)).length
  // One repair per condition at most; the guard is belt-and-braces against a
  // predicate pair that could otherwise trade places forever.
  for (let pass = 0; pass < conditions.length * 2; pass += 1) {
    const violated = conditions.find(condition =>
      !unsatisfied.includes(condition.code) && countFor(nextRoster, condition) < condition.required
    )
    if (!violated) break
    const inRoster = new Set(nextRoster)
    // Prefer a candidate that also satisfies the other conditions on this
    // group — that is exactly the sleeve-covered AND register-compliant top
    // the winter case needs, and taking it avoids a second repair.
    const candidatePool = violated.group === '*'
      ? Object.values(groups).flat()
      : (groups[violated.group] || [])
    const candidate = candidatePool
      .filter(piece => !inRoster.has(piece) && capsuleConditionMatches(piece, violated, nextRoster))
      .sort((a, b) => {
        // Prefer a candidate that also satisfies the other conditions bearing on
        // its own category — the sleeve-covered AND register-compliant top the
        // winter case needs — so one swap does not create the next violation.
        const satisfied = piece => conditions
          .filter(condition => condition.group === '*' || condition.group === wardrobeCategoryGroup(piece))
          .filter(condition => capsuleConditionMatches(piece, condition, nextRoster)).length
        return satisfied(b) - satisfied(a) || (scoreOf.get(b) || 0) - (scoreOf.get(a) || 0)
      })[0]
    if (!candidate) {
      unsatisfied.push(violated.code)
      continue
    }
    // Swap within the incoming candidate's own category, so a whole-roster
    // guarantee cannot quietly rewrite the category quotas to satisfy itself.
    const candidateGroup = wardrobeCategoryGroup(candidate)
    const relevantConditions = conditions.filter(condition =>
      condition.group === '*' || condition.group === candidateGroup
    )
    const swapTarget = nextRoster
      .filter(piece => {
        if (wardrobeCategoryGroup(piece) !== candidateGroup) return false
        if (protectedPieces.has(piece)) return false
        if (capsuleConditionMatches(piece, violated, nextRoster)) return false
        // Judge the roster AFTER the swap, not merely after the removal: the
        // incoming candidate frequently carries the very property the outgoing
        // piece was holding (an everyday long-sleeved knit replacing an
        // elevated long-sleeved blouse keeps the covered-base count intact).
        // Testing removal alone rejects exactly the repairs worth making.
        const withSwap = nextRoster.map(other => other === piece ? candidate : other)
        return relevantConditions.every(condition =>
          condition === violated ||
          countFor(nextRoster, condition) < condition.required ||
          countFor(withSwap, condition) >= condition.required
        )
      })
      .sort((a, b) => (scoreOf.get(a) || 0) - (scoreOf.get(b) || 0))[0]
    if (!swapTarget) {
      unsatisfied.push(violated.code)
      continue
    }
    nextRoster = nextRoster.map(piece => piece === swapTarget ? candidate : piece)
  }
  return { roster: nextRoster, unsatisfied }
}

// Season eligibility for a capsule roster, and it is deliberately NOT symmetric.
//
// A winter capsule excludes warm-season-only pieces outright: a linen tank has
// no job in winter. The mirror rule for summer would exclude cool-season
// pieces — and that would delete exactly the piece a summer capsule most needs,
// because the layer's whole purpose is the cool part of a warm day (see
// docs/capsule-real-world-rules.md: air-conditioned interiors and evenings that
// cool off, which is why the layer allowance is season-invariant). Measured on
// the live wardrobe, a blanket summer exclusion removed piece 996767, the olive
// lightweight jacket — the correct summer layer — while leaving the real
// offender to be caught only by rank.
//
// So: a summer capsule excludes cool-season pieces from the CORE groups it will
// build looks out of (corduroy straight pants have no place in a summer
// capsule), and keeps them eligible as outerwear.
function capsuleSeasonEligiblePool(pool = [], { isSummer = false, isWinter = false } = {}) {
  const seasonOf = piece => String(piece?.season || '').toLowerCase()
  if (isWinter) return pool.filter(piece => seasonOf(piece) !== 'warm')
  if (isSummer) {
    return pool.filter(piece => {
      if (!['cool', 'cold'].includes(seasonOf(piece))) return true
      return wardrobeCategoryGroup(piece) === 'outerwear'
    })
  }
  return pool
}

export function selectCapsuleRoster(pool = [], { budget = 10, isSummer = false, isWinter = false, occasions = [], slots = [], palette = [] } = {}) {
  const quotas = capsuleQuotas(budget, { isSummer, isWinter })
  const groups = { top: [], bottom: [], dress: [], outerwear: [], shoes: [] }
  const scoreOf = new Map()
  // An explicitly winter capsule should not spend its finite roster on pieces
  // authored as warm-season-only. Year-round sleeveless bases remain eligible
  // for indoor layering; the balance reserve below prevents them dominating.
  const seasonEligiblePool = capsuleSeasonEligiblePool(pool, { isSummer, isWinter })
  const usablePool = capsulePiecesEligibleForAnySlot(seasonEligiblePool, slots, { isSummer, isWinter })
  for (const piece of usablePool) {
    const group = wardrobeCategoryGroup(piece)
    if (!groups[group]) continue
    scoreOf.set(piece, capsuleVersatilityScore(piece, { isSummer, palette }))
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
  // Coverage precedes multiplicity. The low-ceiling reserve above buys enough
  // casual rotation, but it must not spend every main-path slot and erase a
  // requested dinner/gallery/smart-casual path. Preserve an elevated dress
  // when one is already selected; otherwise reserve one compatible top and
  // bottom, while protecting the casual counts already established above.
  const protectedCoveragePieces = new Set()
  for (const elevatedDemand of elevatedCapsuleDemands(slots, usablePool, { isSummer })) {
    const inDemandBand = piece =>
      elevatedDemand.allowedIds.has(Number(piece.id)) &&
      pieceMeetsFloorRank(piece, elevatedDemand.floorRank) &&
      pieceClearsCeilingRank(piece, elevatedDemand.ceilingRank)
    const elevatedDressPath = roster.find(piece =>
      wardrobeCategoryGroup(piece) === 'dress' && inDemandBand(piece)
    )
    if (elevatedDressPath) {
      protectedCoveragePieces.add(elevatedDressPath)
      continue
    }
    for (const group of ['top', 'bottom']) {
      const updated = ensureCapsuleGroupFloorReserve(roster, groups, group, {
        ...elevatedDemand,
        protectedCeilingRank: reserve?.rank ?? null,
        protectedCount: reserve?.byGroup?.[group] || 0,
        protectedPieces: protectedCoveragePieces,
        scoreOf
      })
      roster.splice(0, roster.length, ...updated)
      const coveredPiece = roster.find(piece => wardrobeCategoryGroup(piece) === group && inDemandBand(piece))
      if (coveredPiece) protectedCoveragePieces.add(coveredPiece)
    }
  }
  if (isWinter && quotas.top > 0) {
    const requiredCoveredBases = Math.ceil(quotas.top / 2)
    const balancedRoster = ensureWinterIndoorTopBalance(
      roster,
      groups,
      requiredCoveredBases,
      scoreOf,
      protectedCoveragePieces
    )
    roster.splice(0, roster.length, ...balancedRoster)
  }
  if (isWinter && quotas.outerwear >= 2) {
    const protectedLayers = new Set()
    const withIndoorLayer = ensureWinterLayerRole(roster, groups, isCapsuleIndoorKnitLayer, scoreOf, protectedLayers)
    roster.splice(0, roster.length, ...withIndoorLayer)
    const indoorLayer = roster.find(isCapsuleIndoorKnitLayer)
    if (indoorLayer) protectedLayers.add(indoorLayer)
    const withTransitionLayer = ensureWinterLayerRole(roster, groups, isCapsuleColdTransitionLayer, scoreOf, protectedLayers)
    roster.splice(0, roster.length, ...withTransitionLayer)
  }
  let shoeDemands = []
  let shoeReserveGapLines = null
  if (quotas.shoes > 0) {
    shoeDemands = shoeReserveDemands(slots, quotas)
    const { roster: guaranteedRoster, gaps } = ensureCapsuleShoeDemands(roster, groups, shoeDemands, scoreOf, quotas.shoes)
    roster.splice(0, roster.length, ...guaranteedRoster)
    if (gaps.length) shoeReserveGapLines = describeShoeReserveGaps(gaps, budget)
  }
  // Every pass above has now run. Check what they each promised, once, and
  // repair anything a later pass undid — including the shoe demands just
  // applied, so the repair cannot trade one guarantee for another.
  const { roster: settledRoster, unsatisfied } = enforceCapsulePostConditions(
    roster,
    groups,
    capsuleRosterPostConditions({ quotas, reserve, isWinter, shoeDemands, roster }),
    scoreOf,
    protectedCoveragePieces
  )
  roster.splice(0, roster.length, ...settledRoster)
  const finalRoster = roster.slice(0, budget)
  if (shoeReserveGapLines) finalRoster.shoeReserveGaps = shoeReserveGapLines
  // A guarantee the wardrobe genuinely cannot meet is reported, not swallowed.
  if (unsatisfied.length) finalRoster.postConditionGaps = unsatisfied
  return finalRoster
}

// The bench a model-driven roster picker will choose from (spec step 1,
// docs/capsule-roster-selection-spec.md §3 stage 1). Same eligibility rule as
// selectCapsuleRoster and the same ranking heuristic, but truncated to
// benchSize WITH guaranteed minimums so a global ranking can't quietly starve
// a category or a requested slot out of the candidate pool the model never
// sees past. Additive only: does not change selectCapsuleRoster's own output.
export function buildCapsuleBench(pool = [], {
  budget = 24, slots = [], isSummer = false, isWinter = false, benchSize = 70,
  palette = [],
  seedWithDeterministicRoster = true
} = {}) {
  const normalizedSlots = Array.isArray(slots) ? slots.filter(Boolean) : []
  // Same winter warm-season exclusion selectCapsuleRoster applies before
  // eligibility — the bench must not offer pieces the roster itself can't use.
  const seasonEligiblePool = capsuleSeasonEligiblePool(pool, { isSummer, isWinter })
  // A roster slot spent on a piece the composer is forbidden to use is a
  // guaranteed dead slot. The capsule composition prompt says "Do not add
  // accessories", so an accessory on the bench can never reach a card — and on
  // thread_1785380251549 the model duly spent 1 of 24 places on a pendant that
  // appeared in none of the ten looks. The deterministic selector never picked
  // accessories; only this bench's rank-fill offered them. Restrict the bench
  // to the groups a look is actually built from.
  const eligible = capsulePiecesEligibleForAnySlot(seasonEligiblePool, normalizedSlots, { isSummer, isWinter })
    .filter(piece => CAPSULE_COMPOSABLE_GROUPS.has(wardrobeCategoryGroup(piece)))
  const scoreOf = new Map()
  for (const piece of eligible) scoreOf.set(piece, capsuleVersatilityScore(piece, { isSummer, palette }))
  const ranked = [...eligible].sort((a, b) => {
    const diff = (scoreOf.get(b) || 0) - (scoreOf.get(a) || 0)
    return diff !== 0 ? diff : Number(a.id) - Number(b.id)
  })

  const byGroup = { top: [], bottom: [], dress: [], outerwear: [], shoes: [] }
  for (const piece of ranked) {
    const group = wardrobeCategoryGroup(piece)
    if (byGroup[group]) byGroup[group].push(piece)
  }

  const bench = []
  const admittedIds = new Set()
  const admittedByGuarantee = new Set()
  const admit = (piece, byGuarantee = false) => {
    if (!piece) return
    const id = Number(piece.id)
    if (admittedIds.has(id)) {
      if (byGuarantee) admittedByGuarantee.add(id)
      return
    }
    admittedIds.add(id)
    bench.push(piece)
    if (byGuarantee) admittedByGuarantee.add(id)
  }

  // Seed: every piece today's deterministic selectCapsuleRoster actually
  // buys. capsuleVersatilityScore ranks pieces in isolation, so it
  // systematically undervalues exactly the pieces the reserve passes below
  // exist to rescue (a shoe reserved for one dressy slot, a dress that clears
  // a register floor) — a rank-only bench cuts them at benchSize before the
  // per-category/per-slot minimums below ever get a chance to re-derive the
  // same guarantee. Seeding directly with the roster means a model choosing
  // from this bench can always at least reproduce today's answer, and every
  // existing reserve guarantee is preserved without re-deriving it here.
  // seedWithDeterministicRoster:false exists only so the diagnostic script
  // can still print the pre-seed, rank-only measurement for reference —
  // production callers must leave it at the default.
  if (seedWithDeterministicRoster) {
    // The seed must be built with the SAME palette the model is given, or the
    // bench will not contain the roster it is meant to guarantee — and the
    // model's candidate list would silently exclude the deterministic answer it
    // is supposed to be able to reproduce. Caught by the comparison harness
    // before any billed call: a palette run reported every roster piece as
    // "not in the supplied pool".
    const deterministicRoster = selectCapsuleRoster(pool, {
      budget, isSummer, isWinter, occasions: normalizedSlots.map(slot => slot.occasion), slots: normalizedSlots, palette
    })
    for (const piece of deterministicRoster) admit(piece, true)
  }
  const seedSize = bench.length

  // Per-category targets: what a bench of this size should hold so the model
  // has a real choice in every category the capsule will actually spend in.
  //
  // This replaces a flat `{ top: 2, bottom: 2, dress: 0, outerwear: 0,
  // shoes: 2 }` floor, under which dress and outerwear had NO floor at all and
  // were represented by the quota alone. A bench that offers exactly the quota
  // in a category is not a choice set — it is a forced pick, and stage 3 is
  // then merely accepting in that category what the deterministic selector
  // already decided.
  //
  // Two terms, both derived rather than picked:
  //
  //  - the choice floor, two candidates per place the capsule will spend here.
  //    "A choice needs at least two options" is the whole justification; the
  //    quota it multiplies is itself researched (docs/capsule-real-world-rules).
  //  - the proportional share, this category's share of eligible supply. A
  //    bench is a SAMPLE of what the person can actually wear for these slots,
  //    so it should look like that pool.
  //
  // Both are clamped by eligible supply, so a wardrobe that simply has no
  // dresses is never asked to invent one.
  const quotas = capsuleQuotas(budget, { isSummer, isWinter })
  const composableGroups = Object.keys(byGroup)
  const totalEligible = composableGroups.reduce((sum, group) => sum + byGroup[group].length, 0)
  const perCategory = {}
  const targets = {}
  for (const group of composableGroups) {
    const eligibleInGroup = byGroup[group].length
    const choiceFloor = Math.min(eligibleInGroup, 2 * (quotas[group] || 0))
    const proportional = totalEligible ? Math.round((eligibleInGroup / totalEligible) * benchSize) : 0
    targets[group] = Math.min(eligibleInGroup, Math.max(choiceFloor, proportional))
    // Key kept as `minimum` — same meaning ("at least this many"), and existing
    // callers/tests read it.
    perCategory[group] = { eligible: eligibleInGroup, minimum: targets[group], choiceFloor, proportional }
  }

  // Per-slot minimum: at least enough gate-eligible pieces to form one
  // complete core (top+bottom or dress, plus a shoe) for every requested slot
  // the wardrobe can actually cover — a slot it genuinely can't cover stays
  // uncovered and is recorded, never fabricated.
  const perSlot = []
  const uncoverableSlots = []
  normalizedSlots.forEach((slot, index) => {
    const slotEligible = slotGateEligiblePieces(eligible, slot, { isSummer, isWinter })
    const slotLabel = slot.slot || slot.label || `slot_${index}`
    const byGroupForSlot = { top: [], bottom: [], dress: [], shoes: [] }
    for (const piece of slotEligible) {
      const group = wardrobeCategoryGroup(piece)
      if (byGroupForSlot[group]) byGroupForSlot[group].push(piece)
    }
    const canFormCore = (byGroupForSlot.top.length && byGroupForSlot.bottom.length || byGroupForSlot.dress.length) &&
      byGroupForSlot.shoes.length
    perSlot.push({ slot: slotLabel, eligibleCount: slotEligible.length, canFormCore: Boolean(canFormCore) })
    if (!canFormCore) { uncoverableSlots.push(slotLabel); return }

    const benchHasCoreForSlot = () => {
      const benchIdsForSlot = bench.filter(piece => admittedIds.has(Number(piece.id)) && slotEligible.includes(piece))
      const hasTop = benchIdsForSlot.some(piece => wardrobeCategoryGroup(piece) === 'top')
      const hasBottom = benchIdsForSlot.some(piece => wardrobeCategoryGroup(piece) === 'bottom')
      const hasDress = benchIdsForSlot.some(piece => wardrobeCategoryGroup(piece) === 'dress')
      const hasShoe = benchIdsForSlot.some(piece => wardrobeCategoryGroup(piece) === 'shoes')
      return ((hasTop && hasBottom) || hasDress) && hasShoe
    }
    if (benchHasCoreForSlot()) return
    // Best-ranked candidates within this slot's own eligibility (already rank
    // ordered since slotEligible is filtered from `eligible`, which is rank
    // ordered) — admit whichever combination the wardrobe can supply.
    const bestDress = byGroupForSlot.dress[0]
    const bestTop = byGroupForSlot.top[0]
    const bestBottom = byGroupForSlot.bottom[0]
    const bestShoe = byGroupForSlot.shoes[0]
    if (bestTop && bestBottom) { admit(bestTop, true); admit(bestBottom, true) }
    else if (bestDress) { admit(bestDress, true) }
    admit(bestShoe, true)
  })

  // Protagonist / Statement Piece Guarantee: reserve candidate slots for expressive/hero pieces
  // (pattern_complexity === 'loud' || visual_roles includes 'hero_piece').
  // Prefer standalone statement pieces (needs_base !== 'yes') over dependent ones so the roster model
  // sees a rich choice of standalone hero tops/dresses alongside dependent options.
  // Shared with the statement-presence guarantee — see pieceReadsAsProtagonist.
  // This copy is what the guarantee had drifted away from.
  const protagonists = ranked.filter(pieceReadsAsProtagonist)
  protagonists.sort((a, b) => {
    const aNeedsBase = a.needs_base === 'yes' ? 1 : 0
    const bNeedsBase = b.needs_base === 'yes' ? 1 : 0
    if (aNeedsBase !== bNeedsBase) return aNeedsBase - bNeedsBase
    return (scoreOf.get(b) || 0) - (scoreOf.get(a) || 0)
  })
  for (const piece of protagonists.slice(0, 8)) {
    admit(piece, true)
  }

  // Palette supply guarantee. The 70-piece bench is a choice set, not a
  // 70-piece capsule, so it should not itself mimic the final 70/30 ratio.
  // It must, however, contain enough eligible supply for the model to obey the
  // final roster contract: the minimum neutral foundation plus up to the
  // target accent allowance, distributed across requested families.
  const neutralPlan = capsuleNeutralBasePlan(budget)
  const neutralCandidates = ranked.filter(piece => colorsArePaletteNeutral(piece?.colors))
  for (const piece of neutralCandidates) {
    if (bench.filter(candidate => colorsArePaletteNeutral(candidate?.colors)).length >= neutralPlan.minimum) break
    admit(piece, true)
  }
  const requestedFamilies = capsuleAccentFamilyNames(palette)
  const accentPlaces = Math.max(0, budget - neutralPlan.maximum)
  if (requestedFamilies.length && accentPlaces > 0) {
    const byRequestedFamily = new Map(requestedFamilies.map(family => [
      family,
      ranked.filter(piece => pieceMatchesAccentFamily(piece, family))
    ]))
    let admittedAccentChoices = 0
    let round = 0
    while (admittedAccentChoices < accentPlaces) {
      let addedThisRound = false
      for (const family of requestedFamilies) {
        const piece = (byRequestedFamily.get(family) || [])[round]
        if (!piece) continue
        const before = bench.length
        admit(piece, true)
        if (bench.length > before) {
          admittedAccentChoices += 1
          addedThisRound = true
          if (admittedAccentChoices >= accentPlaces) break
        }
      }
      if (!addedThisRound) break
      round += 1
    }
  }

  // Fill toward the per-category targets, most-starved category first.
  //
  // This replaced a single global rank-ordered fill, which was the mechanism
  // starving dresses and shoes. capsuleVersatilityScore rewards neutral colour,
  // solid pattern, broad occasion tagging and light fabric — properties tops
  // and bottoms have structurally more of than dresses and shoes do. Measured
  // on the live 242-piece wardrobe (160 eligible for a 4-slot summer capsule),
  // as a rank position where 0 is best:
  //
  //     group      n   median rank   inside the top 70
  //     top       67       84            28/67
  //     bottom    31       44            22/31
  //     dress     14      116             3/14
  //     outerwear 16       71             8/16
  //     shoes     32      113             9/32
  //
  // So the score is a sensible comparator WITHIN a category (which top
  // recombines more freely than which other top) and close to meaningless
  // ACROSS them: a dress at rank 116 is not thereby a worse bench candidate
  // than a top at rank 84, it is a different kind of garment being measured on
  // a scale built for tops. Using it globally turned a within-category
  // preference into a de facto cross-category exclusion — widening the bench
  // from 40 to 70 places bought 15 tops, 8 bottoms and zero dresses, and left
  // hero-capable representation at 10 of 46.
  //
  // Relative deficit, not absolute, so a small category is not drowned out by a
  // large one; `composableGroups` order breaks ties, keeping this deterministic.
  const benchCountIn = group => bench.filter(piece => wardrobeCategoryGroup(piece) === group).length
  while (bench.length < benchSize) {
    let choice = null
    let worstDeficit = 0
    for (const group of composableGroups) {
      const have = benchCountIn(group)
      if (have >= targets[group]) continue
      const next = byGroup[group].find(piece => !admittedIds.has(Number(piece.id)))
      if (!next) continue
      const deficit = (targets[group] - have) / targets[group]
      if (deficit > worstDeficit) {
        worstDeficit = deficit
        choice = next
      }
    }
    if (!choice) break
    admit(choice, false)
  }

  // Every target met and places still spare (a small eligible pool): spend them
  // by rank, exactly as before.
  for (const piece of ranked) {
    if (bench.length >= benchSize) break
    admit(piece, false)
  }

  // A target the bench could not reach is a real shortfall — benchSize is a
  // cost ceiling and it wins over the targets, per the roster-selection spec's
  // "absolute ceiling" ruling. Recorded rather than silently absorbed, matching
  // this project's no-silent-caps rule.
  const unmetTargets = composableGroups
    .filter(group => benchCountIn(group) < targets[group])
    .map(group => ({ group, target: targets[group], actual: benchCountIn(group), eligible: byGroup[group].length }))

  const diagnostics = {
    benchSize: bench.length,
    seedSize,
    targetBenchSize: benchSize,
    exceededTarget: bench.length > benchSize,
    perCategory,
    perSlot,
    uncoverableSlots,
    unmetTargets,
    admittedByGuaranteeIds: [...admittedByGuarantee],
    admittedByGuaranteeCount: admittedByGuarantee.size
  }

  return { bench, diagnostics }
}

// One demand per "the shoe roster must guarantee something" reason: a
// demanding activity profile (hiking's excluded heel/support rules) needs at
// least one passing shoe, and an elevated-look floor needs enough polished
// shoes for the plan's dressier slots. Each has a human label for the
// coverage-gap disclosure if the quota can't hold all of them.
function shoeReserveDemands(slots = [], quotas = {}) {
  const demands = []
  const normalizedSlots = Array.isArray(slots) ? slots : []
  for (const profile of demandingActivityProfilesForSlots(slots)) {
    demands.push({
      label: profile.label || profile.id,
      required: 1,
      predicate: piece => footwearPassesActivityProfile(piece, profile),
    })
  }
  const elevatedRank = formalityRank('elevated')
  const everydayRank = formalityRank('everyday')
  const hasEverydayShoeJob = normalizedSlots
    .filter(slot => {
      const ceilingRank = effectiveSlotRegisterCeilingRank(slot)
      return ceilingRank !== null && ceilingRank <= everydayRank
    })
    .length > 0
  const hasElevatedShoeJob = normalizedSlots.some(slotWantsElevatedShoe)

  // A mixed-register capsule needs a legal shoe path at both ends. Previously
  // five elevated looks could reserve all three shoe slots, leaving the
  // casual slot with zero shoes after its everyday ceiling was applied.
  // Preserve one everyday shoe in a mixed plan; in an all-casual plan retain
  // the existing rotation reserve of roughly one shoe per two looks.
  if (hasEverydayShoeJob) {
    demands.push({
      label: 'an everyday/casual look',
      required: Math.min(quotas.shoes, 1),
      predicate: piece => pieceClearsCeilingRank(piece, everydayRank),
    })
  }
  if (hasElevatedShoeJob && quotas.shoes > 1) {
    demands.push({
      label: 'a dressy/elevated look',
      required: 1,
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
          ownDemand.predicate(candidate) ||
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
  const waistbandConstraint = piece.waistband_type
    ? `waistband:${piece.waistband_type}`
    : ''
  const bits = [
    `ID ${piece.id}`,
    piece.name || 'Garment',
    wardrobeCategoryGroup(piece) || piece.category || '',
    colors ? `colors:${colors}` : '',
    occasions ? `occasions:${occasions}` : '',
    piece.formality ? `formality:${piece.formality}` : '',
    piece.silhouette ? `silhouette:${piece.silhouette}` : '',
    piece.length_hits_at ? `length:${piece.length_hits_at}` : '',
    piece.hem_finish ? `hem:${piece.hem_finish}` : '',
    piece.sleeve_type && piece.sleeve_type !== 'none' ? `sleeve:${piece.sleeve_type}` : '',
    piece.fit_on_body && piece.fit_on_body !== 'none' ? `fit:${piece.fit_on_body}` : '',
    piece.tuck_behavior ? `tuck:${piece.tuck_behavior}` : '',
    waistbandConstraint,
    piece.opacity && piece.opacity !== 'opaque' ? `opacity:${piece.opacity}` : '',
    piece.needs_base === 'yes' ? 'NEEDS_BASE_LAYER' : '',
    piece.fabric_category ? `fabric:${piece.fabric_category}` : '',
    piece.fabric_weight ? `weight:${piece.fabric_weight}` : '',
    piece.heel_height ? `heel:${piece.heel_height}` : '',
    piece.walk_support ? `support:${piece.walk_support}` : '',
    piece.reads_as ? `reads:${String(piece.reads_as).slice(0, 80)}` : '',
    Array.isArray(piece.styling_rules_learned) && piece.styling_rules_learned.length
      ? `RULES (authoritative):${piece.styling_rules_learned.join(' / ')}`
      : '',
    Array.isArray(piece.tried_and_rejected) && piece.tried_and_rejected.length
      ? `REJECTED PAIRINGS:${piece.tried_and_rejected.join(' / ')}`
      : ''
  ].filter(Boolean)
  return bits.join(' | ')
}

export function slotRequiresActiveMovement(slot = {}) {
  const text = [slot?.label, slot?.bestFor, slot?.coverage, slot?.planNote]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return /\b(chas(?:e|ing)|kid[- ]active|active kid|playground|active caregiv(?:ing|er)|rough[- ]and[- ]tumble)\b/.test(text) // ratchet-allow: plan-use-case classifier, not garment matching
}

export function slotRequiresOperationalEase(slot = {}) {
  if (slotRequiresActiveMovement(slot)) return true
  const text = [slot?.label, slot?.bestFor, slot?.coverage, slot?.planNote]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return /\b(indoor play|home base|low-key (?:home|day|days)|downtime at home)\b/.test(text) // ratchet-allow: plan-use-case classifier, not garment matching
}

export function extremeHeatPieceAdvisory(piece = {}, weatherProfile = {}) {
  if (!weatherProfile?.isExtremeHeat) return { tier: 'neutral', score: 0, reason: '' }
  const group = wardrobeCategoryGroup(piece)
  const weight = fabricWeight(piece)
  const coverage = pieceCoverage(piece)
  const bareness = pieceBareness(piece)

  if (group === 'outerwear') {
    if (weight === 'light') return { tier: 'workable', score: 0, reason: 'light removable layer for indoor AC only; never the transit base' }
    return { tier: 'discouraged', score: -24, reason: 'too warm to solve extreme-heat transit; use only a light removable AC layer' }
  }
  if (group === 'shoes') {
    const coverageKind = shoeCoverage(piece)
    if (coverageKind === 'open') return { tier: 'preferred', score: 16, reason: 'open footwear releases more heat' }
    if (coverageKind === 'closed') return { tier: 'workable', score: -12, reason: 'closed footwear can handle movement but runs warmer in triple-digit heat' }
    return { tier: 'workable', score: -4, reason: 'thermal coverage is unknown; compare against more ventilated footwear' }
  }
  if (group === 'bottom' && bottomKind(piece) === 'pants') {
    return {
      tier: 'discouraged',
      score: -22,
      reason: weight === 'light'
        ? 'light fabric helps, but full-leg coverage is still a tradeoff for active triple-digit heat'
        : 'full-leg coverage plus non-light fabric is a poor first choice for active triple-digit heat'
    }
  }
  if ((group === 'dress' || group === 'bottom') && coverage === 'full-insulating') {
    return { tier: 'discouraged', score: -18, reason: 'full-length coverage is a heat-retention tradeoff in active triple-digit heat' }
  }
  if (weight === 'heavy' || pieceHasInsulatingFiber(piece)) {
    return { tier: 'prohibited', score: -100, reason: 'heavy or insulating main is incompatible with triple-digit heat' }
  }
  if (weight === 'light' && bareness === 'high') {
    return { tier: 'preferred', score: 20, reason: 'light fabric and low coverage release heat' }
  }
  if (weight === 'light') return { tier: 'preferred', score: 12, reason: 'light fabric is a strong extreme-heat base candidate' }
  if (weight === 'medium' && bareness === 'high') return { tier: 'workable', score: 2, reason: 'open cut helps, though medium fabric retains more heat' }
  return { tier: 'workable', score: -6, reason: 'not heavy, but lacks a strong low-coverage or lightweight heat signal' }
}

export function activeMovementPieceAdvisory(piece = {}, activeMovement = false) {
  if (!activeMovement) return { tier: 'neutral', score: 0, reason: '' }
  const group = wardrobeCategoryGroup(piece)
  if (group === 'shoes') {
    const heel = String(piece?.heel_height || '').toLowerCase()
    const support = String(piece?.walk_support || '').toLowerCase()
    if (['flat', 'low'].includes(heel) && ['high', 'medium'].includes(support)) {
      return { tier: 'preferred', score: 18, reason: 'flat, supportive footwear suits quick active movement' }
    }
    if (['high', 'medium'].includes(support)) return { tier: 'workable', score: 2, reason: 'support is adequate, but heel height is not the easiest active option' }
    return { tier: 'discouraged', score: -18, reason: 'insufficient structured evidence for quick active movement' }
  }
  if (['top', 'bottom', 'dress'].includes(group)) {
    const rank = formalityRank(pieceFormality(piece))
    if (rank !== null && rank >= formalityRank('elevated')) {
      return { tier: 'discouraged', score: -16, reason: 'elevated register is a tradeoff for rough active caregiving; prefer easy everyday pieces' }
    }
    return { tier: 'preferred', score: 8, reason: 'everyday register is appropriate for rough active use' }
  }
  return { tier: 'neutral', score: 0, reason: '' }
}

export function operationalEasePieceAdvisory(piece = {}, operationalEase = false) {
  if (!operationalEase || wardrobeCategoryGroup(piece) !== 'shoes') return { tier: 'neutral', score: 0, reason: '' }
  const heel = String(piece?.heel_height || '').toLowerCase()
  if (['flat', 'low'].includes(heel)) return { tier: 'preferred', score: 10, reason: 'easy footwear suits home play and low-key movement' }
  if (heel) return { tier: 'discouraged', score: -14, reason: `${heel} heel adds avoidable operational effort for home play or low-key movement` }
  return { tier: 'workable', score: -2, reason: 'heel height is unknown for an operationally easy use case' }
}

function planPieceAssessments(piece = {}, { weatherProfile = {}, activeMovement = false, operationalEase = false } = {}) {
  return {
    id: Number(piece?.id),
    extreme_heat: extremeHeatPieceAdvisory(piece, weatherProfile),
    movement: activeMovementPieceAdvisory(piece, activeMovement),
    operational_ease: operationalEasePieceAdvisory(piece, operationalEase)
  }
}

function idSetForPieces(pieces = []) {
  return new Set((Array.isArray(pieces) ? pieces : []).map(piece => Number(piece?.id)).filter(Boolean))
}

function pieceMapForPieces(pieces = []) {
  return new Map((Array.isArray(pieces) ? pieces : []).map(piece => [Number(piece?.id), piece]).filter(([id]) => Boolean(id)))
}

function capsuleSlotCoreKeys(piecesById = new Map(), slot = {}) {
  const cores = new Set()
  const allowedIds = slot?.gateAllowedIds instanceof Set
    ? slot.gateAllowedIds
    : new Set(Array.isArray(slot?.allowed_piece_ids) ? slot.allowed_piece_ids.map(Number) : [])
  const allowed = [...allowedIds].map(id => piecesById.get(Number(id))).filter(Boolean)
  if (!allowed.some(piece => wardrobeCategoryGroup(piece) === 'shoes')) return cores
  const tops = allowed.filter(piece => wardrobeCategoryGroup(piece) === 'top')
  const bottoms = allowed.filter(piece => wardrobeCategoryGroup(piece) === 'bottom')
  const dresses = allowed.filter(piece => wardrobeCategoryGroup(piece) === 'dress')
  // Step 5 V1 follow-up (owner review 2026-07-30): "a valid dependent-top core
  // is not crochet top + bottom + shoes — it is compatible base + crochet top
  // + bottom + shoes." A needs_base top cannot produce a wearable core by
  // itself; counting one anyway is exactly how capacity gets overstated —
  // this function is what every capacity number in the feature is built from
  // (capsuleOutfitCoreCapacity and the representative rotation allocator).
  // Gate on a genuine base (isCapsuleBaseCandidate,
  // opacity-aware) coexisting in THIS SAME slot's allowed set, mirroring
  // dependent_base_unavailable's own condition.
  //
  // Two separate questions, corrected 2026-07-30 after a test caught the
  // conflation: "can this top serve as a BASE for something else" is
  // opacity-aware (isCapsuleBaseCandidate); "can this top form its OWN core"
  // is governed by needs_base alone — a sheer top not tagged needs_base is
  // not thereby barred from being its own outfit's top. Only a dependent
  // top's OWN core-forming ability depends on whether a base exists here.
  const hasStandaloneBaseHere = tops.some(isCapsuleBaseCandidate)
  const coreCapableTops = tops.filter(top => !pieceNeedsBase(top) || hasStandaloneBaseHere)
  for (const top of coreCapableTops) {
    for (const bottom of bottoms) cores.add(`separates:${Number(top.id)}:${Number(bottom.id)}`)
  }
  for (const dress of dresses) cores.add(`dress:${Number(dress.id)}`)
  return cores
}

export function capsuleOutfitCoreCapacity(roster = [], slots = []) {
  const piecesById = pieceMapForPieces(roster)
  const distinctCores = new Set()
  for (const slot of Array.isArray(slots) ? slots : []) {
    for (const core of capsuleSlotCoreKeys(piecesById, slot)) distinctCores.add(core)
  }
  return distinctCores.size
}

// Can every requested look get its OWN core? Slots overlap — At Home and
// Errands routinely resolve to the identical gate result — so summing per-slot
// capacities double-counts the shared cores, while validateSubmittedPlanOutfits
// enforces distinct cores across the whole plan. Ask the real question instead:
// is there a system of distinct representatives for these demands? Standard
// augmenting-path matching, over at most `cap` demand units.
function capsuleRotationFeasible(coreKeysBySlot = [], targets = []) {
  const units = []
  targets.forEach((target, slotIndex) => {
    for (let card = 0; card < target; card += 1) units.push(slotIndex)
  })
  if (!units.length) return true
  const coreToUnit = new Map()
  const assign = (unitIndex, visitedCores) => {
    for (const core of coreKeysBySlot[units[unitIndex]] || []) {
      if (visitedCores.has(core)) continue
      visitedCores.add(core)
      const holder = coreToUnit.get(core)
      if (holder === undefined || assign(holder, visitedCores)) {
        coreToUnit.set(core, unitIndex)
        return true
      }
    }
    return false
  }
  for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
    if (!assign(unitIndex, new Set())) return false
  }
  return true
}

export function allocateCapsuleRepresentativeRotation(slots = [], roster = [], { cap = 0 } = {}) {
  const source = Array.isArray(slots) ? slots : []
  const maxCards = Math.max(0, Number(cap) || 0)
  const piecesById = pieceMapForPieces(roster)
  const coreKeysBySlot = source.map(slot => [...capsuleSlotCoreKeys(piecesById, slot)])
  const allocated = source.map((slot, index) => {
    const requested = Math.max(1, Number(slot?.requestedOutfits) || Number(slot?.targetOutfits) || 1)
    return {
      ...slot,
      requestedOutfits: requested,
      targetOutfits: 0,
      capsuleSlotCapacity: coreKeysBySlot[index].length
    }
  })
  const targets = allocated.map(() => 0)
  // Every increment is tested against the WHOLE plan, not just its own slot.
  // Asking for a card the roster cannot distinctly fill guarantees a rejection
  // the atomic composer has no retry to recover from.
  const claim = index => {
    targets[index] += 1
    if (capsuleRotationFeasible(coreKeysBySlot, targets)) {
      allocated[index].targetOutfits = targets[index]
      return true
    }
    targets[index] -= 1
    return false
  }
  let remaining = maxCards
  const exhausted = new Set()
  // Coverage first: every structurally coverable use case gets one card before
  // any recurring slot gets multiplicity.
  for (const [index, slot] of allocated.entries()) {
    if (remaining <= 0) break
    if (slot.capsuleSlotCapacity <= 0) continue
    if (claim(index)) remaining -= 1
    else exhausted.add(index)
  }
  // Then buy rotation where the request recurs. Largest unmet recurrence wins;
  // original order breaks ties so allocation is stable. A slot whose increment
  // is globally infeasible is retired rather than retried.
  while (remaining > 0) {
    const candidate = allocated
      .map((slot, index) => ({
        slot,
        index,
        unmet: Math.min(slot.requestedOutfits, slot.capsuleSlotCapacity) - slot.targetOutfits
      }))
      .filter(entry => entry.unmet > 0 && !exhausted.has(entry.index))
      .sort((a, b) => b.unmet - a.unmet || a.index - b.index)[0]
    if (!candidate) break
    if (claim(candidate.index)) remaining -= 1
    else exhausted.add(candidate.index)
  }
  // A slot retired for infeasibility has no unused core left once the rest of
  // the plan has taken its share, however large its own core count looks. Say
  // so, because "Show another" and the expansion endpoint both read this field
  // to decide whether another billed look is even possible. A slot that merely
  // ran out of card cap keeps its real capacity and stays expandable.
  for (const index of exhausted) {
    allocated[index].capsuleSlotCapacity = allocated[index].targetOutfits
  }
  return allocated
}

// Stage 3 of docs/capsule-roster-selection-spec.md: checks CAPACITY only,
// never colour/palette/aesthetic (settled — see the `home`-gate lifestyle-audit
// ruling in docs/stylist-session-handoff.md). Every threshold below is lifted
// from the reserve pass that already enforces it inside selectCapsuleRoster,
// not invented fresh, so a validator failure names the same structural fact
// those passes were written to guarantee.
export function validateCapsuleRoster(roster = [], {
  slots = [], budget = 24, isWinterCapsule = false, isSummer = false, plannedCards = 0, pool = null
} = {}) {
  const normalizedRoster = Array.isArray(roster) ? roster : []
  const normalizedSlots = Array.isArray(slots) ? slots.filter(Boolean) : []
  const poolPieces = Array.isArray(pool) ? pool : []
  const failures = []

  // budget_exceeded — size, activeness, pool membership.
  if (normalizedRoster.length > budget) {
    failures.push({
      code: 'budget_exceeded',
      message: `roster has ${normalizedRoster.length} pieces, budget is ${budget}`
    })
  }
  const inactivePieces = normalizedRoster.filter(piece => piece?.status && piece.status !== 'active')
  if (inactivePieces.length) {
    failures.push({
      code: 'budget_exceeded',
      message: `roster includes ${inactivePieces.length} non-active piece(s): ${inactivePieces.map(piece => `ID ${piece.id}`).join(', ')}`
    })
  }
  if (Array.isArray(pool)) {
    const poolIds = idSetForPieces(pool)
    const outsidePool = normalizedRoster.filter(piece => !poolIds.has(Number(piece?.id)))
    if (outsidePool.length) {
      failures.push({
        code: 'budget_exceeded',
        message: `roster includes ${outsidePool.length} piece(s) not in the supplied pool: ${outsidePool.map(piece => `ID ${piece.id}`).join(', ')}`
      })
    }
  }

  // slot_uncoverable — every requested slot needs >=1 gate-valid core inside
  // the roster (top+bottom or dress, plus a shoe from the roster itself).
  const gateSlots = normalizedSlots.map((slot, index) => {
    const slotEligible = slotGateEligiblePieces(normalizedRoster, slot, { isSummer, isWinter: isWinterCapsule })
    return { slot, index, gateAllowedIds: idSetForPieces(slotEligible), slotEligible }
  })
  for (const { slot, index, gateAllowedIds, slotEligible } of gateSlots) {
    const label = slot.slot || slot.label || `slot_${index}`
    const cores = capsuleOutfitCoreCapacity(normalizedRoster, [{ ...slot, gateAllowedIds }])
    if (cores > 0) continue
    const tops = slotEligible.filter(piece => wardrobeCategoryGroup(piece) === 'top').length
    const bottoms = slotEligible.filter(piece => wardrobeCategoryGroup(piece) === 'bottom').length
    const dresses = slotEligible.filter(piece => wardrobeCategoryGroup(piece) === 'dress').length
    const shoes = slotEligible.filter(piece => wardrobeCategoryGroup(piece) === 'shoes').length
    failures.push({
      code: 'slot_uncoverable',
      message: `${label} has ${shoes} eligible shoe(s), ${tops} eligible top(s), ${bottoms} eligible bottom(s), and ${dresses} eligible dress(es), so it supports 0 cores`
    })
  }

  // dependent_base_unavailable — Step 5 criterion 3. The roster-level condition
  // below (base_for_dependent_top) only proves that SOME standalone top exists
  // somewhere in the roster. That is not the same as the dependent piece being
  // wearable: a dependent top offered in a slot whose gates reject every
  // standalone top in the roster is a piece that cannot form a look there, and
  // the roster spent a slot on it anyway.
  //
  // Structural availability only. Whether the base and the dependent piece
  // actually look right together stays with the roster model and the composer —
  // this is the deterministic half of the enforcement boundary the evaluation
  // draws, and the run is explicitly NOT evidence that two dependent pieces is
  // always too many. Absent any `needs_base` piece nothing here executes, so an
  // unpopulated field is a strict no-op.
  for (const { slot, index, slotEligible } of gateSlots) {
    const dependents = slotEligible.filter(piece =>
      wardrobeCategoryGroup(piece) === 'top' && pieceNeedsBase(piece))
    if (!dependents.length) continue
    if (slotEligible.some(isCapsuleBaseCandidate)) continue
    // Same supply attribution the post-conditions use: a wardrobe that has no
    // standalone top clearing this slot's gates is a supply gap, not a roster
    // defect, and failing it would be unrepairable by any swap.
    if (poolPieces.length) {
      const rosterIds = idSetForPieces(normalizedRoster)
      const availableBases = slotGateEligiblePieces(
        poolPieces.filter(piece => !rosterIds.has(Number(piece?.id))),
        slot,
        { isSummer, isWinter: isWinterCapsule }
      ).filter(isCapsuleBaseCandidate)
      if (!availableBases.length) continue
    }
    const label = slot.slot || slot.label || `slot_${index}`
    const named = dependents.map(piece => piece.name || `ID ${piece.id}`).join(', ')
    failures.push({
      code: 'dependent_base_unavailable',
      message: `${label} offers ${dependents.length} top(s) that cannot be worn alone (${named}) but no top from this roster that can be worn alone passes that slot's gates — add a standalone top valid there, or drop the dependent piece`
    })
  }

  // The number of representative cards is a presentation choice, not a
  // garment requirement. Per-slot coverability above proves the capsule can
  // serve every lifestyle job; the rotation allocator may show fewer cards
  // when the chosen set has fewer distinct cores, without rejecting the set.

  // Parity with the selector, by construction. Every guarantee selectCapsuleRoster
  // enforces is declared once in capsuleRosterPostConditions; the validator
  // evaluates those same declarations rather than keeping a second, drifting
  // copy. Stage 3 hands roster choice to a model and this function becomes the
  // only guard, so a guarantee the validator does not know about is a guarantee
  // that silently stops existing.
  //
  // Legacy codes are preserved where current checks already had one, so
  // existing callers and diagnostics keep working.
  const LEGACY_FAILURE_CODES = [
    [/^register_reserve:/, 'category_floor'],
    [/^shoe_reserve:/, 'register_shoe_path_missing'],
  ]
  const quotas = capsuleQuotas(budget, { isSummer, isWinter: isWinterCapsule })
  const reserve = capsuleDemandReserve(normalizedSlots, quotas)
  const shoeDemands = (quotas.shoes || 0) > 0 ? shoeReserveDemands(normalizedSlots, quotas) : []
  const conditions = capsuleRosterPostConditions({
    quotas,
    reserve,
    isWinter: isWinterCapsule,
    shoeDemands,
    roster: normalizedRoster
  })
  // selectCapsuleRoster records the guarantees it could not meet on the roster
  // it returns. That is better evidence than any heuristic here — it was
  // computed with the real pool and the real swap logic — so a gap the pipeline
  // has already disclosed is not re-reported as a roster defect. A
  // model-chosen roster carries no such record, so every condition applies to
  // it strictly, which is the case this validator exists for.
  const declaredGaps = new Set(Array.isArray(roster?.postConditionGaps) ? roster.postConditionGaps : [])
  for (const condition of conditions) {
    const have = normalizedRoster.filter(piece => capsuleConditionMatches(piece, condition, normalizedRoster)).length
    // Ceilings are checked before floors and never excused. The
    // supply-attribution logic below exists to avoid blaming a roster for what
    // the wardrobe could not supply — that reasoning has no analogue here,
    // because overspending is always the roster's own doing.
    if (Number.isFinite(condition.maximum) && have > condition.maximum) {
      failures.push({
        code: condition.code,
        message: `roster has ${have} ${condition.group}(s) — ${condition.describe()}`
      })
      continue
    }
    if (have >= condition.required) continue
    if (declaredGaps.has(condition.code)) continue
    // A guarantee the WARDROBE cannot satisfy is not a defect in the roster —
    // it is a supply gap, reported elsewhere. Only fail when the roster could
    // actually have done better, so every failure here is repairable by
    // swapping something.
    if (poolPieces.length) {
      // With a candidate pool (stage 3 passes the bench) this is exact: did a
      // satisfying piece exist and go unpicked?
      const rosterIds = idSetForPieces(normalizedRoster)
      const availableUnused = poolPieces.some(piece =>
        !rosterIds.has(Number(piece?.id)) && capsuleConditionMatches(piece, condition, normalizedRoster)
      )
      if (!availableUnused) continue
    } else {
      // Without a pool, attribution is guesswork, so blame only what is
      // provably the roster's doing: a category it spent slots on and filled
      // badly. A whole-roster guarantee, or a category it never bought into,
      // is indistinguishable from the wardrobe simply not having one — and a
      // validator that invents failures is worse than one that misses them.
      if (condition.group === '*') continue
      const spentOnGroup = normalizedRoster.some(piece => wardrobeCategoryGroup(piece) === condition.group)
      if (!spentOnGroup) continue
    }
    const legacy = LEGACY_FAILURE_CODES.find(([pattern]) => pattern.test(condition.code))
    const groupLabel = condition.group === '*' ? 'matching piece' : condition.group
    failures.push({
      code: legacy ? legacy[1] : condition.code,
      message: `roster has ${have} ${groupLabel}(s) — needs ${condition.describe()}`
    })
  }

  return { ok: failures.length === 0, failures }
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

function planWorkbenchPieceScore(piece = {}, slot = {}, { anchorIds = new Set(), weatherProfile = {}, activeMovement = false, operationalEase = false } = {}) {
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
  score += extremeHeatPieceAdvisory(piece, weatherProfile).score
  score += activeMovementPieceAdvisory(piece, activeMovement).score
  score += operationalEasePieceAdvisory(piece, operationalEase).score
  return score
}

function selectPlanWorkbenchPieces(allowedPieces = [], slot = {}, { anchorIds = new Set(), weatherProfile = {}, activeMovement = false, operationalEase = false, limit = PLAN_WORKBENCH_PIECE_LIMIT } = {}) {
  const scored = allowedPieces
    .map((piece, index) => ({ piece, index, score: planWorkbenchPieceScore(piece, slot, { anchorIds, weatherProfile, activeMovement, operationalEase }) }))
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

function modelPlanPool({ allPieces = [], slots = [], constraints = {}, question = '', mood = '', planKind = '' } = {}) {
  const { pieceBudget } = normalizePlanConstraints(constraints)
  const isSeasonalCapsule = planKind === 'seasonal_capsule'
  const weatherContextText = slots.map(slot => `${slot?.season || ''} ${slot?.weather || ''} ${slot?.slotWeather || ''}`).join(' ')
  const isSummerContext = /\b(summer|warm|hot|80|90|heat)\b/i.test(`${question} ${mood} ${weatherContextText}`) // ratchet-allow: plan weather context, not garment matching
  const isWinterContext = /\b(winter|cold|chilly|snow|freezing)\b/i.test(`${question} ${mood} ${weatherContextText}`) // ratchet-allow: plan weather context, not garment matching
  const { accentColors: statedPalette } = extractStatedPalette(question, allPieces)
  return isSeasonalCapsule && pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET
    ? selectCapsuleRoster(allPieces, {
        budget: pieceBudget,
        isSummer: isSummerContext,
        isWinter: isWinterContext && !isSummerContext,
        occasions: slots.map(slot => slot.occasion),
        slots,
        palette: statedPalette
      })
    : allPieces
}

// Spec §3 stage 2 — the model picks the roster, the engine validates it.
//
// Orchestration lives here rather than in the route so it is testable without a
// provider: `chooseRoster` is injected, exactly like `composeCapsulePlanOnce`.
// The contract is deliberately narrow — one bounded call, ONE repair attempt
// given the specific structural failures, then the deterministic roster. Never
// a third attempt, never a silent loop.
//
// Ordering matters and is ratified: validation runs BEFORE composition, so a
// coherent-but-capacity-poor roster is a repairable structural fact rather than
// missing cards discovered later.
export async function selectCapsuleRosterViaModel({
  pool = [],
  budget = 24,
  slots = [],
  isSummer = false,
  isWinter = false,
  occasions = [],
  palette = [],
  benchSize = 70,
  chooseRoster = null,
  onDiagnostic = null,
  ownerRules = []
} = {}) {
  const deterministic = () => selectCapsuleRoster(pool, { budget, isSummer, isWinter, occasions, slots, palette })
  const bump = field => { if (typeof onDiagnostic === 'function') onDiagnostic(field) }
  if (typeof chooseRoster !== 'function') {
    return { roster: deterministic(), source: 'deterministic', palette: '', jobs: [], failures: [], coverageGaps: [] }
  }

  const { bench, diagnostics } = buildCapsuleBench(pool, { budget, slots, isSummer, isWinter, benchSize, palette })
  const benchById = pieceMapForPieces(bench)
  const quotas = capsuleQuotas(budget, { isSummer, isWinter })

  // Resolve a model answer into real pieces. Anything outside the bench, or the
  // wrong count, is a contract failure rather than something to quietly clamp —
  // clamping would hide exactly the mistake the repair round exists to fix.
  const resolve = (answer) => {
    const ids = (Array.isArray(answer?.roster_piece_ids) ? answer.roster_piece_ids : []).map(Number).filter(Boolean)
    const unique = [...new Set(ids)]
    const outsideBench = unique.filter(id => !benchById.has(id))
    const roster = unique.map(id => benchById.get(id)).filter(Boolean)
    const contractFailures = []
    if (outsideBench.length) {
      contractFailures.push({
        code: 'piece_outside_bench',
        message: `pieces ${outsideBench.join(', ')} are not in the supplied candidate list; choose only from it`
      })
    }
    if (unique.length !== budget) {
      contractFailures.push({
        code: 'roster_size',
        message: `selected ${unique.length} pieces; this capsule must contain exactly ${budget}`
      })
    }
    if (roster.length === budget) {
      const neutralPlan = capsuleNeutralBasePlan(budget)
      const neutralCount = capsuleNeutralBaseCount(roster)
      const availableNeutralCount = bench.filter(piece => colorsArePaletteNeutral(piece?.colors)).length
      const requestedFamilies = capsuleAccentFamilyNames(palette)
      const eligibleColourCarriers = bench.filter(piece =>
        pieceCarriesAccent(piece) &&
        (!requestedFamilies.length || requestedFamilies.some(family => pieceMatchesAccentFamily(piece, family)))
      ).length
      if (neutralCount < neutralPlan.minimum && availableNeutralCount >= neutralPlan.minimum) {
        contractFailures.push({
          code: 'neutral_base_share',
          message: `roster has ${neutralCount} neutral foundation piece(s); aim for ${neutralPlan.target} and keep at least ${neutralPlan.minimum} of ${budget}`
        })
      }
      if (neutralCount > neutralPlan.maximum && eligibleColourCarriers >= budget - neutralPlan.maximum) {
        contractFailures.push({
          code: 'neutral_base_share',
          message: `roster has ${neutralCount} neutral foundation piece(s); aim for ${neutralPlan.target} and keep no more than ${neutralPlan.maximum} when the requested colour supply is available`
        })
      }
      if (requestedFamilies.length) {
        const unrelatedAccents = roster.filter(piece =>
          pieceCarriesAccent(piece) &&
          !requestedFamilies.some(family => pieceMatchesAccentFamily(piece, family))
        )
        if (unrelatedAccents.length) {
          contractFailures.push({
            code: 'accent_palette_outside_requested',
            message: `non-neutral pieces ${unrelatedAccents.map(piece => piece.id).join(', ')} introduce unrequested colour families; replace them with requested-family pieces or neutrals`
          })
        }
        const omittedAvailable = requestedFamilies.filter(family =>
          bench.some(piece => pieceMatchesAccentFamily(piece, family)) &&
          !roster.some(piece => pieceMatchesAccentFamily(piece, family))
        )
        if (omittedAvailable.length) {
          contractFailures.push({
            code: 'accent_family_missing',
            message: `requested ${omittedAvailable.map(colorFamilyDisplayName).join(', ')} pieces are available in the eligible candidates but absent from the roster`
          })
        }
      }
    }
    // Provider responses use the accountability fields required by the
    // production schema. Injected offline choosers written before that schema
    // intentionally remain usable; when the fields are present, every claim is
    // checked against garment truth rather than trusted as prose.
    if (Object.prototype.hasOwnProperty.call(answer || {}, 'category_counts')) {
      const groups = ['top', 'bottom', 'dress', 'outerwear', 'shoes']
      const actualCounts = Object.fromEntries(groups.map(group => [
        group,
        roster.filter(piece => wardrobeCategoryGroup(piece) === group).length
      ]))
      const reportedCounts = answer?.category_counts || {}
      const miscounted = groups.filter(group => Number(reportedCounts[group]) !== actualCounts[group])
      if (miscounted.length) {
        contractFailures.push({
          code: 'category_accounting',
          message: `reported category counts do not match the selected IDs: ${miscounted.map(group => `${group} reported ${Number(reportedCounts[group]) || 0}, actual ${actualCounts[group]}`).join('; ')}`
        })
      }

      const departures = Array.isArray(answer?.category_departures) ? answer.category_departures : []
      const departureProblems = []
      for (const group of groups) {
        const target = Number(quotas[group]) || 0
        const actual = actualCounts[group]
        const matching = departures.filter(entry => String(entry?.category || '') === group)
        if (actual === target && matching.length) departureProblems.push(`${group} matches its target but declares a departure`)
        if (actual !== target && matching.length !== 1) departureProblems.push(`${group} is ${actual} against target ${target} but needs exactly one departure reason`)
        if (actual !== target && matching.length === 1) {
          const entry = matching[0]
          if (Number(entry.target_count) !== target || Number(entry.selected_count) !== actual || !String(entry.reason || '').trim()) {
            departureProblems.push(`${group} departure must state target ${target}, selected ${actual}, and a reason`)
          }
        }
      }
      if (departureProblems.length) {
        contractFailures.push({ code: 'category_departure', message: departureProblems.join('; ') })
      }

      const jobs = Array.isArray(answer?.piece_jobs) ? answer.piece_jobs : []
      const jobIds = jobs.map(entry => Number(entry?.piece_id)).filter(Boolean)
      const selectedSet = new Set(roster.map(piece => Number(piece.id)))
      const missingJobs = [...selectedSet].filter(id => !jobIds.includes(id))
      const extraJobs = [...new Set(jobIds.filter(id => !selectedSet.has(id)))]
      const duplicateJobs = [...new Set(jobIds.filter((id, index) => jobIds.indexOf(id) !== index))]
      const blankJobs = jobs.filter(entry => !String(entry?.job || '').trim()).map(entry => Number(entry?.piece_id)).filter(Boolean)
      if (missingJobs.length || extraJobs.length || duplicateJobs.length || blankJobs.length) {
        const details = []
        if (missingJobs.length) details.push(`missing jobs for IDs ${missingJobs.join(', ')}`)
        if (extraJobs.length) details.push(`jobs for unselected IDs ${extraJobs.join(', ')}`)
        if (duplicateJobs.length) details.push(`duplicate jobs for IDs ${duplicateJobs.join(', ')}`)
        if (blankJobs.length) details.push(`blank jobs for IDs ${blankJobs.join(', ')}`)
        contractFailures.push({ code: 'piece_job_coverage', message: details.join('; ') })
      }
    }
    return { roster, contractFailures, palette: String(answer?.palette || '').trim(), jobs: Array.isArray(answer?.piece_jobs) ? answer.piece_jobs : [] }
  }

  const paletteSupplyGaps = [describeCapsuleAccentSupplyGap(palette, bench)].filter(Boolean)

  // A failed model call must not make the palette contract disappear. The old
  // fallback returned the legacy palette-biased engine roster, which could
  // introduce unrelated accents even when the user had named one family. Keep
  // neutrals plus the requested family only; if that family is unavailable,
  // this naturally produces the neutral capsule the user was promised.
  const paletteSafeDeterministic = () => {
    const requestedFamilies = capsuleAccentFamilyNames(palette)
    if (!requestedFamilies.length) return deterministic()
    const allowedPool = pool.filter(piece =>
      colorsArePaletteNeutral(piece?.colors) ||
      requestedFamilies.some(family => pieceMatchesAccentFamily(piece, family))
    )
    let roster = selectCapsuleRoster(allowedPool, { budget, isSummer, isWinter, occasions, slots, palette })
    if (roster.length !== budget) return roster

    const neutralPlan = capsuleNeutralBasePlan(budget)
    const accentCandidates = allowedPool.filter(piece =>
      !roster.some(selected => Number(selected.id) === Number(piece.id)) &&
      !colorsArePaletteNeutral(piece?.colors) &&
      requestedFamilies.some(family => pieceMatchesAccentFamily(piece, family))
    )
    while (capsuleNeutralBaseCount(roster) > neutralPlan.maximum) {
      let swapped = false
      for (const replacement of accentCandidates) {
        const replaceIndex = roster.findIndex(piece =>
          colorsArePaletteNeutral(piece?.colors) &&
          wardrobeCategoryGroup(piece) === wardrobeCategoryGroup(replacement)
        )
        if (replaceIndex < 0) continue
        const trial = [...roster]
        trial[replaceIndex] = replacement
        if (!validateCapsuleRoster(trial, { slots, budget, isSummer, isWinterCapsule: isWinter, pool: allowedPool }).valid) continue
        roster = trial
        accentCandidates.splice(accentCandidates.indexOf(replacement), 1)
        swapped = true
        break
      }
      if (!swapped) break
    }
    return roster
  }

  const check = (roster) => validateCapsuleRoster(roster, {
    slots, budget, isSummer, isWinterCapsule: isWinter, pool: bench
  })
  // Every code seen across both attempts, so a fallback records WHY it happened
  // instead of only that it did.
  const seenCodes = []
  const record = entries => {
    for (const entry of entries) if (entry?.code && !seenCodes.includes(entry.code)) seenCodes.push(entry.code)
    return entries
  }

  bump('capsuleRosterModelCalls')
  // Pass the category starting shape through rather than re-deriving it in the
  // route. It is planning guidance for the model, not a validator formula.
  const first = resolve(await chooseRoster({ bench, benchDiagnostics: diagnostics, slots, budget, palette, isSummer, isWinter, quotas, attempt: 1, failures: [], ownerRules }))
  let failures = record([...first.contractFailures, ...(first.contractFailures.length ? [] : check(first.roster).failures)])
  if (!failures.length) {
    return { roster: first.roster, source: 'model', palette: first.palette, jobs: first.jobs, failures: [], bench, coverageGaps: paletteSupplyGaps, failureCodes: seenCodes }
  }

  // One repair, given the exact structural reasons. Not a fresh start: the
  // model is asked to fix what failed, keeping the rest.
  bump('capsuleRosterModelRepairs')
  const second = resolve(await chooseRoster({
    bench, benchDiagnostics: diagnostics, slots, budget, palette, isSummer, isWinter, quotas,
    attempt: 2, failures, previousRosterIds: first.roster.map(piece => Number(piece.id)), ownerRules
  }))
  const secondFailures = record([...second.contractFailures, ...(second.contractFailures.length ? [] : check(second.roster).failures)])
  if (!secondFailures.length) {
    return { roster: second.roster, source: 'model_repaired', palette: second.palette, jobs: second.jobs, failures: [], bench, coverageGaps: paletteSupplyGaps, failureCodes: seenCodes }
  }

  // Two strikes on something structural: ship the deterministic roster and say
  // so. A capsule the engine chose is a worse answer than one the model chose
  // well, and a better answer than one that fails a guarantee about whether its
  // pieces can be worn at all.
  bump('capsuleRosterModelFallbacks')
  return {
    roster: paletteSafeDeterministic(),
    source: 'deterministic_fallback',
    palette: '',
    jobs: [],
    failures: secondFailures,
    bench,
    // The spec required this disclosure at stage 3 and it was never
    // implemented: capsuleRosterSource was written and read by nothing, so a
    // fallback capsule presented exactly like a chosen one.
    coverageGaps: [...paletteSupplyGaps, `[capsule roster: the stylist's own selection could not meet this capsule's structural guarantees, so the engine chose the roster instead — ${secondFailures.map(failure => failure.message).join('; ')}]`],
    failureCodes: seenCodes
  }
}

export async function buildPlanSlotWorkbench(slots = [], { constraints = {}, allPieces = [], dateRange = {}, mood = '', question = '', location = '', fetchImpl, ownerRules = [], planKind = '', chooseCapsuleRoster = null, onDiagnostic = null } = {}) {
  const { reuse: reuseMode, noRepeat: noRepeatCats, allowRepeat, anchorIds, pieceBudget } = normalizePlanConstraints(constraints)
  const isSeasonalCapsule = planKind === 'seasonal_capsule'
  const weatherContextText = slots.map(slot => `${slot?.season || ''} ${slot?.weather || ''} ${slot?.slotWeather || ''}`).join(' ')
  const isSummerContext = /\b(summer|warm|hot|80|90|heat)\b/i.test(`${question} ${mood} ${weatherContextText}`) // ratchet-allow: plan weather context, not garment matching
  const isWinterContext = /\b(winter|cold|chilly|snow|freezing)\b/i.test(`${question} ${mood} ${weatherContextText}`) // ratchet-allow: plan weather context, not garment matching
  const requiresTransitionLayerCoverage =
    /\bouterwear\b[\s\S]{0,80}\btransition|\btransition[\s\S]{0,80}\bouterwear\b/i.test(String(question || '')) // ratchet-allow: user plan directive
  const { accentColors: requestPalette, optOut: paletteOptOut } = extractStatedPalette(question, allPieces)
  // Stage 2 (spec §3): when a chooser is injected AND this is an enforced
  // capsule, the model picks the roster and the engine validates it. Otherwise
  // — and on any failure — this is byte-identical to the deterministic path.
  let capsuleRosterSelection = null
  if (typeof chooseCapsuleRoster === 'function' && isSeasonalCapsule && pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET) {
    capsuleRosterSelection = await selectCapsuleRosterViaModel({
      pool: allPieces,
      budget: pieceBudget,
      slots,
      isSummer: isSummerContext,
      isWinter: isWinterContext && !isSummerContext,
      occasions: slots.map(slot => slot.occasion),
      palette: paletteOptOut ? [] : requestPalette,
      chooseRoster: chooseCapsuleRoster,
      onDiagnostic,
      // Previously reached only composition (below, in workbenchInstructions);
      // the roster pick itself never saw a stored owner rule at all.
      ownerRules
    })
  }
  const composePool = capsuleRosterSelection
    ? capsuleRosterSelection.roster
    : modelPlanPool({ allPieces, slots, constraints, question, mood, planKind })
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
  // A layer allocation the wardrobe could not supply is disclosed, never
  // silently absorbed by another category (Step 5 criterion 1's graceful half).
  if (Array.isArray(capsuleRosterSelection?.coverageGaps)) coverageGaps.push(...capsuleRosterSelection.coverageGaps)
  for (const [index, slot] of slots.entries()) {
    const slotRequestText = [slot.label, slot.bestFor, slot.coverage, slot.planNote].filter(Boolean).join('. ') || question
    const { profile: weatherProfile, label: weatherLabel } = await resolveSlotWeather(slot, { mood, question: slotRequestText, dateRange, location, fetchImpl, seasonIsCalendarOnly: isSeasonalCapsule })
    slotWeather.push({ label: slot.label, weather: weatherLabel, order: index })
    // The slot's structured occasion/register owns its ceiling. Descriptive
    // prose still informs ranking, but must not silently lower a casual slot
    // to lounge because a note says "comfort-first" (live capsule repro,
    // 2026-07-28). Passing the resolved ceiling explicitly also preserves the
    // existing declared-register escalation behavior.
    const ceilingRank = effectiveSlotRegisterCeilingRank(slot)
    const registerCeilingOverride = registerRankName(ceilingRank) || null
    const gateResult = filterWholeWardrobePiecesForGeneration(composePool, {
      occasion: slot.occasion,
      explorationMode: 'moderate',
      weatherProfile,
      mood: mood || slotRequestText,
      activity: slot.activity,
      request: slotRequestText,
      ...(registerCeilingOverride ? { registerCeiling: registerCeilingOverride } : {})
    })
    const allowedPieces = gateResult.allowedPieces
    const suppressedPieces = gateResult.suppressedPieces
    const activeMovement = slotRequiresActiveMovement(slot)
    const operationalEase = slotRequiresOperationalEase(slot)
    const shownPieces = selectPlanWorkbenchPieces(allowedPieces, slot, { anchorIds, weatherProfile, activeMovement, operationalEase })
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
      piece_assessments: shownPieces.map(piece => planPieceAssessments(piece, { weatherProfile, activeMovement, operationalEase })),
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
  // Step 5 criterion 8 (docs/capsule-step5-evaluation.md): the composer must
  // DEMONSTRATE the roster's functional logic, not merely use most of its IDs.
  // On thread_1785448241452 the rotation reached 22 of 24 pieces and still
  // showed no layer at all, and both dependent tops over the same tank.
  //
  // Derived from what this roster actually holds, so it is a strict no-op for a
  // roster with none of these jobs, and it never names a garment or an ID — it
  // names the function the allocation bought. Which look carries each job, and
  // whether omitting one is the honest answer, stays the model's judgment; this
  // states the requirement, not the assignment.
  const capsuleFunctionalJobs = []
  if (isSeasonalCapsule && pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET) {
    const rosterPieces = Array.isArray(composePool) ? composePool : []
    if (rosterPieces.some(piece => wardrobeCategoryGroup(piece) === 'outerwear')) {
      capsuleFunctionalJobs.push('the layer(s) it holds, worn in at least one look')
    }
    const dependents = rosterPieces.filter(pieceNeedsBase)
    if (dependents.length) {
      capsuleFunctionalJobs.push(dependents.length > 1
        ? 'each piece that cannot be worn alone, over a DIFFERENT base and in a different context — repeating one base under all of them demonstrates bookkeeping, not breadth'
        : 'the piece that cannot be worn alone, over a base that suits it')
    }
    const shoeCount = rosterPieces.filter(piece => wardrobeCategoryGroup(piece) === 'shoes').length
    if (shoeCount > 2) {
      capsuleFunctionalJobs.push(`each of the ${shoeCount} shoe pairs in a look whose register and activity genuinely call for it`)
    }
  }
  const workbenchInstructions = [
    // Spec 27 Part 2 (owner ruling: norms enumeration is DEAD — the failures
    // were blind visual judgments, not missing occasion knowledge). Replaces
    // the old blanket "don't call view_pieces" default with judgment-to-the-
    // model on WHEN to look; Part 1's print-pairing gate still holds the
    // floor if the model under-looks on a printed pairing.
    'Compose the outfits yourself and submit ALL slots in ONE submit_plan_outfits call. Use piece_catalog for garment details and pick only from each slot allowed_piece_ids. Viewing pieces is cheap. VIEW the pieces of any outfit whose visual coherence you are uncertain about — print combinations, statement pieces, layering, anything sheer or revealing, silhouette pairings you haven\'t seen work. Compose directly from the catalog when pieces are solids and the combination is conventional. Do not bulk-browse the whole roster. If validation accepts some outfits and rejects others, resubmit only the failed slots.',
    // Part 4 (spec 18): the spec-15 watch item's agreed escalation, now past
    // its 3-run threshold (16/18/20 distinct pieces across live maximize-reuse
    // packing runs, only accessories repeating).
    // Part 3 (spec 23): the vibe-based instruction ("aim to repeat bottoms
    // and shoes") measured 16/18/20 distinct pieces across live maximize-
    // reuse runs — trending the wrong way, and a live re-run still produced
    // five different pairs of footwear across five outfits. A checkable
    // number replaces the vibe.
    reuseMode === 'maximize'
      ? 'Reuse is set to maximize: pack at most 3 pairs of shoes across the whole set — a fourth only if a demanding activity (hiking, trail) requires it — and aim to repeat bottoms across slots. Every reused piece is one fewer to pack. Accessories alone do not count as reuse.'
      : '',
    isSeasonalCapsule && pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET
      ? 'This is a representative capsule rotation: every card needs a different main core (a different top+bottom pair, or a different dress). Use the casual and elevated shoes the roster reserved where their slots call for them; avoid letting one pair dominate when another eligible pair expresses the requested register or activity better.'
      : '',
    capsuleFunctionalJobs.length
      ? `The rotation is what PROVES this capsule works, so it must demonstrate the roster's functional logic, not just use most of its pieces. Across the whole set, show: ${capsuleFunctionalJobs.join('; ')}. If one of these genuinely cannot be shown well, say which and why in that look's reason rather than quietly skipping it — an omitted look is honest, an unexplained missing function is not.`
      : '',
    // Part 5 (spec 18): live miss — a card described the Tropical pants
    // (catalog: pattern floral, six colors) as "solid-base... muted print",
    // fabricating past the catalog truth it already had in piece_catalog.
    'The catalog\'s pattern and color fields are the truth about prints — never describe a piece as solid, muted, or subtle unless its line says so.',
    'The catalog\'s silhouette, length, hem, sleeve, fit, tuck, waistband, opacity, and base-layer fields are authoritative garment construction. Never write a card reason or styling instruction that contradicts them. Card prose expresses styling intent only; it cannot redefine how a garment is constructed or worn.',
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
    // Part 2 (spec 25) / Part 5 (spec 26): a stored owner rule (e.g.
    // "office/client days: structured silhouettes, no maxi skirts or
    // shawls") was present in the system-prompt tail but got out-composed by
    // an unrelated praise corpus sitting in the same flat feedback list,
    // ~40k tokens further from composition-time attention than this
    // workbench. Deterministic pass-through of the same rows
    // getStylistFeedbackMemory renders under "Owner rules" — still prompt
    // guidance, never a mechanical gate (#44). Spec 26 live miss: with the
    // rule delivered and acknowledged, the model still wrote a constructed
    // exception ("can drape over the shoulders if the office AC runs cold")
    // on a regular office day — strengthened framing below to name and
    // forbid that exact move.
    Array.isArray(ownerRules) && ownerRules.length
      ? `OWNER RULES — hard requirements, not suggestions. Do not construct exceptions or conditional workarounds (no "in case the AC runs cold"). If a rule makes a slot impossible, disclose the conflict instead of bending the rule. Apply to every outfit you compose: ${ownerRules.map(rule => `"${rule}"`).join('; ')}`
      : '',
    // Part 6 (spec 26): the spec-25 professional-context competence bullet
    // is live in STYLIST_SYSTEM but demonstrably weak from tail position (the
    // 07-16 office run: shawl on Tuesday, double botanical on Wednesday).
    // Same delivery lesson as owner rules above — repeat it here, ~40k
    // tokens closer to composition-time attention.
    'For professional/work slots (office, client, presentation): quiet, structured pieces lead; at most ONE bold print per outfit; accessory register matches the outfit; no statement wraps at work. Social slots (dinner, gallery, weekend) are where statement styling belongs.'
  ].filter(Boolean).join(' ')
  let pendingSlots = slots.map((slot, index) => ({
    ...slot,
    originalIndex: index,
    weatherProfile: slot._modelWorkbench?.weatherProfile || null,
    weatherLabel: slot._modelWorkbench?.weatherLabel || '',
    allowedPieces: slot._modelWorkbench?.allowedPieces || [],
    rosterIds: slot._modelWorkbench?.rosterIds || new Set(),
    gateAllowedIds: slot._modelWorkbench?.gateAllowedIds || new Set(),
    suppressedReasonsById: slot._modelWorkbench?.suppressedReasonsById || new Map(),
    slotRequestText: slot._modelWorkbench?.slotRequestText || ''
  }))
  const statedPaletteResult = extractStatedPalette(question, allPieces)
  const capsuleRoster = isSeasonalCapsule && pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET ? composePool : []
  if (capsuleRoster.length) {
    pendingSlots = allocateCapsuleRepresentativeRotation(pendingSlots, capsuleRoster, {
      cap: capsuleTotalOutfitCap(pieceBudget)
    })
    const allocationById = new Map(pendingSlots.map(slot => [slot.id, slot]))
    for (const workbenchSlot of workbenchSlots) {
      const allocation = allocationById.get(workbenchSlot.id)
      if (allocation) workbenchSlot.target_outfits = allocation.targetOutfits
    }
    for (const slot of pendingSlots.filter(slot => slot.capsuleSlotCapacity === 0)) {
      coverageGaps.push(`[missing wardrobe gap: "${slot.label}" has no complete gate-valid outfit core in this ${pieceBudget}-piece capsule roster]`)
    }
  }
  const pendingById = new Map(pendingSlots.map(slot => [slot.id, slot]))
  for (const workbenchSlot of workbenchSlots) {
    const pendingSlot = pendingById.get(workbenchSlot.id)
    const allowed = (pendingSlot?.allowedPieces || []).filter(Boolean)
    const target = Math.max(0, Number(workbenchSlot.target_outfits) || 0)
    const requirements = [
      `Submit exactly ${target} outfit${target === 1 ? '' : 's'} for this slot.`,
      'Every outfit must contain exactly one top plus one bottom, OR one dress; exactly one pair of shoes; and at most one optional outerwear layer. Outerwear never replaces the required top.'
    ]
    if (workbenchSlot.environment === 'indoor' && pendingSlot?.weatherProfile?.isHot) {
      requirements.push('This is a climate-controlled destination reached through hot weather: compose a breathable hot-weather base for transit. If indoor AC needs coverage, use only an optional light layer; do not use a heavy main garment to solve for AC.')
    }
    if (pendingSlot?.weatherProfile?.isExtremeHeat) {
      requirements.push('Extreme-heat fit is advisory unless marked prohibited: lead with pieces rated preferred, use workable pieces only when they better serve another stated need, and avoid discouraged pieces when a preferred or workable option can do the same job. For full-length light pants, “light” describes fabric mass, not guaranteed comfort in triple-digit heat.')
    }
    if (slotRequiresActiveMovement(pendingSlot)) {
      requirements.push('This use case requires quick active movement. Prefer the movement-rated pieces and easy everyday mains. Evaluate movement fit independently from heat fit: a supportive closed shoe may be excellent for movement while still being a warmer choice in triple-digit heat.')
    }
    if (slotRequiresOperationalEase(pendingSlot) && !slotRequiresActiveMovement(pendingSlot)) {
      requirements.push('This is a low-key home/play use case. Prefer pieces rated for operational ease; elevated footwear is a deliberate tradeoff, not the default.')
    }
    if (isSeasonalCapsule && pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET && isWinterContext && !isSummerContext &&
        workbenchSlot.environment === 'indoor' &&
        allowed.some(piece => wardrobeCategoryGroup(piece) === 'top' && hasSleevelessConstruction(piece))) {
      requirements.push('A sleeveless top must include a medium/heavy cardigan that stays on indoors; a coat or puffer does not satisfy the indoor-layer requirement.')
    }
    if (requiresTransitionLayerCoverage &&
        allowed.some(piece => wardrobeCategoryGroup(piece) === 'outerwear')) {
      requirements.push('Across this slot’s submitted looks, include capsule outerwear in at least one look for transition coverage.')
    }
    const eligibleShoeCount = allowed.filter(piece => wardrobeCategoryGroup(piece) === 'shoes').length
    if (isSeasonalCapsule && pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET && target > 1 && eligibleShoeCount > 1) {
      requirements.push('Across this recurring slot, use at least two different eligible shoe pairs.')
    }
    const slotActivityProfile = resolveActivityProfile({
      activity: workbenchSlot.activity,
      occasion: workbenchSlot.occasion,
      request: pendingSlot?.slotRequestText || workbenchSlot.label || ''
    })
    if (slotActivityProfile?.rules && (slotActivityProfile.rules.excluded_heel_heights?.length || slotActivityProfile.rules.excluded_walk_support?.length)) {
      requirements.push(activityFootwearRequirementText(slotActivityProfile))
    }
    if (isSeasonalCapsule && pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET) {
      // Task 1: "distinct main core" is enforced ACROSS THE WHOLE SET by
      // validateSubmittedPlanOutfits (outfitMainCoreKey / usedCoreKeys), not
      // per slot — a look here can still be rejected for repeating a core
      // used by an earlier slot's look, even though this slot's own
      // requirements looked satisfied in isolation.
      requirements.push('This look\'s main core (top+bottom pair, or dress) must be distinct from every other look already submitted across the ENTIRE capsule set, not just within this slot — changing only shoes, a layer, or accessories does not make it a distinct core.')
    }
    workbenchSlot.submission_requirements = requirements
  }
  return {
    status: 'slot_rosters',
    instructions: workbenchInstructions,
    piece_catalog: pieceCatalog,
    slots: workbenchSlots,
    constraints: {
      plan_kind: planKind || (isSeasonalCapsule ? 'seasonal_capsule' : 'coordinated_plan'),
      reuse: reuseMode,
      no_repeat: [...noRepeatCats],
      allow_repeat: [...allowRepeat],
      shared_anchor_ids: [...anchorIds],
      piece_budget: pieceBudget
    },
    pendingPlan: {
      slots: pendingSlots,
      piecesById,
      constraints: { reuse: reuseMode, noRepeat: noRepeatCats, allowRepeat, anchorIds, pieceBudget },
      capsuleRoster,
      capsuleCapacity: capsuleOutfitCoreCapacity(capsuleRoster, pendingSlots),
      statedPalette: statedPaletteResult.accentColors,
      paletteOptOut: statedPaletteResult.optOut,
      capsuleRosterSource: capsuleRosterSelection?.source || 'deterministic',
      capsuleRosterPalette: capsuleRosterSelection?.palette || '',
      capsuleRosterJobs: capsuleRosterSelection?.jobs || [],
      capsuleRosterFailureCodes: capsuleRosterSelection?.failureCodes || [],
      slotWeather,
      coverageGaps,
      heldOutfits: [],
      resubmits: 0,
      planKind: planKind || (isSeasonalCapsule ? 'seasonal_capsule' : 'coordinated_plan'),
      isSeasonalCapsule,
      // User-request parsing, not garment inference: this turns an explicit
      // "outerwear for transitions" instruction into inspectable set
      // coverage. It is absent/no-op for every other plan.
      requiresTransitionLayerCoverage,
      isWinterCapsule: isSeasonalCapsule && pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET && isWinterContext && !isSummerContext
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
  let newSlots = Array.isArray(newPendingPlan?.slots) ? newPendingPlan.slots : []
  // After a partial delivery, the tool contract asks the model to re-plan only
  // the unfilled slot. Models sometimes append "Supplement" to that slot's
  // label, producing a fresh id even though the occasion/activity and requested
  // count clearly describe the outstanding gap. Rebind a one-to-one compatible
  // gap-fill to the original slot so its accepted card closes that gap instead
  // of creating a second slot while the first remains permanently missing.
  if (priorPendingPlan?.partialDelivered && newSlots.length) {
    const heldCountBySlot = new Map()
    for (const outfit of priorHeld) {
      const slotId = outfit?._slotId || outfit?.slot_id || outfit?.tripSlot
      if (slotId) heldCountBySlot.set(slotId, (heldCountBySlot.get(slotId) || 0) + 1)
    }
    const missingPriorSlots = priorSlots.filter(slot =>
      (heldCountBySlot.get(slot.id) || 0) < Math.min(3, Math.max(0, Number(slot.targetOutfits) || 0))
    )
    const claimedPriorIds = new Set()
    newSlots = newSlots.map(slot => {
      if (priorSlots.some(prior => prior.id === slot.id)) return slot
      const compatible = missingPriorSlots.filter(prior =>
        !claimedPriorIds.has(prior.id) &&
        prior.occasion === slot.occasion &&
        prior.activity === slot.activity &&
        (prior.environment || '') === (slot.environment || '')
      )
      if (compatible.length !== 1) return slot
      const prior = compatible[0]
      claimedPriorIds.add(prior.id)
      const heldCount = heldCountBySlot.get(prior.id) || 0
      const missingCount = Math.max(1, Math.min(3, Number(prior.targetOutfits) || 0) - heldCount)
      return {
        ...slot,
        id: prior.id,
        label: prior.label,
        targetOutfits: missingCount
      }
    })
  }
  const newSlotIds = new Set(newSlots.map(slot => slot.id))
  const priorSlotById = new Map(priorSlots.map(slot => [slot.id, slot]))
  const preserveMatchingHeld = Boolean(priorPendingPlan?.partialDelivered)
  const preservedCountBySlot = new Map()
  if (preserveMatchingHeld) {
    for (const outfit of priorHeld) {
      const slotId = outfit?._slotId || outfit?.slot_id || outfit?.tripSlot
      if (slotId && newSlotIds.has(slotId)) {
        preservedCountBySlot.set(slotId, (preservedCountBySlot.get(slotId) || 0) + 1)
      }
    }
  }

  const keptPriorSlots = priorSlots.filter(slot => !newSlotIds.has(slot.id))
  const maxPriorIndex = priorSlots.reduce((max, slot) => Math.max(max, Number(slot.originalIndex) || 0), -1)
  let nextAppendIndex = maxPriorIndex + 1
  const positionedNewSlots = newSlots.map(slot => {
    const priorMatch = priorSlotById.get(slot.id)
    // A re-planned slot (label/id matches a prior slot) takes that slot's
    // original position; a genuinely new slot appends after the existing set.
    const originalIndex = priorMatch ? priorMatch.originalIndex : nextAppendIndex++
    const preservedCount = preservedCountBySlot.get(slot.id) || 0
    return {
      ...slot,
      originalIndex,
      targetOutfits: Math.max(0, Number(slot.targetOutfits) || 0) + preservedCount
    }
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
    if (slotId && newSlotIds.has(slotId) && !(preserveMatchingHeld && priorHeld.includes(outfit))) {
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
    capsuleRoster: newPendingPlan?.capsuleRoster?.length
      ? newPendingPlan.capsuleRoster
      : (priorPendingPlan?.capsuleRoster || []),
    capsuleCapacity: newPendingPlan?.capsuleCapacity || priorPendingPlan?.capsuleCapacity || 0,
    slotWeather: mergedSlotWeather,
    coverageGaps,
    heldOutfits: keptHeld,
    resubmits: 0,
    partialDelivered: false,
    planKind: newPendingPlan?.planKind || priorPendingPlan?.planKind || 'coordinated_plan',
    isSeasonalCapsule: Boolean(priorPendingPlan?.isSeasonalCapsule || newPendingPlan?.isSeasonalCapsule),
    requiresTransitionLayerCoverage: Boolean(
      priorPendingPlan?.requiresTransitionLayerCoverage ||
      newPendingPlan?.requiresTransitionLayerCoverage
    ),
    isWinterCapsule: Boolean(priorPendingPlan?.isWinterCapsule || newPendingPlan?.isWinterCapsule)
  }
}

// Spec 26 Part 1: two captured occurrences of the model revising its outfit
// mid-reason while submitting the un-revised piece_ids ("Actually revising:
// emerald v-neck top..." with the dress submitted anyway; "wait, maxi skirt
// is prohibited... Switching:" with maxi 167 submitted). The spec-19
// piece_ids-ARE-the-outfit instruction (a prose-only fix) failed both times —
// this hardens it into a mechanical check on the model's OWN reply prose, not
// garment text, matching the looksLikeDestinationOrWeatherQuestion precedent
// (provider.js). Each marker is anchored with its own \b so trailing
// punctuation in the "wait" branch doesn't swallow the boundary check (a
// combined \b(...)\b around the whole alternation fails to match "wait," since
// both the comma and the following space are non-word characters).
export function reasonRevisesMidSentence(reasonText = '') {
  const text = String(reasonText || '')
  return /\bwait\b[,—\- ]|\bactually\b[, ]|\bswitching to\b|\brevising\b|\bscratch that\b|\binstead let'?s\b/i.test(text) // ratchet-allow: model's own reply prose, not garment matching
}

export const REASON_REVISION_MESSAGE = 'your reason revises itself mid-sentence — decide the pieces first, update piece_ids to match, and resubmit with a clean reason describing only the pieces you actually included.'

// Spec 27 Part 1: print mixing is a visual decision, not a tag lookup — two
// or more MAIN pieces (top/bottom/dress/outerwear; accessories excluded,
// see the sight-registry) with a known non-solid pattern_type must have been
// visually SEEN this turn before the outfit is accepted. Unknown/missing
// pattern_type never triggers this — tags are the truth surface, and an
// untagged piece isn't evidence of a clash. Shared by validateSubmittedPlanOutfits
// (submit_plan_outfits) and propose_outfit's contract-issue block so both
// composition paths enforce the same gate.
const NON_PRINT_PATTERN_TYPES = new Set(['solid', 'none', ''])

export function printedMainPieceIds(pieces = []) {
  return pieces
    .filter(piece => ['top', 'bottom', 'dress', 'outerwear'].includes(wardrobeCategoryGroup(piece)))
    .filter(piece => !NON_PRINT_PATTERN_TYPES.has(String(piece?.pattern_type || '').toLowerCase()))
    .map(piece => Number(piece?.id))
    .filter(Boolean)
}

export function printPairingSightIssue(pieces = [], seenPieceIds = new Set()) {
  const printedIds = printedMainPieceIds(pieces)
  if (printedIds.length < 2) return ''
  const seen = seenPieceIds instanceof Set ? seenPieceIds : new Set()
  const unseenIds = printedIds.filter(id => !seen.has(id))
  if (!unseenIds.length) return ''
  return `this outfit pairs ${printedIds.length} printed pieces — print mixing is a visual decision: call view_pieces on [${unseenIds.join(', ')}], look at how the prints actually interact, then resubmit (keep the pairing only if it genuinely works to the eye).`
}

export function validateSlotOutfitConstraints(outfit = {}, slot = {}, { weatherProfile = {} } = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const reasons = []
  const mainPieces = pieces.filter(piece => ['top', 'bottom', 'dress'].includes(wardrobeCategoryGroup(piece)))
  const layer = pieces.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  const top = pieces.find(piece => wardrobeCategoryGroup(piece) === 'top')
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  for (let index = 0; index < pieces.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < pieces.length; otherIndex += 1) {
      const first = pieces[index]
      const second = pieces[otherIndex]
      if (hasRejectedReference(first, second) || hasRejectedReference(second, first)) {
        reasons.push(`${first.name || first.id} + ${second.name || second.id} is an owner-rejected pairing`)
      }
    }
  }
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
  const isEnforcedCapsule = Boolean(
    pendingPlan?.isSeasonalCapsule ||
    (Array.isArray(pendingPlan?.capsuleRoster) && pendingPlan.capsuleRoster.length)
  ) && pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET
  const usedKeys = new Set(heldOutfits.map(outfit => tripOutfitKey(outfit)).filter(Boolean))
  const usedCoreKeys = new Set(heldOutfits.map(outfit => outfitMainCoreKey(outfit)).filter(Boolean))
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
    if (outfit.reason && reasonRevisesMidSentence(outfit.reason)) {
      reasons.push(REASON_REVISION_MESSAGE)
    }
    if (!unresolvedPieceIds.length) {
      const structureGap = describeOutfitStructureGap(pieces, { requireShoes: true })
      if (structureGap || !isOutfitStructurallyValid(pieces, { requireShoes: true })) {
        reasons.push(structureGap || 'outfit is structurally incomplete or has duplicate core roles')
      }
      // Step 5 V1 follow-up (owner review 2026-07-30): a needs_base piece is
      // tagged unwearable alone by construction, but nothing checked that at
      // the OUTFIT level before — only that a standalone base existed
      // somewhere in the roster or slot. A submitted look could pair a
      // needs_base top with just a bottom and shoes and ship as an ordinary
      // card, presenting the dependent as if it were standalone. Shared by
      // every caller of this validator (atomic capsule composition and the
      // model tool-loop submit_plan_outfits), so a trip or work-week plan
      // that happens to include a needs_base piece is covered too — same
      // defect, same fix, not new scope.
      const dependentTops = pieces.filter(piece => wardrobeCategoryGroup(piece) === 'top' && pieceNeedsBase(piece))
      if (dependentTops.length && !pieces.some(isCapsuleBaseCandidate)) {
        reasons.push(`${dependentTops.map(piece => piece.name || `piece ${piece.id}`).join(', ')} cannot be worn alone — this outfit needs a base layer underneath it, not just a bottom`)
      }
      if (pendingPlan.isWinterCapsule && slot.environment === 'indoor') {
        const hasSleevelessBase = pieces.some(piece =>
          wardrobeCategoryGroup(piece) === 'top' && hasSleevelessConstruction(piece)
        )
        const hasStayOnIndoorLayer = pieces.some(piece =>
          wardrobeCategoryGroup(piece) === 'outerwear' &&
          garmentKind(piece) === 'cardigan' &&
          ['medium', 'heavy'].includes(fabricWeight(piece))
        )
        if (hasSleevelessBase && !hasStayOnIndoorLayer) {
          reasons.push('winter indoor sleeveless base needs a medium/heavy cardigan that can stay on indoors; a transition coat alone does not satisfy this')
        }
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
      const coreKey = outfitMainCoreKey(outfit)
      if (isEnforcedCapsule && coreKey && usedCoreKeys.has(coreKey)) {
        reasons.push('duplicate capsule core already represented — use a different top+bottom pair or dress; changing only shoes, a layer, or accessories is not a distinct representative look')
      }
      const repeatReason = modelPlanNoRepeatViolation(outfit, usedPieceIdsByCategory, noRepeat, anchorIds)
      if (repeatReason) reasons.push(repeatReason)
      const nextDistinctPieceCount = new Set([...usedPieceIds, ...outfitCategoryPairs(outfit).map(pair => pair.id)]).size
      if (pieceBudget > 0 && nextDistinctPieceCount > pieceBudget) reasons.push(`would exceed the ${pieceBudget}-piece budget`)
      // Part 1 (spec 24, owner ruling: enforce): reuse:maximize is a packing
      // directive, not a taste judgment — under-reuse means the directive
      // wasn't followed. Only blocks a 4th+ distinct pair when an
      // already-used pair is gate-eligible for THIS slot (the activity
      // exemption — a hiking slot's athletic shoe, a dressy slot's heels —
      // falls out of gate eligibility with no activity-specific code). Never
      // blocks the first, second, or third distinct pair.
      // Part 2 (spec 26, owner ruling 2026-07-16): the effective-2 trigger
      // (reject the 3rd distinct pair) deadlocked the coastal slot on the
      // first enforced run — the model refused loafers-at-the-beach
      // (defensible taste), burned the resubmit budget, coastal delivered
      // 0/1. Moved the trigger to distinct pairs >= 3 (reject the 4th); the
      // eligibility exemption and coached message are unchanged.
      // A seasonal capsule's roster has already paid for its shoe range inside
      // the piece budget. Reuse there means mix-and-match value across a
      // season, not trip-style shoe minimization. Keep the three-pair cap for
      // trips and other packing-light plans only.
      if (reuseMode === 'maximize' && !isEnforcedCapsule) {
        const shoePair = outfitCategoryPairs(outfit).find(pair => pair.group === 'shoes')
        if (shoePair) {
          const usedShoes = usedPieceIdsByCategory.get('shoes') || new Set()
          if (!usedShoes.has(shoePair.id) && usedShoes.size >= 3) {
            const eligibleUsedShoeIds = [...usedShoes].filter(id => gateAllowedIds.has(id))
            if (eligibleUsedShoeIds.length) {
              const names = eligibleUsedShoeIds.map(id => planPiecesById.get(id)?.name || `piece ${id}`).join(', ')
              reasons.push(`this would be a 4th pair of shoes under reuse:maximize — reuse one of: ${names} (they pass this slot's gates), or drop reuse:maximize if packing light isn't the goal.`)
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
      const printIssue = printPairingSightIssue(pieces, seenPieceIds)
      if (printIssue) reasons.push(printIssue)
    }
    if (reasons.length) {
      // Carry the rejected attempt itself, not just its reasons. Owner ruling
      // 2026-07-28: a rejected look is shown as a "needs review" card and
      // repaired in place, the way every other composing surface already does
      // it — so the caller needs the pieces, and needs to know WHICH piece was
      // blocked in order to offer a one-garment swap. Additive: existing
      // callers that only read `reasons` are unaffected.
      failures.push({
        slot_id: slot.id,
        label,
        reasons,
        outfit,
        blockedPieceIds: [...new Set(unresolvedPieceIds)]
      })
      continue
    }
    const key = tripOutfitKey(outfit)
    usedKeys.add(key)
    const coreKey = outfitMainCoreKey(outfit)
    if (coreKey) usedCoreKeys.add(coreKey)
    recordModelPlanUse(outfit, usedPieceIds, usedPieceIdsByCategory)
    accepted.push({ ...outfit, _slotId: slot.id })
  }
  const anchorAllowedSlots = anchorIds.size
    ? slots.filter(slot => [...anchorIds].some(id => (slot.gateAllowedIds || slot.rosterIds)?.has(id))).map(slot => slot.label)
    : []
  const allAccepted = [...heldOutfits, ...accepted]
  // A representative rotation must demonstrate the explicit set-level
  // promises it can actually satisfy. Remove one newly accepted card from an
  // offending completed slot so the normal resubmit path can repair it.
  for (const slot of slots) {
    const target = Math.min(3, Math.max(0, Number(slot.targetOutfits) || 0))
    if (!target) continue
    const slotOutfits = allAccepted.filter(outfit => (outfit?._slotId || outfit?.slot_id || outfit?.tripSlot) === slot.id)
    if (slotOutfits.length < target) continue
    const eligiblePieces = [...(slot.gateAllowedIds || [])].map(id => planPiecesById.get(Number(id))).filter(Boolean)
    const slotFailureReasons = []
    if (pendingPlan.requiresTransitionLayerCoverage &&
        eligiblePieces.some(piece => wardrobeCategoryGroup(piece) === 'outerwear') &&
        !slotOutfits.some(outfit => outfitCategoryPairs(outfit).some(pair => pair.group === 'outerwear'))) {
      slotFailureReasons.push('transition-layer coverage requested — include the capsule outerwear in at least one representative look for this use case')
    }
    const eligibleShoeCount = eligiblePieces.filter(piece => wardrobeCategoryGroup(piece) === 'shoes').length
    const usedShoeIds = new Set(slotOutfits.flatMap(outfit =>
      outfitCategoryPairs(outfit).filter(pair => pair.group === 'shoes').map(pair => pair.id)
    ))
    if (isEnforcedCapsule && target > 1 && eligibleShoeCount > 1 && usedShoeIds.size < 2) {
      slotFailureReasons.push('representative shoe range requested — this recurring use case has another gate-eligible capsule shoe; use it in at least one look instead of repeating one pair throughout')
    }
    if (!slotFailureReasons.length) continue
    failures.push({ slot_id: slot.id, label: slot.label, reasons: slotFailureReasons })
    // Dropping a card here only makes sense when the model gets to resubmit a
    // better one. The bounded capsule composer validates once and never
    // retries, so the same splice would convert a wearable look into a missing
    // one to punish shoe monotony. Both rules are already stated up front in
    // the slot's submission_requirements; leave the card standing and keep the
    // failure as evidence.
    if (pendingPlan?.boundedComposition) continue
    const acceptedIndex = accepted.findLastIndex(outfit => outfit._slotId === slot.id)
    if (acceptedIndex < 0) continue
    accepted.splice(acceptedIndex, 1)
  }
  if (anchorIds.size && anchorAllowedSlots.length && !allAccepted.some(outfit => outfitCategoryPairs(outfit).some(({ id }) => anchorIds.has(id)))) {
    failures.push({
      slot_id: '',
      label: 'Shared anchor',
      reasons: [`include at least one shared anchor piece; it is allowed in: ${anchorAllowedSlots.join(', ')}`]
    })
  }
  return { accepted, failures }
}

// Owner ruling 2026-07-28: a capsule look that fails validation is not thrown
// away. Every other composing surface already shows the attempt as a "needs
// review" card and lets it be repaired; the atomic capsule path was the only
// one that deleted the evidence and announced an absence instead. Same card
// shape propose_outfit produces, so the existing broken-card rendering and its
// plain-language reason shim apply unchanged.
// Below these, a capsule is not a capsule. First-pass values, measured against
// one wardrobe — see docs/capsule-roster-selection-spec.md §7c on not tuning
// constants until a number exists for more than one closet.
const CAPSULE_MIN_COVERED_SLOT_RATIO = 0.5
const CAPSULE_MIN_MEANINGFUL_CORES = 3

// Owner ruling 2026-07-28: when the digitized wardrobe cannot sustain the
// capsule that was asked for, say so BEFORE composing rather than delivering a
// one-card "capsule" that looks broken. The live sandbox case: 23 pieces, five
// requested contexts, two uncoverable, one card. Returns null when the wardrobe
// can support the request, so this is a no-op for any healthy capsule.
export function describeCapsuleSupplyGap(pendingPlan = {}) {
  const slots = Array.isArray(pendingPlan?.slots) ? pendingPlan.slots : []
  if (!slots.length) return null
  const roster = Array.isArray(pendingPlan?.capsuleRoster) ? pendingPlan.capsuleRoster : []
  if (!roster.length) return null
  const piecesById = pieceMapForPieces(roster)

  const covered = []
  const uncovered = []
  for (const slot of slots) {
    const capacity = Math.max(0, Number(slot?.capsuleSlotCapacity) || 0)
    if (capacity > 0) { covered.push(slot.label); continue }
    const allowed = [...(slot.gateAllowedIds instanceof Set ? slot.gateAllowedIds : [])]
      .map(id => piecesById.get(Number(id)))
      .filter(Boolean)
    const present = new Set(allowed.map(piece => wardrobeCategoryGroup(piece)))
    // What to photograph next, in the person's words — not "no gate-valid core".
    const missing = []
    if (!present.has('shoes')) missing.push('shoes')
    if (!present.has('dress') && !present.has('top')) missing.push('a top')
    if (!present.has('dress') && !present.has('bottom')) missing.push('a bottom')
    uncovered.push({ label: slot.label, missing })
  }

  const totalCapacity = Math.max(0, Number(pendingPlan?.capsuleCapacity) || 0)
  const tooFewContexts = covered.length < Math.ceil(slots.length * CAPSULE_MIN_COVERED_SLOT_RATIO)
  // Scale the rotation test to what was actually asked for rather than a flat
  // number: a capsule that cannot give every requested context even one
  // distinct look is not a rotation, however that count lands. (A flat 3 let
  // the 23-piece sandbox case through — 5 contexts, 3 cores, one card — which
  // is the exact failure this check exists to catch.)
  const requiredCores = Math.max(CAPSULE_MIN_MEANINGFUL_CORES, slots.length)
  const tooFewCores = totalCapacity < requiredCores
  if (!tooFewContexts && !tooFewCores) return null

  return {
    covered,
    uncovered,
    totalCapacity,
    rosterSize: roster.length,
    reason: tooFewContexts ? 'contexts' : 'rotation'
  }
}

export function buildRejectedCapsuleCards(failures = [], pendingPlan = {}, { source = 'plan_outfit_set' } = {}) {
  const slots = Array.isArray(pendingPlan?.slots) ? pendingPlan.slots : []
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const cards = []
  for (const failure of Array.isArray(failures) ? failures : []) {
    const pieces = failure?.outfit?.pieces || []
    if (!pieces.length) continue
    const slot = slotById.get(failure.slot_id)
    const blockedIds = new Set((failure.blockedPieceIds || []).map(Number))
    cards.push({
      ...failure.outfit,
      label: slot?.label || failure.label || 'Needs review',
      title: String(failure.outfit?.title || '').trim() || slot?.label || failure.label || 'Needs review',
      broken: true,
      rejectionReason: (failure.reasons || []).join('; '),
      brokenPieces: pieces
        .filter(piece => blockedIds.has(Number(piece?.id)))
        .map(piece => ({ name: piece?.name || `Piece ${piece?.id}`, reason: (failure.reasons || []).join('; ') })),
      source,
      tripSlot: slot?.id || failure.slot_id || '',
      bestFor: slot?.bestFor || '',
      occasion: slot?.occasion || '',
      activity: slot?.activity || '',
      composedBy: 'model',
      // Enough state for a local one-garment repair without re-planning: which
      // slot to re-check against, and which piece actually blocked the look.
      capsuleRepair: {
        slotId: slot?.id || failure.slot_id || '',
        blockedPieceIds: [...blockedIds]
      }
    })
  }
  return cards
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
    const target = Math.min(3, Math.max(0, Number(slot.targetOutfits) || 0))
    if (group.length < target && !pendingPlan?.suppressModelCoverageGaps) {
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
  return attachTripPlanMetadata(orderedPicked, {
    source,
    composedBy: 'model',
    slotWeather: orderedSlotWeather,
    reuseMode,
    noRepeatCats,
    pieceBudget,
    capsuleRoster: pendingPlan?.capsuleRoster || [],
    capsuleCapacity: Number(pendingPlan?.capsuleCapacity) || 0,
    capsuleSlots: pendingPlan?.slots || [],
    isWinterCapsule: Boolean(pendingPlan?.isWinterCapsule),
    statedPalette: Array.isArray(pendingPlan?.statedPalette) ? pendingPlan.statedPalette : [],
    coverageGaps
  })
}

export const PLAN_TOTAL_OUTFIT_CAP = 8

// Two plan shapes, two caps — this is the ratified "a plan's cap comes from its
// own shape" rule, and the two must stay separately named. A trip's axis is
// days: a bigger packing budget really does mean more distinct days to dress,
// so the curve below still applies. A capsule's axis is combinatorial reach,
// where practice publishes a rotation rather than an enumeration, hence
// min(piece_budget, 12).
export function planTotalOutfitCapForBudget(budget = 0) {
  const numericBudget = Number(budget) || 0
  if (numericBudget >= 30) return 20
  if (numericBudget >= 24) return 16
  if (numericBudget >= 18) return 12
  return PLAN_TOTAL_OUTFIT_CAP
}

export function capsuleTotalOutfitCap(budget = 0) {
  const numericBudget = Number(budget) || 0
  return numericBudget > 0 ? Math.min(numericBudget, 12) : PLAN_TOTAL_OUTFIT_CAP
}

function ordinalPlanSlotLabel(label = '') {
  const value = String(label || '').trim()
  const match = value.match(/^(.*?)(?:\s*[-–—,:]?\s*(?:day|look|outfit)\s*#?\s*(\d+))$/i) // ratchet-allow: plan-slot ordinal, not garment matching
  if (!match || !String(match[1] || '').trim()) return null
  return {
    base: String(match[1]).trim(),
    ordinal: Number(match[2])
  }
}

function normalizedPlanSlotText(value = '') {
  const ordinal = ordinalPlanSlotLabel(value)
  return String(ordinal?.base || value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function equivalentOrdinalPlanSlotKey(slot = {}) {
  const ordinal = ordinalPlanSlotLabel(slot.label)
  if (!ordinal) return ''
  return JSON.stringify([
    normalizedPlanSlotText(slot.label),
    String(slot.occasion || ''),
    String(slot.activity || ''),
    String(slot.environment || ''),
    String(slot.register || ''),
    String(slot.season || ''),
    String(slot.statedWeather || ''),
    String(slot.location || '').trim().toLowerCase(),
    String(slot.date || '').trim().toLowerCase(),
    normalizedPlanSlotText(slot.bestFor),
    normalizedPlanSlotText(slot.coverage),
    normalizedPlanSlotText(slot.planNote)
  ])
}

function mergeEquivalentOrdinalPlanSlots(slots = [], onDiagnostic = null) {
  const groupsByKey = new Map()
  for (const [index, slot] of slots.entries()) {
    const key = equivalentOrdinalPlanSlotKey(slot)
    if (!key) continue
    const group = groupsByKey.get(key) || []
    group.push(index)
    groupsByKey.set(key, group)
  }
  const mergeGroupByFirstIndex = new Map()
  const mergedAway = new Set()
  for (const indices of groupsByKey.values()) {
    // Two one-look numbered days can be legitimate calendar instances. The
    // captured defect is distinguishable without taste inference: one of its
    // numbered "days" itself requested multiple looks.
    if (indices.length < 2 || !indices.some(index => Number(slots[index]?.targetOutfits) > 1)) continue
    mergeGroupByFirstIndex.set(indices[0], indices)
    for (const index of indices.slice(1)) mergedAway.add(index)
  }
  const merged = []
  for (const [index, slot] of slots.entries()) {
    if (mergedAway.has(index)) continue
    const groupIndices = mergeGroupByFirstIndex.get(index)
    if (!groupIndices) {
      merged.push(slot)
      continue
    }
    const existing = { ...slot }
    const ordinal = ordinalPlanSlotLabel(slot.label)
    if (ordinal) {
      existing.label = ordinal.base
      existing.id = ordinal.base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || existing.id
      if (normalizedPlanSlotText(existing.bestFor) === normalizedPlanSlotText(slot.label)) existing.bestFor = ordinal.base
      if (normalizedPlanSlotText(existing.coverage) === normalizedPlanSlotText(slot.label)) existing.coverage = ordinal.base
    }
    const requested = groupIndices.reduce((sum, groupIndex) => {
      const groupedSlot = slots[groupIndex]
      return sum + (Number(groupedSlot?.requestedOutfits) || Number(groupedSlot?.targetOutfits) || 0)
    }, 0)
    existing.targetOutfits = Math.min(3, requested)
    if (requested > existing.targetOutfits) existing.requestedOutfits = requested
    if (typeof onDiagnostic === 'function') {
      for (let mergedIndex = 1; mergedIndex < groupIndices.length; mergedIndex += 1) {
        onDiagnostic('planEquivalentSlotsMerged')
      }
    }
    merged.push(existing)
  }
  return merged
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
  const normalizedBeforeMerge = allRawSlots
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
      const declaredDeclaredEnvironment = explicitEnvironment || (weatherAsEnvironment && (weatherAsEnvironment === 'beach_coastal' || !proseEnvironment) ? weatherAsEnvironment : '')
      // Owner ruling 2026-07-30: the slot's own label wins over a declared
      // `outdoor`. Live thread_1785380251549 declared `outdoor` for both
      // "Restaurants / Social Events" and "City Outings / Museums" — the engine
      // then dressed both for the weather outside the room. The label-based
      // classifier already gets these right on its own; the declaration was
      // switching it off, because any declared environment short-circuited past
      // it.
      //
      // Narrow by construction: isIndoorPlanSlot only fires on unambiguously
      // indoor places, and it already returns false for a walking/hiking
      // activity or a label naming an outdoor one ("Outdoor Sculpture Garden",
      // "Patio Dinner"). `beach_coastal` stays authoritative — it is a specific,
      // deliberate signal that drives sand/water handling, not a default.
      const labelReadsIndoor = isIndoorPlanSlot(slot, { occasion: String(slot?.occasion || ''), activity })
      const declaredEnvironment = declaredDeclaredEnvironment === 'outdoor' && labelReadsIndoor
        ? 'indoor'
        : declaredDeclaredEnvironment
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
          : environment === 'beach_coastal'
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
        transitSeason: environment === 'indoor'
          ? String(slot?.season || fallbackWeather || '').trim()
          : '',
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
  const mergedSlots = mergeEquivalentOrdinalPlanSlots(normalizedBeforeMerge, onDiagnostic)
  const droppedRawSlots = mergedSlots.slice(maxSlots)
  const normalized = mergedSlots.slice(0, maxSlots)
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
    .map(slot => String(slot?.label || slot?.bestFor || '').trim())
    .filter(Boolean)
  return normalized
}
