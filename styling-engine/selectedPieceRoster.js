// SELECTED-PIECE ROSTER, CHOSEN BY THE STYLIST (docs/selected-piece-model-roster-spec.md).
//
// The first card turn on a garment used to show the composer a roster code chose: a word-matching
// compatibility score cut to fixed per-category quotas (12 tops for a bottom anchor). On the black
// wide-leg knit trousers that kept a sleeveless crop top and graphic tees and ranked the sweaters the
// owner's better cards used at 60th and 61st of 103 (thread_1792822990468). Owner ruling 2026-10-24:
// the model can't style garments it does not know about.
//
// Now the stylist reads the complete eligible catalog (sparse fact lines, identity order, no score)
// and picks the garments worth seeing; the composer then works from those photos as before. Code
// here is mechanical only: which garments are eligible and structurally able to share an outfit
// with the anchor, and whether a pick names real catalog IDs and still makes a complete outfit.
// No styling judgment lives in this file.
import { wardrobeCategoryGroup } from './attributes.js'
import { sparseGarmentCatalogRow, SPARSE_CATALOG_CONVENTIONS } from './garmentEvidenceLine.js'
import { buildCoveredCandidateSet, completeOutfitSupplyRequirement } from './candidateSet.js'
import { EXPLORE_INSTRUCTION, EXPLORE_LAYER_BASE_SCOPE } from './prompts.js'

export const SELECTED_PIECE_ROSTER_MAX = 40
export const SELECTED_PIECE_ROSTER_SUBFLOW = 'selected_piece_roster_selection'

export function selectedPieceModelRosterEnabled(env = process.env) {
  return !['off', 'false', '0'].includes(String(env.WARDROBE_SELECTED_PIECE_MODEL_ROSTER ?? '').trim().toLowerCase())
}

// One outfit holds one bottom or one dress, and one pair of shoes (the composer's slot vocabulary),
// so those are the only garments that can never share a card with the anchor. Tops and outerwear
// stay for a top or outerwear anchor: either can be a middle layer.
const STRUCTURALLY_EXCLUDED_GROUPS = {
  bottom: new Set(['bottom', 'dress']),
  dress: new Set(['dress', 'bottom']),
  shoes: new Set(['shoes']),
}

const CATALOG_GROUP_ORDER = ['top', 'bottom', 'dress', 'outerwear', 'shoes']

/**
 * The complete catalog the stylist chooses from.
 * `eligiblePieces` must already be the photo roster's own gate result for this request, uncapped
 * (evaluateVisualComposerPiecePool with capacity = the whole pool); `isAutoUseAllowed` is the
 * automatic-use pool's verdict. Accessories are left out because the composer never shows them.
 */
export function buildSelectedPieceRosterCatalog({ anchorPiece, eligiblePieces = [], isAutoUseAllowed = () => true } = {}) {
  const anchorId = Number(anchorPiece?.id)
  const excludedGroups = STRUCTURALLY_EXCLUDED_GROUPS[wardrobeCategoryGroup(anchorPiece)] || new Set()
  const pieces = (eligiblePieces || []).filter(piece => {
    const group = wardrobeCategoryGroup(piece)
    return Number(piece?.id) !== anchorId
      && CATALOG_GROUP_ORDER.includes(group)
      && !excludedGroups.has(group)
      && isAutoUseAllowed(piece)
  })
  const grouped = CATALOG_GROUP_ORDER.map(group => ({
    group,
    pieces: pieces.filter(piece => wardrobeCategoryGroup(piece) === group).sort((a, b) => Number(a.id) - Number(b.id)),
  })).filter(entry => entry.pieces.length)
  return {
    pieces: grouped.flatMap(entry => entry.pieces),
    counts: Object.fromEntries(grouped.map(entry => [entry.group, entry.pieces.length])),
    text: grouped.map(entry => `=== ${entry.group.toUpperCase()} (${entry.pieces.length}) ===\n${entry.pieces.map(sparseGarmentCatalogRow).join('\n')}`).join('\n\n'),
  }
}

export function selectedPieceRosterSchema(max = SELECTED_PIECE_ROSTER_MAX) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      selection_note: { type: 'string' },
      roster_piece_ids: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: max },
    },
    required: ['selection_note', 'roster_piece_ids'],
  }
}

// The catalog-format sentences only; the trailing view_pieces sentence describes a tool this call
// does not have.
const CATALOG_CONVENTIONS = SPARSE_CATALOG_CONVENTIONS.split(' view_pieces truth')[0]

// Explore (docs/selected-piece-explore-mode-spec.md §2.2): the roster step is told how many outfits will
// be built and what they are for, so the shortlist is not drawn for the expected outfits only. With
// `explore` off the prompt is exactly the default one.
// A layer anchor (owner ruling 2026-10-25: a layer garment always needs a top or a dress under it).
// thread_1792915678690: the shortlist chose four cream tops as visible partners for a knit layer,
// by idea, with no fit rule; the composer's wearability-first check (#337) then had only one base
// that worked under it and five cards to fill. The shortlist now judges that pair fit first too.
// In Explore it comes after the Explore block, so "not for the expected ones" does not override it,
// and it carries the Explore base scope.
export const ROSTER_LAYER_ANCHOR_BLOCK = 'The anchor is worn over a top or a dress, so every outfit needs one under it, and your shortlist must bring real alternatives for it. Wearability comes first for that pair: from the anchor\'s photograph and recorded construction and each candidate\'s recorded construction, ask whether the candidate can sit inside the anchor at the sleeves, the armholes and the body, and how it will look where the anchor leaves it showing. Shortlist only candidates that pass; colour, texture and the outfit\'s idea are judged after that.'

export function selectedPieceRosterSystemPrompt(max = SELECTED_PIECE_ROSTER_MAX, { explore = false, outfitCount = null, layerAnchor = false } = {}) {
  const layerBlock = layerAnchor ? `\n\n${ROSTER_LAYER_ANCHOR_BLOCK}${explore ? ` ${EXPLORE_LAYER_BASE_SCOPE}` : ''}` : ''
  const exploreBlock = explore
    ? `\n\nYou are choosing for ${outfitCount || 'several'} outfits, each taking its own direction. ${EXPLORE_INSTRUCTION} Shortlist for those outfits, not for the expected ones.`
    : ''
  return `You are a personal stylist choosing which garments from a client's own wardrobe you want to look at before styling one garment of theirs, the anchor. You see a photograph of the anchor and a catalog of every garment in the wardrobe that is eligible for this request and can share an outfit with it. In the next step you will compose outfits around the anchor, looking at photographs of exactly the garments you choose here and of nothing else, so a garment you leave out cannot be used.

This is a shortlist to compare, not your final choice: you will decide between garments on their photographs in the next step. Think about the different ways the anchor can be worn and what each would need. For every part those outfits need — what goes with the anchor on the body, any layer, the shoes — bring several real alternatives, so that each part of each outfit is chosen between options you can see rather than settled now from text. A garment whose facts leave you unsure is worth seeing, because its photograph will decide. A list of only the pieces you already expect to use leaves nothing to compare. You may choose up to ${max}. The catalog is in identity order, not ranked; judge each garment from its recorded facts against the anchor and this request.

${CATALOG_CONVENTIONS}

Answer with \`selection_note\` first: one or two sentences on the directions you are choosing for. Then \`roster_piece_ids\`: the IDs you chose, written as numbers, only from the catalog.${exploreBlock}${layerBlock}`
}

export function selectedPieceRosterUserText({ anchorPiece, anchorTruth = '', requestLines = [], catalog }) {
  return [
    `Anchor: ID ${anchorPiece.id} ${anchorPiece.name}`,
    anchorTruth ? `Anchor garment truth:\n${anchorTruth}` : '',
    '',
    ...requestLines.filter(Boolean),
    '',
    `CATALOG — ${catalog.pieces.length} eligible garments:`,
    catalog.text,
  ].filter(line => line !== null && line !== undefined).join('\n')
}

/**
 * Mechanical checks on the stylist's pick. Never adds a styling choice of its own: a pick that
 * cannot make a complete outfit is completed by the shared supply contract from `coverageRanking`
 * (the code ranking, kept only for this and the fallback), and every addition is reported.
 */
export function validateSelectedPieceRosterPick({ anchorPiece, catalog, pickedIds = [], coverageRanking = [], max = SELECTED_PIECE_ROSTER_MAX }) {
  const byId = new Map(catalog.pieces.map(piece => [Number(piece.id), piece]))
  const anchorId = Number(anchorPiece?.id)
  const seen = new Set()
  const unknownIds = []
  const kept = []
  for (const raw of Array.isArray(pickedIds) ? pickedIds : []) {
    const id = Number(raw)
    if (!Number.isInteger(id) || id === anchorId || seen.has(id)) continue
    seen.add(id)
    if (!byId.has(id)) { unknownIds.push(id); continue }
    kept.push(byId.get(id))
  }
  const trimmedIds = kept.slice(max).map(piece => Number(piece.id))
  const pick = kept.slice(0, max)
  if (!pick.length) return { pieces: [], unknownIds, trimmedIds, addedForCoverageIds: [], coverageReport: null, usable: false }

  const catalogIds = new Set(byId.keys())
  const covered = buildCoveredCandidateSet({
    rankedPieces: (coverageRanking || []).filter(piece => catalogIds.has(Number(piece?.id))),
    initialSelection: pick,
    capacity: max,
    requirements: [completeOutfitSupplyRequirement({ anchorPiece, id: 'selected_anchor_outfit_path' })],
  })
  // The builder fills spare capacity from its ranking once it adds anything; keep only her pick and
  // the pieces the supply contract actually required.
  const addedForCoverageIds = covered.report?.addedForCoverageIds || []
  const keepIds = new Set([...pick.map(piece => Number(piece.id)), ...addedForCoverageIds])
  const pieces = covered.pieces.filter(piece => keepIds.has(Number(piece.id)))
  return {
    pieces,
    unknownIds,
    trimmedIds,
    addedForCoverageIds,
    removedForCoverageIds: covered.report?.removedByCoverageIds || [],
    coverageReport: covered.report,
    usable: covered.report?.complete !== false,
  }
}

export function countByGroup(pieces = []) {
  return pieces.reduce((counts, piece) => {
    const group = wardrobeCategoryGroup(piece) || 'other'
    counts[group] = (counts[group] || 0) + 1
    return counts
  }, {})
}
