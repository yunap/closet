// Stage 3 — day-wear explanation comparison (docs/day-wear-explanation-experiment-2026-09-15.md;
// scratch/ab_stage3_preregistration.json). Composer-only, on the current production composer request:
//   control : WARDROBE_EXPERIMENT_COMPOSER_MANIFEST with every substitution at production (the exact production request)
//   explain : the same, plus dayWearGuidance 'explain' (one appended neutral instruction + one required output string)
// for the counts the pre-registration declares (the 2026-09-15 pilot: one card only), on the saved 65/50, 46°F-walking and 72/62 scenarios. Production verdict words stay ON
// (WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS is not set), because the comparison is against the current request.
//   --mode preflight (default): the test AI hook answers; no provider request; no network permission.
//     Also captures the actual production request (no manifest) per scenario and count and diffs it against control.
//   --mode live: refused before any child or provider call unless --approved and --approved-prereg-sha match AND the live
//     git HEAD, tracked-file diff hash, snapshot hashes and every cell's sealed request identity equal the sealed values.
//     Each route call re-checks its request identity immediately before the provider call. --guard-only checks and exits.
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { SCENARIOS } from './ab_stage1_scenarios.mjs'
import { providerNetworkEnv } from './ab_stage1_contract.mjs'
import { snapshotHashes, freshSnapshotCopy, removeDbCopies, sourceState, captureCompleteness, assertLiveApproved, unifiedDiff, sha256File, sha256Text, TOKENS_PER_IMAGE } from './ab_stage2_common.mjs'

const __filename = fileURLToPath(import.meta.url)
const REPO = path.join(path.dirname(__filename), '..')
const CHILD = path.join(REPO, 'scratch', 'ab_stage2_composer_only.mjs') // its --child branch runs one route call from a spec
export const STAGE3_PREREG_REL_PATH = 'scratch/ab_stage3_preregistration.json'
export const stage3PreregPath = () => process.env.WARDROBE_STAGE3_PREREG_PATH || path.join(REPO, STAGE3_PREREG_REL_PATH)
const MODEL = 'gemini-3.5-flash-lite'
const CONTRACT = 'D'

const args = process.argv.slice(2)
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const mode = value('--mode') || 'preflight'
const snapshot = value('--snapshot'), outRoot = value('--out')
if (!snapshot || !outRoot || !['preflight', 'live'].includes(mode)) {
  console.error('usage: node scratch/ab_stage3_day_wear.mjs --snapshot <dir> --out <dir> [--mode preflight|live --approved --approved-prereg-sha <sha> [--guard-only]]')
  process.exit(2)
}
const PREREG_PATH = stage3PreregPath()
const prereg = JSON.parse(fs.readFileSync(PREREG_PATH, 'utf8'))
const preregSha256 = sha256File(PREREG_PATH)
const source = sourceState(REPO, { excludePaths: [STAGE3_PREREG_REL_PATH] })
const spec = prereg.contracts[CONTRACT]
try { assertLiveApproved({ mode, args, preregSha256, prereg, source, snapshotDir: snapshot, contract: CONTRACT, cellKeys: spec.executionOrder }) } catch (err) { console.error(err.message); process.exit(2) }
if (args.includes('--guard-only')) {
  if (mode !== 'live') { console.error('--guard-only checks live guards; pass --mode live --approved --approved-prereg-sha <sha>'); process.exit(2) }
  console.log(`live guards passed for Stage 3: sealed source, snapshot and ${spec.executionOrder.length} cell request identities; no call made`)
  process.exit(0)
}
fs.mkdirSync(outRoot, { recursive: true })
const manifest = { experiment: prereg.experiment, contract: CONTRACT, mode, createdAt: new Date().toISOString(), model: MODEL, preregistration: { path: STAGE3_PREREG_REL_PATH, sha256: preregSha256 }, source, snapshot: snapshotHashes(snapshot), attempts: [] }

function runAttempt({ key, scenario, replicate, arm, armSpec, dir, production = false }) {
  freshSnapshotCopy(snapshot, dir)
  if (mode === 'live' && JSON.stringify(snapshotHashes(dir)) !== JSON.stringify(prereg.sealed.snapshot)) {
    removeDbCopies(dir)
    throw new Error(`Refusing ${key}: the fresh snapshot copy does not match the sealed snapshot hashes; no call made`)
  }
  const manifestPath = armSpec ? path.join(dir, 'experiment-manifest.json') : null
  if (armSpec) fs.writeFileSync(manifestPath, JSON.stringify({ experiment: prereg.experiment, arm, stopAfterComposer: true, garmentLine: 'production', sleeveGuidance: 'production', holdOutComparisonSet: false, maxTokensForCount: null, dayWearGuidance: armSpec.dayWearGuidance,
    requireSealedRequest: mode === 'live', expectedRequestIdentitySha256: mode === 'live' ? prereg.sealed.cells[CONTRACT][key].requestIdentitySha256 : null }, null, 2))
  const limit = armSpec?.limit ?? Number(String(arm).match(/(\d+)$/)?.[1] || 5)
  const specPath = path.join(dir, 'child-spec.json')
  fs.writeFileSync(specPath, JSON.stringify({ attempt: key, scenario, replicate, arm, limit, dir, production }))
  const base = { ...process.env, NODE_ENV: 'test', WARDROBE_DB_PATH: path.join(dir, 'wardrobe.db'), WARDROBE_SYSTEM_DB_PATH: path.join(dir, 'system.db'), WARDROBE_UPLOADS_DIR: path.join(REPO, 'uploads'),
    STYLIST_PROVIDER_OVERRIDE: 'gemini', STYLIST_MODEL_OVERRIDE: MODEL, GEMINI_THINKING_LEVEL: 'low',
    WARDROBE_CAPTURE_PROVIDER_INPUT_DIR: path.join(dir, 'capture'), AB_LIVE: mode === 'live' ? 'true' : 'false' }
  delete base.WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS // current production request: production verdict words
  if (manifestPath) base.WARDROBE_EXPERIMENT_COMPOSER_MANIFEST = manifestPath
  else delete base.WARDROBE_EXPERIMENT_COMPOSER_MANIFEST
  const env = providerNetworkEnv(base, { mode, approved: mode === 'live' })
  if (mode !== 'live') Object.assign(env, { GEMINI_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' })
  const child = spawnSync(process.execPath, [CHILD, '--child', '--spec', specPath], { env, cwd: REPO, encoding: 'utf8', timeout: 600000 })
  fs.writeFileSync(path.join(dir, 'child.log'), `${child.stdout}\n${child.stderr}`)
  removeDbCopies(dir)
  const file = path.join(dir, 'attempt.json')
  const attempt = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { attempt: key, status: null, error: `child exited ${child.status}: ${String(child.stderr).split('\n').slice(-5).join(' ')}` }
  if (attempt.experiment) fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(attempt.experiment.request.schema, null, 2))
  return { ...attempt, key, scenario, replicate, arm, dir, networkPermissionInChildEnv: env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK ?? null, capture: captureCompleteness(path.join(dir, 'capture')) }
}

const summarize = a => {
  const e = a.experiment
  if (!e) return { key: a.key, status: a.status, error: a.error, experiment: false }
  const textChars = e.request.textParts.join('\n').length
  return { key: a.key, status: a.status, error: a.error, arm: a.arm, limit: e.requestedLimit, dayWearGuidance: e.manifest?.dayWearGuidance, rosterSize: e.roster.length, images: e.request.imageCount, systemChars: e.request.system.length, textChars,
    estInputTokens: Math.round((e.request.system.length + textChars) / 4) + e.request.imageCount * TOKENS_PER_IMAGE, maxTokens: e.request.maxTokens, rawOutfits: (e.raw?.outfits || []).length,
    requestIdentitySha256: e.requestIdentity?.sha256 || null, requestIdentity: e.requestIdentity || null,
    downstreamModelCalls: a.aiCallKinds ? a.aiCallKinds.filter(k => k !== 'composer').length : null, composerCalls: a.aiCallKinds ? a.aiCallKinds.filter(k => k === 'composer').length : null,
    networkPermissionInChildEnv: a.networkPermissionInChildEnv, resolvedContext: e.resolvedContext, systemSha256: e.request.systemSha256, schemaSha256: sha256Text(JSON.stringify(e.request.schema)),
    imageManifestSha256: sha256Text(JSON.stringify(e.imageManifest)), rosterSha256: sha256Text(JSON.stringify(e.roster)), textSha256: sha256Text(e.request.textParts.join('\n')) }
}

for (const entry of spec.executionOrder) {
  const [r, scenario, arm] = entry.split(':')
  const replicate = Number(r.slice(1))
  const dir = path.join(outRoot, `${scenario}-${arm}-r${replicate}`)
  const attempt = runAttempt({ key: entry, scenario, replicate, arm, armSpec: spec.arms[arm], dir })
  manifest.attempts.push({ ...summarize(attempt), executionIndex: manifest.attempts.length + 1, capture: attempt.capture, blockedFetches: attempt.blockedFetches })
}

const counts = [...new Set(Object.values(spec.arms).map(a => a.limit))].sort((a, b) => a - b)
const lines = d => d.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8')
const diffWork = path.join(outRoot, '.diffwork')

// CONTROL IS THE CURRENT PRODUCTION REQUEST (preflight only, free): the actual production composer request — no manifest —
// captured from the test hook for each scenario and count, diffed against control replicate 1. Every changed line is listed.
if (mode === 'preflight') {
  manifest.productionDiffs = []
  for (const scenario of Object.keys(SCENARIOS)) for (const count of counts) {
    const pdir = path.join(outRoot, `production-${scenario}-N${count}`)
    runAttempt({ key: `production:${scenario}:N${count}`, scenario, replicate: 0, arm: `production-N${count}`, armSpec: null, dir: pdir, production: true })
    const cdir = path.join(outRoot, `${scenario}-control-N${count}-r1`)
    const systemDiff = unifiedDiff(read(pdir, 'system.txt'), read(cdir, 'system.txt'), `production ${scenario} N${count} system`, `control ${scenario} N${count} system`, diffWork)
    const textDiff = unifiedDiff(read(pdir, 'request-text.txt'), read(cdir, 'request-text.txt'), `production ${scenario} N${count}`, `control ${scenario} N${count}`, diffWork)
    fs.writeFileSync(path.join(outRoot, `production-vs-control-${scenario}-N${count}.patch`), `${systemDiff}${textDiff}`)
    const control = JSON.parse(read(cdir, 'attempt.json')).experiment
    const productionImages = JSON.parse(read(pdir, 'images.json'))
    manifest.productionDiffs.push({ scenario, count, systemChangedLines: lines(systemDiff), textChangedLines: lines(textDiff),
      imagesIdentical: JSON.stringify(productionImages.map(i => i.bytesSha256)) === JSON.stringify(control.imageManifest.map(i => i.sentSha256)),
      maxTokens: { production: Number(read(pdir, 'max-tokens.txt')), control: control.request.maxTokens } })
  }
}

// CONTROL vs EXPLAIN, per scenario, replicate and count: the system may differ only by the appended instruction, the schema only
// by the one output string; text, photographs, roster, context and token budget must be identical.
manifest.armDiffs = []
for (const scenario of Object.keys(SCENARIOS)) for (const replicate of [1, 2]) for (const count of counts) {
  const c = `r${replicate}:${scenario}:control-N${count}`, x = `r${replicate}:${scenario}:explain-N${count}`
  const cdir = path.join(outRoot, `${scenario}-control-N${count}-r${replicate}`), xdir = path.join(outRoot, `${scenario}-explain-N${count}-r${replicate}`)
  const ca = manifest.attempts.find(a => a.key === c), xa = manifest.attempts.find(a => a.key === x)
  if (!ca?.systemSha256 || !xa?.systemSha256) { manifest.armDiffs.push({ scenario, replicate, count, error: 'missing attempt' }); continue }
  const systemDiff = unifiedDiff(read(cdir, 'system.txt'), read(xdir, 'system.txt'), `${c} system`, `${x} system`, diffWork)
  const textDiff = unifiedDiff(read(cdir, 'request-text.txt'), read(xdir, 'request-text.txt'), c, x, diffWork)
  const schemaDiff = unifiedDiff(read(cdir, 'schema.json'), read(xdir, 'schema.json'), `${c} schema`, `${x} schema`, diffWork)
  fs.writeFileSync(path.join(outRoot, `diff-${scenario}-N${count}-r${replicate}.patch`), `${systemDiff}${textDiff}${schemaDiff}`)
  manifest.armDiffs.push({ scenario, replicate, count, systemChangedLines: lines(systemDiff), textChangedLines: lines(textDiff).length, schemaChangedLines: lines(schemaDiff),
    sameRoster: ca.rosterSha256 === xa.rosterSha256, sameImages: ca.imageManifestSha256 === xa.imageManifestSha256, sameText: ca.textSha256 === xa.textSha256,
    sameMaxTokens: ca.maxTokens === xa.maxTokens, sameResolvedContext: JSON.stringify(ca.resolvedContext) === JSON.stringify(xa.resolvedContext) })
}
fs.rmSync(diffWork, { recursive: true, force: true })
fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`wrote ${path.join(outRoot, 'manifest.json')} (Stage 3, ${mode}, ${manifest.attempts.length} attempts)`)
