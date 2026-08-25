import {
  pieceDressSupportsUnderlayer,
  pieceHasExplicitBaseLayerEvidence,
  pieceHasExplicitTopLayerEvidence,
  pieceRequiresBaseLayer,
  wardrobeCategoryGroup,
} from './attributes.js'

export const OUTFIT_ROLES = ['primary_top', 'layer_top', 'primary_bottom', 'layer_bottom', 'dress', 'shoes', 'outerwear', 'accessory']

const BASE_LAYER_CLOSE_FITS = new Set(['clings_stretchy', 'clings_drapey', 'skims'])
const BASE_LAYER_INCOMPATIBLE_FITS = new Set(['hangs_straight', 'drapes', 'structured', 'none'])
const BASE_LAYER_INCOMPATIBLE_OPACITIES = new Set(['sheer', 'semi_sheer', 'open_weave'])

// Prompt projection of the executable contract. Prompts may explain the rule to a composer, but
// may not maintain a second list of fit values that can drift from the validator.
export function requiredBaseLayerPromptRule() {
  return `- Base-layer compatibility: a piece labeled \`needs_base: yes\` requires a base underneath whose \`fit_on_body\` is \`skims\`, \`clings_stretchy\`, or \`clings_drapey\` — close enough to the body to sit cleanly under an open or sheer dependent garment without its own excess fabric bunching or showing through unevenly. A candidate base tagged \`drapes\`, \`hangs_straight\`, \`structured\`, or \`none\` does not satisfy this even if it is otherwise the right color or a good match. Missing fit or opacity is unknown rather than proof either way: inspect both garments before using that pairing. This rule is only for a garment that needs required coverage beneath it; it is not a close-fit rule for ordinary layering. When two pieces share a near-identical name, check each candidate's own fields by ID — never assume they are interchangeable.`
}

// Model-visible projection of the canonical category structure. Options describe deliberate flow
// strategy (for example a visual composer that declines multi-top looks); they do not re-define
// what the validator considers a structurally wearable outfit.
export function categoryOutfitStructurePromptRule({
  strictSingleTop = false,
  maxOuterwear = null,
  allowAccessories = true,
} = {}) {
  if (strictSingleTop && maxOuterwear === 1 && !allowAccessories) {
    // Preserve the ratcheted visual-composer contract byte-for-byte while moving its ownership
    // here. Capsule expansion deliberately selects the same strict, accessory-free policy.
    return 'Each outfit: EXACTLY one top AND one bottom, OR exactly one dress; EXACTLY one pair of shoes; optional single outerwear; never two pieces occupying the same slot (no two bottoms, no two tops). Accessories are styled separately and are not shown — do not invent or reference accessory pieces.'
  }
  const topRule = strictSingleTop
    ? 'exactly one top plus one bottom, or exactly one dress'
    : 'at least one top plus one bottom, or one dress (an additional top with a dress is allowed only as an intentional layer)'
  const outerwearRule = Number.isInteger(maxOuterwear)
    ? `; at most ${maxOuterwear} optional outerwear layer${maxOuterwear === 1 ? '' : 's'}`
    : ''
  const accessoryRule = allowAccessories ? '' : '; do not add accessories'
  return `Outfit structure invariant: ${topRule}; exactly one pair of shoes; never more than one bottom, dress, or shoe slot${outerwearRule}${accessoryRule}. Outerwear never replaces the required top.`
}

export function roleOutfitStructurePromptRule() {
  return 'Outfit role invariant: use primary_top + primary_bottom, or one dress, plus exactly one shoes role. Use layer_top/layer_bottom only for intentional layering; a layer needs its primary garment, and roles must match garment categories. At most one primary_top, primary_bottom, dress, and shoes role.'
}

export function projectOutfitValidationFindings(findings = [], { prefix = 'Validation findings' } = {}) {
  const lines = (Array.isArray(findings) ? findings : [])
    .filter(Boolean)
    .map(finding => `- [${finding.code || 'validation'}] ${finding.message || finding.reason || ''}`)
  return lines.length ? `${prefix}:\n${lines.join('\n')}` : ''
}

function baseLayerFinding(code, message, severity, evidence = {}) {
  return {
    code,
    message,
    kind: 'base_layer',
    severity,
    evidence,
  }
}

// Canonical construction verdict for the garment that would provide required coverage beneath a
// `needs_base` garment. This is deliberately not an ordinary-layering rule: a blouse may drape
// under a roomy jacket, but it cannot serve as the close, smooth coverage layer required by a
// sheer/open dependent garment. Missing historical tags stay unknown rather than becoming false
// facts; each flow decides whether sight can resolve that uncertainty.
export function evaluateBaseLayerCandidate(piece = {}) {
  const pieceId = Number(piece?.id) || null
  const label = piece?.name || (pieceId ? `piece ${pieceId}` : 'this garment')
  const categoryGroup = wardrobeCategoryGroup(piece)
  const opacity = String(piece?.opacity || '').toLowerCase().trim()
  const fitOnBody = String(piece?.fit_on_body || '').toLowerCase().trim()
  const requiresBase = pieceRequiresBaseLayer(piece)
  const findings = []

  if (categoryGroup !== 'top') {
    findings.push(baseLayerFinding(
      'base_layer_candidate_not_top',
      `${label} is not a top and cannot fill the required base-layer slot`,
      'error',
      { pieceId, categoryGroup },
    ))
  }
  if (requiresBase) {
    findings.push(baseLayerFinding(
      'base_layer_candidate_is_dependent',
      `${label} also needs a base layer and cannot provide the required coverage`,
      'error',
      { pieceId, requiresBase: true },
    ))
  }
  if (BASE_LAYER_INCOMPATIBLE_OPACITIES.has(opacity)) {
    findings.push(baseLayerFinding(
      'base_layer_candidate_not_opaque',
      `${label} is ${opacity.replace('_', ' ')} and cannot provide the required coverage`,
      'error',
      { pieceId, opacity },
    ))
  }
  if (BASE_LAYER_INCOMPATIBLE_FITS.has(fitOnBody)) {
    findings.push(baseLayerFinding(
      'base_layer_candidate_not_close_fitting',
      `${label} is tagged ${fitOnBody.replace('_', ' ')} rather than close-fitting, so it will not sit cleanly beneath a dependent garment`,
      'error',
      { pieceId, fitOnBody },
    ))
  }

  const incompatible = findings.some(finding => finding.severity === 'error')
  if (!incompatible && opacity !== 'opaque') {
    findings.push(baseLayerFinding(
      'base_layer_candidate_opacity_unknown',
      opacity ? `${label} has an unrecognized opacity value (${opacity})` : `${label} has no recorded opacity`,
      'warning',
      { pieceId, opacity: opacity || null },
    ))
  }
  if (!incompatible && !BASE_LAYER_CLOSE_FITS.has(fitOnBody)) {
    findings.push(baseLayerFinding(
      'base_layer_candidate_fit_unknown',
      fitOnBody ? `${label} has an unrecognized fit-on-body value (${fitOnBody})` : `${label} has no recorded fit-on-body`,
      'warning',
      { pieceId, fitOnBody: fitOnBody || null },
    ))
  }

  const verdict = incompatible
    ? 'incompatible'
    : (opacity !== 'opaque' || !BASE_LAYER_CLOSE_FITS.has(fitOnBody) ? 'unknown' : 'compatible')

  return {
    verdict,
    findings,
    primaryFinding: findings[0] || null,
    evidence: { pieceId, categoryGroup, requiresBase, opacity: opacity || null, fitOnBody: fitOnBody || null },
    sightRequired: verdict === 'unknown' ? 'both' : 'none',
  }
}

// Shared dependent-to-base contract. With explicit roles, the base beneath a dependent top is the
// primary_top; a top beneath a dependent dress is the additional layer_top. Category-only plan
// submissions use the same facts without pretending to know a visual direction that roles did not
// express. Visual colour/neckline/texture/proportion judgment remains outside this verdict.
export function evaluateRequiredBaseLayers(pieces = [], { roleAware = false } = {}) {
  const normalizedPieces = Array.isArray(pieces) ? pieces : []
  const dependents = normalizedPieces.filter(piece =>
    ['top', 'dress'].includes(wardrobeCategoryGroup(piece)) && pieceRequiresBaseLayer(piece))
  const findings = []
  const pairs = []

  for (const dependent of dependents) {
    const dependentGroup = wardrobeCategoryGroup(dependent)
    const candidates = normalizedPieces.filter(candidate => {
      if (candidate === dependent || Number(candidate?.id) === Number(dependent?.id)) return false
      if (wardrobeCategoryGroup(candidate) !== 'top') return false
      if (!roleAware) return true
      if (dependentGroup === 'dress') return candidate.role === 'layer_top'
      return candidate.role === 'primary_top'
    })
    const evaluated = candidates.map(candidate => ({
      dependent,
      candidate,
      result: evaluateBaseLayerCandidate(candidate),
    }))
    pairs.push(...evaluated)

    if (evaluated.some(pair => pair.result.verdict === 'compatible')) continue
    const unknownPairs = evaluated.filter(pair => pair.result.verdict === 'unknown')
    if (unknownPairs.length) {
      const candidateIds = unknownPairs.map(pair => Number(pair.candidate.id)).filter(Boolean)
      findings.push(baseLayerFinding(
        'required_base_layer_unknown',
        `${dependent.name || `piece ${dependent.id}`} needs a base layer, but the possible base${candidateIds.length === 1 ? '' : 's'} ${candidateIds.join(', ')} ${candidateIds.length === 1 ? 'has' : 'have'} incomplete fit or opacity data`,
        'warning',
        { dependentId: Number(dependent.id) || null, candidateIds, sightRequired: 'both' },
      ))
      continue
    }

    const candidateFindings = evaluated.flatMap(pair => pair.result.findings)
    findings.push(baseLayerFinding(
      'required_base_layer_missing_or_incompatible',
      candidateFindings[0]?.message || `${dependent.name || `piece ${dependent.id}`} cannot be worn alone — this outfit needs a base layer underneath it, not just a bottom`,
      'error',
      {
        dependentId: Number(dependent.id) || null,
        candidateIds: candidates.map(candidate => Number(candidate.id)).filter(Boolean),
      },
    ))
  }

  const verdict = findings.some(finding => finding.severity === 'error')
    ? 'incompatible'
    : (findings.some(finding => finding.severity === 'warning') ? 'unknown' : 'compatible')
  return {
    verdict,
    findings,
    primaryFinding: findings[0] || null,
    pairs,
    evidence: { dependentIds: dependents.map(piece => Number(piece.id)).filter(Boolean), roleAware: Boolean(roleAware) },
    sightRequired: verdict === 'unknown' ? 'both' : 'none',
  }
}

function layerDirectionFinding(code, message, severity, evidence = {}) {
  return {
    code,
    message,
    kind: 'layer_direction',
    severity,
    evidence,
  }
}

function layerDirectionPair(addedPiece, basePiece, { relationship, direction = null, source = null, sightRequired = 'both' } = {}) {
  const addedId = Number(addedPiece?.id) || null
  const baseId = Number(basePiece?.id) || null
  if (direction) {
    return {
      verdict: 'compatible',
      addedPiece,
      basePiece,
      direction,
      findings: [],
      evidence: { addedId, baseId, relationship, source },
      sightRequired,
    }
  }
  const finding = layerDirectionFinding(
    'layer_direction_unknown',
    `${addedPiece?.name || `piece ${addedId}`} + ${basePiece?.name || `piece ${baseId}`} has no recorded over/under direction; inspect both pieces and make the stylistic decision visually`,
    'warning',
    {
      addedId,
      baseId,
      relationship,
      sightRequired: 'both',
      resolutionPolicy: 'provisional_visual_judgment',
    },
  )
  return {
    verdict: 'unknown',
    addedPiece,
    basePiece,
    direction: null,
    findings: [finding],
    evidence: finding.evidence,
    sightRequired: 'both',
  }
}

// Canonical direction verdict for ordinary layering. Recorded construction/intent establishes a
// known over/under relationship; absent legacy metadata is unknown, never proof of incompatibility.
// `unknown` may be resolved only by a caller that has shown both photos to the stylist model. That
// allowance is deliberately tagged as provisional and never writes a reusable garment fact.
export function evaluateLayerDirections(pieces = [], { roleAware = false } = {}) {
  const normalizedPieces = Array.isArray(pieces) ? pieces : []
  const pairs = []

  if (!roleAware) {
    const dresses = normalizedPieces.filter(piece => wardrobeCategoryGroup(piece) === 'dress')
    const tops = normalizedPieces.filter(piece => wardrobeCategoryGroup(piece) === 'top')
    for (const dress of dresses) {
      for (const top of tops) {
        const overlay = pieceHasExplicitTopLayerEvidence(top)
        const underlay = pieceHasExplicitBaseLayerEvidence(top) ||
          pieceDressSupportsUnderlayer(dress) || pieceRequiresBaseLayer(dress)
        pairs.push(layerDirectionPair(top, dress, {
          relationship: 'top_dress',
          direction: underlay ? 'top_under_dress' : (overlay ? 'top_over_dress' : null),
          source: underlay ? 'underlayer_evidence' : (overlay ? 'top_overlay_evidence' : null),
          sightRequired: 'both',
        }))
      }
    }
  } else {
    const layerTops = normalizedPieces.filter(piece => piece.role === 'layer_top')
    const dresses = normalizedPieces.filter(piece => piece.role === 'dress')
    const primaryTops = normalizedPieces.filter(piece => piece.role === 'primary_top')
    for (const layerTop of layerTops) {
      if (dresses.length) {
        for (const dress of dresses) {
          const overlay = pieceHasExplicitTopLayerEvidence(layerTop)
          const underlay = pieceHasExplicitBaseLayerEvidence(layerTop) ||
            pieceDressSupportsUnderlayer(dress) || pieceRequiresBaseLayer(dress)
          pairs.push(layerDirectionPair(layerTop, dress, {
            relationship: 'layer_top_dress',
            direction: underlay ? 'top_under_dress' : (overlay ? 'top_over_dress' : null),
            source: underlay ? 'underlayer_evidence' : (overlay ? 'top_overlay_evidence' : null),
            sightRequired: 'both',
          }))
        }
        continue
      }
      for (const primaryTop of primaryTops) {
        const categoryGroup = wardrobeCategoryGroup(layerTop)
        const overlay = categoryGroup === 'outerwear' || pieceRequiresBaseLayer(layerTop) ||
          pieceHasExplicitTopLayerEvidence(layerTop)
        const underlay = pieceHasExplicitBaseLayerEvidence(layerTop)
        pairs.push(layerDirectionPair(layerTop, primaryTop, {
          relationship: 'layer_top_primary_top',
          direction: overlay ? 'layer_top_over_primary_top' : (underlay ? 'layer_top_under_primary_top' : null),
          source: categoryGroup === 'outerwear'
            ? 'outerwear_category'
            : (pieceRequiresBaseLayer(layerTop)
                ? 'dependent_layer_requires_base'
                : (overlay ? 'top_overlay_evidence' : (underlay ? 'underlayer_evidence' : null))),
          sightRequired: overlay || underlay ? 'one' : 'both',
        }))
      }
    }
  }

  const findings = pairs.flatMap(pair => pair.findings)
  const verdict = pairs.some(pair => pair.verdict === 'incompatible')
    ? 'incompatible'
    : (pairs.some(pair => pair.verdict === 'unknown') ? 'unknown' : 'compatible')
  return {
    verdict,
    findings,
    primaryFinding: findings[0] || null,
    pairs,
    evidence: {
      roleAware: Boolean(roleAware),
      resolvedDirections: pairs.filter(pair => pair.direction).map(pair => ({
        addedId: Number(pair.addedPiece?.id) || null,
        baseId: Number(pair.basePiece?.id) || null,
        direction: pair.direction,
        source: pair.evidence.source,
      })),
      provisionalVisualPairIds: pairs.filter(pair => pair.verdict === 'unknown').map(pair => [
        Number(pair.addedPiece?.id) || null,
        Number(pair.basePiece?.id) || null,
      ]),
    },
    sightRequired: pairs.some(pair => pair.sightRequired === 'both')
      ? 'both'
      : (pairs.some(pair => pair.sightRequired === 'one') ? 'one' : 'none'),
  }
}

function structureFinding(code, message, evidence = {}) {
  return {
    code,
    message,
    kind: 'structure',
    severity: 'error',
    evidence,
  }
}

function roleStructureFinding(code, message, evidence = {}) {
  return {
    code,
    message,
    kind: 'role_structure',
    severity: 'error',
    evidence,
  }
}

function roleCategoryFinding(piece = {}) {
  const role = String(piece.role || '').trim()
  const category = String(piece.category || '').toLowerCase().trim()
  if (!role || !category) return null
  const expected = {
    primary_top: ['top'],
    layer_top: ['top', 'outerwear'],
    primary_bottom: ['bottom'],
    layer_bottom: ['bottom'],
    dress: ['dress'],
    shoes: ['shoes'],
    outerwear: ['outerwear'],
    accessory: ['accessory'],
  }[role]
  if (!expected || expected.includes(category)) return null
  return roleStructureFinding(
    'role_category_mismatch',
    `${piece.name || `piece ${piece.id}`} is category "${piece.category}" but was assigned role "${role}"`,
    { pieceId: piece.id, role, category, expectedCategories: expected },
  )
}

// Canonical explicit-role structure. This is intentionally distinct from category structure:
// role intent can distinguish a primary top from a layer over a dress, while categories cannot.
export function evaluateOutfitRoles(pieces = []) {
  const normalizedPieces = Array.isArray(pieces) ? pieces : []
  const counts = Object.fromEntries(OUTFIT_ROLES.map(role => [role, 0]))
  const findings = []

  for (const piece of normalizedPieces) {
    if (!OUTFIT_ROLES.includes(piece.role)) {
      findings.push(roleStructureFinding(
        'invalid_role',
        `piece ${piece.id} has an invalid or missing role`,
        { pieceId: piece.id, role: piece.role || null },
      ))
    } else {
      counts[piece.role] += 1
    }
  }

  // Invalid roles make the remaining cardinality evidence incomplete, matching the former
  // validator's early return rather than producing speculative secondary findings.
  if (findings.length) {
    return { valid: false, findings, primaryFinding: findings[0], evidence: { counts } }
  }

  if (counts.primary_top > 1) {
    findings.push(roleStructureFinding('multiple_primary_tops', 'two primary_top pieces — unresolved top slot (use layer_top for intentional layering)', { actual: counts.primary_top, maximum: 1 }))
  }
  if (counts.primary_bottom > 1) {
    findings.push(roleStructureFinding('multiple_primary_bottoms', 'two primary_bottom pieces — unresolved bottom slot (use layer_bottom for intentional layering)', { actual: counts.primary_bottom, maximum: 1 }))
  }
  if (counts.dress > 1) {
    findings.push(roleStructureFinding('multiple_dresses', 'two dress pieces — unresolved dress slot', { actual: counts.dress, maximum: 1 }))
  }
  if (counts.shoes > 1) {
    findings.push(roleStructureFinding('multiple_shoes', 'more than one shoes — unresolved shoes slot', { actual: counts.shoes, maximum: 1 }))
  }
  if (counts.shoes < 1) {
    findings.push(roleStructureFinding(
      'missing_shoes',
      'outfit is missing shoes — every proposed outfit card needs actual footwear; missing_gaps may explain the wardrobe gap but cannot satisfy the shoes slot',
      { actual: counts.shoes, required: 1 },
    ))
  }

  const hasSeparatesCore = counts.primary_top >= 1 && counts.primary_bottom >= 1
  const hasDressCore = counts.dress === 1
  if (!hasSeparatesCore && !hasDressCore) {
    findings.push(roleStructureFinding('missing_primary_core', 'outfit needs a primary_top plus primary_bottom, or a single dress', { primaryTopCount: counts.primary_top, primaryBottomCount: counts.primary_bottom, dressCount: counts.dress }))
  }
  if (counts.dress >= 1 && (counts.primary_top >= 1 || counts.primary_bottom >= 1)) {
    findings.push(roleStructureFinding('dress_with_primary', 'a dress cannot be combined with a primary_top/primary_bottom — choose separates or a dress', { primaryTopCount: counts.primary_top, primaryBottomCount: counts.primary_bottom, dressCount: counts.dress }))
  }
  if (counts.layer_top >= 1 && counts.primary_top < 1 && counts.dress < 1) {
    findings.push(roleStructureFinding('orphan_layer_top', 'layer_top has no primary_top or dress to layer with', { layerTopCount: counts.layer_top, primaryTopCount: counts.primary_top, dressCount: counts.dress }))
  }
  if (counts.layer_bottom >= 1 && counts.primary_bottom < 1 && counts.dress < 1) {
    findings.push(roleStructureFinding('orphan_layer_bottom', 'layer_bottom has no primary_bottom or dress to layer with', { layerBottomCount: counts.layer_bottom, primaryBottomCount: counts.primary_bottom, dressCount: counts.dress }))
  }

  for (const piece of normalizedPieces) {
    const categoryFinding = roleCategoryFinding(piece)
    if (categoryFinding) findings.push(categoryFinding)
  }

  return {
    valid: findings.length === 0,
    findings,
    primaryFinding: findings[0] || null,
    evidence: { counts },
  }
}

// Canonical category-level outfit structure. Role intent, layer mechanics, contextual suitability,
// and set-level constraints remain separate validators that may compose these findings.
export function evaluateOutfitStructure(pieces = [], { requireShoes = true } = {}) {
  const groups = (Array.isArray(pieces) ? pieces : []).map(piece => wardrobeCategoryGroup(piece))
  const counts = {
    shoes: groups.filter(group => group === 'shoes').length,
    bottom: groups.filter(group => group === 'bottom').length,
    dress: groups.filter(group => group === 'dress').length,
    top: groups.filter(group => group === 'top').length,
  }
  const findings = []

  if (requireShoes && counts.shoes === 0) {
    findings.push(structureFinding('missing_shoes', 'missing shoes', { actual: 0, required: 1 }))
  }
  if (counts.shoes > 1) {
    findings.push(structureFinding('multiple_shoes', 'more than one shoe option was submitted', { actual: counts.shoes, maximum: 1 }))
  }
  if (counts.bottom > 1) {
    findings.push(structureFinding('multiple_bottoms', 'more than one bottom was submitted', { actual: counts.bottom, maximum: 1 }))
  }
  if (counts.dress > 1) {
    findings.push(structureFinding('multiple_dresses', 'more than one dress was submitted', { actual: counts.dress, maximum: 1 }))
  }
  if (counts.dress === 1 && counts.bottom > 0) {
    findings.push(structureFinding('dress_with_bottom', 'dress and bottom were both submitted', { dressCount: counts.dress, bottomCount: counts.bottom }))
  }
  if (counts.dress === 0 && counts.top < 1) {
    findings.push(structureFinding('missing_top_or_dress', 'missing top or dress', { topCount: counts.top, dressCount: counts.dress }))
  }
  if (counts.dress === 0 && counts.bottom === 0) {
    if (counts.top > 1 && counts.bottom === 0) {
      findings.push(structureFinding('multiple_tops_without_bottom', `${counts.top} tops were submitted without a bottom`, { topCount: counts.top, bottomCount: 0 }))
    } else {
      findings.push(structureFinding('missing_bottom', 'missing bottom', { actual: counts.bottom, required: 1 }))
    }
  }

  return {
    valid: findings.length === 0,
    findings,
    primaryFinding: findings[0] || null,
    evidence: { counts, requireShoes: Boolean(requireShoes) },
  }
}

// Shared composed verdict for any surface that claims to produce a wearable outfit. Narrow fact
// owners above remain independently testable; this function owns their composition and the
// distinction between hard invalidity and unresolved evidence. Flow policy controls visibility,
// retry, and whether role/layer extensions apply, but cannot rewrite a finding.
export function evaluateWearableOutfit(pieces = [], {
  requireShoes = true,
  roleAware = false,
  includeRoles = roleAware,
  includeLayerDirections = false,
  seenPieceIds = [],
} = {}) {
  const normalizedPieces = Array.isArray(pieces) ? pieces : []
  const seenIds = seenPieceIds instanceof Set
    ? seenPieceIds
    : new Set((Array.isArray(seenPieceIds) ? seenPieceIds : []).map(Number))
  const stages = []
  const structure = includeRoles
    ? evaluateOutfitRoles(normalizedPieces)
    : evaluateOutfitStructure(normalizedPieces, { requireShoes })
  stages.push({ stage: includeRoles ? 'roles' : 'structure', result: structure })

  const dependencies = evaluateRequiredBaseLayers(normalizedPieces, { roleAware })
  stages.push({ stage: 'required_base', result: dependencies })

  const directions = includeLayerDirections
    ? evaluateLayerDirections(normalizedPieces, { roleAware })
    : null
  if (directions) stages.push({ stage: 'layer_direction', result: directions })

  const findings = stages.flatMap(({ result }) => result?.findings || [])
  const hardFindings = findings.filter(finding => finding.severity === 'error')
  const advisoryFindings = findings.filter(finding => finding.severity !== 'error')
  const unresolvedPairs = [
    ...dependencies.pairs
      .filter(pair => pair.result.verdict === 'unknown')
      .map(pair => ({
        kind: 'required_base',
        pieceIds: [Number(pair.dependent?.id), Number(pair.candidate?.id)].filter(Boolean),
      })),
    ...(directions?.pairs || [])
      .filter(pair => pair.verdict === 'unknown')
      .map(pair => ({
        kind: 'layer_direction',
        pieceIds: [Number(pair.addedPiece?.id), Number(pair.basePiece?.id)].filter(Boolean),
      })),
  ]
  const unresolvedSightPairs = unresolvedPairs.filter(pair =>
    pair.pieceIds.some(pieceId => !seenIds.has(pieceId)))
  const unresolvedSightPieceIds = [...new Set(unresolvedSightPairs.flatMap(pair => pair.pieceIds))]

  return {
    valid: hardFindings.length === 0,
    hardValid: hardFindings.length === 0,
    reviewRequired: hardFindings.length > 0 || unresolvedSightPairs.length > 0,
    findings,
    hardFindings,
    advisoryFindings,
    primaryFinding: hardFindings[0] || advisoryFindings[0] || null,
    unresolvedPairs,
    unresolvedSightPairs,
    unresolvedSightPieceIds,
    evidence: {
      roleAware: Boolean(roleAware),
      includedStages: stages.map(stage => stage.stage),
      seenPieceIds: [...seenIds],
    },
    stages,
  }
}

export function describeOutfitStructureGap(pieces = [], options = {}) {
  return evaluateOutfitStructure(pieces, options).primaryFinding?.message || ''
}
