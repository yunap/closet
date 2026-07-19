// Spec 33 Part 2 — invite-gated signup. No open registration in v1: an unused invite
// code (minted via scripts/create-invite.js) is required.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '28px 26px', maxWidth: 360, margin: '80px auto 0' }
const label = { display: 'block', fontSize: 13, fontWeight: 650, color: 'var(--text)', margin: '14px 0 6px' }
const inputStyle = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' }
const primaryBtn = { width: '100%', padding: '10px 18px', borderRadius: 10, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 18 }

export default function Register() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, inviteCode })
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Registration failed'); return }
      navigate('/wardrobe', { replace: true })
    } catch {
      setError('Could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={card}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Create your wardrobe</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginTop: 0 }}>Invite-only for now — you'll need a code.</p>
      <form onSubmit={submit}>
        <label style={label} htmlFor="register-invite">Invite code</label>
        <input id="register-invite" style={inputStyle} required value={inviteCode} onChange={e => setInviteCode(e.target.value)} />
        <label style={label} htmlFor="register-email">Email</label>
        <input id="register-email" style={inputStyle} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        <label style={label} htmlFor="register-password">Password</label>
        <input id="register-password" style={inputStyle} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} />
        {error && <div style={{ color: 'var(--donate)', fontSize: 13, marginTop: 10 }}>{error}</div>}
        <button style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }} type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 16, textAlign: 'center' }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  )
}
