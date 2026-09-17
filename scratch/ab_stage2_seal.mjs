// Seals the Stage 2 pre-registration (docs/stage1-cause-matrix-2026-09-14.md §4) from preflights run on the FINAL
// frozen snapshot: git HEAD, the tracked-file diff hash (excluding the pre-registration itself), the six snapshot
// database hashes, and every cell's complete request identity. Refuses unless every preflight manifest was produced
// from exactly the current source and the given snapshot, with a request identity for every pre-registered cell.
// usage: node scratch/ab_stage2_seal.mjs --snapshot <final snapshot dir> --a <A preflight dir> --b <B preflight dir> --c <C preflight dir> [--out <prereg path>]
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { sourceState, snapshotHashes, preregPath, sha256File } from './ab_stage2_common.mjs'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const snapshot = value('--snapshot'), dirs = { A: value('--a'), B: value('--b'), C: value('--c') }
if (!snapshot || !dirs.A || !dirs.B || !dirs.C) { console.error('usage: node scratch/ab_stage2_seal.mjs --snapshot <dir> --a <dir> --b <dir> --c <dir> [--out <prereg>]'); process.exit(2) }
const out = value('--out') || preregPath(REPO)
const prereg = JSON.parse(fs.readFileSync(preregPath(REPO), 'utf8'))
const source = sourceState(REPO)
if (source.untrackedFiles.length) { console.error(`Refusing to seal: untracked files ${source.untrackedFiles.join(', ')}`); process.exit(2) }
const snap = snapshotHashes(snapshot)
const problems = []
const cells = {}
for (const [contract, dir] of Object.entries(dirs)) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  if (m.mode !== 'preflight') problems.push(`${contract}: manifest is not a preflight`)
  if (m.source.gitHead !== source.gitHead || m.source.diffBinaryHeadSha256 !== source.diffBinaryHeadSha256) problems.push(`${contract}: preflight source differs from the current source`)
  if (JSON.stringify(m.snapshot) !== JSON.stringify(snap)) problems.push(`${contract}: preflight snapshot differs from --snapshot`)
  const items = m.calls || m.attempts
  cells[contract] = {}
  for (const key of prereg.contracts[contract].executionOrder) {
    const item = items.find(x => (x.attempt || x.key) === key)
    if (!item?.requestIdentity?.sha256 || item.error) { problems.push(`${contract}: no clean request identity for ${key}`); continue }
    cells[contract][key] = { requestIdentitySha256: item.requestIdentity.sha256, ...item.requestIdentity }
  }
}
if (problems.length) { console.error(`Refusing to seal:\n- ${problems.join('\n- ')}`); process.exit(2) }
prereg.sealed = { sealedAt: new Date().toISOString(), source: { gitHead: source.gitHead, diffBinaryHeadSha256: source.diffBinaryHeadSha256, excludedFromDiff: source.excludedFromDiff }, snapshot: snap, cells }
fs.writeFileSync(out, JSON.stringify(prereg, null, 2) + '\n')
console.log(`sealed ${out}; sha256 ${sha256File(out)}`)
