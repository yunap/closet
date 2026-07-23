import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')

test('the interface loads real sans-serif weights used by controls', () => {
  assert.match(html, /DM\+Sans:wght@300;400;500;600;700/)
})

test('shared typography tokens define the working interface hierarchy', () => {
  assert.match(css, /--font-display:\s*var\(--font-serif\)/)
  assert.match(css, /--font-reading:\s*var\(--font-sans\)/)
  assert.match(css, /--type-eyebrow:\s+12px/)
  assert.match(css, /--type-caption:\s+12px/)
  assert.match(css, /--type-meta:\s+13px/)
  assert.match(css, /--type-control:\s+14px/)
  assert.match(css, /--type-body:\s+15px/)
  assert.match(css, /--type-title:\s+28px/)
})

test('long-form stylist reading uses the sans reading face at the body scale', () => {
  assert.match(css, /\.stylist-markdown\s*\{[\s\S]*font-family:\s*var\(--font-reading\);[\s\S]*font-size:\s*var\(--type-body\);[\s\S]*line-height:\s*1\.68/)
  assert.match(css, /\.stylist-critique-details-body p\s*\{[\s\S]*font-family:\s*var\(--font-reading\);[\s\S]*font-size:\s*var\(--type-body\) !important;[\s\S]*line-height:\s*1\.65/)
})

test('decision-critical outfit labels and actions are not treated as tiny metadata', () => {
  assert.match(css, /\.stylist-outfit-piece-name\s*\{[\s\S]*font-size:\s*var\(--type-meta\)/)
  assert.match(css, /\.stylist-outfit-reason > summary\s*\{[\s\S]*font-size:\s*var\(--type-meta\)/)
  assert.match(css, /\.stylist-outfit-actions > button\s*\{[\s\S]*font-size:\s*var\(--type-caption\) !important/)
})

test('the interface does not use hard-coded sub-12px working text', () => {
  assert.doesNotMatch(css, /font-size:\s*(?:8|9|10|11)(?:\.\d+)?px/)
  assert.match(css, /\.style-memory-note\s*\{[\s\S]*font-size:\s*var\(--type-meta\)/)
  assert.match(css, /\.outfit-card-occasion\s*\{[\s\S]*font-size:\s*var\(--type-meta\)/)
})

test('the lightest text and focus tokens remain readable and palette-consistent', () => {
  assert.match(css, /--text-light:\s+#776958/)
  assert.match(css, /--focus-ring:\s+var\(--accent\)/)
  assert.doesNotMatch(css, /#(?:1f6feb|2563eb)/i)
})

test('repeated user messages use a restrained semantic aubergine tint', () => {
  assert.match(css, /--conversation-user-bg:\s*color-mix\(in srgb,\s*var\(--accent-light\) 28%,\s*var\(--surface\)\)/)
  assert.match(css, /--conversation-user-border:\s*color-mix\(in srgb,\s*var\(--accent\) 12%,\s*var\(--border\)\)/)
  assert.match(css, /\.ai-message\.user\s*\{[^}]*background:\s*var\(--conversation-user-bg\)/s)
  assert.doesNotMatch(css, /\.ai-message\.user\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--accent-light\) 72%/s)
})

test('keyboard focus and reduced-motion preferences have global foundations', () => {
  assert.match(css, /:where\(button, a, input, textarea, select, summary, \[role="button"\]\):focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--focus-ring\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*transition-duration:\s*0\.01ms !important/)
})
