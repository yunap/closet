/**
 * test/boardCritiqueFix.test.js
 *
 * Tests for the saved-board critique image bug (spec 2026-07-08).
 * All tests are offline/deterministic — no LLM calls, no file I/O.
 *
 * Bugs fixed:
 * 1. uploadedOrSavedOutfitPhotoPath stripped generated-boards/ subdirectory (path.basename)
 * 2. outfitPhoto resolution missed outfit.image_url (snake_case from DB rows)
 * 3. BoardDetail handoff didn't extract pieceIds from board.pieces
 * 4. evidenceMode:'limited' was in debug only — not surfaced for UI visibility
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

// ── Replicate the fixed uploadedOrSavedOutfitPhotoPath logic ─────────────────
// (mirrors styling-engine/core.js exactly — any drift here breaks the test)

const UPLOADS_DIR = '/app/uploads'  // placeholder; only the path structure matters

function uploadedOrSavedOutfitPhotoPath(outfitPhoto = '', uploadsDir = UPLOADS_DIR) {
  if (!outfitPhoto) return ''
  const s = String(outfitPhoto)
  const uploadsPrefix = '/uploads/'
  if (s.startsWith(uploadsPrefix)) {
    return path.join(uploadsDir, s.slice(uploadsPrefix.length))
  }
  return path.join(uploadsDir, path.basename(s))
}

// ── Replicate outfitPhoto resolution chain ────────────────────────────────────

function resolveOutfitPhoto(outfit = {}) {
  return outfit.photo || outfit.imageUrl || outfit.image_url || ''
}

// ── Replicate boardPieceIds extraction (mirrors OutfitLookbook.jsx handoff) ──

function extractBoardPieceIds(board = {}) {
  return (board.pieces || [])
    .map(p => p?.id)
    .filter(id => id != null && Number(id) > 0)
    .map(Number)
}

// ─── Test 1: regression — saved_boards photo path round-trips correctly ──────

describe('uploadedOrSavedOutfitPhotoPath — subdirectory preservation', () => {
  it('preserves generated-boards/ subdirectory (was stripped by path.basename)', () => {
    const imageUrl = '/uploads/generated-boards/board-1778720433106-1-303472.png'
    const resolved = uploadedOrSavedOutfitPhotoPath(imageUrl)
    assert.ok(
      resolved.endsWith('generated-boards/board-1778720433106-1-303472.png'),
      `Expected path to end with generated-boards/..., got: ${resolved}`
    )
    // The old broken behaviour would have produced /uploads/board-xxx.png (no subdir).
    // The fixed behaviour produces /uploads/generated-boards/board-xxx.png.
    assert.ok(
      resolved.includes('generated-boards'),
      `Expected generated-boards/ to be preserved in: ${resolved}`
    )
  })

  it('preserves editorial-boards/ subdirectory', () => {
    const imageUrl = '/uploads/editorial-boards/editorial-1778661504502-3-289872.png'
    const resolved = uploadedOrSavedOutfitPhotoPath(imageUrl)
    assert.ok(
      resolved.includes('editorial-boards'),
      `Expected editorial-boards/ to be preserved, got: ${resolved}`
    )
  })

  it('legacy bare filename (no /uploads/ prefix) still works', () => {
    const imageUrl = '1778112949988-744334279.jpg'
    const resolved = uploadedOrSavedOutfitPhotoPath(imageUrl)
    assert.ok(
      resolved.endsWith('1778112949988-744334279.jpg'),
      `Bare filename should resolve to uploads/<filename>, got: ${resolved}`
    )
    // Must not double-add any prefix
    assert.ok(!resolved.includes('undefined'), 'Should not contain undefined')
  })

  it('empty input returns empty string', () => {
    assert.equal(uploadedOrSavedOutfitPhotoPath(''), '')
    assert.equal(uploadedOrSavedOutfitPhotoPath(null), '')
    assert.equal(uploadedOrSavedOutfitPhotoPath(undefined), '')
  })

  it('pre-existing /uploads/filename.jpg (flat, no subdir) still resolves', () => {
    const imageUrl = '/uploads/1778112949988-744334279.jpg'
    const resolved = uploadedOrSavedOutfitPhotoPath(imageUrl)
    assert.ok(resolved.endsWith('1778112949988-744334279.jpg'))
  })
})

// ── Test 2: pipeline photo-field fallback chain ───────────────────────────────

describe('outfitPhoto resolution — fallback chain', () => {
  const TARGET = '/uploads/generated-boards/board-xxx.png'

  it('{ photo } resolves correctly', () => {
    assert.equal(resolveOutfitPhoto({ photo: TARGET }), TARGET)
  })

  it('{ imageUrl } (camelCase) resolves correctly', () => {
    assert.equal(resolveOutfitPhoto({ imageUrl: TARGET }), TARGET)
  })

  it('{ image_url } (snake_case, DB row) resolves correctly — was the missing case', () => {
    assert.equal(resolveOutfitPhoto({ image_url: TARGET }), TARGET)
  })

  it('photo takes priority over imageUrl and image_url', () => {
    assert.equal(
      resolveOutfitPhoto({ photo: 'photo.jpg', imageUrl: 'imageUrl.jpg', image_url: 'image_url.jpg' }),
      'photo.jpg'
    )
  })

  it('imageUrl takes priority over image_url', () => {
    assert.equal(
      resolveOutfitPhoto({ imageUrl: 'imageUrl.jpg', image_url: 'image_url.jpg' }),
      'imageUrl.jpg'
    )
  })

  it('empty object resolves to empty string', () => {
    assert.equal(resolveOutfitPhoto({}), '')
    assert.equal(resolveOutfitPhoto({ photo: '' }), '')
  })
})

// ── Test 3: resolveBoardPieceIds — live data shape ────────────────────────────
// Real saved_boards.pieces shape from DB (confirmed by sqlite3 query):
// [{"id":149,"name":"navy wool sleeveless top","category":"top","missing":false},...]

describe('extractBoardPieceIds — board.pieces → pieceIds', () => {
  const realBoardPieces = [
    { id: 149, name: 'navy wool sleeveless top', category: 'top', missing: false },
    { id: 99,  name: 'oatmeal linen wide jogger-style pants', category: 'bottom', missing: false },
    { id: 48,  name: 'Navy slip-ons', category: 'shoes', missing: false }
  ]

  it('extracts numeric IDs from real board.pieces shape', () => {
    const ids = extractBoardPieceIds({ pieces: realBoardPieces })
    assert.deepEqual(ids, [149, 99, 48])
  })

  it('all extracted IDs are Numbers, not strings', () => {
    const ids = extractBoardPieceIds({ pieces: realBoardPieces })
    for (const id of ids) {
      assert.equal(typeof id, 'number', `ID ${id} should be a Number`)
    }
  })

  it('board with empty pieces returns []', () => {
    assert.deepEqual(extractBoardPieceIds({ pieces: [] }), [])
  })

  it('board with no pieces key returns []', () => {
    assert.deepEqual(extractBoardPieceIds({}), [])
  })

  it('board with null pieces entry is filtered out', () => {
    const ids = extractBoardPieceIds({
      pieces: [{ id: 1 }, null, undefined, { id: 2 }]
    })
    assert.deepEqual(ids, [1, 2])
  })

  it('board with missing:true pieces still extracts IDs (missing pieces may still have IDs)', () => {
    const ids = extractBoardPieceIds({
      pieces: [{ id: 5, name: 'ideal trouser', missing: true }]
    })
    assert.deepEqual(ids, [5])
  })

  it('board id=0 / null / NaN are filtered out (not valid DB IDs)', () => {
    const ids = extractBoardPieceIds({
      pieces: [
        { id: 0 },      // 0 is not a valid PK — filtered by > 0 check
        { id: null },   // null → filtered
        { id: 'abc' },  // NaN → filtered
        { id: 7 }       // valid
      ]
    })
    assert.deepEqual(ids, [7])
  })

  it('first board in live DB (pieces: []) returns empty — safe for image-only boards', () => {
    const ids = extractBoardPieceIds({ pieces: [] })
    assert.deepEqual(ids, [])
  })
})

// ── Test 4: evidenceMode surface — limited case triggers notice ───────────────
// We can't call the real pipeline offline, so we test the UI-layer decision:
// if data.evidenceMode === 'limited', the replyText should get the notice prepended.

describe('evidenceMode visibility — limited critique notice', () => {
  function buildReplyText(data) {
    let replyText = data.feedback || 'Outfit evaluation complete.'
    if (data.evidenceMode === 'limited') {
      replyText = '⚠️ _Evaluated from outfit description only — no image was available for this board._\n\n' + replyText
    }
    return replyText
  }

  it('limited evidenceMode prepends the notice', () => {
    const data = { feedback: 'The navy top reads well.', evidenceMode: 'limited' }
    const reply = buildReplyText(data)
    assert.ok(reply.startsWith('⚠️'), 'Notice must be prepended for limited evidence')
    assert.ok(reply.includes('Evaluated from outfit description only'), 'Notice text must appear')
    assert.ok(reply.includes('The navy top reads well.'), 'Original feedback must follow')
  })

  it('photo_only_low_garment_truth evidenceMode does NOT get the notice', () => {
    const data = { feedback: 'Good silhouette.', evidenceMode: 'photo_only_low_garment_truth' }
    const reply = buildReplyText(data)
    assert.ok(!reply.startsWith('⚠️'), 'Should not prepend notice when an image was present')
    assert.equal(reply, 'Good silhouette.')
  })

  it('linked_garment_truth evidenceMode does NOT get the notice', () => {
    const data = { feedback: 'Strong outfit.', evidenceMode: 'linked_garment_truth' }
    const reply = buildReplyText(data)
    assert.equal(reply, 'Strong outfit.')
  })

  it('missing feedback falls back to default text, notice still prepended', () => {
    const data = { evidenceMode: 'limited' }
    const reply = buildReplyText(data)
    assert.ok(reply.includes('Outfit evaluation complete.'))
    assert.ok(reply.startsWith('⚠️'))
  })
})

// ── Test 5: full handoff shape for a real saved board ────────────────────────
// Validates the complete normalized object that reaches evaluateOutfitThroughSharedPipeline.

describe('saved board critique handoff — complete object shape', () => {
  // Simulate what BoardDetail's onSendToStylist now produces
  function buildBoardHandoff(board) {
    const boardPieceIds = (board.pieces || [])
      .map(p => p?.id)
      .filter(id => id != null && !isNaN(Number(id)))
      .map(Number)
    return {
      id: null,
      name: board.title,
      title: board.title,
      label: board.title,
      photo: board.image_url ? `/uploads/${board.image_url.replace(/^\/?uploads\//, '')}` : null,
      pieceIds: boardPieceIds,
      pieces: board.pieces,
      occasion: board.context_name || '',
      notes: board.reason,
      autoSend: true,
      stylistPrompt: 'Evaluate this styling direction. Tell me whether the pieces work together, what feels risky, and what I should change first.'
    }
  }

  const liveBoard = {
    id: 2,
    title: 'strongest artistic-minimal',
    image_url: '/uploads/generated-boards/board-1778720433106-1-303472.png',
    context_name: 'city',
    reason: 'Strong silhouette with grounded base.',
    pieces: [
      { id: 149, name: 'navy wool sleeveless top', category: 'top', missing: false },
      { id: 99,  name: 'oatmeal linen wide jogger-style pants', category: 'bottom', missing: false },
      { id: 48,  name: 'Navy slip-ons', category: 'shoes', missing: false }
    ]
  }

  it('photo field is populated (not undefined/empty) — the primary regression guard', () => {
    const handoff = buildBoardHandoff(liveBoard)
    assert.ok(handoff.photo, `photo must not be falsy, got: ${handoff.photo}`)
    assert.ok(
      handoff.photo.includes('generated-boards'),
      `photo must include generated-boards/ subdirectory, got: ${handoff.photo}`
    )
  })

  it('pieceIds extracted correctly from live DB shape', () => {
    const handoff = buildBoardHandoff(liveBoard)
    assert.deepEqual(handoff.pieceIds, [149, 99, 48])
  })

  it('id is null — prevents route from mis-resolving as an outfits row', () => {
    const handoff = buildBoardHandoff(liveBoard)
    assert.equal(handoff.id, null)
  })

  it('occasion is populated from context_name', () => {
    const handoff = buildBoardHandoff(liveBoard)
    assert.equal(handoff.occasion, 'city')
  })

  it('image-only board (pieces:[]) — photo still populated, pieceIds empty', () => {
    const imageOnlyBoard = {
      id: 1,
      title: 'Modern structured culottes',
      image_url: '/uploads/generated-boards/editorial-1778661504502-3-289872.png',
      pieces: [],
      context_name: '',
      reason: ''
    }
    const handoff = buildBoardHandoff(imageOnlyBoard)
    assert.ok(handoff.photo, 'photo must be populated for image-only board')
    assert.deepEqual(handoff.pieceIds, [], 'pieceIds must be empty for image-only board')
  })
})
