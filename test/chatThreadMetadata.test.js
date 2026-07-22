import test from 'node:test'
import assert from 'node:assert/strict'
import { compactChatThreadMemory } from '../lib/chatThreadMetadata.js'

test('chat thread list memory keeps rail fields and drops full outfit payloads', () => {
  const compact = compactChatThreadMemory({
    memorySource: 'whole_wardrobe',
    stylingContext: JSON.stringify({
      occasion: 'smart-casual',
      activity: 'walking',
      season: 'warm',
      mood: 'relaxed',
      request: 'city outfits',
      resolvedWeather: { forecast: 'large unused object' }
    }),
    latestOutfits: JSON.stringify([{
      title: 'City Walk',
      label: 'Everyday City',
      bestFor: 'walking',
      previewOnly: true,
      pieces: [{ id: 1, embeddedPayload: 'large unused object' }]
    }])
  })

  assert.deepEqual(compact, {
    source: 'whole_wardrobe',
    stylingContext: {
      occasion: 'smart-casual',
      activity: 'walking',
      season: 'warm',
      mood: 'relaxed',
      request: 'city outfits'
    },
    latestOutfits: [{
      title: 'City Walk',
      label: 'Everyday City',
      bestFor: 'walking',
      previewOnly: true
    }]
  })
  assert.ok(!JSON.stringify(compact).includes('large unused object'))
})

test('chat thread list memory tolerates missing and malformed JSON fields', () => {
  assert.equal(compactChatThreadMemory({}), null)
  assert.deepEqual(compactChatThreadMemory({
    memorySource: 'saved_outfit_formula',
    stylingContext: '{bad json',
    latestOutfits: 'not json'
  }), { source: 'saved_outfit_formula' })
})
