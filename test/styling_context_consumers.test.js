import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const routeSource = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
const toolSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/tools.js'), 'utf8')
const plannerSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitSetPlanner.js'), 'utf8')
const rulesSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/rules.js'), 'utf8')
const validationSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitValidation.js'), 'utf8')

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

test('selected and whole visual composers delegate finite-pool eligibility to one authority', () => {
  const selected = sourceBlock(
    'async function composeSelectedPieceVisualWardrobeOutfits',
    "router.post('/evaluate-piece'",
  )
  const whole = sourceBlock(
    'export async function generateWholeWardrobeOutfitsVisualInternal',
    "router.post('/generate-wardrobe-outfits-visual'",
  )
  assert.match(selected, /evaluateVisualComposerPiecePool\(\{/)
  assert.match(selected, /recoveryEligibleIds/)
  assert.doesNotMatch(selected, /buildVisualComposerRoster\(/)
  assert.match(whole, /evaluateVisualComposerPiecePool\(\{/)
  assert.doesNotMatch(whole, /buildVisualComposerRoster\(/)
})

test('freeform search, proposal, and slot swaps consume shared automatic-use eligibility', () => {
  assert.match(toolSource, /evaluateAutomaticUsePiecePool\(\{/)
  assert.doesNotMatch(toolSource, /wholeWardrobePieceTrustDecision\(/)
})

test('selected ranking and whole generation consume shared automatic-use pool adapters', () => {
  const selected = sourceBlock(
    'export async function generateOutfitsForPieceInternal',
    "router.post('/generate-outfits-for-piece'",
  )
  const whole = sourceBlock(
    'export async function generateWholeWardrobeOutfitsVisualInternal',
    "router.post('/generate-wardrobe-outfits-visual'",
  )
  assert.match(selected, /selectAutomaticUseCandidatesForOutfitGeneration\(\{/)
  assert.doesNotMatch(selected, /selectCandidatesForOutfitGeneration\(/)
  assert.match(whole, /evaluateAutomaticUsePiecePool\(\{/)
  assert.doesNotMatch(whole, /filterWholeWardrobePiecesForGeneration\(/)
})

test('plan workbenches and capsule eligibility consume the shared automatic-use pool', () => {
  assert.match(plannerSource, /evaluateAutomaticUsePiecePool\(\{/)
  assert.doesNotMatch(plannerSource, /filterWholeWardrobePiecesForGeneration\(/)
})

test('whole-wardrobe footwear recovery consumes the shared automatic-use pool core', () => {
  const start = rulesSource.indexOf('export function repairWholeWardrobeOutfit')
  const end = rulesSource.indexOf('export function wholeWardrobeDiversitySelectionScore', start)
  assert.ok(start >= 0 && end > start, 'missing repairWholeWardrobeOutfit source block')
  const repair = rulesSource.slice(start, end)
  assert.match(repair, /evaluateAutomaticUsePiecePoolCore\(\{/)
  assert.doesNotMatch(repair, /filterWholeWardrobePiecesForGeneration\(/)
})

test('category structure boolean and diagnosis delegate to one typed validator', () => {
  const start = rulesSource.indexOf('export function isOutfitStructurallyValid')
  const end = rulesSource.indexOf('export function normalizeWholeWardrobeStrengths', start)
  assert.ok(start >= 0 && end > start, 'missing isOutfitStructurallyValid source block')
  assert.match(rulesSource.slice(start, end), /evaluateOutfitStructure\(/)
  assert.match(plannerSource, /import \{ describeOutfitStructureGap, evaluateOutfitStructure \} from '\.\/outfitValidation\.js'/)
  assert.doesNotMatch(plannerSource, /function describeOutfitStructureGap\(/)
  assert.match(validationSource, /export function evaluateOutfitStructure\(/)
  assert.match(validationSource, /export function describeOutfitStructureGap\(/)
})

test('whole-wardrobe and submitted-plan gates consume typed structure findings directly', () => {
  const wholeStart = rulesSource.indexOf('export function locallyGateWholeWardrobeOutfits')
  const wholeEnd = rulesSource.indexOf('export function buildOutfitMechanicsReason', wholeStart)
  assert.ok(wholeStart >= 0 && wholeEnd > wholeStart, 'missing locallyGateWholeWardrobeOutfits source block')
  const whole = rulesSource.slice(wholeStart, wholeEnd)
  assert.match(whole, /evaluateOutfitStructure\(pieces, \{ requireShoes \}\)/)
  assert.doesNotMatch(whole, /isOutfitStructurallyValid\(/)

  const planStart = plannerSource.indexOf('export function validateSubmittedPlanOutfits')
  const planEnd = plannerSource.indexOf('export function assembleSubmittedPlanOutfits', planStart)
  assert.ok(planStart >= 0 && planEnd > planStart, 'missing validateSubmittedPlanOutfits source block')
  const plan = plannerSource.slice(planStart, planEnd)
  assert.match(plan, /evaluateOutfitStructure\(pieces, \{ requireShoes: true \}\)/)
  assert.doesNotMatch(plan, /isOutfitStructurallyValid\(/)
  assert.doesNotMatch(plan, /describeOutfitStructureGap\(/)
})

test('route-level structure filters reuse typed findings and contain no category recount', () => {
  assert.match(routeSource, /import \{ evaluateOutfitStructure \} from '\.\.\/styling-engine\/outfitValidation\.js'/)
  assert.doesNotMatch(routeSource, /isOutfitStructurallyValid\(/)
  const whole = sourceBlock(
    'export async function generateWholeWardrobeOutfitsVisualInternal',
    "router.post('/generate-wardrobe-outfits-visual'",
  )
  assert.match(whole, /const structureByOutfit = new Map\(/)
  assert.match(whole, /structureByOutfit\.get\(outfit\)\.valid/)
  assert.doesNotMatch(whole, /const structuralRejectionReason = \(outfit\)/)
})
