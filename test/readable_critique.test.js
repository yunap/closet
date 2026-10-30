import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-readable-critique-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { formatSharedOutfitEvaluation, CRITIQUE_DETAILS_DELIMITER, wholeWardrobeImagePrompt, wholeWardrobeComparisonSheetPrompt, garmentReferencePlan, normalizeGeneratedOutfitObject } = await import('../styling-engine/core.js')
const { buildPrompts } = await import('../styling-engine/prompts.js')
const { db } = await import('../db.js')
const WHOLE_WARDROBE_EVALUATOR_SYSTEM = buildPrompts().WHOLE_WARDROBE_EVALUATOR_SYSTEM
const OUTFIT_EVALUATION_FOLLOWUP_SYSTEM = buildPrompts().OUTFIT_EVALUATION_FOLLOWUP_SYSTEM

after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('final renders use worn and hanger evidence with distinct authority', () => {
  const refs = garmentReferencePlan({
    name: 'silk cardigan',
    category: 'top',
    photo: 'cardigan-hanger.jpg',
    worn_photo: 'cardigan-worn.jpg',
  })
  assert.deepEqual(refs.map(ref => ref.kind), ['worn', 'hanger'])
  assert.match(refs[0].label, /how this garment sits on her body — where its hem lands, how it hangs, how its sleeves fall/)
  assert.match(refs[1].label, /construction, color, print scale, texture, and garment shape/)
})

// The renderer was copying the facial expression out of whichever worn photo was in the outfit,
// despite the label expressly forbidding it. Downscaling only the worn photo keeps the geometry
// that makes it useful (drape, hem position, how it sits) while removing facial detail there is
// anything to copy from. The hanger photo carries print scale and construction, so it must NOT be
// downscaled with it.
test('a worn photo is sent at lower resolution than its hanger photo', () => {
  const refs = garmentReferencePlan({
    name: 'silk cardigan',
    category: 'top',
    photo: 'cardigan-hanger.jpg',
    worn_photo: 'cardigan-worn.jpg',
  })
  const worn = refs.find(ref => ref.kind === 'worn')
  const hanger = refs.find(ref => ref.kind === 'hanger')
  assert.ok(worn.maxPx < hanger.maxPx, 'the worn photo must be downscaled relative to the hanger photo')
  assert.equal(hanger.maxPx, 768, 'the hanger photo must keep full resolution for print scale and construction')
  assert.match(worn.label, /intentionally low resolution/)
  assert.match(worn.label, /Do not copy this photo's face, hair, or expression/)
})

test('hanger-only evidence discloses that fit and drape are unconfirmed', () => {
  const refs = garmentReferencePlan({
    name: 'silk cardigan',
    category: 'top',
    photo: 'cardigan-hanger.jpg',
  })
  assert.deepEqual(refs.map(ref => ref.kind), ['hanger'])
  assert.match(refs[0].label, /no worn photo is available/)
  assert.match(refs[0].label, /inferred conservatively from structured garment data/)
})

test('comparison previews cap references and prefer worn evidence', () => {
  const refs = garmentReferencePlan({
    name: 'silk cardigan',
    category: 'top',
    photo: 'cardigan-hanger.jpg',
    worn_photo: 'cardigan-worn.jpg',
  }, { maxPhotos: 1 })
  assert.deepEqual(refs.map(ref => ref.kind), ['worn'])
})

// A worn photo necessarily shows her face and body, which is what makes it authoritative for fit
// — but that same content makes it a plausible identity source if nothing says otherwise. The
// disclaimer covers face, hair and expression only. Owner ruling 2026-10-26: body proportions are
// NOT disclaimed — the worn photo is her, and it is the evidence for where a hem lands on her body
// (thread_1793058184605: a mid-thigh tunic rendered cropped at the waist while it was disclaimed).
test('a worn photo\'s label disclaims face/hair/expression but keeps her body proportions', () => {
  const refs = garmentReferencePlan({
    name: 'silk cardigan',
    category: 'top',
    photo: 'cardigan-hanger.jpg',
    worn_photo: 'cardigan-worn.jpg',
  })
  const worn = refs.find(ref => ref.kind === 'worn')
  assert.match(worn.label, /Do not copy this photo's face, hair, or expression/)
  assert.doesNotMatch(worn.label, /body proportions/)
  assert.match(worn.label, /where its hem lands/)
  assert.match(worn.label, /render it at those same proportions on her/)
  const hanger = refs.find(ref => ref.kind === 'hanger')
  assert.match(hanger.label, /the worn photo, not this one, shows where it lands on her body/)
})

const diagnosticRead = {
  visibleFacts: {
    floorLine: 'the pant hem covers most of the shoe',
    proportionRead: 'the long trouser line works until the fabric pools at the floor',
  },
  inferredIntent: {
    label: 'relaxed city tailoring',
    successCriteria: ['a long trouser line with a readable shoe'],
  },
  evaluation: {
    summary: 'The outfit idea works, but the hem needs one adjustment.',
    verdict: 'revise',
    firstVisibleIssue: 'the pant hem swallows the shoe',
    executionGap: 'floor-line pooling',
    scores: { silhouetteIntegrity: 3 },
  },
  recommendation: {
    smallestAdjustment: 'Adjust the pant hem enough to reveal the shoe.',
  },
}

test('readable critique leads with answer, reason, action, and an observable check', () => {
  const result = formatSharedOutfitEvaluation({
    parsed: {
      ...diagnosticRead,
      userCritique: {
        answer: 'Works with one adjustment',
        reason: 'The fitted top gives the wide trousers a clear upper edge, but the pooled hem hides the shoes.',
        action: 'Pin or cuff the trousers to the length you would actually wear.',
        check: 'Look for the shoes to become readable without breaking the long trouser line.',
        occasionNote: '',
      },
    },
  })

  const [userRead, diagnosticDetails] = result.feedback.split(CRITIQUE_DETAILS_DELIMITER)
  assert.match(userRead, /^\*\*Works with one adjustment\.\*\*/)
  assert.match(userRead, /\*\*Try this:\*\* Pin or cuff the trousers/)
  assert.match(userRead, /\*\*Check:\*\* Look for the shoes/)
  assert.doesNotMatch(userRead, /Verdict:|execution gap|silhouette integrity|Scores:/i)
  assert.match(diagnosticDetails, /Visible facts:/)
  assert.match(diagnosticDetails, /Floor line: the pant hem covers most of the shoe/)
  assert.equal(result.evaluation.userCritique.action, 'Pin or cuff the trousers to the length you would actually wear.')
})

test('a successful outfit may say no change needed without manufacturing an issue', () => {
  const result = formatSharedOutfitEvaluation({
    parsed: {
      ...diagnosticRead,
      evaluation: {
        ...diagnosticRead.evaluation,
        verdict: 'keep',
        firstVisibleIssue: 'none',
        executionGap: 'none',
      },
      recommendation: {
        smallestAdjustment: 'No change needed.',
        tryNext: '',
      },
      userCritique: {
        answer: 'Works',
        reason: 'The fitted top and wide trousers already create a clear, easy proportion.',
        action: 'No change needed.',
        check: '',
        occasionNote: '',
      },
    },
  })

  const [userRead] = result.feedback.split(CRITIQUE_DETAILS_DELIMITER)
  assert.match(userRead, /^\*\*Works\.\*\*/)
  assert.match(userRead, /\*\*No change needed\.\*\*/)
  assert.doesNotMatch(userRead, /\*\*Try this:\*\*/)
  assert.doesNotMatch(userRead, /\*\*Check:\*\*/)
})

test('critique followups use a lean answer-only contract without weakening evidence rules', () => {
  assert.match(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /Do not regenerate the full critique/)
  assert.match(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /2-5 concise sentences/)
  assert.match(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /current outfit photo as primary evidence/)
  assert.match(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /linked garment records as authority/)
  assert.match(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /"answer": "direct answer to the follow-up"/)
  assert.doesNotMatch(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /"visibleFacts"\s*:/)
  assert.doesNotMatch(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /"detailedCritique"\s*:/)
})

test('purpose-written detailed critique replaces the structured-field fallback', () => {
  const paragraphs = [
    'This outfit starts with a strong contrast between the quiet top and expressive skirt.',
    'The top meets the skirt cleanly at the waist, so their proportions remain easy to read.',
    'The shoe repeats the skirt’s darker note and gives the hem a clear finish.',
    'The only change worth testing is a slightly shorter hem so more of that shoe remains visible.',
  ]
  const result = formatSharedOutfitEvaluation({
    parsed: {
      ...diagnosticRead,
      detailedCritique: paragraphs,
      userCritique: {
        answer: 'Works with one adjustment',
        reason: 'The outfit works, but the hem hides too much of the shoe.',
        action: 'Test a slightly shorter hem.',
        check: 'The shoe should remain visible.',
        occasionNote: '',
      },
    },
  })

  const [, explanation] = result.feedback.split(CRITIQUE_DETAILS_DELIMITER)
  assert.equal(explanation.trim(), paragraphs.join('\n\n'))
  assert.deepEqual(result.evaluation.detailedCritique, paragraphs)
})

test('evaluator prompt requires the readable contract while retaining visible-fact diagnostics', () => {
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /Use this sequence: answer → reason → action → check/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /A keep may simply work/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /Visible facts must include:/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /"userCritique": \{/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /Return exactly four connected paragraph strings/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /"detailedCritique": \[/)
  const schema = WHOLE_WARDROBE_EVALUATOR_SYSTEM.slice(WHOLE_WARDROBE_EVALUATOR_SYSTEM.lastIndexOf('JSON shape:'))
  assert.doesNotMatch(schema, /"summary"|"roles"|"scores"|"works"|"risks"|"critiqueProse"|"styleIdea"|"mainSuccess"|"executionGap"/)
})

test('generated outfit image prompt treats garment truth as authoritative over card prose', () => {
  const prompt = wholeWardrobeImagePrompt({
    outfit: {
      label: 'Gallery',
      reason: 'Tuck the shirt into the trousers for a crisp waist.',
    },
    pieces: [{
      name: 'white tailed shirt',
      category: 'top',
      silhouette: 'oversized',
      length_hits_at: 'hip',
      hem_finish: 'design_hem',
      fit_on_body: 'hangs_straight',
      tuck_behavior: 'wear_over_only',
    }],
  })

  assert.match(prompt, /Structured garment fields and reference images are authoritative/)
  assert.match(prompt, /preserve its oversized silhouette; keep its hip length \(worn untucked, the hem ends at the widest part of the hips\); show its complete design hem; render its fit as hangs straight/)
  assert.match(prompt, /wear it fully outside the bottom waistband, with the complete hem visible and no part tucked in/)
  assert.match(prompt, /Non-authoritative styling intent: Tuck the shirt/)
  assert.match(prompt, /Final render check: the visible outfit must satisfy every authoritative garment-construction direction/)
  assert.doesNotMatch(prompt, /Stylist mechanics:/)
})

test('generated outfit image prompt treats styling_instructions as authoritative for garment relationships', () => {
  const prompt = wholeWardrobeImagePrompt({
    outfit: {
      label: 'Gallery',
      reason: 'A soft, elevated layered look.',
      stylingInstructions: 'Open cardigan over the dress, then belt over the cardigan at the natural waist.',
    },
    pieces: [{
      name: 'floral midi dress',
      category: 'dress',
    }, {
      name: 'cream cardigan',
      category: 'outerwear',
    }, {
      name: 'brown belt',
      category: 'accessory',
    }],
  })

  assert.match(prompt, /Authoritative styling instructions \(how these garments relate to each other — follow exactly\):\nOpen cardigan over the dress, then belt over the cardigan at the natural waist\./)
  assert.match(prompt, /Final render check: the visible outfit must satisfy every authoritative garment-construction direction and the authoritative styling instructions \(if present\) above/)
  assert.match(prompt, /Non-authoritative styling intent: A soft, elevated layered look\./)
})

test('generated outfit image prompt omits the styling_instructions section when the field is absent', () => {
  const prompt = wholeWardrobeImagePrompt({
    outfit: { label: 'Gallery', reason: 'A soft, elevated layered look.' },
    pieces: [{ name: 'plain tee', category: 'top' }],
  })

  assert.doesNotMatch(prompt, /Authoritative styling instructions \(how these garments relate to each other/)
})

// thread_1788495287089: a hooded, asymmetric-drape, double-breasted cardigan with zip pockets
// rendered as a plain symmetric open cardigan. pieceFidelityChecklist (styling-engine/core.js) gave
// every other category construction-specific fidelity language except outerwear, which fell to the
// generic "preserve category, color, shape, and visible texture" fallback. These pin the new
// outerwear branch: it fires per-feature only on evidence already in the piece's text blob (name,
// reads_as, notes — see pieceTextBlob in rules.js), the same "only on evidence" contract top/bottom
// already use above.
test('generated outfit image prompt reinforces outerwear construction cues that are actually evidenced', () => {
  const prompt = wholeWardrobeImagePrompt({
    outfit: { label: 'Evening', reason: 'Layer for the cool evening.' },
    pieces: [{
      name: 'olive hooded utility parka',
      category: 'outerwear',
      notes: 'An asymmetric, draped front with a large attached hood. Double-breasted button closure down the front, plus a separate zip-front inner layer. Two large zip pockets at the hip and a notched collar. Dropped-shoulder sleeve construction. Hits below the hip.',
    }],
  })

  assert.match(prompt, /preserve the exact visible outerwear construction from the reference: collar\/hood configuration, front closure type and placement, pocket type\/placement, sleeve\/shoulder construction, hem\/length, and front-panel shape/)
  assert.match(prompt, /preserve the asymmetric\/draped silhouette, not a symmetric closure/)
  assert.match(prompt, /must remain hooded/)
  assert.match(prompt, /preserve the button closure\/placket/)
  assert.match(prompt, /preserve the zip closure/)
  assert.match(prompt, /preserve the visible pockets, in their described style/)
  assert.match(prompt, /preserve the collar\/lapel shape/)
  assert.match(prompt, /preserve the sleeve construction\/shoulder line/)
  assert.match(prompt, /must remain the listed length\/hem shape/)
})

// The other half of the same contract: absence of a feature in the text must never become a
// negative claim ("no hood", "no pockets") — most outerwear legitimately lacks these features, and
// the blob has no reliable way to confirm a true negative. Grounded in the actual incident piece's
// real notes text (thread_1788495287089, piece id 157): describes the asymmetric drape and dropped
// shoulder, says nothing about a hood, closure, or pockets, because the tagging pass never captured
// them either.
test('generated outfit image prompt never fabricates outerwear construction claims from absence', () => {
  const prompt = wholeWardrobeImagePrompt({
    outfit: { label: 'Evening', reason: 'Layer for the cool evening.' },
    pieces: [{
      name: 'dark grey knit draped cardigan',
      category: 'outerwear',
      notes: 'Fit: the cardigan drapes over the body with asymmetrical front panels hanging below the hips; sleeves appear slightly long, touching the wrists. the shoulder seams seem dropped, leading to a relaxed fit.',
    }],
  })

  // Even when nothing specific is known, the unconditional baseline still tells the model to
  // inspect and preserve the reference photo's real construction — it just names no variant.
  assert.match(prompt, /preserve the exact visible outerwear construction from the reference: collar\/hood configuration, front closure type and placement, pocket type\/placement, sleeve\/shoulder construction, hem\/length, and front-panel shape/)
  assert.match(prompt, /preserve the asymmetric\/draped silhouette, not a symmetric closure/)
  assert.match(prompt, /preserve the sleeve construction\/shoulder line/)
  assert.doesNotMatch(prompt, /must remain hooded/)
  assert.doesNotMatch(prompt, /preserve the button closure/)
  assert.doesNotMatch(prompt, /preserve the zip closure/)
  assert.doesNotMatch(prompt, /preserve the visible pockets/)
  assert.doesNotMatch(prompt, /preserve the collar\/lapel shape/)
  assert.doesNotMatch(prompt, /no hood/i)
  assert.doesNotMatch(prompt, /no pocket/i)
})

// The requested "middle ground" case: a minimally tagged outerwear piece with NOTHING distinctive
// in its blob (no notes, no reads_as beyond the bare name) must still get an explicit instruction
// to preserve its visible hood/collar, closure, pockets, and construction — the unconditional
// baseline is not gated on the tagger ever having captured those features in text, only the
// evidence-specific lines are. It still asserts no variant ("must remain hooded" etc. stay absent):
// this tells the model WHAT CLASSES to inspect in the reference photo, not WHICH ONES this garment
// has.
test('a minimally tagged outerwear piece still gets baseline construction-preservation instructions, without asserting which variants it has', () => {
  const prompt = wholeWardrobeImagePrompt({
    outfit: { label: 'Casual', reason: 'Easy layering.' },
    pieces: [{ name: 'grey wool cardigan', category: 'outerwear' }],
  })

  assert.match(prompt, /preserve the exact visible outerwear construction from the reference: collar\/hood configuration, front closure type and placement, pocket type\/placement, sleeve\/shoulder construction, hem\/length, and front-panel shape — do not simplify, regularize, add, or remove these details/)
  assert.doesNotMatch(prompt, /must remain hooded/)
  assert.doesNotMatch(prompt, /preserve the button closure/)
  assert.doesNotMatch(prompt, /preserve the zip closure/)
  assert.doesNotMatch(prompt, /preserve the visible pockets/)
  assert.doesNotMatch(prompt, /preserve the collar\/lapel shape/)
  assert.doesNotMatch(prompt, /preserve category, color, shape, and visible texture/)
})

test('normalizeGeneratedOutfitObject (selected-item composer/gate path) carries styling_instructions through, and defaults to empty when absent', () => {
  const selectedPiece = { id: 1, name: 'cream cardigan' }
  const candidatePieces = [
    selectedPiece,
    { id: 2, name: 'floral midi dress', category: 'dress' },
    { id: 3, name: 'brown belt', category: 'accessory' },
  ]

  const withMechanics = normalizeGeneratedOutfitObject({
    label: 'Layered look',
    pieceIds: [2, 3],
    reason: 'A soft, elevated layered look.',
    styling_instructions: 'Open cardigan over the dress, belt over the cardigan at the natural waist.',
  }, selectedPiece, candidatePieces)
  assert.equal(withMechanics.stylingInstructions, 'Open cardigan over the dress, belt over the cardigan at the natural waist.')

  const withoutMechanics = normalizeGeneratedOutfitObject({
    label: 'Simple look',
    pieceIds: [2],
    reason: 'Clean and simple.',
  }, selectedPiece, candidatePieces)
  assert.equal(withoutMechanics.stylingInstructions, '')
})

test('whole-wardrobe comparison sheet prompt surfaces each panel\'s authoritative styling instructions when present', () => {
  const piecesById = new Map([
    [10, { id: 10, name: 'cream cardigan', category: 'outerwear' }],
    [11, { id: 11, name: 'floral midi dress', category: 'dress' }],
  ])
  const prompt = wholeWardrobeComparisonSheetPrompt({
    outfits: [
      { label: 'Layered', pieceIds: [10, 11], reason: 'soft layered look', stylingInstructions: 'Leave the cardigan open over the dress.' },
      { label: 'Plain', pieceIds: [11], reason: 'simple' },
    ],
    piecesById,
  })

  assert.match(prompt, /Authoritative styling instructions \(how these garments relate to each other — follow exactly\): Leave the cardigan open over the dress\./)
  assert.match(prompt, /follow them exactly for that panel's layering\/positioning/)
})

test('critique request ranks linked garment truth above generated card rationale', () => {
  const coreSource = fs.readFileSync(new URL('../styling-engine/core.js', import.meta.url), 'utf8')
  assert.match(coreSource, /Card rationale \(non-authoritative styling intent only/)
  assert.match(coreSource, /structured owned-garment truth and the current attached images outrank card titles, reasons/)
  assert.match(coreSource, /before recommending any physical styling action that involves multiple garments/)
  assert.match(coreSource, /capability on one garment cannot override a prohibition or construction constraint on another/)
})

// thread_1793058184605: render prompts carried buildPieceText cut at 500–900 characters. A long
// tunic's owner note on where its hem lands sat past the cut, while tagger prose ("AI auto-use
// trust", a wrong "high hip" guess) went out. Renders now carry the shared fact line plus
// source-labelled notes, never truncated, and — owner ruling 2026-10-26, renders only — the free
// notes field when it was saved through the app.
const longTunic = {
  id: 9001,
  name: 'olive open-knit tunic sweater top',
  category: 'top',
  length_hits_at: 'mid_thigh',
  hem_finish: 'ribbed',
  worn_photo: 'tunic-worn.jpg',
  manual_overrides: JSON.stringify(['notes']),
  style_profile_json: JSON.stringify({
    style_notes: { best_use: 'x'.repeat(600), risk: 'y'.repeat(600) },
    garment_intelligence: { real_wear_notes: { placement: 'ribbed hem likely sits at high hip' } },
    _confidence: { fit_on_body: 'low' },
  }),
  fit_on_body: 'hangs_straight',
  notes: 'A relaxed tunic; the hem falls well below the skirt waistband and ends at mid-thigh.',
}

test('render prompts carry an app-saved note in full and no tagger prose', async () => {
  const { renderGarmentEvidenceLine } = await import('../styling-engine/garmentEvidenceLine.js')
  const line = renderGarmentEvidenceLine(longTunic)
  assert.match(line, /length mid_thigh/)
  assert.match(line, /notes saved in the app \(author not recorded\): A relaxed tunic; the hem falls well below the skirt waistband and ends at mid-thigh\./)
  assert.doesNotMatch(line, /high hip|xxxx|yyyy|AI auto-use trust/)
  const prompt = wholeWardrobeImagePrompt({ outfit: {}, pieces: [longTunic] })
  assert.match(prompt, /ends at mid-thigh\./)
  assert.match(prompt, /Garment facts are recorded values only/)
})

test('render prompts leave out a notes field the app did not record as saved', async () => {
  const { renderGarmentEvidenceLine } = await import('../styling-engine/garmentEvidenceLine.js')
  const line = renderGarmentEvidenceLine({ ...longTunic, manual_overrides: '[]' })
  assert.doesNotMatch(line, /mid-thigh\./)
  assert.doesNotMatch(line, /GARMENT NOTES/)
})

test('render notes drop text the retired Save button appended from chat', async () => {
  const { renderGarmentEvidenceLine } = await import('../styling-engine/garmentEvidenceLine.js')
  const { _clearRuleProvenanceCacheForTests } = await import('../styling-engine/ruleProvenance.js')
  const reply = 'Try it with the cream wide-leg trousers for a softer column.'
  db.prepare('INSERT INTO chat_threads (id, payload) VALUES (?, ?)').run('thread_saved_reply', JSON.stringify({ messages: [{ role: 'assistant', text: reply }], savedIndices: [0] }))
  _clearRuleProvenanceCacheForTests()
  try {
    const line = renderGarmentEvidenceLine({ ...longTunic, notes: `${longTunic.notes}\n\n${reply}` })
    assert.match(line, /ends at mid-thigh\./)
    assert.doesNotMatch(line, /cream wide-leg trousers/)
  } finally {
    db.prepare('DELETE FROM chat_threads WHERE id = ?').run('thread_saved_reply')
    _clearRuleProvenanceCacheForTests()
  }
})

test('a low-confidence field asks for a worn photo only when the piece has none', async () => {
  const { buildWardrobePieceTruthText } = await import('../src/utils/wardrobeAiContext.js')
  assert.match(buildWardrobePieceTruthText(longTunic), /fit: \[low confidence\] hangs_straight/)
  assert.match(buildWardrobePieceTruthText({ ...longTunic, worn_photo: null }), /fit: \[low confidence - add worn photo\] hangs_straight/)
})

// thread_1793053056487 (owner ruling 2026-10-26): a length tag alone must be enough for a correct
// render. Tops and outerwear state where the hem lands as a visible cue; above_knee is the lower
// thigh, clearly below the fingertips, between mid_thigh and knee.
test('render construction states top and outerwear lengths as visible body cues', () => {
  const prompt = wholeWardrobeImagePrompt({ outfit: {}, pieces: [
    { id: 1, name: 'olive tunic', category: 'top', length_hits_at: 'above_knee' },
    { id: 2, name: 'long cardigan', category: 'outerwear', length_hits_at: 'mid_thigh' },
    { id: 3, name: 'cream midi skirt', category: 'bottom', bottom_subtype: 'skirt', length_hits_at: 'midi' },
  ] })
  assert.match(prompt, /olive tunic: keep its above knee length \(worn untucked, the hem ends on the lower thigh, clearly below the fingertips when the arms hang relaxed, a few inches above the knee\)/)
  assert.match(prompt, /long cardigan: keep its mid thigh length \(the hem ends at mid-thigh, about level with the fingertips when the arms hang relaxed\)/)
  assert.match(prompt, /cream midi skirt: keep its midi length\./)
})

test('the tagger is offered above_knee for tops and outerwear, with both thigh values defined', async () => {
  const { TAG_PIECE_PROMPT } = buildPrompts()
  assert.match(TAG_PIECE_PROMPT, /top -> cropped\|waist\|high_hip\|hip\|low_hip\|mid_thigh\|above_knee\|unknown;/)
  assert.match(TAG_PIECE_PROMPT, /outerwear -> cropped\|waist\|high_hip\|hip\|low_hip\|mid_thigh\|above_knee\|knee\|/)
  assert.match(TAG_PIECE_PROMPT, /above_knee = the hem ends on the lower thigh, clearly below the fingertips/)
})

// thread_1793066674849 (owner ruling 2026-10-26: tags decide). Photo captions hand hem position to the recorded length.
test('photo captions hand hem position to the recorded length when a top has one', () => {
  const refs = garmentReferencePlan({ name: 'olive tunic', category: 'top', length_hits_at: 'above_knee', photo: 'h.jpg', worn_photo: 'w.jpg' })
  assert.match(refs.find(r => r.kind === 'worn').label, /Where its hem lands is decided by its recorded length \(above knee: the hem ends on the lower thigh/)
  assert.doesNotMatch(refs.find(r => r.kind === 'worn').label, /render it at those same proportions/)
  assert.match(refs.find(r => r.kind === 'hanger').label, /where it lands on her body is decided by its recorded length \(above knee/)
})

// Same thread: a scoop-neck open-knit tunic with a V back showed the V through its front in the hanger photo, and
// every render drew a V-neck while the construction line said "scoop … exactly as in the reference photo".
test('a see-through garment states its recorded front neckline instead of deferring to the photo', () => {
  const prompt = wholeWardrobeImagePrompt({ outfit: {}, pieces: [
    { id: 1, name: 'olive open-knit tunic', category: 'top', neckline: 'scoop', opacity: 'open_weave' },
    { id: 2, name: 'white tee', category: 'top', neckline: 'crew', opacity: 'opaque' },
  ] })
  assert.match(prompt, /olive open-knit tunic: its front neckline is scoop; the garment is see-through, so a back neckline can show through the front in the photos — draw the scoop front neckline/)
  assert.doesNotMatch(prompt, /scoop neckline\/collar exactly as in the reference photo/)
  assert.match(prompt, /white tee: keep its crew neckline\/collar exactly as in the reference photo/)
})

test('checklist sleeves and bottom shape come from tags, not words in notes', () => {
  const prompt = wholeWardrobeImagePrompt({ outfit: {}, pieces: [
    { id: 1, name: 'olive tunic', category: 'top', sleeve_length: 'elbow', notes: 'a relaxed short-sleeve tunic that layers over a fitted tank', manual_overrides: '["notes"]' },
    { id: 2, name: 'gray slim pants', category: 'bottom', bottom_subtype: 'pants', notes: 'hang straight from the knee down', manual_overrides: '["notes"]' },
  ] })
  assert.match(prompt, /1\. olive tunic: must keep its elbow-length sleeves\./)
  assert.doesNotMatch(prompt, /must remain a short-sleeve top|sleeveless\/tank shaped/)
  assert.match(prompt, /2\. gray slim pants: must remain the listed pant\/jean silhouette\./)
  assert.doesNotMatch(prompt, /gray slim pants: must remain the listed skirt/)
})

test('render prompts say a recorded fact beats a disagreeing note', () => {
  const prompt = wholeWardrobeImagePrompt({ outfit: {}, pieces: [{ id: 1, name: 'olive tunic', category: 'top' }] })
  assert.match(prompt, /Where a garment note disagrees with a recorded garment fact \(length, neckline, sleeves, fit, opacity\), the recorded fact wins\./)
})

test('the tagger is told neckline is the front edge, even on see-through garments', () => {
  const { TAG_PIECE_PROMPT } = buildPrompts()
  assert.match(TAG_PIECE_PROMPT, /"neckline": "V\|scoop[^"]*unknown — the FRONT neckline\. On a see-through garment/)
})

test('anchorGarmentEvidence: fact line, then source-labelled notes; no tagger prose fields', async () => {
  const { anchorGarmentEvidence } = await import('../styling-engine/garmentEvidenceLine.js')
  const text = anchorGarmentEvidence({ id: 7, name: 'sheer tunic', category: 'top', reads_as: 'airy net tunic', tried_and_rejected: '["over the bulky boat-neck"]', style_profile_json: '{"best_use":"monochrome texture"}' })
  assert.match(text, /^ID 7: sheer tunic; top;/)
  assert.match(text, /\nGARMENT NOTES \(source-labelled; not recorded facts\): REJECTED: over the bulky boat-neck; tagger impression \(not owner-verified\): airy net tunic$/)
  assert.doesNotMatch(text, /monochrome texture|best use/)
})
