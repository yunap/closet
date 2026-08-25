process.env.NODE_ENV = 'test'

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-eligibility-'))
process.env.WARDROBE_DB_PATH = path.join(tempRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tempRoot, 'uploads')

const { evaluateAutomaticUsePiecePool, evaluateVisualComposerPiecePool } = await import('../styling-engine/eligibility.js')
const {
  wholeWardrobeOutfitLooksQuestionable,
  wholeWardrobeOutfitVisualReviewFindings,
} = await import('../styling-engine/rules.js')

function piece(id, overrides = {}) {
  return {
    id,
    name: `Piece ${id}`,
    category: 'shoes',
    photo: `piece-${id}.jpg`,
    formality: 'everyday',
    heel_height: 'flat',
    walk_support: 'high',
    shoe_type: 'sneaker',
    occasions: ['casual', 'city', 'outdoor'],
    style_profile_json: {},
    ...overrides,
  }
}

test('shared automatic-use pool preserves hard-gate findings while anchor policy changes only disposition', () => {
  const blockedShoe = piece(30, {
    name: 'Low-support heel',
    heel_height: 'high',
    walk_support: 'low',
    shoe_type: 'pump',
  })
  const ordinaryShoe = piece(31)
  const result = evaluateAutomaticUsePiecePool({
    pieces: [blockedShoe, ordinaryShoe],
    context: { occasion: 'city', activity: 'walking', weatherProfile: { isHot: false, isCold: false } },
    policy: { anchorPieceIds: [blockedShoe.id] },
  })

  const blockedDecision = result.decisionsById.get(blockedShoe.id)
  assert.equal(blockedDecision.underlyingAllowed, false)
  assert.equal(blockedDecision.allowed, true, 'explicit anchor policy changes disposition')
  assert.equal(blockedDecision.bypassed, true)
  assert.ok(blockedDecision.findings.some(finding => finding.source === 'hard_gate' && finding.kind === 'validity'))
  assert.equal(result.eligibleIds.has(blockedShoe.id), true)
  assert.equal(result.debug.bypassedAnchorCount, 1)
})

test('shared automatic-use findings identify owner authority without consumer-side reason parsing', () => {
  const excluded = piece(32, { occasion_exclusions: ['city'] })
  const result = evaluateAutomaticUsePiecePool({
    pieces: [excluded],
    context: { occasion: 'city', weatherProfile: { isHot: false, isCold: false } },
  })

  const decision = result.decisionsById.get(excluded.id)
  assert.equal(decision.allowed, false)
  assert.ok(decision.findings.some(finding => finding.authority === 'owner' && finding.code === 'user_excluded_for_city'))
})

test('shared pool findings bind recovery to validity while preserving presentation-only pieces', () => {
  const anchor = piece(1, { category: 'top', name: 'Anchor top', formality: 'elevated' })
  const loungeShoe = piece(2, { name: 'Lounge athletic shoe', formality: 'lounge' })
  const walkingShoeA = piece(3)
  const walkingShoeB = piece(4)
  const accessory = piece(5, { category: 'accessory', name: 'Pendant', formality: 'everyday' })
  const result = evaluateVisualComposerPiecePool({
    pieces: [anchor, loungeShoe, walkingShoeA, walkingShoeB, accessory],
    context: {
      occasion: 'outdoor_daytime_social',
      activity: 'walking',
      weatherProfile: { isHot: false, isCold: false },
    },
    policy: { selectedPieceId: anchor.id, maxImages: 54 },
  })

  assert.equal(result.eligibleIds.has(loungeShoe.id), false)
  assert.equal(result.recoveryEligibleIds.has(loungeShoe.id), false, 'validity exclusions bind fallback')
  assert.equal(result.eligibleIds.has(accessory.id), false)
  assert.equal(result.recoveryEligibleIds.has(accessory.id), true, 'presentation exclusions do not become validity rules')
  assert.ok(result.findings.some(finding => finding.pieceId === loungeShoe.id && finding.kind === 'validity'))
  assert.ok(result.findings.some(finding => finding.pieceId === accessory.id && finding.kind === 'presentation'))
})

test('legacy tagger pairing prose cannot activate visual review', () => {
  const outfit = {
    pieces: [
      piece(10, {
        category: 'top',
        pattern_complexity: 'solid',
        style_profile_json: { garment_intelligence: { do_not_pair_rules: ['avoid oversized bottoms without defined waist'] } },
      }),
      piece(11, {
        category: 'bottom',
        pattern_complexity: 'solid',
        style_profile_json: { garment_intelligence: { do_not_pair_rules: ['avoid another solid in same tone'] } },
      }),
      piece(12, { pattern_complexity: 'solid' }),
    ],
  }

  assert.deepEqual(wholeWardrobeOutfitVisualReviewFindings(outfit), [])
  assert.equal(wholeWardrobeOutfitLooksQuestionable(outfit), false)
})

test('two concrete pattern signals still activate visual clash review', () => {
  const outfit = {
    pieces: [
      piece(20, { category: 'top', pattern_complexity: 'loud' }),
      piece(21, { category: 'bottom', pattern_complexity: 'medium' }),
      piece(22, { pattern_complexity: 'solid' }),
    ],
  }

  assert.deepEqual(wholeWardrobeOutfitVisualReviewFindings(outfit), [{
    code: 'multiple_patterned_pieces',
    reason: 'two or more pieces carry a concrete pattern signal',
    pieceIds: [20, 21],
    source: 'structured_piece_facts',
  }])
  assert.equal(wholeWardrobeOutfitLooksQuestionable(outfit), true)
})
