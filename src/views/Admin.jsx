// Spec 34 Part 4 — the admin UI. Replaces create-invite.js/reset-password.js/
// approve-operator-key.js as the normal path; those scripts stay as break-glass.
import { useEffect, useState } from 'react'

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px', marginBottom: 16 }
const inputStyle = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' }
const primaryBtn = { padding: '7px 14px', borderRadius: 9, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const quietBtn = { padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12.5, cursor: 'pointer' }
const dangerBtn = { ...quietBtn, borderColor: 'var(--donate)', color: 'var(--donate)' }
const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes, i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${units[i]}`
}

export default function Admin() {
  const [users, setUsers] = useState([])
  const [invites, setInvites] = useState([])
  const [requests, setRequests] = useState([])
  const [status, setStatus] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [resetCode, setResetCode] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [confirmEmailInput, setConfirmEmailInput] = useState('')

  const flash = (msg) => { setStatus(msg); setTimeout(() => setStatus(''), 3000) }

  const load = async () => {
    try {
      const usersRes = await fetch('/api/admin/users')
      if (usersRes.status === 403) { setForbidden(true); setLoaded(true); return }
      const { users } = await usersRes.json()
      setUsers(users)
      const { invites } = await fetch('/api/admin/invites').then(r => r.json())
      setInvites(invites)
      const { requests } = await fetch('/api/admin/invite-requests').then(r => r.json())
      setRequests(requests)
    } catch (err) {
      flash(`Failed to load admin data: ${err.message}`)
    } finally {
      setLoaded(true)
    }
  }
  useEffect(() => { load() }, [])

  const patchUser = async (id, path, body) => {
    const res = await fetch(`/api/admin/users/${id}/${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) { flash((await res.json()).error || 'Action failed'); return false }
    return true
  }

  const toggleOperatorKey = async (u) => { if (await patchUser(u.id, 'operator-key-approval', { approved: !u.operatorKeyApproved })) { flash('Updated.'); load() } }
  const toggleStatus = async (u) => { if (await patchUser(u.id, 'status', { status: u.status === 'active' ? 'disabled' : 'active' })) { flash('Updated.'); load() } }
  const toggleAdmin = async (u) => { if (await patchUser(u.id, 'admin', { isAdmin: !u.isAdmin })) { flash('Updated.'); load() } }

  const resetPassword = async (u) => {
    const res = await fetch(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' })
    if (!res.ok) return flash('Failed to generate reset code')
    const { code } = await res.json()
    setResetCode({ email: u.email, code })
  }

  const revokeSessions = async (u) => {
    const res = await fetch(`/api/admin/users/${u.id}/revoke-sessions`, { method: 'POST' })
    if (!res.ok) return flash('Failed to revoke sessions')
    const { revoked } = await res.json()
    flash(`Revoked ${revoked} session${revoked === 1 ? '' : 's'}.`)
    load()
  }

  const confirmDelete = async () => {
    const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmEmail: confirmEmailInput }) })
    if (!res.ok) return flash((await res.json()).error || 'Delete failed')
    setDeleteTarget(null); setConfirmEmailInput('')
    flash('User deleted.'); load()
  }

  const mintInvite = async () => {
    const res = await fetch('/api/admin/invites', { method: 'POST' })
    const { code } = await res.json()
    flash(`Invite minted: ${code}`)
    load()
  }

  const revokeInviteCode = async (code) => {
    const res = await fetch(`/api/admin/invites/${code}`, { method: 'DELETE' })
    if (!res.ok) return flash('Failed to revoke — already used')
    flash('Invite revoked.'); load()
  }

  const decideRequest = async (id, decision) => {
    const res = await fetch(`/api/admin/invite-requests/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: decision }) })
    if (!res.ok) return flash('Failed to update request')
    const data = await res.json()
    if (data.code) flash(`Approved — invite code: ${data.code}`)
    else flash('Request dismissed.')
    load()
  }

  if (!loaded) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
  if (forbidden) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>You don't have access to this page.</div>

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 20px 60px' }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Administration</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 0 }}>Users, invites, and requests for this instance.</p>
      {status && <div style={{ padding: '8px 12px', borderRadius: 9, background: 'var(--donate-bg)', color: 'var(--donate)', fontSize: 13, marginBottom: 12 }}>{status}</div>}

      <h2 style={{ fontSize: 18, margin: '22px 0 10px' }}>Users</h2>
      <div style={card}>
        {users.map(u => (
          <div key={u.id} style={rowStyle}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {u.email} {u.isAdmin && <span style={{ color: 'var(--accent)', fontSize: 11 }}>· admin</span>} {u.status === 'disabled' && <span style={{ color: 'var(--donate)', fontSize: 11 }}>· disabled</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                joined {u.createdAt} · last seen {u.lastSeen || 'never'} · {u.sessionCount} session{u.sessionCount === 1 ? '' : 's'} · {formatBytes(u.storageBytes)}
                {' · '}{u.operatorKeyApproved ? 'operator key: approved' : 'operator key: not approved'}
                {(u.hasOwnAnthropicKey || u.hasOwnOpenAiKey) && ' · own key set'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={quietBtn} onClick={() => toggleOperatorKey(u)}>{u.operatorKeyApproved ? 'Revoke key access' : 'Approve key access'}</button>
              <button style={quietBtn} onClick={() => toggleStatus(u)}>{u.status === 'active' ? 'Disable' : 'Re-enable'}</button>
              <button style={quietBtn} onClick={() => toggleAdmin(u)}>{u.isAdmin ? 'Remove admin' : 'Make admin'}</button>
              <button style={quietBtn} onClick={() => resetPassword(u)}>Reset password</button>
              <button style={quietBtn} onClick={() => revokeSessions(u)}>Revoke sessions</button>
              <button style={dangerBtn} onClick={() => setDeleteTarget(u)}>Delete</button>
            </div>
          </div>
        ))}
        {users.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No users yet.</div>}
      </div>

      <h2 style={{ fontSize: 18, margin: '22px 0 10px' }}>Invites</h2>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button style={primaryBtn} onClick={mintInvite}>Mint invite</button>
        </div>
        {invites.map(inv => (
          <div key={inv.code} style={rowStyle}>
            <div>
              <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{inv.code}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {inv.used_by_email ? `used by ${inv.used_by_email} on ${inv.used_at}` : `unused · minted ${inv.created_at}`}
              </div>
            </div>
            {!inv.used_by_email && <button style={quietBtn} onClick={() => revokeInviteCode(inv.code)}>Revoke</button>}
          </div>
        ))}
        {invites.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No invites minted yet.</div>}
      </div>

      <h2 style={{ fontSize: 18, margin: '22px 0 10px' }}>Invite requests</h2>
      <div style={card}>
        {requests.map(r => (
          <div key={r.id} style={rowStyle}>
            <div>
              <div style={{ fontSize: 13 }}>{r.email}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{r.note || 'no note'} · {r.status} · {r.created_at}</div>
            </div>
            {r.status === 'pending' && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={quietBtn} onClick={() => decideRequest(r.id, 'approved')}>Approve</button>
                <button style={quietBtn} onClick={() => decideRequest(r.id, 'dismissed')}>Dismiss</button>
              </div>
            )}
          </div>
        ))}
        {requests.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No requests yet.</div>}
      </div>

      {resetCode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ ...card, maxWidth: 420, margin: 0 }}>
            <h3 style={{ marginTop: 0, fontSize: 16 }}>One-time reset code for {resetCode.email}</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>This is shown once — hand it to them personally. They'll use it at login to set a new password.</p>
            <div style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 16, textAlign: 'center', marginBottom: 12 }}>{resetCode.code}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button style={primaryBtn} onClick={() => setResetCode(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ ...card, maxWidth: 420, margin: 0 }}>
            <h3 style={{ marginTop: 0, fontSize: 16, color: 'var(--donate)' }}>Delete {deleteTarget.email}?</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              This removes the account, every session, and their entire data directory — wardrobe, photos, everything. There is no undo. Type their email to confirm.
            </p>
            <input style={inputStyle} value={confirmEmailInput} onChange={e => setConfirmEmailInput(e.target.value)} placeholder={deleteTarget.email} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button style={quietBtn} onClick={() => { setDeleteTarget(null); setConfirmEmailInput('') }}>Cancel</button>
              <button style={dangerBtn} disabled={confirmEmailInput.toLowerCase().trim() !== deleteTarget.email} onClick={confirmDelete}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
