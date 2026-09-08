import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSystemAwareWeatherRoster } from '../styling-engine/candidateSet.js'
import { validateUserWeather, resolveWeatherContext } from '../styling-engine/weather.js'

const weather = (high_f, low_f) => ({
  ...resolveWeatherContext({ userWeather: validateUserWeather({ high_f, low_f }) }).temperature,
})

const photo = id => `/tmp/system-roster-${id}.jpg`
const top = (id, overrides = {}) => ({
  id, name: `top ${id}`, category: 'top', photo: photo(id),
  fabric_weight: 'medium', fabric_category: 'cotton', fiber_content: ['cotton'],
  sleeve_length: 'long', sleeve_shape: 'fitted', opacity: 'opaque', fit_on_body: 'skims',
  ...overrides,
})
const bottom = (id, overrides = {}) => ({
  id, name: `bottom ${id}`, category: 'bottom', photo: photo(id),
  fabric_weight: 'medium', fabric_category: 'denim', fiber_content: ['cotton'],
  length_hits_at: 'ankle', ...overrides,
})
const shoe = (id, overrides = {}) => ({
  id, name: `shoe ${id}`, category: 'shoes', photo: photo(id),
  walk_support: 'high', weather_protection: [], ...overrides,
})
const layer = (id, overrides = {}) => ({
  id, name: `layer ${id}`, category: 'outerwear', photo: photo(id),
  fabric_weight: 'heavy', fabric_category: 'leather', fiber_content: ['leather'],
  insulating_layer_materials: [], interior_construction: 'full_lining',
  sleeve_length: 'long', sleeve_shape: 'fitted', length_hits_at: 'hip', opacity: 'opaque',
  ...overrides,
})

test('cold required-layer roster exposes same-label construction choices and one warmer boundary', () => {
  const uninsulated = layer(4, {
    fabric_category: 'wool', fiber_content: ['wool'], neckline: 'mock',
  })
  const insulated = layer(5, {
    fabric_weight: 'medium', fabric_category: 'wool', fiber_content: ['wool'],
    insulating_layer_materials: ['wool batting'],
  })
  const winter = layer(6, {
    insulating_layer_materials: ['down'], interior_construction: 'quilted_lining',
    length_hits_at: 'full_length', neckline: 'mock',
  })
  const pieces = [top(1), bottom(2), shoe(3), uninsulated, insulated, winter]
  const roster = buildSystemAwareWeatherRoster({
    pieces, weatherProfile: weather(60, 48), activity: 'walking', layerRequired: true,
  })

  assert.equal(roster.report.outcome, 'ready')
  assert.deepEqual(roster.eligiblePieceIndex.map(piece => piece.id), pieces.map(piece => piece.id))
  assert.equal(
    roster.eligiblePieceIndex.find(piece => piece.id === 4)?.construction_thermal_degree,
    0.5,
    'the compact roster projects the canonical derived construction evidence, not the stored enum',
  )
  const visibleLayers = roster.visualPieceIds.filter(id => [4, 5, 6].includes(id))
  assert.ok(visibleLayers.includes(4), 'uninsulated construction remains a visible choice')
  assert.ok(visibleLayers.includes(5), 'insulated same-band construction remains a visible choice')
  assert.ok(visibleLayers.includes(6), 'the warmer boundary remains visible without owning the roster')
  assert.ok(roster.systemPaths.every(path => path.wearing_states.warm.removed_piece_id))
  assert.ok(roster.systemPaths.every(path => path.wearing_states.warm.piece_ids.includes(1)))
})

test('wearing-state piece_ids track each path\'s own shoe, not the first-enumerated shoe', () => {
  const winter = layer(6, {
    insulating_layer_materials: ['down'], interior_construction: 'quilted_lining',
    length_hits_at: 'full_length', neckline: 'mock',
  })
  const pieces = [
    top(1), bottom(2),
    shoe(3, { walk_support: 'high' }),
    shoe(30, { walk_support: 'low', weather_protection: ['waterproof'] }),
    winter,
  ]
  const roster = buildSystemAwareWeatherRoster({
    pieces, weatherProfile: weather(60, 48), activity: 'walking', layerRequired: true,
  })

  const pathsWithShoe30 = roster.systemPaths.filter(path => path.piece_ids.includes(30))
  assert.ok(pathsWithShoe30.length > 0, 'roster should enumerate a path using the second shoe')
  for (const path of pathsWithShoe30) {
    assert.ok(!path.piece_ids.includes(3), 'a path should not carry both shoes in piece_ids')
    assert.deepEqual(
      [...path.wearing_states.cold.piece_ids].sort(),
      [...path.piece_ids].sort(),
      'cold wearing-state piece_ids must match this path\'s own shoe, not shoe 3',
    )
    assert.ok(!path.wearing_states.cold.piece_ids.includes(3), 'shoe 3 must not leak into a shoe-30 path')
    assert.ok(!path.wearing_states.warm.piece_ids.includes(3), 'shoe 3 must not leak into warm state either')
  }
})

test('a coat cannot make a light warm-end base feasible, while a remaining layer can', () => {
  const lightBase = top(10, {
    fabric_weight: 'light', fabric_category: 'satin', fiber_content: ['polyester'],
    sleeve_length: 'three_quarter',
  })
  const cardigan = top(11, {
    fabric_weight: 'medium', fabric_category: 'knit', fiber_content: ['wool'],
    insulating_layer_materials: [], needs_base: true,
  })
  const coat = layer(12, {
    insulating_layer_materials: ['down'], interior_construction: 'quilted_lining',
  })

  const stranded = buildSystemAwareWeatherRoster({
    pieces: [lightBase, bottom(13), shoe(14), coat],
    weatherProfile: weather(60, 48), activity: 'walking', layerRequired: true,
  })
  assert.equal(stranded.systemPaths.length, 0)
  assert.equal(stranded.report.outcome, 'known_physical_shortfall')

  const supported = buildSystemAwareWeatherRoster({
    pieces: [lightBase, bottom(13), shoe(14), cardigan, coat],
    weatherProfile: weather(60, 48), activity: 'walking', layerRequired: true,
  })
  assert.ok(supported.systemPaths.some(path =>
    path.piece_ids.includes(cardigan.id) && path.wearing_states.warm.piece_ids.includes(cardigan.id)))
})

test('hot selection evaluates complete systems and does not collapse equivalent warmth labels', () => {
  const pieces = [
    top(20, { fabric_weight: 'ultralight', sleeve_length: 'sleeveless' }),
    top(21, { fabric_weight: 'ultralight', sleeve_length: 'short' }),
    bottom(22, { fabric_weight: 'ultralight', fabric_category: 'linen', fiber_content: ['linen'], length_hits_at: 'full_length' }),
    bottom(23, { fabric_weight: 'ultralight', fabric_category: 'cotton', length_hits_at: 'above_knee' }),
    shoe(24), shoe(25, { walk_support: 'medium' }),
  ]
  const roster = buildSystemAwareWeatherRoster({
    pieces, weatherProfile: weather(95, 85), activity: 'walking', layerRequired: false,
  })

  assert.equal(roster.report.outcome, 'ready')
  assert.equal(roster.systemPaths.length, 4)
  assert.ok(new Set(roster.systemPaths.flatMap(path => path.piece_ids.filter(id => [20, 21].includes(id)))).size > 1)
  assert.ok(new Set(roster.systemPaths.flatMap(path => path.piece_ids.filter(id => [22, 23].includes(id)))).size > 1)
  assert.ok(roster.eligiblePieceIndex.some(piece => piece.id === 22 && piece.length_hits_at === 'full_length'),
    'long coverage stays eligible; the selector contains no short-equals-cool gate')
})

test('unknown thermal evidence is preserved and no weather keeps structural order', () => {
  const unknownLayer = layer(34, {
    fabric_weight: 'medium', fiber_content: ['unknown'],
    insulating_layer_materials: undefined, interior_construction: undefined,
  })
  const unknown = buildSystemAwareWeatherRoster({
    pieces: [top(31), bottom(32), shoe(33), unknownLayer],
    weatherProfile: weather(60, 48), activity: 'walking', layerRequired: true,
  })
  assert.equal(unknown.report.outcome, 'evidence_shortfall')
  assert.equal(unknown.systemPaths[0]?.evidence_state, 'unknown')
  assert.ok(unknown.eligiblePieceIndex.some(piece => piece.id === 34 && piece.insulating_layer === 'unknown'))

  const neutral = buildSystemAwareWeatherRoster({
    pieces: [top(40), top(41), bottom(42), bottom(43), shoe(44), shoe(45)],
    weatherProfile: null, layerRequired: false,
  })
  assert.deepEqual(neutral.systemPaths.map(path => path.piece_ids), [
    [40, 42, 44],
    [40, 42, 45],
    [40, 43, 44],
    [40, 43, 45],
  ])
  assert.ok(neutral.report.selected_paths.every(path =>
    path.reason === 'stable structural order; no resolved thermal demand'))
})

test('the image budget is atomic and reports configuration failure distinctly', () => {
  const roster = buildSystemAwareWeatherRoster({
    pieces: [top(50), bottom(51), shoe(52), layer(53, { insulating_layer_materials: ['down'] })],
    weatherProfile: weather(60, 48), activity: 'walking', layerRequired: true,
    totalImageCap: 3,
  })
  assert.equal(roster.systemPaths.length, 0)
  assert.deepEqual(roster.visualPieceIds, [])
  assert.equal(roster.report.outcome, 'visual_budget_configuration_failure')
})
