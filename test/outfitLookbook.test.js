import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/views/OutfitLookbook.jsx', import.meta.url), 'utf8')

test('OutfitLookbook exposes indoor season in filters and edit form', () => {
  assert.match(source, /value:\s*'indoor',\s*label:\s*'🏠 Indoor \/ Any Weather'/)
  assert.match(source, /const OUTFIT_SEASONS = \[/)
  assert.match(source, /value:\s*'indoor',\s*label:\s*'indoor'/)
})

test('OutfitForm edit mode prepopulates fields and submits PUT to the outfit endpoint', () => {
  assert.match(source, /function OutfitForm\(\{ outfit = null, onSave, onCancel \}\)/)
  assert.match(source, /const isEdit = Boolean\(outfit\)/)
  assert.match(source, /useState\(outfit\?\.name \|\| ''\)/)
  assert.match(source, /useState\(outfit\?\.occasion \|\| 'casual'\)/)
  assert.match(source, /useState\(outfit\?\.season \|\| 'year-round'\)/)
  assert.match(source, /useState\(outfit\?\.notes \|\| ''\)/)
  assert.match(source, /useState\(outfit\?\.status \|\| 'confirmed'\)/)
  assert.match(source, /fetch\(isEdit \? `\/api\/outfits\/\$\{outfit\.id\}` : '\/api\/outfits'/)
  assert.match(source, /method: isEdit \? 'PUT' : 'POST'/)
})

test('OutfitDetail opens the shared form for editing', () => {
  assert.match(source, /function OutfitDetail\(\{ outfit, onClose, onEdit, onDelete/)
  assert.match(source, /<button className="btn-secondary" onClick=\{\(\) => onEdit\(\{ \.\.\.outfit, pieces \}\)\}>Edit<\/button>/)
  assert.match(source, /onEdit=\{outfit => \{ setDetail\(null\); setEditOutfit\(outfit\); setShowForm\(true\) \}\}/)
  assert.match(source, /<OutfitForm outfit=\{editOutfit\}/)
})

test('indoor season matches warm, cool, and year-round browsing but can be filtered directly', () => {
  assert.match(source, /if \(selectedSeason === 'indoor'\) return outfitSeason === 'indoor'/)
  assert.match(source, /if \(selectedSeason === 'year-round'\) return outfitSeason === 'year-round' \|\| outfitSeason === 'indoor'/)
  assert.match(source, /return outfitSeason === selectedSeason \|\| outfitSeason === 'year-round' \|\| outfitSeason === 'indoor'/)
})
