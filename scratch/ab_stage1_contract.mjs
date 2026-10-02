// Stage 1 contract checks shared by the harness and the blind review sheet, so the two cannot drift.
// Pre-registration: scratch/ab_stage1_preregistration.json.

// Resolved conditions as each arm recorded them. The harness writes `resolvedWeather` per cell from the
// route's own debug (never from the scenario definition), so this compares what each flow actually used.
export function weatherParity(oneCell, bundleCell) {
  const one = oneCell?.resolvedWeather || null
  const bundle = bundleCell?.resolvedWeather || null
  const reasons = []
  if (!one) reasons.push('one-outfit arm recorded no resolved weather')
  if (!bundle) reasons.push('bundle arm recorded no resolved weather')
  if (one && bundle) {
    for (const field of ['highF', 'lowF']) {
      if (!Number.isFinite(one[field]) || !Number.isFinite(bundle[field])) reasons.push(`${field} missing (one ${one[field]}, bundle ${bundle[field]})`)
      else if (one[field] !== bundle[field]) reasons.push(`${field} differs (one ${one[field]}, bundle ${bundle[field]})`)
    }
    const norm = value => String(value || '').trim().toLowerCase()
    if (!norm(one.location) || !norm(bundle.location)) reasons.push(`location missing (one "${one.location || ''}", bundle "${bundle.location || ''}")`)
    else if (norm(one.location) !== norm(bundle.location)) reasons.push(`location differs (one "${one.location}", bundle "${bundle.location}")`)
  }
  return { ok: reasons.length === 0, reasons, one, bundle }
}

// Routing is an end-to-end outcome of the one-outfit arm, reported over every attempt.
export function singleOutfitRouted(oneCell) {
  const routing = oneCell?.routing || {}
  return routing.routerProfile === 'single_outfit' && routing.executedProfile === 'single_outfit'
}

// A cell's cards may go on the blind sheet only when the route answered, the two arms of that scenario
// and replicate resolved identical temperature and location, and (one-outfit arm) routing succeeded.
export function reviewEligibility(oneCell, bundleCell) {
  const parity = weatherParity(oneCell, bundleCell)
  const reasons = [...parity.reasons]
  if (!oneCell?.technicalOk) reasons.push('one-outfit arm: route error or non-200')
  if (!bundleCell?.technicalOk) reasons.push('bundle arm: route error or non-200')
  if (oneCell && !singleOutfitRouted(oneCell)) reasons.push(`one-outfit arm: routed ${oneCell.routing?.routerProfile || 'none'} / executed ${oneCell.routing?.executedProfile || 'none'}`)
  return { eligible: reasons.length === 0, reasons, parity }
}

// The card as the product shows it to a user (StylistChat.jsx, STYLIST_DEBUG_ENABLED off). Only the
// arm is blinded; a card the product itself marked broken is shown with its Needs-review treatment.
const DIRECTION_RANK_LABELS = { signature: 'Closest to your brief', strong: 'Strong alternative', usable: 'More exploratory', experimental: 'Needs review' }
const LEGACY_ENGINE_REJECTION_SUFFIX = /\s*(?:Rejected|Broken)\s+because\s.*$/is
const LEGACY_DEBUG_CARD_FALLBACKS = ['Model proposal shown for debugging.', 'Local fill candidate shown for debugging.']
const stripEngineRejectionSuffix = reason => {
  const stripped = String(reason || '').replace(LEGACY_ENGINE_REJECTION_SUFFIX, '').trim()
  return LEGACY_DEBUG_CARD_FALLBACKS.includes(stripped) ? '' : stripped
}
export function userVisibleCard(card, index) {
  const broken = Boolean(card.broken || card.diagnosticOnly)
  const flags = (Array.isArray(card.systemFlags) ? card.systemFlags : []).map(flag => ({ type: flag?.type || 'Note', message: flag?.message ?? String(flag) }))
  return {
    title: card.label || card.title || `Direction ${index + 1}`,
    badge: broken ? 'needs review' : (DIRECTION_RANK_LABELS[String(card.strength || '').toLowerCase()] || 'Direction'),
    needsReview: broken,
    reviewNotice: broken ? "This direction didn't clear one of the engine's structural checks, so it's shown here for review rather than as a validated suggestion." : null,
    rejectionReason: broken ? (card.rejectionReason || null) : null,
    // brokenPieces rows render only with STYLIST_DEBUG_ENABLED, so a user never sees them.
    flags: broken ? [] : flags,
    engineNote: broken ? null : (card.engineNote || null),
    reason: card.reason ? (broken ? stripEngineRejectionSuffix(card.reason) : card.reason) : null,
    stylingInstructions: broken ? null : (card.stylingInstructions || null),
    watchFor: !broken && card.watchFor && !/^none$/i.test(String(card.watchFor).trim()) ? card.watchFor : null,
  }
}

// One card's visible body, shared by the sheet and its regression test. Flags render once, at the top,
// as a user sees them first. The "Why this outfit" block renders when any of reason, styling
// instructions or watchFor exists, so instructions are never lost behind an empty reason.
export function renderVisibleCardBody(visible, photosHtml = '', esc = value => String(value ?? '')) {
  const flagList = visible.flags.map(f => `<div class="flag"><strong>${esc(f.type)}:</strong> ${esc(f.message)}</div>`).join('')
  const whyParts = [
    visible.reason ? `<p>${esc(visible.reason)}</p>` : '',
    visible.stylingInstructions ? `<p><strong>How to wear it:</strong> ${esc(visible.stylingInstructions)}</p>` : '',
    visible.watchFor ? `<p><strong>Watch:</strong> ${esc(visible.watchFor)}</p>` : '',
  ].filter(Boolean)
  return [
    `<div class="heading"><h2>${esc(visible.title)}</h2><span class="badge">${esc(visible.badge)}</span></div>`,
    flagList ? `<div class="flags">${flagList}</div>` : '',
    visible.engineNote ? `<p class="note">${esc(visible.engineNote)}</p>` : '',
    visible.needsReview ? `<div class="review-notice"><div>${esc(visible.reviewNotice)}</div>${visible.rejectionReason ? `<div><strong>What didn't clear:</strong> ${esc(visible.rejectionReason)}</div>` : ''}</div>` : '',
    `<div class="photos">${photosHtml}</div>`,
    whyParts.length ? `<details class="why"><summary>Why this outfit</summary>${whyParts.join('')}</details>` : '',
  ].filter(Boolean).join('\n')
}

// Pre-registered outcomes for one attempt's displayed cards (ready and Needs review alike).
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
export function attemptOutcomes(ratedCards) {
  const cards = ratedCards || []
  if (!cards.length) return { visibleCards: 0, readyCards: 0, needsReviewCards: 0, computable: false, reason: 'zero displayable cards', meanWeather: null, meanStyle: null, wouldWearProportion: null, bestWeather: null, bestStyle: null }
  return {
    visibleCards: cards.length,
    readyCards: cards.filter(c => !c.needsReview).length,
    needsReviewCards: cards.filter(c => c.needsReview).length,
    computable: true,
    meanWeather: mean(cards.map(c => c.weatherAdequacy)),
    meanStyle: mean(cards.map(c => c.styleIntent)),
    wouldWearProportion: cards.filter(c => c.wouldWear === 'yes').length / cards.length,
    bestWeather: Math.max(...cards.map(c => c.weatherAdequacy)),
    bestStyle: Math.max(...cards.map(c => c.styleIntent)),
  }
}

// Joins a blinded ratings export with its sealed key. Refuses mismatched sheets and incomplete ratings.
// The export's strongest-card pick is carried through as descriptive only and feeds no comparison.
export const OUTCOME_KEYS = { primary: ['meanWeather', 'meanStyle', 'wouldWearProportion'], secondary: ['bestWeather', 'bestStyle'] }
export function scoreStage1(ratingsExport, sealedKey) {
  if (ratingsExport.seed !== sealedKey.seed) throw new Error(`export seed ${ratingsExport.seed} does not match sealed key ${sealedKey.seed}`)
  if (ratingsExport.preregistrationSha256 !== sealedKey.preregistrationSha256) throw new Error('export and sealed key name different pre-registrations')
  const ratingByPosition = new Map((ratingsExport.cards || []).map(c => [c.position, c]))
  const unrated = sealedKey.cards.filter(k => {
    const r = ratingByPosition.get(k.position)
    return !r || !Number.isInteger(r.weatherAdequacy) || !Number.isInteger(r.styleIntent) || !['yes', 'no'].includes(r.wouldWear)
  }).map(k => k.position)
  if (unrated.length) throw new Error(`every displayed card must be rated before scoring; unrated positions: ${unrated.join(', ')}`)
  const attempts = []
  for (const replicate of sealedKey.includedReplicates.map(r => r.replicate)) {
    for (const arm of ['one', 'bundle']) {
      const cards = sealedKey.cards.filter(k => k.replicate === replicate && k.arm === arm)
        .map(k => ({ ...ratingByPosition.get(k.position), needsReview: Boolean(k.needsReview) }))
      attempts.push({ scenario: sealedKey.scenario, replicate, arm, ...attemptOutcomes(cards) })
    }
  }
  const comparisons = sealedKey.includedReplicates.map(({ replicate }) => {
    const one = attempts.find(a => a.replicate === replicate && a.arm === 'one')
    const bundle = attempts.find(a => a.replicate === replicate && a.arm === 'bundle')
    const notComputable = [one, bundle].filter(a => !a.computable).map(a => `${a.arm === 'one' ? 'one-outfit' : 'bundle'} attempt produced no displayable card`)
    const diff = keys => Object.fromEntries(keys.map(k => [k, notComputable.length ? null : one[k] - bundle[k]]))
    return { scenario: sealedKey.scenario, replicate, notComputable, primary: diff(OUTCOME_KEYS.primary), secondary: diff(OUTCOME_KEYS.secondary) }
  })
  return { scenario: sealedKey.scenario, seed: sealedKey.seed, preregistrationSha256: sealedKey.preregistrationSha256, attempts, comparisons,
    excludedReplicates: sealedKey.excludedReplicates,
    descriptiveStrongestPick: { position: ratingsExport.strongestPosition ?? null, wouldWear: ratingsExport.wouldWearStrongest ?? null, usedInComparisons: false } }
}

// Provider-network permission for a cell's child process. Cells run under NODE_ENV=test (the test AI hook
// serves the preflight), and assertProviderKey() refuses every provider request under test unless
// WARDROBE_ALLOW_TEST_PROVIDER_NETWORK is 'true'. The flag is granted only to an approved live run and is
// removed, even if inherited, in every other state.
export function providerNetworkEnv(baseEnv, { mode, approved }) {
  const env = { ...baseEnv }
  delete env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK
  if (mode === 'live') {
    if (approved !== true) throw new Error('provider network permission requires --mode live --approved')
    env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK = 'true'
  }
  return env
}

// Capture integrity: a technically successful live attempt must have at least one captured call, every
// call complete (normalized, wire and output under one callId) and no record without a callId. A failure
// is reported and the attempt is kept as it is; nothing is rerun. Preflight capture is not assessed.
export function captureIntegrity(cell, mode) {
  if (mode !== 'live') return { assessed: false, ok: null, reasons: ['preflight: provider calls are served by the test hook, so there is no provider capture'] }
  if (!cell?.technicalOk) return { assessed: false, ok: null, reasons: ['not technically successful: reported under technical success'] }
  const capture = cell.capture || {}
  const reasons = []
  if (!capture.calls) reasons.push('no captured provider call')
  if (capture.calls && capture.callsComplete !== capture.calls) reasons.push(`${capture.calls - capture.callsComplete} of ${capture.calls} calls lack a normalized, wire or output record`)
  if (capture.recordsWithoutCallId) reasons.push(`${capture.recordsWithoutCallId} capture records without a callId`)
  if (cell.arm === 'one' && !capture.toolLoopTurns) reasons.push('no captured single-outfit tool-loop turn')
  return { assessed: true, ok: reasons.length === 0, reasons }
}
