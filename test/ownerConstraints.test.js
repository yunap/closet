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
const {
  createOwnerConstraint,
  createOwnerConstraintFromProposal,
  setOwnerConstraintStatus,
} = await import('../lib/ownerConstraints.js')
const { wholeWardrobePieceTrustDecision } = await import('../styling-engine/rules.js')
const { evaluateAutomaticUsePiecePool } = await import('../styling-engine/eligibility.js')

function generationPool(pieces, context) {
  const result = evaluateAutomaticUsePiecePool({ pieces, context, policy: { hotOuterwearCap: 3 } })
  return { allowedPieces: result.eligiblePieces, suppressedPieces: result.underlyingExcludedPieces }
}

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
    contextDimension: 'occasion',
    contextValues: ['travel'],
    reason: 'Owner-confirmed travel constraint.',
  })
  assert.ok(created.constraint.id)
  assert.equal(db.prepare('SELECT archived FROM stylist_feedback WHERE id = ?').get(sourceId).archived, 1)

  const matching = wholeWardrobePieceTrustDecision(dress, { occasion: 'travel' })
  assert.match(matching.reasons.join(' '), /owner constraint/)
  const otherPiece = wholeWardrobePieceTrustDecision(pants, { occasion: 'travel' })
  assert.doesNotMatch(otherPiece.reasons.join(' '), /owner constraint/)
  const otherContext = wholeWardrobePieceTrustDecision(dress, { occasion: 'casual', activity: 'museum' })
  assert.doesNotMatch(otherContext.reasons.join(' '), /owner constraint/)

  setOwnerConstraintStatus(db, created.constraint.id, 'retired')
  assert.doesNotMatch(wholeWardrobePieceTrustDecision(dress, { occasion: 'travel' }).reasons.join(' '), /owner constraint/)
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
  const wet = generationPool([suede, leather], {
    occasion: 'casual', weatherProfile: { isWetExposure: true },
  })
  assert.deepEqual(wet.allowedPieces.map(piece => piece.id), [leather.id])
  const dry = generationPool([suede, leather], {
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

  const noSeason = generationPool([boots, sandals], { occasion: 'casual' })
  assert.deepEqual(noSeason.allowedPieces.map(piece => piece.id), [boots.id, sandals.id])

  const summer = generationPool([boots, sandals], { occasion: 'casual', season: 'summer' })
  assert.deepEqual(summer.allowedPieces.map(piece => piece.id), [sandals.id])
  assert.match(summer.suppressedPieces[0].reasons.join(' '), /owner constraint/)

  const winter = generationPool([boots, sandals], { occasion: 'casual', season: 'winter' })
  assert.deepEqual(winter.allowedPieces.map(piece => piece.id), [boots.id, sandals.id])
})

test('owner can enforce no boots in summer as a footwear-type rule', () => {
  const boots = insertPiece({ name: 'plain ankle boots', category: 'shoes', material: 'leather' })
  const sandals = insertPiece({ name: 'plain walking sandals', category: 'shoes', material: 'leather' })
  createOwnerConstraint(db, {
    confirmOwnerConstraint: true,
    selectorType: 'footwear',
    selectorValues: ['boots'],
    contextDimension: 'season',
    contextValues: ['summer'],
    reason: "Don't suggest boots when season is summer.",
  })

  const summer = generationPool([boots, sandals], { occasion: 'casual', season: 'summer' })
  assert.deepEqual(summer.allowedPieces.map(piece => piece.id), [sandals.id])
  const winter = generationPool([boots, sandals], { occasion: 'casual', season: 'winter' })
  assert.deepEqual(winter.allowedPieces.map(piece => piece.id), [boots.id, sandals.id])
  const warm = generationPool([boots, sandals], { occasion: 'casual', season: 'warm' })
  assert.deepEqual(warm.allowedPieces.map(piece => piece.id), [sandals.id])
  const currentSummer = generationPool([boots, sandals], {
    occasion: 'casual', season: 'current season', currentDate: new Date('2026-07-15T12:00:00Z'),
  })
  assert.deepEqual(currentSummer.allowedPieces.map(piece => piece.id), [sandals.id])
})

test('an unavailable request dimension cannot be stored as an apparently valid firm rule', () => {
  const created = createOwnerConstraint(db, {
    confirmOwnerConstraint: true,
    selectorType: 'category',
    selectorValues: ['dress'],
    contextDimension: 'activity',
    contextValues: ['airplane travel'],
    reason: "Don't suggest dresses when activity is airplane travel.",
  })
  assert.equal(created.statusCode, 400)
  assert.match(created.error, /Unsupported activity value/)
})

test('a stored validated proposal becomes a firm rule only after explicit confirmation', () => {
  const payload = JSON.stringify({
    ownerConstraintProposal: {
      version: 1,
      selectorType: 'footwear',
      selectorValues: ['boots'],
      contextDimension: 'season',
      contextValues: ['summer'],
      reason: "Don't suggest boots in summer.",
    },
  })
  const sourceId = Number(db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, note, payload) VALUES ('preference_reaction', 'message', ?, ?)
  `).run("I don't wear boots in the summer", payload).lastInsertRowid)

  const unconfirmed = createOwnerConstraintFromProposal(db, sourceId)
  assert.equal(unconfirmed.statusCode, 400)
  assert.equal(db.prepare('SELECT archived FROM stylist_feedback WHERE id = ?').get(sourceId).archived, 0)

  const created = createOwnerConstraintFromProposal(db, sourceId, { confirmOwnerConstraint: true })
  assert.ok(created.constraint.id)
  assert.equal(created.constraint.selector_type, 'footwear')
  assert.equal(db.prepare('SELECT archived FROM stylist_feedback WHERE id = ?').get(sourceId).archived, 1)
})

test('feedback without a complete supported proposal cannot become a firm rule', () => {
  const missingId = Number(db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, note, payload) VALUES ('owner_rule', 'message', ?, '{}')
  `).run('Please make this firm somehow.').lastInsertRowid)
  const missing = createOwnerConstraintFromProposal(db, missingId, { confirmOwnerConstraint: true })
  assert.equal(missing.statusCode, 400)

  const malformedId = Number(db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, note, payload) VALUES ('owner_rule', 'message', ?, ?)
  `).run('No dresses sometimes.', JSON.stringify({
    ownerConstraintProposal: {
      version: 1,
      selectorType: 'category',
      selectorValues: ['dress'],
      contextDimension: 'activity',
      contextValues: [],
    },
  })).lastInsertRowid)
  const malformed = createOwnerConstraintFromProposal(db, malformedId, { confirmOwnerConstraint: true })
  assert.equal(malformed.statusCode, 400)
  assert.equal(db.prepare('SELECT archived FROM stylist_feedback WHERE id IN (?, ?)').all(missingId, malformedId).every(row => row.archived === 0), true)
})
