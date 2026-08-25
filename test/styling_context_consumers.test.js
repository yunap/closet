import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const routeSource = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')

function sourceBlock(startNeedle, endNeedle) {
  const start = routeSource.indexOf(startNeedle)
  const end = routeSource.indexOf(endNeedle, start)
  assert.ok(start >= 0, `missing source block start: ${startNeedle}`)
  assert.ok(end > start, `missing source block end: ${endNeedle}`)
  return routeSource.slice(start, end)
}

test('selected-piece composition delegates context resolution and exposes provenance', () => {
  const block = sourceBlock(
    'export async function generateOutfitsForPieceInternal',
    "router.post('/generate-outfits-for-piece'",
  )
  assert.match(block, /await resolveStylingContext\(\{/)
  assert.match(block, /location: location \|\| getHomeLocation\(\)/)
  assert.match(block, /stylingContext: stylingContext\.debug/)
  assert.doesNotMatch(block, /weatherProfileFromContext\(/)
  assert.doesNotMatch(block, /resolveOccasionProfile\(/)
  assert.doesNotMatch(block, /resolveActivityProfile\(/)
})

test('whole-wardrobe composition delegates the same context interface', () => {
  const block = sourceBlock(
    'export async function generateWholeWardrobeOutfitsVisualInternal',
    "router.post('/generate-wardrobe-outfits-visual'",
  )
  assert.match(block, /await resolveStylingContext\(\{/)
  assert.match(block, /location: location \|\| getHomeLocation\(\)/)
  assert.match(block, /stylingContext: stylingContext\.debug/)
  assert.doesNotMatch(block, /weatherProfileFromContext\(/)
  assert.doesNotMatch(block, /resolveOccasionProfile\(/)
  assert.doesNotMatch(block, /resolveActivityProfile\(/)
})

test('retired direct context assemblers cannot return', () => {
  assert.doesNotMatch(routeSource, /resolveWholeWardrobeWeatherProfile/)
  assert.doesNotMatch(routeSource, /resolveDirectVisualComposerWeather/)
  assert.doesNotMatch(routeSource, /getCurrentWeatherProfile/)
})
