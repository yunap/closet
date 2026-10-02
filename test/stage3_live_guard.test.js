// Stage 3 live guard (docs/day-wear-explanation-experiment-2026-09-15.md). The paid day-wear comparison must refuse, before any
// child process or provider request, when the tracked source or the frozen snapshot differs from the sealed pre-registration,
// or when the approval hash does not name this exact pre-registration.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { sourceState, snapshotHashes, sha256File, DB_FILES } from '../scratch/ab_stage2_common.mjs'

const REPO = process.cwd()
const SCRIPT = path.join(REPO, 'scratch', 'ab_stage3_day_wear.mjs')

function tempSnapshot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-guard-snapshot-'))
  for (const f of DB_FILES) fs.writeFileSync(path.join(dir, f), `frozen ${f}\n`)
  return dir
}

test('STAGE 3 LIVE GUARD: the day-wear harness refuses before any attempt on a changed source, a changed snapshot or a wrong approval hash', () => {
  const real = JSON.parse(fs.readFileSync(path.join(REPO, 'scratch', 'ab_stage3_preregistration.json'), 'utf8'))
  assert.equal(real.contracts.D.executionOrder.length, 12, 'the owner-approved scope is the 12-call one-card pilot')
  const snap = tempSnapshot()
  const source = sourceState(REPO, { excludePaths: ['scratch/ab_stage3_preregistration.json'] })
  const cells = Object.fromEntries(real.contracts.D.executionOrder.map(key => [key, { requestIdentitySha256: 'a'.repeat(64) }]))
  const sealedPrereg = overrides => {
    const prereg = { ...real, sealed: { source: { gitHead: source.gitHead, diffBinaryHeadSha256: source.diffBinaryHeadSha256 }, snapshot: snapshotHashes(snap), cells: { D: cells }, ...overrides } }
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-guard-prereg-')), 'prereg.json')
    fs.writeFileSync(file, JSON.stringify(prereg))
    return file
  }
  const run = (preregFile, approvalSha = sha256File(preregFile)) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-guard-out-'))
    const env = { ...process.env, WARDROBE_STAGE3_PREREG_PATH: preregFile }
    delete env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK
    const r = spawnSync(process.execPath, [SCRIPT, '--snapshot', snap, '--out', out, '--mode', 'live', '--approved', '--approved-prereg-sha', approvalSha], { cwd: REPO, env, encoding: 'utf8', timeout: 60000 })
    const attemptDirs = fs.readdirSync(out).filter(name => fs.statSync(path.join(out, name)).isDirectory())
    return { status: r.status, stderr: r.stderr, attemptDirs }
  }

  const wrongSource = run(sealedPrereg({ source: { gitHead: source.gitHead, diffBinaryHeadSha256: '0'.repeat(64) } }))
  assert.equal(wrongSource.status, 2, wrongSource.stderr)
  assert.match(wrongSource.stderr, /diffBinaryHeadSha256 differs/)
  assert.deepEqual(wrongSource.attemptDirs, [], 'no attempt started')

  const preregFile = sealedPrereg({})
  fs.appendFileSync(path.join(snap, 'wardrobe.db'), 'changed after sealing')
  const wrongSnapshot = run(preregFile)
  assert.equal(wrongSnapshot.status, 2, wrongSnapshot.stderr)
  assert.match(wrongSnapshot.stderr, /snapshot wardrobe\.db differs/)
  assert.deepEqual(wrongSnapshot.attemptDirs, [], 'no attempt started')
  fs.writeFileSync(path.join(snap, 'wardrobe.db'), 'frozen wardrobe.db\n')

  const wrongApproval = run(preregFile, 'b'.repeat(64))
  assert.equal(wrongApproval.status, 2)
  assert.match(wrongApproval.stderr, /--approved-prereg-sha must equal/)
  assert.deepEqual(wrongApproval.attemptDirs, [], 'no attempt started')

  const unsealed = run((() => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-guard-prereg-')), 'prereg.json'); fs.writeFileSync(f, JSON.stringify({ ...real, sealed: undefined })); return f })())
  assert.equal(unsealed.status, 2)
  assert.match(unsealed.stderr, /not sealed/)
  assert.deepEqual(unsealed.attemptDirs, [], 'no attempt started')
})
