import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownMessage from '../src/components/MarkdownMessage.js'

const render = (text) => renderToStaticMarkup(React.createElement(MarkdownMessage, { text }))

// Spec: chat message markdown rendering. Assistant prose must render as real HTML elements, not
// literal markdown characters, and must never execute embedded HTML.

test('headers, bold, and numbered lists render as HTML elements, not literal markdown', () => {
  const html = render('### Winery Lunch\n\nTry the **linen set**.\n\n1. Option one\n2. Option two')
  assert.match(html, /<h3>Winery Lunch<\/h3>/)
  assert.match(html, /<strong>linen set<\/strong>/)
  assert.match(html, /<ol>[\s\S]*<li>Option one<\/li>[\s\S]*<li>Option two<\/li>[\s\S]*<\/ol>/)
  // The raw markdown tokens must not survive into the output as literal text.
  assert.ok(!html.includes('###'), 'no literal ### heading token')
  assert.ok(!html.includes('**'), 'no literal ** bold token')
})

test('bulleted lists and inline code render as elements', () => {
  const html = render('- first\n- second\n\nUse `search_wardrobe` first.')
  assert.match(html, /<ul>[\s\S]*<li>first<\/li>[\s\S]*<li>second<\/li>[\s\S]*<\/ul>/)
  assert.match(html, /<code>search_wardrobe<\/code>/)
})

test('style overrides are applied via the scoped wrapper class', () => {
  const html = render('**hello**')
  assert.match(html, /^<div class="stylist-markdown">/)
})

test('no HTML injection: embedded script/tags render as inert escaped text', () => {
  const html = render('Careful: <script>alert(1)</script> and <img src=x onerror=alert(2)>')
  assert.ok(!/<script>/.test(html), 'no live <script> tag in output')
  assert.ok(!/<img/.test(html), 'no live <img> tag in output (images disallowed + raw HTML escaped)')
  assert.match(html, /&lt;script&gt;/, 'script tag is escaped to inert text')
})

test('plain text with no markdown still renders inside the wrapper', () => {
  const html = render('just a normal sentence.')
  assert.match(html, /<div class="stylist-markdown">[\s\S]*just a normal sentence\.[\s\S]*<\/div>/)
})

test('empty/undefined text does not throw', () => {
  assert.doesNotThrow(() => render(''))
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(MarkdownMessage, {})))
})
