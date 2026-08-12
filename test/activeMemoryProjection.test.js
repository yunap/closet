import test from 'node:test'
import assert from 'node:assert/strict'
import { activeMemoryMetadata } from '../lib/activeMemory.js'

test('legacy owner rules disclose their broad compatibility delivery without claiming a hard gate', () => {
  assert.deepEqual(activeMemoryMetadata({
    feedback_type: 'owner_rule',
    target_type: 'message',
  }), {
    destination: 'owner_prompt',
    source: 'Stylist chat',
    scope: 'Legacy broad delivery',
    effect: 'Guides the stylist when its saved applicability matches; it is not a deterministic gate or score.',
    strength: 'standing',
  })
})

test('new owner guidance projects its executable scope and withholds unresolved rows', () => {
  const scoped = activeMemoryMetadata({
    feedback_type: 'owner_rule',
    target_type: 'message',
    payload: { ownerGuidanceApplicability: {
      version: 1,
      reach: 'garment_context',
      garment: { footwear: ['sandals'] },
      context: { activities: ['hiking'] },
    } },
  })
  assert.equal(scoped.scope, 'Matching garments and situations')
  assert.equal(scoped.strength, 'standing')

  const unresolved = activeMemoryMetadata({
    feedback_type: 'owner_rule',
    target_type: 'message',
    payload: { ownerGuidanceApplicability: { version: 1, reach: 'unresolved' } },
  })
  assert.equal(unresolved.scope, 'Needs scope review')
  assert.equal(unresolved.strength, 'review')
  assert.match(unresolved.effect, /does not currently reach styling prompts/)
})

test('Style Profile receives only server-validated firm-rule proposals', () => {
  const supported = activeMemoryMetadata({
    id: 10,
    feedback_type: 'owner_rule',
    target_type: 'message',
    payload: { ownerConstraintProposal: {
      version: 1,
      selectorType: 'footwear',
      selectorValues: ['boots'],
      contextDimension: 'season',
      contextValues: ['summer'],
      reason: "Don't suggest boots in summer.",
    } },
  })
  assert.equal(supported.ownerConstraintProposal.selectorType, 'footwear')

  const unavailable = activeMemoryMetadata({
    id: 11,
    feedback_type: 'owner_rule',
    target_type: 'message',
    payload: { ownerConstraintProposal: {
      version: 1,
      selectorType: 'category',
      selectorValues: ['dress'],
      contextDimension: 'activity',
      contextValues: ['airplane travel'],
      reason: "Don't suggest dresses for airplane travel.",
    } },
  })
  assert.equal(unavailable.ownerConstraintProposal, undefined)
})

test('garment rule receipts disclose that they are display-only projections', () => {
  const memory = activeMemoryMetadata({
    feedback_type: 'piece_rule_receipt',
    target_type: 'piece',
    context_id: 242,
    context_name: 'beige tailored linen shorts',
  })
  assert.equal(memory.destination, 'display_only')
  assert.equal(memory.scope, 'Garment: beige tailored linen shorts')
  assert.match(memory.effect, /editable projection/)
})

test('wrong-item evidence is provisional context rather than a score or standing preference', () => {
  const memory = activeMemoryMetadata({
    feedback_type: 'wrong_item_read',
    target_type: 'whole_wardrobe_outfit',
    payload: {
      feedbackEvidence: {
        version: 2,
        action: 'wrong_piece_for_outfit',
        subject: { pieceId: 18, name: 'Canvas sneakers' },
        context: { outfitLabel: 'Museum walk', occasion: 'city', activity: 'walking' },
        explicitReason: 'Canvas absorbs water.',
      },
    },
  })
  assert.equal(memory.destination, 'provisional_context')
  assert.equal(memory.strength, 'provisional')
  assert.equal(memory.scope, 'Outfit context: city · walking')
  assert.match(memory.effect, /not a score or standing preference/)
  assert.equal(memory.synthesisEligible, true)
})

test('reasonless wrong-choice evidence has exact-outfit meaning but no synthesis eligibility', () => {
  const memory = activeMemoryMetadata({
    feedback_type: 'wrong_item_read',
    target_type: 'whole_wardrobe_outfit',
    payload: { feedbackEvidence: {
      version: 2,
      action: 'wrong_piece_for_outfit',
      subject: { pieceId: 18, name: 'Canvas sneakers' },
      context: { outfitLabel: 'Museum walk' },
    } },
  })
  assert.equal(memory.destination, 'provisional_context')
  assert.equal(memory.synthesisEligible, false)
  assert.match(memory.effect, /exact garment-and-outfit combination/)
})

test('renderer corrections cannot be presented as styling authority', () => {
  const memory = activeMemoryMetadata({
    feedback_type: 'body_proportions_drift',
    target_type: 'generated_visual_board',
  })
  assert.equal(memory.destination, 'renderer')
  assert.equal(memory.scope, 'Image generation only')
  assert.match(memory.effect, /does not influence garment or outfit selection/)
})

test('positive outfit logic remains contextual provenance but is not synthesis eligible while reinforcement is unresolved', () => {
  const memory = activeMemoryMetadata({
    feedback_type: 'works',
    target_type: 'whole_wardrobe_outfit',
    payload: {
      scopedEvidence: {
        version: 1,
        kind: 'outfit_logic',
        logic: { formula: 'compact top + flowing bottom' },
        context: { occasion: 'city', mood: 'artistic' },
      },
    },
  })
  assert.equal(memory.destination, 'display_only')
  assert.equal(memory.scope, 'Styling context: city · artistic')
  assert.match(memory.effect, /does not steer garment or formula selection/)
  assert.equal(memory.synthesisEligible, false)
})

test('legacy positive reactions without structured outfit logic are not synthesis eligible', () => {
  const memory = activeMemoryMetadata({
    feedback_type: 'works',
    target_type: 'whole_wardrobe_outfit',
    payload: {},
  })
  assert.equal(memory.destination, 'display_only')
  assert.equal(memory.synthesisEligible, false)
})

test('classified legacy board snapshots are not synthesis eligible while positive learning is paused', () => {
  const memory = activeMemoryMetadata({
    feedback_type: 'works',
    target_type: 'generated_visual_board',
    payload: {
      scopedEvidence: {
        version: 1,
        kind: 'legacy_outfit_snapshot',
        verdict: 'works',
        snapshot: { explanation: 'A compact upper half balances a long base.', pieces: [] },
        context: { occasion: 'city' },
      },
    },
  })
  assert.equal(memory.destination, 'display_only')
  assert.equal(memory.synthesisEligible, false)
})
