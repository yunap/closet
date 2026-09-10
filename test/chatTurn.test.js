import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyChatTurn } from '../src/utils/chatTurn.js'

const viennaRequest = 'Give me one complete outfit for an art-gallery evening in Vienna, Austria. I’ll be outside on foot between venues from about 6–10 pm, and the temperature will fall from 60°F to 48°F with a breeze. Include a removable layer that keeps me genuinely warm at 48°F. This is ordinary sightseeing and walking, not exercise.'

test('a fresh request cannot become a correction because its own brief says “this is”', () => {
  assert.equal(classifyChatTurn(viennaRequest, { hasThreadMemory: false }), 'new_request')
})

test('correction language retains its meaning when a prior thread subject exists', () => {
  assert.equal(classifyChatTurn('This is too cold for that coat.', { hasThreadMemory: true }), 'correction')
})

test('ordinary messages with prior thread memory remain follow-ups', () => {
  assert.equal(classifyChatTurn('Could you make it a little more colorful?', { hasThreadMemory: true }), 'followup')
})
