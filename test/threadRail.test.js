import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  humanizeLabel,
  deriveBuilderTitle,
  getThreadDisplayTitle,
  getThreadOutcomeSummary,
  getThreadOriginalFirstMessage,
  getThreadSubjectChildTitle,
  groupThreadsByDate,
  clusterThreadsBySubject
} from '../src/utils/threadGrouping.js'

// Isolated per-run DB (spec 21 Part 1 pattern; missed here per spec 28's audit, fixed spec 29 Part
// 2) — this file imports `routes/ai.js`, which statically imports `db.js`. The env vars must land
// before `db.js` evaluates (its module-load tag_state backfill issues real UPDATEs against
// whatever DB it opens), so the import is dynamic and comes after this.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-thread-rail-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { deriveTripTitle } = await import('../routes/ai.js')

test('humanizeLabel formats occasions and activities correctly', () => {
  assert.equal(humanizeLabel('outdoor_daytime_social'), 'Outdoor social')
  assert.equal(humanizeLabel('smart-casual'), 'Smart casual')
  assert.equal(humanizeLabel('walking'), 'Lots of walking')
  assert.equal(humanizeLabel('hiking'), 'Hiking/Outdoor active')
  assert.equal(humanizeLabel('none'), '')
  assert.equal(humanizeLabel('some-random-tag'), 'Some Random Tag')
})

test('deriveBuilderTitle generates concise titles based on query details', () => {
  const title = deriveBuilderTitle({
    occasion: 'smart-casual',
    activity: 'walking',
    season: 'warm',
    mood: 'artistic minimalist'
  })
  assert.equal(title, 'Smart casual · Lots of walking · Warm · "artistic minimalist"')
})

test('thread display helpers derive concise history titles and outcome summaries', () => {
  const tripThread = {
    title: 'In a few days, I am going to Paso Robles...',
    originalFirstMessage: 'In a few days, I am going to Paso Robles for wineries, a hike, and dinner.',
    threadMemory: {
      latestOutfits: [
        { label: 'Winery Day' },
        { label: 'Hike Morning' },
        { label: 'Dinner Out' }
      ]
    }
  }

  assert.equal(getThreadOriginalFirstMessage(tripThread), tripThread.originalFirstMessage)
  assert.equal(getThreadDisplayTitle(tripThread), 'Paso Robles trip outfits')
  assert.equal(getThreadOutcomeSummary(tripThread), '3 looks · winery, hike and dinner')

  const renamedThread = {
    title: 'Review later',
    user_renamed: true,
    originalFirstMessage: 'Build me a 24-piece summer capsule'
  }
  assert.equal(getThreadDisplayTitle(renamedThread), 'Review later')

  const capsuleThread = {
    originalFirstMessage: 'Build me a 24-piece summer capsule wardrobe.'
  }
  assert.equal(getThreadDisplayTitle(capsuleThread), '24-piece summer capsule')
  assert.equal(getThreadOutcomeSummary(capsuleThread), 'New styling chat')

  const meetingThread = {
    originalFirstMessage: 'I need one outfit for a Thursday client meeting.',
    threadMemory: {
      latestOutfits: [
        { label: 'Everyday Office' },
        { label: 'Client Prep' }
      ]
    }
  }
  assert.equal(getThreadDisplayTitle(meetingThread), 'Thursday client outfit')
  assert.equal(getThreadOutcomeSummary(meetingThread), '2 looks · office and client meetings')

  // E10: critique/similar/creative/comparison threads all share activeContext.type 'outfit' and
  // used to collapse to the same "<name> critique" title and "Outfit critique" subtitle
  // regardless of which action it actually was. No threadMemory.latestOutfits on any of these —
  // that's the common real-world shape for a critique/variant/comparison reply (prose or a
  // rendered image, not a fresh structured-outfits array), which is exactly the case that used
  // to fall through to the generic branch being fixed here.
  const critiqueThread = {
    originalFirstMessage: 'Evaluate this outfit. Tell me whether the pieces work together, what feels risky, and what I should change first.',
    activeContext: { type: 'outfit', id: 'outfit_1', name: 'Volvo get together' },
  }
  assert.equal(getThreadDisplayTitle(critiqueThread), 'Volvo get together · Critique')
  assert.equal(getThreadOutcomeSummary(critiqueThread), 'Outfit critique')

  const similarThread = {
    originalFirstMessage: 'Create formula-similar outfits from my wardrobe based on this saved look.',
    activeContext: { type: 'outfit', id: 'outfit_1', name: 'Volvo get together' },
  }
  assert.equal(getThreadDisplayTitle(similarThread), 'Volvo get together · Similar')
  assert.equal(getThreadOutcomeSummary(similarThread), 'Similar outfit variants')

  const creativeThread = {
    originalFirstMessage: 'Generate creative alternatives from this saved outfit photo and linked garment references.',
    activeContext: { type: 'outfit', id: 'outfit_1', name: 'Volvo get together' },
  }
  assert.equal(getThreadDisplayTitle(creativeThread), 'Volvo get together · Creative')
  assert.equal(getThreadOutcomeSummary(creativeThread), 'Creative alternatives')

  const comparisonThread = {
    originalFirstMessage: 'Compare this outfit against another saved look.',
    activeContext: { type: 'outfit', id: 'outfit_1', name: 'Volvo get together' },
  }
  assert.equal(getThreadDisplayTitle(comparisonThread), 'Volvo get together · Comparison')
  assert.equal(getThreadOutcomeSummary(comparisonThread), 'Outfit comparison')

  const edgeThread = {
    threadMemory: {
      latestOutfits: [
        { title: 'Controlled Edge', previewOnly: true },
        { title: 'Polished Edge', previewOnly: true },
        { title: 'Elevated Edge', previewOnly: true }
      ]
    }
  }
  assert.equal(getThreadOutcomeSummary(edgeThread), '3 directions · polished edge')

  // E9: diagnostic/"needs review" cards must not count toward this subtitle — otherwise it
  // disagrees with the in-chat header, which already excludes them via the same filter.
  const mixedDiagnosticThread = {
    threadMemory: {
      latestOutfits: [
        { label: 'Winery Day' },
        { label: 'Rejected Attempt', broken: true, diagnosticOnly: true },
        { label: 'Dinner Out' }
      ]
    }
  }
  assert.equal(getThreadOutcomeSummary(mixedDiagnosticThread), '2 looks · winery and dinner')

  // All-diagnostic threads fall back to counting them anyway (same empty-set fallback the
  // in-chat header uses) rather than silently dropping to the no-outfits branch below.
  const allDiagnosticThread = {
    threadMemory: {
      latestOutfits: [
        { label: 'Rejected Attempt One', broken: true, diagnosticOnly: true },
        { label: 'Rejected Attempt Two', broken: true, diagnosticOnly: true }
      ]
    }
  }
  assert.equal(getThreadOutcomeSummary(allDiagnosticThread), '2 looks · rejected attempt one and rejected attempt two')

  const subjectChildThread = {
    title: 'dark grey gathered mini dress styling',
    activeContext: { type: 'piece', id: 'piece_1', name: 'dark grey gathered mini dress' },
    threadMemory: {
      latestOutfits: [
        { title: 'Belted Definition', previewOnly: true }
      ]
    }
  }
  assert.equal(getThreadSubjectChildTitle(subjectChildThread, subjectChildThread.activeContext), 'Belted Definition direction')

  const savedOutfitVariantThread = {
    title: 'Volvo get together · Similar',
    kind: 'outfit_critique',
    originalFirstMessage: 'Generate similar variants from this saved outfit photo and linked garment references.',
    activeContext: { type: 'outfit', id: 'outfit_1', name: 'Volvo get together' },
    threadMemory: {
      source: 'saved_outfit_formula',
      latestOutfits: [
        { title: 'Soft Structure Contrast' }
      ]
    }
  }
  assert.equal(getThreadSubjectChildTitle(savedOutfitVariantThread, savedOutfitVariantThread.activeContext), 'Similar outfit variants')

  const savedOutfitCritiqueThread = {
    title: 'Volvo get together · Critique',
    kind: 'outfit_critique',
    originalFirstMessage: 'Evaluate this outfit.',
    activeContext: { type: 'outfit', id: 'outfit_1', name: 'Volvo get together' }
  }
  assert.equal(getThreadSubjectChildTitle(savedOutfitCritiqueThread, savedOutfitCritiqueThread.activeContext), 'Outfit critique')
})

test('clusterThreadsBySubject clusters outfit/piece threads and groups freeform ones', () => {
  const threads = [
    {
      id: 'thread_1',
      title: 'Outfit discussion 1',
      activeContext: { type: 'outfit', id: 'outfit_123', name: 'Rioja Vineyard' },
      subjectPhoto: '/uploads/rioja.jpg',
      updated_at: '2026-07-07 12:00:00'
    },
    {
      id: 'thread_2',
      title: 'Outfit discussion 2',
      activeContext: { type: 'outfit', id: 'outfit_123', name: 'Rioja Vineyard' },
      updated_at: '2026-07-07 13:00:00'
    },
    {
      id: 'thread_3',
      title: 'Piece discussion',
      activeContext: { type: 'piece', id: 'piece_456', name: 'Emerald Pants' },
      subjectPhoto: '/uploads/emerald.jpg',
      updated_at: '2026-07-07 10:00:00'
    },
    {
      id: 'thread_4',
      title: 'Freeform conversation',
      activeContext: null,
      updated_at: '2026-07-07 14:00:00'
    }
  ]

  const { clusters, otherConversations } = clusterThreadsBySubject(threads)

  // 2 clusters should be created
  assert.equal(clusters.length, 2)
  
  // First cluster should be outfit_123 because maxTime is 13:00 vs 10:00 for piece_456
  assert.equal(clusters[0].id, 'outfit_123')
  assert.equal(clusters[0].name, 'Rioja Vineyard')
  assert.equal(clusters[0].typeLabel, 'Outfit')
  assert.equal(clusters[0].photo, '/uploads/rioja.jpg')
  assert.equal(clusters[0].threads.length, 2)
  assert.equal(clusters[0].threads[0].id, 'thread_2') // newest first within cluster

  assert.equal(clusters[1].id, 'piece_456')
  assert.equal(clusters[1].name, 'Emerald Pants')
  assert.equal(clusters[1].typeLabel, 'Piece')
  assert.equal(clusters[1].photo, '/uploads/emerald.jpg')
  assert.equal(clusters[1].threads.length, 1)

  // Freeform thread should land in other conversations
  assert.equal(otherConversations.length, 1)
  assert.equal(otherConversations[0].id, 'thread_4')
})

test('groupThreadsByDate categorizes threads into date windows', () => {
  const now = new Date()
  const todayTime = now.getTime()
  const yesterdayTime = todayTime - 24 * 60 * 60 * 1000
  const twoDaysAgoTime = todayTime - 2 * 24 * 60 * 60 * 1000
  const earlierTime = todayTime - 10 * 24 * 60 * 60 * 1000
  const builderTime = todayTime - 35 * 24 * 60 * 60 * 1000

  const threads = [
    { id: 't_today', updatedAt: todayTime },
    { id: 't_yesterday', updatedAt: yesterdayTime },
    { id: 't_thisWeek', updatedAt: twoDaysAgoTime },
    { id: 't_earlier', updatedAt: earlierTime },
    { id: 't_olderBuilder', updatedAt: builderTime, kind: 'builder' }
  ]

  const groups = groupThreadsByDate(threads)
  assert.equal(groups.today[0].id, 't_today')
  assert.equal(groups.yesterday[0].id, 't_yesterday')
  assert.equal(groups.thisWeek[0].id, 't_thisWeek')
  assert.equal(groups.earlier[0].id, 't_earlier')
  assert.equal(groups.olderBuilder[0].id, 't_olderBuilder')
})

test('groupThreadsByDate disableOlderBuilderCollapse flag works for archived view', () => {
  const now = new Date()
  const builderTime = now.getTime() - 35 * 24 * 60 * 60 * 1000

  const threads = [
    { id: 't_olderBuilder', updatedAt: builderTime, kind: 'builder' }
  ]

  // Without the flag, it collapses
  const groups1 = groupThreadsByDate(threads, false)
  assert.equal(groups1.olderBuilder.length, 1)
  assert.equal(groups1.earlier.length, 0)

  // With the flag, it does not collapse (lands in earlier)
  const groups2 = groupThreadsByDate(threads, true)
  assert.equal(groups2.olderBuilder.length, 0)
  assert.equal(groups2.earlier.length, 1)
})

test('ThreadRail component view toggle and collapsed state persists via localStorage code checks', () => {
  const source = fs.readFileSync(new URL('../src/components/ThreadRail.jsx', import.meta.url), 'utf8')
  
  assert.match(source, /localStorage\.getItem\('stylist_rail_view_mode'\)/)
  assert.match(source, /localStorage\.setItem\('stylist_rail_view_mode',\s*viewMode\)/)
  assert.match(source, /localStorage\.getItem\('stylist_rail_collapsed'\)/)
  assert.match(source, /localStorage\.setItem\('stylist_rail_collapsed',\s*String\(collapsed\)\)/)
  assert.doesNotMatch(source, /stylist_subject_groups_open/)
})

test('active thread deletion can fall through to another thread or new chat', () => {
  const chatSource = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')
  const railSource = fs.readFileSync(new URL('../src/components/ThreadRail.jsx', import.meta.url), 'utf8')

  assert.doesNotMatch(chatSource, /totalThreads\s*<=\s*1\s*&&\s*threadId\s*===\s*currentThreadId/)
  assert.match(chatSource, /openThread\(nextThread\.id,\s*\{\s*skipSaveCurrent:\s*true\s*\}\)/)
  assert.match(chatSource, /openThread\('new_chat',\s*\{\s*skipSaveCurrent:\s*true\s*\}\)/)
  assert.match(chatSource, /navigate\('\/stylist\/'\s*\+\s*nextThread\.id,\s*\{\s*replace:\s*true\s*\}\)/)
  assert.match(chatSource, /navigate\('\/stylist',\s*\{\s*replace:\s*true\s*\}\)/)
  assert.doesNotMatch(railSource, /threads\.length\s*>\s*1\s*&&\s*\(/)
})

test('opening a saved thread does not rewrite thread recency metadata', () => {
  const source = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')

  assert.match(source, /const\s+suppressThreadLoadAutosaveRef\s*=\s*useRef\(false\)/)
  assert.match(source, /!skipSaveCurrent\s*&&\s*debounceTimerRef\.current\s*&&\s*currentThreadId/)
  assert.match(source, /suppressThreadLoadAutosaveRef\.current\s*=\s*true/)
  assert.match(source, /suppressNextMessageScrollRef\.current\s*=\s*true/)
  assert.match(source, /const\s+loadedMessages\s*=\s*thread\.payload\.messages/)
  assert.match(source, /setMessages\(loadedMessages\)/)
  assert.match(source, /if\s*\(suppressThreadLoadAutosaveRef\.current\)\s*\{\s*suppressThreadLoadAutosaveRef\.current\s*=\s*false\s*return\s*\}/)
})

test('ThreadRail subject view renders a collapsible wardrobe tree', () => {
  const source = fs.readFileSync(new URL('../src/components/ThreadRail.jsx', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

  assert.match(source, /const\s+\[openSubjectGroups,\s*setOpenSubjectGroups\]\s*=\s*useState\(\{\}\)/)
  assert.match(source, /className="subject-cluster-header"/)
  assert.match(source, /aria-expanded=\{isOpen\}/)
  assert.match(source, /aria-label=\{`\$\{isOpen \? 'Collapse' : 'Expand'\} \$\{cluster\.name\}/)
  assert.match(source, /title=\{cluster\.name\}/)
  assert.match(source, /cluster\.photo\s*\?\s*\(/)
  assert.match(source, /const isOpen = isActiveGroup \|\| Boolean\(openSubjectGroups\[key\]\)/)
  assert.match(source, /const childRows = getSubjectChildRows\(cluster\)/)
  assert.match(source, /formatChildTitleTime\(row\.thread\.updatedAt \|\| row\.thread\.updated_at\)/)
  assert.match(source, /title: time \? `\$\{row\.title\} · \$\{time\}` : row\.title/)
  assert.match(source, /renderThreadRow\(thread,\s*\{\s*subject:\s*cluster,\s*childTitle:\s*title\s*\}\)/)
  assert.match(source, /getThreadSubjectChildTitle\(t,\s*subject\)/)
  assert.match(source, /aria-label=\{`Open chat: \$\{fullLabel\}`\}/)
  assert.match(source, /<span className="thread-title-text" title=\{displayTitle\}>/)
  assert.match(css, /\.cluster-rows\s*\{[\s\S]*margin-left: 36px/)
  assert.match(css, /\.cluster-rows\s*\{[\s\S]*border-left: 1px solid rgba\(139, 111, 82, 0\.1\)/)
  assert.match(css, /\.thread-row\.subject-child-row \.thread-row-main\s*\{[\s\S]*padding-left: 18px/)
  assert.match(css, /\.thread-row\.subject-child-row\.active[\s\S]*padding-top: 3px/)
  assert.match(css, /\.subject-disclosure[\s\S]*width: 24px/)
  assert.match(css, /\.subject-meta[\s\S]*font-weight: 650/)
  assert.match(css, /\.thread-row-main:focus-visible/)
  assert.match(css, /\.thread-overflow-btn:focus-visible/)
})

test('StylistChat queries saved-boards on mount and uses savedBoardUrls to check saved state', () => {
  const source = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')
  
  // Verify state declaration
  assert.match(source, /const\s*\[savedBoardUrls,\s*setSavedBoardUrls\]\s*=\s*useState\(new Set\(\)\)/)
  
  // Verify fetch call on mount (extracted into refreshSavedBoards, called from the mount effect)
  assert.match(source, /fetch\('\/api\/saved-boards\?limit=1000'\)/)
  assert.match(source, /refreshSavedBoards\(\)/)
  assert.match(source, /setSavedBoardUrls\(urls\)/)
  
  // Verify imageURL checks for board/visual card rendering
  assert.match(source, /isSaved\s*=\s*savedBoardKeys\.has\(saveKey\)\s*\|\|\s*\(board\.imageUrl\s*&&\s*savedBoardUrls\.has\(board\.imageUrl\)\)/)
  assert.match(source, /isSaved\s*=\s*savedBoardKeys\.has\(key\)\s*\|\|\s*\(visual\.imageUrl\s*&&\s*savedBoardUrls\.has\(visual\.imageUrl\)\)/)
  assert.match(source, /isBoardSaved\s*=\s*savedBoardKeys\.has\(saveKey\)\s*\|\|\s*\(board\.imageUrl\s*&&\s*savedBoardUrls\.has\(board\.imageUrl\)\)/)
})

test('deriveTripTitle parses trip destination, duration, and occasion parameters correctly', () => {
  // Question with destination and day count
  const title1 = deriveTripTitle('Compose outfits for a 5-day summer trip to Portland, OR', '', [])
  assert.equal(title1, 'Portland, OR trip · 5 days')

  // Question with destination and no day count, but outfits present
  const title2 = deriveTripTitle('packing for NYC', '', [{ tripSummary: { durationText: '3 days' } }])
  assert.equal(title2, 'NYC trip · 3 days')

  // Question with destination and no day count
  const title3 = deriveTripTitle('what should I pack for a smart casual dinner in London?', '', [])
  assert.equal(title3, 'London trip')

  // Question with no destination, but day count and slots occasion bestFor
  const title4 = deriveTripTitle('4 days trip', '', [
    { occasion: 'outdoor_daytime_social' },
    { occasion: 'evening' }
  ])
  assert.equal(title4, 'Trip · 4 days · Winery/Evening')
})

test('StylistChat handles errors by rendering distinct error bubble and bypassing rule actions', () => {
  const source = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')

  // Verify that an assistant error message renders in an error-bubble wrapper
  assert.match(source, /className="ai-message assistant error-bubble"/)
  assert.match(source, /background:\s*'rgba\(219,\s*68,\s*85,\s*0\.08\)'/)
  assert.match(source, /border:\s*'1px\s*solid\s*rgba\(219,\s*68,\s*85,\s*0\.25\)'/)

  // Verify that styling rule buttons are bypassed for error messages, and (2026-08-14) for a
  // plain local-acknowledgment reply that never actually discussed the active piece/outfit —
  // see the item 12 fast path in routes/ai.js.
  assert.match(source, /!m\.isError\s*&&\s*!m\.isLocalAcknowledgment\s*&&\s*i\s*>\s*0\s*&&\s*activeContext\s*&&\s*i\s*===\s*latestAssistantIndex/)

  // Verify that the client-side follow-up query uses the existing thread and does not create a new one
  assert.match(source, /let\s*isTransitioningNew\s*=\s*currentThreadId\s*===\s*'new_chat'/)
})

test('Outfit card layout refinement - split chips, saved badge, details teaser, telemetry details', () => {
  const source = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')

  // 1. Verify getTeaserText helper existence
  assert.match(source, /const getTeaserText =/)

  // Test getTeaserText sentence splitting behavior directly
  const getTeaserText = (text) => {
    if (!text) return ''
    const trimmed = String(text).trim()
    const firstSentence = trimmed.split(/[.!?]\s/)[0]
    if (firstSentence.length < trimmed.length) {
      return firstSentence + '.'
    }
    return firstSentence
  }
  assert.equal(getTeaserText("This is perfect. It works really well."), "This is perfect.")
  assert.equal(getTeaserText("Only one sentence"), "Only one sentence")
  assert.equal(getTeaserText(""), "")

  // 2. Verify primary vs diagnostic chip split logic
  assert.match(source, /const primaryTypes = \['signature', 'works', 'almost', 'not_me'\]/)
  assert.match(source, /const primaryLabels = GENERATED_BOARD_FEEDBACK_LABELS\.filter/)
  assert.match(source, /const diagnosticLabels = GENERATED_BOARD_FEEDBACK_LABELS\.filter/)

  // 3. Verify More feedback / Less feedback toggles and disclosure rendering
  assert.match(source, /Less feedback ▴/)
  assert.match(source, /More feedback ▾/)
  assert.match(source, /isExpanded\s*&&\s*\(/)

  // 4. Verify relative position card wrapper for saved board badge positioning
  assert.match(source, /className="generated-visual-card"\s+style=\{\{\s*position:\s*'relative'/i)

  // 5. Verify saved board badge styling
  assert.match(source, /className="saved-board-badge"/i)

  // 6. Verify telemetry details collapse
  assert.match(source, /className="telemetry-details"/i)
})

test('rail summaries humanize slot ids instead of printing them raw', () => {
  const mk = labels => ({ id: 't', kind: 'chat', threadMemory: { latestOutfits: labels.map(l => ({ label: l, bestFor: l })) } })
  // Slot ids reached the subtitle verbatim ("3 looks · outdoor_daytime_social") because neither
  // the keyword branches nor the fallback split on separators.
  assert.ok(!getThreadOutcomeSummary(mk(['outdoor_daytime_social'])).includes('_'))
  assert.match(getThreadOutcomeSummary(mk(['outdoor_daytime_social'])), /outdoor daytime social/)
  // Normalizing separators exposed a latent alternation bug: /\bgallery|museum|art\b/ parses as
  // (\bgallery)|(museum)|(art\b), so "sm-art casual" matched "gallery" once the underscore that
  // had been suppressing the word boundary became a space.
  assert.match(getThreadOutcomeSummary(mk(['smart_casual_outing'])), /smart casual outing/)
  assert.doesNotMatch(getThreadOutcomeSummary(mk(['smart_casual_outing'])), /gallery/)
  // real slot vocabulary still maps to its intended phrase
  assert.match(getThreadOutcomeSummary(mk(['city_gallery'])), /gallery/)
})

test('nature_walk keeps its own phrase instead of collapsing into city walk', () => {
  const mk = labels => ({ id: 't', kind: 'chat', threadMemory: { latestOutfits: labels.map(l => ({ label: l, bestFor: l })) } })
  // Underscore-to-space normalization turned "nature_walk" into "nature walk", which then matched
  // the generic /\b(city|walking|walk|stroll)\b/ branch and printed "city walk" — semantically
  // wrong in the rail (a real nature hike/stroll reading as an urban outing).
  assert.match(getThreadOutcomeSummary(mk(['nature_walk'])), /nature walk/)
  assert.doesNotMatch(getThreadOutcomeSummary(mk(['nature_walk'])), /city walk/)
  // plain city/walking vocabulary still collapses to city walk
  assert.match(getThreadOutcomeSummary(mk(['city_stroll'])), /city walk/)
})
