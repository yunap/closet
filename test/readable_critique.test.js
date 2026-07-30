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

const { formatSharedOutfitEvaluation, CRITIQUE_DETAILS_DELIMITER, wholeWardrobeImagePrompt } = await import('../styling-engine/core.js')
const { buildPrompts } = await import('../styling-engine/prompts.js')
const { db } = await import('../db.js')
const WHOLE_WARDROBE_EVALUATOR_SYSTEM = buildPrompts().WHOLE_WARDROBE_EVALUATOR_SYSTEM
const OUTFIT_EVALUATION_FOLLOWUP_SYSTEM = buildPrompts().OUTFIT_EVALUATION_FOLLOWUP_SYSTEM

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
  assert.match(userRead, /\*\*No change needed\.\*\*/)
  assert.doesNotMatch(userRead, /\*\*Try this:\*\*/)
  assert.doesNotMatch(userRead, /\*\*Check:\*\*/)
})

test('critique followups use a lean answer-only contract without weakening evidence rules', () => {
  assert.match(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /Do not regenerate the full critique/)
  assert.match(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /2-5 concise sentences/)
  assert.match(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /current outfit photo as primary evidence/)
  assert.match(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /linked garment records as authority/)
  assert.match(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /"answer": "direct answer to the follow-up"/)
  assert.doesNotMatch(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /"visibleFacts"\s*:/)
  assert.doesNotMatch(OUTFIT_EVALUATION_FOLLOWUP_SYSTEM, /"detailedCritique"\s*:/)
})

test('purpose-written detailed critique replaces the structured-field fallback', () => {
  const paragraphs = [
    'This outfit starts with a strong contrast between the quiet top and expressive skirt.',
    'The top meets the skirt cleanly at the waist, so their proportions remain easy to read.',
    'The shoe repeats the skirt’s darker note and gives the hem a clear finish.',
    'The only change worth testing is a slightly shorter hem so more of that shoe remains visible.',
  ]
  const result = formatSharedOutfitEvaluation({
    parsed: {
      ...diagnosticRead,
      detailedCritique: paragraphs,
      userCritique: {
        answer: 'Works with one adjustment',
        reason: 'The outfit works, but the hem hides too much of the shoe.',
        action: 'Test a slightly shorter hem.',
        check: 'The shoe should remain visible.',
        occasionNote: '',
      },
    },
  })

  const [, explanation] = result.feedback.split(CRITIQUE_DETAILS_DELIMITER)
  assert.equal(explanation.trim(), paragraphs.join('\n\n'))
  assert.deepEqual(result.evaluation.detailedCritique, paragraphs)
})

test('evaluator prompt requires the readable contract while retaining visible-fact diagnostics', () => {
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /Use this sequence: answer → reason → action → check/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /A keep may simply work/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /Visible facts must include:/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /"userCritique": \{/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /Return exactly four connected paragraph strings/)
  assert.match(WHOLE_WARDROBE_EVALUATOR_SYSTEM, /"detailedCritique": \[/)
  const schema = WHOLE_WARDROBE_EVALUATOR_SYSTEM.slice(WHOLE_WARDROBE_EVALUATOR_SYSTEM.lastIndexOf('JSON shape:'))
  assert.doesNotMatch(schema, /"summary"|"roles"|"scores"|"works"|"risks"|"critiqueProse"|"styleIdea"|"mainSuccess"|"executionGap"/)
})

test('generated outfit image prompt treats garment truth as authoritative over card prose', () => {
  const prompt = wholeWardrobeImagePrompt({
    outfit: {
      label: 'Gallery',
      reason: 'Tuck the shirt into the trousers for a crisp waist.',
    },
    pieces: [{
      name: 'white tailed shirt',
      category: 'top',
      silhouette: 'oversized',
      length_hits_at: 'hip',
      hem_finish: 'design_hem',
      fit_on_body: 'hangs_straight',
      tuck_behavior: 'wear_over_only',
    }],
  })

  assert.match(prompt, /Structured garment fields and reference images are authoritative/)
  assert.match(prompt, /preserve its oversized silhouette; keep its hip length; show its complete design hem; render its fit as hangs straight/)
  assert.match(prompt, /wear it fully outside the bottom waistband, with the complete hem visible and no part tucked in/)
  assert.match(prompt, /Non-authoritative styling intent: Tuck the shirt/)
  assert.match(prompt, /Final render check: the visible outfit must satisfy every authoritative garment-construction direction/)
  assert.doesNotMatch(prompt, /Stylist mechanics:/)
})

test('critique request ranks linked garment truth above generated card rationale', () => {
  const coreSource = fs.readFileSync(new URL('../styling-engine/core.js', import.meta.url), 'utf8')
  assert.match(coreSource, /Card rationale \(non-authoritative styling intent only/)
  assert.match(coreSource, /structured owned-garment truth and the current attached images outrank card titles, reasons/)
  assert.match(coreSource, /before recommending any physical styling action that involves multiple garments/)
  assert.match(coreSource, /capability on one garment cannot override a prohibition or construction constraint on another/)
})
