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
      // 2026-08-19: the general evidence-provenance authority, restored. It was learned across the
      // qualified_coverage arc (material is not proof of rain performance; duration does not
      // multiply quantity; inference must not become fact) and was deleted along with that profile
      // — leaving coverage questions, which now route to full_stylist, with none of the guardrails
      // the arc paid live calls to discover. It is stated generally, not as per-garment branches.
      expected = expected.replace(
        'TUCK COMPATIBILITY (two-piece check before every tuck suggestion):',
        'EVIDENCE PROVENANCE (general; the tuck rule below is one instance of it):\n- Rank what you know: an explicit owner statement or a manually confirmed saved fact is strongest;\n  then what a photograph clearly shows; then a cautious inference from construction; then unknown.\n  An inference may never silently become a verified fact. Say which you are working from when it\n  matters, in ordinary language, without naming fields or confidence levels.\n- A claim about hidden performance — waterproofing, warmth rating, breathability, comfort over\n  distance, durability — needs evidence about that same property. Material, colour, appearance and\n  visible hardware are not that evidence: a waxed cotton jacket with taped-looking seams may or may\n  not keep rain out, and saying it does because it looks the part is inventing a fact. Purpose-built\n  design can establish function where a tag is weak or missing; the material name alone cannot.\n- How long something lasts does not multiply how much of it is needed. A week away does not mean\n  seven of a garment; one suitable piece covers repeated use unless the request actually states\n  simultaneous use, rotation, laundering or drying time.\n- Contextual qualities — dressy, polished, casual, creative — are judgments about whether a garment\n  can play that role in the use being asked about, not equality against its saved formality, occasion\n  or style labels. A piece labelled differently may still qualify; say why it does. Physical limits\n  are the opposite: those stay with the saved fact.\n\n' + 'TUCK COMPATIBILITY (two-piece check before every tuck suggestion):'
      )
      // 2026-08-20 owner ruling — global absolutes that were false as universal law. Each looked
      // authoritative while contradicting either generic styling knowledge or the prompt's own
      // evidence hierarchy: "silk … regardless of notes" overrode the owner's own note about their
      // own garment, which is the strongest rung on the provenance ladder. Structured truth
      // (tuck_behavior) carries the general case; per-piece RULES carry the specific one.
      expected = expected.replace(
        '- Silky or satin fabrics cannot hold a tuck — never suggest tucking them.',
        '- Slippery or drapey fabrics such as silk, satin, chiffon and some viscose may be less stable when tucked. Check the garment\'s saved tuck_behavior, owner notes, hem and length, and the receiving waistband before suggesting a tuck. Do not infer "wear over only" from the material name alone.'
      )
      expected = expected.replace(
        '- Silk, satin, chiffon → always wear_over_only regardless of notes.',
        "- Silk, satin and chiffon drape and slip, so a tuck holds less reliably — but that is a reason to check, not a verdict. Judge from the saved tuck_behavior, the owner's notes, the hem and length, and the waistband receiving it. Where material and owner notes conflict, the owner's note wins."
      )
      expected = expected.replace(
        '- For city walks or walking-heavy outings, ensure shoes are practical and comfortable. Never recommend heels, wedges, or delicate shoes for walking-heavy days or walks.',
        '- For city walks or walking-heavy outings, ensure shoes are practical and comfortable. Avoid high, slender or unstable heels and delicate constructions on walking-heavy days; a low block heel may be acceptable where saved comfort evidence supports it.'
      )
      expected = expected.replace(
        '- Never pair two "loud" pieces. One loud + one solid/quiet only. Pattern mixing works when prints share a color family and one is simpler than the other.',
        '- Do not pair two focal pieces unless there is a clear unifying relationship between them. Deliberate print or colour mixing is allowed when hierarchy, palette and scale are controlled — prints that share a colour family, with one simpler or smaller in scale than the other, are the usual way that works.'
      )
      // 2026-08-20: this prohibition contradicted the shipped architecture. Bounded multi-look routes
      // an ordinary "what should I wear?" TO generate_outfits, and both the tool description and the
      // turn's own controller instruction say so — leaving the cached prompt telling the model the
      // opposite, in the most authoritative-sounding place it reads.
      expected = expected.replace(
        " Do not call 'generate_outfits' for ordinary styling advice.",
        " Use 'generate_outfits' when the turn's contract says to (a fresh same-context batch); use 'propose_outfit' for one specific outfit you have composed yourself."
      )
    }
    assert.strictEqual(built[key], expected, `byte drift in ${key}`)
  }
})

// The stylist prompt is built in two layers: stylistSystemTemplate holds the base text, and
// currentStylistSystemTemplate applies .replace() patches that supersede specific strings in it.
// String.replace is a SILENT no-op when its needle is not found — so editing a base line that a
// patch targets does not error, does not fail a build, and quietly reverts that correction to the
// older wording. This is the trap standing between here and any clause-level edit of the prompt.
//
// Parses the patch pairs out of the source rather than listing them, so a new patch is covered the
// day it is written.
test('every currentStylistSystemTemplate patch still finds its target', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'styling-engine/prompts.js'), 'utf8')
  const start = source.indexOf('function currentStylistSystemTemplate')
  assert.ok(start > 0, 'the patch layer must still exist')
  const body = source.slice(start, source.indexOf('\n}', source.indexOf('return stylistSystemTemplate', start)))

  // .replace('old', 'new') across the quote styles used in this file.
  const pairs = [...body.matchAll(/\.replace\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)]
  assert.ok(pairs.length >= 4, `expected the patch layer to be parsed, found ${pairs.length}`)

  const built = buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION }).STYLIST_SYSTEM
  const unescape = text => text.replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\')

  for (const [, rawOld, rawNew] of pairs) {
    const before = unescape(rawOld)
    const after = unescape(rawNew)
    assert.ok(!built.includes(before),
      `a patch did not apply — its target text is still in the built prompt, so the correction was lost silently: ${before.slice(0, 70)}`)
    assert.ok(built.includes(after),
      `a patch's replacement text is missing from the built prompt: ${after.slice(0, 70)}`)
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
