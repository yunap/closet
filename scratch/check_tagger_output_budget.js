// Acceptance capture for docs/tagger-cost-spec.md §6f — did tightening the output contract
// actually make the tagger leaner, and did it stay valid under the 3000 cap?
//
// Read-only. Reports the six measurements the §6f review asked for, for one piece and the AI call
// that produced it. Run AFTER a real retag:
//
//   WARDROBE_ALLOW_LIVE_DB=1 node scratch/check_tagger_output_budget.js --id 996867
//
// Compare against the pre-change baselines printed alongside each line.
import { db, parsePiece } from '../db.js'

const idArg = process.argv.indexOf('--id')
const pieceId = idArg > -1 ? Number(process.argv[idArg + 1]) : null
if (!pieceId) {
  console.error('usage: WARDROBE_ALLOW_LIVE_DB=1 node scratch/check_tagger_output_budget.js --id <pieceId>')
  process.exit(1)
}

const piece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId))
if (!piece) { console.error(`no piece ${pieceId}`); process.exit(1) }

const profile = piece.style_profile_json || {}
const rw = profile?.garment_intelligence?.real_wear_notes || {}
const confidence = profile?._confidence || {}
const words = Object.values(rw).filter(v => typeof v === 'string').join(' ').trim().split(/\s+/).filter(Boolean).length

// The most recent tagging call. tag_piece / tag_piece_existing are the two tagger flows; the
// unattributed rows are the same calls losing their flow label on the Anthropic path.
const call = db.prepare(`
  SELECT created_at, provider, model, output_tokens, success, error_message, context
  FROM ai_call_log
  WHERE flow IN ('tag_piece', 'tag_piece_existing', 'unattributed')
  ORDER BY id DESC LIMIT 1
`).get() || {}
let stopReason = null
try { stopReason = JSON.parse(call.context || '{}')?.stopReason ?? null } catch {}

const line = (label, value, baseline) =>
  console.log(`  ${String(label).padEnd(30)}${String(value).padEnd(28)}${baseline}`)

console.log(`\n=== ${piece.id} ${piece.name} (${piece.category}) ===\n`)
console.log(`  ${'measurement'.padEnd(30)}${'now'.padEnd(28)}before the change`)
line('output tokens', call.output_tokens ?? '(no call logged)', '1571 clean / 2496 truncated')
line('real_wear_notes keys', Object.keys(rw).length, '4.9 of 5 on average')
line('real_wear_notes words', words, 'unbounded; ~8-12 each now')
line('confidence keys', Object.keys(confidence).length, '34, ten inapplicable on a coat')
line('stop reason', stopReason ?? '(not recorded on this call)', 'was never recorded at all')
line('parse succeeded', call.success === 1 ? 'yes' : call.success === 0 ? `NO — ${call.error_message || ''}` : '(unknown)', 'truncation logged as success')
console.log(`\n  call: ${call.created_at || '?'}  ${call.provider || '?'}/${call.model || '?'}`)
console.log(`  cap is 3000; a clean output should sit well under it.\n`)
