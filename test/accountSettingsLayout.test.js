import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/views/StylistSettings.jsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('account settings has distinct operational sections without changing their actions', () => {
  assert.match(source, /<h2>Profile &amp; location<\/h2>/)
  assert.match(source, /<h2>Provider keys<\/h2>/)
  assert.match(source, /<h2>Security &amp; sessions<\/h2>/)
  assert.match(source, /onClick=\{saveProfile\}/)
  assert.match(source, /onClick=\{saveHomeLocation\}/)
  assert.match(source, /saveApiKey\('anthropicKey'/)
  assert.match(source, /saveApiKey\('openAiKey'/)
  assert.match(source, /onClick=\{logout\}/)
})

test('profile fields use explicit labels and explain weather context', () => {
  assert.match(source, /htmlFor="settings-display-name"/)
  assert.match(source, /htmlFor="settings-pronoun-subject"/)
  assert.match(source, /htmlFor="settings-pronoun-object"/)
  assert.match(source, /htmlFor="settings-pronoun-possessive"/)
  assert.match(source, /htmlFor="settings-home-location"/)
  assert.match(source, /Used for live weather when you ask for outfit advice\./)
})

test('settings layout is structured on desktop and stacks at mobile width', () => {
  assert.match(css, /\.account-settings-grid\s*\{[\s\S]*grid-template-columns:/)
  assert.match(css, /\.account-settings-provider\s*\{[\s\S]*grid-template-columns:/)
  assert.match(css, /\.account-settings-current-badge\s*\{[\s\S]*var\(--accent-light\)/)
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.account-settings-grid,[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.account-settings-session-current,[\s\S]*flex-direction:\s*column/)
})

test('sample-data maintenance remains secondary and disclosed', () => {
  assert.match(source, /<details className="account-settings-disclosure">/)
  assert.match(source, /Manage sample content stored in this wardrobe\./)
  assert.match(source, /Remove all demo pieces/)
})
