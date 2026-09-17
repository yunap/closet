// STAGE 1 A/B — production-path comparison: the real one-outfit slice (/api/ai/ask → execution router →
// single_outfit model/tool loop) versus the real Whole Wardrobe bundle
// (/api/ai/generate-wardrobe-outfits-visual → composer → critic → repair), identical context.
// Pre-registration: scratch/ab_stage1_preregistration.json. Its sha256 is recorded in every manifest.
//
// TWO MODES.
//   --mode preflight (default): a TOOL/PAYLOAD PREFLIGHT, never a comparison. Every model call is served
//     by a recorder with scripted responses, so the single-outfit tool loop does NOT run as the model
//     would drive it: the router and the loop are short-circuited, and the search/view/propose tool
//     results are produced by calling the real tools directly with a route-shaped context. No provider
//     call, no external fetch (blocked), provider keys blanked, BYOK rows removed from each cell copy.
//   --mode live --approved: the real production paths with real provider calls — the real router, the
//     real single-outfit model/tool loop, the real composer, critic and repair, with provider capture
//     (normalized/wire input and raw output of every call, every tool-loop turn included) per attempt.
//     Refused without --approved, and refused unless the replicate count equals the pre-registered one.
// Every attempt is kept: nothing is rerun or replaced. Routing, technical success and the conditions
// check are reported over all attempts in manifest.contract and contract-report.md.
//
// AGENTS.md CLI safety: preflight is the default; live costs money and needs explicit approval.
// Isolation (docs/database-safety.md): every cell (scenario × arm × replicate) runs in its own child
// process against its own copy of one frozen snapshot, so session rotation memory from one run can never
// enter another run's payload.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { SCENARIOS } from './ab_stage1_scenarios.mjs'
import { weatherParity, singleOutfitRouted, reviewEligibility, providerNetworkEnv, captureIntegrity } from './ab_stage1_contract.mjs'
export { SCENARIOS }

const __filename = fileURLToPath(import.meta.url)
const REPO = path.join(path.dirname(__filename), '..')
const args = process.argv.slice(2)
const argValue = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const PREREG_PATH = path.join(REPO, 'scratch', 'ab_stage1_preregistration.json')
const MODEL = 'gemini-3.5-flash-lite'
const TOKENS_PER_IMAGE = 1080 // measured: 89,894 image tokens / 83 composer images; 11,871 / 11 viewed pieces
const CURRENT_DATE = '2026-09-13' // fixed request date for every cell; weather is stated, date only sets calendar season

// ─────────────────────────────────────────── child: one cell ───────────────────────────────────────────
// ─────────────────────── child: provider-boundary check (never bills, never a cell) ───────────────────────
// Runs under exactly a cell's environment. Every non-loopback fetch is blocked and the Gemini SDK's
// request method is replaced by one that throws a sentinel, so a request that passes assertProviderKey()
// and is fully built stops at the SDK boundary without leaving the process.
if (args.includes('--boundary-child')) {
  const fetchAttempts = []
  globalThis.fetch = async input => { fetchAttempts.push(String(input?.url || input).replace(/key=[^&]+/, 'key=<redacted>')); throw new Error('boundary check: fetch blocked') }
  const { GoogleGenAI } = await import('@google/genai')
  const sdkRequests = []
  Object.defineProperty(GoogleGenAI.prototype, 'interactions', { configurable: true, get() {
    return { create: async request => { sdkRequests.push({ model: request.model, hasTools: Array.isArray(request.tools) && request.tools.length > 0 }); const err = new Error('BOUNDARY_REACHED'); err.code = 'boundary_reached'; throw err } }
  } })
  const { assertProviderKey, resolveAiTarget, stylistProviderOverride, askStylistStructuredWithUsage, askStylistWithTools } = await import(`${REPO}/styling-engine/provider.js`)
  const target = resolveAiTarget(stylistProviderOverride)
  const attempt = async (name, fn) => {
    try { await fn(); return { name, outcome: 'returned without reaching the SDK' } } catch (err) { return { name, outcome: err.code === 'boundary_reached' ? 'reached SDK boundary' : `refused: ${err.code || ''} ${err.message}` } }
  }
  const results = [
    await attempt('assertProviderKey', async () => { assertProviderKey(target); const err = new Error('passed'); err.code = 'boundary_reached'; throw err }),
    await attempt('structured call (router/composer/critic/repair path)', () => askStylistStructuredWithUsage({ system: 'boundary check', messages: [{ role: 'user', content: 'boundary check' }], schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, providerOverride: stylistProviderOverride, subflow: 'boundary_check' })),
    await attempt('tool-loop turn (single-outfit path)', () => askStylistWithTools({ system: 'boundary check', messages: [{ role: 'user', content: 'boundary check' }], toolContext: { providerOverride: stylistProviderOverride } })),
  ]
  console.log(JSON.stringify({ nodeEnv: process.env.NODE_ENV, providerNetworkPermission: process.env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK ?? null, target, results, sdkRequests, fetchAttempts }))
  process.exit(0)
}

if (args.includes('--child')) {
  const [scenarioKey, arm] = argValue('--child').split(':')
  const scenario = SCENARIOS[scenarioKey]
  const cellDir = argValue('--cell-dir')
  const live = process.env.AB_LIVE === 'true'
  const blockedFetches = []
  if (!live) {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = String(input?.url || input)
      if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return realFetch(input, init)
      blockedFetches.push(url.replace(/key=[^&]+/, 'key=<redacted>'))
      throw new Error(`preflight: external fetch blocked (${new URL(url).host})`)
    }
  }
  const { app, db, executeTool } = await import(`${REPO}/server.js`)
  const { stylistToolsForTurn, extractToolResultImages } = await import(`${REPO}/styling-engine/provider.js`)
  const { declareSingleOutfitIntent } = await import(`${REPO}/styling-engine/tools.js`)
  const { parsePiece } = await import(`${REPO}/db.js`)
  if (!live) db.prepare("DELETE FROM app_meta WHERE key LIKE 'byok%'").run()

  // IDENTICAL LOCATION CONTEXT. Both arms receive the snapshot's home location explicitly in the request
  // body, and the same fixed date, rather than each route's own default.
  const location = db.prepare("SELECT value FROM app_meta WHERE key = 'home_location'").get()?.value || ''
  const pieceIndex = Object.fromEntries(db.prepare("SELECT id, name, category FROM pieces WHERE status = 'active'").all().map(p => [p.id, { name: p.name, category: p.category }]))
  fs.writeFileSync(path.join(cellDir, 'piece-index.json'), JSON.stringify(pieceIndex))

  const calls = []
  const sha = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)
  const flatten = content => {
    const parts = Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }]
    const text = []; let images = 0
    for (const part of parts) {
      if (part?.type === 'text') text.push(part.text)
      else if (part?.type === 'image') { images++; text.push(`[image ${sha(String(part?.source?.data || ''))}]`) }
      else text.push(JSON.stringify(part))
    }
    return { text: text.join('\n'), images }
  }
  const kindOf = system => {
    const s = String(system || '')
    if (s.includes('Classify one wardrobe-stylist request')) return 'router'
    if (s.includes('personal stylist. You are looking at photos')) return 'composer'
    if (s.includes('second stylist reviewing outfits')) return 'clash_critic'
    if (s.includes('repairing cards you composed')) return 'repair'
    if (s.includes('Compose exactly ONE complete outfit')) return 'single_outfit_loop'
    return 'unexpected'
  }
  const record = (kind, system, messages) => {
    const flat = (messages || []).map(m => flatten(m.content))
    const userText = flat.map(f => f.text).join('\n\n')
    const images = flat.reduce((n, f) => n + f.images, 0)
    const n = calls.filter(c => c.kind === kind).length
    fs.writeFileSync(path.join(cellDir, `${kind}-${n}-system.txt`), String(system || ''))
    fs.writeFileSync(path.join(cellDir, `${kind}-${n}-user.txt`), userText)
    calls.push({ kind, systemChars: String(system || '').length, userChars: userText.length, images,
      estInputTokens: Math.round((String(system || '').length + userText.length) / 4) + images * TOKENS_PER_IMAGE })
    return userText
  }
  if (!live) {
    globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
      const kind = kindOf(system)
      const userText = record(kind, system, messages)
      if (kind === 'router') return { profile: 'single_outfit', occasion: 'casual', activity: scenario.activity, season: 'fall', mood: '', mission: 'mix', limit: 1, location: '', date: '', subject: '', usage: { input_tokens: 0, output_tokens: 0 } }
      if (kind === 'composer') {
        const byGroup = {}; let group = null
        for (const line of userText.split('\n')) {
          const heading = line.match(/^=== ([A-Z]+)/); if (heading) { group = heading[1]; continue }
          const id = line.match(/^ID (\d+):/); if (id && group) (byGroup[group] ||= []).push(Number(id[1]))
        }
        const pick = (g, i) => (byGroup[g] || [])[i] ?? null
        return { outfits: [0, 1, 2, 3, 4].map(i => ({ label: `PREFLIGHT card ${i + 1}`, strength: 'usable', dominantDirection: 'preflight', silhouette: 'preflight', bestFor: 'preflight',
          base_top_id: pick('TOPS', i), bottom_id: pick('BOTTOMS', i), dress_id: null, middle_layer_id: null, outer_layer_id: i < 2 ? pick('OUTERWEAR', i) : null, shoes_id: pick('SHOES', i),
          reason: 'preflight', styling_instructions: '', watchFor: 'none' })), skip: '', saveableLearning: '' }
      }
      if (kind === 'clash_critic') return { flagged: [] }
      if (kind === 'repair') {
        const cardIndexes = [...userText.matchAll(/=== CARD (\d+):/g)].map(m => Number(m[1]))
        return { repairs: [], declines: cardIndexes.map(cardIndex => ({ cardIndex, consideredLayerIds: [], reason: 'preflight' })) }
      }
      if (kind === 'single_outfit_loop') return 'PREFLIGHT single-outfit answer.'
      return 'PREFLIGHT: unexpected model call (served locally, never billed).'
    }
  }

  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const post = async (route, body) => {
    const started = Date.now()
    const res = await fetch(`${baseUrl}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, json: await res.json(), ms: Date.now() - started }
  }
  // The card exactly as the route returned it, minus photos and debug: every user-visible field, the
  // composer's slots and each piece's role. Nothing downstream derives a role from category.
  const cardSummary = card => ({
    label: card.label ?? null, title: card.title ?? null, strength: card.strength ?? null,
    broken: Boolean(card.broken), diagnosticOnly: Boolean(card.diagnosticOnly), retryPending: Boolean(card.retryPending), disposition: card.result?.disposition ?? null,
    reason: card.reason ?? null, stylingInstructions: card.stylingInstructions ?? null, watchFor: card.watchFor ?? null,
    systemFlags: Array.isArray(card.systemFlags) ? card.systemFlags : [], engineNote: card.engineNote ?? null,
    rejectionReason: card.rejectionReason ?? null, brokenPieces: Array.isArray(card.brokenPieces) ? card.brokenPieces.map(p => ({ id: p.id ?? null, name: p.name, reason: p.reason })) : [],
    modelSlots: card.modelSlots ?? null,
    pieces: (card.pieces || []).map(p => ({ id: Number(p.id), name: p.name ?? null, category: p.category ?? null, role: p.role || null, anchor: p.anchor === true })),
    ids: (card.pieceIds || (card.pieces || []).map(p => p.id)).map(Number),
  })
  const out = { cell: `${scenarioKey}:${arm}`, mode: live ? 'live' : 'preflight', neutralVerdicts: process.env.WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS === 'true', location, date: CURRENT_DATE, blockedFetches }
  const serialize = result => {
    const { textResult, images } = extractToolResultImages(result)
    return { text: textResult + (images.length ? `\n${images.map(image => `[image label: ${image.label}]`).join('\n')}` : ''), images: images.length }
  }

  if (arm === 'bundle') {
    const body = { occasion: 'casual', season: 'fall', mood: '', request: scenario.situation, question: scenario.situation, mission: 'mix', limit: 5, activity: scenario.activity, userWeather: scenario.user_weather, location, date: CURRENT_DATE, currentDate: CURRENT_DATE }
    fs.writeFileSync(path.join(cellDir, 'request.json'), JSON.stringify(body, null, 2))
    const response = await post('/api/ai/generate-wardrobe-outfits-visual', body)
    const debug = response.json.debug || {}
    out.resolvedWeather = debug.weatherProfile ? { highF: debug.weatherProfile.highF ?? null, lowF: debug.weatherProfile.lowF ?? null, location: debug.weatherProfile.resolvedWeatherContext?.location || '', source: debug.weatherProfile.weatherSource || null } : null
    out.weatherProfileForEvaluation = debug.weatherProfile || null
    out.response = { status: response.status, ms: response.ms, cards: (response.json.structuredOutfits || []).map(cardSummary),
      shownPieceCount: debug.shownPieceCount, postGatePoolSize: debug.postGatePoolSize, composerUsage: debug.composerUsage || null, outfitCountCheck: debug.finalSelection?.outfitCountCheck,
      layerRepair: debug.finalSelection?.layerRepair ? { attempted: debug.finalSelection.layerRepair.attempted, repairedCount: debug.finalSelection.layerRepair.repairedCount } : null, clashReview: debug.finalSelection?.visualClashReview || null, error: response.json.error || null }
    out.supply = {
      suppressed: debug.suppressedPieces || [],
      poolExcluded: (debug.excluded || []).map(entry => ({ id: Number(entry.id ?? entry.piece?.id), reason: entry.reason })),
      rosterCount: debug.rosterCount ?? null,
    }
    out.technicalOk = response.status === 200 && !out.response.error
  } else {
    const question = `Style one casual outfit. ${scenario.situation} Show me one outfit card.`
    const body = { question, sessionId: `ab-${path.basename(cellDir)}`, history: [], conversationMode: 'new_request', currentDate: CURRENT_DATE, timezone: 'America/Los_Angeles', user_weather: scenario.user_weather, location }
    fs.writeFileSync(path.join(cellDir, 'request.json'), JSON.stringify(body, null, 2))
    const response = await post('/api/ai/ask', body)
    const debug = response.json.debug || {}
    out.response = { status: response.status, ms: response.ms, executionRouterProfile: debug.executionRouterProfile, executionProfile: debug.executionProfile, toolSequence: debug.toolSequence || null,
      weatherSource: debug.weatherSource || null, providerInputTokens: debug.providerInputTokens ?? null, providerOutputTokens: debug.providerOutputTokens ?? null,
      cards: (response.json.structuredOutfits || []).map(cardSummary), answer: response.json.answer || null, error: response.json.error || null }
    out.routing = { routerProfile: debug.executionRouterProfile || null, executedProfile: debug.executionProfile || null, scriptedByPreflight: !live }
    let diagnostics = debug
    if (!live) {
      // PREFLIGHT ONLY: the test hook short-circuits the loop, so the tool results the model would see
      // are produced by the real tools with a route-shaped context. This is not how the live arm runs.
      const toolContext = { generatedOutfits: [], source: 'whole_wardrobe', occasion: 'casual', season: 'fall', mood: '', mission: 'mix', activity: scenario.activity,
        question, location, currentDate: CURRENT_DATE, retrievedPieceIds: new Set(), visuallySeenPieceIds: new Set(), activeContext: null, declaredIntent: null,
        providerOverride: null, turnMode: 'new_request', executionProfile: 'single_outfit', freeformDiagnostics: { executionProfile: 'single_outfit' },
        allowedToolNames: ['search_wardrobe', 'view_pieces', 'propose_outfit'], userWeather: scenario.user_weather,
        executionRouterActivity: scenario.activity, executionRouterActivityLocked: true, knownOutfitPieceIds: [], currentOutfitSet: [],
        packingRosterIds: new Set(), packingRosterPieces: [], packingRosterSlots: [] }
      declareSingleOutfitIntent(toolContext)
      const tools = stylistToolsForTurn(toolContext)
      fs.writeFileSync(path.join(cellDir, 'single_outfit-tools.json'), JSON.stringify(tools, null, 2))
      const search = await executeTool('search_wardrobe', { occasion: 'casual', activity: scenario.activity, category: ['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory'], user_weather: scenario.user_weather, location, intent: 'compose' }, toolContext)
      const searchSer = serialize(search)
      fs.writeFileSync(path.join(cellDir, 'tool-search_wardrobe-result.txt'), searchSer.text)
      const searchBody = Array.isArray(search) ? search.find(item => item?.stylist_catalog) : search
      const catalog = String(searchBody?.stylist_catalog?.catalog || '')
      const rows = [...catalog.matchAll(/^#(\d+) .*? \| ([a-z() _]+?)(?: \||$)/gm)].map(m => ({ id: Number(m[1]), group: m[2].split(' ')[0] }))
      const take = (g, n) => rows.filter(r => r.group === g).slice(0, n).map(r => r.id)
      const workbench = [...take('top', 3), ...take('bottom', 2), ...take('shoes', 2), ...take('outerwear', 5)]
      const view = await executeTool('view_pieces', { ids: workbench }, toolContext)
      fs.writeFileSync(path.join(cellDir, 'tool-view_pieces-result.txt'), serialize(view).text)
      const [top, , , bottom, , shoe, , outer] = workbench
      const propose = await executeTool('propose_outfit', { label: 'PREFLIGHT', pieces: [{ id: top, role: 'primary_top' }, { id: bottom, role: 'primary_bottom' }, { id: shoe, role: 'shoes' }, { id: outer, role: 'outerwear' }], why_it_works: 'preflight', styling_instructions: '' }, toolContext)
      fs.writeFileSync(path.join(cellDir, 'tool-propose_outfit-result.txt'), serialize(propose).text)
      out.preflightTools = { names: tools.map(t => t.name), catalogRows: rows.length, workbench, proposeStatus: propose?.status }
      // The real card objects propose_outfit produced, including any Needs-review attempt.
      out.response.cards = (toolContext.generatedOutfits || []).map(cardSummary)
      diagnostics = toolContext.freeformDiagnostics
    }
    out.supply = {
      catalogEligibleIds: diagnostics.singleOutfitCatalogEligibleIds || [],
      catalogExclusions: diagnostics.singleOutfitCatalogExclusions || {},
    }
    out.resolvedWeather = diagnostics.resolvedWeather || null
    // Misrouting is an outcome, reported over all attempts (manifest.contract), never a reason to rerun.
    out.technicalOk = response.status === 200 && !out.response.error
  }
  out.calls = calls
  fs.writeFileSync(path.join(cellDir, 'cell.json'), JSON.stringify(out, null, 2))
  server.close(); db.close()
  process.exit(0)
}

// ─────────────────────────────────────────── parent ───────────────────────────────────────────
const mode = argValue('--mode') || 'preflight'
if (!['preflight', 'live'].includes(mode)) { console.error('--mode must be preflight or live'); process.exit(2) }
const prereg = JSON.parse(fs.readFileSync(PREREG_PATH, 'utf8'))
const preregSha256 = crypto.createHash('sha256').update(fs.readFileSync(PREREG_PATH)).digest('hex')
const replicates = Number(argValue('--replicates') || prereg.replicates.perCell)
const approved = args.includes('--approved')
// SOURCE STATE. The implementation under test is largely uncommitted, so HEAD alone does not name it:
// the manifest records HEAD, the sha256 of `git diff --binary HEAD` (staged and unstaged changes to
// tracked files, new staged files included) and any untracked file, which live mode refuses.
function sourceState() {
  const git = (...gitArgs) => spawnSync('git', gitArgs, { cwd: REPO, maxBuffer: 1 << 30 })
  const diff = git('diff', '--binary', 'HEAD').stdout
  return { gitHead: git('rev-parse', 'HEAD').stdout.toString().trim(), diffBinaryHeadSha256: crypto.createHash('sha256').update(diff).digest('hex'), diffBytes: diff.length,
    untrackedFiles: git('ls-files', '--others', '--exclude-standard').stdout.toString().split('\n').filter(Boolean) }
}
const source = sourceState()
if (mode === 'live') {
  if (!approved) { console.error('Refusing paid calls: --mode live requires --approved after owner approval.'); process.exit(2) }
  if (source.untrackedFiles.length) { console.error(`Refusing live mode: untracked files would not be named by the source hash:\n${source.untrackedFiles.join('\n')}`); process.exit(2) }
  if (replicates !== prereg.replicates.perCell) { console.error(`Refusing: the pre-registration fixes exactly ${prereg.replicates.perCell} replicates per cell (got ${replicates}). Fewer is a pilot; more is a new experiment.`); process.exit(2) }
}
const snapshot = argValue('--snapshot')
const outRoot = argValue('--out')
if (!snapshot || !outRoot) { console.error('usage: node scratch/ab_stage1_production_paths.mjs --snapshot <dir with wardrobe.db[-wal,-shm], system.db> --out <dir> [--mode preflight|live --approved] [--replicates N]'); process.exit(2) }
fs.mkdirSync(outRoot, { recursive: true })
const hashFile = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
const manifest = { createdAt: new Date().toISOString(), mode, model: MODEL, preregistration: { path: 'scratch/ab_stage1_preregistration.json', sha256: preregSha256 }, replicates,
  snapshot: Object.fromEntries(['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm', 'system.db', 'system.db-wal', 'system.db-shm'].map(f => [f, hashFile(path.join(snapshot, f))])), source, cells: [] }

// PROVIDER-BOUNDARY CHECK (--boundary-check): proves, without billing and without running any attempt,
// that a cell's live environment passes assertProviderKey() and builds requests up to the SDK, and that
// the preflight environment is refused. Writes boundary-check.json and exits.
if (args.includes('--boundary-check')) {
  const checkDir = path.join(outRoot, 'boundary-check')
  fs.rmSync(checkDir, { recursive: true, force: true }); fs.mkdirSync(checkDir, { recursive: true })
  for (const f of ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm', 'system.db', 'system.db-wal', 'system.db-shm']) {
    if (fs.existsSync(path.join(snapshot, f))) fs.copyFileSync(path.join(snapshot, f), path.join(checkDir, f))
  }
  const cellBase = { ...process.env, NODE_ENV: 'test', WARDROBE_DB_PATH: path.join(checkDir, 'wardrobe.db'), WARDROBE_SYSTEM_DB_PATH: path.join(checkDir, 'system.db'),
    WARDROBE_UPLOADS_DIR: path.join(REPO, 'uploads'), STYLIST_PROVIDER_OVERRIDE: 'gemini', STYLIST_MODEL_OVERRIDE: MODEL, GEMINI_THINKING_LEVEL: 'low' }
  const run = env => {
    const child = spawnSync(process.execPath, [__filename, '--boundary-child'], { env, cwd: REPO, encoding: 'utf8', timeout: 120000 })
    const line = String(child.stdout).trim().split('\n').reverse().find(l => l.startsWith('{'))
    return line ? JSON.parse(line) : { error: `child exited ${child.status}: ${String(child.stderr).split('\n').slice(-5).join(' ')}` }
  }
  const report = { source, preregistrationSha256: preregSha256,
    preflightEnvironment: run(providerNetworkEnv(cellBase, { mode: 'preflight', approved: false })),
    ...(mode === 'live' && approved ? { liveEnvironment: run(providerNetworkEnv(cellBase, { mode: 'live', approved: true })) } : { liveEnvironment: 'not run: requires --mode live --approved' }) }
  fs.rmSync(checkDir, { recursive: true, force: true })
  fs.writeFileSync(path.join(outRoot, 'boundary-check.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

// A provider call is complete only with all three records — normalized input, wire input and raw
// output — sharing one callId. Records without a callId cannot be paired and are counted as such.
export function captureCompleteness(dir) {
  const empty = { records: 0, calls: 0, callsComplete: 0, toolLoopTurns: 0, toolLoopTurnsComplete: 0, incompleteCalls: [], recordsWithoutCallId: 0 }
  if (!fs.existsSync(dir)) return empty
  const records = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  const byCall = new Map()
  for (const r of records) {
    if (!r.callId) continue
    const entry = byCall.get(r.callId) || { subflow: r.subflow, stages: new Set() }
    entry.stages.add(r.stage)
    byCall.set(r.callId, entry)
  }
  const complete = entry => ['normalized', 'wire', 'output'].every(stage => entry.stages.has(stage))
  const calls = [...byCall.values()]
  const loop = calls.filter(c => c.subflow === 'stylist_tool_loop')
  return { records: records.length, calls: calls.length, callsComplete: calls.filter(complete).length,
    toolLoopTurns: loop.length, toolLoopTurnsComplete: loop.filter(complete).length,
    incompleteCalls: [...byCall.entries()].filter(([, c]) => !complete(c)).map(([id, c]) => ({ callId: id, subflow: c.subflow, stages: [...c.stages] })),
    recordsWithoutCallId: records.filter(r => !r.callId).length }
}

const runCell = (scenarioKey, arm, replicate, neutral = true) => {
  const cellDir = path.join(outRoot, `${scenarioKey}-${arm}-r${replicate}${neutral ? '' : '-production'}`)
  fs.rmSync(cellDir, { recursive: true, force: true }); fs.mkdirSync(cellDir, { recursive: true })
  for (const f of ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm', 'system.db', 'system.db-wal', 'system.db-shm']) {
    if (fs.existsSync(path.join(snapshot, f))) fs.copyFileSync(path.join(snapshot, f), path.join(cellDir, f))
  }
  const env = providerNetworkEnv({ ...process.env, NODE_ENV: 'test', WARDROBE_DB_PATH: path.join(cellDir, 'wardrobe.db'), WARDROBE_SYSTEM_DB_PATH: path.join(cellDir, 'system.db'),
    WARDROBE_UPLOADS_DIR: path.join(REPO, 'uploads'), STYLIST_PROVIDER_OVERRIDE: 'gemini', STYLIST_MODEL_OVERRIDE: MODEL, GEMINI_THINKING_LEVEL: 'low',
    WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS: neutral ? 'true' : '', AB_LIVE: mode === 'live' ? 'true' : 'false' }, { mode, approved })
  env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR = path.join(cellDir, 'capture')
  if (mode !== 'live') {
    Object.assign(env, { GEMINI_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' })
  }
  const child = spawnSync(process.execPath, [__filename, '--child', `${scenarioKey}:${arm}`, '--cell-dir', cellDir], { env, cwd: REPO, encoding: 'utf8', timeout: 600000 })
  fs.writeFileSync(path.join(cellDir, 'child.log'), `${child.stdout}\n${child.stderr}`)
  const cellFile = path.join(cellDir, 'cell.json')
  const cell = fs.existsSync(cellFile) ? JSON.parse(fs.readFileSync(cellFile, 'utf8')) : { cell: `${scenarioKey}:${arm}`, technicalOk: false, neutralVerdicts: neutral, error: `child exited ${child.status}: ${String(child.stderr).split('\n').slice(-6).join(' ')}` }
  Object.assign(cell, { scenario: scenarioKey, arm, replicate, executionIndex: manifest.cells.length + 1, dir: cellDir, capture: captureCompleteness(path.join(cellDir, 'capture')) })
  for (const f of ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm', 'system.db', 'system.db-wal', 'system.db-shm']) fs.rmSync(path.join(cellDir, f), { force: true })
  manifest.cells.push(cell)
  return cell
}
// COUNTERBALANCED ORDER. The pre-registered sequence is run exactly as written. A preflight with a
// different replicate count alternates arm order by replicate and rotates scenario order.
const scenarioKeys = Object.keys(SCENARIOS)
const schedule = replicates === prereg.replicates.perCell
  ? prereg.executionOrder.sequence.map(entry => { const [r, scenarioKey, arm] = entry.split(':'); return { replicate: Number(r.slice(1)), scenarioKey, arm } })
  : Array.from({ length: replicates }, (_, i) => {
    const rotated = scenarioKeys.map((_, j) => scenarioKeys[(i + j) % scenarioKeys.length])
    const arms = i % 2 === 0 ? ['one', 'bundle'] : ['bundle', 'one']
    return rotated.flatMap(scenarioKey => arms.map(arm => ({ replicate: i + 1, scenarioKey, arm })))
  }).flat()
const expected = scenarioKeys.flatMap(s => ['one', 'bundle'].flatMap(a => Array.from({ length: replicates }, (_, i) => `r${i + 1}:${s}:${a}`))).sort()
const scheduled = schedule.map(e => `r${e.replicate}:${e.scenarioKey}:${e.arm}`)
if (JSON.stringify([...scheduled].sort()) !== JSON.stringify(expected)) { console.error('Refusing: execution order does not cover every scenario x arm x replicate exactly once.'); process.exit(2) }
manifest.executionOrder = scheduled
for (const { scenarioKey, arm, replicate } of schedule) runCell(scenarioKey, arm, replicate)
if (mode === 'preflight') for (const arm of ['one', 'bundle']) runCell('S1', arm, 1, false)

// SUPPLY RECONCILIATION, by ID and reason, from the first replicate of each scenario.
const supply = {}
for (const scenarioKey of Object.keys(SCENARIOS)) {
  const one = manifest.cells.find(c => c.scenario === scenarioKey && c.arm === 'one' && c.replicate === 1 && c.neutralVerdicts)
  const bundle = manifest.cells.find(c => c.scenario === scenarioKey && c.arm === 'bundle' && c.replicate === 1 && c.neutralVerdicts)
  // supply is recorded per attempt; reconciliation reads replicate 1
  if (!one?.supply || !bundle?.supply) continue
  const index = JSON.parse(fs.readFileSync(path.join(bundle.dir, 'piece-index.json'), 'utf8'))
  const active = Object.keys(index).map(Number)
  const suppressed = new Map(bundle.supply.suppressed.map(s => [s.id, s.reasons]))
  const poolExcluded = new Map(bundle.supply.poolExcluded.filter(e => !/roster cap/.test(String(e.reason))).map(e => [e.id, e.reason]))
  const bundlePool = new Set(active.filter(id => !suppressed.has(id) && !poolExcluded.has(id)))
  const catalog = new Set(one.supply.catalogEligibleIds.map(Number))
  const describe = id => ({ id, name: index[id]?.name, category: index[id]?.category })
  const onlyOne = [...catalog].filter(id => !bundlePool.has(id)).map(id => ({ ...describe(id), bundleReason: suppressed.get(id) || poolExcluded.get(id) || 'not in active set' }))
  const onlyBundle = [...bundlePool].filter(id => !catalog.has(id)).map(id => ({ ...describe(id), oneReason: one.supply.catalogExclusions[id] || ['not in catalog, no recorded exclusion'] }))
  const tally = (rows, key) => rows.reduce((acc, row) => { for (const r of [].concat(row[key])) acc[r] = (acc[r] || 0) + 1; return acc }, {})
  supply[scenarioKey] = { oneCatalog: catalog.size, bundlePoolBeforeCap: bundlePool.size, bundleShown: bundle.response?.shownPieceCount ?? null, shared: [...catalog].filter(id => bundlePool.has(id)).length,
    onlyInOneArm: { count: onlyOne.length, byBundleReason: tally(onlyOne, 'bundleReason'), pieces: onlyOne },
    onlyInBundle: { count: onlyBundle.length, byOneArmReason: tally(onlyBundle, 'oneReason'), pieces: onlyBundle } }
}
manifest.supplyReconciliation = supply

// CONTRACT REPORT, over every attempt of the experiment cells (neutral flag).
const experimentCells = manifest.cells.filter(c => c.neutralVerdicts)
const cellOf = (s, arm, r) => experimentCells.find(c => c.scenario === s && c.arm === arm && c.replicate === r)
const rate = list => ({ successes: list.filter(Boolean).length, attempts: list.length })
const routingBy = {}, pairs = []
for (const s of Object.keys(SCENARIOS)) {
  const oneAttempts = experimentCells.filter(c => c.scenario === s && c.arm === 'one')
  routingBy[s] = rate(oneAttempts.map(singleOutfitRouted))
  for (let r = 1; r <= replicates; r++) {
    const one = cellOf(s, 'one', r), bundle = cellOf(s, 'bundle', r)
    const eligibility = reviewEligibility(one, bundle)
    pairs.push({ scenario: s, replicate: r, executionIndex: { one: one?.executionIndex ?? null, bundle: bundle?.executionIndex ?? null },
      captureIntegrity: { one: captureIntegrity(one, mode), bundle: captureIntegrity(bundle, mode) },
      routing: one?.routing || null, conditions: weatherParity(one, bundle),
      technicalOk: { one: Boolean(one?.technicalOk), bundle: Boolean(bundle?.technicalOk) },
      reviewEligible: eligibility.eligible, exclusionReasons: eligibility.reasons,
      cards: { one: one?.response?.cards?.length ?? 0, bundle: bundle?.response?.cards?.length ?? 0,
        needsReview: { one: (one?.response?.cards || []).filter(c => c.broken || c.diagnosticOnly).length, bundle: (bundle?.response?.cards || []).filter(c => c.broken || c.diagnosticOnly).length } },
      piecesWithoutRole: [one, bundle].flatMap(c => (c?.response?.cards || []).flatMap(card => card.pieces.filter(p => !p.role).map(p => `${c.arm}:${p.id}`))),
      bundleCardsWithSlots: (bundle?.response?.cards || []).filter(card => card.modelSlots).length,
      capture: { one: one?.capture || null, bundle: bundle?.capture || null } })
  }
}
const allOne = experimentCells.filter(c => c.arm === 'one')
manifest.contract = {
  mode, preregistrationSha256: preregSha256, snapshotSha256: manifest.snapshot,
  replicatesPerCell: { required: prereg.replicates.perCell, run: replicates, meetsPreregistration: replicates === prereg.replicates.perCell },
  attempts: experimentCells.length, rerunsOrReplacements: 0,
  routingSuccess: { overall: rate(allOne.map(singleOutfitRouted)), byScenario: routingBy, scriptedByPreflight: mode !== 'live' },
  source,
  captureIntegrity: {
    assessed: mode === 'live',
    failures: experimentCells.map(cell => ({ attempt: `r${cell.replicate}:${cell.scenario}:${cell.arm}`, ...captureIntegrity(cell, mode) })).filter(r => r.assessed && !r.ok),
  },
  zeroCardAttempts: { one: rate(allOne.map(c => !(c.response?.cards || []).length)), bundle: rate(experimentCells.filter(c => c.arm === 'bundle').map(c => !(c.response?.cards || []).length)) },
  executionOrder: manifest.executionOrder,
  technicalSuccess: { one: rate(allOne.map(c => Boolean(c.technicalOk))), bundle: rate(experimentCells.filter(c => c.arm === 'bundle').map(c => Boolean(c.technicalOk))) },
  pairs,
}
const line = pair => `| ${pair.scenario} | r${pair.replicate} | ${pair.executionIndex.one}, ${pair.executionIndex.bundle} | ${pair.routing ? `${pair.routing.routerProfile} / ${pair.routing.executedProfile}` : 'none'} | ${pair.conditions.one ? `${pair.conditions.one.highF}/${pair.conditions.one.lowF} ${pair.conditions.one.location}` : 'none'} | ${pair.conditions.bundle ? `${pair.conditions.bundle.highF}/${pair.conditions.bundle.lowF} ${pair.conditions.bundle.location}` : 'none'} | ${pair.conditions.ok ? 'identical' : pair.conditions.reasons.join('; ')} | one ${pair.cards.one - pair.cards.needsReview.one} ready + ${pair.cards.needsReview.one} NR; bundle ${pair.cards.bundle - pair.cards.needsReview.bundle} ready + ${pair.cards.needsReview.bundle} NR | ${pair.piecesWithoutRole.length} | ${pair.bundleCardsWithSlots} | ${pair.capture.one?.toolLoopTurnsComplete ?? 0}/${pair.capture.one?.toolLoopTurns ?? 0} loop, ${pair.capture.one?.callsComplete ?? 0}/${pair.capture.one?.calls ?? 0} one, ${pair.capture.bundle?.callsComplete ?? 0}/${pair.capture.bundle?.calls ?? 0} bundle; unpaired records ${(pair.capture.one?.recordsWithoutCallId ?? 0) + (pair.capture.bundle?.recordsWithoutCallId ?? 0)} | ${pair.reviewEligible ? 'yes' : `no: ${pair.exclusionReasons.join('; ')}`} |`
const c = manifest.contract
fs.writeFileSync(path.join(outRoot, 'contract-report.md'), [
  `# Stage 1 contract report (${mode}${mode === 'live' ? '' : ' — tool/payload preflight, not comparison evidence'})`, '',
  `- Pre-registration sha256: \`${preregSha256}\``,
  `- Source: HEAD \`${source.gitHead}\`; sha256(git diff --binary HEAD) \`${source.diffBinaryHeadSha256}\` (${source.diffBytes} bytes); untracked files ${source.untrackedFiles.length}`,
  `- Capture integrity (technically successful live attempts): ${c.captureIntegrity.assessed ? (c.captureIntegrity.failures.length ? `${c.captureIntegrity.failures.length} FAILURE(S): ${c.captureIntegrity.failures.map(f => `${f.attempt} — ${f.reasons.join('; ')}`).join(' | ')}` : 'all complete') : 'not assessed in preflight (provider calls are served by the test hook)'}`,
  `- Snapshot sha256: ${Object.entries(manifest.snapshot).map(([f, h]) => `${f} ${h ? h.slice(0, 16) : 'absent'}`).join(', ')}`,
  `- Replicates per cell: ${replicates} (pre-registered ${prereg.replicates.perCell}); attempts ${c.attempts}; reruns or replacements 0`,
  `- Single-outfit routing success over all attempts: ${c.routingSuccess.overall.successes}/${c.routingSuccess.overall.attempts}${mode === 'live' ? '' : ' (router answers scripted by the preflight recorder)'}; ${Object.entries(routingBy).map(([s, v]) => `${s} ${v.successes}/${v.attempts}`).join(', ')}`,
  `- Technical success: one ${c.technicalSuccess.one.successes}/${c.technicalSuccess.one.attempts}, bundle ${c.technicalSuccess.bundle.successes}/${c.technicalSuccess.bundle.attempts}`,
  `- Zero-card attempts: one ${c.zeroCardAttempts.one.successes}/${c.zeroCardAttempts.one.attempts}, bundle ${c.zeroCardAttempts.bundle.successes}/${c.zeroCardAttempts.bundle.attempts}`,
  `- Execution order: ${manifest.executionOrder.join(' → ')}`, '',
  '| Scenario | Rep | Order (one, bundle) | Router / executed | One: resolved | Bundle: resolved | Conditions | Displayed cards | Pieces without role | Bundle cards with slots | Capture complete (normalized+wire+output / calls) | Review-eligible |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...pairs.map(line), '',
  '## Supply boundary (replicate 1)', '',
  ...Object.entries(supply).map(([s, v]) => `- ${s}: one-outfit catalog ${v.oneCatalog}, bundle pre-cap pool ${v.bundlePoolBeforeCap}, shared ${v.shared}; catalog-only ${v.onlyInOneArm.count} ${JSON.stringify(v.onlyInOneArm.byBundleReason)}; bundle-only ${v.onlyInBundle.count}`),
  '',
].join('\n'))
fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`wrote ${path.join(outRoot, 'manifest.json')} (${mode}, ${replicates} replicate(s) per cell)`)
