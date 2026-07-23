// Spec 32 Part 2's edit surface: the style constitution is per-user DATA, and the user
// reading what their stylist believes about them — and correcting it directly — is the
// product's core loop. Every save appends the prior text to constitution_history (the
// ruling-archaeology log); the interviewable layers link back into the wizard for a re-run.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

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
const LEARNING_TYPES = new Set(['owner_rule', 'preference_reaction', 'correction'])

const card = { background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 16, padding: '20px 22px', marginBottom: 16, boxShadow: '0 10px 28px rgba(64, 47, 29, 0.045)' }
const inputStyle = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' }
const primaryBtn = { padding: '7px 14px', borderRadius: 9, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const quietBtn = { padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12.5, cursor: 'pointer' }

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
  const [contextualFeedback, setContextualFeedback] = useState([])
  const [feedbackBoards, setFeedbackBoards] = useState([])
  const [feedbackLoading, setFeedbackLoading] = useState(true)
  const [feedbackSearch, setFeedbackSearch] = useState('')
  const [demo, setDemo] = useState(null)
  const [learningDrafts, setLearningDrafts] = useState({})
  const [sessions, setSessions] = useState([])
  const [sessionsExpanded, setSessionsExpanded] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState(null)
  const [apiKeyDrafts, setApiKeyDrafts] = useState({ anthropicKey: '', openAiKey: '' })
  const [isAdmin, setIsAdmin] = useState(false)
  const [status, setStatus] = useState('')

  const load = async () => {
    setFeedbackLoading(true)
    try {
      const [p, h, c] = await Promise.all([
        fetch('/api/settings/profile').then(r => r.json()),
        fetch('/api/settings/home-location').then(r => r.json()),
        fetch('/api/settings/constitution').then(r => r.json())
      ])
      setProfile(p)
      setHomeLocation(h.homeLocation || '')
      setLayers(c.layers || [])
      const [feedback, savedBoards] = await Promise.all([
        fetch('/api/stylist-feedback?limit=1000').then(r => r.json()).catch(() => []),
        fetch('/api/saved-boards?limit=500').then(r => r.json()).catch(() => []),
      ])
      const feedbackRows = Array.isArray(feedback) ? feedback : []
      setLearnings(feedbackRows.filter(row => LEARNING_TYPES.has(row.feedback_type)))
      setContextualFeedback(feedbackRows.filter(row => !LEARNING_TYPES.has(row.feedback_type)))
      setFeedbackBoards(Array.isArray(savedBoards) ? savedBoards : [])
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
      flash('Learning updated.'); load()
    } else flash('Failed to update learning')
  }

  const archiveLearning = async (row) => {
    const res = await fetch(`/api/stylist-feedback/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) })
    if (res.ok) { flash('Learning retired — it will no longer influence styling.'); load() }
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
  const matchingContextualFeedback = contextualFeedback.filter(row => {
    if (!normalizedFeedbackSearch) return true
    return [row.context_name, row.label, row.note, row.feedback_type]
      .some(value => String(value || '').toLowerCase().includes(normalizedFeedbackSearch))
  })
  const visibleContextualFeedback = matchingContextualFeedback.slice(0, 40)

  const feedbackBoardImage = row => row?.payload?.board?.imageUrl || row?.payload?.board?.image_url || ''
  const matchedFeedbackBoard = row => {
    const imageUrl = feedbackBoardImage(row)
    return imageUrl ? feedbackBoards.find(board => board.image_url === imageUrl) : null
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
    const referencedPieceId = row?.payload?.pieceId || row?.payload?.piece?.id
    if (row.feedback_type === 'wrong_item_read' && referencedPieceId) {
      navigate(`/wardrobe?pieceId=${referencedPieceId}`)
      return
    }
    if (row.referenced_thread_id && onGoToThread) {
      onGoToThread(row.referenced_thread_id)
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
    <div className={`settings-page ${mode === 'style' ? 'settings-page--style' : 'settings-page--account'}`} style={{ maxWidth: mode === 'style' ? 820 : 860, margin: '0 auto', padding: embedded ? '8px 0 48px' : '38px 28px 72px' }}>
      <div className="settings-page-header">
      <h1 className="settings-page-title">{mode === 'style' ? 'Style profile' : 'Settings'}</h1>
      <p className="settings-page-intro">
        {mode === 'style'
          ? 'This is your stylist’s working understanding of you — plain text, yours to correct.'
          : `Manage your profile, AI provider keys, ${isAdmin ? 'administration, ' : ''}and account security.`}
      </p>
      </div>
      {status && <div style={{ padding: '8px 12px', borderRadius: 9, background: 'var(--donate-bg)', color: 'var(--donate)', fontSize: 13, marginBottom: 12 }}>{status}</div>}

      {mode !== 'style' && profile && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Profile</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Name</div>
              <input style={inputStyle} value={profile.displayName} onChange={e => setProfile({ ...profile, displayName: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 90px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Pronouns (subject/object/possessive)</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={inputStyle} value={profile.pronouns.subject} onChange={e => setProfile({ ...profile, pronouns: { ...profile.pronouns, subject: e.target.value, plural: e.target.value.trim() === 'they' } })} />
                <input style={inputStyle} value={profile.pronouns.object} onChange={e => setProfile({ ...profile, pronouns: { ...profile.pronouns, object: e.target.value } })} />
                <input style={inputStyle} value={profile.pronouns.possessive} onChange={e => setProfile({ ...profile, pronouns: { ...profile.pronouns, possessive: e.target.value } })} />
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Home location (live weather)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={inputStyle} value={homeLocation} onChange={e => setHomeLocation(e.target.value)} />
              <button style={quietBtn} onClick={saveHomeLocation}>Save</button>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button style={primaryBtn} onClick={saveProfile}>Save profile</button>
          </div>
        </div>
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
        <details style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <summary style={{ padding: '16px 20px', cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
            Data & maintenance
          </summary>
          <div style={{ padding: '0 20px 18px', borderTop: '1px solid var(--border-light)' }}>
            <h3 style={{ margin: '16px 0 6px', fontSize: 14 }}>Sample wardrobe</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>{demo.count} demo pieces are in your wardrobe.</span>
              <button
                style={quietBtn}
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
      {learnings.map(row => (
        <div key={row.id} style={{ ...card, padding: '12px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{row.feedback_type.replace('_', ' ')}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{row.created_at}</span>
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 48, marginTop: 8, fontSize: 13 }}
            value={learningDrafts[row.id] ?? row.note}
            onChange={e => setLearningDrafts({ ...learningDrafts, [row.id]: e.target.value })}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button style={quietBtn} onClick={() => archiveLearning(row)}>Retire</button>
            {learningDrafts[row.id] !== undefined && learningDrafts[row.id] !== row.note && (
              <button style={primaryBtn} onClick={() => saveLearning(row)}>Save</button>
            )}
          </div>
        </div>
      ))}
      </section>

      <section className="style-profile-section style-profile-learnings">
        <div className="style-profile-section-heading">
          <div>
            <span>Contextual memory</span>
            <h2>Outfit &amp; garment feedback</h2>
          </div>
          <p>Feedback tied to a particular outfit, garment, or generated result. It does not become a global style rule.</p>
        </div>
        <input
          type="search"
          style={{ ...inputStyle, marginBottom: 12 }}
          value={feedbackSearch}
          onChange={event => setFeedbackSearch(event.target.value)}
          placeholder="Search by outfit, garment, feedback, or note…"
          aria-label="Search outfit and garment feedback"
        />
        {matchingContextualFeedback.length > visibleContextualFeedback.length && (
          <div style={{ margin: '-4px 0 12px', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Showing the first {visibleContextualFeedback.length} of {matchingContextualFeedback.length} matches. Refine the search to narrow the list.
          </div>
        )}
        {feedbackLoading && (
          <div className="style-profile-empty">Loading outfit and garment feedback…</div>
        )}
        {!feedbackLoading && visibleContextualFeedback.length === 0 && (
          <div className="style-profile-empty">
            {feedbackSearch.trim() ? 'No contextual feedback matches this search.' : 'No outfit or garment feedback saved yet.'}
          </div>
        )}
        {visibleContextualFeedback.map(row => {
          const contextLabel = row.context_name || (row.context_type === 'wardrobe' ? 'Whole wardrobe' : '') || row.label || 'Saved styling result'
          const canOpenContext = ['outfit', 'piece'].includes(row.context_type) && row.context_id
          const canOpenBoard = Boolean(row.referenced_board_id || matchedFeedbackBoard(row) || (row.target_type === 'generated_visual_board' && feedbackBoardImage(row)))
          const canOpenGarment = row.feedback_type === 'wrong_item_read' && Boolean(row?.payload?.pieceId || row?.payload?.piece?.id)
          const canOpenThread = !canOpenBoard && !canOpenGarment && Boolean(row.referenced_thread_id && onGoToThread)
          return (
            <div key={row.id} style={{ ...card, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 360px' }}>
                  <div style={{ fontSize: 11, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {row.feedback_type.replaceAll('_', ' ')}{row.is_gold ? ' · Gold' : ''}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 14, fontWeight: 650, color: 'var(--text)' }}>{contextLabel}</div>
                  {row.label && row.label !== contextLabel && <div style={{ marginTop: 2, fontSize: 12, color: 'var(--text-muted)' }}>{row.label}</div>}
                  <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-muted)' }}>{row.note || 'No note saved.'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{row.created_at}</span>
                  {canOpenContext && !canOpenBoard && !canOpenGarment && !canOpenThread && (
                    <button style={quietBtn} onClick={() => openFeedbackContext(row)}>
                      Open {row.context_type === 'outfit' ? 'outfit' : 'garment'}
                    </button>
                  )}
                  {canOpenBoard && (
                    <button style={quietBtn} onClick={() => openFeedbackContext(row)}>
                      Open board
                    </button>
                  )}
                  {canOpenGarment && (
                    <button style={quietBtn} onClick={() => openFeedbackContext(row)}>Open garment</button>
                  )}
                  {canOpenThread && (
                    <button style={quietBtn} onClick={() => openFeedbackContext(row)}>Open source chat</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </section>
      </>}

      {mode !== 'style' && <>
      <h2>AI provider keys</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        {apiKeyStatus?.hasOperatorKeyAccess
          ? "Bring your own Anthropic and/or OpenAI keys — they're used for your requests instead of the operator's. Leave blank to keep using the operator's keys."
          : "You don't have access to the operator's keys yet — add your own below, or ask the operator to approve your account."}
      </p>
      {apiKeyStatus && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                Anthropic key {apiKeyStatus.hasOwnAnthropicKey ? '(set)' : apiKeyStatus.hasOperatorKeyAccess ? '(using operator\'s)' : '(none — no operator access)'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={inputStyle}
                  type="password"
                  placeholder={apiKeyStatus.hasOwnAnthropicKey ? '••••••••••••' : 'sk-ant-...'}
                  value={apiKeyDrafts.anthropicKey}
                  onChange={e => setApiKeyDrafts({ ...apiKeyDrafts, anthropicKey: e.target.value })}
                />
                <button style={quietBtn} disabled={!apiKeyDrafts.anthropicKey} onClick={() => saveApiKey('anthropicKey', apiKeyDrafts.anthropicKey)}>Save</button>
                {apiKeyStatus.hasOwnAnthropicKey && (
                  <button style={quietBtn} onClick={() => saveApiKey('anthropicKey', '')}>Clear</button>
                )}
              </div>
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                OpenAI key {apiKeyStatus.hasOwnOpenAiKey ? '(set)' : apiKeyStatus.hasOperatorKeyAccess ? '(using operator\'s)' : '(none — no operator access)'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={inputStyle}
                  type="password"
                  placeholder={apiKeyStatus.hasOwnOpenAiKey ? '••••••••••••' : 'sk-...'}
                  value={apiKeyDrafts.openAiKey}
                  onChange={e => setApiKeyDrafts({ ...apiKeyDrafts, openAiKey: e.target.value })}
                />
                <button style={quietBtn} disabled={!apiKeyDrafts.openAiKey} onClick={() => saveApiKey('openAiKey', apiKeyDrafts.openAiKey)}>Save</button>
                {apiKeyStatus.hasOwnOpenAiKey && (
                  <button style={quietBtn} onClick={() => saveApiKey('openAiKey', '')}>Clear</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isAdmin && (
        <>
        <h2>Administration</h2>
        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Manage this installation</div>
            <div style={{ marginTop: 3, fontSize: 12.5, color: 'var(--text-muted)' }}>Manage users, access, invites, and operator settings.</div>
          </div>
          <Link to="/admin" style={{ ...primaryBtn, textDecoration: 'none', display: 'inline-block' }}>Open Administration</Link>
        </div>
        </>
      )}

      <h2>Security & sessions</h2>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {currentSession ? friendlySessionName(currentSession.userAgentLabel) : 'Current session'}
              <span style={{ color: 'var(--accent)', fontSize: 11.5, fontWeight: 600 }}> · this session</span>
            </div>
            <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--text-muted)' }}>
              {currentSession ? relativeSessionTime(currentSession.lastSeen) : 'Currently signed in'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {otherSessions.length > 0 && <button style={quietBtn} onClick={revokeOtherSessions}>Sign out other sessions</button>}
            <button style={quietBtn} onClick={logout}>Sign out</button>
          </div>
        </div>

        {otherSessions.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={() => setSessionsExpanded(open => !open)}
              aria-expanded={sessionsExpanded}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, color: 'var(--accent)', fontSize: 12.5, fontWeight: 700, textAlign: 'left' }}
            >
              <span>{sessionsExpanded ? 'Hide' : 'View'} {otherSessions.length} other {otherSessions.length === 1 ? 'session' : 'sessions'}</span>
              <span aria-hidden="true">{sessionsExpanded ? '↑' : '↓'}</span>
            </button>

            {sessionsExpanded && (
              <div style={{ marginTop: 8 }}>
                {otherSessions.map(session => (
                  <div key={session.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid var(--border-light)', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{friendlySessionName(session.userAgentLabel)}</div>
                      <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--text-muted)' }}>{relativeSessionTime(session.lastSeen)}</div>
                    </div>
                    <button style={quietBtn} onClick={() => revokeSession(session.id)}>Revoke session</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </>}
    </div>
  )
}
