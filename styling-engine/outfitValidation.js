import { wardrobeCategoryGroup } from './attributes.js'

function structureFinding(code, message, evidence = {}) {
  return {
    code,
    message,
    kind: 'structure',
    severity: 'error',
    evidence,
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
