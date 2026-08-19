// Spec 32 — THE safety rail. The fixture test/fixtures/prompts_yuna_snapshot.json was
// frozen from the prompts.js constants at origin/main BEFORE the profile/constitution
// refactor. buildPrompts() with the legacy (owner) profile + constitution must reproduce
// every one of those strings byte-for-byte: the refactor moves where the words live,
// never what they are. If this test fails, the refactor changed the owner's prompts.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { buildPrompts, DEFAULT_CONSTITUTION, CONSTITUTION_LAYER_KEYS } from '../styling-engine/prompts.js'
import { LEGACY_PROFILE, LEGACY_CONSTITUTION } from '../styling-engine/constitutionSeed.js'

const snapshot = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'test/fixtures/prompts_yuna_snapshot.json'), 'utf8'))

const ASSEMBLED_KEYS = [
  'STYLIST_SYSTEM',
  'STYLE_SELECTED_ITEM_SYSTEM',
  'COMPARE_OUTFITS_SYSTEM',
  'GENERATE_OUTFIT_IDEAS_SYSTEM',
  'OUTFIT_COMPOSER_SYSTEM',
  'OUTFIT_EVALUATOR_GATE_SYSTEM',
  'WHOLE_WARDROBE_EVALUATOR_SYSTEM',
  'OUTFIT_BOARD_PLANNER_SYSTEM',
  'EDITORIAL_NEW_PIECES_SYSTEM',
  'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM',
  'VISUAL_SUPPORT_CRITIC_SYSTEM',
  'VISUAL_WARDROBE_CRITIC_SYSTEM',
  'TAG_PIECE_PROMPT',
  'EDITORIAL_IMAGE_SUBJECT_PROMPT',
  'EDITORIAL_IMAGE_SHOES_RULE',
  'BODY_CONTRACT',
  'PROVEN_FORMULAS',
  'AESTHETIC_GRAVITY',
  'LANE_NEUTRALITY',
  'WORKING_STYLE'
]

test('legacy profile + constitution reproduce every pre-refactor prompt byte-for-byte', () => {
  const built = buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION })
  for (const key of ASSEMBLED_KEYS) {
    assert.ok(typeof snapshot[key] === 'string', `snapshot missing ${key}`)
    // 2026-08-18: one deliberate post-refactor composer instruction prevents its private roster
    // comparison from leaking into user-facing card prose. Keep the frozen pre-refactor fixture
    // intact and spell out the sole accepted delta so this remains a byte-level ratchet.
    let expected = key === 'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM'
      ? snapshot[key].replace(
          '- Respect the rotation warnings and any rejected-pairing memory provided.\n',
          '- Respect the rotation warnings and any rejected-pairing memory provided.\n- Rotation is a soft tie-breaker, never a prohibition: repeat a recently shown garment when it is clearly the best or only valid choice. Do all comparison silently. Every returned field must describe only the final IDs in that outfit; never expose deliberation, rejected alternatives, self-correction, inventory checking, or rebuilding language.\n'
        )
      : snapshot[key]
    // 2026-08-19 owner amendment: a direct tuckability question may reason across evidence when a
    // tag is missing, low-confidence, or visibly contradicted. Automatic composition remains
    // conservative, and hem shape alone still cannot decide. Keep this deliberate delta explicit.
    if (key === 'STYLIST_SYSTEM') {
      expected = expected.replace(
        '- Top tuck_behavior "wear_over_only" → NEVER suggest tucking. tuck_behavior is the authority on\n  whether a top can be tucked — hem_finish describes hem shape/construction only and does not by\n  itself determine tuckability (a ribbed or shaped hem can still be designed to tuck).',
        '- For automatic outfit composition, obey a saved tuck_behavior "wear_over_only" conservatively and\n  never suggest tucking it. For a direct user question ABOUT tuckability, treat tuck_behavior as\n  evidence rather than infallible truth: a manual/high-confidence value is strong; a missing or\n  low-confidence value may be inferred cautiously from a fit-visible photo, cut, fabric, length,\n  silhouette, and the receiving waistband. Clear contradictory construction/visual evidence may\n  challenge the saved value, but state that conflict instead of silently replacing it.\n- hem_finish describes hem shape/construction only and does not by itself determine tuckability (a\n  ribbed or shaped hem can still be designed to tuck; straight_loose alone does not mean untuckable).'
      )
    }
    assert.strictEqual(built[key], expected, `byte drift in ${key}`)
  }
})

test('untouched global prompt constants still match the snapshot', async () => {
  const prompts = await import('../styling-engine/prompts.js')
  for (const key of ['EXPRESSIVE_HIERARCHY_RULES', 'TAG_PIECE_SYSTEM', 'EXTRACT_PIECES_SYSTEM', 'EDITORIAL_IMAGE_BASE_PROMPT', 'EDITORIAL_IMAGE_REALISM_RULE', 'STYLE_SELECTED_ITEM_FEW_SHOTS']) {
    assert.strictEqual(prompts[key], snapshot[key], `byte drift in global ${key}`)
  }
  assert.deepStrictEqual(prompts.WHOLE_WARDROBE_OUTFIT_ARCHETYPES, snapshot.WHOLE_WARDROBE_OUTFIT_ARCHETYPES)
  assert.deepStrictEqual(prompts.OUTFIT_MISSIONS, snapshot.OUTFIT_MISSIONS)
})

test('generic default assembly is fully de-personalized', () => {
  const built = buildPrompts()
  const all = ASSEMBLED_KEYS.map(key => built[key]).join('\n')
  assert.ok(!/\bYuna\b/.test(all), 'generic prompts must not mention Yuna')
  assert.ok(!/\bshe\b/i.test(all), 'generic prompts must not use she')
  assert.ok(!/\bUrban Artisan\b/.test(all), 'generic prompts must not assert an aesthetic home base')
  assert.ok(!/Plum and mustard are just raw color names/.test(all), 'generic prompts must not carry the plum/mustard ruling')
  assert.ok(!/except by /.test(built.AESTHETIC_GRAVITY), 'generic aesthetic layer must not carry owner-specific ratification language')
  // Per-user drift vocabulary lives in Layer 4 (lane_neutrality) and must be absent from the
  // generic layer. The composer/editorial templates' anti-drift language ("librarian drift" etc.)
  // is global editorial craft doctrine (spec 6), same class as the tagger rulings — deliberately
  // NOT per-user, so it is not asserted here.
  assert.ok(!/librarian|teacher/.test(built.LANE_NEUTRALITY), 'generic Layer 4 must not carry ratified drift vocabulary')
  assert.ok(/the user's personal stylist/.test(built.STYLIST_SYSTEM), 'generic stylist prompt addresses a generic user')
  assert.ok(/their wardrobe/.test(built.STYLIST_SYSTEM), 'generic prompts use they/them by default')
})

test('partial constitution rows fall back per-layer to the generic defaults', () => {
  const built = buildPrompts({ constitution: { body_contract: 'Layer 1 — custom contract', working_style: '   ' } })
  assert.strictEqual(built.BODY_CONTRACT, 'Layer 1 — custom contract')
  assert.strictEqual(built.WORKING_STYLE, DEFAULT_CONSTITUTION.working_style)
  assert.ok(built.STYLIST_SYSTEM.includes('Layer 1 — custom contract'))
  for (const key of CONSTITUTION_LAYER_KEYS) assert.ok(typeof DEFAULT_CONSTITUTION[key] === 'string' && DEFAULT_CONSTITUTION[key].length > 0)
})
