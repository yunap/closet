import express from 'express'
import { db } from '../db.js'
import {
  ACTIVE_STYLIST_MODEL,
  AI_PROVIDER,
  askStylistStructuredWithUsage,
  estimateAiUsageCost,
} from '../styling-engine/provider.js'
import {
  buildFeedbackSynthesisPreview,
  compactSynthesisEvidenceRow,
  feedbackSynthesisCall,
  FEEDBACK_SYNTHESIS_DISPOSITIONS,
  sanitizeSynthesisApplicability,
} from '../lib/feedbackSynthesis.js'
import { createDirectProductQualityFinding, resolveProductQualityFinding, syncProductQualityFindingForDraft } from '../lib/productQualityFindings.js'
import { createOwnerConstraint, parseOwnerConstraintRow, setOwnerConstraintStatus } from '../lib/ownerConstraints.js'

const router = express.Router()
const MAX_BATCH = 12

function requestedIds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(values.map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, MAX_BATCH)
}

function feedbackRows(ids) {
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  return db.prepare(`
    SELECT id, feedback_type, note, payload
    FROM stylist_feedback
    WHERE id IN (${placeholders}) AND COALESCE(archived,0) = 0
    ORDER BY id ASC
  `).all(...ids)
}

function previewFor(ids) {
  const preview = buildFeedbackSynthesisPreview(feedbackRows(ids), {
    provider: AI_PROVIDER,
    model: ACTIVE_STYLIST_MODEL,
    maxItems: MAX_BATCH,
  })
  const cost = estimateAiUsageCost({
    provider: AI_PROVIDER,
    model: ACTIVE_STYLIST_MODEL,
    inputTokens: preview.estimatedInputTokens,
    outputTokens: preview.estimatedOutputTokens,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  })
  return { ...preview, estimatedCost: cost }
}

router.get('/feedback-synthesis/preview', (req, res) => {
  try {
    const ids = requestedIds(req.query.ids)
    if (!ids.length) return res.status(400).json({ error: 'Select at least one feedback item.' })
    const preview = previewFor(ids)
    if (!preview.feedbackIds.length) return res.status(400).json({ error: 'No eligible provisional feedback was selected.' })
    res.json({
      feedbackIds: preview.feedbackIds,
      evidence: preview.evidence,
      inputHash: preview.inputHash,
      provider: preview.provider,
      model: preview.model,
      estimatedInputTokens: preview.estimatedInputTokens,
      estimatedOutputTokens: preview.estimatedOutputTokens,
      outputTokenCap: preview.outputTokenCap,
      estimatedCost: preview.estimatedCost,
      providerCalls: 0,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/feedback-synthesis/batches', async (req, res) => {
  const ids = requestedIds(req.body?.feedbackIds)
  if (req.body?.authorize !== true) return res.status(400).json({ error: 'Explicit authorization is required.' })
  if (!ids.length) return res.status(400).json({ error: 'Select at least one feedback item.' })
  const preview = previewFor(ids)
  if (!preview.feedbackIds.length) return res.status(400).json({ error: 'No eligible provisional feedback was selected.' })
  if (!req.body?.inputHash || req.body.inputHash !== preview.inputHash) {
    return res.status(409).json({ error: 'The synthesis preview changed. Review the updated cost before authorizing.' })
  }

  const batchResult = db.prepare(`
    INSERT INTO feedback_synthesis_batches
      (status, feedback_ids, compact_input, input_hash, provider, model,
       estimated_input_tokens, estimated_output_tokens, estimated_cost_usd)
    VALUES ('authorized', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    JSON.stringify(preview.feedbackIds),
    preview.compactInput,
    preview.inputHash,
    preview.provider,
    preview.model,
    preview.estimatedInputTokens,
    preview.estimatedOutputTokens,
    preview.estimatedCost?.estimatedUsd ?? null,
  )
  const batchId = Number(batchResult.lastInsertRowid)

  try {
    db.prepare("UPDATE feedback_synthesis_batches SET status = 'processing' WHERE id = ?").run(batchId)
    const { value, usage } = await askStylistStructuredWithUsage(
      feedbackSynthesisCall(preview.compactInput, preview.outputTokenCap)
    )
    const allowedIds = new Set(preview.feedbackIds)
    const evidenceById = new Map(preview.evidence.map(item => [Number(item.evidenceId), item]))
    const coveredIds = new Set()
    const validResults = (Array.isArray(value?.results) ? value.results : []).map(result => {
      const sourceIds = [...new Set((result?.source_feedback_ids || []).map(Number)
        .filter(id => allowedIds.has(id)))]
      sourceIds.forEach(id => coveredIds.add(id))
      const sourceEvidence = sourceIds.map(id => evidenceById.get(id)).filter(Boolean)
      const evidenceKinds = new Set(sourceEvidence.map(item => item.evidenceKind))
      const mixedEvidenceKinds = evidenceKinds.size > 1
      const disposition = !mixedEvidenceKinds && FEEDBACK_SYNTHESIS_DISPOSITIONS.includes(result?.disposition)
        ? result.disposition
        : 'insufficient_evidence'
      const positiveLogicResult = evidenceKinds.size === 1 &&
        (evidenceKinds.has('positive_outfit_logic') || evidenceKinds.has('legacy_positive_board'))
      const requestedApplicability = positiveLogicResult
        ? { ...(result?.applicability || {}), scope: 'context', piece_ids: [] }
        : result?.applicability
      return {
        ...result,
        source_feedback_ids: sourceIds,
        disposition,
        applicability: disposition === 'personal_contextual_lesson'
          ? sanitizeSynthesisApplicability(requestedApplicability, sourceEvidence)
          : null,
      }
    }).filter(result => result.source_feedback_ids.length)
    for (const id of preview.feedbackIds) {
      if (coveredIds.has(id)) continue
      validResults.push({
        source_feedback_ids: [id],
        disposition: 'insufficient_evidence',
        title: 'No safe lesson proposed',
        proposed_text: '',
        boundary: 'The original reaction remains evidence but did not yield a safe transferable lesson.',
        rationale: 'The synthesis response did not return a supported proposal for this evidence.',
        confidence: 'insufficient',
        related_draft_id: 0,
        applicability: null,
      })
    }

    const insertDraft = db.prepare(`
      INSERT INTO feedback_synthesis_drafts
        (batch_id, disposition, title, proposed_text, boundary, rationale, confidence,
         source_feedback_ids, related_draft_id, status, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
    `)
    db.transaction(() => {
      for (const result of validResults) {
        insertDraft.run(
          batchId,
          result.disposition,
          String(result.title || '').trim(),
          String(result.proposed_text || '').trim(),
          String(result.boundary || '').trim(),
          String(result.rationale || '').trim(),
          String(result.confidence || '').trim(),
          JSON.stringify(result.source_feedback_ids),
          Number(result.related_draft_id) || null,
          JSON.stringify(result),
        )
      }
      db.prepare(`
        UPDATE feedback_synthesis_batches
        SET status = 'completed', actual_usage = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(usage || {}), batchId)
    })()
    const drafts = db.prepare('SELECT * FROM feedback_synthesis_drafts WHERE batch_id = ? ORDER BY id').all(batchId)
    res.json({ batchId, status: 'completed', usage, estimatedCost: estimateAiUsageCost(usage), drafts })
  } catch (err) {
    db.prepare(`
      UPDATE feedback_synthesis_batches
      SET status = 'failed', error = ?, actual_usage = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(String(err.message || err), JSON.stringify(err.usage || {}), batchId)
    res.status(502).json({ error: err.message, batchId, status: 'failed' })
  }
})

router.get('/feedback-synthesis/drafts', (req, res) => {
  const drafts = db.prepare(`
    SELECT d.*, b.provider, b.model, b.status AS batch_status
    FROM feedback_synthesis_drafts d
    JOIN feedback_synthesis_batches b ON b.id = d.batch_id
    ORDER BY d.id DESC
    LIMIT 200
  `).all()
  res.json(drafts)
})

router.get('/product-quality-findings', (req, res) => {
  const findings = db.prepare(`
    SELECT finding.*, draft.boundary, draft.rationale, draft.confidence
    FROM product_quality_findings finding
    JOIN feedback_synthesis_drafts draft ON draft.id = finding.synthesis_draft_id
    ORDER BY CASE finding.status WHEN 'open' THEN 0 ELSE 1 END, finding.id DESC
    LIMIT 200
  `).all()
  res.json(findings)
})

router.post('/product-quality-findings/from-feedback', (req, res) => {
  const result = createDirectProductQualityFinding(db, req.body || {})
  if (result.error) return res.status(result.statusCode).json({ error: result.error })
  res.status(201).json({ finding: result.finding, draft: result.draft, providerCalls: 0 })
})

router.patch('/product-quality-findings/:id', (req, res) => {
  const result = resolveProductQualityFinding(db, req.params.id, req.body || {})
  if (result.error) return res.status(result.statusCode).json({ error: result.error })
  res.json(result.finding)
})

router.get('/owner-constraints', (_req, res) => {
  res.json(db.prepare('SELECT * FROM owner_constraints ORDER BY id DESC').all().map(parseOwnerConstraintRow))
})

router.post('/owner-constraints', (req, res) => {
  const result = createOwnerConstraint(db, req.body || {})
  if (result.error) return res.status(result.statusCode).json({ error: result.error })
  res.status(201).json({ ...result.constraint, selector_values: JSON.parse(result.constraint.selector_values), context_values: JSON.parse(result.constraint.context_values) })
})

router.patch('/owner-constraints/:id', (req, res) => {
  const result = setOwnerConstraintStatus(db, req.params.id, String(req.body?.status || ''))
  if (result.error) return res.status(result.statusCode).json({ error: result.error })
  res.json(parseOwnerConstraintRow(result.constraint))
})

router.patch('/feedback-synthesis/drafts/:id', (req, res) => {
  const id = Number(req.params.id)
  const current = db.prepare('SELECT * FROM feedback_synthesis_drafts WHERE id = ?').get(id)
  if (!current) return res.status(404).json({ error: 'Draft not found.' })
  const allowedStatuses = ['draft', 'accepted', 'deferred', 'rejected', 'retired']
  if (req.body?.status !== undefined && !allowedStatuses.includes(req.body.status)) {
    return res.status(400).json({ error: `Invalid draft status: ${req.body.status}` })
  }
  const status = req.body?.status ?? current.status
  const editedText = req.body?.editedText === undefined
    ? current.edited_text
    : String(req.body.editedText || '').trim().slice(0, 600)
  const boundary = req.body?.boundary === undefined
    ? current.boundary
    : String(req.body.boundary || '').trim().slice(0, 300)
  let payload = {}
  try { payload = JSON.parse(current.payload || '{}') || {} } catch { payload = {} }
  if (req.body?.applicability !== undefined) {
    let sourceIds = []
    try { sourceIds = JSON.parse(current.source_feedback_ids || '[]') } catch { sourceIds = [] }
    const sourceEvidence = feedbackRows(requestedIds(sourceIds)).map(compactSynthesisEvidenceRow).filter(Boolean)
    payload.applicability = current.disposition === 'personal_contextual_lesson'
      ? sanitizeSynthesisApplicability(req.body.applicability, sourceEvidence)
      : null
  }
  db.transaction(() => {
    db.prepare(`
      UPDATE feedback_synthesis_drafts
      SET status = ?, edited_text = ?, boundary = ?, payload = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, editedText, boundary, JSON.stringify(payload), id)
    syncProductQualityFindingForDraft(db, current, { status, editedText })
  })()
  res.json(db.prepare('SELECT * FROM feedback_synthesis_drafts WHERE id = ?').get(id))
})

export default router
