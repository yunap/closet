// Spec 32 Part 2's edit surface: the style constitution is per-user DATA, and the user
// reading what their stylist believes about them — and correcting it directly — is the
// product's core loop. Every save appends the prior text to constitution_history (the
// ruling-archaeology log); the interviewable layers link back into the wizard for a re-run.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { WRONG_PIECE_FOR_OUTFIT_FEEDBACK } from '../../lib/feedbackTaxonomy.js'

const LAYER_TITLES = {
  body_contract: 'Layer 1 — Body & Comfort Contract',
  proven_formulas: 'Layer 2 — Proven Formulas',
  aesthetic_gravity: 'Layer 3 — Aesthetic Gravity',
  lane_neutrality: 'Layer 4 — Style Lanes',
  working_style: 'Working Style',
  editorial_subject: 'Image Generation — Subject',
  editorial_shoes: 'Image Generation — Shoe Rules'
}
const LAYER_META = {
  body_contract: ['Foundation', 'Comfort, fit, movement, and maintenance requirements.'],
  proven_formulas: ['What works', 'Outfit formulas earned from looks you have confirmed.'],
  aesthetic_gravity: ['Preferences', 'The visual qualities you tend to favor, without limiting your range.'],
  lane_neutrality: ['Style range', 'How the stylist explores different moods without drifting into caricature.'],
  working_style: ['Collaboration', 'How you want the stylist to communicate, ask, and respond.'],
  editorial_subject: ['Rendered person', 'How you should appear in generated outfit imagery.'],
  editorial_shoes: ['Rendered footwear', 'How footwear should be handled in generated imagery.'],
}
const PERSONAL_STYLE_LAYERS = new Set(['body_contract', 'proven_formulas', 'aesthetic_gravity', 'lane_neutrality', 'working_style'])
const IMAGE_STYLE_LAYERS = new Set(['editorial_subject', 'editorial_shoes'])
const INTERVIEW_STEPS = { body_contract: 'comfort', aesthetic_gravity: 'aesthetic', working_style: 'working' }
// The durable learned classes: rules the stylist stored from conversations
// (store_user_correction → owner_rule; persisted preference reactions). Card-level
// taste feedback stays in the chat's context-scoped Learning panel.
const isStandingLearning = row => row.feedback_type === 'owner_rule' ||
  row.feedback_type === 'piece_rule_receipt' ||
  (row.feedback_type === 'preference_reaction' && row.target_type === 'message')
// Raw feedback_type values are adequate filter text but not user-facing card labels.
const FEEDBACK_TYPE_DISPLAY_LABELS = {
  [WRONG_PIECE_FOR_OUTFIT_FEEDBACK]: 'Wrong choice for this outfit',
}
const feedbackTypeDisplayLabel = (rowOrType) => {
  const type = typeof rowOrType === 'object' ? rowOrType?.feedback_type : rowOrType
  return FEEDBACK_TYPE_DISPLAY_LABELS[type] || String(type || '').replaceAll('_', ' ')
}
const CONTEXT_FILTERS = [
  ['all', 'All'],
  ['outfit', 'Outfits'],
  ['board', 'Generated boards'],
]
const FEEDBACK_PAGE_SIZE = 40
const SYNTHESIS_DISPOSITION_LABELS = {
  personal_contextual_lesson: 'Personal or contextual lesson',
  garment_fact_correction: 'Garment fact correction',
  general_styling_failure: 'General styling issue',
  duplicate_or_refinement: 'Duplicate or refinement',
  insufficient_evidence: 'Not enough evidence',
}
const parsedIdList = value => {
  if (Array.isArray(value)) return value.map(Number).filter(Boolean)
  try { return JSON.parse(value || '[]').map(Number).filter(Boolean) } catch { return [] }
}
const effectiveSynthesisText = draft => String(draft?.edited_text || draft?.proposed_text || '')
const effectiveSynthesisBoundary = draft => String(draft?.boundary || '')
const parsedDraftPayload = draft => {
  if (draft?.payload && typeof draft.payload === 'object') return draft.payload
  try { return JSON.parse(draft?.payload || '{}') || {} } catch { return {} }
}
const synthesisApplicability = draft => {
  const value = parsedDraftPayload(draft)?.applicability || {}
  return {
    version: 1,
    scope: ['piece', 'context', 'piece_context'].includes(value.scope) ? value.scope : 'piece_context',
    piece_ids: parsedIdList(value.piece_ids),
    occasions: Array.isArray(value.occasions) ? value.occasions : [],
    activities: Array.isArray(value.activities) ? value.activities : [],
    seasons: Array.isArray(value.seasons) ? value.seasons : [],
    weather_terms: Array.isArray(value.weather_terms) ? value.weather_terms : [],
  }
}
const normalizedApplicability = value => ({
  ...value,
  version: 1,
  piece_ids: parsedIdList(value?.piece_ids),
  occasions: (value?.occasions || []).map(String).map(item => item.trim()).filter(Boolean),
  activities: (value?.activities || []).map(String).map(item => item.trim()).filter(Boolean),
  seasons: (value?.seasons || []).map(String).map(item => item.trim()).filter(Boolean),
  weather_terms: (value?.weather_terms || []).map(String).map(item => item.trim()).filter(Boolean),
})
const applicabilityEqual = (left, right) => JSON.stringify(normalizedApplicability(left)) === JSON.stringify(normalizedApplicability(right))
const applicabilityIsUsable = value => {
  const normalized = normalizedApplicability(value)
  const hasPiece = normalized.piece_ids.length > 0
  const hasContext = Boolean(normalized.occasions.length || normalized.activities.length || normalized.seasons.length || normalized.weather_terms.length)
  if (normalized.scope === 'piece') return hasPiece
  if (normalized.scope === 'context') return hasContext
  return normalized.scope === 'piece_context' && hasPiece && hasContext
}
const commaList = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean)

function SynthesisApplicabilityEditor({ sources, value, onChange }) {
  const sourcePieces = new Map()
  for (const source of sources) {
    let sourcePayload = source?.payload || {}
    if (typeof sourcePayload === 'string') {
      try { sourcePayload = JSON.parse(sourcePayload) || {} } catch { sourcePayload = {} }
    }
    const evidence = sourcePayload.feedbackEvidence || {}
    const subject = evidence?.subject
    if (Number(subject?.pieceId)) sourcePieces.set(Number(subject.pieceId), subject.pieceName || source.context_name || `Piece #${subject.pieceId}`)
    const outfitPieces = Array.isArray(sourcePayload?.outfit?.pieces)
      ? sourcePayload.outfit.pieces
      : Array.isArray(sourcePayload?.pieces) ? sourcePayload.pieces : []
    for (const piece of outfitPieces) if (Number(piece?.id)) sourcePieces.set(Number(piece.id), piece.name || `Piece #${piece.id}`)
  }
  const updateList = (field, text) => onChange({ ...value, [field]: commaList(text) })
  const needsPiece = value.scope === 'piece' || value.scope === 'piece_context'
  const needsContext = value.scope === 'context' || value.scope === 'piece_context'
  return (
    <fieldset className="feedback-synthesis-applicability">
      <legend>When this lesson applies</legend>
      <p>This routing controls when the stylist receives the lesson. The boundary above is explanatory text only.</p>
      <label>
        <span>Scope</span>
        <select value={value.scope} onChange={event => onChange({ ...value, scope: event.target.value })}>
          <option value="piece">When a selected garment is available</option>
          <option value="context">Whenever the request context matches</option>
          <option value="piece_context">Only when both garment and context match</option>
        </select>
      </label>
      {needsPiece && (
        <div className="feedback-synthesis-piece-options">
          <span>Garments</span>
          {[...sourcePieces.entries()].map(([id, name]) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={value.piece_ids.includes(id)}
                onChange={event => onChange({
                  ...value,
                  piece_ids: event.target.checked
                    ? [...new Set([...value.piece_ids, id])]
                    : value.piece_ids.filter(pieceId => pieceId !== id),
                })}
              />
              {name} <span>(#{id})</span>
            </label>
          ))}
          {!sourcePieces.size && <p>No source garments are available for this lesson.</p>}
        </div>
      )}
      {needsContext && (
        <div className="feedback-synthesis-context-fields">
          <label><span>Occasions</span><input type="text" value={value.occasions.join(', ')} onChange={event => updateList('occasions', event.target.value)} placeholder="e.g. city" /></label>
          <label><span>Activities</span><input type="text" value={value.activities.join(', ')} onChange={event => updateList('activities', event.target.value)} placeholder="e.g. walking" /></label>
          <label><span>Seasons</span><input type="text" value={value.seasons.join(', ')} onChange={event => updateList('seasons', event.target.value)} placeholder="e.g. summer" /></label>
          <label><span>Weather</span><input type="text" value={value.weather_terms.join(', ')} onChange={event => updateList('weather_terms', event.target.value)} placeholder="e.g. wet, foggy" /></label>
          <p>Use comma-separated terms found in the original reaction. Unsupported additions are not stored.</p>
        </div>
      )}
      {!applicabilityIsUsable(value) && <p role="alert">Choose the garment and/or context required by this scope before saving.</p>}
    </fieldset>
  )
}

function feedbackContextKind(row) {
  if (row?.target_type === 'generated_visual_board' || row?.referenced_board_id || row?.payload?.board?.imageUrl || row?.payload?.board?.image_url) return 'board'
  // A piece context records where styling began; the feedback is still about
  // the resulting outfit or styling direction rather than the garment itself.
  return 'outfit'
}

function readableFeedbackNote(value) {
  return String(value || '')
    .replace(/\[([^\]]+)\]\((?:sandbox:\/|\/?uploads\/|generated-boards\/)[^)]+\)/gi, '$1')
    .replace(/^\s*\(?(?:sandbox:\/|\/?uploads\/|generated-boards\/)\S+\)?\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function friendlySessionName(userAgent = '') {
  const ua = String(userAgent)
  const browser = /Claude\//i.test(ua)
    ? 'Claude'
    : /Edg\//i.test(ua)
      ? 'Edge'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Chrome\//i.test(ua)
          ? 'Chrome'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : 'Browser'
  const platform = /iPhone|iPad/i.test(ua)
    ? 'iPhone or iPad'
    : /Android/i.test(ua)
      ? 'Android'
      : /Macintosh|Mac OS X/i.test(ua)
        ? 'Mac'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'unknown device'
  return `${browser} on ${platform}`
}

function relativeSessionTime(value) {
  if (!value) return 'Activity time unavailable'
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(' ', 'T')}Z`
  const timestamp = new Date(normalized).getTime()
  if (!Number.isFinite(timestamp)) return `Last active ${value}`
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000))
  if (minutes < 2) return 'Active just now'
  if (minutes < 60) return `Active ${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Active ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hours / 24)
  return `Active ${days} ${days === 1 ? 'day' : 'days'} ago`
}

export default function StylistSettings({ mode = 'account', embedded = false, onGoToThread = null } = {}) {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [homeLocation, setHomeLocation] = useState('')
  const [layers, setLayers] = useState([])
  const [drafts, setDrafts] = useState({})
  const [historyFor, setHistoryFor] = useState(null)
  const [historyRows, setHistoryRows] = useState([])
  const [learnings, setLearnings] = useState([])
  const [occasionExclusions, setOccasionExclusions] = useState([])
  const [occasionExclusionsLoading, setOccasionExclusionsLoading] = useState(true)
  const [contextualFeedback, setContextualFeedback] = useState([])
  const [feedbackBoards, setFeedbackBoards] = useState([])
  const [feedbackLoading, setFeedbackLoading] = useState(true)
  const [feedbackSearch, setFeedbackSearch] = useState('')
  const [feedbackContextFilter, setFeedbackContextFilter] = useState('all')
  const [feedbackTypeFilter, setFeedbackTypeFilter] = useState('all')
  const [feedbackVisibleCount, setFeedbackVisibleCount] = useState(FEEDBACK_PAGE_SIZE)
  const [selectedSynthesisFeedback, setSelectedSynthesisFeedback] = useState(new Set())
  const [synthesisPreview, setSynthesisPreview] = useState(null)
  const [synthesisDrafts, setSynthesisDrafts] = useState([])
  const [synthesisEdits, setSynthesisEdits] = useState({})
  const [synthesisBoundaryEdits, setSynthesisBoundaryEdits] = useState({})
  const [synthesisApplicabilityEdits, setSynthesisApplicabilityEdits] = useState({})
  const [synthesisSavedId, setSynthesisSavedId] = useState(null)
  const [synthesisBusy, setSynthesisBusy] = useState(false)
  const [demo, setDemo] = useState(null)
  const [learningDrafts, setLearningDrafts] = useState({})
  const [editingLearningId, setEditingLearningId] = useState(null)
  const [sessions, setSessions] = useState([])
  const [sessionsExpanded, setSessionsExpanded] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState(null)
  const [apiKeyDrafts, setApiKeyDrafts] = useState({ anthropicKey: '', openAiKey: '' })
  const [isAdmin, setIsAdmin] = useState(false)
  const [status, setStatus] = useState('')

  const load = async () => {
    setFeedbackLoading(true)
    setOccasionExclusionsLoading(true)
    try {
      const [p, h, c] = await Promise.all([
        fetch('/api/settings/profile').then(r => r.json()),
        fetch('/api/settings/home-location').then(r => r.json()),
        fetch('/api/settings/constitution').then(r => r.json())
      ])
      setProfile(p)
      setHomeLocation(h.homeLocation || '')
      setLayers(c.layers || [])
      fetch('/api/pieces/occasion-exclusions').then(r => r.json()).then(rows => {
        setOccasionExclusions(Array.isArray(rows) ? rows : [])
      }).catch(() => setOccasionExclusions([])).finally(() => setOccasionExclusionsLoading(false))
      const [feedback, savedBoards, synthesisRows] = await Promise.all([
        fetch('/api/stylist-feedback?limit=1000').then(r => r.json()).catch(() => []),
        fetch('/api/saved-boards?limit=500').then(r => r.json()).catch(() => []),
        fetch('/api/feedback-synthesis/drafts').then(r => r.json()).catch(() => []),
      ])
      const feedbackRows = Array.isArray(feedback) ? feedback : []
      const activeFeedbackRows = feedbackRows.filter(row => row.memory?.strength !== 'none')
      setLearnings(activeFeedbackRows.filter(isStandingLearning))
      setContextualFeedback(activeFeedbackRows.filter(row => !isStandingLearning(row)))
      setFeedbackBoards(Array.isArray(savedBoards) ? savedBoards : [])
      setSynthesisDrafts(Array.isArray(synthesisRows) ? synthesisRows : [])
      setDemo(await fetch('/api/settings/demo-wardrobe').then(r => r.json()).catch(() => null))
      const sessionData = await fetch('/api/auth/sessions').then(r => r.json()).catch(() => null)
      setSessions(sessionData?.sessions || [])
      setApiKeyStatus(await fetch('/api/settings/api-keys').then(r => r.json()).catch(() => null))
      setApiKeyDrafts({ anthropicKey: '', openAiKey: '' })
      const me = await fetch('/api/auth/me').then(r => r.json()).catch(() => null)
      setIsAdmin(Boolean(me?.isAdmin))
    } catch (err) {
      setStatus(`Failed to load settings: ${err.message}`)
    } finally {
      setFeedbackLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // value is explicit here (never read from possibly-untouched draft state) so a blank,
  // never-typed-in draft can't silently wipe an already-saved key on an accidental click.
  const saveApiKey = async (field, value) => {
    const res = await fetch('/api/settings/api-keys', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) })
    if (res.ok) { flash(value ? 'Key saved.' : 'Key cleared — using the operator\'s key.'); load() }
    else flash('Failed to save key')
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    navigate('/login', { replace: true })
  }

  const revokeSession = async (id) => {
    const res = await fetch(`/api/auth/sessions/${id}`, { method: 'DELETE' })
    if (!res.ok) return flash('Failed to revoke session')
    const { revokedCurrent } = await res.json()
    if (revokedCurrent) { navigate('/login', { replace: true }); return }
    flash('Session revoked.'); load()
  }

  const revokeOtherSessions = async () => {
    const res = await fetch('/api/auth/sessions/revoke-others', { method: 'POST' })
    if (res.ok) { flash('Signed out everywhere else.'); load() }
  }

  const flash = (msg) => { setStatus(msg); setTimeout(() => setStatus(''), 2500) }

  const saveProfile = async () => {
    const res = await fetch('/api/settings/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })
    if (res.ok) { flash('Profile saved — your stylist updated instantly.'); load() }
    else flash((await res.json()).error || 'Failed to save profile')
  }

  const saveHomeLocation = async () => {
    const res = await fetch('/api/settings/home-location', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ homeLocation }) })
    if (res.ok) flash('Home location saved.')
  }

  const saveLayer = async (layer) => {
    const body = drafts[layer]
    const res = await fetch(`/api/settings/constitution/${layer}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
    if (res.ok) {
      const next = { ...drafts }; delete next[layer]; setDrafts(next)
      flash('Saved — prior text kept in history.'); load()
    } else flash((await res.json()).error || 'Failed to save layer')
  }

  const saveLearning = async (row) => {
    const note = learningDrafts[row.id]
    const res = await fetch(`/api/stylist-feedback/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) })
    if (res.ok) {
      const next = { ...learningDrafts }; delete next[row.id]; setLearningDrafts(next)
      setEditingLearningId(null)
      flash('Learning updated.'); load()
    } else flash('Failed to update learning')
  }

  const archiveLearning = async (row) => {
    const res = await fetch(`/api/stylist-feedback/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) })
    if (res.ok) { flash('Learning retired — it will no longer influence styling.'); load() }
  }

  const restoreOccasionExclusion = async (entry) => {
    const res = await fetch(`/api/pieces/${entry.pieceId}/occasion-exclusion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ occasion: entry.occasion, excluded: false })
    })
    if (res.ok) {
      flash(`${entry.name} will be offered for ${entry.occasion} again.`)
      setOccasionExclusions(prev => prev.filter(e => !(e.pieceId === entry.pieceId && e.occasion === entry.occasion)))
    } else {
      flash('Failed to restore this piece')
    }
  }

  const showHistory = async (layer) => {
    if (historyFor === layer) { setHistoryFor(null); return }
    const res = await fetch(`/api/settings/constitution/${layer}/history`)
    const data = await res.json()
    setHistoryRows(data.history || [])
    setHistoryFor(layer)
  }

  const currentSession = sessions.find(session => session.isCurrent)
  const otherSessions = sessions.filter(session => !session.isCurrent)
  const normalizedFeedbackSearch = feedbackSearch.trim().toLowerCase()
  const processedSynthesisFeedbackIds = new Set(synthesisDrafts.flatMap(draft => parsedIdList(draft.source_feedback_ids)))
  const actionableContextualFeedback = contextualFeedback.filter(row =>
    row.memory?.synthesisEligible && !processedSynthesisFeedbackIds.has(row.id)
  )
  const matchingContextualFeedback = actionableContextualFeedback.filter(row => {
    if (feedbackContextFilter !== 'all' && feedbackContextKind(row) !== feedbackContextFilter) return false
    if (feedbackTypeFilter !== 'all' && row.feedback_type !== feedbackTypeFilter) return false
    if (!normalizedFeedbackSearch) return true
    return [row.context_name, row.label, row.note, row.feedback_type]
      .some(value => String(value || '').toLowerCase().includes(normalizedFeedbackSearch))
  })
  const visibleContextualFeedback = matchingContextualFeedback.slice(0, feedbackVisibleCount)
  const contextualFeedbackTypes = [...new Set(actionableContextualFeedback.map(row => row.feedback_type).filter(Boolean))].sort()
  const pendingSynthesisDrafts = synthesisDrafts.filter(draft => ['draft', 'deferred'].includes(draft.status))

  const feedbackBoardImage = row => row?.payload?.board?.imageUrl || row?.payload?.board?.image_url || ''
  const matchedFeedbackBoard = row => {
    const imageUrl = feedbackBoardImage(row)
    return imageUrl ? feedbackBoards.find(board => board.image_url === imageUrl) : null
  }
  // Whole-wardrobe-outfit feedback (wrong choice for outfit, bad_occasion, too_safe, ...) carries no
  // board image — it's feedback on the outfit card, not a rendered board — and older rows
  // predate thread-linking entirely, so neither of the above lookups can find anything for them.
  // A saved board's piece set is still a reliable fingerprint of "this exact look" — reuse it as
  // a fallback before landing on the bare garment page (or, for text-only outfit replies that
  // were never rendered as a board at all, before landing on nothing). Only trusted when exactly
  // one board matches; an ambiguous match (the outfit saved more than once) is left alone rather
  // than guessing, same caution `referencedThreadForFeedback` already applies server-side for its
  // own fallback case.
  const matchedBoardByPieceSet = row => {
    if (row.target_type !== 'whole_wardrobe_outfit') return null
    const rowPieceIds = (row?.payload?.pieceIds || row?.payload?.outfit?.pieceIds || [])
      .map(Number).filter(Boolean).sort((a, b) => a - b)
    if (!rowPieceIds.length) return null
    const key = rowPieceIds.join(',')
    const candidates = feedbackBoards.filter(board => {
      const boardIds = (board.linked_piece_ids || []).map(Number).filter(Boolean).sort((a, b) => a - b)
      return boardIds.length > 0 && boardIds.join(',') === key
    })
    return candidates.length === 1 ? candidates[0] : null
  }

  const removeContextualFeedback = async (row) => {
    const res = await fetch(`/api/stylist-feedback/${row.id}`, { method: 'DELETE' })
    if (res.ok) {
      setContextualFeedback(prev => prev.filter(r => r.id !== row.id))
      flash('Removed.')
    } else {
      flash('Failed to remove this entry')
    }
  }

  const toggleSynthesisFeedback = (id) => {
    setSelectedSynthesisFeedback(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSynthesisPreview(null)
  }

  const previewSynthesis = async () => {
    if (!selectedSynthesisFeedback.size) return
    setSynthesisBusy(true)
    try {
      const ids = [...selectedSynthesisFeedback].join(',')
      const response = await fetch(`/api/feedback-synthesis/preview?ids=${encodeURIComponent(ids)}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not prepare the synthesis preview.')
      setSynthesisPreview(result)
    } catch (err) {
      flash(err.message)
    } finally {
      setSynthesisBusy(false)
    }
  }

  const authorizeSynthesis = async () => {
    if (!synthesisPreview?.inputHash) return
    setSynthesisBusy(true)
    try {
      const response = await fetch('/api/feedback-synthesis/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackIds: synthesisPreview.feedbackIds,
          inputHash: synthesisPreview.inputHash,
          authorize: true,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Synthesis failed.')
      setSynthesisDrafts(previous => [...(result.drafts || []), ...previous])
      setSelectedSynthesisFeedback(new Set())
      setSynthesisPreview(null)
      flash('Draft lessons are ready for review. Nothing was accepted automatically.')
    } catch (err) {
      flash(err.message)
    } finally {
      setSynthesisBusy(false)
    }
  }

  const updateSynthesisDraft = async (draft, nextStatus) => {
    const hasTextEdit = Object.hasOwn(synthesisEdits, draft.id)
    const hasBoundaryEdit = Object.hasOwn(synthesisBoundaryEdits, draft.id)
    const hasApplicabilityEdit = Object.hasOwn(synthesisApplicabilityEdits, draft.id)
    const body = { status: nextStatus }
    if (hasTextEdit) body.editedText = synthesisEdits[draft.id]
    if (hasBoundaryEdit) body.boundary = synthesisBoundaryEdits[draft.id]
    if (hasApplicabilityEdit) body.applicability = synthesisApplicabilityEdits[draft.id]
    const response = await fetch(`/api/feedback-synthesis/drafts/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok) return flash(result.error || 'Could not update this draft.')
    setSynthesisDrafts(previous => previous.map(row => row.id === draft.id ? result : row))
    setSynthesisEdits(previous => { const next = { ...previous }; delete next[draft.id]; return next })
    setSynthesisBoundaryEdits(previous => { const next = { ...previous }; delete next[draft.id]; return next })
    setSynthesisApplicabilityEdits(previous => { const next = { ...previous }; delete next[draft.id]; return next })
    setSynthesisSavedId(draft.id)
    setTimeout(() => setSynthesisSavedId(current => current === draft.id ? null : current), 2500)
    flash(nextStatus === 'accepted'
      ? 'Lesson accepted.'
      : nextStatus === 'retired'
        ? 'Lesson retired — it no longer guides styling.'
        : nextStatus === 'rejected'
          ? 'Draft rejected.'
          : 'Draft saved for later.')
  }

  const openFeedbackContext = async (row) => {
    const matchedBoard = matchedFeedbackBoard(row)
    const existingBoardId = row.referenced_board_id || matchedBoard?.id
    if (existingBoardId) {
      navigate(`/visual-lab?section=profile&boardId=${existingBoardId}`)
      return
    }
    const board = row?.payload?.board
    if (row.target_type === 'generated_visual_board' && board?.imageUrl) {
      const response = await fetch('/api/saved-boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardType: board.wholeWardrobe ? 'whole_wardrobe_board' : 'editorial_direction',
          contextType: row.context_type || 'wardrobe',
          contextId: row.context_id || null,
          contextName: row.context_name || 'Whole wardrobe',
          title: board.label || row.label || 'Generated styling result',
          imageUrl: board.imageUrl,
          pieces: board.pieces || row?.payload?.outfit?.pieces || [],
          missingPieces: row?.payload?.outfit?.missingPieces || [],
          reason: board.reason || row.note || '',
          watchFor: board.watchFor || '',
          payload: { ...row.payload, feedback_labels: [row.feedback_type] },
        }),
      })
      const saved = await response.json().catch(() => null)
      if (response.ok && saved?.id) {
        setFeedbackBoards(previous => [...previous, saved])
        navigate(`/visual-lab?section=profile&boardId=${saved.id}`)
      } else {
        flash('Could not open this generated board.')
      }
      return
    }
    // Thread wins over the garment page when both are reachable — matches the button label
    // logic below (canOpenThread / canOpenGarment): a "Wrong choice for this outfit" row's garment
    // page shows the piece in isolation, no outfit, no "why", so the thread that produced the
    // correction is the more useful jump whenever it still exists.
    if (row.referenced_thread_id && onGoToThread) {
      onGoToThread(row.referenced_thread_id)
      return
    }
    const pieceMatchedBoard = matchedBoardByPieceSet(row)
    if (pieceMatchedBoard) {
      navigate(`/visual-lab?section=profile&boardId=${pieceMatchedBoard.id}`)
      return
    }
    const referencedPieceId = row?.payload?.pieceId || row?.payload?.piece?.id
    if (row.feedback_type === WRONG_PIECE_FOR_OUTFIT_FEEDBACK && referencedPieceId) {
      navigate(`/wardrobe?pieceId=${referencedPieceId}`)
      return
    }
    if (row.context_type === 'outfit' && row.context_id) navigate(`/outfits?outfitId=${row.context_id}`)
    if (row.context_type === 'piece' && row.context_id) navigate(`/wardrobe?pieceId=${row.context_id}`)
  }

  const renderStyleLayer = ({ layer, body, updatedAt, isDefault }) => {
    const [eyebrow, description] = LAYER_META[layer] || ['Guidance', 'Working guidance used by your stylist.']
    const hasChanges = drafts[layer] !== undefined && drafts[layer] !== body
    return (
      <details key={layer} className="style-profile-card" defaultOpen={layer === 'body_contract'}>
        <summary>
          <div className="style-profile-card-summary">
            <span className="style-profile-card-eyebrow">{eyebrow}</span>
            <strong>{LAYER_TITLES[layer] || layer}</strong>
            <span className="style-profile-card-description">{description}</span>
          </div>
          <span className={`style-profile-card-status ${isDefault ? 'is-default' : ''}`}>
            {isDefault ? 'Not personalized' : 'Personalized'}
          </span>
        </summary>
        <div className="style-profile-card-body">
          <textarea
            className="style-profile-editor"
            value={drafts[layer] ?? body}
            onChange={e => setDrafts({ ...drafts, [layer]: e.target.value })}
          />
          <div className="style-profile-card-meta">
            <span>{!isDefault && updatedAt ? `Last updated ${updatedAt}` : 'Using the default guidance'}</span>
            <div className="style-profile-card-actions">
              {INTERVIEW_STEPS[layer] && (
                <Link to={`/onboarding?step=${INTERVIEW_STEPS[layer]}&return=visual-lab`} className="btn-secondary">Redo interview</Link>
              )}
              {!isDefault && <button className="btn-secondary" onClick={() => showHistory(layer)}>{historyFor === layer ? 'Hide history' : 'View history'}</button>}
              {hasChanges && <button className="btn-primary" onClick={() => saveLayer(layer)}>Save changes</button>}
            </div>
          </div>
          {historyFor === layer && (
            <div className="style-profile-history">
              {historyRows.length === 0 && <div className="style-profile-history-empty">No history yet.</div>}
              {historyRows.map(row => (
                <div key={row.id} className="style-profile-history-entry">
                  <strong>{row.created_at} · {row.source}</strong>
                  <pre>{row.prior_body ?? '(no prior text — first write)'}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    )
  }

  return (
    <div className={`settings-page ${mode === 'style' ? 'settings-page--style' : 'settings-page--account'}`} style={{ maxWidth: mode === 'style' ? 820 : 940, margin: '0 auto', padding: embedded ? '8px 0 48px' : '38px 28px 72px' }}>
      <div className="settings-page-header">
      {mode !== 'style' && <span className="settings-page-eyebrow">Account &amp; application</span>}
      <h1 className="settings-page-title">{mode === 'style' ? 'Style profile' : 'Settings'}</h1>
      <p className="settings-page-intro">
        {mode === 'style'
          ? 'This is your stylist’s working understanding of you — plain text, yours to correct.'
          : `Manage your profile, AI provider keys, ${isAdmin ? 'administration, ' : ''}and account security.`}
      </p>
      </div>
      {status && <div className="settings-status" role="status">{status}</div>}

      {mode !== 'style' && profile && (
        <section className="account-settings-section">
          <div className="account-settings-heading">
            <div>
              <span>Personal details</span>
              <h2>Profile &amp; location</h2>
            </div>
            <p>Your name and pronouns shape how the stylist addresses you. Location supplies live weather context.</p>
          </div>
          <div className="account-settings-card">
            <div className="account-settings-grid">
              <div className="account-settings-field">
                <label htmlFor="settings-display-name">Name</label>
                <input id="settings-display-name" value={profile.displayName} onChange={e => setProfile({ ...profile, displayName: e.target.value })} />
              </div>
              <fieldset className="account-settings-field account-settings-pronouns">
                <legend>Pronouns</legend>
                <div className="account-settings-pronoun-inputs">
                  <div>
                    <label htmlFor="settings-pronoun-subject">Subject</label>
                    <input id="settings-pronoun-subject" value={profile.pronouns.subject} onChange={e => setProfile({ ...profile, pronouns: { ...profile.pronouns, subject: e.target.value, plural: e.target.value.trim() === 'they' } })} />
                  </div>
                  <div>
                    <label htmlFor="settings-pronoun-object">Object</label>
                    <input id="settings-pronoun-object" value={profile.pronouns.object} onChange={e => setProfile({ ...profile, pronouns: { ...profile.pronouns, object: e.target.value } })} />
                  </div>
                  <div>
                    <label htmlFor="settings-pronoun-possessive">Possessive</label>
                    <input id="settings-pronoun-possessive" value={profile.pronouns.possessive} onChange={e => setProfile({ ...profile, pronouns: { ...profile.pronouns, possessive: e.target.value } })} />
                  </div>
                </div>
              </fieldset>
            </div>
            <div className="account-settings-location">
              <div className="account-settings-field">
                <label htmlFor="settings-home-location">Home location</label>
                <span className="account-settings-field-hint">Used for live weather when you ask for outfit advice.</span>
                <div className="account-settings-inline-control">
                  <input id="settings-home-location" value={homeLocation} onChange={e => setHomeLocation(e.target.value)} />
                  <button className="btn-secondary" onClick={saveHomeLocation}>Save location</button>
                </div>
              </div>
            </div>
            <div className="account-settings-card-footer">
              <span>Changes to your profile affect future stylist conversations.</span>
              <button className="btn-primary" onClick={saveProfile}>Save profile</button>
            </div>
          </div>
        </section>
      )}

      {mode === 'style' && <>
      <section className="style-profile-section">
        <div className="style-profile-section-heading">
          <div>
            <span>Personal guidance</span>
            <h2>How your stylist understands you</h2>
          </div>
          <p>These layers guide every recommendation. Expand any one to review or correct it.</p>
        </div>
        <div className="style-profile-card-list">
          {layers.filter(({ layer }) => PERSONAL_STYLE_LAYERS.has(layer)).map(renderStyleLayer)}
        </div>
      </section>

      <section className="style-profile-section">
        <div className="style-profile-section-heading">
          <div>
            <span>Visual generation</span>
            <h2>How generated looks represent you</h2>
          </div>
          <p>Rendering guidance affects imagery only; it does not limit outfit recommendations.</p>
        </div>
        <div className="style-profile-card-list">
          {layers.filter(({ layer }) => IMAGE_STYLE_LAYERS.has(layer)).map(renderStyleLayer)}
        </div>
      </section>
      </>}

      {mode !== 'style' && demo?.count > 0 && (
        <details className="account-settings-disclosure">
          <summary>
            <span>
              <strong>Data &amp; maintenance</strong>
              <small>Manage sample content stored in this wardrobe.</small>
            </span>
          </summary>
          <div className="account-settings-disclosure-body">
            <div className="account-settings-action-row">
              <div>
                <strong>Sample wardrobe</strong>
                <span>{demo.count} demo pieces are in your wardrobe.</span>
              </div>
              <button
                className="btn-secondary"
                onClick={async () => {
                  const res = await fetch('/api/settings/demo-wardrobe', { method: 'DELETE' })
                  if (res.ok) { flash('Demo wardrobe removed.'); load() }
                }}
              >Remove all demo pieces</button>
            </div>
          </div>
        </details>
      )}

      {mode === 'style' && <>
      <details className="style-memory-legend">
        <summary>How the stylist uses this memory</summary>
        <div className="style-memory-legend-grid">
          <div><strong>Standing guidance</strong><span>Included in styling prompts until you retire it.</span></div>
          <div><strong>Hard exclusion</strong><span>The garment is never offered for that occasion until restored.</span></div>
          <div><strong>Contextual guidance</strong><span>Applied to similar outfit contexts, not as a global garment preference.</span></div>
          <div><strong>Provisional feedback</strong><span>Kept with its garment and outfit context; it is not a score or standing preference.</span></div>
          <div><strong>Image correction</strong><span>Guides generated images only; it does not change outfit selection.</span></div>
        </div>
      </details>
      <section className="style-profile-section style-profile-learnings">
      <div className="style-profile-section-heading">
        <div>
          <span>Conversation memory</span>
          <h2>Learned rules & preferences</h2>
        </div>
        <p>Durable corrections learned in chat, such as what you do not wear or weather-specific needs.</p>
      </div>
      {feedbackLoading && <div className="style-profile-empty">Loading learned rules and preferences…</div>}
      {!feedbackLoading && learnings.length === 0 && (
        <div className="style-profile-empty">Nothing learned yet. Corrections you give the stylist in chat will appear here.</div>
      )}
      <div className="style-memory-list">
      {learnings.map(row => (
        <div key={row.id} className="style-memory-row style-memory-row--editable">
          <div className="style-memory-row-heading">
            <span className="style-memory-kind">
              {row.feedback_type === 'piece_rule_receipt'
                ? `garment rule · ${row.context_name || `Piece ${row.context_id}`}`
                : row.feedback_type.replace('_', ' ')}
            </span>
            <span className="style-memory-date">{row.created_at}</span>
          </div>
          {editingLearningId === row.id ? (
            <>
              <textarea
                className="style-memory-editor"
                value={learningDrafts[row.id] ?? row.note}
                onChange={e => setLearningDrafts({ ...learningDrafts, [row.id]: e.target.value })}
                autoFocus
              />
              <div className="style-memory-actions">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    const next = { ...learningDrafts }
                    delete next[row.id]
                    setLearningDrafts(next)
                    setEditingLearningId(null)
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  disabled={(learningDrafts[row.id] ?? row.note) === row.note}
                  onClick={() => saveLearning(row)}
                >
                  Save changes
                </button>
              </div>
            </>
          ) : (
            <div className="style-memory-read-layout">
              <div className="style-memory-rule">{row.note}</div>
              <div className="style-memory-actions style-memory-actions--read">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setLearningDrafts({ ...learningDrafts, [row.id]: row.note })
                    setEditingLearningId(row.id)
                  }}
                >
                  Edit
                </button>
                <button className="style-memory-retire" onClick={() => archiveLearning(row)}>Retire</button>
              </div>
            </div>
          )}
        </div>
      ))}
      </div>
      </section>

      <section className="style-profile-section style-profile-learnings">
        <div className="style-profile-section-heading">
          <div>
            <span>Garment memory</span>
            <h2>Occasion exclusions</h2>
          </div>
          <p>Garments marked "Wrong for" an occasion from the Stylist chat. This is a hard rule —
          the piece will never be offered for that occasion again until you restore it here.</p>
        </div>
        {occasionExclusionsLoading && <div className="style-profile-empty">Loading occasion exclusions…</div>}
        {!occasionExclusionsLoading && occasionExclusions.length === 0 && (
          <div className="style-profile-empty">No garments are currently excluded from any occasion.</div>
        )}
        <div className="style-memory-list">
        {occasionExclusions.map(entry => (
          <div key={`${entry.pieceId}:${entry.occasion}`} className="style-memory-row style-memory-row--context">
            <div className="style-memory-context-layout">
              <div className="style-memory-copy">
                <div className="style-memory-kind">occasion exclusion</div>
                <div className="style-memory-context-title">{entry.name}</div>
                <div className="style-memory-note">Won't be offered for {entry.occasion}.</div>
              </div>
              <div className="style-memory-context-actions">
                <button className="btn-secondary" onClick={() => restoreOccasionExclusion(entry)}>
                  Restore for {entry.occasion}
                </button>
              </div>
            </div>
          </div>
        ))}
        </div>
      </section>

      <section className="style-profile-section style-profile-learnings">
        <div className="style-profile-section-heading">
          <div>
            <span>Contextual memory</span>
            <h2>Outfit &amp; styling feedback</h2>
          </div>
          <p>Feedback tied to a particular outfit, styling result, or generated board. It does not become a global style rule.</p>
        </div>
        <div className="feedback-synthesis-panel">
          <div>
            <strong>Turn selected reactions into draft lessons</strong>
            <p>Select provisional reactions below, then preview the exact model and estimated cost. No model call happens until you authorize it.</p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={!selectedSynthesisFeedback.size || synthesisBusy}
            onClick={previewSynthesis}
          >
            Preview synthesis cost ({selectedSynthesisFeedback.size})
          </button>
          {synthesisPreview && (
            <div className="feedback-synthesis-preview" role="status">
              <div>
                <strong>{synthesisPreview.feedbackIds.length} reactions · {synthesisPreview.provider} / {synthesisPreview.model}</strong>
                <span>
                  Conservative maximum {synthesisPreview.estimatedInputTokens.toLocaleString()} input + {synthesisPreview.outputTokenCap.toLocaleString()} output tokens
                  {synthesisPreview.estimatedCost?.pricingAvailable
                    ? ` · about $${Number(synthesisPreview.estimatedCost.estimatedUsd).toFixed(4)}`
                    : ' · local price estimate unavailable'}
                </span>
                <span>Preview calls: {synthesisPreview.providerCalls}. The next button authorizes one paid model call.</span>
              </div>
              <button type="button" className="btn-primary" disabled={synthesisBusy} onClick={authorizeSynthesis}>
                {synthesisBusy ? 'Synthesizing…' : 'Authorize one model call'}
              </button>
            </div>
          )}
        </div>
        {pendingSynthesisDrafts.length > 0 && (
          <div className="feedback-synthesis-drafts">
            <h3>Draft lessons awaiting your decision</h3>
            <p>These remain drafts until you accept them. General styling issues and garment corrections never become personal preferences.</p>
            {pendingSynthesisDrafts.map(draft => {
              const sourceIds = parsedIdList(draft.source_feedback_ids)
              const sources = sourceIds.map(id => contextualFeedback.find(row => Number(row.id) === id)).filter(Boolean)
              const storedApplicability = synthesisApplicability(draft)
              const editedApplicability = synthesisApplicabilityEdits[draft.id] ?? storedApplicability
              const textDirty = Object.hasOwn(synthesisEdits, draft.id) && synthesisEdits[draft.id].trim() !== effectiveSynthesisText(draft).trim()
              const boundaryDirty = Object.hasOwn(synthesisBoundaryEdits, draft.id) && synthesisBoundaryEdits[draft.id].trim() !== effectiveSynthesisBoundary(draft).trim()
              const applicabilityDirty = !applicabilityEqual(editedApplicability, storedApplicability)
              const draftDirty = textDirty || boundaryDirty || applicabilityDirty
              return (
              <div key={draft.id} className="feedback-synthesis-draft">
                <div className="style-memory-kind">{SYNTHESIS_DISPOSITION_LABELS[draft.disposition] || draft.disposition}</div>
                <strong>{draft.title || 'Untitled draft'}</strong>
                <textarea
                  className="style-memory-editor"
                  value={synthesisEdits[draft.id] ?? effectiveSynthesisText(draft)}
                  onChange={event => setSynthesisEdits(previous => ({ ...previous, [draft.id]: event.target.value }))}
                  aria-label={`Edit ${draft.title || 'draft lesson'}`}
                />
                <label className="feedback-synthesis-boundary">
                  <strong>Boundary</strong>
                  <textarea
                    className="style-memory-editor"
                    value={synthesisBoundaryEdits[draft.id] ?? effectiveSynthesisBoundary(draft)}
                    onChange={event => setSynthesisBoundaryEdits(previous => ({ ...previous, [draft.id]: event.target.value }))}
                    aria-label={`Edit boundary for ${draft.title || 'draft lesson'}`}
                  />
                </label>
                {draft.disposition === 'personal_contextual_lesson' && (
                  <SynthesisApplicabilityEditor
                    sources={sources}
                    value={editedApplicability}
                    onChange={value => setSynthesisApplicabilityEdits(previous => ({ ...previous, [draft.id]: normalizedApplicability(value) }))}
                  />
                )}
                {draft.rationale && <p><strong>Why it was routed here:</strong> {draft.rationale}</p>}
                <div className="feedback-synthesis-draft-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={draft.disposition === 'personal_contextual_lesson' && !applicabilityIsUsable(editedApplicability)}
                    onClick={() => updateSynthesisDraft(draft, 'accepted')}
                  >
                    {draft.disposition === 'personal_contextual_lesson'
                      ? (draftDirty ? 'Accept edited lesson' : 'Accept proposed lesson')
                      : 'Mark reviewed'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => updateSynthesisDraft(draft, 'deferred')}>Keep for later</button>
                  <button type="button" className="style-memory-retire" onClick={() => updateSynthesisDraft(draft, 'rejected')}>Reject</button>
                </div>
              </div>
              )
            })}
          </div>
        )}
        {synthesisDrafts.some(draft => draft.status === 'accepted' && draft.disposition === 'personal_contextual_lesson') && (
          <div className="feedback-synthesis-drafts">
            <h3>Accepted personal lessons</h3>
            <p>These are the only synthesized lessons that currently guide styling. You can revise or retire them at any time.</p>
            {synthesisDrafts.filter(draft => draft.status === 'accepted' && draft.disposition === 'personal_contextual_lesson').map(draft => {
              const sourceIds = parsedIdList(draft.source_feedback_ids)
              const sources = sourceIds.map(id => contextualFeedback.find(row => Number(row.id) === id)).filter(Boolean)
              const storedApplicability = synthesisApplicability(draft)
              const editedApplicability = synthesisApplicabilityEdits[draft.id] ?? storedApplicability
              const textDirty = Object.hasOwn(synthesisEdits, draft.id) && synthesisEdits[draft.id].trim() !== effectiveSynthesisText(draft).trim()
              const boundaryDirty = Object.hasOwn(synthesisBoundaryEdits, draft.id) && synthesisBoundaryEdits[draft.id].trim() !== effectiveSynthesisBoundary(draft).trim()
              const applicabilityDirty = !applicabilityEqual(editedApplicability, storedApplicability)
              const draftDirty = textDirty || boundaryDirty || applicabilityDirty
              return (
                <details key={draft.id} className="feedback-synthesis-draft feedback-synthesis-draft--accepted">
                  <summary className="feedback-synthesis-accepted-summary">
                    <span className="style-memory-kind">accepted personal or contextual lesson</span>
                    <strong>{draft.title || 'Accepted lesson'}</strong>
                  </summary>
                  <div className="feedback-synthesis-accepted-details">
                  <textarea
                    className="style-memory-editor"
                    value={synthesisEdits[draft.id] ?? effectiveSynthesisText(draft)}
                    onChange={event => setSynthesisEdits(previous => ({ ...previous, [draft.id]: event.target.value }))}
                    aria-label={`Edit accepted lesson ${draft.title || draft.id}`}
                  />
                  <label className="feedback-synthesis-boundary">
                    <strong>Boundary</strong>
                    <textarea
                      className="style-memory-editor"
                      value={synthesisBoundaryEdits[draft.id] ?? effectiveSynthesisBoundary(draft)}
                      onChange={event => setSynthesisBoundaryEdits(previous => ({ ...previous, [draft.id]: event.target.value }))}
                      aria-label={`Edit boundary for accepted lesson ${draft.title || draft.id}`}
                    />
                  </label>
                  <SynthesisApplicabilityEditor
                    sources={sources}
                    value={editedApplicability}
                    onChange={value => setSynthesisApplicabilityEdits(previous => ({ ...previous, [draft.id]: normalizedApplicability(value) }))}
                  />
                  <details className="style-memory-technical">
                    <summary>Source reactions ({sourceIds.length})</summary>
                    {sources.length > 0 ? (
                      <ul>
                        {sources.map(source => (
                          <li key={source.id}>#{source.id} · {source.memory?.display?.title || source.context_name || source.label}: {source.memory?.display?.summary || readableFeedbackNote(source.note)}</li>
                        ))}
                      </ul>
                    ) : <p>{sourceIds.length ? sourceIds.map(id => `#${id}`).join(', ') : 'No source IDs recorded.'}</p>}
                  </details>
                  <div className="feedback-synthesis-draft-actions">
                    <button type="button" className="btn-primary" disabled={!draftDirty || !applicabilityIsUsable(editedApplicability)} onClick={() => updateSynthesisDraft(draft, 'accepted')}>Save changes</button>
                    <button type="button" className="style-memory-retire" onClick={() => updateSynthesisDraft(draft, 'retired')}>Retire lesson</button>
                    {synthesisSavedId === draft.id && <span className="style-memory-save-confirmation" role="status">Changes saved.</span>}
                  </div>
                  </div>
                </details>
              )
            })}
          </div>
        )}
        {synthesisDrafts.some(draft => draft.status === 'accepted' && draft.disposition !== 'personal_contextual_lesson') && (
          <div className="feedback-synthesis-drafts">
            <h3>Reviewed synthesis conclusions</h3>
            <p>These are retained for review and provenance only. They do not guide styling or alter garment data.</p>
            {synthesisDrafts.filter(draft => draft.status === 'accepted' && draft.disposition !== 'personal_contextual_lesson').map(draft => (
              <div key={draft.id} className="feedback-synthesis-draft">
                <div className="style-memory-kind">{SYNTHESIS_DISPOSITION_LABELS[draft.disposition] || draft.disposition}</div>
                <strong>{draft.title || 'Reviewed conclusion'}</strong>
                {Boolean(draft.edited_text || draft.proposed_text) && <p>{draft.edited_text || draft.proposed_text}</p>}
                {draft.boundary && <p><strong>Boundary:</strong> {draft.boundary}</p>}
                <div className="feedback-synthesis-draft-actions">
                  <button type="button" className="style-memory-retire" onClick={() => updateSynthesisDraft(draft, 'retired')}>Retire record</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {actionableContextualFeedback.length > 0 && <div className="style-memory-toolbar">
          <input
            type="search"
            className="style-memory-search"
            value={feedbackSearch}
            onChange={event => {
              setFeedbackSearch(event.target.value)
              setFeedbackVisibleCount(FEEDBACK_PAGE_SIZE)
            }}
            placeholder="Search by outfit, styling feedback, or note…"
            aria-label="Search outfit and styling feedback"
          />
          <div className="style-memory-filter-row" aria-label="Filter feedback by context">
            {CONTEXT_FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`style-memory-filter ${feedbackContextFilter === value ? 'active' : ''}`}
                onClick={() => {
                  setFeedbackContextFilter(value)
                  setFeedbackVisibleCount(FEEDBACK_PAGE_SIZE)
                }}
              >
                {label}
              </button>
            ))}
            <select
              className="style-memory-type-filter"
              value={feedbackTypeFilter}
              onChange={event => {
                setFeedbackTypeFilter(event.target.value)
                setFeedbackVisibleCount(FEEDBACK_PAGE_SIZE)
              }}
              aria-label="Filter by feedback type"
            >
              <option value="all">All feedback types</option>
              {contextualFeedbackTypes.map(type => (
                <option key={type} value={type}>{feedbackTypeDisplayLabel(type)}</option>
              ))}
            </select>
          </div>
        </div>}
        {matchingContextualFeedback.length > visibleContextualFeedback.length && (
          <div className="style-memory-results-note">
            Showing {visibleContextualFeedback.length} of {matchingContextualFeedback.length} matches.
          </div>
        )}
        {feedbackLoading && (
          <div className="style-profile-empty">Loading outfit and styling feedback…</div>
        )}
        {!feedbackLoading && visibleContextualFeedback.length === 0 && (
          <div className="style-profile-empty">
            {actionableContextualFeedback.length === 0
              ? 'No provisional outfit reactions are currently available for lesson synthesis.'
              : (feedbackSearch.trim() ? 'No actionable feedback matches this search.' : 'No feedback matches these filters.')}
          </div>
        )}
        <div className="style-memory-list">
        {visibleContextualFeedback.map(row => {
          const memoryDisplay = row.memory?.display
          const contextLabel = memoryDisplay?.title || row.context_name || (row.context_type === 'wardrobe' ? 'Whole wardrobe' : '') || row.label || 'Saved styling result'
          const readableNote = memoryDisplay?.summary || readableFeedbackNote(row.note) || 'No note saved.'
          const displayLabel = memoryDisplay?.context || (row.label && row.label !== contextLabel ? row.label : '')
          const hasTechnicalDetails = readableNote !== String(row.note || '').trim()
            || Boolean(row.target_type || row.context_id || row.referenced_board_id || row.referenced_thread_id)
          const canOpenContext = ['outfit', 'piece'].includes(row.context_type) && row.context_id
          const hasImageBoardMatch = Boolean(row.referenced_board_id || matchedFeedbackBoard(row) || (row.target_type === 'generated_visual_board' && feedbackBoardImage(row)))
          // A "Wrong choice for this outfit" row's garment page shows the piece in isolation — no
          // outfit, no "why" — so once the thread that produced the correction is reachable,
          // that's the more useful jump. If no thread survives either, try the saved board with
          // the same piece set (see matchedBoardByPieceSet) before landing on bare garment.
          const canOpenThread = Boolean(row.referenced_thread_id && onGoToThread)
          const pieceMatchedBoard = hasImageBoardMatch ? null : matchedBoardByPieceSet(row)
          const sourceSurface = row?.payload?.feedbackEvidence?.source?.surface || row?.payload?.sourceSurface || ''
          const boardIsSource = ['visual_lab', 'lookbook', 'saved_board'].includes(sourceSurface)
            || (!sourceSurface && row.target_type === 'generated_visual_board')
          const relatedBoardId = !boardIsSource
            ? (row.referenced_board_id || matchedFeedbackBoard(row)?.id || pieceMatchedBoard?.id)
            : null
          const canOpenSourceBoard = hasImageBoardMatch && boardIsSource
          const canOpenRelatedBoard = Boolean(relatedBoardId)
          const canOpenRelatedGarment = row.feedback_type === WRONG_PIECE_FOR_OUTFIT_FEEDBACK && Boolean(row?.payload?.pieceId || row?.payload?.piece?.id)
          return (
            <div key={row.id} id={`feedback-row-${row.id}`} className="style-memory-row style-memory-row--context">
              <div className="style-memory-context-layout">
                <div className="style-memory-copy">
                  {row.memory?.synthesisEligible && !processedSynthesisFeedbackIds.has(row.id) && (
                    <label className="feedback-synthesis-select">
                      <input
                        type="checkbox"
                        checked={selectedSynthesisFeedback.has(row.id)}
                        onChange={() => toggleSynthesisFeedback(row.id)}
                      />
                      Select for lesson synthesis
                    </label>
                  )}
                  <div className="style-memory-kind">
                    {feedbackTypeDisplayLabel(row)}
                  </div>
                  <div className="style-memory-context-title">{contextLabel}</div>
                  {displayLabel && <div className="style-memory-label">{displayLabel}</div>}
                  <div className="style-memory-note">{readableNote}</div>
                  {hasTechnicalDetails && (
                    <details className="style-memory-technical">
                      <summary>Technical details</summary>
                      <dl>
                        {row.target_type && <><dt>Target</dt><dd>{row.target_type}</dd></>}
                        {row.context_type && <><dt>Context</dt><dd>{row.context_type}{row.context_id ? ` · ${row.context_id}` : ''}</dd></>}
                        {row.referenced_board_id && <><dt>{boardIsSource ? 'Source board' : 'Related board'}</dt><dd>{row.referenced_board_id}</dd></>}
                        {row.referenced_thread_id && <><dt>Source chat</dt><dd>{row.referenced_thread_id}</dd></>}
                        {readableNote !== String(row.note || '').trim() && <><dt>Raw note</dt><dd>{row.note}</dd></>}
                      </dl>
                    </details>
                  )}
                </div>
                <div className="style-memory-context-actions">
                  <span className="style-memory-date">{row.created_at}</span>
                  {canOpenContext && !canOpenSourceBoard && !canOpenRelatedBoard && !canOpenRelatedGarment && !canOpenThread && (
                    <button className="btn-secondary" onClick={() => openFeedbackContext(row)}>
                      Open {row.context_type === 'outfit' ? 'outfit' : 'garment'}
                    </button>
                  )}
                  {canOpenSourceBoard && (
                    <button className="btn-secondary" onClick={() => openFeedbackContext(row)}>
                      Open source board
                    </button>
                  )}
                  {canOpenThread && (
                    <button className="btn-secondary" onClick={() => onGoToThread(row.referenced_thread_id)}>Open source chat</button>
                  )}
                  {canOpenRelatedBoard && (
                    <button className="btn-secondary" onClick={() => navigate(`/visual-lab?section=profile&boardId=${relatedBoardId}`)}>Open related board</button>
                  )}
                  {canOpenRelatedGarment && (
                    <button className="btn-secondary" onClick={() => navigate(`/wardrobe?pieceId=${row?.payload?.pieceId || row?.payload?.piece?.id}`)}>Open related garment</button>
                  )}
                  <button className="style-memory-retire" onClick={() => removeContextualFeedback(row)}>Remove</button>
                </div>
              </div>
            </div>
          )
        })}
        </div>
        {matchingContextualFeedback.length > visibleContextualFeedback.length && (
          <button
            type="button"
            className="style-memory-show-more"
            onClick={() => setFeedbackVisibleCount(count => count + FEEDBACK_PAGE_SIZE)}
          >
            Show {Math.min(FEEDBACK_PAGE_SIZE, matchingContextualFeedback.length - visibleContextualFeedback.length)} more
          </button>
        )}
      </section>
      </>}

      {mode !== 'style' && <>
      <section className="account-settings-section">
        <div className="account-settings-heading">
          <div>
            <span>AI access</span>
            <h2>Provider keys</h2>
          </div>
          <p>
            {apiKeyStatus?.hasOperatorKeyAccess
              ? "Optional personal keys are used instead of this installation's shared keys."
              : "Add a personal key, or ask the operator to approve access to the installation's shared keys."}
          </p>
        </div>
        {apiKeyStatus && (
          <div className="account-settings-card account-settings-provider-list">
            <div className="account-settings-provider">
              <div className="account-settings-provider-copy">
                <strong>Anthropic</strong>
                <span className="account-settings-provider-status">
                  {apiKeyStatus.hasOwnAnthropicKey ? 'Personal key saved' : apiKeyStatus.hasOperatorKeyAccess ? 'Using installation key' : 'No key available'}
                </span>
              </div>
              <div className="account-settings-provider-control">
                <input
                  type="password"
                  aria-label="Anthropic API key"
                  placeholder={apiKeyStatus.hasOwnAnthropicKey ? '••••••••••••' : 'sk-ant-...'}
                  value={apiKeyDrafts.anthropicKey}
                  onChange={e => setApiKeyDrafts({ ...apiKeyDrafts, anthropicKey: e.target.value })}
                />
                <button className="btn-secondary" disabled={!apiKeyDrafts.anthropicKey} onClick={() => saveApiKey('anthropicKey', apiKeyDrafts.anthropicKey)}>Save</button>
                {apiKeyStatus.hasOwnAnthropicKey && (
                  <button className="account-settings-clear-key" onClick={() => saveApiKey('anthropicKey', '')}>Clear</button>
                )}
              </div>
            </div>
            <div className="account-settings-provider">
              <div className="account-settings-provider-copy">
                <strong>OpenAI</strong>
                <span className="account-settings-provider-status">
                  {apiKeyStatus.hasOwnOpenAiKey ? 'Personal key saved' : apiKeyStatus.hasOperatorKeyAccess ? 'Using installation key' : 'No key available'}
                </span>
              </div>
              <div className="account-settings-provider-control">
                <input
                  type="password"
                  aria-label="OpenAI API key"
                  placeholder={apiKeyStatus.hasOwnOpenAiKey ? '••••••••••••' : 'sk-...'}
                  value={apiKeyDrafts.openAiKey}
                  onChange={e => setApiKeyDrafts({ ...apiKeyDrafts, openAiKey: e.target.value })}
                />
                <button className="btn-secondary" disabled={!apiKeyDrafts.openAiKey} onClick={() => saveApiKey('openAiKey', apiKeyDrafts.openAiKey)}>Save</button>
                {apiKeyStatus.hasOwnOpenAiKey && (
                  <button className="account-settings-clear-key" onClick={() => saveApiKey('openAiKey', '')}>Clear</button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="account-settings-section">
          <div className="account-settings-heading">
            <div>
              <span>Operator tools</span>
              <h2>Administration</h2>
            </div>
          </div>
          <div className="account-settings-card account-settings-action-row">
            <div>
              <strong>Manage this installation</strong>
              <span>Manage users, access, invites, and operator settings.</span>
            </div>
            <Link to="/admin" className="btn-primary account-settings-admin-link">Open administration</Link>
          </div>
        </section>
      )}

      <section className="account-settings-section">
        <div className="account-settings-heading">
          <div>
            <span>Account access</span>
            <h2>Security &amp; sessions</h2>
          </div>
          <p>Review where your account is signed in and close sessions you no longer use.</p>
        </div>
        <div className="account-settings-card">
          <div className="account-settings-session-current">
            <div className="account-settings-session-copy">
              <span className="account-settings-current-badge">Current session</span>
              <strong>
              {currentSession ? friendlySessionName(currentSession.userAgentLabel) : 'Current session'}
              </strong>
              <span>
              {currentSession ? relativeSessionTime(currentSession.lastSeen) : 'Currently signed in'}
              </span>
            </div>
            <div className="account-settings-session-actions">
              {otherSessions.length > 0 && <button className="btn-secondary" onClick={revokeOtherSessions}>Sign out other sessions</button>}
              <button className="btn-secondary" onClick={logout}>Sign out</button>
            </div>
          </div>

          {otherSessions.length > 0 && (
            <div className="account-settings-other-sessions">
              <button
                type="button"
                className="account-settings-session-toggle"
                onClick={() => setSessionsExpanded(open => !open)}
                aria-expanded={sessionsExpanded}
              >
                <span>{sessionsExpanded ? 'Hide' : 'View'} {otherSessions.length} other {otherSessions.length === 1 ? 'session' : 'sessions'}</span>
                <span aria-hidden="true">{sessionsExpanded ? '↑' : '↓'}</span>
              </button>

              {sessionsExpanded && (
                <div className="account-settings-session-list">
                  {otherSessions.map(session => (
                    <div key={session.id} className="account-settings-session-row">
                      <div className="account-settings-session-copy">
                        <strong>{friendlySessionName(session.userAgentLabel)}</strong>
                        <span>{relativeSessionTime(session.lastSeen)}</span>
                      </div>
                      <button className="btn-secondary" onClick={() => revokeSession(session.id)}>Revoke session</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      </>}
    </div>
  )
}
