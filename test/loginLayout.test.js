import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/views/Login.jsx', import.meta.url), 'utf8')
const registerSource = fs.readFileSync(new URL('../src/views/Register.jsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('login presents product context without changing the invite-gated flow', () => {
  assert.match(source, /className="auth-brand"/)
  assert.match(source, /Your clothes, made more useful\./)
  assert.match(source, /Keep track of what you own, work through outfit questions/)
  assert.match(source, /Have an invite code\?/)
  assert.match(source, /to="\/register"/)
})

test('login uses an intentional desktop composition and a simple mobile flow', () => {
  assert.match(css, /\.auth-shell\s*\{[\s\S]*grid-template-columns:/)
  assert.match(css, /\.auth-introduction\s*\{[\s\S]*border-right:/)
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.auth-shell\s*\{[\s\S]*display:\s*block/)
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.auth-page\s*\{[\s\S]*padding:\s*0/)
})

test('login controls follow the app accent and neutralize browser autofill', () => {
  assert.match(css, /\.auth-submit\s*\{[\s\S]*background:\s*var\(--accent\)/)
  assert.match(css, /\.auth-account-link a\s*\{[\s\S]*color:\s*var\(--accent\)/)
  assert.match(css, /\.auth-form input:-webkit-autofill[\s\S]*var\(--surface\) inset/)
  assert.match(source, /className="auth-error" role="alert"/)
})

test('invite registration shares the auth shell and preserves its account contract', () => {
  assert.match(registerSource, /className="auth-page"/)
  assert.match(registerSource, /className="auth-shell"/)
  assert.match(registerSource, /<h2 id="register-heading">Create your account<\/h2>/)
  assert.match(registerSource, /id="register-invite" autoComplete="one-time-code" required/)
  assert.match(registerSource, /id="register-password" type="password" autoComplete="new-password" required minLength=\{8\}/)
  assert.match(registerSource, /Use at least 8 characters\./)
  assert.match(registerSource, /to="\/login"/)
})
