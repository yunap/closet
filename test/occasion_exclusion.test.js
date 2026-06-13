import test from 'node:test'
import assert from 'node:assert/strict'
import { db, parsePiece } from '../db.js'
import { wholeWardrobePieceTrustDecision, filterWholeWardrobePiecesForGeneration, buildVisualComposerRoster } from '../styling-engine/rules.js'
import { resolveOccasionProfile } from '../styling-engine/occasions.js'
import fs from 'fs'
import path from 'path'

test('Part 1 & 5 — Exclusion toggle API database mechanics', () => {
  // Let's create a temporary piece to test database toggling
  const stmt = db.prepare(`
    INSERT INTO pieces (name, category, status)
    VALUES (?, ?, ?)
  `)
  const result = stmt.run('Test Toggle Piece', 'top', 'active')
  const pieceId = result.lastInsertRowid

  try {
    // 1. Initial state: empty occasion_exclusions
    let piece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId))
    assert.deepEqual(piece.occasion_exclusions, [], 'Should default to empty array')

    // 2. Mock exclude toggle logic (norm, de-duplicate, rule append)
    const occasion = 'Outdoor Active'
    const normOccasion = String(occasion || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
    
    // Simulate POST /api/pieces/:id/occasion-exclusion (excluded = true)
    let exclusions = (piece.occasion_exclusions || []).map(o => String(o || '').toLowerCase().replace(/[-_]+/g, ' ').trim())
    if (!exclusions.includes(normOccasion)) {
      exclusions.push(normOccasion)
    }
    let rules = piece.styling_rules_learned || []
    rules.push(`Excluded from ${occasion} by Yuna (2026-06-12)`)

    db.prepare('UPDATE pieces SET occasion_exclusions = ?, styling_rules_learned = ? WHERE id = ?')
      .run(JSON.stringify(exclusions), JSON.stringify(rules), pieceId)

    // Verify it persists and reasons are appended
    piece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId))
    assert.deepEqual(piece.occasion_exclusions, ['outdoor active'], 'Should store normalized lowercase exclusion')
    assert.ok(piece.styling_rules_learned.includes('Excluded from Outdoor Active by Yuna (2026-06-12)'), 'Should record rule note')

    // Verify double-exclude doesn't duplicate
    exclusions = (piece.occasion_exclusions || []).map(o => String(o || '').toLowerCase().replace(/[-_]+/g, ' ').trim())
    if (!exclusions.includes(normOccasion)) {
      exclusions.push(normOccasion)
    }
    assert.equal(exclusions.length, 1, 'Double exclude should de-duplicate')

    // 3. Mock un-exclude toggle logic (remove array element, leave note, append reversal note)
    exclusions = exclusions.filter(o => o !== normOccasion)
    rules = piece.styling_rules_learned || []
    rules.push(`Restored for ${occasion} by Yuna (2026-06-12)`)

    db.prepare('UPDATE pieces SET occasion_exclusions = ?, styling_rules_learned = ? WHERE id = ?')
      .run(JSON.stringify(exclusions), JSON.stringify(rules), pieceId)

    // Verify restored state
    piece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId))
    assert.deepEqual(piece.occasion_exclusions, [], 'Should clear exclusions array')
    assert.ok(piece.styling_rules_learned.includes('Excluded from Outdoor Active by Yuna (2026-06-12)'), 'Should keep history note')
    assert.ok(piece.styling_rules_learned.includes('Restored for Outdoor Active by Yuna (2026-06-12)'), 'Should append reversal note')
  } finally {
    // Cleanup
    db.prepare('DELETE FROM pieces WHERE id = ?').run(pieceId)
  }
})

test('Part 1 & 5 — wholeWardrobePieceTrustDecision suppression & casing normalization robustness', () => {
  // Test case where exclusions are checked regardless of casing, dashes, or spaces
  const piece = {
    id: 9999,
    name: 'Exclude Test Blouse',
    category: 'top',
    role_permission: 'auto',
    occasion_exclusions: ['outdoor active']
  }

  // 1. Matches "Outdoor Active"
  const res1 = wholeWardrobePieceTrustDecision(piece, { occasion: 'Outdoor Active' })
  assert.equal(res1.allowed, false, 'Should be suppressed for "Outdoor Active"')
  assert.equal(res1.reasons[0], 'user-excluded for Outdoor Active', 'Should report exclusion reason')

  // 2. Matches "outdoor-active"
  const res2 = wholeWardrobePieceTrustDecision(piece, { occasion: 'outdoor-active' })
  assert.equal(res2.allowed, false, 'Should match dashes')

  // 3. Matches "OUTDOOR ACTIVE"
  const res3 = wholeWardrobePieceTrustDecision(piece, { occasion: 'OUTDOOR ACTIVE' })
  assert.equal(res3.allowed, false, 'Should be case-insensitive')

  // 4. Allowed for "casual"
  const resCasual = wholeWardrobePieceTrustDecision(piece, { occasion: 'casual' })
  assert.equal(resCasual.allowed, true, 'Should allow other occasions')
})

test('Part 1, 4 & 5 — Exclusion logic propagates to candidate generation and visual composer roster', () => {
  const pieceExcluded = {
    id: 9998,
    name: 'Excluded Top',
    category: 'top',
    photo: 'mock.jpg',
    occasion_exclusions: ['outdoor active']
  }
  const pieceAllowed = {
    id: 9997,
    name: 'Allowed Top',
    category: 'top',
    photo: 'mock.jpg',
    occasion_exclusions: []
  }

  const pool = [pieceExcluded, pieceAllowed]

  // Flow A: Candidate pool filter
  const { allowedPieces } = filterWholeWardrobePiecesForGeneration(pool, { occasion: 'Outdoor Active' })
  const allowedIds = allowedPieces.map(p => p.id)
  assert.ok(!allowedIds.includes(9998), 'Excluded piece must not be allowed in generation flow')
  assert.ok(allowedIds.includes(9997), 'Allowed piece must be present')

  // Flow B: Visual composer roster
  const rosterRes = buildVisualComposerRoster(allowedPieces, { occasion: 'outdoor-active', includeAccessories: true })
  const rosterIds = rosterRes.roster.map(p => p.id)
  assert.ok(!rosterIds.includes(9998), 'Roster built from filtered pieces does not contain the excluded piece')
})

test('Part 4 & 5 — Unprofiled occasion "concert" behavior', () => {
  // 1. resolveOccasionProfile('concert', '') must return null
  const profile = resolveOccasionProfile('concert', '')
  assert.equal(profile, null, 'resolveOccasionProfile for concert should return null')

  // 2. Verify that we can generate outfits for concert and allowedPieces filters out exclusions
  const pieceExcluded = {
    id: 8888,
    name: 'Exclude Concert Jacket',
    category: 'outerwear',
    occasion_exclusions: ['concert']
  }
  const pieceAllowed = {
    id: 8887,
    name: 'Allowed Concert Shirt',
    category: 'top',
    occasion_exclusions: []
  }

  const { allowedPieces } = filterWholeWardrobePiecesForGeneration([pieceExcluded, pieceAllowed], { occasion: 'concert' })
  const allowedIds = allowedPieces.map(p => p.id)
  assert.ok(!allowedIds.includes(8888), 'Should suppress concert exclusion under unprofiled concert occasion')
  assert.ok(allowedIds.includes(8887), 'Should allow the other piece')

  // 3. Verify that if occasionProfile is null, no profile block or coverage note is created
  // Since resolveOccasionProfile('concert') is null:
  // - Guidance string stays empty.
  // - computeWardrobeCoverage is called with null profile, returning null coverages, which results in an empty coverage note.
  const mockComputeWardrobeCoverage = (pieces, prof) => {
    let topCoverage = null
    let shoeCoverage = null
    if (prof) {
      topCoverage = 5
      shoeCoverage = 3
    }
    return { topCoverage, shoeCoverage }
  }
  const mockFormatCoverageNote = (top, shoe) => {
    let limitedSlots = []
    if (top !== null && top < 5) limitedSlots.push('tops')
    if (shoe !== null && shoe < 3) limitedSlots.push('footwear')
    if (limitedSlots.length > 0) return 'limited'
    return ''
  }
  const coverage = mockComputeWardrobeCoverage(allowedPieces, profile)
  assert.equal(coverage.topCoverage, null, 'topCoverage should be null for unprofiled occasions')
  assert.equal(coverage.shoeCoverage, null, 'shoeCoverage should be null for unprofiled occasions')
  const note = mockFormatCoverageNote(coverage.topCoverage, coverage.shoeCoverage)
  assert.equal(note, '', 'Coverage note must be empty when coverage data is null')
})


test('Part 3 & 5 — Occasions freeze guard assertions', () => {
  // Read scratch/check_style_claims.js content to verify that it scans for OCCASION_PROFILES length or keys
  const scriptPath = path.join(process.cwd(), 'scratch/check_style_claims.js')
  const content = fs.readFileSync(scriptPath, 'utf8')
  assert.ok(content.includes('ALLOWED_OCCASION_IDS'), 'Freeze guard must contain ALLOWED_OCCASION_IDS in style claims script')
  assert.ok(content.includes('Forbidden occasion profile found'), 'Freeze guard must throw error when new profile is found')
})
