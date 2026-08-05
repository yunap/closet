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
import { chooseCapsuleRosterWithProvider } from '../routes/ai.js'
import { userUploadsDir } from '../db.js'
import { pieceVisualDetailPolicy } from '../styling-engine/attributes.js'

// What the comparison actually spent, so the run reports cost instead of
// leaving it to be guessed afterwards.
export const comparisonUsage = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0
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

  const usage = toolContext.freeformDiagnostics || {}
  comparisonUsage.calls += 1
  comparisonUsage.inputTokens += Number(usage.providerInputTokens) || 0
  comparisonUsage.outputTokens += Number(usage.providerOutputTokens) || 0
  comparisonUsage.cacheReadInputTokens += Number(usage.providerCacheReadInputTokens) || 0
  comparisonUsage.cacheCreationInputTokens += Number(usage.providerCacheCreationInputTokens) || 0
  return answer
}
