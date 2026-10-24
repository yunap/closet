// The chat dispatcher sends a selected-piece turn to "ideal new pieces" (garments the user does not
// own) when this pattern matches. thread_1792781414837: "ok these are not bad, but let's think about
// these pants some more. what else can you see to pair these with in my wardrobe?" matched `not.*wardrobe`
// and got four pieces the owner does not own. Only an explicit ask to go outside the wardrobe counts.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
const literal = source.match(/const editorialRequestPattern = (\/.+\/[a-z]*)\n/)[1]
const pattern = new Function(`return ${literal}`)()

test('a wardrobe question that merely contains "not" stays in the wardrobe', () => {
  for (const q of [
    "ok these are not bad, but let's think about these pants some more. what else can you see to pair these with in my wardrobe?",
    'not sure what in my wardrobe goes with this',
    "this isn't working — show me other options from my wardrobe",
  ]) assert.equal(pattern.test(q), false, q)
})

test('an explicit request for pieces outside the wardrobe still goes to ideal new pieces', () => {
  for (const q of [
    'suggest ideal new pieces for this',
    'what new pieces would complete this?',
    'show me things not in my wardrobe',
    'something outside my wardrobe',
    'ideas beyond my wardrobe',
    "don't use my wardrobe",
  ]) assert.equal(pattern.test(q), true, q)
})
