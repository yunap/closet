// Actually renders StylistSettings. Every other test in this repo asserts against the file's
// SOURCE TEXT, which cannot catch the failure mode that broke this page three times in one session:
//
//   - a helper used but never imported        (canonicalFeedbackType)
//   - a helper used above its own declaration (feedbackBoardImage, temporal dead zone)
//   - a binding deleted while a caller stayed (visibleLearnings)
//
// All three are ReferenceErrors thrown while the component function executes, so `vite build`
// reports success and a regex assertion still matches. Only running the component finds them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/visual-lab?section=profile',
  pretendToBeVisual: true,
})
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'localStorage']) {
  if (globalThis[key] === undefined) globalThis[key] = dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Realistic rows matter more than coverage here: the three regressions all lived inside callbacks
// that iterate loaded feedback, so an empty response never executes them. A static render would
// pass while the real page threw.
const FEEDBACK_ROWS = [
  {
    id: 1, feedback_type: 'wrong_length', target_type: 'generated_visual_board', context_name: 'Whole wardrobe',
    note: 'hem looked wrong', archived: false,
    payload: { board: { label: 'Winery Chic Escape', imageUrl: '/uploads/generated-boards/x.png' }, length_correction: { piece_id: 92, piece_name: 'midi skirt', issue: 'lower_hem_too_short' } },
    memory: { destination: 'renderer', strength: 'renderer', display: { title: 'Whole wardrobe', summary: 'hem looked wrong' } },
  },
  {
    id: 2, feedback_type: 'body_proportions_drift', target_type: 'generated_visual_board', context_name: 'Whole wardrobe',
    note: 'proportions off', archived: false,
    payload: { board: { label: 'Daytime Hiking', imageUrl: '/uploads/generated-boards/y.png' } },
    memory: { destination: 'renderer', strength: 'renderer', display: { title: 'Whole wardrobe', summary: 'proportions off' } },
  },
  {
    id: 3, feedback_type: 'owner_rule', target_type: 'message', note: 'No boots in summer.', archived: false,
    payload: { ownerGuidanceApplicability: { version: 1, reach: 'context', garment: { piece_ids: [], categories: [], footwear: [], materials: [] }, context: { occasions: [], activities: [], seasons: ['summer'], weather: [], situations: [] }, source: 't' } },
    memory: { destination: 'owner_prompt', strength: 'prompt', ownerGuidanceApplicability: { version: 1, reach: 'context', garment: { piece_ids: [], categories: [], footwear: [], materials: [] }, context: { occasions: [], activities: [], seasons: ['summer'], weather: [], situations: [] } } },
  },
  {
    id: 4, feedback_type: 'wrong_item_read', target_type: 'whole_wardrobe_outfit', context_type: 'wardrobe',
    context_name: 'Whole wardrobe', note: 'wrong shoe', archived: false, payload: { pieceIds: [1, 2] },
    created_at: '2026-08-10 09:00:00',
    memory: { destination: 'provisional', strength: 'context', synthesisEligible: true, display: { title: 'Rain walk', summary: 'wrong shoe' } },
  },
  // Not referenced by any draft's source_feedback_ids below, unlike id 4 — actionableContextualFeedback
  // excludes any row already used as evidence, so this is the one that stays visible as a raw,
  // still-unreviewed reaction and exercises the memory-card-feedback row itself.
  {
    id: 5, feedback_type: 'wrong_item_read', target_type: 'whole_wardrobe_outfit', context_type: 'wardrobe',
    context_name: 'Whole wardrobe', note: 'this is a very classic cardigan, does not feel right with the rest', archived: false,
    payload: {
      pieceId: 92, pieceName: 'black white trim open cardigan',
      outfit: { label: 'Soft Structure Contrast: standard wear', pieces: [{ id: 92, name: 'black white trim open cardigan', photo: 'pieces/92.jpg' }] },
    },
    created_at: '2026-08-11 17:45:02',
    memory: {
      destination: 'provisional', strength: 'context', synthesisEligible: true,
      display: { title: 'black white trim open cardigan', context: 'Wrong choice for Soft Structure Contrast: standard wear', summary: 'this is a very classic cardigan, does not feel right with the rest' },
    },
  },
]
const ROUTES = {
  '/api/stylist-feedback': FEEDBACK_ROWS,
  '/api/saved-boards': [{ id: 10, image_url: '/uploads/generated-boards/x.png', title: 'Winery Chic Escape', linked_piece_ids: [92] }],
  '/api/feedback-synthesis/drafts': [
    { id: 1, disposition: 'personal_contextual_lesson', status: 'accepted', title: 'Suede reads autumnal', proposed_text: 'Avoid suede in summer.', boundary: 'summer only', source_feedback_ids: '[4]', payload: JSON.stringify({ applicability: { version: 1, scope: 'piece_context', piece_ids: [92], occasions: [], activities: [], seasons: ['summer'], weather_terms: [] } }), applicabilityOptions: { pieces: [{ id: 92, name: 'midi skirt', photo: null }], occasions: [], activities: [], seasons: ['summer'], weather: [] } },
    { id: 2, disposition: 'insufficient_evidence', status: 'reported', title: 'Nothing learned', rationale: 'no bounded scope', source_feedback_ids: '[4]' },
    { id: 3, disposition: 'general_styling_failure', status: 'accepted', title: 'Athletic shorts', proposed_text: 'wrong register', source_feedback_ids: '[4]' },
    // A still-pending lesson naming two pieces — exercises draftLessonPhotos' two-photo path and
    // the full "Not quite" -> chips -> wording reveal, none of which the other three drafts touch.
    {
      id: 5, disposition: 'personal_contextual_lesson', status: 'draft',
      title: 'Ruffled top too delicate', proposed_text: 'This ruffled plum top feels too delicate with textured mauve pants.',
      source_feedback_ids: '[4]',
      payload: JSON.stringify({ applicability: { version: 1, scope: 'piece_context', piece_ids: [92, 93], occasions: [], activities: [], seasons: ['summer'], weather_terms: [] } }),
      applicabilityOptions: { pieces: [{ id: 92, name: 'ruffled plum top', photo: 'pieces/92.jpg' }, { id: 93, name: 'mauve pants', photo: 'pieces/93.jpg' }], occasions: [], activities: [], seasons: ['summer'], weather: [] },
    },
    // A pending product-issue draft — exercises the non-lesson branch (no applicability, "Mark
    // reviewed" instead of "Yes, remember this").
    { id: 6, disposition: 'general_styling_failure', status: 'draft', title: 'Wrong silhouette', proposed_text: 'The stylist chose an overly casual silhouette.', source_feedback_ids: '[4]' },
  ],
  '/api/owner-constraints': [{ id: 1, status: 'active', selector_type: 'footwear', selector_values: ['boots'], context_dimension: 'season', context_values: ['summer'], reason: 'Not in summer.' }],
  '/api/product-quality-findings': [{
    id: 1, status: 'open', title: 'General: Athletic shorts are not appropriate for an outdoor daytime social occasion', description: 'register', source_feedback_ids: '[408]',
    // Shape matches lib/productQualityFindings.js's productFindingEvidenceSnapshot exactly — a
    // real thread id, no board image (this was a text-only outfit, not a rendered board), and the
    // subject piece with its photo carried in `pieces`.
    evidence_snapshot: JSON.stringify([{
      feedback_id: 408, feedback_type: 'wrong_item_read', target_type: 'whole_wardrobe_outfit',
      label: 'Wrong choice: green utility pocket shorts', image_url: '', thread_id: 'thread_1781752711481',
      context: { type: 'outfit', outfitLabel: 'Soft Structure Contrast: standard wear', occasion: 'casual' },
      subject: { type: 'garment', pieceId: 247, name: 'green utility pocket shorts', category: 'bottom' },
      explicit_reason: 'athletic shorts are not a good choice for an outdoor daytime social',
      pieces: [{ id: 247, name: 'green utility pocket shorts', photo: 'pieces/247.jpg' }],
    }]),
  }],
  '/api/pieces/occasion-exclusions': [{ pieceId: 92, name: 'midi skirt', category: 'bottom', photo: null, occasion: 'hiking', changedAt: '2026-08-01' }],
  '/api/settings/constitution': { layers: [{ layer: 'body_contract', body: 'Layer 1 — Body & Comfort:\n- comfortable', updatedAt: '2026-07-18 10:00:00', isDefault: false }] },
}
globalThis.fetch = async (url) => {
  const key = Object.keys(ROUTES).find(route => String(url).startsWith(route))
  const body = key ? ROUTES[key] : []
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')

// Node cannot import .jsx, so bundle the component the way the app does. esbuild ships with vite;
// bundling also means a missing import inside any dependency of this file surfaces here too.
const esbuild = await import('esbuild')
const fs = await import('node:fs')
const path = await import('node:path')
const built = await esbuild.build({
  entryPoints: [new URL('../src/views/StylistSettings.jsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*', 'react-router-dom'],
  logLevel: 'silent',
})
// Inside the repo, not os.tmpdir(): the bundle imports react, and Node resolves bare specifiers
// relative to the importing file, so a temp-dir bundle cannot see node_modules.
const bundlePath = path.join(new URL('../node_modules/', import.meta.url).pathname, `.style-profile-smoke-${process.pid}.mjs`)
fs.writeFileSync(bundlePath, built.outputFiles[0].text)
const StylistSettings = (await import(bundlePath)).default
process.on('exit', () => { try { fs.unlinkSync(bundlePath) } catch {} })

const onGoToThreadCalls = { ids: [] }
onGoToThreadCalls.record = id => onGoToThreadCalls.ids.push(id)

// A client render, not renderToStaticMarkup: effects must run and the fetches must resolve, or the
// lists stay empty and the very callbacks that broke are never entered.
// keepMounted leaves the container attached (and returns { container, click, unmount }) so a test
// can click through a multi-step reveal, like the "Not quite" triage, and read the DOM at each step.
async function renderProfile({ tab = null, keepMounted = false } = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const errors = []
  const onError = event => errors.push(String(event.error?.message || event.message))
  dom.window.addEventListener('error', onError)
  await act(async () => {
    root.render(React.createElement(
      MemoryRouter,
      { initialEntries: ['/visual-lab?section=profile'] },
      React.createElement(StylistSettings, { mode: 'style', embedded: true, onGoToThread: onGoToThreadCalls.record }),
    ))
  })
  // let the load() chain settle
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
  if (tab) {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === tab)
    if (button) await act(async () => { button.click() })
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve() })
  }
  const click = async matcher => {
    const button = [...container.querySelectorAll('button')].find(matcher)
    if (!button) return false
    await act(async () => { button.click() })
    return true
  }
  if (keepMounted) return { container, errors, click, unmount: () => { root.unmount(); container.remove() } }
  const text = container.textContent || ''
  dom.window.removeEventListener('error', onError)
  root.unmount()
  container.remove()
  return { text, errors }
}

test('Style profile renders, with data, without throwing', async () => {
  const { text } = await renderProfile()
  assert.ok(text.length > 0, 'rendered no content')
  assert.match(text, /Active guidance/)
  assert.match(text, /Review feedback/)
})

test('the guidance tab renders its loaded records', async () => {
  const { text } = await renderProfile()
  assert.match(text, /Things your stylist remembers for particular clothes or situations/)
  assert.match(text, /Avoid suede in summer\./)     // accepted lesson card, shown by its text
  assert.match(text, /No boots in summer\./)       // told-you rule
  assert.match(text, /View past decisions/)        // history is not a primary tab
})

test('the review tab renders the sections that iterate loaded feedback', async () => {
  const { text } = await renderProfile({ tab: 'Review feedback' })
  assert.match(text, /Feedback your stylist noticed but hasn/)
  assert.match(text, /Things your stylist got wrong/)
  // The renderer-report grouping is where two of the three ReferenceErrors lived.
  assert.match(text, /Fixes your stylist applies when drawing pictures/)
  assert.match(text, /Your stylist now matches the length in your saved photo\./)
  assert.match(text, /Every picture/)
})

test('a pending lesson resting card asks a plain question, not a form', async () => {
  const { text } = await renderProfile({ tab: 'Review feedback' })
  assert.match(text, /Your stylist found a possible lesson/)
  assert.match(text, /Does this sound right\?/)
  assert.match(text, /This ruffled plum top feels too delicate with textured mauve pants\./)
  assert.match(text, /Your stylist would remember this when styling ruffled plum top or mauve pants for summer\./)
  assert.match(text, /Based on feedback you gave on Aug 10\./)
  assert.match(text, /Yes, remember this/)
  assert.match(text, /Not quite/)
  assert.match(text, /Maybe later/)
  // The raw fields this replaced must actually be gone, not just visually hidden.
  assert.doesNotMatch(text, /PERSONAL OR CONTEXTUAL LESSON|Personal or contextual lesson/)
  assert.doesNotMatch(text, /Boundary/)
  assert.doesNotMatch(text, /Would be used when/)
  assert.doesNotMatch(text, /Why it was routed here/)
  // A pending product-issue draft renders too, with disposition-appropriate copy, not "remember".
  assert.match(text, /product issue rather than a styling preference/)
  assert.match(text, /Mark reviewed/)
})

test('a raw feedback row uses the same memory-card shell as an accepted lesson', async () => {
  const { container, unmount } = await renderProfile({ tab: 'Review feedback', keepMounted: true })
  try {
    const text = container.textContent
    // Her own words are the headline — not the system's "WRONG CHOICE FOR THIS OUTFIT" eyebrow
    // stacked above a bold title stacked above a quoted note.
    assert.match(text, /This is a very classic cardigan, does not feel right with the rest/)
    assert.match(text, /black white trim open cardigan — Wrong choice for Soft Structure Contrast: standard wear/)
    const card = [...container.querySelectorAll('.memory-card-feedback')].find(el => el.textContent.includes('very classic cardigan'))
    assert.ok(card, 'feedback row did not render as a .memory-card-feedback')
    assert.ok(card.querySelector('.memory-card-thumb img'), 'the named garment has a photo in the fixture but no thumbnail rendered')
    assert.ok(card.querySelector('.feedback-synthesis-select'), '"Use this feedback" control missing from a synthesis-eligible row')
    assert.ok(card.querySelector('.style-memory-retire'), 'Remove control missing')
  } finally {
    unmount()
  }
})

test('"Not quite" reveals reason chips, and only "The wording" reveals a textarea', async () => {
  const { container, click, unmount } = await renderProfile({ tab: 'Review feedback', keepMounted: true })
  try {
    assert.equal(container.querySelectorAll('.memory-card-pending textarea').length, 0, 'a textarea is visible before any triage choice')
    const openedTriage = await click(b => b.textContent.trim() === 'Not quite')
    assert.ok(openedTriage, '"Not quite" button not found')
    const text1 = container.textContent
    assert.match(text1, /What isn.t right\?/)
    assert.match(text1, /The wording/)
    assert.match(text1, /It applies too broadly/)
    assert.match(text1, /This shouldn.t be a lesson/)
    assert.equal(container.querySelectorAll('.memory-card-pending textarea').length, 0, 'a textarea appeared from the chip list alone')
    const openedWording = await click(b => b.textContent.trim() === 'The wording')
    assert.ok(openedWording, '"The wording" chip not found')
    assert.equal(container.querySelectorAll('.memory-card-pending textarea').length, 1, 'choosing "The wording" did not reveal exactly one textarea')
    assert.match(container.textContent, /Looks better — remember this/)
  } finally {
    unmount()
  }
})

test('a product-issue finding links its evidence to the source chat and garment, not a bare id', async () => {
  onGoToThreadCalls.ids.length = 0
  const { container, click, unmount } = await renderProfile({ tab: 'Review feedback', keepMounted: true })
  try {
    const summary = [...container.querySelectorAll('.style-memory-technical summary')].find(el => el.textContent.includes('Evidence & source'))
    assert.ok(summary, 'Evidence & source disclosure not found')
    await click(b => b === summary)
    const text = container.textContent
    // Her actual words, not a bare feedback id.
    assert.match(text, /green utility pocket shorts/)
    assert.match(text, /athletic shorts are not a good choice for an outdoor daytime social/)
    assert.doesNotMatch(text, /#408/, 'still showing the bare feedback id instead of a real link')
    const clickedChat = await click(b => b.closest('.product-finding-evidence-links') && b.textContent.trim() === 'Open source chat')
    assert.ok(clickedChat, '"Open source chat" control missing even though the fixture carries a real thread_id')
    assert.deepEqual(onGoToThreadCalls.ids, ['thread_1781752711481'], 'clicking "Open source chat" did not call onGoToThread with the evidence\'s real thread id')
    const openGarment = [...container.querySelectorAll('.product-finding-evidence-links button')].find(b => b.textContent.trim() === 'Open garment')
    assert.ok(openGarment, '"Open garment" control missing even though the fixture carries a subject pieceId')
    // No board image in this fixture (a text-only outfit) — "Open board" must not appear for it.
    assert.ok(!container.querySelector('.product-finding-evidence-links')?.textContent.includes('Open board'), '"Open board" rendered despite no image_url in the evidence')
  } finally {
    unmount()
  }
})
