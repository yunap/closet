import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const pieceCardSource = fs.readFileSync(new URL('../src/components/PieceCard.jsx', import.meta.url), 'utf8')
const pieceDetailSource = fs.readFileSync(new URL('../src/components/PieceDetail.jsx', import.meta.url), 'utf8')
const pieceFormSource = fs.readFileSync(new URL('../src/components/PieceForm.jsx', import.meta.url), 'utf8')
const relationshipSource = fs.readFileSync(new URL('../src/utils/garmentRelationships.js', import.meta.url), 'utf8')

test('garment grid, detail, and editor use the retina-ready display derivative', () => {
  assert.match(pieceCardSource, /garment-display/)
  assert.match(pieceDetailSource, /garment-display/)
  assert.match(pieceFormSource, /garment-display/)
})

test('piece editor uses fixed photo slots without a photo-size control', () => {
  assert.doesNotMatch(pieceFormSource, /photoPreviewSize|aria-label="Photo size"/)
})

test('piece editor preserves accessible dialog and progressive-disclosure structure', () => {
  assert.match(pieceFormSource, /role="dialog"/)
  assert.match(pieceFormSource, /aria-modal="true"/)
  assert.match(pieceFormSource, /className="piece-form-disclosure"/)
  assert.match(pieceFormSource, /Required to add this garment\./)
  assert.match(pieceFormSource, /Add a name to continue/)
  assert.match(pieceFormSource, /aria-required="true"/)
  assert.match(pieceFormSource, /aria-pressed=\{form\.season === s\}/)
  assert.match(pieceFormSource, /Garment character/)
  assert.match(pieceFormSource, />What the stylist should remember</)
  assert.match(pieceFormSource, /requestClose/)
})

test('standard AI retag merges every fit field exposed by worn-photo analysis', () => {
  assert.match(pieceFormSource, /applyTagValue\(next, 'stretch', tags\.stretch\)/)
  assert.match(pieceFormSource, /applyTagValue\(next, 'tuck_behavior', tags\.tuck_behavior\)/)
  assert.match(pieceFormSource, /applyTagValue\(next, 'waistband_type', tags\.waistband_type\)/)
})

test('add piece is a shorter intake flow with optional refinement', () => {
  assert.match(pieceFormSource, /Start with a photo or the details you already know/)
  assert.match(pieceFormSource, /Fill details with AI/)
  assert.match(pieceFormSource, /Refine garment details/)
  assert.match(pieceFormSource, /Fit and wear/)
  assert.match(pieceFormSource, /Add a note/)
  assert.match(pieceFormSource, /\{isEdit && <details className="piece-form-disclosure">/)
  assert.match(pieceFormSource, /\{isEdit && \(\s*<div className="form-group">\s*<label className="form-label">Status/)
})

test('edit piece presents missing recommendation data as actionable, non-blocking help', () => {
  assert.match(pieceFormSource, /Add for better outfit suggestions:/)
  assert.match(pieceFormSource, /revealMissingField/)
  assert.match(pieceFormSource, /data-piece-field="formality"/)
  assert.match(pieceFormSource, /data-piece-field="fiber_content"/)
  assert.doesNotMatch(pieceFormSource, /Needed for reliable outfit suggestions:/)
})

test('garment relationships preload on intent and prioritize initially visible thumbnails', () => {
  assert.match(pieceCardSource, /prefetchGarmentRelationships\(piece\.id\)/)
  assert.match(pieceDetailSource, /getCachedGarmentRelationships\(piece\.id\)/)
  assert.match(pieceDetailSource, /loading=\{prioritize \? 'eager' : 'lazy'\}/)
  assert.match(pieceDetailSource, /fetchPriority=\{prioritize \? 'high' : 'auto'\}/)
  assert.match(relationshipSource, /savedBoards\.slice\(0, 4\)/)
  assert.match(relationshipSource, /relationshipRequests\.has\(key\)/)
})
