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
  getSavedBoardInfluenceForPair,
  getSavedBoardMemory,
  getSavedBoardRendererMemory,
  getStylistFeedbackMemory,
} = await import('../styling-engine/rules.js')

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
  assert.equal(getSavedBoardInfluenceForPair(selected, candidate), null)
  assert.equal(getSavedBoardMemory('piece', selected.id, 10), '')
})

test('explicit positive board feedback enables positive prompt and pair influence', () => {
  insertBoard({ imageUrl: '/uploads/works-board.png', labels: ['works'] })
  const influence = getSavedBoardInfluenceForPair(selected, candidate)
  assert.equal(influence.score, 18)
  assert.match(influence.reasons.join(' '), /positive feedback/)
  assert.match(getSavedBoardMemory('piece', selected.id, 10), /works-board\.png.*\[works\]/)
})

test('negative feedback blocks local boosts and remains negative prompt evidence', () => {
  insertBoard({
    imageUrl: '/uploads/negative-board.png',
    labels: ['shape_balance'],
    details: { shape_balance: ['too_much_volume', 'shape_lost'] },
    favorite: true,
  })
  assert.equal(getSavedBoardInfluenceForPair(selected, candidate), null)
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

test('Almost right preserves a qualified positive formula instead of becoming avoid evidence', () => {
  insertBoard({
    imageUrl: '/uploads/almost-board.png',
    labels: ['almost', 'shape_balance'],
    details: { shape_balance: ['layer_too_long'] },
  })
  const influence = getSavedBoardInfluenceForPair(selected, candidate)
  assert.equal(influence.score, 6)
  assert.match(influence.reasons.join(' '), /Almost right/)
  const memory = getSavedBoardMemory('piece', selected.id, 10)
  assert.match(memory, /close-but-not-finished memory/)
  assert.match(memory, /Preserve the core outfit formula/)
  assert.match(memory, /shape and balance issue: top or layer was too long/)
  assert.doesNotMatch(memory, /negative memory/)
})

test('Use strongly remains explicit positive influence when no negative label exists', () => {
  insertBoard({ imageUrl: '/uploads/strong-board.png', favorite: true })
  const influence = getSavedBoardInfluenceForPair(selected, candidate)
  assert.equal(influence.score, 45)
  assert.match(getSavedBoardMemory('piece', selected.id, 10), /positive memory/)
})

test('image-fidelity feedback does not penalize a working outfit formula', () => {
  insertBoard({ imageUrl: '/uploads/fidelity-board.png', labels: ['works', 'wrong_length', 'wrong_garment_details', 'body_proportions_drift', 'identity_drift'] })
  const influence = getSavedBoardInfluenceForPair(selected, candidate)
  assert.equal(influence.score, 18)
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
