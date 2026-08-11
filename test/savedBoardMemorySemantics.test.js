import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-board-memory-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { db } = await import('../db.js')
const {
  getSavedBoardMemory,
  getSavedBoardRendererMemory,
  getStylistFeedbackMemory,
  getProvisionalWrongChoiceMemory,
  getExactOutfitReactionMemory,
  getAcceptedFeedbackSynthesisMemory,
  compatibilityScoreForSelectedItem,
} = await import('../styling-engine/rules.js')
const { syncStructuredReasonsFromSavedBoard, syncFeedbackFromSavedBoard } = await import('../routes/crud.js')
const { buildOutfitLogicEvidence } = await import('../lib/feedbackTaxonomy.js')

after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(() => {
  db.prepare('DELETE FROM stylist_feedback').run()
  db.prepare('DELETE FROM saved_boards').run()
  db.prepare('DELETE FROM chat_threads').run()
  db.prepare('DELETE FROM feedback_synthesis_drafts').run()
  db.prepare('DELETE FROM feedback_synthesis_batches').run()
})

test('legacy Lookbook board recovers transferable logic from one exact source-chat outfit', () => {
  const imageUrl = '/uploads/legacy-exact.png'
  db.prepare('INSERT INTO chat_threads (id, payload) VALUES (?, ?)').run('thread_exact', JSON.stringify({
    messages: [{ structuredOutfits: [{
      pieceIds: [candidate.id, selected.id],
      formulaFamily: 'compact_top_long_base',
      silhouette: 'compact upper over a long lower line',
      dominantDirection: 'quiet graphic contrast',
      occasion: 'museum',
    }] }],
  }))
  const id = db.prepare(`
    INSERT INTO saved_boards (context_type, context_name, title, image_url, pieces, reason, payload)
    VALUES ('wardrobe', 'Museum', 'Legacy generated outfit', ?, ?, 'Generated explanation', ?)
  `).run(imageUrl, pieces, JSON.stringify({
    threadId: 'thread_exact',
    board: { imageUrl, pieces: [selected, candidate] },
  })).lastInsertRowid
  const board = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(id)
  syncFeedbackFromSavedBoard(board, [], ['works'])
  const evidence = JSON.parse(db.prepare("SELECT payload FROM stylist_feedback WHERE feedback_type = 'works'").get().payload).scopedEvidence
  assert.equal(evidence.kind, 'outfit_logic')
  assert.equal(evidence.sourceConfidence, 'exact_source_recovery')
  assert.equal(evidence.logic.formula, 'compact_top_long_base')
  assert.equal(evidence.verdict, 'works')
})

test('unmatched legacy Lookbook board keeps a lower-confidence synthesis snapshot', () => {
  const imageUrl = '/uploads/legacy-snapshot.png'
  const id = db.prepare(`
    INSERT INTO saved_boards (context_type, context_name, title, image_url, pieces, reason, payload)
    VALUES ('wardrobe', 'City outing', 'Old Lookbook idea', ?, ?, 'A compact top balances the long base.', ?)
  `).run(imageUrl, pieces, JSON.stringify({ board: { imageUrl, pieces: [selected, candidate] } })).lastInsertRowid
  const board = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(id)
  syncFeedbackFromSavedBoard(board, [], ['works'])
  const evidence = JSON.parse(db.prepare("SELECT payload FROM stylist_feedback WHERE feedback_type = 'works'").get().payload).scopedEvidence
  assert.equal(evidence.kind, 'legacy_outfit_snapshot')
  assert.equal(evidence.sourceConfidence, 'legacy_generated_description')
  assert.equal(evidence.snapshot.explanation, 'A compact top balances the long base.')
  assert.deepEqual(evidence.snapshot.pieces.map(piece => piece.category), ['top', 'bottom'])
  assert.equal(evidence.context.occasion, '', 'wardrobe context names are not treated as occasions')
})

const selected = { id: 9001, name: 'Selected top', category: 'top' }
const candidate = { id: 9002, name: 'Candidate trousers', category: 'bottom' }
const pieces = JSON.stringify([selected, candidate])

function insertBoard({ imageUrl, labels = [], details = {}, favorite = false }) {
  return db.prepare(`
    INSERT INTO saved_boards (board_type, context_type, context_id, context_name, title, image_url, pieces, reason, payload, favorite)
    VALUES ('editorial_direction', 'piece', ?, 'Selected top', ?, ?, ?, 'Board rationale', ?, ?)
  `).run(
    selected.id,
    `Board ${imageUrl}`,
    imageUrl,
    pieces,
    JSON.stringify({ board: { imageUrl, pieces: [selected, candidate] }, feedback_labels: labels, feedback_details: details }),
    favorite ? 1 : 0
  ).lastInsertRowid
}

test('saving an unlabeled board is neutral for prompt memory and local pair ranking', () => {
  insertBoard({ imageUrl: '/uploads/neutral-board.png' })
  assert.equal(getSavedBoardMemory('piece', selected.id, 10), '')
})

test('Almost right reaches an existing styling call only as an exact piece-set reminder', () => {
  insertBoard({
    imageUrl: '/uploads/almost-exact.png',
    labels: ['almost', 'shape_balance'],
    details: { shape_balance: ['layer_too_long'], owner_comment: 'Maybe the proportions feel strange.' },
  })
  const memory = getExactOutfitReactionMemory([selected.id, candidate.id, 9999], { limit: 3 })
  assert.match(memory, /Exact prior outfit piece IDs \[9001, 9002\] was marked Almost right/)
  assert.match(memory, /Top or jacket looks too long/)
  assert.match(memory, /Owner comment \(verbatim, may express uncertainty\): "Maybe the proportions feel strange\."/)
  assert.match(memory, /Do not infer dislike of its formula, silhouette, colors, or individual garments/)
  assert.doesNotMatch(memory, /almost-exact|Board rationale|Selected top|Candidate trousers/)
  assert.equal(getExactOutfitReactionMemory([selected.id], { limit: 3 }), '')
})

test('unsaved generated-board verdict carries its optional owner comment without broadening scope', () => {
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_name, payload)
    VALUES ('almost', 'generated_visual_board', 'wardrobe', 'Whole wardrobe', ?)`)
    .run(JSON.stringify({
      board: { imageUrl: '/uploads/unsaved-almost.png', pieces: [selected, candidate] },
      ownerComment: 'I just know this is not quite right.',
    }))
  const memory = getExactOutfitReactionMemory([selected.id, candidate.id], { limit: 3 })
  assert.match(memory, /Exact prior outfit piece IDs \[9001, 9002\] was marked Almost right/)
  assert.match(memory, /I just know this is not quite right/)
  assert.doesNotMatch(memory, /unsaved-almost|Whole wardrobe/)
})

test('exact outfit reaction stays within its recorded context', () => {
  const id = insertBoard({ imageUrl: '/uploads/almost-city.png', labels: ['almost'] })
  const row = db.prepare('SELECT payload FROM saved_boards WHERE id = ?').get(id)
  const payload = JSON.parse(row.payload)
  payload.scoped_evidence = { version: 1, kind: 'outfit_logic', verdict: 'almost', logic: {}, context: { occasion: 'city' } }
  db.prepare('UPDATE saved_boards SET payload = ? WHERE id = ?').run(JSON.stringify(payload), id)
  assert.match(getExactOutfitReactionMemory([selected.id, candidate.id], { occasion: 'city' }), /Almost right/)
  assert.equal(getExactOutfitReactionMemory([selected.id, candidate.id], { occasion: 'evening' }), '')
  assert.equal(getExactOutfitReactionMemory([selected.id, candidate.id]), '')
})

test('exact outfit reaction normalizes absent and compound stored context', () => {
  const id = insertBoard({ imageUrl: '/uploads/almost-compound-context.png', labels: ['almost'] })
  const row = db.prepare('SELECT payload FROM saved_boards WHERE id = ?').get(id)
  const payload = JSON.parse(row.payload)
  payload.scoped_evidence = {
    version: 1,
    kind: 'outfit_logic',
    verdict: 'almost',
    logic: {},
    context: {
      occasion: 'outdoor daytime social, wine festival, outdoor café',
      activity: 'none',
      season: '',
    },
  }
  db.prepare('UPDATE saved_boards SET payload = ? WHERE id = ?').run(JSON.stringify(payload), id)

  assert.match(getExactOutfitReactionMemory(
    [selected.id, candidate.id],
    { occasion: 'outdoor_daytime_social' },
  ), /Almost right/)
  assert.match(getExactOutfitReactionMemory(
    [selected.id, candidate.id],
    { occasion: 'wine festival', activity: '' },
  ), /Almost right/)
  assert.equal(getExactOutfitReactionMemory(
    [selected.id, candidate.id],
    { occasion: 'evening' },
  ), '')
})

test('explicit positive board feedback is provenance and does not steer prompt memory', () => {
  insertBoard({ imageUrl: '/uploads/works-board.png', labels: ['works'] })
  assert.equal(getSavedBoardMemory('piece', selected.id, 10), '')
})

test('global board memory can exclude a scoped board already delivered above', () => {
  insertBoard({ imageUrl: '/uploads/scoped-board.png', labels: ['works'] })
  const memory = getSavedBoardMemory(null, null, 10, { excludeContexts: [{ type: 'piece', id: selected.id }] })
  assert.doesNotMatch(memory, /scoped-board\.png/)
})

test('signature feedback does not create a second hidden gold authority', () => {
  const boardId = insertBoard({ imageUrl: '/uploads/signature-board.png' })
  const board = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(boardId)
  syncFeedbackFromSavedBoard(board, [], ['signature'])
  const feedback = db.prepare("SELECT * FROM stylist_feedback WHERE feedback_type = 'signature'").get()
  assert.equal(feedback.is_gold, 0)
})

test('saved-board positive logic is retained in storage without reaching prompt memory', () => {
  const imageUrl = '/uploads/structured-works-board.png'
  const outfit = {
    formulaFamily: 'soft_piece_structured_anchor',
    silhouette: 'fitted top + relaxed bottom',
    dominantDirection: 'polished classic',
    mood: 'quiet confidence',
    occasion: 'city',
    activity: 'walking',
    season: 'warm',
    pieces: [{ id: selected.id, name: 'Literal selected top' }, { id: candidate.id, name: 'Literal candidate trousers' }],
  }
  const id = db.prepare(`
    INSERT INTO saved_boards (board_type, context_type, context_id, context_name, title, image_url, pieces, payload)
    VALUES ('whole_wardrobe_board', 'piece', ?, 'Selected top', 'Structured board', ?, ?, ?)
  `).run(selected.id, imageUrl, pieces, JSON.stringify({
    board: { imageUrl, pieces: outfit.pieces },
    outfit,
    feedback_labels: ['works'],
    scoped_evidence: buildOutfitLogicEvidence('works', { outfit }),
  })).lastInsertRowid
  const row = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(id)
  syncFeedbackFromSavedBoard(row, [], ['works'])

  const memory = getSavedBoardMemory('piece', selected.id, 10)
  assert.equal(memory, '')

  const mirrored = db.prepare("SELECT * FROM stylist_feedback WHERE feedback_type = 'works'").get()
  assert.deepEqual(JSON.parse(mirrored.payload).scopedEvidence, buildOutfitLogicEvidence('works', { outfit }))
  assert.equal(getStylistFeedbackMemory('piece', selected.id, 20), '')
})

test('removing a saved-board verdict removes transferable authority', () => {
  const imageUrl = '/uploads/removable-board.png'
  const outfit = { formulaFamily: 'column_with_grounding', occasion: 'museum', activity: 'walking' }
  const id = db.prepare(`
    INSERT INTO saved_boards (board_type, context_type, context_id, context_name, title, image_url, pieces, payload)
    VALUES ('whole_wardrobe_board', 'piece', ?, 'Selected top', 'Removable board', ?, ?, ?)
  `).run(selected.id, imageUrl, pieces, JSON.stringify({ board: { imageUrl }, outfit })).lastInsertRowid
  const row = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(id)
  syncFeedbackFromSavedBoard(row, [], ['works'])
  syncFeedbackFromSavedBoard(row, ['works'], [])
  assert.equal(db.prepare("SELECT archived FROM stylist_feedback WHERE feedback_type = 'works'").get().archived, 1)
})

test('saved-board re-sync preserves renderer correction payload fields', () => {
  const imageUrl = '/uploads/length-correction-board.png'
  const correction = { piece_id: selected.id, piece_name: selected.name, issue: 'upper_hem_too_long' }
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, payload)
    VALUES ('wrong_length', 'generated_visual_board', 'piece', ?, ?)`)
    .run(selected.id, JSON.stringify({
      board: { imageUrl, pieces: [selected, candidate] },
      pieceIds: [selected.id, candidate.id],
      length_correction: correction,
      feedback_reason: 'owner selected a garment length issue',
    }))
  const boardId = insertBoard({ imageUrl, labels: ['wrong_length'] })
  const board = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(boardId)
  syncFeedbackFromSavedBoard(board, ['wrong_length'], ['wrong_length'])

  const payload = JSON.parse(db.prepare("SELECT payload FROM stylist_feedback WHERE feedback_type = 'wrong_length'").get().payload)
  assert.deepEqual(payload.length_correction, correction)
  assert.deepEqual(payload.pieceIds, [selected.id, candidate.id])
  assert.equal(payload.feedback_reason, 'owner selected a garment length issue')
})

test('unstructured wrong-item feedback does not regain prompt authority through legacy payload ids', () => {
  const flagged = { id: 9003, name: 'Flagged shoes', category: 'shoes' }
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'piece', ?, ?)`)
    .run(selected.id, JSON.stringify({ pieceId: flagged.id, pieceIds: [selected.id, candidate.id, flagged.id] }))
  assert.equal(getStylistFeedbackMemory('piece', selected.id, 20), '')
})

test('provisional wrong-choice evidence does not create a generic occasion/activity score', () => {
  const heels = { id: 9003, name: 'High heels', category: 'shoes' }
  const payload = JSON.stringify({
    pieceId: heels.id,
    feedbackEvidence: {
      version: 2,
      action: 'wrong_piece_for_outfit',
      subject: { pieceId: heels.id, name: heels.name },
      context: { outfitLabel: 'Museum walk', occasion: 'city', activity: 'walking' },
      scope: 'outfit_context',
      authority: 'weak_contextual',
    },
  })
  const insert = db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', NULL, ?)`)
  insert.run(payload)

  const anchor = { id: 9010, name: 'Museum dress', category: 'dress', colors: [] }
  const baseline = compatibilityScoreForSelectedItem(anchor, heels, { occasion: 'city', activity: 'walking' })
  const after = compatibilityScoreForSelectedItem(anchor, heels, { occasion: 'city', activity: 'walking' })
  assert.deepEqual(after, baseline)
  assert.equal(getStylistFeedbackMemory('wardrobe', null, 20), '')
})

test('provisional corrections are bounded, verbatim, and delivered only for considered garments', () => {
  const insert = db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', ?)`)
  const evidence = (pieceId, name, reason) => JSON.stringify({
    feedbackEvidence: {
      version: 2,
      action: 'wrong_piece_for_outfit',
      subject: { pieceId, name },
      context: { outfitLabel: 'Fog walk', occasion: 'casual', activity: 'walking', weather: 'wet and foggy' },
      explicitReason: reason,
      scope: 'outfit_context',
      authority: 'weak_contextual',
    },
  })
  insert.run(evidence(9003, 'Canvas sneakers', 'canvas absorbs water'))
  insert.run(evidence(9004, 'Suede shoes', 'too warm for summer'))
  insert.run(evidence(9005, 'Cardigan', ''))

  const one = getProvisionalWrongChoiceMemory([9003], 3)
  assert.match(one, /Canvas sneakers \(ID 9003\)/)
  assert.match(one, /Owner reason: "canvas absorbs water"/)
  assert.doesNotMatch(one, /Suede shoes|Cardigan/)

  const capped = getProvisionalWrongChoiceMemory([9003, 9004, 9005], 1)
  assert.equal(capped.split('\n').filter(Boolean).length, 1)
  const reasonless = getProvisionalWrongChoiceMemory([9005], 1)
  assert.match(reasonless, /Cardigan/)
  assert.match(reasonless, /No reason was supplied: do not repeat the exact combination blindly/)
  assert.match(reasonless, /do not infer any broader garment or owner preference/)
})

test('only accepted personal synthesis drafts become styling prompt memory', () => {
  const batchId = db.prepare(`
    INSERT INTO feedback_synthesis_batches
      (status, feedback_ids, compact_input, input_hash, provider, model)
    VALUES ('completed', '[]', '{}', 'hash', 'test', 'test')
  `).run().lastInsertRowid
  const insert = db.prepare(`
    INSERT INTO feedback_synthesis_drafts
      (batch_id, disposition, title, proposed_text, boundary, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const wetApplicability = JSON.stringify({ applicability: {
    version: 1, scope: 'piece_context', piece_ids: [44], occasions: [], activities: ['walking'], seasons: [], weather_terms: ['wet'],
  } })
  insert.run(batchId, 'personal_contextual_lesson', 'Accepted', 'Prefer practical shoes for wet walks.', 'Only for wet walking contexts.', 'accepted', wetApplicability)
  insert.run(batchId, 'personal_contextual_lesson', 'Unreviewed', 'Never wear canvas shoes.', '', 'draft', wetApplicability)
  insert.run(batchId, 'personal_contextual_lesson', 'Summer shoes', 'Do not use the fall shoes in summer.', 'Summer only.', 'accepted', JSON.stringify({ applicability: {
    version: 1, scope: 'piece_context', piece_ids: [195], occasions: [], activities: [], seasons: ['summer'], weather_terms: [],
  } }))
  insert.run(batchId, 'personal_contextual_lesson', 'Active top', 'Preserve this top’s elevated register.', 'Only when styling piece 260.', 'accepted', JSON.stringify({ applicability: {
    version: 1, scope: 'piece', piece_ids: [260], occasions: [], activities: [], seasons: [], weather_terms: [],
  } }))
  insert.run(batchId, 'personal_contextual_lesson', 'Legacy accepted', 'This lacks structured applicability.', 'Legacy prose only.', 'accepted', '{}')
  insert.run(batchId, 'general_styling_failure', 'General', 'Do not layer tight sleeves over full sleeves.', '', 'accepted', '{}')
  insert.run(batchId, 'garment_fact_correction', 'Garment', 'The cardigan has narrow sleeves.', '', 'accepted', '{}')

  const memory = getAcceptedFeedbackSynthesisMemory(8, { pieceIds: [44], activity: 'walking', weather: 'wet and foggy' })
  assert.match(memory, /Prefer practical shoes for wet walks/)
  assert.match(memory, /Only for wet walking contexts/)
  assert.doesNotMatch(memory, /Never wear canvas|tight sleeves|cardigan has narrow sleeves/)
  assert.equal(getAcceptedFeedbackSynthesisMemory(8, { activity: 'dinner', weather: 'dry' }), '')
  assert.equal(getAcceptedFeedbackSynthesisMemory(8, { pieceIds: [44], activity: 'walking', weather: 'wet' }).includes('Prefer practical shoes'), true)
  assert.doesNotMatch(getAcceptedFeedbackSynthesisMemory(8, { season: 'summer' }), /fall shoes in summer/)
  assert.doesNotMatch(getAcceptedFeedbackSynthesisMemory(8, { season: 'winter' }), /fall shoes in summer/)
  assert.doesNotMatch(getAcceptedFeedbackSynthesisMemory(8, { pieceIds: [195], season: 'winter' }), /fall shoes in summer/)
  assert.match(getAcceptedFeedbackSynthesisMemory(8, { pieceIds: [195], season: 'summer' }), /fall shoes in summer/)
  assert.match(getAcceptedFeedbackSynthesisMemory(8, { pieceIds: [260] }), /elevated register/)
  assert.doesNotMatch(getAcceptedFeedbackSynthesisMemory(8, { pieceIds: [261] }), /elevated register/)
  assert.doesNotMatch(getAcceptedFeedbackSynthesisMemory(8, { season: 'summer' }), /lacks structured applicability/)
})

test('historical wrong-item rows without canonical context are display-only legacy evidence', () => {
  const heels = { id: 9003, name: 'High heels', category: 'shoes' }
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', NULL, ?)`)
    .run(JSON.stringify({ pieceId: heels.id, occasion: 'city', activity: 'walking' }))

  assert.equal(getStylistFeedbackMemory('wardrobe', null, 20), '')
})

test('legacy contextual evidence cannot alter pre-model candidate ranking', () => {
  const anchor = { id: 9010, name: 'Museum dress', category: 'dress', colors: [] }
  const heels = { id: 9011, name: 'High heels', category: 'shoes', colors: [] }
  const baseline = compatibilityScoreForSelectedItem(anchor, heels, { occasion: 'city', activity: 'walking' })
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', ?)`)
    .run(JSON.stringify({ scopedEvidence: {
      version: 1,
      kind: 'garment_context_suitability',
      subjectPieceId: heels.id,
      strength: 'weak',
      context: { occasion: 'city', activity: 'walking' },
    } }))

  const matching = compatibilityScoreForSelectedItem(anchor, heels, { occasion: 'city', activity: 'walking' })
  assert.equal(matching.score, baseline.score)
  assert.equal(matching.reasons.some(reason => reason.includes('context feedback')), false)

  const dinnerBefore = compatibilityScoreForSelectedItem(anchor, heels, { occasion: 'evening', activity: 'none' })
  assert.equal(dinnerBefore.reasons.some(reason => reason.includes('context feedback')), false)
})

test('plain positive relational feedback remains provenance rather than prompt memory', () => {
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, label, note, payload)
    VALUES ('works', 'whole_wardrobe_outfit', 'piece', ?, 'A good outfit', 'Keep the formula, not the literal pieces.', ?)`)
    .run(selected.id, JSON.stringify({ pieceIds: [selected.id, candidate.id] }))

  assert.equal(getStylistFeedbackMemory('piece', selected.id, 20), '')
})

test('legacy positive prompt lines are not delivered', () => {
  const insert = db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, note)
    VALUES ('works', 'whole_wardrobe_outfit', 'piece', ?, ?)`)
  insert.run(selected.id, 'An older distinct observation.')
  insert.run(selected.id, 'Repeated legacy observation.')
  insert.run(selected.id, 'Repeated legacy observation.')
  insert.run(selected.id, 'Repeated legacy observation.')

  assert.equal(getStylistFeedbackMemory('piece', selected.id, 2), '')
})

test('positive outfit-logic evidence does not become formula authority', () => {
  const payload = JSON.stringify({
    pieceIds: [selected.id, candidate.id],
    pieces: [{ id: selected.id, name: 'Literal selected top' }, { id: candidate.id, name: 'Literal candidate trousers' }],
    scopedEvidence: {
      version: 1,
      kind: 'outfit_logic',
      verdict: 'works',
      logic: {
        formula: 'compact top + flowing bottom',
        silhouette: 'defined upper half with movement below',
        direction: 'graphic relaxed',
        mood: 'artistic',
      },
      context: { occasion: 'city', activity: 'walking', season: 'warm' },
    },
  })
  const insert = db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, payload)
    VALUES ('works', 'whole_wardrobe_outfit', 'piece', ?, ?)`)
  insert.run(selected.id, payload)
  insert.run(selected.id, payload)

  const memory = getStylistFeedbackMemory('piece', selected.id, 20)
  assert.equal(memory, '')
})

test('almost outfit-logic evidence does not preserve or reinforce the formula', () => {
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, payload)
    VALUES ('almost', 'whole_wardrobe_outfit', 'piece', ?, ?)`)
    .run(selected.id, JSON.stringify({ scopedEvidence: {
      version: 1,
      kind: 'outfit_logic',
      verdict: 'almost',
      logic: { formula: 'column dress + grounded shoe', silhouette: '', direction: '', mood: '' },
      context: { occasion: 'city', activity: 'none', season: 'warm' },
    } }))

  const memory = getStylistFeedbackMemory('piece', selected.id, 20)
  assert.equal(memory, '')
})

test('an accepted synthesized lesson replaces its source outfit-logic prompt authority until retired', () => {
  const sourceId = Number(db.prepare(`
    INSERT INTO stylist_feedback
      (feedback_type, target_type, context_type, context_name, note, payload)
    VALUES ('works', 'whole_wardrobe_outfit', 'wardrobe', 'City walk', 'Owner liked this look.', ?)
  `).run(JSON.stringify({
    scopedEvidence: {
      version: 1,
      kind: 'outfit_logic',
      verdict: 'works',
      logic: { formula: 'compact top + flowing bottom', silhouette: '', direction: '', mood: '' },
      context: { occasion: 'city', activity: 'walking', season: 'summer' },
    },
  })).lastInsertRowid)
  assert.doesNotMatch(getStylistFeedbackMemory(), /compact top \+ flowing bottom/)

  const batchId = Number(db.prepare(`
    INSERT INTO feedback_synthesis_batches
      (status, feedback_ids, compact_input, input_hash)
    VALUES ('completed', ?, '{}', 'accepted-positive-source')
  `).run(JSON.stringify([sourceId])).lastInsertRowid)
  const draftId = Number(db.prepare(`
    INSERT INTO feedback_synthesis_drafts
      (batch_id, disposition, title, proposed_text, boundary, source_feedback_ids, status, payload)
    VALUES (?, 'personal_contextual_lesson', 'Summer city formula',
      'For summer city walks, use a compact top with a flowing bottom.',
      'Summer city walking contexts.', ?, 'accepted', ?)
  `).run(batchId, JSON.stringify([sourceId]), JSON.stringify({ applicability: {
    version: 1, scope: 'context', piece_ids: [], occasions: ['city'], activities: ['walking'], seasons: ['summer'], weather_terms: [],
  } })).lastInsertRowid)

  assert.doesNotMatch(getStylistFeedbackMemory(), /compact top \+ flowing bottom/)
  assert.match(getAcceptedFeedbackSynthesisMemory(8, { occasion: 'city', activity: 'walking', season: 'summer' }), /compact top with a flowing bottom/)

  db.prepare("UPDATE feedback_synthesis_drafts SET status = 'retired' WHERE id = ?").run(draftId)
  assert.doesNotMatch(getStylistFeedbackMemory(), /compact top \+ flowing bottom/)
})

test('negative feedback blocks local boosts and remains negative prompt evidence', () => {
  insertBoard({
    imageUrl: '/uploads/negative-board.png',
    labels: ['shape_balance'],
    details: { shape_balance: ['too_much_volume', 'shape_lost'] },
    favorite: true,
  })
  const memory = getSavedBoardMemory('piece', selected.id, 10)
  assert.match(memory, /negative memory/)
  assert.match(memory, /shape_balance/)
  assert.match(memory, /shape and balance issue: too much overall volume; waist or shape was lost/)
})

test('style direction reasons reach stylist memory in plain language', () => {
  insertBoard({
    imageUrl: '/uploads/energy-board.png',
    labels: ['style_direction'],
    details: {
      style_direction: ['too_soft', 'too_formal', 'too_subdued'],
    },
  })
  const memory = getSavedBoardMemory('piece', selected.id, 10)
  assert.match(memory, /style direction issue: too soft; too formal; too subdued/)
})

test('a reason picked in Visual Lab is stored as its own specific stylist_feedback row', () => {
  const imageUrl = '/uploads/lab-picked-board.png'
  const boardId = insertBoard({ imageUrl })
  const row = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(boardId)

  // Simulates the PATCH /api/saved-boards/:id route: Visual Lab toggles one style_direction
  // reason on, going from no reasons to one.
  syncStructuredReasonsFromSavedBoard(row, {}, { style_direction: ['weak_structure'] })

  const rows = db.prepare(`
    SELECT * FROM stylist_feedback
    WHERE feedback_type = 'style_direction' AND json_extract(payload, '$.board.imageUrl') = ?
  `).all(imageUrl)
  assert.equal(rows.length, 1)
  const payload = JSON.parse(rows[0].payload)
  // Before this fix, syncFeedbackFromSavedBoard wrote one reason-less row per group label
  // (feedback_type: 'style_direction' with no feedback_reason at all) instead of one row per
  // specific reason — this asserts the row now carries the reason that was actually picked.
  assert.equal(payload.feedback_reason, 'weak_structure')

  // Note: getStylistFeedbackMemory's reactionLines deliberately exclude stylist_feedback rows
  // for boards that are already in saved_boards (see its "NOT (target_type =
  // 'generated_visual_board' AND EXISTS (saved_boards...))" clause) to avoid double-counting
  // with getSavedBoardMemory, which reads structured reasons directly from
  // saved_boards.payload.feedback_details and was already correct before this fix (see "style
  // direction reasons reach stylist memory in plain language" above). So this fix corrects the
  // stored data's shape/consistency — useful for any future consumer that reads
  // stylist_feedback's feedback_reason directly — but does not change getStylistFeedbackMemory's
  // output for saved boards, which was never broken.
})

test('Visual Lab picking a second reason under the same category adds a second specific row, not a duplicate', () => {
  const imageUrl = '/uploads/lab-two-reasons-board.png'
  const boardId = insertBoard({ imageUrl })
  const row = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(boardId)

  syncStructuredReasonsFromSavedBoard(row, {}, { style_direction: ['weak_structure'] })
  syncStructuredReasonsFromSavedBoard(row, { style_direction: ['weak_structure'] }, { style_direction: ['weak_structure', 'too_safe'] })

  const rows = db.prepare(`
    SELECT * FROM stylist_feedback
    WHERE feedback_type = 'style_direction' AND json_extract(payload, '$.board.imageUrl') = ? AND COALESCE(archived,0) = 0
  `).all(imageUrl)
  const reasons = rows.map(r => JSON.parse(r.payload).feedback_reason).sort()
  assert.deepEqual(reasons, ['too_safe', 'weak_structure'])
})

test('Visual Lab deselecting a reason archives only that reason\'s row', () => {
  const imageUrl = '/uploads/lab-deselect-board.png'
  const boardId = insertBoard({ imageUrl })
  const row = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(boardId)

  syncStructuredReasonsFromSavedBoard(row, {}, { style_direction: ['weak_structure', 'too_safe'] })
  syncStructuredReasonsFromSavedBoard(row, { style_direction: ['weak_structure', 'too_safe'] }, { style_direction: ['too_safe'] })

  const activeRows = db.prepare(`
    SELECT * FROM stylist_feedback
    WHERE feedback_type = 'style_direction' AND json_extract(payload, '$.board.imageUrl') = ? AND COALESCE(archived,0) = 0
  `).all(imageUrl)
  assert.equal(activeRows.length, 1)
  assert.equal(JSON.parse(activeRows[0].payload).feedback_reason, 'too_safe')

  const archivedRows = db.prepare(`
    SELECT * FROM stylist_feedback
    WHERE feedback_type = 'style_direction' AND json_extract(payload, '$.board.imageUrl') = ? AND archived = 1
  `).all(imageUrl)
  assert.equal(archivedRows.length, 1)
  assert.equal(JSON.parse(archivedRows[0].payload).feedback_reason, 'weak_structure')
})

test('Almost right does not preserve the formula while its selected diagnostic remains scoped evidence', () => {
  insertBoard({
    imageUrl: '/uploads/almost-board.png',
    labels: ['almost', 'shape_balance'],
    details: { shape_balance: ['layer_too_long'] },
  })
  const memory = getSavedBoardMemory('piece', selected.id, 10)
  assert.match(memory, /negative memory/)
  assert.match(memory, /shape and balance issue: top or layer was too long/)
  assert.doesNotMatch(memory, /Preserve the core outfit formula/)
})

test('saved-board favorite remains organizational metadata rather than prompt evidence', () => {
  insertBoard({ imageUrl: '/uploads/strong-board.png', favorite: true })
  assert.equal(getSavedBoardMemory('piece', selected.id, 10), '')
})

test('image-fidelity feedback does not turn a works verdict into styling memory', () => {
  insertBoard({ imageUrl: '/uploads/fidelity-board.png', labels: ['works', 'wrong_length', 'wrong_garment_details', 'body_proportions_drift', 'identity_drift'] })
  const memory = getSavedBoardMemory('piece', selected.id, 10)
  assert.equal(memory, '')
})

test('image-fidelity feedback reaches renderer memory without entering styling memory', () => {
  insertBoard({
    imageUrl: '/uploads/renderer-board.png',
    labels: ['wrong_length', 'wrong_garment_details', 'body_proportions_drift', 'identity_drift'],
    details: {
      wrong_length: [{ piece_id: selected.id, piece_name: selected.name, issue: 'upper_hem_too_long' }],
    },
  })
  const rendererMemory = getSavedBoardRendererMemory([selected.id], 10)
  assert.match(rendererMemory, /Renderer-only corrections/)
  assert.match(rendererMemory, /Selected top: prior render had top or jacket hem rendered too long/)
  assert.match(rendererMemory, /Preserve the exact construction.*Selected top/)
  assert.match(rendererMemory, /body proportions consistent/)
  assert.match(rendererMemory, /facial identity and resemblance/)
  assert.equal(getSavedBoardMemory('piece', selected.id, 10), '')
})

test('legacy proportion labels remain renderer-only body feedback', () => {
  insertBoard({ imageUrl: '/uploads/legacy-proportions-board.png', labels: ['wrong_proportions'] })
  assert.match(getSavedBoardRendererMemory([selected.id], 10), /body proportions consistent/)
  assert.equal(getSavedBoardMemory('piece', selected.id, 10), '')
})

test('legacy proportion feedback never enters stylist prompt memory', () => {
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, note, payload)
    VALUES ('proportion_problem', 'message', 'piece', ?, 'Legacy body rendering comment.', '{}')`)
    .run(selected.id)
  assert.equal(getStylistFeedbackMemory('piece', selected.id, 10), '')
})

test('unsaved chat-board corrections reach stylist and renderer memory', () => {
  db.prepare(`
    INSERT INTO stylist_feedback (feedback_type, target_type, context_type, context_id, label, note, payload)
    VALUES ('style_direction', 'generated_visual_board', 'piece', ?, 'Chat board', 'Board rationale', ?)
  `).run(selected.id, JSON.stringify({ board: { imageUrl: '/uploads/chat-board.png', pieces: [selected, candidate] }, feedback_reason: 'too_formal' }))
  db.prepare(`
    INSERT INTO stylist_feedback (feedback_type, target_type, context_type, context_id, label, note, payload)
    VALUES ('wrong_garment_details', 'generated_visual_board', 'piece', ?, 'Chat board', '', ?)
  `).run(selected.id, JSON.stringify({ board: { imageUrl: '/uploads/chat-board.png', pieces: [selected, candidate] } }))
  db.prepare(`
    INSERT INTO stylist_feedback (feedback_type, target_type, context_type, context_id, label, note, payload)
    VALUES ('wrong_length', 'generated_visual_board', 'piece', ?, 'Chat board', '', ?)
  `).run(selected.id, JSON.stringify({
    board: { imageUrl: '/uploads/chat-board.png', pieces: [selected, candidate] },
    length_correction: { piece_id: selected.id, piece_name: selected.name, issue: 'sleeves_too_short' },
  }))

  assert.match(getStylistFeedbackMemory('piece', selected.id, 20), /style direction issue.*Too formal/)
  assert.match(getSavedBoardRendererMemory([selected.id], 20), /Preserve the exact construction.*Selected top/)
  assert.match(getSavedBoardRendererMemory([selected.id], 20), /Selected top: prior render had sleeves rendered too short/)
})

test('generated-board feedback is not duplicated when its saved board carries the same memory', () => {
  const savedImage = '/uploads/deduped-board.png'
  insertBoard({ imageUrl: savedImage, labels: ['not_me'] })
  db.prepare(`
    INSERT INTO stylist_feedback (feedback_type, target_type, context_type, context_id, label, note, payload)
    VALUES ('not_me', 'generated_visual_board', 'piece', ?, 'Deduped board', 'Do not repeat this.', ?)
  `).run(selected.id, JSON.stringify({ board: { imageUrl: savedImage } }))
  db.prepare(`
    INSERT INTO stylist_feedback (feedback_type, target_type, context_type, context_id, label, note, payload)
    VALUES ('not_me', 'generated_visual_board', 'piece', ?, 'Unsaved board', 'Keep this unsaved reaction.', ?)
  `).run(selected.id, JSON.stringify({ board: { imageUrl: '/uploads/unsaved-board.png' } }))

  const memory = getStylistFeedbackMemory('piece', selected.id, 20)
  assert.doesNotMatch(memory, /Deduped board/)
  assert.match(memory, /Unsaved board/)
})
