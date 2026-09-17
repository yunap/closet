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

// The requested card count is part of the contract: `minItems`/`maxItems` are enforced by the provider
// where it enforces the schema (OpenAI strict json_schema, Gemini response_format), guidance only for
// an Anthropic forced tool call — so `composerOutfitCountCheck` checks it locally on every provider.
// `wearThroughDay` exists only for the day-wear explanation experiment (docs/day-wear-explanation-experiment-2026-09-15.md);
// production never passes it, so the production schema is unchanged.
export function composerOutfitSlotsSchema({ minOutfits = 1, maxOutfits = minOutfits, wearThroughDay = false } = {}) {
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
          label: { type: 'string' },
          strength: { type: 'string', enum: ['signature', 'strong', 'usable', 'experimental'] },
          dominantDirection: { type: 'string' },
          silhouette: { type: 'string' },
          bestFor: { type: 'string' },
          ...Object.fromEntries(COMPOSER_SLOTS.map(slot => [slot.key, nullableId])),
          reason: { type: 'string' },
          styling_instructions: { type: 'string' },
          watchFor: { type: 'string' },
          ...(wearThroughDay ? { wear_through_day: { type: 'string' } } : {}),
        },
        required: ['label', 'strength', 'dominantDirection', 'silhouette', 'bestFor', ...COMPOSER_SLOTS.map(slot => slot.key), 'reason', 'styling_instructions', 'watchFor', ...(wearThroughDay ? ['wear_through_day'] : [])],
      },
    },
    skip: { type: 'string' },
    saveableLearning: { type: 'string' },
  },
  required: ['outfits', 'skip', 'saveableLearning'],
}
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
