import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  COLOR_NAMES,
  COLOR_TAXONOMY,
  colorFamilies,
  colorTaggerInstruction,
  colorTaxonomyEntry,
  colorsArePaletteNeutral,
  unknownColorNames,
} from '../lib/colorTaxonomy.js'
import { buildPrompts } from '../styling-engine/prompts.js'

test('color taxonomy has unique canonical names and complete derived properties', () => {
  assert.equal(new Set(COLOR_NAMES).size, COLOR_NAMES.length)
  for (const color of COLOR_TAXONOMY) {
    assert.match(color.name, /^[a-z]+(?: [a-z]+)*$/)
    assert.ok(color.hex)
    assert.notEqual(color.family, 'unknown')
    assert.ok(['neutral', 'neutral-adjacent', 'accent', 'metallic', 'multi'].includes(color.neutrality))
  }
})

test('owner-ratified color classifications are pinned', () => {
  assert.deepEqual(colorTaxonomyEntry('silver'), {
    name: 'silver', hex: '#A8A9AD', family: 'metallic', neutrality: 'metallic',
  })
  assert.equal(colorTaxonomyEntry('gold').neutrality, 'metallic')
  assert.deepEqual(
    [colorTaxonomyEntry('burgundy').family, colorTaxonomyEntry('burgundy').neutrality],
    ['red', 'accent'],
  )
  assert.equal(colorTaxonomyEntry('sage').neutrality, 'neutral-adjacent')
  assert.equal(colorTaxonomyEntry('olive').neutrality, 'neutral-adjacent')
  assert.equal(COLOR_NAMES.includes('periwinkle'), false)
  assert.deepEqual(colorFamilies(['black', 'white', 'grey']), ['black', 'white', 'grey'])
})

test('unknown values are explicit and never earn the palette-neutral classification', () => {
  assert.equal(colorTaxonomyEntry('chartreuse').family, 'unknown')
  assert.deepEqual(unknownColorNames(['navy', ' Chartreuse ', 'chartreuse']), ['chartreuse'])
  assert.equal(colorsArePaletteNeutral(['navy', 'white']), true)
  assert.equal(colorsArePaletteNeutral(['olive', 'sage']), true)
  assert.equal(colorsArePaletteNeutral(['navy', 'chartreuse']), false)
  assert.equal(colorsArePaletteNeutral([]), false)
})

test('all tagger prompts derive their color vocabulary from the taxonomy', () => {
  const instruction = colorTaggerInstruction()
  assert.ok(buildPrompts().TAG_PIECE_PROMPT.includes(`"colors": ["${instruction}"]`))

  for (const path of ['styling-engine/prompts.js', 'routes/ai.js']) {
    const source = fs.readFileSync(path, 'utf8')
    assert.ok(source.includes('colorTaggerInstruction()'), `${path} must derive the prompt enum`)
    assert.equal(source.includes('"colors": ["only from: black,'), false, `${path} retains a copied color enum`)
  }
})
