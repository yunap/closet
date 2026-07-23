import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const askClaudeSource = fs.readFileSync(new URL('../src/views/AskClaude.jsx', import.meta.url), 'utf8')
const lookbookSource = fs.readFileSync(new URL('../src/views/OutfitLookbook.jsx', import.meta.url), 'utf8')
const stylistChatSource = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')

test('Generated Outfits exposes the whole-wardrobe Visual Composer entry point', () => {
  assert.match(
    lookbookSource,
    /activeSubTab === 'generated-outfits'[\s\S]*onClick=\{onOpenVisualComposer\}[\s\S]*Create outfits/
  )
  assert.match(
    appSource,
    /navigate\('\/stylist\?compose=wardrobe'\)/
  )
  assert.match(
    askClaudeSource,
    /new URLSearchParams\(search\)\.get\('compose'\) === 'wardrobe'/
  )
  assert.match(
    stylistChatSource,
    /useState\(Boolean\(initialOpenVisualComposer\)\)/
  )
  assert.match(
    stylistChatSource,
    /const isLaunchingAction = initialOutfit \|\| initialPiece \|\| initialOpenVisualComposer/
  )
})

test('established conversations do not retain the global Visual Composer pathway', () => {
  assert.match(
    stylistChatSource,
    /\{!pending && messages\.length === 1 && \([\s\S]*className="composer-outfit-pathway"/
  )
})
