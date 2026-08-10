export const OVERALL_VERDICT_LABELS = [
  ['signature', 'This feels exactly like me'],
  ['works', 'Looks good'],
  ['almost', 'Almost right'],
  ['not_me', 'Not for me'],
]

export const STYLE_DIRECTION_REASONS = [
  ['too_safe', 'Too plain'],
  ['too_polished', 'Too polished or dressed-up'],
  ['too_soft', 'Feels too delicate'],
  ['too_generic', 'Does not feel personal'],
  ['too_formal', 'Too formal'],
  ['too_casual', 'Too casual'],
  ['too_severe', 'Feels too harsh'],
  ['too_youthful', 'Feels too young'],
  ['too_sporty', 'Too sporty'],
  ['too_subdued', 'Feels too quiet or dull'],
  ['costume_like', 'Feels like a costume'],
  ['catalog_like', 'Looks generic or store-styled'],
  ['weak_structure', 'Not enough structure'],
  ['weak_contrast', 'Not enough contrast'],
  ['bad_grounding', 'Shoes do not ground the look'],
]

export const SHAPE_BALANCE_REASONS = [
  ['too_much_volume', 'Looks too bulky'],
  ['shape_lost', 'My shape disappears'],
  ['unbalanced_proportions', 'Top and bottom do not work together'],
  ['layer_too_long', 'Top or jacket looks too long'],
  ['competing_hemlines', 'The layer lengths look awkward'],
  ['too_columnar', 'Looks too straight up and down'],
  ['too_fitted', 'Looks too tight'],
]

export const IMAGE_FIDELITY_FEEDBACK_LABELS = [
  ['wrong_length', 'A garment is the wrong length'],
  ['wrong_garment_details', 'Garment details look wrong'],
  ['body_proportions_drift', 'My body proportions look wrong'],
  ['identity_drift', 'This does not look like me'],
]

export const WRONG_LENGTH_REASONS = [
  ['sleeves_too_long', 'Sleeves too long'],
  ['sleeves_too_short', 'Sleeves too short'],
  ['upper_hem_too_long', 'Top or jacket hem too long'],
  ['upper_hem_too_short', 'Top or jacket hem too short'],
  ['lower_hem_too_long', 'Pants, skirt, or dress too long'],
  ['lower_hem_too_short', 'Pants, skirt, or dress too short'],
]

const SLEEVE_ISSUES = new Set(['sleeves_too_long', 'sleeves_too_short'])
const UPPER_HEM_ISSUES = new Set(['upper_hem_too_long', 'upper_hem_too_short'])
const LOWER_LENGTH_ISSUES = new Set(['lower_hem_too_long', 'lower_hem_too_short'])

// Shoes and accessories have no sleeve or hem to get wrong. Tops/outerwear get sleeves + their
// own (jacket/top) hem. Bottoms get only the pants/skirt/dress hem. A dress gets sleeves + the
// pants/skirt/dress hem too, but not "top or jacket hem" — a dress isn't a jacket.
export function wrongLengthReasonsForCategory(category) {
  if (category === 'top' || category === 'outerwear') {
    return WRONG_LENGTH_REASONS.filter(([issue]) => SLEEVE_ISSUES.has(issue) || UPPER_HEM_ISSUES.has(issue))
  }
  if (category === 'bottom') {
    return WRONG_LENGTH_REASONS.filter(([issue]) => LOWER_LENGTH_ISSUES.has(issue))
  }
  if (category === 'dress') {
    return WRONG_LENGTH_REASONS.filter(([issue]) => SLEEVE_ISSUES.has(issue) || LOWER_LENGTH_ISSUES.has(issue))
  }
  if (category === 'shoes' || category === 'accessory') {
    return []
  }
  // Unknown/missing category (older boards, uncategorized pieces) — show everything rather
  // than silently hiding a real correction.
  return WRONG_LENGTH_REASONS
}

export const FEEDBACK_REASON_LABELS = Object.fromEntries([
  ...STYLE_DIRECTION_REASONS,
  ...SHAPE_BALANCE_REASONS,
])

export const SAVED_BOARD_FEEDBACK_DISPLAY_LABELS = [
  ...OVERALL_VERDICT_LABELS,
  ...STYLE_DIRECTION_REASONS,
  ...SHAPE_BALANCE_REASONS,
  ['wrong_energy', 'The overall feel is wrong'],
  ['style_direction', 'Style direction'],
  ['shape_balance', 'Shape and balance'],
  ...IMAGE_FIDELITY_FEEDBACK_LABELS,
  ['bad_reference', 'Bad reference'],
]

// One reaction gets one primary behavioural reader. Display, audit history and
// corrective follow-up tasks may still show the same receipt, but must not give
// it a second source of styling authority.
export const FEEDBACK_BEHAVIOURS = Object.freeze({
  OWNER_PROMPT: 'owner_prompt',
  STYLING_PROMPT: 'styling_prompt',
  CONTEXT_SCORE: 'context_score',
  RENDERER: 'renderer',
  RETIRED: 'retired',
  DISPLAY_ONLY: 'display_only',
})

export const POSITIVE_OUTFIT_LOGIC_TYPES = new Set(['signature', 'works', 'almost'])

// Historical UI names retained only as read aliases. New surfaces write the
// canonical names, so old renderer feedback cannot leak into styling memory.
export function canonicalFeedbackType(type) {
  if (type === 'catalog_drift') return 'catalog_like'
  if (type === 'wrong_proportions' || type === 'proportion_problem') return 'body_proportions_drift'
  return type
}

export function buildOutfitLogicEvidence(feedbackType, payload = {}) {
  if (!POSITIVE_OUTFIT_LOGIC_TYPES.has(feedbackType)) return null
  const outfit = payload?.outfit || {}
  const logic = {
    formula: String(payload?.formulaFamily || outfit?.formulaFamily || payload?.archetypeId || outfit?.archetypeId || '').trim(),
    silhouette: String(payload?.silhouette || outfit?.silhouette || '').trim(),
    direction: String(payload?.dominantDirection || outfit?.dominantDirection || '').trim(),
    mood: String(payload?.mood || outfit?.mood || '').trim(),
  }
  if (!Object.values(logic).some(Boolean)) return null
  return {
    version: 1,
    kind: 'outfit_logic',
    verdict: feedbackType,
    logic,
    context: {
      occasion: String(payload?.occasion || outfit?.occasion || outfit?.bestFor || '').trim(),
      activity: String(payload?.activity || outfit?.activity || 'none').trim(),
      season: String(payload?.season || outfit?.season || '').trim(),
    },
  }
}

const RENDERER_FEEDBACK_TYPES = new Set([
  ...IMAGE_FIDELITY_FEEDBACK_LABELS.map(([value]) => value),
  'bad_reference',
])

const STYLING_PROMPT_FEEDBACK_TYPES = new Set([
  ...OVERALL_VERDICT_LABELS.map(([value]) => value),
  ...STYLE_DIRECTION_REASONS.map(([value]) => value),
  ...SHAPE_BALANCE_REASONS.map(([value]) => value),
  'style_direction',
  'shape_balance',
  'good_formula',
  'good_pieces',
  'bad_occasion',
  'fit_issue',
  'too_boho',
  'wrong_silhouette',
  'wrong_energy',
  'strong_direction',
  'close_but_off',
  'preference_reaction',
  'wrong_item_read',
])

export function feedbackBehaviour(row = {}) {
  if (row.target_type === 'renderer_calibration') return FEEDBACK_BEHAVIOURS.RETIRED
  const feedbackType = canonicalFeedbackType(row.feedback_type)
  if (row.feedback_type === 'owner_rule' ||
      (row.feedback_type === 'preference_reaction' && row.target_type === 'message')) {
    return FEEDBACK_BEHAVIOURS.OWNER_PROMPT
  }
  if (RENDERER_FEEDBACK_TYPES.has(feedbackType)) return FEEDBACK_BEHAVIOURS.RENDERER
  if (row.feedback_type === 'wrong_item_read') {
    let payload = row.payload
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload) } catch { payload = {} }
    }
    const evidence = payload?.scopedEvidence
    if (Number(evidence?.version) === 1 &&
        evidence?.kind === 'garment_context_suitability' &&
        Number.isInteger(Number(evidence?.subjectPieceId)) &&
        Number(evidence.subjectPieceId) > 0) {
      return FEEDBACK_BEHAVIOURS.CONTEXT_SCORE
    }
  }
  if (STYLING_PROMPT_FEEDBACK_TYPES.has(feedbackType)) return FEEDBACK_BEHAVIOURS.STYLING_PROMPT
  return FEEDBACK_BEHAVIOURS.DISPLAY_ONLY
}
