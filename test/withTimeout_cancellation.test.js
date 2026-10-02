// thread_1789546295700 (2026-09-16, owner review): the previous `withTimeout(promise, ms)` accepted
// an already-in-flight promise, so a losing timeout never signalled anything — the underlying call
// kept running, unobserved, for as long as it liked (one incident: ~500s past a 120s "timeout").
// These tests exercise the real timer/race logic with short, real delays (no mocked provider) to
// prove the structural fix: the operation is a function that receives an AbortSignal created BEFORE
// it is ever called, the signal is aborted exactly when the timeout wins, a genuine (non-timeout)
// operation error is never misclassified, and an abandoned operation's later settlement can never
// surface as an unhandled promise rejection.
process.env.NODE_ENV = 'test'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// styling-engine/core.js transitively reaches db.js — isolate before importing anything, per this
// repo's hermeticity guard, even though these tests never touch the database.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-withtimeout-'))
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { withTimeout } = await import('../styling-engine/core.js')

test('withTimeout calls the operation with a real AbortSignal, not an already-created promise', async () => {
  let receivedSignal = null
  const operation = signal => {
    receivedSignal = signal
    return Promise.resolve('ok')
  }
  const result = await withTimeout(operation, 200, 'quick op')
  assert.equal(result, 'ok')
  assert.ok(receivedSignal instanceof AbortSignal, 'the operation must receive a real AbortSignal argument')
  assert.equal(receivedSignal.aborted, false, 'a call that finished before the deadline must not be aborted')
})

test('withTimeout aborts the operation\'s own signal exactly when the timeout wins the race', async () => {
  let receivedSignal = null
  let sawAbortEvent = false
  const slowOperation = signal => {
    receivedSignal = signal
    signal.addEventListener('abort', () => { sawAbortEvent = true })
    return new Promise(resolve => setTimeout(() => resolve('late result'), 150))
  }
  await assert.rejects(
    withTimeout(slowOperation, 20, 'slow op'),
    err => {
      assert.equal(err.isTimeout, true, 'a timeout must be classified distinctly via isTimeout')
      assert.equal(err.timeoutLabel, 'slow op')
      assert.equal(err.timeoutMs, 20)
      assert.match(err.message, /slow op timed out after 20ms/)
      return true
    }
  )
  assert.ok(receivedSignal instanceof AbortSignal)
  assert.equal(receivedSignal.aborted, true, 'the signal must be aborted once the timeout has won')
  assert.equal(sawAbortEvent, true, 'the abort must actually fire as an event the operation can react to, not just a flag')
  // Let the abandoned operation's own 150ms timer finish so it does not leak into a later test.
  await new Promise(resolve => setTimeout(resolve, 180))
})

test('withTimeout does not misclassify a genuine operation error as a timeout', async () => {
  const failingOperation = () => Promise.reject(new Error('provider exploded'))
  await assert.rejects(withTimeout(failingOperation, 200, 'op'), err => {
    assert.equal(err.message, 'provider exploded')
    assert.equal(err.isTimeout, undefined, 'a real operation failure must not carry the timeout flag')
    return true
  })
})

test('withTimeout never lets an abandoned operation\'s late rejection become an unhandled promise rejection', async () => {
  let unhandled = null
  const onUnhandled = err => { unhandled = err }
  process.on('unhandledRejection', onUnhandled)
  try {
    const slowFailingOperation = () => new Promise((_, reject) => {
      setTimeout(() => reject(new Error('late provider failure, after the app already gave up')), 60)
    })
    await assert.rejects(withTimeout(slowFailingOperation, 15, 'op'), err => {
      assert.equal(err.isTimeout, true)
      return true
    })
    // Give the abandoned operation's own timer time to fire its late rejection.
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(unhandled, null, `the late rejection must never surface as unhandled; got: ${unhandled?.message}`)
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
  }
})
