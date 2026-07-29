import test from 'node:test'
import assert from 'node:assert/strict'
import {
  autoStylingTrustDecision,
  buildWardrobePieceTruthText,
  buildWardrobeManifest,
  buildWardrobeManifestLine,
} from '../src/utils/wardrobeAiContext.js'

test('piece truth text preserves bottom construction facts for AI prompts', () => {
  const text = buildWardrobePieceTruthText({
    name: 'black washed bootcut denim jeans',
    category: 'bottom',
    colors: ['Black'],
    reads_as: 'quiet dark neutral',
    bottom_shape: 'bootcut',
    leg_opening: 'straight/open',
    length_hits_at: 'full-length',
    hem_finish: 'straight_open',
    fabric_category: 'denim',
    fabric_weight: 'medium',
    fit_confidence: 'high',
    recommendation_status: 'trusted',
  })

  assert.match(text, /black washed bootcut denim jeans/)
  assert.match(text, /bottom shape: bootcut/)
  assert.match(text, /leg opening: straight\/open/)
  assert.match(text, /hits at: full-length/)
  assert.match(text, /fabric: denim\/medium/)
})

test('piece truth text includes engine notes and AI garment intelligence', () => {
  const text = buildWardrobePieceTruthText({
    name: 'black pink floral skirt',
    category: 'bottom',
    recommendation_status: 'needs_fit_review',
    fit_confidence: 'low',
    engine_notes: 'Too small now; do not auto-style as a hero piece.',
    style_profile_json: {
      style_lanes: { folk_artisan: 4, modern_bohemian: 3 },
      visual_roles: ['movement_piece'],
      style_notes: {
        best_use: 'testing only',
        risk: 'can ride up at the waist',
      },
      garment_intelligence: {
        auto_use_trust: 'needs_fit_review',
        best_outfit_role: 'movement',
        pairing_requirements: ['needs compact support'],
        failure_risks: ['can turn costume-like with another folk piece'],
        formula_compatibility: ['compact top + movement skirt'],
        do_not_pair_rules: ['avoid another folk piece'],
        real_wear_notes: { fit: 'rides up when too tight' },
        occasion_confidence: { city: 'low' },
      },
    },
  })

  assert.match(text, /recommendation trust: needs_fit_review/)
  assert.match(text, /fit confidence: low/)
  assert.match(text, /engine note: Too small now; do not auto-style as a hero piece\./)
  assert.match(text, /style lanes: folk_artisan:4, modern_bohemian:3/)
  assert.match(text, /AI auto-use trust: needs_fit_review/)
  assert.match(text, /real wear: fit: rides up when too tight/)
})

test('auto styling trust blocks low-confidence fit and explicit do-not-auto notes', () => {
  const decision = autoStylingTrustDecision({
    name: 'black pink floral skirt',
    recommendation_status: 'needs_fit_review',
    fit_confidence: 'low',
    engine_notes: 'Too small now; testing whether alteration is worth it. Do not auto-style as a hero piece. OK to explore only when specifically requested.',
  }, { occasion: 'city' })

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('needs fit review'))
  assert.ok(decision.reasons.includes('low fit confidence'))
  assert.ok(decision.reasons.includes('engine notes suppress auto-use'))
})

test('manual fit confidence and city tag override stale AI profile fit and profile confidence', () => {
  const decision = autoStylingTrustDecision({
    name: 'bold multicolor dot peplum top',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    manual_overrides: ['fit_confidence', 'occasions'],
    occasions: ['casual', 'city'],
    style_profile_json: {
      garment_intelligence: {
        auto_use_trust: 'needs_fit_review',
        occasion_confidence: {
          'smart-casual': 'low'
        }
      }
    }
  }, { occasion: 'city_smart_casual' })

  assert.equal(decision.allowed, true)
  assert.equal(decision.reasons.includes('AI profile needs fit review'), false)
  assert.equal(decision.reasons.includes('AI profile low confidence for city_smart_casual'), false)
})

test('auto styling trust does not treat bohemian or folk/artisan as inherently bad', () => {
  const decision = autoStylingTrustDecision({
    name: 'gray folk artisan skirt',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    reads_as: 'folk artisan utilitarian bohemian movement piece',
    style_profile_json: {
      style_lanes: { folk_artisan: 4, modern_bohemian: 3 },
      style_notes: {
        risk: 'strong point of view; needs quiet support',
      },
    },
  }, { occasion: 'city' })

  assert.equal(decision.allowed, true)
  assert.deepEqual(decision.reasons, [])
})

// Spec 26 Part 3: outdoor_daytime_social must not read the tagger's rugged
// `outdoor` confidence strictly — startsWith('outdoor') accidentally
// prefix-collapsed every social outdoor occasion to the same key hiking uses,
// systematically suppressing refined pieces (live DB shape: linen wide-leg
// pants, patchwork top) that carry `outdoor: low` but are fine for a social
// outdoor slot like a winery patio.
test('outdoor_daytime_social reads the best of casual/smart-casual/outdoor (the live 128/260 shape) instead of the strict outdoor key', () => {
  const decision = autoStylingTrustDecision({
    name: 'linen wide-leg pants',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    style_profile_json: {
      garment_intelligence: {
        occasion_confidence: {
          outdoor: 'low',
          casual: 'high'
        }
      }
    }
  }, { occasion: 'outdoor_daytime_social' })

  assert.equal(decision.allowed, true)
  assert.equal(decision.reasons.includes('AI profile low confidence for outdoor_daytime_social'), false)
})

test('outdoor_daytime_social still suppresses when casual/smart-casual/outdoor are all low (gate keeps teeth)', () => {
  const decision = autoStylingTrustDecision({
    name: 'rugged trail top',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    style_profile_json: {
      garment_intelligence: {
        occasion_confidence: {
          outdoor: 'low',
          casual: 'low',
          'smart-casual': 'low'
        }
      }
    }
  }, { occasion: 'outdoor_daytime_social' })

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('AI profile low confidence for outdoor_daytime_social'))
})

test('a plain hiking-flavored outdoor occasion still reads the strict outdoor key', () => {
  const decision = autoStylingTrustDecision({
    name: 'trail sneakers',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    style_profile_json: {
      garment_intelligence: {
        occasion_confidence: {
          outdoor: 'low',
          casual: 'high'
        }
      }
    }
  }, { occasion: 'outdoor_hiking' })

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('AI profile low confidence for outdoor_hiking'), 'plain outdoor occasions must not borrow casual/smart-casual confidence')
})

test('manifest line is compact, carries attributes, trust flags, and low-confidence markers', () => {
  const line = buildWardrobeManifestLine({
    id: 132,
    name: 'cream textured knit top',
    category: 'top',
    reads_as: 'soft cream texture',
    fabric_category: 'knit',
    fabric_weight: 'medium',
    silhouette: 'relaxed',
    length_hits_at: 'hip',
    formality: 'everyday',
    occasions: ['casual', 'city'],
    season: 'warm',
    recommendation_status: 'needs_fit_review',
    fit_confidence: 'low',
    role_permission: 'support_only',
    style_profile_json: {
      _confidence: { silhouette: 'low', fabric_category: 'high' },
    },
  })

  assert.match(line, /^#132 cream textured knit top — /)
  assert.match(line, /fabric knit\/medium/)
  assert.match(line, /silhouette relaxed\?/, 'low-confidence field carries a ? marker')
  assert.match(line, /hits hip/)
  assert.match(line, /formality everyday/)
  assert.match(line, /occ casual\+city/)
  assert.match(line, /season warm/)
  assert.match(line, /\[trust:needs_fit_review fit:low role:support_only\]/)
  assert.equal(line.includes('\n'), false, 'manifest line stays a single line')
})

test('manifest line omits noise for a fully trusted solid piece', () => {
  const line = buildWardrobeManifestLine({
    id: 7,
    name: 'black straight trousers',
    category: 'bottom',
    reads_as: 'quiet dark column',
    pattern_complexity: 'solid',
    fabric_category: 'twill',
    fit_confidence: 'high',
    recommendation_status: 'trusted',
    role_permission: 'auto',
    season: 'year-round',
  })

  assert.match(line, /^#7 black straight trousers — quiet dark column; fabric twill$/)
})

test('manifest line surfaces non-opaque opacity with confidence marker', () => {
  const line = buildWardrobeManifestLine({
    id: 200,
    name: 'cream crochet top',
    category: 'top',
    reads_as: 'open airy texture',
    fabric_category: 'crochet',
    opacity: 'open_weave',
    style_profile_json: { _confidence: { opacity: 'low' } },
  })
  assert.match(line, /opacity open_weave\?/, 'low-confidence opacity carries the ? marker')

  const opaque = buildWardrobeManifestLine({ id: 201, name: 'solid tee', category: 'top', opacity: 'opaque' })
  assert.equal(opaque.includes('opacity'), false, 'opaque is the default and stays silent')
})

// docs/capsule-roster-selection-spec.md §7b: needs_base is readable evidence
// for the model, not engine behaviour — 'yes' surfaces on both truth
// surfaces; unset and an explicit 'no' both stay silent (identical to each
// other today, even though only the second is owner evidence).
test('needs_base surfaces on both truth surfaces only when explicitly yes', () => {
  const manifestYes = buildWardrobeManifestLine({ id: 258, name: 'bold geometric top', category: 'top', needs_base: 'yes' })
  assert.match(manifestYes, /needs base layer/)

  const manifestNo = buildWardrobeManifestLine({ id: 259, name: 'plain top', category: 'top', needs_base: 'no' })
  assert.equal(manifestNo.includes('needs base'), false, 'an explicit no must stay silent, same as unset')

  const manifestUnset = buildWardrobeManifestLine({ id: 260, name: 'other top', category: 'top' })
  assert.equal(manifestUnset.includes('needs base'), false)

  const truthYes = buildWardrobePieceTruthText({ id: 258, name: 'bold geometric top', category: 'top', needs_base: 'yes' })
  assert.match(truthYes, /cannot be worn alone/)

  const truthNo = buildWardrobePieceTruthText({ id: 259, name: 'plain top', category: 'top', needs_base: 'no' })
  assert.equal(truthNo.includes('cannot be worn alone'), false)
})

test('manifest groups by category with counts in deterministic id order', () => {
  const manifest = buildWardrobeManifest([
    { id: 9, name: 'blue tee', category: 'top' },
    { id: 3, name: 'white shirt', category: 'top' },
    { id: 5, name: 'black loafers', category: 'shoes' },
  ], { groupFor: piece => piece.category })

  const topSection = manifest.split('\n\n').find(section => section.startsWith('TOPS (2):'))
  assert.ok(topSection, 'top group carries its count')
  assert.ok(manifest.includes('SHOES (1):'))
  const shirtIndex = topSection.indexOf('#3 white shirt')
  const teeIndex = topSection.indexOf('#9 blue tee')
  assert.ok(shirtIndex !== -1 && teeIndex !== -1 && shirtIndex < teeIndex, 'pieces sorted by id within group')
})
