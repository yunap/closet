import test from 'node:test'
import assert from 'node:assert/strict'

import { FEEDBACK_BEHAVIOURS, feedbackBehaviour } from '../lib/feedbackTaxonomy.js'

test('feedback routing assigns one primary behavioural reader to each reaction family', () => {
  const cases = [
    [{ feedback_type: 'owner_rule', target_type: 'message' }, FEEDBACK_BEHAVIOURS.OWNER_PROMPT],
    [{ feedback_type: 'preference_reaction', target_type: 'message' }, FEEDBACK_BEHAVIOURS.OWNER_PROMPT],
    [{ feedback_type: 'works', target_type: 'generated_visual_board' }, FEEDBACK_BEHAVIOURS.STYLING_PROMPT],
    [{ feedback_type: 'style_direction', target_type: 'generated_visual_board' }, FEEDBACK_BEHAVIOURS.STYLING_PROMPT],
    [{ feedback_type: 'too_soft', target_type: 'whole_wardrobe_outfit' }, FEEDBACK_BEHAVIOURS.STYLING_PROMPT],
    [{ feedback_type: 'wrong_item_read', target_type: 'whole_wardrobe_outfit' }, FEEDBACK_BEHAVIOURS.DISPLAY_ONLY],
    [{ feedback_type: 'wrong_item_read', target_type: 'whole_wardrobe_outfit', payload: JSON.stringify({ feedbackEvidence: { version: 2, action: 'wrong_piece_for_outfit', subject: { pieceId: 42 } } }) }, FEEDBACK_BEHAVIOURS.PROVISIONAL_CONTEXT],
    [{ feedback_type: 'wrong_item_read', target_type: 'whole_wardrobe_outfit', payload: JSON.stringify({ scopedEvidence: { version: 1, kind: 'garment_context_suitability', subjectPieceId: null } }) }, FEEDBACK_BEHAVIOURS.DISPLAY_ONLY],
    [{ feedback_type: 'wrong_length', target_type: 'generated_visual_board' }, FEEDBACK_BEHAVIOURS.RENDERER],
    [{ feedback_type: 'wrong_proportions', target_type: 'generated_visual_board' }, FEEDBACK_BEHAVIOURS.RENDERER],
    [{ feedback_type: 'proportion_problem', target_type: 'message' }, FEEDBACK_BEHAVIOURS.RENDERER],
    [{ feedback_type: 'catalog_drift', target_type: 'generated_visual_board' }, FEEDBACK_BEHAVIOURS.STYLING_PROMPT],
    [{ feedback_type: 'bad_reference', target_type: 'generated_visual_board' }, FEEDBACK_BEHAVIOURS.RENDERER],
    [{ feedback_type: 'works', target_type: 'renderer_calibration' }, FEEDBACK_BEHAVIOURS.RETIRED],
    [{ feedback_type: 'unclassified_legacy_type', target_type: 'piece' }, FEEDBACK_BEHAVIOURS.DISPLAY_ONLY],
  ]

  for (const [row, expected] of cases) assert.equal(feedbackBehaviour(row), expected)
})

test('generic score authority is not part of the feedback routing taxonomy', () => {
  assert.equal(Object.hasOwn(FEEDBACK_BEHAVIOURS, 'SCORE'), false)
  assert.equal(Object.values(FEEDBACK_BEHAVIOURS).includes('score'), false)
  assert.equal(Object.values(FEEDBACK_BEHAVIOURS).includes('context_score'), false)
})
