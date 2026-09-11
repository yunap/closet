// Matzarakis PET (Physiological Equivalent Temperature) Biometeorological Scale
//
// Ground-truth biometeorological thermal index based on the Munich Energy-balance Model for
// Individuals (MEMI) (Matzarakis & Mayer 1996; Matzarakis et al. 1999).
// Standardized for human energy balance under ordinary sedentary/light activity (80 W) with
// clothing adaptation.
//
// This module is the SINGLE AUTHORITATIVE DEFINITION for temperature boundaries across the styling engine.
// All flows (weather.js, thermalDemand.js, rules.js, outfitSetPlanner.js, outfitEnvironmentalAdequacy.js)
// derive their thermal thresholds from here rather than inventing ad-hoc constants.

export const PET_BANDS = {
  VERY_COLD: {
    key: 'very_cold',
    label: 'Very Cold',
    stress: 'extreme_cold_stress',
    minC: -Infinity,
    maxC: 4,
    minF: -Infinity,
    maxF: 39,
    demandLevel: 'very warm',
    dressingGuidance: 'Heavy winter coat, down parka, thermal underwear, wool accessories',
    requiresOuterwear: true,
  },
  COLD: {
    key: 'cold',
    label: 'Cold',
    stress: 'strong_cold_stress',
    minC: 4,
    maxC: 8,
    minF: 39,
    maxF: 46,
    demandLevel: 'warm',
    dressingGuidance: 'Wool coat, winter jacket, heavy knitwear or intentional 3-layer system',
    requiresOuterwear: true,
  },
  COOL: {
    key: 'cool',
    label: 'Cool',
    stress: 'moderate_cold_stress',
    minC: 8,
    maxC: 13,
    minF: 46,
    maxF: 55,
    demandLevel: 'warm',
    dressingGuidance: 'Outerwear layer required (trench, fleece, jacket, leather jacket) over base',
    requiresOuterwear: true,
  },
  SLIGHTLY_COOL: {
    key: 'slightly_cool',
    label: 'Slightly Cool',
    stress: 'slight_cold_stress',
    minC: 13,
    maxC: 18,
    minF: 55,
    maxF: 64,
    demandLevel: 'moderate',
    dressingGuidance: 'Midweight layer required (chunky sweater, cardigan, hoodie, light jacket)',
    requiresOuterwear: false,
    needsRemovableCoolLayer: true,
  },
  COMFORTABLE: {
    key: 'comfortable',
    label: 'Comfortable',
    stress: 'thermal_neutrality',
    minC: 18,
    maxC: 23,
    minF: 64,
    maxF: 73,
    demandLevel: 'light',
    dressingGuidance: 'Transitional light layer or long sleeves (light cardigan, button-down, lightweight knit)',
    requiresOuterwear: false,
    needsRemovableCoolLayer: false,
  },
  SLIGHTLY_WARM: {
    key: 'slightly_warm',
    label: 'Slightly Warm',
    stress: 'slight_heat_stress',
    minC: 23,
    maxC: 29,
    minF: 73,
    maxF: 84,
    demandLevel: 'very light',
    dressingGuidance: 'Single breathable layer (short sleeves, lightweight cotton or linen blend)',
    requiresOuterwear: false,
    needsRemovableCoolLayer: false,
  },
  HOT: {
    key: 'hot',
    label: 'Hot',
    stress: 'moderate_to_strong_heat_stress',
    minC: 29,
    maxC: Infinity,
    minF: 84,
    maxF: Infinity,
    demandLevel: 'very light',
    dressingGuidance: 'Summer linen, sleeveless tops, tanks, shorts, airy dresses',
    requiresOuterwear: false,
    needsRemovableCoolLayer: false,
  },
}

export const PET_BAND_ORDER = [
  PET_BANDS.VERY_COLD,
  PET_BANDS.COLD,
  PET_BANDS.COOL,
  PET_BANDS.SLIGHTLY_COOL,
  PET_BANDS.COMFORTABLE,
  PET_BANDS.SLIGHTLY_WARM,
  PET_BANDS.HOT,
]

export const EXTREME_HEAT_F = 100

// Canonical temperature thresholds derived from the PET scale:
export const COLD_THRESHOLD_F = PET_BANDS.COOL.minF // 46°F: below this is strong/extreme cold stress (isCold)
export const SEVERE_COLD_THRESHOLD_F = PET_BANDS.COLD.minF // 39°F: below this is extreme cold stress (isColdSevere)
export const COOL_LAYER_THRESHOLD_F = PET_BANDS.COMFORTABLE.minF // 64°F: below this warrants a removable cool or midweight layer
export const WARM_THRESHOLD_F = PET_BANDS.SLIGHTLY_WARM.minF // 73°F: at or above this is warm/hot weather (isHot)
export const HOT_THRESHOLD_F = PET_BANDS.HOT.minF // 84°F: at or above this is high summer heat

/**
 * Classifies a single Fahrenheit temperature into its corresponding Matzarakis PET band.
 * @param {number} tempF
 * @returns {object|null} PET band definition or null if non-numeric
 */
export function classifyPetTemperature(tempF) {
  if (!Number.isFinite(tempF)) return null
  for (const band of PET_BAND_ORDER) {
    if (tempF < band.maxF) return band
  }
  return PET_BANDS.HOT
}

/**
 * Classifies a Fahrenheit temperature range (e.g. daytime high and waking low) across the PET scale.
 * @param {object} range { highF, lowF }
 * @param {object} options { exclusive: boolean }
 * @returns {object}
 */
export function classifyPetRange({ highF, lowF } = {}, { exclusive = true } = {}) {
  const high = Number.isFinite(highF) ? highF : (Number.isFinite(lowF) ? lowF : null)
  const low = Number.isFinite(lowF) ? lowF : (Number.isFinite(highF) ? highF : null)

  if (high === null && low === null) {
    return {
      highBand: null,
      lowBand: null,
      isHot: false,
      isCold: false,
      isColdSevere: false,
      isExtremeHeat: false,
      needsRemovableCoolLayer: false,
    }
  }

  const highBand = classifyPetTemperature(high)
  const lowBand = classifyPetTemperature(low)

  // In the PET scale:
  // - isHot: high temperature is in Slightly Warm (>= 73°F) or Hot (>= 84°F)
  // - isCold: low temperature is in Cold (< 46°F) or Very Cold (< 39°F)
  // - isColdSevere: low temperature is in Very Cold (< 39°F)
  // - needsRemovableCoolLayer: low drops into Slightly Cool (< 64°F) or Cool (< 55°F)
  const isHotRaw = high >= WARM_THRESHOLD_F
  const isColdRaw = low < COLD_THRESHOLD_F
  const isColdSevere = low < SEVERE_COLD_THRESHOLD_F
  const isExtremeHeat = high >= EXTREME_HEAT_F
  const needsRemovableCoolLayer = low < COOL_LAYER_THRESHOLD_F && !isColdRaw

  let isHot = isHotRaw
  let isCold = isColdRaw

  if (exclusive) {
    isHot = isHotRaw && !isColdRaw
    isCold = isColdRaw && !isHotRaw
  }

  return {
    highBand,
    lowBand,
    isHot,
    isCold,
    isColdSevere,
    isExtremeHeat,
    needsRemovableCoolLayer,
    highF: high,
    lowF: low,
  }
}

/**
 * Maps a PET band key to the corresponding 5-level thermal demand level
 * ('very light' | 'light' | 'moderate' | 'warm' | 'very warm').
 * @param {string} bandKey
 * @returns {string}
 */
export function petBandToThermalDemand(bandKey) {
  const normalized = String(bandKey || '').toLowerCase().trim()
  for (const band of PET_BAND_ORDER) {
    if (band.key === normalized) return band.demandLevel
  }
  return 'moderate'
}

// Biometeorological sedentary thermal demand boundaries matching Matzarakis PET scale
export const SEDENTARY_DEMAND_F = [
  { atOrAbove: WARM_THRESHOLD_F, level: 'very light' }, // >= 73°F (Slightly Warm & Hot)
  { atOrAbove: COOL_LAYER_THRESHOLD_F, level: 'light' }, // >= 64°F (Comfortable / Neutral)
  { atOrAbove: PET_BANDS.SLIGHTLY_COOL.minF, level: 'moderate' }, // >= 55°F (Slightly Cool)
  { atOrAbove: SEVERE_COLD_THRESHOLD_F, level: 'warm' }, // >= 39°F (Cold & Cool)
  { atOrAbove: -Infinity, level: 'very warm' }, // < 39°F (Very Cold / Extreme Cold Stress)
]

