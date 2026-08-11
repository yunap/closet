import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-owner-constraints-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { db, parsePiece } = await import('../db.js')
const { createOwnerConstraint, setOwnerConstraintStatus } = await import('../lib/ownerConstraints.js')
const { wholeWardrobePieceTrustDecision, filterWholeWardrobePiecesForGeneration } = await import('../styling-engine/rules.js')

function insertPiece({ name, category, material = '', occasions = ['casual'] }) {
  const result = db.prepare(`INSERT INTO pieces
    (name, category, fabric_category, occasions, status, recommendation_status, fit_confidence, role_permission)
    VALUES (?, ?, ?, ?, 'active', 'trusted', 'high', 'auto')
  `).run(name, category, material, JSON.stringify(occasions))
  return parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(result.lastInsertRowid))
}

test('owner-confirmed constraints archive duplicate prose and gate only matching structured contexts', () => {
  const dress = insertPiece({ name: 'summer dress', category: 'dress' })
  const pants = insertPiece({ name: 'summer pants', category: 'bottom' })
  const sourceId = Number(db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, note, payload) VALUES ('owner_rule', 'message', ?, '{}')
  `).run('I do not wear dresses for airplane travel.').lastInsertRowid)
  const created = createOwnerConstraint(db, {
    confirmOwnerConstraint: true,
    sourceFeedbackId: sourceId,
    selectorType: 'category',
    selectorValues: ['dress'],
    contextDimension: 'activity',
    contextValues: ['airplane travel'],
    reason: 'Owner-confirmed travel constraint.',
  })
  assert.ok(created.constraint.id)
  assert.equal(db.prepare('SELECT archived FROM stylist_feedback WHERE id = ?').get(sourceId).archived, 1)

  const matching = wholeWardrobePieceTrustDecision(dress, { occasion: 'travel', activity: 'airplane travel' })
  assert.match(matching.reasons.join(' '), /owner constraint/)
  const otherPiece = wholeWardrobePieceTrustDecision(pants, { occasion: 'travel', activity: 'airplane travel' })
  assert.doesNotMatch(otherPiece.reasons.join(' '), /owner constraint/)
  const otherContext = wholeWardrobePieceTrustDecision(dress, { occasion: 'casual', activity: 'museum' })
  assert.doesNotMatch(otherContext.reasons.join(' '), /owner constraint/)

  setOwnerConstraintStatus(db, created.constraint.id, 'retired')
  assert.doesNotMatch(wholeWardrobePieceTrustDecision(dress, { occasion: 'travel', activity: 'airplane travel' }).reasons.join(' '), /owner constraint/)
})

test('slot-aware filtering applies material weather constraints per request context', () => {
  const suede = insertPiece({ name: 'plain slip-on shoes', category: 'shoes', material: 'suede' })
  const leather = insertPiece({ name: 'plain walking shoes', category: 'shoes', material: 'leather' })
  createOwnerConstraint(db, {
    confirmOwnerConstraint: true,
    selectorType: 'material',
    selectorValues: ['suede'],
    contextDimension: 'weather',
    contextValues: ['wet_exposure'],
    reason: 'Owner does not want suede used in wet exposure.',
  })
  const wet = filterWholeWardrobePiecesForGeneration([suede, leather], {
    occasion: 'casual', weatherProfile: { isWetExposure: true },
  })
  assert.deepEqual(wet.allowedPieces.map(piece => piece.id), [leather.id])
  const dry = filterWholeWardrobePiecesForGeneration([suede, leather], {
    occasion: 'casual', weatherProfile: {},
  })
  assert.equal(dry.allowedPieces.length, 2)
})

test('season constraints are no-ops without season and gate before roster assembly when season matches', () => {
  const boots = insertPiece({ name: 'plain ankle boots', category: 'shoes', material: 'leather' })
  const sandals = insertPiece({ name: 'plain sandals', category: 'shoes', material: 'leather' })
  createOwnerConstraint(db, {
    confirmOwnerConstraint: true,
    selectorType: 'piece_ids',
    selectorValues: [boots.id],
    contextDimension: 'season',
    contextValues: ['summer'],
    reason: 'Owner does not wear these boots in summer.',
  })

  const noSeason = filterWholeWardrobePiecesForGeneration([boots, sandals], { occasion: 'casual' })
  assert.deepEqual(noSeason.allowedPieces.map(piece => piece.id), [boots.id, sandals.id])

  const summer = filterWholeWardrobePiecesForGeneration([boots, sandals], { occasion: 'casual', season: 'summer' })
  assert.deepEqual(summer.allowedPieces.map(piece => piece.id), [sandals.id])
  assert.match(summer.suppressedPieces[0].reasons.join(' '), /owner constraint/)

  const winter = filterWholeWardrobePiecesForGeneration([boots, sandals], { occasion: 'casual', season: 'winter' })
  assert.deepEqual(winter.allowedPieces.map(piece => piece.id), [boots.id, sandals.id])
})
