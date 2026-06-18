import test, { after, afterEach, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-ai-contracts-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''
process.env.PHOTO_PRESERVING_VISUALS = 'true'
process.env.WARDROBE_TEST_MAX_WHOLE_WARDROBE_CANDIDATES = '18'
process.env.WARDROBE_TEST_MAX_WHOLE_WARDROBE_REVIEW_CANDIDATES = '3'

const { app, db, uploadsDir, executeTool, contentToOpenAI } = await import('../server.js')
const { savedOutfitImagePrompt } = await import('../styling-engine/core.js')
const { extractToolResultImages } = await import('../styling-engine/provider.js')

let server
let baseUrl
let seeded
let aiCalls = []

before(async () => {
  server = app.listen(0)
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  resetTables()
  seeded = await seedWardrobe()
  aiCalls = []
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = mockAiHandler
})

afterEach(() => {
  delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  delete globalThis.__WARDROBE_AI_TEST_RESPONSES__
})

function resetTables() {
  for (const table of [
    'outfit_pieces',
    'outfits',
    'pieces',
    'saved_boards',
    'stylist_feedback',
    'whole_wardrobe_sessions',
    'calibration_images',
    'stylist_conversation_state',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
}

async function makeImage(filename, color = '#d8c9b7') {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
  await sharp({
    create: {
      width: 120,
      height: 160,
      channels: 3,
      background: color,
    },
  }).png().toFile(path.join(uploadsDir, filename))
  return filename
}

async function seedWardrobe() {
  const photos = {
    top: await makeImage('top.png', '#222222'),
    bottom: await makeImage('bottom.png', '#eee4d6'),
    jeans: await makeImage('jeans.png', '#1d2f45'),
    shoe: await makeImage('shoe.png', '#e7dfd2'),
    boot: await makeImage('boot.png', '#6f4d34'),
    jacket: await makeImage('jacket.png', '#777777'),
    dress: await makeImage('dress.png', '#4b1f48'),
    outfit: await makeImage('outfit.png', '#c7b299'),
  }

  const top = insertPiece({
    name: 'black button detail top',
    category: 'top',
    colors: ['black'],
    occasions: ['city', 'casual'],
    photo: photos.top,
    reads_as: 'quiet dark structured top',
    silhouette: 'fitted',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const bottom = insertPiece({
    name: 'light beige linen wide-leg pants',
    category: 'bottom',
    colors: ['cream'],
    occasions: ['city', 'casual'],
    photo: photos.bottom,
    worn_photo: photos.outfit,
    reads_as: 'soft structured light column',
    bottom_shape: 'wide_leg',
    length_hits_at: 'full-length',
    fabric_category: 'linen',
  })
  const jeans = insertPiece({
    name: 'black bootcut denim jeans',
    category: 'bottom',
    colors: ['black'],
    occasions: ['city', 'casual'],
    photo: photos.jeans,
    reads_as: 'quiet dark neutral',
    bottom_shape: 'bootcut',
    fabric_category: 'denim',
  })
  const shoe = insertPiece({
    name: 'cream slip-on shoes',
    category: 'shoes',
    colors: ['cream'],
    occasions: ['city', 'casual'],
    photo: photos.shoe,
    reads_as: 'quiet casual grounding',
  })
  const boot = insertPiece({
    name: 'brown ankle boots',
    category: 'shoes',
    colors: ['brown'],
    occasions: ['city', 'casual'],
    photo: photos.boot,
    reads_as: 'grounded boot',
  })
  const jacket = insertPiece({
    name: 'gray jacket',
    category: 'outerwear',
    colors: ['gray'],
    occasions: ['city'],
    photo: photos.jacket,
    reads_as: 'quiet structured layer',
  })
  const dress = insertPiece({
    name: 'plum wool dress',
    category: 'dress',
    colors: ['plum'],
    occasions: ['city', 'evening'],
    photo: photos.dress,
    reads_as: 'simple one piece column',
  })

  const outfitId = db.prepare(`
    INSERT INTO outfits (name, occasion, season, photo)
    VALUES (?, ?, ?, ?)
  `).run('Vest top + white blouse', 'city', 'year-round', photos.outfit).lastInsertRowid
  for (const id of [top, bottom, shoe]) {
    db.prepare('INSERT INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)').run(outfitId, id)
  }

  return { top, bottom, jeans, shoe, boot, jacket, dress, outfitId, photos }
}

function insertPiece(overrides = {}) {
  const piece = {
    name: 'test piece',
    category: 'top',
    colors: [],
    occasions: ['casual'],
    season: 'year-round',
    notes: '',
    status: 'active',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    role_permission: 'auto',
    occasion_permissions: [],
    engine_notes: '',
    photo: null,
    worn_photo: null,
    pattern_type: 'solid',
    pattern_scale: 'none',
    pattern_complexity: 'solid',
    reads_as: '',
    silhouette: '',
    fabric_category: '',
    fabric_weight: '',
    length_hits_at: '',
    style_profile_json: {},
    ...overrides,
  }
  return db.prepare(`
    INSERT INTO pieces (
      name, category, colors, occasions, season, notes, status,
      recommendation_status, fit_confidence, role_permission, occasion_permissions,
      engine_notes, photo, worn_photo, pattern_type, pattern_scale,
      pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight,
      length_hits_at, style_profile_json
    ) VALUES (
      @name, @category, @colors, @occasions, @season, @notes, @status,
      @recommendation_status, @fit_confidence, @role_permission, @occasion_permissions,
      @engine_notes, @photo, @worn_photo, @pattern_type, @pattern_scale,
      @pattern_complexity, @reads_as, @silhouette, @fabric_category, @fabric_weight,
      @length_hits_at, @style_profile_json
    )
  `).run({
    ...piece,
    colors: JSON.stringify(piece.colors),
    occasions: JSON.stringify(piece.occasions),
    occasion_permissions: JSON.stringify(piece.occasion_permissions),
    style_profile_json: JSON.stringify(piece.style_profile_json),
  }).lastInsertRowid
}

async function postJson(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json()
  assert.equal(response.status, 200, `${pathname} failed: ${JSON.stringify(json)}`)
  return json
}

function mockAiHandler({ system, messages }) {
  aiCalls.push({ system, messages })
  const text = String(system || '')
  const latestMessage = Array.isArray(messages) ? messages.at(-1) : null
  const latestText = Array.isArray(latestMessage?.content)
    ? latestMessage.content.map(part => part?.text || '').join('\n')
    : String(latestMessage?.content || '')

  if (text.includes('visual support-piece critic')) {
    return {
      rankedPieceIds: [seeded.top, seeded.shoe, seeded.boot, seeded.jacket],
      rejectedPieceIds: [],
      visualLearning: 'mock selected-piece visual pass',
    }
  }

  if (text.includes('visual wardrobe critic')) {
    return {
      rankedCandidateIds: ['cand-1', 'cand-2', 'cand-3'],
      rejectedCandidateIds: [],
      visualLearning: 'mock whole-wardrobe visual pass',
    }
  }

  if (text.includes('visual editorial stylist')) {
    return {
      directions: [{
        title: 'Mock editorial direction',
        missingPieces: ['ideal silk shirt', 'leather boots'],
        reason: 'Styling mock reason',
        watchFor: 'Grounding watch',
        visualPrompt: 'Mood reference'
      }]
    }
  }

  if (text.includes('FREEFORM_STYLIST_USE_CASE_PLANNER')) {
    if (/\b(same outfit|spill|wine|four nights|4 nights|enough|variety)\b/i.test(latestText)) {
      return {
        shouldCompose: true,
        reason: 'User is asking for additional dinner coverage from the current set.',
        slots: [
          {
            id: 'dinner_alternative_1',
            label: 'Dinner Alternative 1',
            occasion: 'evening',
            activity: 'none',
            season: 'cool evening weather',
            bestFor: 'additional dinner coverage',
            planNote: 'Use owned wardrobe pieces and avoid exact repeats from the current set.',
          },
          {
            id: 'dinner_alternative_2',
            label: 'Dinner Alternative 2',
            occasion: 'evening',
            activity: 'none',
            season: 'cool evening weather',
            bestFor: 'backup dinner option',
            planNote: 'Use owned wardrobe pieces and keep the register suitable for dinner.',
          },
        ],
      }
    }
    if (/pack|packing|trip|travel/i.test(latestText)) {
      return {
        shouldCompose: true,
        reason: 'User needs a multi-use-case packing plan.',
        slots: [
          {
            id: 'city_exploring',
            label: 'City Exploring',
            occasion: 'city',
            activity: 'walking',
            season: 'hot weather',
            bestFor: 'hot daytime city exploring and walking',
            planNote: 'Prioritize breathable garments and walkable shoes.',
          },
          {
            id: 'museum_day',
            label: 'Museum Day',
            occasion: 'city',
            activity: 'none',
            season: 'hot weather',
            bestFor: 'museum day and indoor cultural visits',
            planNote: 'Keep it presentable indoors without overheating outside.',
          },
          {
            id: 'dinner',
            label: 'Dinner Out',
            occasion: 'evening',
            activity: 'none',
            season: 'cool evening weather',
            bestFor: 'cooler evening dinner',
            planNote: 'Use a dinner-register outfit and add a layer only if it helps.',
          },
          {
            id: 'winery',
            label: 'Winery Day',
            occasion: 'outdoor_daytime_social',
            activity: 'walking',
            season: 'hot weather',
            bestFor: 'warm daytime winery visit',
            planNote: 'Keep it outdoor-social and standing-friendly.',
          },
        ],
      }
    }
    return {
      shouldCompose: false,
      reason: 'Conversational follow-up does not require new structured cards.',
      slots: [],
    }
  }

  if (text.includes('Outfit Composer') || text.includes('Outfit Gate')) {
    return {
      outfits: [selectedPieceOutfit()],
      rejected: [],
      skip: '',
      saveableLearning: 'mock selected-piece learning',
    }
  }

  if (text.includes('personal visual stylist agent') || text.includes('whole-wardrobe outfit composer') || text.includes("You are Yuna's personal stylist. You are looking at photos")) {
    return {
      outfits: [{
        label: 'Mock city column',
        strength: 'signature',
        dominantDirection: 'city structure with grounded shoe',
        silhouette: 'controlled top over grounded lower line',
        bestFor: 'city',
        pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
        reason: 'The dark top clarifies the light pant and the shoe keeps the floor line readable.',
        watchFor: 'Keep the shoe visible.',
      }],
      rejected: [],
      skip: '',
      saveableLearning: 'mock whole-wardrobe learning',
    }
  }

  if (text.includes('evaluating one proposed whole-wardrobe outfit')) {
    if (/Response mode:\s*followup/i.test(latestText)) {
      return {
        answer: 'Direct follow-up answer about the attached outfit photos.',
      }
    }
    return {
      summary: 'Mock evaluation',
      inferredIntent: {
        label: 'city casual',
        successCriteria: ['clear proportions'],
      },
      visibleFacts: {
        floorLine: 'shoes are visible',
        fitPlacement: 'garments sit naturally',
        proportionRead: 'top length and pant rise create a readable proportion',
        shoeAnalysis: {
          visibility: 'visible/readable',
          read: 'cream slip-on shoes',
          confidence: 'high',
        },
      },
      evaluation: {
        summary: 'Mock evaluation',
        verdict: 'keep',
        tensionType: 'productive',
        maintenanceBurden: 'low',
        scores: { tensionQuality: 4, silhouetteIntegrity: 4 },
        roles: {
          heroPiece: 'black button detail top',
          supportPieces: ['light beige linen wide-leg pants'],
          groundingPiece: 'cream slip-on shoes',
        },
        ideaViability: 'keep',
        executionGap: 'minor floor-line watch only',
        mainSuccess: 'The proportions are readable.',
        firstVisibleIssue: 'No major issue.',
      },
      works: ['garment placement is readable'],
      risks: [],
      recommendation: { smallestAdjustment: 'Keep the floor line visible.', avoidForNow: 'Do not over-layer.' },
    }
  }

  return 'Mock stylist answer with generated outfit context.'
}

function selectedPieceOutfit() {
  return {
    label: 'Mock selected-piece outfit',
    strength: 'signature',
    dominantDirection: 'selected garment with quiet support',
    silhouette: 'selected garment with controlled support pieces',
    bestFor: 'city',
    pieceIds: [seeded.bottom, seeded.top, seeded.shoe],
    pieces: [
      { id: seeded.bottom, name: 'light beige linen wide-leg pants', category: 'bottom' },
      { id: seeded.top, name: 'black button detail top', category: 'top' },
      { id: seeded.shoe, name: 'cream slip-on shoes', category: 'shoes' },
    ],
    reason: 'The selected garment is supported by quiet pieces.',
    watchFor: 'Keep grounding visible.',
  }
}

function generatedCard() {
  return {
    label: 'Mock city column',
    strength: 'signature',
    dominantDirection: 'city structure with grounded shoe',
    silhouette: 'controlled top over grounded lower line',
    bestFor: 'city',
    pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
    pieces: [
      { id: seeded.top, name: 'black button detail top', category: 'top' },
      { id: seeded.bottom, name: 'light beige linen wide-leg pants', category: 'bottom' },
      { id: seeded.shoe, name: 'cream slip-on shoes', category: 'shoes' },
    ],
    reason: 'The dark top clarifies the light pant.',
    watchFor: 'Keep the shoe visible.',
  }
}

test('selected-piece generator returns structured outfit cards', async () => {
  const json = await postJson('/api/ai/generate-outfits-for-piece', {
    pieceId: seeded.bottom,
    occasion: 'city',
    season: 'current season',
  })

  assert.equal(json.mode, 'generate_outfit_ideas')
  assert.equal(json.pipeline, 'selected_piece_visual_composer')
  assert.ok(Array.isArray(json.structuredOutfits))
  assert.ok(json.structuredOutfits.length >= 1)
  assert.ok(json.structuredOutfits[0].pieceIds.includes(seeded.bottom))
  assert.ok('visualCritic' in json.debug)
  assert.ok(json.debug.visualCritic.shownPieceCount > 0)
})

test('selected-piece visual composer pins the selected anchor when model omits it', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    aiCalls.push({ system, messages })
    return {
      outfits: [{
        label: 'Mock omitted-anchor outfit',
        strength: 'strong',
        dominantDirection: 'support pieces without anchor',
        silhouette: 'dark top with quiet shoe',
        bestFor: 'city',
        pieceIds: [seeded.top, seeded.shoe],
        reason: 'The support pieces are compatible.',
        watchFor: 'Selected anchor must be restored.',
      }],
      rejected: [],
      skip: '',
      saveableLearning: '',
    }
  }

  const json = await postJson('/api/ai/generate-outfits-for-piece', {
    pieceId: seeded.bottom,
    occasion: 'city',
    season: 'current season',
  })

  assert.equal(json.pipeline, 'selected_piece_visual_composer')
  assert.ok(json.structuredOutfits[0].pieceIds.includes(seeded.bottom))
  assert.ok(json.structuredOutfits[0].pieces.some(p => Number(p.id) === Number(seeded.bottom)))
})

test('selected-piece visual composer repairs boots for June walking', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    aiCalls.push({ system, messages })
    return {
      outfits: [{
        label: 'Mock June walk with boots',
        strength: 'strong',
        dominantDirection: 'structured pants with boot grounding',
        silhouette: 'wide pant over boot',
        bestFor: 'casual walk',
        pieceIds: [seeded.bottom, seeded.top, seeded.boot],
        reason: 'The boot grounds the pant.',
        watchFor: 'Warm walking should prefer lighter footwear.',
      }],
      rejected: [],
      skip: '',
      saveableLearning: '',
    }
  }

  const json = await postJson('/api/ai/generate-outfits-for-piece', {
    pieceId: seeded.bottom,
    occasion: 'casual',
    season: 'current season',
    activity: 'walking',
  })

  const first = json.structuredOutfits[0]
  assert.equal(json.pipeline, 'selected_piece_visual_composer')
  assert.ok(first.pieceIds.includes(seeded.bottom))
  assert.equal(first.pieceIds.includes(seeded.boot), false, 'June walking should not return ankle boots')
  assert.ok(first.watchFor.includes('swapped for all-day walking comfort'))
})

test('selected-piece generator accepts and forwards mission and mood parameters', async () => {
  const json = await postJson('/api/ai/generate-outfits-for-piece', {
    pieceId: seeded.bottom,
    occasion: 'city',
    season: 'current season',
    mission: 'monochrome_texture',
    mood: 'moody winter',
  })

  assert.equal(json.mode, 'generate_outfit_ideas')
  assert.ok(Array.isArray(json.structuredOutfits))

  const lastCall = aiCalls.find(c => c.system.includes('SELECTED-ANCHOR CONTRACT'))
  assert.ok(lastCall, 'A selected-piece visual composer call was recorded')
  const latestMessage = lastCall.messages.at(-1)
  const latestText = Array.isArray(latestMessage?.content)
    ? latestMessage.content.map(part => part?.text || '').join('\n')
    : String(latestMessage?.content || '')

  assert.match(latestText, /Mission: monochrome_texture/)
  assert.match(latestText, /Mood: moody winter/)
})

test('editorial-directions-preview generator accepts and forwards mission and mood parameters', async () => {
  const json = await postJson('/api/ai/editorial-directions-preview', {
    pieceId: seeded.bottom,
    occasion: 'city',
    season: 'current season',
    mission: 'structured_soft',
    mood: 'dreamy retro',
  })

  assert.ok(Array.isArray(json.directions))
  assert.ok(json.directions.length >= 1)

  const lastCall = aiCalls.find(c => c.system.includes('visual editorial stylist'))
  assert.ok(lastCall, 'An editorial preview call was recorded')
  const latestMessage = lastCall.messages.at(-1)
  const latestText = Array.isArray(latestMessage?.content)
    ? latestMessage.content.map(part => part?.text || '').join('\n')
    : String(latestMessage?.content || '')

  assert.match(latestText, /Mission: structured_soft/)
  assert.match(latestText, /Mood: dreamy retro/)
})

test('whole-wardrobe generator returns cards and records resettable session memory', async () => {
  const json = await postJson('/api/ai/generate-wardrobe-outfits', {
    occasion: 'city',
    season: 'spring',
    mood: 'artistic minimalist',
    limit: 3,
  })

  assert.equal(json.mode, 'generate_wardrobe_outfits')
  assert.equal(json.pipeline, 'whole_wardrobe_composer_evaluator')
  assert.ok(Array.isArray(json.structuredOutfits))
  assert.ok(json.structuredOutfits.length >= 1)
  assert.ok(json.debug.candidateCount > 0)
  assert.ok(json.debug.finalReturnedCount >= 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM whole_wardrobe_sessions').get().count, 1)

  // Verify occasion profile rules are present in the system prompt for the agent
  const agentCalls = aiCalls.filter(c => c.system.includes('personal visual stylist agent'))
  assert.equal(agentCalls.length, 1)
  assert.ok(agentCalls[0].system.includes('OCCASION & CLIMATE PROFILES (RULES-AS-DATA)'))
  assert.ok(agentCalls[0].system.includes('Occasion & Weather Classification'))

  const response = await fetch(`${baseUrl}/api/ai/whole-wardrobe-session-memory`, { method: 'DELETE' })
  const resetJson = await response.json()
  assert.equal(response.status, 200)
  assert.equal(resetJson.mode, 'reset_whole_wardrobe_session_memory')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM whole_wardrobe_sessions').get().count, 0)
})

test('visual wardrobe composer endpoint returns outfits and populates debug shownPieceCount', async () => {
  // Clear any pre-existing calls
  aiCalls = []

  const json = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'current season',
    mood: 'modern bohemian',
    limit: 3,
  })

  assert.equal(json.mode, 'generate_wardrobe_outfits_visual')
  assert.equal(json.pipeline, 'full_wardrobe_visual_composer')
  assert.ok(Array.isArray(json.structuredOutfits))
  assert.ok(json.structuredOutfits.length >= 1)
  assert.ok(json.debug.shownPieceCount > 0)
  assert.ok(json.debug.aiReturnedCount >= 1)

  // Verify that rotation sessions are saved
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM whole_wardrobe_sessions').get().count, 1)

  // 1. Generate an image from a visual-composer card via the existing /api/ai/generate-wardrobe-outfit-image endpoint
  const outfit = json.structuredOutfits[0]
  const imageJson = await postJson('/api/ai/generate-wardrobe-outfit-image', {
    outfit,
    occasion: 'city',
    season: 'current season',
  })

  assert.equal(imageJson.mode, 'generate_wardrobe_outfit_image')
  assert.ok(imageJson.imageUrl)
  assert.equal(imageJson.wholeWardrobe, true)

  // 2. Run the workflow twice in a row and confirm the second call's outfits differ meaningfully (rotation warning loop test)
  const json2 = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'current season',
    mood: 'modern bohemian',
    limit: 3,
  })

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM whole_wardrobe_sessions').get().count, 2)
  
  // Verify that the second call received rotation warning texts (meaning it saw recently shown garments)
  const visualComposerCalls = aiCalls.filter(c => c.system.includes("You are Yuna's personal stylist. You are looking at photos"))
  assert.equal(visualComposerCalls.length, 2)

  // Verify occasion profile rules are present in the system prompt for the visual composer
  for (const call of visualComposerCalls) {
    assert.ok(call.system.includes('OCCASION & CLIMATE PROFILES (RULES-AS-DATA)'))
    assert.ok(call.system.includes('Occasion & Weather Classification'))
  }

  const firstCallText = visualComposerCalls[0].messages[0].content[0].text
  const secondCallText = visualComposerCalls[1].messages[0].content[0].text

  // The first call shouldn't have rotation warning text for 'city' occasion (as it was empty)
  assert.ok(!firstCallText.includes('Recently shown garments'))
  // The second call must contain rotation warning text listing the garments from the first session
  assert.ok(secondCallText.includes('Recently shown garments'))
})

test('visual wardrobe composer endpoint propagates activity parameter to LLM prompt', async () => {
  aiCalls = []

  const json = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'current season',
    mood: 'modern bohemian',
    activity: 'walking',
    limit: 2,
  })

  assert.equal(json.mode, 'generate_wardrobe_outfits_visual')
  const visualComposerCalls = aiCalls.filter(c => c.system.includes("You are Yuna's personal stylist. You are looking at photos"))
  assert.ok(visualComposerCalls.length >= 1)
  
  const contentText = visualComposerCalls[0].messages[0].content[0].text
  assert.ok(contentText.includes('Activity: walking'), 'The visual composer prompt must contain Activity: walking')
  assert.ok(contentText.includes('All-day walking: avoid stilettos, high heels, pumps, delicate sandals, and warm-weather boots'), 'The visual composer prompt must contain walking guidance')
})


test('selected-piece board generation returns saved-garment visual boards', async () => {
  const json = await postJson('/api/ai/generate-outfit-boards', {
    pieceId: seeded.bottom,
    occasion: 'city',
    season: 'current season',
    structuredOutfits: [selectedPieceOutfit()],
  })

  assert.equal(json.mode, 'generate_outfit_boards')
  assert.ok(Array.isArray(json.boards))
  assert.ok(json.boards[0].imageUrl.startsWith('/uploads/generated-boards/'))
  assert.ok(fs.existsSync(path.join(uploadsDir, json.boards[0].imageUrl.replace('/uploads/', ''))))
})

test('whole-wardrobe image endpoint returns one generated board artifact', async () => {
  const json = await postJson('/api/ai/generate-wardrobe-outfit-image', {
    outfit: generatedCard(),
    pieceIds: generatedCard().pieceIds,
    occasion: 'city',
    season: 'current season',
  })

  assert.equal(json.mode, 'generate_wardrobe_outfit_image')
  assert.ok(json.imageUrl.startsWith('/uploads/generated-boards/'))
  assert.equal(json.wholeWardrobe, true)
  assert.ok(json.debug.renderer)
})

test('whole-wardrobe comparison sheet endpoint returns a preview board artifact', async () => {
  const first = generatedCard()
  const second = {
    ...generatedCard(),
    label: 'Mock dress column',
    pieceIds: [seeded.dress, seeded.boot],
    pieces: [
      { id: seeded.dress, name: 'plum wool dress', category: 'dress' },
      { id: seeded.boot, name: 'brown ankle boots', category: 'shoes' },
    ],
  }

  const json = await postJson('/api/ai/generate-wardrobe-outfit-comparison-sheet', {
    outfits: [first, second],
    occasion: 'city',
    season: 'current season',
  })

  assert.equal(json.mode, 'generate_wardrobe_outfit_comparison_sheet')
  assert.equal(json.previewOnly, true)
  assert.ok(json.imageUrl.startsWith('/uploads/generated-boards/'))
})

test('ideal-additions preview sheet endpoint returns a preview board artifact', async () => {
  const json = await postJson('/api/ai/generate-ideal-additions-preview-sheet', {
    pieceId: seeded.bottom,
    directions: [
      { label: 'Direction A', additions: ['leather belt', 'white tee'], reason: 'contrast' },
      { label: 'Direction B', additions: ['silk blouse', 'mules'], reason: 'drape' }
    ],
    occasion: 'city',
    season: 'current season',
  })

  assert.equal(json.mode, 'generate_ideal_additions_preview_sheet')
  assert.equal(json.previewOnly, true)
  assert.ok(json.imageUrl.startsWith('/uploads/generated-boards/'))
  assert.equal(json.pieces.length, 1)
  assert.equal(json.pieces[0].id, seeded.bottom)
})

test('saved outfit variants endpoint supports creative boards from linked pieces', async () => {
  const json = await postJson('/api/ai/generate-saved-outfit-image', {
    outfit: { id: seeded.outfitId, name: 'Vest top + white blouse', photo: `/uploads/${seeded.photos.outfit}` },
    occasion: 'city',
    season: 'current season',
    variantMode: 'creative',
  })

  assert.equal(json.mode, 'generate_saved_outfit_creative_alternatives')
  assert.equal(json.debug.variantCount, 3)
  assert.equal(json.debug.requestCount, 1)
  assert.equal(json.boards[0].variantMode, 'creative')
  assert.ok(json.boards[0].imageUrl.startsWith('/uploads/generated-boards/'))
})

test('saved outfit variants prompt treats current season in June as warm-weather context', () => {
  const prompt = savedOutfitImagePrompt({
    outfit: { name: 'Summer saved outfit' },
    pieces: [
      { id: seeded.top, name: 'emerald sleeveless top', category: 'Top' },
      { id: seeded.bottom, name: 'beige pleated pants', category: 'Bottom' },
      { id: seeded.shoe, name: 'brown ankle boots', category: 'Shoes' },
    ],
    occasion: 'casual',
    season: 'current season',
    variantMode: 'similar',
    currentDate: new Date('2026-06-15T12:00:00-07:00'),
  })

  assert.ok(prompt.includes('Warm/current-season realism'))
  assert.ok(prompt.includes('do not introduce boots, ankle boots, or heavy cold-weather footwear'))
})

test('wardrobe outfit evaluator sends outfit and linked garment images', async () => {
  const json = await postJson('/api/ai/evaluate-wardrobe-outfit', {
    outfit: { label: 'Mock outfit', photo: `/uploads/${seeded.photos.outfit}` },
    pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
    occasion: 'city',
    season: 'current season',
  })

  assert.equal(json.mode, 'evaluate_wardrobe_outfit')
  assert.equal(json.debug.outfitImageIncluded, true)
  assert.equal(json.debug.linkedPieceCount, 3)
  assert.ok(json.debug.imageCount >= 4)
  assert.match(json.feedback, /Mock evaluation/)
  assert.match(json.feedback, /Fit placement: garments sit naturally/)
  assert.match(json.feedback, /Proportion read: top length and pant rise create a readable proportion/)
  assert.match(json.feedback, /Idea viability: keep/)
  assert.match(json.feedback, /Execution gap: minor floor-line watch only/)
})

test('wardrobe outfit evaluator enriches saved outfit cards with linked garment authority', async () => {
  const json = await postJson('/api/ai/evaluate-wardrobe-outfit', {
    outfit: { id: seeded.outfitId, label: 'Vest top + white blouse', photo: `/uploads/${seeded.photos.outfit}` },
    occasion: 'city',
    season: 'year-round',
    question: 'Evaluate this outfit.',
  })

  assert.equal(json.mode, 'evaluate_wardrobe_outfit')
  assert.equal(json.debug.outfitImageIncluded, true)
  assert.equal(json.debug.linkedPieceCount, 3)
  assert.ok(json.debug.imageCount >= 4)

  const lastCall = aiCalls.at(-1)
  const latestUserMessage = lastCall.messages.at(-1)
  const latestText = latestUserMessage.content.at(-1).text
  assert.match(latestText, /AUTHORITY NOTE: This outfit has linked garment records/)
  assert.match(latestText, /Outfit: "Vest top \+ white blouse"/)
  assert.match(latestText, /Linked garment truth:/)
  assert.match(latestText, /black button detail top/)
  assert.match(latestText, /light beige linen wide-leg pants/)
  assert.match(latestText, /cream slip-on shoes/)
})

test('wardrobe outfit followup exposes current image inventory', async () => {
  const json = await postJson('/api/ai/evaluate-wardrobe-outfit', {
    outfit: { label: 'Mock outfit', photo: `/uploads/${seeded.photos.outfit}` },
    pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
    occasion: 'city',
    season: 'current season',
    responseMode: 'followup',
    question: 'Which images do you still see?',
    previousEvaluation: 'Previous critique text.',
  })

  assert.equal(json.mode, 'evaluate_wardrobe_outfit')
  assert.match(json.feedback, /I have these images attached in this turn/)
  assert.match(json.feedback, /actual worn outfit photo: Mock outfit/)
  assert.match(json.feedback, /linked garment reference photo: black button detail top/)
  assert.match(json.feedback, /linked garment reference photo: light beige linen wide-leg pants/)
  assert.match(json.feedback, /linked garment reference photo: cream slip-on shoes/)
  assert.match(json.feedback, /Direct follow-up answer about the attached outfit photos/)
  assert.doesNotMatch(json.feedback, /Visible facts:/)
  assert.doesNotMatch(json.feedback, /Updated read:/)

  const lastCall = aiCalls.at(-1)
  const latestUserMessage = lastCall.messages.at(-1)
  assert.ok(Array.isArray(latestUserMessage.content))
  assert.match(latestUserMessage.content.at(-1).text, /Current attached image inventory for this turn/)
  assert.match(latestUserMessage.content.at(-1).text, /If the user asks what photos\/images you can see/)
})

test('legacy saved outfit evaluator endpoint is removed', async () => {
  const response = await fetch(`${baseUrl}/api/ai/evaluate-outfit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outfitId: seeded.outfitId,
      question: 'What do you think of this outfit?',
    }),
  })

  assert.equal(response.status, 404)
})

test('saved outfit cards use the shared wardrobe evaluator with linked garment images', async () => {
  const json = await postJson('/api/ai/evaluate-wardrobe-outfit', {
    outfit: {
      id: seeded.outfitId,
      label: 'Saved outfit card',
    },
    outfitId: seeded.outfitId,
    question: 'What do you think of this outfit?',
  })

  assert.equal(json.mode, 'evaluate_wardrobe_outfit')
  assert.equal(json.pipeline, 'whole_wardrobe_outfit_evaluator')
  assert.equal(json.debug.outfitImageIncluded, true)
  assert.equal(json.debug.linkedPieceCount, 3)
  assert.ok(json.debug.imageCount >= 4)
  assert.match(json.feedback, /Mock evaluation/)
  assert.match(json.feedback, /Fit placement: garments sit naturally/)
  assert.match(json.feedback, /Proportion read: top length and pant rise create a readable proportion/)
  assert.match(json.feedback, /Idea viability: keep/)
  assert.match(json.feedback, /Execution gap: minor floor-line watch only/)

  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /evaluating one proposed whole-wardrobe outfit/)
})

test('uploaded outfit feedback uses the shared wardrobe evaluator with uploaded image evidence', async () => {
  const form = new FormData()
  const fileBuffer = fs.readFileSync(path.join(uploadsDir, seeded.photos.outfit))
  form.set('photo', new Blob([fileBuffer], { type: 'image/png' }), 'outfit.png')
  form.set('question', 'What do you think of this outfit?')
  form.set('outfitName', 'Uploaded hotel breakfast outfit')
  form.set('outfitNotes', 'The shoes are black and visible.')

  const response = await fetch(`${baseUrl}/api/ai/outfit-feedback`, {
    method: 'POST',
    body: form,
  })
  const json = await response.json()

  assert.equal(response.status, 200, `/api/ai/outfit-feedback failed: ${JSON.stringify(json)}`)
  assert.equal(json.mode, 'evaluate_uploaded_outfit_photo')
  assert.equal(json.pipeline, 'whole_wardrobe_outfit_evaluator')
  assert.equal(json.debug.outfitImageIncluded, true)
  assert.equal(json.debug.linkedPieceCount, 0)
  assert.equal(json.debug.imageCount, 1)
  assert.match(json.feedback, /Mock evaluation/)
  assert.match(json.feedback, /Fit placement: garments sit naturally/)
  assert.match(json.feedback, /Proportion read: top length and pant rise create a readable proportion/)
  assert.match(json.feedback, /Idea viability: keep/)
  assert.match(json.feedback, /Execution gap: minor floor-line watch only/)

  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /evaluating one proposed whole-wardrobe outfit/)
  const latestUserMessage = lastCall.messages.at(-1)
  assert.ok(Array.isArray(latestUserMessage.content))
  assert.equal(latestUserMessage.content[0].type, 'image')
  assert.match(latestUserMessage.content.at(-1).text, /Mode: evaluate_uploaded_outfit_photo/)
})

test('freeform ask attaches generated outfit image context when cards are supplied', async () => {
  const pieces = db.prepare('SELECT * FROM pieces WHERE status = ?').all('active').map(row => ({
    ...row,
    colors: JSON.parse(row.colors || '[]'),
    occasions: JSON.parse(row.occasions || '[]'),
    occasion_permissions: JSON.parse(row.occasion_permissions || '[]'),
    styling_rules_learned: [],
    pairs_well_with: [],
    tried_and_rejected: [],
    style_profile_json: JSON.parse(row.style_profile_json || '{}'),
  }))
  const json = await postJson('/api/ai/ask', {
    question: 'Can you see the shoe photo in the first generated outfit?',
    pieces,
    history: [],
    generatedContext: 'Generated outfit cards are visible in the current stylist thread.',
    generatedOutfits: [generatedCard()],
    conversationMode: 'explanation',
    currentDateLabel: 'Monday, June 1, 2026',
    timezone: 'America/Los_Angeles',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  const lastCall = aiCalls.at(-1)
  const latestUserMessage = lastCall.messages.at(-1)
  assert.match(lastCall.system, /CURRENT DATE \/ SEASON/)
  assert.match(lastCall.system, /Monday, June 1, 2026/)
  assert.match(lastCall.system, /CONVERSATION CONTROLLER/)
  assert.match(lastCall.system, /Current turn mode: explanation/)
  assert.ok(Array.isArray(latestUserMessage.content))
  assert.equal(latestUserMessage.content[0].type, 'image')
  assert.match(latestUserMessage.content[1].text, /generated outfit garment-reference sheet/)
})

test('freeform ask grounds date and correction mode for conversational follow-ups', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'today is June 1st',
    pieces: [],
    history: [
      { role: 'user', content: 'What should I pack for Portland in a few weeks?' },
      { role: 'assistant', content: 'Assuming fall, bring layers.' },
    ],
    conversationMode: 'correction',
    currentDateLabel: 'Monday, June 1, 2026',
    timezone: 'America/Los_Angeles',
    threadContext: 'User is correcting a previous seasonal assumption.',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  const lastCall = aiCalls.at(-1)
  const latestUserMessage = lastCall.messages.at(-1)
  assert.match(lastCall.system, /Today is Monday, June 1, 2026/)
  assert.match(lastCall.system, /Current turn mode: correction/)
  assert.match(lastCall.system, /The user is correcting or challenging a detail/)
  assert.match(lastCall.system, /User is correcting a previous seasonal assumption/)
  assert.equal(typeof latestUserMessage.content, 'string')
  assert.match(latestUserMessage.content, /Today is Monday, June 1, 2026/)
  assert.match(latestUserMessage.content, /today is June 1st/)
})

test('freeform ask infers correction mode from latest user message', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'Wait, today is June 1st',
    pieces: [],
    history: [
      { role: 'user', content: 'What should I pack for Portland in a few weeks?' },
      { role: 'assistant', content: 'Assuming fall, bring layers.' },
    ],
    conversationMode: 'new_request',
    currentDateLabel: 'Monday, June 1, 2026',
    timezone: 'America/Los_Angeles',
    threadContext: 'Previous assistant assumed fall for a Portland trip.',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  const lastCall = aiCalls.at(-1)
  const latestUserMessage = lastCall.messages.at(-1)
  assert.match(lastCall.system, /Current turn mode: correction/)
  assert.match(lastCall.system, /Turn directive: The user is challenging or correcting a previous response/)
  assert.equal(typeof latestUserMessage.content, 'string')
  assert.match(latestUserMessage.content, /today is June 1st/)
})

test('freeform ask image follow-ups use current attachment wording', async () => {
  const pieces = db.prepare('SELECT * FROM pieces WHERE status = ?').all('active').map(row => ({
    ...row,
    colors: JSON.parse(row.colors || '[]'),
    occasions: JSON.parse(row.occasions || '[]'),
    occasion_permissions: JSON.parse(row.occasion_permissions || '[]'),
    styling_rules_learned: [],
    pairs_well_with: [],
    tried_and_rejected: [],
    style_profile_json: JSON.parse(row.style_profile_json || '{}'),
  }))
  const json = await postJson('/api/ai/ask', {
    question: 'Which images do you still see?',
    pieces,
    history: [],
    generatedContext: 'Generated outfit cards are visible in the current stylist thread.',
    generatedOutfits: [generatedCard()],
    conversationMode: 'new_request',
    currentDateLabel: 'Monday, June 1, 2026',
    timezone: 'America/Los_Angeles',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  const lastCall = aiCalls.at(-1)
  const latestUserMessage = lastCall.messages.at(-1)
  assert.match(lastCall.system, /Current turn mode: explanation/)
  assert.match(lastCall.system, /photos attached to the CURRENT API call/)
  assert.match(lastCall.system, /any images attached to this call/)
  assert.doesNotMatch(lastCall.system, /Photos from earlier in the conversation are no longer visible/)
  assert.ok(Array.isArray(latestUserMessage.content))
  assert.match(lastCall.system, /Turn directive: The user is asking for explanation or rationale/)
})

test('freeform ask generated outfit follow-up stays conversational without reattaching cards', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'So dinner out is 4 nights, same outfit? What if I spill some wine?',
    pieces: [],
    history: [
      { role: 'user', content: 'Suggest outfits for a Portland trip.' },
      { role: 'assistant', content: 'Here is the trip plan followed by outfit cards.' },
    ],
    generatedContext: 'Outfit 1: City Exploring\nPieces:\n- paisley sleeveless blouse\n\nOutfit 2: Dinner Out\nPieces:\n- black dress',
    generatedOutfits: [generatedCard()],
    conversationMode: 'followup',
    occasion: 'city',
    season: 'highs 80-90F days, cool evenings',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  assert.ok(Array.isArray(json.structuredOutfits))
  assert.ok(json.structuredOutfits.length > 0)
  assert.ok(json.structuredOutfits.every(outfit => /dinner/i.test(outfit.label || '')))
  assert.ok(json.structuredOutfits.every(outfit => (outfit.pieces || []).every(piece => piece?.id && !piece?.missing)))
  const lastCall = aiCalls.at(-1)
  const plannerCall = aiCalls.find(call => /FREEFORM_STYLIST_USE_CASE_PLANNER/.test(call.system || ''))
  assert.ok(plannerCall, 'follow-up should use the planner to decompose the new coverage need')
  const latestUserMessage = lastCall.messages.at(-1)
  assert.match(lastCall.system, /Current turn mode: followup/)
  assert.match(lastCall.system, /treat the cards as memory only/)
  assert.match(lastCall.system, /do not repeat the full trip plan or outfit list/)
  assert.match(lastCall.system, /CURRENT SET COVERAGE AUDIT/)
  assert.match(lastCall.system, /MUST call search_wardrobe with visual:true/)
  assert.match(lastCall.system, /Suggest only exact owned wardrobe garments returned by search_wardrobe/)
  assert.match(lastCall.system, /Do NOT invent aspirational pieces/)
  assert.match(lastCall.system, /do NOT add shopping-style \[missing wardrobe gap\] outfits/)
  assert.equal(typeof latestUserMessage.content, 'string')
  assert.doesNotMatch(latestUserMessage.content, /Attached: current generated outfit garment-reference sheet/)
})

test('freeform ask shoe follow-up maps to explanation mode and targets shoes', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'why those shoes?',
    pieces: [],
    history: [
      { role: 'user', content: 'Suggest a city structured outfit' },
      { role: 'assistant', content: 'Use the linen pants and the brown ankle boots.' },
    ],
    conversationMode: 'followup',
    threadContext: 'Critique of city column outfit suggesting brown ankle boots.',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /Current turn mode: explanation/)
  assert.match(lastCall.system, /Turn directive: The user is asking for explanation or rationale/)
})

test('freeform ask surfaces established styling context for follow-up generation', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'make these more interesting',
    pieces: [],
    history: [
      { role: 'user', content: 'Use my wardrobe to create outfits for evening, current season, walking.' },
      { role: 'assistant', content: 'Here are the generated evening outfits.' },
    ],
    generatedContext: 'Generated evening outfit cards are visible in the current stylist thread.',
    conversationMode: 'followup',
    occasion: 'evening',
    season: 'current season',
    mood: 'moody polish',
    mission: 'wildcard',
    activity: 'walking',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  assert.equal(json.structuredOutfitsOccasion, 'evening')
  assert.equal(json.structuredOutfitsSeason, 'current season')
  assert.equal(json.structuredOutfitsMood, 'moody polish')
  assert.equal(json.structuredOutfitsMission, 'wildcard')
  assert.equal(json.structuredOutfitsActivity, 'walking')

  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /Established styling context in this thread: occasion=evening; activity=walking; season=current season; mood=moody polish; mission=wildcard/)
  assert.match(lastCall.system, /Reuse these for any follow-up outfit generation unless the user's message changes them/)
})

test('freeform ask outfit follow-up does not repeat full critique template', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'can we make it sharper?',
    pieces: [],
    history: [],
    conversationMode: 'followup',
    outfit: { id: seeded.outfitId, label: 'Vest top + white blouse' },
    pieceIds: [seeded.top, seeded.bottom],
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /Current turn mode: followup/)
  assert.match(lastCall.system, /Only use the full structured outfit-evaluation template when the user explicitly asks to evaluate or critique an outfit/)
})

test('freeform ask outfit follow-up handles image presence and attaches images', async () => {
  const pieces = db.prepare('SELECT * FROM pieces WHERE status = ?').all('active').map(row => ({
    ...row,
    colors: JSON.parse(row.colors || '[]'),
    occasions: JSON.parse(row.occasions || '[]'),
    occasion_permissions: JSON.parse(row.occasion_permissions || '[]'),
    styling_rules_learned: [],
    pairs_well_with: [],
    tried_and_rejected: [],
    style_profile_json: JSON.parse(row.style_profile_json || '{}'),
  }))

  const json = await postJson('/api/ai/ask', {
    question: 'do you see the garment photo?',
    pieces,
    history: [],
    conversationMode: 'followup',
    outfit: { label: 'Active outfit', photo: seeded.photos.outfit },
    pieceIds: [seeded.top, seeded.bottom],
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /CURRENT ATTACHED IMAGE INVENTORY:/)
  assert.match(lastCall.system, /actual worn outfit photo: Active outfit/)
  assert.match(lastCall.system, /linked garment reference photo: black button detail top/)
  
  const latestUserMessage = lastCall.messages.at(-1)
  assert.ok(Array.isArray(latestUserMessage.content))
  // The first few elements should be images
  assert.equal(latestUserMessage.content[0].type, 'image')
  assert.equal(latestUserMessage.content.at(-1).type, 'text')
  assert.match(latestUserMessage.content.at(-1).text, /Attached: images for the outfit under discussion/)
})

test('freeform ask broad request triggers clarifying question instruction', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'suggest packing outfits for Portland',
    pieces: [],
    history: [],
    conversationMode: 'new_request',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  assert.deepEqual(json.structuredOutfits, [])
  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /ask exactly one clear clarifying question/i)
  assert.match(lastCall.system, /do not recommend garments, and do not suggest outfits/)
  assert.match(lastCall.system, /TRAVEL WEATHER BLOCKER/)
  assert.match(lastCall.system, /weather\/forecast context is missing/)
})

test('freeform ask extracts travel weather and surfaces it to tools', async () => {
  insertPiece({
    name: 'paisley sleeveless blouse',
    category: 'top',
    colors: ['blue', 'green'],
    occasions: ['city', 'casual', 'outdoor_daytime_social'],
    photo: seeded.photos.top,
    reads_as: 'lightweight sleeveless blouse',
    fabric_weight: 'light',
  })
  insertPiece({
    name: 'beige tailored linen shorts',
    category: 'bottom',
    colors: ['beige'],
    occasions: ['city', 'casual', 'outdoor_daytime_social'],
    photo: seeded.photos.bottom,
    reads_as: 'tailored linen shorts',
    fabric_category: 'linen',
    fabric_weight: 'light',
  })
  insertPiece({
    name: 'black cream geometric midi skirt',
    category: 'bottom',
    colors: ['black', 'cream'],
    occasions: ['city', 'evening'],
    photo: seeded.photos.bottom,
    reads_as: 'graphic geometric midi skirt',
    pattern_complexity: 'loud',
  })
  insertPiece({
    name: 'vibrant blue sleeveless top',
    category: 'top',
    colors: ['blue'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.top,
    reads_as: 'bright casual sleeveless top',
  })
  insertPiece({
    name: 'oatmeal crochet knit midi skirt',
    category: 'bottom',
    colors: ['oatmeal'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.bottom,
    reads_as: 'soft crochet knit midi skirt',
  })
  insertPiece({
    name: 'striped knit cardigan',
    category: 'outerwear',
    colors: ['cream', 'blue'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.jacket,
    reads_as: 'casual striped knit cardigan',
  })
  insertPiece({
    name: 'black herringbone pointed heels',
    category: 'shoes',
    colors: ['black'],
    occasions: ['city', 'evening', 'outdoor_daytime_social'],
    photo: seeded.photos.shoe,
    reads_as: 'black pointed heel dress shoes',
  })
  insertPiece({
    name: 'grey wool black stripe knit dress',
    category: 'dress',
    colors: ['grey', 'black'],
    occasions: ['city'],
    photo: seeded.photos.dress,
    reads_as: 'wool knit fitted stripe midi dress',
    fabric_category: 'wool',
    fabric_weight: 'heavy',
  })

  const json = await postJson('/api/ai/ask', {
    question: "Hi there! In a few days, I am going to Portland, OR. The trip will take 4-5 days. Mainly city exploring, walking, a few museums, and also a few nice restaurants and one day at a winery. What would you suggest I should pack? They say it'll be pretty hot during the day",
    pieces: [],
    history: [],
    conversationMode: 'new_request',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  assert.ok(Array.isArray(json.structuredOutfits))
  assert.ok(json.structuredOutfits.length >= 4)
  assert.ok(json.structuredOutfits.every(outfit => outfit.reason && outfit.reason.length > 20))
  assert.ok(json.structuredOutfits.some(outfit => /city exploring/i.test(outfit.label || '')))
  assert.ok(json.structuredOutfits.some(outfit => /dinner/i.test(outfit.label || '')))
  assert.ok(json.structuredOutfits.some(outfit => /winery/i.test(outfit.label || '')))
  const dressFormulas = json.structuredOutfits
    .map(outfit => (outfit.pieces || []).find(piece => piece.category === 'dress')?.id)
    .filter(Boolean)
  assert.equal(new Set(dressFormulas).size, dressFormulas.length, 'trip slots should not reuse the same dress formula when alternatives exist')
  const initialDinner = json.structuredOutfits.find(outfit => /dinner/i.test(outfit.label || ''))
  const initialDinnerPieces = (initialDinner?.pieces || []).map(piece => piece.name || '').join(' | ').toLowerCase()
  assert.ok(initialDinner)
  assert.ok(
    !(/striped knit cardigan/.test(initialDinnerPieces) && /slip-on|slip on/.test(initialDinnerPieces)),
    'initial dinner slot should not combine a casual striped cardigan with casual slip-ons'
  )
  assert.equal(initialDinner.occasion, 'evening')
  assert.equal(initialDinner.activity, 'none')
  const museumOutfit = json.structuredOutfits.find(outfit => /museum/i.test(outfit.label || ''))
  assert.ok(museumOutfit)
  assert.equal(museumOutfit.activity, 'none')
  const museumPieces = (museumOutfit.pieces || []).map(piece => `${piece.name || ''} ${piece.fabric_category || ''} ${piece.fabric_weight || ''}`).join(' | ').toLowerCase()
  assert.doesNotMatch(museumPieces, /grey wool black stripe knit dress|wool.*heavy/, 'museum slot should not use a heavy wool dress in hot daytime weather')
  const daytimeTripOutfits = json.structuredOutfits.filter(outfit => outfit.activity === 'walking')
  assert.ok(daytimeTripOutfits.length >= 2)
  for (const outfit of daytimeTripOutfits) {
    const shoeText = (outfit.pieces || [])
      .filter(piece => piece.category === 'shoes')
      .map(piece => `${piece.name || ''} ${piece.reads_as || ''}`)
      .join(' ')
      .toLowerCase()
    assert.doesNotMatch(shoeText, /\b(pointed|heel|heels|mule|mules|boot|boots)\b/, `${outfit.label} should use hot-weather walking footwear`)
    if (outfit.tripSlot !== 'winery') {
      const lowerHalfText = (outfit.pieces || [])
        .filter(piece => ['bottom', 'dress'].includes(piece.category))
        .map(piece => `${piece.name || ''} ${piece.reads_as || ''}`)
        .join(' ')
        .toLowerCase()
      assert.doesNotMatch(lowerHalfText, /\b(geometric midi skirt|crochet knit midi skirt|dress)\b/, `${outfit.label} should not use dressed-up skirts or dresses for hot walking slots`)
    }
  }
  const dinnerPieces = initialDinnerPieces
  assert.ok(
    !(/vibrant blue sleeveless top/.test(dinnerPieces) && /oatmeal crochet knit midi skirt/.test(dinnerPieces) && /striped knit cardigan/.test(dinnerPieces)),
    'dinner slot should not choose the casual crochet skirt plus striped cardigan combination'
  )
  assert.equal(json.structuredOutfitsSource, 'whole_wardrobe')
  const lastCall = aiCalls.at(-1)
  const plannerCall = aiCalls.find(call => /FREEFORM_STYLIST_USE_CASE_PLANNER/.test(call.system || ''))
  assert.ok(plannerCall, 'initial trip plan should use the planner to decompose stated use cases')
  assert.match(plannerCall.system, /Map dinner, evening restaurant, and night-out use cases to occasion "evening" with activity "none"/)
  assert.match(plannerCall.system, /For museums, galleries, and indoor cultural visits, use activity "none"/)
  assert.match(lastCall.system, /Established weather context for this turn: hot weather/)
  assert.match(lastCall.system, /Pass this weather to search_wardrobe/)
  assert.match(lastCall.system, /CURRENT OUTFIT SET \(LATEST, HIGH AUTHORITY\)/)
  assert.match(lastCall.system, /pre-composed by the validated wardrobe composer/)
  assert.doesNotMatch(lastCall.system, /TRAVEL WEATHER BLOCKER/)
})

test('freeform ask non-visual follow-up prunes base64 images to save tokens', async () => {
  const pieces = db.prepare('SELECT * FROM pieces WHERE status = ?').all('active').map(row => ({
    ...row,
    colors: JSON.parse(row.colors || '[]'),
    occasions: JSON.parse(row.occasions || '[]'),
    occasion_permissions: JSON.parse(row.occasion_permissions || '[]'),
    styling_rules_learned: [],
    pairs_well_with: [],
    tried_and_rejected: [],
    style_profile_json: JSON.parse(row.style_profile_json || '{}'),
  }))

  const json = await postJson('/api/ai/ask', {
    question: 'where should I wear this?', // non-visual question
    pieces,
    history: [
      { role: 'user', content: 'Evaluate this outfit.' },
      { role: 'assistant', content: 'Looks great!' },
    ],
    conversationMode: 'followup',
    outfit: { label: 'Active outfit', photo: seeded.photos.outfit },
    pieceIds: [seeded.top, seeded.bottom],
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /CURRENT ATTACHED IMAGE INVENTORY:/)
  assert.match(lastCall.system, /images omitted on this turn to conserve vision tokens/)
  
  const latestUserMessage = lastCall.messages.at(-1)
  // Content should be a plain string since images are pruned
  assert.equal(typeof latestUserMessage.content, 'string')
  assert.doesNotMatch(latestUserMessage.content, /Attached: images/)
})

test('freeform ask correction saves preference reaction to database', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'I do not wear flats',
    pieces: [],
    history: [],
    conversationMode: 'correction',
    outfit: { id: seeded.outfitId, label: 'Active outfit' },
    pieceIds: [seeded.top, seeded.bottom],
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  
  const row = db.prepare(`
    SELECT * FROM stylist_feedback 
    WHERE feedback_type = 'preference_reaction' 
    ORDER BY id DESC LIMIT 1
  `).get()
  
  assert.ok(row)
  assert.equal(row.note, 'I do not wear flats')
  assert.equal(row.context_type, 'outfit')
  assert.equal(Number(row.context_id), seeded.outfitId)
})

test('freeform ask new_request clears and does not restore database session state', async () => {
  const pieces = db.prepare('SELECT * FROM pieces WHERE status = ?').all('active').map(row => ({
    ...row,
    colors: JSON.parse(row.colors || '[]'),
    occasions: JSON.parse(row.occasions || '[]'),
    occasion_permissions: JSON.parse(row.occasion_permissions || '[]'),
    styling_rules_learned: [],
    pairs_well_with: [],
    tried_and_rejected: [],
    style_profile_json: JSON.parse(row.style_profile_json || '{}'),
  }))

  // Turn 1: request with outfit context. This saves state.
  await postJson('/api/ai/ask', {
    question: 'evaluate this outfit',
    pieces,
    history: [],
    conversationMode: 'new_request',
    outfit: { label: 'Active outfit', photo: seeded.photos.outfit },
    pieceIds: [seeded.top, seeded.bottom],
    sessionId: 'test-session-123'
  })

  // Turn 2: send new_request without outfit using same sessionId.
  // This should clear/not restore state.
  await postJson('/api/ai/ask', {
    question: 'suggest a casual outfit',
    pieces,
    history: [],
    conversationMode: 'new_request',
    sessionId: 'test-session-123'
  })

  const lastCall = aiCalls.at(-1)
  // Check that the system prompt does NOT contain active outfit details or inventory
  assert.ok(!lastCall.system.includes('OUTFIT CONTEXT UNDER DISCUSSION'))
  assert.ok(!lastCall.system.includes('CURRENT ATTACHED IMAGE INVENTORY:'))

  // Turn 3: send followup without outfit using same sessionId.
  // Since the state was cleared, it should still be empty.
  await postJson('/api/ai/ask', {
    question: 'tell me more',
    pieces,
    history: [
      { role: 'user', content: 'suggest a casual outfit' },
      { role: 'assistant', content: 'Mock response' }
    ],
    conversationMode: 'followup',
    sessionId: 'test-session-123'
  })

  const lastCallFollowup = aiCalls.at(-1)
  assert.ok(!lastCallFollowup.system.includes('OUTFIT CONTEXT UNDER DISCUSSION'))
  assert.ok(!lastCallFollowup.system.includes('CURRENT ATTACHED IMAGE INVENTORY:'))
})

test('freeform ask system prompt includes context persistence and no hallucination rules', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'what should I wear today?',
    pieces: [],
    history: [],
    conversationMode: 'new_request',
  })

  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /Context Persistence:/)
  assert.match(lastCall.system, /Strictly No Garment Hallucination:/)
  assert.match(lastCall.system, /Occasion Realism & Styling Sense:/)
  assert.match(lastCall.system, /Layering Logic & No Double-Vests:/)
  assert.match(lastCall.system, /Precise Garment Naming:/)
  assert.match(lastCall.system, /Avoid formatting suggestions as generic category-by-category checklists/)
})

test('StylistChat enables rough preview for rendered freeform outfit cards', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /const isTextOnlyPreviewSet = Boolean\(outfits\[0\]\?\.previewOnly\)/)
  assert.match(src, /const canGenerateComparison = !isTextOnlyPreviewSet && outfits\.length >= 2/)
  assert.match(src, /Generate rough preview/)
})

test('StylistChat shows trip explanation before cards, not inside trip cards', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /Trip plan/)
  assert.match(src, /getTripPlanNotes/)
  assert.match(src, /garment and layer photos are prioritized before accessories/)
  assert.doesNotMatch(src, /Accessories are left out of these cards/)
  assert.match(src, /outfit\.reason && !isTripCard/)
  assert.match(src, /const msgOccasion = outfit\.occasion \|\| outfit\.bestFor \|\| message\.queryOptions\?\.occasion/)
  assert.doesNotMatch(src, /<details open=\{message\?\.wholeWardrobe \|\| outfit\.source === 'trip_precompose'\}/)
})

test('freeform trip precompose keeps accessories in cards while visual budget may prioritize garments', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  assert.match(src, /function annotateTripOutfit/)
  assert.doesNotMatch(src, /outfit\.pieces\.filter\(piece => wardrobeCategoryGroup\(piece\) !== 'accessory'\)/)
})

test('StylistChat parses freeform outfit sections into current outfit memory', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /parseStructuredOutfitsFromAssistantText/)
  assert.match(src, /OUTFIT_CARD_RESPONSE_PATTERN/)
  assert.doesNotMatch(src, /OUTFIT_CARD_RESPONSE_PATTERN = .*\\b\(show\|render\|visualize[^\\n]*\|pack\|/)
  assert.doesNotMatch(src, /OUTFIT_CARD_RESPONSE_PATTERN = .*\\b\(show\|render\|visualize[^\\n]*\|wear\|/)
  assert.match(src, /const shouldParseAssistantOutfitCards = replyConversationMode === 'new_request' \|\| OUTFIT_CARD_RESPONSE_PATTERN\.test\(q\)/)
  assert.match(src, /mergeCurrentOutfitSet/)
  assert.match(src, /unresolvedPieceNames/)
  assert.match(src, /Needs exact wardrobe match:/)
  assert.match(src, /outfits\.slice\(0, 5\)\.map/)
  assert.match(src, /Unresolved cards stay visible here but are skipped for image generation/)
  assert.match(src, /CURRENT OUTFIT SET \(LATEST, HIGH AUTHORITY\)/)
  assert.match(src, /source: 'freeform_current_set'/)
  assert.match(src, /setThreadMemory\(\{\s*type: 'generated_outfits',\s*source: 'freeform_current_set'/)
})

test('executeTool get_garment_details loads text and base64 photo blocks', async () => {
  // Write a dummy temp image to uploads directory to mock the photo file
  const topPhotoFilename = 'mock-top-photo.jpg'
  const mockFilePath = path.join(uploadsDir, topPhotoFilename)
  
  // Ensure uploads directory exists and write a valid dummy 1x1 JPEG to satisfy sharp resizing
  fs.mkdirSync(uploadsDir, { recursive: true })
  const dummy1x1Jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAZABkAAD/2wCEABQQEBkSGScXFycyJh8mMi4mJiYmLj41NTU1NT5EQUFBQUFBREREREREREREREREREREREREREREREREREREREQBFRkZIBwgJhgYJjYmICY2RDYrKzZERERCNUJERERERERERERERERERERERERERERERERERERERERERERERERERP/AABEIAAEAAQMBIgACEQEDEQH/xABMAAEBAAAAAAAAAAAAAAAAAAAABQEBAQAAAAAAAAAAAAAAAAAABQYQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQA9Yv/2Q==', 'base64')
  fs.writeFileSync(mockFilePath, dummy1x1Jpeg)

  // Seed db piece to reference this photo
  db.prepare('UPDATE pieces SET photo = ? WHERE id = ?').run(topPhotoFilename, seeded.top)

  try {
    const details = await executeTool('get_garment_details', { ids: [seeded.top] })
    assert.ok(Array.isArray(details))
    assert.equal(details.length, 1)
    assert.equal(details[0].id, seeded.top)
    assert.match(details[0].text, /black button detail top/)
    
    // Verify that visual image data was resolved and loaded as base64
    assert.ok(details[0].image)
    assert.equal(details[0].image.mime, 'image/jpeg')
    assert.ok(typeof details[0].image.base64 === 'string')
    assert.ok(details[0].image.base64.length > 10)
  } finally {
    if (fs.existsSync(mockFilePath)) {
      fs.unlinkSync(mockFilePath)
    }
  }
})

test('executeTool search_wardrobe supports filtering and returns visual metadata fields', async () => {
  // Update seeded top with visual attributes
  db.prepare(`
    UPDATE pieces 
    SET neckline = 'cowl', silhouette = 'boxy', fabric_weight = 'heavy', fabric_category = 'knit', pattern_type = 'solid'
    WHERE id = ?
  `).run(seeded.top)

  // 1. Verify filtering by neckline works and returns correct keys
  const res1 = await executeTool('search_wardrobe', { neckline: 'cowl' })
  assert.ok(Array.isArray(res1))
  assert.equal(res1.length, 1)
  assert.equal(res1[0].id, seeded.top)
  assert.equal(res1[0].neckline, 'cowl')
  assert.equal(res1[0].silhouette, 'boxy')
  assert.equal(res1[0].fabric_weight, 'heavy')
  assert.equal(res1[0].fabric_category, 'knit')
  assert.equal(res1[0].pattern_type, 'solid')

  // 2. Verify filtering by silhouette works
  const res2 = await executeTool('search_wardrobe', { silhouette: 'boxy' })
  assert.ok(Array.isArray(res2))
  assert.equal(res2.length, 1)
  assert.equal(res2[0].id, seeded.top)

  // 3. Verify mismatch neckline returns empty
  const res3 = await executeTool('search_wardrobe', { neckline: 'V' })
  assert.ok(Array.isArray(res3))
  assert.equal(res3.length, 0)
})

test('executeTool search_wardrobe ranks and annotates weather and profile-rule fit', async () => {
  db.prepare(`
    UPDATE pieces
    SET fabric_weight = 'heavy', reads_as = 'black denim heavy full-length jeans'
    WHERE id = ?
  `).run(seeded.jeans)
  db.prepare(`
    UPDATE pieces
    SET fabric_weight = 'light', fabric_category = 'linen', reads_as = 'lightweight linen breathable pants'
    WHERE id = ?
  `).run(seeded.bottom)
  db.prepare(`
    UPDATE pieces
    SET reads_as = 'flat rugged boots'
    WHERE id = ?
  `).run(seeded.boot)

  const bottoms = await executeTool('search_wardrobe', {
    category: 'bottom',
    occasion: 'city',
    weather: 'highs 80-90F'
  })
  assert.ok(Array.isArray(bottoms))
  const linen = bottoms.find(p => p.id === seeded.bottom)
  const denim = bottoms.find(p => p.id === seeded.jeans)
  assert.equal(linen.weatherFit, 'lightweight - good for heat')
  assert.equal(denim.weatherFit, 'heavy - too warm for the heat')
  assert.ok(bottoms.findIndex(p => p.id === seeded.bottom) < bottoms.findIndex(p => p.id === seeded.jeans))

  const hikingShoes = await executeTool('search_wardrobe', {
    category: 'shoes',
    occasion: 'casual',
    activity: 'hiking'
  })
  const boot = hikingShoes.find(p => p.id === seeded.boot)
  const slipOn = hikingShoes.find(p => p.id === seeded.shoe)
  assert.equal(boot.ruleFit, 'preferred')
  assert.equal(slipOn.ruleFit, 'neutral')
})

test('executeTool search_wardrobe relies on structured occasion instead of dinner query normalization', async () => {
  const dinnerSearch = await executeTool('search_wardrobe', {
    occasion: 'evening',
    weather: '81f',
    visual: true,
  })
  assert.ok(Array.isArray(dinnerSearch))
  assert.ok(dinnerSearch.length > 0)
  assert.ok(dinnerSearch.some(item => item.id === seeded.dress))
  assert.ok(dinnerSearch.every(item => !/Treated "dinner" as the requested occasion/.test(item.note || '')))

  const flexibleEveningTops = await executeTool('search_wardrobe', {
    category: 'top',
    occasion: 'evening',
    weather: '81f',
  })
  assert.ok(flexibleEveningTops.some(item => item.id === seeded.top))
  assert.ok(flexibleEveningTops.some(item => /No active pieces are explicitly tagged for "evening"/.test(item.note || '')))
})

test('executeTool search_wardrobe uses toolContext weather when model omits weather arg', async () => {
  db.prepare('UPDATE pieces SET fabric_category = ?, fabric_weight = ? WHERE id = ?').run('linen', 'light', seeded.bottom)
  db.prepare('UPDATE pieces SET fabric_category = ?, fabric_weight = ? WHERE id = ?').run('denim', 'heavy', seeded.jeans)

  const bottoms = await executeTool('search_wardrobe', {
    category: 'bottom',
    occasion: 'city'
  }, {
    weather: 'hot weather'
  })

  const linen = bottoms.find(p => p.id === seeded.bottom)
  const denim = bottoms.find(p => p.id === seeded.jeans)
  assert.equal(linen.weatherFit, 'lightweight - good for heat')
  assert.equal(denim.weatherFit, 'heavy - too warm for the heat')
})

test('executeTool search_wardrobe visual mode attaches capped low-detail thumbnails', async () => {
  const visualResults = await executeTool('search_wardrobe', {
    occasion: 'city',
    visual: true
  })
  const top = visualResults.find(p => p.id === seeded.top)
  const bottom = visualResults.find(p => p.id === seeded.bottom)
  assert.ok(top.image)
  assert.equal(top.image.mime, 'image/jpeg')
  assert.ok(typeof top.image.base64 === 'string')
  assert.ok(bottom.image)
  assert.ok(visualResults.filter(p => p.image).length <= 16)

  const textResults = await executeTool('search_wardrobe', {
    occasion: 'city'
  })
  assert.ok(!textResults.find(p => p.id === seeded.top)?.image)
})

test('executeTool render_outfit emits a card only when every named piece resolves', async () => {
  const toolContext = {
    occasion: 'city',
    season: 'current season',
    generatedOutfits: [{
      label: 'Existing card',
      occasion: 'city',
      season: 'current season',
      pieceIds: [seeded.shoe],
      pieces: [],
      previewOnly: true
    }]
  }
  const rendered = await executeTool('render_outfit', {
    label: 'Winery column',
    pieces: ['black button detail top', 'light beige linen wide-leg pants'],
    occasion: 'city',
    season: 'highs 80-90F'
  }, toolContext)

  assert.equal(rendered.status, 'success')
  assert.deepEqual(rendered.pieceNames, ['black button detail top', 'light beige linen wide-leg pants'])
  assert.deepEqual(rendered.unresolved, [])
  assert.equal(toolContext.source, 'rendered_outfit')
  assert.equal(toolContext.generatedOutfits.length, 2)
  assert.equal(toolContext.generatedOutfits[0].label, 'Existing card')
  assert.equal(toolContext.generatedOutfits[1].label, 'Winery column')
  assert.deepEqual(toolContext.generatedOutfits[1].pieceIds, [seeded.top, seeded.bottom])
  assert.equal(toolContext.generatedOutfits[1].previewOnly, true)

  const failedContext = { generatedOutfits: [...toolContext.generatedOutfits] }
  const failed = await executeTool('render_outfit', {
    label: 'Partial outfit',
    pieces: ['black button detail top', 'not a real garment']
  }, failedContext)

  assert.equal(failed.status, 'error')
  assert.deepEqual(failed.pieceNames, ['black button detail top'])
  assert.deepEqual(failed.unresolved, ['not a real garment'])
  assert.equal(failedContext.generatedOutfits.length, 2)
})

test('executeTool render_outfit resolves names with normalized whitespace', async () => {
  const spacedNameId = insertPiece({
    name: 'oatmeal linen wide  jogger-style pants',
    category: 'bottom',
    colors: ['oatmeal'],
    occasions: ['city', 'casual'],
    reads_as: 'linen jogger pants',
    fabric_category: 'linen',
  })
  const toolContext = { generatedOutfits: [] }
  const rendered = await executeTool('render_outfit', {
    label: 'Whitespace normalized',
    pieces: ['black button detail top', 'Oatmeal linen wide jogger-style pants']
  }, toolContext)

  assert.equal(rendered.status, 'success')
  assert.deepEqual(rendered.pieceNames, ['black button detail top', 'oatmeal linen wide  jogger-style pants'])
  assert.equal(toolContext.generatedOutfits.length, 1)
  assert.deepEqual(toolContext.generatedOutfits[0].pieceIds, [seeded.top, spacedNameId])
})

test('contentToOpenAI preserves image_url blocks without stringifying them', () => {
  const content = [
    { type: 'text', text: 'Hello!' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abcdefg' } }
  ]
  const result = contentToOpenAI(content)
  assert.equal(result.length, 2)
  assert.equal(result[0].type, 'text')
  assert.equal(result[0].text, 'Hello!')
  assert.equal(result[1].type, 'image_url')
  assert.deepEqual(result[1].image_url, { url: 'data:image/jpeg;base64,abcdefg' })
})

test('extractToolResultImages strips image blobs and preserves labeled visual references', () => {
  const result = [{
    id: 42,
    name: 'linen top',
    weatherFit: 'lightweight - good for heat',
    ruleFit: 'preferred',
    image: { mime: 'image/jpeg', base64: 'abc123' },
    text: 'linen top details'
  }, {
    id: 43,
    name: 'plain pants',
    text: 'pants details'
  }]

  const extracted = extractToolResultImages(result)
  assert.equal(extracted.images.length, 1)
  assert.equal(extracted.images[0].label, 'ID 42: linen top — preferred, lightweight - good for heat')
  assert.equal(extracted.images[0].mime, 'image/jpeg')
  assert.equal(extracted.images[0].base64, 'abc123')
  assert.ok(!JSON.parse(extracted.textResult)[0].image)
  assert.equal(JSON.parse(extracted.textResult)[0].text, 'linen top details')
})

test('saved boards endpoint returns boards linked to piece context_id', async () => {
  const testBoard = await postJson('/api/saved-boards', {
    boardType: 'editorial_direction',
    contextType: 'piece',
    contextId: seeded.top,
    title: 'Editorial Blue Board',
    imageUrl: '/uploads/board-xyz.png',
    pieces: []
  })

  const res = await fetch(`${baseUrl}/api/saved-boards?pieceId=${seeded.top}`)
  const boards = await res.json()
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(boards))
  const found = boards.find(b => b.id === testBoard.id)
  assert.ok(found, 'Should find the saved board linked to the piece by context_id')
  assert.equal(found.title, 'Editorial Blue Board')
})

test('getCalibrationReferenceImagesForGeneration priority-starred random rotation logic', async () => {
  const { getCalibrationReferenceImagesForGeneration } = await import('../styling-engine/core.js')

  // Create mock calibration image files
  const files = [
    await makeImage('cal1.jpg', '#ff0000'),
    await makeImage('cal2.jpg', '#00ff00'),
    await makeImage('cal3.jpg', '#0000ff'),
    await makeImage('cal4.jpg', '#ffff00'),
    await makeImage('cal5.jpg', '#ff00ff'),
    await makeImage('cal6.jpg', '#00ffff'),
  ]

  try {
    // Insert 4 active normal, 2 active starred references
    // Starred 1 (favorite = 1)
    db.prepare(`
      INSERT INTO calibration_images (kind, favorite, archived, image_url, labels)
      VALUES ('real_photo', 1, 0, '/uploads/cal1.jpg', '[]')
    `).run()
    const starred1Id = db.prepare('SELECT last_insert_rowid() as id').get().id

    // Starred 2 (favorite = 1)
    db.prepare(`
      INSERT INTO calibration_images (kind, favorite, archived, image_url, labels)
      VALUES ('real_photo', 1, 0, '/uploads/cal2.jpg', '[]')
    `).run()
    const starred2Id = db.prepare('SELECT last_insert_rowid() as id').get().id

    // Normal 1 (favorite = 0)
    db.prepare(`
      INSERT INTO calibration_images (kind, favorite, archived, image_url, labels)
      VALUES ('real_photo', 0, 0, '/uploads/cal3.jpg', '[]')
    `).run()
    // Normal 2 (favorite = 0)
    db.prepare(`
      INSERT INTO calibration_images (kind, favorite, archived, image_url, labels)
      VALUES ('real_photo', 0, 0, '/uploads/cal4.jpg', '[]')
    `).run()
    // Normal 3 (favorite = 0)
    db.prepare(`
      INSERT INTO calibration_images (kind, favorite, archived, image_url, labels)
      VALUES ('real_photo', 0, 0, '/uploads/cal5.jpg', '[]')
    `).run()
    // Normal 4 (favorite = 0)
    db.prepare(`
      INSERT INTO calibration_images (kind, favorite, archived, image_url, labels)
      VALUES ('real_photo', 0, 0, '/uploads/cal6.jpg', '[]')
    `).run()

    // 1. Fetch with limit 2. It should return exactly the 2 starred images.
    const refsLimit2 = await getCalibrationReferenceImagesForGeneration(2)
    assert.equal(refsLimit2.length, 2)
    const idsLimit2 = refsLimit2.map(r => r.id)
    assert.ok(idsLimit2.includes(starred1Id))
    assert.ok(idsLimit2.includes(starred2Id))

    // 2. Unstar one of them (make cal2.jpg favorite = 0)
    db.prepare('UPDATE calibration_images SET favorite = 0 WHERE id = ?').run(starred2Id)

    // 3. Fetch with limit 2 again. It should return exactly 2 images: the remaining starred one first, and 1 of the normal ones.
    const refsLimit2Post = await getCalibrationReferenceImagesForGeneration(2)
    assert.equal(refsLimit2Post.length, 2)
    assert.equal(refsLimit2Post[0].id, starred1Id) // The only starred one left must be first
    assert.notEqual(refsLimit2Post[1].id, starred1Id) // Second one is a normal one
    assert.ok(refsLimit2Post[1].id !== starred1Id)
  } finally {
    // Cleanup generated files
    for (const file of files) {
      const p = path.join(uploadsDir, file)
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
  }
})

test('buildWholeWardrobeCandidateOutfits generates candidates tagged with Outfit Missions', async () => {
  const { buildWholeWardrobeCandidateOutfits } = await import('../styling-engine/rules.js')

  const allPieces = [
    { id: 1, name: 'Floral Print Top', category: 'top', pattern_type: 'floral', status: 'active', colors: ['white', 'blue'], styling_rules_learned: [], occasions: ['casual'], notes: 'floral prints' },
    { id: 2, name: 'Structured Denim Pants', category: 'bottom', status: 'active', fit_on_body: 'structured', notes: 'structured raw denim', colors: ['navy'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 3, name: 'Black Leather Boot', category: 'shoes', status: 'active', notes: 'pointed black leather', colors: ['black'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 4, name: 'Silk Cowl Neck Top', category: 'top', status: 'active', notes: 'cowl neck silk drape top', colors: ['cream'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 5, name: 'Fitted Black Tank', category: 'top', status: 'active', notes: 'fitted knit tank', colors: ['black'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 6, name: 'Linen Wide Pants', category: 'bottom', status: 'active', notes: 'relaxed linen wide leg', colors: ['cream'], styling_rules_learned: [], occasions: ['casual'] },
  ]

  const candidates = buildWholeWardrobeCandidateOutfits(allPieces, {
    occasion: 'casual',
    activeMissions: ['controlled_print', 'structured_soft', 'soft_architecture']
  })

  assert.ok(candidates.length > 0, 'Should generate at least some candidates')
  
  // Verify controlled_print candidate has a print piece and structure
  const printCand = candidates.find(c => c.missionId === 'controlled_print')
  if (printCand) {
    const hasPrint = printCand.pieces.some(p => p.name.includes('Floral'))
    assert.ok(hasPrint, 'Controlled Print candidate should contain a print piece')
  }

  // Verify soft_architecture contains no black or denim
  const archCand = candidates.find(c => c.missionId === 'soft_architecture')
  if (archCand) {
    const hasBlackOrDenim = archCand.pieces.some(p => p.name.includes('Black') || p.name.includes('Denim'))
    assert.ok(!hasBlackOrDenim, 'Soft Architecture candidate should contain no black or denim')
  }
})

test('Agent OCCASION PROFILE prompt block and wardrobe coverage contract tests', async () => {
  // Test 1: Agent message with occasion "hiking" vs "casual"
  aiCalls = []
  
  // Call with hiking
  await postJson('/api/ai/generate-wardrobe-outfits', {
    occasion: 'hiking',
    season: 'current season',
    mood: 'artistic minimalist',
    limit: 1
  })
  
  const hikeCall = aiCalls.find(c => c.system.includes('personal visual stylist agent'))
  assert.ok(hikeCall, 'Should have styled agent call')
  const hikeUserMessage = hikeCall.messages[0].content
  assert.ok(hikeUserMessage.includes('ACTIVITY PROFILE — Hiking / Outdoor active:'), 'Should contain ACTIVITY PROFILE header')
  assert.ok(hikeUserMessage.includes('Use sparingly and justify in watchFor if chosen:'), 'Should contain Use sparingly block')
  assert.ok(hikeUserMessage.includes('suede'), 'Should list suede in discouraged')
  assert.ok(hikeUserMessage.includes('boot'), 'Should list boots in discouraged')
  
  // Call with casual and empty mood
  aiCalls = []
  await postJson('/api/ai/generate-wardrobe-outfits', {
    occasion: 'casual',
    season: 'current season',
    mood: '',
    limit: 1
  })
  
  const casualCall = aiCalls.find(c => c.system.includes('personal visual stylist agent'))
  assert.ok(casualCall, 'Should have styled agent call')
  const casualUserMessage = casualCall.messages[0].content
  assert.ok(!casualUserMessage.includes('OCCASION PROFILE') && !casualUserMessage.includes('ACTIVITY PROFILE'), 'Should NOT contain PROFILE block for casual/empty mood')

  // Test 2: Wardrobe coverage note for trail active outdoor (low tops/shoes vs ample)
  const coverageJson = await postJson('/api/ai/generate-wardrobe-outfits', {
    occasion: 'hiking',
    season: 'current season',
    mood: '',
    limit: 1
  })
  
  assert.ok(coverageJson.debug.profileCoverage, 'profileCoverage must be populated in debug')
  assert.equal(coverageJson.debug.profileCoverage.tops, 0, 'Seed pool has 0 trail-ready tops')
  assert.equal(coverageJson.debug.profileCoverage.shoes, 0, 'Seed pool has 0 trail-ready shoes')
  assert.ok(coverageJson.feedback.includes('Your wardrobe has limited trail-ready tops and footwear'), 'Feedback must report limited tops and footwear')

  const cityCoverageJson = await postJson('/api/ai/generate-wardrobe-outfits', {
    occasion: 'city',
    season: 'current season',
    mood: '',
    limit: 1
  })

  assert.ok(cityCoverageJson.feedback.includes('Your wardrobe has limited city smart casual / everyday tops'), 'Feedback must use the matched occasion label')
  assert.ok(!cityCoverageJson.feedback.includes('trail-specific'), 'Non-hiking coverage feedback must not mention trail-specific pieces')

  // Now seed trail-ready pieces to test ample coverage behavior
  for (let i = 0; i < 5; i++) {
    insertPiece({
      name: `cotton hiking tee ${i}`,
      category: 'top',
      occasions: ['casual', 'outdoor'],
      reads_as: 'cotton blend tee'
    })
  }
  
  for (let i = 0; i < 3; i++) {
    insertPiece({
      name: `rugged trail sneakers ${i}`,
      category: 'shoes',
      occasions: ['casual', 'outdoor'],
      reads_as: 'comfortable running sneakers'
    })
  }
  
  const ampleCoverageJson = await postJson('/api/ai/generate-wardrobe-outfits', {
    occasion: 'hiking',
    season: 'current season',
    mood: '',
    limit: 1
  })
  
  assert.equal(ampleCoverageJson.debug.profileCoverage.tops >= 5, true, 'Should now have >= 5 trail-ready tops')
  assert.equal(ampleCoverageJson.debug.profileCoverage.shoes >= 3, true, 'Should now have >= 3 trail-ready shoes')
  assert.ok(!ampleCoverageJson.feedback.includes('limited trail-ready'), 'Feedback must not contain limited coverage note with ample coverage')
})
