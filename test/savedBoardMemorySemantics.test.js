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
  getScopedWrongItemInfluence,
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

test('explicit positive board feedback is preserved as memory without promoting literal pairs', () => {
  insertBoard({ imageUrl: '/uploads/works-board.png', labels: ['works'] })
  assert.match(getSavedBoardMemory('piece', selected.id, 10), /works-board\.png.*\[works\]/)
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

test('saved-board verdict uses the same transferable logic evidence without exposing garments', () => {
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
  assert.match(memory, /positive transferable outfit logic for city \+ walking \+ warm/)
  assert.match(memory, /formula: soft_piece_structured_anchor/)
  assert.match(memory, /silhouette: fitted top \+ relaxed bottom/)
  assert.match(memory, /Reuse this logic with different suitable garments/)
  assert.doesNotMatch(memory, /Literal selected top|Literal candidate trousers|9001|9002/)

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

test('wrong-item feedback remains scoped prompt evidence without scoring the garment', () => {
  const flagged = { id: 9003, name: 'Flagged shoes', category: 'shoes' }
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'piece', ?, ?)`)
    .run(selected.id, JSON.stringify({ pieceId: flagged.id, pieceIds: [selected.id, candidate.id, flagged.id] }))
  assert.match(getStylistFeedbackMemory('piece', selected.id, 20), /wrong_item_read/)
})

test('scoped wrong-item evidence mildly affects only a matching occasion and activity', () => {
  const heels = { id: 9003, name: 'High heels', category: 'shoes' }
  const payload = JSON.stringify({
    pieceId: heels.id,
    scopedEvidence: {
      version: 1,
      kind: 'garment_context_suitability',
      subjectPieceId: heels.id,
      strength: 'weak',
      context: { occasion: 'city', activity: 'walking', season: 'current season', mood: '' },
    },
  })
  const insert = db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', NULL, ?)`)
  insert.run(payload)

  assert.equal(getScopedWrongItemInfluence(heels.id, { occasion: 'city', activity: 'walking' })?.score, -6)
  assert.equal(getStylistFeedbackMemory('wardrobe', null, 20), '')
  assert.equal(getScopedWrongItemInfluence(heels.id, { occasion: 'evening', activity: 'none' }), null)
  assert.equal(getScopedWrongItemInfluence(heels.id, { occasion: 'city', activity: 'none' }), null)

  insert.run(payload)
  insert.run(payload)
  assert.equal(getScopedWrongItemInfluence(heels.id, { occasion: 'city', activity: 'walking' })?.score, -12)
})

test('historical wrong-item rows without canonical context remain prompt-only evidence', () => {
  const heels = { id: 9003, name: 'High heels', category: 'shoes' }
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', NULL, ?)`)
    .run(JSON.stringify({ pieceId: heels.id, occasion: 'city', activity: 'walking' }))

  assert.equal(getScopedWrongItemInfluence(heels.id, { occasion: 'city', activity: 'walking' }), null)
})

test('matching contextual evidence reaches pre-model candidate ranking with an observable reason', () => {
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
  assert.equal(matching.score, baseline.score - 6)
  assert.match(matching.reasons.join(' '), /context feedback: previously replaced for city \+ walking/)

  const dinnerBefore = compatibilityScoreForSelectedItem(anchor, heels, { occasion: 'evening', activity: 'none' })
  assert.equal(dinnerBefore.reasons.some(reason => reason.includes('context feedback')), false)
})

test('relational stylist feedback reaches prompt memory', () => {
  db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, label, note, payload)
    VALUES ('works', 'whole_wardrobe_outfit', 'piece', ?, 'A good outfit', 'Keep the formula, not the literal pieces.', ?)`)
    .run(selected.id, JSON.stringify({ pieceIds: [selected.id, candidate.id] }))

  assert.match(getStylistFeedbackMemory('piece', selected.id, 20), /Keep the formula, not the literal pieces/)
})

test('identical legacy prompt lines are delivered once and do not crowd out distinct evidence', () => {
  const insert = db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, context_id, note)
    VALUES ('works', 'whole_wardrobe_outfit', 'piece', ?, ?)`)
  insert.run(selected.id, 'An older distinct observation.')
  insert.run(selected.id, 'Repeated legacy observation.')
  insert.run(selected.id, 'Repeated legacy observation.')
  insert.run(selected.id, 'Repeated legacy observation.')

  const memory = getStylistFeedbackMemory('piece', selected.id, 2)
  assert.equal(memory.match(/Repeated legacy observation\./g)?.length, 1)
  assert.match(memory, /An older distinct observation\./)
})

test('positive outfit-logic evidence consolidates without exposing literal garments', () => {
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
  assert.match(memory, /positive transferable outfit logic \(2 observations\)/)
  assert.match(memory, /city \+ walking \+ warm/)
  assert.match(memory, /formula: compact top \+ flowing bottom/)
  assert.match(memory, /silhouette: defined upper half with movement below/)
  assert.match(memory, /Reuse this logic with different suitable garments/)
  assert.doesNotMatch(memory, /Literal selected top|Literal candidate trousers|9001|9002/)
})

test('almost outfit-logic evidence remains qualified rather than becoming a positive rule', () => {
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
  assert.match(memory, /qualified transferable outfit logic/)
  assert.doesNotMatch(memory, /positive transferable outfit logic/)
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

test('Almost right preserves a qualified positive formula instead of becoming avoid evidence', () => {
  insertBoard({
    imageUrl: '/uploads/almost-board.png',
    labels: ['almost', 'shape_balance'],
    details: { shape_balance: ['layer_too_long'] },
  })
  const memory = getSavedBoardMemory('piece', selected.id, 10)
  assert.match(memory, /close-but-not-finished memory/)
  assert.match(memory, /Preserve the core outfit formula/)
  assert.match(memory, /shape and balance issue: top or layer was too long/)
  assert.doesNotMatch(memory, /negative memory/)
})

test('Use strongly remains prompt evidence', () => {
  insertBoard({ imageUrl: '/uploads/strong-board.png', favorite: true })
  assert.match(getSavedBoardMemory('piece', selected.id, 10), /positive memory/)
})

test('image-fidelity feedback does not penalize a working outfit formula', () => {
  insertBoard({ imageUrl: '/uploads/fidelity-board.png', labels: ['works', 'wrong_length', 'wrong_garment_details', 'body_proportions_drift', 'identity_drift'] })
  const memory = getSavedBoardMemory('piece', selected.id, 10)
  assert.match(memory, /\[works\]/)
  assert.doesNotMatch(memory, /wrong_length|wrong_garment_details|body_proportions_drift|identity_drift/)
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
