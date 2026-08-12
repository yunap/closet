// Spec 32 Part 2's edit surface: the style constitution is per-user DATA, and the user
// reading what their stylist believes about them — and correcting it directly — is the
// product's core loop. Every save appends the prior text to constitution_history (the
// ruling-archaeology log); the interviewable layers link back into the wizard for a re-run.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { canonicalFeedbackType, WRONG_PIECE_FOR_OUTFIT_FEEDBACK } from '../../lib/feedbackTaxonomy.js'
import { describeOwnerGuidanceScope } from '../../lib/ownerGuidance.js'
import { uploadThumbnailSrc } from '../utils/uploadThumbnails.js'

const LAYER_TITLES = {
  body_contract: 'Body & comfort',
  proven_formulas: 'Proven formulas',
  aesthetic_gravity: 'Aesthetic preferences',
  lane_neutrality: 'Style range',
  working_style: 'Working relationship',
  editorial_subject: 'How you should appear',
  editorial_shoes: 'How footwear should appear'
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
// Two tabs, not three: what the stylist uses now, and what still needs her attention. Past
// decisions is an archive for recovery — real, but not equal in weight to those two, so it lives
// behind a quiet link rather than claiming a third of the primary navigation.
const STYLE_PROFILE_TABS = [
  ['guidance', 'Active guidance'],
  ['review', 'Review feedback'],
]
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
const parsedIdList = value => {
  if (Array.isArray(value)) return value.map(Number).filter(Boolean)
  try { return JSON.parse(value || '[]').map(Number).filter(Boolean) } catch { return [] }
}
const effectiveSynthesisText = draft => String(draft?.edited_text || draft?.proposed_text || '')
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
const constraintContextPhrase = (dimension, value) => {
  if (dimension === 'season') return `in ${value}`
  if (dimension === 'weather') return `in ${value} weather`
  return `for ${value}`
}
const ownerConstraintProposal = row => {
  const proposal = row?.memory?.ownerConstraintProposal
  if (!proposal || Number(proposal.version) !== 1) return null
  if (proposal.selectorValues?.length !== 1 || proposal.contextValues?.length !== 1) return null
  return proposal
}

const timestampValue = value => {
  if (!value) return 0
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`
  const timestamp = new Date(normalized).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

const sentenceCase = value => {
  const text = String(value || '')
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text
}


// A lesson's conditions are ANDed — every populated dimension has to match before it is sent.
// Placeholder context the composer writes when nothing was chosen ("none") is not a condition a
// person would recognise, so it never appears in her sentence.
const SCOPE_PLACEHOLDERS = new Set(['none', 'unspecified', 'any', 'current season'])
const synthesisScopeParts = draft => {
  const applicability = synthesisApplicability(draft)
  const pieceNames = new Map((draft.applicabilityOptions?.pieces || []).map(piece => [piece.id, piece.name]))
  const meaningful = values => values.filter(value => !SCOPE_PLACEHOLDERS.has(String(value).toLowerCase()))
  return {
    garment: applicability.piece_ids.map(id => pieceNames.get(id) || `piece #${id}`),
    context: meaningful([
      ...applicability.occasions,
      ...applicability.activities,
      ...applicability.seasons,
      ...applicability.weather_terms,
    ]),
  }
}
// "Used when: canvas sneakers · wet weather" — the terms themselves, never the field names that
// carry them. A row whose scope was never resolved simply shows nothing rather than explaining an
// internal state she has no way to act on from this card.
const ownerGuidanceUsedWhen = row => describeOwnerGuidanceScope(row?.memory?.ownerGuidanceApplicability)
// Her own words for the baseline, not the layer keys. Descriptions say what each one governs so
// the foundation reads as a summary of what she told the stylist at setup, not a settings index.
const FOUNDATION_TILES = [
  ['body_contract', 'Body & comfort', 'Your fit, comfort and movement needs'],
  ['aesthetic_gravity', 'Aesthetic preferences', 'The looks and details you gravitate toward'],
  ['proven_formulas', 'Proven formulas', 'Outfit structures that work for you'],
  ['lane_neutrality', 'Style range', 'How broadly your stylist can explore'],
  ['working_style', 'Working relationship', 'How you want your stylist to communicate'],
  ['editorial_subject', 'Image guidance', 'How you appear in generated looks'],
  ['editorial_shoes', 'Footwear guidance', 'How shoes are handled in generated looks'],
]
const FOUNDATION_TILE_GLYPHS = {
  body_contract: 'M12 4a2 2 0 100 4 2 2 0 000-4zM8 21v-6l-2-3 2-3h8l2 3-2 3v6',
  aesthetic_gravity: 'M4 5h16v11H4zM8 20h8M9 12l2.5-3 2 2.5L15 10l3 3',
  proven_formulas: 'M5 4h9l5 5v11H5zM14 4v5h5M8 14h8M8 17h5',
  lane_neutrality: 'M12 4v16M6 8l-3 4 3 4M18 8l3 4-3 4',
  working_style: 'M4 5h16v10H9l-5 4z',
  editorial_subject: 'M4 6h16v12H4zM4 15l4-4 3 3 4-5 5 6',
  editorial_shoes: 'M3 16h10l4-3 4 1v2H3zM3 16v-5h4l2 3',
}

// Warmer than the layer keys, and phrased as what the stylist does with each one.
const FOUNDATION_DESCRIPTIONS = {
  body_contract: 'How your stylist thinks about fit, movement, and comfort.',
  proven_formulas: 'Outfit formulas your stylist relies on most.',
  aesthetic_gravity: "The visual qualities you're drawn to.",
  lane_neutrality: 'How broadly your stylist can explore different moods.',
  working_style: 'How you want your stylist to communicate, ask, and respond.',
  editorial_subject: 'How you want to be represented in generated outfit imagery.',
  editorial_shoes: 'How footwear should be shown and styled in generated imagery.',
}

// The stored layer is a prompt: it carries a "Layer N — …" header, ALL-CAPS emphasis aimed at the
// model, and glossary lines about app internals. None of that belongs in something she reads as
// her own style notes. This filters the reading view ONLY — the stored text is never rewritten,
// and Edit shows it verbatim, so nothing here can quietly change what the stylist receives.
const FOUNDATION_INTERNAL_LINE = /\bDBs?\b|\bdatabase\b|\bapp\s+DB\b/i
const FOUNDATION_LAYER_HEADER = /^Layer\s+\d+\s+[—-]/i
const isBareHeading = text => /:$/.test(text) && text.split(/\s+/).length <= 4
const softenModelEmphasis = text => text.replace(/\b[A-Z]{2,}\b/g, match => match.toLowerCase())

function foundationReadingLines(body) {
  const lines = []
  let hiddenCount = 0
  for (const raw of String(body || '').split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (FOUNDATION_LAYER_HEADER.test(trimmed) || isBareHeading(trimmed)) continue
    const text = trimmed.replace(/^[-•]\s*/, '').replace(/[;]$/, '').trim()
    if (!text) continue
    if (FOUNDATION_INTERNAL_LINE.test(text)) { hiddenCount += 1; continue }
    lines.push(softenModelEmphasis(text))
  }
  return { lines, hiddenCount }
}

const friendlyLayerDate = value => {
  if (!value) return ''
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return String(value)
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear()
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

const TOLD_GUIDANCE_PREVIEW = 5
const LIMITS_PREVIEW = 4

// The garment a lesson is about, so the card can show it instead of describing it.
const lessonPhoto = draft => {
  const first = synthesisApplicability(draft).piece_ids[0]
  return (draft.applicabilityOptions?.pieces || []).find(piece => piece.id === first)?.photo || null
}

// Same idea for a still-pending draft, but a lesson can name two pieces at once (a pairing that
// doesn't work together) — show both when both exist, rather than only ever the first.
const draftLessonPhotos = draft => {
  const ids = synthesisApplicability(draft).piece_ids.slice(0, 2)
  const byId = new Map((draft.applicabilityOptions?.pieces || []).map(piece => [piece.id, piece]))
  return ids.map(id => byId.get(id)).filter(piece => piece?.photo)
}

// "Applies when styling these shoes for summer." — a sentence, not a field dump.
const lessonAppliesSentence = draft => {
  const { garment, context } = synthesisScopeParts(draft)
  if (garment.length && context.length) return `Applies when styling ${garment.join(' or ')} for ${context.join(' ')}.`
  if (garment.length) return `Applies when styling ${garment.join(' or ')}.`
  if (context.length) return `Applies for ${context.join(' ')}.`
  return 'Applies whenever it is relevant.'
}

// The same scope, phrased as what happens next rather than as a filter rule — for a draft still
// waiting on a decision. Only meaningful for a personal/contextual lesson: other dispositions
// don't get delivered as scoped guidance at all, so they never call this.
const synthesisRememberSentence = draft => {
  const { garment, context } = synthesisScopeParts(draft)
  if (garment.length && context.length) return `Your stylist would remember this when styling ${garment.join(' or ')} for ${context.join(' ')}.`
  if (garment.length) return `Your stylist would remember this when styling ${garment.join(' or ')}.`
  if (context.length) return `Your stylist would remember this for ${context.join(' ')}.`
  return 'Your stylist would remember this whenever it comes up.'
}

// A lesson can be synthesized from several reactions on different days and different outfits, so
// there is rarely one true "this outfit" to point at — the honest version names how many and when,
// not a single fabricated scene. sources is the caller's own contextualFeedback rows so this never
// re-fetches or assumes a shape the caller doesn't already have.
const synthesisProvenanceSentence = sources => {
  const dated = sources.map(row => row.created_at).filter(Boolean).sort()
  if (!dated.length) return sources.length ? 'Based on feedback you gave.' : ''
  const latest = friendlyLayerDate(dated[dated.length - 1])
  if (sources.length === 1) return `Based on feedback you gave${latest ? ` on ${latest}` : ''}.`
  return `Based on ${sources.length} things you flagged${latest ? `, most recently ${latest}` : ''}.`
}

// A quiet line glyph so a list of sentences scans as distinct memories rather than a wall of text.
// Chosen from what the guidance is actually about; the generic note is the honest fallback.
const GUIDANCE_GLYPHS = [
  [/\btravel\b|\bairplane\b|\btrip\b/, 'M2 9l14-5-3 6 3 6-14-5 4-1z'],
  [/\brain|\bwet\b|\bfog|\bweather\b/, 'M5 12a3 3 0 010-6 4 4 0 017.6-1A3.5 3.5 0 1114 12zm1 2l-1 3m3-3l-1 3m3-3l-1 3'],
  [/\boffice\b|\bclient\b|\bwork\b/, 'M3 7h14v9H3zM7 7V5h6v2'],
  [/\bsummer\b|\bhot\b/, 'M10 5v-2m0 14v2m5-9h2M3 10h2m8.5-4.5l1.5-1.5M5 15l1.5-1.5m0-7L5 5m10 10l-1.5-1.5M13 10a3 3 0 11-6 0 3 3 0 016 0z'],
  [/\bwinter\b|\bcold\b/, 'M10 3v14M4 6l12 8M16 6L4 14'],
]
const guidanceGlyph = row => {
  const haystack = `${row.note || ''} ${ownerGuidanceUsedWhen(row)}`.toLowerCase()
  const path = GUIDANCE_GLYPHS.find(([pattern]) => pattern.test(haystack))?.[1]
    || 'M5 4h10v12l-5-3-5 3z'
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
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
  const [searchParams, setSearchParams] = useSearchParams()
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
  // Per-draft resting state for the "Not quite" reveal: null (resting card), 'chips' (reason
  // chips shown), or 'wording' (the one reason with something to actually edit). Nothing here is
  // ever sent to the server until a chip is clicked or the wording is saved.
  const [draftTriage, setDraftTriage] = useState({})
  const [synthesisSavedId, setSynthesisSavedId] = useState(null)
  const [synthesisBusy, setSynthesisBusy] = useState(false)
  const [styleProfileTab, setStyleProfileTab] = useState('guidance')
  const [ownerConstraints, setOwnerConstraints] = useState([])
  const [productFindings, setProductFindings] = useState([])
  const [productResolutionDrafts, setProductResolutionDrafts] = useState({})
  const [demo, setDemo] = useState(null)
  const [convertingLearningId, setConvertingLearningId] = useState(null)
  const [showAllLearnings, setShowAllLearnings] = useState(false)
  const [foundationOpen, setFoundationOpen] = useState(false)
  const [forgottenLearnings, setForgottenLearnings] = useState([])
  const [openFoundationLayer, setOpenFoundationLayer] = useState(null)
  const [editingFoundationLayer, setEditingFoundationLayer] = useState(null)
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
      const [feedback, savedBoards, synthesisRows, constraints, findings] = await Promise.all([
        fetch('/api/stylist-feedback?limit=1000&includeArchived=true').then(r => r.json()).catch(() => []),
        fetch('/api/saved-boards?limit=500').then(r => r.json()).catch(() => []),
        fetch('/api/feedback-synthesis/drafts').then(r => r.json()).catch(() => []),
        fetch('/api/owner-constraints').then(r => r.json()).catch(() => []),
        fetch('/api/product-quality-findings').then(r => r.json()).catch(() => []),
      ])
      const feedbackRows = Array.isArray(feedback) ? feedback : []
      const liveFeedbackRows = feedbackRows.filter(row => !row.archived)
      const activeFeedbackRows = liveFeedbackRows.filter(row => row.memory?.strength !== 'none')
      setLearnings(activeFeedbackRows.filter(isStandingLearning))
      setContextualFeedback(activeFeedbackRows.filter(row => !isStandingLearning(row)))
      // Forgetting guidance archives the row rather than deleting it, so it stays recoverable —
      // but nothing surfaced it, which made "Forget this" look permanent. Past decisions lists it.
      setForgottenLearnings(feedbackRows.filter(row => row.archived && isStandingLearning(row)))
      setFeedbackBoards(Array.isArray(savedBoards) ? savedBoards : [])
      setSynthesisDrafts(Array.isArray(synthesisRows) ? synthesisRows : [])
      setOwnerConstraints(Array.isArray(constraints) ? constraints : [])
      setProductFindings(Array.isArray(findings) ? findings : [])
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

  const archiveLearning = async (row) => {
    const res = await fetch(`/api/stylist-feedback/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) })
    if (res.ok) { flash('Learning retired — it will no longer influence styling.'); load() }
  }

  const convertLearningToConstraint = async (row) => {
    const res = await fetch('/api/owner-constraints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmOwnerConstraint: true,
        sourceFeedbackId: row.id,
        useStoredProposal: true,
      }),
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok) return flash(result.error || 'Could not create this rule.')
    setConvertingLearningId(null)
    flash('Always-avoid rule created. The old prompt sentence was archived.')
    load()
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

  const retireOwnerConstraint = async (constraint) => {
    const res = await fetch(`/api/owner-constraints/${constraint.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'retired' }),
    })
    if (res.ok) { flash('Constraint retired.'); load() }
    else flash('Failed to retire constraint')
  }

  const dismissProductFinding = async (finding) => {
    const res = await fetch(`/api/product-quality-findings/${finding.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed', resolutionType: 'no_change' }),
    })
    if (res.ok) { flash('Product issue dismissed.'); load() }
    else flash('Failed to dismiss product issue')
  }

  // The archive exists for recovery, so every row in it has to lead somewhere. Each of these
  // reverses the decision that put the record there; all three were already supported by the API
  // and simply had no way to reach them.
  const restoreOwnerConstraint = async (constraint) => {
    const res = await fetch(`/api/owner-constraints/${constraint.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    if (res.ok) { flash('Firm rule is being used again.'); load() }
    else flash('Could not start using this rule again.')
  }

  const restoreLearning = async (row) => {
    const res = await fetch(`/api/stylist-feedback/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: false }),
    })
    if (res.ok) { flash('Your stylist is using this again.'); load() }
    else flash('Could not start using this again.')
  }

  const removeSynthesisNonResult = async (draft) => {
    const res = await fetch(`/api/feedback-synthesis/drafts/${draft.id}`, { method: 'DELETE' })
    if (res.ok) { flash('Removed.'); load() }
    else flash((await res.json().catch(() => ({}))).error || 'Could not remove this.')
  }

  const reopenProductFinding = async (finding) => {
    const res = await fetch(`/api/product-quality-findings/${finding.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'open' }),
    })
    if (res.ok) { flash('Reopened for review.'); load() }
    else flash('Could not reopen this issue.')
  }

  const resolveProductFinding = async (finding) => {
    const draft = productResolutionDrafts[finding.id] || {}
    if (!draft.resolutionType) return
    const res = await fetch(`/api/product-quality-findings/${finding.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'resolved',
        resolutionType: draft.resolutionType,
        resolutionNote: draft.resolutionNote || '',
      }),
    })
    if (res.ok) {
      setProductResolutionDrafts(previous => { const next = { ...previous }; delete next[finding.id]; return next })
      flash('Product issue resolved.'); load()
    } else flash('Failed to resolve product issue')
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
  const pendingSynthesisDrafts = synthesisDrafts.filter(draft =>
    ['draft', 'deferred'].includes(draft.status) && draft.disposition !== 'insufficient_evidence')
  const activeOwnerConstraints = ownerConstraints.filter(row => row.status === 'active')
  // Reported outcomes from recent runs. Shown so the owner can see WHY a reaction taught nothing —
  // that explanation is the part worth reading, and it tells her what a reaction needs next time.
  const reportedNonResults = synthesisDrafts
    .filter(row => row.disposition === 'insufficient_evidence' && row.status === 'reported')
    .slice(0, 5)
  const acceptedContextualLessons = synthesisDrafts.filter(draft => draft.status === 'accepted' && draft.disposition === 'personal_contextual_lesson')
  const visibleLearnings = showAllLearnings ? learnings : learnings.slice(0, TOLD_GUIDANCE_PREVIEW)
  const guidanceLimitCount = activeOwnerConstraints.length + occasionExclusions.length
  const groupedOccasionExclusions = [...occasionExclusions.reduce((groups, entry) => {
    const key = String(entry.pieceId)
    const group = groups.get(key) || { pieceId: entry.pieceId, name: entry.name, photo: entry.photo, entries: [] }
    group.entries.push(entry)
    groups.set(key, group)
    return groups
  }, new Map()).values()]
  // The server already returns exclusions newest-changed first (parsed from each one's receipt),
  // so grouping preserves that order and the preview shows what actually changed most recently.
  const showingAllLimits = searchParams.get('limits') === 'all'
  const showingPastDecisions = searchParams.get('past') === '1'
  const closeSubView = key => setSearchParams(params => {
    const next = new URLSearchParams(params)
    next.delete(key)
    return next
  })
  const openSubView = key => setSearchParams(params => {
    const next = new URLSearchParams(params)
    next.set(key, key === 'past' ? '1' : 'all')
    return next
  })

  // History is grouped by what she did, not by which table the record came from. The old list
  // labelled rows "Retired constraint" / "Rejected draft" / "Reviewed conclusion" — storage names
  // for three stores that, from her side, are the same two or three decisions.
  const retiredConstraints = ownerConstraints.filter(row => row.status === 'retired')
  const reviewedDrafts = synthesisDrafts.filter(row => row.status === 'accepted' && row.disposition !== 'personal_contextual_lesson')
  // "Insufficient evidence" is not a suggestion she turned down — it is the stylist reporting that
  // it could not learn anything from the reactions it was given. Its rationale says why ("the
  // occasion field holds a garment descriptor, not a context term"), which is the one thing in this
  // archive that teaches her how to give feedback that will actually stick. Grouping it with
  // declined suggestions both misdescribed it and buried the useful part.
  const unlearnableDrafts = synthesisDrafts.filter(row =>
    row.disposition === 'insufficient_evidence' && row.status !== 'draft' && row.status !== 'deferred')
  const declinedDrafts = synthesisDrafts.filter(row =>
    row.status === 'rejected' && row.disposition !== 'insufficient_evidence')
  const historyGroups = [
    {
      key: 'stopped',
      title: 'No longer used',
      description: 'Rules and lessons you stopped using.',
      glyph: 'M5 12h14',
      rows: [
        ...retiredConstraints.map(row => ({
          key: `constraint-${row.id}`,
          title: `${sentenceCase(row.selector_values.join(', '))} — not ${constraintContextPhrase(row.context_dimension, row.context_values.join(', '))}`,
          detail: 'Firm rule you stopped using.',
          date: row.updated_at || row.created_at,
          action: { label: 'Start using again', run: () => restoreOwnerConstraint(row) },
        })),
        ...forgottenLearnings.map(row => ({
          key: `forgotten-${row.id}`,
          title: row.note,
          detail: ownerGuidanceUsedWhen(row) ? `Was used for ${ownerGuidanceUsedWhen(row)}.` : 'Guidance you stopped using.',
          date: row.updated_at || row.created_at,
          action: { label: 'Start using again', run: () => restoreLearning(row) },
        })),
        ...synthesisDrafts.filter(row => row.status === 'retired' && row.disposition !== 'insufficient_evidence').map(row => ({
          key: `retired-${row.id}`,
          title: row.title || effectiveSynthesisText(row) || 'Saved lesson',
          detail: row.disposition === 'garment_fact_correction' ? 'Garment correction you stopped using.' : 'Lesson you stopped using.',
          date: row.updated_at || row.created_at,
          action: { label: 'Start using again', run: () => updateSynthesisDraft(row, 'accepted') },
        })),
      ],
    },
    {
      key: 'declined',
      title: 'You decided not to keep these',
      description: 'Suggestions your stylist proposed that you turned down.',
      glyph: 'M6 6l12 12M18 6L6 18',
      rows: declinedDrafts.map(row => ({
        key: `rejected-${row.id}`,
        title: row.title || effectiveSynthesisText(row) || 'Suggested lesson',
        detail: 'Your stylist suggested this; you declined it.',
        date: row.updated_at || row.created_at,
        // Back to Review feedback rather than straight to active: it was declined once, so it
        // should be re-decided rather than silently switched on.
        action: { label: 'Reconsider', run: () => updateSynthesisDraft(row, 'draft') },
      })),
    },
    {
      key: 'closed',
      title: 'Reviewed and closed',
      description: 'Issues that were looked at and settled.',
      glyph: 'M5 12l4 4L19 7',
      rows: [
        ...reviewedDrafts.filter(row => row.disposition !== 'insufficient_evidence').map(row => ({
          key: `reviewed-${row.id}`,
          title: row.title || 'Reviewed conclusion',
          detail: effectiveSynthesisText(row) || row.boundary || '',
          date: row.updated_at || row.created_at,
          action: { label: 'Reconsider', run: () => updateSynthesisDraft(row, 'draft') },
        })),
        ...productFindings.filter(row => row.status !== 'open').map(row => ({
          key: `finding-${row.id}`,
          title: row.title || 'Product issue',
          detail: row.resolution_note || row.description || (row.status === 'resolved' ? 'Resolved.' : 'Dismissed.'),
          date: row.updated_at || row.created_at,
          action: { label: 'Reopen', run: () => reopenProductFinding(row) },
        })),
      ],
    },
    {
      key: 'unlearnable',
      title: "Couldn't be turned into a lesson",
      description: 'Your stylist looked at these but did not find enough to go on.',
      glyph: 'M12 8v5m0 3h.01M12 3l9 16H3z',
      // Removable rather than recoverable: there is nothing to switch back on, and these would
      // otherwise pile up in the archive. The explanation is the value while it is there.
      rows: unlearnableDrafts.map(row => ({
        key: `unlearnable-${row.id}`,
        title: row.title || 'Nothing could be learned',
        detail: row.rationale || row.boundary || 'Not enough context to draw a conclusion.',
        date: row.updated_at || row.created_at,
        action: { label: 'Remove', run: () => removeSynthesisNonResult(row) },
      })),
    },
  ]
  const feedbackBoardImage = row => row?.payload?.board?.imageUrl || row?.payload?.board?.image_url || ''
  const matchedFeedbackBoard = row => {
    const imageUrl = feedbackBoardImage(row)
    return imageUrl ? feedbackBoards.find(board => board.image_url === imageUrl) : null
  }

  const rendererCorrections = contextualFeedback.filter(row => row.memory?.destination === 'renderer')
  // What the renderer is actually told, in her words. Three things the old copy got wrong:
  // it never said WHAT looked wrong (the structured `issue` was on hand), it used the context
  // label — often the meaningless "Whole wardrobe" — instead of the garment the correction names,
  // and it never said what the stylist now does, which is the whole point of the section.
  const RENDERER_ISSUE_TEXT = {
    sleeves_too_long: 'Sleeves were drawn too long',
    sleeves_too_short: 'Sleeves were drawn too short',
    upper_hem_too_long: 'The hem was drawn too long',
    upper_hem_too_short: 'The hem was drawn too short',
    lower_hem_too_long: 'It was drawn too long',
    lower_hem_too_short: 'It was drawn too short',
  }
  // Only the types getSavedBoardRendererMemory actually reads. 'bad_reference' is deliberately
  // absent: it is classified as a renderer type but no renderer path consumes it, so listing it
  // here would claim an effect that does not exist.
  const RENDERER_EFFECT_TEXT = {
    wrong_length: { global: false, fallback: 'It was drawn at the wrong length', effect: 'Your stylist now matches the length in your saved photo.' },
    wrong_garment_details: { global: false, fallback: 'Its print, neckline or sleeves were drawn wrong', effect: 'Your stylist now copies those details from your saved photo.' },
    body_proportions_drift: { global: true, fallback: 'Your body proportions looked wrong', effect: 'Your stylist keeps your proportions matched to your real photos.' },
    identity_drift: { global: true, fallback: 'The face did not look like you', effect: 'Your stylist keeps your face matched to your real photos.' },
    wrong_proportions: { global: true, fallback: 'Your body proportions looked wrong', effect: 'Your stylist keeps your proportions matched to your real photos.' },
    proportion_problem: { global: true, fallback: 'Your body proportions looked wrong', effect: 'Your stylist keeps your proportions matched to your real photos.' },
  }
  const GENERIC_CONTEXT_TITLES = new Set(['whole wardrobe', 'wardrobe', ''])

  const rendererReportGroups = [...rendererCorrections.reduce((groups, row) => {
    const spec = RENDERER_EFFECT_TEXT[canonicalFeedbackType(row.feedback_type)]
    if (!spec) return groups
    let payload = row.payload || {}
    if (typeof payload === 'string') { try { payload = JSON.parse(payload) || {} } catch { payload = {} } }
    const correction = payload.length_correction || {}
    // The correction names the garment; context_name is where the reaction happened.
    // Prefer the garment the correction names; fall back to the outfit it was reported on, since
    // context_name is often the meaningless storage label "Whole wardrobe".
    const named = correction.piece_name
      || (GENERIC_CONTEXT_TITLES.has(String(row.context_name || '').toLowerCase()) ? '' : row.context_name)
      || (payload.board?.label ? `A garment in “${payload.board.label}”` : '')
    const title = spec.global ? 'Every picture' : (named || 'A garment in a saved outfit')
    const problem = RENDERER_ISSUE_TEXT[correction.issue] || spec.fallback
    const key = `${title}::${problem}`
    const group = groups.get(key) || {
      key, title, problem, effect: spec.effect, global: spec.global, count: 0,
      // The picture that looked wrong is the artifact being reported, so it is the thumbnail —
      // more use than the garment's catalog photo, which shows nothing about the render. Links go
      // to both when known. A repeated report links to the most recent occurrence, not all of them.
      boardImage: feedbackBoardImage(row),
      boardId: row.referenced_board_id || matchedFeedbackBoard(row)?.id || null,
      boardLabel: payload.board?.label || '',
      pieceId: Number(correction.piece_id) || null,
      pieceName: correction.piece_name || '',
    }
    group.count += 1
    groups.set(key, group)
    return groups
  }, new Map()).values()]
    .sort((left, right) => (Number(left.global) - Number(right.global)) || (right.count - left.count))

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

  const updateSynthesisDraft = async (draft, nextStatus, extra = {}) => {
    const hasTextEdit = Object.hasOwn(synthesisEdits, draft.id)
    const body = { status: nextStatus, ...extra }
    if (hasTextEdit) body.editedText = synthesisEdits[draft.id]
    const response = await fetch(`/api/feedback-synthesis/drafts/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok) return flash(result.error || 'Could not update this draft.')
    setSynthesisDrafts(previous => previous.map(row => row.id === draft.id ? result : row))
    setSynthesisEdits(previous => { const next = { ...previous }; delete next[draft.id]; return next })
    setSynthesisApplicabilityEdits(previous => { const next = { ...previous }; delete next[draft.id]; return next })
    setDraftTriage(previous => { const next = { ...previous }; delete next[draft.id]; return next })
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

  const renderExclusionRow = (group) => (
    <div key={group.pieceId} className="limit-row">
      <span className="limit-row-thumb">
        {group.photo
          ? <img src={uploadThumbnailSrc(`/uploads/${group.photo}`, 'garment-display')} alt="" loading="lazy" decoding="async" />
          : <span className="limit-row-thumb--empty" aria-hidden="true" />}
      </span>
      <div className="limit-row-body">
        <strong>{group.name}</strong>
        <span>Not for {group.entries.map((entry, index) => (
          <span key={entry.occasion}>
            {index > 0 && ', '}
            <em>{sentenceCase(entry.occasion)}</em>
          </span>
        ))}</span>
      </div>
      <div className="limit-row-actions">
        {group.entries.map(entry => (
          <button key={entry.occasion} className="btn-secondary" onClick={() => restoreOccasionExclusion(entry)}>
            Restore for {entry.occasion}
          </button>
        ))}
      </div>
    </div>
  )

  const renderStyleLayer = ({ layer, body, updatedAt, isDefault }) => {
    const description = FOUNDATION_DESCRIPTIONS[layer] || (LAYER_META[layer] || [])[1] || 'Working guidance used by your stylist.'
    const isOpen = openFoundationLayer === layer
    const isEditing = editingFoundationLayer === layer
    const draft = drafts[layer] ?? body
    const { lines, hiddenCount } = foundationReadingLines(body)
    return (
      <div key={layer} className={`foundation-layer${isOpen ? ' is-open' : ''}`}>
        <div className="foundation-layer-head">
          <span className="foundation-layer-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d={FOUNDATION_TILE_GLYPHS[layer]} />
            </svg>
          </span>
          <button
            type="button"
            className="foundation-layer-toggle"
            aria-expanded={isOpen}
            onClick={() => {
              // One open at a time — the foundation is seven sections and only stays readable if
              // it never unfolds all of them at once.
              setEditingFoundationLayer(null)
              setOpenFoundationLayer(current => (current === layer ? null : layer))
            }}
          >
            <strong>{LAYER_TITLES[layer] || layer}</strong>
            <span>{description}</span>
          </button>
          <div className="foundation-layer-actions">
            {isDefault && <span className="foundation-layer-status">Not personalized</span>}
            {!isEditing && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setOpenFoundationLayer(layer); setEditingFoundationLayer(layer) }}
              >
                Edit
              </button>
            )}
            <span className="foundation-layer-chevron" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8l5 5 5-5" /></svg>
            </span>
          </div>
        </div>

        {isOpen && !isEditing && (
          <div className="foundation-layer-read">
            {lines.length > 1
              ? <ul>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
              : <p>{lines[0] || 'Nothing recorded yet.'}</p>}
            <p className="foundation-layer-footer">
              {layer === 'proven_formulas'
                ? <span>Earned from outfits you&rsquo;ve confirmed</span>
                : <span>{isDefault || !updatedAt ? 'Using the default guidance' : `Updated ${friendlyLayerDate(updatedAt)}`}</span>}
              {!isDefault && <><span aria-hidden="true"> · </span><button type="button" className="foundation-layer-link" onClick={() => showHistory(layer)}>{historyFor === layer ? 'Hide history' : 'View history'}</button></>}
              {INTERVIEW_STEPS[layer] && <><span aria-hidden="true"> · </span><Link className="foundation-layer-link" to={`/onboarding?step=${INTERVIEW_STEPS[layer]}&return=visual-lab`}>Redo interview</Link></>}
              {hiddenCount > 0 && <><span aria-hidden="true"> · </span><span>{hiddenCount} technical {hiddenCount === 1 ? 'note' : 'notes'} shown when editing</span></>}
            </p>
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
        )}

        {isOpen && isEditing && (
          <div className="foundation-layer-edit">
            {/* Edit shows the stored text exactly as the stylist receives it, including the
                technical lines the reading view leaves out. */}
            <textarea
              className="style-profile-editor"
              value={draft}
              autoFocus
              onChange={e => setDrafts({ ...drafts, [layer]: e.target.value })}
            />
            <div className="foundation-layer-edit-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { const next = { ...drafts }; delete next[layer]; setDrafts(next); setEditingFoundationLayer(null) }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={draft === body}
                onClick={async () => { await saveLayer(layer); setEditingFoundationLayer(null) }}
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
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

      {mode === 'style' && (
        <nav className="style-profile-tabs" aria-label="Style profile sections">
          {STYLE_PROFILE_TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={styleProfileTab === value ? 'active' : ''}
              aria-current={styleProfileTab === value ? 'page' : undefined}
              onClick={() => {
                setStyleProfileTab(value)
                if (showingAllLimits) setSearchParams(params => {
                  const next = new URLSearchParams(params)
                  next.delete('limits')
                  return next
                })
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

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

      {/* A dedicated view, not an inline expansion: "Review all" on a long list has to take her
          somewhere, or Active guidance turns back into the full memory inventory. It is a URL
          param so the browser back button returns her to the overview. */}
      {mode === 'style' && styleProfileTab === 'guidance' && showingAllLimits && !showingPastDecisions && (
        <section className="style-profile-section limits-all">
          <button type="button" className="limits-all-back" onClick={() => closeSubView('limits')}>
            <span aria-hidden="true">←</span> Back to active guidance
          </button>
          <div className="style-profile-section-heading">
            <div>
              <span>All limits</span>
              <h2>{guidanceLimitCount} active {guidanceLimitCount === 1 ? 'limit' : 'limits'}</h2>
            </div>
            <p>Everything your stylist currently leaves out, and the situations it applies to.</p>
          </div>
          {activeOwnerConstraints.length > 0 && (
            <div className="limit-group">
              <div className="limit-group-heading"><div><strong>Always avoid</strong><span>Firm rules your stylist always enforces.</span></div></div>
              <div className="limit-rows">
                {activeOwnerConstraints.map(row => (
                  <div key={`all-constraint:${row.id}`} className="limit-row">
                    <div className="limit-row-body">
                      <strong>{sentenceCase(row.selector_values.join(', '))}</strong>
                      <span>Not {constraintContextPhrase(row.context_dimension, row.context_values.join(', '))}.</span>
                    </div>
                    <button className="btn-secondary" onClick={() => retireOwnerConstraint(row)}>Stop using rule</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {groupedOccasionExclusions.length > 0 && (
            <div className="limit-group">
              <div className="limit-group-heading"><div><strong>Specific pieces</strong><span>Pieces your stylist avoids for certain occasions.</span></div></div>
              <div className="limit-rows">{groupedOccasionExclusions.map(renderExclusionRow)}</div>
            </div>
          )}
        </section>
      )}

      {mode === 'style' && styleProfileTab === 'guidance' && !showingAllLimits && !showingPastDecisions && <>
      <section id="contextual-lessons" className="style-profile-section style-profile-learnings style-profile-contextual">
        <div className="style-profile-section-heading">
          <div>
            <span>When it matters</span>
            <h2>Things your stylist remembers for particular clothes or situations</h2>
          </div>
          <p>Your stylist uses these only when the right piece or situation comes up.</p>
        </div>
        {feedbackLoading && <div className="style-profile-empty">Loading guidance…</div>}
        {!feedbackLoading && !acceptedContextualLessons.length && !learnings.length && (
          <div className="style-profile-empty">Nothing here yet — your stylist adds to this as you work together.</div>
        )}

        {acceptedContextualLessons.length > 0 && (
          <div className="memory-card-list">
            {acceptedContextualLessons.map(draft => {
              const sourceIds = parsedIdList(draft.source_feedback_ids)
              const sources = sourceIds.map(id => contextualFeedback.find(row => Number(row.id) === id)).filter(Boolean)
              const photo = lessonPhoto(draft)
              return (
                <article key={`lesson:${draft.id}`} id={`contextual-lesson-${draft.id}`} className="memory-card">
                  <div className="memory-card-thumb">
                    {photo
                      ? <img src={uploadThumbnailSrc(`/uploads/${photo}`, 'garment-display')} alt="" loading="lazy" decoding="async" />
                      : <span className="memory-card-thumb-empty" aria-hidden="true" />}
                  </div>
                  <div className="memory-card-body">
                    <h3>{effectiveSynthesisText(draft)}</h3>
                    <p className="memory-card-scope">{lessonAppliesSentence(draft)}</p>
                    <p className="memory-card-source">Learned from feedback you approved.</p>
                  </div>
                  <div className="memory-card-actions">
                    <button type="button" className="btn-secondary" onClick={() => updateSynthesisDraft(draft, 'retired')}>Forget this</button>
                  </div>
                  <details className="memory-card-more">
                    <summary>Where this came from</summary>
                    {sources.length > 0
                      ? <ul>{sources.map(source => <li key={source.id}>{source.memory?.display?.title || source.context_name || source.label}: {source.memory?.display?.summary || readableFeedbackNote(source.note)}</li>)}</ul>
                      : <p>{sourceIds.length ? 'The original reactions are no longer available.' : 'No source reactions recorded.'}</p>}
                  </details>
                </article>
              )
            })}
          </div>
        )}

        {learnings.length > 0 && (
          <div className="memory-told">
            <div className="memory-told-heading">Other things you&rsquo;ve told your stylist</div>
            <div className="memory-told-list">
              {visibleLearnings.map(row => {
                const proposal = ownerConstraintProposal(row)
                const scope = ownerGuidanceUsedWhen(row)
                return (
                  <div key={`direct:${row.id}`} id={`learned-guidance-${row.id}`} className="memory-told-row">
                    <span className="memory-told-icon" aria-hidden="true">{guidanceGlyph(row)}</span>
                    <div className="memory-told-body">
                      <p className="memory-told-text">{row.note}</p>
                      {scope && <p className="memory-told-scope">For {scope}</p>}
                    </div>
                    <div className="memory-told-actions">
                      {proposal && (
                        <button className="btn-secondary" onClick={() => setConvertingLearningId(row.id)}>Make this a firm rule</button>
                      )}
                      <button className="btn-secondary" onClick={() => archiveLearning(row)}>Forget this</button>
                    </div>
                    {convertingLearningId === row.id && (
                      <div className="owner-rule-conversion">
                        <div>
                          <strong>Make this an always-avoid rule?</strong>
                          <span>This rule can be enforced while clothes are being selected.</span>
                        </div>
                        <div className="owner-rule-conversion-preview">
                          <strong>Your stylist will not suggest {proposal.selectorValues[0]} {constraintContextPhrase(proposal.contextDimension, proposal.contextValues[0])}.</strong>
                          <span>The original learned sentence will be kept in history, but will stop being sent separately.</span>
                        </div>
                        <div className="style-memory-actions">
                          <button className="btn-secondary" onClick={() => setConvertingLearningId(null)}>Cancel</button>
                          <button className="btn-primary" onClick={() => convertLearningToConstraint(row)}>Confirm firm rule</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {learnings.length > TOLD_GUIDANCE_PREVIEW && (
              <button type="button" className="btn-secondary memory-see-all" onClick={() => setShowAllLearnings(value => !value)}>
                {showAllLearnings ? 'Show fewer' : `See all guidance (${learnings.length})`}
              </button>
            )}
          </div>
        )}
      </section>

      <section id="garment-occasion-limits" className="style-profile-section style-profile-limits">
        <div className="style-profile-section-heading">
          <div>
            <span>Garment &amp; occasion limits</span>
            <h2>Things your stylist knows not to suggest in certain situations</h2>
          </div>
          <p>These limits help your stylist skip pieces that aren&rsquo;t a good fit — saving you time and avoiding suggestions you won&rsquo;t wear.</p>
        </div>
        {occasionExclusionsLoading && <div className="style-profile-empty">Loading garment limits…</div>}
        {!occasionExclusionsLoading && guidanceLimitCount === 0 && <div className="style-profile-empty">No garment or occasion limits are active.</div>}

        {activeOwnerConstraints.length > 0 && (
          <div className="limit-group">
            <div className="limit-group-heading">
              <span className="limit-group-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.4-3.2 8.2-8 9-4.8-.8-8-4.6-8-9V6z" /></svg>
              </span>
              <div>
                <strong>Always avoid</strong>
                <span>Firm rules your stylist always enforces.</span>
              </div>
            </div>
            {/* Every firm rule is shown: there are usually very few and each one is broad and
                high-impact, so hiding any of them behind a "show more" would misrepresent the set. */}
            <div className="limit-rows">
              {activeOwnerConstraints.map(row => (
                <div key={`constraint:${row.id}`} className="limit-row">
                  <span className="limit-row-thumb limit-row-thumb--glyph" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a2 2 0 100 4 2 2 0 000-4zM8 21v-6l-2-3 2-3h8l2 3-2 3v6" /></svg>
                  </span>
                  <div className="limit-row-body">
                    <strong>{sentenceCase(row.selector_values.join(', '))}</strong>
                    <span>Not {constraintContextPhrase(row.context_dimension, row.context_values.join(', '))}.</span>
                  </div>
                  <button className="btn-secondary" onClick={() => retireOwnerConstraint(row)}>Stop using rule</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {groupedOccasionExclusions.length > 0 && (
          <div className="limit-group">
            <div className="limit-group-heading">
              <span className="limit-group-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4a2 2 0 100 4 2 2 0 000-4zM12 8v3l8 6H4l8-6" /></svg>
              </span>
              <div>
                <strong>Specific pieces</strong>
                <span>Pieces your stylist avoids for certain occasions.</span>
              </div>
            </div>
            {/* A preview, not an inventory. The server returns these newest-changed first, so the
                four shown are the ones she most likely just changed — the rest live in their own
                view rather than unrolling the page. */}
            <div className="limit-rows">
              {groupedOccasionExclusions.slice(0, LIMITS_PREVIEW).map(renderExclusionRow)}
            </div>
            {groupedOccasionExclusions.length > LIMITS_PREVIEW && (
              <button type="button" className="limit-review-all" onClick={() => openSubView('limits')}>
                Review all {guidanceLimitCount} limits
              </button>
            )}
          </div>
        )}
      </section>

      </>}

      {mode === 'style' && styleProfileTab === 'review' && <>
      <section className="style-profile-section style-profile-learnings">
        <div className="style-profile-section-heading">
          <div>
            <span>Needs your review</span>
            <h2>Feedback your stylist noticed but hasn&rsquo;t acted on</h2>
          </div>
          <p>These are reactions to particular outfits. Your stylist keeps them as context — none of them becomes a rule unless you decide it should.</p>
        </div>
        <div className="feedback-synthesis-panel">
          <div>
            <strong>See if there&rsquo;s a pattern in your feedback</strong>
            <p>Select a few reactions that seem related. Your stylist can look for something useful to remember.</p>
          </div>
          {selectedSynthesisFeedback.size > 0 && (
            <span className="feedback-synthesis-selected-count">
              {selectedSynthesisFeedback.size} reaction{selectedSynthesisFeedback.size === 1 ? '' : 's'} selected
            </span>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={!selectedSynthesisFeedback.size || synthesisBusy}
            onClick={previewSynthesis}
          >
            {selectedSynthesisFeedback.size > 0 ? 'Review for a possible lesson' : 'See cost & review'}
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
        {reportedNonResults.length > 0 && (
          <div className="synthesis-nonresults">
            <strong>Nothing to learn from {reportedNonResults.length === 1 ? 'one reaction' : `${reportedNonResults.length} reactions`}</strong>
            <p>Your stylist looked at {reportedNonResults.length === 1 ? 'this' : 'these'} but didn&rsquo;t find enough to go on. Nothing to decide — it just didn&rsquo;t teach it anything.</p>
            <ul>
              {reportedNonResults.map(row => (
                <li key={row.id}>
                  {row.rationale || row.boundary || 'Not enough context to draw a conclusion.'}
                  <button type="button" className="synthesis-nonresult-remove" onClick={() => removeSynthesisNonResult(row)}>Remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {pendingSynthesisDrafts.length > 0 && (
          <div className="feedback-synthesis-drafts">
            <h3>Your stylist found a possible lesson</h3>
            <p>Nothing changes unless you choose to remember it.</p>
            {pendingSynthesisDrafts.map(draft => {
              const isLesson = draft.disposition === 'personal_contextual_lesson'
              const sourceIds = parsedIdList(draft.source_feedback_ids)
              const sources = sourceIds.map(id => contextualFeedback.find(row => Number(row.id) === id)).filter(Boolean)
              const photos = draftLessonPhotos(draft)
              const triage = draftTriage[draft.id] || null
              const setTriage = next => setDraftTriage(previous => ({ ...previous, [draft.id]: next }))
              const rejectWithReason = reason => updateSynthesisDraft(draft, 'rejected', { rejectionReason: reason })
              const saveWording = () => updateSynthesisDraft(draft, 'accepted')
              return (
              <article key={draft.id} className="memory-card memory-card-pending">
                {photos.length > 0 && (
                  <div className="memory-card-pending-photos">
                    {photos.map(piece => (
                      <div key={piece.id} className="memory-card-thumb">
                        <img src={uploadThumbnailSrc(`/uploads/${piece.photo}`, 'garment-display')} alt="" loading="lazy" decoding="async" />
                      </div>
                    ))}
                  </div>
                )}
                <div className="memory-card-body">
                  <p className="memory-card-pending-prompt">Does this sound right?</p>
                  <h3>{effectiveSynthesisText(draft)}</h3>
                  {isLesson
                    ? <p className="memory-card-scope">{synthesisRememberSentence(draft)}</p>
                    : <p className="memory-card-scope">This looks like a product issue rather than a styling preference — it won&rsquo;t change how clothes are chosen.</p>}
                  {synthesisProvenanceSentence(sources) && (
                    <p className="memory-card-source">{synthesisProvenanceSentence(sources)}</p>
                  )}

                  {triage === 'wording' ? (
                    <div className="memory-card-pending-wording">
                      <textarea
                        className="style-memory-editor"
                        value={synthesisEdits[draft.id] ?? effectiveSynthesisText(draft)}
                        onChange={event => setSynthesisEdits(previous => ({ ...previous, [draft.id]: event.target.value }))}
                        aria-label={`Edit ${draft.title || 'draft lesson'}`}
                      />
                      <div className="memory-card-pending-actions">
                        <button type="button" className="btn-primary" onClick={saveWording}>Looks better — remember this</button>
                        <button type="button" className="btn-secondary" onClick={() => { setSynthesisEdits(previous => { const next = { ...previous }; delete next[draft.id]; return next }); setTriage(null) }}>Cancel</button>
                      </div>
                    </div>
                  ) : triage === 'chips' ? (
                    <div className="memory-card-pending-triage">
                      <span className="memory-card-pending-triage-label">What isn&rsquo;t right?</span>
                      <div className="chip-grid">
                        <button type="button" className="chip-toggle" onClick={() => setTriage('wording')}>The wording</button>
                        <button type="button" className="chip-toggle" onClick={() => rejectWithReason('too_broad')}>It applies too broadly</button>
                        <button type="button" className="chip-toggle" onClick={() => rejectWithReason('not_a_lesson')}>This shouldn&rsquo;t be a lesson</button>
                      </div>
                    </div>
                  ) : (
                    <div className="memory-card-pending-actions">
                      <button type="button" className="btn-primary" onClick={() => updateSynthesisDraft(draft, 'accepted')}>
                        {isLesson ? 'Yes, remember this' : 'Mark reviewed'}
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setTriage('chips')}>Not quite</button>
                      <button type="button" className="memory-card-pending-later" onClick={() => updateSynthesisDraft(draft, 'deferred')}>Maybe later</button>
                    </div>
                  )}
                </div>
              </article>
              )
            })}
          </div>
        )}
      </section>
      </>}

      {mode === 'style' && styleProfileTab === 'guidance' && !showingAllLimits && !showingPastDecisions && (
        <div className="style-profile-foundation">
            {/* Not a <details>: the row is not a click target and carries no disclosure marker.
                "Review foundation" is the only control, so nothing here toggles by accident. */}
            <div className="foundation-head">
            <div className="foundation-summary">
              <span className="foundation-badge" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5 10.2 10.8 5.5 9l4.7-1.3z" />
                </svg>
              </span>
              <div>
                <span>Your foundation</span>
                <strong>The foundation your stylist uses every day</strong>
                <p className="foundation-blurb">
                  These are your core preferences and guidance from onboarding.<br />
                  They help your stylist make better recommendations and create looks that feel like you.
                </p>
              </div>
            </div>
            <button
              type="button"
              className={`foundation-cta${foundationOpen ? ' foundation-cta--quiet' : ''}`}
              aria-expanded={foundationOpen}
              onClick={() => {
                setFoundationOpen(open => !open)
                setOpenFoundationLayer(null)
                setEditingFoundationLayer(null)
              }}
            >
              {foundationOpen ? 'Collapse all' : 'Review foundation →'}
            </button>
            </div>
            {/* The seven areas are what the foundation IS, so they always read; only the editable
                layer text is behind the button. */}
            {!foundationOpen && <div className="foundation-tiles">
              {FOUNDATION_TILES.map(([layer, label, blurb]) => (
                <div key={layer} className="foundation-tile">
                  <span className="foundation-tile-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                      <path d={FOUNDATION_TILE_GLYPHS[layer]} />
                    </svg>
                  </span>
                  <strong>{label}</strong>
                  <span>{blurb}</span>
                </div>
              ))}
            </div>}
            {foundationOpen && <div className="style-profile-foundation-body">
            <section>
              <div className="style-profile-section-heading">
                <div><span>Personal style</span><h2>How your stylist understands you</h2></div>
                <p>Core guidance used across recommendations.</p>
              </div>
              <div className="style-profile-card-list">
                {layers.filter(({ layer }) => PERSONAL_STYLE_LAYERS.has(layer)).map(renderStyleLayer)}
              </div>
            </section>
            <section>
              <div className="style-profile-section-heading">
                <div><span>Generated images</span><h2>How generated looks represent you</h2></div>
                <p>Image guidance only; it does not limit outfit selection.</p>
              </div>
              <div className="style-profile-card-list">
                {layers.filter(({ layer }) => IMAGE_STYLE_LAYERS.has(layer)).map(renderStyleLayer)}
              </div>
            </section>
            <div className="foundation-nudge">
              <span className="foundation-nudge-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9V16h7v-2.1A6 6 0 0012 3z" />
                </svg>
              </span>
              <div>
                <strong>Not sure if this is still right?</strong>
                <span>You can update anything here anytime. Your stylist learns and adapts as you go.</span>
              </div>
              <Link className="btn-primary foundation-nudge-cta" to="/stylist">Share feedback in chat</Link>
            </div>
            </div>}
        </div>
      )}

      {mode === 'style' && styleProfileTab === 'guidance' && !showingAllLimits && !showingPastDecisions && (
        <button type="button" className="past-decisions-link" onClick={() => openSubView('past')}>
          View past decisions
        </button>
      )}

      {mode === 'style' && styleProfileTab === 'review' && <>
      <section className="style-profile-section style-profile-learnings">
        {actionableContextualFeedback.length > 0 && <div className="style-memory-toolbar">
          <input
            type="search"
            className="style-memory-search"
            value={feedbackSearch}
            onChange={event => {
              setFeedbackSearch(event.target.value)
              setFeedbackVisibleCount(FEEDBACK_PAGE_SIZE)
            }}
            placeholder="Search your feedback…"
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
              <option value="all">Everything</option>
              {contextualFeedbackTypes.map(type => (
                <option key={type} value={type}>{feedbackTypeDisplayLabel(type)}</option>
              ))}
            </select>
          </div>
        </div>}
        {matchingContextualFeedback.length > visibleContextualFeedback.length && (
          <div className="style-memory-results-note">
            Showing {visibleContextualFeedback.length} of {matchingContextualFeedback.length}.
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
          // The garment named in the reaction, when the payload snapshot carries its photo — same
          // idea as lessonPhoto/draftLessonPhotos, but sourced from a raw feedback row instead of a
          // synthesized draft. Falls back to the board it was recorded on; never fabricated.
          const wrongPieceId = Number(row?.payload?.pieceId || row?.payload?.piece?.id) || null
          const wrongPiecePhoto = wrongPieceId
            ? (row?.payload?.outfit?.pieces || row?.payload?.pieces || []).find(piece => Number(piece?.id) === wrongPieceId)?.photo
            : null
          const boardImage = feedbackBoardImage(row)
          const thumbSrc = wrongPiecePhoto
            ? uploadThumbnailSrc(`/uploads/${wrongPiecePhoto}`, 'garment-display')
            : (boardImage ? uploadThumbnailSrc(boardImage, 'lookbook-display') : null)
          // "black white trim open cardigan — Wrong choice for Soft Structure Contrast: standard
          // wear" reads as one clause instead of a stacked eyebrow + bold title + subtitle.
          const scopeLine = displayLabel ? `${contextLabel} — ${displayLabel}` : `${feedbackTypeDisplayLabel(row)} — ${contextLabel}`
          const canUseForLesson = row.memory?.synthesisEligible && !processedSynthesisFeedbackIds.has(row.id)
          return (
            <article key={row.id} id={`feedback-row-${row.id}`} className="memory-card memory-card-feedback">
              <div className="memory-card-thumb">
                {thumbSrc
                  ? <img src={thumbSrc} alt="" loading="lazy" decoding="async" />
                  : <span className="memory-card-thumb-empty" aria-hidden="true" />}
              </div>
              <div className="memory-card-body">
                <h3>{sentenceCase(readableNote)}</h3>
                <p className="memory-card-scope">{scopeLine}</p>
                <p className="memory-card-source">{row.created_at}</p>
                {hasTechnicalDetails && (
                  <details className="memory-card-more">
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
              <div className="memory-card-feedback-actions">
                {canUseForLesson && (
                  <label className="feedback-synthesis-select">
                    <input
                      type="checkbox"
                      checked={selectedSynthesisFeedback.has(row.id)}
                      onChange={() => toggleSynthesisFeedback(row.id)}
                    />
                    Use this feedback
                  </label>
                )}
                <div className="style-memory-context-actions">
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
            </article>
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

      <section className="style-profile-section style-profile-learnings">
        <div className="style-profile-section-heading">
          <div>
            <span>Not about your taste</span>
            <h2>Things your stylist got wrong</h2>
          </div>
          <p>Times the stylist itself made a mistake, rather than something about your taste. These wait for a decision and never change how your clothes are chosen.</p>
        </div>
        {productFindings.filter(row => row.status === 'open').length === 0 && (
          <div className="style-profile-empty">No product issues currently need review.</div>
        )}
        <div className="style-memory-list">
          {productFindings.filter(row => row.status === 'open').map(row => {
            let evidence = []
            try { evidence = JSON.parse(row.evidence_snapshot || '[]') } catch { evidence = [] }
            return (
              <div key={row.id} className="style-memory-row">
                <div className="style-memory-kind style-memory-kind--quiet">No styling effect yet</div>
                <div className="style-memory-context-title">{row.title || 'Product issue'}</div>
                {row.description && <div className="style-memory-note">{row.description}</div>}
                {row.boundary && <div className="style-memory-note"><strong>Boundary:</strong> {row.boundary}</div>}
                <details className="style-memory-technical">
                  <summary>Evidence &amp; source ({evidence.length})</summary>
                  {evidence.length > 0 ? (
                    <ul>{evidence.map(item => <li key={item.feedback_id}>#{item.feedback_id} · {item.context?.name || item.label || item.feedback_type}</li>)}</ul>
                  ) : <p>No source snapshot is available.</p>}
                </details>
                <div className="product-finding-resolution">
                  <label>
                    <span>Resolution</span>
                    <select
                      value={productResolutionDrafts[row.id]?.resolutionType || ''}
                      onChange={event => setProductResolutionDrafts(previous => ({
                        ...previous,
                        [row.id]: { ...previous[row.id], resolutionType: event.target.value },
                      }))}
                    >
                      <option value="">Choose where the fix landed…</option>
                      <option value="shared_rule">Shared engine rule</option>
                      <option value="model_instruction">Model instruction</option>
                      <option value="garment_metadata">Garment metadata</option>
                      <option value="renderer">Image-generation guidance</option>
                      <option value="no_change">Reviewed; no product change</option>
                    </select>
                  </label>
                  <label>
                    <span>What changed</span>
                    <textarea
                      value={productResolutionDrafts[row.id]?.resolutionNote || ''}
                      onChange={event => setProductResolutionDrafts(previous => ({
                        ...previous,
                        [row.id]: { ...previous[row.id], resolutionNote: event.target.value },
                      }))}
                      placeholder="Briefly record the decision or fix."
                    />
                  </label>
                </div>
                <div className="style-memory-actions">
                  <button className="btn-primary" disabled={!productResolutionDrafts[row.id]?.resolutionType} onClick={() => resolveProductFinding(row)}>Mark resolved</button>
                  <button className="style-memory-retire" onClick={() => dismissProductFinding(row)}>Dismiss</button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Its own section. These are not product decisions: nothing here is queued for a human to
          resolve, and each one is already acting on the image renderer. Grouping them under
          "things your stylist got wrong" implied a decision that does not exist. */}
      {rendererReportGroups.length > 0 && (
        <section className="style-profile-section style-profile-learnings">
          <div className="style-profile-section-heading">
            <div>
              <span>Already in effect</span>
              <h2>Fixes your stylist applies when drawing pictures</h2>
            </div>
            <p>You reported these looked wrong, so your stylist corrects for them the next time it draws. Nothing here needs a decision from you.</p>
          </div>
          <div className="memory-card-list">
            {rendererReportGroups.map(group => (
              <article key={group.key} className="memory-card">
                <div className="memory-card-thumb">
                  {group.boardImage
                    ? <img src={uploadThumbnailSrc(group.boardImage, 'lookbook-display')} alt="" loading="lazy" decoding="async" />
                    : <span className="memory-card-thumb-empty" aria-hidden="true" />}
                </div>
                <div className="memory-card-body">
                  <h3>{group.title}{group.count > 1 && <span className="memory-card-count"> · reported {group.count}×</span>}</h3>
                  <p className="memory-card-scope">{group.problem}. {group.effect}</p>
                  <p className="memory-card-source">
                    {group.pieceId && (
                      <button type="button" className="foundation-layer-link" onClick={() => navigate(`/wardrobe?pieceId=${group.pieceId}`)}>
                        {group.pieceName || 'Open garment'}
                      </button>
                    )}
                    {group.pieceId && group.boardId && <span aria-hidden="true"> · </span>}
                    {group.boardId && (
                      <button type="button" className="foundation-layer-link" onClick={() => navigate(`/visual-lab?section=profile&boardId=${group.boardId}`)}>
                        {group.boardLabel ? `Open “${group.boardLabel}”` : 'Open the outfit'}
                      </button>
                    )}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      </>}

      {mode === 'style' && styleProfileTab === 'guidance' && showingPastDecisions && (
        <section className="style-profile-section style-profile-history-section limits-all">
          <button type="button" className="limits-all-back" onClick={() => closeSubView('past')}>
            <span aria-hidden="true">←</span> Back to active guidance
          </button>
          <div className="style-profile-section-heading">
            <div>
              <span>Past decisions</span>
              <h2>Rules, lessons, and suggestions you&rsquo;ve stopped using or declined</h2>
            </div>
            <p>Nothing here affects what your stylist suggests. Bring anything back if you change your mind.</p>
          </div>
          {historyGroups.every(group => !group.rows.length) && (
            <div className="style-profile-empty">Nothing here yet — this fills in as you stop using guidance or decline a suggestion.</div>
          )}
          {historyGroups.filter(group => group.rows.length).map(group => (
            <div key={group.key} className="limit-group">
              <div className="limit-group-heading">
                <span className="limit-group-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <path d={group.glyph} />
                  </svg>
                </span>
                <div>
                  <strong>{group.title}</strong>
                  <span>{group.description}</span>
                </div>
              </div>
              <div className="limit-rows">
                {group.rows.map(row => (
                  <div key={row.key} className="limit-row">
                    <div className="limit-row-body">
                      <strong>{row.title}</strong>
                      {row.detail && <span>{row.detail}</span>}
                    </div>
                    {row.date && <span className="history-row-date">{friendlyLayerDate(row.date)}</span>}
                    {row.action && (
                      <button type="button" className="btn-secondary" onClick={row.action.run}>{row.action.label}</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

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
