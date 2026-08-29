import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Editorial ideal-additions directions (the "Explore ideal additions" / "Suggest ideal new
// pieces" flow) used to never populate threadMemory, so a follow-up question about a specific
// direction had no structured card data to answer from -- generatedOutfits stayed [] on every
// /ask call regardless of what was just shown. See routes/ai.js's compactFreeformContext:
// context.outfits comes from body.generatedOutfits, which only exists when threadMemory.type is
// 'generated_outfits'. This test guards the three call sites that generate editorial directions
// (board-seeded, selected-piece, and active-context) actually wire that up.
const chatSource = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')

test('editorial ideal-additions directions populate threadMemory so follow-ups have card context', () => {
  const occurrences = chatSource.match(/source: 'ideal_editorial_directions'/g) || []
  // Each of the three call sites (board-seeded, selected-piece, active-context) uses the tag
  // twice: once as threadMemory.source, once passed into compactGeneratedOutfitContext's meta.
  assert.equal(occurrences.length, 6, 'expected three call sites, each tagging both threadMemory.source and the context-builder meta')

  assert.match(chatSource, /type: 'generated_outfits',\s*\n\s*source: 'ideal_editorial_directions',\s*\n\s*id: activeContext\.id,/, 'exploreIdealAdditionsFromBoard should wire threadMemory')
  assert.match(chatSource, /type: 'generated_outfits',\s*\n\s*source: 'ideal_editorial_directions',\s*\n\s*id: pieceToSend\.id,/, 'the selected-piece editorial-directions branch should wire threadMemory')
  const activeContextMatches = chatSource.match(/type: 'generated_outfits',\s*\n\s*source: 'ideal_editorial_directions',\s*\n\s*id: activeContext\.id,/g) || []
  assert.ok(activeContextMatches.length >= 2, 'both the board-seeded and active-context branches key threadMemory off activeContext.id')
})

test('compactGeneratedOutfitContext discloses proposed-not-owned pieces and fallback status', () => {
  assert.match(chatSource, /meta\.source === 'ideal_editorial_directions'/)
  assert.match(chatSource, /there is no saved garment record, tag data, or photograph for it/)
  assert.match(chatSource, /meta\.usedFallback \? '.*deterministic template/)
  assert.match(chatSource, /Suggested additions \(not owned\): \$\{outfit\.missingPieces\.join\(' \+ '\)\}/)
})
