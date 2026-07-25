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

const STOP_PREFIX_PATTERN = /^(hi|hello|hey|please|can you|could you|would you|i need|i want|help me|make me|build me|put together|create|show me|give me)\s+/i

function compactText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .trim()
}

function titleCaseWords(value = '') {
  return compactText(value)
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

function truncateLabel(value = '', max = 32) {
  const text = compactText(value)
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

function firstAvailableText(thread = {}) {
  return compactText(
    thread.originalFirstMessage ||
    thread.original_first_message ||
    thread.firstUserMessage ||
    thread.first_user_message ||
    thread.chatHistory?.[0]?.content ||
    thread.messages?.find?.(m => m?.role === 'user')?.text ||
    thread.title ||
    ''
  )
}

function threadMemory(thread = {}) {
  return thread.threadMemory || thread.thread_memory || null
}

function stripTruncation(value = '') {
  return compactText(value).replace(/\.{3}$|…$/g, '').trim()
}

function normalizeComparable(value = '') {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(outfit|outfits|look|looks|styling|style|critique|directions?|ideas?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function promptDay(raw = '') {
  return raw.toLowerCase().match(/\b(saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/)?.[1] || ''
}

function titleFromContext(prompt = '') {
  const lower = prompt.toLowerCase()
  const day = promptDay(prompt)
  const dayLabel = day ? titleCaseWords(day) : ''

  if (/\bclient\s+(meeting|meetings|presentation|presentations)\b/.test(lower)) {
    return dayLabel ? `${dayLabel} client outfit` : 'Client meeting outfit'
  }
  if (/\boffice|work\b/.test(lower)) {
    if (/\beveryday|daily\b/.test(lower)) return 'Everyday office outfits'
    return dayLabel ? `${dayLabel} office outfit` : 'Office outfits'
  }
  if (/\bcasual\b/.test(lower) && /\berrands?\b/.test(lower)) {
    return 'Casual errands outfits'
  }
  if (/\b(city|walking|walk)\b/.test(lower) && /\bcasual\b/.test(lower)) {
    return 'Casual city walk'
  }
  if (dayLabel && /\bdinner\b/.test(lower)) return `${dayLabel} dinner outfit`
  if (dayLabel && /\bbrunch\b/.test(lower)) return `${dayLabel} brunch outfit`
  if (dayLabel && /\blunch\b/.test(lower)) return `${dayLabel} lunch outfit`
  return ''
}

function deriveTitleFromPrompt(prompt = '', thread = {}) {
  const raw = compactText(prompt)
  const lower = raw.toLowerCase()
  if (!raw) return ''

  const contextualTitle = titleFromContext(raw)
  if (contextualTitle) return truncateLabel(contextualTitle)

  const capsule = lower.match(/\b(\d+)[-\s]*piece\b.*\bcapsule\b/)
  if (capsule) {
    const season = lower.match(/\b(spring|summer|fall|winter|warm-weather|warm weather|cold-weather|cold weather)\b/)?.[1]
    const seasonLabel = season ? season.replace(/\s+/g, '-') + ' ' : ''
    return truncateLabel(`${capsule[1]}-piece ${seasonLabel}capsule`)
  }

  const dayTrip = lower.match(/\b(?:my\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+)[-\s]*day\s+trip\b/)
  if (dayTrip) {
    const dayLabel = dayTrip[1].replace(/^\w/, c => c.toUpperCase())
    return truncateLabel(`${dayLabel}-day trip outfits`)
  }

  const placeMatch = raw.match(/\b(?:to|in|for)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})(?:[,.;:]|\s+(?:for|with|and|during|this|next|in|on|trip|weekend|tomorrow|today|weather)\b)/)
  if (placeMatch && !/\b(outfits?|looks?|pieces?|wardrobe|closet|dinner|brunch)\b/i.test(placeMatch[1])) {
    const place = placeMatch[1].replace(/\s+(CA|NY|LA)$/i, '').trim()
    if (place) return truncateLabel(`${place} trip outfits`)
  }

  const pieceName = thread.activeContext?.type === 'piece'
    ? thread.activeContext.name
    : raw.match(/\b(?:this|these|my|the)\s+([a-z][a-z\s-]{3,45}?(?:pants|jeans|skirt|dress|top|blouse|shirt|sweater|cardigan|jacket|coat|shoes|heels|sandals|boots))\b/i)?.[1]
  if (pieceName) return truncateLabel(`${titleCaseWords(pieceName)} styling`)

  const occasion = lower.match(/\b(dinner|brunch|wedding|gallery|concert|office|work|travel|beach|city|hiking|winery)\b/)
  if (occasion) return truncateLabel(`${titleCaseWords(occasion[1])} outfit`)

  return truncateLabel(stripTruncation(raw).replace(STOP_PREFIX_PATTERN, '') || raw)
}

export function getThreadOriginalFirstMessage(thread = {}) {
  return firstAvailableText(thread)
}

export function getThreadDisplayTitle(thread = {}) {
  const customTitle = (thread.user_renamed || thread.userRenamed) ? compactText(thread.title) : ''
  if (customTitle) return truncateLabel(customTitle, 42)
  const generated = compactText(thread.generatedTitle || thread.generated_title)
  if (generated) return truncateLabel(generated, 42)

  const memory = threadMemory(thread)
  const context = memory?.stylingContext || {}
  if (thread.kind === 'builder' || memory?.source === 'whole_wardrobe') {
    return truncateLabel(deriveBuilderTitle(context) || 'Wardrobe generation', 42)
  }
  if (thread.activeContext?.type === 'piece') {
    return truncateLabel(`${thread.activeContext.name || 'Selected piece'} styling`, 42)
  }
  if (thread.activeContext?.type === 'outfit') {
    // E10: was always "<name> critique" regardless of whether this was actually a critique,
    // similar-variants, creative-alternatives, adjacent-variants, or comparison thread — see
    // outfitSubjectActionTitle's comment for why. Falls back to the old generic suffix only if
    // it can't tell.
    const actionTitle = outfitSubjectActionTitle(thread)
    const suffix = SHORT_OUTFIT_ACTION_LABELS[actionTitle] || actionTitle || 'Critique'
    return truncateLabel(`${thread.activeContext.name || 'Saved outfit'} · ${suffix}`, 42)
  }

  return deriveTitleFromPrompt(firstAvailableText(thread), thread) || 'Styling chat'
}

function joinSummaryItems(items = []) {
  const clean = items.map(v => compactText(v).toLowerCase()).filter(Boolean)
  const unique = [...new Set(clean)].slice(0, 3)
  if (unique.length <= 1) return unique[0] || ''
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique[0]}, ${unique[1]} and ${unique[2]}`
}

function compactOutcomePhrase(value = '') {
  // Slot ids arrive here verbatim (`outdoor_daytime_social`, `smart_casual_outing`), and neither
  // the keyword branches below nor the fallback ever split on separators — so an unmatched id was
  // printed raw into the rail subtitle ("3 looks · outdoor_daytime_social"). Normalising here fixes
  // both: the keyword tests now see real words, and anything unmatched reads as prose.
  const v = compactText(value).replace(/[-_]+/g, ' ').toLowerCase()
  if (!v) return ''
  if (/\b(client|presentation|meeting|meetings)\b/.test(v)) return 'client meetings'
  if (/\b(office|work)\b/.test(v)) return 'office'
  if (/\b(winery|vineyard|tasting|tastings)\b/.test(v)) return 'winery'
  if (/\bmountain\b/.test(v) && /\b(hike|hiking)\b/.test(v)) return 'mountain hiking'
  if (/\b(hike|hiking|trail|trails)\b/.test(v)) return 'hike'
  if (/\b(dinner|evening)\b/.test(v)) return 'dinner'
  if (/\bbrunch\b/.test(v)) return 'brunch'
  if (/\b(beach|coastal|coast)\b/.test(v)) return 'beach'
  if (/\b(gallery|museum|art)\b/.test(v)) return 'gallery'
  if (/\berrands?\b/.test(v)) return 'errands'
  if (/\bmarket\b/.test(v)) return 'market'
  if (/\b(city|walking|walk|stroll)\b/.test(v)) return 'city walk'
  if (/\b(controlled|polished|elevated)\b.*\bedge\b|\bedge\b/.test(v)) return 'polished edge'
  return v
    .replace(/\b(visits?|explor(?:e|ing|ation)|tastings?|vibes?|ready|comfortable|relaxed|everyday|outfit|look|looks|day|days|morning|afternoon)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function outfitTheme(outfit = {}) {
  const source = compactText(outfit.bestFor || outfit.best_for || outfit.label || outfit.title || outfit.occasion || '')
    .replace(/\b(look|outfit|looks|outfits|day|days|morning|afternoon)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return compactOutcomePhrase(source)
}

export function getThreadOutcomeSummary(thread = {}) {
  const explicit = compactText(thread.outcomeSummary || thread.outcome_summary)
  if (explicit) return truncateLabel(explicit, 54)

  const memory = threadMemory(thread)
  const rawOutfits = Array.isArray(memory?.latestOutfits) ? memory.latestOutfits : []
  // E9: exclude diagnostic/"needs review" cards from the count and theme summary, same filter
  // StylistChat.jsx's in-chat header uses — otherwise this subtitle disagreed with the header's
  // own count for the same thread (header excludes them, this didn't). Same empty-set fallback
  // as the header, so a thread that's entirely diagnostic cards still shows a real count instead
  // of silently going to the no-outfits branch below.
  const visibleOutfits = rawOutfits.filter(outfit => !outfit?.diagnosticOnly)
  const outfits = visibleOutfits.length ? visibleOutfits : rawOutfits
  if (outfits.length) {
    const isDirections = outfits.some(o => o?.previewOnly)
    const noun = isDirections ? (outfits.length === 1 ? 'direction' : 'directions') : (outfits.length === 1 ? 'look' : 'looks')
    const themes = joinSummaryItems(outfits.map(outfitTheme))
    return truncateLabel(`${outfits.length} ${noun}${themes ? ` · ${themes}` : ''}`, 68)
  }

  const context = memory?.stylingContext || {}
  if (thread.kind === 'builder' || memory?.source === 'whole_wardrobe') {
    const request = compactText(context.request || context.mood)
    const season = context.season && context.season !== 'current season' ? humanizeLabel(context.season).toLowerCase() : ''
    return truncateLabel(request || (season ? `${season} wardrobe generation` : 'Wardrobe generation'), 54)
  }
  if (thread.activeContext?.type === 'piece') return 'Selected-piece styling'
  // E10: critique, similar-variants, creative-alternatives, adjacent-variants, and comparison
  // threads all share activeContext.type 'outfit' and thread.kind 'outfit_critique', so this
  // used to collapse every one of them to the same 'Outfit critique' subtitle regardless of
  // which action it actually was. outfitSubjectActionTitle already does this differentiation
  // correctly (it's what the "By outfit/piece" clustered view's child rows use) — just wasn't
  // wired into this flat-list subtitle. Falls back to the old generic text only if it can't
  // tell (empty prompt/title/source to pattern-match against).
  if (thread.activeContext?.type === 'outfit' || thread.kind === 'outfit_critique') {
    return outfitSubjectActionTitle(thread) || 'Outfit critique'
  }
  if (thread.kind === 'piece') return 'Selected-piece styling'
  if ((thread.message_count ?? 0) <= 2) return 'New styling chat'
  return 'Wardrobe styling chat'
}

function subjectPhotoFromThread(thread = {}) {
  return compactText(
    thread.subjectPhoto ||
    thread.subject_photo ||
    thread.activeContext?.photo ||
    thread.activeContext?.imageUrl ||
    thread.activeContext?.image_url ||
    ''
  )
}

export function getSubjectTypeLabel(type = '') {
  if (type === 'piece') return 'Piece'
  if (type === 'outfit') return 'Outfit'
  return 'Chat'
}

export function getSubjectIcon(type = '') {
  if (type === 'piece') return '□'
  if (type === 'outfit') return '◇'
  return '○'
}

function outfitSubjectActionTitle(thread = {}) {
  const memory = threadMemory(thread)
  const prompt = firstAvailableText(thread)
  const title = compactText(thread.generatedTitle || thread.generated_title || thread.title || '')
  const source = compactText(memory?.source || '')
  const haystack = `${prompt} ${title} ${source}`.toLowerCase()

  if (/\bcreative\b|\balternatives?\b/.test(haystack)) return 'Creative alternatives'
  if (/\badjacent\b/.test(haystack)) return 'Adjacent outfit variants'
  if (/\bsimilar\b|\bvariant|variants\b|\bformula[-\s]*similar\b|\bsaved_outfit_formula\b/.test(haystack)) {
    return 'Similar outfit variants'
  }
  if (/\bcompare|comparison\b/.test(haystack)) return 'Outfit comparison'
  if (/\bcritique|evaluate|evaluation|feedback\b/.test(haystack)) return 'Outfit critique'
  return ''
}

// Short forms of outfitSubjectActionTitle's labels, for contexts (the flat-list display title)
// that already show the outfit name and just need a terse " · <action>" suffix — matches the
// short suffixes ("Similar"/"Creative"/"Critique") StylistChat.jsx's send() already derives at
// thread-creation time, extended to the two actions it didn't originally label (comparison,
// adjacent variants).
const SHORT_OUTFIT_ACTION_LABELS = {
  'Creative alternatives': 'Creative',
  'Adjacent outfit variants': 'Adjacent variants',
  'Similar outfit variants': 'Similar',
  'Outfit comparison': 'Comparison',
  'Outfit critique': 'Critique',
}

export function getThreadSubjectChildTitle(thread = {}, subject = {}) {
  const customTitle = (thread.user_renamed || thread.userRenamed) ? compactText(thread.title) : ''
  if (customTitle) return truncateLabel(customTitle, 42)

  const displayTitle = getThreadDisplayTitle(thread)
  const subjectName = compactText(subject.name || thread.activeContext?.name || '')
  const sameAsSubject = subjectName && normalizeComparable(displayTitle).startsWith(normalizeComparable(subjectName))
  if (sameAsSubject) {
    const memory = threadMemory(thread)
    const outfits = Array.isArray(memory?.latestOutfits) ? memory.latestOutfits : []
    const firstOutcomeTitle = compactOutcomePhrase(outfits[0]?.title || outfits[0]?.label || outfits[0]?.bestFor || outfits[0]?.best_for || '')
    const isDirections = outfits.some(o => o?.previewOnly)
    const outfitActionTitle = subject.type === 'outfit' || thread.activeContext?.type === 'outfit'
      ? outfitSubjectActionTitle(thread)
      : ''
    if (outfitActionTitle && outfitActionTitle !== 'Outfit critique') return outfitActionTitle
    if (firstOutcomeTitle && !normalizeComparable(firstOutcomeTitle).startsWith(normalizeComparable(subjectName))) {
      return truncateLabel(`${titleCaseWords(firstOutcomeTitle)} ${isDirections ? 'direction' : 'styling'}`, 42)
    }
    if (outfitActionTitle) return outfitActionTitle
    if (thread.kind === 'outfit_critique' || thread.activeContext?.type === 'outfit') return 'Outfit critique'
    if (isDirections) return 'Styling directions'
    return 'Styling ideas'
  }

  return displayTitle
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
          typeLabel: getSubjectTypeLabel(ctx.type),
          icon: getSubjectIcon(ctx.type),
          photo: subjectPhotoFromThread(t),
          maxTime: 0,
          threads: []
        }
      }
      if (!clusters[clusterId].photo) {
        clusters[clusterId].photo = subjectPhotoFromThread(t)
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
