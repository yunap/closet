// Deterministic "Wardrobe mix" ordering — no RNG, no model call, stable across
// renders for the same input list. First-pass behavior per the compact-filters
// spec: mix categories, avoid clustering similar colors, blend newer/older
// pieces, and modestly prefer current-season items.

function currentSeasonKey(now = new Date()) {
  const month = now.getMonth() // 0-11
  return month >= 4 && month <= 8 ? 'warm' : 'cool' // May-Sep => warm, else cool
}

function dominantColor(piece) {
  return Array.isArray(piece.colors) && piece.colors.length ? piece.colors[0] : null
}

export function wardrobeMixSort(pieces, { now, usageStats = {} } = {}) {
  // A piece confirmed no longer owned has no business in a "what should I
  // wear" mix — reuses the existing status value, no archived/hidden concept
  // needed for garments.
  const eligible = (pieces || []).filter(piece => piece.status !== 'donated')
  if (eligible.length < 2) return eligible

  const currentSeason = currentSeasonKey(now)

  const byCategory = new Map()
  for (const piece of eligible) {
    const key = piece.category || 'other'
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key).push(piece)
  }

  // Within each category: modest bumps for current-season, favorites, and
  // overlooked (low/no usage) pieces, then zigzag old/new so the group isn't
  // just newest-first. "Usage" = referenced by the Visual Composer or a
  // Stylist chat, per usageStats — not literal real-world wear.
  const categoryQueues = []
  for (const group of byCategory.values()) {
    const sorted = [...group].sort((a, b) => {
      const scoreOf = (piece) => {
        const seasonBonus = piece.season === currentSeason || piece.season === 'year-round' ? 1 : 0
        const favoriteBonus = piece.favorite ? 1 : 0
        const overlookedBonus = !usageStats[piece.id]?.count ? 1 : 0
        return seasonBonus + favoriteBonus + overlookedBonus
      }
      const scoreDiff = scoreOf(b) - scoreOf(a)
      if (scoreDiff !== 0) return scoreDiff
      return new Date(b.date_added || 0) - new Date(a.date_added || 0)
    })
    const zigzagged = []
    let lo = 0
    let hi = sorted.length - 1
    let takeFront = true
    while (lo <= hi) {
      if (takeFront) { zigzagged.push(sorted[lo]); lo++ }
      else { zigzagged.push(sorted[hi]); hi-- }
      takeFront = !takeFront
    }
    categoryQueues.push(zigzagged)
  }

  // Round-robin across categories so the grid alternates category rather than
  // running through one category at a time.
  const mixed = []
  let idx = 0
  let remaining = true
  while (remaining) {
    remaining = false
    for (const queue of categoryQueues) {
      if (idx < queue.length) {
        mixed.push(queue[idx])
        remaining = true
      }
    }
    idx++
  }

  // Local pass: if two adjacent pieces share a dominant color, pull a later
  // piece with a different color forward to break up the run.
  for (let i = 1; i < mixed.length; i++) {
    const prevColor = dominantColor(mixed[i - 1])
    if (!prevColor || dominantColor(mixed[i]) !== prevColor) continue
    for (let j = i + 1; j < mixed.length; j++) {
      if (dominantColor(mixed[j]) !== prevColor) {
        const [swapped] = mixed.splice(j, 1)
        mixed.splice(i, 0, swapped)
        break
      }
    }
  }

  return mixed
}
