// Offline verification of docs/selected-piece-model-roster-spec.md §6 on real anchors: runs the
// shipped chooseSelectedPieceRoster on an isolated DB copy with the provider stubbed (NODE_ENV=test,
// no network, no cost). Prints the catalog the stylist would read, whether the named garments are
// in it, the request size, and what a pick of those garments would hand the composer.
// usage: node scratch/verify_selected_piece_model_roster.mjs <anchorId> [watchId,...]
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-verify-'))
for (const f of ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm']) { const src = path.join(REPO, f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dbCopy, f)) }
for (const f of ['system.db', 'system.db-wal', 'system.db-shm']) { const src = path.join(REPO, 'data', f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dbCopy, f)) }
process.on('exit', () => fs.rmSync(dbCopy, { recursive: true, force: true }))
Object.assign(process.env, { NODE_ENV: 'test', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', WARDROBE_DB_PATH: path.join(dbCopy, 'wardrobe.db'), WARDROBE_SYSTEM_DB_PATH: path.join(dbCopy, 'system.db'), WARDROBE_USERS_DIR: path.join(dbCopy, 'users'), WARDROBE_UPLOADS_DIR: path.join(REPO, 'uploads') })
const { db, parsePiece } = await import(`${REPO}/db.js`)
const all = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
if (!all.length) throw new Error('DB copy opened empty')
const { chooseSelectedPieceRoster } = await import(`${REPO}/routes/ai.js`)
const { selectAutomaticUseCandidatesForOutfitGeneration } = await import(`${REPO}/styling-engine/eligibility.js`)
const { resolveStylingContext } = await import(`${REPO}/styling-engine/stylingContext.js`)

const anchorId = Number(process.argv[2]); const watch = (process.argv[3] || '').split(',').filter(Boolean).map(Number)
const anchor = all.find(p => p.id === anchorId)
const sc = await resolveStylingContext({ explicitRequest: { occasion: 'city', activity: 'none', season: 'current season', mission: 'mix', mood: '', requestText: '', location: '', date: new Date() }, policy: { allowLiveWeather: true } })
const rankingContext = { occasion: sc.occasion, mission: sc.mission, mood: sc.mood, season: sc.season, currentDate: sc.date, weatherProfile: sc.weatherProfile, comfortConstraint: sc.comfortConstraint, activity: sc.activity, request: '', question: '' }
const { rankedCandidates, eligibility } = selectAutomaticUseCandidatesForOutfitGeneration({ anchorPiece: anchor, pieces: all, limit: 32, context: rankingContext })

let request = null
globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
  request = { system, content: messages[0].content }
  return { selection_note: 'verification pick: the watched garments', roster_piece_ids: watch }
}
const result = await chooseSelectedPieceRoster({
  selectedPiece: anchor, allPieces: all, codeRankedCandidates: rankedCandidates, eligibilityDecisionsById: eligibility.decisionsById, rankingContext,
  occasion: sc.occasion, season: sc.season, mission: sc.mission, mood: sc.mood, activity: sc.activity, question: '',
  weatherProfile: sc.weatherProfile, occasionProfile: sc.occasionProfile, activityProfile: sc.activityProfile,
})
const text = request.content.filter(p => p.type === 'text').map(p => p.text).join('\n')
const catalogIds = new Set([...text.matchAll(/^#(\d+) /gm)].map(m => Number(m[1])))
const codeIds = new Set(rankedCandidates.map(r => Number(r.piece.id)))
console.log(`\n━━ ${anchor.id} ${anchor.name}`)
console.log(`   catalog: ${result.debug.catalogCount} garments ${JSON.stringify(result.debug.catalogCounts)}; code roster today: ${codeIds.size}`)
console.log(`   roster request: system ${request.system.length} chars, user text ${text.length} chars (≈${Math.round((request.system.length + text.length) / 4)} tokens) + ${request.content.filter(p => p.type === 'image').length} anchor photo`)
for (const id of watch) console.log(`   ${String(id).padEnd(7)} ${(all.find(p => p.id === id)?.name || '?').padEnd(42)} in catalog: ${catalogIds.has(id) ? 'yes' : 'NO '}   in code roster: ${codeIds.has(id) ? 'yes' : 'no'}`)
console.log(`   a pick of these → source ${result.debug.source}${result.debug.fallbackReason ? ` (${result.debug.fallbackReason})` : ''}; composer would see ${result.rankedCandidates.length} + anchor ${JSON.stringify(result.debug.pickedCounts)}; added for coverage ${JSON.stringify(result.debug.addedForCoverageIds)}; unknown ${JSON.stringify(result.debug.unknownIds)}`)
