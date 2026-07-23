import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const cssSource = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('reference card actions do not change card height on hover', () => {
  const actionsRule = cssSource.match(/\.visual-reference-actions\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  const hoverRule = cssSource.match(/\.visual-reference-card:hover \.visual-reference-actions,[\s\S]*?\{([\s\S]*?)\n\}/)?.[1] || ''

  assert.match(actionsRule, /min-height:\s*30px/)
  assert.match(actionsRule, /visibility:\s*hidden/)
  assert.doesNotMatch(actionsRule, /max-height/)
  assert.doesNotMatch(hoverRule, /max-height|padding/)
})
