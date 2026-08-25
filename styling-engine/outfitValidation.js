import { pieceReadsAsStandaloneBaseTop, wardrobeCategoryGroup } from './attributes.js'

export const OUTFIT_ROLES = ['primary_top', 'layer_top', 'primary_bottom', 'layer_bottom', 'dress', 'shoes', 'outerwear', 'accessory']

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
    if (piece.role === 'layer_top' && pieceReadsAsStandaloneBaseTop(piece)) {
      findings.push(roleStructureFinding(
        'standalone_top_as_layer',
        `${piece.name || `piece ${piece.id}`} is assigned as layer_top but reads as a standalone top, not a layer`,
        { pieceId: piece.id, role: piece.role },
      ))
    }
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

export function describeOutfitStructureGap(pieces = [], options = {}) {
  return evaluateOutfitStructure(pieces, options).primaryFinding?.message || ''
}
