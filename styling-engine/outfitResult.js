export const OUTFIT_RESULT_VERSION = 1
export const OUTFIT_DISPOSITIONS = Object.freeze(['accepted', 'annotated', 'repairable', 'rejected'])

function normalizeFinding(finding, index) {
  if (typeof finding === 'string') {
    return { code: `finding_${index + 1}`, message: finding, severity: 'error', kind: 'validation' }
  }
  return {
    code: String(finding?.code || `finding_${index + 1}`),
    message: String(finding?.message || finding?.reason || ''),
    severity: String(finding?.severity || 'error'),
    kind: String(finding?.kind || 'validation'),
    ...(finding?.evidence ? { evidence: finding.evidence } : {}),
  }
}

function provenanceFor(outfit, provenance = {}) {
  return {
    flow: String(provenance.flow || ''),
    source: String(provenance.source || outfit?.source || 'unknown'),
    composedBy: String(provenance.composedBy || outfit?.composedBy || 'unknown'),
    stage: String(provenance.stage || 'response'),
    ...(provenance.recovery ? { recovery: provenance.recovery } : {}),
  }
}

export function normalizeOutfitResult(outfit = {}, {
  disposition = 'accepted',
  findings = [],
  annotations = [],
  provenance = {},
  repair = null,
} = {}) {
  if (!OUTFIT_DISPOSITIONS.includes(disposition)) {
    throw new TypeError(`Unknown outfit disposition: ${disposition}`)
  }
  const normalizedFindings = (Array.isArray(findings) ? findings : [findings])
    .filter(Boolean)
    .map(normalizeFinding)
  const normalizedAnnotations = (Array.isArray(annotations) ? annotations : [annotations]).filter(Boolean)
  const rejectionReason = String(outfit.rejectionReason || normalizedFindings.map(finding => finding.message).filter(Boolean).join('; '))
  const result = {
    version: OUTFIT_RESULT_VERSION,
    disposition,
    provenance: provenanceFor(outfit, provenance),
    findings: normalizedFindings,
    annotations: normalizedAnnotations,
    ...(repair ? { repair } : {}),
  }

  const normalized = { ...outfit, result }
  if (disposition === 'annotated' && normalizedAnnotations.length && !Array.isArray(normalized.systemFlags)) {
    normalized.systemFlags = normalizedAnnotations
  }
  if (disposition === 'repairable' || disposition === 'rejected') {
    normalized.broken = true
    if (rejectionReason) normalized.rejectionReason = rejectionReason
  }
  if (disposition === 'rejected') normalized.diagnosticOnly = true
  return normalized
}

export function dispositionForOutfit(outfit = {}) {
  if (outfit?.result?.disposition && OUTFIT_DISPOSITIONS.includes(outfit.result.disposition)) {
    return outfit.result.disposition
  }
  if (outfit?.broken && outfit?.diagnosticOnly) return 'rejected'
  if (outfit?.broken) return 'repairable'
  if (Array.isArray(outfit?.systemFlags) && outfit.systemFlags.length) return 'annotated'
  return 'accepted'
}

export function normalizeDeliveredOutfit(outfit = {}, options = {}) {
  const disposition = options.disposition || dispositionForOutfit(outfit)
  const findings = options.findings || (outfit.rejectionReason ? [outfit.rejectionReason] : [])
  const annotations = options.annotations || outfit.systemFlags || []
  return normalizeOutfitResult(outfit, { ...options, disposition, findings, annotations })
}
