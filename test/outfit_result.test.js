import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dispositionForOutfit,
  normalizeDeliveredOutfit,
  normalizeOutfitResult,
} from '../styling-engine/outfitResult.js'
import {
  categoryOutfitStructurePromptRule,
  projectOutfitValidationFindings,
  roleOutfitStructurePromptRule,
} from '../styling-engine/outfitValidation.js'

test('normalized outfit result keeps one disposition and provenance contract', () => {
  const result = normalizeOutfitResult({ label: 'Look', source: 'model' }, {
    disposition: 'annotated',
    findings: [{ code: 'unknown_fit', message: 'Fit needs visual review', severity: 'warning' }],
    annotations: [{ type: 'fit', message: 'Check fit.' }],
    provenance: { flow: 'whole_wardrobe_visual', composedBy: 'model', stage: 'advisor_gate' },
  })

  assert.equal(result.result.version, 1)
  assert.equal(result.result.disposition, 'annotated')
  assert.deepEqual(result.result.provenance, {
    flow: 'whole_wardrobe_visual',
    source: 'model',
    composedBy: 'model',
    stage: 'advisor_gate',
  })
  assert.equal(result.result.findings[0].code, 'unknown_fit')
  assert.equal(result.broken, undefined)
})

test('repairable and rejected results retain legacy card aliases without changing semantics', () => {
  const repairable = normalizeOutfitResult({ label: 'Needs review' }, {
    disposition: 'repairable',
    findings: ['missing shoes'],
    repair: { operation: 'complete', action: 'repair_capsule_look' },
  })
  assert.equal(repairable.broken, true)
  assert.equal(repairable.diagnosticOnly, undefined)
  assert.equal(repairable.rejectionReason, 'missing shoes')
  assert.equal(repairable.result.repair.operation, 'complete')

  const rejected = normalizeDeliveredOutfit({ broken: true, diagnosticOnly: true, rejectionReason: 'visual critic: clash' })
  assert.equal(rejected.result.disposition, 'rejected')
  assert.equal(dispositionForOutfit(rejected), 'rejected')
})

test('prompt projections serialize the canonical structure and typed findings', () => {
  assert.match(categoryOutfitStructurePromptRule({ strictSingleTop: true, maxOuterwear: 1, allowAccessories: false }), /EXACTLY one top AND one bottom, OR exactly one dress/)
  assert.match(categoryOutfitStructurePromptRule(), /additional top with a dress is allowed only as an intentional layer/)
  assert.match(roleOutfitStructurePromptRule(), /primary_top \+ primary_bottom/)
  assert.equal(projectOutfitValidationFindings([{ code: 'missing_shoes', message: 'missing shoes' }]), 'Validation findings:\n- [missing_shoes] missing shoes')
})
