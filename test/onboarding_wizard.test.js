// Spec 32 Part 3 — source contracts for the onboarding wizard and settings surface.
// Pins the review rulings: Layer-1 is skippable ONLY via the explicit no-restrictions
// confirmation; every layer save goes through an editable preview and carries
// source:'interview'; the aesthetic step never synthesizes favorite-color claims;
// Layer 2 (proven formulas) is NOT interviewed; the wizard is re-runnable per layer
// from settings; fresh instances redirect into the wizard, legacy ones never do
// (server-decided via onboarding-status).
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const read = p => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

test('onboarding wizard enforces the Layer-1 explicit-escape ruling and interview sourcing', () => {
  const src = read('src/views/Onboarding.jsx')
  assert.match(src, /disabled=\{comfortSelectionEmpty && !noRestrictions\}/, 'comfort step must not proceed silently empty')
  assert.match(src, /I confirm I have no hard restrictions/, 'the escape must be an explicit confirmation')
  assert.match(src, /source: 'interview'/, 'wizard writes must be history-tagged as interview')
  assert.ok(!/proven_formulas/.test(src), 'Layer 2 is earned, never interviewed')
  assert.match(src, /Never state any color as a favorite, signature/, 'the generalized plum/mustard rule is written into every assembled aesthetic layer')
  assert.match(src, /as stated/, 'colors are recorded verbatim, not promoted')
})

test('every constitution step previews editable text before saving', () => {
  const src = read('src/views/Onboarding.jsx')
  for (const preview of ['comfortPreview', 'aestheticPreview', 'workingPreview']) {
    assert.ok(src.includes(`${preview} === null`), `${preview} gate exists`)
    assert.ok(src.includes(`onChange={e => set${preview[0].toUpperCase()}${preview.slice(1)}(e.target.value)}`), `${preview} is editable`)
  }
})

test('app shell wires the wizard: routes, first-run redirect, settings nav', () => {
  const src = read('src/App.jsx')
  assert.match(src, /path="\/onboarding" element=\{<Onboarding \/>\}/)
  assert.match(src, /path="\/settings"\s+element=\{<StylistSettings \/>\}/)
  assert.match(src, /settings\/onboarding-status/)
  assert.match(src, /navigate\('\/onboarding', \{ replace: true \}\)/)
})

test('settings surface exposes per-layer editing, history, and interview re-runs', () => {
  const src = read('src/views/StylistSettings.jsx')
  assert.match(src, /constitution\/\$\{layer\}\/history/)
  assert.match(src, /\/onboarding\?step=\$\{INTERVIEW_STEPS\[layer\]\}&return=visual-lab/)
  for (const layer of ['body_contract', 'proven_formulas', 'aesthetic_gravity', 'lane_neutrality', 'working_style', 'editorial_subject', 'editorial_shoes']) {
    assert.ok(src.includes(layer), `settings lists ${layer}`)
  }
})

test('settings surfaces learned rules globally: durable types listed, editable, retirable', () => {
  const src = read('src/views/StylistSettings.jsx')
  assert.match(src, /Learned rules & preferences/, 'global learnings section exists')
  for (const type of ['owner_rule', 'preference_reaction', 'correction']) {
    assert.ok(src.includes(type), `durable learning type ${type} included`)
  }
  assert.match(src, /archived: true/, 'learnings can be retired (archived), never silently deleted')
  assert.match(src, /stylist-feedback\?limit/, 'reads the un-scoped feedback listing')
})

test('style profile makes contextual outfit and styling feedback searchable by name', () => {
  const src = read('src/views/StylistSettings.jsx')
  assert.match(src, /Outfit &amp; styling feedback/)
  assert.match(src, /Search by outfit, styling feedback, or note/)
  assert.match(src, /row\.context_name, row\.label, row\.note, row\.feedback_type/)
  assert.match(src, /navigate\(`\/outfits\?outfitId=\$\{row\.context_id\}`\)/)
  assert.match(src, /navigate\(`\/wardrobe\?pieceId=\$\{row\.context_id\}`\)/)
  assert.match(src, /Open board/)
  assert.match(src, /section=profile&boardId=\$\{existingBoardId\}/)
  assert.match(src, /feedbackBoards\.find\(board => board\.image_url === imageUrl\)/)
  assert.match(src, /method: 'POST'[\s\S]*boardType: board\.wholeWardrobe/)
  assert.match(src, /Open garment/)
  assert.match(src, /Open source chat/)
  assert.match(src, /row\?\.payload\?\.pieceId \|\| row\?\.payload\?\.piece\?\.id/)
  assert.match(src, /onGoToThread\(row\.referenced_thread_id\)/)
  assert.doesNotMatch(src, />\{row\.context_id\}</)
})

test('whole-wardrobe generated-board feedback does not inherit the open outfit context', () => {
  const src = read('src/components/StylistChat.jsx')
  assert.match(src, /message\?\.wholeWardrobe \|\| board\?\.wholeWardrobe \|\| outfit\?\.wholeWardrobe/)
  assert.match(src, /return \{ type: 'wardrobe', id: null, name: 'Whole wardrobe' \}/)
})
