import test from 'node:test'
import assert from 'node:assert/strict'
import { db, parsePiece } from '../db.js'
import { compatibilityScoreForSelectedItem } from '../styling-engine/rules.js'
import { bottomKind, fabricWeight } from '../styling-engine/attributes.js'

test('Whale stripe tee hot weather recommendations include appropriate shorts/lightweight bottoms', () => {
  // Query all active pieces
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  
  const selectedPiece = allPieces.find(p => p.id === 1)
  assert.ok(selectedPiece, 'Whale stripe tee (ID 1) should exist')
  
  // Get bottom candidates for the top
  const candidates = allPieces.filter(p => p.id !== selectedPiece.id && p.category === 'bottom')
  
  const options = { occasion: 'casual', mood: 'it is really hot', weatherProfile: null }
  
  // Score and sort candidates
  const list = candidates.map(p => {
    const res = compatibilityScoreForSelectedItem(selectedPiece, p, options)
    return { piece: p, score: res.score, reasons: res.reasons || [] }
  })
  
  // Tie-breaker matches the sorting in the app
  const ranked = list.sort((a, b) => 
    b.score - a.score || 
    Number(b.piece.favorite) - Number(a.piece.favorite) || 
    String(a.piece.category).localeCompare(String(b.piece.category)) ||
    a.piece.id - b.piece.id
  )
  
  const top12 = ranked.slice(0, 12)
  const top12Ids = top12.map(x => x.piece.id)
  
  // 1. Assert beige tailored linen shorts (ID 242) is recommended in the top-12
  const hasBeigeShorts = top12Ids.includes(242)
  assert.ok(hasBeigeShorts, 'Beige tailored linen shorts (ID 242) must be in the top-12')
  
  // 2. Count shorts and lightweight skirts in the top-12
  const hotAppropriate = top12.filter(item => {
    const kind = bottomKind(item.piece)
    const weight = fabricWeight(item.piece)
    return kind === 'shorts' || kind === 'skirt-mini' || kind === 'skirt-midi' || weight === 'light'
  })
  
  assert.ok(hotAppropriate.length >= 2, `Should recommend >= 2 hot-appropriate bottoms, found ${hotAppropriate.length}`)
  
  // 3. Jeans carrying 'hot weather: insulating coverage' must not outnumber hot-appropriate bottoms
  const insulatingJeans = top12.filter(item => {
    const isInsulating = item.reasons.includes('hot weather: insulating coverage')
    const name = String(item.piece.name || '').toLowerCase()
    return isInsulating && (name.includes('jean') || name.includes('denim'))
  })
  
  assert.ok(insulatingJeans.length <= hotAppropriate.length, 
    `Insulating jeans (${insulatingJeans.length}) should not outnumber hot-appropriate bottoms (${hotAppropriate.length})`
  )
})
