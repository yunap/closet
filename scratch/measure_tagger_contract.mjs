// §6f acceptance run. Calls the REAL tagger on a real piece and measures the six values the review
// asked for, then reads back the telemetry row the call produced.
//
// Deliberately does NOT write to the wardrobe: it measures the tagger's OUTPUT, so persisting adds
// risk without adding evidence. Photo inputs mirror tagExistingHandler exactly (hanger + worn).
//
//   WARDROBE_ALLOW_LIVE_DB=1 node scratch/measure_tagger_contract.mjs --id 996867 [--reps 2]
import fs from 'fs'
import path from 'path'
import { db, parsePiece, userUploadsDir } from '../db.js'
import { tagPieceWithProvider } from '../routes/ai.js'

const arg = (flag, dflt = null) => {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : dflt
}
const pieceId = Number(arg('--id'))
const reps = Number(arg('--reps', '1'))
const piece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId))
if (!piece) { console.error(`no piece ${pieceId}`); process.exit(1) }

const photos = []
const uploads = userUploadsDir()
if (piece.photo && fs.existsSync(path.join(uploads, piece.photo))) {
  photos.push({ path: path.join(uploads, piece.photo), label: 'HANGER PHOTO', guidance: 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.' })
}
if (piece.worn_photo && fs.existsSync(path.join(uploads, piece.worn_photo))) {
  photos.push({ path: path.join(uploads, piece.worn_photo), label: 'WORN PHOTO', guidance: 'Use for fit, drape, scale, real-wear behavior, outfit role, and risks. Do not override literal garment color/category from this styling context.' })
}
if (!photos.length) { console.error('piece has no photos on disk'); process.exit(1) }

console.log(`\n=== ${piece.id} ${piece.name} (${piece.category}) — ${photos.length} photo(s), ${reps} rep(s) ===`)
console.log('   NOT persisted: this measures the tagger output only.\n')

for (let rep = 1; rep <= reps; rep++) {
  const before = db.prepare('SELECT MAX(id) m FROM ai_call_log').get()?.m ?? 0
  let tags, error = null
  try { tags = await tagPieceWithProvider(photos, piece) } catch (err) { error = err }
  const row = db.prepare('SELECT provider, model, output_tokens, success, error_message, context FROM ai_call_log WHERE id > ? ORDER BY id DESC LIMIT 1').get(before) || {}
  let stopReason = null
  try { stopReason = JSON.parse(row.context || '{}')?.stopReason ?? null } catch {}

  const rw = tags?.style_profile_json?.garment_intelligence?.real_wear_notes || tags?.garment_intelligence?.real_wear_notes || {}
  const conf = tags?._confidence || tags?.style_profile_json?._confidence || {}
  const rwWords = Object.values(rw).filter(v => typeof v === 'string').join(' ').trim().split(/\s+/).filter(Boolean).length
  const longest = Math.max(0, ...Object.values(rw).filter(v => typeof v === 'string').map(v => v.trim().split(/\s+/).filter(Boolean).length))

  console.log(`  rep ${rep}  ${row.provider || '?'}/${row.model || '?'}`)
  console.log(`    output tokens        ${String(row.output_tokens ?? '?').padEnd(10)} (baseline 1571 clean / 2496 truncated)`)
  console.log(`    real_wear_notes keys ${String(Object.keys(rw).length).padEnd(10)} (baseline 5)`)
  console.log(`    real_wear_notes words${String(rwWords).padEnd(10)} (baseline 34; longest value now ${longest} words)`)
  console.log(`    confidence keys      ${String(Object.keys(conf).length).padEnd(10)} (baseline 35)`)
  console.log(`    stop reason          ${String(stopReason ?? '(none)').padEnd(10)} (baseline: never recorded)`)
  console.log(`    parse succeeded      ${error ? `NO — ${error.message.slice(0, 60)}` : 'yes'}`)
  if (row.success === 0) console.log(`    telemetry            FAILURE logged: ${row.error_message}`)
  console.log('')
}
