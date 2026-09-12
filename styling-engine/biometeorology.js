// Owner-Calibrated Ambient Thermal Scale
//
// Ambient temperature scale inspired by biometeorological comfort reporting categories
// (Matzarakis sedentary baseline). This scale classifies ambient temperature ranges and
// maps them to thermal demand levels. It does NOT compute physiological PET (which requires
// mean radiant temperature, air velocity, relative humidity, and metabolic rate).
//
// This module defines neutral ambient category boundaries and sedentary demand levels.
// It emits NO garment prescriptions and NO physiological stress claims.

export const PET_BANDS = {
  VERY_COLD: {
    key: 'very_cold',
    label: 'Very Cold',
    minC: -Infinity,
    maxC: 4,
    minF: -Infinity,
    maxF: 39,
    demandLevel: 'very warm',
  },
  COLD: {
    key: 'cold',
    label: 'Cold',
    minC: 4,
    maxC: 8,
    minF: 39,
    maxF: 46,
    demandLevel: 'warm',
  },
  COOL: {
    key: 'cool',
    label: 'Cool',
    minC: 8,
    maxC: 13,
    minF: 46,
    maxF: 55,
    demandLevel: 'warm',
  },
  SLIGHTLY_COOL: {
    key: 'slightly_cool',
    label: 'Slightly Cool',
    minC: 13,
    maxC: 18,
    minF: 55,
    maxF: 64,
    demandLevel: 'moderate',
    needsRemovableCoolLayer: true,
  },
  COMFORTABLE: {
    key: 'comfortable',
    label: 'Comfortable',
    minC: 18,
    maxC: 23,
    minF: 64,
    maxF: 73,
    demandLevel: 'light',
    needsRemovableCoolLayer: false,
  },
  SLIGHTLY_WARM: {
    key: 'slightly_warm',
    label: 'Slightly Warm',
    minC: 23,
    maxC: 29,
    minF: 73,
    maxF: 84,
    demandLevel: 'very light',
    needsRemovableCoolLayer: false,
  },
  HOT: {
    key: 'hot',
    label: 'Hot',
    minC: 29,
    maxC: Infinity,
    minF: 84,
    maxF: Infinity,
    demandLevel: 'very light',
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

// Canonical ambient temperature thresholds:
export const COLD_THRESHOLD_F = PET_BANDS.COOL.minF // 46°F: ambient threshold for Cold band
export const SEVERE_COLD_THRESHOLD_F = PET_BANDS.COLD.minF // 39°F: ambient threshold for Very Cold band
export const COOL_LAYER_THRESHOLD_F = PET_BANDS.COMFORTABLE.minF // 64°F: below this warrants a removable cool or midweight layer
export const WARM_THRESHOLD_F = PET_BANDS.SLIGHTLY_WARM.minF // 73°F: at or above this is warm weather (isHot)
export const HOT_THRESHOLD_F = PET_BANDS.HOT.minF // 84°F: at or above this is hot weather

/**
 * Classifies a single Fahrenheit temperature into its corresponding ambient band.
 * @param {number} tempF
 * @returns {object|null} band definition or null if non-numeric
 */
export function classifyPetTemperature(tempF) {
  if (!Number.isFinite(tempF)) return null
  for (const band of PET_BAND_ORDER) {
    if (tempF < band.maxF) return band
  }
  return PET_BANDS.HOT
}

/**
 * Classifies a Fahrenheit temperature range across ambient comfort bands.
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
 * Maps a band key to the corresponding 5-level thermal demand level
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

// Ambient sedentary thermal demand boundaries inspired by biometeorological comfort reporting
export const SEDENTARY_DEMAND_F = [
  { atOrAbove: WARM_THRESHOLD_F, level: 'very light' }, // >= 73°F
  { atOrAbove: COOL_LAYER_THRESHOLD_F, level: 'light' }, // >= 64°F
  { atOrAbove: PET_BANDS.SLIGHTLY_COOL.minF, level: 'moderate' }, // >= 55°F
  { atOrAbove: SEVERE_COLD_THRESHOLD_F, level: 'warm' }, // >= 39°F
  { atOrAbove: -Infinity, level: 'very warm' }, // < 39°F
]
