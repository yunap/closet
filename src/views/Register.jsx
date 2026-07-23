// Spec 33 Part 2 — invite-gated signup. No open registration in v1: an unused invite
// code (minted via scripts/create-invite.js) is required.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

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
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-introduction" aria-labelledby="auth-product-name">
          <div className="auth-brand">
            <span className="auth-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 4.25a2.25 2.25 0 1 1 2.25 2.25L12 8.25" />
                <path d="m4.5 17 6.2-6.1a1.85 1.85 0 0 1 2.6 0l6.2 6.1" />
                <path d="M4.5 17h15" />
              </svg>
            </span>
            <span id="auth-product-name">Wardrobe</span>
          </div>
          <div className="auth-introduction-copy">
            <p className="auth-eyebrow">A wardrobe built around real life</p>
            <h1>Make more of the clothes you own.</h1>
            <p>Organize your wardrobe, explore complete outfits, and build styling guidance that becomes more useful as you use it.</p>
          </div>
          <p className="auth-privacy-note">Your wardrobe and styling history stay private to your account.</p>
        </section>

        <section className="auth-form-panel auth-form-panel--register" aria-labelledby="register-heading">
          <div className="auth-form-heading">
            <p className="auth-eyebrow">Invite only</p>
            <h2 id="register-heading">Create your account</h2>
            <p className="auth-form-description">Enter the invitation code you received to begin.</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="register-invite">Invite code</label>
            <input id="register-invite" autoComplete="one-time-code" required value={inviteCode} onChange={e => setInviteCode(e.target.value)} />
            <label htmlFor="register-email">Email</label>
            <input id="register-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
            <label htmlFor="register-password">Password</label>
            <input id="register-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} />
            <p className="auth-field-hint">Use at least 8 characters.</p>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</button>
          </form>
          <p className="auth-account-link">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </section>
      </div>
    </div>
  )
}
