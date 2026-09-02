// Spec: docs/fit-on-body-definitions-spec.md — fit_on_body gains definitions, the enum does not
// change. These guard the wording that carries the meaning; a live retag is what proves the model
// acts on it, and that is recorded in the spec as still outstanding.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { FIT_ON_BODY_VALUES, FIT_ON_BODY_SCHEMA_DESCRIPTION } from '../styling-engine/attributes.js'
import { buildPrompts } from '../styling-engine/prompts.js'
import { LEGACY_PROFILE, LEGACY_CONSTITUTION } from '../styling-engine/constitutionSeed.js'

const { TAG_PIECE_PROMPT } = buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION })

test('the enum is unchanged — this spec defines values, it does not add or remove any', () => {
  assert.deepEqual(FIT_ON_BODY_VALUES,
    ['clings_stretchy', 'clings_drapey', 'skims', 'hangs_straight', 'drapes', 'structured', 'none'])
  assert.ok(FIT_ON_BODY_SCHEMA_DESCRIPTION.startsWith(FIT_ON_BODY_VALUES.join('|')))
})

test('every value is actually defined, not just listed', () => {
  // The defect this closes: seven near-synonyms with no statement of what separates them.
  for (const value of FIT_ON_BODY_VALUES) {
    assert.ok(FIT_ON_BODY_SCHEMA_DESCRIPTION.includes(`'${value}':`),
      `${value} is offered as a choice but never defined`)
  }
})

test('the three disambiguations survive — the definitions alone would not have fixed 996866', () => {
  assert.match(TAG_PIECE_PROMPT, /ask whether there is WAIST DEFINITION/)
  assert.match(TAG_PIECE_PROMPT, /PADDING IS NOT STRUCTURE/)
  assert.match(TAG_PIECE_PROMPT, /fit_on_body is NOT silhouette/)
  assert.match(TAG_PIECE_PROMPT, /shaped or elasticated side panels/,
    'the specific feature the model misread as texture contrast')
})

test('fabric stiffness is a default that shaping overrides, not a determinant', () => {
  // The actual cause. The Fabric & Drape block used to map stiffness straight onto a fit value,
  // so a quilted nylon shell was classified "structured or hangs_straight" per instructions —
  // correct obedience to a wrong rule. Stiffness and body relationship are different axes.
  assert.ok(!/Holds its own shape away from the body\. Fit matches:/.test(TAG_PIECE_PROMPT),
    'stiffness must no longer decide the fit value outright')
  assert.match(TAG_PIECE_PROMPT, /Fit DEFAULTS to "structured" or "hangs_straight" — but this is a fallback/)
  assert.match(TAG_PIECE_PROMPT, /a stiff fabric can still be cut to the waist/)

  // Self-inflicted regression, caught by a live retag. The first implementation ADDED
  // "quilted/padded shells" to the stiff-fabric list — telling the model in one line that a padded
  // shell defaults to hangs_straight, and ten lines later that padding is not structure. For the
  // one garment this spec exists to fix, the wrong signal was stated first and nearer the fabric
  // reasoning. The retag still returned hangs_straight.
  assert.ok(!/Structured\/Stiff \([^)]*quilted/i.test(TAG_PIECE_PROMPT),
    'quilting must not be listed as a stiff fabric — it primes exactly the wrong fit value')
  assert.match(TAG_PIECE_PROMPT, /QUILTING AND PADDING ARE NOT STIFFNESS/)
})

test('both photo-derived producers project one description', () => {
  const ai = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const prompts = fs.readFileSync(path.join(process.cwd(), 'styling-engine/prompts.js'), 'utf8')
  for (const [name, text] of Object.entries({ 'routes/ai.js': ai, 'styling-engine/prompts.js': prompts })) {
    assert.match(text, /\$\{FIT_ON_BODY_SCHEMA_DESCRIPTION\}/, `${name} must project the description`)
    assert.ok(!text.includes("follows the body closely because the fabric stretches onto it"),
      `${name} restates the definitions instead of projecting them`)
  }
  // /extract-pieces keeps its own worn-photo authority sentence on top of the shared description.
  assert.match(ai, /\$\{FIT_ON_BODY_SCHEMA_DESCRIPTION\} This photo IS a worn photo/)
})
