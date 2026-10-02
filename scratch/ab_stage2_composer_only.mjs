// Stage 2 Contracts B and C (docs/stage1-cause-matrix-2026-09-14.md §6–7; scratch/ab_stage2_preregistration.json).
// Composer-only: each attempt runs the production Whole Wardrobe route with WARDROBE_EXPERIMENT_COMPOSER_MANIFEST
// set, so everything upstream is production and the route returns right after the composer response.
//   --mode preflight (default): the test AI hook answers the composer; no provider request; network permission absent.
//   --mode live: refused, before any child or provider call, unless --approved and --approved-prereg-sha match AND
//     the live git HEAD, tracked-file diff hash, snapshot database hashes and every cell's sealed request identity
//     equal the pre-registration's sealed values. Each cell's route call re-checks its request identity
//     immediately before the Gemini call. --guard-only runs those checks and exits without any call.
//   --production-diff (preflight, contract B): also captures the actual production composer request (no manifest,
//     neutral verdict words OFF) per scenario and diffs it against experimental B0.
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { SCENARIOS } from './ab_stage1_scenarios.mjs'
import { providerNetworkEnv } from './ab_stage1_contract.mjs'
import { snapshotHashes, freshSnapshotCopy, removeDbCopies, sourceState, captureCompleteness, assertLiveApproved, unifiedDiff, sha256File, sha256Text, preregPath, TOKENS_PER_IMAGE } from './ab_stage2_common.mjs'

const __filename = fileURLToPath(import.meta.url)
const REPO = path.join(path.dirname(__filename), '..')
const args = process.argv.slice(2)
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const PREREG_PATH = preregPath(REPO)
const REQUEST_DATE = '2026-09-13'
const MODEL = 'gemini-3.5-flash-lite'

// ─────────────── child: one attempt ───────────────
if (args.includes('--child')) {
  const spec = JSON.parse(fs.readFileSync(value('--spec'), 'utf8'))
  const live = process.env.AB_LIVE === 'true'
  const blockedFetches = []
  if (!live) {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = String(input?.url || input)
      if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return realFetch(input, init)
      blockedFetches.push(url.replace(/key=[^&]+/, 'key=<redacted>'))
      throw new Error('preflight: external fetch blocked')
    }
  }
  const { app, db } = await import(`${REPO}/server.js`)
  if (!live) db.prepare("DELETE FROM app_meta WHERE key LIKE 'byok%'").run()
  const location = db.prepare("SELECT value FROM app_meta WHERE key = 'home_location'").get()?.value || ''
  const aiCalls = []
  const kindOf = system => {
    const s = String(system || '')
    if (s.includes('personal stylist. You are looking at photos')) return 'composer'
    if (s.includes('second stylist reviewing')) return 'critic'
    if (s.includes('repairing cards you composed')) return 'repair'
    return 'other'
  }
  if (!live) {
    globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages, maxTokens }) => {
      const kind = kindOf(system)
      aiCalls.push(kind)
      if (kind !== 'composer') return {}
      if (spec.production && aiCalls.filter(k => k === 'composer').length === 1) {
        const content = messages?.[0]?.content || []
        fs.writeFileSync(path.join(spec.dir, 'system.txt'), String(system))
        fs.writeFileSync(path.join(spec.dir, 'request-text.txt'), content.filter(p => p.type === 'text').map(p => p.text).join('\n'))
        fs.writeFileSync(path.join(spec.dir, 'images.json'), JSON.stringify(content.filter(p => p.type === 'image').map(p => ({ detail: p.detail || null, bytesSha256: sha256Text(String(p.source?.data || '')) }))))
        fs.writeFileSync(path.join(spec.dir, 'max-tokens.txt'), String(maxTokens))
      }
      const byGroup = {}; let group = null
      for (const part of messages?.[0]?.content || []) {
        if (part.type !== 'text') continue
        const heading = part.text.match(/^=== ([A-Z]+)/); if (heading) { group = heading[1]; continue }
        const id = part.text.match(/^ID (\d+):/); if (id && group) (byGroup[group] ||= []).push(Number(id[1]))
      }
      const pick = (g, i) => (byGroup[g] || [])[i] ?? null
      return { outfits: Array.from({ length: spec.limit }, (_, i) => ({ label: `PREFLIGHT ${i + 1}`, strength: 'usable', dominantDirection: 'preflight', silhouette: 'preflight', bestFor: 'preflight',
        base_top_id: pick('TOPS', i), bottom_id: pick('BOTTOMS', i), dress_id: null, middle_layer_id: null, outer_layer_id: pick('OUTERWEAR', i), shoes_id: pick('SHOES', i),
        reason: 'preflight', styling_instructions: '', watchFor: 'none' })), skip: '', saveableLearning: '' }
    }
  }
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  const scenario = SCENARIOS[spec.scenario]
  const body = { occasion: 'casual', season: 'fall', mood: '', request: scenario.situation, question: scenario.situation, mission: 'mix', limit: spec.limit, activity: scenario.activity, userWeather: scenario.user_weather, location, date: REQUEST_DATE, currentDate: REQUEST_DATE }
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/generate-wardrobe-outfits-visual`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  const out = { attempt: spec.attempt, mode: live ? 'live' : 'preflight', status: res.status, error: json.error || null, request: body, aiCallKinds: live ? null : aiCalls, blockedFetches,
    experiment: json.experimentComposerOnly || null, productionResponseKeys: json.experimentComposerOnly ? null : Object.keys(json) }
  fs.writeFileSync(path.join(spec.dir, 'attempt.json'), JSON.stringify(out, null, 2))
  if (out.experiment) {
    fs.writeFileSync(path.join(spec.dir, 'system.txt'), out.experiment.request.system)
    fs.writeFileSync(path.join(spec.dir, 'request-text.txt'), out.experiment.request.textParts.join('\n'))
  }
  server.close(); db.close(); process.exit(0)
}

// ─────────────── parent ───────────────
const contract = value('--contract')
const mode = value('--mode') || 'preflight'
const snapshot = value('--snapshot'), outRoot = value('--out')
if (!['B', 'C'].includes(contract) || !snapshot || !outRoot || !['preflight', 'live'].includes(mode)) {
  console.error('usage: node scratch/ab_stage2_composer_only.mjs --contract B|C --snapshot <dir> --out <dir> [--mode preflight|live --approved --approved-prereg-sha <sha> [--guard-only]] [--production-diff]')
  process.exit(2)
}
const prereg = JSON.parse(fs.readFileSync(PREREG_PATH, 'utf8'))
const preregSha256 = sha256File(PREREG_PATH)
const source = sourceState(REPO)
const spec = prereg.contracts[contract]
try { assertLiveApproved({ mode, args, preregSha256, prereg, source, snapshotDir: snapshot, contract, cellKeys: spec.executionOrder }) } catch (err) { console.error(err.message); process.exit(2) }
if (args.includes('--guard-only')) {
  if (mode !== 'live') { console.error('--guard-only checks live guards; pass --mode live --approved --approved-prereg-sha <sha>'); process.exit(2) }
  console.log(`live guards passed for contract ${contract}: sealed source, snapshot and ${spec.executionOrder.length} cell request identities; no call made`)
  process.exit(0)
}
fs.mkdirSync(outRoot, { recursive: true })
const manifest = { contract, mode, createdAt: new Date().toISOString(), model: MODEL, preregistration: { path: 'scratch/ab_stage2_preregistration.json', sha256: preregSha256 }, source, snapshot: snapshotHashes(snapshot), attempts: [], identityChecks: [] }

function runAttempt({ key, scenario, replicate, arm, armSpec, dir, production = false }) {
  freshSnapshotCopy(snapshot, dir)
  if (mode === 'live' && JSON.stringify(snapshotHashes(dir)) !== JSON.stringify(prereg.sealed.snapshot)) {
    removeDbCopies(dir)
    throw new Error(`Refusing ${key}: the fresh snapshot copy does not match the sealed snapshot hashes; no call made`)
  }
  const manifestPath = armSpec ? path.join(dir, 'experiment-manifest.json') : null
  if (armSpec) fs.writeFileSync(manifestPath, JSON.stringify({ experiment: `stage2-${contract}`, arm, stopAfterComposer: true, garmentLine: armSpec.garmentLine, sleeveGuidance: armSpec.sleeveGuidance, holdOutComparisonSet: armSpec.holdOutComparisonSet, maxTokensForCount: armSpec.maxTokensForCount,
    requireSealedRequest: mode === 'live', expectedRequestIdentitySha256: mode === 'live' ? prereg.sealed.cells[contract][key].requestIdentitySha256 : null }, null, 2))
  const specPath = path.join(dir, 'child-spec.json')
  fs.writeFileSync(specPath, JSON.stringify({ attempt: key, scenario, replicate, arm, limit: armSpec?.limit ?? 5, dir, production }))
  const base = { ...process.env, NODE_ENV: 'test', WARDROBE_DB_PATH: path.join(dir, 'wardrobe.db'), WARDROBE_SYSTEM_DB_PATH: path.join(dir, 'system.db'), WARDROBE_UPLOADS_DIR: path.join(REPO, 'uploads'),
    STYLIST_PROVIDER_OVERRIDE: 'gemini', STYLIST_MODEL_OVERRIDE: MODEL, GEMINI_THINKING_LEVEL: 'low', WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS: 'true',
    WARDROBE_CAPTURE_PROVIDER_INPUT_DIR: path.join(dir, 'capture'), AB_LIVE: mode === 'live' ? 'true' : 'false' }
  // Actual production identity: no manifest AND neutral verdict words off.
  if (production) delete base.WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS
  if (manifestPath) base.WARDROBE_EXPERIMENT_COMPOSER_MANIFEST = manifestPath
  else delete base.WARDROBE_EXPERIMENT_COMPOSER_MANIFEST
  const env = providerNetworkEnv(base, { mode, approved: mode === 'live' })
  if (mode !== 'live') Object.assign(env, { GEMINI_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' })
  const child = spawnSync(process.execPath, [__filename, '--child', '--spec', specPath], { env, cwd: REPO, encoding: 'utf8', timeout: 600000 })
  fs.writeFileSync(path.join(dir, 'child.log'), `${child.stdout}\n${child.stderr}`)
  removeDbCopies(dir)
  const file = path.join(dir, 'attempt.json')
  const attempt = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { attempt: key, status: null, error: `child exited ${child.status}: ${String(child.stderr).split('\n').slice(-5).join(' ')}` }
  return { ...attempt, key, scenario, replicate, arm, dir, networkPermissionInChildEnv: env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK ?? null, capture: captureCompleteness(path.join(dir, 'capture')) }
}

const summarize = a => {
  const e = a.experiment
  if (!e) return { key: a.key, status: a.status, error: a.error, experiment: false }
  const textChars = e.request.textParts.join('\n').length
  const imagesByKind = e.imageManifest.reduce((acc, m) => ({ ...acc, [m.photoKind]: (acc[m.photoKind] || 0) + 1 }), {})
  return { key: a.key, status: a.status, error: a.error, arm: a.arm, limit: e.requestedLimit, rosterSize: e.roster.length, images: e.request.imageCount, imagesByKind, systemChars: e.request.system.length, textChars,
    estInputTokens: Math.round((e.request.system.length + textChars) / 4) + e.request.imageCount * TOKENS_PER_IMAGE, maxTokens: e.request.maxTokens, rawOutfits: (e.raw?.outfits || []).length,
    requestIdentitySha256: e.requestIdentity?.sha256 || null, requestIdentity: e.requestIdentity || null,
    downstreamModelCalls: a.aiCallKinds ? a.aiCallKinds.filter(k => k !== 'composer').length : null, composerCalls: a.aiCallKinds ? a.aiCallKinds.filter(k => k === 'composer').length : null,
    networkPermissionInChildEnv: a.networkPermissionInChildEnv, resolvedContext: e.resolvedContext, systemSha256: e.request.systemSha256, imageManifestSha256: sha256Text(JSON.stringify(e.imageManifest)), rosterSha256: sha256Text(JSON.stringify(e.roster)) }
}

for (const entry of spec.executionOrder) {
  const [r, scenario, arm] = entry.split(':')
  const replicate = Number(r.slice(1))
  const dir = path.join(outRoot, `${scenario}-${arm}-r${replicate}`)
  const attempt = runAttempt({ key: entry, scenario, replicate, arm, armSpec: spec.arms[arm], dir })
  manifest.attempts.push({ ...summarize(attempt), executionIndex: manifest.attempts.length + 1, capture: attempt.capture, blockedFetches: attempt.blockedFetches })
}

// PRODUCTION vs EXPERIMENTAL B0 (preflight only, free): the actual production composer request — no manifest,
// neutral verdict words off — captured from the test hook, diffed against B0 replicate 1. Every changed line is listed.
if (mode === 'preflight' && contract === 'B' && args.includes('--production-diff')) {
  manifest.productionDiffs = []
  for (const scenario of Object.keys(SCENARIOS)) {
    const pdir = path.join(outRoot, `production-${scenario}`)
    runAttempt({ key: `production:${scenario}`, scenario, replicate: 0, arm: 'production', armSpec: null, dir: pdir, production: true })
    const bdir = path.join(outRoot, `${scenario}-B0-r1`)
    const textDiff = unifiedDiff(fs.readFileSync(path.join(pdir, 'request-text.txt'), 'utf8'), fs.readFileSync(path.join(bdir, 'request-text.txt'), 'utf8'), `production ${scenario}`, `B0 ${scenario} r1`, path.join(outRoot, '.diffwork'))
    const systemDiff = unifiedDiff(fs.readFileSync(path.join(pdir, 'system.txt'), 'utf8'), fs.readFileSync(path.join(bdir, 'system.txt'), 'utf8'), `production ${scenario} system`, `B0 ${scenario} r1 system`, path.join(outRoot, '.diffwork'))
    fs.writeFileSync(path.join(outRoot, `production-vs-B0-${scenario}.patch`), `${systemDiff}${textDiff}`)
    const lines = d => d.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    const b0 = JSON.parse(fs.readFileSync(path.join(bdir, 'attempt.json'), 'utf8')).experiment
    const productionImages = JSON.parse(fs.readFileSync(path.join(pdir, 'images.json'), 'utf8'))
    manifest.productionDiffs.push({ scenario, patch: `production-vs-B0-${scenario}.patch`, systemChangedLines: lines(systemDiff), textChangedLines: lines(textDiff),
      imagesIdentical: JSON.stringify(productionImages.map(i => i.bytesSha256)) === JSON.stringify(b0.imageManifest.map(i => i.sentSha256)),
      maxTokens: { production: Number(fs.readFileSync(path.join(pdir, 'max-tokens.txt'), 'utf8')), b0: b0.request.maxTokens } })
  }
}

// Exact request diffs between the arms of each scenario and replicate.
const arms = Object.keys(spec.arms)
const byKey = Object.fromEntries(manifest.attempts.map(a => [a.key, a]))
const diffs = []
for (const scenario of Object.keys(SCENARIOS)) for (const replicate of [1, 2]) {
  const [a, b] = arms.map(arm => `r${replicate}:${scenario}:${arm}`)
  const da = path.join(outRoot, `${scenario}-${arms[0]}-r${replicate}`), db_ = path.join(outRoot, `${scenario}-${arms[1]}-r${replicate}`)
  if (!fs.existsSync(path.join(da, 'request-text.txt')) || !fs.existsSync(path.join(db_, 'request-text.txt'))) { diffs.push({ scenario, replicate, error: 'missing request text' }); continue }
  const textDiff = unifiedDiff(fs.readFileSync(path.join(da, 'request-text.txt'), 'utf8'), fs.readFileSync(path.join(db_, 'request-text.txt'), 'utf8'), a, b, path.join(outRoot, '.diffwork'))
  const systemDiff = unifiedDiff(fs.readFileSync(path.join(da, 'system.txt'), 'utf8'), fs.readFileSync(path.join(db_, 'system.txt'), 'utf8'), `${a} system`, `${b} system`, path.join(outRoot, '.diffwork'))
  const diffFile = path.join(outRoot, `diff-${scenario}-r${replicate}.patch`)
  fs.writeFileSync(diffFile, `${systemDiff}${textDiff}`)
  const changed = textDiff.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
  // B only: every B1 garment line must be the exact B0 line plus appended `; field: value` facts, with no role vocabulary.
  let appendOnly = null
  if (contract === 'B') {
    const lines = file => Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').map(l => [l.match(/^ID (\d+):/)?.[1], l]).filter(([id]) => id))
    const b0 = lines(path.join(da, 'request-text.txt')), b1 = lines(path.join(db_, 'request-text.txt'))
    const violations = Object.keys(b0).filter(id => !(b1[id]?.startsWith(b0[id]) && /^(; [a-z_]+: [^;]+)*$/.test(b1[id].slice(b0[id].length))) || /layer_top|primary_top|primary_bottom|\(layer_top\)/.test(b1[id] || ''))
    appendOnly = { garments: Object.keys(b0).length, violations, sameIds: JSON.stringify(Object.keys(b0)) === JSON.stringify(Object.keys(b1)) }
  }
  diffs.push({ scenario, replicate, diffFile: path.basename(diffFile), appendOnly, systemIdentical: systemDiff === '', changedTextLines: changed.length,
    changedGarmentLines: changed.filter(l => /^[+-]ID \d+:/.test(l)).length, changedOtherLines: changed.filter(l => !/^[+-]ID \d+:/.test(l)).map(l => l.slice(0, 160)),
    sameRoster: byKey[a]?.rosterSha256 === byKey[b]?.rosterSha256, sameImages: byKey[a]?.imageManifestSha256 === byKey[b]?.imageManifestSha256,
    sameSystem: byKey[a]?.systemSha256 === byKey[b]?.systemSha256, sameMaxTokens: byKey[a]?.maxTokens === byKey[b]?.maxTokens,
    sameResolvedContext: JSON.stringify({ ...byKey[a]?.resolvedContext }) === JSON.stringify({ ...byKey[b]?.resolvedContext }) })
}
manifest.diffs = diffs
fs.rmSync(path.join(outRoot, '.diffwork'), { recursive: true, force: true })
fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`wrote ${path.join(outRoot, 'manifest.json')} (${contract}, ${mode}, ${manifest.attempts.length} attempts)`)
