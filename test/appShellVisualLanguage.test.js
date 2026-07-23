import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('desktop primary navigation uses quiet rows rather than nested icon cards', () => {
  assert.match(css, /\.primary-nav__item \.primary-nav__icon\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;/)
  assert.match(css, /\.primary-nav__item\.active\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--surface-selected\)[\s\S]*?box-shadow:\s*none;/)
})

test('generated outfit creation remains prominent in the existing accent palette', () => {
  const rule = css.match(/\.lookbook-create-outfits\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(rule, /background:\s*var\(--accent\)/)
  assert.match(rule, /min-height:\s*40px/)
  assert.match(rule, /font-weight:\s*700/)
})

test('working-area controls compact at the 1024px layout', () => {
  assert.match(css, /@media \(max-width: 1120px\)\s*\{[\s\S]*?\.lookbook-filter-toolbar \.search-bar-lookbook\s*\{[\s\S]*?flex-basis:\s*100%/)
  assert.match(css, /@media \(max-width: 1120px\)\s*\{[\s\S]*?\.thread-rail\s*\{[\s\S]*?width:\s*248px/)
})
