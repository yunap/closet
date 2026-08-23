// scratch/openai_persistence_benchmark.mjs
//
// Minimal benchmark to resolve two unknowns left open by
// docs/freeform-openai-persistent-conversation-investigation.md §8:
//
//   A) Does a `conversation`-backed follow-up call re-bill ALL prior turns
//      as input tokens, or can the caller scope what gets billed?
//   B) What is the effective prompt-cache TTL for a plain (non-5.6) GPT-5
//      call -- the ~30-minute tier documented for GPT-5.6+, or something
//      closer to the up-to-24h "extended retention" tier the docs mention
//      for earlier models without saying which applies here?
//
// NOT wired into the app -- standalone, throwaway. Talks to OpenAI via raw
// fetch rather than the `openai` SDK: the installed SDK version (4.104.0)
// has no `client.conversations` resource yet, and raw HTTP avoids a false
// negative from SDK method coverage rather than actual API behavior.
//
// This script makes REAL, BILLED calls to the OpenAI API. It refuses to run
// unless OPENAI_API_KEY is set AND CONFIRM_SPEND=yes is passed, specifically
// so it can't fire by being executed by habit. Estimated cost: $0.06-0.11
// (see the investigation doc and the chat thread that scoped this script).
//
// Test B deliberately waits up to ~40 minutes of wall-clock between calls --
// run it backgrounded (`node scratch/openai_persistence_benchmark.mjs &`)
// rather than blocking a foreground terminal.
//
// Every raw provider response is saved verbatim -- not just this script's
// interpretation of it -- to scratch/openai_persistence_benchmark_output/,
// so the actual `usage` object (and its exact field names, which this
// script does not assume) can be inspected by hand. The console log lines
// below print raw `usage` objects for the same reason: so a human reading
// the run doesn't have to trust this script's summary of what happened.
//
// Usage:
//   CONFIRM_SPEND=yes npm run bench:openai-persistence
//   -- or, without the npm script --
//   CONFIRM_SPEND=yes node scratch/openai_persistence_benchmark.mjs
//   OPENAI_BENCHMARK_MODEL=gpt-5-mini ... (optional override, default gpt-5)
//
// Reads OPENAI_API_KEY from .env automatically (same convention as
// server.js). CONFIRM_SPEND is deliberately not read from .env -- it must be
// passed on the command line every time, so a real spend is always a
// conscious choice at invocation, not a standing setting.

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_KEY = process.env.OPENAI_API_KEY
const CONFIRMED = process.env.CONFIRM_SPEND === 'yes'
const MODEL = process.env.OPENAI_BENCHMARK_MODEL || 'gpt-5'
const API_BASE = 'https://api.openai.com/v1'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(HERE, 'openai_persistence_benchmark_output')
const RUN_STARTED = new Date().toISOString().replace(/[:.]/g, '-')

// ---------------------------------------------------------------------------
// Shared synthetic payload
// ---------------------------------------------------------------------------

// A deterministic ~2.5-3k token stand-in for Closet's real stable prefix
// (tool schemas + wardrobe manifest + system prompt). Real magnitude isn't
// needed to answer either question -- see the investigation doc's "what
// this minimal version does not settle" -- only a prefix past the ~1,024
// token cache-eligibility floor OpenAI documents.
function buildSyntheticStableContext() {
  const fakeToolSchema = {
    name: 'search_wardrobe',
    description: 'Search the user\'s wardrobe by category, color, formality, season, and fit. Returns matching garment records with id, name, category, color, formality, season tags, and fit notes.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        color: { type: 'string' },
        formality: { type: 'string' },
        season: { type: 'string' }
      }
    }
  }
  const fakePiece = (i) => ({
    id: 1000 + i,
    name: `Synthetic garment ${i}`,
    category: ['top', 'bottom', 'outerwear', 'shoes', 'accessory'][i % 5],
    color: ['navy', 'olive', 'charcoal', 'cream', 'burgundy'][i % 5],
    formality: ['casual', 'smart_casual', 'business', 'formal'][i % 4],
    season: ['spring', 'summer', 'fall', 'winter'][i % 4],
    notes: 'Placeholder garment record used only to pad this benchmark payload to a realistic token count; not a real wardrobe item.'
  })
  const tools = Array.from({ length: 6 }, (_, i) => ({ ...fakeToolSchema, name: `${fakeToolSchema.name}_${i}` }))
  const manifest = Array.from({ length: 60 }, (_, i) => fakePiece(i))
  const systemProse = `You are a benchmark stand-in for a wardrobe stylist assistant. You are not
being asked to give real styling advice in this run -- every question in this benchmark is a
trivial placeholder used only to exercise token accounting. Answer every question in one short
sentence and do not elaborate.`
  return [
    systemProse,
    'TOOLS AVAILABLE (synthetic):',
    JSON.stringify(tools, null, 2),
    'WARDROBE MANIFEST (synthetic):',
    JSON.stringify(manifest, null, 2)
  ].join('\n\n')
}

const STABLE_CONTEXT = buildSyntheticStableContext()

// ---------------------------------------------------------------------------
// Provider calls -- raw fetch, not the SDK, so every field OpenAI actually
// returns is preserved untouched for inspection.
// ---------------------------------------------------------------------------

async function callResponses(body) {
  const startedAt = Date.now()
  const res = await fetch(`${API_BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  const elapsedMs = Date.now() - startedAt
  if (!res.ok) {
    throw new Error(`OpenAI /responses ${res.status}: ${JSON.stringify(json)}`)
  }
  return { raw: json, httpStatus: res.status, elapsedMs }
}

async function createConversation() {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`OpenAI /conversations ${res.status}: ${JSON.stringify(json)}`)
  }
  return json
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

function saveRaw(name, data) {
  ensureOutDir()
  const file = path.join(OUT_DIR, `${RUN_STARTED}__${name}.json`)
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  return file
}

// ---------------------------------------------------------------------------
// Test A -- billing-scope test
//
// One `conversation`, 5 short follow-up turns, with the same stable
// instructions resent every turn -- mirroring Closet's own stated design
// principle that wardrobe/tool facts are supplied fresh each turn, never
// trusted from provider memory. Records the raw `usage` object from every
// turn verbatim.
//
// How to read the saved output (not decided by this script):
//   - If turn 5's usage.input_tokens approaches the sum of everything sent
//     across turns 1-4 (stable context + each prior question/answer), the
//     provider is re-billing full prior history on every call.
//   - If it stays close to just (stable context + this turn's new
//     question), the provider is scoping the bill to what was explicitly
//     sent and the conversation object is closer to free bookkeeping.
//   - Whatever cached-token field the response actually contains (name and
//     shape unverified ahead of running this) is saved as-is -- read it
//     from the JSON file, don't assume `cached_tokens` is the right key.
// ---------------------------------------------------------------------------

const TEST_A_QUESTIONS = [
  'In one sentence, say the number 1.',
  'In one sentence, say the number 2.',
  'In one sentence, say the number 3.',
  'In one sentence, say the number 4.',
  'In one sentence, say the number 5.'
]

async function runTestA() {
  console.log('\n=== Test A: billing-scope test ===')
  const conversation = await createConversation()
  console.log(`Created conversation ${conversation.id}`)
  const turns = []

  for (let i = 0; i < TEST_A_QUESTIONS.length; i++) {
    const question = TEST_A_QUESTIONS[i]
    const body = {
      model: MODEL,
      conversation: conversation.id,
      instructions: STABLE_CONTEXT,
      input: question,
      max_output_tokens: 50
    }
    const { raw, elapsedMs } = await callResponses(body)
    const record = {
      turnIndex: i,
      question,
      elapsedMs,
      usage: raw.usage, // whole raw usage object, untouched
      responseId: raw.id,
      conversationId: raw.conversation?.id ?? conversation.id
    }
    turns.push(record)
    console.log(`Turn ${i}: usage =`, JSON.stringify(raw.usage))
  }

  const file = saveRaw('test_a_billing_scope', { model: MODEL, conversationId: conversation.id, turns })
  console.log(`Test A raw results saved to ${file}`)
  return { conversation, turns }
}

// ---------------------------------------------------------------------------
// Test B -- cache-TTL bracket test
//
// Standalone (no `conversation`) calls, byte-identical instructions+input
// every time, fired at increasing idle gaps from a single warm-up call.
// Records the raw `usage` object at each checkpoint.
//
// How to read the saved output (not decided by this script):
//   - The largest gap that still shows a cache hit (whatever field the
//     response uses for it) and the smallest gap that shows a miss bracket
//     the real TTL for this model tier.
// ---------------------------------------------------------------------------

const TEST_B_GAP_MINUTES = [0, 4, 10, 20, 30, 40]
const TEST_B_QUESTION = 'In one sentence, say the word "checkpoint".'

async function runTestB() {
  console.log('\n=== Test B: cache-TTL bracket test ===')
  const checkpoints = []
  const startedAt = Date.now()

  for (const gapMinutes of TEST_B_GAP_MINUTES) {
    const targetElapsedMs = gapMinutes * 60 * 1000
    const waitMs = targetElapsedMs - (Date.now() - startedAt)
    if (waitMs > 0) {
      console.log(`Waiting ${(waitMs / 1000).toFixed(0)}s to reach the ${gapMinutes}-minute checkpoint...`)
      await sleep(waitMs)
    }
    const body = {
      model: MODEL,
      instructions: STABLE_CONTEXT,
      input: TEST_B_QUESTION,
      max_output_tokens: 50
    }
    const { raw, elapsedMs } = await callResponses(body)
    const record = {
      targetGapMinutes: gapMinutes,
      actualElapsedMs: Date.now() - startedAt,
      requestElapsedMs: elapsedMs,
      usage: raw.usage, // whole raw usage object, untouched
      responseId: raw.id
    }
    checkpoints.push(record)
    console.log(`Checkpoint ${gapMinutes}min: usage =`, JSON.stringify(raw.usage))
  }

  const file = saveRaw('test_b_cache_ttl', { model: MODEL, checkpoints })
  console.log(`Test B raw results saved to ${file}`)
  return { checkpoints }
}

// ---------------------------------------------------------------------------

async function main() {
  if (!API_KEY) {
    console.error('OPENAI_API_KEY is not set. Nothing was called.')
    process.exit(1)
  }
  if (!CONFIRMED) {
    console.error('Refusing to run: this makes real, billed OpenAI API calls.')
    console.error('Re-run with CONFIRM_SPEND=yes to proceed (estimated cost: $0.06-0.11).')
    process.exit(1)
  }

  console.log(`Model: ${MODEL}`)
  console.log(`Stable context size: ${STABLE_CONTEXT.length} chars (~${Math.round(STABLE_CONTEXT.length / 4)} tokens, rough estimate -- read the real usage.input_tokens from the first raw response instead of trusting this estimate)`)
  console.log(`Raw results will be written under ${OUT_DIR}`)

  await runTestA()
  await runTestB()

  console.log('\n=== Done. Raw per-call responses are in scratch/openai_persistence_benchmark_output/ ===')
  console.log('Inspect the saved usage objects directly -- this script prints and saves values but does not decide what they mean.')
}

main().catch(err => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
