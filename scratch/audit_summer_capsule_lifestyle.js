#!/usr/bin/env node

// Structured-data audit of thread_1785272841293's captured summer roster.
// Reports what the saved garment metadata can actually say about the user's
// lived contexts. It does not score taste, call a model, use the network, or
// write to the database.

process.env.NODE_ENV = 'test'

const { db } = await import('../db.js')
const { parsePiece } = await import('../styling-engine/rules.js')
const { wardrobeCategoryGroup } = await import('../styling-engine/attributes.js')
const { OCCASION_VALUES } = await import('../styling-engine/stylingIntent.js')
const { OCCASION_PROFILES } = await import('../styling-engine/occasions.js')

const rosterIds = [
  67, 136, 63, 364, 172, 174, 1, 71, 132, 224, 242, 128,
  93, 101, 261, 92, 97, 151, 110, 262, 169, 214, 199, 194
]
const roster = db.prepare(`SELECT * FROM pieces WHERE status = 'active' AND id IN (${rosterIds.map(() => '?').join(',')})`)
  .all(...rosterIds)
  .map(parsePiece)

function intelligence(piece) {
  return piece?.style_profile_json?.garment_intelligence || {}
}

function confidence(piece, context) {
  return String(intelligence(piece)?.occasion_confidence?.[context] || 'unknown').toLowerCase()
}

function tally(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

const groups = tally(roster.map(wardrobeCategoryGroup))
const formalities = tally(roster.map(piece => String(piece.formality || 'unknown')))
const patterns = tally(roster.map(piece => String(piece.pattern_complexity || 'unknown')))
const contexts = ['home', 'casual', 'city', 'smart-casual', 'evening']
const contextCoverage = Object.fromEntries(contexts.map(context => [
  context,
  tally(roster.map(piece => confidence(piece, context)))
]))
const shoes = roster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')
const walkingShoes = shoes.map(piece => ({
  id: Number(piece.id),
  name: piece.name,
  heel: piece.heel_height || 'unknown',
  support: piece.walk_support || 'unknown'
}))
const homeLow = roster
  .filter(piece => confidence(piece, 'home') === 'low')
  .map(piece => ({ id: Number(piece.id), name: piece.name, group: wardrobeCategoryGroup(piece) }))
const homeKnownPositive = roster
  .filter(piece => ['high', 'medium'].includes(confidence(piece, 'home')))
  .map(piece => ({ id: Number(piece.id), name: piece.name, confidence: confidence(piece, 'home') }))
const homeProfileExists = OCCASION_PROFILES.some(profile => profile.id === 'home_loungewear')
const homePlannerValueExists = OCCASION_VALUES.includes('home') || OCCASION_VALUES.includes('home_loungewear')

const report = {
  providerCalls: 0,
  networkCalls: 0,
  rosterSize: roster.length,
  categoryBalance: groups,
  formalityRange: formalities,
  patternRange: patterns,
  contextConfidence: contextCoverage,
  walkingShoes,
  homeRepresentation: {
    frozenProfileExists: homeProfileExists,
    plannerVocabularyCanNameIt: homePlannerValueExists,
    knownPositivePieces: homeKnownPositive,
    lowConfidencePieces: homeLow
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('summer capsule lifestyle audit — structured data only')
  console.log('provider calls: 0; network calls: 0; database writes: 0')
  console.log(`roster: ${report.rosterSize}`)
  console.log(`categories: ${JSON.stringify(report.categoryBalance)}`)
  console.log(`formalities: ${JSON.stringify(report.formalityRange)}`)
  console.log(`patterns: ${JSON.stringify(report.patternRange)}`)
  for (const context of contexts) {
    console.log(`${context} confidence: ${JSON.stringify(report.contextConfidence[context])}`)
  }
  console.log(`walking shoes: ${walkingShoes.map(shoe => `${shoe.id}:${shoe.name} [${shoe.heel}/${shoe.support}]`).join(' | ')}`)
  console.log(`home profile exists: ${homeProfileExists}; planner can name home: ${homePlannerValueExists}`)
  console.log(`known home-positive roster pieces: ${homeKnownPositive.length}`)
  console.log(`known home-low roster pieces: ${homeLow.length}`)
  for (const piece of homeLow) console.log(`- home low: ${piece.id}:${piece.name} [${piece.group}]`)
}

if (roster.length !== rosterIds.length || !homeProfileExists) process.exitCode = 1

db.close()
