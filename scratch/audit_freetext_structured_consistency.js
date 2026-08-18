// Q3 — Internal consistency: does garment_intelligence free text contradict the structured
// fields sitting right next to it in the same tag response?
//
// The bug that started this whole audit plan: a piece's failure_risks referenced a tuck scenario
// (`"ribbed hem may bunch if tucked"`) that its own tuck_behavior (`wear_over_only`) and
// length_hits_at (`tunic`) had already ruled out as physically impossible. Nothing validates that
// garment_intelligence's five free-text surfaces agree with the structured fields on the same piece.
//
// This is a FIRST-PASS heuristic scan, not a full contradiction detector (that's a stretch goal
// per the plan). It flags candidates by keyword co-occurrence for a human to actually read — the
// same shape as the original finding, generalized. False positives are expected and fine; false
// negatives (missed real contradictions) are the risk to watch for for a first pass.
//
// Read-only. No model call.

import { db, parsePiece } from '../db.js'
import { pieceStyleProfile, pieceGarmentIntelligence } from '../styling-engine/rules.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
console.log(`wardrobe: ${pieces.length} active pieces\n`)

// Two different kinds of free text, and conflating them is exactly what produced Check 2's first
// draft (72 near-all-false-positive hits): "needs a structured top" in pairing_requirements is a
// statement about a PARTNER piece, not a claim about this piece's own fit_on_body. Only
// self-describing text is a valid contradiction candidate against this piece's own structured
// fields; pairing-facing text is a candidate only for the tuck check, where a stray mention is
// still worth a glance.
const selfDescribingTextOf = (piece) => {
  const gi = pieceGarmentIntelligence(piece)
  const profile = pieceStyleProfile(piece)
  return [
    ...gi.failureRisks,
    ...Object.values(gi.realWearNotes || {}),
    profile?.style_notes?.risk,
    profile?.style_notes?.best_use
  ].filter(Boolean).map(String)
}
const pairingFacingTextOf = (piece) => {
  const gi = pieceGarmentIntelligence(piece)
  return [
    ...gi.pairingRequirements,
    ...gi.doNotPairRules,
    ...gi.formulaCompatibility
  ].filter(Boolean).map(String)
}
const freeTextOf = (piece) => [...selfDescribingTextOf(piece), ...pairingFacingTextOf(piece)]

// --- Check 1: tuck-behavior contradictions -----------------------------------------------------
// wear_over_only means tucking is not a live possibility; any free-text mention of tucking on such
// a piece is worth a human read, the same shape as the original bug.
const TUCK_MENTION = /\btuck(ed|ing)?\b/i
const tuckCandidates = []
for (const p of pieces) {
  const tuckBehavior = p.tuck_behavior
  if (tuckBehavior !== 'wear_over_only') continue
  for (const text of freeTextOf(p)) {
    if (TUCK_MENTION.test(text)) {
      tuckCandidates.push({ id: p.id, name: p.name, tuck_behavior: tuckBehavior, length_hits_at: p.length_hits_at, text })
    }
  }
}

console.log(`--- Check 1: tuck-related free text on a wear_over_only piece (${tuckCandidates.length}) ---`)
console.log('Not automatically a contradiction — "don\'t tuck this" is a VALID sentence on a')
console.log('wear_over_only piece. Flagged for a human to confirm the sentence agrees with the field')
console.log('rather than contradicting it (the original bug read as agreeing at a glance).\n')
for (const c of tuckCandidates) {
  console.log(`  piece ${c.id} "${c.name}" (length_hits_at: ${c.length_hits_at})`)
  console.log(`    "${c.text}"`)
}

// --- Check 2: fit/drape word choice vs. fit_on_body ---------------------------------------------
// fit_on_body is an enum describing how the garment sits: clings_stretchy/clings_drapey/skims/
// hangs_straight/drapes/structured. Free text calling a piece "structured"/"stiff"/"boxy" while
// fit_on_body says it clings or drapes (or vice versa) is the same class of bug as the tuck one —
// the prose contradicts the schema's own answer.
const STRUCTURED_WORDS = /\b(structured|stiff|boxy|rigid|holds its shape)\b/i
const CLINGY_DRAPEY_WORDS = /\b(clings?|clingy|drapes?|drapey|skims?|flowy|fluid)\b/i
const fitCandidates = []
for (const p of pieces) {
  const fit = p.fit_on_body
  if (!fit) continue
  for (const text of selfDescribingTextOf(p)) {
    const saysStructured = STRUCTURED_WORDS.test(text)
    const saysClingyDrapey = CLINGY_DRAPEY_WORDS.test(text)
    const fieldIsStructured = fit === 'structured' || fit === 'hangs_straight'
    const fieldIsClingyDrapey = ['clings_stretchy', 'clings_drapey', 'skims', 'drapes'].includes(fit)
    if ((saysStructured && fieldIsClingyDrapey) || (saysClingyDrapey && fieldIsStructured)) {
      fitCandidates.push({ id: p.id, name: p.name, fit_on_body: fit, text })
    }
  }
}

console.log(`\n--- Check 2: fit/drape word choice vs. fit_on_body (${fitCandidates.length}) ---`)
for (const c of fitCandidates) {
  console.log(`  piece ${c.id} "${c.name}" (fit_on_body: ${c.fit_on_body})`)
  console.log(`    "${c.text}"`)
}

// --- Check 3: length words vs. length_hits_at ----------------------------------------------------
// A crude length-word scan. Genuinely crude — "cropped" in a pairing_requirements sentence about
// what to pair WITH (e.g. "needs a cropped jacket on top") is not a self-contradiction, so this
// needs a human read even more than the other two checks. Kept as a candidate list, not a verdict.
const LENGTH_WORDS = {
  cropped: /\bcropped?\b/i,
  tunic: /\btunic\b/i,
  midi: /\bmidi\b/i,
  maxi: /\bmaxi\b/i,
  mini: /\bmini\b/i,
  full_length: /\bfull[- ]length\b|\bfloor[- ]length\b/i
}
const lengthCandidates = []
for (const p of pieces) {
  const len = p.length_hits_at
  if (!len) continue
  for (const text of selfDescribingTextOf(p)) {
    for (const [word, re] of Object.entries(LENGTH_WORDS)) {
      if (word === len) continue // matching word, not a conflict
      if (re.test(text)) {
        lengthCandidates.push({ id: p.id, name: p.name, length_hits_at: len, mentionedWord: word, text })
      }
    }
  }
}

console.log(`\n--- Check 3: a DIFFERENT length word than length_hits_at appears in free text (${lengthCandidates.length}) ---`)
console.log('Highest false-positive rate of the three checks — read each one, do not batch-act.\n')
for (const c of lengthCandidates) {
  console.log(`  piece ${c.id} "${c.name}" (length_hits_at: ${c.length_hits_at}, text says "${c.mentionedWord}")`)
  console.log(`    "${c.text}"`)
}

console.log(`\n=== Summary: ${tuckCandidates.length} tuck candidates, ${fitCandidates.length} fit candidates, ${lengthCandidates.length} length candidates — all need a human read, none is auto-confirmed. ===`)
