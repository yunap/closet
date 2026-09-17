// PRINT JUDGMENT IS VISUAL, CASE BY CASE (owner ruling 2026-09-15). The categorical "at most one loud print per outfit" rule —
// including its shoes-and-accessories budget — is gone from every prompt the composer, stylist and critic receive, and no code
// path rejects or caps an outfit by counting patterned pieces. Garment tags (pattern_type, pattern_complexity) are unchanged and
// remain descriptive facts.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pattern-judgment-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const prompts = await import('../styling-engine/prompts.js')
const { LEGACY_PROFILE, LEGACY_CONSTITUTION } = await import('../styling-engine/constitutionSeed.js')
const { printPairingSightIssue } = await import('../styling-engine/outfitSetPlanner.js')
const { wholeWardrobeOutfitVisualReviewFindings } = await import('../styling-engine/rules.js')

// Rule phrasings only. The clash critic deliberately QUOTES "one loud piece grounded by solid support" as an example of a
// plausible-sounding written justification to ignore in favour of the photographs — that quotation argues against the formula.
const CATEGORICAL = /at most one loud|one loud print|one loud piece per outfit|never pair two "?loud"?|same violation as two loud|blows the same budget|exactly like two loud|second loud print|loud \+ one solid/i

test('no built prompt carries a categorical print-count rule', () => {
  const built = prompts.buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION })
  const texts = [
    ['EXPRESSIVE_HIERARCHY_RULES', prompts.EXPRESSIVE_HIERARCHY_RULES],
    ...Object.entries(built).filter(([, value]) => typeof value === 'string'),
  ]
  for (const [key, text] of texts) {
    assert.doesNotMatch(text, CATEGORICAL, `${key} still states a print-count rule`)
  }
})

test('the stylist, composer and shared hierarchy prompts ask for case-by-case visual judgment across the whole outfit', () => {
  const built = prompts.buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION })
  assert.match(prompts.EXPRESSIVE_HIERARCHY_RULES, /judged by eye, case by case — there is no fixed print count/)
  assert.match(prompts.EXPRESSIVE_HIERARCHY_RULES, /shoes and accessories included/)
  assert.match(built.STYLIST_SYSTEM, /decide case by case whether the prints support or compete/)
  assert.match(built.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM, /judged by eye, case by case — there is no fixed count per outfit/)
  assert.match(built.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM, /keep the pairing only if the prints visibly work together/)
  // The critic still rejects only a visible failure, never a count, and quotes the old formula only as a justification to ignore.
  const critic = String(built.VISUAL_WARDROBE_CRITIC_SYSTEM || '') + String(built.WHOLE_WARDROBE_OUTFIT_CLASH_CRITIC_SYSTEM || '')
  const source = fs.readFileSync(path.join(process.cwd(), 'styling-engine/prompts.js'), 'utf8')
  assert.match(source, /reject" — ONLY for a clear failure you can point to in the photos: two patterns or prints that visibly fight/)
  assert.doesNotMatch(critic, CATEGORICAL)
  assert.match(built.WHOLE_WARDROBE_OUTFIT_CLASH_CRITIC_SYSTEM, /Ignore that justification — judge only what you actually see[\s\S]*"one loud piece grounded by solid support"/)
})

// thread_1789526496845: the clash critic never asked about sleeve/layer fit at all, so a card sent
// to it for that reason (see wholeWardrobeOutfitVisualReviewFindings above) would have been judged
// against the wrong question. The critic must judge only what the photo shows, never assume a
// conflict from shape/labels alone, and say plainly when it cannot tell — never a second
// deterministic veto layered on top of the log-only shape heuristic.
test('the clash critic is also asked to judge layered sleeve fit from the photo, with explicit uncertainty handling', () => {
  const built = prompts.buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION })
  const critic = built.WHOLE_WARDROBE_OUTFIT_CLASH_CRITIC_SYSTEM
  assert.match(critic, /sleeves visibly fit together/)
  assert.match(critic, /never from a label or a guess about fabric you cannot see/)
  assert.match(critic, /a layered sleeve pair that visibly does not fit \(real crowding or distortion you can see, not an assumption from shape alone\)/)
  assert.match(critic, /a sleeve pairing you cannot judge confidently from the photo \(say so plainly — do not guess\)/)
})

test('no hard pattern-count gate: several printed pieces pass once seen, and the patterned-pieces signal only requests visual review', () => {
  const printed = [
    { id: 1, category: 'top', pattern_type: 'floral', pattern_complexity: 'loud' },
    { id: 2, category: 'bottom', pattern_type: 'stripe', pattern_complexity: 'loud' },
    { id: 3, category: 'outerwear', pattern_type: 'plaid', pattern_complexity: 'medium' },
    { id: 4, category: 'shoes', pattern_type: 'floral', pattern_complexity: 'loud' },
  ]
  assert.equal(printPairingSightIssue(printed, new Set([1, 2, 3, 4])), '', 'three printed garments plus printed shoes pass once looked at')
  assert.match(printPairingSightIssue(printed, new Set()), /call view_pieces[\s\S]*keep the pairing only if it genuinely works to the eye/, 'unseen prints ask for sight, not removal')
  assert.equal(wholeWardrobeOutfitVisualReviewFindings({ pieces: printed })[0].code, 'multiple_patterned_pieces')
  const route = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const use = route.slice(route.indexOf('wholeWardrobeOutfitVisualReviewFindings({'), route.indexOf('Whole-wardrobe clash critic'))
  assert.match(use, /reviewComposedWholeWardrobeOutfitsForClash/, 'the finding only selects outfits for the visual clash critic')
  assert.doesNotMatch(use, /hardValid\s*=\s*false|broken:\s*true|rejectionReason/, 'the finding itself never rejects a card')
  // Planner and freeform validation carry no count-based pattern rejection either.
  for (const file of ['styling-engine/outfitValidation.js', 'styling-engine/outfitSetPlanner.js', 'styling-engine/tools.js', 'routes/ai.js']) {
    const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    assert.doesNotMatch(src, CATEGORICAL, `${file} states a print-count rule`)
  }
})
