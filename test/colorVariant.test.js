import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-color-variant-tests-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { app, db } = await import('../server.js')
const { buildColorVariantDraft, memoryItemsFor, applyMemoryChoices } = await import('../src/utils/colorVariant.js')
const { applyOwnerGarmentNotes, GARMENT_NOTE_PATHS } = await import('../styling-engine/garmentNotes.js')
const { applyTaggerResult } = await import('../styling-engine/taggerMerge.js')

const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`

after(async () => {
  await new Promise(resolve => server.close(resolve))
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const original = {
  id: 7,
  name: 'cream cotton button-up shirt',
  category: 'top',
  top_subtype: 'shirt_blouse',
  colors: ['cream', 'white'],
  reads_as: 'soft pale neutral',
  background_color: 'cream',
  photo: 'cream.jpg',
  worn_photo: 'cream-worn.jpg',
  formality: 'everyday',
  silhouette: 'relaxed',
  fabric_category: 'cotton',
  season: 'warm',
  occasions: ['casual', 'city'],
  status: 'needs-repair',
  notes: 'Runs a little long.',
  engine_notes: 'too sheer for a focal evening look',
  styling_rules_learned: ['always half-tuck', 'Excluded from evening by Yuna (2026-09-01)'],
  tried_and_rejected: ['grey wide-leg — too much volume'],
  occasion_exclusions: ['evening'],
  manual_overrides: ['colors', 'neckline', 'style_profile_json.garment_intelligence.do_not_pair_rules'],
  style_profile_json: {
    style_notes: { best_use: 'tucked into tailored bottoms', risk: 'reads shapeless untucked' },
    garment_intelligence: {
      failure_risks: ['wrinkles easily', 'all-cream styling risks a flat, washed-out palette'],
      do_not_pair_rules: ['another pale, loose top layer'],
      real_wear_notes: { fit: 'relaxed through the body', maintenance: 'needs steaming' },
    },
    photo_properties: { 'HANGER PHOTO': { fit_visible: false } },
    _confidence: { colors: 'high', reads_as: 'high', background_color: 'high', silhouette: 'medium' },
  },
}

test('a color copy keeps every structured tag and clears what describes the original color or photo', () => {
  const draft = buildColorVariantDraft(original)
  assert.equal(draft.id, undefined)
  assert.equal(draft.photo, undefined)
  assert.equal(draft.worn_photo, undefined)
  assert.deepEqual(draft.colors, [])
  assert.equal(draft.reads_as, '')
  assert.equal(draft.background_color, '')
  assert.equal(draft.status, 'active')
  for (const field of ['name', 'category', 'top_subtype', 'formality', 'silhouette', 'fabric_category', 'season']) {
    assert.deepEqual(draft[field], original[field], field)
  }
  assert.deepEqual(draft.occasions, original.occasions)
  // The tagger's notes come across (the form shows them as editable); the photo's properties do not.
  assert.deepEqual(draft.style_profile_json.garment_intelligence, original.style_profile_json.garment_intelligence)
  assert.equal(draft.style_profile_json.photo_properties, undefined)
  assert.deepEqual(draft.style_profile_json._confidence, { silhouette: 'medium' })
  assert.deepEqual(draft.manual_overrides, ['neckline', 'style_profile_json.garment_intelligence.do_not_pair_rules'])
})

test('the owner memory is not copied unless ticked, and exclusion receipts are offered as the exclusion', () => {
  const draft = buildColorVariantDraft(original)
  assert.deepEqual(draft.styling_rules_learned, [])
  assert.deepEqual(draft.tried_and_rejected, [])
  assert.equal(draft.notes, '')
  assert.equal(draft.engine_notes, '')
  assert.equal(draft.occasion_exclusions, undefined)

  const items = memoryItemsFor(original)
  assert.deepEqual(items.map(item => item.text), [
    'always half-tuck',
    'grey wide-leg — too much volume',
    'Never offered for evening',
    'Runs a little long.',
    'too sheer for a focal evening look',
  ])
  const none = applyMemoryChoices(items, [])
  assert.deepEqual(none, { fields: { styling_rules_learned: [], tried_and_rejected: [], notes: '', engine_notes: '' }, exclusions: [] })
  const some = applyMemoryChoices(items, ['rule-0', 'exclusion-evening'])
  assert.deepEqual(some.fields.styling_rules_learned, ['always half-tuck'])
  assert.deepEqual(some.exclusions, ['evening'])
  // A ticked note can be rewritten before copying (keep the cut, fix the color); emptied means dropped.
  const edited = applyMemoryChoices(items, ['notes', 'rule-0', 'exclusion-evening'], {
    notes: '  Runs a little long; navy hides creasing. ',
    'rule-0': '   ',
    'exclusion-evening': 'ignored',
  })
  assert.equal(edited.fields.notes, 'Runs a little long; navy hides creasing.')
  assert.deepEqual(edited.fields.styling_rules_learned, [])
  assert.deepEqual(edited.exclusions, ['evening'])
})

test('owner note edits write only garment-note paths and claim them as manual overrides', () => {
  const { profile, overridePaths } = applyOwnerGarmentNotes(
    { garment_intelligence: { failure_risks: ['a', 'b'], best_outfit_role: 'support' } },
    {
      'garment_intelligence.failure_risks': ['wrinkles easily', ' wrinkles easily ', ''],
      'style_notes.risk': '  reads shapeless untucked ',
      'garment_intelligence.best_outfit_role': 'hero',
      formality: 'dressy',
    }
  )
  assert.deepEqual(profile.garment_intelligence.failure_risks, ['wrinkles easily'])
  assert.equal(profile.garment_intelligence.best_outfit_role, 'support')
  assert.equal(profile.style_notes.risk, 'reads shapeless untucked')
  assert.equal(profile.formality, undefined)
  assert.deepEqual(overridePaths, ['style_profile_json.garment_intelligence.failure_risks', 'style_profile_json.style_notes.risk'])
  assert.ok(GARMENT_NOTE_PATHS.every(p => !p.startsWith('style_profile_json')))
})

test('a retag keeps an owner-edited note list', () => {
  const piece = {
    manual_overrides: ['style_profile_json.garment_intelligence.failure_risks'],
    style_profile_json: { garment_intelligence: { failure_risks: ['wrinkles easily'], do_not_pair_rules: ['old'] } },
  }
  const merged = applyTaggerResult(piece, {
    style_profile_json: { garment_intelligence: { failure_risks: ['all-cream risks a flat palette'], do_not_pair_rules: ['new'] } },
  })
  const profile = merged.style_profile_json
  assert.deepEqual(profile.garment_intelligence.failure_risks, ['wrinkles easily'])
  assert.deepEqual(profile.garment_intelligence.do_not_pair_rules, ['new'])
})

function pieceForm(fields) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue
    fd.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  return fd
}

test('saving an edited note lands even though the path is protected, on create and on every later save', async () => {
  const profile = { garment_intelligence: { failure_risks: ['wrinkles easily', 'all-cream risks a flat palette'] } }
  const created = await (await fetch(`${baseUrl}/api/pieces`, {
    method: 'POST',
    body: pieceForm({
      name: 'navy cotton button-up shirt', category: 'top', colors: ['navy'],
      style_profile_json: profile,
      manual_overrides: ['colors', 'style_profile_json.garment_intelligence.failure_risks'],
      owner_garment_notes: { 'garment_intelligence.failure_risks': ['wrinkles easily'] },
    }),
  })).json()
  assert.deepEqual(created.style_profile_json.garment_intelligence.failure_risks, ['wrinkles easily'])
  assert.ok(created.manual_overrides.includes('style_profile_json.garment_intelligence.failure_risks'))

  // A later edit of the now-protected path: the profile merge keeps the stored value, then the
  // owner write replaces it.
  const edited = await (await fetch(`${baseUrl}/api/pieces/${created.id}`, {
    method: 'PUT',
    body: pieceForm({
      name: created.name, category: 'top', colors: ['navy'],
      style_profile_json: { garment_intelligence: { failure_risks: ['wrinkles easily', 'shows sweat'] } },
      manual_overrides: created.manual_overrides,
      owner_garment_notes: { 'garment_intelligence.failure_risks': ['wrinkles easily', 'shows sweat'] },
    }),
  })).json()
  assert.deepEqual(edited.style_profile_json.garment_intelligence.failure_risks, ['wrinkles easily', 'shows sweat'])

  // A save that does not touch notes leaves them alone.
  const untouched = await (await fetch(`${baseUrl}/api/pieces/${created.id}`, {
    method: 'PUT',
    body: pieceForm({
      name: created.name, category: 'top', colors: ['navy'],
      style_profile_json: { garment_intelligence: { failure_risks: ['tagger text'] } },
      manual_overrides: edited.manual_overrides,
    }),
  })).json()
  assert.deepEqual(untouched.style_profile_json.garment_intelligence.failure_risks, ['wrinkles easily', 'shows sweat'])
})

test('the original piece is untouched by adding its color copy', async () => {
  const first = await (await fetch(`${baseUrl}/api/pieces`, {
    method: 'POST',
    body: pieceForm({ name: 'striped linen tee', category: 'top', colors: ['white'], style_profile_json: original.style_profile_json }),
  })).json()
  const draft = buildColorVariantDraft(first)
  const second = await (await fetch(`${baseUrl}/api/pieces`, {
    method: 'POST',
    body: pieceForm({ ...draft, name: 'striped linen tee (navy)', colors: ['navy'] }),
  })).json()
  assert.notEqual(second.id, first.id)
  const reread = await (await fetch(`${baseUrl}/api/pieces/${first.id}`)).json()
  assert.deepEqual(reread.colors, ['white'])
  assert.equal(reread.name, 'striped linen tee')
  assert.deepEqual(second.colors, ['navy'])
  assert.equal(second.style_profile_json.photo_properties, undefined)
})
