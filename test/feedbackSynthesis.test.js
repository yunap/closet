import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFeedbackSynthesisPreview,
  compactSynthesisEvidenceRow,
  FEEDBACK_SYNTHESIS_SYSTEM,
  feedbackSynthesisCall,
  sanitizeSynthesisApplicability,
  structuredRequestInputTokenUpperBound,
} from '../lib/feedbackSynthesis.js'
import { installMockAiHandler } from '../styling-engine/mockAiHandler.js'

const row = (id, reason = 'canvas is unsuitable in wet fog') => ({
  id,
  payload: JSON.stringify({
    feedbackEvidence: {
      version: 2,
      action: 'wrong_piece_for_outfit',
      subject: { pieceId: 44, name: 'Canvas sneakers', category: 'shoes' },
      context: {
        outfitLabel: 'Fog walk', occasion: 'casual', activity: 'walking',
        season: 'cool summer', weather: 'wet and foggy',
      },
      explicitReason: reason || null,
    },
    outfit: {
      pieces: [
        { id: 44, name: 'Canvas sneakers', category: 'shoes', notes: 'large field intentionally omitted' },
        { id: 12, name: 'Bishop-sleeve top', category: 'top', sleeve_type: 'bishop', fit_on_body: 'drapes' },
      ],
    },
  }),
})

const positiveRow = (id, verdict = 'works') => ({
  id,
  feedback_type: verdict,
  payload: JSON.stringify({
    scopedEvidence: {
      version: 1,
      kind: 'outfit_logic',
      verdict,
      logic: {
        formula: 'compact top + flowing bottom',
        silhouette: 'defined upper half with movement below',
        direction: 'artistic city',
        mood: 'quietly expressive',
      },
      context: { occasion: 'city', activity: 'walking', season: 'summer' },
    },
    outfit: { pieces: [{ id: 999, name: 'Literal garment must stay out' }] },
  }),
})

const legacyPositiveRow = (id, verdict = 'works') => ({
  id,
  feedback_type: verdict,
  payload: JSON.stringify({
    scopedEvidence: {
      version: 1,
      kind: 'legacy_outfit_snapshot',
      verdict,
      sourceConfidence: 'legacy_generated_description',
      snapshot: {
        title: 'Urban balance',
        explanation: 'A compact upper half balances a long relaxed base.',
        pieces: [
          { category: 'top', fit_on_body: 'fitted', reads_as: 'compact' },
          { category: 'bottom', fit_on_body: 'relaxed', reads_as: 'long line' },
        ],
      },
      context: { occasion: 'city', activity: 'walking', season: 'summer' },
    },
  }),
})

test('synthesis preview compacts evidence without copying complete garment payloads', () => {
  const compact = compactSynthesisEvidenceRow(row(404))
  assert.equal(compact.evidenceId, 404)
  assert.equal(compact.ownerReason, 'canvas is unsuitable in wet fog')
  assert.deepEqual(compact.outfit.otherPieces, [{
    id: 12,
    name: 'Bishop-sleeve top',
    category: 'top',
    sleeveType: 'bishop',
    fit: 'drapes',
    fabric: '',
    readsAs: '',
    silhouette: '',
    length: '',
  }])
  assert.equal(JSON.stringify(compact).includes('large field intentionally omitted'), false)
})

test('evidence season resolves the composer\'s unresolved "current season" placeholder against the reaction\'s own created_at, not "now"', () => {
  const unresolvedRow = {
    id: 900,
    created_at: '2026-01-15 10:00:00', // winter
    payload: JSON.stringify({
      feedbackEvidence: {
        version: 2,
        action: 'wrong_piece_for_outfit',
        subject: { pieceId: 44, name: 'Canvas sneakers', category: 'shoes' },
        context: { occasion: 'casual', activity: 'walking', season: 'current season', weather: 'wet' },
        explicitReason: 'canvas is unsuitable in wet fog',
      },
    }),
  }
  const compact = compactSynthesisEvidenceRow(unresolvedRow)
  assert.equal(compact.context.season, 'winter')

  const summerRow = { ...unresolvedRow, id: 901, created_at: '2026-07-15 10:00:00' }
  assert.equal(compactSynthesisEvidenceRow(summerRow).context.season, 'summer')

  // A term the model proposes as "summer" must actually validate against evidence recorded as the
  // literal placeholder — otherwise the resolved evidence and the sanitizer would silently disagree
  // and a correctly-scoped applicability term would be dropped as "unsupported" on every edit.
  const sanitized = sanitizeSynthesisApplicability(
    { scope: 'context', piece_ids: [], occasions: [], activities: [], seasons: ['summer'], weather_terms: [] },
    [compactSynthesisEvidenceRow(summerRow)],
  )
  assert.deepEqual(sanitized.seasons, ['summer'])

  // The 'warm' and 'autumn' aliases resolve the same way ownerConstraints.js already resolves them
  // for firm-rule matching — one shared vocabulary, not two independently-maintained ones.
  const warmRow = { ...unresolvedRow, id: 902 }
  warmRow.payload = warmRow.payload.replace('"current season"', '"warm"')
  assert.equal(compactSynthesisEvidenceRow(warmRow).context.season, 'summer')
  const autumnRow = { ...unresolvedRow, id: 903 }
  autumnRow.payload = autumnRow.payload.replace('"current season"', '"autumn"')
  assert.equal(compactSynthesisEvidenceRow(autumnRow).context.season, 'fall')
})

test('preview is deterministic, bounded, and estimates cost inputs without a provider call', async () => {
  const first = await buildFeedbackSynthesisPreview([row(404), row(405, '')], { provider: 'openai', model: 'test-model' })
  const second = await buildFeedbackSynthesisPreview([row(404), row(405, '')], { provider: 'openai', model: 'test-model' })
  assert.equal(first.inputHash, second.inputHash)
  assert.deepEqual(first.feedbackIds, [404])
  assert.ok(first.estimatedInputTokens > 0)
  assert.ok(first.estimatedOutputTokens > 0)
  assert.equal(first.outputTokenCap, first.estimatedOutputTokens)
  assert.equal(first.evidence.length, 1, 'reasonless evidence is not eligible for a paid synthesis call')
  assert.equal(
    first.estimatedInputTokens,
    structuredRequestInputTokenUpperBound(feedbackSynthesisCall(first.compactInput, first.outputTokenCap)),
    'the preview bounds the exact system, evidence, schema and tool metadata sent by the route',
  )
  assert.ok(first.estimatedInputTokens > Buffer.byteLength(first.compactInput), 'the bound includes more than user evidence')
})

test('preview bounds owner prose as well as the number of evidence rows', async () => {
  const preview = await buildFeedbackSynthesisPreview([row(404, 'x'.repeat(4000))], { provider: 'openai', model: 'test-model' })
  assert.equal(preview.evidence[0].ownerReason.length, 500)
  assert.ok(preview.compactInput.length < 2400)
})

test('positive synthesis compacts transferable outfit logic without literal garments', () => {
  const compact = compactSynthesisEvidenceRow(positiveRow(501))
  assert.equal(compact.evidenceKind, 'positive_outfit_logic')
  assert.equal(compact.verdict, 'works')
  assert.equal(compact.logic.formula, 'compact top + flowing bottom')
  assert.equal(compact.context.occasion, 'city')
  assert.doesNotMatch(JSON.stringify(compact), /999|Literal garment/)
})

test('positive and Almost structured logic remain compactable but are excluded from paid preview while reinforcement is unresolved', async () => {
  const preview = await buildFeedbackSynthesisPreview([
    positiveRow(501, 'works'),
    positiveRow(502, 'almost'),
    { id: 503, feedback_type: 'works', payload: '{}' },
  ], { provider: 'openai', model: 'test-model' })
  assert.deepEqual(preview.feedbackIds, [])
  assert.deepEqual(preview.evidence, [])
})

test('legacy positive board compacts generated clues without garment identity', () => {
  const compact = compactSynthesisEvidenceRow(legacyPositiveRow(504))
  assert.equal(compact.evidenceKind, 'legacy_positive_board')
  assert.equal(compact.sourceConfidence, 'legacy_generated_description')
  assert.equal(compact.generatedDescription.explanation, 'A compact upper half balances a long relaxed base.')
  assert.deepEqual(compact.anonymousPieces.map(piece => piece.category), ['top', 'bottom'])
  assert.doesNotMatch(JSON.stringify(compact), /pieceId|name|Literal/)
})

test('legacy positive board is excluded from paid preview while positive learning is paused', async () => {
  const preview = await buildFeedbackSynthesisPreview([legacyPositiveRow(504)], { provider: 'openai', model: 'test-model' })
  assert.deepEqual(preview.feedbackIds, [])
  assert.deepEqual(preview.evidence, [])
})

test('legacy generated explanation may support an exact context boundary without becoming owner prose', () => {
  const evidence = [compactSynthesisEvidenceRow({
    ...legacyPositiveRow(504),
    payload: JSON.stringify({
      scopedEvidence: {
        version: 1,
        kind: 'legacy_outfit_snapshot',
        verdict: 'works',
        snapshot: { title: 'Nice Dinners', explanation: 'This is polished for a nice dinner.', pieces: [] },
        context: { occasion: '', activity: 'none', season: '' },
      },
    }),
  })]
  const applicability = sanitizeSynthesisApplicability({
    scope: 'context', piece_ids: [], occasions: ['dinner', 'office'],
  }, evidence)
  assert.deepEqual(applicability?.occasions, ['dinner'])
  assert.deepEqual(applicability?.piece_ids, [])
})

test('synthesis contract separates general model failures from personal memory', () => {
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /For negative evidence, generic physical, practical, or styling knowledge is general_styling_failure/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /Do not derive a cause that is neither stated by the owner nor visible in a photo/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /Do not turn the model's own styling mistake into an owner preference/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /absorbent canvas footwear selected for credible wet exposure/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /fitted narrow-sleeved layer proposed over a long voluminous sleeve/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /physical incompatibility between two otherwise-correct garments is not a garment fact/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /Never copy, reward or recommend the literal garments/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /reasonless "almost".*cannot become a positive rule/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /legacy_positive_board.*lower-confidence clues/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /owner-specific, non-obvious choice/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /a relaxed top with a structured bottom looks cohesive/)
  assert.match(FEEDBACK_SYNTHESIS_SYSTEM, /positive evidence that merely confirms ordinary styling knowledge, use insufficient_evidence/)
})

test('synthesis applicability keeps only piece IDs and context terms supported by the evidence', () => {
  const evidence = [compactSynthesisEvidenceRow(row(404))]
  const applicability = sanitizeSynthesisApplicability({
    scope: 'piece_context',
    piece_ids: [44, 12, 999],
    occasions: ['casual', 'opera'],
    activities: ['walking'],
    seasons: ['summer', 'winter'],
    weather_terms: ['wet', 'snow'],
  }, evidence)
  assert.deepEqual(applicability, {
    version: 1,
    scope: 'piece_context',
    piece_ids: [44, 12],
    occasions: ['casual'],
    activities: ['walking'],
    seasons: ['summer'],
    weather_terms: ['wet'],
  })
})

test('synthesis applicability preserves a valid owner-selected scope', () => {
  const evidence = [{
    subject: { id: 44 },
    outfit: { otherPieces: [] },
    context: { season: 'summer', occasion: '', activity: '', weather: '' },
    ownerReason: 'These are fall shoes, not summer shoes.',
  }]
  const contextOnly = sanitizeSynthesisApplicability({
    scope: 'context', piece_ids: [44], seasons: ['summer'],
  }, evidence)
  assert.equal(contextOnly.scope, 'context')
  const pieceOnly = sanitizeSynthesisApplicability({
    scope: 'piece', piece_ids: [44], seasons: ['summer'],
  }, evidence)
  assert.equal(pieceOnly.scope, 'piece')
  const combined = sanitizeSynthesisApplicability({
    scope: 'piece_context', piece_ids: [44], seasons: ['summer'],
  }, evidence)
  assert.equal(combined.scope, 'piece_context')
})

test('sandbox synthesis returns structured review drafts without a provider call', () => {
  const previous = globalThis.__WARDROBE_AI_TEST_HANDLER__
  try {
    installMockAiHandler({})
    const response = globalThis.__WARDROBE_AI_TEST_HANDLER__({
      system: 'You are a constrained feedback-memory editor.',
      messages: [{
        role: 'user',
        content: JSON.stringify({ evidence: [{ evidenceId: 44, ownerReason: 'Canvas absorbs rain.' }] }),
      }],
    })
    assert.equal(response.results.length, 1)
    assert.deepEqual(response.results[0].source_feedback_ids, [44])
    assert.equal(response.results[0].disposition, 'general_styling_failure')
    assert.match(response.results[0].rationale, /no billed AI call/i)
  } finally {
    if (previous) globalThis.__WARDROBE_AI_TEST_HANDLER__ = previous
    else delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})
