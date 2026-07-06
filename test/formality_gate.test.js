import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compatibilityScoreForSelectedItem,
  explicitFormalityAvoidanceIssue,
  formalityFitForOutfit,
  locallyGateWholeWardrobeOutfits,
  resolveFormalityIntent,
  resolveRegisterCeiling,
  scoreWholeWardrobeCandidate
} from '../styling-engine/rules.js'
import { resolveOccasionProfile } from '../styling-engine/occasions.js'
import { resolveActivityProfile } from '../styling-engine/footwear-comfort.js'

const base = {
  status: 'active',
  colors: [],
  occasions: ['casual'],
  styling_rules_learned: [],
  pairs_well_with: [],
  tried_and_rejected: [],
  style_profile_json: {},
}

test('formality intent parses user-facing register requests', () => {
  assert.deepEqual(
    {
      target: resolveFormalityIntent({ request: 'same outfit, more everyday and not dressy' }).target,
      avoidDressy: resolveFormalityIntent({ request: 'same outfit, more everyday and not dressy' }).avoid.has('dressy')
    },
    { target: 'everyday', avoidDressy: true }
  )
  assert.equal(resolveFormalityIntent({ request: 'dressy but walkable' }).target, 'dressy')
  assert.equal(resolveFormalityIntent({ request: 'dressy but walkable' }).walkable, true)
})

test('resolveRegisterCeiling combines profiles and explicit user intent', () => {
  assert.equal(
    resolveRegisterCeiling({ occasionProfile: { register_ceiling: 'elevated' } }),
    'elevated'
  )
  assert.equal(
    resolveRegisterCeiling({ request: 'not dressy' }),
    'elevated'
  )
  assert.equal(
    resolveRegisterCeiling({
      occasionProfile: { register_ceiling: 'elevated' },
      activityProfile: { rules: { register_ceiling: 'everyday' } }
    }),
    'everyday'
  )
  assert.equal(
    resolveRegisterCeiling({
      occasionProfile: { register_ceiling: 'everyday' },
      request: 'dressy'
    }),
    'dressy'
  )
  assert.equal(resolveRegisterCeiling({ occasion: 'city' }), null)
})

test('ratified occasion and activity register ceilings resolve as expected', () => {
  assert.equal(resolveOccasionProfile('casual')?.register_ceiling, 'everyday')
  assert.equal(resolveOccasionProfile('city')?.register_ceiling, 'elevated')
  assert.equal(resolveOccasionProfile('smart casual')?.register_ceiling, 'elevated')
  assert.equal(resolveOccasionProfile('outdoor cafe')?.register_ceiling, 'elevated')
  assert.equal(resolveOccasionProfile('evening')?.register_ceiling, 'dressy')
  assert.equal(resolveOccasionProfile('gallery / art event')?.register_ceiling, 'elevated')
  assert.equal(resolveOccasionProfile('travel'), null)
  assert.equal(resolveOccasionProfile('concert')?.register_ceiling, 'elevated')
  assert.equal(resolveOccasionProfile('home')?.register_ceiling, 'everyday')

  assert.equal(resolveActivityProfile({ activity: 'walking' })?.rules?.register_ceiling, undefined)
  assert.equal(resolveActivityProfile({ activity: 'hiking' })?.rules?.register_ceiling, 'everyday')
})

test('selected-piece ranking favors requested everyday register over dressy support', () => {
  const selected = { ...base, id: 1, name: 'graphic tee', category: 'top', formality: 'everyday' }
  const everyday = { ...base, id: 2, name: 'dark jeans', category: 'bottom', formality: 'everyday' }
  const dressy = { ...base, id: 3, name: 'satin midi skirt', category: 'bottom', formality: 'dressy', occasions: ['evening'] }

  const everydayScore = compatibilityScoreForSelectedItem(selected, everyday, {
    request: 'make this more everyday, not dressy'
  })
  const dressyScore = compatibilityScoreForSelectedItem(selected, dressy, {
    request: 'make this more everyday, not dressy'
  })

  assert.ok(everydayScore.score > dressyScore.score)
  assert.ok(dressyScore.reasons.some(reason => reason.includes('avoid dressy') || reason.includes('too far from everyday')))
})

test('whole-wardrobe scoring penalizes register clashes and walkability misses', () => {
  const loungeTop = { ...base, id: 1, name: 'fleece hoodie', category: 'top', formality: 'lounge' }
  const dressySkirt = { ...base, id: 2, name: 'satin midi skirt', category: 'bottom', formality: 'dressy' }
  const highHeel = { ...base, id: 3, name: 'black high heel', category: 'shoes', formality: 'dressy', heel_height: 'high', walk_support: 'low' }
  const elevatedTop = { ...base, id: 4, name: 'black wrap blouse', category: 'top', formality: 'elevated' }
  const elevatedBottom = { ...base, id: 5, name: 'tailored trousers', category: 'bottom', formality: 'elevated' }
  const walkableFlat = { ...base, id: 6, name: 'black loafer', category: 'shoes', formality: 'elevated', heel_height: 'flat', walk_support: 'high' }

  const clash = formalityFitForOutfit([loungeTop, dressySkirt], {})
  assert.ok(clash.score < 0)
  assert.ok(clash.adjustments.some(adjustment => adjustment.reason.includes('register clash')))

  const badWalk = scoreWholeWardrobeCandidate([elevatedTop, elevatedBottom, highHeel], {
    request: 'dressy but walkable'
  })
  const goodWalk = scoreWholeWardrobeCandidate([elevatedTop, elevatedBottom, walkableFlat], {
    request: 'dressy but walkable'
  })
  assert.ok(goodWalk.score > badWalk.score)
  assert.ok(badWalk.reasons.some(reason => reason.includes('not walkable enough')))
})

test('explicit not-dressy detection remains available before model composition', () => {
  const dress = { ...base, id: 10, name: 'botanical maxi dress', category: 'dress', formality: 'dressy' }
  const heels = { ...base, id: 11, name: 'red peep-toe heels', category: 'shoes', formality: 'dressy', heel_height: 'mid', walk_support: 'medium' }
  const loafers = { ...base, id: 12, name: 'black loafers', category: 'shoes', formality: 'everyday', heel_height: 'flat', walk_support: 'high' }
  const top = { ...base, id: 13, name: 'striped tee', category: 'top', formality: 'everyday' }
  const pants = { ...base, id: 14, name: 'cotton pants', category: 'bottom', formality: 'everyday' }

  assert.match(
    explicitFormalityAvoidanceIssue([dress, heels], { mood: 'more everyday, not dressy' }),
    /avoid dressy/
  )

  const gated = locallyGateWholeWardrobeOutfits([
    { label: 'Evening floral', pieces: [dress, heels], pieceIds: [10, 11] },
    { label: 'Everyday column', pieces: [top, pants, loafers], pieceIds: [13, 14, 12] }
  ], 5, {
    mode: 'advisor',
    requireShoes: true,
    applyDiversity: false,
    candidatePieces: [dress, heels, top, pants, loafers],
    occasion: 'city',
    mood: 'more everyday, not dressy'
  })

  assert.deepEqual(gated.outfits.map(outfit => outfit.label), ['Evening floral', 'Everyday column'])
  assert.equal(gated.rejected.some(item => item.reason.includes('avoid dressy')), false)
})
