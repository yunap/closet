// Seals the Stage 3 pre-registration from a preflight run on the frozen snapshot: git HEAD, the tracked-file diff hash
// (excluding the pre-registration itself), the six snapshot database hashes and every cell's complete request identity.
// Refuses unless the preflight came from exactly the current source and snapshot, control equals the production request
// for every scenario and count, and every control/explain pair differs only as pre-registered.
// usage: node scratch/ab_stage3_seal.mjs --snapshot <dir> --preflight <dir> [--out <prereg path>]
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { sourceState, snapshotHashes, sha256File } from './ab_stage2_common.mjs'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const REL = 'scratch/ab_stage3_preregistration.json'
const preregFile = process.env.WARDROBE_STAGE3_PREREG_PATH || path.join(REPO, REL)
const args = process.argv.slice(2)
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const snapshot = value('--snapshot'), dir = value('--preflight')
if (!snapshot || !dir) { console.error('usage: node scratch/ab_stage3_seal.mjs --snapshot <dir> --preflight <dir> [--out <prereg>]'); process.exit(2) }
const out = value('--out') || preregFile
const prereg = JSON.parse(fs.readFileSync(preregFile, 'utf8'))
const source = sourceState(REPO, { excludePaths: [REL] })
const problems = []
if (source.untrackedFiles.length) problems.push(`untracked files ${source.untrackedFiles.join(', ')}`)
const snap = snapshotHashes(snapshot)
const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
if (m.mode !== 'preflight') problems.push('manifest is not a preflight')
if (m.source.gitHead !== source.gitHead || m.source.diffBinaryHeadSha256 !== source.diffBinaryHeadSha256) problems.push('preflight source differs from the current source')
if (JSON.stringify(m.snapshot) !== JSON.stringify(snap)) problems.push('preflight snapshot differs from --snapshot')
for (const d of m.productionDiffs || []) {
  if (d.systemChangedLines.length || d.textChangedLines.length || !d.imagesIdentical || d.maxTokens.production !== d.maxTokens.control) problems.push(`control differs from production for ${d.scenario} N${d.count}`)
}
const counts = [...new Set(Object.values(prereg.contracts.D.arms).map(a => a.limit))]
const scenarioCount = Object.keys(prereg.contracts.D.scenarios).length
if ((m.productionDiffs || []).length !== scenarioCount * counts.length) problems.push(`expected ${scenarioCount * counts.length} production-vs-control comparisons`)
const instruction = prereg.change.instructionVerbatim
// Compare the captured files directly: a line diff reports the untouched final system line (no trailing newline) as
// removed and re-added, which is not a change.
const readText = (d, f) => fs.readFileSync(path.join(d, f), 'utf8')
for (const d of m.armDiffs || []) {
  const cdir = path.join(dir, `${d.scenario}-control-N${d.count}-r${d.replicate}`), xdir = path.join(dir, `${d.scenario}-explain-N${d.count}-r${d.replicate}`)
  let systemOk = false, schemaOk = false
  try {
    systemOk = readText(xdir, 'system.txt') === `${readText(cdir, 'system.txt')}\n\n${instruction}`
    const control = JSON.parse(readText(cdir, 'schema.json')), explain = JSON.parse(readText(xdir, 'schema.json'))
    const item = explain.properties.outfits.items
    const added = JSON.stringify(item.properties.wear_through_day) === JSON.stringify({ type: 'string' }) && item.required.at(-1) === 'wear_through_day'
    delete item.properties.wear_through_day
    item.required = item.required.filter(k => k !== 'wear_through_day')
    schemaOk = added && JSON.stringify(explain) === JSON.stringify(control)
  } catch { /* reported below */ }
  if (d.error || !systemOk || d.textChangedLines || !schemaOk || !d.sameRoster || !d.sameImages || !d.sameText || !d.sameMaxTokens || !d.sameResolvedContext) problems.push(`control/explain ${d.scenario} N${d.count} r${d.replicate} differ beyond the pre-registered change`)
}
if ((m.armDiffs || []).length !== scenarioCount * prereg.contracts.D.replicatesPerCell * counts.length) problems.push('unexpected number of control/explain comparisons')
const cells = {}
for (const key of prereg.contracts.D.executionOrder) {
  const item = m.attempts.find(x => x.key === key)
  if (!item?.requestIdentity?.sha256 || item.error) { problems.push(`no clean request identity for ${key}`); continue }
  cells[key] = { requestIdentitySha256: item.requestIdentity.sha256, ...item.requestIdentity }
}
if (problems.length) { console.error(`Refusing to seal:\n- ${problems.join('\n- ')}`); process.exit(2) }
prereg.sealed = { sealedAt: new Date().toISOString(), source: { gitHead: source.gitHead, diffBinaryHeadSha256: source.diffBinaryHeadSha256, excludedFromDiff: [REL] }, snapshot: snap, cells: { D: cells } }
fs.writeFileSync(out, JSON.stringify(prereg, null, 2) + '\n')
console.log(`sealed ${out}; sha256 ${sha256File(out)}`)
