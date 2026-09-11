// Canonical owner of environmental presence decisions.
// See docs/exposure-conditions-spec.md and docs/cold-severity-spec.md.
//
// Consumes canonical ExposureContext from exposure.js (which carries conditions, exertion,
// exposureMode, and severeColdEvidence). Computes no weather data, resolves no location,
// and parses no prose.

/**
 * @typedef {'required' | 'recommended' | 'not_needed' | 'unknown'} ColdPresenceState
 *
 * @typedef {Object} ColdPresenceVerdict
 * @property {ColdPresenceState} state
 * @property {Object} evidence
 * @property {number|null} evidence.wakingLowF
 * @property {number|null} evidence.wakingHighF
 * @property {string} evidence.exertion
 * @property {string} evidence.exposureMode
 * @property {boolean} evidence.isSevereCold
 * @property {string|null} evidence.severeBasis
 * @property {string} rationale
 */

/**
 * Resolves whether an outfit requires, is recommended, or does not need a cold-weather layer.
 * Evaluates canonical exposureContext.
 *
 * @param {Object} exposureContext  ExposureContext from exposure.js
 * @returns {ColdPresenceVerdict}
 */
export function resolveColdLayerPresenceRequirement(exposureContext = null) {
  const conditions = exposureContext?.conditions
  const exposureMode = exposureContext?.exposureMode || 'unknown'
  const exertion = exposureContext?.exertion || 'unknown'
  const wakingLowF = Number.isFinite(conditions?.wakingLowF) ? conditions.wakingLowF : null
  const wakingHighF = Number.isFinite(conditions?.wakingHighF) ? conditions.wakingHighF : null
  const severeEvidence = exposureContext?.severeColdEvidence || {}
  const isSevereCold = Boolean(severeEvidence.applies)
  const severeBasis = severeEvidence.basis || null

  const evidence = {
    wakingLowF,
    wakingHighF,
    exertion,
    exposureMode,
    isSevereCold,
    severeBasis,
  }

  // 1. Indoor destination base outfit -> not_needed
  // An indoor destination excuses the BASE outfit from requiring a cold layer.
  // Transit exposure to and from the venue is evaluated independently by Contract D / transit
  // checks in outfitEnvironmentalAdequacy.js (weather.transitIsCold, transitNeedsRemovableCoolLayer).
  if (exposureMode === 'indoor_destination') {
    return {
      state: 'not_needed',
      applies: false,
      evidence,
      rationale: 'indoor destination base (transit evaluated independently)',
    }
  }

  // 2. Verified severe cold outdoor exposure -> required
  if (isSevereCold) {
    return {
      state: 'required',
      applies: true,
      evidence,
      rationale: 'severe cold outdoor exposure',
    }
  }

  // 3. Unverified qualitative cold statement / band -> recommended (advisory only)
  if (conditions?.temperatureBand === 'cold') {
    return {
      state: 'recommended',
      applies: false,
      evidence,
      rationale: 'unverified qualitative cold statement (advisory recommended)',
    }
  }

  // 4. Qualitative warm or mild conditions -> not_needed
  if (conditions?.temperatureBand === 'hot' || conditions?.temperatureBand === 'mild') {
    return {
      state: 'not_needed',
      applies: false,
      evidence,
      rationale: 'qualitative warm/mild conditions',
    }
  }

  // 5. Unknown / unavailable conditions -> unknown (zero hard rejections)
  if (!conditions || !conditions.known || wakingLowF === null) {
    return {
      state: 'unknown',
      applies: false,
      evidence,
      rationale: 'conditions unavailable',
    }
  }

  // 4. Mild weather (wakingLowF >= 55°F) -> not_needed
  // Proposed advisory calibration: wakingLowF >= 55°F is mild enough that no layer is recommended.
  if (wakingLowF >= 55) {
    return {
      state: 'not_needed',
      applies: false,
      evidence,
      rationale: 'mild weather',
    }
  }

  // 5. Ordinary cool/cold exposure (< 55°F) -> recommended
  // Proposed advisory calibration (pending owner ratification): unknown duration means
  // ordinary cool exposure is advisory only (produces WARM_LAYER_RECOMMENDED), zero hard invalidity.
  return {
    state: 'recommended',
    applies: false,
    evidence,
    rationale: 'ordinary cool/cold exposure with unknown duration (proposed advisory calibration)',
  }
}
