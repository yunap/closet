// Contract B of docs/outerwear-weather-consolidation-spec.md — the canonical, narrow verdict for
// **what environmental job an outerwear piece can legitimately perform**.
//
// This module answers one question and deliberately refuses two neighbouring ones:
//
//   - It does NOT interpret thermal warmth. That is Contract A, owned by pieceWeatherScores() /
//     weatherFitForPiece() in rules.js. A cashmere cardigan is thermally substantial AND an
//     indoor_layer; a rain shell is thermally light AND a protective_shell. Both facts are true at
//     once, and collapsing them is the defect this whole slice exists to remove.
//   - It does NOT decide whether an OUTFIT is adequate. That is Contract C
//     (evaluateOutfitEnvironmentalAdequacy), which composes this verdict with thermal evidence and
//     owns cold severity. Per owner ruling [O2], isColdSevere never appears in this file: a piece
//     cannot know how cold it is, only what job it is built for.
//
// The caller supplies a *requirement* — "I need an outdoor-capable outer layer", "I need rain
// protection" — which Contract C derives from resolved context. This module reports whether the
// piece's own tagged capability meets it. It is pure and deterministic: no weather prose, no
// dates, no location, no I/O.
//
// Eligibility boundary (spec §15 Slice C, [A2]): an `insufficient` verdict here is EVIDENCE, not a
// pool exclusion. A piece that cannot do the job alone may still belong in an outfit — a shell
// under-insulates until you put a sweater beneath it. Only Contract C may hard-fail.
import { pieceOuterwearRole, pieceWeatherProtection } from './attributes.js'

export const OUTERWEAR_CAPABILITY_VERDICTS = ['pass', 'insufficient', 'unknown']

// Stable finding codes (spec §18). Consumers and diagnostics match on these, never on prose.
export const OUTERWEAR_CAPABILITY_CODES = {
  UNKNOWN: 'outerwear_capability_unknown',
  INDOOR_ROLE_INSUFFICIENT: 'outerwear_indoor_role_insufficient_for_outdoor_exposure',
  RAIN_MISSING: 'outerwear_rain_protection_missing',
  WIND_MISSING: 'outerwear_wind_protection_missing',
  HAZARD_UNKNOWN: 'outerwear_hazard_protection_unknown',
}

// Which roles can serve as the outfit's actual outer layer outdoors. indoor_layer is the whole
// point of the field: it is real outerwear by category and contributes real warmth, but it is not
// what you put on to walk outside in weather. Note this says nothing about how MUCH cold the layer
// can handle — a transition_layer qualifies as outdoor-capable here and may still be too light for
// the day. That second judgment is Contract A's, applied by Contract C.
const OUTDOOR_CAPABLE_ROLES = new Set(['transition_layer', 'protective_shell', 'cold_weather_outerwear'])

const HAZARD_MISSING_CODE = {
  rain: OUTERWEAR_CAPABILITY_CODES.RAIN_MISSING,
  wind: OUTERWEAR_CAPABILITY_CODES.WIND_MISSING,
}

/**
 * The piece's raw capability facts, with no requirement applied and therefore no verdict.
 *
 * This is what the shared eligibility owner attaches to every candidate (Slice C): one canonical
 * reading of the two fields, so search, selected generation, whole-wardrobe, plan and capsule all
 * see the same facts without re-deriving the category guard. It deliberately produces no finding
 * and no judgment — under owner ruling [O2] the judgment is outfit-level, so there is nothing for
 * a per-piece pool to decide here and, by construction, nothing that could exclude a piece.
 */
export function pieceOuterwearCapabilityFacts(piece = {}) {
  const outerwearRole = pieceOuterwearRole(piece)
  return {
    outerwearRole,
    weatherProtection: pieceWeatherProtection(piece),
    capabilityTagged: outerwearRole !== null,
  }
}

/**
 * @param {object} piece
 * @param {object} requirement
 * @param {boolean} requirement.requireOutdoorLayer  the context needs a genuine outdoor outer layer
 * @param {string[]} requirement.requiredHazards     hazards ('rain'/'wind') the context needs covered
 * @returns {{verdict: string, findings: Array<{code, dimension, reason, evidence}>, evidence: object}}
 */
export function evaluateOuterwearCapability(piece = {}, requirement = {}) {
  const { requireOutdoorLayer = false, requiredHazards = [] } = requirement
  const { outerwearRole: role, weatherProtection: protection, capabilityTagged } =
    pieceOuterwearCapabilityFacts(piece)

  // capabilityTagged is the proxy for "this piece has been through capability tagging at all". weather_protection
  // column-defaults to '[]', so an empty array cannot by itself distinguish "the tagger looked and
  // found no protective construction" (real evidence of absence) from "nothing ever asked"
  // (no evidence at all). A populated role is what separates them. Measured live 2026-08-31: one
  // wardrobe piece was stored as outerwear while the tagger read it as a top (a pullover fleece,
  // resolved by an owner ruling) — a piece in that state must read as unknown, never as one that
  // failed.

  const findings = []
  const evidence = { outerwearRole: role, weatherProtection: protection, capabilityTagged }

  const hazards = [...new Set((Array.isArray(requiredHazards) ? requiredHazards : [])
    .filter(h => h === 'rain' || h === 'wind'))]

  if (!capabilityTagged) {
    // Unknown is never insufficiency (spec §9, acceptance criterion 8). Report it once, with the
    // dimensions that could not be answered, and let the caller fall back to concrete garment
    // facts and the thermal owner.
    if (requireOutdoorLayer || hazards.length) {
      findings.push({
        code: OUTERWEAR_CAPABILITY_CODES.UNKNOWN,
        dimension: 'outerwear_role',
        reason: 'this piece has no tagged outerwear capability, so its outdoor function and hazard protection are unknown — judge it from construction and thermal evidence instead',
        evidence,
      })
    }
    return { verdict: 'unknown', findings, evidence }
  }

  let insufficient = false

  if (requireOutdoorLayer && !OUTDOOR_CAPABLE_ROLES.has(role)) {
    insufficient = true
    findings.push({
      code: OUTERWEAR_CAPABILITY_CODES.INDOOR_ROLE_INSUFFICIENT,
      dimension: 'outerwear_role',
      reason: `${role} is a layer meant to stay wearable indoors; it contributes warmth but does not by itself serve as the outfit's outdoor outer layer`,
      evidence,
    })
  }

  for (const hazard of hazards) {
    if (protection.includes(hazard)) continue
    insufficient = true
    findings.push({
      code: HAZARD_MISSING_CODE[hazard],
      dimension: 'weather_protection',
      reason: `this layer has no tagged ${hazard} protection`,
      evidence,
    })
  }

  return { verdict: insufficient ? 'insufficient' : 'pass', findings, evidence }
}
