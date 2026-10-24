// One live first turn per anchor through the shipped generateOutfitsForPieceInternal, with the
// stylist-chosen roster (docs/selected-piece-model-roster-spec.md §6). Isolated DB copy; the
// provider is pinned to the control's (Gemini 3.5 Flash-Lite) so the comparison is like for like.
// PAID: one roster call + one composer call per anchor.
// usage: node scratch/selected_piece_roster_live.mjs [outSubdir] [--explore] [--rep N] [--with-flare] [--dry]
//   outSubdir defaults to live_roster; --explore turns Explore on (docs/selected-piece-explore-mode-spec.md);
//   --rep N suffixes the output files (__rN) so replicates sit side by side; --dry prints the plan only.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const SUBDIR = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'live_roster'
const EXPLORE = flag('--explore')
const REP = argv.includes('--rep') ? Number(argv[argv.indexOf('--rep') + 1]) : null
const OUT = path.join(REPO, 'scratch/garment_read_runs/2026-10-24', SUBDIR)
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
  ...(flag('--with-flare') ? [{ thread: 'thread_1792867254713', pieceId: 106, season: 'current season' }] : []),
]
if (flag('--dry')) {
  console.log(`plan: ${RUNS.length} first turns, explore=${EXPLORE}, rep=${REP ?? '-'}, out=${OUT}\n${RUNS.map(r => `  ${r.thread} piece ${r.pieceId} (${r.season})`).join('\n')}`)
  process.exit(0)
}
let spent = 0
for (const run of RUNS) {
  const file = path.join(OUT, `${run.thread}${REP ? `__r${REP}` : ''}.json`)
  if (fs.existsSync(file)) { console.log(`skip (done) ${run.thread}`); continue }
  const result = await generateOutfitsForPieceInternal({ pieceId: run.pieceId, occasion: 'city', season: run.season, mission: 'mix', explore: EXPLORE })
  const r = result.debug.visualCritic?.rosterSelection
  const c = (result.debug.rosterSelectionUsage?.estimatedCost?.estimatedUsd || 0) + (result.debug.composerUsage?.estimatedCost?.estimatedUsd || 0)
  spent += c
  fs.writeFileSync(file, JSON.stringify({ ...run, explore: EXPLORE, rep: REP, result }, null, 2))
  console.log(`${run.thread} ${run.pieceId}: roster ${r?.source}${r?.fallbackReason ? ` (${r.fallbackReason})` : ''} ${r?.pickedCount}/${r?.catalogCount} ${JSON.stringify(r?.pickedCounts)} | shown ${result.debug.visualCritic?.shownPieceCount} | cards ${result.structuredOutfits.length} | $${c.toFixed(4)}\n   note: ${r?.selectionNote}`)
}
console.log(`spent ≈ $${spent.toFixed(3)}`)
