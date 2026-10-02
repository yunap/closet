// Stage 2 live guard (docs/stage1-cause-matrix-2026-09-14.md §4). A paid run must refuse, before any child
// process or provider request, when the live source (git HEAD, staged or unstaged tracked-file changes, untracked
// files) or the frozen snapshot differs from the values sealed in the pre-registration.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { sourceState, snapshotHashes, verifySealedState, sha256File, DB_FILES } from '../scratch/ab_stage2_common.mjs'

const REPO = process.cwd()

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-guard-repo-'))
  const git = (...args) => { const r = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr) }
  git('init', '-q')
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'original\n')
  git('add', 'tracked.txt'); git('commit', '-q', '-m', 'init')
  return { dir, git }
}

function tempSnapshot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-guard-snapshot-'))
  for (const f of DB_FILES) fs.writeFileSync(path.join(dir, f), `frozen ${f}\n`)
  return dir
}

test('LIVE GUARD: sealed state passes; a changed tracked file (unstaged or staged), a changed snapshot file, an untracked file or an unsealed cell each refuse', () => {
  const { dir, git } = tempRepo()
  const snap = tempSnapshot()
  const s0 = sourceState(dir)
  const sealed = { source: { gitHead: s0.gitHead, diffBinaryHeadSha256: s0.diffBinaryHeadSha256 }, snapshot: snapshotHashes(snap) }
  const cells = { 'r1:S1:B0': { requestIdentitySha256: 'a'.repeat(64) } }
  const check = (cellKeys = ['r1:S1:B0']) => verifySealedState({ sealed, source: sourceState(dir), snapshotDir: snap, cellKeys, cells })
  assert.deepEqual(check(), [])

  fs.appendFileSync(path.join(dir, 'tracked.txt'), 'edited after approval\n')
  assert.ok(check().some(m => m.startsWith('diffBinaryHeadSha256 differs')), 'unstaged tracked edit refuses')
  git('add', 'tracked.txt')
  assert.ok(check().some(m => m.startsWith('diffBinaryHeadSha256 differs')), 'staged tracked edit refuses')
  git('reset', '-q', 'HEAD', 'tracked.txt'); git('checkout', '-q', '--', 'tracked.txt')
  assert.deepEqual(check(), [])

  const original = fs.readFileSync(path.join(snap, 'wardrobe.db'))
  fs.appendFileSync(path.join(snap, 'wardrobe.db'), 'changed')
  assert.ok(check().some(m => m.startsWith('snapshot wardrobe.db differs')), 'changed snapshot refuses')
  fs.writeFileSync(path.join(snap, 'wardrobe.db'), original)
  assert.deepEqual(check(), [])

  fs.writeFileSync(path.join(dir, 'new.txt'), 'untracked\n')
  assert.ok(check().some(m => m.startsWith('untracked files present')), 'untracked file refuses')
  fs.rmSync(path.join(dir, 'new.txt'))

  assert.ok(check(['r1:S1:B0', 'r1:S1:B1']).some(m => m === 'cell r1:S1:B1 has no sealed request identity'), 'unsealed cell refuses')
  assert.deepEqual(verifySealedState({ sealed: {}, source: sourceState(dir), snapshotDir: snap }), ['pre-registration is not sealed (sealed.source / sealed.snapshot missing)'])
})

// Harness level: the live runners exit before creating any attempt directory (so before any child process and
// any provider request) when the snapshot or the tracked-file diff does not match the sealed pre-registration.
test('LIVE GUARD: both live harnesses refuse before any attempt when the snapshot or tracked source differs from the sealed pre-registration', () => {
  const real = JSON.parse(fs.readFileSync(path.join(REPO, 'scratch', 'ab_stage2_preregistration.json'), 'utf8'))
  const snap = tempSnapshot()
  const source = sourceState(REPO)
  const allCells = contract => Object.fromEntries(real.contracts[contract].executionOrder.map(key => [key, { requestIdentitySha256: 'a'.repeat(64) }]))
  const sealedPrereg = overrides => {
    const prereg = { ...real, sealed: { source: { gitHead: source.gitHead, diffBinaryHeadSha256: source.diffBinaryHeadSha256 }, snapshot: snapshotHashes(snap), cells: { A: allCells('A'), B: allCells('B'), C: allCells('C') }, ...overrides } }
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-guard-prereg-')), 'prereg.json')
    fs.writeFileSync(file, JSON.stringify(prereg))
    return file
  }
  const run = (script, extra, preregFile) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-guard-out-'))
    const env = { ...process.env, WARDROBE_STAGE2_PREREG_PATH: preregFile }
    delete env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK
    const r = spawnSync(process.execPath, [path.join(REPO, 'scratch', script), ...extra, '--snapshot', snap, '--out', out, '--mode', 'live', '--approved', '--approved-prereg-sha', sha256File(preregFile)], { cwd: REPO, env, encoding: 'utf8', timeout: 60000 })
    const attemptDirs = fs.existsSync(out) ? fs.readdirSync(out).filter(name => fs.statSync(path.join(out, name)).isDirectory()) : []
    return { status: r.status, stderr: r.stderr, attemptDirs }
  }
  for (const [script, extra] of [['ab_stage2_composer_only.mjs', ['--contract', 'B']], ['ab_stage2_construction_probe.mjs', []]]) {
    const wrongSource = run(script, extra, sealedPrereg({ source: { gitHead: source.gitHead, diffBinaryHeadSha256: '0'.repeat(64) } }))
    assert.equal(wrongSource.status, 2, `${script}: ${wrongSource.stderr}`)
    assert.match(wrongSource.stderr, /diffBinaryHeadSha256 differs/)
    assert.deepEqual(wrongSource.attemptDirs, [], `${script}: no attempt started`)

    const preregFile = sealedPrereg({})
    fs.appendFileSync(path.join(snap, 'system.db'), 'changed after sealing')
    const wrongSnapshot = run(script, extra, preregFile)
    assert.equal(wrongSnapshot.status, 2, `${script}: ${wrongSnapshot.stderr}`)
    assert.match(wrongSnapshot.stderr, /snapshot system\.db differs/)
    assert.deepEqual(wrongSnapshot.attemptDirs, [], `${script}: no attempt started`)
    fs.writeFileSync(path.join(snap, 'system.db'), 'frozen system.db\n')

    // An approval hash that does not name this exact pre-registration refuses too.
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-guard-out-'))
    const env = { ...process.env, WARDROBE_STAGE2_PREREG_PATH: preregFile }
    delete env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK
    const wrongApproval = spawnSync(process.execPath, [path.join(REPO, 'scratch', script), ...extra, '--snapshot', snap, '--out', out, '--mode', 'live', '--approved', '--approved-prereg-sha', 'b'.repeat(64)], { cwd: REPO, env, encoding: 'utf8', timeout: 60000 })
    assert.equal(wrongApproval.status, 2)
    assert.match(wrongApproval.stderr, /--approved-prereg-sha must equal/)
    assert.deepEqual(fs.readdirSync(out).filter(name => fs.statSync(path.join(out, name)).isDirectory()), [], `${script}: no attempt started`)
  }
})
