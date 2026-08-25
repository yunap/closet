import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCoveredCandidateSet, completeOutfitSupplyRequirement } from '../styling-engine/candidateSet.js'

const piece = (id, category, extra = {}) => ({ id, category, ...extra })

test('covered candidate set is a byte-order no-op when the initial cap already contains a complete path', () => {
  const initial = [piece(1, 'top'), piece(2, 'bottom'), piece(3, 'shoes'), piece(4, 'outerwear')]
  const result = buildCoveredCandidateSet({
    rankedPieces: initial,
    initialSelection: initial,
    capacity: 4,
    requirements: [completeOutfitSupplyRequirement()],
  })
  assert.deepEqual(result.pieces.map(item => item.id), [1, 2, 3, 4])
  assert.equal(result.report.complete, true)
  assert.deepEqual(result.report.addedForCoverageIds, [])
})

test('hard truncation preserves a complete structure when eligible supply exists', () => {
  const ranked = [piece(1, 'top'), piece(2, 'top'), piece(3, 'bottom'), piece(4, 'shoes')]
  const result = buildCoveredCandidateSet({
    rankedPieces: ranked,
    initialSelection: ranked.slice(0, 3),
    capacity: 3,
    requirements: [completeOutfitSupplyRequirement()],
  })
  assert.deepEqual(new Set(result.pieces.map(item => item.category)), new Set(['top', 'bottom', 'shoes']))
  assert.equal(result.report.complete, true)
  assert.deepEqual(result.report.addedForCoverageIds, [4])
})

test('a dependent anchor reserves a usable base as part of its completion path', () => {
  const anchor = piece(10, 'top', { needs_base: 'yes' })
  const looseTop = piece(1, 'top', { opacity: 'opaque', fit_on_body: 'drapes' })
  const base = piece(2, 'top', { opacity: 'opaque', fit_on_body: 'skims' })
  const bottom = piece(3, 'bottom')
  const shoes = piece(4, 'shoes')
  const result = buildCoveredCandidateSet({
    rankedPieces: [looseTop, bottom, shoes, base],
    initialSelection: [looseTop, bottom, shoes],
    capacity: 3,
    requirements: [completeOutfitSupplyRequirement({ anchorPiece: anchor })],
  })
  assert.equal(result.report.complete, true)
  assert.deepEqual(new Set(result.pieces.map(item => item.id)), new Set([2, 3, 4]))
})

test('impossible supply and impossible capacity are distinct shortfalls', () => {
  const supply = buildCoveredCandidateSet({
    rankedPieces: [piece(1, 'top'), piece(2, 'bottom')],
    initialSelection: [piece(1, 'top'), piece(2, 'bottom')],
    capacity: 3,
    requirements: [completeOutfitSupplyRequirement()],
  })
  assert.equal(supply.report.complete, false)
  assert.equal(supply.report.shortfalls[0].code, 'required_structure_unavailable')

  const capacity = buildCoveredCandidateSet({
    rankedPieces: [piece(1, 'top'), piece(2, 'bottom'), piece(3, 'shoes')],
    initialSelection: [piece(1, 'top'), piece(2, 'bottom')],
    capacity: 2,
    requirements: [completeOutfitSupplyRequirement()],
  })
  assert.equal(capacity.report.complete, false)
  assert.equal(capacity.report.shortfalls[0].code, 'required_structure_exceeds_capacity')
})
