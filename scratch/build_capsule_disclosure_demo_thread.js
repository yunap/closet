// One-off review fixture for the 2026-07-28 capsule disclosure fixes (handoff
// entry "capsule design evaluation, six correctness fixes"). Drives the REAL
// planner — buildPlanSlotWorkbench, allocateCapsuleRepresentativeRotation,
// validateSubmittedPlanOutfits, assembleSubmittedPlanOutfits — against the
// durable sandbox wardrobe, reproducing the atomic capsule path's own pending
// plan (suppressModelCoverageGaps + boundedComposition), then inserts the
// resulting thread into chat_threads so the notes/chips can be reviewed live.
//
// No AI client is constructed and no network request is made. The "model"
// submission below is chosen deterministically from each slot's allowed ids,
// and one slot deliberately under-delivers so the shortfall disclosure renders.
//
// Run with the sandbox DB env vars, matching .claude/launch.json's sandbox-api:
//   WARDROBE_DB_PATH=$HOME/.wardrobe-sandbox/legacy-wardrobe.db \
//   WARDROBE_SYSTEM_DB_PATH=$HOME/.wardrobe-sandbox/system.db \
//   WARDROBE_USERS_DIR=$HOME/.wardrobe-sandbox/users \
//   WARDROBE_UPLOADS_DIR=$HOME/.wardrobe-sandbox/legacy-uploads \
//   node scratch/build_capsule_disclosure_demo_thread.js

import { db, parsePiece } from '../db.js'
import {
  normalizePlanSlots,
  buildPlanSlotWorkbench,
  validateSubmittedPlanOutfits,
  assembleSubmittedPlanOutfits,
  describeCapsuleCompositionShortfall,
  capsuleTotalOutfitCap
} from '../styling-engine/outfitSetPlanner.js'
import { wardrobeCategoryGroup } from '../styling-engine/attributes.js'

const PIECE_BUDGET = 10
const QUESTION = 'I want a summer capsule from my wardrobe'

// No live forecast: this fixture must stay free and deterministic.
const fetchImpl = async () => { throw new Error('offline fixture: no weather fetch') }

async function main() {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const cap = capsuleTotalOutfitCap(PIECE_BUDGET)
  const slots = normalizePlanSlots([
    { label: 'At Home', occasion: 'casual', best_for: 'low-key time at home', count: 3, weather: 'warm' },
    { label: 'Errands / Weekends', occasion: 'casual', best_for: 'errands and weekend outings', count: 3, weather: 'warm' },
    { label: 'City Outings', occasion: 'city', activity: 'walking', best_for: 'walking and museums', count: 2, weather: 'warm' },
    { label: 'Restaurant Dinner', occasion: 'evening', best_for: 'restaurant dinner', environment: 'indoor', count: 2, weather: 'warm' },
  ], { fallbackWeather: 'warm', maxSlots: cap, maxTotalOutfits: cap })

  const workbench = await buildPlanSlotWorkbench(slots, {
    constraints: { piece_budget: PIECE_BUDGET, reuse: 'maximize' },
    allPieces,
    mood: '',
    question: QUESTION,
    planKind: 'seasonal_capsule',
    fetchImpl
  })

  // Mirror the atomic capsule path's pending plan exactly (tools.js).
  const pendingPlan = {
    ...workbench.pendingPlan,
    mode: 'model',
    suppressModelCoverageGaps: true,
    boundedComposition: true
  }

  console.log(`roster: ${pendingPlan.capsuleRoster.length} pieces, capacity ${pendingPlan.capsuleCapacity} distinct cores, card cap ${cap}`)
  for (const slot of pendingPlan.slots) {
    console.log(`  ${slot.label}: target ${slot.targetOutfits} of requested ${slot.requestedOutfits || slot.targetOutfits}, slot capacity ${slot.capsuleSlotCapacity}`)
  }

  // Deterministic stand-in for the composer: walk each slot's allowed pieces and
  // build distinct cores. The LAST planned look of the last slot is deliberately
  // skipped so the shortfall disclosure has something true to report.
  const submissions = []
  const usedCores = new Set()
  const plannedTotal = pendingPlan.slots.reduce((sum, slot) => sum + Math.max(0, Number(slot.targetOutfits) || 0), 0)
  for (const slot of pendingPlan.slots) {
    const allowed = [...(slot.gateAllowedIds || [])].map(id => pendingPlan.piecesById.get(Number(id))).filter(Boolean)
    const tops = allowed.filter(piece => wardrobeCategoryGroup(piece) === 'top')
    const bottoms = allowed.filter(piece => wardrobeCategoryGroup(piece) === 'bottom')
    const shoes = allowed.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')
    let made = 0
    outer: for (const top of tops) {
      for (const bottom of bottoms) {
        if (made >= slot.targetOutfits) break outer
        const core = `separates:${top.id}:${bottom.id}`
        if (usedCores.has(core) || !shoes.length) continue
        usedCores.add(core)
        made += 1
        submissions.push({
          slot_id: slot.id,
          title: `${slot.label} — look ${made}`,
          reason: `${top.name} with ${bottom.name}, grounded by ${shoes[made % shoes.length].name}.`,
          piece_ids: [top.id, bottom.id, shoes[made % shoes.length].id]
        })
      }
    }
  }
  submissions.pop() // one planned look deliberately not delivered

  const { accepted, failures } = validateSubmittedPlanOutfits(pendingPlan, submissions, {
    visuallySeenPieceIds: new Set(pendingPlan.capsuleRoster.map(piece => Number(piece.id)))
  })
  console.log(`\nsubmitted ${submissions.length} of ${plannedTotal} planned; accepted ${accepted.length}; failures ${failures.length}`)

  const acceptedCounts = new Map()
  for (const outfit of accepted) {
    const slotId = outfit?._slotId || outfit?.slot_id
    if (slotId) acceptedCounts.set(slotId, (acceptedCounts.get(slotId) || 0) + 1)
  }
  const shortfalls = pendingPlan.slots
    .map(slot => ({
      label: slot.label,
      missing: Math.max(0, Number(slot.targetOutfits) || 0) - (acceptedCounts.get(slot.id) || 0)
    }))
    .filter(entry => entry.missing > 0)
  const shortfallLine = describeCapsuleCompositionShortfall(shortfalls, {
    plannedTotal,
    acceptedTotal: accepted.length
  })
  if (shortfallLine) pendingPlan.coverageGaps = [...(pendingPlan.coverageGaps || []), shortfallLine]

  const planOutfits = assembleSubmittedPlanOutfits(pendingPlan, accepted)
  if (!planOutfits.length) throw new Error('no cards assembled — fixture cannot be reviewed')

  console.log('\nplan lines rendered under Stylist’s notes:')
  for (const line of planOutfits[0].tripPlanLines || []) console.log(`  ${line}`)
  console.log(`\ncapsulePlanContext present: ${Boolean(planOutfits[0].capsulePlanContext)} (is_winter_capsule=${planOutfits[0].capsulePlanContext?.is_winter_capsule})`)

  const now = new Date().toISOString()
  const threadId = `thread_capsule_disclosure_demo_${Date.now()}`
  const payload = {
    messages: [
      { role: 'user', text: QUESTION, contextType: 'wardrobe' },
      {
        role: 'assistant',
        text: `Here ${planOutfits.length === 1 ? 'is' : 'are'} ${planOutfits.length} validated look${planOutfits.length === 1 ? '' : 's'} from your ${PIECE_BUDGET}-piece summer capsule.`,
        structuredOutfits: planOutfits,
        source: 'plan_outfit_set',
        mode: 'freeform'
      }
    ]
  }
  db.prepare(`
    INSERT INTO chat_threads (id, title, kind, payload, pinned, archived, created_at, updated_at)
    VALUES (?, ?, 'chat', ?, 0, 0, ?, ?)
  `).run(threadId, 'Capsule disclosure demo (scripted, real planner)', JSON.stringify(payload), now, now)

  console.log(`\nInserted thread: ${threadId}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
