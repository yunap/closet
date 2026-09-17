// Stage 2 Contract A — controlled construction-discrimination probe (docs/stage1-cause-matrix-2026-09-14.md §5;
// scratch/ab_stage2_preregistration.json). One structured call per pairing: inner garment under 996866.
//   --mode preflight (default): the test AI hook answers; no provider request; network permission absent.
//   --mode live: refused, before any child or provider call, unless the approval hash, live source, snapshot and every
//     cell's sealed request identity match the pre-registration; each call re-checks its request identity immediately
//     before the provider call. --guard-only runs those checks and exits without any call.
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { providerNetworkEnv } from './ab_stage1_contract.mjs'
import { snapshotHashes, freshSnapshotCopy, removeDbCopies, sourceState, captureCompleteness, assertLiveApproved, sha256File, sha256Text, preregPath, TOKENS_PER_IMAGE } from './ab_stage2_common.mjs'

const __filename = fileURLToPath(import.meta.url)
const REPO = path.join(path.dirname(__filename), '..')
const args = process.argv.slice(2)
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const PREREG_PATH = preregPath(REPO)
const MODEL = 'gemini-3.5-flash-lite'
const PROBE_MAX_PX = 768

if (args.includes('--child')) {
  const spec = JSON.parse(fs.readFileSync(value('--spec'), 'utf8'))
  const live = process.env.AB_LIVE === 'true'
  const blockedFetches = []
  if (!live) globalThis.fetch = async input => { blockedFetches.push(String(input?.url || input)); throw new Error('preflight: fetch blocked') }
  const { db, parsePiece } = await import(`${REPO}/db.js`)
  const { askStylistStructuredWithUsage, prepareWardrobeThumb, stylistProviderOverride } = await import(`${REPO}/styling-engine/provider.js`)
  const { composerExperimentGarmentLine, composerRequestIdentity } = await import(`${REPO}/routes/ai.js`)
  const { resolveAiTarget } = await import(`${REPO}/styling-engine/provider.js`)
  const { userUploadsDir } = await import(`${REPO}/server.js`)
  const piece = id => parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(Number(id)))
  const content = []
  const imageManifest = []
  for (const [role, id] of [['inner', spec.inner], ['outer', spec.outer]]) {
    const p = piece(id)
    content.push({ type: 'text', text: `${role === 'inner' ? 'INNER GARMENT (worn under)' : 'OUTER GARMENT (worn over)'} — ${composerExperimentGarmentLine(p, 'complete')}` })
    for (const [kind, file] of [['hanger', p.photo], ['worn', p.worn_photo]]) {
      const full = file ? path.join(userUploadsDir(), file) : ''
      if (!file || !fs.existsSync(full)) { content.push({ type: 'text', text: `${role} garment — ${kind} photo: not available` }); imageManifest.push({ id: p.id, role, photoKind: kind, photoFile: file || null, sent: false }); continue }
      const thumb = await prepareWardrobeThumb(full, `${p.id}:${PROBE_MAX_PX}:${file}`, { maxPx: PROBE_MAX_PX })
      content.push({ type: 'text', text: `${role} garment — ${kind} photo` })
      content.push({ type: 'image', detail: 'auto', source: { type: 'base64', media_type: thumb.media_type, data: thumb.data } })
      imageManifest.push({ id: p.id, role, photoKind: kind, photoFile: file, maxPx: PROBE_MAX_PX, sent: true, sentSha256: sha256Text(thumb.data) })
    }
  }
  content.push({ type: 'text', text: 'Question: the inner garment is worn under the outer garment with both sleeves on. Is this layering relationship workable, unworkable, or genuinely uncertain?' })
  if (!live) {
    globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => ({ verdict: 'genuinely_uncertain', construction_evidence: [{ garment: 'inner', source: 'fact', observation: 'PREFLIGHT' }], sleeve_treatment: '', uncertainty_reason: 'PREFLIGHT' })
  }
  let result = null, error = null
  const requestIdentity = composerRequestIdentity({ system: spec.systemPrompt, content, schema: spec.schema, model: resolveAiTarget(stylistProviderOverride).model, maxTokens: 1200 })
  // SEALED REQUEST: compared immediately before the provider call; a mismatch refuses without calling.
  if (spec.requireSealedRequest && requestIdentity.sha256 !== spec.expectedRequestIdentitySha256) {
    error = `Sealed probe request identity mismatch (expected ${spec.expectedRequestIdentitySha256}, got ${requestIdentity.sha256}); no provider call was made`
  } else try {
    result = await askStylistStructuredWithUsage({ system: spec.systemPrompt, messages: [{ role: 'user', content }], schema: spec.schema, name: 'construction_probe', description: 'Classify one garment layering relationship.', maxTokens: 1200, providerOverride: stylistProviderOverride, subflow: 'construction_probe' })
  } catch (err) { error = err.message }
  const textParts = content.filter(p => p.type === 'text').map(p => p.text)
  fs.writeFileSync(path.join(spec.dir, 'request-text.txt'), textParts.join('\n'))
  fs.writeFileSync(path.join(spec.dir, 'attempt.json'), JSON.stringify({ attempt: spec.attempt, mode: live ? 'live' : 'preflight', inner: spec.inner, outer: spec.outer, systemSha256: sha256Text(spec.systemPrompt), requestIdentity, textParts, imageManifest, imageCount: content.filter(p => p.type === 'image').length, raw: result?.value ?? null, usage: result?.usage ?? null, error, blockedFetches }, null, 2))
  db.close(); process.exit(0)
}

const mode = value('--mode') || 'preflight'
const snapshot = value('--snapshot'), outRoot = value('--out')
if (!snapshot || !outRoot || !['preflight', 'live'].includes(mode)) { console.error('usage: node scratch/ab_stage2_construction_probe.mjs --snapshot <dir> --out <dir> [--mode preflight|live --approved --approved-prereg-sha <sha>]'); process.exit(2) }
const prereg = JSON.parse(fs.readFileSync(PREREG_PATH, 'utf8'))
const preregSha256 = sha256File(PREREG_PATH)
const source = sourceState(REPO)
const A = prereg.contracts.A
try { assertLiveApproved({ mode, args, preregSha256, prereg, source, snapshotDir: snapshot, contract: 'A', cellKeys: A.executionOrder }) } catch (err) { console.error(err.message); process.exit(2) }
if (args.includes('--guard-only')) {
  if (mode !== 'live') { console.error('--guard-only checks live guards; pass --mode live --approved --approved-prereg-sha <sha>'); process.exit(2) }
  console.log(`live guards passed for contract A: sealed source, snapshot and ${A.executionOrder.length} cell request identities; no call made`)
  process.exit(0)
}
fs.mkdirSync(outRoot, { recursive: true })
const manifest = { contract: 'A', mode, createdAt: new Date().toISOString(), model: MODEL, preregistration: { path: 'scratch/ab_stage2_preregistration.json', sha256: preregSha256 }, source, snapshot: snapshotHashes(snapshot), calls: [] }
const { layerConstructionPromptRuleText, neutral } = { layerConstructionPromptRuleText: 'Sleeve layering compatibility', neutral: prereg.sleeve.neutralSentence }
for (const entry of A.executionOrder) {
  const [r, inner] = entry.split(':')
  const dir = path.join(outRoot, `${inner}-${r}`)
  freshSnapshotCopy(snapshot, dir)
  if (mode === 'live' && JSON.stringify(snapshotHashes(dir)) !== JSON.stringify(prereg.sealed.snapshot)) { removeDbCopies(dir); console.error(`Refusing ${entry}: fresh snapshot copy does not match the sealed hashes; no call made`); process.exit(2) }
  const specPath = path.join(dir, 'child-spec.json')
  fs.writeFileSync(specPath, JSON.stringify({ attempt: entry, inner: Number(inner), outer: 996866, systemPrompt: A.systemPrompt, schema: A.schema, dir,
    requireSealedRequest: mode === 'live', expectedRequestIdentitySha256: mode === 'live' ? prereg.sealed.cells.A[entry].requestIdentitySha256 : null }))
  const base = { ...process.env, NODE_ENV: 'test', WARDROBE_DB_PATH: path.join(dir, 'wardrobe.db'), WARDROBE_SYSTEM_DB_PATH: path.join(dir, 'system.db'), WARDROBE_UPLOADS_DIR: path.join(REPO, 'uploads'),
    STYLIST_PROVIDER_OVERRIDE: 'gemini', STYLIST_MODEL_OVERRIDE: MODEL, GEMINI_THINKING_LEVEL: 'low', WARDROBE_CAPTURE_PROVIDER_INPUT_DIR: path.join(dir, 'capture'), AB_LIVE: mode === 'live' ? 'true' : 'false' }
  const env = providerNetworkEnv(base, { mode, approved: mode === 'live' })
  if (mode !== 'live') Object.assign(env, { GEMINI_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' })
  const child = spawnSync(process.execPath, [__filename, '--child', '--spec', specPath], { env, cwd: REPO, encoding: 'utf8', timeout: 300000 })
  fs.writeFileSync(path.join(dir, 'child.log'), `${child.stdout}\n${child.stderr}`)
  removeDbCopies(dir)
  const file = path.join(dir, 'attempt.json')
  const a = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { attempt: entry, error: `child exited ${child.status}: ${String(child.stderr).split('\n').slice(-5).join(' ')}` }
  const text = [A.systemPrompt, ...(a.textParts || [])].join('\n')
  manifest.calls.push({ executionIndex: manifest.calls.length + 1, attempt: entry, error: a.error || null, imageCount: a.imageCount, imageManifest: a.imageManifest,
    estInputTokens: Math.round(text.length / 4) + (a.imageCount || 0) * TOKENS_PER_IMAGE,
    withheldChecks: { noTemperature: !/°F|\bdegrees?\b/i.test(text), noOccasion: !/\boccasion\b/i.test((a.textParts || []).join('\n')), noCategoricalSleeveRule: !text.includes(layerConstructionPromptRuleText), noNeutralSentence: !text.includes(neutral), noTruthTable: !/compressible ruching|non-compressible/i.test((a.textParts || []).join('\n')) },
    bothPhotosPerGarment: ['inner', 'outer'].every(role => ['hanger', 'worn'].every(kind => (a.imageManifest || []).some(m => m.role === role && m.photoKind === kind && m.sent))),
    networkPermissionInChildEnv: env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK ?? null, capture: captureCompleteness(path.join(dir, 'capture')), rawVerdict: a.raw?.verdict ?? null,
    requestIdentitySha256: a.requestIdentity?.sha256 || null, requestIdentity: a.requestIdentity || null })
}
fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`wrote ${path.join(outRoot, 'manifest.json')} (A, ${mode}, ${manifest.calls.length} calls)`)
