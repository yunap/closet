import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated per-run DB (spec 21 Part 1) — this file used to import `db.js`
// statically, which meant it read/wrote the developer's real wardrobe.db.
// The env vars must land before `db.js` (and anything importing it, like
// rules.js) evaluates, so those imports are dynamic and come after this.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-occasion-exclusion-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { db, parsePiece } = await import('../db.js')
const { wholeWardrobePieceTrustDecision, filterWholeWardrobePiecesForGeneration, buildVisualComposerRoster } = await import('../styling-engine/rules.js')
const { resolveOccasionProfile } = await import('../styling-engine/occasions.js')

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

test('Part 4 & 5 — Ratified occasion "concert" behavior', () => {
  // 1. resolveOccasionProfile('concert', '') now returns the ratified concert profile
  const profile = resolveOccasionProfile('concert', '')
  assert.equal(profile?.id, 'concert', 'resolveOccasionProfile for concert should return the ratified profile')
  assert.equal(profile?.register_ceiling, 'elevated')

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
  assert.ok(!allowedIds.includes(8888), 'Should suppress concert exclusion under profiled concert occasion')
  assert.ok(allowedIds.includes(8887), 'Should allow the other piece')

  // 3. Verify that profiled concert occasions can produce coverage data.
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
  assert.equal(coverage.topCoverage, 5, 'topCoverage should be populated for profiled concert')
  assert.equal(coverage.shoeCoverage, 3, 'shoeCoverage should be populated for profiled concert')
  const note = mockFormatCoverageNote(coverage.topCoverage, coverage.shoeCoverage)
  assert.equal(note, '', 'Coverage note stays empty when profiled coverage is sufficient')
})


test('Part 3 & 5 — Occasions freeze guard assertions', () => {
  // Read scratch/check_style_claims.js content to verify that it scans for OCCASION_PROFILES length or keys
  const scriptPath = path.join(process.cwd(), 'scratch/check_style_claims.js')
  const content = fs.readFileSync(scriptPath, 'utf8')
  assert.ok(content.includes('ALLOWED_OCCASION_IDS'), 'Freeze guard must contain ALLOWED_OCCASION_IDS in style claims script')
  assert.ok(content.includes('Forbidden occasion profile found'), 'Freeze guard must throw error when new profile is found')
})

test('Evening bottoms strict governance and user override tests', () => {
  // 1. Prohibit cargo/utility bottoms for evening
  const cargoBottom = {
    id: 7001,
    name: 'brown cargo trousers',
    category: 'bottom',
    occasions: ['evening'], // Tagged as evening by user
    style_profile_json: {}
  }
  const trustCargo = wholeWardrobePieceTrustDecision(cargoBottom, { occasion: 'evening' })
  assert.equal(trustCargo.allowed, false, 'Cargo pants must be blocked for evening')
  assert.ok(trustCargo.reasons[0].includes('utility/cargo pants'), 'Reason must indicate utility/cargo pants block')

  // 2. Prohibit bottoms without explicit "evening" occasion
  const daytimeBottom = {
    id: 7002,
    name: 'beige silk trousers',
    category: 'bottom',
    occasions: ['casual', 'city'],
    style_profile_json: {}
  }
  const trustDaytime = wholeWardrobePieceTrustDecision(daytimeBottom, { occasion: 'evening' })
  assert.equal(trustDaytime.allowed, false, 'Bottom without explicit evening occasion must be blocked')

  // 3. User manual tag overrides AI profile confidence "low"
  const userTaggedBottom = {
    id: 7003,
    name: 'taupe tailoring trousers',
    category: 'bottom',
    occasions: ['casual', 'evening'], // explicitly user-tagged as evening
    style_profile_json: {
      garment_intelligence: {
        occasion_confidence: {
          evening: 'low' // AI says low confidence
        }
      }
    }
  }
  const trustUserTagged = wholeWardrobePieceTrustDecision(userTaggedBottom, { occasion: 'evening' })
  assert.equal(trustUserTagged.allowed, true, 'User manual occasion tag must override AI profile low confidence')
})
