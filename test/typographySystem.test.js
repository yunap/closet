import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')

test('the interface loads real sans-serif weights used by controls', () => {
  assert.match(html, /DM\+Sans:wght@300;400;500;600;700/)
})

test('shared typography tokens define the working interface hierarchy', () => {
  assert.match(css, /--type-eyebrow:\s+10px/)
  assert.match(css, /--type-caption:\s+11px/)
  assert.match(css, /--type-meta:\s+12px/)
  assert.match(css, /--type-control:\s+13px/)
  assert.match(css, /--type-body:\s+14px/)
  assert.match(css, /--type-title:\s+28px/)
})

test('modernized reading and memory surfaces do not use sub-10px working text', () => {
  const modernizedStart = css.indexOf('/* Style profile reads as working guidance')
  const modernizedCss = css.slice(modernizedStart)
  assert.doesNotMatch(modernizedCss, /font-size:\s*(?:8|9)(?:\.\d+)?px/)
  assert.match(css, /\.style-memory-note\s*\{[\s\S]*font-size:\s*var\(--type-meta\)/)
  assert.match(css, /\.outfit-card-occasion\s*\{[\s\S]*font-size:\s*var\(--type-meta\)/)
})
