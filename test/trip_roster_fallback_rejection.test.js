// thread_1789598100140 (2026-09-16, owner ruling): a trip roster that falls back to the raw
// coverage-guaranteed bench (both model attempts failed structural validation) is not a packing
// list -- it is the entire eligible candidate pool, offered with no curation. The previous behavior
// proceeded to compose real outfit cards from it and returned status:'success', relying on a
// plan_lines disclosure sentence to convey this -- and a live run proved that sentence can be
// silently dropped from the model's own final answer (thread_1789598100140: the "Complete Packed
// Roster (60 pieces)" and the missing Hiking coverage-gap disclosure both vanished from the model's
// prose, even though plan_lines genuinely contained them). This pins the fix: plan_outfit_set must
// short-circuit to an honest error BEFORE any card is composed from a fallback bench, so there is
// never a real-looking outfit set or roster for a silently-dropped disclosure to fail to caveat.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-trip-roster-fallback-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { db } = await import('../db.js')
const { executeTool } = await import('../styling-engine/tools.js')

function insertPiece(overrides = {}) {
  const piece = {
    name: 'test piece', category: 'top', colors: [], occasions: ['casual', 'city'],
    season: 'year-round', notes: '', status: 'active', recommendation_status: 'trusted',
    fit_confidence: 'high', role_permission: 'auto', occasion_permissions: [], engine_notes: '',
    photo: null, worn_photo: null, pattern_type: 'solid', pattern_scale: 'none',
    pattern_complexity: 'solid', reads_as: '', silhouette: '', fabric_category: '',
    fabric_weight: 'light', fiber_content: [], formality: 'everyday', sleeve_length: '',
    length_hits_at: '', heel_height: null, walk_support: null, toe_shape: null, shoe_type: null,
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
    ...overrides,
  }
  return db.prepare(`
    INSERT INTO pieces (
      name, category, colors, occasions, season, notes, status,
      recommendation_status, fit_confidence, role_permission, occasion_permissions,
      engine_notes, photo, worn_photo, pattern_type, pattern_scale,
      pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content,
      formality, sleeve_length, length_hits_at, heel_height, walk_support, toe_shape, shoe_type, style_profile_json
    ) VALUES (
      @name, @category, @colors, @occasions, @season, @notes, @status,
      @recommendation_status, @fit_confidence, @role_permission, @occasion_permissions,
      @engine_notes, @photo, @worn_photo, @pattern_type, @pattern_scale,
      @pattern_complexity, @reads_as, @silhouette, @fabric_category, @fabric_weight, @fiber_content,
      @formality, @sleeve_length, @length_hits_at, @heel_height, @walk_support, @toe_shape, @shoe_type, @style_profile_json
    )
  `).run({
    ...piece,
    colors: JSON.stringify(piece.colors),
    occasions: JSON.stringify(piece.occasions),
    occasion_permissions: JSON.stringify(piece.occasion_permissions),
    fiber_content: JSON.stringify(piece.fiber_content),
    style_profile_json: JSON.stringify(piece.style_profile_json),
  }).lastInsertRowid
}

test('a trip roster that falls back to the bench returns an honest error, not a success with a fake packing list', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'city top' })
  insertPiece({ category: 'bottom', name: 'city bottom' })
  insertPiece({ category: 'shoes', name: 'city shoes', heel_height: 'flat', walk_support: 'high' })

  let composeCalled = false
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'a week in the city',
    // Always names a piece outside the supplied bench -- guarantees a contract failure on both the
    // initial attempt and the one repair attempt, independent of weather/season specifics, so this
    // deterministically reaches bench_fallback.
    chooseTripRoster: async () => ({ roster_piece_ids: [999999] }),
    composeTripPlanOnce: async () => { composeCalled = true; return [] },
  }
  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'trip',
    slots: [{ label: 'City Days', occasion: 'city', activity: 'walking', count: 1 }],
  }, toolContext)

  assert.equal(result.status, 'error', 'a fallback-bench roster must never be reported as a success')
  assert.doesNotMatch(result.message, /Complete Packed Roster/i, 'the error must not itself present the bench as a packing list')
  assert.match(result.message, /do not present the full eligible candidate bench as if it were a packing list/i)
  assert.match(result.message, /structural validation/i)
  assert.deepEqual(toolContext.generatedOutfits, [], 'no cards may exist for a fallback-bench trip -- nothing structurally exists to render as if valid')
  assert.equal(toolContext.pendingPlan, null)
  assert.equal(composeCalled, false, 'composition must never run against an uncurated fallback bench')
})

test('a trip roster the model chooses successfully is unaffected by the fallback check', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'city top' })
  const bottomId = insertPiece({ category: 'bottom', name: 'city bottom' })
  const shoeId = insertPiece({ category: 'shoes', name: 'city shoes', heel_height: 'flat', walk_support: 'high' })

  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'a week in the city',
    chooseTripRoster: async ({ bench }) => ({ roster_piece_ids: bench.map(p => Number(p.id)) }),
    composeTripPlanOnce: async workbench => [{
      slot_id: workbench.slots[0].id, piece_ids: [topId, bottomId, shoeId], title: 'City Look', reason: 'r'
    }],
  }
  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'trip',
    slots: [{ label: 'City Days', occasion: 'city', activity: 'walking', count: 1 }],
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 1)
})
