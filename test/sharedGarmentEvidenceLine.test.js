// SHARED GARMENT EVIDENCE (docs/garment-evidence-parity-2026-09-15.md §7). The default path: Whole Wardrobe, /ask
// single_outfit (catalog and view_pieces truth) and trip composition give the model the SAME compact, physical fact line for a
// garment — known sleeve length, explicit unknown fibre, whole-garment grouping, low-confidence `?` markers, no derived warmth,
// thermal benchmark, weather verdict or prose — plus selective, source-labelled garment notes in a separate channel.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-evidence-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { sharedGarmentEvidenceFacts, sharedGarmentEvidenceLine, garmentNotesText, garmentNotesEntry, garmentNotesBlock, taggerNotesText, garmentEvidenceFields, decodeGarmentFactLine, decodeSparseCatalogFacts, sparseGarmentCatalogRow } = await import('../styling-engine/garmentEvidenceLine.js')
const { db } = await import('../db.js')
const { _clearRuleProvenanceCacheForTests } = await import('../styling-engine/ruleProvenance.js')
const { singleOutfitStylistCatalogLine } = await import('../styling-engine/tools.js')
const { tripPlanTruthCatalog, tripPlanPieceNotes } = await import('../routes/ai.js')

// Recorded facts as held in the frozen Stage 2 snapshot (subset of fields).
const TOP137 = { id: 137, name: 'black and cream striped knit top', category: 'top', fabric_category: 'cotton', fiber_content: ['cotton', 'spandex'], fabric_weight: 'medium', fit_on_body: 'clings_stretchy', silhouette: 'fitted', length_hits_at: 'hip', sleeve_length: 'short', neckline: 'boat', tuck_behavior: 'tucks_anywhere', opacity: 'opaque', reads_as: 'classic nautical stripe', colors: ['cream', 'black'], pattern_type: 'stripe', pattern_scale: 'medium', pattern_complexity: 'medium', formality: 'everyday', season: 'year-round' }
const SHOE198 = { id: 198, name: 'taupe knit lace-up sneakers', category: 'shoes', fabric_category: 'woven', fiber_content: [], visual_weight: 'slim', shoe_type: 'sneaker', walk_support: 'medium', reads_as: 'textured knit sneakers' }
const JEANS110 = { id: 110, name: 'white slim crop jeans', category: 'bottom', bottom_subtype: 'pants', fabric_category: 'denim', fiber_content: ['cotton', 'spandex', 'unknown'], fabric_weight: 'medium', length_hits_at: 'full_length', style_profile_json: { _confidence: { length_hits_at: 'low' } } }
const PANTS125 = { id: 125, name: 'light cream linen relaxed pants', category: 'bottom', bottom_subtype: 'pants', fabric_category: 'linen blend', fiber_content: ['linen'], fabric_weight: 'medium', length_hits_at: 'full_length', reads_as: 'relaxed cropped pants', style_profile_json: { _confidence: { length_hits_at: 'manual' } } }
const JACKET = { id: 996767, name: 'olive green lightweight jacket', category: 'outerwear', fabric_category: 'cotton', fiber_content: ['cotton'], fabric_weight: 'medium', sleeve_length: 'long', interior_construction: 'unlined', insulating_layer_materials: [], weather_protection: ['wind'] }
const NO_SLEEVE_TOP = { id: 9001, name: 'untagged top', category: 'top', fabric_weight: 'light' }
// Stored-rule shapes found in the provenance audit (§2a): a plain stored rule, a generated occasion receipt, a retired
// outfit-reaction copy, and a saved chat reply. The saved reply is identified by its source — a chat message the retired Save
// button marked in `savedIndices` — not by its content.
const SAVED_REPLY = '![Board](sandbox:/uploads/generated-boards/b.png)\n\nThe orange tank does exactly what we wanted. Want to swap the shoes?'
const STORED = ['This cardigan is clingy and needs a very thin base layer.', 'Excluded from hiking by Yuna (2026-07-07)', '[feedback:works] (usable variation) This pairing offers a clean silhouette.', SAVED_REPLY]
db.prepare('INSERT INTO chat_threads (id, title, payload) VALUES (?, ?, ?)').run('thread_saved_reply', 't', JSON.stringify({ messages: [{ role: 'user', text: 'style it' }, { role: 'assistant', text: SAVED_REPLY }], savedIndices: [1] }))
_clearRuleProvenanceCacheForTests()


test('FACT LINE: known sleeve length is stated, and an unrecorded sleeve length or fibre is stated as unknown', () => {
  assert.match(sharedGarmentEvidenceFacts(TOP137), /sleeves short/)
  assert.match(sharedGarmentEvidenceFacts(TOP137), /fibre cotton, spandex/)
  assert.match(sharedGarmentEvidenceFacts(NO_SLEEVE_TOP), /sleeves unknown/)
  assert.match(sharedGarmentEvidenceFacts(SHOE198), /fibre unknown/, 'an empty fibre record is stated as unknown')
  assert.doesNotMatch(sharedGarmentEvidenceFacts(SHOE198), /wool/)
  assert.match(sharedGarmentEvidenceFacts(JEANS110), /fibre cotton, spandex, unknown/, 'a partly unknown fibre record keeps its unknown')
})

test('FACT LINE: whole-garment fields are grouped, low-confidence values are marked, owner manual values are not', () => {
  assert.match(sharedGarmentEvidenceFacts(TOP137), /whole garment: weight medium, fit clings_stretchy/)
  assert.match(sharedGarmentEvidenceFacts(JEANS110), /length full_length\?/)
  assert.match(sharedGarmentEvidenceFacts(PANTS125), /length full_length(;|$)/)
  assert.doesNotMatch(sharedGarmentEvidenceFacts(PANTS125), /\?/)
  assert.match(sharedGarmentEvidenceFacts(JACKET), /insulating layer none; interior unlined/)
  assert.match(sharedGarmentEvidenceFacts({ ...JACKET, insulating_layer_materials: null }), /insulating layer not recorded/)
})

test('FACT LINE: compact and physical — no prose, rules, rejections, notes, derived warmth or weather verdict', () => {
  const loaded = { ...TOP137, manual_overrides: ['reads_as'], notes: 'Fit: sits comfortably.', styling_rules_learned: STORED, tried_and_rejected: ['with the floral skirt'], style_profile_json: { garment_intelligence: { do_not_pair_rules: ['avoid another loud pattern'] } } }
  const facts = sharedGarmentEvidenceFacts(loaded)
  assert.equal(facts, sharedGarmentEvidenceFacts(TOP137), 'prose and stored memory never change the fact line')
  assert.doesNotMatch(facts, /nautical|impression|caution|rule|reject|authoritative|sits comfortably/i)
  for (const piece of [TOP137, SHOE198, JEANS110, PANTS125, JACKET]) {
    assert.doesNotMatch(sharedGarmentEvidenceFacts(piece), /\b(warmth|clo|PET|thermal|adequate|acceptable|recommended|ordered for these conditions|too warm|too cold|comfortable)\b/i)
  }
})

// Varied recorded shapes: unknown fibre and sleeves, low confidence, defaults present and absent, flags, outerwear insulation states,
// shoes, jewelry, provisional tags.
const RECONSTRUCTION_CASES = [
  TOP137, SHOE198, JEANS110, PANTS125, JACKET, NO_SLEEVE_TOP,
  { ...JACKET, id: 1, insulating_layer_materials: null },
  { ...JACKET, id: 2, insulating_layer_materials: ['down', 'polyester'], weather_protection: ['wind', 'rain'] },
  { id: 3, name: 'sheer blouse', category: 'top', fabric_category: 'chiffon', fiber_content: ['silk'], opacity: 'sheer', needs_base: 'yes', tuck_behavior: 'wear_over_only', sleeve_length: 'long', sleeve_shape: 'bishop', hem_finish: 'curved', formality: 'elevated', season: 'warm', tag_state: 'provisional', style_profile_json: { _confidence: { sleeve_shape: 'low', hem_finish: 'low' } } },
  { id: 4, name: 'untagged dress', category: 'dress' },
  { id: 5, name: 'gold pendant', category: 'accessory', accessory_subtype: 'jewelry', jewelry_type: 'necklace', necklace_length: 'long', colors: ['gold'], formality: 'elevated' },
  { id: 6, name: 'plain skirt', category: 'bottom', bottom_subtype: 'skirt', opacity: 'opaque', formality: 'everyday', season: 'year-round', waistband_type: 'elastic', length_hits_at: 'midi' },
]

test('SPARSE /ask ROW: reconstructs exactly the same facts and unknowns as the full fact line, including defaults and unrecorded defaults', () => {
  for (const piece of RECONSTRUCTION_CASES) {
    const fields = garmentEvidenceFields(piece)
    const rich = sharedGarmentEvidenceFacts(piece)
    const row = sparseGarmentCatalogRow(piece)
    assert.deepEqual(decodeGarmentFactLine(rich), fields, `full line decodes to the fields: ${rich}`)
    assert.deepEqual(decodeSparseCatalogFacts(row.slice(`#${piece.id} ${piece.name} | `.length)), fields, `sparse row decodes to the same fields: ${row}`)
    // The full line conveys an unrecorded default field by omission; the sparse row must spell it out as `:unknown`. Beyond those markers it is never longer.
    assert.ok(row.replace(/;?(opacity|tuck|pat|formal|season):unknown/g, '').length <= `#${piece.id} ${piece.name} | ${rich}`.length, `apart from explicit unknowns, the sparse row is never longer than the full line: ${row}`)
  }
  const untagged = sparseGarmentCatalogRow({ id: 4, name: 'untagged dress', category: 'dress' })
  assert.match(untagged, /fibre:unknown/)
  assert.match(untagged, /slv:unknown/)
  assert.match(untagged, /opacity:unknown/, 'an unrecorded field with a default is written as unknown, never omitted')
  assert.match(untagged, /formal:unknown/)
  assert.match(untagged, /season:unknown/)
  const defaults = sparseGarmentCatalogRow(RECONSTRUCTION_CASES.at(-1))
  assert.doesNotMatch(defaults, /opacity|formal|season/, 'recorded default values are omitted by convention')
  // Provisional tags make structure/fit fields low confidence (getFieldConfidence), so the recorded long sleeves carry `?` too; no
  // pattern is recorded on this fixture, so the default does not apply and the row says so.
  assert.match(sparseGarmentCatalogRow(RECONSTRUCTION_CASES[8]), /opacity:sheer;needs-base;slv:long\?;slvshape:bishop\?;tuck:wear_over_only;formal:elevated;season:warm;tags:provisional;pat:unknown$/)
})

test('GARMENT NOTES: selective saved records only; owner rules authoritative; receipts, retired copies and saved chat replies (by source) are not rules', () => {
  const notes = garmentNotesText({ ...PANTS125, styling_rules_learned: STORED, tried_and_rejected: ['with the floral skirt'], notes: 'Fit: relaxed.', style_profile_json: { garment_intelligence: { do_not_pair_rules: ['avoid another relaxed bottom'] } } })
  assert.equal(notes, 'RULES (authoritative): This cardigan is clingy and needs a very thin base layer.; REJECTED: with the floral skirt')
  assert.doesNotMatch(notes, /author not recorded|\[feedback:|sandbox:|orange tank|Excluded from|Fit: relaxed|tagger/)
  // The same text is only a rule candidate when no saved chat message is its source.
  assert.match(garmentNotesText({ id: 77, name: 'x', category: 'top', styling_rules_learned: ['The orange tank does exactly what we wanted.'] }), /RULES \(authoritative\): The orange tank/)
  assert.equal(garmentNotesText({ ...PANTS125, reads_as: '', styling_rules_learned: ['Roll the hem once', 'Wear with flats'] }), 'RULES (authoritative): Roll the hem once | Wear with flats', 'no receipt is needed for an owner rule to keep its authority')
  assert.match(garmentNotesText({ ...TOP137, reads_as: 'my go-to stripe', manual_overrides: ['reads_as'] }), /^description edited in the app \(author not recorded\): my go-to stripe$/, 'an edit is not proof of authorship')
  assert.equal(garmentNotesEntry(TOP137), '', 'tagger prose alone does not create a saved-record entry')
  assert.equal(taggerNotesText({ ...TOP137, style_profile_json: { garment_intelligence: { do_not_pair_rules: ['avoid another loud pattern'] } } }), 'tagger impression (not owner-verified): classic nautical stripe', 'tagger pairing cautions are not part of change 1 (a separate guidance change)')
  assert.equal(taggerNotesText({ ...TOP137, reads_as: 'my go-to stripe', manual_overrides: ['reads_as'] }), '', 'an edited description is a saved record, not a tagger note')
  assert.ok(!garmentNotesText({ ...TOP137, styling_rules_learned: ['Line one\n\nLine two'] }).includes('\n'), 'carried prose stays on one line')
  const block = garmentNotesBlock([{ ...TOP137, tried_and_rejected: ['with the floral skirt'] }, { id: 5, name: 'plain', category: 'top' }])
  assert.match(block, /^GARMENT NOTES[^\n]*\n- #137 black and cream striped knit top: REJECTED: with the floral skirt/)
  assert.doesNotMatch(block, /^ID \d+:|#5 plain/m)
})

test('SHARED EVIDENCE: Whole Wardrobe, /ask and trip give the same facts, and trip carries the same saved-record notes', () => {
  const withMemory = { ...TOP137, styling_rules_learned: ['Wear with a solid bottom'], tried_and_rejected: ['with the floral skirt'] }
  for (const piece of [TOP137, SHOE198, JEANS110, JACKET, withMemory]) {
    const facts = sharedGarmentEvidenceFacts(piece)
    assert.equal(sharedGarmentEvidenceLine(piece), `ID ${piece.id}: ${piece.name}; ${facts}`, 'Whole Wardrobe line')
    const row = singleOutfitStylistCatalogLine(piece)
    assert.equal(row, sparseGarmentCatalogRow(piece), '/ask catalog uses the sparse rendering')
    assert.deepEqual(decodeSparseCatalogFacts(row.slice(`#${piece.id} ${piece.name} | `.length)), decodeGarmentFactLine(facts), '/ask catalog row reconstructs the full fact line')
    // thread_1789585467294: trip's catalog line is the shared fact line plus each piece's recorded
    // occasions -- the one addition trip needs, since its roster spans multiple slot occasions rather
    // than one already-filtered request occasion (see docs/garment-evidence-parity-2026-09-15.md's
    // stated occasion-omission rationale, which does not hold for a multi-occasion trip roster).
    assert.equal(tripPlanTruthCatalog([piece])[0], `${sharedGarmentEvidenceLine(piece)} | occasions: unknown`, 'trip carries the same facts, plus its own recorded occasions')
  }
  assert.deepEqual(tripPlanPieceNotes([withMemory, TOP137]), [garmentNotesEntry(withMemory)], 'trip notes are the shared entries, only for roster pieces with saved records')
  assert.match(tripPlanPieceNotes([withMemory])[0], /RULES \(authoritative\): Wear with a solid bottom; REJECTED: with the floral skirt/)
})
