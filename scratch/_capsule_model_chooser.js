// The model side of scratch/compare_capsule_rosters.js --with-model.
//
// compare_capsule_rosters.js has referenced this module since it was written,
// but the module was never committed, so a clean checkout could not run
// `--with-model`. Earlier live capsule runs did evaluate model-selected rosters
// against the engine baseline and informed the #196 default-on decision. This
// adapter supplies the missing reproducible, identical-input comparison needed
// to revalidate that decision after both roster paths changed.
//
// Deliberately a thin adapter over the PRODUCTION call. A harness that builds
// its own provider call measures its own call: different prompt, different
// images, different cache behaviour. chooseCapsuleRosterWithProvider is the
// function the app runs, so it is the function this compares.

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { chooseCapsuleRosterWithProvider } from '../routes/ai.js'
import { userUploadsDir } from '../db.js'
import { pieceVisualDetailPolicy, wardrobeCategoryGroup } from '../styling-engine/attributes.js'

// What the comparison actually spent, so the run reports cost instead of
// leaving it to be guessed afterwards.
export const comparisonUsage = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0
}

// Preserve every paid answer, including answers production later rejects.
// Without this, a deterministic fallback replaces the attempted model roster
// and makes visual review impossible after the process exits.
export const comparisonAttempts = []

export function resetComparisonAttempts() {
  comparisonAttempts.splice(0, comparisonAttempts.length)
}

export function captureComparisonAnswer(request = {}, answer = {}) {
  const attemptNumber = Math.max(1, Number(request.attempt) || 1)
  const previous = comparisonAttempts[attemptNumber - 2]
  if (previous && Array.isArray(request.failures)) previous.failures = request.failures

  const bench = Array.isArray(request.bench) ? request.bench : []
  const benchById = new Map(bench.map(piece => [Number(piece.id), piece]))
  const requestedIds = (Array.isArray(answer?.roster_piece_ids) ? answer.roster_piece_ids : [])
    .map(Number)
    .filter(Boolean)
  const uniqueIds = [...new Set(requestedIds)]
  const attempt = {
    attempt: attemptNumber,
    requestedIds,
    rosterPieceIds: uniqueIds.filter(id => benchById.has(id)),
    outsideBenchIds: uniqueIds.filter(id => !benchById.has(id)),
    duplicateIds: requestedIds.filter((id, index) => requestedIds.indexOf(id) !== index),
    roster: uniqueIds.map(id => benchById.get(id)).filter(Boolean),
    palette: String(answer?.palette || '').trim(),
    categoryShapeReason: String(answer?.category_shape_reason || '').trim(),
    repairChanges: Array.isArray(answer?.repair_changes) ? answer.repair_changes : [],
    jobs: Array.isArray(answer?.piece_jobs) ? answer.piece_jobs : [],
    failures: []
  }
  comparisonAttempts[attemptNumber - 1] = attempt
  return attempt
}

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function tileLabelLines(piece = {}) {
  const name = String(piece.name || 'Unnamed piece').trim()
  const clipped = name.length > 28 ? `${name.slice(0, 27)}…` : name
  const colors = (Array.isArray(piece.colors) ? piece.colors : []).join('/') || 'no colour tag'
  return [`#${piece.id} · ${clipped}`, colors]
}

async function rosterTile(piece, { width, height, imageSize }) {
  const uploadsDir = userUploadsDir()
  const photoFile = piece?.worn_photo || piece?.photo || ''
  const photoPath = photoFile ? path.join(uploadsDir, photoFile) : ''
  let image
  if (photoPath && fs.existsSync(photoPath)) {
    image = await sharp(photoPath)
      .rotate()
      .resize({ width: imageSize, height: imageSize, fit: 'contain', background: '#f4f0ea' })
      .flatten({ background: '#f4f0ea' })
      .png()
      .toBuffer()
  } else {
    image = await sharp({
      create: { width: imageSize, height: imageSize, channels: 4, background: '#e8e1d8' }
    }).png().toBuffer()
  }
  const [name, colors] = tileLabelLines(piece)
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" rx="10" fill="#fffdf9" stroke="#d8d0c6"/>
    <text x="12" y="${imageSize + 30}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#302820">${escapeXml(name)}</text>
    <text x="12" y="${imageSize + 51}" font-family="Arial, sans-serif" font-size="12" fill="#6f6256">${escapeXml(colors)}</text>
  </svg>`
  return sharp(Buffer.from(svg))
    .composite([{ input: image, left: Math.round((width - imageSize) / 2), top: 10 }])
    .png()
    .toBuffer()
}

// A neutral evidence surface, not a styled editorial board: identical crop,
// tile size, typography and category order for the engine and both model picks.
export async function renderRosterContactSheet({ roster = [], label = '', outPath } = {}) {
  if (!outPath) throw new Error('renderRosterContactSheet requires outPath')
  const groupOrder = new Map([['top', 0], ['bottom', 1], ['dress', 2], ['outerwear', 3], ['shoes', 4]])
  const ordered = [...roster].sort((a, b) => {
    const aGroup = groupOrder.get(wardrobeCategoryGroup(a)) ?? 9
    const bGroup = groupOrder.get(wardrobeCategoryGroup(b)) ?? 9
    return aGroup - bGroup || String(a.name || '').localeCompare(String(b.name || '')) || Number(a.id) - Number(b.id)
  })
  const columns = 6
  const tileWidth = 220
  const tileHeight = 260
  const gap = 14
  const margin = 24
  const headerHeight = 72
  const rows = Math.max(1, Math.ceil(ordered.length / columns))
  const width = margin * 2 + columns * tileWidth + (columns - 1) * gap
  const height = headerHeight + margin + rows * tileHeight + (rows - 1) * gap + margin
  const header = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f4f0ea"/>
    <text x="${margin}" y="34" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#302820">${escapeXml(label)}</text>
    <text x="${margin}" y="57" font-family="Arial, sans-serif" font-size="14" fill="#6f6256">${ordered.length} garments · identical evidence layout · grouped by category</text>
  </svg>`
  const composites = []
  for (let index = 0; index < ordered.length; index += 1) {
    const row = Math.floor(index / columns)
    const column = index % columns
    composites.push({
      input: await rosterTile(ordered[index], { width: tileWidth, height: tileHeight, imageSize: 190 }),
      left: margin + column * (tileWidth + gap),
      top: headerHeight + row * (tileHeight + gap)
    })
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  await sharp(Buffer.from(header)).composite(composites).png().toFile(outPath)
  return outPath
}

// Anthropic bills an image at roughly (w x h) / 750 tokens. Square is the
// worst case for a thumbnail capped at maxPx, so this over-estimates slightly
// — the right direction for a spend preview.
function imageTokensFor(piece) {
  const { maxPx } = pieceVisualDetailPolicy(piece)
  return Math.round((maxPx * maxPx) / 750)
}

function hasResolvablePhoto(piece, uploadsDir) {
  const photoFile = piece?.worn_photo || piece?.photo || ''
  if (!photoFile) return false
  return fs.existsSync(path.join(uploadsDir, photoFile))
}

// The failure this exists to prevent: chooseCapsuleRosterWithProvider skips a
// piece whose photo it cannot find (`if (!fs.existsSync(filePath)) continue`),
// silently. userUploadsDir() resolves relative to the checkout, so running the
// harness from a git worktree — which has no uploads/ directory — sends ZERO
// images and the model judges a capsule blind. That produces a confident,
// meaningless comparison. Refuse instead.
export function previewCapsuleRosterCall({ bench = [], budget = 24, label = '' } = {}) {
  const uploadsDir = userUploadsDir()
  const withPhoto = bench.filter(piece => hasResolvablePhoto(piece, uploadsDir))
  const imageTokens = withPhoto.reduce((sum, piece) => sum + imageTokensFor(piece), 0)
  const hiRes = withPhoto.filter(piece => pieceVisualDetailPolicy(piece).maxPx === 800).length
  return {
    label,
    uploadsDir,
    benchSize: bench.length,
    resolvablePhotos: withPhoto.length,
    missingPhotos: bench.length - withPhoto.length,
    hiRes,
    imageTokens,
    // The roster call was measured at ~$0.075 on a 40-piece/448px bench
    // (docs/capsule-index-and-plan.md 3c). Scale by image tokens rather than
    // inventing a price: the image payload is what dominates this call.
    scaledFromMeasuredCost: imageTokens / (40 * Math.round((448 * 448) / 750)) * 0.075
  }
}

export function describePreview(preview) {
  const dollars = preview.scaledFromMeasuredCost
  return [
    `  ${preview.label}`,
    `    bench ${preview.benchSize} · photos resolvable ${preview.resolvablePhotos}${preview.missingPhotos ? ` · MISSING ${preview.missingPhotos}` : ''} · ${preview.hiRes} at 800px`,
    `    ~${preview.imageTokens.toLocaleString()} image tokens · ~$${dollars.toFixed(3)} per attempt (a repair doubles it)`,
    `    uploads: ${preview.uploadsDir}`
  ].join('\n')
}

// Thrown rather than warned. A comparison run on blind input is worse than no
// comparison, because its output looks exactly like a real result.
export function assertPhotosResolve(preview, { minimumRatio = 0.9 } = {}) {
  if (!preview.benchSize) throw new Error('capsule roster comparison: the bench is empty')
  const ratio = preview.resolvablePhotos / preview.benchSize
  if (ratio >= minimumRatio) return
  throw new Error(
    `capsule roster comparison: only ${preview.resolvablePhotos} of ${preview.benchSize} bench photos resolve under ${preview.uploadsDir}. ` +
    'The model would judge this capsule almost blind and the comparison would be meaningless. ' +
    'Run from the main checkout, or set WARDROBE_UPLOADS_DIR to the real uploads directory.'
  )
}

// The signature selectCapsuleRosterViaModel expects for its `chooseRoster`
// injection point — the same shape routes/ai.js wires in production.
export async function chooseCapsuleRosterForComparison(request) {
  const preview = previewCapsuleRosterCall({
    bench: request?.bench || [],
    budget: request?.budget || 24,
    label: `attempt ${request?.attempt || 1}`
  })
  assertPhotosResolve(preview)

  // bumpFreeformDiagnostic creates freeformDiagnostics on a bare object, so an
  // empty context is all recordToolLoopUsage needs.
  const toolContext = {}
  const answer = await chooseCapsuleRosterWithProvider(request, toolContext)
  captureComparisonAnswer(request, answer)

  const usage = toolContext.freeformDiagnostics || {}
  comparisonUsage.calls += 1
  comparisonUsage.inputTokens += Number(usage.providerInputTokens) || 0
  comparisonUsage.outputTokens += Number(usage.providerOutputTokens) || 0
  comparisonUsage.cacheReadInputTokens += Number(usage.providerCacheReadInputTokens) || 0
  comparisonUsage.cacheCreationInputTokens += Number(usage.providerCacheCreationInputTokens) || 0
  return answer
}
