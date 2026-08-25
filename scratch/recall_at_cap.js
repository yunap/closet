// Recall@cap replay is measurement only. Results parameterize a decision; they do not auto-tune anything.
// Weight changes motivated by this report need their own spec with before/after recall@cap and A/B diffs.
// With a few dozen confirmed outfits, only coarse block-level changes are defensible; per-constant fitting is out of bounds.
import fs from 'fs'
import { pathToFileURL } from 'url'
import { db, parsePiece } from '../db.js'
import {
  buildVisualComposerRoster,
  weatherProfileFromContext
} from '../styling-engine/rules.js'
import { evaluateAutomaticUsePiecePool } from '../styling-engine/eligibility.js'

const OUTPUT_PATH = 'scratch/recall_at_cap_report.json'
const ACCESSORY_CATEGORIES = new Set(['accessory', 'accessories', 'jewelry', 'bag', 'bags', 'belt', 'belts', 'scarf', 'scarves', 'hat', 'hats', 'sunglasses'])

function category(piece) {
  return String(piece?.category || '').toLowerCase().trim()
}

export function isAccessoryPiece(piece = {}) {
  return ACCESSORY_CATEGORIES.has(category(piece))
}

function weatherLabel(profile = {}) {
  if (profile.isHot) return 'hot'
  if (profile.isCold) return 'cold'
  return 'neutral'
}

function metric() {
  return { hits: 0, total: 0, recall: 0 }
}

function addMetric(bucket, key, hit, total = 1) {
  if (!bucket[key]) bucket[key] = metric()
  bucket[key].hits += hit
  bucket[key].total += total
}

function finalizeMetric(item) {
  item.recall = item.total ? Number((item.hits / item.total).toFixed(4)) : 0
  return item
}

function classifyMiss(pieceId, { suppressed = [], excluded = [], debug = {}, candidateIds = null } = {}) {
  const capCut = (debug.capCutPieces || []).find(piece => Number(piece.id) === Number(pieceId))
  if (capCut) return { layer: 'cap', reason: capCut.reason || 'roster cap' }

  const rosterExclusion = excluded.find(item => Number(item.pieceId) === Number(pieceId))
  if (rosterExclusion) {
    const reason = rosterExclusion.reason || 'roster exclusion'
    return {
      layer: reason.startsWith('metadata missing:') ? 'missing-metadata' : 'gate',
      reason
    }
  }

  const suppression = suppressed.find(item => Number(item.id) === Number(pieceId))
  if (suppression) {
    const reason = (suppression.reasons || []).join('; ') || 'suppressed before roster'
    return {
      layer: /metadata missing:/i.test(reason) ? 'missing-metadata' : 'gate',
      reason
    }
  }

  if (candidateIds && !candidateIds.has(Number(pieceId))) {
    return { layer: 'gate', reason: 'not in replay candidate pool' }
  }

  return { layer: 'gate', reason: 'not present in final roster' }
}

function getConfirmedOutfits() {
  const rows = db.prepare(`
    SELECT
      o.id AS outfit_id,
      o.name AS outfit_name,
      o.occasion AS outfit_occasion,
      o.season AS outfit_season,
      p.*
    FROM outfits o
    JOIN outfit_pieces op ON op.outfit_id = o.id
    JOIN pieces p ON p.id = op.piece_id
    WHERE o.status = 'confirmed'
      AND p.status = 'active'
    ORDER BY o.id, p.id
  `).all()

  const byOutfit = new Map()
  for (const row of rows) {
    if (!byOutfit.has(row.outfit_id)) {
      byOutfit.set(row.outfit_id, {
        id: row.outfit_id,
        name: row.outfit_name,
        occasion: row.outfit_occasion || 'casual',
        season: row.outfit_season || 'current season',
        pieces: []
      })
    }
    const { outfit_id, outfit_name, outfit_occasion, outfit_season, ...pieceRow } = row
    byOutfit.get(outfit_id).pieces.push(parsePiece(pieceRow))
  }

  return [...byOutfit.values()].filter(outfit => outfit.pieces.length >= 2)
}

function newReport() {
  return {
    generatedAt: new Date().toISOString(),
    confirmedOutfitCount: 0,
    flows: {
      whole_wardrobe_visual: newFlowReport(),
      anchor_visual: newFlowReport()
    },
    conclusion: ''
  }
}

export function newFlowReport() {
  return {
    overall: metric(),
    byOccasion: {},
    byWeather: {},
    misses: [],
    accessories: {
      overall: metric(),
      byOccasion: {},
      byWeather: {},
      misses: []
    }
  }
}

function recordMiss(misses, { outfit, piece, layer, reason, anchor = null }) {
  misses.push({
    outfitId: outfit.id,
    outfitName: outfit.name,
    occasion: outfit.occasion,
    weather: weatherLabel(weatherProfileFromContext({ mood: '', season: outfit.season })),
    missedPieceId: piece.id,
    missedPieceName: piece.name,
    layer,
    reason,
    anchorPieceId: anchor?.id || null,
    anchorPieceName: anchor?.name || null
  })
}

export function recordReplayPiece(flowReport, { outfit, piece, hit, weatherProfile, miss = null }) {
  const target = isAccessoryPiece(piece) ? flowReport.accessories : flowReport
  addMetric({ overall: target.overall }, 'overall', hit)
  addMetric(target.byOccasion, outfit.occasion, hit)
  addMetric(target.byWeather, weatherLabel(weatherProfile), hit)
  if (!hit && miss) recordMiss(target.misses, { outfit, piece, ...miss })
}

function replayWholeWardrobe(outfit, allActivePieces, report) {
  const weatherProfile = weatherProfileFromContext({ mood: '', season: outfit.season })
  const { eligiblePieces: allowedPieces, underlyingExcludedPieces: suppressedPieces } = evaluateAutomaticUsePiecePool({
    pieces: allActivePieces,
    context: {
      occasion: outfit.occasion,
      explorationMode: 'moderate',
      weatherProfile,
      mood: '',
      activity: ''
    },
    policy: { hotOuterwearCap: 3 },
  })
  const { roster, excluded, debug } = buildVisualComposerRoster(allowedPieces, {
    occasion: outfit.occasion,
    weatherProfile,
    sessionInfluence: null,
    maxImages: 90,
    recordMetadataTodos: false
  })
  const rosterIds = new Set(roster.map(piece => Number(piece.id)))
  const flowReport = report.flows.whole_wardrobe_visual

  for (const piece of outfit.pieces) {
    const hit = rosterIds.has(Number(piece.id)) ? 1 : 0
    recordReplayPiece(flowReport, {
      outfit,
      piece,
      hit,
      weatherProfile,
      miss: hit ? null : classifyMiss(piece.id, { suppressed: suppressedPieces, excluded, debug })
    })
  }
}

function replayAnchor(outfit, allActivePieces, report) {
  const weatherProfile = weatherProfileFromContext({ mood: '', season: outfit.season })
  const flowReport = report.flows.anchor_visual

  for (const anchor of outfit.pieces) {
    const candidatePool = [
      anchor,
      ...allActivePieces.filter(piece => Number(piece.id) !== Number(anchor.id))
    ]
    const candidateIds = new Set(candidatePool.map(piece => Number(piece.id)))
    const { roster, excluded, debug } = buildVisualComposerRoster(candidatePool, {
      occasion: outfit.occasion,
      weatherProfile,
      sessionInfluence: null,
      selectedPieceId: anchor.id,
      maxImages: 54,
      recordMetadataTodos: false
    })
    const rosterIds = new Set(roster.map(piece => Number(piece.id)))

    for (const piece of outfit.pieces.filter(piece => Number(piece.id) !== Number(anchor.id))) {
      const hit = rosterIds.has(Number(piece.id)) ? 1 : 0
      recordReplayPiece(flowReport, {
        outfit,
        piece,
        hit,
        weatherProfile,
        miss: hit ? null : {
          anchor,
          ...classifyMiss(piece.id, { excluded, debug, candidateIds })
        }
      })
    }
  }
}

export function finalizeReport(report) {
  for (const flow of Object.values(report.flows)) {
    finalizeMetric(flow.overall)
    for (const item of Object.values(flow.byOccasion)) finalizeMetric(item)
    for (const item of Object.values(flow.byWeather)) finalizeMetric(item)
    finalizeMetric(flow.accessories.overall)
    for (const item of Object.values(flow.accessories.byOccasion)) finalizeMetric(item)
    for (const item of Object.values(flow.accessories.byWeather)) finalizeMetric(item)
  }

  const misses = Object.values(report.flows).flatMap(flow => flow.misses)
  const accessoryMisses = Object.values(report.flows).flatMap(flow => flow.accessories.misses)
  const layerCounts = misses.reduce((counts, miss) => {
    counts[miss.layer] = (counts[miss.layer] || 0) + 1
    return counts
  }, {})
  const accessoryLayerCounts = accessoryMisses.reduce((counts, miss) => {
    counts[miss.layer] = (counts[miss.layer] || 0) + 1
    return counts
  }, {})
  const dominant = Object.entries(layerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none'
  if (!misses.length) {
    report.conclusion = 'Near-zero misses: scoring is low-stakes for the current confirmed-outfit dataset.'
  } else if (dominant === 'cap') {
    report.conclusion = 'Misses are dominated by cap cuts: soft-score order may be costing real outfits and is worth tuning or replacing.'
  } else {
    report.conclusion = 'Misses are dominated by gates or metadata: scoring is not the primary bottleneck for this dataset.'
  }
  report.layerCounts = layerCounts
  report.accessoryLayerCounts = accessoryLayerCounts
  return report
}

export async function runRecallAtCapReplay({ outputPath = OUTPUT_PATH } = {}) {
  const allActivePieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const outfits = getConfirmedOutfits()
  const report = newReport()
  report.confirmedOutfitCount = outfits.length

  for (const outfit of outfits) {
    replayWholeWardrobe(outfit, allActivePieces, report)
    replayAnchor(outfit, allActivePieces, report)
  }

  finalizeReport(report)
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2))
  return report
}

async function main() {
  const report = await runRecallAtCapReplay()

  console.log(`Confirmed outfits replayed: ${report.confirmedOutfitCount}`)
  for (const [flowName, flow] of Object.entries(report.flows)) {
    console.log(`\n${flowName}`)
    console.log(`  overall recall@cap: ${flow.overall.recall} (${flow.overall.hits}/${flow.overall.total})`)
    console.log(`  misses: ${flow.misses.length}`)
    console.log(`  accessories recall@cap: ${flow.accessories.overall.recall} (${flow.accessories.overall.hits}/${flow.accessories.overall.total})`)
    console.log(`  accessory misses: ${flow.accessories.misses.length}`)
    if (flow.misses.length) {
      for (const miss of flow.misses.slice(0, 20)) {
        const anchor = miss.anchorPieceName ? ` anchored on ${miss.anchorPieceName}` : ''
        console.log(`  - ${miss.outfitName}${anchor}: missed ${miss.missedPieceName} [${miss.layer}] ${miss.reason}`)
      }
    }
  }
  console.log(`\n${report.conclusion}`)
  console.log(`Wrote ${OUTPUT_PATH}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main()
}
