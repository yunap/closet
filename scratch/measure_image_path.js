// Measures the IMAGE-GENERATION path's real inputs — the app's most expensive operation.
//
// Every number here comes from running the real reference-image builders (sharp only) against the
// real wardrobe. No OpenAI client is constructed and no image is generated, so this costs nothing.
// What it cannot measure is the output image itself; that is priced as a flat constant by the
// client (see docs/engine-behaviour-map.md → "The image-generation path").
//
//   node scratch/measure_image_path.js
//
// Read-only. No network, no model call.

import { db, parsePiece, userUploadsDir } from '../db.js'
import fs from 'fs'
import path from 'path'
import { garmentReferenceImage, getOpenAIImageSize, getOpenAIImageFallbackModels, photoPreservingVisualsEnabled } from '../styling-engine/core.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
const withPhoto = pieces.filter(p => p.photo || p.worn_photo)

console.log('--- configuration as this environment resolves it ---')
console.log(`  image size (generate):   ${getOpenAIImageSize('generate')}`)
console.log(`  image size (identity):   ${getOpenAIImageSize('identity')}`)
console.log(`  fallback model chain:    ${getOpenAIImageFallbackModels().join(' -> ')}`)
console.log(`  photo-preserving mode:   ${photoPreservingVisualsEnabled()}  (true = no billed image call)`)

console.log('\n--- garment reference payloads (resized 768px, jpeg q84) ---')
console.log(`  ${withPhoto.length} of ${pieces.length} active pieces have a usable photo`)

// Composition paths send at most 5 garment references; sample a spread of real pieces.
const sample = []
for (let i = 0; i < Math.min(24, withPhoto.length); i++) {
  sample.push(withPhoto[Math.floor((i * withPhoto.length) / 24)])
}

let total = 0
const sizes = []
for (const piece of sample) {
  const ref = await garmentReferenceImage(piece)
  if (!ref) continue
  const bytes = Buffer.byteLength(ref.base64, 'utf8')
  sizes.push(bytes)
  total += bytes
}
sizes.sort((a, b) => a - b)
const kb = n => `${(n / 1024).toFixed(0)} KB`
const mean = total / (sizes.length || 1)
console.log(`  sampled ${sizes.length}: min ${kb(sizes[0])}, median ${kb(sizes[Math.floor(sizes.length / 2)])}, max ${kb(sizes[sizes.length - 1])}, mean ${kb(mean)}`)
console.log(`  a 5-garment outfit therefore ships ~${kb(mean * 5)} of base64 garment reference`)

// Calibration references are added on top, up to the caller's limit (2 for whole-wardrobe).
const calibration = db.prepare(
  "SELECT * FROM calibration_images WHERE COALESCE(archived,0) = 0 AND kind IN ('good_reference','real_photo')"
).all()
console.log('\n--- calibration reference pool ---')
const byKind = {}
for (const row of calibration) byKind[row.kind] = (byKind[row.kind] || 0) + 1
console.log(`  ${calibration.length} eligible rows: ${Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(', ')}`)
console.log(`  ${calibration.filter(r => r.favorite).length} are starred (starred rows are drawn first)`)

// Rough token cost of the image INPUTS, using OpenAI's ~750 tokens for a 768x768 image.
const IMAGE_TOKENS = 750
console.log('\n--- input scale for one whole-wardrobe generation ---')
console.log(`  up to 5 garment references + 2 calibration references = 7 images`)
console.log(`  ~${(7 * IMAGE_TOKENS).toLocaleString()} input tokens of imagery alone, before any prompt text`)
console.log(`  at gpt-4o's $2.50/Mtok input, that is ~$${((7 * IMAGE_TOKENS * 2.5) / 1_000_000).toFixed(4)} of input`)
console.log(`  the generated image itself is billed separately and is the dominant cost`)

console.log('\n--- what the user is shown ---')
console.log(`  StylistChat.calculateOpenAICost adds a FLAT $0.08 for a 1024x1536 image`)
console.log(`  ($0.04 for 1024x1024). That constant is client-side and independent of quality,`)
console.log(`  model, and how many attempts the server actually made.`)
console.log(`  It returns null when timings.usage is absent — which is the case for every`)
console.log(`  collage render (correctly, they are free) AND for the gpt-image-1 fallback`)
console.log(`  renderer (incorrectly — that one is billed and shows no cost at all).`)

// ── the prompts themselves ──────────────────────────────────────────────────
import { wholeWardrobeImagePrompt, editorialImagePrompt } from '../styling-engine/core.js'
import { getSavedBoardRendererMemory, pieceTextBlob } from '../styling-engine/rules.js'
import { wardrobeCategoryGroup } from '../styling-engine/attributes.js'

console.log('\n--- prompt size, built against real pieces ---')
const outfitPieces = ['top', 'bottom', 'shoes']
  .map(g => withPhoto.find(p => wardrobeCategoryGroup(p) === g))
  .filter(Boolean)
const wwPrompt = wholeWardrobeImagePrompt({
  outfit: { label: 'sample', dominantDirection: 'd', silhouette: 's', reason: 'r', watchFor: 'w' },
  pieces: outfitPieces, occasion: 'casual', season: 'summer'
})
console.log(`  wholeWardrobeImagePrompt (3 pieces): ${wwPrompt.length} chars, ~${Math.round(wwPrompt.length / 4)} tokens`)
const edPrompt = editorialImagePrompt({
  selectedPiece: outfitPieces[0],
  direction: { missingPieces: ['a', 'b'], reason: 'r' },
  occasion: 'casual', season: 'summer'
})
console.log(`  editorialImagePrompt (1 anchor):     ${edPrompt.length} chars, ~${Math.round(edPrompt.length / 4)} tokens`)
console.log(`  editorial anchor description uses name/category/colors/notes only —`)
console.log(`  it references selectedPiece.fabric, a column that does not exist (fabric_category does).`)

// ── fidelity checklist: does the pattern clause reach the patterned pieces? ──
// The checklist regex and the diversity classifier's regex are DIFFERENT lists.
const CHECKLIST_RE = /\b(floral|botanical|paisley|abstract|stripe|striped|pattern|tapestry)\b/
const DIVERSITY_RE = /\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/
const patternedByTag = pieces.filter(p => {
  const t = String(p.pattern_type || '').toLowerCase()
  return t && t !== 'solid' && t !== 'none'
})
const seenByChecklist = patternedByTag.filter(p => CHECKLIST_RE.test(pieceTextBlob(p)))
const seenByDiversity = patternedByTag.filter(p => DIVERSITY_RE.test(pieceTextBlob(p)))
console.log('\n--- "is this patterned?" answered three different ways ---')
console.log(`  pattern_type says non-solid:                 ${patternedByTag.length} pieces`)
console.log(`  image fidelity checklist regex sees:         ${seenByChecklist.length}`)
console.log(`  diversity/rhythm classifier regex sees:      ${seenByDiversity.length}`)
console.log(`  (the checklist reads pieceTextBlob and has botanical+paisley; the classifier reads`)
console.log(`   pieceNameBlob and has print+graphic instead. Neither reads pattern_type.)`)

// ── renderer memory: is it actually producing corrections today? ────────────
console.log('\n--- renderer memory appended to every image prompt ---')
const allIds = pieces.map(p => Number(p.id))
const globalMemory = getSavedBoardRendererMemory(allIds, 24)
console.log(`  across the whole wardrobe: ${globalMemory ? `${globalMemory.split('\n').length - 1} correction lines, ${globalMemory.length} chars` : 'EMPTY — no correction lines'}`)
const outfitMemory = getSavedBoardRendererMemory(outfitPieces.map(p => Number(p.id)), 24)
console.log(`  for the 3-piece sample outfit: ${outfitMemory ? `${outfitMemory.split('\n').length - 1} lines` : 'empty'}`)
if (globalMemory) console.log(globalMemory.split('\n').slice(0, 6).map(l => `    ${l}`).join('\n'))

// ── the two paths describe a garment very differently ───────────────────────
// wholeWardrobeImagePrompt uses buildPieceText (the structured truth text).
// editorialImagePrompt builds its own thinner description and adds keyword-derived rules.
import { anchorFidelityInstructions } from '../styling-engine/core.js'
import { buildPieceText } from '../styling-engine/rules.js'

console.log('\n--- how each path describes the same garment ---')
const truthLens = pieces.map(p => buildPieceText(p).replace(/\s+/g, ' ').length).sort((a, b) => a - b)
console.log(`  buildPieceText (whole-wardrobe path): median ${truthLens[Math.floor(truthLens.length / 2)]} chars, max ${truthLens[truthLens.length - 1]}`)
console.log(`  truncated at 900 chars in the prompt; ${truthLens.filter(n => n > 900).length} of ${pieces.length} pieces exceed that and lose their tail`)
console.log(`  editorial pieceDesc: name; category; colors; notes(<=700) — no length_hits_at,`)
console.log(`  no sleeve_type, no silhouette, no fit_on_body, no hem_finish, no fabric_category.`)

// anchorFidelityInstructions (editorial only) reads name + notes, never the columns.
console.log('\n--- editorial anchor fidelity: structured columns vs name/notes ---')
const nameNotes = p => `${String(p.name || '')} ${String(p.notes || '')}`.toLowerCase()
const checks = [
  ['sleeve_type', /sleeveless|tank|shell|short sleeve|short-sleeve|long sleeve|long-sleeve/, 'sleeve clause'],
  ['length_hits_at', /midi|maxi|knee|crop|ankle|mini/, 'NO length clause exists in the builder'],
  ['fit_on_body', /boxy|relaxed|loose|oversized|fitted|slim|compact/, 'fit clause'],
  ['pattern_type', /stripe|striped/, 'stripe clause only — no floral/botanical clause']
]
for (const [column, re, label] of checks) {
  const populated = pieces.filter(p => {
    const v = p[column]
    return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)
  })
  const visible = populated.filter(p => re.test(nameNotes(p)))
  console.log(`  ${column.padEnd(15)} populated ${String(populated.length).padStart(3)}/${pieces.length}, said in name/notes ${String(visible.length).padStart(3)}  -> ${label}`)
}
const noInstruction = pieces.filter(p => !anchorFidelityInstructions(p).trim())
console.log(`  ${noInstruction.length} of ${pieces.length} pieces produce NO anchor fidelity instruction at all`)
console.log(`  (this builder is used by the EDITORIAL path only; the whole-wardrobe path carries`)
console.log(`   these columns through buildPieceText instead.)`)

// ── the tagger prompt: size and calibration coverage ────────────────────────
import { prompts } from '../styling-engine/promptRuntime.js'
import { buildAnchorBlock, normalizeManualOverrides } from '../styling-engine/taggerMerge.js'

console.log('\n--- tagger prompt ---')
const tagPrompt = prompts.TAG_PIECE_PROMPT || ''
console.log(`  TAG_PIECE_PROMPT: ${tagPrompt.length} chars, ~${Math.round(tagPrompt.length / 4)} tokens`)
console.log(`  sections: ${(tagPrompt.match(/^=== .+ ===$/gm) || []).length} (${(tagPrompt.match(/^=== (.+) ===$/gm) || []).map(s => s.replace(/=/g, '').trim()).join(' | ')})`)

const overrideCounts = new Map()
let withAny = 0
for (const p of pieces) {
  const o = normalizeManualOverrides(p.manual_overrides)
  if (o.length) withAny++
  for (const f of o) overrideCounts.set(f, (overrideCounts.get(f) || 0) + 1)
}
console.log('\n--- owner corrections, which are what the calibration anchors are built from ---')
console.log(`  ${withAny} of ${pieces.length} pieces carry at least one manual override`)
for (const [field, n] of [...overrideCounts].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`    ${String(n).padStart(4)}  ${field}`)
}
const anchorBlock = buildAnchorBlock({ pieces, fields: ['formality', 'fabric_weight'] })
console.log(`  anchors sent to the tagger: ${anchorBlock.anchors.length} (${anchorBlock.text.length} chars + one low-detail thumbnail each)`)
const anchorByField = {}
for (const a of anchorBlock.anchors) anchorByField[a.field] = (anchorByField[a.field] || 0) + 1
console.log(`    by field: ${Object.entries(anchorByField).map(([f, n]) => `${f}=${n}`).join(', ')}  (cap is 3 per distinct value)`)

// ── does the import preflight's 6000-token estimate match the real payload? ──
// importer.js: TAG_EST_INPUT_TOKENS = 6000, TAG_EST_OUTPUT_TOKENS = 1400 per new-piece cluster.
// Anthropic bills an image at roughly (width x height) / 750 tokens.
import sharpLib from 'sharp'
import { TAG_PIECE_SYSTEM } from '../styling-engine/prompts.js'

const imgTokens = (w, h) => Math.round((w * h) / 750)
const dimsAfter = async (file, max) => {
  const buf = await sharpLib(path.join(userUploadsDir(), file))
    .rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
  const m = await sharpLib(buf).metadata()
  return { w: m.width, h: m.height }
}

console.log('\n--- tagger call: estimated vs actual input scale ---')
const sampleTagged = withPhoto.slice(0, 6)
let garmentTok = 0
for (const p of sampleTagged) {
  const d = await dimsAfter(p.photo || p.worn_photo, 1568)   // prepareImageForClaude
  garmentTok += imgTokens(d.w, d.h)
}
const perGarmentPhoto = Math.round(garmentTok / sampleTagged.length)

let thumbTok = 0
const thumbAnchors = anchorBlock.anchors.filter(a => a.photo || a.worn_photo).slice(0, 8)  // anchorThumbsForTagger limit
for (const a of thumbAnchors) {
  const d = await dimsAfter(a.photo || a.worn_photo, 448)
  thumbTok += imgTokens(d.w, d.h)
}

const textTok = Math.round((tagPrompt.length + TAG_PIECE_SYSTEM.length + anchorBlock.text.length) / 4)
console.log(`  prompt + system + anchor text: ~${textTok.toLocaleString()} tokens`)
console.log(`  garment photo @1568px:         ~${perGarmentPhoto.toLocaleString()} tokens each (import sends 1; add-piece can send 2)`)
console.log(`  ${thumbAnchors.length} anchor thumbnails @448px:    ~${thumbTok.toLocaleString()} tokens total`)
const oneGarment = textTok + perGarmentPhoto + thumbTok
console.log(`  --> realistic single-photo total: ~${oneGarment.toLocaleString()} input tokens`)
console.log(`      importer.js preflight assumes: 6,000  (ratio ${(oneGarment / 6000).toFixed(1)}x)`)
console.log(`      output cap is 2,500; preflight assumes 1,400`)
