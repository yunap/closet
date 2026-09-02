// Tagging source attribution + Batch Add hardening (2026-08-23 follow-up spec). Phase 1
// (caller attribution) is exercised end to end in test/ai_call_telemetry.test.js against the
// real instrumented SDK transport; these tests cover the server-side vocabulary/validation and
// the frontend/route wiring via source inspection, matching this repo's existing convention for
// BatchAdd/PieceForm (see test/batchAdd.test.js) rather than full component rendering.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { KNOWN_TAGGER_SOURCES, normalizeTaggerSource } from '../lib/aiCallTelemetry.js'

const batchAddSource = fs.readFileSync(path.join(process.cwd(), 'src/components/BatchAdd.jsx'), 'utf8')
const pieceFormSource = fs.readFileSync(path.join(process.cwd(), 'src/components/PieceForm.jsx'), 'utf8')
const routeAiSource = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')

test('closed vocabulary is exactly piece_form_add and batch_add', () => {
  assert.deepEqual([...KNOWN_TAGGER_SOURCES].sort(), ['batch_add', 'piece_form_add'])
})

test('normalizeTaggerSource: known values pass through', () => {
  assert.equal(normalizeTaggerSource('piece_form_add'), 'piece_form_add')
  assert.equal(normalizeTaggerSource('batch_add'), 'batch_add')
})

test('normalizeTaggerSource: missing/empty stays safe and backward-compatible', () => {
  assert.equal(normalizeTaggerSource(undefined), '')
  assert.equal(normalizeTaggerSource(null), '')
  assert.equal(normalizeTaggerSource(''), '')
})

test('normalizeTaggerSource: arbitrary client strings cannot pollute telemetry', () => {
  assert.equal(normalizeTaggerSource('tag_piece_existing'), 'unknown')
  assert.equal(normalizeTaggerSource('piece_form_add; DROP TABLE ai_call_log'), 'unknown')
  assert.equal(normalizeTaggerSource('  '), '')
  assert.equal(normalizeTaggerSource('PIECE_FORM_ADD'), 'unknown') // case-sensitive, not fuzzy-matched
})

test('1. PieceForm Add sends X-Tagger-Source: piece_form_add on the plain (non-edit) /tag-piece call', () => {
  assert.match(
    pieceFormSource,
    /fetch\('\/api\/ai\/tag-piece', \{ method: 'POST', headers: \{ 'X-Tagger-Source': 'piece_form_add' \}, body: fd \}\)/
  )
})

test('2. Batch Add sends X-Tagger-Source: batch_add on its /tag-piece call', () => {
  assert.match(
    batchAddSource,
    /fetch\('\/api\/ai\/tag-piece', \{ method: 'POST', headers: \{ 'X-Tagger-Source': 'batch_add' \}, body: fd \}\)/
  )
})

test('3. /tag-piece stages a normalized tagger source before the provider call fires', () => {
  const handlerStart = routeAiSource.indexOf("router.post('/tag-piece', upload.fields([")
  assert.ok(handlerStart >= 0)
  const handlerSection = routeAiSource.slice(handlerStart, handlerStart + 1200)
  assert.match(handlerSection, /updateAiTelemetryContext\(\{ taggerSource: normalizeTaggerSource\(req\.headers\['x-tagger-source'\]\) \}\)/)
  // tag-piece-existing/:id is deliberately NOT part of this vocabulary (already separately
  // attributable via flow=tag_piece_existing) — confirm this route doesn't set taggerSource.
  const existingHandlerStart = routeAiSource.indexOf('const tagExistingHandler = async')
  const existingHandlerSection = routeAiSource.slice(existingHandlerStart, existingHandlerStart + 1500)
  assert.doesNotMatch(existingHandlerSection, /taggerSource/)
})

test('4/5. server validates against the known list rather than trusting arbitrary client text', () => {
  assert.match(routeAiSource, /import \{ updateAiTelemetryContext, backfillFreeformRunId, normalizeTaggerSource, getAiTelemetryContext, runWithAiTelemetryContext \} from '\.\.\/lib\/aiCallTelemetry\.js'/)
})

test('tagPieceWithProvider re-establishes its telemetry snapshot directly around the provider call', () => {
  // Bounded by the function's real end rather than a fixed character window: a 6000-char slice
  // silently stopped covering the assertion when a comment above the provider call grew (the
  // 2026-09-02 maxTokens raise). A window that shrinks as comments grow tests the comments, not
  // the code.
  const fnStart = routeAiSource.indexOf('export async function tagPieceWithProvider(')
  const nextTopLevel = routeAiSource.indexOf('\nexport ', fnStart + 1)
  const fnSection = routeAiSource.slice(fnStart, nextTopLevel === -1 ? undefined : nextTopLevel)
  assert.match(fnSection, /const telemetrySnapshot = \{ \.\.\.getAiTelemetryContext\(\) \}/)
  assert.match(fnSection, /await runWithAiTelemetryContext\(telemetrySnapshot, \(\) => askStylistWithUsage\(payload\)\)/)
})

test('6. Batch Add no longer allows post-tag photo-role swapping in Review', () => {
  const reviewPhaseStart = batchAddSource.indexOf('function ReviewPhase(')
  const reviewPhaseEnd = batchAddSource.indexOf('\nfunction ', reviewPhaseStart + 1)
  const reviewPhaseSection = batchAddSource.slice(reviewPhaseStart, reviewPhaseEnd)
  assert.doesNotMatch(reviewPhaseSection, /onSwap/)
  assert.doesNotMatch(reviewPhaseSection, /Swap Hanger/)
  assert.doesNotMatch(batchAddSource, /onSwap=\{\(\) => handleSwapPhotos\(current\)\}/)
})

test('optional pre-tag swap lives in Grouping, before Analyze', () => {
  const groupingPhaseStart = batchAddSource.indexOf('function GroupingPhase(')
  const groupingPhaseEnd = batchAddSource.indexOf('\nfunction ', groupingPhaseStart + 1)
  const groupingPhaseSection = batchAddSource.slice(groupingPhaseStart, groupingPhaseEnd)
  assert.match(groupingPhaseSection, /onSwap\(item\.id\)/)
  assert.match(batchAddSource, /const handleSwapGrouped = \(itemId\) => \{/)
  // No new AI/classification call introduced to power the swap — plain local state swap only.
  const swapFnStart = batchAddSource.indexOf('const handleSwapGrouped = (itemId) => {')
  const swapFnSection = batchAddSource.slice(swapFnStart, swapFnStart + 400)
  assert.doesNotMatch(swapFnSection, /fetch\(/)
})

test('7. pre-tag grouping still sends primary photo as photo, paired photo as worn_photo', () => {
  const startProcessingIdx = batchAddSource.indexOf('const startProcessing = async () => {')
  const startProcessingSection = batchAddSource.slice(startProcessingIdx, startProcessingIdx + 900)
  assert.match(startProcessingSection, /fd\.append\('photo', updated\[i\]\.file\)/)
  assert.match(startProcessingSection, /fd\.append\('worn_photo', updated\[i\]\.wornFile\)/)
})

test('8. no additional AI calls are introduced by the attribution/swap changes', () => {
  // Exactly one /tag-piece POST per component (unchanged call count from before this work).
  assert.equal((batchAddSource.match(/fetch\('\/api\/ai\/tag-piece'/g) || []).length, 1)
  assert.equal((pieceFormSource.match(/fetch\('\/api\/ai\/tag-piece'/g) || []).length, 1)
})

test('9. Batch Add remains sequential (serial for-loop, not concurrent)', () => {
  const startProcessingIdx = batchAddSource.indexOf('const startProcessing = async () => {')
  const startProcessingSection = batchAddSource.slice(startProcessingIdx, startProcessingIdx + 1500)
  assert.match(startProcessingSection, /for \(let i = 0; i < updated\.length; i\+\+\) \{/)
  assert.match(startProcessingSection, /await fetch\('\/api\/ai\/tag-piece'/)
  assert.doesNotMatch(startProcessingSection, /Promise\.all/)
})

test('10. saving reviewed tags/fields is otherwise unchanged', () => {
  assert.match(batchAddSource, /const handleSave = async \(\) => \{/)
  assert.match(batchAddSource, /fd\.append\('photo', item\.file\)/)
  assert.match(batchAddSource, /fd\.append\('worn_photo', item\.wornFile\)/)
})
