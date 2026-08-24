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
    // 2026-08-21: the composer proposes from isolated per-garment photos and was observed
    // rationalizing a two-print pairing ("shares a warm palette", "reads quieter because the
    // ground is dark") instead of actually comparing the two photos. Strengthens pattern
    // discipline from a bare rule into an instruction to look and a named trap to avoid.
    if (key === 'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM') {
      expected = expected.replace(
        '- Pattern discipline: one loud piece per outfit, grounded by solid supporting pieces.',
        '- Pattern discipline: at most one loud/busy print or heavy texture per outfit, grounded by solid supporting pieces. Before you pair two pieces that both have a print, pattern, or heavy texture, actually look at their two photos side by side and ask whether they compete — similar scale, similar busyness, fighting for the same attention — not whether they share a color-family word. A dark background does not make a busy print "read quiet"; a print\'s ground color and its pattern discipline are two different things, and one does not fix the other. If you find yourself writing a reason like "shares a warm palette" or "reads quieter because the ground is dark" to justify pairing two patterned or heavily textured pieces, that is the sign to stop and swap one of them for a solid piece instead — do not use that reasoning to keep the pairing.'
      )
    }
    // 2026-08-21: a smart-casual request with no stated activity came back with three outfits
    // whose bestFor read "walking-heavy day" / "all-day walking" — the composer was inflating the
    // city_smart_casual occasion profile's "walk-friendly" VIBE text (a footwear/register quality)
    // into an unstated ACTIVITY claim. Structural activity gating was unaffected (activitySource
    // stayed "none"); this was purely a prose overclaim.
    if (key === 'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM') {
      expected = expected.replace(
        '- Occasion & Weather Classification: Honor the occasion guidance provided in the request; the wardrobe shown has already been filtered for validity — compose freely within it.',
        '- Occasion & Weather Classification: Honor the occasion guidance provided in the request; the wardrobe shown has already been filtered for validity — compose freely within it.\n- Do not invent a physical activity. An occasion\'s vibe text (e.g. "walk-friendly," "comfortable," "walkable") describes a footwear/register QUALITY the occasion generally calls for — it is not a claim that this specific request involves walking, hiking, or any other named activity. Only use activity language like "walking-heavy day," "all-day walking," or "a walk" in `bestFor`/`silhouette`/`watchFor` when an activity was actually stated for this turn (see the Activity line in the request, if present). Otherwise describe the outfit by its occasion and register only (e.g. "smart casual, everyday" — not "smart casual, walking-heavy day").'
      )
    }
    // 2026-08-24: live thread_1787558991064 paired a needs_base crochet top with a relaxed/drapey
    // "emerald green v-neck top" as its base, defending the pairing until the owner corrected it —
    // "to be a base top, it needs to be a fitted top, which it most definitely is not". The composer
    // had the right piece available (a near-identically-named skims/straight tank) and used it
    // correctly elsewhere in the same turn, so this was a base-layer compatibility check the model
    // never had a stated rule for, not a missing garment. Moved ex-ante into the composition rules
    // rather than left to post-hoc repair, per owner instruction: "repair is a bit late I want model
    // to know that garments structure or silhouette won't work for what it wants it to do."
    if (key === 'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM') {
      expected = expected.replace(
        '- Respect the rotation warnings and any rejected-pairing memory provided.',
        '- Base-layer compatibility: a piece labeled `needs_base: yes` (or visibly sheer/open-weave in its photo) requires a base underneath whose `fit_on_body` is `skims`, `clings_stretchy`, or `clings_drapey` — close enough to the body to sit cleanly under an open or sheer layer without its own excess fabric bunching or showing through unevenly. A candidate base tagged `drapes`, `hangs_straight`, or `none` does not satisfy this even if it is otherwise the right color or otherwise a good match — treat that as disqualifying for the base-layer slot specifically, not a minor style note. When two pieces share a near-identical name (e.g. two "emerald green v-neck top" entries), check each candidate\'s own `fit_on_body` by its ID — never assume they are interchangeable.\n- Respect the rotation warnings and any rejected-pairing memory provided.'
      )
    }
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
      // 2026-08-20 — the Part A carve-outs. Each of these clauses now lives on the tool that owns it
      // (propose_outfit's output contract, search_wardrobe's result semantics), so the cached prompt
      // no longer restates it. The 'Storing User Corrections' bullet went entirely: every clause in
      // it was already documented on store_user_correction's arguments, envelope included.
      expected = expected.replace(
        " Every outfit MUST include a shoes-role piece — never finalize an outfit without one. If no suitable shoe exists in the wardrobe for this occasion, say plainly that the wardrobe has a shoe gap; do not call 'propose_outfit' for an incomplete outfit using missing_gaps as a shoe substitute.",
        ''
      )
      expected = expected.replace(
        ' Search for a visually plausible base underneath it: a fitted or smooth primary_top, or a simple dress, unless the saved garment notes explicitly say it works over a button-down or bulkier blouse.',
        ''
      )
      expected = expected.replace(
        " Honor the per-result flags returned by 'search_wardrobe': use `weatherFit` (avoid heavy fabrics like denim on hot daytime looks; reserve heavier pieces for cool-evening layers) and the `ruleFit` tier.",
        ''
      )
      expected = expected.split('\n').filter(line => !line.includes("* Storing User Corrections:")).join('\n')
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
