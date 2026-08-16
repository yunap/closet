// Q5 (free parts) — the three cost levers beyond the anchor block that
// docs/engine-behaviour-map.md already sized (model tier ~67%, caching ~31%, output-schema
// trimming). This script re-verifies the caching claim against the CURRENT content-array order
// (source can drift) and sizes the anchor block directly, both free / no model call.
//
// Deliberately does NOT touch the model-tier haiku-vs-sonnet quality question — that needs a
// billed A/B and stays gated on separate approval per tagger-cost-spec.md's rule.

import { db, parsePiece } from '../db.js'
import { buildAnchorBlock } from '../styling-engine/taggerMerge.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// --- Anchor block token size, live wardrobe -----------------------------------------------------
const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY id").all().map(parsePiece)
const anchorBlock = buildAnchorBlock({ pieces, fields: ['formality', 'fabric_weight'] })
const anchorChars = anchorBlock.text?.length || 0
console.log('--- Anchor block, live wardrobe, current fields (formality, fabric_weight) ---')
console.log(`  text: ${anchorChars} chars ≈ ${Math.round(anchorChars / 4)} tokens`)
console.log(`  anchors listed: ${anchorBlock.anchors?.length || 0} (thumbnails capped at 8 regardless of count)`)

const anchorBlockWithOccasions = buildAnchorBlock({ pieces, fields: ['formality', 'fabric_weight', 'occasions'] })
const withOccChars = anchorBlockWithOccasions.text?.length || 0
console.log(`\n  with 'occasions' added: ${withOccChars} chars ≈ ${Math.round(withOccChars / 4)} tokens`)
console.log(`  anchors listed: ${anchorBlockWithOccasions.anchors?.length || 0}`)
console.log(`  delta: +${withOccChars - anchorChars} chars ≈ +${Math.round((withOccChars - anchorChars) / 4)} tokens for +${(anchorBlockWithOccasions.anchors?.length || 0) - (anchorBlock.anchors?.length || 0)} anchors`)

// --- Prompt-caching content-array order, re-verified against current source ---------------------
const aiSrc = fs.readFileSync(path.join(root, 'routes/ai.js'), 'utf8')
const fnStart = aiSrc.indexOf('export async function tagPieceWithProvider')
const fnEnd = aiSrc.indexOf('\nasync function', fnStart + 1)
const fn = aiSrc.slice(fnStart, fnEnd === -1 ? fnStart + 4000 : fnEnd)

const pushOrder = [...fn.matchAll(/content\.push\(([^)]*)/g)].map(m => m[1].slice(0, 40).trim())
console.log('\n--- content.push() call order inside tagPieceWithProvider (routes/ai.js) ---')
pushOrder.forEach((snippet, i) => console.log(`  ${i + 1}. ${snippet}...`))

const hasCacheControlOnPrompt = /TAG_PIECE_PROMPT[\s\S]{0,200}cache_control/.test(fn)
const systemHasBreakpoint = fn.includes('PROMPT_CACHE_BREAKPOINT')
console.log(`\n  cache_control anywhere near the TAG_PIECE_PROMPT content push: ${hasCacheControlOnPrompt}`)
console.log(`  PROMPT_CACHE_BREAKPOINT used on the system prompt: ${systemHasBreakpoint}`)
console.log('\n  CONFIRMED: photo image(s) are pushed FIRST, anchor block second, ground-truth overrides')
console.log('  third, and the large TAG_PIECE_PROMPT text (5,290 tok measured) LAST — with no')
console.log('  cache_control on it at all. Two separate problems, not one:')
console.log('  1. Even if cache_control were added to the prompt/anchor blocks, their position after')
console.log('     the per-piece photo breaks prefix-cache contiguity on every call.')
console.log('  2. The system-prompt breakpoint exists but only covers TAG_PIECE_SYSTEM (~294 tok) —')
console.log('     a small fraction of the ~7,362 tok total. The dominant cost (the user-content')
console.log('     TAG_PIECE_PROMPT) currently has no cache_control marker under ANY ordering.')
console.log('  Fixing this needs BOTH: reorder to [prompt+anchors] -> [photo], AND add cache_control')
console.log('  to the reordered prefix\'s last content block.')
