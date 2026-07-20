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
const INTERVIEW_STEPS = { body_contract: 'comfort', aesthetic_gravity: 'aesthetic', working_style: 'working' }
// The durable learned classes: rules the stylist stored from conversations
// (store_user_correction → owner_rule; persisted preference reactions). Card-level
// taste feedback stays in the chat's context-scoped Learning panel.
const LEARNING_TYPES = new Set(['owner_rule', 'preference_reaction', 'correction'])

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px', marginBottom: 16 }
const inputStyle = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' }
const primaryBtn = { padding: '7px 14px', borderRadius: 9, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const quietBtn = { padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12.5, cursor: 'pointer' }

export default function StylistSettings() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [homeLocation, setHomeLocation] = useState('')
  const [layers, setLayers] = useState([])
  const [drafts, setDrafts] = useState({})
  const [historyFor, setHistoryFor] = useState(null)
  const [historyRows, setHistoryRows] = useState([])
  const [learnings, setLearnings] = useState([])
  const [demo, setDemo] = useState(null)
  const [learningDrafts, setLearningDrafts] = useState({})
  const [sessions, setSessions] = useState([])
  const [apiKeyStatus, setApiKeyStatus] = useState(null)
  const [apiKeyDrafts, setApiKeyDrafts] = useState({ anthropicKey: '', openAiKey: '' })
  const [status, setStatus] = useState('')

  const load = async () => {
    try {
      const [p, h, c] = await Promise.all([
        fetch('/api/settings/profile').then(r => r.json()),
        fetch('/api/settings/home-location').then(r => r.json()),
        fetch('/api/settings/constitution').then(r => r.json())
      ])
      setProfile(p)
      setHomeLocation(h.homeLocation || '')
      setLayers(c.layers || [])
      const feedback = await fetch('/api/stylist-feedback?limit=200').then(r => r.json()).catch(() => [])
      setLearnings((Array.isArray(feedback) ? feedback : []).filter(row => LEARNING_TYPES.has(row.feedback_type)))
      setDemo(await fetch('/api/settings/demo-wardrobe').then(r => r.json()).catch(() => null))
      const sessionData = await fetch('/api/auth/sessions').then(r => r.json()).catch(() => null)
      setSessions(sessionData?.sessions || [])
      setApiKeyStatus(await fetch('/api/settings/api-keys').then(r => r.json()).catch(() => null))
      setApiKeyDrafts({ anthropicKey: '', openAiKey: '' })
    } catch (err) {
      setStatus(`Failed to load settings: ${err.message}`)
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

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 60px' }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Stylist Settings</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 0 }}>
        This is everything your stylist believes about you — plain text, yours to correct.
      </p>
      {status && <div style={{ padding: '8px 12px', borderRadius: 9, background: 'var(--donate-bg)', color: 'var(--donate)', fontSize: 13, marginBottom: 12 }}>{status}</div>}

      {profile && (
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

      <h2 style={{ fontSize: 18, margin: '22px 0 10px' }}>Style constitution</h2>
      {layers.map(({ layer, body, updatedAt, isDefault }) => (
        <div key={layer} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{LAYER_TITLES[layer] || layer}</h3>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {isDefault ? 'default — not yet personalized' : (updatedAt ? `updated ${updatedAt}` : '')}
            </div>
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 120, marginTop: 10, fontFamily: 'monospace', fontSize: 12.5 }}
            value={drafts[layer] ?? body}
            onChange={e => setDrafts({ ...drafts, [layer]: e.target.value })}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {INTERVIEW_STEPS[layer] && (
                <Link to={`/onboarding?step=${INTERVIEW_STEPS[layer]}&return=settings`} style={{ ...quietBtn, textDecoration: 'none', display: 'inline-block' }}>Redo interview</Link>
              )}
              {!isDefault && <button style={quietBtn} onClick={() => showHistory(layer)}>{historyFor === layer ? 'Hide history' : 'History'}</button>}
            </div>
            {drafts[layer] !== undefined && drafts[layer] !== body && (
              <button style={primaryBtn} onClick={() => saveLayer(layer)}>Save layer</button>
            )}
          </div>
          {historyFor === layer && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10, display: 'grid', gap: 8 }}>
              {historyRows.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No history yet.</div>}
              {historyRows.map(row => (
                <div key={row.id} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  <div style={{ fontWeight: 600 }}>{row.created_at} · {row.source}</div>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 11.5, background: 'var(--surface-2)', padding: 8, borderRadius: 8 }}>{row.prior_body ?? '(no prior text — first write)'}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {demo && (
        <div style={card}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Demo wardrobe</h3>
          {demo.count > 0 ? (
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
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>Explore the stylist with {demo.available} sample pieces — removable any time.</span>
              <button
                style={quietBtn}
                onClick={async () => {
                  const res = await fetch('/api/settings/demo-wardrobe', { method: 'POST' })
                  if (res.ok) { flash('Demo wardrobe loaded.'); load() }
                }}
              >Load demo wardrobe</button>
            </div>
          )}
        </div>
      )}

      <h2 style={{ fontSize: 18, margin: '22px 0 4px' }}>Learned rules & preferences</h2>
      <p style={{ ...{ color: 'var(--text-muted)', fontSize: 13 }, marginTop: 0 }}>
        Durable rules your stylist stored from conversations ("I don't wear…", weather corrections).
        These live alongside the constitution and every future styling turn respects them.
      </p>
      {learnings.length === 0 && (
        <div style={card}><div style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>Nothing learned yet — corrections you give in chat land here.</div></div>
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

      <h2 style={{ fontSize: 18, margin: '22px 0 10px' }}>API keys</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        Bring your own Anthropic and/or OpenAI keys — they're used for your requests instead of the operator's. Leave blank to keep using the operator's keys.
      </p>
      {apiKeyStatus && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                Anthropic key {apiKeyStatus.hasOwnAnthropicKey ? '(set)' : '(using operator\'s)'}
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
                OpenAI key {apiKeyStatus.hasOwnOpenAiKey ? '(set)' : '(using operator\'s)'}
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

      <h2 style={{ fontSize: 18, margin: '22px 0 10px' }}>Account & sessions</h2>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: sessions.length ? 12 : 0 }}>
          <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Signed in on {sessions.length} {sessions.length === 1 ? 'device' : 'devices'}.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {sessions.length > 1 && <button style={quietBtn} onClick={revokeOtherSessions}>Sign out other devices</button>}
            <button style={quietBtn} onClick={logout}>Sign out</button>
          </div>
        </div>
        {sessions.map(s => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13 }}>{s.userAgentLabel || 'Unknown device'} {s.isCurrent && <span style={{ color: 'var(--accent)', fontSize: 11.5 }}>· this device</span>}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>last seen {s.lastSeen}</div>
            </div>
            <button style={quietBtn} onClick={() => revokeSession(s.id)}>{s.isCurrent ? 'Sign out' : 'Revoke'}</button>
          </div>
        ))}
      </div>
    </div>
  )
}
