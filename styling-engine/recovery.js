// Shared recovery mechanics. A recovery policy chooses candidates, ordering, retry/cost budgets,
// and the authoritative validator. This module owns the invariant that a mutated or fallback
// result is never returned as recovered until that validator has accepted the exact result.

function defaultAccepted(validation) {
  if (validation === true) return true
  if (!validation || validation === false) return false
  if (typeof validation.valid === 'boolean') return validation.valid
  if (typeof validation.ok === 'boolean') return validation.ok
  return false
}

function candidateIdentity(candidate) {
  if (candidate && typeof candidate === 'object') {
    return Number(candidate.id) || candidate.name || null
  }
  return candidate ?? null
}

function validationReason(validation) {
  if (!validation || validation === false) return 'validator_rejected'
  if (validation === true) return ''
  return validation.primaryFinding?.code ||
    validation.primaryFinding?.message ||
    validation.reason ||
    (Array.isArray(validation.reasons) ? validation.reasons[0] : '') ||
    (Array.isArray(validation.failures) ? validation.failures[0]?.reasons?.[0] : '') ||
    'validator_rejected'
}

export function discloseRecoveryShortfall({
  operation = 'fallback',
  requestedCount = 1,
  recoveredCount = 0,
  reason = 'no_valid_candidate',
  attempts = [],
  context = {},
  message = '',
} = {}) {
  const remaining = Math.max(0, Number(requestedCount) - Number(recoveredCount))
  return {
    code: 'recovery_shortfall',
    operation,
    reason,
    requestedCount: Number(requestedCount) || 0,
    recoveredCount: Number(recoveredCount) || 0,
    remainingCount: remaining,
    attempts: Array.isArray(attempts) ? attempts : [],
    context,
    message: message || `Could not validate ${remaining || 1} ${remaining === 1 ? 'result' : 'results'} through ${operation}.`,
  }
}

function validatedMutation({ operation, subject, target = null, candidates = [], mutate, validate, accept = defaultAccepted, context = {} }) {
  if (typeof mutate !== 'function') throw new TypeError(`${operation} recovery requires mutate`)
  if (typeof validate !== 'function') throw new TypeError(`${operation} recovery requires validate`)
  const attempts = []
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const value = mutate(subject, candidate, target)
    const validation = validate(value, { subject, candidate, target, operation })
    const accepted = Boolean(accept(validation, value, { subject, candidate, target, operation }))
    attempts.push({
      candidate: candidateIdentity(candidate),
      accepted,
      reason: accepted ? '' : validationReason(validation),
    })
    if (!accepted) continue
    return {
      status: 'recovered',
      operation,
      value,
      candidate,
      validation,
      report: { operation, attempts, context },
    }
  }
  return {
    status: 'shortfall',
    operation,
    value: null,
    candidate: null,
    validation: null,
    report: discloseRecoveryShortfall({ operation, attempts, context }),
  }
}

export function validatedSubstitute(options = {}) {
  return validatedMutation({ ...options, operation: 'substitute' })
}

export function validatedComplete(options = {}) {
  return validatedMutation({ ...options, operation: 'complete' })
}

export function validatedFallback({ candidates = [], validate, accept = defaultAccepted, limit = 1, context = {} } = {}) {
  if (typeof validate !== 'function') throw new TypeError('fallback recovery requires validate')
  const requestedCount = Math.max(0, Number(limit) || 0)
  const values = []
  const validations = []
  const attempts = []
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (values.length >= requestedCount) break
    const validation = validate(candidate, { operation: 'fallback' })
    const accepted = Boolean(accept(validation, candidate, { operation: 'fallback' }))
    attempts.push({
      candidate: candidateIdentity(candidate),
      accepted,
      reason: accepted ? '' : validationReason(validation),
    })
    if (!accepted) continue
    values.push(candidate)
    validations.push(validation)
  }
  const complete = values.length >= requestedCount
  return {
    status: values.length ? 'recovered' : 'shortfall',
    operation: 'fallback',
    values,
    validations,
    report: complete
      ? { operation: 'fallback', attempts, context }
      : discloseRecoveryShortfall({
          operation: 'fallback',
          requestedCount,
          recoveredCount: values.length,
          attempts,
          context,
        }),
  }
}
