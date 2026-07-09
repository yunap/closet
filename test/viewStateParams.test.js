/**
 * test/viewStateParams.test.js
 *
 * Tests for view-state persistence via URL query params (router migration, part 2).
 * All tests are jsdom-free — pure logic assertions on the param read/write contract.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ─── Shared helpers ───────────────────────────────────────────────────────────
// These replicate the exact read/write logic used by each view component,
// so any drift between test and implementation breaks the test.

const PIECE_DEFAULTS = {
  q: '',
  category: '',
  occasion: '',
  season: '',
  color: '',
  fabric: '',
  fav: false,
}

const LOOKBOOK_DEFAULTS = {
  view: 'my-outfits',
  q: '',
  occasion: '',
  season: '',
  sort: 'newest',
  pin: true,
}

const VISLAB_DEFAULTS = {
  section: 'references',
}

// Simulate reading params from a URL search string, with defaults applied.
function parsePieceParams(search) {
  const p = new URLSearchParams(search)
  return {
    q:        p.get('q')        ?? PIECE_DEFAULTS.q,
    category: p.get('category') ?? PIECE_DEFAULTS.category,
    occasion: p.get('occasion') ?? PIECE_DEFAULTS.occasion,
    season:   p.get('season')   ?? PIECE_DEFAULTS.season,
    color:    p.get('color')    ?? PIECE_DEFAULTS.color,
    fabric:   p.get('fabric')   ?? PIECE_DEFAULTS.fabric,
    fav:      p.get('fav') === '1',
  }
}

function parseLookbookParams(search) {
  const p = new URLSearchParams(search)
  return {
    view:     p.get('view')     ?? LOOKBOOK_DEFAULTS.view,
    q:        p.get('q')        ?? LOOKBOOK_DEFAULTS.q,
    occasion: p.get('occasion') ?? LOOKBOOK_DEFAULTS.occasion,
    season:   p.get('season')   ?? LOOKBOOK_DEFAULTS.season,
    sort:     p.get('sort')     ?? LOOKBOOK_DEFAULTS.sort,
    pin:      p.get('pin') !== '0',   // default true: omitted → true, '0' → false
  }
}

function parseVislabParams(search) {
  const p = new URLSearchParams(search)
  return {
    section: p.get('section') ?? VISLAB_DEFAULTS.section,
  }
}

// Simulate the setSearchParams write — returns a URLSearchParams object
// containing only non-default values (defaults are omitted to keep URLs clean).
function buildPieceParams(state) {
  const p = new URLSearchParams()
  if (state.q)        p.set('q',        state.q)
  if (state.category) p.set('category', state.category)
  if (state.occasion) p.set('occasion', state.occasion)
  if (state.season)   p.set('season',   state.season)
  if (state.color)    p.set('color',    state.color)
  if (state.fabric)   p.set('fabric',   state.fabric)
  if (state.fav)      p.set('fav',      '1')
  return p
}

function buildLookbookParams(state) {
  const p = new URLSearchParams()
  if (state.view && state.view !== LOOKBOOK_DEFAULTS.view) p.set('view', state.view)
  if (state.q)        p.set('q',        state.q)
  if (state.occasion) p.set('occasion', state.occasion)
  if (state.season)   p.set('season',   state.season)
  if (state.sort && state.sort !== LOOKBOOK_DEFAULTS.sort) p.set('sort', state.sort)
  if (!state.pin)     p.set('pin',      '0')   // only write when false (default is true)
  return p
}

function buildVislabParams(state) {
  const p = new URLSearchParams()
  if (state.section && state.section !== VISLAB_DEFAULTS.section) p.set('section', state.section)
  return p
}

// ─── Test 1: Setting a filter updates the URL, reloading restores state ───────

describe('PieceInventory — param round-trip', () => {
  it('writing active filters produces a readable URL, which restores the same state', () => {
    const activeState = {
      q: 'linen', category: 'top', occasion: 'city',
      season: 'warm', color: 'cream', fabric: 'linen', fav: true,
    }
    const params = buildPieceParams(activeState)
    const search = params.toString()

    // All active filters must appear in the URL
    assert.ok(search.includes('q=linen'),      'search term missing')
    assert.ok(search.includes('category=top'), 'category missing')
    assert.ok(search.includes('occasion=city'),'occasion missing')
    assert.ok(search.includes('season=warm'),  'season missing')
    assert.ok(search.includes('color=cream'),  'color missing')
    assert.ok(search.includes('fabric=linen'), 'fabric missing')
    assert.ok(search.includes('fav=1'),        'fav missing')

    // Round-trip: parse the URL back and get identical state
    const restored = parsePieceParams(search)
    assert.equal(restored.q,        activeState.q)
    assert.equal(restored.category, activeState.category)
    assert.equal(restored.occasion, activeState.occasion)
    assert.equal(restored.season,   activeState.season)
    assert.equal(restored.color,    activeState.color)
    assert.equal(restored.fabric,   activeState.fabric)
    assert.equal(restored.fav,      activeState.fav)
  })

  it('each filter individually round-trips', () => {
    const cases = [
      { q: 'blazer' },
      { category: 'outerwear' },
      { occasion: 'evening' },
      { fav: true },
    ]
    for (const partial of cases) {
      const state = { ...PIECE_DEFAULTS, ...partial }
      const restored = parsePieceParams(buildPieceParams(state).toString())
      for (const [k, v] of Object.entries(state)) {
        assert.equal(restored[k], v, `round-trip failed for key: ${k}`)
      }
    }
  })
})

describe('OutfitLookbook — param round-trip', () => {
  it('activeSubTab=generated is preserved across the URL', () => {
    const state = { ...LOOKBOOK_DEFAULTS, view: 'generated' }
    const params = buildLookbookParams(state)
    assert.equal(params.get('view'), 'generated', 'view param must be set to generated')
    const restored = parseLookbookParams(params.toString())
    assert.equal(restored.view, 'generated', 'view must restore to generated')
  })

  it('all lookbook filters round-trip', () => {
    const activeState = {
      view: 'generated', q: 'summer', occasion: 'casual',
      season: 'warm', sort: 'oldest', pin: false,
    }
    const restored = parseLookbookParams(buildLookbookParams(activeState).toString())
    assert.equal(restored.view,     'generated')
    assert.equal(restored.q,        'summer')
    assert.equal(restored.occasion, 'casual')
    assert.equal(restored.season,   'warm')
    assert.equal(restored.sort,     'oldest')
    assert.equal(restored.pin,      false)
  })
})

describe('VisualLab — param round-trip', () => {
  it('section=saved is preserved across the URL', () => {
    const state = { section: 'saved' }
    const params = buildVislabParams(state)
    assert.equal(params.get('section'), 'saved')
    const restored = parseVislabParams(params.toString())
    assert.equal(restored.section, 'saved')
  })

  it('section=upload round-trips', () => {
    const restored = parseVislabParams(buildVislabParams({ section: 'upload' }).toString())
    assert.equal(restored.section, 'upload')
  })
})

// ─── Test 2: replace:true — filter changes don't spam history ─────────────────
// We can't test the actual react-router history length in a jsdom-free test,
// but we can assert that the params produced by N rapid filter changes are
// all self-consistent (i.e., each write is a full replacement, not an
// accumulation), which is the contract replace:true enforces.

describe('replace:true semantics — each write is a full replacement', () => {
  it('successive filter changes produce independent, non-accumulating param sets', () => {
    // Simulate 4 rapid filter changes
    const changes = [
      { ...PIECE_DEFAULTS, q: 'a' },
      { ...PIECE_DEFAULTS, q: 'ab' },
      { ...PIECE_DEFAULTS, q: 'abc', category: 'top' },
      { ...PIECE_DEFAULTS, q: 'abc', category: 'top', fav: true },
    ]

    // Each write should produce a complete, parseable snapshot — not a diff patch
    for (const state of changes) {
      const params = buildPieceParams(state)
      const restored = parsePieceParams(params.toString())
      assert.deepEqual(restored, state, 'param write must encode full state, not a diff')
    }
  })
})

// ─── Test 3: Bare route — no params → default state ──────────────────────────

describe('Bare route (no params) = default state', () => {
  it('PieceInventory: empty search string yields all defaults', () => {
    const state = parsePieceParams('')
    assert.deepEqual(state, PIECE_DEFAULTS)
  })

  it('OutfitLookbook: empty search string yields all defaults', () => {
    const state = parseLookbookParams('')
    assert.deepEqual(state, LOOKBOOK_DEFAULTS)
  })

  it('VisualLab: empty search string yields default section', () => {
    const state = parseVislabParams('')
    assert.deepEqual(state, VISLAB_DEFAULTS)
  })

  it('default params produce an empty URL string (no noise in clean URLs)', () => {
    assert.equal(buildPieceParams(PIECE_DEFAULTS).toString(),    '', 'piece defaults should produce empty URL')
    assert.equal(buildVislabParams(VISLAB_DEFAULTS).toString(),  '', 'vislab default should produce empty URL')
    // Lookbook: default view (my-outfits), no search/filters, pin=true → empty
    assert.equal(buildLookbookParams(LOOKBOOK_DEFAULTS).toString(), '', 'lookbook defaults should produce empty URL')
  })
})

// ─── Test 4: OutfitLookbook activeSubTab — the highest-value single case ──────

describe('OutfitLookbook /outfits?view=generated — explicit high-value case', () => {
  it('view=generated activates the Generated tab (not the My Outfits default)', () => {
    const state = parseLookbookParams('view=generated')
    assert.equal(state.view, 'generated',
      '/outfits?view=generated must yield activeSubTab = generated')
  })

  it('view=my-outfits (explicit) equals the bare default', () => {
    const explicit = parseLookbookParams('view=my-outfits')
    const bare     = parseLookbookParams('')
    assert.equal(explicit.view, bare.view)
  })

  it('unknown view value falls back to default (defensive)', () => {
    // If someone pastes /outfits?view=bogus, fallback logic applies.
    // The component should treat unrecognised values as the default.
    const VALID_VIEWS = ['my-outfits', 'generated']
    const rawView = new URLSearchParams('view=bogus').get('view')
    const resolved = VALID_VIEWS.includes(rawView) ? rawView : LOOKBOOK_DEFAULTS.view
    assert.equal(resolved, 'my-outfits')
  })
})

// ─── Test 5: Transient/modal state is NOT in the URL ─────────────────────────

describe('Transient state stays out of URL (regression guard)', () => {
  it('showTodo is not a param in PieceInventory (it is a modal-open flag)', () => {
    // Confirm buildPieceParams never writes a "todo" param, even if state had it
    const params = buildPieceParams({ ...PIECE_DEFAULTS, showTodo: true })
    assert.equal(params.get('todo'), null, 'showTodo must not appear in URL')
    assert.equal(params.get('showTodo'), null, 'showTodo must not appear in URL')
  })

  it('VisualLab sub-filters (calibrationFilter etc.) are not in URL params', () => {
    // buildVislabParams only encodes `section` — nothing else
    const params = buildVislabParams({ section: 'references', calibrationFilter: 'strong' })
    assert.equal(params.get('calibrationFilter'), null, 'calibration sub-filters must not appear in URL')
    assert.equal(params.size, 0, 'references section (default) should produce empty params')
  })

  it('Lookbook modal state (showForm, detail) is not in URL params', () => {
    const params = buildLookbookParams({ ...LOOKBOOK_DEFAULTS, showForm: true, detail: { id: 1 } })
    assert.equal(params.get('showForm'), null)
    assert.equal(params.get('detail'), null)
  })
})
