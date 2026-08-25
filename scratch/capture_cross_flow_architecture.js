#!/usr/bin/env node

// Provider-free architecture baseline for the consolidation pass.
//
// This is deliberately not a second implementation of any styling rule. It feeds one synthetic
// wardrobe and the same contexts/outfits through the production exports that currently own each
// flow's deterministic stages, then records their observable results. Later consolidation slices
// use this artifact to distinguish a code-reuse migration from an accidental behavior redesign.
//
// Usage:
//   node scratch/capture_cross_flow_architecture.js          # print current capture
//   node scratch/capture_cross_flow_architecture.js --check  # compare with committed baseline
//   node scratch/capture_cross_flow_architecture.js --write  # deliberately refresh baseline

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(root, 'test', 'fixtures', 'cross_flow_architecture_baseline.json')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-cross-flow-architecture-'))

process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tempRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tempRoot, 'uploads')

const { db } = await import('../db.js')
const {
  filterWholeWardrobePiecesForGeneration,
  locallyGateWholeWardrobeOutfits,
  selectCandidatesForOutfitGeneration,
  wholeWardrobePieceTrustDecision,
  weatherProfileFromContext,
} = await import('../styling-engine/rules.js')
const { evaluateOutfitStructure } = await import('../styling-engine/outfitValidation.js')
const { evaluateAutomaticUsePiecePool, evaluateVisualComposerPiecePool } = await import('../styling-engine/eligibility.js')
const { normalizeStylingIntent } = await import('../styling-engine/stylingIntent.js')
const { createStylingContextResolver } = await import('../styling-engine/stylingContext.js')
const { resolveOccasionProfile } = await import('../styling-engine/occasions.js')
const { resolveActivityProfile } = await import('../styling-engine/footwear-comfort.js')
const { buildLocalFallbackOutfitDirections } = await import('../styling-engine/core.js')
const { validateOutfitRoles } = await import('../styling-engine/tools.js')
const {
  buildCapsuleBench,
  buildPlanSlotWorkbench,
  completeSubmittedPlanOutfits,
  describeOutfitStructureGap,
  selectCapsuleRoster,
  validateCapsuleRoster,
  validateSubmittedPlanOutfits,
} = await import('../styling-engine/outfitSetPlanner.js')

const REFERENCE_DATE = new Date('2026-08-24T12:00:00-07:00')
const resolveFixtureStylingContext = createStylingContextResolver({
  weatherResolver: async ({ location }) => ({
    isHot: false,
    isCold: false,
    isWetExposure: false,
    highF: 72,
    lowF: 56,
    location,
    weatherSource: 'live',
  }),
})

function piece(overrides = {}) {
  const id = Number(overrides.id)
  return {
    id,
    name: `Fixture piece ${id}`,
    category: 'top',
    status: 'active',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    role_permission: 'auto',
    occasions: ['casual', 'city', 'travel'],
    occasion_exclusions: [],
    formality: 'everyday',
    photo: `fixture-${id}.jpg`,
    colors: ['navy'],
    pattern_type: 'solid',
    fabric_category: 'cotton',
    fiber_content: ['cotton'],
    fabric_weight: 'light',
    opacity: 'opaque',
    needs_base: 'no',
    fit_on_body: 'skims',
    reads_as: 'plain wardrobe garment',
    style_profile_json: {},
    ...overrides,
  }
}

const wardrobe = [
  piece({ id: 101, name: 'Navy cotton tee', category: 'top', reads_as: 'plain navy cotton tee' }),
  piece({
    id: 102,
    name: 'Heavy wool turtleneck',
    category: 'top',
    fabric_category: 'wool',
    fiber_content: ['wool'],
    fabric_weight: 'heavy',
    neckline: 'turtleneck',
    sleeve_length: 'long',
    reads_as: 'heavy wool turtleneck',
  }),
  piece({
    id: 103,
    name: 'Ivory elevated blouse',
    category: 'top',
    occasions: ['smart casual', 'evening', 'city'],
    formality: 'elevated',
    colors: ['ivory'],
    reads_as: 'refined ivory blouse',
  }),
  piece({
    id: 104,
    name: 'Sheer mesh shell',
    category: 'top',
    opacity: 'sheer',
    needs_base: 'yes',
    fit_on_body: 'clings_stretchy',
    reads_as: 'sheer mesh shell requiring a base',
  }),
  piece({
    id: 201,
    name: 'Straight blue jeans',
    category: 'bottom',
    fabric_category: 'denim',
    fiber_content: ['cotton'],
    fabric_weight: 'medium',
    bottom_kind: 'pants',
    style_profile_json: { bottom_kind: 'pants' },
    reads_as: 'straight denim jeans',
  }),
  piece({
    id: 202,
    name: 'Tan linen shorts',
    category: 'bottom',
    fabric_category: 'linen',
    fiber_content: ['linen'],
    bottom_kind: 'shorts',
    style_profile_json: { bottom_kind: 'shorts' },
    colors: ['tan'],
    reads_as: 'light linen shorts',
  }),
  piece({
    id: 203,
    name: 'Black tailored trousers',
    category: 'bottom',
    occasions: ['smart casual', 'evening', 'city'],
    formality: 'elevated',
    fabric_weight: 'medium',
    bottom_kind: 'pants',
    style_profile_json: { bottom_kind: 'pants' },
    colors: ['black'],
    reads_as: 'tailored black trousers',
  }),
  piece({
    id: 301,
    name: 'Blue cotton day dress',
    category: 'dress',
    reads_as: 'simple cotton day dress',
  }),
  piece({
    id: 302,
    name: 'Black evening dress',
    category: 'dress',
    occasions: ['evening'],
    formality: 'dressy',
    colors: ['black'],
    reads_as: 'dressy black evening dress',
  }),
  piece({
    id: 401,
    name: 'Light cotton cardigan',
    category: 'outerwear',
    garment_kind: 'cardigan',
    layerability: 'top_layer',
    style_profile_json: { garment_kind: 'cardigan', layerability: 'top_layer' },
    reads_as: 'light open-front cotton cardigan',
  }),
  piece({
    id: 501,
    name: 'White supportive sneakers',
    category: 'shoes',
    fabric_category: 'leather',
    fiber_content: ['leather'],
    heel_height: 'flat',
    walk_support: 'high',
    shoe_style: 'sneakers',
    reads_as: 'supportive white leather sneakers',
  }),
  piece({
    id: 502,
    name: 'Tan low-support sandals',
    category: 'shoes',
    fabric_category: 'leather',
    fiber_content: ['leather'],
    heel_height: 'flat',
    walk_support: 'low',
    shoe_style: 'sandals',
    colors: ['tan'],
    reads_as: 'flat low-support leather sandals',
  }),
  piece({
    id: 503,
    name: 'Black ankle boots',
    category: 'shoes',
    occasions: ['casual', 'city', 'evening'],
    fabric_category: 'leather',
    fiber_content: ['leather'],
    heel_height: 'low',
    walk_support: 'medium',
    shoe_style: 'boots',
    colors: ['black'],
    reads_as: 'black leather ankle boots',
  }),
  piece({
    id: 504,
    name: 'Untagged comfort flats',
    category: 'shoes',
    fabric_category: 'leather',
    fiber_content: ['leather'],
    heel_height: null,
    walk_support: null,
    shoe_style: 'flats',
    reads_as: 'plain leather flats with comfort metadata not yet tagged',
  }),
]

// A real persisted owner constraint, in the isolated fixture database. All production consumers
// that query the shared store can see it; a path that does not consult that owner remains visible
// in the capture instead of being papered over by injected test data.
db.prepare(`
  INSERT INTO owner_constraints
    (id, status, selector_type, selector_values, context_dimension, context_values, reason)
  VALUES (1, 'active', 'piece_ids', '[503]', 'season', '["summer"]', 'Fixture: no boots in summer')
`).run()

const pieceById = new Map(wardrobe.map(item => [Number(item.id), item]))
const ids = values => (Array.isArray(values) ? values : []).map(value => Number(value?.piece?.id ?? value?.id ?? value)).filter(Number.isFinite)
const sortedObject = value => Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)))
const reasonsById = values => Object.fromEntries((Array.isArray(values) ? values : [])
  .map(entry => [String(Number(entry?.pieceId ?? entry?.id)), [...(entry?.reasons || [entry?.reason].filter(Boolean))]])
  .sort(([a], [b]) => Number(a) - Number(b)))

const scenarioDefinitions = [
  {
    id: 'casual_neutral',
    request: {
      occasion: 'casual',
      season: 'current season',
      mood: 'easy city day',
      activity: 'none',
      mission: 'default',
      weatherProfile: { isHot: false, isCold: false, isWetExposure: false, weatherSource: 'fixture' },
    },
    slot: {
      id: 'casual-day',
      label: 'Casual day',
      occasion: 'casual',
      activity: 'none',
      environment: 'mixed',
      register: '',
      statedWeather: 'mild weather',
      season: 'current season',
      targetOutfits: 1,
    },
    capsule: { isSummer: false, isWinter: false },
  },
  {
    id: 'hot_hiking',
    request: {
      occasion: 'travel',
      season: 'summer',
      mood: 'hot outdoor hiking day',
      activity: 'hiking',
      mission: 'default',
      weatherProfile: { isHot: true, isCold: false, isWetExposure: false, weatherSource: 'fixture' },
    },
    slot: {
      id: 'hot-hike',
      label: 'Hot-weather hike',
      occasion: 'travel',
      activity: 'hiking',
      environment: 'outdoor',
      register: '',
      statedWeather: 'hot weather',
      season: 'summer',
      targetOutfits: 1,
    },
    capsule: { isSummer: true, isWinter: false },
  },
  {
    id: 'capacity_pressure',
    request: {
      occasion: 'casual',
      season: 'spring',
      mood: 'ordinary mild day',
      activity: 'none',
      mission: 'default',
      weatherProfile: { isHot: false, isCold: false, isWetExposure: false, weatherSource: 'fixture' },
    },
    slot: {
      id: 'capacity-day',
      label: 'Capacity-pressure day',
      occasion: 'casual',
      activity: 'none',
      environment: 'mixed',
      register: '',
      statedWeather: 'mild weather',
      season: 'spring',
      targetOutfits: 1,
    },
    capsule: { isSummer: false, isWinter: false },
    limits: { visualImages: 5, selectedCandidates: 4, capsuleBudget: 6, capsuleBench: 5 },
  },
]

async function normalizedContext(definition) {
  const intent = normalizeStylingIntent(definition.request)
  const occasionProfile = resolveOccasionProfile(intent.occasion, intent.mood)
  const activityProfile = resolveActivityProfile({
    activity: definition.request.activity,
    occasion: intent.occasion,
    mood: intent.mood,
    request: definition.request.mood,
  })
  const heuristicWeather = weatherProfileFromContext({
    mood: intent.mood,
    season: intent.season,
    currentDate: REFERENCE_DATE,
  })
  const shared = await resolveFixtureStylingContext({
    explicitRequest: {
      ...definition.request,
      requestText: definition.request.mood,
      location: definition.request.season === 'current season' ? 'Berkeley, CA' : '',
      date: REFERENCE_DATE,
    },
    actionArtifact: {
      occasion: 'evening',
      season: 'winter',
      weatherProfile: {
        isHot: false,
        isCold: true,
        weatherSource: 'saved_snapshot',
      },
    },
    inferred: {
      activity: definition.request.activity === 'none' ? 'walking' : '',
    },
  })
  return {
    intent,
    occasionProfile: occasionProfile?.id || null,
    activityProfile: activityProfile?.id || null,
    suppliedWeather: {
      isHot: Boolean(definition.request.weatherProfile.isHot),
      isCold: Boolean(definition.request.weatherProfile.isCold),
      isWetExposure: Boolean(definition.request.weatherProfile.isWetExposure),
      weatherSource: definition.request.weatherProfile.weatherSource,
    },
    heuristicWeather: {
      isHot: Boolean(heuristicWeather.isHot),
      isCold: Boolean(heuristicWeather.isCold),
      isWetExposure: Boolean(heuristicWeather.isWetExposure),
    },
    sharedResolution: {
      occasion: shared.occasion,
      declaredActivity: shared.activity,
      resolvedActivity: shared.resolvedActivity,
      activitySource: shared.activitySource,
      season: shared.season,
      weather: shared.debug.resolved.weather,
      provenanceByField: JSON.parse(JSON.stringify(shared.provenanceByField)),
      conflicts: shared.conflicts,
    },
  }
}

async function captureCandidateStages(definition) {
  const visualImages = Number(definition.limits?.visualImages) || 10
  const selectedCandidateLimit = Number(definition.limits?.selectedCandidates) || 10
  const capsuleBudget = Number(definition.limits?.capsuleBudget) || 10
  const capsuleBenchSize = Number(definition.limits?.capsuleBench) || 10
  const options = {
    occasion: definition.request.occasion,
    season: definition.request.season,
    mood: definition.request.mood,
    activity: definition.request.activity,
    request: definition.request.mood,
    weatherProfile: definition.request.weatherProfile,
    currentDate: REFERENCE_DATE,
  }
  const trust = wardrobe.map(item => ({ id: item.id, ...wholeWardrobePieceTrustDecision(item, options) }))
  const automaticUse = evaluateAutomaticUsePiecePool({
    pieces: wardrobe,
    context: options,
    policy: { hotOuterwearCap: 3 },
  })
  const filtered = filterWholeWardrobePiecesForGeneration(wardrobe, options)
  const visual = evaluateVisualComposerPiecePool({
    pieces: wardrobe,
    context: {
      occasion: options.occasion,
      season: options.season,
      mood: options.mood,
      activity: options.activity,
      requestText: options.request,
      weatherProfile: options.weatherProfile,
    },
    policy: {
      maxImages: visualImages,
      includeAccessories: false,
      recordMetadataTodos: false,
    },
  })
  const selected = selectCandidatesForOutfitGeneration(pieceById.get(101), wardrobe, selectedCandidateLimit, options)
  const slots = [structuredClone(definition.slot)]
  const workbench = await buildPlanSlotWorkbench(slots, {
    constraints: { reuse: 'maximize', piece_budget: capsuleBudget },
    allPieces: wardrobe,
    dateRange: { start: '2026-08-24', end: '2026-08-24' },
    mood: definition.request.mood,
    question: definition.request.mood,
    location: '',
    fetchImpl: async () => { throw new Error('cross-flow fixture attempted a network weather lookup') },
    planKind: 'coordinated_plan',
  })
  const capsuleRoster = selectCapsuleRoster(wardrobe, {
    budget: capsuleBudget,
    isSummer: definition.capsule.isSummer,
    isWinter: definition.capsule.isWinter,
    occasions: [definition.slot.occasion],
    slots: [structuredClone(definition.slot)],
  })
  const capsuleBench = buildCapsuleBench(wardrobe, {
    budget: capsuleBudget,
    isSummer: definition.capsule.isSummer,
    isWinter: definition.capsule.isWinter,
    slots: [structuredClone(definition.slot)],
    benchSize: capsuleBenchSize,
  })
  const capsuleValidation = validateCapsuleRoster(capsuleRoster, {
    slots: [structuredClone(definition.slot)],
    budget: capsuleBudget,
    isSummer: definition.capsule.isSummer,
    isWinterCapsule: definition.capsule.isWinter,
    pool: wardrobe,
  })

  return {
    trust: {
      allowedIds: trust.filter(entry => entry.allowed).map(entry => entry.id),
      suppressed: Object.fromEntries(trust.filter(entry => !entry.allowed).map(entry => [String(entry.id), entry.reasons])),
    },
    automaticUsePool: {
      eligibleIds: ids(automaticUse.eligiblePieces),
      excluded: Object.fromEntries(automaticUse.excludedPieces.map(entry => [String(entry.pieceId), entry.reasons])),
      findingCounts: sortedObject(automaticUse.debug.findingCounts),
    },
    wholeWardrobeFilter: {
      allowedIds: ids(filtered.allowedPieces),
      suppressed: reasonsById(filtered.suppressedPieces),
    },
    visualRoster: {
      rosterIds: ids(visual.eligiblePieces),
      recoveryEligibleIds: ids(visual.recoveryEligiblePieces),
      excluded: Object.fromEntries((visual.excludedPieces || [])
        .map(entry => [String(entry.pieceId), entry.reason])
        .sort(([a], [b]) => Number(a) - Number(b))),
      excludedCounts: sortedObject(visual.debug?.excludedCounts),
      findingCounts: sortedObject(visual.debug?.findingCounts),
      slotCoverage: visual.debug?.slotCoverage || {},
      cap: {
        requested: visualImages,
        applied: Boolean(visual.debug?.capApplied),
        cutPieceIds: (visual.debug?.capCutPieces || []).map(entry => Number(entry.id)).filter(Number.isFinite),
      },
    },
    selectedPieceCandidates: selected.map(entry => ({
      id: Number(entry.piece.id),
      blocked: Boolean(entry.autoUseBlocked),
      blockReasons: entry.autoUseBlockReasons || [],
    })),
    planWorkbench: {
      allowedIds: workbench.slots[0]?.allowed_piece_ids || [],
      gateAllowedIds: [...(workbench.pendingPlan.slots[0]?.gateAllowedIds || new Set())].sort((a, b) => a - b),
      suppressed: Object.fromEntries([...(workbench.pendingPlan.slots[0]?.suppressedReasonsById || new Map()).entries()]
        .map(([id, reasons]) => [String(id), reasons])
        .sort(([a], [b]) => Number(a) - Number(b))),
      weatherUsed: workbench.slots[0]?.weather_used || '',
    },
    capsule: {
      requestedBudget: capsuleBudget,
      requestedBenchSize: capsuleBenchSize,
      rosterIds: ids(capsuleRoster),
      postConditionGaps: capsuleRoster.postConditionGaps || [],
      benchIds: ids(capsuleBench.bench),
      benchUnmetTargets: capsuleBench.diagnostics?.unmetTargets || [],
      validation: {
        ok: capsuleValidation.ok,
        failures: capsuleValidation.failures.map(entry => ({ code: entry.code, message: entry.message })),
      },
    },
  }
}

const structureCases = [
  {
    id: 'valid_separates',
    pieceIds: [101, 201, 501],
    roles: ['primary_top', 'primary_bottom', 'shoes'],
  },
  {
    id: 'missing_shoes',
    pieceIds: [101, 201],
    roles: ['primary_top', 'primary_bottom'],
  },
  {
    id: 'two_shoes',
    pieceIds: [101, 201, 501, 502],
    roles: ['primary_top', 'primary_bottom', 'shoes', 'shoes'],
  },
  {
    id: 'dependent_top_without_base',
    pieceIds: [104, 201, 501],
    roles: ['primary_top', 'primary_bottom', 'shoes'],
  },
  {
    id: 'dress_plus_top_unseen',
    pieceIds: [301, 101, 501],
    roles: ['dress', 'primary_top', 'shoes'],
  },
]

function planForStructureCase() {
  const allowedIds = new Set(wardrobe.map(item => Number(item.id)))
  return {
    slots: [{
      id: 'fixture-slot',
      label: 'Fixture slot',
      occasion: 'casual',
      activity: 'none',
      environment: 'mixed',
      register: '',
      weatherProfile: {},
      allowedPieces: wardrobe,
      rosterIds: allowedIds,
      gateAllowedIds: allowedIds,
      suppressedReasonsById: new Map(),
    }],
    piecesById: pieceById,
    heldOutfits: [],
    constraints: {
      reuse: '',
      noRepeat: new Set(),
      allowRepeat: new Set(),
      anchorIds: new Set(),
      pieceBudget: 0,
    },
    isWinterCapsule: false,
  }
}

function captureValidationStages() {
  return structureCases.map(entry => {
    const pieces = entry.pieceIds.map(id => pieceById.get(id))
    const rolePieces = pieces.map((item, index) => ({ ...item, role: entry.roles[index] }))
    const outfit = {
      label: entry.id,
      title: entry.id,
      reason: 'Fixture reason.',
      pieceIds: entry.pieceIds,
      pieces,
    }
    const gate = locallyGateWholeWardrobeOutfits([outfit], 1, {
      mode: 'gate',
      repair: false,
      applyDiversity: false,
      candidatePieces: wardrobe,
      occasion: 'casual',
      activity: 'none',
      weatherProfile: {},
    })
    const advisor = locallyGateWholeWardrobeOutfits([outfit], 1, {
      mode: 'advisor',
      repair: false,
      applyDiversity: false,
      candidatePieces: wardrobe,
      occasion: 'casual',
      activity: 'none',
      weatherProfile: {},
    })
    const plan = validateSubmittedPlanOutfits(planForStructureCase(), [{
      slot_id: 'fixture-slot',
      title: entry.id,
      piece_ids: entry.pieceIds,
      reason: 'Fixture reason.',
      styling_instructions: '',
    }])
    return {
      id: entry.id,
      core: {
        valid: evaluateOutfitStructure(pieces).valid,
        gap: describeOutfitStructureGap(pieces),
      },
      freeformRoles: { issues: validateOutfitRoles(rolePieces, []) },
      wholeGate: {
        accepted: gate.outfits.length === 1,
        rejectedReasons: gate.rejected.map(item => item.reason),
      },
      wholeAdvisor: {
        accepted: advisor.outfits.length === 1,
        flags: (advisor.outfits[0]?.systemFlags || []).map(flag => ({ type: flag.type, message: flag.message })),
        rejectedReasons: advisor.rejected.map(item => item.reason),
      },
      plan: {
        accepted: plan.accepted.length === 1,
        failureReasons: plan.failures.flatMap(item => item.reasons || []),
      },
    }
  })
}

function captureRecoveryStages() {
  const selectedCandidates = selectCandidatesForOutfitGeneration(pieceById.get(101), wardrobe, 10, {
    occasion: 'casual',
    activity: 'none',
    weatherProfile: {},
  })
  const selectedFallback = buildLocalFallbackOutfitDirections(pieceById.get(101), selectedCandidates, { occasion: 'casual' })
  const incompleteSubmission = [{
    slot_id: 'fixture-slot',
    title: 'Sneakers fixture',
    piece_ids: [101, 201],
    reason: 'Navy cotton tee, straight blue jeans, and white supportive sneakers.',
    styling_instructions: '',
  }]
  const completed = completeSubmittedPlanOutfits(planForStructureCase(), incompleteSubmission)
  return {
    selectedLocalFallback: selectedFallback.map(outfit => ({
      label: outfit.label,
      pieceIds: outfit.pieceIds,
    })),
    planCompletion: {
      acceptedPieceIds: completed.accepted.map(outfit => outfit.pieceIds),
      remainingFailures: completed.failures.flatMap(item => item.reasons || []),
      completions: completed.completions,
    },
  }
}

export async function captureCrossFlowArchitecture() {
  const scenarios = {}
  for (const definition of scenarioDefinitions) {
    scenarios[definition.id] = {
      context: await normalizedContext(definition),
      candidates: await captureCandidateStages(definition),
    }
  }
  return {
    schemaVersion: 3,
    auditBaseline: 'c1693a8e8f76881d5cb3d87c173ea21fed6ccb53',
    fixturePieceIds: wardrobe.map(item => item.id),
    scenarios,
    validation: captureValidationStages(),
    recovery: captureRecoveryStages(),
  }
}

const capture = await captureCrossFlowArchitecture()
const serialized = `${JSON.stringify(capture, null, 2)}\n`

try {
  if (process.argv.includes('--write')) {
    fs.writeFileSync(baselinePath, serialized, 'utf8')
    console.log(`Wrote ${path.relative(root, baselinePath)}`)
  } else if (process.argv.includes('--check')) {
    assert.ok(fs.existsSync(baselinePath), `missing baseline: ${path.relative(root, baselinePath)}`)
    const expected = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    assert.deepEqual(capture, expected)
    console.log(`Cross-flow architecture baseline matches ${path.relative(root, baselinePath)}`)
  } else {
    process.stdout.write(serialized)
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
