// Chat turn progress (owner, 2026-11-04: "just showing '...' to the user is not good enough").
// Server: lib/turnProgress.js. Client: src/utils/askStream.js, src/utils/turnProgressCopy.js.
import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import express from 'express'

// The telemetry store opens db.js; never the live database (docs/database-safety.md).
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-turn-progress-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))

const { runWithAiTelemetryContext } = await import('../lib/aiCallTelemetry.js')
const { startTurnProgressStream, reportTurnProgress } = await import('../lib/turnProgress.js')
const { postAskWithProgress } = await import('../src/utils/askStream.js')
const { understoodChips, stepText, reduceTurnProgress, initialTurnProgress } = await import('../src/utils/turnProgressCopy.js')

async function withServer(handler, fn) {
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => runWithAiTelemetryContext({ originalUrl: req.originalUrl }, next))
  app.post('/api/ai/ask', handler)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

// Like /ask: a step reported deep inside awaited work, then an ordinary res.status().json() exit.
const askLike = async (req, res) => {
  startTurnProgressStream(req, res)
  await new Promise(resolve => setTimeout(resolve, 5))
  reportTurnProgress('understood', { profile: 'bounded_multi', setting: 'indoor_only' })
  await (async () => { reportTurnProgress('tool', { tool: 'generate_outfits', count: 3 }) })()
  if (req.body.fail) return res.status(429).json({ error: 'busy' })
  res.json({ answer: 'Here are three options.' })
}

test('with the header, the route streams progress lines and ends with its own response as the last line', async () => {
  await withServer(askLike, async base => {
    const response = await fetch(`${base}/api/ai/ask`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-stylist-progress': 'ndjson' }, body: '{}' })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/)
    const lines = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(lines, [
      { type: 'progress', stage: 'understood', profile: 'bounded_multi', setting: 'indoor_only' },
      { type: 'progress', stage: 'tool', tool: 'generate_outfits', count: 3 },
      { type: 'result', status: 200, body: { answer: 'Here are three options.' } },
    ])
    const failed = await fetch(`${base}/api/ai/ask`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-stylist-progress': 'ndjson' }, body: '{"fail":true}' })
    const last = JSON.parse((await failed.text()).trim().split('\n').at(-1))
    assert.deepEqual(last, { type: 'result', status: 429, body: { error: 'busy' } }, 'an error exit keeps its status inside the stream')
  })
})

test('without the header, the same route answers with ordinary JSON and reporting is a no-op', async () => {
  await withServer(askLike, async base => {
    const response = await fetch(`${base}/api/ai/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.deepEqual(await response.json(), { answer: 'Here are three options.' })
  })
  assert.doesNotThrow(() => reportTurnProgress('tool', { tool: 'search_wardrobe' }), 'outside any request it does nothing')
})

test('the client reader delivers progress as it arrives and returns a fetch-like result, including lines split across chunks', async () => {
  await withServer(askLike, async base => {
    const events = []
    let started = 0
    const res = await postAskWithProgress({ question: 'x' }, {
      onStart: () => { started += 1 },
      onProgress: event => events.push(event.stage),
      fetchImpl: (url, init) => fetch(`${base}${url}`, init),
    })
    assert.equal(started, 1)
    assert.deepEqual(events, ['understood', 'tool'])
    assert.equal(res.ok, true)
    assert.deepEqual(await res.json(), { answer: 'Here are three options.' })
    const failed = await postAskWithProgress({ fail: true }, { fetchImpl: (url, init) => fetch(`${base}${url}`, init) })
    assert.equal(failed.ok, false)
    assert.equal(failed.status, 429)
    assert.deepEqual(await failed.json(), { error: 'busy' })
  })

  const text = '{"type":"progress","stage":"tool","tool":"view_pieces","count":9}\n{"type":"result","status":200,"body":{"answer":"ok"}}\n'
  const chunks = [text.slice(0, 17), text.slice(17, 70), text.slice(70)].map(part => new TextEncoder().encode(part))
  const fakeResponse = () => ({
    headers: { get: () => 'application/x-ndjson; charset=utf-8' },
    body: new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close() } }),
  })
  const seen = []
  const res = await postAskWithProgress({}, { fetchImpl: async () => fakeResponse(), onProgress: event => seen.push(event) })
  assert.deepEqual(seen, [{ type: 'progress', stage: 'tool', tool: 'view_pieces', count: 9 }])
  assert.deepEqual(await res.json(), { answer: 'ok' })

  const truncated = () => ({ headers: { get: () => 'application/x-ndjson' }, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text.split('\n')[0] + '\n')); c.close() } }) })
  await assert.rejects(postAskWithProgress({}, { fetchImpl: async () => truncated() }), /stopped before finishing/)

  const plain = { ok: true, headers: { get: () => 'application/json' }, body: {}, json: async () => ({ answer: 'plain' }) }
  assert.equal(await postAskWithProgress({}, { fetchImpl: async () => plain }), plain, 'an ordinary JSON answer passes straight through')
})

test('the router reading becomes short chips, only for turns that build outfits', () => {
  const now = new Date('2026-11-04T10:00:00')
  // thread_1793852510241's own reading.
  assert.deepEqual(
    understoodChips({ profile: 'bounded_multi', limit: 3, occasion: 'casual', setting: 'indoor_only', date: '2026-11-07', timeOfDay: '' }, { now }),
    ['At home', 'Saturday', 'Casual', 'A few options'])
  assert.deepEqual(
    understoodChips({ profile: 'single_outfit', occasion: 'evening', setting: 'includes_outdoors', location: 'Berkeley, CA', date: '2026-11-05', timeOfDay: 'evening', activity: 'walking' }, { now }),
    ['Berkeley, CA', 'Tomorrow', 'Evening out', 'Walking', 'One outfit'])
  assert.deepEqual(understoodChips({ profile: 'trip_plan', date: '2026-12-20' }, { now }), ['Dec 20', 'Trip plan'])
  assert.deepEqual(understoodChips({ profile: 'garment_fact', occasion: 'casual' }, { now }), [], 'a question about a garment shows no reading')
  assert.deepEqual(understoodChips({ profile: 'single_outfit', occasion: 'casual', asking: true }, { now }), [], 'nor does a turn that will ask a question first')
})

test('steps are worded from facts, and tools not worth naming are skipped', () => {
  assert.equal(stepText({ stage: 'tool', tool: 'search_wardrobe', categories: ['top', 'bottom', 'shoes', 'outerwear'] }), 'Looking through your tops, bottoms, shoes and layers')
  assert.equal(stepText({ stage: 'tool', tool: 'search_wardrobe' }), 'Looking through your wardrobe')
  assert.equal(stepText({ stage: 'tool', tool: 'view_pieces', count: 1 }), 'Looking closely at 1 piece')
  assert.equal(stepText({ stage: 'tool', tool: 'generate_outfits', count: 3 }), 'Putting together 3 outfits from the photos')
  assert.equal(stepText({ stage: 'layer_repair', count: 2 }), 'Looking for a layer for 2 looks')
  for (const tool of ['declare_intent', 'get_last_outfit_evaluation', 'get_current_image_inventory', 'anything_new']) {
    assert.equal(stepText({ stage: 'tool', tool }), '', tool)
  }
})

test('the hosting thread\'s turn, folded step by step: the failed attempt is said, repeats collapse, and there is no ready line', () => {
  const now = new Date('2026-11-04T10:00:00')
  let state = initialTurnProgress(0)
  assert.equal(state.current, 'Reading your request')
  for (const event of [
    { stage: 'understood', profile: 'bounded_multi', occasion: 'casual', setting: 'indoor_only', date: '2026-11-07' },
    { stage: 'tool', tool: 'generate_outfits', count: 3 },
    { stage: 'attempt_failed', tool: 'generate_outfits' },
    { stage: 'tool', tool: 'declare_intent' },
    { stage: 'tool', tool: 'generate_outfits', count: 3 },
    { stage: 'layer_repair', count: 2 },
  ]) state = reduceTurnProgress(state, event, { now })
  assert.deepEqual(state.chips, ['At home', 'Saturday', 'Casual', 'A few options'])
  assert.deepEqual(state.done, [
    { text: 'Reading your request' },
    { text: "That attempt didn't finish", warn: true },
    { text: 'Putting together 3 outfits from the photos' },
  ])
  assert.equal(state.current, 'Looking for a layer for 2 looks')
  const unchanged = reduceTurnProgress(state, { stage: 'tool', tool: 'declare_intent' })
  assert.equal(unchanged, state, 'a skipped step returns the same state, so nothing re-renders')
  const component = fs.readFileSync(path.join(process.cwd(), 'src/components/TurnProgress.jsx'), 'utf8')
  const rendered = component.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(rendered, /ready/i, 'the outfits arriving says it is done (owner, 2026-11-04)')
})

test('the server reports only plain facts: tool arguments are reduced to counts and categories', async () => {
  const { toolProgressFacts } = await import('../styling-engine/tools.js')
  assert.deepEqual(toolProgressFacts('search_wardrobe', { category: ['top', 'top', 'shoes'], query: 'something private', occasion: 'casual' }), { tool: 'search_wardrobe', categories: ['top', 'shoes'] })
  assert.deepEqual(toolProgressFacts('view_pieces', { ids: [1, 2, 2, 3] }), { tool: 'view_pieces', count: 3 })
  assert.deepEqual(toolProgressFacts('generate_outfits', { limit: 3, stylist_brief: 'long brief' }), { tool: 'generate_outfits', count: 3 })
  assert.deepEqual(toolProgressFacts('propose_outfit', { pieces: [{ id: 1 }], stylist_note: 'text' }), { tool: 'propose_outfit' })

  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const toolsSrc = fs.readFileSync(path.join(process.cwd(), 'styling-engine/tools.js'), 'utf8')
  assert.match(routeSrc, /router\.post\('\/ask', async \(req, res\) => \{\n[^\n]*\n\s*startTurnProgressStream\(req, res\)/, '/ask opens the stream before any exit')
  assert.match(routeSrc, /reportTurnProgress\('understood', \{/)
  assert.match(routeSrc, /reportTurnProgress\('layer_repair', \{ count: repairable\.length \}\)/)
  assert.match(toolsSrc, /reportTurnProgress\('tool', toolProgressFacts\(name, args\)\)/)
  assert.match(toolsSrc, /reportTurnProgress\('attempt_failed', \{ tool: 'generate_outfits' \}\)/)
})
