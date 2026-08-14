import express from 'express'
import fs from 'fs'
import path from 'path'
import { db, userUploadsDir, safeJsonParse } from '../db.js'
import {
  ACTIVE_STYLIST_MODEL,
  AI_PROVIDER,
  askStylistStructuredWithUsage,
  estimateAiUsageCost,
  prepareWardrobeThumb,
} from '../styling-engine/provider.js'
import { pieceVisualDetailPolicy, visuallyPrioritizedPieces } from '../styling-engine/attributes.js'
import {
  buildFeedbackSynthesisPreview,
  compactSynthesisEvidenceRow,
  computeSynthesisApplicabilityOptions,
  estimateImagePixelTokens,
  feedbackSynthesisCall,
  FEEDBACK_SYNTHESIS_DISPOSITIONS,
  sanitizeSynthesisApplicability,
} from '../lib/feedbackSynthesis.js'
import { createDirectProductQualityFinding, resolveProductQualityFinding, syncProductQualityFindingForDraft } from '../lib/productQualityFindings.js'
import { createOwnerConstraint, createOwnerConstraintFromProposal, parseOwnerConstraintRow, setOwnerConstraintStatus } from '../lib/ownerConstraints.js'

// Board images are resized larger than a garment thumb (enough to read overall silhouette/color/
// pattern interplay, not fine texture) but still far below the source render's native resolution.
const BOARD_IMAGE_MAX_PX = 800
// Bounds worst-case cost for a big outfit (accessories, layers): prioritized the same way other
// vision calls in this app already prioritize photo slots (visuallyPrioritizedPieces) — complex/
// hero pieces first, since those are the ones text attributes describe worst.
const MAX_GARMENT_IMAGES_PER_EVIDENCE_ITEM = 4

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
    SELECT id, feedback_type, note, payload, created_at
    FROM stylist_feedback
    WHERE id IN (${placeholders}) AND COALESCE(archived,0) = 0
    ORDER BY id ASC
  `).all(...ids)
}

// Shared by the drafts listing and the PATCH handler so both compute applicability options from
// the exact same, currently-non-archived evidence sanitizeSynthesisApplicability will validate
// against — a checkbox built from anything else could offer a choice the server would reject.
// The card shows the garment a lesson is about, so the option list carries its photo too. Read
// from `pieces` at request time rather than the evidence snapshot: the snapshot preserves what the
// reaction looked like, but the card should show the garment as it is now.
function withPiecePhotos(options) {
  if (!options?.pieces?.length) return options
  const ids = options.pieces.map(piece => piece.id)
  const rows = db.prepare(`SELECT id, name, photo FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
  const byId = new Map(rows.map(row => [row.id, row]))
  return { ...options, pieces: options.pieces.map(piece => ({ ...piece, photo: byId.get(piece.id)?.photo || null })) }
}

// The feedback payload only ever snapshots the lightweight outfit-card shape (id/name/category/
// photo) — sleeve, fit, fabric, reads_as, silhouette and length live on the piece record and were
// never captured there. Hydrate each piece from `pieces` at request time so the synthesis model
// actually sees the garment attributes an owner's reason ("the vest shape", "strange proportions")
// needs to be checked against, instead of always receiving them blank. Cached per call since the
// same piece can appear as both a subject and an otherPieces entry across several feedback rows.
function pieceAttributeHydrator() {
  const cache = new Map()
  return piece => {
    const id = Number(piece?.id)
    if (!id) return piece
    if (!cache.has(id)) {
      cache.set(id, db.prepare(`
        SELECT sleeve_length, sleeve_shape, fit_on_body, fabric_category, reads_as, silhouette, length_hits_at
        FROM pieces WHERE id = ?
      `).get(id) || null)
    }
    const attrs = cache.get(id)
    return attrs ? { ...piece, ...attrs } : piece
  }
}

function sourceEvidenceForDraft(draft) {
  let sourceIds = []
  try { sourceIds = JSON.parse(draft.source_feedback_ids || '[]') } catch { sourceIds = [] }
  return feedbackRows(requestedIds(sourceIds)).map(row => compactSynthesisEvidenceRow(row)).filter(Boolean)
}

// Mirrors the frontend's feedbackBoardImage (StylistSettings.jsx) — the same board.imageUrl the
// owner sees rendered for this reaction is what gets attached here, so the model is looking at
// exactly the image the owner reacted to, not a different render of the same outfit.
function boardImageUrlForRow(row) {
  const payload = typeof row?.payload === 'string' ? (safeJsonParse(row.payload, {}) || {}) : (row?.payload || {})
  return payload?.board?.imageUrl || payload?.board?.image_url || payload?.outfit?.imageUrl || ''
}

function uploadsFilePath(relativeOrFilename) {
  const cleaned = String(relativeOrFilename || '').replace(/^\/?uploads\//, '')
  if (!cleaned) return null
  const filePath = path.join(userUploadsDir(), cleaned)
  return fs.existsSync(filePath) ? filePath : null
}

// Text-only evidence was cheap and safe but visually blind — a claim like "the vest shape doesn't
// work with the cropped top" is a claim about fit/silhouette the text attributes can only
// approximate. Attaches the board render (what the owner actually reacted to) plus photos for the
// referenced garments, each preceded by a text label so the model can tell which evidence/garment
// an image belongs to. Every block carries `_tokenEstimate` for structuredRequestInputTokenUpperBound
// — see feedbackSynthesis.js for why that can't be derived from the block's own (base64) size.
async function imageBlocksForEvidence(evidenceList, rawRowById) {
  const referencedPieceIds = [...new Set(evidenceList.flatMap(item => [
    Number(item?.subject?.id),
    ...(Array.isArray(item?.outfit?.otherPieces) ? item.outfit.otherPieces.map(piece => Number(piece?.id)) : []),
  ]).filter(id => Number.isInteger(id) && id > 0))]
  const pieceRows = referencedPieceIds.length
    ? db.prepare(`
        SELECT id, photo, worn_photo, pattern_complexity, fabric_category, fabric_weight, style_profile_json
        FROM pieces WHERE id IN (${referencedPieceIds.map(() => '?').join(',')})
      `).all(...referencedPieceIds)
    : []
  const pieceById = new Map(pieceRows.map(row => [row.id, { ...row, style_profile_json: safeJsonParse(row.style_profile_json, {}) }]))

  const blocks = []
  for (const item of evidenceList) {
    const rawRow = rawRowById.get(Number(item.evidenceId))
    const boardImageUrl = rawRow ? boardImageUrlForRow(rawRow) : ''
    const boardFilePath = boardImageUrl ? uploadsFilePath(boardImageUrl) : null
    if (boardFilePath) {
      const thumb = await prepareWardrobeThumb(boardFilePath, `synthesis-board:${item.evidenceId}`, { maxPx: BOARD_IMAGE_MAX_PX })
      blocks.push({ type: 'text', text: `Evidence ${item.evidenceId} — the generated outfit image the owner reacted to:` })
      blocks.push({ type: 'image', source: { type: 'base64', ...thumb }, _tokenEstimate: estimateImagePixelTokens(BOARD_IMAGE_MAX_PX) })
    }

    const itemPieceIds = [Number(item?.subject?.id), ...(Array.isArray(item?.outfit?.otherPieces) ? item.outfit.otherPieces.map(piece => Number(piece?.id)) : [])]
      .filter(id => Number.isInteger(id) && id > 0)
    const candidatePieces = itemPieceIds.map(id => pieceById.get(id)).filter(Boolean)
    const prioritized = visuallyPrioritizedPieces(candidatePieces, MAX_GARMENT_IMAGES_PER_EVIDENCE_ITEM)
    for (const piece of prioritized) {
      const photoFile = piece.photo || piece.worn_photo
      const filePath = photoFile ? uploadsFilePath(photoFile) : null
      if (!filePath) continue
      const { maxPx } = pieceVisualDetailPolicy(piece)
      const thumb = await prepareWardrobeThumb(filePath, `synthesis-piece:${item.evidenceId}:${piece.id}`, { maxPx })
      blocks.push({ type: 'text', text: `Evidence ${item.evidenceId} — garment ${piece.id}:` })
      blocks.push({ type: 'image', source: { type: 'base64', ...thumb }, _tokenEstimate: estimateImagePixelTokens(maxPx) })
    }
  }
  return blocks
}

async function previewFor(ids) {
  const rows = feedbackRows(ids)
  const rawRowById = new Map(rows.map(row => [Number(row.id), row]))
  const preview = await buildFeedbackSynthesisPreview(rows, {
    provider: AI_PROVIDER,
    model: ACTIVE_STYLIST_MODEL,
    maxItems: MAX_BATCH,
    hydratePiece: pieceAttributeHydrator(),
    buildImageBlocks: evidence => imageBlocksForEvidence(evidence, rawRowById),
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

router.get('/feedback-synthesis/preview', async (req, res) => {
  try {
    const ids = requestedIds(req.query.ids)
    if (!ids.length) return res.status(400).json({ error: 'Select at least one feedback item.' })
    const preview = await previewFor(ids)
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
      imageCount: preview.imageBlocks.filter(block => block.type === 'image').length,
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
  const preview = await previewFor(ids)
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
      feedbackSynthesisCall(preview.compactInput, preview.outputTokenCap, preview.imageBlocks)
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

    // An "insufficient evidence" result is not a proposal — it is the model reporting that the
    // selected reactions did not contain enough to learn from. Putting it in the decision queue
    // asked the owner to accept or reject a non-result, and the only way to clear it was Reject,
    // which then made it look like a suggestion she had turned down. It is recorded as already
    // reviewed so it never demands a decision; its rationale is still shown as an outcome.
    const insertDraft = db.prepare(`
      INSERT INTO feedback_synthesis_drafts
        (batch_id, disposition, title, proposed_text, boundary, rationale, confidence,
         source_feedback_ids, related_draft_id, status, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          result.disposition === 'insufficient_evidence' ? 'reported' : 'draft',
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
  res.json(drafts.map(draft => ({
    ...draft,
    applicabilityOptions: draft.disposition === 'personal_contextual_lesson'
      ? withPiecePhotos(computeSynthesisApplicabilityOptions(sourceEvidenceForDraft(draft)))
      : null,
  })))
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
  const result = req.body?.useStoredProposal
    ? createOwnerConstraintFromProposal(db, req.body?.sourceFeedbackId, req.body || {})
    : createOwnerConstraint(db, req.body || {})
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
  // 'reported' is terminal and owner-free: it records an outcome the model produced, not a
  // proposal awaiting a decision. It is listed so the PATCH route cannot be used to smuggle a
  // non-result back into the decision queue.
  const allowedStatuses = ['draft', 'accepted', 'deferred', 'rejected', 'retired', 'reported']
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
  const sourceEvidence = sourceEvidenceForDraft(current)
  if (req.body?.applicability !== undefined) {
    const sanitized = current.disposition === 'personal_contextual_lesson'
      ? sanitizeSynthesisApplicability(req.body.applicability, sourceEvidence)
      : null
    // A save that would leave an accepted lesson with no delivery scope is rejected rather than
    // silently persisted — otherwise the row keeps showing as an active, accepted lesson while
    // matching zero requests, with nothing on screen indicating it stopped working. Retiring is the
    // explicit, visible way to deactivate a lesson; editing should never do that as a side effect.
    if (!sanitized && current.disposition === 'personal_contextual_lesson' && status === 'accepted') {
      return res.status(400).json({ error: 'This would leave the lesson with no delivery scope. Select at least one garment or context term, or use Retire instead.' })
    }
    payload.applicability = sanitized
  }
  // Not delivered anywhere — no reader depends on this — but the triage reveal offers a reason
  // without a free-text box for "It applies too broadly" / "This shouldn't be a lesson", and
  // throwing that context away would leave the reject with no trace of what was wrong.
  if (status === 'rejected' && req.body?.rejectionReason !== undefined) {
    payload.rejectionReason = String(req.body.rejectionReason || '').trim().slice(0, 40) || undefined
  }
  db.transaction(() => {
    db.prepare(`
      UPDATE feedback_synthesis_drafts
      SET status = ?, edited_text = ?, boundary = ?, payload = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, editedText, boundary, JSON.stringify(payload), id)
    syncProductQualityFindingForDraft(db, current, { status, editedText })
  })()
  const updated = db.prepare('SELECT * FROM feedback_synthesis_drafts WHERE id = ?').get(id)
  res.json({
    ...updated,
    applicabilityOptions: updated.disposition === 'personal_contextual_lesson'
      ? withPiecePhotos(computeSynthesisApplicabilityOptions(sourceEvidence))
      : null,
  })
})

// Deliberately narrow: only a non-result may be deleted outright. These are model output recording
// that nothing could be learned — removing one loses none of the owner's own data, and the paid
// batch (cost, usage, input hash) and the source reactions are separate records that survive. Any
// other disposition is refused, so this cannot become a way to erase an accepted lesson or a
// decision she made; those retire and stay visible.
router.delete('/feedback-synthesis/drafts/:id', (req, res) => {
  const id = Number(req.params.id)
  const draft = db.prepare('SELECT * FROM feedback_synthesis_drafts WHERE id = ?').get(id)
  if (!draft) return res.status(404).json({ error: 'Draft not found.' })
  if (draft.disposition !== 'insufficient_evidence') {
    return res.status(400).json({ error: 'Only an unusable synthesis result can be removed. Retire the lesson instead.' })
  }
  db.prepare('DELETE FROM feedback_synthesis_drafts WHERE id = ?').run(id)
  res.json({ success: true })
})

export default router
