import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  ACCENT_COLOR_NAMES,
  COLOR_NAMES,
  COLOR_TAXONOMY,
  colorFamilyLabel,
  colorFamilies,
  colorTaggerInstruction,
  colorTaxonomyEntry,
  colorsArePaletteNeutral,
  unknownColorNames,
  partitionCanonicalColors,
  sanitizeTaggerColors,
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
  assert.deepEqual(
    ['cognac', 'chocolate'].map(name => [colorTaxonomyEntry(name).family, colorTaxonomyEntry(name).neutrality]),
    [['brown', 'neutral-adjacent'], ['brown', 'neutral-adjacent']],
  )
  assert.deepEqual(
    ['peach', 'terracotta'].map(name => [colorTaxonomyEntry(name).family, colorTaxonomyEntry(name).neutrality]),
    [['orange', 'accent'], ['orange', 'accent']],
  )
  assert.deepEqual(
    [colorTaxonomyEntry('emerald').family, colorTaxonomyEntry('emerald').neutrality],
    ['green', 'accent'],
  )
  assert.equal(COLOR_NAMES.includes('mint'), false)
  assert.equal(COLOR_NAMES.includes('periwinkle'), false)
  assert.deepEqual(colorFamilies(['black', 'white', 'grey']), ['black', 'white', 'grey'])
  assert.equal(ACCENT_COLOR_NAMES.includes('burgundy'), true)
  assert.equal(ACCENT_COLOR_NAMES.includes('olive'), false)
  assert.equal(ACCENT_COLOR_NAMES.includes('sage'), false)
  assert.equal(ACCENT_COLOR_NAMES.includes('silver'), false)
  assert.equal(colorTaxonomyEntry('fuchsia').family, 'pink')
  assert.equal(colorTaxonomyEntry('teal').family, 'cyan')
  assert.equal(colorTaxonomyEntry('mustard').family, 'yellow')
  assert.equal(colorFamilyLabel('cyan'), 'Teal & turquoise')
})

test('unknown values are explicit and never earn the palette-neutral classification', () => {
  assert.equal(colorTaxonomyEntry('chartreuse').family, 'unknown')
  assert.deepEqual(unknownColorNames(['navy', ' Chartreuse ', 'chartreuse']), ['chartreuse'])
  assert.equal(colorsArePaletteNeutral(['navy', 'white']), true)
  assert.equal(colorsArePaletteNeutral(['olive', 'sage']), true)
  assert.equal(colorsArePaletteNeutral(['navy', 'chartreuse']), false)
  assert.equal(colorsArePaletteNeutral([]), false)
})

test('tagger colors are partitioned at the canonical taxonomy boundary', () => {
  assert.deepEqual(partitionCanonicalColors([' Peach ', 'mint', 'MINT', 'emerald']), {
    canonical: ['peach', 'emerald'],
    unknown: ['mint'],
  })
})

test('unsupported-only retags preserve existing colors while new-piece tags become empty', () => {
  assert.deepEqual(sanitizeTaggerColors({ colors: ['mint'] }).tags, {
    colors: [], color_taxonomy_gaps: ['mint'],
  })
  assert.deepEqual(sanitizeTaggerColors({ colors: ['mint'] }, { preserveExisting: true }).tags, {
    color_taxonomy_gaps: ['mint'],
  })
  assert.deepEqual(sanitizeTaggerColors({ colors: ['peach', 'mint'] }, { preserveExisting: true }).tags, {
    colors: ['peach'], color_taxonomy_gaps: ['mint'],
  })
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

test('mission focal-color scoring derives from taxonomy accents', () => {
  const source = fs.readFileSync('styling-engine/rules.js', 'utf8')
  assert.ok(source.includes("import { ACCENT_COLOR_NAMES } from '../lib/colorTaxonomy.js'"))
  assert.ok(source.includes('const MISSION_FOCAL_COLORS = ACCENT_COLOR_NAMES'))
  assert.equal(source.includes("const MISSION_FOCAL_COLORS = ['"), false)
  for (const deadColor of ['fuchsia', 'magenta', 'chartreuse', 'violet', 'ochre']) {
    assert.equal(ACCENT_COLOR_NAMES.includes(deadColor), false)
  }
  for (const canonicalAccent of ['peach', 'terracotta', 'emerald']) {
    assert.equal(ACCENT_COLOR_NAMES.includes(canonicalAccent), true)
  }
  for (const versatileBrown of ['cognac', 'chocolate']) {
    assert.equal(ACCENT_COLOR_NAMES.includes(versatileBrown), false)
  }
  const attributes = fs.readFileSync('styling-engine/attributes.js', 'utf8')
  assert.ok(attributes.includes('ACCENT_COLOR_NAMES.join'))
  assert.equal(/\baccentList\b/.test(attributes), false)
})
