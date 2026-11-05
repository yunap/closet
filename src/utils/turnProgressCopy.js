// The words for a chat turn's progress (server: lib/turnProgress.js sends stage codes and plain facts).
// Kept here, not on the server, so the copy is in one place and the server never sends display text.
// Plain, present-tense, about what is actually happening; nothing about models, tokens or cost.

const CATEGORY_WORDS = {
  top: 'tops',
  bottom: 'bottoms',
  dress: 'dresses',
  shoes: 'shoes',
  outerwear: 'layers',
  accessory: 'accessories',
}

const OCCASION_WORDS = {
  casual: 'Casual',
  city: 'City',
  'smart casual': 'Smart casual',
  outdoor_daytime_social: 'Daytime outdoors',
  evening: 'Evening out',
  'gallery / art event': 'Gallery',
  travel: 'Travel',
  concert: 'Concert',
}

// Profiles that build outfits; the others answer a question, where a reading like "Casual" is noise.
const OUTFIT_PROFILES = new Set(['single_outfit', 'bounded_multi', 'trip_plan', 'full_stylist'])

function list(words) {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

function dayWords(dateText, now) {
  const match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((date - today) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days > 1 && days < 7) return date.toLocaleDateString('en-US', { weekday: 'long' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// How the request was read, as short chips. Empty when there is nothing worth showing.
export function understoodChips(facts = {}, { now = new Date() } = {}) {
  if (facts.asking || !OUTFIT_PROFILES.has(facts.profile)) return []
  const chips = []
  if (facts.setting === 'indoor_only') chips.push('At home')
  else if (facts.location) chips.push(facts.location)
  const day = dayWords(facts.date, now)
  if (day) chips.push(day)
  const occasion = OCCASION_WORDS[facts.occasion]
  if (occasion) chips.push(occasion)
  if (facts.timeOfDay && !(facts.timeOfDay === 'evening' && facts.occasion === 'evening')) {
    chips.push(facts.timeOfDay[0].toUpperCase() + facts.timeOfDay.slice(1))
  }
  if (facts.activity === 'walking') chips.push('Walking')
  if (facts.activity === 'hiking') chips.push('Hiking')
  if (facts.profile === 'single_outfit') chips.push('One outfit')
  if (facts.profile === 'bounded_multi') chips.push('A few options')
  if (facts.profile === 'trip_plan') chips.push('Trip plan')
  return chips
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

// The step a progress line starts, or '' for a step not worth naming.
export function stepText(event = {}) {
  if (event.stage === 'layer_repair') {
    const count = Number(event.count) || 0
    return count ? `Looking for a layer for ${plural(count, 'look', 'looks')}` : 'Looking for a layer'
  }
  if (event.stage !== 'tool') return ''
  const count = Number(event.count) || 0
  switch (event.tool) {
    case 'search_wardrobe': {
      const words = [...new Set((event.categories || []).map(category => CATEGORY_WORDS[category]).filter(Boolean))]
      return words.length ? `Looking through your ${list(words)}` : 'Looking through your wardrobe'
    }
    case 'view_pieces':
      return count ? `Looking closely at ${plural(count, 'piece', 'pieces')}` : 'Looking at the photos'
    case 'generate_outfits':
      if (event.aroundPiece) return 'Putting outfits together around your piece'
      return count > 1 ? `Putting together ${count} outfits from the photos` : 'Putting outfits together from the photos'
    case 'propose_outfit':
      return 'Checking the outfit'
    case 'plan_outfit_set':
      return count ? `Planning ${plural(count, 'look', 'looks')}` : 'Planning the looks'
    case 'submit_plan_outfits':
      return 'Putting the looks together'
    case 'suggest_slot_swaps':
      return 'Looking for swaps'
    case 'render_preview':
      return 'Making a picture of the outfit'
    case 'get_garment_details':
      return 'Reading the garment details'
    case 'wardrobe_coverage':
      return 'Checking what your wardrobe covers'
    case 'store_user_correction':
      return 'Saving what you told me'
    default:
      return ''
  }
}

export const FIRST_STEP_TEXT = 'Reading your request'

export function initialTurnProgress(startedAt = Date.now()) {
  return { startedAt, chips: [], done: [], current: FIRST_STEP_TEXT }
}

// Folds one progress line into the display state. Pure, so it is tested without a browser.
export function reduceTurnProgress(state, event = {}, { now = new Date() } = {}) {
  const current = state || initialTurnProgress()
  if (event.stage === 'understood') {
    return { ...current, chips: understoodChips(event, { now }) }
  }
  if (event.stage === 'attempt_failed') {
    return { ...current, done: [...current.done, { text: "That attempt didn't finish", warn: true }] }
  }
  const text = stepText(event)
  if (!text || text === current.current) return current
  return { ...current, done: [...current.done, { text: current.current }], current: text }
}
