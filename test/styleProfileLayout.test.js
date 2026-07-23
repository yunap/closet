import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/views/StylistSettings.jsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('all style profile memory sections use the document row system', () => {
  assert.match(source, /Learned rules & preferences[\s\S]*className="style-memory-list"/)
  assert.match(source, /Outfit &amp; styling feedback[\s\S]*className="style-memory-list"/)
  assert.match(source, /className="style-memory-row style-memory-row--editable"/)
  assert.match(source, /className="style-memory-row style-memory-row--context"/)
  assert.match(css, /\.style-memory-list\s*\{[\s\S]*border-top:\s*1px solid var\(--border\)/)
  assert.match(css, /\.style-memory-row\s*\{[\s\S]*border-bottom:\s*1px solid var\(--border-light\)/)
})

test('learned rules are read-first and require an explicit edit action', () => {
  assert.match(source, /editingLearningId === row\.id/)
  assert.match(source, /className="style-memory-rule">\{row\.note\}/)
  assert.match(source, />\s*Edit\s*<\/button>/)
  assert.match(source, />Retire<\/button>/)
  assert.match(css, /\.style-memory-read-layout\s*\{[\s\S]*display:\s*flex/)
})

test('contextual memory can be filtered without discarding its source context', () => {
  assert.match(source, /const CONTEXT_FILTERS = \[[\s\S]*Generated boards/)
  assert.doesNotMatch(source, /\['piece', 'Garments'\]/)
  assert.match(source, /function feedbackContextKind\(row\)/)
  assert.match(source, /return 'outfit'/)
  assert.match(source, /className="style-memory-type-filter"/)
  assert.match(source, /className=\{`style-memory-filter \$\{feedbackContextFilter === value \? 'active' : ''\}`\}/)
  assert.match(css, /\.style-memory-filter\.active\s*\{[\s\S]*var\(--accent-light\)/)
})

test('contextual memory progressively reveals results and hides raw metadata by default', () => {
  assert.match(source, /const FEEDBACK_PAGE_SIZE = 40/)
  assert.match(source, /setFeedbackVisibleCount\(count => count \+ FEEDBACK_PAGE_SIZE\)/)
  assert.match(source, /className="style-memory-show-more"/)
  assert.match(source, /function readableFeedbackNote\(value\)/)
  assert.match(source, /<details className="style-memory-technical">/)
  assert.match(source, /<summary>Technical details<\/summary>/)
  assert.match(css, /\.style-memory-technical dl\s*\{[\s\S]*grid-template-columns:/)
})
