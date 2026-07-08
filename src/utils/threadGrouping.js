export function humanizeLabel(val) {
  if (!val) return ''
  const v = val.toLowerCase().trim()
  if (v === 'outdoor_daytime_social') return 'Outdoor social'
  if (v === 'smart casual' || v === 'smart-casual') return 'Smart casual'
  if (v === 'gallery / art event' || v === 'gallery/art event') return 'Gallery/art event'
  if (v === 'none') return ''
  if (v === 'walking') return 'Lots of walking'
  if (v === 'hiking') return 'Hiking/Outdoor active'
  
  return val
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

export function deriveBuilderTitle({ occasion, activity, season, mood, request }) {
  const parts = []
  if (occasion) {
    const humOcc = humanizeLabel(occasion)
    if (humOcc) parts.push(humOcc)
  }
  if (activity && activity !== 'none') {
    const humAct = humanizeLabel(activity)
    if (humAct) parts.push(humAct)
  }
  if (season && season !== 'current season' && season !== 'all') {
    const humSea = humanizeLabel(season)
    if (humSea) parts.push(humSea)
  }
  const snippet = request?.trim() || mood?.trim()
  if (snippet) {
    parts.push(`"${snippet}"`)
  }
  return parts.join(' · ') || 'Wardrobe generation'
}

export function getRelativeTimeLabel(timestamp) {
  const now = new Date()
  const date = new Date(timestamp)
  const diffMs = now.getTime() - date.getTime()
  
  if (isNaN(diffMs) || diffMs < 0) return ''
  
  const diffMins = Math.floor(diffMs / (60 * 1000))
  if (diffMins < 60) {
    return `${diffMins || 1}m`
  }
  
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) {
    return `${diffHours}h`
  }
  
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) {
    return 'Yesterday'
  }
  
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfThisWeek = startOfToday - 7 * 24 * 60 * 60 * 1000
  if (date.getTime() >= startOfThisWeek) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return days[date.getDay()]
  }
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getMonth()]} ${date.getDate()}`
}

export function groupThreadsByDate(threads, disableOlderBuilderCollapse = false) {
  const groups = {
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
    olderBuilder: []
  }
  
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const startOfThisWeek = startOfToday - 7 * 24 * 60 * 60 * 1000
  const thirtyDaysAgo = startOfToday - 30 * 24 * 60 * 60 * 1000

  for (const t of threads) {
    const time = new Date(t.updatedAt || t.updated_at || Date.now()).getTime()
    const isOlderBuilder = !disableOlderBuilderCollapse && t.kind === 'builder' && time < thirtyDaysAgo
    
    if (isOlderBuilder) {
      groups.olderBuilder.push(t)
    } else if (time >= startOfToday) {
      groups.today.push(t)
    } else if (time >= startOfYesterday) {
      groups.yesterday.push(t)
    } else if (time >= startOfThisWeek) {
      groups.thisWeek.push(t)
    } else {
      groups.earlier.push(t)
    }
  }
  
  return groups
}

export function clusterThreadsBySubject(threads) {
  const clusters = {} // key: activeContext.id -> { id, name, type, maxTime, threads: [] }
  const otherConversations = []

  for (const t of threads) {
    const ctx = t.activeContext
    if (ctx && ctx.id && (ctx.type === 'outfit' || ctx.type === 'piece')) {
      const clusterId = `${ctx.type}_${ctx.id}`
      if (!clusters[clusterId]) {
        clusters[clusterId] = {
          id: ctx.id,
          name: ctx.name || humanizeLabel(String(ctx.id)),
          type: ctx.type,
          maxTime: 0,
          threads: []
        }
      }
      const threadTime = new Date(t.updatedAt || t.updated_at || Date.now()).getTime()
      clusters[clusterId].threads.push(t)
      if (threadTime > clusters[clusterId].maxTime) {
        clusters[clusterId].maxTime = threadTime
      }
    } else {
      otherConversations.push(t)
    }
  }

  // Sort threads within each cluster newest first
  Object.values(clusters).forEach(c => {
    c.threads.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.updated_at || Date.now()).getTime()
      const timeB = new Date(b.updatedAt || b.updated_at || Date.now()).getTime()
      return timeB - timeA
    })
  })

  // Sort clusters by maxTime descending (most recently active cluster first)
  const sortedClusters = Object.values(clusters).sort((a, b) => b.maxTime - a.maxTime)

  // Sort other conversations newest first
  otherConversations.sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.updated_at || Date.now()).getTime()
    const timeB = new Date(b.updatedAt || b.updated_at || Date.now()).getTime()
    return timeB - timeA
  })

  return {
    clusters: sortedClusters,
    otherConversations
  }
}
