import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const chatSource = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')
const cssSource = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('outfit chat context renders as a readable conversation subject', () => {
  assert.match(chatSource, /className="stylist-conversation-subject"/)
  assert.match(chatSource, /className="stylist-conversation-subject-photo"/)
  assert.match(chatSource, /className="stylist-conversation-subject-copy"/)
  assert.match(chatSource, /contextType: outfitToSend \? 'outfit'/)
  assert.match(chatSource, /m\.contextType === 'wardrobe'[\s\S]*\? 'Wardrobe'[\s\S]*m\.contextType === 'outfit'[\s\S]*\? 'Outfit'[\s\S]*: 'Piece'/)
  assert.match(cssSource, /\.stylist-conversation-subject\s*\{[\s\S]*grid-template-columns:\s*104px minmax\(0, 1fr\)/)
})

test('established chats suppress the generic new-chat introduction', () => {
  assert.match(
    chatSource,
    /if \(i === 0 && m\.role === 'assistant' && String\(m\.text \|\| ''\)\.includes\('personal stylist'\)\) \{\s*return null/
  )
})

test('whole-wardrobe composer chats do not masquerade as piece contexts', () => {
  assert.match(chatSource, /\{ role: 'user', text: userText, contextType: 'wardrobe' \}/)
  assert.match(chatSource, /const isWardrobeSessionMessage = m\.contextType === 'wardrobe'/)
  assert.match(chatSource, /!m\.imagePrev[\s\S]*\^use my wardrobe\$[\s\S]*\^use my wardrobe to create outfits/)
  assert.match(chatSource, /!isWardrobeSessionMessage && \(m\.imagePrev \|\| m\.contextName\)/)
})

test('generated outfit results use the styling worksheet hierarchy', () => {
  assert.match(chatSource, /className="stylist-outfit-result-body"/)
  assert.match(chatSource, /className="stylist-outfit-result-heading"/)
  assert.match(chatSource, /className="stylist-outfit-piece-list"/)
  assert.match(chatSource, /className="stylist-outfit-reason"/)
  assert.match(chatSource, /className="stylist-outfit-actions"/)
  assert.match(cssSource, /\.stylist-response-shell\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/)
  assert.match(cssSource, /\.stylist-outfit-result-card\s*\{[\s\S]*background:\s*var\(--surface\)/)
})

test('outfit directions prioritize comparison-scale garment imagery and readable support text', () => {
  assert.match(chatSource, /aria-label=\{`Pieces in \$\{cardDisplayTitle\}`\}/)
  assert.match(cssSource, /\.stylist-outfit-piece\s*\{[\s\S]*width:\s*112px/)
  assert.match(cssSource, /\.stylist-outfit-piece-photo\s*\{[\s\S]*width:\s*112px;[\s\S]*height:\s*124px/)
  assert.match(cssSource, /\.stylist-outfit-piece-name\s*\{[\s\S]*font-size:\s*var\(--type-meta\)/)
  assert.match(cssSource, /\.stylist-outfit-result-meta\s*\{[\s\S]*font-size:\s*13px/)
  assert.match(chatSource, /resolveUploadThumbnailSrc\(photo, 'chat-garment'\)/)
  assert.match(chatSource, /loading="lazy" decoding="async"/)
})

test('generated outfit evaluation renders one loading state and one inline critique', () => {
  assert.equal((chatSource.match(/Evaluating this outfit\.\.\./g) || []).length, 1)
  assert.equal(chatSource.split('<CritiqueBody text={critiqueText} />').length - 1, 1)
})

test('critique prose uses the shared readable body scale and a controlled line length', () => {
  assert.match(chatSource, /const CritiqueBody = \(\{ text \}\)/)
  assert.doesNotMatch(chatSource, /<CritiqueBody[^>]*fontSize=/)
  assert.match(cssSource, /\.stylist-critique-body p\s*\{[\s\S]*max-width:\s*68ch;[\s\S]*font-size:\s*var\(--type-body\)/)
  assert.match(cssSource, /\.stylist-critique-details-body p\s*\{[\s\S]*max-width:\s*68ch;[\s\S]*color:\s*var\(--text\);[\s\S]*font-family:\s*var\(--font-reading\);[\s\S]*font-size:\s*var\(--type-body\) !important;[\s\S]*line-height:\s*1\.65/)
})

test('established chat composer stays pinned without covering the final result', () => {
  assert.match(cssSource, /\.stylist-chat-scroll\.is-existing-chat \.chat-thread\s*\{[\s\S]*padding-bottom:\s*28px/)
  assert.match(cssSource, /\.stylist-composer-dock\.is-sticky\s*\{[\s\S]*position:\s*sticky;[\s\S]*bottom:\s*0;/)
  assert.match(cssSource, /\.stylist-composer-dock\.is-sticky \.stylist-input-shell,[\s\S]*width:\s*min\(100%, 880px\);[\s\S]*margin-inline:\s*auto/)
})
