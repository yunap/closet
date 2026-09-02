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
import { confidenceFromProfile } from './taggerMerge.js'

export const OUTERWEAR_CAPABILITY_VERDICTS = ['pass', 'insufficient', 'unknown']

// Stable finding codes (spec §18). Consumers and diagnostics match on these, never on prose.
export const OUTERWEAR_CAPABILITY_CODES = {
  UNKNOWN: 'outerwear_capability_unknown',
  INDOOR_ROLE_INSUFFICIENT: 'outerwear_indoor_role_insufficient_for_outdoor_exposure',
  RAIN_MISSING: 'outerwear_rain_protection_missing',
  WIND_MISSING: 'outerwear_wind_protection_missing',
  HAZARD_UNKNOWN: 'outerwear_hazard_protection_unknown',
}


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
  return {
    weatherProtection: pieceWeatherProtection(piece),
    capabilityTagged: pieceWentThroughCapabilityTagging(piece),
  }
}

// "Has this piece been through capability tagging at all?" — NOT a garment fact, and deliberately
// not one. weather_protection column-defaults to '[]', so an empty array alone cannot distinguish
// "the tagger looked and found no protective construction" (real evidence of absence) from "nothing
// ever asked" (no evidence at all).
//
// Until 2026-09-02 a populated `outerwear_role` was that proxy. The field is retired
// (docs/outerwear-role-ontology-spec.md) and the tagger no longer emits it, so on its own it would
// have marked every NEWLY tagged piece as never-tagged — silently turning the rain/wind hazard
// checks into `unknown` for everything going forward. Measured while making that change; it would
// not have failed a test.
//
// So: the tagger's own confidence entry for weather_protection answers it for anything tagged since
// that field joined CONFIDENCE_FIELDS, and the legacy column answers it for older rows. Measured on
// the real wardrobe: only 6 of 33 outerwear pieces carry the confidence entry, so dropping the
// legacy read would have moved 27 pieces to unknown.
//
// The legacy column is consulted ONLY as "this row went through an earlier tagging generation".
// Its VALUE is never read, never compared, never projected, and never treated as garment evidence.
function pieceWentThroughCapabilityTagging(piece = {}) {
  if (confidenceFromProfile(piece, 'weather_protection')) return true
  return pieceOuterwearRole(piece) !== null
}

/**
 * Slice E — the ONE canonical rendering of these two facts for every model-facing projection.
 *
 * Returns display strings, not sentences: the manifest, the truth text and the tool rows each apply
 * their own house formatting around these values, but none of them decides what the values MEAN.
 * That is the §10 rule — projection code transmits canonical facts, it does not own their meaning —
 * and the reason it exists is that three projections each writing their own gloss of
 * "indoor_layer" is how a field acquires three meanings.
 *
 * Both are null when absent, so a projection can omit the clause entirely rather than printing an
 * empty label. Non-outerwear pieces get null for the same reason: the readers are category-gated.
 */
export function outerwearCapabilityDisplay(piece = {}) {
  const { weatherProtection } = pieceOuterwearCapabilityFacts(piece)
  // `role` was removed 2026-09-02 with the field's retirement. Projecting it would have kept
  // showing models a deprecated taxonomy — and an actively misleading one, since indoor_layer was
  // over-applied to technical jackets.
  return {
    protection: weatherProtection.length ? weatherProtection.join('/') : null,
  }
}

/**
 * @param {object} piece
 * @param {object} requirement
 * @param {string[]} requirement.requiredHazards     hazards ('rain'/'wind') the context needs covered
 * @returns {{verdict: string, findings: Array<{code, dimension, reason, evidence}>, evidence: object}}
 */
export function evaluateOuterwearCapability(piece = {}, requirement = {}) {
  const { requiredHazards = [] } = requirement
  const { weatherProtection: protection, capabilityTagged } = pieceOuterwearCapabilityFacts(piece)

  // capabilityTagged is the proxy for "this piece has been through capability tagging at all". weather_protection
  // column-defaults to '[]', so an empty array cannot by itself distinguish "the tagger looked and
  // found no protective construction" (real evidence of absence) from "nothing ever asked"
  // (no evidence at all). A populated role is what separates them. Measured live 2026-08-31: one
  // wardrobe piece was stored as outerwear while the tagger read it as a top (a pullover fleece,
  // resolved by an owner ruling) — a piece in that state must read as unknown, never as one that
  // failed.

  const findings = []
  const evidence = { weatherProtection: protection, capabilityTagged }

  const hazards = [...new Set((Array.isArray(requiredHazards) ? requiredHazards : [])
    .filter(h => h === 'rain' || h === 'wind'))]

  if (!capabilityTagged) {
    // Unknown is never insufficiency (spec §9, acceptance criterion 8). Report it once, with the
    // dimensions that could not be answered, and let the caller fall back to concrete garment
    // facts and the thermal owner.
    if (hazards.length) {
      findings.push({
        code: OUTERWEAR_CAPABILITY_CODES.UNKNOWN,
        dimension: 'weather_protection',
        reason: 'this piece has never been through capability tagging, so its hazard protection is unknown — judge it from construction and thermal evidence instead',
        evidence,
      })
    }
    return { verdict: 'unknown', findings, evidence }
  }

  let insufficient = false

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
