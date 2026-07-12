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
  assert.match(source, /<button className="btn-secondary" onClick=\{\(\) => onEdit\(\{ \.\.\.outfit, pieces, main_piece_id: mainPieceId \}\)\}>Edit<\/button>/)
  assert.match(source, /onEdit=\{outfit => \{ setDetail\(null\); setEditOutfit\(outfit\); setShowForm\(true\) \}\}/)
  assert.match(source, /<OutfitForm outfit=\{editOutfit\}/)
})

test('Piece selector supports marking a linked outfit piece as Main', () => {
  assert.match(source, /function PieceSelector\(\{ outfitId, linkedPieceIds, mainPieceId = null/)
  assert.match(source, /body: JSON\.stringify\(\{ pieceIds: selectedIds, mainPieceId: nextMainId \}\)/)
  assert.match(source, /e\.preventDefault\(\)/)
  assert.match(source, /e\.stopPropagation\(\)/)
  assert.match(source, /setMainId\(isMain \? null : pieceId\)/)
  assert.match(source, /const isMain = mainId === pieceId/)
  assert.match(source, />\s*Main\s*<\/button>/)
  assert.match(source, /main_piece_id: mainPieceId/)
})

test('Similar outfit actions request wardrobe formula variants', () => {
  assert.match(source, /variantMode: 'formula'/)
  assert.match(source, /Create formula-similar outfits from my wardrobe based on this saved look\./)
  assert.doesNotMatch(source, /variantMode: 'similar'/)
})

test('indoor season matches warm, cool, and year-round browsing but can be filtered directly', () => {
  assert.match(source, /if \(selectedSeason === 'indoor'\) return outfitSeason === 'indoor'/)
  assert.match(source, /if \(selectedSeason === 'year-round'\) return outfitSeason === 'year-round' \|\| outfitSeason === 'indoor'/)
  assert.match(source, /return outfitSeason === selectedSeason \|\| outfitSeason === 'year-round' \|\| outfitSeason === 'indoor'/)
})

test('Generated Outfits board images are normalized before rendering and critique handoff', () => {
  assert.match(source, /const resolveUploadImageSrc = \(photo\) =>/)
  assert.ok(source.includes("value.replace(/^\\/uploads\\/+uploads\\//, '/uploads/')"))
  assert.match(source, /value\.startsWith\('generated-boards\/'\)/)
  assert.match(source, /const uploadsIndex = value\.indexOf\('\/uploads\/'\)/)
  assert.match(source, /const boardImageSrc = resolveUploadImageSrc\(board\.image_url\)/)
  assert.match(source, /src=\{boardImageSrc\}/)
  assert.match(source, /src=\{resolveUploadImageSrc\(b\.image_url\)\}/)
  assert.match(source, /photo: resolveUploadImageSrc\(board\.image_url\)/)
})
