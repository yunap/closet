const relationshipCache = new Map()
const relationshipRequests = new Map()

function preloadImage(src) {
  if (!src || typeof Image === 'undefined') return
  const image = new Image()
  image.decoding = 'async'
  image.src = src
}

function warmRelationshipImages({ savedBoards = [], outfits = [] }) {
  savedBoards.slice(0, 4).forEach(board => preloadImage(board.thumbnail_url || board.image_url))
  outfits.slice(0, 4).forEach(outfit => preloadImage(outfit.thumbnail_url || (outfit.photo ? `/uploads/${outfit.photo}` : '')))
}

export function getCachedGarmentRelationships(pieceId) {
  return relationshipCache.get(String(pieceId)) || null
}

export function loadGarmentRelationships(pieceId, { refresh = false } = {}) {
  const key = String(pieceId)
  if (!key) return Promise.resolve({ savedBoards: [], outfits: [] })
  if (relationshipRequests.has(key)) return relationshipRequests.get(key)
  if (!refresh && relationshipCache.has(key)) return Promise.resolve(relationshipCache.get(key))

  const request = Promise.all([
    fetch(`/api/pieces/${pieceId}/outfits`).then(response => response.ok ? response.json() : []),
    fetch(`/api/saved-boards?pieceId=${pieceId}&limit=80`).then(response => response.ok ? response.json() : [])
  ]).then(([outfits, boards]) => {
    const relationships = {
      outfits: Array.isArray(outfits) ? outfits : [],
      savedBoards: Array.isArray(boards) ? boards.filter(board => board.image_url) : []
    }
    relationshipCache.set(key, relationships)
    warmRelationshipImages(relationships)
    return relationships
  }).finally(() => relationshipRequests.delete(key))

  relationshipRequests.set(key, request)
  return request
}

export function prefetchGarmentRelationships(pieceId) {
  loadGarmentRelationships(pieceId).catch(() => {})
}
