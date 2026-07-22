function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function compactChatThreadMemory({ memorySource, stylingContext, latestOutfits }) {
  const context = parseJson(stylingContext)
  const outfits = parseJson(latestOutfits)
  const compact = {}

  if (memorySource) compact.source = memorySource
  if (context && typeof context === 'object' && !Array.isArray(context)) {
    const compactContext = {}
    ;['occasion', 'activity', 'season', 'mood', 'request'].forEach(key => {
      if (context[key] !== undefined && context[key] !== null && context[key] !== '') {
        compactContext[key] = context[key]
      }
    })
    if (Object.keys(compactContext).length) compact.stylingContext = compactContext
  }
  if (Array.isArray(outfits) && outfits.length) {
    compact.latestOutfits = outfits.map(outfit => {
      const summary = {}
      ;['title', 'label', 'bestFor', 'best_for', 'previewOnly'].forEach(key => {
        if (outfit?.[key] !== undefined && outfit?.[key] !== null && outfit?.[key] !== '') {
          summary[key] = outfit[key]
        }
      })
      return summary
    })
  }

  return Object.keys(compact).length ? compact : null
}
