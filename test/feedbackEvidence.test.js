import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFeedbackEvidence } from '../lib/feedbackEvidence.js'
import { activeMemoryMetadata } from '../lib/activeMemory.js'

test('wrong-choice feedback stores explicit subject, context, source, scope, and authority without styling inference', () => {
  const feedbackEvidence = buildFeedbackEvidence({
    feedbackType: 'wrong_item_read',
    targetType: 'whole_wardrobe_outfit',
    contextType: 'wardrobe',
    contextName: 'Whole wardrobe',
    sourceSurface: 'stylist_chat',
    payload: {
      threadId: 'thread_123',
      messageIndex: 4,
      outfitIndex: 9,
      pieceId: 177,
      pieceName: 'neutral ribbed knit cardigan',
      pieceCategory: 'outerwear',
      outfit: { label: 'Restaurants / Social Events', silhouette: 'model-owned description' },
      occasion: 'smart casual',
      activity: 'none',
      weatherContext: 'Foggy, windy coastal walk with light rain',
      explicitReason: 'Canvas absorbs water in wet, foggy weather.',
    },
  })

  assert.deepEqual(feedbackEvidence.subject, {
    type: 'garment', pieceId: 177, name: 'neutral ribbed knit cardigan', category: 'outerwear',
  })
  assert.deepEqual(feedbackEvidence.source, {
    surface: 'stylist_chat', threadId: 'thread_123', messageIndex: 4, outfitIndex: 9,
    targetType: 'whole_wardrobe_outfit',
  })
  assert.equal(feedbackEvidence.context.outfitLabel, 'Restaurants / Social Events')
  assert.equal(feedbackEvidence.context.weather, 'Foggy, windy coastal walk with light rain')
  assert.equal(feedbackEvidence.explicitReason, 'Canvas absorbs water in wet, foggy weather.')
  assert.equal(feedbackEvidence.scope, 'outfit_context')
  assert.equal(feedbackEvidence.authority, 'weak_contextual')
  assert.equal('silhouette' in feedbackEvidence, false, 'the app must not promote model styling interpretation into canonical evidence')
})

test('active-memory display uses the evidence envelope instead of raw storage labels', () => {
  const feedbackEvidence = buildFeedbackEvidence({
    feedbackType: 'wrong_item_read',
    targetType: 'whole_wardrobe_outfit',
    payload: {
      pieceId: 177,
      pieceName: 'neutral ribbed knit cardigan',
      outfit: { label: 'Restaurants / Social Events' },
      occasion: 'smart casual',
      weatherContext: 'Heavy rain',
      explicitReason: 'Canvas will get soaked.',
    },
  })
  const memory = activeMemoryMetadata({
    feedback_type: 'wrong_item_read',
    target_type: 'whole_wardrobe_outfit',
    context_name: 'Whole wardrobe',
    label: 'Bad piece: neutral ribbed knit cardigan',
    note: 'neutral ribbed knit cardigan was the bad piece choice.',
    payload: {
      feedbackEvidence,
      scopedEvidence: {
        version: 1,
        kind: 'garment_context_suitability',
        subjectPieceId: 177,
        context: { occasion: 'smart casual', activity: 'none' },
      },
    },
  })

  assert.deepEqual(memory.display, {
    title: 'neutral ribbed knit cardigan',
    context: 'Wrong choice for Restaurants / Social Events',
    summary: 'Canvas will get soaked.',
  })
})

test('feedback evidence preserves the literal source surface and does not invent chat provenance', () => {
  const boardEvidence = buildFeedbackEvidence({
    feedbackType: 'wrong_item_read',
    targetType: 'whole_wardrobe_outfit',
    sourceSurface: 'generated_board',
    payload: { pieceId: 177, pieceName: 'neutral cardigan' },
  })
  const unknownEvidence = buildFeedbackEvidence({
    feedbackType: 'wrong_item_read',
    targetType: 'whole_wardrobe_outfit',
    payload: { pieceId: 177, pieceName: 'neutral cardigan' },
  })

  assert.equal(boardEvidence.source.surface, 'generated_board')
  assert.equal(unknownEvidence.source.surface, 'unknown')
})
