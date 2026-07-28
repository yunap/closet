import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { feedbackWeight } from '../styling-engine/rules.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const stylistChatPath = path.join(__dirname, '../src/components/StylistChat.jsx')

test('rules.js feedbackWeight preserves historical scoring keys', () => {
  assert.equal(feedbackWeight('good_formula'), 14)
  assert.equal(feedbackWeight('good_pieces'), 16)
  assert.equal(feedbackWeight('fit_issue'), -34)
  assert.equal(feedbackWeight('bad_occasion'), -22)
  assert.equal(feedbackWeight('works'), 22)
  assert.equal(feedbackWeight('not_me'), -32)
  assert.equal(feedbackWeight('wrong_item_read'), -24)
})

test('StylistChat.jsx defines correct outfit feedback labels', () => {
  const content = fs.readFileSync(stylistChatPath, 'utf8')

  // Assert that OUTFIT_FEEDBACK_LABELS is defined
  assert.ok(content.includes('const OUTFIT_FEEDBACK_LABELS = ['))

  // Assert OUTFIT_FEEDBACK_LABELS contains works and not_me
  assert.match(content, /['"]works['"]\s*,\s*['"]More like this['"]/)
  assert.match(content, /['"]not_me['"]\s*,\s*['"]Not for me['"]/)

  // Assert they are the only ones in OUTFIT_FEEDBACK_LABELS
  const match = content.match(/const OUTFIT_FEEDBACK_LABELS = \[\s*([\s\S]*?\n\])/)
  assert.ok(match, 'OUTFIT_FEEDBACK_LABELS definition not found')
  const arrayContent = match[1]
  assert.ok(arrayContent.includes('works'), 'Should include works')
  assert.ok(arrayContent.includes('not_me'), 'Should include not_me')

  // Count elements in arrayContent by counting nested brackets `[...]`
  const count = (arrayContent.match(/\[\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]\s*\]/g) || []).length
  assert.equal(count, 2, 'OUTFIT_FEEDBACK_LABELS should have exactly 2 elements')
})

test('StylistChat.jsx does not use disabled={isSaved} on outfit-level feedback buttons', () => {
  const content = fs.readFileSync(stylistChatPath, 'utf8')

  // Find the OUTFIT_FEEDBACK_LABELS.map loop
  const loopMatch = content.match(/OUTFIT_FEEDBACK_LABELS\.map\([\s\S]*?<button[\s\S]*?<\/button>/)
  assert.ok(loopMatch, 'OUTFIT_FEEDBACK_LABELS loop not found')
  const buttonContent = loopMatch[0]
  assert.ok(!buttonContent.includes('disabled={isSaved}'), 'Outfit-level buttons must not be disabled when saved')
})

test('StylistChat.jsx renames piece issue to Replace in this outfit', () => {
  const content = fs.readFileSync(stylistChatPath, 'utf8')

  assert.ok(content.includes('Replace in this outfit'), 'Should include Replace in this outfit')
  assert.ok(content.includes('✓ Replaced in this outfit'), 'Should include ✓ Replaced in this outfit')
  assert.ok(!content.includes("'piece issue'") && !content.includes('"piece issue"'), 'Should not contain old name')
})
