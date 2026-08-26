import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const routeSource = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
const toolSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/tools.js'), 'utf8')
const plannerSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitSetPlanner.js'), 'utf8')
const rulesSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/rules.js'), 'utf8')
const validationSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitValidation.js'), 'utf8')
const candidateSetSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/candidateSet.js'), 'utf8')
const recoverySource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/recovery.js'), 'utf8')
const outfitResultSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitResult.js'), 'utf8')
const footwearSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/footwear-comfort.js'), 'utf8')
const attributesSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/attributes.js'), 'utf8')
const coreSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/core.js'), 'utf8')
const promptSource = fs.readFileSync(path.join(process.cwd(), 'styling-engine/prompts.js'), 'utf8')

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

test('freeform and plan composition delegate field precedence to the shared context resolver', () => {
  assert.match(toolSource, /export async function resolveToolStylingContext\(/)
  assert.match(toolSource, /const stylingContext = await resolveToolStylingContext\(\{/)
  assert.doesNotMatch(toolSource, /export async function resolveStatedOrLiveWeather\(/)
  const workbenchStart = plannerSource.indexOf('export async function buildPlanSlotWorkbench')
  const workbench = plannerSource.slice(workbenchStart)
  assert.match(workbench, /const stylingContext = await resolveStylingContext\(\{/)
  assert.match(workbench, /styling_context: slot\.stylingContext/)
})

test('paid visual composition preserves hard-invalid model results as Needs review cards', () => {
  const selected = sourceBlock(
    'async function composeSelectedPieceVisualWardrobeOutfits',
    "router.post('/evaluate-piece'",
  )
  const whole = sourceBlock(
    'export async function generateWholeWardrobeOutfitsVisualInternal',
    "router.post('/generate-wardrobe-outfits-visual'",
  )
  assert.match(selected, /const needsReviewOutfits = selectedModelOutfits/)
  assert.match(selected, /rejectionReason: selectedValidation\.get\(outfit\)\.primaryFinding/)
  assert.match(whole, /const paidRejectedDiagnostics = \[/)
  assert.match(whole, /const readyOutfits = structuredOutfits\.filter\(outfit => !outfit\.broken\)\.slice\(0, requestedLimit\)/)
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

test('retired whole-filter response shape cannot return as an executable API', () => {
  assert.doesNotMatch(rulesSource, /export function filterWholeWardrobePiecesForGeneration/)
  assert.doesNotMatch(rulesSource, /allowedPieces: result\.eligiblePieces/)
  assert.doesNotMatch(toolSource, /filterWholeWardrobePiecesForGeneration/)
  assert.doesNotMatch(plannerSource, /filterWholeWardrobePiecesForGeneration/)
  assert.doesNotMatch(routeSource, /filterWholeWardrobePiecesForGeneration/)
})

test('plan workbenches and capsule eligibility consume the shared automatic-use pool', () => {
  assert.match(plannerSource, /evaluateAutomaticUsePiecePool\(\{/)
  assert.doesNotMatch(plannerSource, /filterWholeWardrobePiecesForGeneration\(/)
})

test('bounded composition consumers share one structural candidate-set owner', () => {
  assert.match(candidateSetSource, /export function buildCoveredCandidateSet\(/)
  assert.match(candidateSetSource, /export function completeOutfitSupplyRequirement\(/)
  assert.match(candidateSetSource, /export function restrictSupplyRequirement\(/)
  assert.match(rulesSource, /buildCoveredCandidateSet\(\{/)
  assert.match(rulesSource, /completeOutfitSupplyRequirement\(\{/)
  assert.match(plannerSource, /buildCoveredCandidateSet\(\{/)
  assert.match(plannerSource, /completeOutfitSupplyRequirement\(\{/)
  assert.match(plannerSource, /restrictSupplyRequirement\(/)
})

test('visual composition stops before its provider call when structural supply is incomplete', () => {
  const selected = sourceBlock(
    'async function composeSelectedPieceVisualWardrobeOutfits',
    "router.post('/evaluate-piece'",
  )
  const whole = sourceBlock(
    'export async function generateWholeWardrobeOutfitsVisualInternal',
    "router.post('/generate-wardrobe-outfits-visual'",
  )
  for (const block of [selected, whole]) {
    const guard = block.indexOf("compositionSkipped: 'incomplete_candidate_supply'")
    const provider = block.indexOf('askStylistWithUsage({')
    assert.ok(guard >= 0 && provider > guard, 'structural shortfall must return before the composer boundary')
  }
})

test('active recovery paths delegate mutations to one validator-enforcing owner', () => {
  assert.match(recoverySource, /export function validatedSubstitute\(/)
  assert.match(recoverySource, /export function validatedComplete\(/)
  assert.match(recoverySource, /export function validatedFallback\(/)
  assert.match(recoverySource, /export function discloseRecoveryShortfall\(/)
  assert.match(coreSource, /validatedFallback\(\{/)
  assert.match(coreSource, /export function validateSelectedRecoveryOutfit\(/)
  assert.match(rulesSource, /validatedSubstitute\(\{/)
  assert.match(footwearSource, /validatedSubstitute\(\{/)
  assert.match(plannerSource, /validatedComplete\(\{/)
  assert.match(plannerSource, /validatedSubstitute\(\{/)
  assert.match(routeSource, /validatedComplete\(\{/)
  assert.match(routeSource, /validatedSubstitute\(\{/)
  assert.match(routeSource, /validatedFallback\(\{/)
  assert.match(toolSource, /validatedSubstitute\(\{/)
})

test('whole-wardrobe footwear recovery consumes the shared automatic-use pool core', () => {
  const start = rulesSource.indexOf('export function repairWholeWardrobeOutfit')
  const end = rulesSource.indexOf('export function wholeWardrobeDiversitySelectionScore', start)
  assert.ok(start >= 0 && end > start, 'missing repairWholeWardrobeOutfit source block')
  const repair = rulesSource.slice(start, end)
  assert.match(repair, /evaluateAutomaticUsePiecePoolCore\(\{/)
  assert.doesNotMatch(repair, /filterWholeWardrobePiecesForGeneration\(/)
})

test('retired category-structure boolean adapter cannot return', () => {
  assert.doesNotMatch(rulesSource, /export function isOutfitStructurallyValid/)
  assert.match(plannerSource, /describeOutfitStructureGap,[\s\S]*evaluateWearableOutfit,[\s\S]*from '\.\/outfitValidation\.js'/)
  assert.doesNotMatch(plannerSource, /function describeOutfitStructureGap\(/)
  assert.match(validationSource, /export function evaluateOutfitStructure\(/)
  assert.match(validationSource, /export function describeOutfitStructureGap\(/)
})

test('whole-wardrobe and submitted-plan gates consume the composed wearable verdict', () => {
  const wholeStart = rulesSource.indexOf('export function locallyGateWholeWardrobeOutfits')
  const wholeEnd = rulesSource.indexOf('export function buildOutfitMechanicsReason', wholeStart)
  assert.ok(wholeStart >= 0 && wholeEnd > wholeStart, 'missing locallyGateWholeWardrobeOutfits source block')
  const whole = rulesSource.slice(wholeStart, wholeEnd)
  assert.match(whole, /evaluateWearableOutfit\(pieces, \{ requireShoes \}\)/)
  assert.doesNotMatch(whole, /isOutfitStructurallyValid\(/)

  const planStart = plannerSource.indexOf('export function validateSubmittedPlanOutfits')
  const planEnd = plannerSource.indexOf('export function assembleSubmittedPlanOutfits', planStart)
  assert.ok(planStart >= 0 && planEnd > planStart, 'missing validateSubmittedPlanOutfits source block')
  const plan = plannerSource.slice(planStart, planEnd)
  assert.match(plan, /const wearableValidation = evaluateWearableOutfit\(pieces, \{/)
  assert.doesNotMatch(plan, /isOutfitStructurallyValid\(/)
  assert.doesNotMatch(plan, /describeOutfitStructureGap\(/)
})

test('route-level structure filters reuse typed findings and contain no category recount', () => {
  assert.match(routeSource, /import \{ categoryOutfitStructurePromptRule, evaluateLayerPairConstructionFor, evaluateWearableOutfit \} from '\.\.\/styling-engine\/outfitValidation\.js'/)
  assert.doesNotMatch(routeSource, /isOutfitStructurallyValid\(/)
  const whole = sourceBlock(
    'export async function generateWholeWardrobeOutfitsVisualInternal',
    "router.post('/generate-wardrobe-outfits-visual'",
  )
  assert.match(whole, /const validationByOutfit = new Map\(/)
  assert.match(whole, /validationByOutfit\.get\(outfit\)\.hardValid/)
  assert.doesNotMatch(whole, /const structuralRejectionReason = \(outfit\)/)
})

test('freeform proposal and swap validation consume the composed wearable verdict', () => {
  assert.match(validationSource, /export function evaluateOutfitRoles\(/)
  assert.match(toolSource, /import \{ evaluateWearableOutfit, layerConstructionPromptRule, OUTFIT_ROLES, projectOutfitValidationFindings, roleOutfitStructurePromptRule \} from '\.\/outfitValidation\.js'/)
  assert.match(toolSource, /const wearableValidation = evaluateWearableOutfit\(resolved, \{/)
  assert.match(validationSource, /export function evaluateLayerDirections\(/)
  assert.match(validationSource, /includeLayerDirections/)
  assert.doesNotMatch(attributesSource, /pieceReadsAsStandaloneBaseTop/)
  assert.doesNotMatch(toolSource, /export function validateOutfitRoles\(/)
  assert.doesNotMatch(toolSource, /function roleCategoryIssue\(/)
})

test('model-visible structure rules project from the shared validator owner', () => {
  assert.match(validationSource, /export function categoryOutfitStructurePromptRule\(/)
  assert.match(validationSource, /export function roleOutfitStructurePromptRule\(/)
  assert.match(validationSource, /export function projectOutfitValidationFindings\(/)
  assert.match(promptSource, /categoryOutfitStructurePromptRule\(/)
  assert.match(plannerSource, /categoryOutfitStructurePromptRule\(/)
  assert.match(routeSource, /categoryOutfitStructurePromptRule\(/)
  assert.match(toolSource, /roleOutfitStructurePromptRule\(/)
  assert.match(toolSource, /projectOutfitValidationFindings\(/)
})

// A prompt-responsibility census on #263 found evaluateLayerPairConstruction had a canonical
// outfitValidation.js owner and post-composition validation via evaluateWearableOutfit, but no
// active composer projected the same rule to the model BEFORE composition — each would have had
// to reinvent it locally in prose to give the model advance guidance. This proves the shared
// layerConstructionPromptRule() projection, not a local restatement, reaches every active
// layering-capable composer: the runtime prompt text itself (not just source presence) for the
// visual composer and propose_outfit, and source wiring for the plan/capsule workbench (its live
// projection and negative-control gating are proven directly in plan_outfit_set.test.js, since
// building it needs DB fixtures this file does not set up).
test('every active layering-capable composer projects the canonical layer-construction rule, not a local restatement', async () => {
  const { layerConstructionPromptRule } = await import('../styling-engine/outfitValidation.js')
  const ruleText = layerConstructionPromptRule()
  assert.ok(ruleText.length > 0)

  // Selected/whole visual composer: WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM backs both
  // generateWholeWardrobeOutfitsVisualInternal and the selected-anchor visual composer
  // (routes/ai.js appends its anchor contract to the same base template).
  const { buildPrompts } = await import('../styling-engine/prompts.js')
  const built = buildPrompts({})
  assert.ok(
    built.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM.includes(ruleText),
    'the visual composer must cite the canonical rule verbatim'
  )

  // Freeform propose_outfit: the tool description is static (cache-stable), so the projection is
  // wired at schema-definition time rather than per-turn. tools.js reaches db.js on import (see
  // hermeticity_guard.test.js), and this file intentionally never sets up DB isolation — it only
  // ever inspects tools.js as source text, so the description is verified by string-slicing that
  // source, not by importing STYLIST_TOOLS at runtime.
  const proposeOutfitStart = toolSource.indexOf('name: "propose_outfit"')
  const proposeOutfitEnd = toolSource.indexOf('input_schema:', proposeOutfitStart)
  assert.ok(proposeOutfitStart >= 0 && proposeOutfitEnd > proposeOutfitStart, 'propose_outfit tool description block not found')
  const proposeOutfitDescription = toolSource.slice(proposeOutfitStart, proposeOutfitEnd)
  assert.ok(
    proposeOutfitDescription.includes('${layerConstructionPromptRule()}'),
    'propose_outfit must cite the canonical rule by reference, not restate it'
  )

  // Plan and seasonal capsule composition share one workbench builder (buildPlanSlotWorkbench);
  // composeCapsulePlanOnce (routes/ai.js) passes its per-slot submission_requirements straight
  // into the atomic capsule composer's prompt payload, so one wiring point covers both.
  assert.match(plannerSource, /requirements\.push\(layerConstructionPromptRule\(\)\)/)
  assert.match(routeSource, /instructions: workbench\.instructions/, 'capsule composer must forward the workbench instructions carrying the projection')
  assert.match(routeSource, /slots: workbench\.slots/, 'capsule composer must forward the per-slot submission_requirements carrying the projection')

  // Guard against the thing this fix specifically warned against: no separate prompt should
  // restate the sleeve/fabric thresholds in its own words instead of citing the shared rule.
  assert.doesNotMatch(routeSource, /sleeve_type/, 'no prompt may cite the retired sleeve_type field')
})

test('outfit-producing flows share one normalized result envelope', () => {
  assert.match(outfitResultSource, /export const OUTFIT_DISPOSITIONS/)
  assert.match(outfitResultSource, /export function normalizeOutfitResult\(/)
  assert.match(outfitResultSource, /export function normalizeDeliveredOutfit\(/)
  assert.match(routeSource, /normalizeDeliveredOutfit\(/)
  assert.match(routeSource, /flow: 'selected_piece'/)
  assert.match(routeSource, /flow: 'whole_wardrobe_visual'/)
  assert.match(routeSource, /flow: 'capsule_expansion'/)
  assert.match(routeSource, /flow: 'capsule_repair'/)
  assert.match(toolSource, /flow: 'freeform_propose_outfit'/)
  assert.match(plannerSource, /flow: 'plan_outfit_set'/)
})

test('runtime dependent-piece decisions consume one structured needs_base reader', () => {
  assert.match(attributesSource, /export function pieceRequiresBaseLayer\(/)
  for (const source of [plannerSource, coreSource, toolSource]) {
    assert.doesNotMatch(
      source,
      /needs_base\s*===\s*['"]yes['"]/,
    )
    assert.doesNotMatch(source, /function pieceNeedsBase\(/)
  }
  assert.match(plannerSource, /pieceRequiresBaseLayer/)
  assert.match(coreSource, /pieceRequiresBaseLayer/)
  assert.match(toolSource, /pieceRequiresBaseLayer/)
})

test('required base-layer mechanics and their prompt projection have one typed owner', () => {
  assert.match(validationSource, /export function evaluateBaseLayerCandidate\(/)
  assert.match(validationSource, /export function evaluateRequiredBaseLayers\(/)
  assert.match(plannerSource, /evaluateBaseLayerCandidate\(piece\)\.verdict !== 'incompatible'/)
  assert.match(plannerSource, /const wearableValidation = evaluateWearableOutfit\(pieces, \{/)
  assert.match(toolSource, /const wearableValidation = evaluateWearableOutfit\(resolved, \{/)
  assert.match(promptSource, /\$\{requiredBaseLayerPromptRule\(\)\}/)
  assert.doesNotMatch(promptSource, /A candidate base tagged/)
})
