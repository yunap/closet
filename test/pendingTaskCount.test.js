import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/utils/usePendingWardrobeTaskCount.js', import.meta.url), 'utf8')

test('wardrobe task badges share one published count', () => {
  assert.match(source, /let sharedPendingCount = 0/)
  assert.match(source, /const pendingCountListeners = new Set\(\)/)
  assert.match(source, /pendingCountListeners\.forEach\(listener => listener\(count\)\)/)
  assert.match(source, /pendingCountListeners\.add\(setPendingCount\)/)
  assert.match(source, /pendingCountListeners\.delete\(setPendingCount\)/)
})

test('older task requests cannot overwrite a newer count', () => {
  assert.match(source, /const requestId = \+\+latestRequestId/)
  assert.match(source, /requestId !== latestRequestId/)
})
