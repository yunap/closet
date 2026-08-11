export const PRODUCT_FINDING_STATUSES = ['open', 'resolved', 'dismissed']
export const PRODUCT_FINDING_RESOLUTION_TYPES = [
  '', 'shared_rule', 'model_instruction', 'garment_metadata', 'renderer', 'no_change',
]

const parseJson = (value, fallback) => {
  try { return JSON.parse(value || '') } catch { return fallback }
}

function sourceIdsForDraft(draft = {}) {
  return [...new Set((Array.isArray(draft.source_feedback_ids)
    ? draft.source_feedback_ids
    : parseJson(draft.source_feedback_ids, []))
    .map(Number).filter(id => Number.isInteger(id) && id > 0))]
}

export function productFindingEvidenceSnapshot(db, draft = {}) {
  const ids = sourceIdsForDraft(draft)
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  return db.prepare(`
    SELECT id, feedback_type, target_type, context_type, context_id, context_name,
           label, note, payload, created_at
    FROM stylist_feedback WHERE id IN (${placeholders}) ORDER BY id
  `).all(...ids).map(row => {
    const payload = parseJson(row.payload, {}) || {}
    const evidence = payload.feedbackEvidence || null
    const board = payload.board || {}
    const outfit = payload.outfit || {}
    const pieces = (Array.isArray(board.pieces) ? board.pieces : (Array.isArray(outfit.pieces) ? outfit.pieces : []))
      .map(piece => ({
        id: Number(piece?.id) || null,
        name: String(piece?.name || '').trim(),
        category: String(piece?.category || '').trim(),
        photo: String(piece?.photo || '').trim(),
        worn_photo: String(piece?.worn_photo || '').trim(),
        fabric_category: String(piece?.fabric_category || '').trim(),
        sleeve_type: String(piece?.sleeve_type || '').trim(),
        fit_on_body: String(piece?.fit_on_body || '').trim(),
      }))
    return {
      feedback_id: Number(row.id),
      feedback_type: row.feedback_type,
      target_type: row.target_type,
      label: row.label || '',
      note: row.note || '',
      created_at: row.created_at,
      image_url: String(board.imageUrl || board.image_url || payload.imageUrl || '').trim(),
      thread_id: String(evidence?.source?.threadId || payload.threadId || '').trim() || null,
      context: evidence?.context || {
        type: row.context_type || '', id: row.context_id || null, name: row.context_name || '',
      },
      subject: evidence?.subject || null,
      explicit_reason: evidence?.explicitReason || payload.explicitReason || row.note || null,
      pieces,
    }
  })
}

export function syncProductQualityFindingForDraft(db, draft, { status, editedText = '' } = {}) {
  if (draft?.disposition !== 'general_styling_failure') return null
  const draftId = Number(draft.id)
  if (!draftId) return null
  if (status === 'accepted') {
    const evidenceSnapshot = productFindingEvidenceSnapshot(db, draft)
    db.prepare(`
      INSERT INTO product_quality_findings
        (synthesis_draft_id, finding_type, status, title, description, source_feedback_ids, evidence_snapshot)
      VALUES (?, 'general_styling_failure', 'open', ?, ?, ?, ?)
      ON CONFLICT(synthesis_draft_id) DO UPDATE SET
        status = CASE WHEN product_quality_findings.status = 'resolved' THEN 'resolved' ELSE 'open' END,
        title = excluded.title,
        description = excluded.description,
        source_feedback_ids = excluded.source_feedback_ids,
        evidence_snapshot = CASE WHEN excluded.evidence_snapshot = '[]' THEN product_quality_findings.evidence_snapshot ELSE excluded.evidence_snapshot END,
        updated_at = datetime('now')
    `).run(
      draftId,
      draft.title || 'General styling issue',
      editedText || draft.proposed_text || '',
      draft.source_feedback_ids || '[]',
      JSON.stringify(evidenceSnapshot),
    )
  } else if (status === 'rejected' || status === 'retired') {
    db.prepare(`
      UPDATE product_quality_findings
      SET status = CASE WHEN status = 'resolved' THEN status ELSE 'dismissed' END,
          resolution_type = CASE WHEN status = 'resolved' THEN resolution_type ELSE 'no_change' END,
          updated_at = datetime('now')
      WHERE synthesis_draft_id = ?
    `).run(draftId)
  }
  return db.prepare('SELECT * FROM product_quality_findings WHERE synthesis_draft_id = ?').get(draftId) || null
}

export function resolveProductQualityFinding(db, id, { status, resolutionType, resolutionNote } = {}) {
  const current = db.prepare('SELECT * FROM product_quality_findings WHERE id = ?').get(Number(id))
  if (!current) return { error: 'Product-quality finding not found.', statusCode: 404 }
  const nextStatus = status === undefined ? current.status : String(status)
  const nextResolutionType = resolutionType === undefined ? current.resolution_type : String(resolutionType)
  if (!PRODUCT_FINDING_STATUSES.includes(nextStatus)) return { error: `Invalid finding status: ${nextStatus}`, statusCode: 400 }
  if (!PRODUCT_FINDING_RESOLUTION_TYPES.includes(nextResolutionType)) return { error: `Invalid resolution type: ${nextResolutionType}`, statusCode: 400 }
  if (nextStatus === 'resolved' && !nextResolutionType) return { error: 'Resolved findings require a resolution type.', statusCode: 400 }
  const nextResolutionNote = resolutionNote === undefined
    ? current.resolution_note
    : String(resolutionNote || '').trim().slice(0, 1000)
  db.prepare(`
    UPDATE product_quality_findings
    SET status = ?, resolution_type = ?, resolution_note = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(nextStatus, nextResolutionType, nextResolutionNote, Number(id))
  return { finding: db.prepare('SELECT * FROM product_quality_findings WHERE id = ?').get(Number(id)) }
}

export function createDirectProductQualityFinding(db, {
  feedbackId, title, description, confirmProductIssue = false,
} = {}) {
  if (confirmProductIssue !== true) return { error: 'Explicit product-issue confirmation is required.', statusCode: 400 }
  const sourceId = Number(feedbackId)
  if (!Number.isInteger(sourceId) || sourceId <= 0) return { error: 'A valid source feedback ID is required.', statusCode: 400 }
  const source = db.prepare('SELECT id FROM stylist_feedback WHERE id = ?').get(sourceId)
  if (!source) return { error: 'Source feedback was not found.', statusCode: 404 }
  const cleanTitle = String(title || '').trim().slice(0, 140)
  const cleanDescription = String(description || '').trim().slice(0, 600)
  if (!cleanTitle || !cleanDescription) return { error: 'Title and description are required.', statusCode: 400 }

  return db.transaction(() => {
    const batchId = Number(db.prepare(`
      INSERT INTO feedback_synthesis_batches
        (status, feedback_ids, compact_input, input_hash, provider, model,
         estimated_input_tokens, estimated_output_tokens, estimated_cost_usd,
         actual_usage, completed_at)
      VALUES ('completed', ?, '', ?, 'none', 'none', 0, 0, 0, '{}', datetime('now'))
    `).run(JSON.stringify([sourceId]), `direct-product-finding:${sourceId}:${Date.now()}`).lastInsertRowid)
    const result = db.prepare(`
      INSERT INTO feedback_synthesis_drafts
        (batch_id, disposition, title, proposed_text, boundary, rationale, confidence,
         source_feedback_ids, status, payload)
      VALUES (?, 'general_styling_failure', ?, ?, '', ?, 'explicit_owner', ?, 'accepted', ?)
    `).run(
      batchId,
      cleanTitle,
      cleanDescription,
      'The owner explicitly routed this reaction to product review; no model call was made.',
      JSON.stringify([sourceId]),
      JSON.stringify({ direct_product_finding: true, provider_calls: 0 }),
    )
    const draft = db.prepare('SELECT * FROM feedback_synthesis_drafts WHERE id = ?').get(result.lastInsertRowid)
    return { finding: syncProductQualityFindingForDraft(db, draft, { status: 'accepted' }), draft }
  })()
}
