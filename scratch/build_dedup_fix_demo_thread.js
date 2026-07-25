// One-off script (see CLAUDE.md / docs/ui-v1-design-handoff.md "Recommended design direction"
// entry, dedup-fix follow-up): drives the REAL propose_outfit tool handler
// (styling-engine/tools.js) through an actual reject-then-retry-with-a-swapped-piece
// sequence against the durable sandbox DB, then inserts the resulting thread into
// chat_threads so the fix can be reviewed live in the browser — no AI call, no mocked
// approximation, just the real gate/dedup code running on real sandbox pieces.
//
// Run with the sandbox DB env vars, matching .claude/launch.json's sandbox-api command:
//   WARDROBE_DB_PATH=$HOME/.wardrobe-sandbox/legacy-wardrobe.db \
//   WARDROBE_SYSTEM_DB_PATH=$HOME/.wardrobe-sandbox/system.db \
//   WARDROBE_USERS_DIR=$HOME/.wardrobe-sandbox/users \
//   WARDROBE_UPLOADS_DIR=$HOME/.wardrobe-sandbox/legacy-uploads \
//   node scratch/build_dedup_fix_demo_thread.js

import { db } from '../db.js'
import { executeTool } from '../styling-engine/tools.js'

const DRESS_ID = 18   // rust floral wrap short-sleeve dress
const TRENCH_ID = 19  // tan cotton trench coat with belt (should hard-gate: hot weather)
const JACKET_ID = 26  // Green jacket (lightweight, should pass)
const BOOTS_ID = 9    // black lace-up ankle boots

async function main() {
  const names = Object.fromEntries(
    db.prepare(`SELECT id, name FROM pieces WHERE id IN (${DRESS_ID},${TRENCH_ID},${JACKET_ID},${BOOTS_ID})`)
      .all().map(r => [r.id, r.name])
  )
  for (const id of [DRESS_ID, TRENCH_ID, JACKET_ID, BOOTS_ID]) {
    if (!names[id]) throw new Error(`Piece id ${id} not found in this DB — check ids before running.`)
  }

  const toolContext = {
    generatedOutfits: [],
    occasion: 'city',
    season: 'current season',
    activity: '',
    declaredIntent: { want: 'cards', outfitCount: null, turnMode: null },
    retrievedPieceIds: new Set([DRESS_ID, TRENCH_ID, JACKET_ID, BOOTS_ID]),
    visuallySeenPieceIds: new Set([DRESS_ID, TRENCH_ID, JACKET_ID, BOOTS_ID]),
    knownOutfitPieceIds: [],
  }

  const label = 'Rust Dress Layered'

  console.log('--- Attempt 1: dress + trench coat (expect hot-weather hard-gate rejection) ---')
  const first = await executeTool('propose_outfit', {
    label,
    season: 'hot July day',
    why_it_works: 'The structured trench gives the ruffle-hem dress a grounding edge.',
    pieces: [
      { id: DRESS_ID, role: 'dress', anchor: true },
      { id: TRENCH_ID, role: 'outerwear' },
      { id: BOOTS_ID, role: 'shoes' },
    ],
  }, toolContext)
  console.log('status:', first.status, first.message || '')

  if (first.status !== 'validation_error' || toolContext.generatedOutfits.length !== 1 || !toolContext.generatedOutfits[0]?.broken) {
    console.error('\nDid not get the expected hard-gate rejection on attempt 1. toolContext.generatedOutfits:')
    console.error(JSON.stringify(toolContext.generatedOutfits, null, 2))
    process.exit(1)
  }
  console.log('Broken card recorded, rejectionReason:', toolContext.generatedOutfits[0].rejectionReason)

  console.log('\n--- Attempt 2: same label, trench swapped for the green jacket (expect success + dedup) ---')
  const second = await executeTool('propose_outfit', {
    label,
    season: 'hot July day',
    why_it_works: 'The lightweight linen-blend jacket keeps the same grounding edge without the heat risk.',
    pieces: [
      { id: DRESS_ID, role: 'dress', anchor: true },
      { id: JACKET_ID, role: 'outerwear' },
      { id: BOOTS_ID, role: 'shoes' },
    ],
  }, toolContext)
  console.log('status:', second.status, second.message || '')

  if (second.status !== 'success' || toolContext.generatedOutfits.length !== 1 || toolContext.generatedOutfits[0]?.broken) {
    console.error('\nDedup did NOT happen as expected — this reproduces the bug rather than the fix. toolContext.generatedOutfits:')
    console.error(JSON.stringify(toolContext.generatedOutfits, null, 2))
    process.exit(1)
  }

  const survivor = toolContext.generatedOutfits[0]
  console.log('\nSingle surviving card. engineNote:', survivor.engineNote)

  // Build the chat thread exactly the way the real /api/ai/ask response shapes
  // structuredOutfits for the frontend (see StylistChat.jsx ~4403: wholeWardrobe:true,
  // textOnly:true on each outfit for a freeform-ask-sourced whole_wardrobe card).
  const structuredOutfit = { ...survivor, wholeWardrobe: true, textOnly: true }

  const now = new Date().toISOString()
  const threadId = `thread_dedupfix_demo_${Date.now()}`
  const payload = {
    messages: [
      {
        role: 'user',
        text: `Propose an outfit called '${label}' using the rust floral dress with the trench coat as the layer.`,
        contextType: 'wardrobe',
      },
      {
        role: 'assistant',
        text: `First pass: the trench coat over the rust dress got flagged by the wardrobe's own weather rules — ${survivor.engineNote}\n\nHere's the corrected direction.`,
        structuredOutfits: [structuredOutfit],
        wholeWardrobe: true,
        source: 'proposed_outfit',
        mode: 'freeform',
      },
    ],
  }

  db.prepare(`
    INSERT INTO chat_threads (id, title, kind, payload, pinned, archived, created_at, updated_at)
    VALUES (?, ?, 'chat', ?, 0, 0, ?, ?)
  `).run(
    threadId,
    "Dedup fix demo — Rust Dress Layered (scripted, real executeTool)",
    JSON.stringify(payload),
    now,
    now
  )

  console.log('\nInserted thread:', threadId)
  console.log('Open it in the sandbox Stylist sidebar under "Recent" to review live.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
