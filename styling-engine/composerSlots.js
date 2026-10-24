// ATOMIC STRUCTURED COMPOSER OUTPUT (owner ruling 2026-09-13).
//
// thread_1789346300319's fifth card carried two bottoms and no top under prose describing a garment
// that was not on it. The captured prompt already prohibited two bottoms, so more prose was not the
// fix: the contract itself let a free `pieces[]` array hold any shape, with a name beside each ID
// that could disagree with it and a role the model could leave out for code to guess.
//
// The visual composers now answer in six ID slots, one garment per job. Identity is the ID alone —
// names are resolved from the wardrobe, so an ID and a name cannot disagree. Two bottoms cannot be
// expressed. The schema is deliberately the simplest shape every provider accepts (nullable integers,
// no per-slot enums, no anyOf): everything the schema does not make unrepresentable is checked here,
// and every check still runs when a provider enforces the schema.
//
// Nothing is filled in. A slot left null is a finding; a card with findings is preserved as a
// diagnostic card exactly as the model answered it.
import { wardrobeCategoryGroup } from './attributes.js'
import { ROLE_CATEGORY_EXPECTATIONS } from './outfitValidation.js'

// Category truth per slot comes from the role table, not a second copy of it: `middle_layer_id`
// admits whatever `layer_top` admits (a top or an outerwear garment).
export const COMPOSER_SLOTS = Object.freeze([
  { key: 'base_top_id', groups: ROLE_CATEGORY_EXPECTATIONS.primary_top },
  { key: 'bottom_id', groups: ROLE_CATEGORY_EXPECTATIONS.primary_bottom },
  { key: 'dress_id', groups: ROLE_CATEGORY_EXPECTATIONS.dress },
  { key: 'middle_layer_id', groups: ROLE_CATEGORY_EXPECTATIONS.layer_top },
  { key: 'outer_layer_id', groups: ROLE_CATEGORY_EXPECTATIONS.outerwear },
  { key: 'shoes_id', groups: ROLE_CATEGORY_EXPECTATIONS.shoes },
])

const nullableId = { type: ['integer', 'null'] }
const nullableName = { type: ['string', 'null'] }

// SLOT NAMES (docs/composer-slot-name-check-spec.md, owner 2026-10-24). Each slot's garment name is
// written immediately before its ID. Identity is still the ID alone; the name is the model's stated
// intent, so a wrong ID becomes detectable instead of silent (thread_1792867254713: every word of a
// card described the gradient cashmere sweater 996870 while middle_layer_id held 996890, the striped
// one next to it in the roster). A name never selects, replaces or rescues a garment.
export const slotNameKey = slotKey => slotKey.replace(/_id$/, '_name')

// The requested card count is part of the contract: `minItems`/`maxItems` are enforced by the provider
// where it enforces the schema (OpenAI strict json_schema, Gemini response_format), guidance only for
// an Anthropic forced tool call — so `composerOutfitCountCheck` checks it locally on every provider.
// `wearThroughDay` exists only for the day-wear explanation experiment (docs/day-wear-explanation-experiment-2026-09-15.md);
// production never passes it, so the production schema is unchanged.
export function composerOutfitSlotsSchema({ minOutfits = 1, maxOutfits = minOutfits, wearThroughDay = false, stylistNote = false } = {}) {
  const min = Math.max(1, Number(minOutfits) || 1)
  const max = Math.max(min, Number(maxOutfits) || min)
  return {
  type: 'object',
  additionalProperties: false,
  properties: {
    outfits: {
      type: 'array',
      minItems: min,
      maxItems: max,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // First, so the physical check is written before the card's idea (layerWearabilityFirstPromptRule).
          layering_check: { type: 'string' },
          label: { type: 'string' },
          strength: { type: 'string', enum: ['signature', 'strong', 'usable', 'experimental'] },
          dominantDirection: { type: 'string' },
          silhouette: { type: 'string' },
          bestFor: { type: 'string' },
          ...Object.fromEntries(COMPOSER_SLOTS.flatMap(slot => [[slotNameKey(slot.key), nullableName], [slot.key, nullableId]])),
          reason: { type: 'string' },
          styling_instructions: { type: 'string' },
          watchFor: { type: 'string' },
          ...(wearThroughDay ? { wear_through_day: { type: 'string' } } : {}),
        },
        required: ['layering_check', 'label', 'strength', 'dominantDirection', 'silhouette', 'bestFor', ...COMPOSER_SLOTS.flatMap(slot => [slotNameKey(slot.key), slot.key]), 'reason', 'styling_instructions', 'watchFor', ...(wearThroughDay ? ['wear_through_day'] : [])],
      },
    },
    skip: { type: 'string' },
    saveableLearning: { type: 'string' },
    // The stylist's own words about the set, shown as the chat reply above the cards (/ask's
    // "a few options" turn; owner 2026-10-06). Absent from every other composer call.
    ...(stylistNote ? { stylist_note: { type: 'string' } } : {}),
  },
  required: ['outfits', 'skip', 'saveableLearning', ...(stylistNote ? ['stylist_note'] : [])],
}
}

// Word-set comparison: every word of the stated name must be in the recorded name, so a shortened
// name passes ("gradient cashmere sweater") and another garment's name fails. Not garment matching:
// it only asks whether the model's own words and its own ID name the same garment.
const nameWords = value => new Set(String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
export function statedNameFitsGarment(statedName, piece) {
  const stated = nameWords(statedName)
  if (!stated.size) return true
  const recorded = nameWords(piece?.name)
  return [...stated].every(word => recorded.has(word))
}

function slotFinding(code, message, evidence = {}) {
  return { code, message, severity: 'hard', evidence }
}

// The role each slot states. A top beside a dress is the dress's under-layer, which the role
// vocabulary spells `layer_top`; which garment sits outside is still decided by garment evidence in
// the layer-direction evaluator, exactly as before.
function slotRole(key, { hasDress }) {
  if (key === 'base_top_id') return hasDress ? 'layer_top' : 'primary_top'
  return {
    bottom_id: 'primary_bottom',
    dress_id: 'dress',
    middle_layer_id: 'layer_top',
    outer_layer_id: 'outerwear',
    shoes_id: 'shoes',
  }[key]
}

// Resolves one composer card. Never derives a missing role, never inserts a piece, never moves a
// garment to the slot it "should" have been in. `requiredPieceId` is the selected-piece anchor.
export function resolveComposerSlotOutfit(outfit = {}, candidatePieces = [], { requiredPieceId = null } = {}) {
  const byId = new Map((Array.isArray(candidatePieces) ? candidatePieces : []).map(piece => [Number(piece.id), piece]))
  const modelSlots = {}
  const slotFindings = []
  const pieces = []
  const slotById = new Map()
  const named = key => modelSlots[key] !== null
  for (const { key } of COMPOSER_SLOTS) {
    const raw = outfit?.[key]
    modelSlots[key] = raw === undefined ? null : raw
  }
  const hasDress = named('dress_id')

  for (const { key, groups } of COMPOSER_SLOTS) {
    const raw = modelSlots[key]
    if (raw === null) continue
    const id = Number(raw)
    if (typeof raw === 'boolean' || !Number.isInteger(id) || id <= 0) {
      slotFindings.push(slotFinding('invalid_slot_value', `${key} is not a garment ID`, { slot: key, value: raw }))
      continue
    }
    const piece = byId.get(id)
    if (!piece) {
      slotFindings.push(slotFinding('unknown_piece_id', `${key} names ID ${id}, which is not in the shown roster`, { slot: key, pieceId: id }))
      continue
    }
    if (slotById.has(id)) {
      slotFindings.push(slotFinding('duplicate_slot_piece', `ID ${id} fills both ${slotById.get(id)} and ${key}`, { slot: key, pieceId: id, firstSlot: slotById.get(id) }))
      continue
    }
    slotById.set(id, key)
    const statedName = outfit?.[slotNameKey(key)]
    if (typeof statedName === 'string' && statedName.trim() && !statedNameFitsGarment(statedName, piece)) {
      const fitting = [...byId.values()].filter(other => Number(other.id) !== id && statedNameFitsGarment(statedName, other))
      slotFindings.push(slotFinding('slot_name_mismatch', `${key} is named "${statedName.trim()}" but ID ${id} is ${piece.name || `piece ${id}`}`, {
        slot: key, pieceId: id, statedName: statedName.trim(), recordedName: piece.name || '',
        statedNameFitsPieceId: fitting.length === 1 ? Number(fitting[0].id) : null,
      }))
    }
    const categoryGroup = wardrobeCategoryGroup(piece)
    const fits = groups.includes(categoryGroup)
    if (!fits) {
      slotFindings.push(slotFinding('slot_category_mismatch', `${piece.name || `piece ${id}`} is ${categoryGroup || 'uncategorized'} and cannot fill ${key}`, { slot: key, pieceId: id, categoryGroup: categoryGroup || null, allowed: [...groups] }))
    }
    // A mismatched garment stays on the card as evidence of what the model chose, with no role.
    pieces.push({ ...piece, role: fits ? slotRole(key, { hasDress }) : null })
  }

  // The anchor first: on a selected-piece card it is the premise, so it leads the findings.
  if (requiredPieceId != null && !slotById.has(Number(requiredPieceId))) {
    slotFindings.unshift(slotFinding('missing_selected_anchor', `the selected piece (ID ${Number(requiredPieceId)}) is in no slot`, { pieceId: Number(requiredPieceId) }))
  }
  // Permitted combinations: base_top + bottom; or dress, optionally with a base_top under it.
  // Middle and outer layers are optional over either. Shoes are required. The codes match the
  // category evaluator's so one finding is not reported twice under two names.
  if (!named('shoes_id')) slotFindings.push(slotFinding('missing_shoes', 'shoes_id is empty', { slot: 'shoes_id' }))
  if (hasDress && named('bottom_id')) slotFindings.push(slotFinding('dress_with_bottom', 'dress_id and bottom_id are both filled', {}))
  if (!hasDress && !named('base_top_id')) slotFindings.push(slotFinding('missing_top_or_dress', 'neither base_top_id nor dress_id is filled', {}))
  if (!hasDress && !named('bottom_id')) slotFindings.push(slotFinding('missing_bottom', 'bottom_id is empty and there is no dress', { slot: 'bottom_id' }))

  return { pieceIds: pieces.map(piece => Number(piece.id)), pieces, modelSlots, slotFindings }
}

// Slot findings join the shared evaluator's hard findings; an evaluator finding with a code the
// slots already reported is the same fact seen twice and is dropped.
export function withSlotFindings(validation = {}, slotFindings = []) {
  if (!slotFindings.length) return validation
  const slotCodes = new Set(slotFindings.map(finding => finding.code))
  const hardFindings = [
    ...slotFindings,
    ...(validation.hardFindings || []).filter(finding => !slotCodes.has(finding.code)),
  ]
  return { ...validation, valid: false, hardValid: false, hardFindings, primaryFinding: hardFindings[0] }
}

// Local half of the count contract. A mismatch is reported, never repaired here: a short answer is
// already handled by the flow's existing shortfall path, and extra cards are cut by its own limit.
export function composerOutfitCountCheck(parsed, { minOutfits = 1, maxOutfits = minOutfits } = {}) {
  const returned = Array.isArray(parsed?.outfits) ? parsed.outfits.length : 0
  return { minOutfits, maxOutfits, returned, withinRequest: returned >= minOutfits && returned <= maxOutfits }
}

// The correction call's note (docs/composer-slot-name-check-spec.md §2.3): one line per mismatch, in
// the model's own terms. The answer comes back in the same schema; nothing here picks a garment.
export function composerNameMismatchCorrection(parsed, mismatchesByIndex) {
  const lines = []
  for (const [index, findings] of mismatchesByIndex) {
    const label = parsed?.outfits?.[index]?.label || `outfit ${index + 1}`
    for (const finding of findings) {
      lines.push(`- "${label}": you wrote "${finding.evidence.statedName}" for ${finding.evidence.slot}, but ID ${finding.evidence.pieceId} is "${finding.evidence.recordedName}".`)
    }
  }
  return `YOUR PREVIOUS ANSWER:\n${JSON.stringify(parsed)}\n\nCORRECTION NEEDED — in these slots the garment you named is not the garment whose ID you wrote:\n${lines.join('\n')}\nReturn the same outfits again. In each slot, write the ID of the garment you actually mean, from the labels shown. If the garment you described is not among those shown, rebuild that outfit from shown garments. Keep every outfit you did not need to change exactly as it was.`
}

// Which cards of a composer answer carry a name mismatch, resolved against the shown roster.
export function composerNameMismatches(parsed, candidatePieces = []) {
  const byIndex = new Map()
  ;(Array.isArray(parsed?.outfits) ? parsed.outfits : []).forEach((outfit, index) => {
    const findings = resolveComposerSlotOutfit(outfit, candidatePieces).slotFindings.filter(finding => finding.code === 'slot_name_mismatch')
    if (findings.length) byIndex.set(index, findings)
  })
  return byIndex
}
