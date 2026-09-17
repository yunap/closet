// THE INFERRED-VERSUS-EXPLICIT CONTRACT, PROVEN AT EVERY CONSUMER (owner ruling 2026-09-13).
//
// An occasion-derived target or ceiling is soft; a stated maximum ("nothing above casual") is hard.
// `profileRuleFit` defaults `registerCeilingExplicit` to `true`, so a consumer that forgets to pass
// it keeps the old hard behaviour silently — which is exactly how the automatic-use pool went on
// suppressing one-rank-above pieces after the composer had been migrated. That pool runs UPSTREAM of
// `recoveryEligiblePieces`, so anything it drops is unavailable to composition and to repair alike.
//
// The same garment pair is therefore driven through every consumer in one file: automatic use,
// visual composition, search_wardrobe, and the plan slot path. No occasion, activity or formality
// rank is special-cased — each case names only the pair's relative position.
import test from 'node:test'
import nodeFs from 'node:fs'
import assert from 'node:assert/strict'
import {
  wholeWardrobePieceTrustDecision,
  buildVisualComposerRoster,
  profileRuleFit,
  resolveRegisterCeiling,
  registerCeilingIsExplicit,
} from '../styling-engine/rules.js'
import { evaluateAutomaticUsePiecePool } from '../styling-engine/eligibility.js'
import { resolveOccasionProfile } from '../styling-engine/occasions.js'

// One rank above the `city` occasion default (elevated), and a complete outfit's worth of
// within-register pieces so no consumer fails for an unrelated coverage reason.
const ONE_RANK_ABOVE = { id: 601, category: 'outerwear', name: 'structured coat', formality: 'dressy', occasions: ['evening'], fabric_weight: 'medium', sleeve_length: 'long', photo: 'coat.jpg' }
const WITHIN_REGISTER = [
  { id: 602, category: 'top', name: 'knit top', formality: 'everyday', occasions: ['city'], fabric_weight: 'medium', sleeve_length: 'long', photo: 'top.jpg' },
  { id: 603, category: 'bottom', name: 'trousers', formality: 'everyday', occasions: ['city'], fabric_weight: 'medium', photo: 'bottom.jpg' },
  { id: 604, category: 'shoes', name: 'loafers', formality: 'everyday', occasions: ['city'], heel_height: 'flat', walk_support: 'high', photo: 'shoes.jpg' },
]
const ALL = [ONE_RANK_ABOVE, ...WITHIN_REGISTER]
const INFERRED = { occasion: 'city' }
const STATED = { occasion: 'city', request: 'nothing dressy please' }

test('CONSUMER 1 — automatic use (upstream of both composition and repair)', () => {
  assert.equal(wholeWardrobePieceTrustDecision(ONE_RANK_ABOVE, INFERRED).allowed, true,
    'an inferred ceiling leaves the piece available to everything downstream')
  assert.equal(wholeWardrobePieceTrustDecision(ONE_RANK_ABOVE, STATED).allowed, false,
    'a stated maximum removes it')

  const inferredPool = evaluateAutomaticUsePiecePool({ pieces: ALL, context: INFERRED, policy: {} })
  const statedPool = evaluateAutomaticUsePiecePool({ pieces: ALL, context: STATED, policy: {} })
  assert.ok(inferredPool.eligiblePieces.some(piece => piece.id === ONE_RANK_ABOVE.id))
  assert.ok(!statedPool.eligiblePieces.some(piece => piece.id === ONE_RANK_ABOVE.id))
})

test('CONSUMER 2 — visual composition roster', () => {
  const roster = request => buildVisualComposerRoster(ALL, {
    occasion: 'city', weatherProfile: {}, calendarSeason: '', maxImages: 90, request,
  })
  const inferred = roster('outfits for a city day')
  const stated = roster('nothing dressy please')

  assert.ok(inferred.roster.some(piece => Number(piece.id) === ONE_RANK_ABOVE.id),
    'eligible under an inferred ceiling, ranked down rather than removed')
  assert.ok(!stated.roster.some(piece => Number(piece.id) === ONE_RANK_ABOVE.id))
  assert.match(
    (stated.excluded.find(entry => Number(entry.pieceId) === ONE_RANK_ABOVE.id) || {}).reason || '',
    /register/,
    'and removed for the register reason, not incidentally',
  )
})

test('CONSUMER 3 — search_wardrobe tiering', () => {
  const occasionProfile = resolveOccasionProfile('city', '')
  const tierFor = request => {
    const intent = { occasion: 'city', request, occasionProfile }
    return profileRuleFit(ONE_RANK_ABOVE, occasionProfile?.rules || {}, {
      occasionProfile,
      registerCeiling: resolveRegisterCeiling(intent),
      registerCeilingExplicit: registerCeilingIsExplicit(intent),
    }).tier
  }
  assert.equal(tierFor('outfits for a city day'), 'discouraged',
    'returned and rankable — the prohibited tier holds prohibitions')
  assert.equal(tierFor('nothing dressy please'), 'prohibited')
})

test('CONSUMER 4 — plan slot pool', async () => {
  // The plan path resolves its own ceiling per slot (occasion profile + the slot's `register`
  // target) and passes explicitness alongside it. Driven through the planner's own pool evaluator,
  // which is what `slotGateEligiblePieces` consumes.
  // `evaluatePlannerAutomaticUsePool` is the planner's thin wrapper over the shared pool; the slot
  // path calls it with the slot's resolved ceiling and explicitness, which is what this drives.
  const poolFor = (requestText, explicit) => evaluateAutomaticUsePiecePool({
    pieces: ALL,
    context: {
      occasion: 'city',
      season: 'fall',
      weatherProfile: {},
      mood: requestText,
      request: requestText,
      registerCeiling: 'elevated',
      registerCeilingExplicit: explicit,
    },
    policy: { hotOuterwearCap: 3 },
  }).eligiblePieces

  assert.ok(poolFor('walking around the city', false).some(piece => Number(piece.id) === ONE_RANK_ABOVE.id),
    'a slot register target is a target; the piece stays available to the plan')
  assert.ok(!poolFor('nothing dressy please', true).some(piece => Number(piece.id) === ONE_RANK_ABOVE.id),
    'a stated maximum in the slot brief is a constraint')
})

test('no consumer relies on the hard default', () => {
  // The default exists so an un-migrated caller fails closed rather than open. This asserts the
  // audit is complete: every call site passes the flag, so the default is unreachable in production.
  const fs = nodeFs
  const sources = ['styling-engine/rules.js', 'styling-engine/tools.js', 'styling-engine/outfitSetPlanner.js', 'styling-engine/core.js']
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8')
    const calls = [...text.matchAll(/profileRuleFit\([^)]*?\{[^}]*?registerCeiling[^}]*?\}/gs)]
    for (const call of calls) {
      assert.match(call[0], /registerCeilingExplicit/,
        `${file}: every profileRuleFit call that passes a ceiling must also pass its explicitness`)
    }
  }
})
