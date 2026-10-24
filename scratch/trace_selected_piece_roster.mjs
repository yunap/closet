// Offline trace (no model calls): where each wardrobe piece ranks in the selected-piece support
// selection for one anchor, and which pieces the per-category quotas cut. Isolated DB copy.
// usage: node scratch/trace_selected_piece_roster.mjs <anchorId> [watchId,...]
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-trace-'))
for (const f of ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm']) { const src = path.join(REPO, f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dbCopy, f)) }
for (const f of ['system.db', 'system.db-wal', 'system.db-shm']) { const src = path.join(REPO, 'data', f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dbCopy, f)) }
process.on('exit', () => fs.rmSync(dbCopy, { recursive: true, force: true }))
Object.assign(process.env, { NODE_ENV: 'test', WARDROBE_DB_PATH: path.join(dbCopy, 'wardrobe.db'), WARDROBE_SYSTEM_DB_PATH: path.join(dbCopy, 'system.db'), WARDROBE_USERS_DIR: path.join(dbCopy, 'users'), WARDROBE_UPLOADS_DIR: path.join(REPO, 'uploads') })
const { db, parsePiece } = await import(`${REPO}/db.js`)
const all = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
if (!all.length) throw new Error('DB copy opened empty')
const { selectAutomaticUseCandidatesForOutfitGeneration, evaluateVisualComposerPiecePool, evaluateAutomaticUsePiecePool } = await import(`${REPO}/styling-engine/eligibility.js`)
const { rankedComplementaryWardrobeFor } = await import(`${REPO}/styling-engine/rules.js`)
const anchorId = Number(process.argv[2]); const watch = (process.argv[3] || '').split(',').filter(Boolean).map(Number)
const anchor = all.find(p => p.id === anchorId)
const { resolveStylingContext } = await import(`${REPO}/styling-engine/stylingContext.js`)
// Same resolution the route runs, live weather allowed (a weather fetch, not a model call).
const sc = await resolveStylingContext({ explicitRequest: { occasion: 'city', activity: 'none', season: 'current season', mission: 'mix', mood: '', requestText: '', location: '', date: new Date() }, policy: { allowLiveWeather: true } })
const context = { occasion: sc.occasion, mission: sc.mission, mood: sc.mood, season: sc.season, currentDate: sc.date, weatherProfile: sc.weatherProfile, comfortConstraint: sc.comfortConstraint, activity: sc.activity, request: '', question: '', requestText: '', occasionProfile: sc.occasionProfile, activityProfile: sc.activityProfile }
console.log('styling context:', sc.occasion, sc.season, 'weather', sc.weatherProfile?.label || sc.weatherProfile?.summary || JSON.stringify(sc.weatherProfile)?.slice(0, 160))
const { rankedCandidates } = selectAutomaticUseCandidatesForOutfitGeneration({ anchorPiece: anchor, pieces: all, limit: 32, context })
const chosen = new Set(rankedCandidates.map(r => Number(r.piece.id)))
const elig = evaluateAutomaticUsePiecePool({ pieces: all, context })
const ranked = rankedComplementaryWardrobeFor(anchor, all, all.length, { ...context, eligibilityDecisionsById: elig.decisionsById })
const byCat = {}
for (const r of ranked) (byCat[r.piece.category] ||= []).push(r)
console.log(`anchor ${anchor.id} ${anchor.name}; active ${all.length}; chosen supports ${chosen.size}`)
for (const [cat, rows] of Object.entries(byCat)) {
  const usable = rows.filter(r => !r.autoUseBlocked)
  console.log(`  ${cat}: ranked ${rows.length}, not auto-use-blocked ${usable.length}, chosen ${rows.filter(r => chosen.has(Number(r.piece.id))).length}`)
}
const full = evaluateVisualComposerPiecePool({ pieces: all, context, policy: { selectedPieceId: anchorId, maxImages: 54 } })
const counts = full.eligiblePieces.reduce((c, p) => (c[p.category] = (c[p.category] || 0) + 1, c), {})
console.log(`whole active wardrobe through the visual pool at 54 images: ${full.eligiblePieces.length} ${JSON.stringify(counts)}; excluded ${full.excludedPieces.length}`, JSON.stringify(full.debug.excludedCounts || {}))
const full90 = evaluateVisualComposerPiecePool({ pieces: all, context, policy: { selectedPieceId: anchorId, maxImages: 90 } })
console.log(`… at 90 images: ${full90.eligiblePieces.length} ${JSON.stringify(full90.eligiblePieces.reduce((c, p) => (c[p.category] = (c[p.category] || 0) + 1, c), {}))}`)
const fullIds54 = new Set(full.eligiblePieces.map(p => Number(p.id))), fullIds90 = new Set(full90.eligiblePieces.map(p => Number(p.id)))
for (const id of watch) {
  const r = ranked.find(x => Number(x.piece.id) === id)
  const rows = byCat[r?.piece.category] || []
  const usable = rows.filter(x => !x.autoUseBlocked)
  console.log(`  watch ${id} ${r?.piece.name}: ${r?.piece.category} rank ${usable.indexOf(r) + 1}/${usable.length} (blocked ${Boolean(r?.autoUseBlocked)}), score ${r?.score}, chosen ${chosen.has(id)}, in 54-pool ${fullIds54.has(id)}, in 90-pool ${fullIds90.has(id)} | ${(r?.reasons || []).slice(0, 4).join('; ')}`)
}
console.log('  chosen tops:', rankedCandidates.filter(r => r.piece.category === 'top').map(r => `${r.piece.id}:${r.piece.name}(${r.score})`).join(', '))
