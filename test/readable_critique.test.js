import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-readable-critique-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { formatSharedOutfitEvaluation, CRITIQUE_DETAILS_DELIMITER } = await import('../styling-engine/core.js')
const { buildPrompts } = await import('../styling-engine/prompts.js')
const { db } = await import('../db.js')
const WHOLE_WARDROBE_EVALUATOR_SYSTEM = buildPrompts().WHOLE_WARDROBE_EVALUATOR_SYSTEM

after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const diagnosticRead = {
  visibleFacts: {
    floorLine: 'the pant hem covers most of the shoe',
    proportionRead: 'the long trouser line works until the fabric pools at the floor',
  },
  inferredIntent: {
    label: 'relaxed city tailoring',
    successCriteria: ['a long trouser line with a readable shoe'],
  },
  evaluation: {
    summary: 'The outfit idea works, but the hem needs one adjustment.',
    verdict: 'revise',
    firstVisibleIssue: 'the pant hem swallows the shoe',
    executionGap: 'floor-line pooling',
    scores: { silhouetteIntegrity: 3 },
  },
  recommendation: {
    smallestAdjustment: 'Adjust the pant hem enough to reveal the shoe.',
  },
}

test('readable critique leads with answer, reason, action, and an observable check', () => {
  const result = formatSharedOutfitEvaluation({
    parsed: {
      ...diagnosticRead,
      userCritique: {
        answer: 'Works with one adjustment',
        reason: 'The fitted top gives the wide trousers a clear upper edge, but the pooled hem hides the shoes.',
        action: 'Pin or cuff the trousers to the length you would actually wear.',
        check: 'Look for the shoes to become readable without breaking the long trouser line.',
        occasionNote: '',
      },
    },
  })

  const [userRead, diagnosticDetails] = result.feedback.split(CRITIQUE_DETAILS_DELIMITER)
  assert.match(userRead, /^\*\*Works with one adjustment\.\*\*/)
  assert.match(userRead, /\*\*Try this:\*\* Pin or cuff the trousers/)
  assert.match(userRead, /\*\*Check:\*\* Look for the shoes/)
  assert.doesNotMatch(userRead, /Verdict:|execution gap|silhouette integrity|Scores:/i)
  assert.match(diagnosticDetails, /Visible facts:/)
  assert.match(diagnosticDetails, /Floor line: the pant hem covers most of the shoe/)
  assert.equal(result.evaluation.userCritique.action, 'Pin or cuff the trousers to the length you would actually wear.')
})

test('a successful outfit may say no change needed without manufacturing an issue', () => {
  const result = formatSharedOutfitEvaluation({
    parsed: {
      ...diagnosticRead,
      evaluation: {
        ...diagnosticRead.evaluation,
        verdict: 'keep',
        firstVisibleIssue: 'none',
        executionGap: 'none',
      },
      recommendation: {
        smallestAdjustment: 'No change needed.',
        tryNext: '',
      },
      userCritique: {
        answer: 'Works',
        reason: 'The fitted top and wide trousers already create a clear, easy proportion.',
        action: 'No change needed.',
        check: '',
        occasionNote: '',
      },
    },
  })

  const [userRead] = result.feedback.split(CRITIQUE_DETAILS_DELIMITER)
  assert.match(userRead, /^\*\*Works\.\*\*/)
  assert.match(userRead, /\*\*Try this:\*\* No change needed\./)
  assert.doesNotMatch(userRead, /\*\*Check:\*\*/)
})

test('evaluator prompt requires the readable contract while retaining visible-fact diagnostics', () => {
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /Use this sequence: answer → reason → action → check/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /A keep may simply work/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /Visible facts must include:/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /"userCritique": \{/)
})
