// Spec 33 Part 2 — minimal login page. No open registration (invite-gated, see
// Register.jsx); this is the only door back in for an existing account.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed'); return }
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
            <p className="auth-eyebrow">Your personal wardrobe workspace</p>
            <h1>Your clothes, made more useful.</h1>
            <p>Keep track of what you own, work through outfit questions, and teach your stylist what genuinely works for you.</p>
          </div>
          <p className="auth-privacy-note">Your wardrobe and styling history stay private to your account.</p>
        </section>

        <section className="auth-form-panel" aria-labelledby="login-heading">
          <div className="auth-form-heading">
            <p className="auth-eyebrow">Welcome back</p>
            <h2 id="login-heading">Sign in to your wardrobe</h2>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="login-email">Email</label>
            <input id="login-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p className="auth-account-link">
            Have an invite code? <Link to="/register">Create an account</Link>
          </p>
        </section>
      </div>
    </div>
  )
}
