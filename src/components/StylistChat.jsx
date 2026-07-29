import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import ThreadRail, { humanizeLabel, deriveBuilderTitle } from './ThreadRail'
import MarkdownMessage from './MarkdownMessage.js'
import PieceForm from './PieceForm.jsx'
import InfoTooltip from './InfoTooltip.jsx'
import StylistLandingPanel from './StylistLandingPanel.jsx'
import OptionCard from './OptionCard.jsx'
import StylistSelect from './StylistSelect.jsx'
import { uploadThumbnailSrc } from '../utils/uploadThumbnails.js'
import { getCachedChatThread, loadChatThread } from '../utils/chatThreadCache.js'
import {
  OVERALL_VERDICT_LABELS,
  STYLE_DIRECTION_REASONS,
  SHAPE_BALANCE_REASONS,
  IMAGE_FIDELITY_FEEDBACK_LABELS,
  wrongLengthReasonsForCategory,
} from '../../lib/feedbackTaxonomy.js'

const GENERATED_BOARD_FEEDBACK_LABELS = [
  ...OVERALL_VERDICT_LABELS.map(([type, label]) => [type, label, null]),
  ...STYLE_DIRECTION_REASONS.map(([reason, label]) => ['style_direction', label, reason]),
  ...SHAPE_BALANCE_REASONS.map(([reason, label]) => ['shape_balance', label, reason]),
  ...IMAGE_FIDELITY_FEEDBACK_LABELS.map(([type, label]) => [type, label, null]),
]

const PIECE_ACTION_MENU_MARGIN = 8

const PieceActionEditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="15" height="15"><path d="M15.6 5.4 18.6 8.4 8.4 18.6 4.8 19.2 5.4 15.6 15.6 5.4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
)
const PieceActionSwapIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="15" height="15"><path d="M5 8.5h13M18 8.5 14.5 5M18 8.5 14.5 12M19 15.5H6M6 15.5 9.5 12M6 15.5 9.5 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
)
const PieceActionRuleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="15" height="15"><circle cx="12" cy="12" r="7.25" stroke="currentColor" strokeWidth="1.5"/><path d="M7.2 16.8 16.8 7.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
)

// Portals the dropdown into document.body and positions it from the trigger's
// real bounding rect, clamped to the viewport on every edge — outfit cards use
// `overflow: hidden` for their rounded corners, which silently clips any
// absolutely-positioned popover that opens near an edge (left, right, or
// bottom of a card). A portal is the only fix that works regardless of where
// the trigger sits.
function PieceActionMenu({ label, children }) {
  const [isOpen, setIsOpen] = useState(false)
  const [coords, setCoords] = useState(null)
  const [measured, setMeasured] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  const open = () => {
    const rect = triggerRef.current.getBoundingClientRect()
    setMeasured(false)
    setCoords({ top: rect.bottom + 4, left: rect.left })
    setIsOpen(true)
  }
  const close = () => setIsOpen(false)

  useLayoutEffect(() => {
    if (!isOpen || measured || !panelRef.current || !triggerRef.current) return
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const panelRect = panelRef.current.getBoundingClientRect()
    let left = triggerRect.left + triggerRect.width / 2 - panelRect.width / 2
    left = Math.max(PIECE_ACTION_MENU_MARGIN, Math.min(left, window.innerWidth - panelRect.width - PIECE_ACTION_MENU_MARGIN))
    const fitsBelow = triggerRect.bottom + 4 + panelRect.height <= window.innerHeight - PIECE_ACTION_MENU_MARGIN
    const top = fitsBelow ? triggerRect.bottom + 4 : Math.max(PIECE_ACTION_MENU_MARGIN, triggerRect.top - 4 - panelRect.height)
    setCoords({ top, left })
    setMeasured(true)
  }, [isOpen, measured])

  useEffect(() => {
    if (!isOpen) return
    const onMouseDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      close()
    }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [isOpen])

  return (
    <div className="piece-action-menu">
      <button
        ref={triggerRef}
        type="button"
        className="piece-action-menu-trigger"
        onClick={() => (isOpen ? close() : open())}
        title={label}
        aria-label={label}
        aria-expanded={isOpen}
      >
        ⋮
      </button>
      {isOpen && coords && createPortal(
        <div
          ref={panelRef}
          className="piece-action-menu-panel"
          style={{ top: coords.top, left: coords.left, visibility: measured ? 'visible' : 'hidden' }}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </div>,
        document.body
      )}
    </div>
  )
}

function GeneratedBoardLengthFeedback({ board, baseKey, feedbackSaved, toggleFeedback, payload, label, note, contextOverride = null, canonicalCorrections = null, onToggleCanonical = null }) {
  const boardPieces = Array.isArray(board?.pieces) ? board.pieces.filter(piece => Number(piece?.id) && wrongLengthReasonsForCategory(piece.category).length) : []
  if (!boardPieces.length) return <div style={{ fontSize: 10, color: 'var(--text-light)' }}>The source garment could not be identified for this older image.</div>
  return (
    <div style={{ padding: 8, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 600 }}>Which garment is the wrong length?</div>
      {boardPieces.map(piece => {
        const pieceId = Number(piece.id)
        const pieceReasons = wrongLengthReasonsForCategory(piece.category)
        const pieceCorrections = canonicalCorrections ? canonicalCorrections.filter(c => Number(c?.piece_id) === pieceId) : null
        const activeCount = pieceCorrections
          ? pieceCorrections.length
          : pieceReasons.filter(([issue]) => feedbackSaved.has(`${baseKey}:wrong_length_detail:${piece.id}:${issue}`)).length
        return (
          <div key={piece.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 600 }}>{piece.name || `Piece ${piece.id}`}{activeCount ? ` (${activeCount})` : ''}</div>
            <div className="stylist-feedback-row">
              {pieceReasons.map(([issue, text]) => {
                const key = `${baseKey}:wrong_length_detail:${piece.id}:${issue}`
                const active = pieceCorrections ? pieceCorrections.some(c => c?.issue === issue) : feedbackSaved.has(key)
                return (
                  <button
                    key={issue}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onToggleCanonical
                      ? onToggleCanonical(pieceId, piece.name || `Piece ${pieceId}`, issue)
                      : toggleFeedback({ key, feedbackType: 'wrong_length', targetType: 'generated_visual_board', label, note, payload: { ...payload, length_correction: { piece_id: pieceId, piece_name: piece.name || `Piece ${pieceId}`, issue } }, appendToPiece: false, contextOverride })}
                    className="stylist-feedback-chip"
                  >
                    {active ? '✓ ' : ''}{text}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const SUGGESTIONS = [
  { label: 'Occasion', prompt: 'What should I wear for a city dinner?' },
  { label: 'Style a piece', prompt: 'Help me style my cream wide-leg pants' },
  { label: 'Dress code', prompt: 'What outfit would work for a smart casual event?' },
  { label: 'Weekend', prompt: 'I\'m going hiking this weekend — what should I wear?' },
]



const OUTFIT_FEEDBACK_LABELS = [
  ['works', 'More like this'],
  ['not_me', 'Not for me'],
]

const INITIAL_SAVED_MESSAGE_COUNT = 8
const INITIAL_SAVED_OUTFIT_COUNT = 4

// Occasion = social register only (activities removed)
const OCCASION_OPTIONS = [
  ['casual', 'Casual'], ['city', 'City'], ['smart casual', 'Smart casual'],
  ['outdoor_daytime_social', 'Outdoor daytime social'],
  ['evening', 'Evening'], ['gallery / art event', 'Gallery / art event'],
  ['travel', 'Travel'],            // oddball, intentionally left for now
  ['concert', 'Concert'],
]

// Activity = physical-demand axis, optional, orthogonal to occasion.
// Only values with real enforcement appear here.
const ACTIVITY_OPTIONS = [
  ['none', 'No special activity'],
  ['walking', 'Lots of walking'],
  ['hiking', 'Hiking / Outdoor active'],
]

const PIECE_SEASON_OPTIONS = [
  ['current season', 'Current season'],
  ['early spring / cool mild weather', 'Early spring'],
  ['spring', 'Spring'],
  ['summer', 'Summer'],
  ['fall', 'Fall'],
  ['winter', 'Winter'],
  ['hot weather', 'Very hot weather'],
  ['cold weather', 'Very cold weather'],
  ['year-round', 'Year-round'],
]

const WARDROBE_SEASON_OPTIONS = [
  ['current season', 'Current season'],
  ['spring', 'Spring'],
  ['summer', 'Summer'],
  ['fall', 'Fall'],
  ['winter', 'Winter'],
  ['hot weather', 'Very hot weather'],
  ['cold weather', 'Very cold weather'],
]

const STYLE_DIRECTION_OPTIONS = [
  ['mix', 'Mix of style directions'],
  ['controlled_print', 'Controlled Print'],
  ['monochrome_texture', 'Monochrome Texture'],
  ['structured_soft', 'Structured + Soft'],
  ['color_anchor', 'Color Anchor'],
  ['unexpected_pairing', 'Unexpected Pairing'],
  ['soft_architecture', 'Soft Architecture'],
]

const wardrobeBuilderControlStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 13.5,
  minHeight: 34,
}

const backToChatButtonStyle = {
  borderRadius: 8,
  background: 'var(--surface)',
}

function capitalizeFirst(str) {
  const s = String(str || '')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

const WardrobeOptionIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="3" width="16" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 3V21" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="10.3" cy="12" r="0.9" fill="currentColor" />
    <circle cx="13.7" cy="12" r="0.9" fill="currentColor" />
  </svg>
)

const NewPiecesOptionIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="5.3" r="1.1" stroke="currentColor" strokeWidth="1.4" />
    <path d="M12 6.4V8.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M12 8.3L4 14.3L6.2 16.3H17.8L20 14.3L12 8.3Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const SparkleIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8 1L9.4 6.1L14.5 7.5L9.4 8.9L8 14L6.6 8.9L1.5 7.5L6.6 6.1L8 1Z" />
  </svg>
)

const WardrobeComposerIcon = () => (
  <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <rect x="9" y="5" width="30" height="38" rx="2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M24 5v38M12.5 10h23M12.5 38h23" stroke="currentColor" strokeWidth="1.15" />
    <path d="M17 15c-2 2.6-3 5.4-3 8.5s1 5.9 3 8.5M20 15c2 2.6 3 5.4 3 8.5s-1 5.9-3 8.5M31 15c-2 2.6-3 5.4-3 8.5s1 5.9 3 8.5M34 15c2 2.6 3 5.4 3 8.5s-1 5.9-3 8.5" stroke="currentColor" strokeWidth="1" />
    <circle cx="21.5" cy="26" r=".8" fill="currentColor" />
    <circle cx="26.5" cy="26" r=".8" fill="currentColor" />
  </svg>
)

const HistoryClockIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.35" />
    <path d="M10 6v4.25l2.75 1.6M4.1 5.4H1.75V3.05" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const ReviewOutfitIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5h16M4 12h10M4 18.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="m16.5 17 1.8 1.8 3.2-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
)

const SimilarLooksIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="10" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 3.5h8A2 2 0 0 1 20.5 5.5v11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
)

const RestyleOutfitIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.4 7.2A5.8 5.8 0 0 1 18 9l1.7-1.7M19.7 7.3v4.2h-4.2M15.6 16.8A5.8 5.8 0 0 1 6 15l-1.7 1.7M4.3 16.7v-4.2h4.2" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"/></svg>
)

const STYLE_DIRECTION_LEGEND = [
  ['Mix of style directions', 'Explore a balanced mix of distinct styling approaches.'],
  ['Controlled Print', 'One printed piece, kept in check by solids.'],
  ['Monochrome Texture', 'Same tone throughout — texture does the work.'],
  ['Structured + Soft', 'Pairs something tailored with something relaxed.'],
  ['Color Anchor', 'Builds the outfit around one dominant color.'],
  ['Unexpected Pairing', "Combines pieces that don't obviously go together."],
  ['Soft Architecture', 'Precise shapes made in soft, fluid fabrics.'],
]

const formatMs = (ms) => {
  const n = Number(ms)
  if (!Number.isFinite(n)) return null
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`
}

const getTeaserText = (text) => {
  if (!text) return ''
  const trimmed = String(text).trim()
  const firstSentence = trimmed.split(/[.!?]\s/)[0]
  if (firstSentence.length < trimmed.length) {
    return firstSentence + '.'
  }
  return firstSentence
}

const timingSummary = (timings = {}) => Object.entries(timings || {})
  .filter(([, value]) => typeof value === 'number')
  .map(([key, value]) => `${key.replace(/Ms$/, '')}: ${formatMs(value)}`)
  .join(' · ')

const formatTokenCount = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(Math.round(n))
}

const composerUsageSummary = (usage = null) => {
  if (!usage) return ''
  const provider = usage.provider || 'ai'
  const model = usage.model ? `${provider}:${usage.model}` : provider
  const pieces = [
    model,
    `in: ${formatTokenCount(usage.inputTokens)}`,
    `out: ${formatTokenCount(usage.outputTokens)}`,
  ]
  const cached = Number(usage.cacheReadInputTokens || usage.cachedInputTokens || 0)
  if (cached > 0) pieces.push(`cached: ${formatTokenCount(cached)}`)
  const cost = usage.estimatedCost
  if (cost?.pricingAvailable && typeof cost.estimatedUsd === 'number') {
    pieces.push(`est: $${cost.estimatedUsd.toFixed(4)}`)
  } else if (cost && cost.pricingAvailable === false) {
    pieces.push('est: unavailable')
  }
  return pieces.join(' · ')
}

// Owner-facing engine internals (styling engine trace, generation timing/token telemetry,
// raw gate-rejection vocabulary) are for tuning the model/engine, not for regular users.
// Set VITE_STYLIST_DEBUG=true (see sandbox-web in .claude/launch.json) to surface them.
const STYLIST_DEBUG_ENABLED = import.meta.env.VITE_STYLIST_DEBUG === 'true'

const ROSTER_CATEGORY_PLURAL_LABELS = {
  top: 'tops',
  bottom: 'bottoms',
  dress: 'dresses',
  outerwear: 'outerwear',
  shoes: 'shoes',
  accessory: 'accessories',
}

const pluralizeRosterCategory = (category) =>
  ROSTER_CATEGORY_PLURAL_LABELS[category] || `${category}s`

// Legacy-payload shim. `routes/ai.js` used to append the raw gate-rejection text onto a broken
// card's own `reason` prose ("... Rejected because <raw>. Resolution note: <raw>"), alongside
// duplicating it into `watchFor`/`systemFlags`. Those fields are no longer written, but thread
// payloads are durable and there is no migration — cards stored before that fix still carry the
// suffix, so stripping it at render is what actually keeps the raw vocabulary off old threads.
// Only applied to broken/diagnostic cards, and only when the dev flag is off; the plain-language
// "What didn't clear" disclaimer above the card carries the same information in the register the
// owner ruling asked for.
const LEGACY_ENGINE_REJECTION_SUFFIX = /\s*(?:Rejected|Broken)\s+because\s.*$/is
const LEGACY_DEBUG_CARD_FALLBACKS = [
  'Model proposal shown for debugging.',
  'Local fill candidate shown for debugging.'
]
const stripEngineRejectionSuffix = (reason) => {
  const stripped = String(reason || '').replace(LEGACY_ENGINE_REJECTION_SUFFIX, '').trim()
  // If the model never wrote its own rationale, the builder's placeholder is all that survives —
  // showing "shown for debugging" to a regular user is the same leak in a different costume.
  return LEGACY_DEBUG_CARD_FALLBACKS.includes(stripped) ? '' : stripped
}

// Plain-language replacements for the internal signature/strong/usable/experimental
// ranking vocabulary — panel feedback: those terms read as arbitrary badges rather
// than telling the user what to do with a direction.
const DIRECTION_RANK_LABELS = {
  signature: 'Closest to your brief',
  strong: 'Strong alternative',
  usable: 'More exploratory',
  experimental: 'Needs review',
}

const directionRankLabel = (value) => DIRECTION_RANK_LABELS[String(value || '').toLowerCase()] || ''

const calculateOpenAICost = (timings) => {
  if (!timings || !timings.usage) return null
  const input = (timings.usage.input_tokens || 0) * 0.0000025
  const output = (timings.usage.output_tokens || 0) * 0.00001
  const imgSize = timings.imageSize || '1024x1536'
  const imgCost = imgSize === '1024x1024' ? 0.04 : 0.08
  return input + output + imgCost
}

// Translate known internal error strings into plain-language copy before they reach a board
// card; the raw text stays in the server log (see safeJsonFromModel). Any error we don't
// recognize passes through unchanged rather than risk hiding something the user needs to see.
const friendlyBoardErrorMessage = (rawMessage) => {
  const message = String(rawMessage || '')
  if (/model did not return json/i.test(message)) {
    return 'The image model returned an unexpected response. Try generating again.'
  }
  return message
}

const renderCost = (timings) => {
  const cost = calculateOpenAICost(timings)
  if (cost === null) return ''
  return ` · Measured cost: $${cost.toFixed(3)}`
}

// Renderer/timing telemetry stays behind STYLIST_DEBUG_ENABLED; the measured cost line is
// deliberately always visible per the product's paid-action honesty.
const renderTelemetryDetailBody = (timings, renderer) => {
  const cost = calculateOpenAICost(timings)
  return [
    STYLIST_DEBUG_ENABLED ? `Render timing: ${timingSummary(timings)}` : '',
    STYLIST_DEBUG_ENABLED && renderer ? `renderer: ${renderer}` : '',
    cost !== null ? `Measured cost: $${cost.toFixed(3)}` : ''
  ].filter(Boolean).join(' · ')
}

const MessageTelemetryDisclosure = ({ message }) => {
  if (!STYLIST_DEBUG_ENABLED) return null
  const composerUsage = message?.debug?.composerUsage
  const critiqueUsage = message?.wardrobeEvaluation && message?.debug?.usage
    ? { ...message.debug.usage, estimatedCost: message.debug.estimatedCost }
    : null
  const critiqueCache = message?.wardrobeEvaluation ? message?.debug?.resultCache : null
  const showTiming = (message?.wholeWardrobe || message?.wardrobeEvaluation) && message?.debug?.timings
  if (!composerUsage && !critiqueUsage && !critiqueCache && !showTiming) return null

  const rows = []
  if (composerUsage) {
    rows.push(['Composer', composerUsageSummary(composerUsage)])
  }
  if (critiqueUsage) {
    rows.push(['Critique', composerUsageSummary(critiqueUsage)])
  }
  if (critiqueCache) {
    rows.push(['Critique cache', critiqueCache.hit
      ? (critiqueCache.coalesced ? 'shared in-flight request' : 'exact-result hit')
      : 'miss'])
  }
  if (showTiming) {
    rows.push(['Timing', `${timingSummary(message.debug.timings)}${renderCost(message.debug.timings)}`])
  }

  return (
    <div className="stylist-response-dev-telemetry">
      <details className="telemetry-details message-telemetry">
        <summary title="Click for generation timing and token telemetry (dev only)">
          <span className="message-telemetry-label">Dev telemetry</span>
          <span className="message-telemetry-count">{rows.length}</span>
        </summary>
        <div className="message-telemetry-panel">
          {rows.map(([label, value]) => (
            <div className="message-telemetry-row" key={label}>
              <span>{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

const resolveUploadImageSrc = (photo) => {
  const value = String(photo || '').trim()
  if (!value) return null
  const dedupedUploads = value.replace(/^\/uploads\/+uploads\//, '/uploads/')
  if (dedupedUploads !== value) return dedupedUploads
  if (/^(https?:\/\/|data:|blob:|\/uploads\/)/i.test(value)) return value
  const uploadsIndex = value.indexOf('/uploads/')
  if (uploadsIndex >= 0) return value.slice(uploadsIndex)
  if (value.startsWith('/generated-boards/')) return `/uploads${value}`
  if (value.startsWith('generated-boards/')) return `/uploads/${value}`
  if (value.startsWith('uploads/')) return `/${value}`
  if (value.startsWith('/')) return value
  return `/uploads/${value}`
}

const resolveUploadThumbnailSrc = (photo, variant) => uploadThumbnailSrc(resolveUploadImageSrc(photo), variant)

const VISUAL_FOLLOWUP_PATTERN = /\b(look|again|photo|image|visible|read|missed|shoe|shoes|hem|cuff|floor|fit|waist|rise|pull|bunch|color|colour|sleeve|neckline|length|drape|fabric|texture|pattern|lighting|crop|cropped)\b/i
const OUTFIT_FOLLOWUP_PATTERN = /\b(this|it|outfit|idea|look|piece|pieces|make|change|swap|instead|sharper|stronger|softer|better|work|works|risk|risky|why|how|what)\b/i

const createResultId = (prefix = 'result') => `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`

const currentChatDateContext = () => {
  const now = new Date()
  const timezone = 'America/Los_Angeles'
  return {
    currentDate: now.toISOString(),
    currentDateLabel: new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: timezone,
    }).format(now),
    timezone,
  }
}

const classifyChatTurn = (text, { hasThreadMemory = false } = {}) => {
  const q = String(text || '').trim().toLowerCase()
  if (!q) return 'new_request'
  if (/\b(i disagree|you are wrong|that's wrong|that is wrong|not true|actually|you missed|you ignored|you said|but you|today is|it is|it isn't|it is not|these are|this is)\b/.test(q)) {
    return 'correction'
  }
  if (/^(why|how did|how do you know|what made|which|do you see|can you see|did you see|where|what date|which season|what season)\b/.test(q)) {
    return 'explanation'
  }
  if (/\b(i like|i don't like|i do not like|not me|too safe|too soft|too generic|more like|less like)\b/.test(q)) {
    return 'preference_reaction'
  }
  if (/\b(last|previous|above|earlier|that one|first one|second one|third one|those outfits|these outfits|this outfit|that outfit)\b/.test(q) || hasThreadMemory) {
    return 'followup'
  }
  return 'new_request'
}

const compactThreadContext = (memory = null, activeContext = null) => {
  const parts = []
  if (activeContext?.type && activeContext?.name) {
    parts.push(`Active context: ${activeContext.type} "${activeContext.name}".`)
  }
  if (memory?.type === 'generated_outfits' && memory.latestContextText) {
    parts.push(`Generated outfit cards in this thread:\n${memory.latestContextText}`)
  } else if ((memory?.type === 'outfit' || memory?.type === 'generated_outfit') && memory.latestEvaluationText) {
    parts.push(`Most recent outfit evaluation memory:\n${memory.latestEvaluationText}`)
  }
  return parts.join('\n\n')
}

const stylingContextFromMemory = (memory = null, fallbackActivity = 'none') => ({
  occasion: memory?.stylingContext?.occasion,
  season: memory?.stylingContext?.season,
  mood: memory?.stylingContext?.mood,
  mission: memory?.stylingContext?.mission,
  activity: memory?.stylingContext?.activity ?? fallbackActivity,
})

// Must match CRITIQUE_DETAILS_DELIMITER in styling-engine/core.js.
const CRITIQUE_DETAILS_DELIMITER = '--- Full structured read ---'

const splitCritiqueText = (text = '') => {
  const s = String(text || '')
  const idx = s.indexOf(CRITIQUE_DETAILS_DELIMITER)
  if (idx === -1) return { prose: s, details: '' }
  return {
    prose: s.slice(0, idx).trimEnd(),
    details: s.slice(idx + CRITIQUE_DETAILS_DELIMITER.length).trim(),
  }
}

// Renders critique feedback with its short supporting explanation collapsed.
const CritiqueBody = ({ text }) => {
  const { prose, details } = splitCritiqueText(text)
  return (
    <div className="stylist-critique-body">
      <MarkdownMessage text={prose} />
      {details && (
        <details className="stylist-critique-details">
          <summary>
            More detail
          </summary>
          <div className="stylist-critique-details-body">
            <MarkdownMessage text={details} />
          </div>
        </details>
      )}
    </div>
  )
}

const compactEvaluationMemory = (evaluation = null) => {
  if (!evaluation || typeof evaluation !== 'object') return ''
  const facts = evaluation.visibleFacts || {}
  const intent = evaluation.inferredIntent || {}
  const shoe = facts.shoeAnalysis || {}
  return [
    intent.label ? `Intent: ${intent.label}` : '',
    evaluation.verdict ? `Verdict: ${evaluation.verdict}` : '',
    facts.floorLine ? `Floor line: ${facts.floorLine}` : '',
    facts.fitPlacement ? `Fit placement: ${facts.fitPlacement}` : '',
    shoe.visibility || shoe.read || shoe.effect
      ? `Shoe read: ${[shoe.visibility, shoe.read, shoe.effect, shoe.confidence].filter(Boolean).join(' · ')}`
      : '',
    evaluation.firstVisibleIssue ? `First visible issue: ${evaluation.firstVisibleIssue}` : '',
    evaluation.recommendation ? `Last recommendation: ${evaluation.recommendation}` : '',
  ].filter(Boolean).join('\n')
}



export default function StylistChat({
  initialOutfit,
  initialPiece,
  initialOpenVisualComposer = false,
  initialThreadId,
  activeContext: externalActiveContext,
  onContextChange,
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [threads, setThreads] = useState([])
  const [archivedThreads, setArchivedThreads] = useState([])
  const [archivedView, setArchivedView] = useState(false)
  const [currentThreadId, setCurrentThreadId] = useState('new_chat')
  const [activeThreadMetadata, setActiveThreadMetadata] = useState(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [expandedFeedbackCards, setExpandedFeedbackCards] = useState(new Set())
  const [collapsedFeedbackCards, setCollapsedFeedbackCards] = useState(new Set())
  const toggleFeedbackCardExpansion = useCallback((cardKey, isExpanded) => {
    setExpandedFeedbackCards(previous => {
      const next = new Set(previous)
      if (isExpanded) next.delete(cardKey)
      else next.add(cardKey)
      return next
    })
    setCollapsedFeedbackCards(previous => {
      const next = new Set(previous)
      if (isExpanded) next.add(cardKey)
      else next.delete(cardKey)
      return next
    })
  }, [])
  const [visibleMessageStart, setVisibleMessageStart] = useState(0)
  const [collapsedStructuredResults, setCollapsedStructuredResults] = useState(new Set())

  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! I\'m your personal stylist. I know your full wardrobe — ask me anything. You can also upload a photo of an outfit for feedback.' }
  ])
  const [chatHistory, setChatHistory] = useState([])
  const [threadMemory, setThreadMemory] = useState(null)
  const [evaluatedKeys, setEvaluatedKeys] = useState(new Set())
  const [boardResults, setBoardResults] = useState({})
  const [editorialVisualResults, setEditorialVisualResults] = useState({})
  const [evaluationResultsByKey, setEvaluationResultsByKey] = useState({})

  const [internalActiveContext, setInternalActiveContext] = useState(null)
  const activeContext = externalActiveContext ?? internalActiveContext
  const setActiveContext = useCallback((nextContext) => {
    setInternalActiveContext(nextContext)
    onContextChange?.(nextContext)
  }, [onContextChange])

  const [input, setInput] = useState('')
  const [pendingCapsuleExpansion, setPendingCapsuleExpansion] = useState(null)
  const [renamingThreadId, setRenamingThreadId] = useState(null)
  const [renamingTitle, setRenamingTitle] = useState('')
  const [pendingPieceMode, setPendingPieceMode] = useState('wardrobe')
  const [imageFile, setImageFile] = useState(null)
  const [imagePrev, setImagePrev] = useState(null)
  // Router handoffs should render on the first pass so their small hero image can
  // start loading immediately. The effects below still synchronize later handoffs.
  const [pendingOutfit, setPendingOutfit] = useState(() => (
    initialOutfit?.autoSend === true ? null : (initialOutfit || null)
  ))
  const [pendingPiece, setPendingPiece] = useState(() => initialPiece || null)
  const [pendingOutfitAction, setPendingOutfitAction] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [chatAnnouncement, setChatAnnouncement] = useState('')
  const wasLoadingRef = useRef(false)
  const [imageStatusByKey, setImageStatusByKey] = useState({})
  const [pieces, setPieces] = useState([])
  const [outfits, setOutfits] = useState([])
  const [compareOutfitId, setCompareOutfitId] = useState('')
  const [generateOutfitMode, setGenerateOutfitMode] = useState(false)
  const [wardrobeBuilderOpen, setWardrobeBuilderOpen] = useState(Boolean(initialOpenVisualComposer))
  const [includeMissingPieces, setIncludeMissingPieces] = useState(false)
  const [idealOnlyMode, setIdealOnlyMode] = useState(false)
  const [editorialVisualMode, setEditorialVisualMode] = useState(false)
  const [generateOccasion, setGenerateOccasion] = useState('casual')
  const [generateSeason, setGenerateSeason] = useState('current season')
  const [generateMission, setGenerateMission] = useState('mix')
  const [generateMood, setGenerateMood] = useState('')
  const [generateActivity, setGenerateActivity] = useState('none')
  const [wardrobeOutfitOccasion, setWardrobeOutfitOccasion] = useState('casual')
  const [wardrobeOutfitSeason, setWardrobeOutfitSeason] = useState('current season')
  const [wardrobeOutfitMood, setWardrobeOutfitMood] = useState('')
  const [wardrobeOutfitRequest, setWardrobeOutfitRequest] = useState('')
  const [wardrobeOutfitMission, setWardrobeOutfitMission] = useState('mix')
  const [wardrobeOutfitActivity, setWardrobeOutfitActivity] = useState('none')
  const [recentMemoryStatus, setRecentMemoryStatus] = useState('')
  const [recentMemoryResetting, setRecentMemoryResetting] = useState(false)
  const [recentMemoryItemCount, setRecentMemoryItemCount] = useState(0)
  const [recentMemoryConfirmation, setRecentMemoryConfirmation] = useState('')
  const [homeLocation, setHomeLocation] = useState('')
  const [homeLocationInput, setHomeLocationInput] = useState('')
  const [homeLocationOpen, setHomeLocationOpen] = useState(false)
  const [homeLocationSaving, setHomeLocationSaving] = useState(false)
  const [savedIndices, setSavedIndices] = useState(new Set())
  const [feedbackSaved, setFeedbackSaved] = useState(new Set())
  const [feedbackIdsByKey, setFeedbackIdsByKey] = useState({})
  const [boardFeedbackLabels, setBoardFeedbackLabels] = useState({})
  const [boardLearningStatus, setBoardLearningStatus] = useState({})
  const [savedBoardKeys, setSavedBoardKeys] = useState(new Set())
  const [savedBoardUrls, setSavedBoardUrls] = useState(new Set())
  const [savedBoardsByUrl, setSavedBoardsByUrl] = useState({})

  const [boardLoadingIndex, setBoardLoadingIndex] = useState(null)
  const [previewImage, setPreviewImage] = useState(null)
  const previewDialogRef = useRef(null)
  const previewCloseRef = useRef(null)
  const previewReturnFocusRef = useRef(null)
  const [editPiece, setEditPiece] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const bottomRef = useRef(null)
  const pendingActionRef = useRef(null)
  const holdActionScrollRef = useRef(false)
  const suppressNextMessageScrollRef = useRef(false)
  const textRef = useRef(null)
  const createOutfitsButtonRef = useRef(null)
  const wardrobeBuilderFirstFieldRef = useRef(null)
  const homeLocationButtonRef = useRef(null)
  const homeLocationPopoverRef = useRef(null)
  const recentMemoryConfirmTimeoutRef = useRef(null)
  const loadingTimersRef = useRef([])
  const lastAutoOutfitActionRef = useRef('')
  const suppressThreadLoadAutosaveRef = useRef(false)
  const currentThreadIdRef = useRef(currentThreadId)
  useEffect(() => {
    currentThreadIdRef.current = currentThreadId
  }, [currentThreadId])

  useEffect(() => () => {
    if (recentMemoryConfirmTimeoutRef.current) clearTimeout(recentMemoryConfirmTimeoutRef.current)
  }, [])

  const [toastMessage, setToastMessage] = useState('')
  const [showToast, setShowToast] = useState(false)
  const triggerToast = useCallback((msg) => {
    setToastMessage(msg)
    setShowToast(true)
  }, [])

  const openPieceEditor = useCallback(async (pieceInput) => {
    const pieceId = Number(pieceInput?.id || pieceInput)
    if (!Number.isFinite(pieceId)) return
    try {
      const res = await fetch(`/api/pieces/${pieceId}`)
      if (!res.ok) throw new Error('Could not load wardrobe item')
      const piece = await res.json()
      setEditPiece(piece)
    } catch (err) {
      triggerToast(err.message || 'Could not load wardrobe item')
    }
  }, [triggerToast])

  useEffect(() => {
    if (!showToast) return
    const timer = setTimeout(() => {
      setShowToast(false)
    }, 3000)
    return () => clearTimeout(timer)
  }, [showToast])

  const saveThreadState = async (threadId, updatedFields) => {
    if (threadId === 'new_chat') return
    
    const currentPayload = {
      messages: updatedFields.messages ?? messages,
      chatHistory: updatedFields.chatHistory ?? chatHistory,
      threadMemory: updatedFields.threadMemory ?? threadMemory,
      activeContext: updatedFields.activeContext ?? activeContext,
      evaluatedKeys: Array.from(updatedFields.evaluatedKeys ?? evaluatedKeys),
      boardResults: updatedFields.boardResults ?? boardResults,
      editorialVisualResults: updatedFields.editorialVisualResults ?? editorialVisualResults,
      evaluationResultsByKey: updatedFields.evaluationResultsByKey ?? evaluationResultsByKey,
      savedBoardKeys: Array.from(updatedFields.savedBoardKeys ?? savedBoardKeys),
      feedbackSaved: Array.from(updatedFields.feedbackSaved ?? feedbackSaved),
      savedIndices: Array.from(updatedFields.savedIndices ?? savedIndices),
      feedbackIdsByKey: updatedFields.feedbackIdsByKey ?? feedbackIdsByKey,
      boardFeedbackLabels: updatedFields.boardFeedbackLabels ?? boardFeedbackLabels
    }
    
    const title = updatedFields.title ?? activeThreadMetadata?.title ?? 'Chat'
    const userRenamed = updatedFields.userRenamed ?? activeThreadMetadata?.user_renamed ?? false
    const kind = updatedFields.kind ?? activeThreadMetadata?.kind ?? 'chat'
    
    const isArchived = archivedThreads.some(t => t.id === threadId)
    const targetSetter = isArchived ? setArchivedThreads : setThreads
    
    try {
      const res = await fetch('/api/chat-threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: threadId,
          title,
          user_renamed: userRenamed ? 1 : 0,
          kind,
          payload: currentPayload,
          pinned: isArchived ? 0 : (activeThreadMetadata?.pinned ? 1 : 0),
          archived: isArchived ? 1 : 0
        })
      })
      
      if (!res.ok) throw new Error('Save failed')
      const updatedMetadata = await res.json()

      let isNewThread = false
      targetSetter(prev => {
        let exists = false
        const next = prev.map(t => {
          if (t.id === threadId) {
            exists = true
            return {
              ...t,
              title: updatedMetadata.title,
              user_renamed: updatedMetadata.user_renamed,
              kind: updatedMetadata.kind,
              updated_at: updatedMetadata.updated_at,
              message_count: updatedMetadata.message_count,
              pinned: updatedMetadata.pinned,
              archived: updatedMetadata.archived
            }
          }
          return t
        })

        isNewThread = !exists
        const finalThreads = exists ? next : [{
          id: updatedMetadata.id,
          title: updatedMetadata.title,
          user_renamed: updatedMetadata.user_renamed,
          kind: updatedMetadata.kind,
          updated_at: updatedMetadata.updated_at,
          message_count: updatedMetadata.message_count,
          pinned: updatedMetadata.pinned,
          archived: updatedMetadata.archived
        }, ...next]

        if (!isArchived) {
          try {
            localStorage.setItem('stylist_chat_threads', JSON.stringify(finalThreads))
          } catch {}
        }
        return finalThreads
      })

      // Replace /stylist with /stylist/:id on first save so back button never
      // lands on the phantom pre-save empty-thread state.
      if (isNewThread && location.pathname === '/stylist') {
        navigate('/stylist/' + updatedMetadata.id, { replace: true })
      }

      setActiveThreadMetadata({
        id: updatedMetadata.id,
        title: updatedMetadata.title,
        user_renamed: updatedMetadata.user_renamed,
        kind: updatedMetadata.kind,
        pinned: updatedMetadata.pinned,
        archived: updatedMetadata.archived,
        created_at: updatedMetadata.created_at,
        updated_at: updatedMetadata.updated_at
      })
    } catch (err) {
      console.error('Failed to save thread state:', err)
    }
  }

  const flushSaveThread = async (threadId, data) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    await saveThreadState(threadId, data)
  }

  const openThread = async (threadId, { skipSaveCurrent = false } = {}) => {
    if (!skipSaveCurrent && debounceTimerRef.current && currentThreadId && currentThreadId !== 'new_chat') {
      await flushSaveThread(currentThreadId, {
        messages,
        chatHistory,
        threadMemory,
        activeContext,
        evaluatedKeys,
        boardResults,
        editorialVisualResults,
        evaluationResultsByKey,
        savedBoardKeys,
        feedbackSaved,
        savedIndices,
        feedbackIdsByKey,
        boardFeedbackLabels
      })
    }

    // Reset input form and loader states when switching threads
    setInput('')
    setImageFile(null)
    setImagePrev(null)
    setPendingOutfit(null)
    setPendingPiece(null)
    setCompareOutfitId('')
    setGenerateOutfitMode(false)
    setEditorialVisualMode(false)
    setWardrobeBuilderOpen(false)
    clearLoadingTimers()
    setLoadingStatus('')

    if (threadId === 'new_chat') {
      setMessages([{ role: 'assistant', text: 'Hi! I\'m your personal stylist. I know your full wardrobe — ask me anything. You can also upload a photo of an outfit for feedback.' }])
      setChatHistory([])
      setThreadMemory(null)
      setActiveContext(null)
      setEvaluatedKeys(new Set())
      setBoardResults({})
      setEditorialVisualResults({})
      setEvaluationResultsByKey({})
      setSavedBoardKeys(new Set())
      setFeedbackSaved(new Set())
      setSavedIndices(new Set())
      setFeedbackIdsByKey({})
      setBoardFeedbackLabels({})
      setVisibleMessageStart(0)
      setCollapsedStructuredResults(new Set())
      setCurrentThreadId('new_chat')
      setActiveThreadMetadata(null)
      try {
        localStorage.setItem('stylist_current_thread_id', 'new_chat')
      } catch {}
      return
    }

    const applyLoadedThread = (thread) => {
      refreshSavedBoards()
      const loadedMessages = thread.payload.messages || []
      suppressThreadLoadAutosaveRef.current = true
      suppressNextMessageScrollRef.current = true
      setMessages(loadedMessages)
      setVisibleMessageStart(Math.max(0, loadedMessages.length - INITIAL_SAVED_MESSAGE_COUNT))
      setCollapsedStructuredResults(new Set(
        loadedMessages
          .map((message, index) => (message?.structuredOutfits?.length > INITIAL_SAVED_OUTFIT_COUNT ? index : null))
          .filter(index => index !== null)
      ))
      setChatHistory(thread.payload.chatHistory || [])
      setThreadMemory(thread.payload.threadMemory || null)
      setActiveContext(thread.payload.activeContext || null)
      setEvaluatedKeys(new Set(thread.payload.evaluatedKeys || []))
      setBoardResults(thread.payload.boardResults || {})
      setEditorialVisualResults(thread.payload.editorialVisualResults || {})
      setEvaluationResultsByKey(thread.payload.evaluationResultsByKey || {})
      setSavedBoardKeys(new Set(thread.payload.savedBoardKeys || []))
      setFeedbackSaved(new Set(thread.payload.feedbackSaved || []))
      setSavedIndices(new Set(thread.payload.savedIndices || []))
      setFeedbackIdsByKey(thread.payload.feedbackIdsByKey || {})
      setBoardFeedbackLabels(thread.payload.boardFeedbackLabels || {})
      
      setCurrentThreadId(threadId)
      setActiveThreadMetadata({
        id: thread.id,
        title: thread.title,
        user_renamed: thread.user_renamed,
        kind: thread.kind,
        pinned: thread.pinned,
        archived: thread.archived,
        created_at: thread.created_at,
        updated_at: thread.updated_at
      })
      try {
        localStorage.setItem('stylist_current_thread_id', threadId)
      } catch {}
    }

    setLoadingThread(true)
    const cachedThread = getCachedChatThread(threadId)
    if (cachedThread) applyLoadedThread(cachedThread)
    try {
      const thread = await loadChatThread(threadId, { refresh: Boolean(cachedThread) })
      applyLoadedThread(thread)
    } catch (err) {
      console.error('Error switching thread:', err)
      if (!cachedThread) {
        alert('This chat thread is no longer available (it may have been deleted).')
        setCurrentThreadId('new_chat')
        setActiveThreadMetadata(null)
      }
    } finally {
      setLoadingThread(false)
    }
  }

  const deleteThread = async (threadId) => {
    try {
      const res = await fetch(`/api/chat-threads/${threadId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      
      const remainingActive = threads.filter(t => t.id !== threadId)
      const remainingArchived = archivedThreads.filter(t => t.id !== threadId)
      
      setThreads(remainingActive)
      setArchivedThreads(remainingArchived)
      
      try {
        localStorage.setItem('stylist_chat_threads', JSON.stringify(remainingActive))
      } catch {}

      if (currentThreadId === threadId) {
        const nextThread = remainingActive[0] || remainingArchived[0]
        if (nextThread) {
          await openThread(nextThread.id, { skipSaveCurrent: true })
          navigate('/stylist/' + nextThread.id, { replace: true })
        } else {
          await openThread('new_chat', { skipSaveCurrent: true })
          navigate('/stylist', { replace: true })
        }
      }
    } catch (err) {
      console.error('Failed to delete thread:', err)
    }
  }

  const renameThread = async (threadId, newTitle) => {
    if (!newTitle.trim()) return
    
    const isArchived = archivedThreads.some(t => t.id === threadId)
    const t = isArchived ? archivedThreads.find(x => x.id === threadId) : threads.find(x => x.id === threadId)
    if (!t) return

    try {
      const detailRes = await fetch(`/api/chat-threads/${threadId}`)
      if (!detailRes.ok) throw new Error('Failed to get thread detail')
      const detail = await detailRes.json()

      const res = await fetch('/api/chat-threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: threadId,
          title: newTitle.trim(),
          user_renamed: 1,
          kind: t.kind,
          payload: detail.payload,
          pinned: t.pinned ? 1 : 0,
          archived: t.archived ? 1 : 0
        })
      })

      if (!res.ok) throw new Error('Rename failed')
      const updated = await res.json()

      const targetSetter = isArchived ? setArchivedThreads : setThreads
      targetSetter(prev => {
        const next = prev.map(x => x.id === threadId ? {
          ...x,
          title: updated.title,
          user_renamed: updated.user_renamed,
          updated_at: updated.updated_at
        } : x)
        if (!isArchived) {
          try {
            localStorage.setItem('stylist_chat_threads', JSON.stringify(next))
          } catch {}
        }
        return next
      })

      if (currentThreadId === threadId) {
        setActiveThreadMetadata(prev => prev ? {
          ...prev,
          title: updated.title,
          user_renamed: updated.user_renamed,
          updated_at: updated.updated_at
        } : null)
      }
    } catch (err) {
      console.error('Failed to rename thread:', err)
    }
  }

  const togglePinThread = async (threadId) => {
    try {
      const res = await fetch(`/api/chat-threads/${threadId}/pin`, {
        method: 'PATCH'
      })
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Failed to pin')
      }
      const data = await res.json()
      
      setThreads(prev => {
        const next = prev.map(t => t.id === threadId ? { ...t, pinned: data.pinned } : t)
        const sorted = [...next].sort((a, b) => {
          const pinA = a.pinned ? 1 : 0
          const pinB = b.pinned ? 1 : 0
          if (pinA !== pinB) return pinB - pinA
          const timeA = new Date(a.updated_at || a.updatedAt || 0).getTime()
          const timeB = new Date(b.updated_at || b.updatedAt || 0).getTime()
          return timeB - timeA
        })
        try {
          localStorage.setItem('stylist_chat_threads', JSON.stringify(sorted))
        } catch {}
        return sorted
      })
      
      if (currentThreadId === threadId) {
        setActiveThreadMetadata(prev => prev ? { ...prev, pinned: data.pinned } : null)
      }
      triggerToast(data.pinned ? 'Thread pinned to top' : 'Thread unpinned')
    } catch (err) {
      console.error('Failed to toggle pin:', err)
      triggerToast(err.message || 'Error pinning thread')
    }
  }

  const toggleArchiveThread = async (threadId) => {
    try {
      const res = await fetch(`/api/chat-threads/${threadId}/archive`, {
        method: 'PATCH'
      })
      if (!res.ok) throw new Error('Failed to archive')
      const data = await res.json()

      let movedThread = null

      if (data.archived) {
        setThreads(prev => {
          const match = prev.find(t => t.id === threadId)
          if (match) movedThread = { ...match, archived: true, pinned: false }
          const next = prev.filter(t => t.id !== threadId)
          try {
            localStorage.setItem('stylist_chat_threads', JSON.stringify(next))
          } catch {}
          return next
        })
        if (movedThread) {
          setArchivedThreads(prev => [movedThread, ...prev])
        }
        triggerToast('Thread archived')
      } else {
        setArchivedThreads(prev => {
          const match = prev.find(t => t.id === threadId)
          if (match) movedThread = { ...match, archived: false, pinned: data.pinned }
          return prev.filter(t => t.id !== threadId)
        })
        if (movedThread) {
          setThreads(prev => {
            const next = [movedThread, ...prev].sort((a, b) => {
              const pinA = a.pinned ? 1 : 0
              const pinB = b.pinned ? 1 : 0
              if (pinA !== pinB) return pinB - pinA
              const timeA = new Date(a.updated_at || a.updatedAt || 0).getTime()
              const timeB = new Date(b.updated_at || b.updatedAt || 0).getTime()
              return timeB - timeA
            })
            try {
              localStorage.setItem('stylist_chat_threads', JSON.stringify(next))
            } catch {}
            return next
          })
        }
        triggerToast('Thread restored to active list')
      }

      if (currentThreadId === threadId) {
        setActiveThreadMetadata(prev => prev ? { ...prev, archived: data.archived, pinned: data.pinned } : null)
      }
    } catch (err) {
      console.error('Failed to toggle archive:', err)
      triggerToast('Error updating archive status')
    }
  }

  // Idempotent per-thread migration and initial load
  useEffect(() => {
    async function initAndMigrate() {
      try {
        let localThreads = []
        try {
          const saved = localStorage.getItem('stylist_chat_threads')
          if (saved) {
            localThreads = JSON.parse(saved) || []
            if (Array.isArray(localThreads) && localThreads.length) {
              setThreads(localThreads)
            }
          }
        } catch (e) {
          console.error('Failed to parse stylist_chat_threads from localStorage:', e)
        }

        const res = await fetch('/api/chat-threads')
        let serverThreads = res.ok ? await res.json() : []
        const serverArchivedThreads = []

        let legacyThread = null
        try {
          const savedMessages = localStorage.getItem('stylist_chat_messages')
          if (savedMessages) {
            const messages = JSON.parse(savedMessages)
            if (Array.isArray(messages) && messages.length > 0) {
              const savedHistory = localStorage.getItem('stylist_chat_history')
              const chatHistory = savedHistory ? JSON.parse(savedHistory) : []
              const savedMemory = localStorage.getItem('stylist_thread_memory')
              const threadMemory = savedMemory ? JSON.parse(savedMemory) : null
              
              let title = 'Active Conversation'
              const firstUser = messages.find(m => m.role === 'user')
              if (firstUser && firstUser.text) {
                title = firstUser.text.slice(0, 48) + (firstUser.text.length > 48 ? '...' : '')
              }
              
              legacyThread = {
                id: 'legacy_active',
                title,
                messages,
                chatHistory,
                threadMemory,
                updatedAt: Date.now()
              }
            }
          }
        } catch (e) {
          console.error('Failed to parse legacy active keys:', e)
        }

        const toMigrate = [...localThreads]
        if (legacyThread) {
          toMigrate.push(legacyThread)
        }

        let migratedAny = false

        const toSqliteDateStr = (val) => {
          if (!val) return null
          if (typeof val === 'number') {
            return new Date(val).toISOString().replace('T', ' ').slice(0, 19)
          }
          if (typeof val === 'string') {
            if (/^\d+$/.test(val)) {
              return new Date(parseInt(val, 10)).toISOString().replace('T', ' ').slice(0, 19)
            }
            return val
          }
          return null
        }

        for (const t of toMigrate) {
          if (!t.id) continue
          
          const exists = serverThreads.some(st => st.id === t.id) || serverArchivedThreads.some(st => st.id === t.id)
          if (exists) continue

          const messages = t.messages || []
          const hasUserMessage = messages.some(m => m.role === 'user')
          if (!hasUserMessage) {
            continue
          }

          let title = t.title || 'Chat'
          if (!t.userRenamed && !t.user_renamed) {
            if (t.kind === 'builder' || title.startsWith('Wardrobe:') || t.threadMemory?.stylingContext) {
              const context = t.threadMemory?.stylingContext || {}
              title = deriveBuilderTitle({
                occasion: context.occasion || '',
                activity: context.activity || 'none',
                season: context.season || '',
                mood: context.mood || '',
                request: context.request || ''
              }) || title
            } else {
              const firstUser = messages.find(m => m.role === 'user')
              if (firstUser && firstUser.text) {
                title = firstUser.text.slice(0, 48) + (firstUser.text.length > 48 ? '...' : '')
              }
            }
          }

          const payload = {
            messages: t.messages || [],
            chatHistory: t.chatHistory || [],
            threadMemory: t.threadMemory || null,
            activeContext: t.activeContext || null,
            evaluatedKeys: t.evaluatedKeys || [],
            boardResults: t.boardResults || {},
            editorialVisualResults: t.editorialVisualResults || {},
            evaluationResultsByKey: t.evaluationResultsByKey || {},
            savedBoardKeys: t.savedBoardKeys || [],
            feedbackSaved: t.feedbackSaved || [],
            savedIndices: t.savedIndices || [],
            feedbackIdsByKey: t.feedbackIdsByKey || {},
            boardFeedbackLabels: t.boardFeedbackLabels || {}
          }

          const created_at_val = t.created_at || t.createdAt || t.updatedAt || t.updated_at
          const updated_at_val = t.updatedAt || t.updated_at

          const upsertRes = await fetch('/api/chat-threads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: t.id,
              title,
              user_renamed: t.userRenamed || t.user_renamed ? 1 : 0,
              kind: t.kind || 'chat',
              payload,
              pinned: t.pinned ? 1 : 0,
              archived: t.archived ? 1 : 0,
              created_at: toSqliteDateStr(created_at_val),
              updated_at: toSqliteDateStr(updated_at_val)
            })
          })

          if (upsertRes.ok) {
            migratedAny = true
          }
        }

        if (legacyThread) {
          localStorage.removeItem('stylist_chat_messages')
          localStorage.removeItem('stylist_chat_history')
          localStorage.removeItem('stylist_thread_memory')
        }

        if (migratedAny) {
          const refetchRes = await fetch('/api/chat-threads')
          if (refetchRes.ok) {
            serverThreads = await refetchRes.json()
          }
        }

        try {
          localStorage.setItem('stylist_chat_threads', JSON.stringify(serverThreads))
        } catch {}

        setThreads(serverThreads)

        // A specific thread requested via the URL (initialThreadId) is handled by its own
        // effect below. If this init effect also picks a thread from localStorage, the two
        // race — this one runs several awaited fetches first, so it reliably finishes last and
        // silently overwrites the correct thread's content with whatever was last active in a
        // different tab/session, without ever updating the URL.
        const isLaunchingAction = initialOutfit || initialPiece || initialOpenVisualComposer || initialThreadId
        if (!isLaunchingAction) {
          let activeId = 'new_chat'
          const savedActiveId = localStorage.getItem('stylist_current_thread_id')
          if (savedActiveId && (serverThreads.some(st => st.id === savedActiveId) || serverArchivedThreads.some(st => st.id === savedActiveId) || savedActiveId === 'new_chat')) {
            activeId = savedActiveId
          } else if (serverThreads.length > 0) {
            activeId = serverThreads[0].id
          }

          await openThread(activeId)
        }
      } catch (err) {
        console.error('Initialization/migration failed:', err)
      } finally {
        setInitialLoading(false)
      }
    }

    initAndMigrate()
  }, [])

  useEffect(() => {
    if (!archivedView) return undefined
    let cancelled = false

    async function loadArchivedThreads() {
      try {
        const res = await fetch('/api/chat-threads?archived=true')
        if (!res.ok) throw new Error('Could not load archived conversations')
        const rows = await res.json()
        if (!cancelled) setArchivedThreads(rows)
      } catch (err) {
        if (!cancelled) console.error('Failed to load archived chat threads:', err)
      }
    }

    loadArchivedThreads()
    return () => { cancelled = true }
  }, [archivedView])

  const debounceTimerRef = useRef(null)

  // Debounced auto-save of active thread updates
  useEffect(() => {
    if (currentThreadId === 'new_chat' || initialLoading || loadingThread) return
    if (suppressThreadLoadAutosaveRef.current) {
      suppressThreadLoadAutosaveRef.current = false
      return
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      saveThreadState(currentThreadId, {
        messages,
        chatHistory,
        threadMemory,
        activeContext,
        evaluatedKeys,
        boardResults,
        editorialVisualResults,
        evaluationResultsByKey,
        savedBoardKeys,
        feedbackSaved,
        savedIndices,
        feedbackIdsByKey,
        boardFeedbackLabels
      })
    }, 2000)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [
    messages,
    chatHistory,
    threadMemory,
    activeContext,
    currentThreadId,
    evaluatedKeys,
    boardResults,
    editorialVisualResults,
    evaluationResultsByKey,
    savedBoardKeys,
    feedbackSaved,
    savedIndices,
    feedbackIdsByKey,
    boardFeedbackLabels
  ])



  const clearLoadingTimers = () => {
    loadingTimersRef.current.forEach(clearTimeout)
    loadingTimersRef.current = []
  }

  const startStatusSequence = (steps, setter = setLoadingStatus) => {
    clearLoadingTimers()
    if (!Array.isArray(steps) || !steps.length) return
    setter(steps[0].text)
    loadingTimersRef.current = steps.slice(1).map(step => setTimeout(() => setter(step.text), step.ms))
  }

  useEffect(() => () => clearLoadingTimers(), [])

  const refreshWholeWardrobeSessionMemory = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/whole-wardrobe-session-memory')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load recent outfit memory')
      setRecentMemoryItemCount(Number(data.itemCount || 0))
    } catch (err) {
      console.error('Failed to refresh recent outfit memory:', err)
    }
  }, [])

  useEffect(() => {
    refreshWholeWardrobeSessionMemory()
  }, [refreshWholeWardrobeSessionMemory])

  useEffect(() => {
    clearLoadingTimers()
    setLoadingStatus('')
  }, [currentThreadId])

  const refreshSavedBoards = useCallback(async () => {
    try {
      const res = await fetch('/api/saved-boards?limit=1000')
      const data = await res.json()
      if (!Array.isArray(data)) return
      const urls = new Set()
      const byUrl = {}
      for (const board of data) {
        const imageUrl = board.imageUrl || board.image_url
        if (!imageUrl) continue
        urls.add(imageUrl)
        byUrl[imageUrl] = board
      }
      setSavedBoardUrls(urls)
      setSavedBoardsByUrl(byUrl)
    } catch (err) {
      console.error('Failed to fetch saved boards:', err)
    }
  }, [])

  useEffect(() => {
    fetch('/api/pieces').then(r => r.json()).then(setPieces)
    fetch('/api/outfits').then(r => r.json()).then(setOutfits).catch(() => setOutfits([]))
    refreshSavedBoards()
    fetch('/api/settings/home-location')
      .then(r => r.json())
      .then(data => {
        setHomeLocation(data.homeLocation || '')
        setHomeLocationInput(data.homeLocation || '')
      })
      .catch(err => console.error('Failed to fetch home location:', err))
  }, [])

  useEffect(() => {
    if (!initialOutfit) return
    const shouldAutoSend = initialOutfit.autoSend === true
    setPendingOutfit(shouldAutoSend ? null : initialOutfit)
    setPendingPiece(null)
    setCompareOutfitId('')
    setGenerateOutfitMode(false)
    setIncludeMissingPieces(false)
    setIdealOnlyMode(false)
    setEditorialVisualMode(false)
    setActiveContext({ type: 'outfit', id: initialOutfit.id, name: initialOutfit.name })
    const prompt = initialOutfit.stylistPrompt || 'What do you think of this outfit?'
    setInput('')
    setImageFile(null); setImagePrev(null)
    if (shouldAutoSend) {
      const actionKey = `${initialOutfit.id || initialOutfit.name || 'outfit'}:${initialOutfit.imageGenerationMode ? `variants-${initialOutfit.variantMode || 'similar'}` : 'critique'}:${prompt}:${initialOutfit.actionId || ''}`
      if (lastAutoOutfitActionRef.current === actionKey) return
      lastAutoOutfitActionRef.current = actionKey
      setTimeout(() => send({ outfit: initialOutfit, input: prompt }), 0)
      // Live-found bug: router state (location.state.outfit) survives a full page
      // reload — the browser restores it from history.state. lastAutoOutfitActionRef
      // does NOT survive a reload (it's a fresh ref on remount), so without this, an
      // F5 (or any full reload — including an HMR full-reload from an unrelated file
      // change) resends this exact, already-answered request to the model. Replacing
      // the history entry's state right after dispatch means a reload finds nothing
      // to auto-send; :replace so it doesn't add a spare back-button stop.
      navigate(location.pathname + location.search, { replace: true, state: null })
    }
  }, [initialOutfit])

  useEffect(() => {
    if (!initialPiece) return
    setPendingPiece(initialPiece)
    setPendingOutfit(null)
    setCompareOutfitId('')
    setGenerateOutfitMode(true)
    setIncludeMissingPieces(false)
    setIdealOnlyMode(false)
    setEditorialVisualMode(false)
    setActiveContext({ type: 'piece', id: initialPiece.id, name: initialPiece.name })
    setInput('')
    setImageFile(null); setImagePrev(null)
  }, [initialPiece])

  useEffect(() => {
    if (!initialThreadId) return
    openThread(initialThreadId)
  }, [initialThreadId])

  useEffect(() => {
    if (!initialOpenVisualComposer) return
    setPendingPiece(null)
    setPendingOutfit(null)
    setActiveContext(null)
    setWardrobeBuilderOpen(true)
  }, [initialOpenVisualComposer])

  useEffect(() => {
    const openingWithAction = initialPiece || (initialOutfit && initialOutfit.autoSend !== true) || pendingPiece || pendingOutfit
    if (openingWithAction && messages.length <= 1 && !loading) return
    if (holdActionScrollRef.current) {
      if (!loading) holdActionScrollRef.current = false
      return
    }
    if (suppressNextMessageScrollRef.current) {
      suppressNextMessageScrollRef.current = false
      return
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, pendingPiece, pendingOutfit, initialPiece, initialOutfit])

  useEffect(() => {
    if (!pendingPiece && !pendingOutfit) return
    const t = setTimeout(() => {
      pendingActionRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
    }, 0)
    return () => clearTimeout(t)
  }, [pendingPiece, pendingOutfit])

  // Screen-reader announcement for "a reply/card/render arrived" — removing content from an
  // aria-live region (the typing-dots indicator disappearing) is not itself announced, so this
  // is a distinct signal fired once a request that was loading settles with a new assistant
  // message. Mirrors the existing timed status text sighted users already get.
  useEffect(() => {
    if (wasLoadingRef.current && !loading) {
      const last = messages[messages.length - 1]
      if (last?.role === 'assistant') {
        setChatAnnouncement(last.isError ? 'Stylist reply failed.' : 'Stylist replied.')
      }
    }
    wasLoadingRef.current = loading
  }, [loading, messages])

  // Image-preview lightbox dialog management, mirroring the pattern already ratified for
  // Calibration Boards (VisualLab.jsx): initial focus, Tab focus trap, Escape to close, focus
  // return to the trigger, and scroll lock on the document + app-main scroll container.
  useEffect(() => {
    if (!previewImage) return undefined
    const main = document.querySelector('.app-main')
    const previousBodyOverflow = document.body.style.overflow
    const previousMainOverflow = main?.style?.overflow
    document.body.style.overflow = 'hidden'
    if (main) main.style.overflow = 'hidden'
    // Refs are already attached by the time an effect runs (React's commit-then-effect
    // ordering), so focusing directly here — rather than deferring another frame — is both
    // simpler and reliably testable (a requestAnimationFrame-wrapped focus call never fires on
    // a backgrounded/hidden tab, which real user tabs aren't, but which made this untestable
    // in automation).
    previewCloseRef.current?.focus()

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPreviewImage(null)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(previewDialogRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      ) || [])]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
      if (main) main.style.overflow = previousMainOverflow || ''
      previewReturnFocusRef.current?.focus?.()
    }
  }, [previewImage])

  const addToHistory = (role, content) => setChatHistory(h => [...h, { role, content }])

  const handleImage = (e) => {
    const f = e.target.files[0]; if (!f) return
    setPendingOutfit(null); setPendingPiece(null); setCompareOutfitId('')
    setGenerateOutfitMode(false); setEditorialVisualMode(false); setIncludeMissingPieces(false); setIdealOnlyMode(false)
    setImageFile(f); setImagePrev(URL.createObjectURL(f))
  }

  const getOutfitConfidenceMode = (outfit) => {
    if (!outfit) return null
    const linkedCount = Array.isArray(outfit.pieces) ? outfit.pieces.length : 0
    if (linkedCount > 0) return { label: 'Wardrobe-aware analysis', detail: `${linkedCount} linked garment${linkedCount === 1 ? '' : 's'}`, tone: 'strong' }
    return { label: 'Visual analysis only', detail: 'Link saved pieces to improve precision', tone: 'soft' }
  }

  const getCompareConfidenceText = (outfitA, outfitB) => {
    const a = getOutfitConfidenceMode(outfitA)
    const b = getOutfitConfidenceMode(outfitB)
    if (!a || !b) return ''
    const aLinked = Array.isArray(outfitA?.pieces) ? outfitA.pieces.length : 0
    const bLinked = Array.isArray(outfitB?.pieces) ? outfitB.pieces.length : 0
    if (aLinked && bLinked) return `Wardrobe-aware comparison · A: ${aLinked} linked · B: ${bLinked} linked`
    if (!aLinked && !bLinked) return 'Visual comparison only · link saved pieces to improve precision'
    return `Mixed-confidence comparison · A: ${a.label} · B: ${b.label}`
  }

  const confidenceBadgeStyle = (tone) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, width: 'fit-content',
    padding: '3px 8px', borderRadius: 999, fontSize: 11, lineHeight: 1.2,
    border: tone === 'strong' ? '1px solid var(--accent)' : '1px solid var(--border)',
    background: tone === 'strong' ? 'var(--surface)' : 'var(--surface-2)',
    color: tone === 'strong' ? 'var(--accent)' : 'var(--text-muted)',
  })

  const saveMessageToNotes = async (messageIndex, text) => {
    if (!activeContext) return
    const url = activeContext.type === 'piece' ? `/api/pieces/${activeContext.id}/append-note` : `/api/outfits/${activeContext.id}/append-note`
    await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    setSavedIndices(prev => new Set([...prev, messageIndex]))
  }


  const isMultiOutfitResponse = (message) => {
    if (!message || message.role !== 'assistant') return false
    if (Array.isArray(message.structuredOutfits) && message.structuredOutfits.length) return true
    const text = String(message.text || '')
    return /Generated outfit ideas for:|Signature \/ strongest direction|Best owned wardrobe direction|Ideal editorial completion|Usable variation|Optional experimental direction|styling directions for/i.test(text)
  }

  const getEditorialNotes = (text = '') => {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean)
    const notes = []
    let mode = null
    for (const rawLine of lines) {
      const line = rawLine.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim()
      const clean = line.replace(/^[-–]\s*/, '').trim()
      if (/^I would skip/i.test(line)) { mode = 'skip'; continue }
      if (/^Avoid for this garment/i.test(line)) { mode = 'avoid'; continue }
      if (/^Saveable learning/i.test(line)) { mode = 'learning'; continue }
      if (/^(Signature|Usable variation|Optional experimental direction|Best owned wardrobe direction|Ideal editorial completion|Pieces:|Why it works:|Watch for:|Generated outfit ideas|Occasion)/i.test(line)) { mode = null; continue }
      if (!mode || !clean || /^none$/i.test(clean) || /^---+$/.test(clean)) continue
      if (mode === 'skip') notes.push(`Skip: ${clean}`)
      if (mode === 'avoid') notes.push(`Avoid: ${clean}`)
      if (mode === 'learning') notes.push(`Learning: ${clean}`)
    }
    const seen = new Set()
    return notes.filter(note => { const k = note.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 5)
  }

  // Planned-set cards: the pre-route's trip precompose and the model-initiated
  // plan_outfit_set tool produce the same card shape (slot labels, coverage
  // lines, tripPlanLines) and share one plan presentation.
  const isPlannedSetSource = (source) => source === 'trip_precompose' || source === 'plan_outfit_set'

  // Which code path produced a given card (plan_outfit_set/trip_precompose = deterministic
  // composer; proposed_outfit = model hand-composing via propose_outfit, which can happen even
  // after plan_outfit_set already ran — found 2026-07-14 testing #87-89: the model called
  // plan_outfit_set then silently re-composed every card itself via propose_outfit, bypassing
  // the engine's coverage-gap/trim disclosures) is no longer surfaced on the card — it was a
  // QA/debug aid leaking into the regular user-facing UI. The same distinction is already
  // traceable server-side: every tool call is unconditionally logged via
  // `styling-engine/tools.js`'s `executeTool` wrapper (`🤖 [Agent Tool Call] <name> (...)`),
  // so grepping server logs for `propose_outfit` vs `plan_outfit_set` still answers this.

  // `formatStructuredOutfitFeedback` (styling-engine/core.js) builds a message body server-side by
  // dumping each outfit's structured fields — Label/Strength/Direction/Silhouette/Pieces/Watch for.
  // That is the same data the cards already render, in the field-dump register PR #142 moved the
  // critique surface away from. It is not the model talking, so it must not reach the notes
  // disclosure. Matching our own deterministic header, not garment text.
  const isEngineFieldDump = (text) => /^\s*\*\*Generated outfit ideas for:\*\*/.test(String(text || ''))

  const parsePlanTrimNote = (note = '') => {
    const match = String(note || '').match(
      /^\[plan trimmed: "([^"]+)" reduced from (\d+) to (\d+) looks? — the plan asked for more outfits than the (\d+)-outfit total across the set allows\]$/
    )
    if (!match) return null
    const requested = Number(match[2])
    const shown = Number(match[3])
    return {
      label: match[1],
      requested,
      shown,
      remaining: Math.max(0, requested - shown),
      cap: Number(match[4]),
    }
  }

  // The engine's own rotation-limit line: this use case was trimmed because the
  // roster has no further distinct outfit core for it, not because of the card
  // cap. Kept separate from parsePlanTrimNote so the two causes can never print
  // the same sentence — offering "ask for the remaining looks" against an
  // exhausted rotation is what put two contradicting sentences in one box.
  // Owner ruling 2026-07-28: a rejected look is shown and repaired in place
  // rather than thrown away. The card already carries everything the repair
  // needs (the slot, and which garment was blocked), and the endpoint is
  // deterministic — providerCalls: 0 — so this button never spends money.
  const [repairingCardKey, setRepairingCardKey] = useState(null)
  const [repairErrorByCard, setRepairErrorByCard] = useState({})

  const repairCapsuleLook = async (outfit, messageIndex, cardKey) => {
    if (!outfit?.capsuleRepair?.slotId || !outfit?.capsulePlanContext) return
    setRepairingCardKey(cardKey)
    setRepairErrorByCard(prev => ({ ...prev, [cardKey]: null }))
    try {
      const siblingOutfits = (messages[messageIndex]?.structuredOutfits || [])
        .filter(other => !other?.broken && isPlannedSetSource(other?.source))
        .map(other => ({ title: other.title, tripSlot: other.tripSlot, pieceIds: other.pieceIds }))
      const res = await fetch('/api/ai/repair-capsule-look', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planContext: outfit.capsulePlanContext,
          slotId: outfit.capsuleRepair.slotId,
          title: outfit.title || '',
          pieceIds: outfit.pieceIds || (outfit.pieces || []).map(piece => Number(piece?.id)).filter(Boolean),
          blockedPieceIds: outfit.capsuleRepair.blockedPieceIds || [],
          existingOutfits: siblingOutfits,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not fix that look')
      const repaired = (data.structuredOutfits || [])[0]
      if (!repaired) throw new Error('Could not fix that look')
      // Replace the broken card in place: the repaired look belongs where the
      // rejected attempt was, not appended at the end of the plan.
      setMessages(prev => prev.map((message, index) => {
        if (index !== messageIndex) return message
        return {
          ...message,
          structuredOutfits: (message.structuredOutfits || []).map(other => other === outfit ? repaired : other),
        }
      }))
    } catch (err) {
      setRepairErrorByCard(prev => ({ ...prev, [cardKey]: err.message || 'Could not fix that look' }))
    } finally {
      setRepairingCardKey(null)
    }
  }

  const parseRotationLimitNote = (note = '') => {
    const match = String(note || '').match(
      /^\[rotation limit: "([^"]+)" reduced from (\d+) to (\d+) looks? — this capsule roster has no further distinct outfit core for that use case\]$/
    )
    if (!match) return null
    return { label: match[1], requested: Number(match[2]), shown: Number(match[3]) }
  }

  // The capsule roster's own zero-capacity line reached the user verbatim,
  // brackets and all ("no complete gate-valid outfit core"). Ratified rule:
  // capsule-gap internals are developer evidence, not stylist copy. The fact is
  // the user's; the vocabulary is not.
  const parseCapsuleWardrobeGapNote = (note = '') => {
    const match = String(note || '').match(
      /^\[missing wardrobe gap: "([^"]+)" has no complete gate-valid outfit core in this (\d+)-piece capsule roster\]$/
    )
    if (!match) return null
    return { label: match[1], budget: Number(match[2]) }
  }

  const parseCapsuleShortfallNote = (note = '') => {
    const match = String(note || '').match(
      /^\[capsule shortfall: (\d+) of (\d+) planned looks are ready — (.+) need a fix and are shown below marked for review\]$/
    )
    if (!match) return null
    // The engine writes slot labels in ASCII quotes; the surrounding prose is
    // typeset. Normalise so one sentence doesn't mix both.
    const detail = match[3].replace(/"([^"]+)"/g, '“$1”')
    return { shown: Number(match[1]), planned: Number(match[2]), detail }
  }

  const formatPlanNote = (note = '') => {
    const trim = parsePlanTrimNote(note)
    if (trim) {
      // No "you can ask for the remaining looks" here: whether that is even
      // possible depends on the slot's unused core capacity, which the action
      // row below already decides. Stating it in both places is how the notes
      // ended up offering more looks directly above "Full available rotation
      // shown". The note states the fact; the action row states availability.
      return `Showing ${trim.shown} of ${trim.requested} requested “${trim.label}” looks in this ${trim.cap}-look representative rotation.`
    }
    const limit = parseRotationLimitNote(note)
    if (limit) {
      return `Showing ${limit.shown} of ${limit.requested} requested “${limit.label}” looks — this capsule’s pieces don’t make another distinct outfit for that use case.`
    }
    const wardrobeGap = parseCapsuleWardrobeGapNote(note)
    if (wardrobeGap) {
      return `“${wardrobeGap.label}” has no complete outfit in this ${wardrobeGap.budget}-piece capsule — nothing in the roster covers it with a top, bottom or dress and shoes that suit it.`
    }
    const shortfall = parseCapsuleShortfallNote(note)
    if (shortfall) {
      const missing = Math.max(0, shortfall.planned - shortfall.shown)
      return `${shortfall.shown} of the ${shortfall.planned} looks planned for this capsule are ready. ${missing === 1 ? 'One look' : `${missing} looks`} still ${missing === 1 ? 'needs' : 'need'} a fix — ${shortfall.detail} — and ${missing === 1 ? 'is' : 'are'} shown below marked for review rather than dropped.`
    }
    return note
  }

  const getPlanExpansionSuggestions = (outfits = []) => {
    const firstPlannedCard = (Array.isArray(outfits) ? outfits : []).find(outfit => isPlannedSetSource(outfit?.source))
    const lines = Array.isArray(firstPlannedCard?.tripPlanLines) ? firstPlannedCard.tripPlanLines : []
    const planContext = firstPlannedCard?.capsulePlanContext || null
    return lines.map(parsePlanTrimNote).filter(trim => trim?.remaining > 0).map(trim => {
      const slot = (Array.isArray(planContext?.slots) ? planContext.slots : []).find(item => item?.label === trim.label)
      const shownForSlot = (Array.isArray(outfits) ? outfits : []).filter(outfit =>
        !outfit?.broken && (outfit?.tripSlot === slot?.id || outfit?.label === trim.label)
      ).length
      const coreCapacity = Math.max(0, Number(slot?.core_capacity) || 0)
      const capacityExhausted = coreCapacity > 0 && shownForSlot >= coreCapacity
      return {
        ...trim,
        slotId: slot?.id || '',
        planContext,
        existingOutfits: Array.isArray(outfits) ? outfits : [],
        capacityExhausted,
        canExpandDirectly: Boolean(planContext && slot?.id && !capacityExhausted)
      }
    })
  }

  const getTripPlanNotes = (outfits = []) => {
    const tripCards = Array.isArray(outfits) ? outfits.filter(outfit => isPlannedSetSource(outfit?.source)) : []
    if (!tripCards.length) return []
    const first = tripCards[0] || {}
    const computedLines = Array.isArray(first.tripPlanLines) ? first.tripPlanLines : []
    const coverageLines = tripCards.map(outfit => outfit.coverageLine).filter(Boolean)
    const notes = [
      ...computedLines,
      ...coverageLines,
      'When image space is limited, garment and layer photos are prioritized before accessories.'
    ]
    for (const outfit of tripCards) {
      if (outfit.tripNote) notes.push(`${outfit.label || outfit.title || 'Outfit'}: ${outfit.tripNote}`)
    }
    const seen = new Set()
    const deduped = notes.filter(note => {
      const key = note.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    // "[plan trimmed: ...]" and "[missing wardrobe gap: ...]" lines (bracket-prefixed) are the
    // disclosure the user needs when a slot silently got fewer outfits than requested — a flat
    // slice(0, 7) was cutting them off on any plan busy enough to need them (7-slot capsule live
    // test: 11 total lines, the 4 gap/trim lines past index 7 vanished with no signal to the user).
    // Cap the cosmetic lines instead so disclosure lines always survive.
    const CAP = 7
    if (deduped.length <= CAP) return deduped.map(formatPlanNote)
    const isCritical = (note) => /^\[/.test(note)
    const critical = deduped.filter(isCritical)
    const nonCritical = deduped.filter(note => !isCritical(note))
    const keptNonCritical = new Set(nonCritical.slice(0, Math.max(0, CAP - critical.length)))
    return deduped
      .filter(note => isCritical(note) || keptNonCritical.has(note))
      .map(formatPlanNote)
  }

  const getPlanNotesTitle = (outfits = []) => {
    const plannedCards = Array.isArray(outfits) ? outfits.filter(outfit => isPlannedSetSource(outfit?.source)) : []
    return plannedCards.some(outfit => outfit?.source === 'plan_outfit_set') ? 'Outfit plan' : 'Trip plan'
  }

  const sentenceCaseLabel = (value = '') => {
    const text = String(value || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
  }

  const singularLookLabel = (count) => `${count} ${count === 1 ? 'look' : 'looks'}`

  const getPreviousUserText = (messageIndex) => {
    for (let idx = messageIndex - 1; idx >= 0; idx -= 1) {
      if (messages[idx]?.role === 'user') return String(messages[idx].text || '')
    }
    return ''
  }

  const derivePlanDestination = (text = '') => {
    const known = ['Paso Robles', 'Cambria', 'Los Angeles', 'Walnut Creek', 'San Francisco', 'Napa', 'Sonoma']
    const foundKnown = known.find(place => new RegExp(`\\b${place}\\b`, 'i').test(text))
    if (foundKnown) return foundKnown
    const match = text.match(/\b(?:in|for|to)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})(?=[:.,;]|\s+(?:for|with|during|and|after|before)\b|$)/)
    return match ? match[1].trim() : ''
  }

  const derivePlanLength = (outfits = []) => {
    const lines = Array.isArray(outfits?.[0]?.tripPlanLines) ? outfits[0].tripPlanLines : []
    const line = lines.find(note => /^Plan length:/i.test(String(note || '')))
    const value = line ? line.replace(/^Plan length:\s*/i, '').trim() : ''
    const dayMatch = value.match(/(\d+)[-\s]*day/i)
    return dayMatch ? `${dayMatch[1]}-day` : ''
  }

  const summarizePlanCoverage = (outfits = []) => {
    const labels = []
    for (const outfit of outfits) {
      const label = outfit?.label || outfit?.bestFor || outfit?.title
      if (!label) continue
      const normalized = sentenceCaseLabel(label).toLowerCase()
      if (!labels.includes(normalized)) labels.push(normalized)
      if (labels.length >= 3) break
    }
    if (!labels.length) return ''
    return labels.join(', ')
  }

  const getResponseChips = (message = {}) => {
    const options = message.queryOptions || {}
    const chips = [
      options.occasion && { id: 'occasion', label: sentenceCaseLabel(options.occasion) },
      options.season && { id: 'season', label: sentenceCaseLabel(options.season) },
      options.mission && { id: 'mission', label: options.mission === 'mix' ? 'Mix of missions' : sentenceCaseLabel(options.mission) },
      options.activity && options.activity !== 'none' && { id: 'activity', label: ACTIVITY_OPTIONS.find(opt => opt[0] === options.activity)?.[1] || sentenceCaseLabel(options.activity) },
      options.idealOnly && { id: 'ideal', label: 'New-piece ideas' },
      message.wholeWardrobe && { id: 'wardrobe', label: 'Wardrobe only' },
    ].filter(Boolean)
    const seen = new Set()
    return chips.filter(chip => {
      const key = chip.label.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 4)
  }

  const buildStylistPresentation = (message = {}, outfits = [], messageIndex = -1) => {
    const visible = outfits.filter(outfit => !outfit?.diagnosticOnly)
    const plannedCards = visible.filter(outfit => isPlannedSetSource(outfit?.source))
    const lookCount = visible.length || outfits.length
    const first = visible[0] || outfits[0] || {}
    const query = message.queryOptions || {}
    const isPlanned = plannedCards.length > 0
    const isIdealDirections = outfits.length >= 2 && outfits.some(outfit => outfit?.previewOnly && outfit?.pieceId)
    const targetPiece = first.pieceId
      ? pieces.find(piece => Number(piece.id) === Number(first.pieceId))
      : null
    const pieceName = activeContext?.type === 'piece'
      ? activeContext.name
      : (targetPiece?.name || first?.pieces?.[0]?.name || 'this piece')

    if (isPlanned) {
      const coverage = summarizePlanCoverage(plannedCards)
      const prompt = getPreviousUserText(messageIndex)
      const destination = derivePlanDestination(prompt)
      const planLength = derivePlanLength(plannedCards)
      const planOccasions = [...new Set(plannedCards
        .map(outfit => sentenceCaseLabel(outfit?.occasion || ''))
        .filter(Boolean))]
      const planChips = [
        planOccasions.length > 1
          ? { id: 'occasion', label: 'Mixed occasions' }
          : (planOccasions[0] ? { id: 'occasion', label: planOccasions[0] } : null),
        // Read the plan's own state, not the user's wording. A regex on the
        // prompt labelled a winter *trip* "Winter capsule", and never produced
        // a chip for a summer capsule at all. capsulePlanContext is present
        // only on a real enforced capsule, and carries its own winter flag.
        (() => {
          const capsuleContext = plannedCards.find(outfit => outfit?.capsulePlanContext)?.capsulePlanContext
          if (capsuleContext) {
            return { id: 'season', label: capsuleContext.is_winter_capsule ? 'Winter capsule' : 'Capsule' }
          }
          return query.season && String(query.season).toLowerCase() !== 'current season'
            ? { id: 'season', label: sentenceCaseLabel(query.season) }
            : null
        })(),
        message.wholeWardrobe && { id: 'wardrobe', label: 'Wardrobe only' },
      ].filter(Boolean)
      const title = destination
        ? [planLength, destination, 'outfit plan'].filter(Boolean).join(' ')
        : (plannedCards.some(outfit => outfit?.source === 'trip_precompose') ? 'Trip wardrobe plan' : 'Wardrobe outfit plan')
      return {
        type: 'trip_plan',
        title,
        // A "needs review" card is an attempt, not a look the plan delivers.
        // Counting it would restate the old lie in a new place: the header
        // would claim 10 looks while two of them are marked broken.
        summary: [singularLookLabel(plannedCards.filter(outfit => !outfit?.broken).length), coverage].filter(Boolean).join(' · '),
        chips: planChips
      }
    }
    if (isIdealDirections || activeContext?.type === 'piece') {
      return {
        type: 'garment_styling',
        title: `${lookCount} ${lookCount === 1 ? 'way' : 'ways'} to style ${pieceName}`,
        summary: `${singularLookLabel(lookCount)} · ${query.occasion ? sentenceCaseLabel(query.occasion).toLowerCase() : 'wardrobe-based directions'}`,
        chips: getResponseChips(message)
      }
    }
    if (message.wholeWardrobe) {
      return {
        type: 'occasion_look',
        title: lookCount === 1 ? 'Wardrobe outfit' : 'Wardrobe outfit options',
        summary: `${singularLookLabel(lookCount)}${query.occasion ? ` · ${sentenceCaseLabel(query.occasion).toLowerCase()}` : ''}`,
        chips: getResponseChips(message)
      }
    }
    return {
      type: 'general',
      title: lookCount === 1 ? 'Stylist recommendation' : 'Stylist recommendations',
      summary: lookCount ? singularLookLabel(lookCount) : '',
      chips: getResponseChips(message)
    }
  }

  const buildResponseSections = (outfits = [], presentation = {}, allOutfits = null) => {
    // A plan is one artifact, not a list of independent results — the same rule
    // that already disables the "show N more" fold for plans. This 8-cap never
    // got the same treatment, so a 10-card capsule silently lost its last two:
    // live, that hid a Nature Walks look AND the needs-review card the person
    // was supposed to repair. Ordinary multi-result replies are genuinely a
    // list and keep the cap.
    const visible = presentation.type === 'trip_plan' ? outfits : outfits.slice(0, 8)
    if (presentation.type === 'trip_plan') {
      const groups = []
      visible.forEach((outfit, idx) => {
        const title = sentenceCaseLabel(outfit.label || outfit.bestFor || outfit.title || `Look ${idx + 1}`)
        let group = groups.find(entry => entry.title.toLowerCase() === title.toLowerCase())
        if (!group) {
          group = { title, items: [] }
          groups.push(group)
        }
        group.items.push({ outfit, idx })
      })
      // A slot's count is how many looks the plan holds for it, not how many are currently
      // rendered — otherwise a collapsed disclosure shows "2 LOOKS" over a card badged "1 OF 3".
      const fullCounts = new Map()
      for (const outfit of (Array.isArray(allOutfits) ? allOutfits : outfits)) {
        const title = sentenceCaseLabel(outfit.label || outfit.bestFor || outfit.title || '').toLowerCase()
        if (!title) continue
        fullCounts.set(title, (fullCounts.get(title) || 0) + 1)
      }
      return groups.map(group => ({
        ...group,
        countLabel: singularLookLabel(fullCounts.get(group.title.toLowerCase()) || group.items.length)
      }))
    }
    return visible.map((outfit, idx) => {
      const explicitRank = outfit.rankLabel || outfit.directionLabel
      const rankLabel = explicitRank || directionRankLabel(outfit.strength)
      return {
        title: rankLabel || `Direction ${idx + 1}`,
        countLabel: '',
        items: [{ outfit, idx }]
      }
    })
  }

  const getTripPlanOverviewRows = (notes = [], planOutfits = []) => {
    const rows = []
    // The planner already knows structurally whether pieces repeat across the plan
    // (`describeTripPieceReuse` → `pieceReuse.repeated`, attached to every plan outfit in
    // outfitSetPlanner.js). Read that instead of keyword-matching the prose line it produced:
    // both of its branches ("Repeat schedule: ..." and "no piece repeats across the N outfits")
    // contain the word "repeats", so a regex labelled a plan with zero repeats "Useful repeats".
    const pieceReuse = planOutfits.find(outfit => outfit?.pieceReuse)?.pieceReuse || null
    const repeatLabelFor = (text) => {
      if (/packing/i.test(text)) return 'Packing'
      // TODO: backfill pieceReuse — plans stored before it was attached fall back to the old
      // keyword guess, which cannot tell the two branches apart.
      if (!pieceReuse) return 'Useful repeats'
      return Array.isArray(pieceReuse.repeated) && pieceReuse.repeated.length
        ? 'Useful repeats'
        : 'All looks distinct'
    }
    const addRow = (label, value) => {
      const clean = String(value || '').trim()
      const cleanLabel = String(label || '').trim()
      if (!clean && !cleanLabel) return
      if (rows.some(row => row.label === label && row.value.toLowerCase() === clean.toLowerCase())) return
      rows.push({ label: cleanLabel, value: clean })
    }
    for (const note of notes) {
      const text = String(note || '').trim()
      if (/^Plan length:/i.test(text)) {
        const value = text.replace(/^Plan length:\s*/i, '').replace(/(\d+)-day/i, '$1 days')
        addRow(value, '')
      }
      else if (/^Coverage:/i.test(text)) addRow('Coverage', text.replace(/^Coverage:\s*/i, ''))
      else if (/^Weather used:/i.test(text)) {
        const compact = text
          .replace(/^Weather used:\s*/i, '')
          .replace(/\s+\((?:live forecast|fallback)[^)]+\)/gi, '')
          .replace(/\s*—\s*/g, ': ')
        addRow('Conditions', compact)
      } else if (/repeat|reuse|packing/i.test(text) && !/image space/i.test(text)) {
        // Strip the value's own restatement of the label ("Useful repeats: Repeat schedule: ...").
        const value = text.replace(/^(?:Repeat schedule|Packing reuse):\s*/i, '')
        addRow(repeatLabelFor(text), value)
      }
      if (rows.length >= 4) break
    }
    return rows
  }

  const simplifyPieceTitle = (piece = {}) => {
    const raw = String(piece?.name || '').replace(/\s+/g, ' ').trim()
    if (!raw) return ''
    const category = String(piece?.category || '').toLowerCase()
    const removeWords = new Set([
      'black', 'white', 'cream', 'beige', 'tan', 'brown', 'navy', 'blue', 'red', 'coral', 'orange',
      'green', 'olive', 'grey', 'gray', 'colorful', 'solid', 'print', 'printed', 'leather', 'suede'
    ])
    let words = raw.split(/\s+/).filter(word => !removeWords.has(word.toLowerCase()))
    if (category === 'dress') {
      const descriptor = words.find(word => /botanical|floral|paisley|abstract|geometric|striped|stripe/i.test(word))
      const length = words.find(word => /maxi|midi|mini/i.test(word))
      words = [descriptor, length, 'dress'].filter(Boolean)
    } else if (category === 'bottom') {
      const garment = words.find(word => /shorts|pants|trousers|skirt|jeans|capris|culottes/i.test(word))
      const descriptor = words.find(word => !new RegExp(`^${garment || ''}$`, 'i').test(word))
      words = [descriptor, garment].filter(Boolean)
    } else if (category === 'top') {
      const garment = words.find(word => /top|blouse|shirt|tank|tee|sweater|camisole/i.test(word))
      const descriptor = words.find(word => /botanical|floral|paisley|abstract|geometric|striped|stripe|ruffled|tie|linen/i.test(word))
      words = [descriptor, garment].filter(Boolean)
    }
    const compact = words.filter(Boolean).slice(0, 4).join(' ').trim()
    return sentenceCaseLabel(compact || raw)
  }

  const getTripCardMarker = (outfit = {}) => {
    const position = String(outfit.coveragePosition || '').trim()
    const match = position.match(/\b\d+\s+of\s+\d+\b/i)
    return match ? match[0].toLowerCase() : (position || 'look')
  }

  const getTripCardDisplayTitle = (outfit = {}, section = {}, sectionItemIndex = 0) => {
    if (!isPlannedSetSource(outfit.source)) return outfit.label || outfit.title || `Direction ${sectionItemIndex + 1}`
    const authoredTitle = String(outfit.title || '').trim()
    if (outfit.composedBy === 'model' && authoredTitle && authoredTitle !== String(outfit.label || '').trim()) {
      return authoredTitle
    }
    const hydrated = Array.isArray(outfit.pieces) ? outfit.pieces.map(piece => hydrateDisplayPiece(piece)) : []
    const dress = hydrated.find(piece => String(piece?.category || '').toLowerCase() === 'dress')
    if (dress) return simplifyPieceTitle(dress)
    const top = hydrated.find(piece => String(piece?.category || '').toLowerCase() === 'top')
    const bottom = hydrated.find(piece => String(piece?.category || '').toLowerCase() === 'bottom')
    if (top && bottom) return `${simplifyPieceTitle(top)} with ${simplifyPieceTitle(bottom).toLowerCase()}`
    const pieces = hydrated.map(piece => simplifyPieceTitle(piece)).filter(Boolean)
    if (pieces.length >= 2) return pieces.slice(0, 2).join(' and ')
    const sectionBase = String(section?.title || outfit.label || 'Look').replace(/\s+days?$/i, '').trim()
    return `${sectionBase || 'Look'} look ${sectionItemIndex + 1}`
  }

  const hydrateDisplayPiece = (piece = {}) => {
    const saved = piece?.id ? pieces.find(p => Number(p.id) === Number(piece.id)) : null
    return {
      ...piece,
      ...(saved || {}),
      name: piece?.name || saved?.name || 'Garment',
      category: piece?.category || saved?.category || '',
      photo: piece?.photo || saved?.photo || null,
      worn_photo: piece?.worn_photo || saved?.worn_photo || null,
    }
  }

  const compactGeneratedOutfitContext = (outfits = [], meta = {}) => {
    if (!Array.isArray(outfits) || !outfits.length) return ''
    const pipelineNote = meta.source === 'whole_wardrobe'
      ? 'Generation pipeline: whole-wardrobe outfit generation. Candidate ranking includes a visual critic pass over garment-photo contact sheets before the final text composer chooses returned cards.'
      : meta.source === 'selected_piece'
        ? 'Generation pipeline: selected-piece visual composer. The selected garment stays pinned as the anchor while saved wardrobe support pieces are reviewed from photos, confidence-aware tags, feedback, and outfit memory. The card thumbnails reflect the pieces reviewed; unless a rendered outfit image exists, discuss garment photos and card context rather than a full worn outfit image.'
        : ''
    const cardContext = outfits.slice(0, 5).map((outfit, index) => {
      const displayPieces = Array.isArray(outfit?.pieces) ? outfit.pieces : []
      const pieceLines = displayPieces.map(piece => {
        const hydrated = hydrateDisplayPiece(piece)
        const photoStatus = hydrated.photo || hydrated.worn_photo
          ? `, thumbnail available${hydrated.photo ? ' on hanger' : ''}${hydrated.worn_photo ? `${hydrated.photo ? ' and' : ''} worn` : ''}`
          : ''
        return `- ${hydrated.name || 'Garment'}${hydrated.category ? ` (${hydrated.category})` : ''}${hydrated.id ? `, id ${hydrated.id}` : ''}${photoStatus}`
      }).join('\n')

      return [
        `Outfit ${index + 1}: ${outfit.label || outfit.title || `Generated outfit ${index + 1}`}`,
        outfit.strength ? `Strength: ${outfit.strength}` : '',
        outfit.dominantDirection ? `Direction: ${outfit.dominantDirection}` : '',
        outfit.silhouette ? `Silhouette: ${outfit.silhouette}` : '',
        outfit.bestFor ? `Best for: ${outfit.bestFor}` : '',
        pieceLines ? `Pieces:\n${pieceLines}` : '',
        outfit.reason ? `Reason: ${outfit.reason}` : '',
        outfit.watchFor ? `Watch: ${outfit.watchFor}` : '',
      ].filter(Boolean).join('\n')
    }).join('\n\n')
    return [pipelineNote, cardContext].filter(Boolean).join('\n\n')
  }

  // ── Render one editorial direction image on demand ──────────────────────────
  const renderOneEditorialDirection = async (outfit, messageIndex, idx) => {
    const key = `${messageIndex}:${idx}`
    let statusTimers = []
    const clearImageTimers = () => {
      statusTimers.forEach(clearTimeout)
      statusTimers = []
    }
    setBoardLoadingIndex(key)
    setImageStatusByKey(prev => ({ ...prev, [key]: 'Loading garment reference photos...' }))
    statusTimers = [
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [key]: 'Sending direction details to the image model...' })), 4000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [key]: 'Rendering outfit image. This can take a minute.' })), 14000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [key]: 'Still rendering...' })), 45000),
    ]
    try {
      const res = await fetch('/api/ai/editorial-render-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pieceId: outfit.pieceId || activeContext?.id,
          direction: outfit,
          occasion: outfit.occasion || generateOccasion,
          season: outfit.season || generateSeason,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Render failed')
      setBoardResults(prev => ({ ...prev, [key]: [data] }))
    } catch (err) {
      setBoardResults(prev => ({ ...prev, [key]: [{ error: friendlyBoardErrorMessage(err.message) }] }))
    } finally {
      clearImageTimers()
      setImageStatusByKey(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      setBoardLoadingIndex(null)
    }
  }

  const renderStructuredAdvice = (message, messageIndex) => {
    const allOutfits = Array.isArray(message?.structuredOutfits) ? message.structuredOutfits : []
    // A plan is one artifact, not a list of independent results: splitting it behind "Show N more
    // outfit results" cuts the thing the owner asked for in half, hides whole slots until clicked,
    // and is what made the header/section counts describe the viewport instead of the plan. The
    // load optimisation this fold came from (#162) still applies to ordinary multi-result replies,
    // which are genuinely a list.
    const isSinglePlanArtifact = allOutfits.some(outfit => isPlannedSetSource(outfit?.source)) || Boolean(message?.wholeWardrobe)
    const hasDeferredOutfits = !isSinglePlanArtifact
      && collapsedStructuredResults.has(messageIndex)
      && allOutfits.length > INITIAL_SAVED_OUTFIT_COUNT
    const outfits = hasDeferredOutfits ? allOutfits.slice(0, INITIAL_SAVED_OUTFIT_COUNT) : allOutfits
    if (!outfits.length) return null
    const messageResultKey = message?.resultId || messageIndex

    const KNOWN_COLORS = {
      black: '#222222',
      charcoal: '#3c3f41',
      grey: '#7a7a7a',
      gray: '#7a7a7a',
      white: '#f9f9fb',
      cream: '#f9f6e5',
      beige: '#d8c7aa',
      oatmeal: '#e6dfd3',
      tan: '#c5a075',
      camel: '#c19a6b',
      sand: '#d9c7a3',
      ecru: '#f0e6d2',
      taupe: '#8b7d6b',
      brown: '#5a4538',
      chocolate: '#4a3222',
      espresso: '#3b2a20',
      tobacco: '#6b4a2e',
      cognac: '#8e4c32',
      rust: '#b15a3a',
      oxblood: '#4a1f1f',
      navy: '#2b3b4c',
      ink: '#1c2331',
      blue: '#6b8ca6',
      green: '#547257',
      olive: '#5e684a',
      emerald: '#296b4f',
      red: '#a53d38',
      orange: '#d97d43',
      yellow: '#e0b845',
      purple: '#5b3a67',
      plum: '#52344a',
      burgundy: '#6b2d35',
      mauve: '#a98296',
      lavender: '#b6a2cf',
      pink: '#e8afb3',
      gold: '#cfab4a',
      silver: '#b3b6b7',
      amber: '#d9a03b',
      mustard: '#c8a23b',
      multi: 'repeating-linear-gradient(45deg, #d8d8d8, #d8d8d8 3px, #f0f0f0 3px, #f0f0f0 6px)',
      stripe: 'repeating-linear-gradient(45deg, #c0c0c0, #c0c0c0 3px, #f8f8f8 3px, #f8f8f8 6px)',
      print: 'repeating-linear-gradient(45deg, #d0d0d0, #d0d0d0 3px, #ebebeb 3px, #ebebeb 6px)',
      floral: 'repeating-linear-gradient(45deg, #e0d0d0, #e0d0d0 3px, #f5f0f0 3px, #f5f0f0 6px)',
    }

    const detectColor = (text, fallback = '#d0d2d4') => {
      if (!text) return fallback
      const lower = text.toLowerCase()
      if (lower.includes('stripe') || lower.includes('stripes') || lower.includes('striped')) return KNOWN_COLORS.stripe
      if (lower.includes('print') || lower.includes('printed')) return KNOWN_COLORS.print
      if (lower.includes('floral') || lower.includes('flower')) return KNOWN_COLORS.floral
      if (lower.includes('multi') || lower.includes('pattern') || lower.includes('patterned')) return KNOWN_COLORS.multi
      
      for (const [colorName, hex] of Object.entries(KNOWN_COLORS)) {
        if (new RegExp(`\\b${colorName}\\b`).test(lower)) return hex
      }
      return fallback
    }

    const detectCategory = (text) => {
      const lower = text.toLowerCase()
      if (lower.includes('pants') || lower.includes('trouser') || lower.includes('trousers') || lower.includes('jeans') || lower.includes('skirt') || lower.includes('leggings') || lower.includes('shorts') || lower.includes('denim') || lower.includes('pant')) {
        return 'bottom'
      }
      if (lower.includes('boot') || lower.includes('sandal') || lower.includes('mule') || lower.includes('flat') || lower.includes('sneaker') || lower.includes('shoe') || lower.includes('heels') || lower.includes('espadrille') || lower.includes('shoes') || lower.includes('flats') || lower.includes('boots') || lower.includes('sandals')) {
        return 'shoes'
      }
      if (lower.includes('jacket') || lower.includes('coat') || lower.includes('cardigan') || lower.includes('hoodie') || lower.includes('vest') || lower.includes('blazer') || lower.includes('trench') || lower.includes('sweater') || lower.includes('knitwear')) {
        return 'outerwear'
      }
      if (lower.includes('bag') || lower.includes('necklace') || lower.includes('scarf') || lower.includes('belt') || lower.includes('hat') || lower.includes('pendant') || lower.includes('purse') || lower.includes('tote') || lower.includes('wristlet')) {
        return 'accessory'
      }
      if (lower.includes('dress') || lower.includes('jumpsuit') || lower.includes('gown')) {
        return 'dress'
      }
      return 'top'
    }
    const getPreviewPieces = (outfit) => {
      const list = []
      const seenCategories = new Set()

      // Look up target piece from outfit.pieceId first, then fallback to activeContext
      const targetPieceId = outfit.pieceId || (activeContext?.type === 'piece' ? activeContext.id : null)
      const targetPiece = targetPieceId ? pieces.find(p => Number(p.id) === Number(targetPieceId)) : null

      if (targetPiece) {
        const cat = targetPiece.category || 'top'
        list.push({
          id: 'active',
          name: targetPiece.name,
          category: cat,
          color: detectColor(`${Array.isArray(targetPiece.colors) ? targetPiece.colors.join(' ') : (targetPiece.colors || '')} ${targetPiece.background_color || ''} ${targetPiece.name}`, '#888888'),
          colors: targetPiece.colors || [],
          background_color: targetPiece.background_color || '',
          isAnchor: true
        })
        seenCategories.add(cat)
      } else if (activeContext) {
        const cat = activeContext.category || 'top'
        const fullPiece = pieces.find(p => Number(p.id) === Number(activeContext.id))
        const colors = fullPiece?.colors || activeContext.colors || []
        list.push({
          id: 'active',
          name: activeContext.name,
          category: cat,
          color: detectColor(`${Array.isArray(colors) ? colors.join(' ') : colors} ${fullPiece?.background_color || ''} ${activeContext.name}`, '#888888'),
          colors: colors,
          background_color: fullPiece?.background_color || activeContext.background_color || '',
          isAnchor: true
        })
        seenCategories.add(cat)
      }

      const rawPieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
      rawPieces.forEach((raw) => {
        const piece = hydrateDisplayPiece(raw)
        if (targetPieceId && Number(piece.id) === Number(targetPieceId)) return
        if (activeContext && Number(piece.id) === Number(activeContext.id)) return
        const cat = piece.category
        if (cat && !seenCategories.has(cat)) {
          list.push({
            id: piece.id,
            name: piece.name,
            category: cat,
            color: detectColor(`${Array.isArray(piece.colors) ? piece.colors.join(' ') : (piece.colors || '')} ${piece.background_color || ''} ${piece.name}`, '#888888'),
            colors: piece.colors || [],
            background_color: piece.background_color || '',
            isAnchor: false
          })
          seenCategories.add(cat)
        }
      })

      const additions = Array.isArray(outfit.missingPieces) ? outfit.missingPieces : []
      additions.forEach((addition, addIdx) => {
        const cat = detectCategory(addition)
        if (cat && !seenCategories.has(cat)) {
          list.push({
            id: `addition-${addIdx}`,
            name: addition,
            category: cat,
            color: detectColor(addition, '#c8c8c8'),
            colors: [],
            isAnchor: false
          })
          seenCategories.add(cat)
        }
      })
      return list
    }

    const getSwatchStyle = (piece) => {
      const textToSearch = `${piece.name} ${piece.background_color || ''} ${Array.isArray(piece.colors) ? piece.colors.join(' ') : (piece.colors || '')}`.toLowerCase()
      const backgroundText = String(piece.background_color || '').toLowerCase()
      const plainColorNames = Object.keys(KNOWN_COLORS).filter(colorName => !['stripe', 'print', 'floral', 'multi'].includes(colorName))
      
      const foundColors = []
      for (const colorName of plainColorNames) {
        const regex = new RegExp(`\\b${colorName}\\b`)
        if (regex.test(textToSearch)) {
          foundColors.push(colorName)
        }
      }

      const isStripe = textToSearch.includes('stripe') || textToSearch.includes('striped')
      const isPrint = textToSearch.includes('print') || textToSearch.includes('printed') || textToSearch.includes('pattern') || textToSearch.includes('patterned') || textToSearch.includes('floral') || textToSearch.includes('flower')
      const isKnit = textToSearch.includes('knit') || textToSearch.includes('patchwork') || textToSearch.includes('marled') || textToSearch.includes('mixed') || textToSearch.includes('multi')
      const backgroundColorNames = plainColorNames.filter(colorName => new RegExp(`\\b${colorName}\\b`).test(backgroundText))
      const nonNeutralColors = foundColors.filter(colorName => !['black', 'charcoal', 'grey', 'gray', 'white'].includes(colorName))
      const baseColorName = backgroundColorNames.find(colorName => !['black', 'charcoal', 'grey', 'gray', 'white'].includes(colorName))
        || backgroundColorNames[0]
        || nonNeutralColors[0]
        || foundColors[0]
      const baseColor = baseColorName ? KNOWN_COLORS[baseColorName] : (piece.color || '#d0d2d4')
      const accentColors = foundColors
        .filter(colorName => colorName !== baseColorName)
        .slice(0, 3)
        .map(colorName => KNOWN_COLORS[colorName])
      const accentOne = accentColors[0] || 'rgba(35,30,27,0.48)'
      const accentTwo = accentColors[1] || 'rgba(255,255,255,0.55)'

      let background = '#d0d2d4'
      let label = ''

      if (isStripe) {
        background = `repeating-linear-gradient(45deg, ${baseColor}, ${baseColor} 5px, ${accentOne} 5px, ${accentOne} 8px, ${accentTwo} 8px, ${accentTwo} 10px)`
        label = foundColors.length ? `${foundColors.join('/')} stripe` : 'stripe'
      } else if (isKnit) {
        background = `repeating-linear-gradient(-45deg, ${baseColor}, ${baseColor} 4px, ${accentOne} 4px, ${accentOne} 6px)`
        label = foundColors.length ? `${foundColors.join('/')} knit` : 'mixed knit'
      } else if (isPrint) {
        background = `radial-gradient(circle at 28% 32%, ${accentOne} 0 2px, transparent 2.5px), radial-gradient(circle at 72% 42%, ${accentTwo} 0 2px, transparent 2.5px), radial-gradient(circle at 46% 72%, ${accentOne} 0 1.6px, transparent 2.3px), ${baseColor}`
        label = foundColors.length ? `${foundColors.join('/')} print` : 'print'
      } else {
        background = baseColor
        label = baseColorName || piece.name.toLowerCase().split(' ')[0] || 'neutral'
      }

      return { background, label }
    }

    const renderOutfitSketch = (outfit, { compact = false } = {}) => {
      const sketchPieces = getPreviewPieces(outfit)
      if (!sketchPieces.length) return null
      const anchor = sketchPieces.find(p => p.isAnchor) || sketchPieces[0]
      const top = sketchPieces.find(p => p.category === 'top') || (anchor?.category === 'top' ? anchor : null)
      const dress = sketchPieces.find(p => p.category === 'dress') || (anchor?.category === 'dress' ? anchor : null)
      const bottom = sketchPieces.find(p => p.category === 'bottom')
      const shoes = sketchPieces.find(p => p.category === 'shoes')
      const outerwear = sketchPieces.find(p => p.category === 'outerwear')
      const accessory = sketchPieces.find(p => p.category === 'accessory')
      const swatchFor = (piece, fallback = '#d0d2d4') => piece ? getSwatchStyle(piece).background : fallback
      const fillStyleFor = (piece) => ({ background: swatchFor(piece) })
      const bottomName = String(bottom?.name || '').toLowerCase()
      const isShorts = /\b(short|shorts|bermuda)\b/.test(bottomName)
      const isCroppedPant = /\b(cropped|crop|ankle|capri|culotte|culottes)\b/.test(bottomName)
      const isSkirt = /\b(skirt|midi|pencil|column|mini|maxi)\b/.test(bottomName)
      const isWide = /\b(wide|barrel|flowing|full|palazzo)\b/.test(bottomName)
      const pantHeight = isShorts ? 17 : (isCroppedPant ? 29 : 38)
      const pantTop = isShorts ? 55 : 54
      const skirtHeight = /\b(maxi|full-length)\b/.test(bottomName)
        ? 41
        : (/\b(midi|column)\b/.test(bottomName) ? 34 : (/\b(mini|short)\b/.test(bottomName) ? 21 : 29))
      const skirtTop = skirtHeight >= 40 ? 51 : 54
      const rolePieces = [anchor, outerwear, top, dress, bottom, shoes, accessory]
        .filter(Boolean)
        .filter((piece, index, arr) => arr.findIndex(p => p.id === piece.id && p.category === piece.category) === index)

      const sketchGraphic = (
          <div style={{
            width: 70,
            height: 106,
            position: 'relative',
            flex: '0 0 auto',
            borderRadius: 10,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.72), rgba(245,240,232,0.72))',
            overflow: 'hidden'
          }}>
            <div style={{
              position: 'absolute',
              left: 31,
              top: 11,
              width: 8,
              height: 8,
              borderRadius: '50%',
              border: '1px solid rgba(91,72,53,0.28)'
            }} />
            <div style={{
              position: 'absolute',
              left: 34,
              top: 20,
              width: 1,
              height: 74,
              background: 'rgba(91,72,53,0.18)'
            }} />
            {(dress || top) && (
              <div
                title={(dress || top).name}
                style={{
                  position: 'absolute',
                  left: dress ? 20 : 21,
                  top: 28,
                  width: dress ? 30 : 28,
                  height: dress ? 45 : 23,
                  ...fillStyleFor(dress || top),
                  border: `1px solid ${(dress || top).isAnchor ? 'var(--accent)' : 'rgba(0,0,0,0.14)'}`,
                  borderRadius: dress ? '8px 8px 12px 12px' : '8px 8px 5px 5px',
                  clipPath: dress ? 'polygon(25% 0, 75% 0, 100% 100%, 0 100%)' : 'polygon(18% 0, 82% 0, 100% 100%, 0 100%)'
                }}
              />
            )}
            {outerwear && (
              <div
                title={outerwear.name}
                style={{
                  position: 'absolute',
                  left: 16,
                  top: 26,
                  width: 38,
                  height: 37,
                  border: `2px solid ${swatchFor(outerwear)}`,
                  borderTopWidth: 5,
                  borderRadius: '10px 10px 6px 6px',
                  opacity: 0.78,
                  pointerEvents: 'none'
                }}
              />
            )}
            {bottom && !dress && (isSkirt ? (
              <div
                title={bottom.name}
                style={{
                  position: 'absolute',
                  left: 20,
                  top: skirtTop,
                  width: 30,
                  height: skirtHeight,
                  ...fillStyleFor(bottom),
                  border: `1px solid ${bottom.isAnchor ? 'var(--accent)' : 'rgba(0,0,0,0.14)'}`,
                  borderRadius: '4px 4px 10px 10px',
                  clipPath: isWide ? 'polygon(20% 0, 80% 0, 100% 100%, 0 100%)' : 'polygon(28% 0, 72% 0, 82% 100%, 18% 100%)'
                }}
              />
            ) : (
              <>
                <div title={bottom.name} style={{
                  position: 'absolute',
                  left: isWide ? 20 : 24,
                  top: pantTop,
                  width: isWide ? 13 : (isShorts ? 11 : 10),
                  height: pantHeight,
                  ...fillStyleFor(bottom),
                  border: `1px solid ${bottom.isAnchor ? 'var(--accent)' : 'rgba(0,0,0,0.14)'}`,
                  borderRadius: isShorts ? '4px 4px 5px 5px' : '4px 4px 7px 7px'
                }} />
                <div title={bottom.name} style={{
                  position: 'absolute',
                  right: isWide ? 20 : 24,
                  top: pantTop,
                  width: isWide ? 13 : (isShorts ? 11 : 10),
                  height: pantHeight,
                  ...fillStyleFor(bottom),
                  border: `1px solid ${bottom.isAnchor ? 'var(--accent)' : 'rgba(0,0,0,0.14)'}`,
                  borderRadius: isShorts ? '4px 4px 5px 5px' : '4px 4px 7px 7px'
                }} />
              </>
            ))}
            {shoes && (
              <>
                <div title={shoes.name} style={{ position: 'absolute', left: 19, bottom: 8, width: 14, height: 5, borderRadius: 8, background: swatchFor(shoes), border: '1px solid rgba(0,0,0,0.15)' }} />
                <div title={shoes.name} style={{ position: 'absolute', right: 19, bottom: 8, width: 14, height: 5, borderRadius: 8, background: swatchFor(shoes), border: '1px solid rgba(0,0,0,0.15)' }} />
              </>
            )}
            {accessory && (
              <div title={accessory.name} style={{ position: 'absolute', right: 8, top: 45, width: 12, height: 16, borderRadius: '5px 5px 7px 7px', background: swatchFor(accessory), border: '1px solid rgba(0,0,0,0.15)' }} />
            )}
          </div>
      )

      if (compact) return sketchGraphic

      return (
        <div style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          marginTop: 8,
          marginBottom: 8,
          padding: '8px 9px',
          borderRadius: 10,
          border: '1px solid var(--border-light)',
          background: 'rgba(255,255,255,0.42)'
        }}>
          {sketchGraphic}
          <div style={{ minWidth: 0, display: 'grid', gap: 4, flex: 1 }}>
            {rolePieces.slice(0, 5).map(piece => {
              const swatch = getSwatchStyle(piece)
              const role = piece.isAnchor ? 'anchor' : piece.category
              return (
                <div key={`${piece.id}-${piece.category}`} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12, lineHeight: 1.4, color: 'var(--text-muted)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: swatch.background, border: '1px solid rgba(0,0,0,0.12)', flex: '0 0 auto' }} />
                  <span style={{ color: piece.isAnchor ? 'var(--accent)' : 'var(--text-light)', fontWeight: piece.isAnchor ? 700 : 600, textTransform: 'uppercase', fontSize: 12 }}>{role}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{piece.name}</span>
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    // Panel feedback: give each direction one plain-language visual thesis (e.g.
    // "Floral top leads, grounded by dark jeans, finished with cream shoes") instead of
    // leaving people to reconstruct it from the sketch + role legend. Reuses the same
    // role extraction as the sketch above so the thesis always describes the same
    // composition it's shown next to. Deliberately keeps piece names as-is (unlike
    // simplifyPieceTitle, which strips color words for compact trip-card titles) —
    // color is exactly what makes one direction read differently from another here.
    const buildVisualThesis = (outfit) => {
      const rolePieces = getPreviewPieces(outfit)
      if (!rolePieces.length) return ''
      const anchor = rolePieces.find(p => p.isAnchor) || rolePieces[0]
      const dress = rolePieces.find(p => p.category === 'dress')
      const top = rolePieces.find(p => p.category === 'top')
      const bottom = rolePieces.find(p => p.category === 'bottom')
      const outerwear = rolePieces.find(p => p.category === 'outerwear')
      const shoes = rolePieces.find(p => p.category === 'shoes')
      const accessory = rolePieces.find(p => p.category === 'accessory')

      const pieceName = (piece) => String(piece?.name || '').replace(/\s+/g, ' ').trim()
      const lead = pieceName(dress || top || anchor)
      const ground = pieceName(dress ? outerwear : (bottom || outerwear))
      const finish = pieceName(shoes || accessory)

      const clauses = []
      if (lead) clauses.push(lead)
      if (ground) clauses.push(`grounded by ${ground.toLowerCase()}`)
      if (finish) clauses.push(`finished with ${finish.toLowerCase()}`)
      return clauses.length ? `${clauses.join(', ')}.` : ''
    }

    const strengthLabel = (value) => directionRankLabel(value) || 'Direction'

    const comparisonKey = `whole-wardrobe-comparison:${messageResultKey}`
    const comparisonBoards = boardResults[comparisonKey] || []
    const isGeneratingComparison = boardLoadingIndex === comparisonKey
    const isTextOnlyPreviewSet = Boolean(outfits[0]?.previewOnly) && outfits.every(outfit => outfit.previewOnly && (outfit.pieceId || outfit.selectedPieceId || outfit.textOnly))
    const canGenerateComparison = !isTextOnlyPreviewSet && outfits.length >= 2 && outfits.some(outfit => {
      if (Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length >= 2) return true
      return Array.isArray(outfit?.pieces) && outfit.pieces.filter(piece => piece?.id).length >= 2
    })

    // Note: previewOnly is overloaded.
    // 1. On rendered board objects (e.g. whole-wardrobe preview sheets), it means "this IS a preview sheet".
    // 2. On direction cards (e.g. ideal-additions editorial directions), it means "text-only direction, not yet rendered".
    // We explicitly check previewOnly && pieceId to target only the text-only editorial direction cards.
    const isIdealAdditions = outfits.length >= 2 &&
      outfits.some(outfit => outfit.previewOnly && outfit.pieceId)
    const canExploreAdjacent = message?.savedOutfitVariantMode === 'formula' && message?.variantSourceOutfit
    // Counts describe the whole response, not the rendered slice — `outfits` is truncated to
    // INITIAL_SAVED_OUTFIT_COUNT while the "Show N more outfit results" disclosure is collapsed,
    // and deriving the header/section counts from it made "N looks" change when the user expanded
    // it (and put "2 LOOKS" above cards the server had badged "1 OF 3"). Same invariant E9 fixed
    // between the chat header and the thread rail: one count, one meaning.
    const presentation = buildStylistPresentation(message, allOutfits, messageIndex)
    const responseSections = buildResponseSections(outfits, presentation, allOutfits)
    const tripNotes = getTripPlanNotes(outfits)
    const tripOverviewRows = getTripPlanOverviewRows(tripNotes, outfits)

    return (
      <div className="stylist-response-shell">
        <div className="stylist-response-header">
          <h2 className="stylist-response-title">{presentation.title}</h2>
          {presentation.summary && <div className="stylist-response-summary">{presentation.summary}</div>}
          {presentation.chips?.length > 0 && (
            <div className="stylist-response-chips" aria-label="Response context">
              {presentation.chips.map(chip => <span key={chip.id} className="stylist-response-chip">{chip.label}</span>)}
            </div>
          )}
        </div>
        <MessageTelemetryDisclosure message={message} />
        {canExploreAdjacent && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => send({
                outfit: { ...message.variantSourceOutfit, imageGenerationMode: true, variantMode: 'adjacent' },
                input: 'Explore adjacent outfits from this saved look using only my wardrobe.',
                compareOutfitId: '',
                continueThread: true,
              })}
              style={{ fontSize: 12, color: 'var(--accent)', padding: '5px 11px', borderRadius: 14, border: '1px solid var(--accent)', background: 'var(--surface)', cursor: 'pointer' }}
            >
              Explore adjacent outfits
            </button>
          </div>
        )}
        {canGenerateComparison && (
          <div className={`stylist-preview-action ${comparisonBoards.length || isGeneratingComparison ? 'has-preview' : ''}`}>
            <div className="stylist-preview-action-row">
              <div className="stylist-preview-action-copy">
                <div className="stylist-preview-action-title">Comparison preview</div>
                <div className="stylist-preview-action-note">See complete outfits side by side.</div>
              </div>
              <button
                type="button"
                onClick={() => generateWholeWardrobeComparisonSheet(messageResultKey, outfits)}
                disabled={isGeneratingComparison}
                style={{ fontSize: 12, color: 'var(--accent)', padding: '5px 11px', borderRadius: 14, border: '1px solid var(--accent)', background: 'var(--surface)', cursor: isGeneratingComparison ? 'default' : 'pointer', opacity: isGeneratingComparison ? 0.65 : 1 }}
              >
                {isGeneratingComparison ? 'Generating preview...' : (comparisonBoards.length ? 'Regenerate comparison' : 'Preview all looks')}
              </button>
            </div>
            {(isGeneratingComparison || comparisonBoards.length > 0) && (
              <div className="generated-visual-grid" style={{ marginTop: 8 }}>
                {isGeneratingComparison && (
                  <div className="generated-visual-card skeleton-pulse" role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 20, border: '1px dashed var(--accent)', background: 'var(--surface-2)', borderRadius: 12 }}>
                    <div className="typing-dots" style={{ marginBottom: 12 }}><span /><span /><span /></div>
                    <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, textAlign: 'center', lineHeight: 1.45 }}>
                      {imageStatusByKey[comparisonKey] || 'Generating rough preview...'}
                    </div>
                  </div>
                )}
                {comparisonBoards.map((board, boardIdx) => {
                  const saveKey = `whole-wardrobe-preview-sheet:${messageIndex}:${boardIdx}`
                  const isSaved = savedBoardKeys.has(saveKey) || (board.imageUrl && savedBoardUrls.has(board.imageUrl))
                  return (
                    <div key={boardIdx} className="generated-visual-card" style={{ position: 'relative' }}>
                      {board.error ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Preview error: {board.error}</div>
                      ) : (
                        <>
                          {isSaved && (
                            <div className="saved-board-badge" style={{ width: 'fit-content', marginBottom: 6, fontSize: 12, background: 'var(--donate-bg)', color: 'var(--donate)', border: '1px solid rgba(107, 140, 107, 0.25)', borderRadius: 12, padding: '3px 8px', fontWeight: 500 }}>
                              ✓ Saved preview board
                            </div>
                          )}
                          <button type="button" className="generated-visual-preview-btn" onClick={event => { previewReturnFocusRef.current = event.currentTarget; setPreviewImage({ src: resolveUploadImageSrc(board.imageUrl), title: board.label || 'Comparison sheet', meta: board.reason || '' }) }} aria-label="Open comparison sheet preview">
                            <img src={resolveUploadThumbnailSrc(board.imageUrl, 'chat-display')} alt={board.label || 'Comparison sheet'} className="generated-visual-image" loading="lazy" decoding="async" />
                          </button>
                          <div style={{ fontSize: 12, fontWeight: 650, marginTop: 7, color: 'var(--text)' }}>{board.label || 'Comparison sheet'}</div>
                          
                          {board.reason && (
                            <details className="rationale-details" style={{ marginTop: 4 }}>
                              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 650, color: 'var(--accent)', userSelect: 'none' }}>
                                {getTeaserText(board.reason)} <span style={{ fontWeight: 'normal', color: 'var(--text-light)' }}>(more ▾)</span>
                              </summary>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                                {board.reason}
                              </div>
                            </details>
                          )}

                          {board.debug?.timings && (() => {
                            const cost = calculateOpenAICost(board.debug.timings)
                            const costStr = cost !== null ? `$${cost.toFixed(2)}` : ''
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-light)', marginTop: 4 }}>
                                {costStr && <span>Cost: {costStr}</span>}
                                <details className="telemetry-details" style={{ display: 'inline' }}>
                                  <summary style={{ cursor: 'pointer', listStyle: 'none', userSelect: 'none' }} title="Click for render details">
                                    ⓘ <span style={{ textDecoration: 'underline', marginLeft: 2 }}>Details</span>
                                  </summary>
                                  <div style={{ marginTop: 4, background: 'var(--surface-2)', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border-light)' }}>
                                    {renderTelemetryDetailBody(board.debug.timings, board.debug.renderer)}
                                  </div>
                                </details>
                              </div>
                            )
                          })()}

                          {!isSaved && (
                            <button
                              type="button"
                              onClick={() => saveGeneratedBoard({
                                key: saveKey,
                                board,
                                boardType: 'whole_wardrobe_preview_sheet',
                                messageIndex,
                                boardIndex: boardIdx,
                                contextOverride: { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
                              })}
                              style={{ fontSize: 12, color: 'var(--accent)', padding: '4px 9px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', marginTop: 7 }}
                            >
                              Save preview board
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {isIdealAdditions && (
          <div className="stylist-directions-compare-strip">
            <div className="stylist-directions-compare-title">Compare silhouettes</div>
            <div className="stylist-directions-compare-row">
              {outfits.filter(o => o.previewOnly && o.pieceId).map((compareOutfit, compareIdx) => (
                <div key={compareIdx} className="stylist-directions-compare-item">
                  {renderOutfitSketch(compareOutfit, { compact: true })}
                  <div className="stylist-directions-compare-item-title">
                    {compareOutfit.label || compareOutfit.title || `Direction ${compareIdx + 1}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {isIdealAdditions && (() => {
          const idealComparisonKey = `ideal-additions-comparison:${messageResultKey}`
          const idealComparisonBoards = boardResults[idealComparisonKey] || []
          const isGeneratingIdealComparison = boardLoadingIndex === idealComparisonKey
          return (
            <div className={`stylist-preview-action ${idealComparisonBoards.length || isGeneratingIdealComparison ? 'has-preview' : ''}`}>
              <div className="stylist-preview-action-row">
                <div className="stylist-preview-action-copy">
                  <div className="stylist-preview-action-title">Comparison preview</div>
                  <div className="stylist-preview-action-note">See all directions side by side.</div>
                </div>
                 <button
                  type="button"
                  onClick={() => generateIdealAdditionsComparisonSheet(messageResultKey, outfits)}
                  disabled={isGeneratingIdealComparison}
                  style={{ fontSize: 12, color: 'var(--accent)', padding: '5px 11px', borderRadius: 14, border: '1px solid var(--accent)', background: 'var(--surface)', cursor: isGeneratingIdealComparison ? 'default' : 'pointer', opacity: isGeneratingIdealComparison ? 0.65 : 1 }}
                >
                  {isGeneratingIdealComparison ? 'Generating preview...' : (idealComparisonBoards.length ? 'Regenerate comparison' : 'Preview all directions (~$0.07)')}
                </button>
              </div>
              {(isGeneratingIdealComparison || idealComparisonBoards.length > 0) && (
                <div className="generated-visual-grid" style={{ marginTop: 8 }}>
                  {isGeneratingIdealComparison && (
                    <div className="generated-visual-card skeleton-pulse" role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 20, border: '1px dashed var(--accent)', background: 'var(--surface-2)', borderRadius: 12 }}>
                      <div className="typing-dots" style={{ marginBottom: 12 }}><span /><span /><span /></div>
                      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, textAlign: 'center', lineHeight: 1.45 }}>
                        {imageStatusByKey[idealComparisonKey] || 'Generating rough preview...'}
                      </div>
                    </div>
                  )}
                  {idealComparisonBoards.map((board, boardIdx) => {
                    const saveKey = `ideal-additions-preview-sheet:${messageIndex}:${boardIdx}`
                    const isSaved = savedBoardKeys.has(saveKey) || (board.imageUrl && savedBoardUrls.has(board.imageUrl))
                    return (
                      <div key={boardIdx} className="generated-visual-card" style={{ position: 'relative' }}>
                        {board.error ? (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Preview error: {board.error}</div>
                        ) : (
                          <>
                            {isSaved && (
                              <div className="saved-board-badge" style={{ width: 'fit-content', marginBottom: 6, fontSize: 12, background: 'var(--donate-bg)', color: 'var(--donate)', border: '1px solid rgba(107, 140, 107, 0.25)', borderRadius: 12, padding: '3px 8px', fontWeight: 500 }}>
                                ✓ Saved preview board
                              </div>
                            )}
                            <button type="button" className="generated-visual-preview-btn" onClick={event => { previewReturnFocusRef.current = event.currentTarget; setPreviewImage({ src: resolveUploadImageSrc(board.imageUrl), title: board.label || 'Comparison sheet', meta: board.reason || '' }) }} aria-label="Open comparison sheet preview">
                              <img src={resolveUploadThumbnailSrc(board.imageUrl, 'chat-display')} alt={board.label || 'Comparison sheet'} className="generated-visual-image" loading="lazy" decoding="async" />
                            </button>
                            <div style={{ fontSize: 12, fontWeight: 650, marginTop: 7, color: 'var(--text)' }}>{board.label || 'Comparison sheet'}</div>
                            
                            {board.reason && (
                              <details className="rationale-details" style={{ marginTop: 4 }}>
                                <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 650, color: 'var(--accent)', userSelect: 'none' }}>
                                  {getTeaserText(board.reason)} <span style={{ fontWeight: 'normal', color: 'var(--text-light)' }}>(more ▾)</span>
                                </summary>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                                  {board.reason}
                                </div>
                              </details>
                            )}

                            {board.debug?.timings && (() => {
                              const cost = calculateOpenAICost(board.debug.timings)
                              const costStr = cost !== null ? `$${cost.toFixed(2)}` : ''
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-light)', marginTop: 4 }}>
                                  {costStr && <span>Cost: {costStr}</span>}
                                  <details className="telemetry-details" style={{ display: 'inline' }}>
                                    <summary style={{ cursor: 'pointer', listStyle: 'none', userSelect: 'none' }} title="Click for render details">
                                      ⓘ <span style={{ textDecoration: 'underline', marginLeft: 2 }}>Details</span>
                                    </summary>
                                    <div style={{ marginTop: 4, background: 'var(--surface-2)', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border-light)' }}>
                                      {renderTelemetryDetailBody(board.debug.timings, board.debug.renderer)}
                                    </div>
                                  </details>
                                </div>
                              )
                            })()}

                            {!isSaved && (
                              <button
                                type="button"
                                onClick={() => saveGeneratedBoard({
                                  key: saveKey,
                                  board,
                                  boardType: 'ideal_additions_preview_sheet',
                                  messageIndex,
                                  boardIndex: boardIdx,
                                  contextOverride: (() => {
                                    if (activeContext) return activeContext
                                    const targetPiece = pieces.find(p => Number(p.id) === Number(firstOutfit?.pieceId))
                                    if (targetPiece) {
                                      return { type: 'piece', id: targetPiece.id, name: targetPiece.name }
                                    }
                                    return null
                                  })()
                                })}
                                style={{ fontSize: 10, color: 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', marginTop: 7 }}
                              >
                                Save preview board
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
        {tripNotes.length > 0 && (
          <div className="stylist-overview">
            <div className="stylist-overview-title">{getPlanNotesTitle(outfits)}</div>
            {tripOverviewRows.length > 0 && (
              <div className="stylist-overview-key-rows">
                {tripOverviewRows.map(row => (
                  <div className={`stylist-overview-key-row ${row.value ? '' : 'headline'}`} key={row.label}>
                    <span>{row.label}</span>
                    {row.value && <strong>{row.value}</strong>}
                  </div>
                ))}
              </div>
            )}
            <details className="stylist-overview-details">
              <summary>View details</summary>
              <div className="stylist-overview-rows">
                {tripNotes.map((note, noteIdx) => <div key={noteIdx}>{note}</div>)}
              </div>
            </details>
          </div>
        )}
        {responseSections.map((section, sectionIndex) => (
          <section className="stylist-response-section" key={`${section.title}-${sectionIndex}`}>
            <div className="stylist-response-section-heading">
              <h3>{section.title}</h3>
              {section.countLabel && <span>{section.countLabel}</span>}
            </div>
            {section.items.map(({ outfit, idx }, sectionItemIndex) => {
          const cardDisplayTitle = getTripCardDisplayTitle(outfit, section, sectionItemIndex)
          const strength = strengthLabel(outfit.strength)
          const pieces = Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name).filter(Boolean) : []
          const boardKey = `${messageResultKey}:${idx}`
          const isPreview = Boolean(outfit.previewOnly)
          const isTextOnly = Boolean(outfit.textOnly || message?.textOnly || message?.wholeWardrobe)
          const hasRenderableOutfitPieces = (Array.isArray(outfit.pieceIds) && outfit.pieceIds.length > 0) ||
            (Array.isArray(outfit.pieces) && outfit.pieces.some(p => p?.id))
          const canRenderStructuredOutfit = isPreview
            ? (activeContext?.type === 'piece' || outfit.pieceId || outfit.selectedPieceId)
            : !message?.wholeWardrobe && !message?.wardrobeEvaluation && hasRenderableOutfitPieces
          const hasRendered = Boolean(boardResults[boardKey]?.length)
          const isRendering = boardLoadingIndex === boardKey
          const isEvaluating = boardLoadingIndex === `evaluate:${boardKey}`
          // previewOnly is shared with the unrelated single-piece "ideal directions" feature
          // (editorial-directions-preview), the only flow that anchors a card to one piece via
          // outfit.pieceId. The outfit sketch belongs only to that flow, not to any other
          // previewOnly card (e.g. a propose_outfit tool-call result also marked previewOnly).
          const showOutfitSketch = isPreview && !isTextOnly && Boolean(outfit.pieceId)
          const isTripCard = isPlannedSetSource(outfit.source)
          const isBrokenCard = Boolean(outfit.broken || outfit.diagnosticOnly)
          const isRankedCard = !isTripCard && String(outfit.strength || '').toLowerCase() === 'signature'
          const brokenReasonRows = Array.isArray(outfit.brokenPieces)
            ? outfit.brokenPieces.filter(piece => piece?.name && piece?.reason)
            : []

          const outfitTitle = outfit.label || outfit.title || `Direction ${idx + 1}`
          const historicalCritique = messages.find(msg => msg.role === 'assistant' && msg.wardrobeEvaluation && (msg.outfitName === outfitTitle || msg.outfitName === outfit.label || msg.outfitName === outfit.title))?.text
          const critiqueText = evaluationResultsByKey[boardKey] || historicalCritique
          const hasCritique = Boolean(critiqueText)
          const renderOutfitFeedbackButtons = () => (
            OUTFIT_FEEDBACK_LABELS.map(([type, label]) => {
              const key = `whole-wardrobe:${messageIndex}:${idx}:${type}`
              const isSaved = feedbackSaved.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={isSaved}
                  onClick={() => toggleStylistFeedback({
                    key,
                    feedbackType: type,
                    targetType: 'whole_wardrobe_outfit',
                    label: outfit.label || `Outfit ${idx + 1}`,
                    note: [outfit.reason, outfit.watchFor].filter(Boolean).join(' Watch: '),
                    payload: {
                      outfit,
                      messageIndex,
                      outfitIndex: idx,
                      pieceIds: outfit.pieceIds || [],
                      pieces: outfit.pieces || [],
                      formulaFamily: outfit.formulaFamily || '',
                      archetypeId: outfit.archetypeId || '',
                      occasion: wardrobeOutfitOccasion,
                      season: wardrobeOutfitSeason,
                      mood: wardrobeOutfitMood,
                      ...(message?.source === 'visual_composer' ? { source: 'visual_composer' } : {})
                    },
                    appendToPiece: activeContext?.type === 'piece'
                  })}
                  className="stylist-feedback-chip"
                >
                  {isSaved ? '✓ ' : ''}{label}
                </button>
              )
            })
          )

          return (
            <div
              key={idx}
              className={`stylist-outfit-result-card ${isBrokenCard ? 'is-broken' : ''} ${isRankedCard ? 'is-ranked' : ''}`.trim()}
            >
              <div className="stylist-outfit-result-body">
                <div className="stylist-outfit-result-heading">
                  <div className="stylist-outfit-result-title">{cardDisplayTitle}</div>
                  <div className="stylist-outfit-result-strength">{isBrokenCard ? 'needs review' : (isTripCard ? getTripCardMarker(outfit) : strength)}</div>
                </div>
                {!isBrokenCard && outfit.engineNote && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-light)', lineHeight: 1.4, fontStyle: 'italic' }}>
                    {outfit.engineNote}
                  </div>
                )}
                {isBrokenCard && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--repair)', lineHeight: 1.45 }}>
                    <div>
                      This direction didn't clear one of the engine's structural checks, so it's shown here for review rather than as a validated suggestion.
                    </div>
                    {outfit.rejectionReason && (
                      <div style={{ marginTop: 4 }}>
                        <strong>What didn't clear:</strong> {outfit.rejectionReason}
                      </div>
                    )}
                    {outfit.capsuleRepair?.slotId && outfit.capsulePlanContext && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className="stylist-inline-action"
                          disabled={repairingCardKey === `repair:${boardKey}`}
                          onClick={() => repairCapsuleLook(outfit, messageIndex, `repair:${boardKey}`)}
                        >
                          {repairingCardKey === `repair:${boardKey}` ? 'Fixing…' : 'Fix this look'}
                        </button>
                        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-light)' }}>
                          Swaps the blocked piece for another from this capsule — free, no AI call.
                        </span>
                        {repairErrorByCard[`repair:${boardKey}`] && (
                          <div style={{ marginTop: 6 }}>{repairErrorByCard[`repair:${boardKey}`]}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {isBrokenCard && STYLIST_DEBUG_ENABLED && outfit.resolutionNote && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--repair)', lineHeight: 1.4, fontStyle: 'italic' }}>
                    <strong>Dev: resolution note:</strong> {outfit.resolutionNote}
                  </div>
                )}
                {isBrokenCard && STYLIST_DEBUG_ENABLED && brokenReasonRows.length > 0 && (
                  <div style={{ marginTop: 6, display: 'grid', gap: 3, fontSize: 12, color: 'var(--repair)', lineHeight: 1.4 }}>
                    <div style={{ fontWeight: 650 }}>Dev: rejected pieces:</div>
                    {brokenReasonRows.map((piece, reasonIdx) => (
                      <div key={`${piece.id || piece.name}-${reasonIdx}`}>
                        <strong>{piece.name}:</strong> {piece.reason}
                      </div>
                    ))}
                  </div>
                )}
                {isBrokenCard && STYLIST_DEBUG_ENABLED && (() => {
                  const trace = outfit.debug || message?.debug?.visualCritic || message?.debug
                  if (!trace) return null
                  const resolvedAct = trace.resolvedActivity || 'none'
                  const actSrc = trace.activitySource || 'none'
                  const isWalk = trace.walkable ? 'true' : 'false'
                  const regCeil = trace.registerCeiling || 'none'
                  const counts = trace.rosterCounts || trace.categoryCounts || {}
                  const countsStr = Object.keys(counts).length > 0
                    ? Object.entries(counts).map(([cat, cnt]) => `${pluralizeRosterCategory(cat)}: ${cnt}`).join(' · ')
                    : 'none'
                  return (
                    <div style={{
                      marginTop: 8,
                      padding: '8px 10px',
                      background: 'rgba(168, 64, 64, 0.05)',
                      border: '1px dashed var(--repair)',
                      borderRadius: 8,
                      fontSize: 11,
                      color: 'var(--repair)',
                      lineHeight: 1.45
                    }}>
                      <div style={{ fontWeight: 650, marginBottom: 4 }}>Dev: styling engine debug trace</div>
                      <div><strong>Resolved Activity:</strong> {resolvedAct} ({actSrc})</div>
                      <div><strong>Walkable:</strong> {isWalk}</div>
                      <div><strong>Register Ceiling:</strong> {regCeil}</div>
                      <div><strong>Roster counts (survived gates):</strong> {countsStr}</div>
                    </div>
                  )
                })()}
                {showOutfitSketch && renderOutfitSketch(outfit)}
                {showOutfitSketch && buildVisualThesis(outfit) && (
                  <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, marginTop: 4, marginBottom: 2, lineHeight: 1.4 }}>
                    {buildVisualThesis(outfit)}
                  </div>
                )}
                {showOutfitSketch && outfit.visualPrompt && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, marginBottom: 2, lineHeight: 1.5 }}>
                    <strong>Full look:</strong> {outfit.visualPrompt}
                  </div>
                )}
              {((!isTripCard && (outfit.missionLabel || outfit.dominantDirection || outfit.silhouette)) || outfit.bestFor) && (
                <div className="stylist-outfit-result-meta">
                  {!isTripCard && outfit.missionLabel && <div><strong>Mission:</strong> {outfit.missionLabel}</div>}
                  {!isTripCard && outfit.dominantDirection && <div><strong>Direction:</strong> {outfit.dominantDirection}</div>}
                  {!isTripCard && outfit.silhouette && <div><strong>Silhouette:</strong> {outfit.silhouette}</div>}
                  {outfit.bestFor && <div><strong>Best for:</strong> {outfit.bestFor}</div>}
                </div>
              )}
              {/* Show missingPieces for preview directions */}
              {isPreview && Array.isArray(outfit.missingPieces) && outfit.missingPieces.length > 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 7, lineHeight: 1.45 }}>
                  <strong>Suggested additions:</strong> {outfit.missingPieces.join(' + ')}
                </div>
              )}
              {pieces.length > 0 && !(Array.isArray(outfit.pieces) && outfit.pieces.length > 0) && (
                <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 7, lineHeight: 1.45 }}>
                  <strong>Pieces:</strong> {pieces.join(' + ')}
                </div>
              )}
              {Array.isArray(outfit.pieces) && outfit.pieces.length > 0 && (
                <div
                  className="stylist-outfit-piece-list"
                  aria-label={`Pieces in ${cardDisplayTitle}`}
                >
                  {outfit.pieces.map((rawPiece, pieceIdx) => {
                    const piece = hydrateDisplayPiece(rawPiece)
                    const photo = piece?.photo || piece?.worn_photo
                    return (
                      <div key={`${piece?.id || pieceIdx}-${pieceIdx}`} title={piece?.name || 'Garment'} className="stylist-outfit-piece">
                        <button
                          type="button"
                          disabled={!photo}
                          onClick={event => { if (!photo) return; previewReturnFocusRef.current = event.currentTarget; setPreviewImage({ src: `/uploads/${photo}`, title: piece?.name || 'Garment', meta: piece?.category || '', pieceId: piece?.id || null }) }}
                          className="stylist-outfit-piece-photo"
                          style={{ cursor: photo ? 'zoom-in' : 'default' }}
                          aria-label={photo ? `Open ${piece?.name || 'garment'} preview` : undefined}
                        >
                          {photo ? (
                            <img src={resolveUploadThumbnailSrc(photo, 'chat-garment')} alt={piece?.name || 'Garment'} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-light)', textAlign: 'center', lineHeight: 1.2, padding: 4 }}>
                              <span style={{ display: 'block', color: 'var(--accent)', fontWeight: 650 }}>needs photo</span>
                              <span style={{ display: 'block', marginTop: 2 }}>{piece?.category || 'piece'}</span>
                            </span>
                          )}
                        </button>
                        <div className="stylist-outfit-piece-name">{piece?.name || 'Garment'}</div>
                        {piece?.id && !piece?.unresolved && (message?.wholeWardrobe || Array.isArray(outfit.pieces)) && (() => {
                            const swapKey = `whole-wardrobe-piece:${messageIndex}:${idx}:${piece?.id || pieceIdx}:wrong_item_read`
                            const isSwapped = feedbackSaved.has(swapKey)
                            const msgOccasion = outfit.occasion || outfit.bestFor || message.queryOptions?.occasion || wardrobeOutfitOccasion || 'casual'
                            const normMsgOccasion = String(msgOccasion || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
                            const exclusions = (piece?.occasion_exclusions || []).map(o => String(o || '').toLowerCase().replace(/[-_]+/g, ' ').trim())
                            const isExcluded = exclusions.includes(normMsgOccasion)
                            const exclusionDisplaySource = isTripCard
                              ? (outfit.label || outfit.title || outfit.bestFor || msgOccasion)
                              : msgOccasion
                            const displayOccasionName = String(exclusionDisplaySource || '').replace(/[-_]+/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                            return (
                              <PieceActionMenu label={`Actions for ${piece?.name || 'this piece'}`}>
                                {({ close }) => (<>
                                  <div className="piece-action-menu-group-label">Piece information</div>
                                  <button
                                    type="button"
                                    onClick={() => { close(); openPieceEditor(piece) }}
                                    className="piece-action-menu-item"
                                  >
                                    <PieceActionEditIcon />
                                    <span className="piece-action-menu-item-body">
                                      <span className="piece-action-menu-item-label">Edit piece details</span>
                                      <span className="piece-action-menu-item-hint">Update fabric, color, fit, or other details — future recommendations use the corrected information.</span>
                                    </span>
                                  </button>
                                  <div className="piece-action-menu-divider" />
                                  <div className="piece-action-menu-group-label">Outfit pairing</div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      close()
                                      toggleStylistFeedback({
                                        key: swapKey,
                                        feedbackType: 'wrong_item_read',
                                        targetType: 'whole_wardrobe_outfit',
                                        label: `Bad piece: ${piece?.name || 'Garment'}`,
                                        note: `${piece?.name || 'This piece'} was the bad piece choice in ${outfit.label || `outfit ${idx + 1}`}.`,
                                        payload: {
                                          outfit,
                                          messageIndex,
                                          outfitIndex: idx,
                                          pieceId: piece?.id || null,
                                          pieceName: piece?.name || '',
                                          pieceCategory: piece?.category || '',
                                          pieceIds: outfit.pieceIds || [],
                                          pieces: outfit.pieces || [],
                                          formulaFamily: outfit.formulaFamily || '',
                                          archetypeId: outfit.archetypeId || '',
                                          occasion: wardrobeOutfitOccasion,
                                          season: wardrobeOutfitSeason,
                                          mood: wardrobeOutfitMood,
                                        },
                                        contextOverride: activeContext?.type === 'piece' ? activeContext : { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
                                      })
                                    }}
                                    className={isSwapped ? 'piece-action-menu-item piece-action-menu-item-quiet-active' : 'piece-action-menu-item'}
                                  >
                                    <PieceActionSwapIcon />
                                    <span className="piece-action-menu-item-body">
                                      <span className="piece-action-menu-item-label">{isSwapped ? '✓ Replaced in this outfit' : 'Replace in this outfit'}</span>
                                      <span className="piece-action-menu-item-hint">Flags this piece as wrong for this look and steers your stylist away from choosing it as often. Everything else here stays the same.</span>
                                    </span>
                                  </button>
                                  <div className="piece-action-menu-divider" />
                                  <div className="piece-action-menu-group-label">Occasion rule</div>
                                  <button
                                    type="button"
                                    onClick={() => { close(); toggleOccasionExclusion(piece.id, msgOccasion, isExcluded) }}
                                    className={isExcluded ? 'piece-action-menu-item piece-action-menu-item-hard piece-action-menu-item-quiet-active' : 'piece-action-menu-item piece-action-menu-item-hard'}
                                  >
                                    <PieceActionRuleIcon />
                                    <span className="piece-action-menu-item-body">
                                      <span className="piece-action-menu-item-label">{isExcluded ? `✓ Wrong for ${displayOccasionName}` : `Wrong for ${displayOccasionName}`}</span>
                                      <span className="piece-action-menu-item-hint">Never suggest this piece for {displayOccasionName} again — applies everywhere, not just this card. Undo anytime in Style profile.</span>
                                    </span>
                                  </button>
                                </>)}
                              </PieceActionMenu>
                            )
                        })()}
                      </div>
                    )
                  })}
                </div>
              )}
              {outfit.reason && !isTripCard && (
                <details className="stylist-outfit-reason">
                  <summary>
                    Why this outfit
                  </summary>
                  <div className="stylist-outfit-reason-body">
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {isBrokenCard && !STYLIST_DEBUG_ENABLED ? stripEngineRejectionSuffix(outfit.reason) : outfit.reason}
                    </div>
                    {outfit.watchFor && !/^none$/i.test(String(outfit.watchFor).trim()) && (!isBrokenCard || STYLIST_DEBUG_ENABLED) && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 6 }}>
                        <strong>Watch:</strong> {outfit.watchFor}
                      </div>
                    )}
                    {Array.isArray(outfit.systemFlags) && outfit.systemFlags.length > 0 && (!isBrokenCard || STYLIST_DEBUG_ENABLED) && (
                      <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                        {outfit.systemFlags.map((flag, flagIndex) => (
                          <div key={`${flag.type || 'note'}-${flagIndex}`} style={{ fontSize: 12, color: 'var(--text-light)', lineHeight: 1.4 }}>
                            <strong>{flag.type || 'Note'}:</strong> {flag.message}
                          </div>
                        ))}
                      </div>
                    )}
                    {outfit.systemSuggestion?.message && (
                      <div style={{ fontSize: 12, color: 'var(--text-light)', lineHeight: 1.4, marginTop: 6 }}>
                        <strong>System suggests:</strong> {outfit.systemSuggestion.message}
                      </div>
                    )}
                    {STYLIST_DEBUG_ENABLED && (() => {
                      const trace = outfit.debug || message?.debug?.visualCritic || message?.debug
                      if (!trace) return null
                      const resolvedAct = trace.resolvedActivity || 'none'
                      const actSrc = trace.activitySource || 'none'
                      const isWalk = trace.walkable ? 'true' : 'false'
                      const regCeil = trace.registerCeiling || 'none'
                      const counts = trace.rosterCounts || trace.categoryCounts || {}
                      const countsStr = Object.keys(counts).length > 0
                        ? Object.entries(counts).map(([cat, cnt]) => `${pluralizeRosterCategory(cat)}: ${cnt}`).join(', ')
                        : 'none'
                      return (
                        <div style={{
                          marginTop: 8,
                          paddingTop: 6,
                          borderTop: '1px dashed var(--border-light)',
                          fontSize: 12,
                          color: 'var(--text-light)',
                          display: 'grid',
                          gap: 3,
                          lineHeight: 1.45
                        }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Dev: styling engine trace</div>
                          <div>Activity: {resolvedAct} ({actSrc}) · Walkable: {isWalk} · Ceiling: {regCeil}</div>
                          <div>Roster: {countsStr}</div>
                        </div>
                      )
                    })()}
                  </div>
                </details>
              )}

              {isEvaluating && (
                <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--accent)', marginTop: 8 }}>
                  <span className="typing-dots"><span /><span /></span>
                  <span>Evaluating this outfit...</span>
                </div>
              )}
              {hasCritique && (
                <details defaultOpen={true} style={{ width: '100%', marginTop: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 650, color: 'var(--accent)', fontSize: 12, userSelect: 'none' }}>
                    🔍 View Outfit Critique
                  </summary>
                  <div style={{ marginTop: 6, borderTop: '1px solid var(--border-light)', paddingTop: 6 }}>
                    <CritiqueBody text={critiqueText} />
                  </div>
                </details>
              )}

              {!canRenderStructuredOutfit && (message?.wholeWardrobe || (activeContext?.type !== 'piece' && !outfit.pieceId && Array.isArray(outfit.pieces) && outfit.pieces.length > 0)) && (
                <>
                  <div className="stylist-outfit-actions">
                    <button
                      onClick={() => generateWholeWardrobeImage(boardKey, outfit)}
                      disabled={isRendering}
                      style={{ fontSize: 12, color: 'var(--accent)', padding: '4px 9px', borderRadius: 10, border: '1px solid var(--accent)', background: 'var(--surface)', cursor: isRendering ? 'default' : 'pointer', opacity: isRendering ? 0.65 : 1 }}
                    >
                      {isRendering ? 'Generating image...' : (hasRendered ? 'Regenerate outfit image' : 'Generate outfit image')}
                    </button>
                    <button
                      onClick={() => evaluateWholeWardrobeOutfit(boardKey, outfit)}
                      disabled={isEvaluating}
                      style={{ fontSize: 12, color: (evaluatedKeys.has(boardKey) || hasCritique) ? 'var(--donate)' : 'var(--text-muted)', padding: '4px 9px', borderRadius: 10, border: '1px solid var(--border)', background: (evaluatedKeys.has(boardKey) || hasCritique) ? 'var(--surface-2)' : 'var(--surface)', cursor: isEvaluating ? 'default' : 'pointer' }}
                    >
                      {isEvaluating ? 'Evaluating...' : ((evaluatedKeys.has(boardKey) || hasCritique) ? '✓ Evaluated' : 'Evaluate outfit')}
                    </button>
                    {renderOutfitFeedbackButtons()}
                  </div>
                </>
              )}

              {canRenderStructuredOutfit && (
                <>
                  <div className="stylist-outfit-actions">
                    {isPreview ? (
                      // Preview mode: render this single direction on demand
                      <button
                        onClick={() => renderOneEditorialDirection(outfit, messageIndex, idx)}
                        disabled={isRendering}
                        style={{
                          fontSize: 12, color: 'var(--accent)',
                          padding: '3px 9px', borderRadius: 12,
                          border: '1px solid var(--accent)',
                          background: 'var(--surface)',
                          cursor: isRendering ? 'default' : 'pointer',
                          opacity: isRendering ? 0.65 : 1,
                        }}
                      >
                        {isRendering ? 'Rendering…' : hasRendered ? 'Regenerate outfit image (~$0.07)' : 'Generate outfit image (~$0.07)'}
                      </button>
                    ) : (
                      // Wardrobe-board generation button (original mode)
                      <>
                        <button
                          onClick={() => generateWholeWardrobeImage(boardKey, outfit, { occasion: generateOccasion, season: generateSeason })}
                          disabled={isRendering}
                          style={{
                            fontSize: 12, color: 'var(--accent)', padding: '3px 9px', borderRadius: 12,
                            border: '1px solid var(--accent)', background: 'var(--surface)',
                            cursor: isRendering ? 'default' : 'pointer', opacity: isRendering ? 0.65 : 1,
                          }}
                        >
                          {isRendering ? 'Rendering this outfit…' : (hasRendered ? 'Regenerate outfit image' : 'Generate outfit image')}
                        </button>
                        <button
                          onClick={() => evaluateWholeWardrobeOutfit(boardKey, outfit)}
                          disabled={isEvaluating}
                          style={{
                            fontSize: 12, color: (evaluatedKeys.has(boardKey) || hasCritique) ? 'var(--donate)' : 'var(--text-muted)', padding: '3px 9px', borderRadius: 12,
                            border: '1px solid var(--border)', background: (evaluatedKeys.has(boardKey) || hasCritique) ? 'var(--surface-2)' : 'var(--surface)',
                            cursor: isEvaluating ? 'default' : 'pointer', opacity: isEvaluating ? 0.65 : 1,
                          }}
                        >
                          {isEvaluating ? 'Evaluating...' : ((evaluatedKeys.has(boardKey) || hasCritique) ? '✓ Evaluated' : 'Evaluate outfit')}
                        </button>
                      </>
                    )}
                    {!isPreview && renderOutfitFeedbackButtons()}
                  </div>
                </>
              )}

              {/* Rendered image for this direction */}
              {(isRendering || hasRendered) && (
                <div className="generated-visual-grid" style={{ marginTop: 10 }}>
                  {isRendering && (
                    <div className="generated-visual-card skeleton-pulse" role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 20, border: '1px dashed var(--accent)', background: 'var(--surface-2)', borderRadius: 12 }}>
                      <div className="typing-dots" style={{ marginBottom: 12 }}><span /><span /><span /></div>
                      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, textAlign: 'center', lineHeight: 1.4 }}>
                        {imageStatusByKey[boardKey] || 'Rendering outfit image...'}
                      </div>
                    </div>
                  )}
                  {hasRendered && boardResults[boardKey].map((board, boardIdx) => {
                    const saveKey = message?.wholeWardrobe ? `whole-wardrobe-board:${messageIndex}:${idx}:${boardIdx}` : `editorial-board:${messageIndex}:${idx}:${boardIdx}`
                    const isBoardSaved = savedBoardKeys.has(saveKey) || (board.imageUrl && savedBoardUrls.has(board.imageUrl))
                    return (
                      <div key={boardIdx} className="generated-visual-card" style={{ position: 'relative' }}>
                        {board.error ? (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Render error: {board.error}</div>
                        ) : (
                          <>
                            {isBoardSaved && (
                              <div className="saved-board-badge" style={{ width: 'fit-content', marginBottom: 6, fontSize: 12, background: 'var(--donate-bg)', color: 'var(--donate)', border: '1px solid rgba(107, 140, 107, 0.25)', borderRadius: 12, padding: '3px 8px', fontWeight: 500 }}>
                                ✓ Saved board
                              </div>
                            )}
                            <button type="button" className="generated-visual-preview-btn" onClick={event => { previewReturnFocusRef.current = event.currentTarget; setPreviewImage({ src: resolveUploadImageSrc(board.imageUrl), title: board.label || outfit.label || 'Generated visual', meta: board.reason || outfit.reason || '' }) }} aria-label="Open generated visual preview">
                              <img src={resolveUploadThumbnailSrc(board.imageUrl, 'chat-display')} alt={board.label} className="generated-visual-image" loading="lazy" decoding="async" />
                            </button>
                            <div style={{ fontSize: 12, fontWeight: 650, marginTop: 7, color: 'var(--text)' }}>{board.label}</div>
                            
                            {board.reason && (
                              <details className="rationale-details" style={{ marginTop: 4 }}>
                                <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 650, color: 'var(--accent)', userSelect: 'none' }}>
                                  {getTeaserText(board.reason)} <span style={{ fontWeight: 'normal', color: 'var(--text-light)' }}>(more ▾)</span>
                                </summary>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                                  {board.reason}
                                </div>
                              </details>
                            )}

                            {board.debug?.timings && (() => {
                              const cost = calculateOpenAICost(board.debug.timings)
                              const costStr = cost !== null ? `$${cost.toFixed(2)}` : ''
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-light)', marginTop: 4 }}>
                                  {costStr && <span>Cost: {costStr}</span>}
                                  <details className="telemetry-details" style={{ display: 'inline' }}>
                                    <summary style={{ cursor: 'pointer', listStyle: 'none', userSelect: 'none' }} title="Click for render details">
                                      ⓘ <span style={{ textDecoration: 'underline', marginLeft: 2 }}>Details</span>
                                    </summary>
                                    <div style={{ marginTop: 4, background: 'var(--surface-2)', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border-light)' }}>
                                      {renderTelemetryDetailBody(board.debug.timings, board.debug.renderer)}
                                    </div>
                                  </details>
                                </div>
                              )
                            })()}

                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7, flexDirection: 'column', alignItems: 'flex-start' }}>
                              {!isPreview && activeContext?.type === 'piece' && (() => {
                                const idealKey = `ideal:${messageIndex}:${idx}:${boardIdx}`
                                const isExploring = boardLoadingIndex === idealKey
                                return (
                                  <button
                                    onClick={() => exploreIdealAdditionsFromBoard({ board, outfit, messageIndex, outfitIndex: idx, boardIndex: boardIdx })}
                                    disabled={isExploring}
                                    style={{ fontSize: 12, color: 'var(--accent)', padding: '4px 9px', borderRadius: 10, border: '1px solid var(--accent)', background: 'var(--surface)', cursor: isExploring ? 'default' : 'pointer', opacity: isExploring ? 0.65 : 1, marginBottom: 4 }}
                                  >
                                    {isExploring ? 'Exploring...' : 'Explore ideal additions'}
                                  </button>
                                )
                              })()}
                              
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', width: '100%', alignItems: 'center' }}>
                                {!isBoardSaved && (
                                  <button
                                    onClick={() => saveGeneratedBoard({
                                      key: saveKey,
                                      board,
                                      boardType: message?.wholeWardrobe ? 'whole_wardrobe_board' : 'editorial_direction',
                                      messageIndex,
                                      boardIndex: idx,
                                      contextOverride: message?.wholeWardrobe 
                                        ? { type: 'wardrobe', id: null, name: 'Whole wardrobe' } 
                                        : (() => {
                                            if (activeContext) return activeContext
                                            const targetPiece = pieces.find(p => Number(p.id) === Number(outfit.pieceId))
                                            if (targetPiece) {
                                              return { type: 'piece', id: targetPiece.id, name: targetPiece.name }
                                            }
                                            return null
                                          })()
                                    })}
                                    style={{ fontSize: 12, color: 'var(--accent)', padding: '4px 9px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
                                  >
                                    Save board
                                  </button>
                                )}

                                {(() => {
                                  const primaryTypes = ['signature', 'works', 'almost', 'not_me']
                                  const primaryLabels = GENERATED_BOARD_FEEDBACK_LABELS.filter(([type, , reason]) => primaryTypes.includes(type) && !reason)
                                  const diagnosticLabels = GENERATED_BOARD_FEEDBACK_LABELS.filter(([type, , reason]) => !primaryTypes.includes(type) || reason)
                                  const diagnosticGroups = [
                                    ['What feels wrong?', diagnosticLabels.filter(([type]) => type === 'style_direction')],
                                    ['Fit and shape', diagnosticLabels.filter(([type]) => type === 'shape_balance')],
                                    ['Problems in the generated image', diagnosticLabels.filter(([type]) => IMAGE_FIDELITY_FEEDBACK_LABELS.some(([value]) => value === type))],
                                  ]

                                  const isBoardSavedToCanon = Boolean(canonicalBoardFor(board))

                                  const hasActiveDiagnostic = diagnosticLabels.some(([type, , reason]) => {
                                    const key = `editorial-idea-board:${messageIndex}:${idx}:${boardIdx}:${type}${reason ? `:${reason}` : ''}`
                                    return (boardFeedbackActive(board, type, reason) ?? feedbackSaved.has(key))
                                  })

                                  const cardKey = `board-card:${messageIndex}:${idx}:${boardIdx}`
                                  const isExpanded = !collapsedFeedbackCards.has(cardKey) && (hasActiveDiagnostic || expandedFeedbackCards.has(cardKey))

                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                                      <div className="stylist-feedback-row">
                                        {primaryLabels.map(([type, label]) => {
                                          const verdictBaseKey = `editorial-idea-board:${messageIndex}:${idx}:${boardIdx}`
                                          const key = `${verdictBaseKey}:${type}`
                                          const isSaved = boardFeedbackActive(board, type) ?? feedbackSaved.has(key)
                                          return (
                                            <button key={key}
                                              onClick={() => isBoardSavedToCanon ? toggleCanonicalBoardVerdict(board, type) : selectGeneratedBoardVerdict({
                                                key,
                                                feedbackType: type,
                                                targetType: 'generated_visual_board',
                                                label: `${board.label || outfit.title || label}`,
                                                note: board.reason || outfit.reason || '',
                                                payload: { board, outfit, messageIndex, outfitIndex: idx, boardIndex: boardIdx },
                                                appendToPiece: false,
                                                contextOverride: (() => {
                                                  if (message?.wholeWardrobe || board?.wholeWardrobe || outfit?.wholeWardrobe) {
                                                    return { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
                                                  }
                                                  if (activeContext) return activeContext
                                                  const targetPiece = pieces.find(p => Number(p.id) === Number(outfit.pieceId))
                                                  if (targetPiece) {
                                                    return { type: 'piece', id: targetPiece.id, name: targetPiece.name }
                                                  }
                                                  return null
                                                })()
                                              }, verdictBaseKey)}
                                              type="button"
                                              aria-pressed={isSaved}
                                              className="stylist-feedback-chip"
                                            >
                                              {isSaved ? '✓ ' : ''}{label}
                                            </button>
                                          )
                                        })}

                                        <button
                                          type="button"
                                          onClick={() => toggleFeedbackCardExpansion(cardKey, isExpanded)}
                                          aria-expanded={isExpanded}
                                          className="stylist-feedback-chip is-quiet"
                                        >
                                          {isExpanded ? 'Less feedback ▴' : 'More feedback ▾'}
                                        </button>
                                      </div>

                                      {isExpanded && (
                                        <div className="stylist-feedback-disclosure">
                                          {diagnosticGroups.map(([groupTitle, entries]) => <div key={groupTitle}>
                                            <div className="stylist-feedback-group-title">{groupTitle}</div>
                                            <div className="stylist-feedback-row">
                                          {entries.map(([type, label, reason]) => {
                                            const key = `editorial-idea-board:${messageIndex}:${idx}:${boardIdx}:${type}${reason ? `:${reason}` : ''}`
                                            const isSaved = boardFeedbackActive(board, type, reason) ?? feedbackSaved.has(key)
                                            return (
                                              <button key={key}
                                                onClick={() => isBoardSavedToCanon
                                                  ? (reason ? toggleCanonicalBoardReason(board, type, reason) : toggleCanonicalBoardLabel(board, type))
                                                  : toggleStylistFeedback({
                                                  key,
                                                  feedbackType: type,
                                                  targetType: 'generated_visual_board',
                                                  label: `${board.label || outfit.title || label}`,
                                                  note: board.reason || outfit.reason || '',
                                                  payload: { board, outfit, messageIndex, outfitIndex: idx, boardIndex: boardIdx, feedback_reason: reason || null },
                                                  appendToPiece: false,
                                                  contextOverride: (() => {
                                                    if (message?.wholeWardrobe || board?.wholeWardrobe || outfit?.wholeWardrobe) {
                                                      return { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
                                                    }
                                                    if (activeContext) return activeContext
                                                    const targetPiece = pieces.find(p => Number(p.id) === Number(outfit.pieceId))
                                                    if (targetPiece) {
                                                      return { type: 'piece', id: targetPiece.id, name: targetPiece.name }
                                                    }
                                                    return null
                                                  })()
                                                })}
                                                type="button"
                                                aria-pressed={isSaved}
                                                className="stylist-feedback-chip"
                                              >
                                                {isSaved ? '✓ ' : ''}{label}
                                              </button>
                                            )
                                          })}
                                            </div>
                                          </div>)}
                                          {(boardFeedbackActive(board, 'wrong_length') ?? feedbackSaved.has(`editorial-idea-board:${messageIndex}:${idx}:${boardIdx}:wrong_length`)) && (
                                            <GeneratedBoardLengthFeedback
                                              board={board}
                                              baseKey={`editorial-idea-board:${messageIndex}:${idx}:${boardIdx}`}
                                              feedbackSaved={feedbackSaved}
                                              toggleFeedback={toggleStylistFeedback}
                                              label={board.label || outfit.title || 'Generated outfit'}
                                              note={board.reason || outfit.reason || ''}
                                              payload={{ board, outfit, messageIndex, outfitIndex: idx, boardIndex: boardIdx }}
                                              contextOverride={message?.wholeWardrobe || board?.wholeWardrobe || outfit?.wholeWardrobe
                                                ? { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
                                                : (activeContext || null)}
                                              canonicalCorrections={boardWrongLengthCorrections(board)}
                                              onToggleCanonical={isBoardSavedToCanon ? (pieceId, pieceName, issue) => toggleCanonicalWrongLength(board, pieceId, pieceName, issue) : null}
                                            />
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })()}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              </div>
            </div>
          )
            })}
          </section>
        ))}
        {hasDeferredOutfits && (
          <button
            type="button"
            className="stylist-history-reveal"
            onClick={() => setCollapsedStructuredResults(previous => {
              const next = new Set(previous)
              next.delete(messageIndex)
              return next
            })}
          >
            Show {allOutfits.length - INITIAL_SAVED_OUTFIT_COUNT} more outfit {allOutfits.length - INITIAL_SAVED_OUTFIT_COUNT === 1 ? 'result' : 'results'}
          </button>
        )}
      </div>
    )
  }

  const feedbackBucketKey = (targetType, payload = {}) => {
    if (!payload || !Number.isInteger(payload.messageIndex) || !Number.isInteger(payload.boardIndex)) return null
    if (['generated_visual_board', 'board', 'renderer_calibration'].includes(targetType)) return `${targetType}:${payload.messageIndex}:${payload.boardIndex}`
    return null
  }

  const feedbackLearningCopy = (feedbackType) => {
    const copy = {
      signature: 'Learning saved: boosting this as a signature direction.',
      works: 'Learning saved: boosting similar outfit logic.',
      good_formula: 'Learning saved: boosting this formula without overcommitting to every exact piece.',
      good_pieces: 'Learning saved: these pieces look promising together.',
      almost: 'Learning saved: treating this as close but not fully solved.',
      not_me: 'Learning saved: reducing this direction for future suggestions.',
      bad_occasion: 'Learning saved: reducing this formula for this occasion.',
      fit_issue: 'Learning saved: treating this as a fit-risk combination.',
      too_safe: 'Learning saved: reducing safe/over-balanced styling.',
      too_boho: 'Learning saved: reducing costume/festival stereotype drift, not bohemian or folk-artisan style itself.',
      too_generic: 'Learning saved: reducing generic outfit logic.',
      too_soft: 'Learning saved: reducing excessive softness.',
      wrong_proportions: 'Learning saved: avoiding this proportion behavior.',
      wrong_silhouette: 'Learning saved: avoiding this silhouette behavior.',
      catalog_drift: 'Learning saved: reducing catalog/mature-casual drift.',
      weak_structure: 'Learning saved: requiring stronger structure next time.',
      weak_contrast: 'Learning saved: requiring clearer contrast/tension next time.',
      bad_grounding: 'Learning saved: improving shoe/grounding logic next time.',
      bad_reference: 'Learning saved: using this as a negative reference.',
      style_direction: 'Learning saved: correcting this part of the outfit’s overall feel.',
      shape_balance: 'Learning saved: correcting this fit or shape issue.',
      wrong_garment_details: 'Rendering correction saved: preserve the garment details.',
      body_proportions_drift: 'Rendering correction saved: preserve body proportions.',
      identity_drift: 'Rendering correction saved: preserve identity and resemblance.',
      wrong_length: 'Rendering correction saved: preserve garment length.',
    }
    return copy[feedbackType] || 'Learning saved.'
  }

  // Once a board is saved to Visual Lab, saved_boards.payload is the canonical feedback
  // record — Visual Lab writes there directly and reads it live. Chat used to read only its
  // own frozen per-thread snapshot (feedbackSaved), which never noticed edits made in Visual
  // Lab. These helpers branch reads/writes through the canonical record for any board present
  // in savedBoardsByUrl, falling back to the local snapshot for boards never saved.
  const canonicalBoardFor = (board) => (board?.imageUrl ? savedBoardsByUrl[board.imageUrl] : null)

  const boardFeedbackActive = (board, feedbackType, reason = null) => {
    const canonical = canonicalBoardFor(board)
    if (!canonical) return null
    const labels = Array.isArray(canonical.payload?.feedback_labels) ? canonical.payload.feedback_labels : []
    if (!reason) return labels.includes(feedbackType)
    const details = canonical.payload?.feedback_details || {}
    const list = Array.isArray(details[feedbackType]) ? details[feedbackType] : []
    return list.includes(reason)
  }

  const boardWrongLengthCorrections = (board) => {
    const canonical = canonicalBoardFor(board)
    const corrections = canonical?.payload?.feedback_details?.wrong_length
    return Array.isArray(corrections) ? corrections : null
  }

  const patchCanonicalBoard = async (board, patch) => {
    const canonical = canonicalBoardFor(board)
    if (!canonical) return false
    try {
      const res = await fetch(`/api/saved-boards/${canonical.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) return false
      await refreshSavedBoards()
      return true
    } catch (err) {
      console.error('Failed to update saved board feedback:', err)
      return false
    }
  }

  const toggleCanonicalBoardVerdict = async (board, type) => {
    const canonical = canonicalBoardFor(board)
    const current = Array.isArray(canonical.payload?.feedback_labels) ? canonical.payload.feedback_labels : []
    const verdictValues = new Set(OVERALL_VERDICT_LABELS.map(([value]) => value))
    const isActive = current.includes(type)
    const next = current.filter(value => !verdictValues.has(value))
    if (!isActive) next.push(type)
    await patchCanonicalBoard(board, { feedbackLabels: next })
  }

  const toggleCanonicalBoardLabel = async (board, label) => {
    const canonical = canonicalBoardFor(board)
    const current = Array.isArray(canonical.payload?.feedback_labels) ? canonical.payload.feedback_labels : []
    const next = current.includes(label) ? current.filter(value => value !== label) : [...current, label]
    await patchCanonicalBoard(board, { feedbackLabels: next })
  }

  const toggleCanonicalBoardReason = async (board, category, reason) => {
    const canonical = canonicalBoardFor(board)
    const details = canonical.payload?.feedback_details || {}
    const current = Array.isArray(details[category]) ? details[category] : []
    const next = current.includes(reason) ? current.filter(value => value !== reason) : [...current, reason]
    const labels = Array.isArray(canonical.payload?.feedback_labels) ? canonical.payload.feedback_labels : []
    const nextLabels = next.length ? (labels.includes(category) ? labels : [...labels, category]) : labels.filter(value => value !== category)
    await patchCanonicalBoard(board, { feedbackLabels: nextLabels, feedbackDetails: { ...details, [category]: next } })
  }

  const toggleCanonicalWrongLength = async (board, pieceId, pieceName, issue) => {
    const canonical = canonicalBoardFor(board)
    const details = canonical.payload?.feedback_details || {}
    const current = Array.isArray(details.wrong_length) ? details.wrong_length : []
    const exists = current.some(correction => Number(correction?.piece_id) === Number(pieceId) && correction?.issue === issue)
    const next = exists
      ? current.filter(correction => !(Number(correction?.piece_id) === Number(pieceId) && correction?.issue === issue))
      : [...current, { piece_id: Number(pieceId), piece_name: pieceName, issue }]
    const labels = Array.isArray(canonical.payload?.feedback_labels) ? canonical.payload.feedback_labels : []
    await patchCanonicalBoard(board, { feedbackLabels: labels.includes('wrong_length') ? labels : [...labels, 'wrong_length'], feedbackDetails: { ...details, wrong_length: next } })
  }

  const saveStylistFeedback = async ({ key, feedbackType, targetType = 'message', label = '', note = '', payload = {}, appendToPiece = false, contextOverride = null }) => {
    const context = contextOverride || activeContext || { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
    const feedbackPayload = { ...payload, threadId: payload.threadId || (currentThreadId !== 'new_chat' ? currentThreadId : null) }
    const res = await fetch('/api/stylist-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackType, targetType, contextType: context.type, contextId: context.id, contextName: context.name, label, note, payload: feedbackPayload, appendToPiece })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Could not save feedback')
    setFeedbackSaved(prev => new Set([...prev, key]))
    if (data.id) setFeedbackIdsByKey(prev => ({ ...prev, [key]: data.id }))
    const bucket = feedbackBucketKey(targetType, feedbackPayload)
    if (bucket) {
      setBoardFeedbackLabels(prev => { const existing = Array.isArray(prev[bucket]) ? prev[bucket] : []; return { ...prev, [bucket]: [...new Set([...existing, feedbackType])] } })
      setBoardLearningStatus(prev => ({ ...prev, [bucket]: data.learningMessage || feedbackLearningCopy(feedbackType) }))
    }
  }

  const toggleStylistFeedback = async (args) => {
    if (feedbackSaved.has(args.key)) {
      const id = feedbackIdsByKey[args.key]
      if (id) await fetch(`/api/stylist-feedback/${id}`, { method: 'DELETE' })
      setFeedbackSaved(prev => {
        const next = new Set(prev)
        next.delete(args.key)
        return next
      })
      setFeedbackIdsByKey(prev => {
        const next = { ...prev }
        delete next[args.key]
        return next
      })
      // Mirrors saveStylistFeedback's own add-side write below — until this fix, nothing ever
      // removed a type from here, so an unsaved board's chip (no `saved_boards` row to read
      // live from, so `canonicalBoardFor` is null and `boardFeedbackActive` falls back to this
      // per-thread snapshot) would show active again on the thread's next load even after the
      // underlying stylist_feedback row was deleted — from here, or from Style Profile's Remove.
      const bucket = feedbackBucketKey(args.targetType, args.payload)
      if (bucket) {
        setBoardFeedbackLabels(prev => {
          const existing = Array.isArray(prev[bucket]) ? prev[bucket] : []
          if (!existing.includes(args.feedbackType)) return prev
          return { ...prev, [bucket]: existing.filter(type => type !== args.feedbackType) }
        })
      }
      return
    }
    await saveStylistFeedback(args)
  }

  const selectGeneratedBoardVerdict = async (args, baseKey) => {
    const verdictKeys = OVERALL_VERDICT_LABELS.map(([type]) => `${baseKey}:${type}`)
    const wasSelected = feedbackSaved.has(args.key)
    await Promise.all(verdictKeys.map(async key => {
      const id = feedbackIdsByKey[key]
      if (id) await fetch(`/api/stylist-feedback/${id}`, { method: 'DELETE' })
    }))
    setFeedbackSaved(prev => {
      const next = new Set(prev)
      verdictKeys.forEach(key => next.delete(key))
      return next
    })
    setFeedbackIdsByKey(prev => {
      const next = { ...prev }
      verdictKeys.forEach(key => delete next[key])
      return next
    })
    if (!wasSelected) await saveStylistFeedback(args)
  }

  const toggleOccasionExclusion = async (pieceId, occasion, currentlyExcluded) => {
    try {
      const res = await fetch(`/api/pieces/${pieceId}/occasion-exclusion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occasion, excluded: !currentlyExcluded })
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to toggle occasion exclusion')
      }
      const updatedPiece = await res.json()
      setPieces(prev => prev.map(p => Number(p.id) === Number(pieceId) ? updatedPiece : p))
      if (!currentlyExcluded) {
        triggerToast(`won't appear for ${occasion} again`)
      } else {
        triggerToast('restored')
      }
    } catch (err) {
      console.error(err)
      triggerToast('Error updating occasion exclusion')
    }
  }

  const saveGeneratedBoard = async ({ key, board, boardType = 'wardrobe', messageIndex = null, boardIndex = null, contextOverride = null }) => {
    const context = contextOverride || activeContext || { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
    if (!board || !board.imageUrl) return
    const res = await fetch('/api/saved-boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardType, contextType: context.type, contextId: context.id, contextName: context.name, title: board.label || board.title || 'Saved board', imageUrl: board.imageUrl, pieces: board.pieces || [], missingPieces: board.missingPieces || [], reason: board.reason || '', watchFor: board.watchFor || '', payload: { board, messageIndex, boardIndex, threadId: currentThreadId } })
    })
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Could not save board') }
    setSavedBoardKeys(prev => new Set([...prev, key]))
    setSavedBoardUrls(prev => new Set([...prev, board.imageUrl]))
    await refreshSavedBoards()
  }

  const generateVisualBoards = async (resultKey, conceptText, structuredOverride = null, pieceIdOverride = null, sourceMessageIndex = null) => {
    const pieceId = pieceIdOverride || (activeContext?.type === 'piece' ? activeContext.id : null)
    if (!pieceId) return
    const messageForFallback = Number.isInteger(sourceMessageIndex) ? messages[sourceMessageIndex] : messages[resultKey]
    setBoardLoadingIndex(resultKey)
    try {
      const res = await fetch('/api/ai/generate-outfit-boards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pieceId, conceptsText: conceptText, structuredOutfits: structuredOverride || messageForFallback?.structuredOutfits || null, occasion: generateOccasion, season: generateSeason })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate boards')
      setBoardResults(prev => ({ ...prev, [resultKey]: data.boards || [] }))
    } catch (err) {
      setBoardResults(prev => ({ ...prev, [resultKey]: [{ error: friendlyBoardErrorMessage(err.message) }] }))
    } finally { setBoardLoadingIndex(null) }
  }

  const generateWholeWardrobeImage = async (resultKey, outfit, options = {}) => {
    const ids = Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
      ? outfit.pieceIds
      : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(p => p?.id).filter(Boolean) : [])
    if (!ids.length) return
    let statusTimers = []
    const clearImageTimers = () => {
      statusTimers.forEach(clearTimeout)
      statusTimers = []
    }
    setBoardLoadingIndex(resultKey)
    setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Loading garment reference photos...' }))
    statusTimers = [
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Sending the outfit pieces to the image model...' })), 4000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Rendering the outfit image. This can take a minute.' })), 14000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Still rendering. Image generation is the slow step.' })), 45000),
    ]
    try {
      const res = await fetch('/api/ai/generate-wardrobe-outfit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outfit,
          pieceIds: ids,
          occasion: options.occasion || wardrobeOutfitOccasion,
          season: options.season || wardrobeOutfitSeason,
          renderMode: options.renderMode || 'ai'
        })
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        throw new Error(text.startsWith('<!DOCTYPE')
          ? 'Image route returned HTML instead of JSON. Restart the backend/dev server so the new /api/ai/generate-wardrobe-outfit-image route is loaded.'
          : `Image route returned ${contentType || 'non-JSON'} response.`)
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate outfit image')
      setBoardResults(prev => ({ ...prev, [resultKey]: [data.board || data] }))
    } catch (err) {
      setBoardResults(prev => ({ ...prev, [resultKey]: [{ error: friendlyBoardErrorMessage(err.message) }] }))
    } finally {
      clearImageTimers()
      setImageStatusByKey(prev => {
        const next = { ...prev }
        delete next[resultKey]
        return next
      })
      setBoardLoadingIndex(null)
    }
  }

  const generateWholeWardrobeComparisonSheet = async (messageResultKey, outfits = []) => {
    const visibleOutfits = outfits.slice(0, 5)
    if (visibleOutfits.length < 2) return
    const resultKey = `whole-wardrobe-comparison:${messageResultKey}`
    let statusTimers = []
    const clearImageTimers = () => {
      statusTimers.forEach(clearTimeout)
      statusTimers = []
    }
    setBoardLoadingIndex(resultKey)
    setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Loading garment reference photos...' }))
    statusTimers = [
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Sending visible outfit cards to the image model...' })), 4000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Rendering one rough comparison image. This can take a minute.' })), 14000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Still rendering the preview sheet...' })), 45000),
    ]
    try {
      const res = await fetch('/api/ai/generate-wardrobe-outfit-comparison-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outfits: visibleOutfits,
          occasion: activeContext?.type === 'piece' ? generateOccasion : wardrobeOutfitOccasion,
          season: activeContext?.type === 'piece' ? generateSeason : wardrobeOutfitSeason
        })
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        throw new Error(text.startsWith('<!DOCTYPE')
          ? 'Image route returned HTML instead of JSON. Restart the backend/dev server so the new comparison sheet route is loaded.'
          : `Image route returned ${contentType || 'non-JSON'} response.`)
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate comparison sheet')
      setBoardResults(prev => ({ ...prev, [resultKey]: [data.board || data] }))
    } catch (err) {
      setBoardResults(prev => ({ ...prev, [resultKey]: [{ error: friendlyBoardErrorMessage(err.message) }] }))
    } finally {
      clearImageTimers()
      setImageStatusByKey(prev => {
        const next = { ...prev }
        delete next[resultKey]
        return next
      })
      setBoardLoadingIndex(null)
    }
  }

  const generateIdealAdditionsComparisonSheet = async (messageResultKey, outfits = []) => {
    if (outfits.length < 2) return
    const firstOutfit = outfits[0]
    const pieceId = firstOutfit?.pieceId || activeContext?.id
    if (!pieceId) return
    const resultKey = `ideal-additions-comparison:${messageResultKey}`
    let statusTimers = []
    const clearImageTimers = () => {
      statusTimers.forEach(clearTimeout)
      statusTimers = []
    }
    setBoardLoadingIndex(resultKey)
    setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Loading garment reference photo...' }))
    statusTimers = [
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Sending directions to the image model...' })), 4000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Rendering rough preview sheet. This can take a minute.' })), 14000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Still rendering preview sheet...' })), 45000),
    ]
    try {
      const res = await fetch('/api/ai/generate-ideal-additions-preview-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pieceId,
          directions: outfits.map(d => ({
            label: d.label || d.title || 'Ideal direction',
            additions: d.missingPieces || [],
            reason: d.reason || ''
          })),
          occasion: firstOutfit?.occasion || generateOccasion,
          season: firstOutfit?.season || generateSeason
        })
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        throw new Error(text.startsWith('<!DOCTYPE')
          ? 'Image route returned HTML instead of JSON. Restart the backend/dev server so the new route is loaded.'
          : `Image route returned ${contentType || 'non-JSON'} response.`)
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate comparison sheet')
      setBoardResults(prev => ({ ...prev, [resultKey]: [data.board || data] }))
    } catch (err) {
      setBoardResults(prev => ({ ...prev, [resultKey]: [{ error: friendlyBoardErrorMessage(err.message) }] }))
    } finally {
      clearImageTimers()
      setImageStatusByKey(prev => {
        const next = { ...prev }
        delete next[resultKey]
        return next
      })
      setBoardLoadingIndex(null)
    }
  }

  const evaluateWholeWardrobeOutfit = async (resultKey, outfit) => {
    const ids = Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
      ? outfit.pieceIds
      : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(p => p?.id).filter(Boolean) : [])
    if (!ids.length) return
    const loadingKey = `evaluate:${resultKey}`
    const outfitTitle = outfit?.label || outfit?.title || 'this outfit'

    setBoardLoadingIndex(loadingKey)

    try {
      const res = await fetch('/api/ai/evaluate-wardrobe-outfit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outfit,
          pieceIds: ids,
          occasion: wardrobeOutfitOccasion,
          season: wardrobeOutfitSeason,
          mood: wardrobeOutfitMood,
          question: 'Evaluate this generated whole-wardrobe outfit.'
        })
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        throw new Error(text.startsWith('<!DOCTYPE')
          ? 'Evaluation route returned HTML instead of JSON. Restart the backend/dev server so the new /api/ai/evaluate-wardrobe-outfit route is loaded.'
          : `Evaluation route returned ${contentType || 'non-JSON'} response.`)
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not evaluate outfit')
      const replyText = data.feedback || 'Outfit evaluation complete.'
      setEvaluationResultsByKey(prev => ({ ...prev, [resultKey]: replyText }))
      const evaluatedOutfit = { ...outfit, label: outfitTitle, title: outfitTitle, pieceIds: ids }
      setThreadMemory({
        type: 'generated_outfit',
        source: outfit?.wholeWardrobe ? 'whole_wardrobe' : 'selected_piece',
        name: outfitTitle,
        latestOutfit: evaluatedOutfit,
        latestEvaluation: data.evaluation || null,
        latestEvaluationText: compactEvaluationMemory(data.evaluation),
        latestContextText: compactGeneratedOutfitContext([evaluatedOutfit], { source: outfit?.wholeWardrobe ? 'whole_wardrobe' : 'selected_piece' }),
        stylingContext: {
          occasion: outfit?.occasion || outfit?.bestFor || wardrobeOutfitOccasion,
          season: outfit?.season || wardrobeOutfitSeason,
          mood: outfit?.mood || wardrobeOutfitMood,
          mission: outfit?.mission || wardrobeOutfitMission || 'mix',
          activity: outfit?.activity || wardrobeOutfitActivity || 'none',
        },
      })
      setEvaluatedKeys(prev => {
        const next = new Set(prev)
        next.add(resultKey)
        return next
      })
    } catch (err) {
      const errText = `Error: ${err.message}`
      setEvaluationResultsByKey(prev => ({ ...prev, [resultKey]: errText }))
    } finally {
      setBoardLoadingIndex(null)
    }
  }

  const exploreIdealAdditionsFromBoard = async ({ board, outfit, messageIndex, outfitIndex, boardIndex }) => {
    if (!activeContext || activeContext.type !== 'piece' || !board) return
    const loadingKey = `ideal:${messageIndex}:${outfitIndex}:${boardIndex}`
    const boardTitle = board.label || outfit?.label || outfit?.title || 'this wardrobe look'
    const userText = `Explore ideal additions from ${boardTitle}.`
    const historySnapshot = chatHistory

    setMessages(m => [...m, { role: 'user', text: userText, contextName: `Ideal additions from ${boardTitle}` }])
    addToHistory('user', userText)
    setBoardLoadingIndex(loadingKey)

    try {
      const res = await fetch('/api/ai/editorial-directions-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pieceId: activeContext.id,
          occasion: outfit?.occasion || generateOccasion,
          season: outfit?.season || generateSeason,
          mission: generateMission,
          mood: generateMood,
          question: `Suggest ideal new additions inspired by this rendered wardrobe look. Use the board as the taste seed, but do not limit the additions to my existing wardrobe.`,
          history: historySnapshot,
          seedLook: { board, outfit }
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate ideal additions')

      const replyText = `Here are three ideal-additions directions inspired by ${boardTitle}. Review them and click "Generate image (~$0.07)" on any you want to render.`
      const replyStructuredOutfits = (data.directions || []).map(d => ({
        ...d,
        label: d.title,
        previewOnly: true,
        pieceId: activeContext.id,
        occasion: outfit?.occasion || generateOccasion,
        season: outfit?.season || generateSeason,
        seedBoard: {
          label: board.label || '',
          reason: board.reason || '',
          pieces: board.pieces || [],
        },
      }))

      setMessages(m => [...m, { role: 'assistant', text: replyText, structuredOutfits: replyStructuredOutfits, mode: 'ideal_styling_directions' }])
      addToHistory('assistant', replyText)
    } catch (err) {
      const errText = `Error: ${err.message}`
      setMessages(m => [...m, { role: 'assistant', text: errText }])
      addToHistory('assistant', errText)
    } finally {
      setBoardLoadingIndex(null)
    }
  }

  const generateWholeWardrobeOutfits = async () => {
    if (loading) return
    const occasion = wardrobeOutfitOccasion || 'casual'
    const season = wardrobeOutfitSeason || 'current season'
    const mood = wardrobeOutfitMood.trim()
    const request = wardrobeOutfitRequest.trim()
    const mission = wardrobeOutfitMission || 'mix'
    const activity = wardrobeOutfitActivity || 'none'
    const activityLabel = activity !== 'none' ? `, ${ACTIVITY_OPTIONS.find(opt => opt[0] === activity)?.[1].toLowerCase()}` : ''
    const userText = `Use my wardrobe to create outfits for ${occasion}, ${season}${mood ? `, mood: ${mood}` : ''}${request ? `, request: ${request}` : ''}${activityLabel}${mission !== 'mix' ? `, mission: ${mission}` : ''}.`
    const resultId = createResultId('whole-wardrobe')
    // Keep the brief panel open (in its own "Generating..." state, see the primary-action
    // button below) until the reply lands, instead of closing it immediately — closing it here
    // exposed the generic empty-state landing hero for the whole request instead of a
    // contextual generating state (looked like the app had reset / lost the request).

    // Automatically spin up a dedicated thread for this wardrobe generation
    const builderParams = { occasion, activity, season, mood, request }
    const title = deriveBuilderTitle(builderParams)
    const newId = 'thread_' + Date.now()
    
    const initialPayload = {
      messages: [
        { role: 'user', text: userText, contextType: 'wardrobe' }
      ],
      chatHistory: [
        { role: 'user', content: userText }
      ],
      threadMemory: null,
      activeContext: null,
      evaluatedKeys: [],
      boardResults: {},
      editorialVisualResults: {},
      evaluationResultsByKey: {}
    }

    // Save to server
    try {
      await fetch('/api/chat-threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          title,
          user_renamed: 0,
          kind: 'builder',
          payload: initialPayload
        })
      })
    } catch (e) {
      console.error('Failed to create builder thread:', e)
    }

    const newThreadMetadata = {
      id: newId,
      title,
      user_renamed: 0,
      kind: 'builder',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 1
    }

    setThreads(prev => [newThreadMetadata, ...prev])
    setCurrentThreadId(newId)
    setMessages(initialPayload.messages)
    setChatHistory(initialPayload.chatHistory)
    setThreadMemory(null)
    setActiveContext(null)
    setEvaluatedKeys(new Set())
    setBoardResults({})
    setEditorialVisualResults({})
    setEvaluationResultsByKey({})
    setImageStatusByKey({})
    setBoardLoadingIndex(null)
    setActiveThreadMetadata(newThreadMetadata)

    try {
      localStorage.setItem('stylist_current_thread_id', newId)
    } catch (e) {}

    setRecentMemoryStatus('')
    setLoading(true)
    startStatusSequence([
      { ms: 0, text: 'Preparing wardrobe photos…' },
      { ms: 6000, text: 'The stylist is looking at your full wardrobe…' },
      { ms: 22000, text: 'Composing outfits…' },
      { ms: 40000, text: 'Still working. Sending many images takes a moment.' },
    ])

    try {
      const res = await fetch('/api/ai/generate-wardrobe-outfits-visual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occasion, season, mood, request, question: request, mission, limit: 5, activity })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate wardrobe outfits')
      const replyText = data.feedback || 'Here are the strongest wardrobe outfits I found.'
      const replyStructuredOutfits = Array.isArray(data.structuredOutfits)
        ? data.structuredOutfits.map(outfit => ({ ...outfit, textOnly: true, wholeWardrobe: true }))
        : null
      setMessages(m => [...m, {
        role: 'assistant',
        text: replyText,
        resultId,
        structuredOutfits: replyStructuredOutfits,
        wholeWardrobe: true,
        source: 'visual_composer',
        textOnly: true,
        debug: data.debug || null,
        queryOptions: { occasion, season, mood, request, mission, activity },
      }])
      setThreadMemory({
        type: 'generated_outfits',
        source: 'whole_wardrobe',
        name: 'Whole wardrobe generated outfits',
        latestContextText: compactGeneratedOutfitContext(replyStructuredOutfits, { source: 'whole_wardrobe' }),
        latestOutfits: replyStructuredOutfits,
        stylingContext: { occasion, season, mood, request, mission: mission || 'mix', activity },
      })
      refreshWholeWardrobeSessionMemory()
      addToHistory('assistant', replyText)
    } catch (err) {
      const errText = `Error: ${err.message}`
      setMessages(m => [...m, { role: 'assistant', text: errText }])
      addToHistory('assistant', errText)
    } finally {
      clearLoadingTimers()
      setLoadingStatus('')
      setLoading(false)
      setWardrobeBuilderOpen(false)
    }
  }

  const resetWholeWardrobeSessionMemory = async () => {
    if (recentMemoryResetting) return
    setRecentMemoryResetting(true)
    setRecentMemoryStatus('')
    if (recentMemoryConfirmTimeoutRef.current) clearTimeout(recentMemoryConfirmTimeoutRef.current)
    setRecentMemoryConfirmation('')

    try {
      const res = await fetch('/api/ai/whole-wardrobe-session-memory', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not reset recent outfit memory')
      setRecentMemoryItemCount(Number(data.itemCount || 0))
      setRecentMemoryConfirmation('Recently used pieces are included again.')
      recentMemoryConfirmTimeoutRef.current = setTimeout(() => setRecentMemoryConfirmation(''), 2500)
    } catch (err) {
      setRecentMemoryStatus(`Reset failed: ${err.message}`)
    } finally {
      setRecentMemoryResetting(false)
    }
  }

  const saveHomeLocation = async () => {
    if (homeLocationSaving) return
    setHomeLocationSaving(true)
    try {
      const res = await fetch('/api/settings/home-location', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeLocation: homeLocationInput.trim() })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save home location')
      setHomeLocation(data.homeLocation || '')
      closeHomeLocationPopover()
    } catch (err) {
      triggerToast(`Could not save home location: ${err.message}`)
    } finally {
      setHomeLocationSaving(false)
    }
  }

  const closeHomeLocationPopover = () => {
    setHomeLocationOpen(false)
    requestAnimationFrame(() => {
      homeLocationButtonRef.current?.focus()
    })
  }

  useEffect(() => {
    if (!homeLocationOpen) return
    const handlePointerDown = (e) => {
      if (homeLocationPopoverRef.current?.contains(e.target)) return
      if (homeLocationButtonRef.current?.contains(e.target)) return
      closeHomeLocationPopover()
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeHomeLocationPopover()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [homeLocationOpen])


  const send = async (overrides = {}) => {
    const q = (overrides.input ?? input).trim()
    const outfitToSend = overrides.outfit ?? pendingOutfit
    const pieceToSend = overrides.piece ?? pendingPiece
    const fileToSend = overrides.imageFile ?? imageFile
    const capsuleExpansionToSend = overrides.capsuleExpansion ?? pendingCapsuleExpansion
    const useCapsuleExpansion = Boolean(
      capsuleExpansionToSend?.canExpandDirectly &&
      q === capsuleExpansionToSend?.prompt &&
      !outfitToSend &&
      !pieceToSend &&
      !fileToSend
    )
    if (!q && !fileToSend) return
    if ((overrides.piece || overrides.outfit) && (pendingPiece || pendingOutfit)) {
      holdActionScrollRef.current = true
    }

    let assistantIndex = messages.length + 1
    const compareId = overrides.compareOutfitId ?? compareOutfitId
    const effectiveGenerateOutfitMode = overrides.generateOutfitMode ?? generateOutfitMode
    const effectiveEditorialVisualMode = overrides.editorialVisualMode ?? editorialVisualMode
    const effectiveIncludeMissingPieces = overrides.includeMissingPieces ?? includeMissingPieces
    const effectiveIdealOnlyMode = overrides.idealOnlyMode ?? idealOnlyMode
    const effectiveGenerateOccasion = overrides.generateOccasion ?? generateOccasion
    const effectiveGenerateSeason = overrides.generateSeason ?? generateSeason
    const effectiveGenerateMission = overrides.generateMission ?? generateMission
    const effectiveGenerateMood = overrides.generateMood ?? generateMood
    const effectiveGenerateActivity = overrides.generateActivity ?? generateActivity
    const editorialRequestPattern = /suggest ideal|ideal addition|ideal new|new pieces|completion|completions|missing-piece|missing piece|not.*wardrobe|beyond my wardrobe|ignore my wardrobe|do not use my wardrobe|don't use my wardrobe|dont use my wardrobe|selected garment only|new item/i
    const typedEditorialRequest = editorialRequestPattern.test(q)
    const shouldGenerateEditorialVisuals = Boolean(pieceToSend && (effectiveEditorialVisualMode || typedEditorialRequest))
    const shouldGenerateOutfits = Boolean(pieceToSend && effectiveGenerateOutfitMode && !shouldGenerateEditorialVisuals)
    const shouldGenerateActiveEditorialVisuals = Boolean(!pieceToSend && activeContext?.type === 'piece' && editorialRequestPattern.test(q))
    const compareOutfit = compareId ? outfits.find(o => String(o.id) === String(compareId)) : null

    let displayPrev = null
    if (outfitToSend?.photo) displayPrev = resolveUploadImageSrc(outfitToSend.photo)
    else if (pieceToSend) { const photo = pieceToSend.worn_photo || pieceToSend.photo; if (photo) displayPrev = `/uploads/${photo}` }
    else if (imagePrev) displayPrev = imagePrev

    const userContextName = compareOutfit && outfitToSend ? `${outfitToSend.name} vs ${compareOutfit.name}`
      : shouldGenerateEditorialVisuals ? `Ideal additions preview for ${pieceToSend?.name}`
      : shouldGenerateActiveEditorialVisuals ? `Ideal additions preview for ${activeContext?.name}`
      : shouldGenerateOutfits ? `${effectiveIdealOnlyMode ? 'New ideal ideas for' : effectiveIncludeMissingPieces ? 'Ideal directions for' : 'Use my wardrobe with'} ${pieceToSend?.name}`
      : (outfitToSend?.name || pieceToSend?.name)

    const userMessage = {
      role: 'user', text: q, imagePrev: displayPrev, contextName: userContextName,
      contextMode: compareOutfit && outfitToSend ? getCompareConfidenceText(outfitToSend, compareOutfit) : (outfitToSend ? `${getOutfitConfidenceMode(outfitToSend)?.label} · ${getOutfitConfidenceMode(outfitToSend)?.detail}` : ''),
      contextType: outfitToSend ? 'outfit' : (pieceToSend || shouldGenerateActiveEditorialVisuals ? 'piece' : null),
    }

    let targetThreadId = currentThreadId
    let isTransitioningNew = currentThreadId === 'new_chat'
    const forceNewFromExisting = currentThreadId !== 'new_chat' && (outfitToSend || pieceToSend) && !overrides.continueThread

    if (forceNewFromExisting) {
      isTransitioningNew = true
      
      // Flush save the old thread first before we switch away from it
      await flushSaveThread(currentThreadId, {
        messages,
        chatHistory,
        threadMemory,
        activeContext,
        evaluatedKeys,
        boardResults,
        editorialVisualResults,
        evaluationResultsByKey
      })
    }

    const nextMessages = forceNewFromExisting ? [
      { role: 'assistant', text: 'Hi! I\'m your personal stylist. I know your full wardrobe — ask me anything. You can also upload a photo of an outfit for feedback.' },
      userMessage
    ] : [...messages, userMessage]

    const nextChatHistory = forceNewFromExisting ? [
      { role: 'user', content: q || 'What do you think?' }
    ] : [...chatHistory, { role: 'user', content: q || 'What do you think?' }]

    let derivedTitle = 'Chat'
    let threadKind = 'chat'
    let targetActiveContext = activeContext

    if (outfitToSend) {
      targetActiveContext = { type: 'outfit', id: outfitToSend.id, name: outfitToSend.name || outfitToSend.title }
    } else if (pieceToSend) {
      targetActiveContext = { type: 'piece', id: pieceToSend.id, name: pieceToSend.name }
    }

    if (isTransitioningNew) {
      assistantIndex = 2
      targetThreadId = 'thread_' + Date.now()
      
      // Derive title and kind
      if (outfitToSend) {
        threadKind = 'outfit_critique'
        const outfitName = outfitToSend.name || outfitToSend.title
        const sessionKind = outfitToSend.imageGenerationMode ?
          (outfitToSend.variantMode === 'creative' ? 'creative' : 'similar') :
          'critique'
        derivedTitle = `${outfitName} · ${sessionKind === 'similar' ? 'Similar' : sessionKind === 'creative' ? 'Creative' : 'Critique'}`
      } else if (pieceToSend) {
        threadKind = 'piece'
        const pieceName = pieceToSend.name
        const pieceMode = shouldGenerateEditorialVisuals ? 'Ideal additions' :
                          effectiveIdealOnlyMode ? 'New ideal ideas' :
                          effectiveIncludeMissingPieces ? 'Ideal directions' :
                          'Outfits'
        derivedTitle = `${pieceName} · ${pieceMode}`
      } else {
        threadKind = 'chat'
        derivedTitle = q.slice(0, 48) + (q.length > 48 ? '...' : '')
      }

      // Add to threads list immediately
      const newMetadata = {
        id: targetThreadId,
        title: derivedTitle,
        user_renamed: 0,
        kind: threadKind,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 1
      }
      setThreads(prev => [newMetadata, ...prev])
      setCurrentThreadId(targetThreadId)
      setActiveThreadMetadata(newMetadata)
      
      setThreadMemory(null)
      setEvaluatedKeys(new Set())
      setBoardResults({})
      setEditorialVisualResults({})
      setEvaluationResultsByKey({})
      if (targetActiveContext) {
        setActiveContext(targetActiveContext)
      }
    }

    setMessages(nextMessages)
    setChatHistory(nextChatHistory)

    setInput(''); setPendingCapsuleExpansion(null); setImageFile(null); setImagePrev(null)
    // Clearing input disables the send button (disabled={loading || !input.trim()}); if focus
    // was on that button, disabling it drops focus to <body> with no signal to assistive tech.
    // Move focus to the still-enabled composer textarea instead, so the user can keep typing.
    textRef.current?.focus()
    // pendingOutfit/pendingPiece are cleared once this request settles (see the finally block
    // below), not here — clearing them immediately closed the piece/outfit-styling landing
    // panel mid-request and exposed the generic empty-state hero instead of a contextual
    // generating state.
    setCompareOutfitId('')
    setGenerateOutfitMode(false); setEditorialVisualMode(false)
    setFileInputKey(k => k + 1)
    setLoading(true)

    // Save the user message to the database immediately (non-debounced for transition, debounced otherwise)
    if (isTransitioningNew) {
      await saveThreadState(targetThreadId, {
        messages: nextMessages,
        chatHistory: nextChatHistory,
        title: derivedTitle,
        userRenamed: false,
        kind: threadKind,
        threadMemory: forceNewFromExisting ? null : threadMemory,
        activeContext: forceNewFromExisting ? targetActiveContext : activeContext,
        evaluatedKeys: forceNewFromExisting ? [] : Array.from(evaluatedKeys),
        boardResults: forceNewFromExisting ? {} : boardResults,
        editorialVisualResults: forceNewFromExisting ? {} : editorialVisualResults,
        evaluationResultsByKey: forceNewFromExisting ? {} : evaluationResultsByKey
      })
    } else {
      await saveThreadState(targetThreadId, {
        messages: nextMessages,
        chatHistory: nextChatHistory
      })
    }

    const historySnapshot = nextChatHistory

    try {
      let replyText
      let replyStructuredOutfits = null
      let replyWardrobeEvaluation = false
      let replyEvaluationResponseMode = 'full'
      let replyOutfitName = null
      let replyDebug = null
      let replyMode = null
      let replyWholeWardrobe = false
      let replyQueryOptions = null
      let replySavedOutfitVariantMode = null
      let replyVariantSourceOutfit = null
      let nextThreadMemory = threadMemory
      let generatedBoards = null
      let replyRenderedBoards = null

      if (useCapsuleExpansion) {
        const existingCapsuleOutfits = messages.flatMap(message =>
          (Array.isArray(message?.structuredOutfits) ? message.structuredOutfits : [])
            .filter(outfit => isPlannedSetSource(outfit?.source))
        )
        const res = await fetch('/api/ai/expand-capsule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planContext: capsuleExpansionToSend.planContext,
            slotId: capsuleExpansionToSend.slotId,
            slotLabel: capsuleExpansionToSend.label,
            existingOutfits: existingCapsuleOutfits,
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not add another capsule look')
        replyText = data.answer || `Added another ${capsuleExpansionToSend.label} look.`
        replyStructuredOutfits = data.structuredOutfits || []
        replyDebug = data.debug || null
        replyMode = 'capsule_expansion'
        replyQueryOptions = {
          occasion: replyStructuredOutfits[0]?.occasion || 'casual',
          season: capsuleExpansionToSend.planContext?.is_winter_capsule ? 'winter' : 'current season',
          activity: replyStructuredOutfits[0]?.activity || 'none',
        }
        nextThreadMemory = {
          type: 'generated_outfits',
          source: 'plan_outfit_set',
          latestContextText: compactGeneratedOutfitContext(
            [...existingCapsuleOutfits, ...replyStructuredOutfits],
            { source: 'plan_outfit_set' }
          ),
          latestOutfits: [...existingCapsuleOutfits, ...replyStructuredOutfits],
          stylingContext: replyQueryOptions,
        }
        setThreadMemory(nextThreadMemory)

      } else if (outfitToSend && compareId) {
        const res = await fetch('/api/ai/compare-outfits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outfitAId: outfitToSend.id, outfitBId: compareId, question: q || 'Which outfit works better for me?', history: historySnapshot }) })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'

      } else if (outfitToSend?.imageGenerationMode) {
        const savedOutfitVariantMode = outfitToSend.variantMode === 'creative'
          ? 'creative'
          : (outfitToSend.variantMode === 'adjacent' ? 'adjacent' : 'formula')
        const outfitPieceIds = Array.isArray(outfitToSend.pieces)
          ? outfitToSend.pieces.map(p => p?.id).filter(Boolean)
          : (Array.isArray(outfitToSend.pieceIds) ? outfitToSend.pieceIds.filter(Boolean) : [])
        const mainPieceId = outfitToSend.mainPieceId || outfitToSend.main_piece_id || outfitToSend.anchorPieceId || null
        const endpoint = savedOutfitVariantMode === 'creative'
          ? '/api/ai/generate-saved-outfit-image'
          : '/api/ai/generate-saved-outfit-variants'
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outfit: {
              id: outfitToSend.id,
              label: outfitToSend.name,
              title: outfitToSend.name,
              photo: outfitToSend.photo || '',
              bestFor: outfitToSend.occasion || '',
              pieces: outfitToSend.pieces || [],
              pieceIds: outfitPieceIds,
              mainPieceId,
              reason: outfitToSend.notes || '',
            },
            pieceIds: outfitPieceIds,
            mainPieceId,
            occasion: outfitToSend.occasion || effectiveGenerateOccasion,
            season: outfitToSend.season || effectiveGenerateSeason,
            variantMode: savedOutfitVariantMode,
            mode: savedOutfitVariantMode,
            activity: effectiveGenerateActivity,
          })
        })
        const contentType = res.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          const text = await res.text()
          throw new Error(text.startsWith('<!DOCTYPE')
            ? `Variant route returned HTML instead of JSON. Restart the backend/dev server so ${endpoint} is loaded.`
            : `Variant route returned ${contentType || 'non-JSON'} response.`)
        }
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate outfit variants')
        if (savedOutfitVariantMode === 'creative') {
          replyText = data.feedback || 'Generated creative outfit alternatives from the saved outfit photo and linked garment references.'
          generatedBoards = data.boards || [data.board || data]
        } else {
          replyText = data.feedback || (savedOutfitVariantMode === 'adjacent'
            ? 'Here are adjacent outfits using your wardrobe pieces.'
            : 'Here are formula-similar outfits using your wardrobe pieces.')
          replyStructuredOutfits = Array.isArray(data.structuredOutfits)
            ? data.structuredOutfits.map(outfit => ({ ...outfit, textOnly: true, wholeWardrobe: true }))
            : []
          replyWholeWardrobe = true
          replyMode = data.mode || `generate_saved_outfit_${savedOutfitVariantMode}_variants`
          replyDebug = data.debug || null
          replySavedOutfitVariantMode = savedOutfitVariantMode
          replyVariantSourceOutfit = data.sourceOutfit || {
            ...outfitToSend,
            pieceIds: outfitPieceIds,
            mainPieceId
          }
          replyQueryOptions = {
            occasion: outfitToSend.occasion || effectiveGenerateOccasion,
            season: outfitToSend.season || effectiveGenerateSeason,
            mood: effectiveGenerateMood,
            mission: effectiveGenerateMission,
            activity: effectiveGenerateActivity,
          }
          nextThreadMemory = {
            type: 'generated_outfits',
            source: `saved_outfit_${savedOutfitVariantMode}`,
            latestContextText: compactGeneratedOutfitContext(replyStructuredOutfits, { source: `saved_outfit_${savedOutfitVariantMode}` }),
            latestOutfits: replyStructuredOutfits,
            stylingContext: replyQueryOptions,
          }
          setThreadMemory(nextThreadMemory)
        }

      } else if (outfitToSend) {
        const outfitPieceIds = Array.isArray(outfitToSend.pieces)
          ? outfitToSend.pieces.map(p => p?.id).filter(Boolean)
          : []
        const priorEvaluationText = (threadMemory?.type === 'outfit' && String(threadMemory?.id) === String(outfitToSend.id))
          ? (threadMemory.latestEvaluationText || '')
          : ''
        const shouldAttachOutfitPhoto = outfitToSend.attachVisualContext !== false
        const res = await fetch('/api/ai/evaluate-wardrobe-outfit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outfit: {
              id: outfitToSend.id,
              label: outfitToSend.name,
              title: outfitToSend.name,
              photo: shouldAttachOutfitPhoto ? (outfitToSend.photo || '') : '',
              bestFor: outfitToSend.occasion || '',
              pieces: outfitToSend.pieces || [],
              pieceIds: outfitPieceIds,
              reason: outfitToSend.notes || '',
            },
            pieceIds: outfitPieceIds,
            occasion: outfitToSend.occasion || effectiveGenerateOccasion,
            season: outfitToSend.season || effectiveGenerateSeason,
            mood: wardrobeOutfitMood,
            previousEvaluation: priorEvaluationText,
            responseMode: overrides.responseMode || 'full',
            question: q || 'Evaluate this outfit.'
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not evaluate outfit')
        replyText = data.feedback || 'Outfit evaluation complete.'
        // Part 4 visibility: surface when no image was available for this critique.
        if (data.evidenceMode === 'limited') {
          replyText = '⚠️ _Evaluated from outfit description only — no image was available for this board._\n\n' + replyText
        }
        replyWardrobeEvaluation = true
        replyEvaluationResponseMode = overrides.responseMode || 'full'
        replyOutfitName = outfitToSend.name
        replyDebug = data.debug || null
        const isEvaluationFollowup = (overrides.responseMode || 'full') === 'followup'
        const rememberedOutfit = {
          id: outfitToSend.id ?? null,
          label: outfitToSend.name || outfitToSend.title,
          title: outfitToSend.name || outfitToSend.title,
          name: outfitToSend.name || outfitToSend.title,
          photo: shouldAttachOutfitPhoto ? (outfitToSend.photo || '') : '',
          bestFor: outfitToSend.occasion || '',
          occasion: outfitToSend.occasion || '',
          season: outfitToSend.season || '',
          pieces: outfitToSend.pieces || [],
          pieceIds: outfitPieceIds,
          reason: outfitToSend.notes || '',
        }
        nextThreadMemory = {
          type: outfitToSend.id == null ? 'generated_outfit' : 'outfit',
          id: outfitToSend.id,
          name: outfitToSend.name,
          latestOutfit: rememberedOutfit,
          latestEvaluation: isEvaluationFollowup
            ? (threadMemory?.latestEvaluation || null)
            : (data.evaluation || null),
          latestEvaluationText: isEvaluationFollowup
            ? priorEvaluationText
            : compactEvaluationMemory(data.evaluation),
          latestContextText: outfitToSend.id == null
            ? compactGeneratedOutfitContext([rememberedOutfit], { source: 'lookbook_generated_outfit' })
            : undefined,
        }
        setThreadMemory(nextThreadMemory)

      } else if (pieceToSend && shouldGenerateEditorialVisuals) {
        // ── PREVIEW MODE: text directions only, no images yet ────────────────
        const res = await fetch('/api/ai/editorial-directions-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pieceId: pieceToSend.id, occasion: effectiveGenerateOccasion, season: effectiveGenerateSeason, mission: effectiveGenerateMission, mood: effectiveGenerateMood, question: q || 'Suggest ideal new pieces for this selected item.', history: historySnapshot })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate directions')
        replyText = `Here are three styling directions for ${pieceToSend.name}. Review them and click "Generate image (~$0.07)" on any you want to render.`
        replyStructuredOutfits = (data.directions || []).map(d => ({
          ...d,
          label: d.title,
          previewOnly: true,
          pieceId: pieceToSend.id,
          occasion: effectiveGenerateOccasion,
          season: effectiveGenerateSeason,
        }))
        replyMode = 'ideal_styling_directions'

      } else if (pieceToSend && shouldGenerateOutfits) {
        const res = await fetch('/api/ai/generate-outfits-for-piece', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pieceId: pieceToSend.id, occasion: effectiveGenerateOccasion, season: effectiveGenerateSeason, mission: effectiveGenerateMission, mood: effectiveGenerateMood, question: q || (effectiveIncludeMissingPieces ? 'Generate ideal outfit directions for this piece, using my wardrobe when possible and missing-piece ideas when needed.' : 'Generate outfit ideas for this piece.'), includeMissingPieces: effectiveIncludeMissingPieces, idealOnly: effectiveIdealOnlyMode, history: historySnapshot, activity: effectiveGenerateActivity }) })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Something went wrong — try again')
        replyText = data.feedback || 'Something went wrong.'
        replyStructuredOutfits = data.structuredOutfits || null
        replyDebug = data.debug || null
        if (Array.isArray(replyStructuredOutfits) && replyStructuredOutfits.length) {
          nextThreadMemory = {
            type: 'generated_outfits',
            source: 'selected_piece',
            id: pieceToSend.id,
            name: pieceToSend.name,
            latestContextText: compactGeneratedOutfitContext(replyStructuredOutfits, { source: 'selected_piece' }),
            latestOutfits: replyStructuredOutfits,
            stylingContext: {
              occasion: effectiveGenerateOccasion,
              season: effectiveGenerateSeason,
              mood: effectiveGenerateMood,
              mission: effectiveGenerateMission || 'mix',
              activity: effectiveGenerateActivity,
            },
          }
          setThreadMemory(nextThreadMemory)
        }

      } else if (pieceToSend) {
        const res = await fetch('/api/ai/evaluate-piece', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pieceId: pieceToSend.id, question: q || 'How should I style this piece?', history: historySnapshot }) })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Something went wrong — try again')
        replyText = data.feedback || 'Something went wrong.'

      } else if (shouldGenerateActiveEditorialVisuals) {
        // ── PREVIEW MODE for active context ──────────────────────────────────
        const res = await fetch('/api/ai/editorial-directions-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pieceId: activeContext.id, occasion: effectiveGenerateOccasion, season: effectiveGenerateSeason, mission: effectiveGenerateMission, mood: effectiveGenerateMood, question: q || 'Suggest ideal new pieces for this selected item.', history: historySnapshot })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate directions')
        replyText = `Here are three styling directions for ${activeContext.name}. Review them and click "Generate image (~$0.07)" on any you want to render.`
        replyStructuredOutfits = (data.directions || []).map(d => ({
          ...d,
          label: d.title,
          previewOnly: true,
          pieceId: activeContext.id,
          occasion: effectiveGenerateOccasion,
          season: effectiveGenerateSeason,
        }))
        replyMode = 'ideal_styling_directions'

      } else if (fileToSend) {
        const fd = new FormData()
        fd.append('photo', fileToSend)
        fd.append('question', q || 'What do you think of this outfit?')
        const res = await fetch('/api/ai/outfit-feedback', { method: 'POST', body: fd })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Something went wrong — try again')
        replyText = data.feedback || 'Something went wrong.'
      } else if (threadMemory?.type === 'generated_outfit' && OUTFIT_FOLLOWUP_PATTERN.test(q)) {
        const rememberedOutfit = threadMemory.latestOutfit || {}
        const outfitPieceIds = Array.isArray(rememberedOutfit.pieceIds) && rememberedOutfit.pieceIds.length
          ? rememberedOutfit.pieceIds
          : (Array.isArray(rememberedOutfit.pieces) ? rememberedOutfit.pieces.map(p => p?.id).filter(Boolean) : [])
        if (!outfitPieceIds.length) {
          throw new Error('Generated outfit context is missing linked pieces. Re-evaluate the outfit card and try again.')
        }
        const conversationMode = classifyChatTurn(q, { hasThreadMemory: true })
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q || 'Continue discussing this generated outfit.',
            pieces,
            history: historySnapshot,
            conversationMode,
            threadContext: threadMemory.latestEvaluationText || '',
            outfit: rememberedOutfit,
            pieceIds: outfitPieceIds,
            activeContext,
            ...stylingContextFromMemory(threadMemory),
            ...currentChatDateContext(),
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not continue generated outfit evaluation')
        replyText = data.answer || 'Outfit follow-up complete.'
        replyWardrobeEvaluation = false
        replyDebug = data.debug || null
        replyStructuredOutfits = data.structuredOutfits || null
        if (data.savedCorrections && data.savedCorrections.length > 0) {
          const lastCorrection = data.savedCorrections[data.savedCorrections.length - 1]
          triggerToast(`Saved styling preference: "${lastCorrection.note}"`)
        }
        if (Array.isArray(replyStructuredOutfits) && replyStructuredOutfits.length) {
          const source = data.structuredOutfitsSource || 'whole_wardrobe'
          replyQueryOptions = {
            occasion: data.structuredOutfitsOccasion || 'casual',
            season: data.structuredOutfitsSeason || 'current season',
            mood: data.structuredOutfitsMood || '',
            mission: data.structuredOutfitsMission || 'mix',
            activity: data.structuredOutfitsActivity || 'none',
          }
          if (source === 'whole_wardrobe') {
            replyWholeWardrobe = true
            replyStructuredOutfits = replyStructuredOutfits.map(outfit => ({ ...outfit, textOnly: true, wholeWardrobe: true }))
          }
          nextThreadMemory = {
            type: 'generated_outfits',
            source,
            latestContextText: compactGeneratedOutfitContext(replyStructuredOutfits, { source }),
            latestOutfits: replyStructuredOutfits,
            stylingContext: replyQueryOptions,
          }
          setThreadMemory(nextThreadMemory)
        } else {
          nextThreadMemory = {
            ...threadMemory,
            type: 'generated_outfit',
            latestOutfit: rememberedOutfit,
          }
          setThreadMemory(nextThreadMemory)
        }

      } else if (activeContext?.type === 'outfit' || (threadMemory?.type === 'outfit' && OUTFIT_FOLLOWUP_PATTERN.test(q))) {
        const activeOutfitId = activeContext?.type === 'outfit' ? activeContext.id : threadMemory.id
        const activeOutfit = outfits.find(o => String(o.id) === String(activeOutfitId))
        if (!activeOutfit) throw new Error('Active outfit context was not found. Reopen the outfit and try again.')
        const outfitPieceIds = Array.isArray(activeOutfit.pieces)
          ? activeOutfit.pieces.map(p => p?.id).filter(Boolean)
          : []
        const memoryText = threadMemory?.type === 'outfit' && String(threadMemory.id) === String(activeOutfit.id)
          ? threadMemory.latestEvaluationText
          : ''
        const conversationMode = classifyChatTurn(q, { hasThreadMemory: true })
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q || 'Continue evaluating this outfit.',
            pieces,
            history: historySnapshot,
            conversationMode,
            threadContext: memoryText,
            outfit: {
              label: activeOutfit.name,
              title: activeOutfit.name,
              photo: activeOutfit.photo || '',
              bestFor: activeOutfit.occasion || '',
              pieces: activeOutfit.pieces || [],
              pieceIds: outfitPieceIds,
              reason: activeOutfit.notes || '',
            },
            pieceIds: outfitPieceIds,
            activeContext,
            ...stylingContextFromMemory(threadMemory),
            ...currentChatDateContext(),
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not continue outfit evaluation')
        replyText = data.answer || 'Outfit follow-up complete.'
        replyWardrobeEvaluation = false
        replyDebug = data.debug || null
        replyStructuredOutfits = data.structuredOutfits || null
        if (data.savedCorrections && data.savedCorrections.length > 0) {
          const lastCorrection = data.savedCorrections[data.savedCorrections.length - 1]
          triggerToast(`Saved styling preference: "${lastCorrection.note}"`)
        }
        if (Array.isArray(replyStructuredOutfits) && replyStructuredOutfits.length) {
          const source = data.structuredOutfitsSource || 'whole_wardrobe'
          replyQueryOptions = {
            occasion: data.structuredOutfitsOccasion || 'casual',
            season: data.structuredOutfitsSeason || 'current season',
            mood: data.structuredOutfitsMood || '',
            mission: data.structuredOutfitsMission || 'mix',
            activity: data.structuredOutfitsActivity || 'none',
          }
          if (source === 'whole_wardrobe') {
            replyWholeWardrobe = true
            replyStructuredOutfits = replyStructuredOutfits.map(outfit => ({ ...outfit, textOnly: true, wholeWardrobe: true }))
          }
          setThreadMemory({
            type: 'generated_outfits',
            source,
            latestContextText: compactGeneratedOutfitContext(replyStructuredOutfits, { source }),
            latestOutfits: replyStructuredOutfits,
            stylingContext: replyQueryOptions,
          })
        } else {
          setThreadMemory({
            type: 'outfit',
            id: activeOutfit.id,
            name: activeOutfit.name,
            latestEvaluation: threadMemory?.latestEvaluation || null,
            latestEvaluationText: memoryText,
          })
        }

      } else {
        const generatedContext = threadMemory?.type === 'generated_outfits'
          ? threadMemory.latestContextText
          : ''
        const generatedOutfits = threadMemory?.type === 'generated_outfits'
          ? threadMemory.latestOutfits || []
          : []
        const conversationMode = classifyChatTurn(q, { hasThreadMemory: Boolean(threadMemory || activeContext) })
        const threadContext = compactThreadContext(threadMemory, activeContext)
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q,
            pieces,
            history: historySnapshot,
            generatedContext,
            generatedOutfits,
            conversationMode,
            threadContext,
            activeContext,
            ...stylingContextFromMemory(threadMemory, activeContext?.type === 'piece' ? generateActivity : wardrobeOutfitActivity),
            ...currentChatDateContext(),
          })
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Something went wrong — try again')
        }
        if (data.suggestedTitle && isTransitioningNew) {
          derivedTitle = data.suggestedTitle
          setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, title: data.suggestedTitle } : t))
        }
        replyText = data.answer || data.error || 'Something went wrong.'
        replyDebug = data.debug || null
        replyStructuredOutfits = data.structuredOutfits || null
        if (Array.isArray(data.renderedBoards) && data.renderedBoards.length) {
          replyRenderedBoards = data.renderedBoards
        }
        if (data.savedCorrections && data.savedCorrections.length > 0) {
          const lastCorrection = data.savedCorrections[data.savedCorrections.length - 1]
          triggerToast(`Saved styling preference: "${lastCorrection.note}"`)
        }
        if (Array.isArray(replyStructuredOutfits) && replyStructuredOutfits.length) {
          const source = data.structuredOutfitsSource || 'whole_wardrobe'
          replyQueryOptions = {
            occasion: data.structuredOutfitsOccasion || 'casual',
            season: data.structuredOutfitsSeason || 'current season',
            mood: data.structuredOutfitsMood || '',
            mission: data.structuredOutfitsMission || 'mix',
            activity: data.structuredOutfitsActivity || 'none',
          }
          if (source === 'whole_wardrobe') {
            replyWholeWardrobe = true
            replyStructuredOutfits = replyStructuredOutfits.map(outfit => ({ ...outfit, textOnly: true, wholeWardrobe: true }))
          }
          setThreadMemory({
            type: 'generated_outfits',
            source,
            latestContextText: compactGeneratedOutfitContext(replyStructuredOutfits, { source }),
            latestOutfits: replyStructuredOutfits,
            stylingContext: replyQueryOptions,
          })
        }
      }
      const assistantMsg = {
        role: 'assistant',
        text: replyText,
        renderedBoards: replyRenderedBoards,
        structuredOutfits: replyStructuredOutfits,
        wholeWardrobe: replyWholeWardrobe,
        wardrobeEvaluation: replyWardrobeEvaluation,
        evaluationResponseMode: replyEvaluationResponseMode,
        textOnly: replyWardrobeEvaluation,
        outfitName: replyOutfitName,
        debug: replyDebug,
        mode: replyMode,
        savedOutfitVariantMode: replySavedOutfitVariantMode,
        variantSourceOutfit: replyVariantSourceOutfit,
        queryOptions: replyQueryOptions || (shouldGenerateOutfits || shouldGenerateEditorialVisuals || shouldGenerateActiveEditorialVisuals ? {
          occasion: effectiveGenerateOccasion,
          season: effectiveGenerateSeason,
          idealOnly: effectiveIdealOnlyMode,
          includeMissingPieces: effectiveIncludeMissingPieces,
          mission: effectiveGenerateMission,
          mood: effectiveGenerateMood,
          activity: effectiveGenerateActivity,
        } : null)
      }
      if (replyWholeWardrobe) {
        refreshWholeWardrobeSessionMemory()
      }

      const updatedMessages = [...nextMessages, assistantMsg]
      const updatedChatHistory = [...nextChatHistory, { role: 'assistant', content: replyText }]

      const newBoardResults = { ...boardResults }
      if (generatedBoards) {
        newBoardResults[updatedMessages.length - 1] = generatedBoards
      }

      if (currentThreadIdRef.current === targetThreadId) {
        setMessages(updatedMessages)
        setChatHistory(updatedChatHistory)
        if (generatedBoards) {
          setBoardResults(newBoardResults)
        }
      }

      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, message_count: updatedMessages.length } : t))

      if (targetThreadId !== 'new_chat') {
        fetch('/api/chat-threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: targetThreadId,
            title: derivedTitle || activeThreadMetadata?.title || 'Chat',
            user_renamed: activeThreadMetadata?.user_renamed ? 1 : 0,
            kind: threadKind,
            payload: {
              messages: updatedMessages,
              chatHistory: updatedChatHistory,
              boardResults: newBoardResults,
              threadMemory: nextThreadMemory,
              activeContext: forceNewFromExisting ? targetActiveContext : activeContext,
              evaluatedKeys: forceNewFromExisting ? [] : Array.from(evaluatedKeys),
              editorialVisualResults: forceNewFromExisting ? {} : editorialVisualResults,
              evaluationResultsByKey: forceNewFromExisting ? {} : evaluationResultsByKey
            }
          })
        }).catch(err => {
          console.error('Failed to save assistant reply to database:', err)
        })
      }

    } catch (err) {
      const errText = `Error: ${err.message}`
      const errMsg = { role: 'assistant', text: errText }
      const updatedMessages = [...nextMessages, errMsg]
      const updatedChatHistory = [...nextChatHistory, { role: 'assistant', content: errText }]

      if (currentThreadIdRef.current === targetThreadId) {
        setMessages(updatedMessages)
        setChatHistory(updatedChatHistory)
      }

      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, message_count: updatedMessages.length } : t))

      if (targetThreadId !== 'new_chat') {
        fetch('/api/chat-threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: targetThreadId,
            title: derivedTitle || activeThreadMetadata?.title || 'Chat',
            user_renamed: activeThreadMetadata?.user_renamed ? 1 : 0,
            kind: threadKind,
            payload: {
              messages: updatedMessages,
              chatHistory: updatedChatHistory,
              boardResults: boardResults,
              threadMemory: threadMemory,
              activeContext: forceNewFromExisting ? targetActiveContext : activeContext,
              evaluatedKeys: forceNewFromExisting ? [] : Array.from(evaluatedKeys),
              editorialVisualResults: forceNewFromExisting ? {} : editorialVisualResults,
              evaluationResultsByKey: forceNewFromExisting ? {} : evaluationResultsByKey
            }
          })
        }).catch(dbErr => {
          console.error('Failed to save error response to database:', dbErr)
        })
      }
    } finally {
      setLoading(false)
      setPendingOutfit(null)
      setPendingPiece(null)
      setPendingOutfitAction(null)
    }
  }

  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }
  const handleInputChange = (e) => {
    setInput(e.target.value)
    const ta = textRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' }
  }

  const pending = pendingPiece || pendingOutfit
  const pendingPhoto = pendingPiece ? (pendingPiece.worn_photo || pendingPiece.photo) : pendingOutfit?.photo
  const pendingConfidence = pendingOutfit ? getOutfitConfidenceMode(pendingOutfit) : null

  const RecentMemoryControls = () => {
    if (!recentMemoryItemCount) {
      if (!recentMemoryConfirmation) return null
      return (
        <div style={{ fontSize: 12, color: 'color-mix(in srgb, var(--text) 55%, var(--text-muted) 45%)' }}>{recentMemoryConfirmation}</div>
      )
    }
    return (
      <div
        className="wardrobe-builder-memory"
        title="Recently shown wardrobe items are temporarily de-prioritized so new generated outfits do not repeat them too soon."
        style={{ fontSize: 12, color: 'color-mix(in srgb, var(--text) 55%, var(--text-muted) 45%)' }}
      >
        <HistoryClockIcon />
        <span>
          Skipping {recentMemoryItemCount} recently used {recentMemoryItemCount === 1 ? 'piece' : 'pieces'}{' · '}
          <button
            onClick={resetWholeWardrobeSessionMemory}
            disabled={recentMemoryResetting || loading}
            title="Clears recently shown generated-card memory only. Saved feedback and learning stay intact."
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', padding: 0, border: 0, background: 'transparent', cursor: recentMemoryResetting || loading ? 'default' : 'pointer', opacity: recentMemoryResetting || loading ? 0.65 : 1, textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            {recentMemoryResetting ? 'Including...' : 'Include them again'}
          </button>
        </span>
      </div>
    )
  }

  const openWardrobeBuilderComposer = () => {
    setWardrobeBuilderOpen(true)
  }

  const closeWardrobeBuilderComposer = () => {
    setWardrobeBuilderOpen(false)
    requestAnimationFrame(() => {
      createOutfitsButtonRef.current?.focus()
    })
  }

  useEffect(() => {
    if (!wardrobeBuilderOpen) return
    requestAnimationFrame(() => {
      wardrobeBuilderFirstFieldRef.current?.focus()
    })
  }, [wardrobeBuilderOpen])

  const wardrobeBuilderFieldLabelStyle = { fontSize: 11.5, fontWeight: 600, color: 'color-mix(in srgb, var(--text) 68%, var(--text-muted) 32%)', marginBottom: 6 }
  const selectedStyleDirectionLabel = STYLE_DIRECTION_OPTIONS.find(([value]) => value === wardrobeOutfitMission)?.[1] || STYLE_DIRECTION_OPTIONS[0][1]
  const selectedStyleDirectionDescription = STYLE_DIRECTION_LEGEND.find(([label]) => label === selectedStyleDirectionLabel)?.[1] || 'Explore a balanced mix of distinct styling approaches.'
  const selectedPieceStyleDirectionLabel = STYLE_DIRECTION_OPTIONS.find(([value]) => value === generateMission)?.[1] || STYLE_DIRECTION_OPTIONS[0][1]

  const renderWardrobeBuilderPanel = ({ compact = false } = {}) => (
    <StylistLandingPanel
      className={`wardrobe-builder-entry ${compact ? 'is-compact' : ''}`.trim()}
      header={
        <div className="wardrobe-builder-hero">
          <div className="wardrobe-builder-hero-content">
            <div className="wardrobe-builder-hero-icon"><WardrobeComposerIcon /></div>
            <div>
              <div className="piece-styling-eyebrow">Visual composer</div>
              <h2 id="outfit-builder-composer-title">Create outfits from my wardrobe</h2>
              <p>Shape a brief, then explore several complete looks made from pieces you already own.</p>
              <div className="wardrobe-builder-piece-count">{pieces.length} pieces available in your wardrobe</div>
            </div>
          </div>
          <button type="button" onClick={closeWardrobeBuilderComposer} className="piece-styling-back" aria-label="Back to chat">
            <span aria-hidden="true">←</span> Back to chat
          </button>
        </div>
      }
      sectionLabel="Shape the brief"
      footer={
        <>
          <div style={{ display: 'grid', gap: 4 }}>
            <RecentMemoryControls />
            {recentMemoryStatus && (
              <div style={{ fontSize: 12, color: recentMemoryStatus.startsWith('Reset failed') ? '#a64b4b' : 'var(--text-muted)' }}>
                {recentMemoryStatus}
              </div>
            )}
          </div>
          <button onClick={generateWholeWardrobeOutfits} disabled={loading} className="piece-styling-primary-action">
            {loading ? 'Generating...' : 'Create my outfits'} <span aria-hidden="true">→</span>
          </button>
        </>
      }
    >
      <fieldset disabled={loading} style={{ border: 'none', margin: 0, padding: 0 }}>
      <div className="wardrobe-builder-fields">
        <div style={{ flex: '1 1 120px' }}>
          <div style={wardrobeBuilderFieldLabelStyle}>Occasion</div>
          <StylistSelect triggerRef={wardrobeBuilderFirstFieldRef} value={wardrobeOutfitOccasion} onChange={setWardrobeOutfitOccasion} options={OCCASION_OPTIONS} ariaLabel="Occasion" />
        </div>
        <div style={{ flex: '1.3 1 150px' }}>
          <div style={wardrobeBuilderFieldLabelStyle}>Activity</div>
          <StylistSelect value={wardrobeOutfitActivity} onChange={setWardrobeOutfitActivity} options={ACTIVITY_OPTIONS} ariaLabel="Activity" />
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <div style={wardrobeBuilderFieldLabelStyle}>Season</div>
          <StylistSelect value={wardrobeOutfitSeason} onChange={setWardrobeOutfitSeason} options={WARDROBE_SEASON_OPTIONS} ariaLabel="Season" side="top" />
        </div>
        <div style={{ flex: '1.4 1 165px' }}>
          <div style={{ ...wardrobeBuilderFieldLabelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Style direction</span>
            <InfoTooltip className="style-direction-tooltip" label="What the style direction options mean" align="right" side="bottom" size="sm" width={310}>
              {STYLE_DIRECTION_LEGEND.map(([label, desc]) => (
                <div key={label} className={label === selectedStyleDirectionLabel ? 'is-selected' : ''}><strong>{label}</strong><span>{desc}</span></div>
              ))}
            </InfoTooltip>
          </div>
          <StylistSelect value={wardrobeOutfitMission} onChange={setWardrobeOutfitMission} options={STYLE_DIRECTION_OPTIONS} ariaLabel="Style direction" side="top" />
          <div className="wardrobe-builder-direction-help">{selectedStyleDirectionDescription}</div>
        </div>
      </div>

      <div className="wardrobe-builder-mood">
        <div style={wardrobeBuilderFieldLabelStyle}>Mood</div>
        <input
          value={wardrobeOutfitMood}
          onChange={e => setWardrobeOutfitMood(e.target.value)}
          placeholder="e.g. relaxed, artful, quietly bold"
          style={{ ...wardrobeBuilderControlStyle, width: '100%' }}
        />
      </div>

      <div className="wardrobe-builder-request">
        <div style={wardrobeBuilderFieldLabelStyle}>Styling request</div>
        <textarea
          value={wardrobeOutfitRequest}
          onChange={e => setWardrobeOutfitRequest(e.target.value)}
          placeholder="e.g. more everyday, less dressy, good for travel"
          rows={2}
          style={{ ...wardrobeBuilderControlStyle, width: '100%' }}
        />
      </div>
      </fieldset>
      {loading && (
        <div className="wardrobe-builder-generating-status" role="status">
          {loadingStatus || 'Composing outfit directions from your brief…'}
        </div>
      )}
    </StylistLandingPanel>
  )



  const renderComposerDock = (extraClassName = '') => (
    <div className={`stylist-composer-dock ${messages.length > 1 ? 'is-sticky' : ''} ${extraClassName}`.trim()}>
      {wardrobeBuilderOpen ? (
        <div
          className="stylist-builder-composer-shell"
          id="outfit-builder-composer"
          role="region"
          aria-labelledby="outfit-builder-composer-title"
          onKeyDown={e => {
            if (e.key === 'Escape') closeWardrobeBuilderComposer()
          }}
        >
          {renderWardrobeBuilderPanel({ compact: true })}
        </div>
      ) : (
        <>
          {imagePrev && (
            <div className="stylist-attached-photo">
              <div style={{ position: 'relative' }}>
                <img src={imagePrev} alt="" style={{ height: 56, width: 56, objectFit: 'contain', borderRadius: 8, background: 'var(--surface-2)' }} />
                <button onClick={() => { setImageFile(null); setImagePrev(null) }} aria-label="Remove attached photo" style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, background: 'var(--text)', color: '#fff', borderRadius: '50%', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Photo attached</span>
            </div>
          )}

          <div className={`stylist-input-shell ${pending ? 'is-hidden-for-pending-action' : ''}`}>
            <div className="ai-input-row" aria-hidden={pending ? 'true' : undefined}>
              {!pending && (
                <>
                  <label className={`ai-upload-btn ${imagePrev ? 'has-image' : ''}`} title="Attach photo">
                    <input key={fileInputKey} type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
                    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M6.25 5.25 7.4 3.75h5.2l1.15 1.5H16a1.75 1.75 0 0 1 1.75 1.75v7.25A1.75 1.75 0 0 1 16 16H4a1.75 1.75 0 0 1-1.75-1.75V7A1.75 1.75 0 0 1 4 5.25h2.25Z" />
                      <circle cx="10" cy="10.5" r="3" />
                    </svg>
                  </label>
                  <textarea ref={textRef} className="ai-input" placeholder="Ask about your wardrobe..." value={input} onChange={handleInputChange} onKeyDown={handleKey} rows={1} />
                  <button className="ai-send-btn" onClick={send} disabled={loading || (!input.trim() && !imageFile)} aria-label="Send message">↑</button>
                </>
              )}
            </div>
          </div>
          {!pending && messages.length === 1 && (
            <button
              ref={createOutfitsButtonRef}
              type="button"
              className="composer-outfit-pathway"
              onClick={openWardrobeBuilderComposer}
              aria-expanded={wardrobeBuilderOpen}
              aria-controls="outfit-builder-composer"
            >
              <span className="composer-outfit-pathway-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="M7.25 4.25A2.75 2.75 0 0 1 10 1.5a2.75 2.75 0 0 1 2.75 2.75c0 1.2-.78 2.22-1.86 2.6v1.02" />
                  <path d="m10.9 7.85 6.35 4.3a1.3 1.3 0 0 1-.73 2.38H3.48a1.3 1.3 0 0 1-.73-2.38l6.35-4.3" />
                </svg>
              </span>
              <span className="composer-outfit-pathway-copy">
                <strong>Create outfits from my wardrobe</strong>
                <span>Shape a brief and explore several complete looks.</span>
              </span>
              <span className="composer-outfit-pathway-arrow" aria-hidden="true">→</span>
            </button>
          )}
        </>
      )}
    </div>
  )

  const latestAssistantIndex = (() => {
    for (let idx = messages.length - 1; idx >= 0; idx--) {
      if (messages[idx].role === 'assistant') return idx
    }
    return -1
  })()
  return (
    <div className="stylist-container">
      <ThreadRail
        threads={archivedView ? archivedThreads : threads}
        currentThreadId={currentThreadId}
        onSelectThread={(threadId) => threadId === 'new_chat' ? openThread('new_chat') : navigate('/stylist/' + threadId)}
        onNewThread={() => openThread('new_chat')}
        onDeleteThread={deleteThread}
        onRenameThread={renameThread}
        archivedView={archivedView}
        onToggleArchivedView={setArchivedView}
        onTogglePinThread={togglePinThread}
        onToggleArchiveThread={toggleArchiveThread}
      />
      
      {mobileDrawerOpen && (
        <ThreadRail
          threads={archivedView ? archivedThreads : threads}
          currentThreadId={currentThreadId}
          onSelectThread={(threadId) => threadId === 'new_chat' ? openThread('new_chat') : navigate('/stylist/' + threadId)}
          onNewThread={() => openThread('new_chat')}
          onDeleteThread={deleteThread}
          onRenameThread={renameThread}
          isMobileDrawer={true}
          onCloseDrawer={() => setMobileDrawerOpen(false)}
          archivedView={archivedView}
          onToggleArchivedView={setArchivedView}
          onTogglePinThread={togglePinThread}
          onToggleArchiveThread={toggleArchiveThread}
        />
      )}

      <div className="stylist-chat-main">
        {/* Toast Notification */}
        {showToast && (
          <div style={{
            position: 'fixed',
            bottom: '100px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(18, 18, 18, 0.95)',
            backdropFilter: 'blur(8px)',
            color: '#ffffff',
            padding: '12px 24px',
            borderRadius: '24px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            zIndex: 99999,
            fontSize: '14px',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            maxWidth: '90%',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {toastMessage}
          </div>
        )}

        {/* Header */}
        <div className="view-header">
          <div className="view-header-top">
            <div>
              <div className="view-title">Ask Your Stylist</div>
              <div className="view-subtitle">
                {pieces.length} pieces
                {activeContext ? ` · about ${activeContext.name}` : ''}
                {chatHistory.length > 0 && !activeContext ? ` · ${Math.ceil(chatHistory.length / 2)} exchanges` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button 
                className="history-mobile-btn" 
                onClick={() => setMobileDrawerOpen(true)}
                title="Chat History"
              >
                🕒 History
              </button>
              <div style={{ position: 'relative' }}>
                <button
                  ref={homeLocationButtonRef}
                  className="chip"
                  style={{ marginTop: 4, background: 'transparent', border: '1px solid transparent', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}
                  onClick={() => { setHomeLocationInput(homeLocation); setHomeLocationOpen(v => !v) }}
                  title="Used for local weather in outfit suggestions"
                  aria-expanded={homeLocationOpen}
                  aria-controls="home-location-popover"
                >
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>Weather location{homeLocation ? ` · ${homeLocation}` : ''}</span>
                  <span aria-hidden="true" style={{ display: 'inline-block', transition: 'transform 0.15s', transform: homeLocationOpen ? 'rotate(180deg)' : 'rotate(0deg)', fontSize: 10 }}>▾</span>
                </button>
                {homeLocationOpen && (
                  <div
                    ref={homeLocationPopoverRef}
                    id="home-location-popover"
                    role="dialog"
                    aria-label="Weather location"
                    style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, width: 260, padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)', display: 'grid', gap: 8, zIndex: 20 }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Weather location</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Used for local weather in outfit suggestions when you do not name another place.
                    </div>
                    <input
                      type="text"
                      value={homeLocationInput}
                      onChange={e => setHomeLocationInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveHomeLocation() }}
                      placeholder="e.g. Seattle"
                      style={{ fontSize: 13, padding: '7px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: '100%' }}
                    />
                    <button
                      onClick={saveHomeLocation}
                      disabled={homeLocationSaving}
                      style={{ fontSize: 12, color: '#fff', padding: '7px 12px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--accent)', cursor: homeLocationSaving ? 'default' : 'pointer', opacity: homeLocationSaving ? 0.65 : 1, justifySelf: 'start' }}
                    >
                      {homeLocationSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      {/* Chat thread */}
      <div className={`stylist-chat-scroll ${messages.length > 1 ? 'is-existing-chat' : 'is-empty-chat'} ${pending ? 'has-pending-action' : ''}`}>
        {messages.length === 1 && !pending && wardrobeBuilderOpen && renderWardrobeBuilderPanel()}
        {messages.length === 1 && !pending && !wardrobeBuilderOpen && (
          <StylistLandingPanel
            variant="plain"
            className="stylist-empty-state"
            header={
              <div className="stylist-empty-intro">
                <h2>Ask anything about your wardrobe</h2>
                <p>Ask for styling advice, explore your saved pieces, or share an outfit photo.</p>
              </div>
            }
            primary={renderComposerDock('is-empty-state')}
          >
            <div className="stylist-suggestion-section">
                <div className="stylist-suggestion-heading">Try asking</div>
                <div className="stylist-suggestion-list">
                  {SUGGESTIONS.map(suggestion => (
                    <button key={suggestion.prompt} type="button" className="stylist-suggestion-btn" onClick={() => setInput(suggestion.prompt)}>
                      <span className="stylist-suggestion-copy">
                        <span className="stylist-suggestion-label">{suggestion.label}</span>
                        <span>{suggestion.prompt}</span>
                      </span>
                      <span className="stylist-suggestion-arrow" aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
              </div>
          </StylistLandingPanel>
        )}

        <div className="sr-only" role="status" aria-live="polite">{chatAnnouncement}</div>
        <div className="chat-thread">
          {messages.length > 1 && visibleMessageStart > 0 && (
            <button
              type="button"
              className="stylist-history-reveal"
              onClick={() => setVisibleMessageStart(previous => Math.max(0, previous - INITIAL_SAVED_MESSAGE_COUNT))}
            >
              Show {Math.min(INITIAL_SAVED_MESSAGE_COUNT, visibleMessageStart)} earlier messages
            </button>
          )}
          {messages.length > 1 && messages.slice(visibleMessageStart).map((m, visibleIndex) => {
            const i = visibleMessageStart + visibleIndex
            const prioritizeContextPhoto = visibleIndex < 2 || i >= messages.length - 2
            const isWardrobeSessionMessage = m.contextType === 'wardrobe'
              || (!m.imagePrev && (
                /^use my wardrobe$/i.test(String(m.contextName || '').trim())
                || /^use my wardrobe to create outfits\b/i.test(String(m.text || '').trim())
              ))
            if (m.contextName === 'Whole wardrobe evaluation') {
              return null
            }
            return (
              <div key={i}>
              {!isWardrobeSessionMessage && (m.imagePrev || m.contextName) && (
                <div className="stylist-conversation-subject">
                  {m.imagePrev && (() => {
                    const messageImageSrc = resolveUploadImageSrc(m.imagePrev)
                    return messageImageSrc ? (
                    <button
                      type="button"
                      onClick={event => { previewReturnFocusRef.current = event.currentTarget; setPreviewImage({
                        src: messageImageSrc,
                        title: m.contextName || 'Outfit photo',
                        meta: m.contextMode || ''
                      }) }}
                      className="stylist-conversation-subject-photo"
                      aria-label="Open outfit photo preview"
                    >
                      <img
                        src={resolveUploadThumbnailSrc(messageImageSrc, 'chat-attachment')}
                        alt=""
                        loading={prioritizeContextPhoto ? 'eager' : 'lazy'}
                        decoding="async"
                        fetchPriority={prioritizeContextPhoto ? 'high' : 'auto'}
                      />
                    </button>
                    ) : null
                  })()}
                  {(m.contextName || m.contextMode) && (
                    <div className="stylist-conversation-subject-copy">
                      <span className="stylist-conversation-subject-label">
                        {m.contextType === 'wardrobe'
                          ? 'Wardrobe'
                          : m.contextType === 'outfit' || (!m.contextType && m.contextMode)
                            ? 'Outfit'
                            : 'Piece'}
                      </span>
                      {m.contextName && <strong>{m.contextName}</strong>}
                      {m.contextMode && <span>{m.contextMode}</span>}
                    </div>
                  )}
                </div>
              )}

              {(() => {
                // The canned opening line is always messages[0]. In the empty-chat state
                // it's replaced entirely by the "Ask anything..." hero below; once a
                // thread has real exchanges, that hero disappears and this line used to
                // fall through to a plain chat bubble. Render it with the same heading +
                // subheading treatment instead, so a loaded/continuing thread opens with
                // the same considered intro as a brand-new one, not a stray greeting bubble.
                if (i === 0 && m.role === 'assistant' && String(m.text || '').includes('personal stylist')) {
                  return null
                }
                if (m.isError) {
                  return (
                    <div className="ai-message assistant error-bubble" style={{ padding: '12px 14px', background: 'rgba(219, 68, 85, 0.08)', border: '1px solid rgba(219, 68, 85, 0.25)', color: 'var(--text)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 16 }}>⚠️</span>
                      <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                        {m.text}
                      </div>
                    </div>
                  )
                }
                const multi = isMultiOutfitResponse(m)
                const hasBoards = Boolean(boardResults[i]?.length)
                if (m.role === 'assistant' && m.wardrobeEvaluation && m.evaluationResponseMode !== 'followup') {
                  return (
                    <div className={`ai-message ${m.role} outfit-critique-message`}>
                      <details open={true}>
                        <summary className="outfit-critique-summary">
                          <span>Outfit critique</span>
                          <strong>{m.outfitName || 'Generated outfit'}</strong>
                        </summary>
                        <div className="outfit-critique-content">
                          <CritiqueBody text={m.text} />
                        </div>
                      </details>
                    </div>
                  )
                }
                if (m.role === 'assistant' && multi) {
                  const hasStructuredIdeas = Array.isArray(m.structuredOutfits) && m.structuredOutfits.length > 0
                  const isPreviewResponse = hasStructuredIdeas && m.structuredOutfits[0]?.previewOnly
                  const structuredPlanNotes = hasStructuredIdeas ? getTripPlanNotes(m.structuredOutfits) : []
                  const planExpansionSuggestions = hasStructuredIdeas ? getPlanExpansionSuggestions(m.structuredOutfits) : []
                  const modelNoteText = String(m.text || '').trim()
                  const planNotesMissingFromProse = structuredPlanNotes.filter(note =>
                    !modelNoteText.toLowerCase().includes(String(note || '').toLowerCase())
                  )
                  return (
                    <div className={`ai-message ${m.role}`} style={{ padding: '12px 14px' }}>
                      {isPreviewResponse ? <MarkdownMessage text={m.text} /> : null}
                      {m.queryOptions && !hasStructuredIdeas && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 12px' }}>
                          {m.queryOptions.occasion && (
                            <span style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '3px 8px', color: 'var(--text-muted)', textTransform: 'capitalize', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              🎯 {m.queryOptions.occasion}
                            </span>
                          )}
                          {m.queryOptions.season && (
                            <span style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '3px 8px', color: 'var(--text-muted)', textTransform: 'capitalize', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              🌤️ {m.queryOptions.season}
                            </span>
                          )}
                          {m.queryOptions.mission && (
                            <span style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '3px 8px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              ⚗️ {m.queryOptions.mission === 'mix' ? 'Mix of missions' : m.queryOptions.mission}
                            </span>
                          )}
                          {m.queryOptions.mood && (
                            <span style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '3px 8px', color: 'var(--text-muted)', fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', gap: 3 }} title="Stylist mood/notes">
                              💬 "{m.queryOptions.mood}"
                            </span>
                          )}
                          {m.queryOptions.request && (
                            <span style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '3px 8px', color: 'var(--text-muted)', fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', gap: 3 }} title="Styling request">
                              🧭 "{m.queryOptions.request}"
                            </span>
                          )}
                          {m.queryOptions.activity && m.queryOptions.activity !== 'none' && (
                            <span style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '3px 8px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              👟 {ACTIVITY_OPTIONS.find(opt => opt[0] === m.queryOptions.activity)?.[1] || m.queryOptions.activity}
                            </span>
                          )}
                        </div>
                      )}
                      {hasStructuredIdeas ? renderStructuredAdvice(m, i) : (
                        <div style={{ marginTop: 10 }}>
                          <MarkdownMessage text={m.text} />
                        </div>
                      )}
                      {/* Structured responses used to render only their cards, so the model's own
                          written answer never appeared: plan / whole-wardrobe replies fell through
                          every branch, and the rest were covered by a canned "Outfit ideas for X…"
                          line (since removed) that stood in for the answer. That prose is the
                          substance — the declared constraint ("6 looks, 3 pairs of shoes"), the
                          piece roster, the budget verdict, per-look rationale, and the levers for
                          changing any of it. Rendered below the cards, not above, so comparison
                          imagery still leads per the ratified image-first ruling.
                          Two exclusions: previewOnly responses already render m.text in full above,
                          and engine field dumps (see isEngineFieldDump) are not prose at all. */}
                      {hasStructuredIdeas && !isPreviewResponse &&
                        ((modelNoteText && !isEngineFieldDump(modelNoteText)) || structuredPlanNotes.length > 0) && (
                        <details className="stylist-plan-notes" open>
                          <summary>Stylist's notes</summary>
                          <div className="stylist-plan-notes-body">
                            {planNotesMissingFromProse.length > 0 && (
                              <ul className="stylist-plan-notes-list">
                                {planNotesMissingFromProse.map(note => <li key={note}>{note}</li>)}
                              </ul>
                            )}
                            {planExpansionSuggestions.some(trim => trim.canExpandDirectly) && (
                              <div className="stylist-plan-expansion-actions">
                                {planExpansionSuggestions.filter(trim => trim.canExpandDirectly).map(trim => (
                                  <button
                                    key={`${trim.label}-${trim.remaining}`}
                                    type="button"
                                    onClick={() => {
                                      const prompt = `Try 1 additional “${trim.label}” look for this capsule. Keep the same capsule roster and all existing looks.`
                                      setPendingCapsuleExpansion({ ...trim, prompt })
                                      setInput(prompt)
                                      requestAnimationFrame(() => textRef.current?.focus())
                                    }}
                                  >
                                    Show another for {trim.label}
                                  </button>
                                ))}
                              </div>
                            )}
                            {planExpansionSuggestions.some(trim => trim.capacityExhausted) && (
                              <div className="stylist-plan-expansion-actions">
                                {planExpansionSuggestions.filter(trim => trim.capacityExhausted).map(trim => (
                                  <span key={`${trim.label}-full`}>Full available rotation shown for {trim.label}.</span>
                                ))}
                              </div>
                            )}
                            {modelNoteText && !isEngineFieldDump(modelNoteText) && <MarkdownMessage text={modelNoteText} />}
                          </div>
                        </details>
                      )}
                      {Boolean(m.debug && (
                        (m.debug.gateExcludedTotal || 0) > 0 ||
                        (m.debug.proposeValidationFails || 0) > 0 ||
                        (m.debug.outfitProseWithoutToolCall || 0) > 0 ||
                        (m.debug.zeroResultContradictionBlocks || 0) > 0 ||
                        (m.debug.destinationClarificationRetries || 0) > 0
                      )) && (
                        <details className="telemetry-details" style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                          <summary>ⓘ <span style={{ textDecoration: 'underline', marginLeft: 2 }}>Search &amp; validation details</span></summary>
                          <div style={{ marginTop: 4, display: 'grid', gap: 2 }}>
                            {m.debug.searchCalls > 0 && <div>Wardrobe searches this turn: {m.debug.searchCalls}</div>}
                            {m.debug.gateExcludedTotal > 0 && <div>Pieces filtered out as prohibited: {m.debug.gateExcludedTotal}</div>}
                            {m.debug.proposeCalls > 0 && <div>Outfits proposed: {m.debug.proposeCalls}</div>}
                            {m.debug.proposeValidationFails > 0 && <div>Proposals rejected by validation (structure or occasion/weather gates): {m.debug.proposeValidationFails}</div>}
                            {m.debug.outfitProseWithoutToolCall > 0 && <div>⚠ An earlier draft of this reply described an outfit in text instead of proposing it as a verified card; it was auto-corrected before sending.</div>}
                            {m.debug.zeroResultContradictionBlocks > 0 && <div>⚠ An earlier draft of this reply described a piece that a search found 0 results for; it was auto-corrected before sending.</div>}
                            {m.debug.destinationClarificationRetries > 0 && <div>⚠ An earlier draft asked about destination/weather without searching the wardrobe first; it was auto-corrected before sending.</div>}
                          </div>
                        </details>
                      )}
                    </div>
                  )
                }
                return (
                  <div className={`ai-message ${m.role}`}>
                    {m.role === 'assistant'
                      ? (String(m.text || '').includes(CRITIQUE_DETAILS_DELIMITER)
                          ? <CritiqueBody text={m.text} />
                          : <MarkdownMessage text={m.text} />)
                      : m.text.split('\n').filter(Boolean).map((line, j) => <p key={j}>{line}</p>)}
                  </div>
                )
              })()}

              {m.role === 'assistant' && Array.isArray(m.renderedBoards) && m.renderedBoards.length > 0 && (
                <div className="generated-visual-grid" style={{ marginTop: 10 }}>
                  {m.renderedBoards.map((board, boardIdx) => {
                    const renderSaveKey = `render-preview:${i}:${boardIdx}`
                    const isRenderSaved = savedBoardKeys.has(renderSaveKey) || (board.imageUrl && savedBoardUrls.has(board.imageUrl))
                    return (
                      <div key={boardIdx} className="generated-visual-card" style={{ position: 'relative' }}>
                        {isRenderSaved && (
                          <div className="saved-board-badge" style={{ width: 'fit-content', marginBottom: 6, fontSize: 10, background: 'var(--donate-bg)', color: 'var(--donate)', border: '1px solid rgba(107, 140, 107, 0.25)', borderRadius: 12, padding: '2px 8px', fontWeight: 500 }}>✓ Saved board</div>
                        )}
                        <button type="button" className="generated-visual-preview-btn" onClick={event => { previewReturnFocusRef.current = event.currentTarget; setPreviewImage({ src: resolveUploadImageSrc(board.imageUrl), title: board.label || 'Outfit preview', meta: board.reason || '' }) }} aria-label="Open outfit preview">
                          <img src={resolveUploadThumbnailSrc(board.imageUrl, 'chat-display')} alt={board.label || 'Outfit preview'} className="generated-visual-image" loading="lazy" decoding="async" />
                        </button>
                        <div style={{ fontSize: 13, fontWeight: 650, marginTop: 8, color: 'var(--text)' }}>{board.label}</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8, width: '100%', alignItems: 'center' }}>
                          {!isRenderSaved && (
                            <button onClick={() => saveGeneratedBoard({ key: renderSaveKey, board, boardType: 'render_preview', messageIndex: i, boardIndex: boardIdx })} style={{ fontSize: 10, color: 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Save board</button>
                          )}
                          {(() => {
                            const primaryTypes = ['signature', 'works', 'almost', 'not_me']
                            const primaryLabels = GENERATED_BOARD_FEEDBACK_LABELS.filter(([type, , reason]) => primaryTypes.includes(type) && !reason)
                            const diagnosticLabels = GENERATED_BOARD_FEEDBACK_LABELS.filter(([type, , reason]) => !primaryTypes.includes(type) || reason)
                            const diagnosticGroups = [
                              ['What feels wrong?', diagnosticLabels.filter(([type]) => type === 'style_direction')],
                              ['Fit and shape', diagnosticLabels.filter(([type]) => type === 'shape_balance')],
                              ['Problems in the generated image', diagnosticLabels.filter(([type]) => IMAGE_FIDELITY_FEEDBACK_LABELS.some(([value]) => value === type))],
                            ]
                            const isBoardSavedToCanon = Boolean(canonicalBoardFor(board))
                            const hasActiveDiagnostic = diagnosticLabels.some(([type, , reason]) => {
                              const k = `${renderSaveKey}:${type}${reason ? `:${reason}` : ''}`
                              return (boardFeedbackActive(board, type, reason) ?? feedbackSaved.has(k))
                            })
                            const cardKey = `render-card:${i}:${boardIdx}`
                            const isExpanded = !collapsedFeedbackCards.has(cardKey) && (hasActiveDiagnostic || expandedFeedbackCards.has(cardKey))
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                                <div className="stylist-feedback-row">
                                  {primaryLabels.map(([type, label]) => {
                                    const k = `${renderSaveKey}:${type}`
                                    const isSavedFeedback = boardFeedbackActive(board, type) ?? feedbackSaved.has(k)
                                    return (
                                      <button key={k} onClick={() => isBoardSavedToCanon ? toggleCanonicalBoardVerdict(board, type) : selectGeneratedBoardVerdict({ key: k, feedbackType: type, targetType: 'generated_visual_board', label: `${board.label || 'rendered board'} - ${label}`, note: board.reason || '', payload: { board, messageIndex: i, boardIndex: boardIdx, feedbackLabel: type }, appendToPiece: false }, renderSaveKey)} type="button" aria-pressed={isSavedFeedback} className="stylist-feedback-chip">
                                        {isSavedFeedback ? '✓ ' : ''}{label}
                                      </button>
                                    )
                                  })}
                                  <button type="button" onClick={() => toggleFeedbackCardExpansion(cardKey, isExpanded)} aria-expanded={isExpanded} className="stylist-feedback-chip is-quiet">
                                    {isExpanded ? 'Less feedback ▴' : 'More feedback ▾'}
                                  </button>
                                </div>
                                {isExpanded && (
                                  <div className="stylist-feedback-disclosure">
                                    {diagnosticGroups.map(([groupTitle, entries]) => <div key={groupTitle}>
                                      <div className="stylist-feedback-group-title">{groupTitle}</div>
                                      <div className="stylist-feedback-row">
                                    {entries.map(([type, label, reason]) => {
                                      const k = `${renderSaveKey}:${type}${reason ? `:${reason}` : ''}`
                                      const isSavedFeedback = boardFeedbackActive(board, type, reason) ?? feedbackSaved.has(k)
                                      return (
                                        <button key={k} onClick={() => isBoardSavedToCanon
                                          ? (reason ? toggleCanonicalBoardReason(board, type, reason) : toggleCanonicalBoardLabel(board, type))
                                          : toggleStylistFeedback({ key: k, feedbackType: type, targetType: 'generated_visual_board', label: `${board.label || 'rendered board'} - ${label}`, note: board.reason || '', payload: { board, messageIndex: i, boardIndex: boardIdx, feedbackLabel: type, feedback_reason: reason || null }, appendToPiece: false })} type="button" aria-pressed={isSavedFeedback} className="stylist-feedback-chip">
                                          {isSavedFeedback ? '✓ ' : ''}{label}
                                        </button>
                                      )
                                    })}
                                      </div>
                                    </div>)}
                                    {(boardFeedbackActive(board, 'wrong_length') ?? feedbackSaved.has(`${renderSaveKey}:wrong_length`)) && (
                                      <GeneratedBoardLengthFeedback
                                        board={board}
                                        baseKey={renderSaveKey}
                                        feedbackSaved={feedbackSaved}
                                        toggleFeedback={toggleStylistFeedback}
                                        label={board.label || 'Rendered board'}
                                        note={board.reason || ''}
                                        payload={{ board, messageIndex: i, boardIndex: boardIdx }}
                                        canonicalCorrections={boardWrongLengthCorrections(board)}
                                        onToggleCanonical={isBoardSavedToCanon ? (pieceId, pieceName, issue) => toggleCanonicalWrongLength(board, pieceId, pieceName, issue) : null}
                                      />
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {m.role === 'assistant' && !m.isError && i > 0 && activeContext && i === latestAssistantIndex && (
                <div style={{ marginTop: 4, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
                    {(!boardResults[i]?.length && !editorialVisualResults[i]?.length && !/Identity-preserving styling edits|visual boards/i.test(m.text)) && (savedIndices.has(i) ? (
                      <span style={{ fontSize: 11, color: 'var(--donate)', display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px' }}>Saved to {activeContext.name}</span>
                    ) : (
                      <button onClick={() => saveMessageToNotes(i, m.text)} style={{ fontSize: 11, color: 'var(--text-muted)', padding: '3px 10px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        Save as styling rule for {activeContext.name}
                      </button>
                    ))}
                    {activeContext.type === 'piece' && !isMultiOutfitResponse(m) && !boardResults[i]?.length && !editorialVisualResults[i]?.length && !/Identity-preserving styling edits|visual boards/i.test(m.text) && (
                      <button onClick={() => generateVisualBoards(i, m.text, null, null, i)} disabled={boardLoadingIndex === i} style={{ fontSize: 11, color: 'var(--accent)', padding: '3px 10px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 4, cursor: boardLoadingIndex === i ? 'default' : 'pointer', opacity: boardLoadingIndex === i ? 0.65 : 1 }}>
                        {boardLoadingIndex === i ? 'Generating boards...' : (boardResults[i]?.length ? 'Regenerate boards' : 'Generate visual boards')}
                      </button>
                    )}
                  </div>

                  {editorialVisualResults[i]?.length > 0 && (
                    <div className="generated-visual-grid" style={{ marginTop: 10 }}>
                      {editorialVisualResults[i].map((visual, idx) => {
                        const key = `editorial-board:${i}:${idx}`
                        const isSaved = savedBoardKeys.has(key) || (visual.imageUrl && savedBoardUrls.has(visual.imageUrl))
                        return (
                          <div key={idx} className="generated-visual-card" style={{ position: 'relative' }}>
                            {visual.error ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Visual error: {visual.error}</div> : (
                              <>
                                {isSaved && (
                                  <div className="saved-board-badge" style={{ width: 'fit-content', marginBottom: 6, fontSize: 10, background: 'var(--donate-bg)', color: 'var(--donate)', border: '1px solid rgba(107, 140, 107, 0.25)', borderRadius: 12, padding: '2px 8px', fontWeight: 500 }}>
                                    ✓ Saved board
                                  </div>
                                )}
                                <button type="button" className="generated-visual-preview-btn" onClick={event => { previewReturnFocusRef.current = event.currentTarget; setPreviewImage({ src: resolveUploadImageSrc(visual.imageUrl), title: visual.label || 'Generated visual', meta: visual.reason || '' }) }} aria-label="Open generated visual preview">
                                  <img src={resolveUploadThumbnailSrc(visual.imageUrl, 'chat-display')} alt={visual.label} className="generated-visual-image" loading="lazy" decoding="async" />
                                </button>
                                <div style={{ fontSize: 13, fontWeight: 650, marginTop: 8, color: 'var(--text)' }}>{visual.label}</div>
                                {Array.isArray(visual.missingPieces) && visual.missingPieces.length > 0 && <div style={{ fontSize: 10, color: 'var(--text-light)', marginTop: 2 }}>Suggested additions: {visual.missingPieces.join(' + ')}</div>}
                                
                                {visual.reason && (
                                  <details className="rationale-details" style={{ marginTop: 4 }}>
                                    <summary style={{ cursor: 'pointer', fontSize: 10, fontWeight: 650, color: 'var(--accent)', userSelect: 'none' }}>
                                      {getTeaserText(visual.reason)} <span style={{ fontWeight: 'normal', color: 'var(--text-light)' }}>(more ▾)</span>
                                    </summary>
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                                      {visual.reason}
                                    </div>
                                  </details>
                                )}

                                {visual.watchFor && <div style={{ fontSize: 10, color: 'var(--text-light)', marginTop: 4, lineHeight: 1.4 }}><strong>Watch:</strong> {visual.watchFor}</div>}
                                
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8, width: '100%', alignItems: 'center' }}>
                                  {!isSaved && (
                                    <button onClick={() => saveGeneratedBoard({ key, board: visual, boardType: 'editorial_direction', messageIndex: i, boardIndex: idx })} style={{ fontSize: 10, color: 'var(--accent)', padding: '3px 8px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Save board</button>
                                  )}

                                  {(() => {
                                    const primaryTypes = ['signature', 'works', 'almost', 'not_me']
                                    const primaryLabels = GENERATED_BOARD_FEEDBACK_LABELS.filter(([type, , reason]) => primaryTypes.includes(type) && !reason)
                                    const diagnosticLabels = GENERATED_BOARD_FEEDBACK_LABELS.filter(([type, , reason]) => !primaryTypes.includes(type) || reason)
                                    const diagnosticGroups = [
                                      ['What feels wrong?', diagnosticLabels.filter(([type]) => type === 'style_direction')],
                                      ['Fit and shape', diagnosticLabels.filter(([type]) => type === 'shape_balance')],
                                      ['Problems in the generated image', diagnosticLabels.filter(([type]) => IMAGE_FIDELITY_FEEDBACK_LABELS.some(([value]) => value === type))],
                                    ]

                                    const isBoardSavedToCanon = Boolean(canonicalBoardFor(visual))

                                    const hasActiveDiagnostic = diagnosticLabels.some(([type, , reason]) => {
                                      const k = `visual-board:${i}:${idx}:${type}${reason ? `:${reason}` : ''}`
                                      return (boardFeedbackActive(visual, type, reason) ?? feedbackSaved.has(k))
                                    })

                                    const cardKey = `visual-card:${i}:${idx}`
                                    const isExpanded = !collapsedFeedbackCards.has(cardKey) && (hasActiveDiagnostic || expandedFeedbackCards.has(cardKey))

                                    return (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                                        <div className="stylist-feedback-row">
                                          {primaryLabels.map(([type, label]) => {
                                            const verdictBaseKey = `visual-board:${i}:${idx}`
                                            const k = `${verdictBaseKey}:${type}`
                                            const isSavedFeedback = boardFeedbackActive(visual, type) ?? feedbackSaved.has(k)
                                            return (
                                              <button key={k} onClick={() => isBoardSavedToCanon ? toggleCanonicalBoardVerdict(visual, type) : selectGeneratedBoardVerdict({ key: k, feedbackType: type, targetType: 'generated_visual_board', label: `${visual.label || 'visual board'} - ${label}`, note: visual.reason || '', payload: { board: visual, messageIndex: i, boardIndex: idx, feedbackLabel: type }, appendToPiece: false }, verdictBaseKey)} type="button" aria-pressed={isSavedFeedback} className="stylist-feedback-chip">
                                                {isSavedFeedback ? '✓ ' : ''}{label}
                                              </button>
                                            )
                                          })}

                                          <button
                                            type="button"
                                            onClick={() => toggleFeedbackCardExpansion(cardKey, isExpanded)}
                                            aria-expanded={isExpanded}
                                            className="stylist-feedback-chip is-quiet"
                                          >
                                            {isExpanded ? 'Less feedback ▴' : 'More feedback ▾'}
                                          </button>
                                        </div>

                                        {isExpanded && (
                                          <div className="stylist-feedback-disclosure">
                                            {diagnosticGroups.map(([groupTitle, entries]) => <div key={groupTitle}>
                                              <div className="stylist-feedback-group-title">{groupTitle}</div>
                                              <div className="stylist-feedback-row">
                                            {entries.map(([type, label, reason]) => {
                                              const k = `visual-board:${i}:${idx}:${type}${reason ? `:${reason}` : ''}`
                                              const isSavedFeedback = boardFeedbackActive(visual, type, reason) ?? feedbackSaved.has(k)
                                              return (
                                                <button key={k} onClick={() => isBoardSavedToCanon
                                                  ? (reason ? toggleCanonicalBoardReason(visual, type, reason) : toggleCanonicalBoardLabel(visual, type))
                                                  : toggleStylistFeedback({ key: k, feedbackType: type, targetType: 'generated_visual_board', label: `${visual.label || 'visual board'} - ${label}`, note: visual.reason || '', payload: { board: visual, messageIndex: i, boardIndex: idx, feedbackLabel: type, feedback_reason: reason || null }, appendToPiece: false })} type="button" aria-pressed={isSavedFeedback} className="stylist-feedback-chip">
                                                  {isSavedFeedback ? '✓ ' : ''}{label}
                                                </button>
                                              )
                                            })}
                                              </div>
                                            </div>)}
                                            {(boardFeedbackActive(visual, 'wrong_length') ?? feedbackSaved.has(`visual-board:${i}:${idx}:wrong_length`)) && (
                                              <GeneratedBoardLengthFeedback
                                                board={visual}
                                                baseKey={`visual-board:${i}:${idx}`}
                                                feedbackSaved={feedbackSaved}
                                                toggleFeedback={toggleStylistFeedback}
                                                label={visual.label || 'Visual board'}
                                                note={visual.reason || ''}
                                                payload={{ board: visual, messageIndex: i, boardIndex: idx }}
                                                canonicalCorrections={boardWrongLengthCorrections(visual)}
                                                onToggleCanonical={isBoardSavedToCanon ? (pieceId, pieceName, issue) => toggleCanonicalWrongLength(visual, pieceId, pieceName, issue) : null}
                                              />
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })()}
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {boardResults[i]?.length > 0 && !isMultiOutfitResponse(m) && (
                    <div className="generated-visual-grid" style={{ marginTop: 10 }}>
                      {boardResults[i].map((board, idx) => {
                        const saveKey = `wardrobe-board:${i}:${idx}`
                        const isBoardSaved = savedBoardKeys.has(saveKey) || (board.imageUrl && savedBoardUrls.has(board.imageUrl))
                        return (
                          <div key={idx} className="generated-visual-card" style={{ position: 'relative' }}>
                            {board.error ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Board error: {board.error}</div> : (
                              <>
                                {isBoardSaved && (
                                  <div className="saved-board-badge" style={{ width: 'fit-content', marginBottom: 6, fontSize: 10, background: 'var(--donate-bg)', color: 'var(--donate)', border: '1px solid rgba(107, 140, 107, 0.25)', borderRadius: 12, padding: '2px 8px', fontWeight: 500 }}>
                                    ✓ Saved board
                                  </div>
                                )}
                                <button type="button" className="generated-visual-preview-btn" onClick={event => { previewReturnFocusRef.current = event.currentTarget; setPreviewImage({ src: resolveUploadImageSrc(board.imageUrl), title: board.label || 'Generated board', meta: board.reason || '' }) }} aria-label="Open generated board preview">
                                  <img src={resolveUploadThumbnailSrc(board.imageUrl, 'chat-display')} alt={board.label} className="generated-visual-image" loading="lazy" decoding="async" />
                                </button>
                                <div style={{ fontSize: 13, fontWeight: 650, marginTop: 8, color: 'var(--text)' }}>{board.label}</div>
                                
                                {board.reason && (
                                  <details className="rationale-details" style={{ marginTop: 4 }}>
                                    <summary style={{ cursor: 'pointer', fontSize: 10, fontWeight: 650, color: 'var(--accent)', userSelect: 'none' }}>
                                      {getTeaserText(board.reason)} <span style={{ fontWeight: 'normal', color: 'var(--text-light)' }}>(more ▾)</span>
                                    </summary>
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                                      {board.reason}
                                    </div>
                                  </details>
                                )}

                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8, width: '100%', alignItems: 'center' }}>
                                  {!isBoardSaved && (
                                    <button onClick={() => saveGeneratedBoard({ key: saveKey, board, boardType: 'wardrobe_board', messageIndex: i, boardIndex: idx })} style={{ fontSize: 10, color: 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Save board</button>
                                  )}
                                  {(() => {
                                    const primaryTypes = ['signature', 'works', 'almost', 'not_me']
                                    const primaryLabels = GENERATED_BOARD_FEEDBACK_LABELS.filter(([type, , reason]) => primaryTypes.includes(type) && !reason)
                                    const diagnosticLabels = GENERATED_BOARD_FEEDBACK_LABELS.filter(([type, , reason]) => !primaryTypes.includes(type) || reason)
                                    const diagnosticGroups = [
                                      ['What feels wrong?', diagnosticLabels.filter(([type]) => type === 'style_direction')],
                                      ['Fit and shape', diagnosticLabels.filter(([type]) => type === 'shape_balance')],
                                      ['Problems in the generated image', diagnosticLabels.filter(([type]) => IMAGE_FIDELITY_FEEDBACK_LABELS.some(([value]) => value === type))],
                                    ]
                                    const isBoardSavedToCanon = Boolean(canonicalBoardFor(board))
                                    const hasActiveDiagnostic = diagnosticLabels.some(([type, , reason]) => {
                                      const k = `${saveKey}:${type}${reason ? `:${reason}` : ''}`
                                      return (boardFeedbackActive(board, type, reason) ?? feedbackSaved.has(k))
                                    })
                                    const cardKey = `wardrobe-board-card:${i}:${idx}`
                                    const isExpanded = !collapsedFeedbackCards.has(cardKey) && (hasActiveDiagnostic || expandedFeedbackCards.has(cardKey))
                                    return (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                                        <div className="stylist-feedback-row">
                                          {primaryLabels.map(([type, label]) => {
                                            const k = `${saveKey}:${type}`
                                            const isSavedFeedback = boardFeedbackActive(board, type) ?? feedbackSaved.has(k)
                                            return (
                                              <button key={k} onClick={() => isBoardSavedToCanon ? toggleCanonicalBoardVerdict(board, type) : selectGeneratedBoardVerdict({ key: k, feedbackType: type, targetType: 'generated_visual_board', label: `${board.label || 'wardrobe board'} - ${label}`, note: board.reason || '', payload: { board, messageIndex: i, boardIndex: idx, feedbackLabel: type }, appendToPiece: false }, saveKey)} type="button" aria-pressed={isSavedFeedback} className="stylist-feedback-chip">
                                                {isSavedFeedback ? '✓ ' : ''}{label}
                                              </button>
                                            )
                                          })}
                                          <button type="button" onClick={() => toggleFeedbackCardExpansion(cardKey, isExpanded)} aria-expanded={isExpanded} className="stylist-feedback-chip is-quiet">
                                            {isExpanded ? 'Less feedback ▴' : 'More feedback ▾'}
                                          </button>
                                        </div>
                                        {isExpanded && (
                                          <div className="stylist-feedback-disclosure">
                                            {diagnosticGroups.map(([groupTitle, entries]) => <div key={groupTitle}>
                                              <div className="stylist-feedback-group-title">{groupTitle}</div>
                                              <div className="stylist-feedback-row">
                                            {entries.map(([type, label, reason]) => {
                                              const k = `${saveKey}:${type}${reason ? `:${reason}` : ''}`
                                              const isSavedFeedback = boardFeedbackActive(board, type, reason) ?? feedbackSaved.has(k)
                                              return (
                                                <button key={k} onClick={() => isBoardSavedToCanon
                                                  ? (reason ? toggleCanonicalBoardReason(board, type, reason) : toggleCanonicalBoardLabel(board, type))
                                                  : toggleStylistFeedback({ key: k, feedbackType: type, targetType: 'generated_visual_board', label: `${board.label || 'wardrobe board'} - ${label}`, note: board.reason || '', payload: { board, messageIndex: i, boardIndex: idx, feedbackLabel: type, feedback_reason: reason || null }, appendToPiece: false })} type="button" aria-pressed={isSavedFeedback} className="stylist-feedback-chip">
                                                  {isSavedFeedback ? '✓ ' : ''}{label}
                                                </button>
                                              )
                                            })}
                                              </div>
                                            </div>)}
                                            {(boardFeedbackActive(board, 'wrong_length') ?? feedbackSaved.has(`${saveKey}:wrong_length`)) && (
                                              <GeneratedBoardLengthFeedback
                                                board={board}
                                                baseKey={saveKey}
                                                feedbackSaved={feedbackSaved}
                                                toggleFeedback={toggleStylistFeedback}
                                                label={board.label || 'Wardrobe board'}
                                                note={board.reason || ''}
                                                payload={{ board, messageIndex: i, boardIndex: idx }}
                                                canonicalCorrections={boardWrongLengthCorrections(board)}
                                                onToggleCanonical={isBoardSavedToCanon ? (pieceId, pieceName, issue) => toggleCanonicalWrongLength(board, pieceId, pieceName, issue) : null}
                                              />
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })()}
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {isMultiOutfitResponse(m) && getEditorialNotes(m.text).length > 0 && (
                    <details style={{ marginTop: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Stylist notes / avoid</summary>
                      <div style={{ marginTop: 8, display: 'grid', gap: 5 }}>
                        {getEditorialNotes(m.text).map((note, idx) => <div key={idx} style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>{note}</div>)}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )})}

          {loading && (
            <div className="ai-message assistant" role="status" aria-live="polite">
              <div className="typing-dots" aria-hidden="true"><span /><span /><span /></div>
              <div className={loadingStatus ? undefined : 'sr-only'} style={loadingStatus ? { marginTop: 8, fontSize: 12, color: 'var(--text-muted)' } : undefined}>
                {loadingStatus || 'Stylist is working…'}
              </div>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {pendingPiece && (() => {
        const pendingPhotoSrc = pendingPhoto ? resolveUploadImageSrc(pendingPhoto) : null
        const closePendingPiece = () => { setPendingPiece(null); setGenerateOutfitMode(false); setEditorialVisualMode(false); setIdealOnlyMode(false); setInput('') }
        return (
          <div ref={pendingActionRef} className="piece-styling-workflow">
            <StylistLandingPanel
              header={
                <div className="piece-styling-hero">
                  <div className="piece-styling-heading-row">
                    <div>
                      <div className="piece-styling-eyebrow">Anchor styling</div>
                      <div className="piece-styling-title">Build a look around this piece</div>
                    </div>
                    <button
                      type="button"
                      className="piece-styling-back"
                      onClick={closePendingPiece}
                    >
                      <span aria-hidden="true">←</span> Back to chat
                    </button>
                  </div>
                  <div className="piece-styling-anchor">
                    {pendingPhotoSrc && (
                      <button
                        type="button"
                        onClick={event => { previewReturnFocusRef.current = event.currentTarget; setPreviewImage({
                          src: pendingPhotoSrc,
                          title: pendingPiece.name || 'Piece',
                          meta: pendingConfidence ? `${pendingConfidence.label} · ${pendingConfidence.detail}` : ''
                        }) }}
                        className="piece-styling-photo-button"
                        aria-label="Preview piece photo"
                      >
                        <img src={resolveUploadThumbnailSrc(pendingPhotoSrc, 'outfit-piece')} alt={pendingPiece.name} decoding="async" fetchPriority="high" />
                      </button>
                    )}
                    <div className="piece-styling-anchor-copy">
                      <span className="piece-styling-anchor-label">Your starting point</span>
                      {pendingPiece.id ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/wardrobe?pieceId=${pendingPiece.id}`)}
                          title="Open this piece's card in the Wardrobe"
                          className="piece-styling-piece-name"
                          onMouseEnter={e => { e.currentTarget.style.textDecorationColor = 'var(--border)' }}
                          onMouseLeave={e => { e.currentTarget.style.textDecorationColor = 'transparent' }}
                        >
                          {capitalizeFirst(pendingPiece.name)}
                        </button>
                      ) : (
                        <div className="piece-styling-piece-name">{capitalizeFirst(pendingPiece.name)}</div>
                      )}
                      {pendingConfidence && <div style={{ marginTop: 6 }}><span style={confidenceBadgeStyle(pendingConfidence.tone)}>{pendingConfidence.label} {pendingConfidence.detail}</span></div>}
                      <div className="piece-styling-anchor-note">It stays in every look; everything else is built in support of it.</div>
                    </div>
                  </div>
                </div>
              }
              sectionLabel="Choose a direction"
              footer={
                <>
                  <div className="piece-styling-footer-note">
                    <SparkleIcon />
                    {pendingPieceMode === 'wardrobe' ? "We'll create several distinct looks around your anchor piece." : "We'll suggest new pieces that pair well with this one."}
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      if (pendingPieceMode === 'wardrobe') {
                        send({ piece: pendingPiece, input: 'Style this piece using my existing wardrobe.', generateOutfitMode: true, editorialVisualMode: false, includeMissingPieces: false, idealOnlyMode: false })
                      } else {
                        send({ piece: pendingPiece, input: 'Suggest ideal new pieces for this selected item. Ignore my wardrobe except for the selected item.', generateOutfitMode: false, editorialVisualMode: true, includeMissingPieces: false, idealOnlyMode: true })
                      }
                    }}
                    className="piece-styling-primary-action"
                  >
                    {loading ? 'Generating...' : (pendingPieceMode === 'wardrobe' ? 'Create my outfits' : 'Explore new pieces')} <span aria-hidden="true">→</span>
                  </button>
                </>
              }
            >
              <fieldset disabled={loading} style={{ border: 'none', margin: 0, padding: 0 }}>
              <div className="stylist-option-grid">
                <OptionCard
                  variant="radio"
                  icon={<WardrobeOptionIcon />}
                  selected={pendingPieceMode === 'wardrobe'}
                  title="Create outfits from my wardrobe"
                  description="Build several distinct looks around this piece using garments I already own."
                  onClick={() => setPendingPieceMode('wardrobe')}
                />
                <OptionCard
                  variant="radio"
                  icon={<NewPiecesOptionIcon />}
                  selected={pendingPieceMode === 'ideal'}
                  title="Suggest new pieces"
                  description="Explore additions that would make this piece easier or more interesting to wear."
                  onClick={() => setPendingPieceMode('ideal')}
                />
              </div>

              <div className="piece-styling-context-heading">
                <span>Shape the brief</span>
                <span>Optional — adjust only what matters today</span>
              </div>
              <div className="piece-styling-context-grid">
                <div style={{ flex: '1 1 120px' }}>
                  <div style={wardrobeBuilderFieldLabelStyle}>Occasion</div>
                  <StylistSelect value={generateOccasion} onChange={setGenerateOccasion} options={OCCASION_OPTIONS} ariaLabel="Occasion" />
                </div>
                <div style={{ flex: '1.3 1 150px' }}>
                  <div style={wardrobeBuilderFieldLabelStyle}>Activity</div>
                  <StylistSelect value={generateActivity} onChange={setGenerateActivity} options={ACTIVITY_OPTIONS} ariaLabel="Activity" />
                </div>
                <div style={{ flex: '1 1 120px' }}>
                  <div style={wardrobeBuilderFieldLabelStyle}>Season</div>
                  <StylistSelect value={generateSeason} onChange={setGenerateSeason} options={PIECE_SEASON_OPTIONS} ariaLabel="Season" />
                </div>
                <div style={{ flex: '1.4 1 165px' }}>
                  <div style={{ ...wardrobeBuilderFieldLabelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Style direction</span>
                    <InfoTooltip className="style-direction-tooltip" label="What the style direction options mean" align="right" side="bottom" size="sm" width={310}>
                      {STYLE_DIRECTION_LEGEND.map(([label, desc]) => (
                        <div key={label} className={label === selectedPieceStyleDirectionLabel ? 'is-selected' : ''}><strong>{label}</strong><span>{desc}</span></div>
                      ))}
                    </InfoTooltip>
                  </div>
                  <StylistSelect value={generateMission} onChange={setGenerateMission} options={STYLE_DIRECTION_OPTIONS} ariaLabel="Style direction" side="top" />
                </div>
              </div>

              <div>
                <div style={wardrobeBuilderFieldLabelStyle}>Mood or styling request</div>
                <input
                  type="text"
                  value={generateMood}
                  onChange={e => setGenerateMood(e.target.value)}
                  placeholder="Optional mood or styling note..."
                  style={{ ...wardrobeBuilderControlStyle, width: '100%' }}
                />
              </div>
              </fieldset>
              {loading && (
                <div className="piece-styling-generating-status" role="status">
                  {loadingStatus || `Composing ${pendingPieceMode === 'wardrobe' ? 'outfits' : 'new-piece ideas'} around ${capitalizeFirst(pendingPiece.name)}…`}
                </div>
              )}
            </StylistLandingPanel>
          </div>
        )
      })()}

      {pendingOutfit && (() => {
        const pendingPhotoSrc = pendingPhoto ? resolveUploadImageSrc(pendingPhoto) : null
        const pieceCount = pendingOutfit.pieces?.length || 0
        return (
          <div ref={pendingActionRef} className="outfit-styling-workflow">
            <StylistLandingPanel
              className="outfit-styling-entry"
              header={
                <div className="outfit-styling-hero">
                  <div className="outfit-styling-heading-row">
                    <div>
                      <div className="piece-styling-eyebrow">Outfit styling</div>
                      <div className="outfit-styling-title">Work with this outfit</div>
                    </div>
                    <button
                      type="button"
                      className="piece-styling-back"
                      onClick={() => { setPendingOutfit(null); setPendingOutfitAction(null); setInput('') }}
                    >
                      <span aria-hidden="true">←</span> Back to chat
                    </button>
                  </div>
                  <div className="outfit-styling-anchor">
                    {pendingPhotoSrc && (
                      <button
                        type="button"
                        onClick={event => { previewReturnFocusRef.current = event.currentTarget; setPreviewImage({
                          src: pendingPhotoSrc,
                          title: pendingOutfit.name || 'Outfit',
                          meta: pendingConfidence ? `${pendingConfidence.label} · ${pendingConfidence.detail}` : ''
                        }) }}
                        className="outfit-styling-photo-button"
                        aria-label="Preview outfit photo"
                      >
                        <img src={resolveUploadThumbnailSrc(pendingPhotoSrc, 'outfit-piece')} alt={pendingOutfit.name} decoding="async" fetchPriority="high" />
                      </button>
                    )}
                    <div className="outfit-styling-anchor-copy">
                      <span className="piece-styling-anchor-label">Your starting point</span>
                      {pendingOutfit.id ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/outfits?outfitId=${pendingOutfit.id}`)}
                          title="Open this outfit's card in Lookbook"
                          className="outfit-styling-outfit-name"
                          onMouseEnter={e => { e.currentTarget.style.textDecorationColor = 'var(--border)' }}
                          onMouseLeave={e => { e.currentTarget.style.textDecorationColor = 'transparent' }}
                        >
                          {pendingOutfit.name}
                        </button>
                      ) : (
                        <div className="outfit-styling-outfit-name">{pendingOutfit.name}</div>
                      )}
                      <div className="outfit-styling-meta">
                        {pieceCount} piece{pieceCount === 1 ? '' : 's'}
                        {pendingOutfit.occasion ? ` · ${pendingOutfit.occasion.charAt(0).toUpperCase()}${pendingOutfit.occasion.slice(1)}` : ''}
                        {pendingOutfit.season ? ` · ${pendingOutfit.season.charAt(0).toUpperCase()}${pendingOutfit.season.slice(1)}` : ''}
                      </div>
                      <div className="outfit-styling-anchor-note">Use this look as the reference point for feedback, variations, or a new direction.</div>
                    </div>
                  </div>
                </div>
              }
              sectionLabel="Choose a direction"
              footer={
                <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden="true">🛡</span> Your outfit and wardrobe stay private.
                </div>
              }
            >
              <fieldset disabled={loading} style={{ border: 'none', margin: 0, padding: 0 }}>
              <div className="stylist-option-grid outfit-styling-options">
                <OptionCard
                  icon={<ReviewOutfitIcon />}
                  title={loading && pendingOutfitAction === 'review' ? 'Reviewing…' : 'Review this outfit'}
                  description="Get feedback on what works, what could be improved, and why."
                  onClick={() => {
                    setPendingOutfitAction('review')
                    send({ outfit: pendingOutfit, input: 'Evaluate this outfit. Tell me whether the pieces work together, what feels risky, and what I should change first.', responseMode: 'full' })
                    setPendingOutfit(null)
                  }}
                />
                <OptionCard
                  icon={<SimilarLooksIcon />}
                  title={loading && pendingOutfitAction === 'similar' ? 'Finding similar looks…' : 'Find similar looks'}
                  description="See similar outfit ideas using pieces you own."
                  onClick={() => {
                    setPendingOutfitAction('similar')
                    send({ outfit: { ...pendingOutfit, imageGenerationMode: true, variantMode: 'formula' }, input: 'Create formula-similar outfits from my wardrobe based on this saved look.' })
                  }}
                />
                <OptionCard
                  icon={<RestyleOutfitIcon />}
                  title={loading && pendingOutfitAction === 'restyle' ? 'Restyling…' : 'Restyle the main piece'}
                  description="Build different outfits around the key garment."
                  onClick={() => {
                    setPendingOutfitAction('restyle')
                    send({ outfit: { ...pendingOutfit, imageGenerationMode: true, variantMode: 'creative' }, input: 'Generate creative alternatives from this saved outfit photo and linked garment references.' })
                  }}
                />
              </div>
              <div className="outfit-question-section">
                <div className="stylist-landing-section-label">Ask something specific</div>
                <div className="outfit-question-shell">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setPendingOutfitAction('question'); send({ responseMode: 'followup' }) } }}
                  placeholder="Ask about shoes, proportions, occasion, or how to change the look…"
                  className="outfit-question-input"
                />
                <button
                  type="button"
                  onClick={() => { setPendingOutfitAction('question'); send({ responseMode: 'followup' }) }}
                  disabled={loading || !input.trim()}
                  className="outfit-question-send"
                  aria-label="Send outfit question"
                >
                  <span aria-hidden="true">→</span>
                </button>
                </div>
              </div>
              </fieldset>
              {loading && (
                <div className="outfit-styling-generating-status" role="status">
                  {loadingStatus || (pendingOutfitAction === 'question' ? 'Answering your question…' : 'Composing your outfit direction…')}
                </div>
              )}
            </StylistLandingPanel>
          </div>
        )
      })()}

      {messages.length > 1 && renderComposerDock()}
      {previewImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stylist-preview-title"
          onClick={() => setPreviewImage(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20,18,16,0.82)', display: 'grid', placeItems: 'center', padding: 20 }}
        >
          <div
            ref={previewDialogRef}
            onClick={e => e.stopPropagation()}
            style={{ width: 'min(960px, 96vw)', maxHeight: '92vh', display: 'grid', gap: 10 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', color: '#fff' }}>
              <div style={{ minWidth: 0 }}>
                <div id="stylist-preview-title" style={{ fontSize: 14, fontWeight: 700 }}>{previewImage.title}</div>
                {previewImage.meta && <div style={{ fontSize: 12, opacity: 0.78 }}>{previewImage.meta}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {previewImage.pieceId && (
                  <button
                    className="chip"
                    onClick={() => {
                      openPieceEditor(previewImage.pieceId)
                      setPreviewImage(null)
                    }}
                  >
                    Edit item card
                  </button>
                )}
                <button ref={previewCloseRef} className="chip" onClick={() => setPreviewImage(null)}>Close</button>
              </div>
            </div>
            <img
              src={previewImage.src}
              alt={previewImage.title}
              style={{ maxWidth: '100%', maxHeight: '84vh', objectFit: 'contain', justifySelf: 'center', borderRadius: 8, boxShadow: '0 18px 60px rgba(0,0,0,0.35)' }}
            />
          </div>
        </div>
      )}
      {editPiece && (
        <PieceForm
          piece={editPiece}
          onSave={(updatedPiece) => {
            setEditPiece(null)
            setPieces(prev => prev.map(piece => Number(piece.id) === Number(updatedPiece.id) ? updatedPiece : piece))
            triggerToast(`Updated ${updatedPiece.name}`)
          }}
          onCancel={() => setEditPiece(null)}
        />
      )}
      </div>
    </div>
  )
}
