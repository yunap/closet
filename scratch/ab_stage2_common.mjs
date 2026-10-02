// Shared by the Stage 2 experiment harnesses (docs/stage1-cause-matrix-2026-09-14.md §4–10).
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

export const DB_FILES = ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm', 'system.db', 'system.db-wal', 'system.db-shm']
export const TOKENS_PER_IMAGE = 1080 // measured in Stage 1: ~89.9k image tokens for 83 composer images
// The pre-registration is approved by its own sha256; it is excluded from the source hash it seals.
export const PREREG_REL_PATH = 'scratch/ab_stage2_preregistration.json'

export const sha256File = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
export const sha256Text = text => crypto.createHash('sha256').update(String(text)).digest('hex')

export function preregPath(repo) {
  return process.env.WARDROBE_STAGE2_PREREG_PATH || path.join(repo, PREREG_REL_PATH)
}

export function snapshotHashes(dir) {
  return Object.fromEntries(DB_FILES.map(f => [f, sha256File(path.join(dir, f))]))
}

export function freshSnapshotCopy(snapshot, dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  for (const f of DB_FILES) if (fs.existsSync(path.join(snapshot, f))) fs.copyFileSync(path.join(snapshot, f), path.join(dir, f))
}

export function removeDbCopies(dir) {
  for (const f of DB_FILES) fs.rmSync(path.join(dir, f), { force: true })
}

// The implementation under test is largely uncommitted: HEAD alone does not name it. Staged and unstaged
// tracked changes both count (git diff against HEAD); untracked files are listed and refused for live runs.
export function sourceState(repo, { excludePaths = [PREREG_REL_PATH] } = {}) {
  const git = (...args) => spawnSync('git', args, { cwd: repo, maxBuffer: 1 << 30 })
  const diff = git('diff', '--binary', 'HEAD', '--', '.', ...excludePaths.map(p => `:(exclude)${p}`)).stdout
  return {
    gitHead: git('rev-parse', 'HEAD').stdout.toString().trim(),
    diffBinaryHeadSha256: crypto.createHash('sha256').update(diff).digest('hex'),
    diffBytes: diff.length,
    excludedFromDiff: excludePaths,
    untrackedFiles: git('ls-files', '--others', '--exclude-standard').stdout.toString().split('\n').filter(Boolean),
  }
}

// A provider call is complete only with normalized input, wire input and raw output under one callId.
export function captureCompleteness(dir) {
  if (!fs.existsSync(dir)) return { records: 0, calls: 0, callsComplete: 0, subflows: {}, incompleteCalls: [], recordsWithoutCallId: 0 }
  const records = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  const byCall = new Map()
  for (const r of records) {
    if (!r.callId) continue
    const entry = byCall.get(r.callId) || { subflow: r.subflow, stages: new Set() }
    entry.stages.add(r.stage); byCall.set(r.callId, entry)
  }
  const complete = e => ['normalized', 'wire', 'output'].every(stage => e.stages.has(stage))
  const calls = [...byCall.values()]
  return {
    records: records.length, calls: calls.length, callsComplete: calls.filter(complete).length,
    subflows: calls.reduce((acc, c) => ({ ...acc, [c.subflow]: (acc[c.subflow] || 0) + 1 }), {}),
    incompleteCalls: [...byCall.entries()].filter(([, c]) => !complete(c)).map(([id, c]) => ({ callId: id, subflow: c.subflow, stages: [...c.stages] })),
    recordsWithoutCallId: records.filter(r => !r.callId).length,
  }
}

// Every value the owner approved, compared with the live state. Returns the list of mismatches (empty = sealed).
export function verifySealedState({ sealed, source, snapshotDir, cellKeys = [], cells = null }) {
  const mismatches = []
  if (!sealed?.source || !sealed?.snapshot) return ['pre-registration is not sealed (sealed.source / sealed.snapshot missing)']
  if (source.gitHead !== sealed.source.gitHead) mismatches.push(`gitHead differs: sealed ${sealed.source.gitHead}, live ${source.gitHead}`)
  if (source.diffBinaryHeadSha256 !== sealed.source.diffBinaryHeadSha256) mismatches.push(`diffBinaryHeadSha256 differs (a tracked file changed, staged or unstaged): sealed ${sealed.source.diffBinaryHeadSha256}, live ${source.diffBinaryHeadSha256}`)
  if (source.untrackedFiles.length) mismatches.push(`untracked files present: ${source.untrackedFiles.join(', ')}`)
  const live = snapshotHashes(snapshotDir)
  for (const f of DB_FILES) if (live[f] !== sealed.snapshot[f]) mismatches.push(`snapshot ${f} differs: sealed ${sealed.snapshot[f]}, live ${live[f]}`)
  for (const key of cellKeys) if (!/^[0-9a-f]{64}$/.test(String(cells?.[key]?.requestIdentitySha256 || ''))) mismatches.push(`cell ${key} has no sealed request identity`)
  return mismatches
}

// Paid runs need the owner's explicit approval of THIS pre-registration by hash, and the live source, snapshot
// and per-cell request identities must equal the sealed values. Throws before any child or provider call.
export function assertLiveApproved({ mode, args, preregSha256, prereg, source, snapshotDir, contract, cellKeys }) {
  if (mode !== 'live') return
  const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
  if (!args.includes('--approved')) throw new Error('Refusing paid calls: --mode live requires --approved.')
  if (value('--approved-prereg-sha') !== preregSha256) throw new Error(`Refusing paid calls: --approved-prereg-sha must equal the pre-registration sha256 ${preregSha256}.`)
  const mismatches = verifySealedState({ sealed: prereg.sealed, source, snapshotDir, cellKeys, cells: prereg.sealed?.cells?.[contract] })
  if (mismatches.length) throw new Error(`Refusing paid calls: live state does not match the sealed pre-registration:\n- ${mismatches.join('\n- ')}`)
}

export function unifiedDiff(aText, bText, aLabel, bLabel, workDir) {
  fs.mkdirSync(workDir, { recursive: true })
  const a = path.join(workDir, 'a.txt'), b = path.join(workDir, 'b.txt')
  fs.writeFileSync(a, aText); fs.writeFileSync(b, bText)
  const out = spawnSync('diff', ['-u', '--label', aLabel, '--label', bLabel, a, b], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout
  fs.rmSync(a); fs.rmSync(b)
  return out
}
