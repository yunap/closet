// One live first turn per anchor through the shipped generateOutfitsForPieceInternal, with the
// stylist-chosen roster (docs/selected-piece-model-roster-spec.md §6). Isolated DB copy; the
// provider is pinned to the control's (Gemini 3.5 Flash-Lite) so the comparison is like for like.
// PAID: one roster call + one composer call per anchor.
// usage: node scratch/selected_piece_roster_live.mjs [outSubdir]   (default live_roster)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(REPO, 'scratch/garment_read_runs/2026-10-24', process.argv[2] || 'live_roster')
fs.mkdirSync(OUT, { recursive: true })
const dbCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-live-'))
for (const f of ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm']) { const s = path.join(REPO, f); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dbCopy, f)) }
for (const f of ['system.db', 'system.db-wal', 'system.db-shm']) { const s = path.join(REPO, 'data', f); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dbCopy, f)) }
process.on('exit', () => fs.rmSync(dbCopy, { recursive: true, force: true }))
const env = Object.fromEntries(fs.readFileSync(path.join(REPO, '.env'), 'utf8').split('\n').map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
Object.assign(process.env, {
  GEMINI_API_KEY: env.GEMINI_API_KEY, STYLIST_PROVIDER_OVERRIDE: 'gemini', GEMINI_STYLIST_MODEL: 'gemini-3.5-flash-lite',
  WARDROBE_DB_PATH: path.join(dbCopy, 'wardrobe.db'), WARDROBE_SYSTEM_DB_PATH: path.join(dbCopy, 'system.db'), WARDROBE_USERS_DIR: path.join(dbCopy, 'users'), WARDROBE_UPLOADS_DIR: path.join(REPO, 'uploads'),
  WARDROBE_CAPTURE_PROVIDER_INPUT_DIR: path.join(OUT, 'captures'),
})
const { db } = await import(`${REPO}/db.js`)
if (!db.prepare("SELECT COUNT(*) n FROM pieces WHERE status='active'").get().n) throw new Error('DB copy opened empty')
const { generateOutfitsForPieceInternal } = await import(`${REPO}/routes/ai.js`)
const RUNS = [
  { thread: 'thread_1792821629010', pieceId: 996905, season: 'current season' },
  { thread: 'thread_1792822990468', pieceId: 996914, season: 'current season' },
  { thread: 'thread_1792823824264', pieceId: 211, season: 'fall' },
]
let spent = 0
for (const run of RUNS) {
  const file = path.join(OUT, `${run.thread}.json`)
  if (fs.existsSync(file)) { console.log(`skip (done) ${run.thread}`); continue }
  const result = await generateOutfitsForPieceInternal({ pieceId: run.pieceId, occasion: 'city', season: run.season, mission: 'mix' })
  const r = result.debug.visualCritic?.rosterSelection
  const c = (result.debug.rosterSelectionUsage?.estimatedCost?.estimatedUsd || 0) + (result.debug.composerUsage?.estimatedCost?.estimatedUsd || 0)
  spent += c
  fs.writeFileSync(file, JSON.stringify({ ...run, result }, null, 2))
  console.log(`${run.thread} ${run.pieceId}: roster ${r?.source}${r?.fallbackReason ? ` (${r.fallbackReason})` : ''} ${r?.pickedCount}/${r?.catalogCount} ${JSON.stringify(r?.pickedCounts)} | shown ${result.debug.visualCritic?.shownPieceCount} | cards ${result.structuredOutfits.length} | $${c.toFixed(4)}\n   note: ${r?.selectionNote}`)
}
console.log(`spent ≈ $${spent.toFixed(3)}`)
