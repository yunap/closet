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
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''
process.env.PHOTO_PRESERVING_VISUALS = 'true'
process.env.WARDROBE_TEST_MAX_WHOLE_WARDROBE_CANDIDATES = '18'
process.env.WARDROBE_TEST_MAX_WHOLE_WARDROBE_REVIEW_CANDIDATES = '3'

const { app, db, userUploadsDir, executeTool, contentToOpenAI } = await import('../server.js')
const { savedOutfitImagePrompt, clearOutfitEvaluationResultCache } = await import('../styling-engine/core.js')
const { extractToolResultImages, normalizeAiUsage, estimateAiUsageCost, applyFreeformOutputChecks, stylistToolsForTurn, systemToAnthropicBlocks, systemToPlainText, withMovingCacheBreakpoint, PROMPT_CACHE_BREAKPOINT, toAnthropicContentBlocks } = await import('../styling-engine/provider.js')

let server
let baseUrl
let seeded
let aiCalls = []

before(async () => {
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  delete process.env.WARDROBE_TEST_EVALUATION_CACHE
  clearOutfitEvaluationResultCache()
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
    'feedback_synthesis_drafts',
    'feedback_synthesis_batches',
    'outfit_pieces',
    'outfits',
    'pieces',
    'saved_boards',
    'stylist_feedback',
    'whole_wardrobe_sessions',
    'generation_runs',
    'freeform_generation_runs',
    'calibration_images',
    'stylist_conversation_state',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
}

async function makeImage(filename, color = '#d8c9b7') {
  if (!fs.existsSync(userUploadsDir())) fs.mkdirSync(userUploadsDir(), { recursive: true })
  await sharp({
    create: {
      width: 120,
      height: 160,
      channels: 3,
      background: color,
    },
  }).png().toFile(path.join(userUploadsDir(), filename))
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
    fabric_weight: 'light',
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
    fabric_weight: 'light',
    fiber_content: ['linen'],
    style_profile_json: { coverage: 'normal', bareness: 'normal' },
  })
  const jeans = insertPiece({
    name: 'black bootcut denim jeans',
    category: 'bottom',
    colors: ['black'],
    occasions: ['city', 'casual'],
    photo: photos.jeans,
    reads_as: 'quiet dark neutral',
    bottom_shape: 'bootcut',
    length_hits_at: 'full-length',
    fabric_category: 'denim',
    fabric_weight: 'medium',
    fiber_content: ['denim'],
    style_profile_json: { coverage: 'full-insulating', bareness: 'normal' },
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
    fabric_weight: 'medium',
    fiber_content: ['cotton'],
  })
  const dress = insertPiece({
    name: 'plum wool dress',
    category: 'dress',
    colors: ['plum'],
    occasions: ['city', 'evening'],
    photo: photos.dress,
    reads_as: 'simple one piece column',
    fabric_weight: 'heavy',
    fiber_content: ['wool'],
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
    fiber_content: [],
    formality: 'everyday',
    length_hits_at: '',
    style_profile_json: {},
    ...overrides,
  }
  return db.prepare(`
    INSERT INTO pieces (
      name, category, colors, occasions, season, notes, status,
      recommendation_status, fit_confidence, role_permission, occasion_permissions,
      engine_notes, photo, worn_photo, pattern_type, pattern_scale,
      pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content,
      formality, length_hits_at, style_profile_json
    ) VALUES (
      @name, @category, @colors, @occasions, @season, @notes, @status,
      @recommendation_status, @fit_confidence, @role_permission, @occasion_permissions,
      @engine_notes, @photo, @worn_photo, @pattern_type, @pattern_scale,
      @pattern_complexity, @reads_as, @silhouette, @fabric_category, @fabric_weight, @fiber_content,
      @formality, @length_hits_at, @style_profile_json
    )
  `).run({
    ...piece,
    colors: JSON.stringify(piece.colors),
    occasions: JSON.stringify(piece.occasions),
    occasion_permissions: JSON.stringify(piece.occasion_permissions),
    fiber_content: JSON.stringify(piece.fiber_content),
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

function mockAiHandler({ system, messages, maxTokens }) {
  aiCalls.push({ system, messages, maxTokens })
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
        tripSummary: {
          durationText: '4-5 days',
          dayBreakdown: 'about 3 city/museum daytime days, 4 dinners, and 1 winery day',
        },
        slots: [
          {
            id: 'city_exploring',
            label: 'City Exploring',
            occasion: 'city',
            activity: 'walking',
            season: 'hot weather',
            bestFor: 'hot daytime city exploring and walking',
            coverage: '3 city/museum daytime days',
            targetOutfits: 2,
            planNote: 'Prioritize breathable garments and walkable shoes.',
          },
          {
            id: 'dinner',
            label: 'Dinner Out',
            occasion: 'evening',
            activity: 'none',
            season: 'cool evening weather',
            bestFor: 'cooler evening dinner',
            coverage: '4 dinners',
            targetOutfits: 2,
            planNote: 'Use a dinner-register outfit and add a layer only if it helps.',
          },
          {
            id: 'winery',
            label: 'Winery Day',
            occasion: 'outdoor_daytime_social',
            activity: 'walking',
            season: 'hot weather',
            bestFor: 'warm daytime winery visit',
            coverage: '1 winery day',
            targetOutfits: 1,
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

  if (text.includes("personal stylist. You are looking at photos") && /Occasion:\s*outdoor_daytime_social/i.test(latestText)) {
    const badTop = db.prepare("SELECT id FROM pieces WHERE name = ?").get('multicolor floral hooded sweatshirt')?.id
    const badShoe = db.prepare("SELECT id FROM pieces WHERE name = ?").get('light grey knit athletic shoes')?.id
    const goodTop = db.prepare("SELECT id FROM pieces WHERE name = ?").get('olive ruffled sleeveless top')?.id
    const goodBottom = db.prepare("SELECT id FROM pieces WHERE name = ?").get('black cream botanical tiered midi skirt')?.id
    const goodShoe = db.prepare("SELECT id FROM pieces WHERE name = ?").get('black slip-on loafers')?.id
    return {
      outfits: [{
        label: 'Too casual outdoor social',
        strength: 'signature',
        dominantDirection: 'soft casual comfort',
        silhouette: 'relaxed top over easy lower line',
        bestFor: 'outdoor daytime social',
        pieceIds: [badTop, seeded.bottom, badShoe].filter(Boolean),
        reason: 'The hoodie and athletic shoes make the outfit easy for walking.',
        watchFor: 'Very casual.',
      }, {
        label: 'Intentional outdoor social',
        strength: 'strong',
        dominantDirection: 'botanical structure with grounded loafers',
        silhouette: 'expressive top over controlled midi line',
        bestFor: 'outdoor daytime social',
        pieceIds: [goodTop, goodBottom, goodShoe].filter(Boolean),
        reason: 'The textured top and botanical skirt keep the outfit social while the loafers stay walkable.',
        watchFor: 'Keep the shoe visible.',
      }],
      rejected: [],
      skip: '',
      saveableLearning: 'mock outdoor-social visual pass',
    }
  }

  if (text.includes("personal stylist. You are looking at photos") && /Activity:\s*walking/i.test(latestText)) {
    return {
      outfits: [{
        label: 'Mock walking outfit with boots',
        strength: 'signature',
        dominantDirection: 'city structure with boot',
        silhouette: 'controlled top over grounded lower line',
        bestFor: 'walking',
        pieceIds: [seeded.top, seeded.bottom, seeded.boot],
        reason: 'The boot grounds the light trouser visually.',
        watchFor: 'May not be ideal for long walking.',
      }],
      rejected: [],
      skip: '',
      saveableLearning: 'mock walking visual pass',
    }
  }

  if (text.includes('personal visual stylist agent') || text.includes('whole-wardrobe outfit composer') || text.includes("personal stylist. You are looking at photos")) {
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
        usage: {
          input_tokens: 1200,
          output_tokens: 80,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 0,
        },
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
      userCritique: {
        answer: 'Works with one adjustment',
        reason: 'The black top gives the wide-leg pants a clear upper edge, but the long hem is beginning to hide the shoes.',
        action: 'Adjust the pant hem enough to keep the cream shoes readable.',
        check: 'Look for the leg line to stay long without fabric pooling over the shoes.',
        occasionNote: '',
      },
      usage: {
        input_tokens: 5200,
        output_tokens: 850,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 0,
      },
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
  assert.equal(json.debug.visualCritic.thumbPx, 768)
  assert.ok(['high', 'auto'].includes(json.debug.visualCritic.imageDetail))
  assert.equal(typeof json.debug.visualCritic.postGatePoolSize, 'number')
  assert.equal(typeof json.debug.visualCritic.capApplied, 'boolean')
  assert.deepEqual(json.debug.visualCritic.capCutPieces, [])
  assert.deepEqual(Object.keys(json.debug.visualCritic.slotCoverage).sort(), ['accessory', 'bottom', 'dress', 'outerwear', 'shoes', 'top'])
  assert.ok(json.debug.visualCritic.postGatePoolSize <= 54)
  assert.equal(Object.hasOwn(json.debug, 'composerUsage'), true)
  assert.equal(Object.hasOwn(json.debug.visualCritic, 'composerUsage'), true)
  const generationRun = db.prepare('SELECT * FROM generation_runs WHERE flow = ?').get('anchor_visual')
  assert.ok(generationRun)
  assert.equal(generationRun.occasion, 'city')
  assert.equal(generationRun.roster_count, json.debug.visualCritic.rosterCount)
  assert.equal(generationRun.pool_size, json.debug.visualCritic.postGatePoolSize)
  assert.equal(generationRun.cap_applied, 0)
  assert.deepEqual(JSON.parse(generationRun.cut_ids), [])

  const composerCall = aiCalls.find(c => c.system.includes('SELECTED-ANCHOR CONTRACT'))
  assert.ok(composerCall, 'A selected-piece visual composer call was recorded')
  const content = composerCall.messages[0].content
  const anchorLabelIndex = content.findIndex(part => part.type === 'text' && part.text.includes(`SELECTED ANCHOR ID ${seeded.bottom}`))
  assert.ok(anchorLabelIndex >= 0, 'Selected anchor label should be present in composer content')
  assert.equal(content[anchorLabelIndex + 1]?.type, 'image')
  assert.equal(content[anchorLabelIndex + 1]?.detail, 'high')
  assert.ok(content.some((part, index) =>
    part.type === 'text' &&
    part.text.startsWith('SUPPORT ID ') &&
    ['high', 'auto'].includes(content[index + 1]?.detail)
  ))
  assert.ok(!content.some(part => part.type === 'image' && part.detail === 'low'))
})

test('selected-piece generator reports a structural shortfall without calling the composer', async () => {
  db.prepare("UPDATE pieces SET status = 'inactive' WHERE category = 'shoes'").run()

  const json = await postJson('/api/ai/generate-outfits-for-piece', {
    pieceId: seeded.bottom,
    occasion: 'city',
    season: 'current season',
  })

  assert.deepEqual(json.structuredOutfits, [])
  assert.equal(json.debug.visualCritic.compositionSkipped, 'incomplete_candidate_supply')
  assert.equal(json.debug.visualCritic.coverageReport.complete, false)
  assert.deepEqual(json.debug.visualCritic.structureCoverageGaps, ['required_structure_unavailable'])
  assert.match(json.feedback, /do not contain a complete outfit path/i)
  assert.equal(aiCalls.some(call => call.system.includes('SELECTED-ANCHOR CONTRACT')), false)
})

test('selected-piece styling receives only exact applicable board reactions, not global rejected-board prose', async () => {
  db.prepare(`INSERT INTO saved_boards
    (board_type, context_type, context_name, title, image_url, pieces, reason, payload)
    VALUES ('wardrobe', 'wardrobe', 'Whole wardrobe', ?, ?, ?, ?, ?)`)
    .run(
      'Unrelated rejected outfit',
      '/uploads/unrelated-rejected.png',
      JSON.stringify([
        { id: seeded.top, name: 'black button detail top', category: 'top' },
        { id: seeded.dress, name: 'plum midi dress', category: 'dress' },
        { id: seeded.boot, name: 'brown ankle boots', category: 'shoes' },
      ]),
      'UNRELATED GLOBAL BOARD REASON MUST NOT REACH THE SELECTED-PIECE PROMPT',
      JSON.stringify({ feedback_labels: ['not_me'] }),
    )

  db.prepare(`INSERT INTO saved_boards
    (board_type, context_type, context_name, title, image_url, pieces, reason, payload)
    VALUES ('wardrobe', 'wardrobe', 'Whole wardrobe', ?, ?, ?, ?, ?)`)
    .run(
      'Exact almost outfit',
      '/uploads/exact-almost.png',
      JSON.stringify([
        { id: seeded.bottom, name: 'light beige linen wide-leg pants', category: 'bottom' },
        { id: seeded.top, name: 'black button detail top', category: 'top' },
        { id: seeded.shoe, name: 'cream slip-on shoes', category: 'shoes' },
      ]),
      'Generated rationale is provenance only.',
      JSON.stringify({
        feedback_labels: ['almost'],
        feedback_details: { owner_comment: 'The upper proportion feels uncertain.' },
        scoped_evidence: {
          version: 1,
          kind: 'outfit_logic',
          verdict: 'almost',
          logic: {},
          context: { occasion: 'city', activity: 'none', season: '' },
        },
      }),
    )

  await postJson('/api/ai/generate-outfits-for-piece', {
    pieceId: seeded.bottom,
    occasion: 'city',
    season: 'current season',
  })

  const composerCall = aiCalls.find(call => call.system.includes('SELECTED-ANCHOR CONTRACT'))
  assert.ok(composerCall)
  const promptText = composerCall.messages[0].content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
  assert.match(promptText, /EXACT PRIOR OUTFIT REACTIONS/)
  assert.match(promptText, /The upper proportion feels uncertain/)
  assert.doesNotMatch(promptText, /UNRELATED GLOBAL BOARD REASON MUST NOT REACH/)
  assert.doesNotMatch(promptText, /Unrelated rejected outfit/)
})

test('generation_runs is not written on selected-piece error path', async () => {
  const response = await fetch(`${baseUrl}/api/ai/generate-outfits-for-piece`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pieceId: 999999, occasion: 'city' }),
  })
  const json = await response.json()
  assert.equal(response.status, 500)
  assert.match(json.error, /not found/i)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM generation_runs').get().count, 0)
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

test('selected-piece visual composer excludes boots from the June walking roster', async () => {
  db.prepare("UPDATE pieces SET heel_height = 'flat', walk_support = 'high', shoe_type = 'sneaker', formality = 'everyday' WHERE id = ?").run(seeded.shoe)
  db.prepare("UPDATE pieces SET heel_height = 'flat', walk_support = 'low', shoe_type = 'boot', formality = 'everyday' WHERE id = ?").run(seeded.boot)
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
    season: 'warm',
    activity: 'walking',
    resolvedWeatherProfile: { isHot: true, isCold: false, highF: 88, lowF: 68, weatherSource: 'live' },
  })

  const first = json.structuredOutfits[0]
  assert.equal(json.pipeline, 'selected_piece_visual_composer')
  assert.ok(first.pieceIds.includes(seeded.bottom))
  assert.equal(first.pieceIds.includes(seeded.boot), false, 'June walking should not return ankle boots')
  const composerCall = aiCalls.find(c => c.system.includes("personal stylist. You are looking at photos"))
  const composerText = JSON.stringify(composerCall?.messages || [])
  assert.doesNotMatch(composerText, /brown ankle boots/i, 'June walking should not show ankle boots to the composer roster')
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
  const json = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'spring',
    mood: 'artistic minimalist',
    limit: 3,
  })

  assert.equal(json.mode, 'generate_wardrobe_outfits_visual')
  assert.equal(json.pipeline, 'full_wardrobe_visual_composer')
  assert.ok(Array.isArray(json.structuredOutfits))
  assert.ok(json.structuredOutfits.length >= 1)
  assert.ok(json.debug.shownPieceCount > 0)
  assert.ok(json.debug.rosterCount > 0)
  assert.equal(json.debug.thumbPx, 768)
  assert.ok(['high', 'auto'].includes(json.debug.imageDetail))
  assert.ok(json.debug.finalReturnedCount >= 1)
  assert.equal(Object.hasOwn(json.debug.timings, 'agentStylistMs'), false)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM whole_wardrobe_sessions').get().count, 1)

  const composerCalls = aiCalls.filter(c => c.system.includes("personal stylist. You are looking at photos"))
  assert.equal(composerCalls.length, 1)
  assert.ok(!composerCalls[0].system.includes('personal visual stylist agent'))

  const summaryResponse = await fetch(`${baseUrl}/api/ai/whole-wardrobe-session-memory`)
  const summaryJson = await summaryResponse.json()
  assert.equal(summaryResponse.status, 200)
  assert.equal(summaryJson.mode, 'whole_wardrobe_session_memory_summary')
  assert.equal(summaryJson.recentSessionCount, 1)
  assert.ok(summaryJson.itemCount >= 1)
  assert.ok(summaryJson.formulaCount >= 1)

  const response = await fetch(`${baseUrl}/api/ai/whole-wardrobe-session-memory`, { method: 'DELETE' })
  const resetJson = await response.json()
  assert.equal(response.status, 200)
  assert.equal(resetJson.mode, 'reset_whole_wardrobe_session_memory')
  assert.equal(resetJson.itemCount, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM whole_wardrobe_sessions').get().count, 0)
})

test('whole-wardrobe generator reports a structural shortfall without composer or local-fill cards', async () => {
  db.prepare("UPDATE pieces SET status = 'inactive' WHERE category = 'shoes'").run()

  const json = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'spring',
    limit: 3,
  })

  assert.deepEqual(json.structuredOutfits, [])
  assert.equal(json.coverageNote.includes('complete outfit path'), true)
  assert.equal(json.debug.compositionSkipped, 'incomplete_candidate_supply')
  assert.equal(json.debug.coverageReport.complete, false)
  assert.deepEqual(json.debug.structureCoverageGaps, ['required_structure_unavailable'])
  assert.equal(aiCalls.some(call => call.system.includes('personal stylist. You are looking at photos')), false)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM whole_wardrobe_sessions').get().count, 0)
})

test('whole-wardrobe visual composer per-piece lines include fabric/reads_as hints', async () => {
  aiCalls = []
  const plainPiece = insertPiece({
    name: 'plain grey tee',
    category: 'top',
    colors: ['gray'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.top,
  })

  await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'spring',
    mood: 'artistic minimalist',
    limit: 3,
  })

  const composerCall = aiCalls.find(c => c.system.includes("personal stylist. You are looking at photos"))
  assert.ok(composerCall)
  const textLines = composerCall.messages
    .flatMap(m => Array.isArray(m.content) ? m.content : [])
    .filter(part => part?.type === 'text')
    .map(part => part.text)

  const bottomLine = textLines.find(line => line.startsWith(`ID ${seeded.bottom}:`))
  assert.ok(bottomLine)
  assert.equal(bottomLine, 'ID ' + seeded.bottom + ': light beige linen wide-leg pants; fabric: linen; reads_as: soft structured light column')

  const plainLine = textLines.find(line => line.startsWith(`ID ${plainPiece}:`))
  assert.ok(plainLine)
  assert.equal(plainLine, `ID ${plainPiece}: plain grey tee`)
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
  assert.equal(json.debug.imageDetail, 'high')
  assert.equal(json.debug.thumbPx, 768)
  assert.equal(typeof json.debug.postGatePoolSize, 'number')
  assert.equal(typeof json.debug.capApplied, 'boolean')
  assert.deepEqual(json.debug.capCutPieces, [])
  assert.deepEqual(Object.keys(json.debug.slotCoverage).sort(), ['accessory', 'bottom', 'dress', 'outerwear', 'shoes', 'top'])
  assert.ok(json.debug.postGatePoolSize <= 90)
  assert.equal(Object.hasOwn(json.debug, 'composerUsage'), true)
  assert.equal(json.debug.finalSelection.mode, 'advisor')
  assert.equal(json.debug.finalSelection.applyDiversity, false)
  assert.equal(typeof json.debug.finalSelection.uniqueFormulaCount, 'number')
  assert.equal(typeof json.debug.finalSelection.uniqueSilhouetteCount, 'number')
  assert.equal(typeof json.debug.finalSelection.comparisonSetCollapsed, 'boolean')
  assert.equal(json.debug.sessionMemory.recentSessionCount, 0)

  const composerCall = aiCalls.find(c => c.system.includes('personal stylist. You are looking at photos'))
  const composerRequestText = composerCall.messages[0].content
    .filter(part => part?.type === 'text')
    .map(part => part.text)
    .join('\n')
  assert.match(composerRequestText, /COMPARISON SET CONTRACT:/)
  assert.match(composerRequestText, /meaningfully different outfit formulas or clearly different silhouettes/)
  assert.match(composerRequestText, /Activity-safe footwear may repeat/)
  assert.match(composerRequestText, /TIME-OF-DAY WEATHER:/)
  assert.match(composerRequestText, /Opacity and needs_base are authoritative/)
  assert.match(composerRequestText, /sleeveless vest over a light or short-sleeved base handles the outdoor chill/)
  assert.match(composerRequestText, /indoor destination.*does not erase arrival and departure weather/i)

  // Verify that rotation sessions are saved
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM whole_wardrobe_sessions').get().count, 1)
  const firstRun = db.prepare('SELECT * FROM generation_runs WHERE flow = ?').get('whole_wardrobe_visual')
  assert.ok(firstRun)
  assert.equal(firstRun.occasion, 'city')
  assert.equal(firstRun.roster_count, json.debug.rosterCount)
  assert.equal(firstRun.pool_size, json.debug.postGatePoolSize)
  assert.equal(firstRun.cap_applied, 0)
  assert.deepEqual(JSON.parse(firstRun.cut_ids), [])
  assert.equal(firstRun.requested, 3)
  assert.equal(firstRun.delivered, json.debug.deliveredCount)
  assert.deepEqual(JSON.parse(firstRun.coverage_gaps), json.debug.activityCoverageGaps)

  // 1. Generate an image from a visual-composer card via the existing /api/ai/generate-wardrobe-outfit-image endpoint
  const outfit = { ...json.structuredOutfits[0], stylingInstructions: 'Leave the top untucked over the pants.' }
  const imageJson = await postJson('/api/ai/generate-wardrobe-outfit-image', {
    outfit,
    occasion: 'city',
    season: 'current season',
  })

  assert.equal(imageJson.mode, 'generate_wardrobe_outfit_image')
  assert.ok(imageJson.imageUrl)
  assert.equal(imageJson.wholeWardrobe, true)
  assert.equal(imageJson.stylingInstructions, 'Leave the top untucked over the pants.', 'styling_instructions on the outfit must survive the round-trip to the generated board response, not just the image prompt')

  // 2. Run the workflow twice in a row and confirm the second call's outfits differ meaningfully (rotation warning loop test)
  const json2 = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'current season',
    mood: 'modern bohemian',
    limit: 3,
  })

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM whole_wardrobe_sessions').get().count, 2)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM generation_runs WHERE flow = 'whole_wardrobe_visual'").get().count, 2)
  assert.ok(json2.debug.sessionMemory.recentSessionCount >= 1)
  assert.ok(json2.debug.sessionMemory.piecePenaltyCount >= 1)
  assert.equal(json2.debug.sessionMemory.rotationWarningShown, true)
  
  // Verify that the second call received rotation warning texts (meaning it saw recently shown garments)
  const visualComposerCalls = aiCalls.filter(c => c.system.includes("personal stylist. You are looking at photos"))
  assert.equal(visualComposerCalls.length, 2)

  // Verify the full rules blob is not present in the visual composer prompt; the lean digest stays in the user message.
  for (const call of visualComposerCalls) {
    assert.ok(!call.system.includes('RULES-AS-DATA'))
    assert.ok(call.system.includes('Occasion & Weather Classification'))
    assert.ok(call.messages[0].content.some(part => part.type === 'text' && /Occasion guidance:/i.test(part.text || '')))
    assert.ok(call.messages[0].content.some(part => part.type === 'image' && ['high', 'auto'].includes(part.detail)))
    assert.ok(!call.messages[0].content.some(part => part.type === 'image' && part.detail === 'low'))
  }

  const firstCallText = visualComposerCalls[0].messages[0].content.filter(p => p.type === 'text').map(p => p.text).join('\n')
  const secondCallText = visualComposerCalls[1].messages[0].content.filter(p => p.type === 'text').map(p => p.text).join('\n')

  // The first call shouldn't have rotation warning text for 'city' occasion (as it was empty)
  assert.ok(!firstCallText.includes('Recently shown garments'))
  // The second call must contain rotation warning text listing the garments from the first session
  assert.ok(secondCallText.includes('Recently shown garments'))
})

test('visual wardrobe composer endpoint propagates activity parameter to LLM prompt', async () => {
  aiCalls = []
  db.prepare("UPDATE pieces SET heel_height = 'flat', walk_support = 'high', shoe_type = 'sneaker', formality = 'everyday' WHERE id = ?").run(seeded.shoe)
  db.prepare("UPDATE pieces SET heel_height = 'flat', walk_support = 'medium', shoe_type = 'boot', formality = 'everyday' WHERE id = ?").run(seeded.boot)

  const json = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'current season',
    mood: 'modern bohemian',
    activity: 'walking',
    limit: 2,
  })

  assert.equal(json.mode, 'generate_wardrobe_outfits_visual')
  const visualComposerCalls = aiCalls.filter(c => c.system.includes("personal stylist. You are looking at photos"))
  assert.ok(visualComposerCalls.length >= 1)
  
  const contentText = visualComposerCalls[0].messages[0].content.filter(p => p.type === 'text').map(p => p.text).join('\n')
  assert.ok(contentText.includes('Activity: walking'), 'The visual composer prompt must contain Activity: walking')
  assert.ok(contentText.includes('All-day walking: avoid stilettos, high heels, pumps, delicate sandals, and warm-weather boots'), 'The visual composer prompt must contain walking guidance')
  const returnedNames = json.structuredOutfits.flatMap(o => o.pieces || []).map(p => p.name).join(' ').toLowerCase()
  assert.match(returnedNames, /brown ankle boots/, 'visual composer should keep the model-selected shoe visible')
  assert.ok(json.structuredOutfits.some(outfit => outfit.systemSuggestion?.type === 'comfort' && Number(outfit.systemSuggestion.swapOut) === Number(seeded.boot)))
  assert.equal(json.debug.finalSelection.localFillAdded, 0)
  assert.equal(json.debug.deliveredCount, 1)
  assert.equal(json.debug.brokenCardCount, 0)
})

test('visual wardrobe composer derives hot weather from styling request text before building roster', async () => {
  aiCalls = []

  const json = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'spring',
    request: 'not too dressy, hot weather',
    limit: 2,
  })

  assert.equal(json.mode, 'generate_wardrobe_outfits_visual')
  assert.equal(json.debug.weatherProfile.isHot, true)
  assert.ok(json.debug.suppressedCount >= 1, 'hot weather request should suppress at least one hot-weather-invalid piece')
  assert.ok(json.debug.suppressedReasonCounts['hot weather: insulating fiber'] >= 1)

  const generationRun = db.prepare('SELECT * FROM generation_runs WHERE flow = ? ORDER BY id DESC LIMIT 1').get('whole_wardrobe_visual')
  assert.ok(generationRun)
  assert.equal(JSON.parse(generationRun.weather).isHot, true)

  const visualComposerCalls = aiCalls.filter(c => c.system.includes("personal stylist. You are looking at photos"))
  assert.ok(visualComposerCalls.length >= 1)
  const contentText = visualComposerCalls[0].messages[0].content.filter(p => p.type === 'text').map(p => p.text).join('\n')
  assert.ok(contentText.includes('Styling request: not too dressy, hot weather'))
  assert.ok(contentText.includes('Off-season pieces have been deprioritized or removed; everything shown is weather-optimized.'))
  assert.doesNotMatch(contentText, /plum wool dress/i, 'hot-weather-invalid wool dress should not be shown to the visual composer')
})

test('visual wardrobe composer excludes lightweight linen bottoms for cold request weather', async () => {
  aiCalls = []
  db.prepare("UPDATE pieces SET heel_height = 'flat', walk_support = 'high', shoe_type = 'sneaker', formality = 'everyday' WHERE id = ?").run(seeded.shoe)
  db.prepare("UPDATE pieces SET heel_height = 'flat', walk_support = 'medium', shoe_type = 'boot', formality = 'everyday' WHERE id = ?").run(seeded.boot)

  const json = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'spring',
    request: 'not too dressy, cold weather',
    activity: 'walking',
    limit: 2,
  })

  assert.equal(json.mode, 'generate_wardrobe_outfits_visual')
  assert.equal(json.debug.weatherProfile.isCold, true)
  assert.ok(json.debug.suppressedReasonCounts['cold weather: lightweight linen bottom'] >= 1)

  const visualComposerCalls = aiCalls.filter(c => c.system.includes("personal stylist. You are looking at photos"))
  assert.ok(visualComposerCalls.length >= 1)
  const contentText = visualComposerCalls[0].messages[0].content.filter(p => p.type === 'text').map(p => p.text).join('\n')
  assert.ok(contentText.includes('Styling request: not too dressy, cold weather'))
  assert.doesNotMatch(contentText, /light beige linen wide-leg pants/i, 'lightweight linen pants should not be shown to the visual composer for cold weather')
})

test('visual wardrobe composer shows rejected model cards as broken diagnostics', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    aiCalls.push({ system, messages })
    if (String(system || '').includes("personal stylist. You are looking at photos")) {
      return {
        outfits: [{
          label: 'Valid model outfit',
          strength: 'signature',
          dominantDirection: 'city structure',
          silhouette: 'top over bottom',
          bestFor: 'city',
          pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
          reason: 'A complete model outfit with top, bottom, and shoe.',
          watchFor: 'None.',
        }, {
          label: 'Model forgot shoes',
          strength: 'strong',
          dominantDirection: 'unfinished column',
          silhouette: 'top over bottom',
          bestFor: 'city',
          pieceIds: [seeded.top, seeded.bottom],
          reason: 'The model proposed a top and bottom but no shoe.',
          watchFor: 'Missing grounding.',
        }, {
          label: 'Model mixed dress and pants',
          strength: 'usable',
          dominantDirection: 'overbuilt dress formula',
          silhouette: 'dress plus bottom',
          bestFor: 'city',
          pieceIds: [seeded.dress, seeded.bottom, seeded.shoe],
          reason: 'The model mixed a dress with a separate bottom.',
          watchFor: 'Too many lower-body pieces.',
        }],
        rejected: [],
        skip: '',
        saveableLearning: 'mock rejected model cards',
      }
    }
    return mockAiHandler({ system, messages })
  }

  const json = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'indoor',
    mood: '',
    limit: 3,
  })

  assert.equal(json.debug.aiReturnedCount, 3)
  assert.equal(json.debug.finalSelection.aiResolvedWithOwnedPieces, 3)
  assert.equal(json.debug.finalSelection.aiStructurallyValid, 1)
  const brokenCards = json.structuredOutfits.filter(outfit => outfit.broken)
  assert.equal(brokenCards.length, 2)
  assert.ok(brokenCards.every(outfit => outfit.source === 'model-rejected'))
  assert.deepEqual(
    brokenCards.map(outfit => outfit.rejectionReason).sort(),
    ['structural: dress plus bottom', 'structural: missing shoes']
  )
  assert.ok(brokenCards.some(outfit => outfit.label.includes('Model forgot shoes')))
  assert.ok(brokenCards.some(outfit => outfit.label.includes('Model mixed dress and pants')))

  // Regression: rejectionReason is the single structured field on a broken card. It must not
  // also leak, raw, through any other ungated field (reason suffix, watchFor, systemFlags) —
  // see docs/stylist-bugfix-spec.md item 1.
  for (const outfit of brokenCards) {
    assert.ok(outfit.rejectionReason, 'broken card must carry a structured rejectionReason')
    assert.ok(
      !String(outfit.reason || '').includes(outfit.rejectionReason),
      `reason field leaked the raw rejectionReason: ${outfit.reason}`
    )
    assert.ok(
      outfit.watchFor === undefined || !String(outfit.watchFor).includes(outfit.rejectionReason),
      `watchFor leaked the raw rejectionReason: ${outfit.watchFor}`
    )
    const flagMessages = Array.isArray(outfit.systemFlags) ? outfit.systemFlags.map(f => f.message) : []
    assert.ok(
      !flagMessages.some(msg => String(msg || '').includes(outfit.rejectionReason)),
      `systemFlags leaked the raw rejectionReason: ${JSON.stringify(flagMessages)}`
    )
  }
})

test('visual wardrobe composer failure uses local fallback without retired agent call', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system }) => {
    aiCalls.push({ system, messages: [] })
    if (String(system || '').includes("personal stylist. You are looking at photos")) {
      throw new Error('mock composer outage')
    }
    return mockAiHandler({ system, messages: [] })
  }

  const json = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'current season',
    mood: 'modern bohemian',
    limit: 2,
  })

  assert.equal(json.mode, 'generate_wardrobe_outfits_visual')
  assert.equal(json.debug.composerError, 'mock composer outage')
  assert.ok(Array.isArray(json.structuredOutfits))
  assert.ok(!aiCalls.some(call => String(call.system || '').includes('personal visual stylist agent')))
})

test('visual wardrobe composer returns model outfits and annotates outdoor social concerns', async () => {
  aiCalls = []

  const badTopPhoto = await makeImage('outdoor-bad-top.png', '#b86442')
  const badShoePhoto = await makeImage('outdoor-bad-shoe.png', '#c8c8c8')
  const goodTopPhoto = await makeImage('outdoor-good-top.png', '#6f7b4c')
  const goodBottomPhoto = await makeImage('outdoor-good-bottom.png', '#15120f')
  const goodShoePhoto = await makeImage('outdoor-good-shoe.png', '#111111')

  const badTopId = insertPiece({
    name: 'multicolor floral hooded sweatshirt',
    category: 'top',
    colors: ['multi'],
    occasions: ['outdoor_daytime_social', 'casual'],
    photo: badTopPhoto,
    reads_as: 'casual hoodie sweatshirt fleece',
    // Deliberately NOT 'sweatshirt fleece': the point of this fixture is the SOFT taste-concern
    // path (occasion profile discouraged_pieces matches "sweatshirt" in the name/reads_as, an
    // advisor-mode annotation, not a removal) — 'sweatshirt fleece' as fabric_category also trips
    // the separate, harder hot-weather insulating-material gate in wholeWardrobePieceTrustDecision
    // (a genuine physical-suitability exclusion, correctly stricter now that pieceHasInsulatingMaterial
    // reads fabric_category too, not just fiber_content), which removes the piece from the roster
    // entirely before this test's own soft-annotation path is ever reached.
    fabric_category: 'cotton',
    fabric_weight: 'medium',
  })
  const badShoeId = insertPiece({
    name: 'light grey knit athletic shoes',
    category: 'shoes',
    colors: ['grey'],
    occasions: ['outdoor_daytime_social', 'casual'],
    photo: badShoePhoto,
    reads_as: 'athletic running shoes gym shoes',
    fabric_category: 'knit',
    formality: 'elevated',
  })
  const goodTopId = insertPiece({
    name: 'olive ruffled sleeveless top',
    category: 'top',
    colors: ['olive'],
    occasions: ['outdoor_daytime_social', 'city'],
    photo: goodTopPhoto,
    reads_as: 'intentional textured sleeveless top',
    silhouette: 'structured sleeveless top',
    fabric_category: 'cotton',
    fabric_weight: 'light',
    formality: 'elevated',
  })
  const goodBottomId = insertPiece({
    name: 'black cream botanical tiered midi skirt',
    category: 'bottom',
    colors: ['black', 'cream'],
    occasions: ['outdoor_daytime_social', 'city'],
    photo: goodBottomPhoto,
    reads_as: 'botanical midi skirt with visual structure',
    pattern_type: 'botanical',
    pattern_scale: 'medium',
    pattern_complexity: 'medium',
    silhouette: 'tiered midi skirt',
    fabric_category: 'cotton',
    fabric_weight: 'light',
    length_hits_at: 'midi',
    formality: 'elevated',
  })
  const goodShoeId = insertPiece({
    name: 'black slip-on loafers',
    category: 'shoes',
    colors: ['black'],
    occasions: ['outdoor_daytime_social', 'city'],
    photo: goodShoePhoto,
    reads_as: 'grounded black loafers lightweight flats',
    formality: 'elevated',
  })
  db.prepare("UPDATE pieces SET heel_height = 'flat', walk_support = 'high', shoe_type = 'sneaker' WHERE id = ?").run(badShoeId)
  db.prepare("UPDATE pieces SET heel_height = 'flat', walk_support = 'high', shoe_type = 'loafer' WHERE id = ?").run(goodShoeId)
  assert.ok(badTopId && badShoeId && goodTopId && goodBottomId && goodShoeId)

  const json = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'outdoor_daytime_social',
    season: 'current season',
    activity: 'walking',
    limit: 2,
  })

  assert.equal(json.mode, 'generate_wardrobe_outfits_visual')
  assert.equal(json.structuredOutfits.length, 2)
  const returnedNames = json.structuredOutfits.flatMap(o => o.pieces || []).map(p => p.name).join(' ').toLowerCase()
  assert.match(returnedNames, /hooded sweatshirt|athletic shoes/, 'visual composer should not silently remove model outfits for taste concerns')
  assert.match(returnedNames, /olive ruffled sleeveless top|botanical tiered midi skirt|black slip-on loafers/)
  const flaggedOutfit = json.structuredOutfits.find(outfit => (outfit.pieces || []).some(piece => /hooded sweatshirt|athletic shoes/i.test(piece.name || '')))
  assert.ok(flaggedOutfit)
  assert.ok(Array.isArray(flaggedOutfit.systemFlags))
  assert.ok(flaggedOutfit.systemFlags.some(flag => flag.type === 'occasion'))
  assert.equal(json.debug.finalSelection.localFillAdded, 0)
  assert.equal(json.debug.finalSelection.modelGateOutfits, 2)

  const visualComposerCalls = aiCalls.filter(c => c.system.includes("personal stylist. You are looking at photos"))
  const contentText = visualComposerCalls[0].messages[0].content.filter(p => p.type === 'text').map(p => p.text).join('\n')
  assert.match(contentText, /use sparingly and justify in watchFor:/i)
  assert.match(contentText, /hoodie/i)
  assert.match(contentText, /athletic running shoe/i)
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
  assert.ok(fs.existsSync(path.join(userUploadsDir(), json.boards[0].imageUrl.replace('/uploads/', ''))))
})

test('selected-piece board generation carries styling_instructions through from client-supplied structured outfits', async () => {
  const json = await postJson('/api/ai/generate-outfit-boards', {
    pieceId: seeded.bottom,
    occasion: 'city',
    season: 'current season',
    structuredOutfits: [{ ...selectedPieceOutfit(), stylingInstructions: 'Leave the top untucked over the pants.' }],
  })

  assert.equal(json.mode, 'generate_outfit_boards')
  assert.equal(json.boards[0].stylingInstructions, 'Leave the top untucked over the pants.')
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

test('whole-wardrobe outfit image button requests AI render instead of preview collage', () => {
  const chatSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const coreSrc = fs.readFileSync(path.join(process.cwd(), 'styling-engine/core.js'), 'utf8')

  assert.match(chatSrc, /renderMode: options\.renderMode \|\| 'ai'/)
  assert.match(routeSrc, /renderMode = ''/)
  assert.match(routeSrc, /forceAi: renderMode === 'ai'/)
  assert.match(coreSrc, /forceAi = false/)
  assert.match(coreSrc, /mockAiEnabled\(\) \|\| \(!forceAi && photoPreservingVisualsEnabled\(\)\) \|\| !hasOpenAiKey\(\)/)
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
  db.prepare('UPDATE outfits SET main_piece_id = ? WHERE id = ?').run(seeded.shoe, seeded.outfitId)
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
  assert.equal(json.boards[0].mainPieceId, seeded.shoe)
  assert.ok(json.boards[0].imageUrl.startsWith('/uploads/generated-boards/'))
})

test('saved outfit formula variants use gated wardrobe cards and preserve Main piece', async () => {
  db.prepare('UPDATE outfits SET main_piece_id = ? WHERE id = ?').run(seeded.shoe, seeded.outfitId)
  const json = await postJson('/api/ai/generate-saved-outfit-variants', {
    outfit: { id: seeded.outfitId, name: 'Vest top + white blouse', photo: `/uploads/${seeded.photos.outfit}` },
    occasion: 'city',
    season: 'warm',
    mode: 'formula',
  })

  assert.equal(json.mode, 'generate_saved_outfit_formula_variants')
  assert.equal(json.pipeline, 'saved_outfit_wardrobe_variant_composer')
  assert.equal(json.savedOutfitVariantMode, 'formula')
  assert.ok(Array.isArray(json.structuredOutfits))
  assert.ok(json.structuredOutfits.length >= 1)
  assert.ok(json.structuredOutfits.filter(outfit => !outfit.broken).every(outfit => outfit.pieceIds.includes(seeded.shoe)))
  assert.equal(json.debug.mainPieceId, seeded.shoe)
  assert.equal(json.debug.weatherProfile.isHot, true)
  assert.equal(typeof json.debug.finalSelection.modelMissingMainRejected, 'number')
  assert.equal(typeof json.debug.finalSelection.localBackfillMissingMainRejected, 'number')
  assert.equal(typeof json.debug.finalSelection.diagnosticBackfillMissingMainRejected, 'number')
  assert.equal(typeof json.debug.finalSelection.missingMainRejected, 'number')
  const composerCall = aiCalls.find(call => String(call.system || '').includes('SAVED OUTFIT VARIANT CONTRACT'))
  assert.ok(composerCall)
  assert.match(composerCall.system, /Formula-similar mode: use only shown wardrobe pieces/)
  assert.match(composerCall.system, new RegExp(`MUST include Main piece ID ${seeded.shoe}`))
  const composerRequestText = composerCall.messages[0].content
    .filter(part => part?.type === 'text')
    .map(part => part.text)
    .join('\n')
  assert.doesNotMatch(composerRequestText, /COMPARISON SET CONTRACT:/, 'formula-similar variants preserve their source formula instead of receiving cross-formula diversity pressure')
})

test('saved outfit formula variants pin Main even when warm weather suppresses it', async () => {
  db.prepare('INSERT INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)').run(seeded.outfitId, seeded.dress)
  db.prepare('UPDATE outfits SET main_piece_id = ?, occasion = ? WHERE id = ?').run(seeded.dress, 'smart-casual', seeded.outfitId)
  const json = await postJson('/api/ai/generate-saved-outfit-variants', {
    outfit: { id: seeded.outfitId, name: 'Wool dress saved look', photo: `/uploads/${seeded.photos.outfit}` },
    occasion: 'smart-casual',
    season: 'warm',
    mode: 'formula',
  })

  assert.equal(json.debug.mainPieceId, seeded.dress)
  assert.equal(json.debug.weatherProfile.isHot, true)
  assert.equal(json.debug.savedMainBypassedSuppression, true)
  assert.ok(json.debug.savedMainSuppressionReasons.length >= 1)
  assert.ok(json.structuredOutfits.filter(outfit => !outfit.broken).every(outfit => outfit.pieceIds.includes(seeded.dress)))
})

test('saved outfit formula variants reject collapsed model cards for two-top source looks', async () => {
  const buttonDownPhoto = await makeImage('olive-button-down.png', '#70815a')
  const buttonDown = insertPiece({
    name: 'olive button-down shirt',
    category: 'top',
    colors: ['olive'],
    occasions: ['city', 'casual'],
    photo: buttonDownPhoto,
    notes: 'button-down worn open as a top layer',
    reads_as: 'olive button-down overshirt top layer',
    fabric_weight: 'light',
    formality: 'everyday',
  })
  db.prepare('INSERT INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)').run(seeded.outfitId, buttonDown)
  db.prepare('UPDATE outfits SET main_piece_id = ?, occasion = ? WHERE id = ?').run(buttonDown, 'city', seeded.outfitId)

  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    aiCalls.push({ system, messages })
    if (String(system || '').includes("personal stylist. You are looking at photos")) {
      return {
        outfits: [{
          label: 'Collapsed button-down city column',
          strength: 'signature',
          dominantDirection: 'single top over relaxed pants',
          silhouette: 'button-down top + wide pants',
          bestFor: 'city',
          pieceIds: [buttonDown, seeded.bottom, seeded.shoe],
          reason: 'The button-down is used as the only top.',
          watchFor: 'Collapsed source formula.',
        }, {
          label: 'Collapsed button-down with boot',
          strength: 'strong',
          dominantDirection: 'single top with grounded boot',
          silhouette: 'button-down top + wide pants',
          bestFor: 'city',
          pieceIds: [buttonDown, seeded.bottom, seeded.boot],
          reason: 'The button-down is again used as the only top.',
          watchFor: 'Collapsed source formula.',
        }, {
          label: 'Collapsed button-down denim',
          strength: 'usable',
          dominantDirection: 'single top with dark jeans',
          silhouette: 'button-down top + jeans',
          bestFor: 'city',
          pieceIds: [buttonDown, seeded.jeans, seeded.shoe],
          reason: 'The button-down is still the only top.',
          watchFor: 'Collapsed source formula.',
        }],
        rejected: [],
        skip: '',
        saveableLearning: 'mock collapsed two-top source look',
      }
    }
    return mockAiHandler({ system, messages })
  }

  const json = await postJson('/api/ai/generate-saved-outfit-variants', {
    outfit: { id: seeded.outfitId, name: 'Olive button-down and beige pants', photo: `/uploads/${seeded.photos.outfit}` },
    occasion: 'city',
    season: 'warm',
    mode: 'formula',
  })

  assert.equal(json.debug.savedSourceHasLayeredTopFormula, true)
  assert.ok(json.debug.finalSelection.modelLayeredTopFormulaRejected >= 2)
  assert.equal(json.debug.finalSelection.aiStructurallyValid, 0)
  assert.ok(json.debug.finalSelection.localFillAdded >= 1)
  const ready = json.structuredOutfits.filter(outfit => !outfit.broken)
  assert.ok(ready.length >= 1)
  assert.ok(ready.every(outfit => outfit.pieceIds.includes(buttonDown)))
  assert.ok(ready.every(outfit => outfit.pieces.filter(piece => piece.category === 'top').length >= 2))
  const composerCall = aiCalls.find(call => String(call.system || '').includes('SAVED OUTFIT VARIANT CONTRACT'))
  assert.ok(composerCall)
  assert.match(composerCall.system, /Formula-similar results MUST preserve that layered-top structure/)
})

test('saved outfit adjacent variants loosen the formula while staying wardrobe-only', async () => {
  db.prepare('UPDATE outfits SET main_piece_id = ? WHERE id = ?').run(seeded.shoe, seeded.outfitId)
  const json = await postJson('/api/ai/generate-saved-outfit-variants', {
    outfit: { id: seeded.outfitId, name: 'Vest top + white blouse', photo: `/uploads/${seeded.photos.outfit}` },
    occasion: 'city',
    season: 'current season',
    mode: 'adjacent',
  })

  assert.equal(json.mode, 'generate_saved_outfit_adjacent_variants')
  assert.equal(json.savedOutfitVariantMode, 'adjacent')
  assert.ok(json.structuredOutfits.filter(outfit => !outfit.broken).every(outfit => outfit.pieceIds.includes(seeded.shoe)))
  const composerCall = aiCalls.find(call => String(call.system || '').includes('Adjacent mode: use only shown wardrobe pieces'))
  assert.ok(composerCall)
  assert.match(composerCall.system, /allow a nearby formula, silhouette, or grounding strategy/)
})

test('saved outfit adjacent variants locally backfill complete outfits around jacket Main', async () => {
  db.prepare('INSERT INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)').run(seeded.outfitId, seeded.jacket)
  db.prepare('UPDATE outfits SET main_piece_id = ?, occasion = ? WHERE id = ?').run(seeded.jacket, 'smart-casual', seeded.outfitId)
  const json = await postJson('/api/ai/generate-saved-outfit-variants', {
    outfit: { id: seeded.outfitId, name: 'Jacket-led saved look', photo: `/uploads/${seeded.photos.outfit}` },
    occasion: 'smart-casual',
    season: 'warm',
    mode: 'adjacent',
  })

  assert.equal(json.mode, 'generate_saved_outfit_adjacent_variants')
  assert.equal(json.savedOutfitVariantMode, 'adjacent')
  assert.equal(json.debug.mainPieceId, seeded.jacket)
  assert.ok(json.debug.finalSelection.localFillAdded >= 1)
  assert.equal(json.debug.finalSelection.localFillGateRejectedReasons['not a complete wardrobe outfit'] || 0, 0)
  const ready = json.structuredOutfits.filter(outfit => !outfit.broken)
  assert.ok(ready.length >= 1)
  assert.ok(ready.every(outfit => outfit.pieceIds.includes(seeded.jacket)))
  assert.ok(ready.every(outfit => outfit.pieces.some(piece => piece.category === 'top')))
  assert.ok(ready.every(outfit => outfit.pieces.some(piece => piece.category === 'bottom')))
  assert.ok(ready.every(outfit => outfit.pieces.some(piece => piece.category === 'shoes')))
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
  assert.ok(prompt.includes('vary the outfit formula family, silhouette family, grounding/shoe strategy, and focal hierarchy'))

  const mainPrompt = savedOutfitImagePrompt({
    outfit: { name: 'Shoe-led saved outfit', mainPieceId: seeded.shoe },
    pieces: [
      { id: seeded.top, name: 'emerald sleeveless top', category: 'Top' },
      { id: seeded.bottom, name: 'beige pleated pants', category: 'Bottom' },
      { id: seeded.shoe, name: 'bold multicolor floral espadrilles', category: 'Shoes' },
    ],
    occasion: 'city',
    season: 'current season',
    variantMode: 'creative',
    currentDate: new Date('2026-06-15T12:00:00-07:00'),
  })
  assert.ok(mainPrompt.includes('user-selected main linked garment'))
  assert.ok(mainPrompt.includes('bold multicolor floral espadrilles (shoes)'))
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
  assert.equal(json.debug.providerCalls, 1)
  assert.equal(json.debug.usage.inputTokens, 5200)
  assert.equal(json.debug.usage.outputTokens, 850)
  assert.equal(json.debug.usage.cacheReadInputTokens, 4000)
  assert.equal(json.debug.estimatedCost.pricingAvailable, true)
  assert.match(json.feedback, /^\*\*Works with one adjustment\.\*\*/)
  assert.match(json.feedback, /\*\*Try this:\*\* Adjust the pant hem/)
  assert.match(json.feedback, /\*\*Check:\*\* Look for the leg line/)
  assert.doesNotMatch(json.feedback, /Mock evaluation/)
  assert.match(json.feedback, /Fit placement: garments sit naturally/)
  assert.match(json.feedback, /Proportion read: top length and pant rise create a readable proportion/)
  assert.match(json.feedback, /Idea viability: keep/)
  assert.match(json.feedback, /Execution gap: minor floor-line watch only/)
})

test('generated board evaluation labels the board as synthetic while My Outfits keeps worn-photo authority', async () => {
  await postJson('/api/ai/evaluate-wardrobe-outfit', {
    outfit: {
      label: 'Generated mock board',
      photo: `/uploads/${seeded.photos.outfit}`,
      visualEvidenceType: 'generated_board',
    },
    pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
    occasion: 'city',
    season: 'current season',
    question: 'Evaluate this generated board.',
  })

  const generatedCall = aiCalls.at(-1)
  const generatedContent = generatedCall.messages.at(-1).content
  const generatedText = generatedContent.at(-1).text
  assert.match(generatedContent[0].text, /IMAGE 1 — AI-GENERATED STYLING VISUALIZATION: Generated mock board/)
  assert.equal(generatedContent[1].type, 'image')
  assert.match(generatedContent[2].text, /IMAGE 2 — LINKED GARMENT REFERENCE: black button detail top \(top\)/)
  assert.equal(generatedContent[3].type, 'image')
  assert.match(generatedText, /first image is an AI-generated styling visualization, not a worn outfit photo/)
  assert.match(generatedText, /AI-generated styling visualization: Generated mock board/)
  assert.match(generatedText, /identify rendering errors/)
  assert.match(generatedText, /Generated-board output validity check/)
  assert.match(generatedText, /contradictory action makes the response invalid/)

  await postJson('/api/ai/evaluate-wardrobe-outfit', {
    outfit: { id: seeded.outfitId, label: 'Saved mock outfit', photo: `/uploads/${seeded.photos.outfit}` },
    occasion: 'city',
    season: 'year-round',
    question: 'Evaluate this saved outfit.',
  })

  const savedCall = aiCalls.at(-1)
  const savedContent = savedCall.messages.at(-1).content
  const savedText = savedContent.at(-1).text
  assert.equal(savedContent[0].type, 'image')
  assert.doesNotMatch(savedText, /Generated-board output validity check/)
  assert.match(savedText, /first image is the actual worn outfit photo/)
  assert.match(savedText, /actual worn outfit photo: Saved mock outfit/)
  assert.doesNotMatch(savedText, /first image is an AI-generated styling visualization/)
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
  assert.equal(json.debug.providerCalls, 1)
  assert.equal(json.debug.resultCache.hit, false)
  assert.equal(json.debug.usage.outputTokens, 80)
  assert.equal(json.debug.usage.cacheReadInputTokens, 900)

  const lastCall = aiCalls.at(-1)
  assert.equal(lastCall.maxTokens, 500)
  assert.match(lastCall.system, /continuing an existing critique conversation/)
  assert.doesNotMatch(lastCall.system, /detailedCritique/)
  const latestUserMessage = lastCall.messages.at(-1)
  assert.ok(Array.isArray(latestUserMessage.content))
  assert.match(latestUserMessage.content.at(-1).text, /Current attached image inventory for this turn/)
  assert.match(latestUserMessage.content.at(-1).text, /If the user asks what photos\/images you can see/)
})

test('critique followups expose only wardrobe retrieval tools', () => {
  const tools = stylistToolsForTurn({
    allowedToolNames: ['search_wardrobe', 'view_pieces', 'get_garment_details'],
  })
  assert.deepEqual(
    tools.map(tool => tool.name),
    ['search_wardrobe', 'view_pieces', 'get_garment_details'],
  )
})

test('exact duplicate outfit critiques reuse the short-lived result cache', async () => {
  process.env.WARDROBE_TEST_EVALUATION_CACHE = 'true'
  const request = {
    outfit: { label: 'Cached mock outfit', photo: `/uploads/${seeded.photos.outfit}` },
    pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
    occasion: 'city',
    season: 'current season',
    question: 'Evaluate this outfit.',
  }

  try {
    const first = await postJson('/api/ai/evaluate-wardrobe-outfit', request)
    const callsAfterFirst = aiCalls.length
    const second = await postJson('/api/ai/evaluate-wardrobe-outfit', request)

    assert.equal(first.debug.providerCalls, 1)
    assert.equal(first.debug.resultCache.hit, false)
    assert.equal(second.debug.providerCalls, 0)
    assert.equal(second.debug.resultCache.hit, true)
    assert.equal(second.debug.estimatedCost.estimatedUsd, 0)
    assert.equal(aiCalls.length, callsAfterFirst, 'cache hit must not consume another provider response')
    assert.equal(second.feedback, first.feedback)
  } finally {
    delete process.env.WARDROBE_TEST_EVALUATION_CACHE
    clearOutfitEvaluationResultCache()
  }
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
  assert.match(json.feedback, /^\*\*Works with one adjustment\.\*\*/)
  assert.match(json.feedback, /\*\*Try this:\*\* Adjust the pant hem/)
  assert.match(json.feedback, /\*\*Check:\*\* Look for the leg line/)
  assert.match(json.feedback, /--- Full structured read ---/)
  assert.ok(json.feedback.indexOf('**Works with one adjustment.**') < json.feedback.indexOf('--- Full structured read ---'))
  // The summary is deduped out of the details block when userCritique leads.
  assert.doesNotMatch(json.feedback, /Mock evaluation/)
  assert.equal(json.evaluation.summary, 'Mock evaluation')
  assert.match(json.feedback, /Fit placement: garments sit naturally/)
  assert.match(json.feedback, /Proportion read: top length and pant rise create a readable proportion/)
  assert.match(json.feedback, /Idea viability: keep/)
  assert.match(json.feedback, /Execution gap: minor floor-line watch only/)
  assert.deepEqual(json.evaluation.userCritique, {
    answer: 'Works with one adjustment',
    reason: 'The black top gives the wide-leg pants a clear upper edge, but the long hem is beginning to hide the shoes.',
    action: 'Adjust the pant hem enough to keep the cream shoes readable.',
    check: 'Look for the leg line to stay long without fabric pooling over the shoes.',
    occasionNote: '',
  })
  // The actionable answer leads the collapsed "Full structured read" details, ahead of the
  // supporting diagnostic/score dump — someone expanding it is looking for the fix, not a
  // dozen analysis rows before reaching it.
  assert.match(json.feedback, /First visible issue: No major issue\./)
  assert.match(json.feedback, /Next: Keep the floor line visible\./)
  assert.match(json.feedback, /Avoid for now: Do not over-layer\./)
  const firstIssueIdx = json.feedback.indexOf('First visible issue:')
  const nextIdx = json.feedback.indexOf('Next:')
  const factsIdx = json.feedback.indexOf('Visible facts:')
  const scoresIdx = json.feedback.indexOf('Scores:')
  assert.ok(firstIssueIdx < nextIdx, 'first visible issue leads, ahead of the recommendation')
  assert.ok(nextIdx < factsIdx, 'the recommendation leads the diagnostic dump, not the reverse')
  assert.ok(factsIdx < scoresIdx, 'diagnostic fields keep their existing relative order after the answer')

  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /evaluating one proposed whole-wardrobe outfit/)
})

test('uploaded outfit feedback uses the shared wardrobe evaluator with uploaded image evidence', async () => {
  const form = new FormData()
  const fileBuffer = fs.readFileSync(path.join(userUploadsDir(), seeded.photos.outfit))
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
  assert.match(json.feedback, /^\*\*Works with one adjustment\.\*\*/)
  assert.match(json.feedback, /\*\*Try this:\*\* Adjust the pant hem/)
  assert.match(json.feedback, /\*\*Check:\*\* Look for the leg line/)
  assert.match(json.feedback, /--- Full structured read ---/)
  assert.doesNotMatch(json.feedback, /Mock evaluation/)
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
  // Slice 7 folded the four unconditional mode reminders into one Turn directive. This asserts the
  // correction contract itself — address it, fix the specific point, don't regenerate prior output —
  // rather than the pre-dedup sentence that carried it.
  assert.match(lastCall.system, /challenging or correcting a previous response/)
  assert.match(lastCall.system, /update the specific mistaken point/)
  assert.match(lastCall.system, /without regenerating prior lists\/outfits unless requested/)
  assert.match(lastCall.system, /User is correcting a previous seasonal assumption/)
  // The date is grounded in the volatile system half (asserted above), NOT repeated in the user
  // message. Repeating it made the sent representation differ from the one browser history replays
  // next turn, which broke the message-array cache prefix at index 0 on every follow-up.
  assert.equal(typeof latestUserMessage.content, 'string')
  assert.doesNotMatch(latestUserMessage.content, /Today is Monday, June 1, 2026/)
  assert.match(latestUserMessage.content, /today is June 1st/)
  assert.equal(latestUserMessage.content, 'today is June 1st', 'the user turn is exactly what history will replay')
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

test('freeform ask selected-item generated outfit follow-up does not become trip precompose', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'same outfit, but could I use taupe knit lace-up sneakers with this top?',
    pieces: [],
    history: [
      { role: 'user', content: 'Use my wardrobe to make outfits with this selected top.' },
      { role: 'assistant', content: 'Here are selected-item outfit cards.' },
    ],
    generatedContext: 'Outfit: Relaxed City Day\nPieces:\n- selected top\n- green utility shorts',
    generatedOutfits: [selectedPieceOutfit()],
    conversationMode: 'followup',
    activeContext: { type: 'piece', id: seeded.top, name: 'black button detail top' },
    occasion: 'city',
    season: 'current season',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  assert.deepEqual(json.structuredOutfits, [])
  assert.ok(!aiCalls.some(call => /FREEFORM_STYLIST_USE_CASE_PLANNER/.test(call.system || '')), 'selected-item follow-up should not invoke trip planner precompose')
  const lastCall = aiCalls.at(-1)
  assert.doesNotMatch(lastCall.system, /CURRENT OUTFIT SET \(LATEST, HIGH AUTHORITY\)/)
  assert.doesNotMatch(lastCall.system, /Trip outfits built from saved wardrobe pieces/)
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
  assert.match(lastCall.system, /THREAD STATE \(STRUCTURED\):/)
  assert.ok(lastCall.system.includes('"occasion": "evening"'))
  assert.ok(lastCall.system.includes('"activity": "walking"'))
  assert.ok(lastCall.system.includes('"season": "current season"'))
  assert.ok(lastCall.system.includes('"mood": "moody polish"'))
  assert.ok(lastCall.system.includes('"mission": "wildcard"'))
  assert.match(lastCall.system, /Reuse its values for follow-ups unless the user changes them/)
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

// The other half of the attribution guard in freeform_observability.test.js. That one enumerates the
// call sites in source; this one proves a real request actually lands an attributed row, so a route
// that stops forwarding sessionId fails here even if every call site still looks correct.
test('a freeform turn writes a run row attributed to its own thread', async () => {
  db.prepare('DELETE FROM freeform_generation_runs').run()
  const sessionId = `thread_attribution_${Date.now()}`
  const json = await postJson('/api/ai/ask', {
    question: 'What should I wear to a gallery opening?',
    pieces: [],
    history: [],
    conversationMode: 'new_request',
    sessionId,
  })
  assert.ok(json.answer, 'the turn should complete')

  const rows = db.prepare('SELECT * FROM freeform_generation_runs').all()
  assert.equal(rows.length, 1, 'exactly one run row for one turn')
  assert.equal(rows[0].session_id, sessionId, 'the row must carry the real thread ID, not an empty default')
  assert.equal(rows[0].turn_failed, 0)

  // Unattributed rows are the failure this guards: they cannot be grouped into conversations, which
  // is what made a month of recorded cost telemetry unusable for per-thread analysis.
  const unattributed = db.prepare("SELECT COUNT(*) AS n FROM freeform_generation_runs WHERE session_id = '' OR session_id IS NULL").get()
  assert.equal(unattributed.n, 0)
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
  // Same condition, stated by the surviving TRAVEL WEATHER BLOCKER rather than the pre-dedup mode
  // sentence. The three assertions above already carry the contract; this one names the trigger.
  assert.match(lastCall.system, /travel\/packing request without weather or forecast context/)
})

test('freeform ask does not precompose destination-only multi-day trips before activity scope is confirmed', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'Going to Fairfax, CA for a few days',
    weather: 'warm',
    pieces: [],
    history: [],
    conversationMode: 'new_request',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  assert.deepEqual(json.structuredOutfits, [])
  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /Trip Scope Clarification/)
  assert.match(lastCall.system, /What kinds of activities should I cover/)
})

test('freeform ask named-place day trip with activity resolves weather live instead of asking forecast', async () => {
  const json = await postJson('/api/ai/ask', {
    question: 'A hiking day trip to Fairfax tomorrow, what should I wear?',
    pieces: [],
    history: [],
    conversationMode: 'new_request',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  const lastCall = aiCalls.at(-1)
  assert.doesNotMatch(lastCall.system, /TRAVEL WEATHER BLOCKER/)
  assert.ok(lastCall.system.includes('"weather_resolution": "resolve live from named destination"'))
  assert.match(lastCall.system, /Pass the city\/place as `location` on 'search_wardrobe'/)
})

test('freeform ask ordinary what-should-I-wear request does not become trip precompose', async () => {
  const json = await postJson('/api/ai/ask', {
    question: "It's hot and I'll be walking around the city all day, but I don't want to look too casual. What should I wear?",
    pieces: [],
    history: [],
    conversationMode: 'new_request',
  })

  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  assert.deepEqual(json.structuredOutfits, [])
  assert.ok(!aiCalls.some(call => /FREEFORM_STYLIST_USE_CASE_PLANNER/.test(call.system || '')), 'ordinary outfit advice should not invoke trip planner precompose')
  const lastCall = aiCalls.at(-1)
  assert.doesNotMatch(lastCall.system, /Trip outfits built from saved wardrobe pieces/)
  assert.doesNotMatch(lastCall.system, /Trip plan/)
  assert.match(lastCall.system, /Proposing Outfits/)
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

test('freeform ask correction turns do NOT auto-store the raw question as a preference', async () => {
  // 2026-07-12: the pre-model auto-save was removed after live data showed it
  // filing plain requests as high-authority preferences (seven duplicates of
  // "give me 3 polished outfit ideas…" steering every later turn). Deliberate
  // saves happen through the model's store_user_correction tool instead.
  const before = db.prepare("SELECT COUNT(*) AS n FROM stylist_feedback").get().n
  const json = await postJson('/api/ai/ask', {
    question: 'I do not wear flats',
    pieces: [],
    history: [],
    conversationMode: 'correction',
    outfit: { id: seeded.outfitId, label: 'Active outfit' },
    pieceIds: [seeded.top, seeded.bottom],
  })
  assert.equal(json.answer, 'Mock stylist answer with generated outfit context.')
  const after = db.prepare("SELECT COUNT(*) AS n FROM stylist_feedback").get().n
  assert.equal(after, before, 'no auto-stored feedback row from the turn classifier')

  // The deliberate path still works (and is the only save path).
  await executeTool('store_user_correction', { note: 'I do not wear flats', context_type: 'outfit', context_id: seeded.outfitId }, {})
  const row = db.prepare("SELECT * FROM stylist_feedback WHERE note = 'I do not wear flats'").get()
  assert.ok(row)
  assert.equal(row.context_type, 'outfit')
  assert.equal(Number(row.context_id), seeded.outfitId)
})

test('item 12 fast path: an explicit "never wear" prohibition is stored with zero model calls, even inside an active thread', async () => {
  // Reproduces the exact 2026-08-11 measured case (feedback-routing-proposal.md item 12): the
  // sentence is self-contained, so re-reading trip/thread context to store it is pure overhead.
  const before = db.prepare('SELECT COUNT(*) AS n FROM stylist_feedback').get().n
  const json = await postJson('/api/ai/ask', {
    question: 'I never wear sandals for hiking',
    pieces: [],
    history: [{ role: 'user', content: 'planning a trip' }, { role: 'assistant', content: 'sure, tell me more' }],
    threadContext: 'Trip: Yosemite hiking weekend',
  })
  assert.equal(aiCalls.length, 0, 'the fast path must not invoke the model at all')
  assert.match(json.answer, /sandals/i)
  assert.match(json.answer, /hiking/i)
  assert.equal(json.savedCorrections.length, 1)
  assert.equal(json.savedCorrections[0].scope, 'garment_context')
  // The client uses this to suppress follow-up affordances (e.g. "Generate visual boards") that
  // assume the reply actually discussed the active piece/outfit context — this reply never did.
  assert.equal(json.isLocalAcknowledgment, true)
  const after = db.prepare('SELECT COUNT(*) AS n FROM stylist_feedback').get().n
  assert.equal(after, before + 1)
  const row = db.prepare("SELECT * FROM stylist_feedback WHERE note = 'I never wear sandals for hiking'").get()
  assert.equal(row.feedback_type, 'owner_rule')
  const payload = JSON.parse(row.payload)
  assert.deepEqual(payload.ownerGuidanceApplicability.garment.footwear, ['sandals'])
  assert.deepEqual(payload.ownerGuidanceApplicability.context.activities, ['hiking'])
})

test('item 12 fast path only fires on an explicit durability marker, not any negated "wear" phrasing', async () => {
  // "always avoid wearing" is the other phrase in the controlled vocabulary; weaker phrasings
  // ("don't wear", "won't wear") are deliberately excluded — see the guardrail test above for why.
  const json = await postJson('/api/ai/ask', {
    question: 'I always avoid wearing wool in summer',
    pieces: [],
    history: [],
  })
  assert.equal(aiCalls.length, 0)
  const row = db.prepare("SELECT * FROM stylist_feedback WHERE note = 'I always avoid wearing wool in summer'").get()
  assert.ok(row)
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
  assert.match(lastCall.system, /never as a generic category checklist/)
})

test('StylistChat enables rough preview for rendered freeform outfit cards', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /const isTextOnlyPreviewSet = Boolean\(outfits\[0\]\?\.previewOnly\)/)
  assert.match(src, /const canGenerateComparison = !isTextOnlyPreviewSet && outfits\.length >= 2/)
  assert.match(src, /Preview all looks/)
})

test('affected Stylist flows expose shared rotation memory in the header and can reset it', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  const dockStart = src.indexOf('const renderComposerDock')
  const dockEnd = src.indexOf('const latestAssistantIndex', dockStart)
  const dock = src.slice(dockStart, dockEnd)
  assert.doesNotMatch(dock, /RotationMemoryControl/)
  assert.match(src, /const activeFlowUsesRotationMemory = Boolean\(/)
  assert.match(src, /const isUnresolvedNewChat = messages\.length === 1 && !activeContext && !pendingPiece && !pendingOutfit/)
  assert.match(src, /isUnresolvedNewChat \|\|/)
  assert.match(src, /wardrobeBuilderOpen \|\|/)
  assert.match(src, /pendingOutfitAction === 'similar'/)
  assert.match(src, /latestResultUsesRotationMemory/)
  assert.match(src, /<RotationMemoryControl \/>/)
  assert.match(src, /if \(!activeFlowUsesRotationMemory \|\| !recentMemoryItemCount\) return null/)
  assert.match(src, /fetch\('\/api\/ai\/whole-wardrobe-session-memory', \{ method: 'DELETE' \}\)/)
  assert.match(src, /recent pieces are deprioritized/i)
  assert.match(src, /Include all pieces again/)
  assert.match(src, /triggerToast\('Recently used pieces are included again\.'\)/)
  assert.match(src, /requestAnimationFrame\(\(\) => textRef\.current\?\.focus\(\)\)/)
  assert.match(src, /replyWholeWardrobe \|\| Number\(replyDebug\?\.atomicMultiLookCalls\) > 0/)
  assert.match(src, /\[currentThreadId, refreshWholeWardrobeSessionMemory\]/)
  assert.ok((src.match(/sessionId: targetThreadId/g) || []).length >= 3, 'every freeform /ask branch identifies its thread to server-side state')
})

test('StylistChat uses outfit sketch instead of color balance on ideal direction cards', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /const renderOutfitSketch = \(outfit, \{ compact = false \} = \{\}\) =>/)
  assert.match(src, /showOutfitSketch && renderOutfitSketch\(outfit\)/)
  assert.match(src, /lower\.includes\('trouser'\)/)
  assert.match(src, /background_color: targetPiece\.background_color \|\| ''/)
  assert.match(src, /beige: '#d8c7aa'/)
  assert.match(src, /purple: '#5b3a67'/)
  assert.match(src, /new RegExp\(`\\\\b\$\{colorName\}\\\\b`\)\.test\(lower\)/)
  assert.match(src, /radial-gradient\(circle at 28% 32%/)
  assert.match(src, /const fillStyleFor = \(piece\) => \(\{ background: swatchFor\(piece\) \}\)/)
  assert.ok(src.includes("const isShorts = /\\b(short|shorts|bermuda)\\b/.test(bottomName)"))
  assert.ok(src.includes("const isCroppedPant = /\\b(cropped|crop|ankle|capri|culotte|culottes)\\b/.test(bottomName)"))
  assert.match(src, /const pantHeight = isShorts \? 17 : \(isCroppedPant \? 29 : 38\)/)
  assert.ok(src.includes("const skirtHeight = /\\b(maxi|full-length)\\b/.test(bottomName)"))
  assert.doesNotMatch(src, /resolveUploadImageSrc\(piece\.worn_photo \|\| piece\.photo\)/)
  assert.doesNotMatch(src, /resolveUploadImageSrc\(piece\.photo\)/)
  assert.doesNotMatch(src, /backgroundImage: `url\("\$\{photoSrc\}"\)`/)
  assert.doesNotMatch(src, /Color balance/)
  assert.doesNotMatch(src, /renderColorBalanceBar/)
})

test('StylistChat routes Similar to wardrobe formula cards and offers adjacent follow-up', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /'\/api\/ai\/generate-saved-outfit-variants'/)
  assert.match(src, /savedOutfitVariantMode === 'creative'/)
  assert.match(src, /outfitToSend\.variantMode === 'adjacent' \? 'adjacent' : 'formula'/)
  assert.match(src, /Explore adjacent outfits/)
  assert.match(src, /continueThread: true/)
  assert.match(src, /variantMode: 'formula'/)
})

test('StylistChat surfaces visual composer usage cost in outfit cards', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /const composerUsageSummary/)
  assert.match(src, /message\?\.debug\?\.composerUsage/)
  assert.match(src, /MessageTelemetryDisclosure/)
  assert.match(src, /rows\.push\(\['Composer', composerUsageSummary\(composerUsage\)\]\)/)
  assert.match(src, /replyDebug = data\.debug \|\| null/)
})

test('StylistChat whole-wardrobe builder defaults to empty mood', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /const \[wardrobeOutfitMood, setWardrobeOutfitMood\] = useState\(''\)/)
  assert.match(src, /const mood = wardrobeOutfitMood\.trim\(\)/)
  assert.doesNotMatch(src, /wardrobeOutfitMood \|\| 'artistic minimalist'/)
  assert.doesNotMatch(src, /m\.queryOptions\.mood !== 'artistic minimalist'/)
})

test('StylistChat preserves generated board image urls for critique previews', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /const resolveUploadImageSrc/)
  assert.ok(src.includes("value.replace(/^\\/uploads\\/+uploads\\//, '/uploads/')"))
  assert.match(src, /\^\(https\?:\\\/\\\/\|data:\|blob:\|\\\/uploads\\\/\)/)
  assert.match(src, /const uploadsIndex = value\.indexOf\('\/uploads\/'\)/)
  assert.match(src, /value\.startsWith\('generated-boards\/'\)/)
  assert.match(src, /displayPrev = resolveUploadImageSrc\(outfitToSend\.photo\)/)
  assert.match(src, /const messageImageSrc = resolveUploadImageSrc\(m\.imagePrev\)/)
  // Intent: the pending photo goes through the URL resolver, never used raw. Tolerant of the
  // null-guard the expression has since grown (`pendingPhoto ? resolve... : null`).
  assert.match(src, /const pendingPhotoSrc = [^\n]*resolveUploadImageSrc\(pendingPhoto\)/)
  assert.match(src, /src: resolveUploadImageSrc\(board\.imageUrl\)/)
  assert.doesNotMatch(src, /displayPrev = `\\\/uploads\\\/\$\{outfitToSend\.photo\}`/)
  assert.doesNotMatch(src, /<img src=\{m\.imagePrev\}/)
  assert.doesNotMatch(src, /src=\{`\\\/uploads\\\/\$\{pendingPhoto\}`\}/)
})

test('StylistChat pending garment action hides the generic chat input', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  const css = fs.readFileSync(path.join(process.cwd(), 'src/App.css'), 'utf8')
  assert.match(src, /stylist-chat-scroll .*\$\{pending \? 'has-pending-action' : ''\}/)
  assert.match(src, /stylist-input-shell \$\{pending \? 'is-hidden-for-pending-action' : ''\}/)
  assert.match(src, /\{!pending && \(/)
  assert.match(css, /\.stylist-chat-scroll\.has-pending-action/)
  assert.match(css, /\.stylist-input-shell\.is-hidden-for-pending-action/)
})

test('StylistChat new-chat empty state prioritizes the freeform composer', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  const css = fs.readFileSync(path.join(process.cwd(), 'src/App.css'), 'utf8')
  assert.match(src, /const renderComposerDock = \(extraClassName = ''\) =>/)
  assert.match(src, /className="stylist-empty-state"/)
  assert.match(src, /<StylistLandingPanel[\s\S]*variant="plain"[\s\S]*className="stylist-empty-state"/)
  assert.match(src, /Ask anything about your wardrobe/)
  assert.match(src, /Ask for styling advice, explore your saved pieces, or share an outfit photo\./)
  assert.match(src, /renderComposerDock\('is-empty-state'\)[\s\S]*className="stylist-suggestion-section"/)
  assert.match(src, /className="stylist-suggestion-btn"/)
  assert.match(src, /className="stylist-suggestion-label"/)
  assert.match(src, /className="stylist-suggestion-arrow"/)
  assert.match(src, /const suppressNextMessageScrollRef = useRef\(false\)/)
  assert.match(src, /suppressNextMessageScrollRef\.current = true/)
  assert.match(src, /if \(suppressNextMessageScrollRef\.current\)/)
  // Intent: the message list renders only past the greeting, so the empty state is the composer.
  // The list is now windowed (messages.slice(visibleMessageStart)), which is why this is tolerant
  // of the slice and of the map's parameter names.
  assert.match(src, /\{messages\.length > 1 && messages\.slice\([^)]*\)\.map\(/)
  assert.match(src, /\{messages\.length > 1 && renderComposerDock\(\)\}/)
  assert.match(src, /messages\.length > 1 \? 'is-existing-chat' : 'is-empty-chat'/)
  assert.match(css, /\.stylist-empty-intro h2/)
  assert.match(css, /\.stylist-entry-layout[\s\S]*width: min\(calc\(100% - 48px\), 920px\)/)
  assert.match(css, /\.stylist-entry-layout[\s\S]*margin: 56px auto 24px/)
  assert.match(css, /\.stylist-empty-intro h2[\s\S]*font-size: clamp\(23px, 3vw, 30px\)/)
  assert.match(css, /\.stylist-chat-scroll\.is-existing-chat[\s\S]*padding-top: 28px/)
  assert.match(css, /\.stylist-chat-scroll\.is-empty-chat[\s\S]*padding-inline: 0/)
  assert.match(css, /\.stylist-suggestion-btn:hover/)
  assert.match(css, /\.stylist-suggestion-list[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.stylist-suggestion-btn:hover \.stylist-suggestion-arrow[\s\S]*transform: translateX\(2px\)/)
  assert.match(css, /\.stylist-suggestion-btn:focus-visible/)
  assert.match(css, /\.thread-summary-text[\s\S]*color: color-mix\(in srgb, var\(--text-muted\) 84%, var\(--text\)\)/)
  assert.match(css, /\.stylist-composer-dock\.is-empty-state/)
  assert.match(css, /\.stylist-entry-layout--plain/)
  assert.match(src, /className="composer-outfit-pathway"/)
  assert.match(src, /Create outfits from my wardrobe/)
  assert.match(src, /className=\{`wardrobe-builder-entry \$\{compact \? 'is-compact' : ''\}`\.trim\(\)\}/)
  assert.match(src, /<div className="piece-styling-eyebrow">Visual composer<\/div>/)
  assert.match(src, /<WardrobeComposerIcon \/>/)
  assert.match(src, /\{pieces\.length\} pieces available in your wardrobe/)
  assert.match(src, /sectionLabel="Shape the brief"/)
  assert.match(src, /className=\{label === selectedStyleDirectionLabel \? 'is-selected' : ''\}/)
  assert.equal((src.match(/className="style-direction-tooltip"/g) || []).length, 2)
  assert.match(css, /\.style-direction-tooltip \.info-tooltip-popover/)
  assert.doesNotMatch(css, /\.wardrobe-builder-entry \.info-tooltip-popover/)
  assert.doesNotMatch(css, /\.piece-styling-workflow \.info-tooltip-popover/)
  assert.match(src, /className="wardrobe-builder-direction-help"/)
  assert.match(src, /<textarea[\s\S]*placeholder="e\.g\. more everyday, less dressy, good for travel"/)
  assert.match(src, /className="outfit-styling-workflow"/)
  assert.match(src, /className="outfit-styling-entry"/)
  assert.match(src, /<div className="piece-styling-eyebrow">Outfit styling<\/div>/)
  // Intent: the outfit action is labelled for hover/assistive tech. The title is now conditional
  // on a loading state ("Reviewing…" while in flight), so match the resting label wherever it sits.
  assert.match(src, /title=\{[^}]*'Review this outfit'\}|title="Review this outfit"/)
  // Same conditional-title change as "Review this outfit" above (loading state added).
  assert.match(src, /title=\{[^}]*'Find similar looks'\}|title="Find similar looks"/)
  assert.match(src, /className="outfit-question-shell"/)
  assert.doesNotMatch(src, /accent\s+title="Critique outfit"/)
  assert.match(css, /\.outfit-styling-options[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(src, /messages\.length === 1 && !pending && wardrobeBuilderOpen && renderWardrobeBuilderPanel\(\)/)
  assert.match(src, /renderWardrobeBuilderPanel\(\{ compact: true \}\)/)
  assert.match(css, /\.wardrobe-builder-entry \.stylist-landing-header/)
  assert.match(css, /\.wardrobe-builder-entry \.stylist-landing-footer/)
  assert.match(css, /\.composer-outfit-pathway[\s\S]*grid-template-columns: 30px minmax\(0, 1fr\) 20px/)
  assert.match(css, /\.stylist-composer-dock\.is-empty-state \.composer-outfit-pathway/)
  assert.match(css, /\.stylist-chat-main \.view-header[\s\S]*padding-top: 16px/)
})

test('Stylist route disables page scroll so chat history owns its own scroll pane', () => {
  const app = fs.readFileSync(path.join(process.cwd(), 'src/App.jsx'), 'utf8')
  const askClaude = fs.readFileSync(path.join(process.cwd(), 'src/views/AskClaude.jsx'), 'utf8')
  const css = fs.readFileSync(path.join(process.cwd(), 'src/App.css'), 'utf8')
  assert.match(app, /useLocation/)
  assert.match(app, /isStylistRoute/)
  assert.match(app, /app-main\$\{isStylistRoute \? ' stylist-app-main' : ''\}/)
  assert.match(askClaude, /minHeight:\s*0/)
  assert.match(css, /\.app-main\.stylist-app-main\s*\{[\s\S]*overflow:\s*hidden/)
  assert.match(css, /\.stylist-chat-scroll\s*\{[\s\S]*overflow-y:\s*auto/)
  assert.match(css, /\.stylist-chat-main\s*\{[\s\S]*display:\s*grid/)
  assert.match(css, /\.stylist-chat-scroll\s*\{[\s\S]*max-height:/)
  assert.doesNotMatch(css, /\.stylist-chat-scroll\s*\{[^}]*flex:\s*1/)
  assert.doesNotMatch(css, /\.stylist-input-shell\s*\{[^}]*position:\s*sticky/)
})

test('Primary app navigation uses full-row accessible sidebar items with shared task count', () => {
  const app = fs.readFileSync(path.join(process.cwd(), 'src/App.jsx'), 'utf8')
  const inventory = fs.readFileSync(path.join(process.cwd(), 'src/views/PieceInventory.jsx'), 'utf8')
  const css = fs.readFileSync(path.join(process.cwd(), 'src/App.css'), 'utf8')
  const hook = fs.readFileSync(path.join(process.cwd(), 'src/utils/usePendingWardrobeTaskCount.js'), 'utf8')
  assert.match(app, /<nav className="primary-nav" aria-label="Primary">/)
  assert.match(app, /<ul className="primary-nav__list">/)
  assert.match(app, /`primary-nav__item\$\{isActive \? ' active' : ''\}`/)
  assert.match(app, /aria-label=\{`\$\{badgeCount\} wardrobe \$\{badgeCount === 1 \? 'task' : 'tasks'\}`\}/)
  assert.match(app, /badgeCount > 99 \? '99\+' : String\(badgeCount\)/)
  assert.match(app, /usePendingWardrobeTaskCount/)
  assert.match(inventory, /usePendingWardrobeTaskCount/)
  assert.match(hook, /window\.addEventListener\('todos-changed', refreshPendingCount\)/)
  // Intent: the active nav item is visually marked, not conveyed by text alone. The marker was a
  // ::before bar; it is now an accent colour + tinted background + border on the item itself.
  assert.match(css, /\.primary-nav__item\.active\s*\{[\s\S]*?background:\s*var\(--accent-light\)[\s\S]*?border-color:/)
  assert.match(css, /\.primary-nav__item:focus-visible/)
  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1040px\)/)
  assert.doesNotMatch(app, /icon:\s*'◈'|icon:\s*'✦'|icon:\s*'◇'|icon:\s*'⌾'/)
  assert.doesNotMatch(app, /className="bottom-nav"/)
})

test('Wardrobe page keeps primary filters visible and collapses color and fabric controls', () => {
  const inventory = fs.readFileSync(path.join(process.cwd(), 'src/views/PieceInventory.jsx'), 'utf8')
  const pieceCard = fs.readFileSync(path.join(process.cwd(), 'src/components/PieceCard.jsx'), 'utf8')
  const css = fs.readFileSync(path.join(process.cwd(), 'src/App.css'), 'utf8')
  // Intent: the category filters are a labelled row, visible (not collapsed behind a menu). The
  // className became a template literal carrying an open-menu modifier; the labelled row is intact.
  assert.match(inventory, /className=(?:"filter-row"|\{`filter-row[^`]*`\}) aria-label="Wardrobe categories"/)
  assert.doesNotMatch(inventory, /className="wardrobe-filter-label">Category/)
  assert.match(inventory, /filterOcc \? `Occasion: \$\{occasionLabel\}` : 'Occasion'/)
  assert.match(inventory, /filterSeason \? `Season: \$\{seasonLabel\}` : 'Season'/)
  // Intent: colour is one of the collapsed filter controls, carrying the current selection.
  // The bespoke chip list + `Color: ${filterColor}` label were replaced by the shared
  // ColorFamilyFilter (family -> exact shade), per docs/wardrobe-color-controls-spec.md.
  // filterColor remains the exact-shade state it reads.
  assert.match(inventory, /<ColorFamilyFilter/)
  assert.match(inventory, /valueColor=\{filterColor\}/)
  assert.match(inventory, /valueFamily=\{activeColorFamily\}/)
  assert.match(inventory, /filterFabric \? `Fabric: \$\{filterFabric\}` : 'Fabric'/)
  assert.match(inventory, /className="filter-menu-chevron"/)
  // The three assertions that used to pin the bespoke colour chip list markup
  // (.wardrobe-color-list / .wardrobe-color-name / the "Any color" reset) now live with the
  // shared component in test/outfitLookbook.test.js — the markup moved there wholesale.
  assert.match(inventory, /import \{ ColorFamilyFilter \} from '\.\.\/components\/ColorSelector'/)
  assert.match(inventory, /className="wardrobe-sort-info"/)
  assert.match(inventory, /className="wardrobe-fabric-search"/)
  assert.match(inventory, /document\.addEventListener\('pointerdown', handlePointerDown\)/)
  assert.match(inventory, /event\.key === 'Escape'/)
  assert.match(inventory, /aria-hidden="true">✓<\/span>/)
  assert.match(inventory, /activeCompactFilters/)
  assert.match(inventory, /className="active-filter-chip"/)
  assert.match(inventory, /Clear all/)
  assert.match(inventory, /aria-label="Show favorite pieces"/)
  assert.match(inventory, /title="Show favorite pieces"/)
  assert.match(inventory, /className="chip wardrobe-add-piece wardrobe-add-menu-trigger"[\s\S]*Add pieces/)
  assert.doesNotMatch(inventory, />Colors:<\/span>/)
  assert.doesNotMatch(inventory, />Fabrics:<\/span>/)
  assert.match(pieceCard, /type="button"[\s\S]*className="piece-card-hit"/)
  assert.match(pieceCard, /aria-label=\{`Open \$\{piece\.name\} wardrobe card`\}/)
  assert.match(pieceCard, /className=\{`piece-photo-stage is-\$\{photoOrientation\}`\}/)
  assert.match(pieceCard, /naturalHeight > naturalWidth \* 1\.08 \? 'portrait' : 'landscape'/)
  // Grid cards deliberately omit the category pill (redundant under category
  // filters) and the "Needs worn photo" nag (lives in the Tasks surface).
  assert.doesNotMatch(pieceCard, /className="piece-card-category"/)
  assert.match(pieceCard, /className="piece-card-swatches"/)
  assert.doesNotMatch(pieceCard, /className="piece-card-status"/)
  assert.match(pieceCard, /aria-pressed=\{Boolean\(piece\.favorite\)\}/)
  assert.doesNotMatch(pieceCard, /className="piece-card-id"/)
  assert.match(css, /\.wardrobe-filter-group/)
  assert.match(css, /\.wardrobe-color-popover/)
  assert.match(css, /\.wardrobe-filter-menu \.filter-menu-btn[\s\S]*width: 132px/)
  assert.match(css, /\.wardrobe-fabric-search-shell[\s\S]*position: sticky/)
  assert.match(css, /\.wardrobe-fabric-popover[\s\S]*overflow-y: auto/)
  assert.match(css, /\.wardrobe-add-piece[\s\S]*background: var\(--accent\)/)
  assert.match(css, /\.wardrobe-mobile-fab[\s\S]*display: none/)
  assert.match(css, /\.chip:focus-visible/)
  assert.doesNotMatch(css, /\.chip:focus(?!-visible)/)
})

test('Opened garment modal uses grouped metadata and updated detail hierarchy', () => {
  const detail = fs.readFileSync(path.join(process.cwd(), 'src/components/PieceDetail.jsx'), 'utf8')
  const css = fs.readFileSync(path.join(process.cwd(), 'src/App.css'), 'utf8')
  assert.match(detail, /className="garment-detail-close"/)
  assert.match(detail, /aria-label="Close garment detail"/)
  assert.match(detail, /aria-labelledby="garment-detail-title"/)
  assert.doesNotMatch(detail, /<div className="modal-handle" \/>/)
  assert.match(detail, /className="garment-photo-toggle"/)
  assert.match(detail, /aria-pressed=\{photoTab === tab\}/)
  assert.match(detail, /id="garment-detail-title"/)
  assert.match(detail, /#\{piece\.id\} · \{formattedCategory\}/)
  assert.match(detail, />Colors<\/div>/)
  assert.match(detail, />Best for<\/div>/)
  assert.match(detail, />Season<\/div>/)
  assert.match(detail, /piece\.colors\?\.length \? piece\.colors\.join\(' · '\) : 'Not set'/)
  assert.match(detail, /Generated outfits · \{savedBoards\.length\}/)
  assert.match(detail, /const visibleSavedBoards = showAllBoards \? savedBoards : savedBoards\.slice\(0, 4\)/)
  assert.match(detail, /const remainingSavedBoards = savedBoards\.length - visibleSavedBoards\.length/)
  assert.match(detail, /className="garment-relation-more"/)
  assert.match(detail, /aria-label=\{`Show \$\{remainingSavedBoards\} more generated outfits`\}/)
  assert.match(detail, /title=\{title\}/)
  assert.match(detail, /Linked outfits · \{outfits\.length\}/)
  assert.match(detail, />\s*Linked outfits\s*<\/div>/)
  assert.match(detail, /Not linked to any outfits yet/)
  assert.match(detail, /className="garment-ask-stylist"/)
  assert.match(detail, /className="garment-relation-tile saved-board-tile"/)
  assert.match(css, /\.garment-detail-close/)
  assert.match(css, /\.garment-meta-groups/)
  assert.match(css, /\.detail-notes[\s\S]*font-style: normal/)
  assert.match(css, /\.garment-relation-tile:focus-visible/)
  assert.match(css, /\.garment-relation-more/)
  assert.match(css, /\.garment-link-status[\s\S]*line-height: 1\.45/)
  assert.match(css, /\.garment-ask-stylist/)
})

test('StylistChat renders wardrobe evaluation replies in the chat thread', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.doesNotMatch(src, /if \(m\.wardrobeEvaluation \|\| m\.contextName === 'Whole wardrobe evaluation'\) \{\s*return null\s*\}/)
  assert.match(src, /if \(m\.role === 'assistant' && m\.wardrobeEvaluation && m\.evaluationResponseMode !== 'followup'\)/)
  assert.match(src, /<details open=\{true\}>/)
  assert.match(src, /<span>Outfit critique<\/span>/)
  assert.match(src, /<strong>\{m\.outfitName \|\| 'Generated outfit'\}<\/strong>/)
  assert.match(src, /const isEvaluationFollowup = \(overrides\.responseMode \|\| 'full'\) === 'followup'/)
  assert.match(src, /isEvaluationFollowup\s*\?\s*\(threadMemory\?\.latestEvaluation \|\| null\)/)
  assert.match(src, /isEvaluationFollowup\s*\?\s*priorEvaluationText/)
  assert.match(src, /rows\.push\(\['Critique', composerUsageSummary\(critiqueUsage\)\]\)/)
  assert.match(src, /shared in-flight request/)
  assert.match(src, /exact-result hit/)
})

test('StylistChat scopes rendered wardrobe boards to each generation result', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /const createResultId = \(prefix = 'result'\)/)
  assert.match(src, /const resultId = createResultId\('whole-wardrobe'\)/)
  assert.match(src, /resultId,\s*\n\s*structuredOutfits: replyStructuredOutfits/)
  assert.match(src, /const messageResultKey = message\?\.resultId \|\| messageIndex/)
  assert.match(src, /const boardKey = `\$\{messageResultKey\}:\$\{idx\}`/)
  assert.match(src, /const comparisonKey = `whole-wardrobe-comparison:\$\{messageResultKey\}`/)
  assert.match(src, /const idealComparisonKey = `ideal-additions-comparison:\$\{messageResultKey\}`/)
  assert.doesNotMatch(src, /const boardKey = `\$\{messageIndex\}:\$\{idx\}`/)
})

test('StylistChat does not show duplicate image and evaluation buttons on whole-wardrobe cards', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /const canRenderStructuredOutfit = isPreview[\s\S]*: !message\?\.wholeWardrobe && !message\?\.wardrobeEvaluation && hasRenderableOutfitPieces/)
  assert.match(src, /\(message\?\.wholeWardrobe \|\| \(activeContext\?\.type !== 'piece'/)
})

test('StylistChat visibly marks broken diagnostic local-fill cards with a plain-language disclaimer', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /const isBrokenCard = Boolean\(outfit\.broken \|\| outfit\.diagnosticOnly\)/)
  assert.match(src, /const brokenReasonRows = Array\.isArray\(outfit\.brokenPieces\)/)
  assert.match(src, /didn't clear one of the engine's structural checks, so it's shown here for review/)
  assert.match(src, /isBrokenCard \? 'needs review'/)
})

test('StylistChat gates raw engine internals behind the STYLIST_DEBUG_ENABLED dev flag', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /const STYLIST_DEBUG_ENABLED = import\.meta\.env\.VITE_STYLIST_DEBUG === 'true'/)
  // The specific rejection reason (piece name + short plain-language reason, e.g. "brown ankle
  // boots: hot weather: insulating fiber") is unconditionally visible — it's what makes the
  // "needs review" disclaimer useful for tuning, not raw internals, so it isn't dev-gated.
  assert.match(src, /\{isBrokenCard && \(/)
  assert.match(src, /What didn't clear:/)
  assert.doesNotMatch(src, /Dev: rejected reason:/)
  // resolutionNote (a separate, less common field) stays dev-only.
  assert.match(src, /isBrokenCard && STYLIST_DEBUG_ENABLED && outfit\.resolutionNote/)
  assert.match(src, /Dev: resolution note:/)
  assert.match(src, /isBrokenCard && STYLIST_DEBUG_ENABLED && brokenReasonRows\.length > 0/)
  assert.match(src, /Dev: rejected pieces:/)
  assert.match(src, /if \(!STYLIST_DEBUG_ENABLED\) return null/)
  assert.doesNotMatch(src, /`\$\{cat\}s: \$\{cnt\}`/)
})

// Owner ruling 2026-07-28: a rejected capsule look is shown as a "needs review"
// card and fixed in place. The rejection already names the blocked garment and
// the saved plan context already holds the slot's gate-passing roster, so the
// repair is a deterministic substitution — it must cost nothing, and it must
// never quietly fall back to a billed guess.
test('capsule look repair swaps the blocked piece from the saved roster with no model call', async () => {
  // Uses only seeded pieces: inserting one mid-run mutates the shared wardrobe
  // while other async subtests in this file are mid-flight, which is how this
  // test first broke two unrelated evaluator tests. And it deliberately does
  // NOT touch globalThis.__WARDROBE_AI_TEST_HANDLER__: the
  // repair route makes no model call, and async subtests in this file interleave,
  // so reassigning the shared handler clobbers whichever test is mid-flight.
  // debug.providerCalls is the assertion that matters anyway.
  const planContext = {
    version: 1,
    piece_budget: 10,
    capacity: 4,
    roster_ids: [seeded.top, seeded.bottom, seeded.shoe, seeded.boot],
    is_winter_capsule: false,
    slots: [{
      id: 'casual_indoors',
      label: 'Casual Indoors',
      occasion: 'casual',
      activity: 'none',
      environment: 'indoor',
      register: '',
      weather_label: 'indoor',
      weather_profile: {},
      allowed_piece_ids: [seeded.top, seeded.bottom, seeded.shoe, seeded.boot],
    }],
  }
  const data = await postJson('/api/ai/repair-capsule-look', {
    planContext,
    slotId: 'casual_indoors',
    title: 'Museum Day',
    pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
    blockedPieceIds: [seeded.shoe],
    existingOutfits: [],
  })

  assert.equal(data.debug.providerCalls, 0, 'repairing a look must not call a model')
  assert.equal(data.structuredOutfits.length, 1)
  assert.deepEqual(
    data.structuredOutfits[0].pieceIds,
    [seeded.top, seeded.bottom, seeded.boot],
    'only the blocked garment is replaced; the rest of the look is preserved'
  )
  assert.equal(data.repairedPieceId, seeded.shoe)
  assert.match(data.answer, /swapped/i)
})

// Live failure (thread_1785348988259): a dinner look was submitted with no shoes
// at all. Every substitution failed — you cannot swap a piece that isn't there —
// and the endpoint then told the person "the pieces it would need are not in
// this capsule" while five eligible shoes sat in that slot's roster. A look can
// fail for a piece that is WRONG or one that is ABSENT; repair must handle both.
test('capsule look repair completes a look that is missing a required piece', async () => {
  const planContext = {
    version: 1,
    piece_budget: 10,
    capacity: 4,
    roster_ids: [seeded.top, seeded.bottom, seeded.shoe],
    is_winter_capsule: false,
    slots: [{
      id: 'casual_indoors',
      label: 'Casual Indoors',
      occasion: 'casual',
      activity: 'none',
      environment: 'indoor',
      register: '',
      weather_label: 'indoor',
      weather_profile: {},
      allowed_piece_ids: [seeded.top, seeded.bottom, seeded.shoe],
    }],
  }
  const data = await postJson('/api/ai/repair-capsule-look', {
    planContext,
    slotId: 'casual_indoors',
    title: 'Shoeless attempt',
    // No shoes — exactly what the composer submitted live.
    pieceIds: [seeded.top, seeded.bottom],
    blockedPieceIds: [],
    existingOutfits: [],
  })

  assert.equal(data.debug.providerCalls, 0, 'completing a look must not call a model either')
  assert.deepEqual(
    data.structuredOutfits[0].pieceIds,
    [seeded.top, seeded.bottom, seeded.shoe],
    'the missing piece is added rather than the look being declared unfixable'
  )
  assert.match(data.answer, /added/i)
  assert.match(data.structuredOutfits[0].engineNote, /missing shoes/i)
})

test('capsule look repair reports honestly when the roster cannot fix the look', async () => {
  const planContext = {
    version: 1,
    piece_budget: 10,
    capacity: 1,
    roster_ids: [seeded.top, seeded.bottom, seeded.shoe],
    is_winter_capsule: false,
    slots: [{
      id: 'casual_indoors',
      label: 'Casual Indoors',
      occasion: 'casual',
      activity: 'none',
      environment: 'indoor',
      register: '',
      weather_label: 'indoor',
      weather_profile: {},
      allowed_piece_ids: [seeded.top, seeded.bottom, seeded.shoe],
    }],
  }
  const response = await fetch(`${baseUrl}/api/ai/repair-capsule-look`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      planContext,
      slotId: 'casual_indoors',
      pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
      blockedPieceIds: [seeded.shoe],
      existingOutfits: [],
    }),
  })
  const body = await response.json()

  assert.equal(response.status, 409)
  assert.match(body.error, /not in this capsule/i)
  assert.equal(body.debug.providerCalls, 0, 'an unfixable look must not escalate to a billed guess')
  assert.equal(body.debug.recoveryShortfall.code, 'recovery_shortfall')
  assert.equal(body.debug.recoveryShortfall.operation, 'substitute')
  assert.equal(body.debug.recoveryShortfall.reason, 'capsule_roster_exhausted')
})

test('capsule expansion uses one bounded model call, the saved roster, and the saved indoor slot context', async () => {
  const alternateTop = insertPiece({
    name: 'navy stripe mock neck top',
    category: 'top',
    colors: ['navy', 'cream'],
    occasions: ['casual'],
    photo: seeded.photos.top,
    reads_as: 'quiet striped mock neck top',
    silhouette: 'fitted',
    fabric_weight: 'medium',
    formality: 'casual',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  let expansionCalls = 0
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    expansionCalls += 1
    assert.match(system, /selecting ONE additional outfit for an existing capsule wardrobe/)
    const promptText = String(messages?.[0]?.content || '')
    assert.match(promptText, /environment: indoor/)
    assert.match(promptText, /weather already resolved: indoor/)
    assert.match(promptText, new RegExp(`\\b${alternateTop}\\b`))
    return {
      title: 'Stripe & Charcoal',
      piece_ids: [alternateTop, seeded.bottom, seeded.shoe],
      reason: 'The compact stripe gives the quiet wide-leg trousers a clear focal line.',
    }
  }

  const planContext = {
    version: 1,
    piece_budget: 10,
    capacity: 4,
    roster_ids: [seeded.top, alternateTop, seeded.bottom, seeded.shoe],
    is_winter_capsule: false,
    slots: [{
      id: 'casual_indoors',
      label: 'Casual Indoors',
      occasion: 'casual',
      activity: 'none',
      environment: 'indoor',
      register: '',
      weather_label: 'indoor',
      weather_profile: {},
      allowed_piece_ids: [seeded.top, alternateTop, seeded.bottom, seeded.shoe],
    }],
  }
  const data = await postJson('/api/ai/expand-capsule', {
    planContext,
    slotId: 'casual_indoors',
    slotLabel: 'Casual Indoors',
    existingOutfits: [{
      title: 'Existing casual look',
      tripSlot: 'casual_indoors',
      pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
    }],
  })

  assert.equal(expansionCalls, 1, 'capsule expansion must not enter a multi-iteration tool loop')
  assert.equal(data.debug.providerCalls, 1)
  assert.equal(data.structuredOutfits.length, 1)
  assert.deepEqual(data.structuredOutfits[0].pieceIds, [alternateTop, seeded.bottom, seeded.shoe])
  assert.equal(data.structuredOutfits[0].tripSlot, 'casual_indoors')
  assert.deepEqual(data.structuredOutfits[0].capsulePlanContext, planContext)
})

test('capsule expansion stops after one invalid composition instead of silently retrying', async () => {
  const alternateTop = insertPiece({
    name: 'alternate casual knit',
    category: 'top',
    occasions: ['casual'],
    photo: seeded.photos.top,
    formality: 'casual',
  })
  let expansionCalls = 0
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => {
    expansionCalls += 1
    return {
      title: 'Repeated core',
      piece_ids: [seeded.top, seeded.bottom, seeded.shoe],
      reason: 'This deliberately repeats the existing core.',
    }
  }
  const planContext = {
    version: 1,
    piece_budget: 10,
    capacity: 4,
    roster_ids: [seeded.top, alternateTop, seeded.bottom, seeded.shoe],
    is_winter_capsule: false,
    slots: [{
      id: 'casual_indoors',
      label: 'Casual Indoors',
      occasion: 'casual',
      activity: 'none',
      environment: 'indoor',
      register: '',
      weather_label: 'indoor',
      weather_profile: {},
      allowed_piece_ids: [seeded.top, alternateTop, seeded.bottom, seeded.shoe],
    }],
  }
  const response = await fetch(`${baseUrl}/api/ai/expand-capsule`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      planContext,
      slotId: 'casual_indoors',
      existingOutfits: [{
        title: 'Existing casual look',
        tripSlot: 'casual_indoors',
        pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
      }],
    }),
  })
  const data = await response.json()

  assert.equal(response.status, 422)
  assert.equal(expansionCalls, 1)
  assert.equal(data.debug.providerCalls, 1)
  assert.match(data.error, /No automatic retry was made/)
  assert.ok(data.validationFailures.length > 0)
})

test('capsule expansion stops for free when the saved slot has no unused core', async () => {
  let expansionCalls = 0
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => {
    expansionCalls += 1
    return { title: 'Should never run', piece_ids: [], reason: '' }
  }
  const response = await fetch(`${baseUrl}/api/ai/expand-capsule`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      planContext: {
        version: 1,
        piece_budget: 10,
        roster_ids: [seeded.top, seeded.bottom, seeded.shoe],
        slots: [{
          id: 'casual_indoors',
          label: 'Casual Indoors',
          occasion: 'casual',
          activity: 'none',
          environment: 'indoor',
          core_capacity: 1,
          allowed_piece_ids: [seeded.top, seeded.bottom, seeded.shoe],
        }],
      },
      slotId: 'casual_indoors',
      existingOutfits: [{
        title: 'Only available core',
        tripSlot: 'casual_indoors',
        pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
      }],
    }),
  })
  const data = await response.json()

  assert.equal(response.status, 409)
  assert.equal(expansionCalls, 0)
  assert.equal(data.debug.providerCalls, 0)
  assert.match(data.error, /Full available rotation shown/)
})

test('capsule expansion uses provider-enforced structured output rather than prose JSON prompting', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const providerSrc = fs.readFileSync(path.join(process.cwd(), 'styling-engine/provider.js'), 'utf8')

  assert.match(routeSrc, /askStylistStructuredWithUsage\(\{/)
  assert.match(routeSrc, /schema: CAPSULE_EXPANSION_SCHEMA/)
  assert.doesNotMatch(routeSrc, /parseModelJson\(text, \{ context: 'capsule expansion'/)
  assert.match(providerSrc, /response_format:\s*\{\s*type: 'json_schema'/)
  assert.match(providerSrc, /tool_choice: \{ type: 'tool', name \}/)
  assert.match(providerSrc, /block\?\.type === 'tool_use' && block\?\.name === name/)
})

// Spec §3 stage 2. Two things must hold before this can ever be switched on:
// with the flag off nothing changes at all, and with it on the model's roster
// Spec §3 stage 2 — model capsule roster selection is default ON and gated by the bench.
test('model capsule roster selection is default ON and gated by the bench', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const plannerSrc = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitSetPlanner.js'), 'utf8')

  assert.match(routeSrc, /WARDROBE_MODEL_CAPSULE_ROSTER/)
  assert.match(routeSrc, /if \(modelCapsuleRosterEnabled\(\)\)[\s\S]{0,80}toolContext\.chooseCapsuleRoster =/)

  // The model chooses from the bench and nothing else, and the schema pins the
  // roster size rather than letting a short answer through.
  assert.match(routeSrc, /choose ONLY from the candidate list/i)
  assert.match(routeSrc, /roster_piece_ids: \{ type: 'array', items: \{ type: 'integer' \}, minItems: exact, maxItems: exact, uniqueItems: true \}/)
  assert.match(routeSrc, /prepareWardrobeThumb\(filePath, `capsule-roster:/)

  // One call, one repair, then the deterministic roster — never a third attempt.
  assert.match(plannerSrc, /bump\('capsuleRosterModelRepairs'\)/)
  assert.match(plannerSrc, /bump\('capsuleRosterModelFallbacks'\)/)
  assert.match(plannerSrc, /source: 'deterministic_fallback'/)
  // Validation before composition: a capacity-poor roster is a repairable fact,
  // not missing cards discovered afterwards.
  assert.match(plannerSrc, /const check = \(roster\) => validateCapsuleRoster\(/)
})

test('atomic capsule composition receives roster thumbnails and full authoritative garment truth', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')

  assert.match(routeSrc, /function capsulePlanCompositionSystemPrompt\(\)/)
  assert.match(routeSrc, /piece_catalog: truthCatalog\.length \? truthCatalog : workbench\.piece_catalog/)
  assert.match(routeSrc, /truthCatalog = rosterPieces\.map\(piece => `ID \$\{piece\.id\}: \$\{buildPieceText\(piece\)\}`\)/)
  assert.match(routeSrc, /prepareWardrobeThumb\(filePath, `capsule-plan:/)
  assert.match(routeSrc, /content\.push\(\{\s*type: 'image'/)
  assert.match(routeSrc, /toolContext\.visuallySeenPieceIds\.add\(id\)/)
  assert.match(routeSrc, /atomicCapsuleVisualPieces = visuallySeenIds\.length/)
})

test('StylistChat suppresses raw gate vocabulary on legacy stored diagnostic cards', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  // routes/ai.js no longer writes these fields, but thread payloads are durable and there is no
  // migration — cards stored before that fix still carry the raw rejection text, so the renderer
  // has to hold the line for old threads too.
  assert.match(src, /const stripEngineRejectionSuffix = \(reason\) =>/)
  assert.match(src, /\(?:Rejected\|Broken\)\\s\+because/)
  assert.match(src, /isBrokenCard && !STYLIST_DEBUG_ENABLED \? stripEngineRejectionSuffix\(outfit\.reason\)/)
  // watchFor and systemFlags are raw duplicates of the rejection reason on a broken card; the
  // plain-language "What didn't clear" disclaimer is what the owner ruling asked to show instead.
  assert.match(src, /outfit\.watchFor[\s\S]{0,120}\(!isBrokenCard \|\| STYLIST_DEBUG_ENABLED\)/)
  assert.match(src, /outfit\.systemFlags\)[\s\S]{0,80}\(!isBrokenCard \|\| STYLIST_DEBUG_ENABLED\)/)
  // the builder's own placeholder must not survive stripping and reach a regular user either
  assert.match(src, /'Model proposal shown for debugging\.'/)
})

test('StylistChat uses the visual capsule roster instead of repeating its text list', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /\^Piece roster \\\(\\d\+\\\):\/i\.test\(note\)/)
  assert.match(src, /className="stylist-capsule-piece-grid"/)
})

test('trip plan repeat label is derived from structured pieceReuse, not a keyword guess', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  // Both planner branches ("Repeat schedule: ..." and "no piece repeats across the N outfits")
  // contain the word "repeats", so the old /repeat|reuse|packing/ guess labelled a plan with zero
  // repeats "Useful repeats". outfitSetPlanner already attaches the structured answer.
  assert.match(src, /const pieceReuse = planOutfits\.find\(outfit => outfit\?\.pieceReuse\)\?\.pieceReuse/)
  assert.match(src, /pieceReuse\.repeated\) && pieceReuse\.repeated\.length/)
  assert.match(src, /'All looks distinct'/)
  assert.match(src, /addRow\(repeatLabelFor\(text\), value\)/)
  // the label must no longer be chosen by the regex ternary it replaced
  assert.doesNotMatch(src, /addRow\(\/packing\/i\.test\(text\) \? 'Packing' : 'Useful repeats', text\)/)
  // and the value must not restate the label it sits under
  assert.match(src, /\^\(\?:Repeat schedule\|Packing reuse\):/)
})

test('response look counts describe the whole response, not the collapsed slice', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  // `outfits` is truncated to INITIAL_SAVED_OUTFIT_COUNT while "Show N more outfit results" is
  // collapsed. Counting from it made the header's "N looks" change when the user expanded the
  // disclosure, and printed "2 LOOKS" above cards the server had badged "1 OF 3".
  assert.match(src, /buildStylistPresentation\(message, allOutfits, messageIndex\)/)
  assert.doesNotMatch(src, /buildStylistPresentation\(message, outfits, messageIndex\)/)
  assert.match(src, /buildResponseSections\(outfits, presentation, allOutfits\)/)
  // section counts come from the full set, falling back to rendered items when it isn't passed
  assert.match(src, /const fullCounts = new Map\(\)/)
  assert.match(src, /fullCounts\.get\(group\.title\.toLowerCase\(\)\) \|\| group\.items\.length/)
})

test('plan and whole-wardrobe responses still render the model\'s own prose answer', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  // Regression: these two response types rendered ONLY their structured cards. `isPreviewResponse`
  // is false for them (plan cards aren't previewOnly) and getCompactOutfitIntro() returns '' for
  // wholeWardrobe/plannedSet, so m.text reached no render branch at all — silently dropping the
  // declared constraint ("6 looks, 3 pairs of shoes"), the piece roster, the budget verdict, the
  // per-look rationale, and the levers for changing any of it.
  // Widened: the canned-intro case (selected-piece / generic outfit ideas) replaced the prose with
  // boilerplate rather than dropping it, so `!compactIntro` must NOT gate this — every structured
  // response except previewOnly (which renders m.text in full above) gets the notes disclosure.
  assert.match(src, /const structuredPlanNotes = hasStructuredIdeas \? getTripPlanNotes\(m\.structuredOutfits\) : \[\]/)
  assert.match(src, /structuredPlanNotes\.length > 0/)
  assert.match(src, /className="stylist-plan-notes-list"/)
  assert.match(src, /const planExpansionSuggestions = hasStructuredIdeas \? getPlanExpansionSuggestions\(m\.structuredOutfits\) : \[\]/)
  assert.match(src, /Showing \$\{trim\.shown\} of \$\{trim\.requested\} requested/)
  assert.match(src, /className="stylist-plan-expansion-actions"/)
  assert.match(src, /Show another for \{trim\.label\}/)
  assert.match(src, /setPendingCapsuleExpansion\(\{ \.\.\.trim, prompt \}\)/)
  assert.match(src, /fetch\('\/api\/ai\/expand-capsule'/)
  assert.match(src, /q === capsuleExpansionToSend\?\.prompt/)
  assert.match(src, /const capacityExhausted = coreCapacity > 0 && shownForSlot >= coreCapacity/)
  assert.match(src, /Full available rotation shown for \{trim\.label\}/)
  assert.doesNotMatch(src, /hasStructuredIdeas && !isPreviewResponse && !compactIntro/)
  assert.match(src, /<details className="stylist-plan-notes" open>/)
  assert.match(src, /stylist-plan-notes-body/)
  assert.match(src, /className="stylist-capsule-roster"/)
  assert.match(src, />Your capsule</)
  assert.match(src, />Example outfits</)
  assert.match(src, /\? 'Wardrobe capsule'/)
  assert.match(src, /return 'Capsule details'/)
  assert.match(src, /capsuleContext\.roster_pieces/)
  assert.match(src, /resolveUploadThumbnailSrc\(photo, 'chat-garment'\)/)
  assert.match(src, /\^\\\[capsule \(\?:roster\|palette\|jobs\):/)
  // The canned "Outfit ideas for X… image generation is optional" line is gone entirely, along
  // with the helper that built it — the model's own answer stands in its place.
  assert.doesNotMatch(src, /getCompactOutfitIntro/)
  assert.doesNotMatch(src, /image generation is optional/)
  // Engine-built field dumps are not prose and must not reach the disclosure: for selected-piece
  // responses styling-engine/core.js's formatStructuredOutfitFeedback assembles the message body
  // from the same Label/Strength/Silhouette/Pieces fields the cards already show.
  assert.match(src, /const isEngineFieldDump = \(text\) =>/)
  assert.match(src, /!isEngineFieldDump\(modelNoteText\)/)
  // A plan is one artifact — it must never be split behind "Show N more outfit results".
  assert.match(src, /const isSinglePlanArtifact = allOutfits\.some\(outfit => isPlannedSetSource\(outfit\?\.source\)\) \|\| Boolean\(message\?\.wholeWardrobe\)/)
  assert.match(src, /const hasDeferredOutfits = !isSinglePlanArtifact/)
})

test('StylistChat image-preview lightbox behaves as a dialog rather than a static overlay', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /role="dialog"\s*\n\s*aria-modal="true"\s*\n\s*aria-labelledby="stylist-preview-title"/)
  assert.match(src, /previewCloseRef\.current\?\.focus\(\)/)
  assert.match(src, /event\.key === 'Escape'/)
  assert.match(src, /previewReturnFocusRef\.current\?\.focus\?\.\(\)/)
  assert.match(src, /document\.body\.style\.overflow = 'hidden'/)
  // every setPreviewImage(...) that opens the dialog (not the 3 close calls) must capture the
  // triggering element so focus can return to it on close
  const openCalls = src.match(/onClick=\{[^}]*previewReturnFocusRef\.current = event\.currentTarget[\s\S]*?setPreviewImage\(\{/g) || []
  assert.ok(openCalls.length >= 10, `expected at least 10 lightbox triggers to capture return focus, found ${openCalls.length}`)
})

test('StylistChat announces stylist activity and replies to assistive tech', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /className="ai-message assistant" role="status" aria-live="polite"/)
  assert.match(src, /Stylist is working…/)
  assert.match(src, /const \[chatAnnouncement, setChatAnnouncement\] = useState\(''\)/)
  assert.match(src, /setChatAnnouncement\(last\.isError \? 'Stylist reply failed\.' : 'Stylist replied\.'\)/)
  assert.match(src, /<div className="sr-only" role="status" aria-live="polite">\{chatAnnouncement\}<\/div>/)
})

test('StylistChat small accessibility/product batch: post-send focus, contrast, labels, badge placement', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  // Clearing input disables the send button; refocus the textarea so focus doesn't drop to <body>.
  // Intent: after send, the composer is cleared AND focus is moved to the textarea so it does not
  // drop to <body> when the send button disables. Tolerant of additional state setters on the
  // clear line (setPendingCapsuleExpansion was added there).
  assert.match(src, /setInput\(''\);[^\n]*setImagePrev\(null\)\s*\n\s*\/\/ Clearing input disables the send button[\s\S]*?textRef\.current\?\.focus\(\)/)
  // "Suggested additions" caption no longer uses --accent (4.48:1, marginal) — uses the
  // documented lowest-contrast readable token instead.
  assert.match(src, /Suggested additions: \{visual\.missingPieces\.join\(' \+ '\)\}<\/div>\}/)
  assert.doesNotMatch(src, /color: 'var\(--accent\)', marginTop: 2 \}\}>Suggested additions/)
  assert.match(src, /fontSize: 10, color: 'var\(--text-light\)', marginTop: 2 \}\}>Suggested additions/)
  // Icon-only send / remove-photo controls are labelled.
  assert.match(src, /className="ai-send-btn" onClick=\{send\}[\s\S]*?aria-label="Send message"/)
  assert.match(src, /aria-label="Remove attached photo"/)
  // The "Saved" badge on generated board previews no longer overlays the image (was
  // position: absolute, top/right 8, zIndex 10) — it now sits above it in normal flow.
  assert.doesNotMatch(src, /saved-board-badge[\s\S]{0,5}style=\{\{ position: 'absolute'/)
  assert.match(src, /className="saved-board-badge" style=\{\{ width: 'fit-content', marginBottom: 6/)
})

test('ThreadRail mobile history drawer behaves as a dialog rather than a static overlay', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ThreadRail.jsx'), 'utf8')
  assert.match(src, /role="dialog" aria-modal="true" aria-label="Chat history"/)
  assert.match(src, /drawerCloseRef\.current\?\.focus\(\)/)
  assert.match(src, /event\.key === 'Escape'/)
  assert.match(src, /if \(drawerNestedStateRef\.current\.renamingId \|\| drawerNestedStateRef\.current\.confirmDeleteId\) return/)
  assert.match(src, /previouslyFocused\?\.focus\?\.\(\)/)
  assert.match(src, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(src, /aria-label="Close chat history"/)
})

test('StylistChat selected-piece season menu keeps spring and summer separate', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  // Intent: spring and summer stay SEPARATE options (never collapsed into "Spring / summer").
  // The options were refactored from objects to [value, label] tuples; the intent is unchanged.
  assert.match(src, /\['spring', 'Spring'\]/)
  assert.match(src, /\['summer', 'Summer'\]/)
  assert.doesNotMatch(src, /Spring \/ summer/)
  assert.doesNotMatch(src, /spring \/ summer/)
})

test('StylistChat shows trip explanation before cards, not inside trip cards', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StylistChat.jsx'), 'utf8')
  assert.match(src, /Trip plan/)
  assert.match(src, /Outfit plan/)
  assert.match(src, /getPlanNotesTitle/)
  assert.match(src, /getTripPlanNotes/)
  assert.match(src, /garment and layer photos are prioritized before accessories/)
  assert.doesNotMatch(src, /Accessories are left out of these cards/)
  assert.match(src, /outfit\.reason && !isTripCard/)
  assert.match(src, /outfit\.coveragePosition/)
  assert.match(src, /const exclusionDisplaySource = isTripCard/)
  assert.match(src, /!isTripCard && outfit\.missionLabel/)
  assert.match(src, /!isTripCard && outfit\.dominantDirection/)
  assert.match(src, /!isTripCard && outfit\.silhouette/)
  assert.match(src, /const msgOccasion = outfit\.occasion \|\| outfit\.bestFor \|\| message\.queryOptions\?\.occasion/)
  assert.doesNotMatch(src, /<details open=\{message\?\.wholeWardrobe \|\| outfit\.source === 'trip_precompose'\}/)
})

test('executeTool get_garment_details loads text and base64 photo blocks', async () => {
  // Write a dummy temp image to uploads directory to mock the photo file
  const topPhotoFilename = 'mock-top-photo.jpg'
  const mockFilePath = path.join(userUploadsDir(), topPhotoFilename)
  
  // Ensure uploads directory exists and write a valid dummy 1x1 JPEG to satisfy sharp resizing
  fs.mkdirSync(userUploadsDir(), { recursive: true })
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

  // res1 and res2 found matches, so nothing was relaxed and the result is a plain piece list --
  // the shape 37 existing callers already expect. The summary appears only when there is a
  // compromise to report.
  assert.ok(!res1.some(item => item.retrieval), 'a search that found what it asked for reports nothing extra')

  // 3. A filter that matches nothing no longer returns an empty list. Broadening drops the soft
  // descriptive filter and returns the closest active pieces, saying so -- an empty list cost the
  // model a round-trip to re-search, and reads like a wardrobe gap when it is only a narrow filter.
  const res3 = await executeTool('search_wardrobe', { neckline: 'V' })
  assert.ok(Array.isArray(res3))
  assert.ok(res3.some(item => item.id), 'closest active pieces are returned instead of nothing')
  const summary = res3.find(item => item.retrieval)?.retrieval
  assert.ok(summary, 'the compromise is reported rather than applied silently')
  assert.equal(summary.broadened, true)
  assert.deepEqual(summary.relaxedFilters, ['neckline'])
  assert.deepEqual(summary.shortfalls, [], 'pieces were found after broadening, so this is not a wardrobe gap')
  assert.match(summary.note, /No exact match for the original filters/)
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
  // search_wardrobe now gates footwear by the heel_height/walk_support enums (spec 1). Tag these
  // walkable shoes accordingly so they pass the hiking gate as 'neutral' rather than surfacing as
  // 'unknown' for missing comfort metadata.
  db.prepare(`
    UPDATE pieces
    SET reads_as = 'flat rugged boots', heel_height = 'flat', walk_support = 'high'
    WHERE id = ?
  `).run(seeded.boot)
  db.prepare(`
    UPDATE pieces
    SET heel_height = 'flat', walk_support = 'high'
    WHERE id = ?
  `).run(seeded.shoe)

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
  assert.equal(boot.ruleFit, 'neutral')
  assert.equal(slipOn.ruleFit, 'neutral')
})

test('executeTool search_wardrobe excludes prohibited pieces in compose mode and surfaces them in explain mode', async () => {
  const heelId = insertPiece({
    name: 'test stiletto pumps',
    category: 'shoes',
    colors: ['black'],
    occasions: ['casual'],
    reads_as: 'sharp high stiletto pumps',
  })
  db.prepare("UPDATE pieces SET heel_height = 'high', walk_support = 'low' WHERE id = ?").run(heelId)
  try {
    // compose (default): a high heel is prohibited for hiking → filtered out entirely.
    const composed = await executeTool('search_wardrobe', { category: 'shoes', occasion: 'casual', activity: 'hiking' })
    assert.ok(!composed.some(p => p.id === heelId), 'prohibited high heel should be filtered out of compose-mode results')
    assert.ok(composed.some(p => (p.note || '').includes('filtered out as prohibited')), 'a gate-exclusion note should be present')
    assert.ok(composed.some(p => p.id && p.ruleFit && p.ruleFit !== 'prohibited'), 'wearable shoes still remain (filter is selective)')

    // explain: the same prohibited piece IS returned, with its reasoning label.
    const explained = await executeTool('search_wardrobe', { category: 'shoes', occasion: 'casual', activity: 'hiking', intent: 'explain' })
    const heel = explained.find(p => p.id === heelId)
    assert.ok(heel, 'explain mode should return the prohibited piece')
    assert.equal(heel.ruleFit, 'prohibited')
    assert.match(heel.ruleFitLabel, /heel unsuitable/)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id = ?').run(heelId)
  }
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

test('executeTool search_wardrobe treats occasion-only queries canonically', async () => {
  const decoy = insertPiece({
    name: 'literal brunch note tee',
    category: 'top',
    colors: ['blue'],
    occasions: ['home'],
    notes: 'brunch wedding gallery',
    reads_as: 'soft home tee'
  })

  const brunchSearch = await executeTool('search_wardrobe', { query: 'brunch' })
  assert.ok(brunchSearch.some(item => item.id === seeded.top), 'brunch should resolve to city-compatible pieces')
  assert.ok(!brunchSearch.some(item => item.id === decoy), 'brunch should not be treated as literal garment-note text')

  const weddingSearch = await executeTool('search_wardrobe', { query: 'wedding' })
  assert.ok(weddingSearch.some(item => item.id === seeded.dress), 'wedding should resolve to evening-compatible pieces')
  assert.ok(!weddingSearch.some(item => item.id === decoy), 'wedding should not be treated as literal garment-note text')
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

test('executeTool propose_outfit appends a structured card when IDs resolve and roles validate', async () => {
  const toolContext = {
    occasion: 'city',
    season: 'current season',
    declaredIntent: { want: 'cards' },
    retrievedPieceIds: new Set([seeded.top, seeded.bottom]),
    generatedOutfits: [{
      label: 'Existing card',
      occasion: 'city',
      season: 'current season',
      pieceIds: [seeded.shoe],
      pieces: [],
      previewOnly: true
    }]
  }
  const proposed = await executeTool('propose_outfit', {
    label: 'Winery column',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' }
    ],
    occasion: 'city',
    season: 'highs 80-90F',
    why_it_works: 'a column of light neutrals grounded by the shoe',
    styling_instructions: 'Leave the top untucked over the wide-leg pants.',
    missing_gaps: ['lightweight rain shell']
  }, toolContext)

  assert.equal(proposed.status, 'success')
  assert.deepEqual(proposed.pieceNames, ['black button detail top', 'light beige linen wide-leg pants', 'cream slip-on shoes'])
  assert.equal(toolContext.source, 'proposed_outfit')
  assert.equal(toolContext.generatedOutfits.length, 2)
  assert.equal(toolContext.generatedOutfits[0].label, 'Existing card')
  const card = toolContext.generatedOutfits[1]
  assert.equal(card.label, 'Winery column')
  assert.deepEqual(card.pieceIds, [seeded.top, seeded.bottom, seeded.shoe])
  assert.equal(card.pieces[0].role, 'primary_top')
  assert.deepEqual(card.missingPieces, ['lightweight rain shell'])
  assert.equal(card.previewOnly, true)
  assert.equal(card.stylingInstructions, 'Leave the top untucked over the wide-leg pants.')
})

test('executeTool propose_outfit defaults stylingInstructions to an empty string when the model omits it', async () => {
  const toolContext = {
    occasion: 'city',
    season: 'current season',
    declaredIntent: { want: 'cards' },
    retrievedPieceIds: new Set([seeded.top, seeded.bottom, seeded.shoe]),
    generatedOutfits: []
  }
  const proposed = await executeTool('propose_outfit', {
    label: 'No mechanics needed',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' }
    ],
    occasion: 'city',
    why_it_works: 'a simple, clean pairing'
  }, toolContext)

  assert.equal(proposed.status, 'success')
  assert.equal(toolContext.generatedOutfits[0].stylingInstructions, '')
})

test('executeTool propose_outfit errors on an unresolved ID and does not append', async () => {
  const failedContext = { generatedOutfits: [{ label: 'keep me' }] }
  const failed = await executeTool('propose_outfit', {
    label: 'Bad ID',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: 999999999, role: 'shoes' }
    ]
  }, failedContext)

  assert.equal(failed.status, 'error')
  assert.deepEqual(failed.unresolvedIds, [999999999])
  assert.equal(failedContext.generatedOutfits.length, 1)
})

test('executeTool propose_outfit rejects an unresolved role collision (two primary_top) and surfaces it as a visible broken card, not a silent drop', async () => {
  const vContext = { generatedOutfits: [], declaredIntent: { want: 'cards' }, retrievedPieceIds: new Set([seeded.top, seeded.bottom, seeded.shoe]) }
  const invalid = await executeTool('propose_outfit', {
    label: 'Slot collision',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_top' },
      { id: seeded.shoe, role: 'shoes' }
    ]
  }, vContext)

  assert.equal(invalid.status, 'validation_error')
  assert.match(invalid.issues.join(' '), /unresolved top slot/)
  // Spec 3 Part 1: a failed validation renders visibly (a broken/"needs review" card) rather than
  // being silently dropped — this is the one behavioral difference from spec 2's original test.
  assert.equal(vContext.generatedOutfits.length, 1)
  assert.equal(vContext.generatedOutfits[0].broken, true)
  assert.match(vContext.generatedOutfits[0].rejectionReason, /unresolved top slot/)
})

test('executeTool propose_outfit treats missing_gaps as disclosure, not a footwear substitute', async () => {
  const toolContext = {
    generatedOutfits: [],
    declaredIntent: { want: 'cards' },
    retrievedPieceIds: new Set([seeded.top, seeded.bottom])
  }
  const invalid = await executeTool('propose_outfit', {
    label: 'Shoeless attempt',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' }
    ],
    missing_gaps: ['walkable flat sandal, no suitable shoe in wardrobe']
  }, toolContext)

  assert.equal(invalid.status, 'validation_error')
  assert.match(invalid.issues.join(' '), /missing shoes/)
  assert.equal(toolContext.generatedOutfits[0].broken, true)
  assert.match(toolContext.generatedOutfits[0].rejectionReason, /missing_gaps may explain/)
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

// Spec 22 hotfix: routes/ai.js's tagger builds image blocks as
// `{ type: 'image', detail: 'low', source }` — `detail` is an OpenAI-only
// concept that the Anthropic API 400s on ("Extra inputs are not permitted").
// toAnthropicContentBlocks is the allowlist sanitizer applied at every
// Anthropic send site so this can't ship again from a different builder.
test('toAnthropicContentBlocks drops detail from image blocks, preserves source/text, passes strings through', () => {
  assert.equal(toAnthropicContentBlocks('plain string'), 'plain string')

  const content = [
    { type: 'text', text: 'Hello!' },
    { type: 'image', detail: 'low', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } }
  ]
  const result = toAnthropicContentBlocks(content)
  assert.equal(result.length, 2)
  assert.deepEqual(result[0], { type: 'text', text: 'Hello!' })
  assert.deepEqual(result[1], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } })
  assert.equal('detail' in result[1], false, 'detail must not survive sanitization')
})

test('toAnthropicContentBlocks preserves cache_control on text and image blocks', () => {
  const content = [
    { type: 'text', text: 'stable prefix', cache_control: { type: 'ephemeral' } },
    { type: 'image', detail: 'low', source: { type: 'base64', media_type: 'image/png', data: 'xyz' }, cache_control: { type: 'ephemeral' } }
  ]
  const result = toAnthropicContentBlocks(content)
  assert.deepEqual(result[0].cache_control, { type: 'ephemeral' })
  assert.deepEqual(result[1].cache_control, { type: 'ephemeral' })
  assert.equal('detail' in result[1], false)
})

test('toAnthropicContentBlocks preserves tool_result/tool_use blocks and recursively sanitizes nested content', () => {
  const content = [
    {
      type: 'tool_result',
      tool_use_id: 'toolu_123',
      cache_control: { type: 'ephemeral' },
      content: [
        { type: 'text', text: 'tool result text' },
        { type: 'image', detail: 'low', source: { type: 'base64', media_type: 'image/png', data: 'xyz' } }
      ]
    },
    { type: 'tool_use', id: 'toolu_456', name: 'search_wardrobe', input: { occasion: 'city' } }
  ]
  const result = toAnthropicContentBlocks(content)
  assert.equal(result[0].type, 'tool_result')
  assert.equal(result[0].tool_use_id, 'toolu_123')
  assert.deepEqual(result[0].cache_control, { type: 'ephemeral' })
  assert.equal('detail' in result[0].content[1], false, 'detail must be dropped from images nested inside tool_result content')
  assert.deepEqual(result[1], { type: 'tool_use', id: 'toolu_456', name: 'search_wardrobe', input: { occasion: 'city' } })
})

test('retag path shape: the tagger\'s detail:low image block loses detail on the Anthropic path but keeps it on the OpenAI path', () => {
  const taggerContent = [
    { type: 'text', text: 'Tag this garment.' },
    { type: 'image', detail: 'low', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } }
  ]

  const anthropicBlocks = toAnthropicContentBlocks(taggerContent)
  assert.equal(JSON.stringify(anthropicBlocks).includes('"detail"'), false, 'no detail key anywhere in the Anthropic-bound payload')

  const openAiBlocks = contentToOpenAI(taggerContent)
  assert.equal(openAiBlocks[1].image_url.detail, 'low', 'OpenAI behavior must stay unchanged')
})

test('toAnthropicContentBlocks composes with the moving cache breakpoint — sanitizing first does not lose the breakpoint annotation', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'last text' },
        { type: 'image', detail: 'low', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc' } }
      ]
    }
  ]
  const formatted = withMovingCacheBreakpoint(messages.map(m => ({ role: m.role, content: toAnthropicContentBlocks(m.content) })))

  assert.equal('detail' in formatted[1].content[1], false, 'detail must still be dropped after composing with the breakpoint')
  assert.deepEqual(formatted[1].content[1].cache_control, { type: 'ephemeral' }, 'the breakpoint annotation must survive sanitizing first')
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

test('provider usage helpers normalize tokens and estimate known model costs', () => {
  const anthropicUsage = normalizeAiUsage({
    input_tokens: 100000,
    output_tokens: 2000,
    cache_read_input_tokens: 10000,
    cache_creation_input_tokens: 0,
  }, { provider: 'anthropic', model: 'claude-sonnet-4-6' })
  const anthropicCost = estimateAiUsageCost(anthropicUsage)
  assert.equal(anthropicUsage.inputTokens, 100000)
  assert.equal(anthropicUsage.outputTokens, 2000)
  assert.equal(anthropicUsage.cacheReadInputTokens, 10000)
  assert.equal(anthropicCost.pricingAvailable, true)
  assert.equal(anthropicCost.estimatedUsd, 0.333)

  const openAiUsage = normalizeAiUsage({
    prompt_tokens: 4000,
    completion_tokens: 500,
    total_tokens: 4500,
    prompt_tokens_details: { cached_tokens: 1000 },
  }, { provider: 'openai', model: 'gpt-5.4' })
  const openAiCost = estimateAiUsageCost(openAiUsage)
  assert.equal(openAiUsage.inputTokens, 4000)
  assert.equal(openAiUsage.outputTokens, 500)
  assert.equal(openAiUsage.cacheReadInputTokens, 1000)
  assert.equal(openAiCost.pricingAvailable, true)
  assert.equal(openAiCost.estimatedUsd, 0.01525)

  const gpt4oCost = estimateAiUsageCost({ provider: 'openai', model: 'gpt-4o', inputTokens: 54000, outputTokens: 656 })
  assert.equal(gpt4oCost.pricingAvailable, true)
  assert.equal(gpt4oCost.estimatedUsd, 0.14156)

  const unknownCost = estimateAiUsageCost({ provider: 'openai', model: 'unknown-openai-model', inputTokens: 1000, outputTokens: 100 })
  assert.equal(unknownCost.pricingAvailable, false)
  assert.equal(unknownCost.estimatedUsd, null)

  const previousInput = process.env.AI_INPUT_USD_PER_MTOK
  const previousOutput = process.env.AI_OUTPUT_USD_PER_MTOK
  const previousCached = process.env.AI_CACHED_INPUT_USD_PER_MTOK
  process.env.AI_INPUT_USD_PER_MTOK = '2.50'
  process.env.AI_OUTPUT_USD_PER_MTOK = '10'
  process.env.AI_CACHED_INPUT_USD_PER_MTOK = '1.25'
  try {
    const overrideCost = estimateAiUsageCost({ provider: 'openai', model: 'gpt-4o', inputTokens: 4000, outputTokens: 500, cacheReadInputTokens: 1000 })
    assert.equal(overrideCost.pricingAvailable, true)
    assert.equal(overrideCost.estimatedUsd, 0.01375)
    assert.equal(overrideCost.ratesPerMillion.source, 'env')
  } finally {
    if (previousInput == null) delete process.env.AI_INPUT_USD_PER_MTOK
    else process.env.AI_INPUT_USD_PER_MTOK = previousInput
    if (previousOutput == null) delete process.env.AI_OUTPUT_USD_PER_MTOK
    else process.env.AI_OUTPUT_USD_PER_MTOK = previousOutput
    if (previousCached == null) delete process.env.AI_CACHED_INPUT_USD_PER_MTOK
    else process.env.AI_CACHED_INPUT_USD_PER_MTOK = previousCached
  }
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

test('generated-board feedback stays synchronized with the editable Visual Lab board', async () => {
  const imageUrl = '/uploads/generated-boards/feedback-sync-test.png'
  const boardPayload = {
    board: {
      imageUrl,
      label: 'Feedback sync board',
      reason: 'A test styling rationale.',
      pieces: [{ id: seeded.pieceId, name: 'Test piece', category: 'top' }],
      wholeWardrobe: true,
    },
    feedback_labels: [],
  }
  const boardResult = db.prepare(`
    INSERT INTO saved_boards (board_type, context_type, context_name, title, image_url, pieces, reason, payload)
    VALUES ('whole_wardrobe_board', 'wardrobe', 'Whole wardrobe', 'Feedback sync board', ?, ?, ?, ?)
  `).run(imageUrl, JSON.stringify(boardPayload.board.pieces), boardPayload.board.reason, JSON.stringify(boardPayload))

  try {
    const createResponse = await fetch(`${baseUrl}/api/stylist-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedbackType: 'wrong_silhouette',
        targetType: 'generated_visual_board',
        contextType: 'wardrobe',
        contextName: 'Whole wardrobe',
        label: boardPayload.board.label,
        note: boardPayload.board.reason,
        payload: { board: boardPayload.board },
      }),
    })
    assert.equal(createResponse.status, 200)
    const created = await createResponse.json()

    let saved = db.prepare('SELECT payload FROM saved_boards WHERE id = ?').get(boardResult.lastInsertRowid)
    assert.deepEqual(JSON.parse(saved.payload).feedback_labels, ['wrong_silhouette'])

    const listing = await fetch(`${baseUrl}/api/stylist-feedback?limit=1000`).then(response => response.json())
    const listedFeedback = listing.find(row => Number(row.id) === Number(created.id))
    assert.equal(listedFeedback?.referenced_board_id, Number(boardResult.lastInsertRowid))
    assert.equal(listedFeedback?.memory?.destination, 'styling_prompt')
    assert.equal(listedFeedback?.memory?.source, 'Saved-board feedback')
    assert.match(listedFeedback?.memory?.effect || '', /without becoming a global garment preference/)

    const directBoardResponse = await fetch(`${baseUrl}/api/saved-boards/${boardResult.lastInsertRowid}`)
    assert.equal(directBoardResponse.status, 200)
    assert.equal((await directBoardResponse.json()).title, 'Feedback sync board')

    const removeResponse = await fetch(`${baseUrl}/api/saved-boards/${boardResult.lastInsertRowid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackLabels: [] }),
    })
    assert.equal(removeResponse.status, 200)
    assert.equal(db.prepare('SELECT archived FROM stylist_feedback WHERE id = ?').get(created.id).archived, 1)

    const restoreResponse = await fetch(`${baseUrl}/api/saved-boards/${boardResult.lastInsertRowid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackLabels: ['wrong_silhouette'] }),
    })
    assert.equal(restoreResponse.status, 200)
    assert.equal(db.prepare('SELECT archived FROM stylist_feedback WHERE id = ?').get(created.id).archived, 0)
  } finally {
    db.prepare(`DELETE FROM stylist_feedback WHERE json_extract(payload, '$.board.imageUrl') = ?`).run(imageUrl)
    db.prepare('DELETE FROM saved_boards WHERE id = ?').run(boardResult.lastInsertRowid)
  }
})

test('wrong-item feedback writes canonical garment and activity context', async () => {
  const response = await fetch(`${baseUrl}/api/stylist-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feedbackType: 'wrong_item_read',
      targetType: 'whole_wardrobe_outfit',
      contextType: 'wardrobe',
      contextId: 77,
      contextName: 'Whole wardrobe',
      payload: {
        sourceSurface: 'stylist_chat',
        pieceId: seeded.shoe,
        pieceName: 'Test walking shoe',
        pieceCategory: 'shoes',
        occasion: 'city',
        activity: 'walking',
        season: 'current season',
        mood: 'museum day',
        weatherContext: 'Steady rain and wet pavement',
        explicitReason: 'The canvas upper will absorb water.',
        threadId: 'thread_evidence_test',
        messageIndex: 4,
        outfitIndex: 1,
        outfit: { label: 'Museum afternoon' },
      },
    }),
  })
  assert.equal(response.status, 200)
  const created = await response.json()
  try {
    const row = db.prepare('SELECT payload FROM stylist_feedback WHERE id = ?').get(created.id)
    const payload = JSON.parse(row.payload)
    assert.equal('scopedEvidence' in payload, false)
    assert.deepEqual(payload.feedbackEvidence, {
      version: 2,
      action: 'wrong_piece_for_outfit',
      verdict: 'negative',
      subject: { type: 'garment', pieceId: seeded.shoe, name: 'Test walking shoe', category: 'shoes' },
      context: {
        type: 'outfit', outfitLabel: 'Museum afternoon', occasion: 'city', activity: 'walking',
        season: 'current season', mood: 'museum day', weather: 'Steady rain and wet pavement',
      },
      source: {
        surface: 'stylist_chat', threadId: 'thread_evidence_test', messageIndex: 4,
        outfitIndex: 1, targetType: 'whole_wardrobe_outfit',
      },
      storageContext: { type: 'wardrobe', id: 77, name: 'Whole wardrobe' },
      explicitReason: 'The canvas upper will absorb water.',
      scope: 'outfit_context',
      authority: 'weak_contextual',
    })
  } finally {
    db.prepare('DELETE FROM stylist_feedback WHERE id = ?').run(created.id)
  }
})

test('stylist feedback accepts registered types, rejects unknown types, and preserves the retired-target 410', async () => {
  const before = db.prepare('SELECT COUNT(*) AS count FROM stylist_feedback').get().count
  const accepted = await fetch(`${baseUrl}/api/stylist-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedbackType: 'works', targetType: 'whole_wardrobe_outfit' }),
  })
  assert.equal(accepted.status, 200)
  const created = await accepted.json()

  const rejected = await fetch(`${baseUrl}/api/stylist-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedbackType: 'new_chip_missing_from_registry', targetType: 'whole_wardrobe_outfit' }),
  })
  assert.equal(rejected.status, 400)
  assert.match((await rejected.json()).error, /Unknown feedbackType/)

  const retired = await fetch(`${baseUrl}/api/stylist-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedbackType: 'new_chip_missing_from_registry', targetType: 'renderer_calibration' }),
  })
  assert.equal(retired.status, 410)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stylist_feedback').get().count, before + 1)
  db.prepare('DELETE FROM stylist_feedback WHERE id = ?').run(created.id)
})

test('feedback synthesis preview is free and the authorized route enforces hash, coverage, and lifecycle', async () => {
  const insert = db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, note, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', ?, ?)`)
  const evidencePayload = (pieceId, reason) => JSON.stringify({
    feedbackEvidence: {
      version: 2,
      action: 'wrong_piece_for_outfit',
      subject: { pieceId, name: `Piece ${pieceId}`, category: 'shoes' },
      context: { outfitLabel: 'Rain walk', occasion: 'casual', activity: 'walking', weather: 'wet' },
      explicitReason: reason,
    },
    outfit: { pieces: [{ id: pieceId, name: `Piece ${pieceId}`, category: 'shoes' }] },
  })
  const firstId = Number(insert.run('First reason', evidencePayload(seeded.shoe, 'Canvas absorbs water.')).lastInsertRowid)
  const secondId = Number(insert.run('Second reason', evidencePayload(seeded.boot, 'The heel is tiring for a long walk.')).lastInsertRowid)
  let synthesisCalls = 0
  let capturedMessages = null
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = (req) => {
    synthesisCalls += 1
    capturedMessages = req.messages
    return { results: [{
      source_feedback_ids: [firstId],
      disposition: 'personal_contextual_lesson',
      title: 'Wet-walk footwear preference',
      proposed_text: 'For wet walks, prefer footwear that does not absorb water.',
      boundary: 'Wet walking contexts only.',
      rationale: 'The owner explicitly supplied the practical reason.',
      confidence: 'explicit_owner',
      related_draft_id: 0,
      applicability: {
        scope: 'piece_context',
        piece_ids: [seeded.shoe],
        occasions: [],
        activities: ['walking'],
        seasons: [],
        weather_terms: ['wet'],
      },
    }] }
  }

  const previewResponse = await fetch(`${baseUrl}/api/feedback-synthesis/preview?ids=${firstId},${secondId}`)
  assert.equal(previewResponse.status, 200)
  const preview = await previewResponse.json()
  assert.equal(preview.providerCalls, 0)
  assert.equal(synthesisCalls, 0)
  assert.equal(preview.outputTokenCap, preview.estimatedOutputTokens)

  const unauthorized = await fetch(`${baseUrl}/api/feedback-synthesis/batches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedbackIds: [firstId, secondId], inputHash: preview.inputHash }),
  })
  assert.equal(unauthorized.status, 400)
  assert.equal(synthesisCalls, 0)

  const stale = await fetch(`${baseUrl}/api/feedback-synthesis/batches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedbackIds: [firstId, secondId], inputHash: 'stale', authorize: true }),
  })
  assert.equal(stale.status, 409)
  assert.equal(synthesisCalls, 0)

  const authorized = await fetch(`${baseUrl}/api/feedback-synthesis/batches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedbackIds: [firstId, secondId], inputHash: preview.inputHash, authorize: true }),
  })
  assert.equal(authorized.status, 200)
  const result = await authorized.json()
  assert.equal(synthesisCalls, 1)
  assert.equal(result.drafts.length, 2)
  assert.ok(result.drafts.some(draft => draft.disposition === 'insufficient_evidence' && JSON.parse(draft.source_feedback_ids).includes(secondId)))

  // Both seeded pieces referenced by this evidence carry real photos, so the actual request sent to
  // the provider must include them. Anthropic requires `source.type: 'base64'` on every image block
  // (missing it 400s the whole call) — this caught a real bug where that field was omitted.
  const imageBlocks = (capturedMessages?.[0]?.content || []).filter(block => block.type === 'image')
  assert.ok(imageBlocks.length > 0, 'photographed pieces should produce at least one image block')
  for (const block of imageBlocks) {
    assert.equal(block.source?.type, 'base64')
    assert.ok(block.source?.media_type, 'image block is missing media_type')
    assert.ok(block.source?.data?.length > 0, 'image block is missing base64 data')
  }

  const personal = result.drafts.find(draft => draft.disposition === 'personal_contextual_lesson')
  const invalidPatch = await fetch(`${baseUrl}/api/feedback-synthesis/drafts/${personal.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'acceptd' }),
  })
  assert.equal(invalidPatch.status, 400)
  assert.equal(db.prepare('SELECT status FROM feedback_synthesis_drafts WHERE id = ?').get(personal.id).status, 'draft')

  const acceptPatch = await fetch(`${baseUrl}/api/feedback-synthesis/drafts/${personal.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'accepted',
      editedText: 'Owner-edited wet-walk preference.',
      boundary: 'Owner-edited wet-weather boundary.',
    }),
  })
  assert.equal(acceptPatch.status, 200)
  const acceptedDraft = await acceptPatch.json()
  assert.equal(acceptedDraft.boundary, 'Owner-edited wet-weather boundary.')
  const retirePatch = await fetch(`${baseUrl}/api/feedback-synthesis/drafts/${personal.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'retired' }),
  })
  assert.equal(retirePatch.status, 200)
  assert.equal(db.prepare('SELECT status FROM feedback_synthesis_drafts WHERE id = ?').get(personal.id).status, 'retired')
})

test('accepted lesson applicability is evidence-derived, cannot be silently emptied, and text edits alone never touch it', async () => {
  const insert = db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, note, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', ?, ?)`)
  const evidencePayload = (pieceId, reason) => JSON.stringify({
    feedbackEvidence: {
      version: 2,
      action: 'wrong_piece_for_outfit',
      subject: { pieceId, name: `Piece ${pieceId}`, category: 'shoes' },
      context: { outfitLabel: 'Rain walk', occasion: 'casual', activity: 'walking', weather: 'wet' },
      explicitReason: reason,
    },
    outfit: { pieces: [{ id: pieceId, name: `Piece ${pieceId}`, category: 'shoes' }] },
  })
  const feedbackId = Number(insert.run('Wet-shoe reason', evidencePayload(seeded.shoe, 'Canvas absorbs water.')).lastInsertRowid)
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => ({ results: [{
    source_feedback_ids: [feedbackId],
    disposition: 'personal_contextual_lesson',
    title: 'Wet-walk footwear preference',
    proposed_text: 'For wet walks, prefer footwear that does not absorb water.',
    boundary: 'Wet walking contexts only.',
    rationale: 'The owner explicitly supplied the practical reason.',
    confidence: 'explicit_owner',
    related_draft_id: 0,
    applicability: { scope: 'piece_context', piece_ids: [seeded.shoe], occasions: [], activities: ['walking'], seasons: [], weather_terms: ['wet'] },
  }] })
  const preview = await (await fetch(`${baseUrl}/api/feedback-synthesis/preview?ids=${feedbackId}`)).json()
  const authorized = await (await fetch(`${baseUrl}/api/feedback-synthesis/batches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedbackIds: [feedbackId], inputHash: preview.inputHash, authorize: true }),
  })).json()
  const draft = authorized.drafts[0]

  const getDrafts = await (await fetch(`${baseUrl}/api/feedback-synthesis/drafts`)).json()
  const listed = getDrafts.find(row => row.id === draft.id)
  // Carries the garment's current photo so the card can show the piece rather than describe it.
  assert.equal(listed.applicabilityOptions.pieces.length, 1)
  assert.equal(listed.applicabilityOptions.pieces[0].id, seeded.shoe)
  assert.ok(Object.hasOwn(listed.applicabilityOptions.pieces[0], 'photo'))
  assert.deepEqual(listed.applicabilityOptions.activities, ['walking'])
  assert.deepEqual(listed.applicabilityOptions.weather, ['wet'])
  // Options only ever include what's checkable — nothing on the "occasions" evidence-supported
  // list here even though occasion 'casual' exists in context, because the model's own applicability
  // never populated occasions; this is a snapshot of what THIS draft's stored/derivable state is.
  assert.deepEqual(listed.applicabilityOptions.occasions, ['casual'])

  const accepted = await (await fetch(`${baseUrl}/api/feedback-synthesis/drafts/${draft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted' }),
  })).json()
  assert.equal(accepted.status, 'accepted')
  const acceptedPayload = JSON.parse(accepted.payload)
  assert.deepEqual(acceptedPayload.applicability.piece_ids, [seeded.shoe])

  // A save that submits only unsupported/empty applicability terms must be rejected outright, not
  // silently persisted as null — the row must keep exactly the delivery scope it had before.
  const rejected = await fetch(`${baseUrl}/api/feedback-synthesis/drafts/${draft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted', applicability: { scope: 'context', piece_ids: [], occasions: [], activities: [], seasons: ['a season never in evidence'], weather_terms: [] } }),
  })
  assert.equal(rejected.status, 400)
  const stillIntact = JSON.parse(db.prepare('SELECT payload FROM feedback_synthesis_drafts WHERE id = ?').get(draft.id).payload)
  assert.deepEqual(stillIntact.applicability.piece_ids, [seeded.shoe])
  assert.deepEqual(stillIntact.applicability.activities, ['walking'])

  // Editing only the lesson text — the applicability key is absent from the request body entirely —
  // must never touch the stored scope, regardless of what evidence looks like at save time.
  const textOnlyEdit = await (await fetch(`${baseUrl}/api/feedback-synthesis/drafts/${draft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted', editedText: 'Prefer water-resistant footwear for wet walks.' }),
  })).json()
  const afterTextEdit = JSON.parse(textOnlyEdit.payload)
  assert.deepEqual(afterTextEdit.applicability.piece_ids, [seeded.shoe])
  assert.deepEqual(afterTextEdit.applicability.activities, ['walking'])

  // A legitimate narrowing — dropping the piece, keeping only the supported context terms — is
  // still allowed and persists exactly what was submitted (after evidence-support filtering).
  const narrowed = await (await fetch(`${baseUrl}/api/feedback-synthesis/drafts/${draft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted', applicability: { scope: 'context', piece_ids: [], occasions: [], activities: ['walking'], seasons: [], weather_terms: ['wet'] } }),
  })).json()
  const afterNarrow = JSON.parse(narrowed.payload)
  assert.deepEqual(afterNarrow.applicability.piece_ids, [])
  assert.deepEqual(afterNarrow.applicability.activities, ['walking'])
  assert.equal(afterNarrow.applicability.scope, 'context')
})

test('occasion exclusions report when each was set, parsed from their own receipts', async () => {
  const piece = seeded.shoe
  await fetch(`${baseUrl}/api/pieces/${piece}/occasion-exclusion`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ occasion: 'hiking', excluded: true }),
  })
  const rows = await (await fetch(`${baseUrl}/api/pieces/occasion-exclusions`)).json()
  const entry = rows.find(row => row.pieceId === piece && row.occasion === 'hiking')
  // `pieces` has no per-exclusion timestamp (its only date column is date_added), so recency comes
  // from parsing the prose receipt the writer records. Without this there is no way to preview
  // "what changed recently" — the endpoint previously returned alphabetical order only.
  assert.match(entry.changedAt, /^\d{4}-\d{2}-\d{2}$/)

  // An exclusion written without a receipt still lists, sorted last rather than dropped.
  db.prepare("UPDATE pieces SET occasion_exclusions = '[\"travel\"]', styling_rules_learned = '[]' WHERE id = ?").run(seeded.boot)
  const withLegacy = await (await fetch(`${baseUrl}/api/pieces/occasion-exclusions`)).json()
  const legacy = withLegacy.find(row => row.pieceId === seeded.boot)
  assert.equal(legacy.changedAt, null)
  assert.equal(withLegacy[withLegacy.length - 1].pieceId, seeded.boot)
})

test('an unusable synthesis result is never queued for a decision, and only it can be deleted', async () => {
  const batchId = Number(db.prepare(`
    INSERT INTO feedback_synthesis_batches (status, feedback_ids, compact_input, input_hash, provider, model)
    VALUES ('completed', '[]', '', ?, 'test', 'test')
  `).run(`nonresult-${Date.now()}`).lastInsertRowid)
  const mk = (disposition, status) => Number(db.prepare(`
    INSERT INTO feedback_synthesis_drafts (batch_id, disposition, title, proposed_text, source_feedback_ids, status)
    VALUES (?, ?, 'x', 'y', '[]', ?)
  `).run(batchId, disposition, status).lastInsertRowid)

  const nonResult = mk('insufficient_evidence', 'reported')
  const realLesson = mk('personal_contextual_lesson', 'accepted')

  // A non-result is model output about its own failure, so it can be removed outright.
  const removed = await fetch(`${baseUrl}/api/feedback-synthesis/drafts/${nonResult}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feedback_synthesis_drafts WHERE id = ?').get(nonResult).n, 0)

  // Anything the owner actually decided on must not be deletable through this route.
  const refused = await fetch(`${baseUrl}/api/feedback-synthesis/drafts/${realLesson}`, { method: 'DELETE' })
  assert.equal(refused.status, 400)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feedback_synthesis_drafts WHERE id = ?').get(realLesson).n, 1)

  // The paid batch survives either way — that is the cost/provenance record.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feedback_synthesis_batches WHERE id = ?').get(batchId).n, 1)
})

test('guidance is stopped, never reworded: a PATCH cannot re-scope or re-derive an owner rule', async () => {
  const stored = { version: 1, reach: 'garment_context', garment: { piece_ids: [], categories: [], footwear: ['sneakers'], materials: ['canvas'] }, context: { occasions: [], activities: [], seasons: [], weather: ['rainy'], situations: [] }, source: 'test' }
  const feedbackId = Number(db.prepare(`
    INSERT INTO stylist_feedback (feedback_type, target_type, note, payload) VALUES ('owner_rule', 'message', ?, ?)
  `).run('Canvas sneakers are not suitable for rainy or foggy beach weather.', JSON.stringify({ ownerGuidanceApplicability: stored })).lastInsertRowid)

  // Style Profile offers no rewording, and the route must not quietly re-derive scope for anything
  // that does send a note — a stored envelope only changes via store_user_correction in chat.
  const patched = await (await fetch(`${baseUrl}/api/stylist-feedback/${feedbackId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'I love canvas sneakers with summer dresses.' }),
  })).json()
  assert.deepEqual(patched.payload.ownerGuidanceApplicability, stored)

  // Stopping it is the one owner action, and it is an archive rather than a delete.
  const stopped = await (await fetch(`${baseUrl}/api/stylist-feedback/${feedbackId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: true }),
  })).json()
  assert.equal(stopped.archived, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stylist_feedback WHERE id = ?').get(feedbackId).n, 1)
})
test('feedback synthesis records provider usage when paid structured output cannot be parsed', async () => {
  const payload = JSON.stringify({
    feedbackEvidence: {
      version: 2,
      action: 'wrong_piece_for_outfit',
      subject: { pieceId: seeded.shoe, name: 'cream slip-on shoes', category: 'shoes' },
      context: { outfitLabel: 'Rain walk', activity: 'walking', weather: 'wet' },
      explicitReason: 'Canvas absorbs water.',
    },
  })
  const feedbackId = Number(db.prepare(`INSERT INTO stylist_feedback
    (feedback_type, target_type, context_type, note, payload)
    VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', ?, ?)`)
    .run('Canvas absorbs water.', payload).lastInsertRowid)
  const preview = await (await fetch(`${baseUrl}/api/feedback-synthesis/preview?ids=${feedbackId}`)).json()
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => ({
    __rawText: 'not valid structured json',
    usage: { input_tokens: 123, output_tokens: 45 },
  })

  const response = await fetch(`${baseUrl}/api/feedback-synthesis/batches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedbackIds: [feedbackId], inputHash: preview.inputHash, authorize: true }),
  })
  assert.equal(response.status, 502)
  const failure = await response.json()
  const batch = db.prepare('SELECT status, actual_usage FROM feedback_synthesis_batches WHERE id = ?').get(failure.batchId)
  assert.equal(batch.status, 'failed')
  const usage = JSON.parse(batch.actual_usage)
  assert.equal(usage.inputTokens, 123)
  assert.equal(usage.outputTokens, 45)
})

test('reviewed general styling failures enter a provenance-linked product-quality lifecycle', async () => {
  const batchId = Number(db.prepare(`
    INSERT INTO feedback_synthesis_batches
      (status, feedback_ids, compact_input, input_hash, provider, model)
    VALUES ('completed', '[]', '', ?, 'test', 'test')
  `).run(`product-finding-${Date.now()}`).lastInsertRowid)
  const draftId = Number(db.prepare(`
    INSERT INTO feedback_synthesis_drafts
      (batch_id, disposition, title, proposed_text, source_feedback_ids, status)
    VALUES (?, 'general_styling_failure', ?, ?, '[404]', 'draft')
  `).run(
    batchId,
    'Canvas footwear selected for wet coastal walking',
    'Absorbent footwear should not be selected for credible wet exposure.',
  ).lastInsertRowid)

  const reviewed = await fetch(`${baseUrl}/api/feedback-synthesis/drafts/${draftId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted' }),
  })
  assert.equal(reviewed.status, 200)
  const finding = db.prepare('SELECT * FROM product_quality_findings WHERE synthesis_draft_id = ?').get(draftId)
  assert.equal(finding.status, 'open')
  assert.deepEqual(JSON.parse(finding.source_feedback_ids), [404])

  const cannotResolveWithoutDestination = await fetch(`${baseUrl}/api/product-quality-findings/${finding.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'resolved' }),
  })
  assert.equal(cannotResolveWithoutDestination.status, 400)

  const resolved = await fetch(`${baseUrl}/api/product-quality-findings/${finding.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'resolved',
      resolutionType: 'shared_rule',
      resolutionNote: 'Added structured wet-exposure footwear validation.',
    }),
  })
  assert.equal(resolved.status, 200)
  assert.equal((await resolved.json()).status, 'resolved')

  const listed = await fetch(`${baseUrl}/api/product-quality-findings`)
  assert.equal(listed.status, 200)
  assert.ok((await listed.json()).some(row => Number(row.id) === Number(finding.id)))
})

test('positive outfit feedback writes transferable logic without garment ids in the evidence block', async () => {
  const response = await fetch(`${baseUrl}/api/stylist-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feedbackType: 'works',
      targetType: 'whole_wardrobe_outfit',
      contextType: 'wardrobe',
      payload: {
        pieceIds: [seeded.top, seeded.bottom],
        formulaFamily: 'compact top + flowing bottom',
        outfit: {
          silhouette: 'defined upper half with movement below',
          dominantDirection: 'graphic relaxed',
        },
        occasion: 'city',
        activity: 'walking',
        season: 'warm',
        mood: 'artistic',
      },
    }),
  })
  assert.equal(response.status, 200)
  const created = await response.json()
  try {
    const payload = JSON.parse(db.prepare('SELECT payload FROM stylist_feedback WHERE id = ?').get(created.id).payload)
    assert.deepEqual(payload.scopedEvidence, {
      version: 1,
      kind: 'outfit_logic',
      verdict: 'works',
      logic: {
        formula: 'compact top + flowing bottom',
        silhouette: 'defined upper half with movement below',
        direction: 'graphic relaxed',
        mood: 'artistic',
      },
      context: { occasion: 'city', activity: 'walking', season: 'warm' },
    })
    assert.equal('subjectPieceId' in payload.scopedEvidence, false)
    assert.equal('pieceIds' in payload.scopedEvidence, false)
    assert.equal('pieces' in payload.scopedEvidence, false)
  } finally {
    db.prepare('DELETE FROM stylist_feedback WHERE id = ?').run(created.id)
  }
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
      const p = path.join(userUploadsDir(), file)
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
  }
})

test('buildWholeWardrobeCandidateOutfits generates candidates tagged with Outfit Missions', async () => {
  const { buildWholeWardrobeCandidateOutfits, weatherProfileFromContext } = await import('../styling-engine/rules.js')
  const { evaluateOutfitStructure } = await import('../styling-engine/outfitValidation.js')
  const structureValid = pieces => evaluateOutfitStructure(pieces, { requireShoes: true }).valid

  const allPieces = [
    { id: 1, name: 'Floral Print Top', category: 'top', pattern_type: 'floral', status: 'active', colors: ['white', 'blue'], styling_rules_learned: [], occasions: ['casual'], notes: 'floral prints' },
    { id: 2, name: 'Structured Denim Pants', category: 'bottom', status: 'active', fit_on_body: 'structured', notes: 'structured raw denim', colors: ['navy'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 3, name: 'Black Leather Boot', category: 'shoes', status: 'active', notes: 'pointed black leather', colors: ['black'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 4, name: 'Silk Cowl Neck Top', category: 'top', status: 'active', reads_as: 'cream', notes: 'cowl neck silk drape top', colors: ['cream'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 5, name: 'Fitted Black Tank', category: 'top', status: 'active', status: 'active', notes: 'fitted knit tank', colors: ['black'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 6, name: 'Linen Wide Pants', category: 'bottom', status: 'active', reads_as: 'cream', notes: 'relaxed linen wide leg', colors: ['cream'], styling_rules_learned: [], occasions: ['casual'] },
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

  const requiredShoeCandidates = buildWholeWardrobeCandidateOutfits(allPieces, {
    occasion: 'casual',
    activeMissions: ['controlled_print', 'structured_soft'],
    requiredPieceId: 3
  })
  assert.ok(requiredShoeCandidates.length > 0, 'required Main piece should still produce local candidates')
  assert.ok(requiredShoeCandidates.every(candidate => candidate.pieceIds.includes(3)), 'local candidates must include required Main piece')
  const requiredDressCandidates = buildWholeWardrobeCandidateOutfits([
    ...allPieces,
    { id: 7, name: 'Plum Wool Dress', category: 'dress', status: 'active', notes: 'simple wool column dress', colors: ['plum'], styling_rules_learned: [], occasions: ['casual'] },
  ], {
    occasion: 'casual',
    activeMissions: ['structured_soft', 'color_anchor'],
    requiredPieceId: 7
  })
  assert.ok(requiredDressCandidates.length > 0, 'dress Main should produce local candidates')
  assert.ok(requiredDressCandidates.every(candidate => candidate.pieceIds.includes(7)), 'dress Main candidates must include the required dress')
  assert.ok(requiredDressCandidates.every(candidate => structureValid(candidate.pieces)), 'dress Main candidates must be complete outfits')
  assert.ok(requiredDressCandidates.every(candidate => !candidate.pieces.some(piece => piece.category === 'bottom')), 'dress Main candidates must not include bottoms')
  const requiredJacketCandidates = buildWholeWardrobeCandidateOutfits([
    ...allPieces,
    { id: 8, name: 'Gray Cropped Jacket', category: 'outerwear', status: 'active', notes: 'structured lightweight jacket', colors: ['gray'], styling_rules_learned: [], occasions: ['casual'] },
  ], {
    occasion: 'casual',
    activeMissions: ['structured_soft', 'controlled_print'],
    requiredPieceId: 8
  })
  assert.ok(requiredJacketCandidates.length > 0, 'jacket Main should produce local candidates')
  assert.ok(requiredJacketCandidates.every(candidate => candidate.pieceIds.includes(8)), 'jacket Main candidates must include the required jacket')
  assert.ok(requiredJacketCandidates.every(candidate => structureValid(candidate.pieces)), 'jacket Main candidates must be complete outfits')
  assert.ok(requiredJacketCandidates.every(candidate => candidate.pieces.some(piece => piece.category === 'top')), 'jacket Main candidates still need a real top')
  assert.ok(requiredJacketCandidates.every(candidate => candidate.pieces.some(piece => piece.category === 'bottom')), 'jacket Main candidates still need a real bottom')
  const requiredJacketStructuralFallback = buildWholeWardrobeCandidateOutfits([
    { id: 9, name: 'Plain Black Top', category: 'top', status: 'active', notes: 'plain cotton top', colors: ['black'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 10, name: 'Plain Gray Trousers', category: 'bottom', status: 'active', notes: 'plain trouser', colors: ['gray'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 11, name: 'Plain Black Flats', category: 'shoes', status: 'active', notes: 'plain flat shoe', colors: ['black'], styling_rules_learned: [], occasions: ['casual'] },
    { id: 12, name: 'Plain Gray Jacket', category: 'outerwear', status: 'active', notes: 'plain jacket', colors: ['gray'], styling_rules_learned: [], occasions: ['casual'] },
  ], {
    occasion: 'casual',
    activeMissions: ['color_anchor'],
    requiredPieceId: 12
  })
  assert.ok(requiredJacketStructuralFallback.length > 0, 'jacket Main should fall back to structural candidates when missions do not match')
  assert.ok(requiredJacketStructuralFallback.every(candidate => candidate.pieceIds.includes(12)), 'structural fallback must still include jacket Main')
  assert.ok(requiredJacketStructuralFallback.every(candidate => structureValid(candidate.pieces)), 'structural fallback candidates must be complete outfits')
  assert.equal(weatherProfileFromContext({ season: 'warm' }).isHot, true)
  const layeredTopMainCandidates = buildWholeWardrobeCandidateOutfits([
    { id: 13, name: 'Fitted Black Tank', category: 'top', status: 'active', notes: 'fitted knit base tank', colors: ['black'], styling_rules_learned: [], occasions: ['city'] },
    { id: 14, name: 'Olive Button-Down Shirt', category: 'top', status: 'active', notes: 'olive button-down worn open as a top layer', colors: ['olive'], styling_rules_learned: [], occasions: ['city'] },
    { id: 15, name: 'Light Beige Linen Pants', category: 'bottom', status: 'active', notes: 'structured wide-leg linen trouser', colors: ['beige'], styling_rules_learned: [], occasions: ['city'] },
    { id: 16, name: 'Brown Leather Sandals', category: 'shoes', status: 'active', notes: 'brown leather strap sandal', colors: ['brown'], styling_rules_learned: [], occasions: ['city'] },
  ], {
    occasion: 'city',
    activeMissions: ['color_anchor'],
    requiredPieceId: 14,
    preserveLayeredTop: true,
    candidateLimit: 12
  })
  assert.ok(layeredTopMainCandidates.some(candidate => candidate.pieceIds.includes(14) && candidate.pieces.filter(piece => piece.category === 'top').length >= 2), 'layer-capable top Main should be able to preserve a two-top saved formula without being recategorized as outerwear')
  // The structural fallback appends the Main piece to a slot combination. When the Main IS the
  // slot (a top/bottom/dress Main, where that slot list is [requiredPiece]), appending blindly
  // put the same garment in the outfit twice. No candidate may list a piece more than once.
  for (const candidateSet of [layeredTopMainCandidates, requiredDressCandidates, requiredShoeCandidates]) {
    for (const candidate of candidateSet) {
      assert.equal(new Set(candidate.pieceIds).size, candidate.pieceIds.length, `candidate must not repeat a piece: ${candidate.pieceIds.join(', ')}`)
    }
  }
})

test('Visual composer occasion profile prompt block and wardrobe coverage contract tests', async () => {
  // An uncovered request now stops before composition instead of asking the model to invent
  // completeness from a roster with no viable outfit path.
  aiCalls = []
  const coverageJson = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'casual',
    activity: 'hiking',
    season: 'current season',
    mood: '',
    limit: 1
  })

  assert.equal(aiCalls.some(c => c.system.includes("personal stylist. You are looking at photos")), false)
  assert.equal(coverageJson.debug.compositionSkipped, 'incomplete_candidate_supply')
  assert.ok(coverageJson.debug.profileCoverage, 'profileCoverage must be populated in debug')
  assert.equal(coverageJson.debug.profileCoverage.tops, 0, 'Seed pool has 0 trail-ready tops')
  assert.equal(coverageJson.debug.profileCoverage.shoes, 0, 'Seed pool has 0 trail-ready shoes')
  assert.ok(coverageJson.feedback.includes('Your wardrobe has limited trail-ready tops and footwear'), 'Feedback must report limited tops and footwear')

  // A covered casual request still reaches composition and carries its profile prompt.
  // Call with casual and empty mood
  aiCalls = []
  await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'casual',
    season: 'current season',
    mood: '',
    limit: 1
  })
  
  const casualCall = aiCalls.find(c => c.system.includes("personal stylist. You are looking at photos"))
  assert.ok(casualCall, 'Should have visual composer call')
  const casualUserMessage = casualCall.messages[0].content.map(part => part?.text || '').join('\n')
  assert.ok(casualUserMessage.includes('Occasion guidance:'), 'Casual is now a ratified occasion profile and should contain guidance')
  assert.equal(casualCall.messages[0].content.some(part => part?.text?.includes('Occasion Vibe: low-key, easy, everyday, unforced')), true)
  assert.equal(casualUserMessage.includes('Mood:'), false, 'Empty mood should be omitted from the visual composer prompt')
  assert.equal(casualUserMessage.includes('artistic minimalist'), false, 'Empty mood must not fall back to artistic minimalist')

  const cityCoverageJson = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'city',
    season: 'current season',
    mood: '',
    limit: 1
  })

  assert.ok(cityCoverageJson.feedback.includes('Your wardrobe has limited city smart casual / everyday tops'), 'Feedback must use the matched occasion label')
  assert.ok(!cityCoverageJson.feedback.includes('trail-specific'), 'Non-hiking coverage feedback must not mention trail-specific pieces')

  // Now seed a complete trail-ready supply to test ample coverage and the hiking prompt.
  for (let i = 0; i < 5; i++) {
    insertPiece({
      name: `cotton hiking tee ${i}`,
      category: 'top',
      occasions: ['casual', 'outdoor'],
      reads_as: 'cotton blend hiking trail tee',
      photo: seeded.photos.top,
      formality: 'everyday',
    })
  }

  for (let i = 0; i < 3; i++) {
    const trailShoeId = insertPiece({
      name: `rugged trail sneakers ${i}`,
      category: 'shoes',
      occasions: ['casual', 'outdoor'],
      reads_as: 'comfortable rugged trail running sneakers',
      photo: seeded.photos.shoe,
      formality: 'everyday',
    })
    db.prepare("UPDATE pieces SET heel_height = 'flat', walk_support = 'high', shoe_type = 'sneaker' WHERE id = ?").run(trailShoeId)
  }

  insertPiece({
    name: 'rugged cotton hiking trousers',
    category: 'bottom',
    occasions: ['casual', 'outdoor'],
    reads_as: 'rugged hiking trail trousers',
    photo: seeded.photos.bottom,
    fabric_category: 'cotton',
    fabric_weight: 'medium',
    formality: 'everyday',
  })

  aiCalls = []
  const ampleCoverageJson = await postJson('/api/ai/generate-wardrobe-outfits-visual', {
    occasion: 'casual',
    activity: 'hiking',
    season: 'current season',
    mood: '',
    limit: 1
  })
  
  assert.equal(ampleCoverageJson.debug.profileCoverage.tops >= 5, true, 'Should now have >= 5 trail-ready tops')
  assert.equal(ampleCoverageJson.debug.profileCoverage.shoes >= 3, true, 'Should now have >= 3 trail-ready shoes')
  assert.ok(!ampleCoverageJson.feedback.includes('limited trail-ready'), 'Feedback must not contain limited coverage note with ample coverage')
  const hikeCall = aiCalls.find(c => c.system.includes("personal stylist. You are looking at photos"))
  assert.ok(hikeCall, 'complete hiking supply should reach the visual composer')
  const hikeUserMessage = hikeCall.messages[0].content.map(part => part?.text || '').join('\n')
  assert.ok(hikeUserMessage.includes('Occasion guidance:'), 'Should contain occasion guidance header')
  assert.ok(hikeUserMessage.includes('use sparingly and justify in watchFor'), 'Should contain use-sparingly block')
  assert.ok(hikeUserMessage.includes('suede'), 'Should list suede in discouraged')
  assert.ok(hikeUserMessage.includes('boot'), 'Should list boots in discouraged')
})

test('prompt cache breakpoint splits the system into stable + volatile blocks', () => {
  const system = `STABLE PREFIX with the manifest\n${PROMPT_CACHE_BREAKPOINT}\nVOLATILE turn state`
  const blocks = systemToAnthropicBlocks(system)
  assert.equal(Array.isArray(blocks), true)
  assert.equal(blocks.length, 2)
  assert.match(blocks[0].text, /STABLE PREFIX/)
  // Cache-efficiency investigation (2026-08-21): this block changes only when the wardrobe itself
  // changes, so it idles across an ordinary chat cadence far more often than it sits within the
  // default 5-minute ephemeral window — moved to the 1-hour cache so a normal pause between turns
  // reads the warm cache (0.1x) instead of paying a full rewrite (1.25x) on nearly every follow-up.
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral', ttl: '1h' })
  assert.match(blocks[1].text, /VOLATILE turn state/)
  assert.equal(blocks[1].cache_control, undefined)

  const plain = systemToPlainText(system)
  assert.equal(plain.includes(PROMPT_CACHE_BREAKPOINT), false)
  assert.match(plain, /STABLE PREFIX[\s\S]*VOLATILE turn state/)

  // No marker → passthrough, unchanged shape.
  assert.equal(systemToAnthropicBlocks('plain system'), 'plain system')
  assert.equal(systemToPlainText('plain system'), 'plain system')
})

test('the moving message-tail breakpoint stays on the default 5-minute TTL, unlike the stable prefix', () => {
  // Anthropic requires any longer-TTL breakpoint to precede shorter ones in the same request. The
  // stable prefix (1-hour, asserted above) already precedes this one in prompt order, so this pins
  // the other half of that contract: the tail that changes every tool-loop iteration within a turn
  // must NOT also carry ttl:'1h' — a turn's own iterations happen well inside 5 minutes, so a longer
  // TTL there buys nothing and would just be an unexamined behavior change.
  const messages = withMovingCacheBreakpoint([{ role: 'user', content: 'plain question' }])
  assert.deepEqual(messages[0].content[0].cache_control, { type: 'ephemeral' })
  assert.equal('ttl' in messages[0].content[0].cache_control, false)
})

test('moving prompt cache breakpoint marks the final message block only', () => {
  const messages = withMovingCacheBreakpoint([
    { role: 'user', content: [{ type: 'text', text: 'first', cache_control: { type: 'ephemeral' } }] },
    { role: 'assistant', content: [{ type: 'text', text: 'middle' }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'last text' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc' } }
      ]
    }
  ])

  assert.equal(messages[0].content[0].cache_control, undefined, 'prior cache marks are stripped')
  assert.equal(messages[1].content[0].cache_control, undefined)
  assert.equal(messages[2].content[0].cache_control, undefined)
  assert.deepEqual(messages[2].content[1].cache_control, { type: 'ephemeral' })
})

test('moving prompt cache breakpoint wraps final string content as a marked text block', () => {
  const messages = withMovingCacheBreakpoint([
    { role: 'user', content: 'plain question' }
  ])

  assert.deepEqual(messages, [{
    role: 'user',
    content: [{ type: 'text', text: 'plain question', cache_control: { type: 'ephemeral' } }]
  }])
})

test('moving prompt cache breakpoint places cache_control on the outer tool_result block', () => {
  const messages = withMovingCacheBreakpoint([
    {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'toolu_123',
        content: [
          { type: 'text', text: 'tool result text' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'xyz' } }
        ]
      }]
    }
  ])

  const toolResult = messages[0].content[0]
  assert.equal(toolResult.type, 'tool_result')
  assert.deepEqual(toolResult.cache_control, { type: 'ephemeral' })
  assert.equal(toolResult.content[0].cache_control, undefined, 'nested tool_result content is not marked')
  assert.equal(toolResult.content[1].cache_control, undefined, 'nested tool_result images are not marked')
})

test('moving prompt cache breakpoint is a no-op for empty messages', () => {
  assert.deepEqual(withMovingCacheBreakpoint([]), [])
})

test('stylist system prompt orders stable blocks before the cache breakpoint and volatile after', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    aiCalls.push({ system, messages })
    return 'Cache-layout answer.'
  }
  await postJson('/api/ai/ask', {
    question: 'Which of my pieces suit a rainy commute?',
    sessionId: 'cache-layout-contract',
    occasion: 'city',
  })
  const call = aiCalls.find(c => String(c.system).includes('WARDROBE MANIFEST'))
  assert.ok(call)
  const sys = String(call.system)
  assert.equal(sys.includes(PROMPT_CACHE_BREAKPOINT), false, 'test path sees the marker-stripped prompt')
  const manifestAt = sys.indexOf('CURRENT WARDROBE TRUTH:')
  const profilesAt = sys.indexOf('OCCASION & CLIMATE PROFILES')
  const dateAt = sys.indexOf('CURRENT DATE / SEASON:')
  const controllerAt = sys.indexOf('CONVERSATION CONTROLLER:')
  const threadStateAt = sys.indexOf('THREAD STATE (STRUCTURED):')
  assert.ok(profilesAt !== -1 && manifestAt !== -1 && dateAt !== -1 && controllerAt !== -1 && threadStateAt !== -1)
  assert.ok(profilesAt < manifestAt, 'profiles precede the manifest in the stable prefix')
  assert.ok(manifestAt < dateAt, 'stable manifest precedes the volatile date block')
  assert.ok(dateAt < controllerAt && controllerAt < threadStateAt, 'volatile blocks follow in order')
})

test('freeform ask injects the wardrobe manifest and structured thread state', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    aiCalls.push({ system, messages })
    return 'Manifest-aware stylist answer.'
  }

  const json = await postJson('/api/ai/ask', {
    question: 'Which of my pieces would suit a gallery evening?',
    sessionId: 'manifest-contract',
    occasion: 'city',
    season: 'warm',
  })
  assert.ok(json.answer)

  const stylistCall = aiCalls.find(call => String(call.system).includes('WARDROBE MANIFEST'))
  assert.ok(stylistCall, 'stylist system prompt must include the wardrobe manifest')
  assert.match(stylistCall.system, /TOPS \(\d+\):/, 'manifest groups pieces with counts')
  assert.ok(stylistCall.system.includes(`#${seeded.top} `), 'manifest lists seeded pieces by exact id')
  assert.ok(
    !stylistCall.system.includes('The full wardrobe list is omitted'),
    'legacy omission notice is replaced by the manifest'
  )
  assert.ok(stylistCall.system.includes('THREAD STATE (STRUCTURED):'), 'thread state block present')
  assert.ok(stylistCall.system.includes('"occasion": "city"'), 'established context is structured JSON')
  assert.ok(stylistCall.system.includes('"season": "warm"'))
})

test('freeform ask restores established context and outfit set on follow-up turns', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    aiCalls.push({ system, messages })
    return 'Stateful stylist answer.'
  }

  await postJson('/api/ai/ask', {
    question: 'Dressing for the gallery tonight.',
    sessionId: 'state-restore-contract',
    occasion: 'gallery / art event',
    weather: 'hot, highs 85F',
    season: 'warm',
    generatedOutfits: [
      {
        label: 'Look one',
        pieceIds: [seeded.top, seeded.shoe],
        pieces: [{ id: seeded.top, name: 'seeded top' }, { id: seeded.shoe, name: 'seeded shoe' }],
      },
      {
        label: 'Look two',
        pieceIds: [seeded.jacket],
        pieces: [{ id: seeded.jacket, name: 'seeded jacket' }],
      },
    ],
  })

  aiCalls = []
  await postJson('/api/ai/ask', {
    question: 'and what about the second one?',
    sessionId: 'state-restore-contract',
    conversationMode: 'followup',
  })

  const followupCall = aiCalls.find(call => String(call.system).includes('THREAD STATE (STRUCTURED):'))
  assert.ok(followupCall, 'follow-up turn still carries structured thread state')
  assert.ok(
    followupCall.system.includes('"occasion": "gallery / art event"'),
    'occasion restored from server-side thread state even though the follow-up body omitted it'
  )
  assert.ok(
    followupCall.system.includes('hot, highs 85F'),
    'weather restored from server-side thread state'
  )
  assert.ok(followupCall.system.includes('Look two'), 'current outfit set restored server-side')
  assert.ok(followupCall.system.includes('"turn_mode": "followup"'))
})

test('propose_outfit rejects pieces not verified this turn, then accepts after retrieval', async () => {
  const toolContext = { generatedOutfits: [], occasion: 'city', season: 'current season', declaredIntent: { want: 'cards' } }
  const outfitArgs = {
    label: 'Verification test',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' }
    ]
  }

  const blocked = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(blocked.status, 'validation_error')
  assert.match(blocked.message, /verify these pieces/)
  assert.match(blocked.message, /fix ALL of the following in one pass/, 'contract issues arrive merged, one bounce')
  assert.deepEqual(blocked.unverifiedIds, [seeded.top, seeded.bottom, seeded.shoe])
  assert.equal(toolContext.generatedOutfits.length, 0, 'no broken card for a recoverable workflow error')

  await executeTool('get_garment_details', { ids: [seeded.top, seeded.bottom, seeded.shoe] }, toolContext)
  const accepted = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(accepted.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 1)
})

test('propose_outfit requires layer pieces to be visually seen this turn', async () => {
  const layerTopId = insertPiece({
    name: 'sheer open knit cardigan',
    category: 'top',
    colors: ['cream'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.top,
    reads_as: 'open airy top layer worn over a base',
    fabric_weight: 'light',
  })
  // Retrieved (text-level) but never SEEN: search without visual attaches no photos.
  const toolContext = {
    generatedOutfits: [],
    occasion: 'city',
    season: 'current season',
    declaredIntent: { want: 'cards' },
    retrievedPieceIds: new Set([seeded.top, seeded.bottom, seeded.shoe, layerTopId])
  }
  const outfitArgs = {
    label: 'Layered look',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: layerTopId, role: 'layer_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' }
    ]
  }

  const blocked = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(blocked.status, 'validation_error')
  assert.match(blocked.message, /visually verified this turn/)
  assert.deepEqual(blocked.unseenLayerIds, [layerTopId])

  // get_garment_details attaches the photo → the layer piece is now seen.
  await executeTool('get_garment_details', { ids: [layerTopId] }, toolContext)
  const accepted = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(accepted.status, 'success')
})

test('propose_outfit allows unknown ordinary layer direction only after both pieces are seen', async () => {
  const ordinaryLayerId = insertPiece({
    name: 'soft silk tee',
    category: 'top',
    colors: ['cream'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.top,
    reads_as: 'soft short sleeve tee',
    fabric_weight: 'light',
  })
  const toolContext = {
    generatedOutfits: [],
    occasion: 'city',
    season: 'current season',
    declaredIntent: { want: 'cards' },
    retrievedPieceIds: new Set([seeded.top, seeded.bottom, seeded.shoe, ordinaryLayerId]),
  }
  const outfitArgs = {
    label: 'Visually judged layer',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: ordinaryLayerId, role: 'layer_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' },
    ],
  }

  const blocked = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(blocked.status, 'validation_error')
  assert.match(blocked.message, /layer direction is unknown/)
  assert.equal(toolContext.freeformDiagnostics.proposeUnknownLayerDirectionBlocks, 1)

  toolContext.visuallySeenPieceIds = new Set([Number(seeded.top), Number(ordinaryLayerId)])
  const accepted = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(accepted.status, 'success')
  assert.equal(toolContext.freeformDiagnostics.proposeVisualLayerDirectionAllows, 1)
})

test('propose_outfit requires sight of both garments when legacy base-layer facts are incomplete', async () => {
  const dependentId = insertPiece({
    name: 'open crochet dependent top',
    category: 'top',
    colors: ['cream'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.top,
    reads_as: 'open crochet overlay worn over a base',
  })
  db.prepare('UPDATE pieces SET needs_base = ? WHERE id = ?').run('yes', dependentId)
  const toolContext = {
    generatedOutfits: [],
    occasion: 'city',
    season: 'current season',
    declaredIntent: { want: 'cards' },
    retrievedPieceIds: new Set([seeded.top, seeded.bottom, seeded.shoe, dependentId]),
  }
  const outfitArgs = {
    label: 'Dependent layer look',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: dependentId, role: 'layer_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' },
    ],
  }

  const unseen = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(unseen.status, 'validation_error')
  assert.match(unseen.message, /required base-layer compatibility is unknown/)
  assert.match(unseen.message, new RegExp(String(dependentId)))
  assert.match(unseen.message, new RegExp(String(seeded.top)))

  toolContext.visuallySeenPieceIds = new Set([Number(dependentId), Number(seeded.top)])
  const accepted = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(accepted.status, 'success')
})

// Spec 26 Part 1: same reason-revision truthfulness check as
// validateSubmittedPlanOutfits, applied to propose_outfit's why_it_works —
// a proposal whose rationale revises itself mid-sentence while `pieces`
// stays the un-revised set is the same failure shape on this path.
test('propose_outfit rejects a why_it_works that revises itself mid-sentence, then accepts a clean rewrite', async () => {
  const toolContext = { generatedOutfits: [], occasion: 'city', season: 'current season', declaredIntent: { want: 'cards' } }
  await executeTool('get_garment_details', { ids: [seeded.top, seeded.bottom, seeded.shoe] }, toolContext)
  const outfitArgs = {
    label: 'Revision test',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' }
    ],
    why_it_works: '**Actually revising:** emerald v-neck top + oatmeal pants would work better here'
  }

  const blocked = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(blocked.status, 'validation_error')
  assert.match(blocked.message, /your reason revises itself mid-sentence/)
  assert.equal(toolContext.generatedOutfits.length, 0)

  const accepted = await executeTool('propose_outfit', {
    ...outfitArgs,
    why_it_works: 'A quiet, structured look worth waiting for sunset to photograph.'
  }, toolContext)
  assert.equal(accepted.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 1)
})

test('prose citations of unverified piece ids force one corrective retry', () => {
  const answer = `Try layering the cream textured knit top (ID ${seeded.top}) under the blouse.`

  const blocked = applyFreeformOutputChecks(answer, { retrievedPieceIds: new Set() })
  assert.equal(blocked.block, true)
  assert.equal(blocked.blockType, 'unverifiedCitation')
  assert.match(blocked.correctionMessage, new RegExp(`ID ${seeded.top}`))

  const retrievedOk = applyFreeformOutputChecks(answer, { retrievedPieceIds: new Set([seeded.top]) })
  assert.equal(retrievedOk.block, false)

  const cardOk = applyFreeformOutputChecks(answer, {
    retrievedPieceIds: new Set(),
    generatedOutfits: [{ pieceIds: [seeded.top] }]
  })
  assert.equal(cardOk.block, false)

  const retryExhausted = applyFreeformOutputChecks(answer, { retrievedPieceIds: new Set() }, new Set(['unverifiedCitation']))
  assert.equal(retryExhausted.block, false, 'only one retry per turn — the loop must not spin')
})

test('declare_intent records the turn contract and acks the capability gap for images', async () => {
  const toolContext = {}
  const cards = await executeTool('declare_intent', { want: 'cards', outfit_count: 3 }, toolContext)
  assert.equal(cards.status, 'success')
  assert.deepEqual(toolContext.declaredIntent, { want: 'cards', outfitCount: 3, turnMode: null })
  assert.match(cards.message, /3 outfits owed/)
  assert.match(cards.message, /verified this turn/)

  const image = await executeTool('declare_intent', { want: 'image' }, toolContext)
  assert.equal(image.status, 'success')
  assert.equal(toolContext.declaredIntent.want, 'image', 're-declaring updates the turn intent')
  assert.match(image.message, /render_preview/)
  assert.match(image.message, /outfit_index/)

  const invalid = await executeTool('declare_intent', { want: 'song' }, toolContext)
  assert.equal(invalid.status, 'validation_error')
})

test('composing tools are blocked until cards intent is declared', async () => {
  const toolContext = {
    generatedOutfits: [],
    occasion: 'city',
    season: 'current season',
    retrievedPieceIds: new Set([seeded.top, seeded.bottom, seeded.shoe])
  }
  const outfitArgs = {
    label: 'Intent gate test',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' }
    ]
  }

  const blockedPropose = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(blockedPropose.status, 'validation_error')
  assert.match(blockedPropose.message, /declare_intent/)

  const blockedGenerate = await executeTool('generate_outfits', { occasion: 'city' }, toolContext)
  assert.equal(blockedGenerate.status, 'validation_error')
  assert.match(blockedGenerate.message, /declare_intent/)

  await executeTool('declare_intent', { want: 'cards' }, toolContext)
  const accepted = await executeTool('propose_outfit', outfitArgs, toolContext)
  assert.equal(accepted.status, 'success')
})

test('output guards consume declared intent instead of phrasing regexes', () => {
  // Declared count drives the outfitCount guard with phrasing no regex would catch.
  const countContext = {
    question: 'you know what I need for the gallery',
    declaredIntent: { want: 'cards', outfitCount: 3, turnMode: null },
    generatedOutfits: [{ label: 'Only card', pieceIds: [seeded.top] }],
    freeformDiagnostics: { proposeCalls: 1, searchCalls: 1 }
  }
  const countCheck = applyFreeformOutputChecks('Here is one look to start.', countContext)
  assert.equal(countCheck.block, true)
  assert.equal(countCheck.blockType, 'outfitCount')
  assert.match(countCheck.correctionMessage, /requested 3 outfit ideas/)

  // A declared text turn answers in prose without penalty.
  const textContext = {
    question: 'outfit ideas?',
    declaredIntent: { want: 'text', outfitCount: null, turnMode: null },
    generatedOutfits: [],
    freeformDiagnostics: { proposeCalls: 0, searchCalls: 1 }
  }
  const textCheck = applyFreeformOutputChecks('Start from texture: pair rough with smooth.', textContext)
  assert.equal(textCheck.block, false)

  // And so does an UNDECLARED one. declare_intent is required by the operations that consume it,
  // not by every turn, so absent declaration is the normal state of a prose answer. The guard used
  // to read a missing declaration plus outfit-ish phrasing as a skipped ceremony, which would now
  // fire on exactly the conversational turns that no longer need to declare -- spending a retry to
  // save a round-trip.
  const undeclaredContext = { ...textContext, declaredIntent: null }
  const undeclaredCheck = applyFreeformOutputChecks('Start from texture: pair rough with smooth.', undeclaredContext)
  assert.equal(undeclaredCheck.block, false, 'an undeclared prose answer is not blocked by question phrasing alone')

  // The real failure is still caught, from the answer rather than the question: prose that lays out
  // an outfit the model never proposed is blocked whether or not the turn declared anything.
  const proseOutfit = 'Quiet Column\n\nTop: Ivory Silk Shell\nBottom: Wide Black Trousers\nShoes: Tan Leather Loafers\n\nThe shell keeps it soft.'
  const undeclaredProseCards = applyFreeformOutputChecks(proseOutfit, undeclaredContext)
  assert.equal(undeclaredProseCards.block, true, 'an outfit written as prose is still caught without a declaration')
  assert.equal(undeclaredProseCards.blockType, 'outfitProse')
})

test('turn contract blocks a declared cards turn that delivered zero cards', () => {
  const ctx = {
    question: 'sort me out for tomorrow',
    declaredIntent: { want: 'cards', outfitCount: null, turnMode: null },
    generatedOutfits: [],
    freeformDiagnostics: { searchCalls: 1, proposeCalls: 0 }
  }

  const blocked = applyFreeformOutputChecks('The gallery look should lean structured.', ctx)
  assert.equal(blocked.block, true)
  assert.equal(blocked.blockType, 'cardsNotDelivered')
  assert.match(blocked.correctionMessage, /declare_intent\(\{ want: 'text' \}\)/)

  // Asking the user something is the model's own clarification judgment — passes.
  const asking = applyFreeformOutputChecks('Before I compose — is this an indoor gallery or an outdoor event?', ctx)
  assert.equal(asking.block, false)

  // One retry per clause: the same kind never blocks twice.
  const retried = applyFreeformOutputChecks('The gallery look should lean structured.', ctx, new Set(['cardsNotDelivered']))
  assert.equal(retried.block, false)

  // A delivered card satisfies the contract.
  const delivered = applyFreeformOutputChecks('Here you go.', {
    ...ctx,
    generatedOutfits: [{ label: 'Card', pieceIds: [seeded.top] }]
  })
  assert.equal(delivered.block, false)
})

test('view_pieces returns truth lines with thumbnails and satisfies the verification gates', async () => {
  const toolContext = { generatedOutfits: [], occasion: 'city', season: 'current season', declaredIntent: { want: 'cards', outfitCount: null, turnMode: null } }

  const viewed = await executeTool('view_pieces', { ids: [seeded.top, seeded.bottom, seeded.shoe, 999999999] }, toolContext)
  const byId = new Map(viewed.map(item => [item.id, item]))
  assert.match(byId.get(seeded.top).truth, new RegExp(`^#${seeded.top} `), 'truth line uses the manifest format')
  assert.ok(byId.get(seeded.top).image, 'thumbnail attached for pieces with photos')
  assert.match(byId.get(999999999).note, /no active piece/)
  assert.ok(toolContext.retrievedPieceIds.has(seeded.top), 'viewing records retrieval')
  assert.ok(toolContext.visuallySeenPieceIds.has(seeded.top), 'viewing records visual verification')

  // One view_pieces call satisfies both the retrieval gate AND the layer visual gate.
  const layerTopId = insertPiece({
    name: 'open weave overshirt cardigan',
    category: 'top',
    colors: ['cream'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.top,
    reads_as: 'airy top layer worn open over a base',
    fabric_weight: 'light',
    opacity: 'open_weave',
  })
  await executeTool('view_pieces', { ids: [layerTopId], size: 'large' }, toolContext)
  const proposed = await executeTool('propose_outfit', {
    label: 'Viewed layered look',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: layerTopId, role: 'layer_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' }
    ]
  }, toolContext)
  assert.equal(proposed.status, 'success')
})

// --- Print-pairing sight gate, propose_outfit path (spec 27 Part 1) --------

test('propose_outfit rejects a blind two-print outfit with view_pieces coaching', async () => {
  const toolContext = { generatedOutfits: [], occasion: 'city', season: 'current season', declaredIntent: { want: 'cards', outfitCount: null, turnMode: null } }
  const printedTopId = insertPiece({ name: 'floral print top', category: 'top', occasions: ['city'], photo: seeded.photos.top, pattern_type: 'floral' })
  const printedBottomId = insertPiece({ name: 'plaid print pants', category: 'bottom', occasions: ['city'], photo: seeded.photos.bottom, pattern_type: 'plaid' })
  // View them (retrieval verified) but never call view_pieces (no sight).
  await executeTool('search_wardrobe', { query: 'print' }, toolContext)
  toolContext.retrievedPieceIds = new Set([printedTopId, printedBottomId, seeded.shoe])

  const blocked = await executeTool('propose_outfit', {
    label: 'Blind print pairing',
    pieces: [
      { id: printedTopId, role: 'primary_top' },
      { id: printedBottomId, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' }
    ]
  }, toolContext)
  assert.equal(blocked.status, 'validation_error')
  assert.match(blocked.message, /pairs 2 printed pieces/)
  assert.match(blocked.message, /call view_pieces on/)
})

test('propose_outfit accepts the same two-print outfit once both pieces have been visually seen', async () => {
  const toolContext = { generatedOutfits: [], occasion: 'city', season: 'current season', declaredIntent: { want: 'cards', outfitCount: null, turnMode: null } }
  const printedTopId = insertPiece({ name: 'floral print top', category: 'top', occasions: ['city'], photo: seeded.photos.top, pattern_type: 'floral' })
  const printedBottomId = insertPiece({ name: 'plaid print pants', category: 'bottom', occasions: ['city'], photo: seeded.photos.bottom, pattern_type: 'plaid' })
  await executeTool('view_pieces', { ids: [printedTopId, printedBottomId, seeded.shoe] }, toolContext)

  const proposed = await executeTool('propose_outfit', {
    label: 'Seen print pairing',
    pieces: [
      { id: printedTopId, role: 'primary_top' },
      { id: printedBottomId, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' }
    ]
  }, toolContext)
  assert.equal(proposed.status, 'success')
})

test('propose_outfit is not gated by a printed scarf accessory paired with one printed top', async () => {
  const toolContext = { generatedOutfits: [], occasion: 'city', season: 'current season', declaredIntent: { want: 'cards', outfitCount: null, turnMode: null } }
  const printedTopId = insertPiece({ name: 'floral print top', category: 'top', occasions: ['city'], photo: seeded.photos.top, pattern_type: 'floral' })
  const scarfId = insertPiece({ name: 'printed silk scarf', category: 'accessory', occasions: ['city'], photo: seeded.photos.top, pattern_type: 'geometric' })
  await executeTool('view_pieces', { ids: [printedTopId, seeded.bottom, scarfId, seeded.shoe] }, toolContext)

  const proposed = await executeTool('propose_outfit', {
    label: 'Print top with printed scarf',
    pieces: [
      { id: printedTopId, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: scarfId, role: 'accessory' },
      { id: seeded.shoe, role: 'shoes' }
    ]
  }, toolContext)
  assert.equal(proposed.status, 'success', `printed accessory must not gate the outfit: ${JSON.stringify(proposed)}`)
})

test('render_preview renders a card from this turn and attaches the board for the chat', async () => {
  const toolContext = {
    occasion: 'city',
    season: 'current season',
    declaredIntent: { want: 'image', outfitCount: null, turnMode: null },
    generatedOutfits: [{
      label: 'Render me',
      pieceIds: [seeded.top, seeded.bottom, seeded.shoe],
      pieces: [],
      previewOnly: true
    }]
  }
  const rendered = await executeTool('render_preview', { outfit_index: 1 }, toolContext)
  assert.equal(rendered.status, 'success')
  assert.ok(rendered.imageUrl, 'render returns an image url')
  assert.equal(toolContext.renderedBoards.length, 1)
  assert.equal(toolContext.renderedBoards[0].label, 'Render me')
  assert.ok(toolContext.renderedBoards[0].imageUrl)
  assert.equal(toolContext.freeformDiagnostics.renderCalls, 1)
})

test('render_preview is blocked during a cards-only turn', async () => {
  const toolContext = {
    declaredIntent: { want: 'cards', outfitCount: null, turnMode: null },
    generatedOutfits: [{
      label: 'Cards only',
      pieceIds: [seeded.top, seeded.bottom, seeded.shoe]
    }]
  }
  const blocked = await executeTool('render_preview', { outfit_index: 1 }, toolContext)
  assert.equal(blocked.status, 'validation_error')
  assert.match(blocked.message, /want: 'image'/)
  assert.equal(toolContext.renderedBoards, undefined)
})

test('render_preview refuses unverified piece_ids and bad indexes', async () => {
  const toolContext = { declaredIntent: { want: 'image', outfitCount: null, turnMode: null }, generatedOutfits: [] }
  const unverified = await executeTool('render_preview', { piece_ids: [seeded.top, seeded.bottom] }, toolContext)
  assert.equal(unverified.status, 'validation_error')
  assert.match(unverified.message, /verified this turn/)

  const nothing = await executeTool('render_preview', {}, toolContext)
  assert.equal(nothing.status, 'validation_error')

  // Verified ids (e.g. from view_pieces) render fine.
  await executeTool('view_pieces', { ids: [seeded.top, seeded.bottom] }, toolContext)
  const ok = await executeTool('render_preview', { piece_ids: [seeded.top, seeded.bottom], label: 'Verified pair' }, toolContext)
  assert.equal(ok.status, 'success')
})

test('turn contract blocks a declared image turn that never rendered', () => {
  const ctx = {
    question: 'can you generate a rough preview using those choices?',
    declaredIntent: { want: 'image', outfitCount: null, turnMode: null },
    generatedOutfits: [{ label: 'Card', pieceIds: [seeded.top] }],
    freeformDiagnostics: { searchCalls: 1, proposeCalls: 1 }
  }
  const blocked = applyFreeformOutputChecks('Here are two directions I like for the layering.', ctx)
  assert.equal(blocked.block, true)
  assert.equal(blocked.blockType, 'imageNotDelivered')
  assert.match(blocked.correctionMessage, /render_preview/)

  const rendered = applyFreeformOutputChecks('Here is the render.', {
    ...ctx,
    freeformDiagnostics: { ...ctx.freeformDiagnostics, renderCalls: 1 }
  })
  assert.equal(rendered.block, false)
})

test('wardrobe_coverage returns exact grouped counts', async () => {
  const toolContext = {}
  const byCategory = await executeTool('wardrobe_coverage', {}, toolContext)
  assert.equal(byCategory.group_by, 'category')
  assert.ok(byCategory.counts.top >= 1)
  assert.ok(byCategory.total_pieces >= 4)

  const shoesOnly = await executeTool('wardrobe_coverage', { group_by: 'formality', category: 'shoes' }, toolContext)
  assert.equal(shoesOnly.total_pieces, Object.values(shoesOnly.counts).reduce((a, b) => a + b, 0))
})

test('anchor pieces bypass suitability gates while supports stay gated', async () => {
  const experimentalId = insertPiece({
    name: 'experimental fringe vest',
    category: 'top',
    colors: ['tan'],
    occasions: ['casual'],
    photo: seeded.photos.top,
    reads_as: 'statement fringe layer',
    recommendation_status: 'experimental',
    fabric_weight: 'light',
  })
  const baseContext = () => ({
    generatedOutfits: [],
    occasion: 'casual',
    season: 'current season',
    declaredIntent: { want: 'cards', outfitCount: null, turnMode: null },
    retrievedPieceIds: new Set([experimentalId, seeded.bottom, seeded.shoe]),
  })
  const outfitPieces = (asAnchor) => ([
    { id: experimentalId, role: 'primary_top', ...(asAnchor ? { anchor: true } : {}) },
    { id: seeded.bottom, role: 'primary_bottom' },
    { id: seeded.shoe, role: 'shoes' }
  ])

  // Unanchored: the experimental piece is rejected by the trust gate.
  const rejected = await executeTool('propose_outfit', { label: 'No anchor', pieces: outfitPieces(false) }, baseContext())
  assert.equal(rejected.status, 'validation_error')
  assert.match(rejected.issues.join(' '), /experimental/)

  // Anchored (user asked to style this piece): the same outfit passes.
  const ctx = baseContext()
  const accepted = await executeTool('propose_outfit', { label: 'Anchored', pieces: outfitPieces(true) }, ctx)
  assert.equal(accepted.status, 'success')
  const card = ctx.generatedOutfits.at(-1)
  assert.deepEqual(card.anchorPieceIds, [experimentalId], 'card records which piece was the user-requested anchor')
})

test('a corrected retry with the same pieces supersedes its own earlier rejected attempt instead of duplicating the card', async () => {
  const experimentalId = insertPiece({
    name: 'experimental fringe vest',
    category: 'top',
    colors: ['tan'],
    occasions: ['casual'],
    photo: seeded.photos.top,
    reads_as: 'statement fringe layer',
    recommendation_status: 'experimental',
    fabric_weight: 'light',
  })
  const ctx = {
    generatedOutfits: [],
    occasion: 'casual',
    season: 'current season',
    declaredIntent: { want: 'cards', outfitCount: null, turnMode: null },
    retrievedPieceIds: new Set([experimentalId, seeded.bottom, seeded.shoe]),
  }
  const outfitPieces = (asAnchor) => ([
    { id: experimentalId, role: 'primary_top', ...(asAnchor ? { anchor: true } : {}) },
    { id: seeded.bottom, role: 'primary_bottom' },
    { id: seeded.shoe, role: 'shoes' }
  ])

  // Same toolContext across both calls, same turn: first attempt rejected, retry corrects it.
  const rejected = await executeTool('propose_outfit', { label: 'No anchor', pieces: outfitPieces(false) }, ctx)
  assert.equal(rejected.status, 'validation_error')
  assert.equal(ctx.generatedOutfits.length, 1, 'the rejected attempt is recorded for tuning visibility')
  assert.equal(ctx.generatedOutfits[0].broken, true)

  const accepted = await executeTool('propose_outfit', { label: 'Anchored', pieces: outfitPieces(true) }, ctx)
  assert.equal(accepted.status, 'success')

  assert.equal(ctx.generatedOutfits.length, 1, 'the superseded broken card must not linger alongside the corrected one')
  const survivor = ctx.generatedOutfits[0]
  assert.equal(survivor.broken, undefined, 'the surviving card is the corrected, non-broken proposal')
  assert.match(survivor.engineNote, /experimental/, 'the original rejection reason carries forward as an honest note')
})

test('a one-piece correction supersedes this turn’s rejected attempt even when the model renames the direction', async () => {
  const experimentalId = insertPiece({
    name: 'experimental renamed retry top',
    category: 'top',
    colors: ['black'],
    occasions: ['casual'],
    photo: seeded.photos.top,
    reads_as: 'experimental statement top',
    recommendation_status: 'experimental',
    fabric_weight: 'medium',
  })
  const ctx = {
    generatedOutfits: [],
    occasion: 'casual',
    season: 'indoor',
    declaredIntent: { want: 'cards', outfitCount: 1, turnMode: 'followup' },
    retrievedPieceIds: new Set([experimentalId, seeded.top, seeded.bottom, seeded.shoe]),
  }

  const rejected = await executeTool('propose_outfit', {
    label: 'Casual Indoors — Dark Tonal',
    occasion: 'casual',
    season: 'indoor',
    pieces: [
      { id: experimentalId, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' },
    ],
  }, ctx)
  assert.equal(rejected.status, 'validation_error')
  assert.equal(ctx.generatedOutfits[0].retryPending, true)

  const accepted = await executeTool('propose_outfit', {
    label: 'Casual Indoors — Stripe & Charcoal',
    occasion: 'casual',
    season: 'indoor',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' },
    ],
  }, ctx)
  assert.equal(accepted.status, 'success')
  assert.equal(ctx.generatedOutfits.length, 1, 'renaming the corrected direction must not preserve the failed attempt as a second look')
  assert.equal(ctx.generatedOutfits[0].label, 'Casual Indoors — Stripe & Charcoal')
  assert.equal(ctx.generatedOutfits[0].broken, undefined)
  assert.match(ctx.generatedOutfits[0].engineNote, /substitution/)
})

test('a corrected retry that swaps out the specific rejected piece supersedes the broken card too', async () => {
  // Same direction (same label), same top/bottom, but the shoe that failed the gate is
  // replaced with a different shoe rather than being re-approved via anchor:true. Exact
  // piece-ID matching alone would miss this and render two competing "Direction" cards.
  const ctx = {
    generatedOutfits: [{
      label: 'Warm Plaid Hero',
      broken: true,
      rejectionReason: 'brown ankle boots: hot weather: insulating fiber',
      pieceIds: [seeded.top, seeded.bottom, seeded.boot],
      pieces: [
        { id: seeded.top, name: 'black button detail top' },
        { id: seeded.bottom, name: 'light beige linen wide-leg pants' },
        { id: seeded.boot, name: 'brown ankle boots' },
      ],
    }],
    occasion: 'casual',
    season: 'current season',
    declaredIntent: { want: 'cards', outfitCount: null, turnMode: null },
    retrievedPieceIds: new Set([seeded.top, seeded.bottom, seeded.shoe]),
  }

  const accepted = await executeTool('propose_outfit', {
    label: 'Warm Plaid Hero',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' },
    ],
  }, ctx)
  assert.equal(accepted.status, 'success')

  assert.equal(ctx.generatedOutfits.length, 1, 'the broken "Warm Plaid Hero" must not linger alongside the corrected one')
  const survivor = ctx.generatedOutfits[0]
  assert.equal(survivor.broken, undefined)
  assert.match(survivor.engineNote, /substitution/, 'a piece swap is described as a substitution, not a plain re-approval')
  assert.match(survivor.engineNote, /brown ankle boots/, 'names the piece that was rejected')
  assert.match(survivor.engineNote, /cream slip-on shoes/, 'names what it was swapped in for')
})

test('store_user_correction dedupes identical notes', async () => {
  const note = 'I never wear ankle boots in summer.'
  await executeTool('store_user_correction', { note, context_type: 'general' }, {})
  await executeTool('store_user_correction', { note, context_type: 'general' }, {})
  const rows = db.prepare('SELECT COUNT(*) AS n FROM stylist_feedback WHERE note = ?').get(note)
  assert.equal(rows.n, 1, 'the same live note must not stack in feedback memory')
})

test('search_wardrobe normalizes plural category filters instead of returning silent zeros', async () => {
  const toolContext = {}
  const plural = await executeTool('search_wardrobe', { category: 'tops' }, toolContext)
  const singular = await executeTool('search_wardrobe', { category: 'top' }, toolContext)
  const pluralIds = plural.filter(item => item.id).map(item => item.id).sort()
  const singularIds = singular.filter(item => item.id).map(item => item.id).sort()
  assert.ok(singularIds.length > 0, 'seeded wardrobe has tops')
  assert.deepEqual(pluralIds, singularIds, '"tops" must return the same pieces as "top"')

  const unknown = await executeTool('search_wardrobe', { category: 'blousewear' }, toolContext)
  assert.equal(unknown.length, 1)
  assert.match(unknown[0].note, /Valid categories/, 'unknown category is corrected, not silently empty')
})

test('light summer maxi dresses pass the hot-weather gate; heavy ones stay blocked', async () => {
  const { wholeWardrobePieceTrustDecision } = await import('../styling-engine/rules.js')
  const hot = { occasion: 'casual', weatherProfile: { isHot: true, isCold: false } }

  const silkMaxi = { id: 9201, name: 'botanical print maxi dress', category: 'dress', fabric_weight: 'light', fabric_category: 'silk', length_hits_at: 'maxi' }
  assert.equal(wholeWardrobePieceTrustDecision(silkMaxi, hot).reasons.includes('hot weather: insulating piece'), false,
    'a light silk summer maxi is not insulating')

  const velvetMaxi = { id: 9202, name: 'heavy velvet maxi dress', category: 'dress', fabric_weight: 'heavy', fabric_category: 'velvet', length_hits_at: 'maxi' }
  assert.ok(wholeWardrobePieceTrustDecision(velvetMaxi, hot).reasons.includes('hot weather: insulating piece'),
    'heavy full-length dresses remain blocked')
})

test('render_preview resolves outfit_index against the thread outfit set on a fresh turn', async () => {
  const toolContext = {
    occasion: 'casual',
    season: 'current season',
    declaredIntent: { want: 'image', outfitCount: null, turnMode: null },
    generatedOutfits: [],
    currentOutfitSet: [
      { index: 1, label: 'Look one', piece_ids: [seeded.top, seeded.shoe] },
      { index: 2, label: 'Look two', piece_ids: [seeded.top, seeded.bottom, seeded.shoe] }
    ],
    knownOutfitPieceIds: [seeded.top, seeded.bottom, seeded.shoe]
  }
  const rendered = await executeTool('render_preview', { outfit_index: 2 }, toolContext)
  assert.equal(rendered.status, 'success')
  assert.equal(toolContext.renderedBoards[0].label, 'Look two')
})

test('structure rejection teaches completion instead of a bare retry', async () => {
  const toolContext = {
    generatedOutfits: [],
    declaredIntent: { want: 'cards', outfitCount: null, turnMode: null },
    retrievedPieceIds: new Set([seeded.top, seeded.jacket])
  }
  const rejected = await executeTool('propose_outfit', {
    label: 'Pair only',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.jacket, role: 'outerwear' }
    ]
  }, toolContext)
  assert.equal(rejected.status, 'validation_error')
  assert.match(rejected.message, /COMPLETE the outfit instead of resending it/)
  assert.match(rejected.message, /answer that part in prose citing verified IDs/)
})

test('shoes and open-front layers are not hot-weather insulating pieces (round-3 rulings)', async () => {
  const { wholeWardrobePieceTrustDecision } = await import('../styling-engine/rules.js')
  const hot = { occasion: 'casual', weatherProfile: { isHot: true, isCold: false } }

  // Live false positive: heavy-substance flats are shoes, not body insulation.
  const flats = { id: 9301, name: 'sleek black cutout flats', category: 'shoes', fabric_weight: 'heavy', fabric_category: 'synthetic' }
  assert.equal(wholeWardrobePieceTrustDecision(flats, hot).reasons.includes('hot weather: insulating piece'), false,
    'shoe fabric_weight describes the shoe, not warmth')

  // Owner ruling 2026-07-12: open-front cardigans are exempt as layers.
  const cardigan = { id: 9302, name: 'dark grey knit draped cardigan', category: 'top', fabric_weight: 'medium', sleeve_length: 'long', reads_as: 'open draped cardigan layer' }
  assert.equal(wholeWardrobePieceTrustDecision(cardigan, hot).reasons.includes('hot weather: insulating piece'), false,
    'open-front cardigans pass the hot gate')

  // Floors stay: heavy tops and warm fibers still block.
  const heavyTop = { id: 9303, name: 'chunky heavy knit sweater', category: 'top', fabric_weight: 'heavy' }
  assert.ok(wholeWardrobePieceTrustDecision(heavyTop, hot).reasons.includes('hot weather: insulating piece'))
  const woolCardigan = { id: 9304, name: 'wool wrap cardigan', category: 'top', fabric_weight: 'medium', fabric_category: 'wool', fiber_content: ['wool'], reads_as: 'cozy wool cardigan' }
  assert.ok(wholeWardrobePieceTrustDecision(woolCardigan, hot).reasons.includes('hot weather: insulating fiber'))

  // A closed medium long-sleeve top (not a layer piece) remains blocked — pending any broader ruling.
  const longSleeve = { id: 9305, name: 'white ruffled long sleeve top', category: 'top', fabric_weight: 'medium', sleeve_length: 'long' }
  assert.ok(wholeWardrobePieceTrustDecision(longSleeve, hot).reasons.includes('hot weather: insulating piece'))
})

test('precompose-seeded turns keep their source flag and inform the declare ack', async () => {
  const toolContext = {
    generatedOutfits: [{ label: 'Trip look', pieceIds: [seeded.top, seeded.bottom, seeded.shoe], pieces: [], source: 'trip_precompose' }],
    source: 'whole_wardrobe',
    sourceLocked: true,
    occasion: 'city',
    season: 'current season',
    declaredIntent: { want: 'cards', outfitCount: null, turnMode: null },
    retrievedPieceIds: new Set([seeded.top, seeded.bottom, seeded.shoe])
  }
  const ack = await executeTool('declare_intent', { want: 'cards' }, toolContext)
  assert.match(ack.message, /ALREADY composed for this turn/, 'declare ack warns about pre-seeded cards')

  const proposed = await executeTool('propose_outfit', {
    label: 'Extra look',
    pieces: [
      { id: seeded.top, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' }
    ]
  }, toolContext)
  assert.equal(proposed.status, 'success')
  assert.equal(toolContext.source, 'whole_wardrobe', 'propose_outfit must not clobber a precompose-locked source')
})

test('suggest_slot_swaps creates current-outfit variants without one propose_outfit call per option', async () => {
  const rustTop = insertPiece({
    name: 'rust ribbed tank top',
    category: 'top',
    colors: ['orange'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.top,
    reads_as: 'bright rust ribbed tank',
    silhouette: 'fitted',
    fabric_weight: 'light',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const greenTop = insertPiece({
    name: 'emerald v-neck top',
    category: 'top',
    colors: ['green'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.top,
    reads_as: 'clean emerald sleeveless shell',
    silhouette: 'relaxed',
    fabric_weight: 'light',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const toolContext = {
    occasion: 'city',
    season: 'current season',
    question: 'Give me other tops for Coast Floral.',
    declaredIntent: { want: 'cards', outfitCount: null, turnMode: 'followup' },
    generatedOutfits: [],
    currentOutfitSet: [
      { index: 1, label: 'Coast Floral', piece_ids: [seeded.top, seeded.bottom, seeded.shoe], stylingInstructions: 'Tuck the top in loosely.' }
    ],
    knownOutfitPieceIds: [seeded.top, seeded.bottom, seeded.shoe]
  }

  const result = await executeTool('suggest_slot_swaps', {
    outfit_label: 'Coast Floral',
    slot_role: 'primary_top',
    replacement_ids: [rustTop, greenTop],
    limit: 2,
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 2)
  assert.equal(toolContext.generatedOutfits[0].source, 'slot_swap')
  assert.equal(toolContext.generatedOutfits[0].pieceIds.includes(seeded.top), false, 'original top is replaced')
  assert.ok(toolContext.generatedOutfits[0].pieceIds.includes(seeded.bottom), 'bottom carries forward')
  assert.ok(toolContext.generatedOutfits[0].pieceIds.includes(seeded.shoe), 'shoes carry forward')
  assert.deepEqual(
    toolContext.generatedOutfits.map(outfit => outfit.debug.swappedIn.id).sort((a, b) => a - b),
    [rustTop, greenTop].sort((a, b) => a - b)
  )
  assert.equal(toolContext.freeformDiagnostics.slotSwapCalls, 1)
  assert.equal(toolContext.freeformDiagnostics.proposeCalls, 0)
  assert.equal(toolContext.sourceLocked, true)
  assert.equal(toolContext.slotSwapCompleted, true)
  assert.deepEqual(stylistToolsForTurn(toolContext), [], 'slot swap completion closes the tool loop for this turn')
  assert.equal(toolContext.generatedOutfits[0].stylingInstructions, 'Tuck the top in loosely.', 'styling_instructions carries forward from the base outfit into the swap variant')

  const duplicate = await executeTool('propose_outfit', {
    label: 'Duplicate swap',
    pieces: [
      { id: rustTop, role: 'primary_top' },
      { id: seeded.bottom, role: 'primary_bottom' },
      { id: seeded.shoe, role: 'shoes' },
    ]
  }, toolContext)
  assert.equal(duplicate.status, 'validation_error')
  assert.match(duplicate.message, /suggest_slot_swaps already composed/)
  assert.equal(toolContext.generatedOutfits.length, 2, 'blocked duplicate proposal does not append more cards')
})

test('suggest_slot_swaps returns one best standalone top and excludes needs_base candidates by default', async () => {
  const dependentTop = insertPiece({
    name: 'cream open crochet top',
    category: 'top',
    colors: ['cream'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.top,
    reads_as: 'open crochet overlay top',
    fabric_weight: 'light',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const standaloneTop = insertPiece({
    name: 'emerald standalone shell',
    category: 'top',
    colors: ['green'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.top,
    reads_as: 'clean emerald sleeveless shell',
    fabric_weight: 'light',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  db.prepare('UPDATE pieces SET needs_base = ? WHERE id = ?').run('yes', dependentTop)
  const toolContext = {
    occasion: 'city',
    season: 'current season',
    question: 'I like Coast Floral. can you give me other options for the top?',
    declaredIntent: { want: 'cards', outfitCount: 3, turnMode: 'followup' },
    generatedOutfits: [],
    currentOutfitSet: [
      { index: 1, label: 'Coast Floral', piece_ids: [seeded.top, seeded.bottom, seeded.shoe] }
    ],
    knownOutfitPieceIds: [seeded.top, seeded.bottom, seeded.shoe]
  }

  const result = await executeTool('suggest_slot_swaps', {
    outfit_label: 'Coast Floral',
    slot_role: 'primary_top',
    replacement_ids: [dependentTop, standaloneTop],
    limit: 3,
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 1)
  assert.equal(result.options.length, 1)
  assert.equal(toolContext.generatedOutfits[0].debug.swappedIn.id, standaloneTop)
  assert.equal(toolContext.generatedOutfits[0].pieceIds.includes(dependentTop), false, 'needs_base top is not used as a standalone top swap')
  assert.equal(toolContext.declaredIntent.outfitCount, 1)
})

test('suggest_slot_swaps treats descriptive query text as ranking, not an exact filter', async () => {
  const travelTop = insertPiece({
    name: 'cool green stripe tank',
    category: 'top',
    colors: ['green'],
    occasions: ['travel', 'city', 'casual'],
    photo: seeded.photos.top,
    reads_as: 'cool grey green stripe tank lightweight travel top',
    fabric_weight: 'light',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const toolContext = {
    occasion: 'travel',
    season: 'hot',
    question: 'Can you give me another top for travel day?',
    declaredIntent: { want: 'cards', outfitCount: 1, turnMode: 'followup' },
    generatedOutfits: [],
    currentOutfitSet: [
      { index: 1, label: 'Travel Day', piece_ids: [seeded.top, seeded.bottom, seeded.shoe] }
    ],
    knownOutfitPieceIds: [seeded.top, seeded.bottom, seeded.shoe]
  }

  const result = await executeTool('suggest_slot_swaps', {
    outfit_index: 1,
    slot_role: 'primary_top',
    replacement_ids: [travelTop],
    occasion: 'travel',
    activity: 'walking',
    season: 'hot',
    query: 'comfortable travel top lightweight',
    limit: 1,
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 1)
  assert.equal(toolContext.generatedOutfits[0].debug.swappedIn.id, travelTop)
})

test('suggest_slot_swaps treats color as an exact structured preference, not a reads_as substring filter', async () => {
  const taggedRedTop = insertPiece({
    name: 'scarlet cotton tank', category: 'top', colors: ['red'], occasions: ['city', 'casual'],
    photo: seeded.photos.top, reads_as: 'simple cotton tank', fabric_weight: 'light',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const structuredFalsePositive = insertPiece({
    name: 'green architectural shell', category: 'top', colors: ['green'], occasions: ['city', 'casual'],
    photo: seeded.photos.top, reads_as: 'structured textured shell', fabric_weight: 'light',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const nonRedAlternative = insertPiece({
    name: 'navy cotton tank', category: 'top', colors: ['navy'], occasions: ['city', 'casual'],
    photo: seeded.photos.top, reads_as: 'simple cotton tank', fabric_weight: 'light',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const toolContext = {
    occasion: 'city', season: 'current season',
    question: 'Give me three different tops for Coast Floral, preferably red.',
    declaredIntent: { want: 'cards', outfitCount: 3, turnMode: 'followup' }, generatedOutfits: [],
    currentOutfitSet: [{ index: 1, label: 'Coast Floral', piece_ids: [seeded.top, seeded.bottom, seeded.shoe] }],
    knownOutfitPieceIds: [seeded.top, seeded.bottom, seeded.shoe]
  }
  const result = await executeTool('suggest_slot_swaps', {
    outfit_label: 'Coast Floral', slot_role: 'primary_top',
    replacement_ids: [structuredFalsePositive, nonRedAlternative, taggedRedTop], color: 'red', limit: 3,
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 3, 'a color preference must not delete non-matching candidates')
  assert.equal(toolContext.generatedOutfits[0].debug.swappedIn.id, taggedRedTop, 'the exact structured color match gets the preference bonus')
  assert.deepEqual(toolContext.generatedOutfits[0].debug.colorPreference, { requested: 'red', matched: true, score: 14 })
  const falsePositiveCard = toolContext.generatedOutfits.find(outfit => outfit.debug.swappedIn.id === structuredFalsePositive)
  assert.deepEqual(falsePositiveCard.debug.colorPreference, { requested: 'red', matched: false, score: 0 }, 'structured/texture prose must not count as red')
  assert.ok(toolContext.generatedOutfits.some(outfit => outfit.debug.swappedIn.id === nonRedAlternative), 'an off-palette but workable alternative remains eligible')

  const lightBlueTop = insertPiece({
    name: 'powder cotton tank', category: 'top', colors: ['light blue'], occasions: ['city', 'casual'],
    photo: seeded.photos.top, reads_as: 'simple cotton tank', fabric_weight: 'light',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const blueSearch = await executeTool('search_wardrobe', { category: 'top', color: 'blue' }, {})
  assert.ok(blueSearch.some(piece => Number(piece.id) === lightBlueTop), 'blue search retains compound structured tags such as light blue')
})

test('suggest_slot_swaps treats singular different-shoes followups as one replacement even if the model asks for three', async () => {
  const blackLoafer = insertPiece({
    name: 'black city loafers',
    category: 'shoes',
    colors: ['black'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.shoe,
    reads_as: 'quiet black walking loafer',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const navySlip = insertPiece({
    name: 'navy slip shoes',
    category: 'shoes',
    colors: ['navy'],
    occasions: ['city', 'casual'],
    photo: seeded.photos.shoe,
    reads_as: 'quiet navy slip shoe',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
  })
  const toolContext = {
    occasion: 'city',
    season: 'current season',
    question: 'Same outfit, different shoes?',
    declaredIntent: { want: 'cards', outfitCount: 3, turnMode: 'followup' },
    generatedOutfits: [],
    currentOutfitSet: [
      { index: 1, label: 'Grounded Graphic Column', piece_ids: [seeded.top, seeded.bottom, seeded.shoe] }
    ],
    knownOutfitPieceIds: [seeded.top, seeded.bottom, seeded.shoe]
  }

  const result = await executeTool('suggest_slot_swaps', {
    outfit_index: 1,
    slot_role: 'shoes',
    replacement_ids: [blackLoafer, navySlip, seeded.boot],
    limit: 3,
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 1)
  assert.equal(result.options.length, 1)
  assert.equal(toolContext.generatedOutfits[0].pieceIds.includes(seeded.shoe), false, 'original shoe is replaced')
})

test('freeform ask retries the model once when prose cites unverified ids', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    aiCalls.push({ system, messages })
    return `Your black button detail top (ID ${seeded.top}) would work well here.`
  }

  const json = await postJson('/api/ai/ask', {
    question: 'What do you think about that top?',
    sessionId: 'citation-retry-contract',
  })

  // The ordered contract (owner ruling 2026-08-20). The guard runs on prose that still carries the
  // citation -- proven by the retry below -- and the citation is stripped only at the last boundary
  // before the user sees it. Both halves matter: asserting only the strip would pass even if the
  // guard had been disarmed, and asserting only the retry would pass with database handles on screen.
  assert.ok(!/\bID\s*:?\s*\d+/i.test(json.answer), `final prose must show no piece IDs: ${json.answer}`)
  assert.match(json.answer, /black button detail top/, 'the garment is still named, just not by handle')
  const stylistCalls = aiCalls.filter(call => String(call.system).includes('WARDROBE MANIFEST'))
  assert.equal(stylistCalls.length, 2, 'blocked once for the unverified citation, then answered on the retry')
  const correction = stylistCalls[1].messages.at(-1)
  const correctionText = Array.isArray(correction?.content)
    ? correction.content.map(part => part?.text || '').join('\n')
    : String(correction?.content || '')
  assert.match(correctionText, /without verifying them this turn/)
})

// docs/search-payload-spec.md §5 — the fallback that keeps trimming safe on a wardrobe above the
// manifest cap, where the manifest is omitted entirely and a trimmed row would be the model's ONLY
// view of a garment.
test('search_wardrobe trims to judgment only when the manifest is actually in the prompt', async () => {
  const withManifest = await executeTool('search_wardrobe', { category: 'shoes', occasion: 'casual' },
    { wardrobeManifestIncluded: true, freeformDiagnostics: {} })
  const withoutManifest = await executeTool('search_wardrobe', { category: 'shoes', occasion: 'casual' },
    { wardrobeManifestIncluded: false, freeformDiagnostics: {} })

  const trimmed = withManifest.find(p => p.id)
  const full = withoutManifest.find(p => p.id)
  assert.ok(trimmed && full)

  // Trimmed: judgment plus the join key into the manifest.
  assert.ok('ruleFit' in trimmed && 'weatherFit' in trimmed, 'per-request judgment always survives')
  assert.equal(trimmed.silhouette, undefined, 'stable truth is left to the cached manifest')
  assert.equal(trimmed.fabric_category, undefined)
  assert.equal(trimmed.occasions, undefined)

  // Without a manifest to join against, the full row is the model's only view and must survive.
  assert.ok('silhouette' in full && 'fabric_category' in full && 'occasions' in full,
    'above the manifest cap the full row is the only description the model gets')

  // Either way the roster itself is identical — this changes description, never selection.
  assert.deepEqual(withManifest.filter(p => p.id).map(p => p.id), withoutManifest.filter(p => p.id).map(p => p.id))
  assert.deepEqual(withManifest.filter(p => p.id).map(p => p.ruleFit), withoutManifest.filter(p => p.id).map(p => p.ruleFit))
})

// docs/search-payload-spec.md §7 lever 2 — batching categories into one call.
// Three searches differing only by category cost three provider round-trips, and each re-reads the
// whole conversation AND the cached prefix. Stated structurally rather than as a prompt asking the
// model to batch, because prompt-only guidance has failed every time it has been tried here.
test('search_wardrobe accepts several categories in one call, with the image budget per category', async () => {
  const ctx = () => ({ wardrobeManifestIncluded: true, freeformDiagnostics: {}, retrievedPieceIds: new Set(), visuallySeenPieceIds: new Set() })
  const args = extra => ({ occasion: 'casual', visual: true, ...extra })

  const separate = []
  for (const category of ['top', 'bottom', 'shoes']) {
    separate.push(...(await executeTool('search_wardrobe', args({ category }), ctx())).filter(p => p.id))
  }
  const batched = (await executeTool('search_wardrobe', args({ category: ['top', 'bottom', 'shoes'] }), ctx())).filter(p => p.id)

  assert.deepEqual(batched.map(p => p.id).sort((a, b) => a - b), separate.map(p => p.id).sort((a, b) => a - b),
    'one batched call returns exactly what three separate calls did')

  // Visual grounding is a founding principle: batching must not hand the model a third of the
  // photos. The cap applies per category, not per call.
  const imagesPerCategory = {}
  for (const p of batched.filter(p => p.image)) imagesPerCategory[p.category] = (imagesPerCategory[p.category] || 0) + 1
  const separatePerCategory = {}
  for (const p of separate.filter(p => p.image)) separatePerCategory[p.category] = (separatePerCategory[p.category] || 0) + 1
  assert.deepEqual(imagesPerCategory, separatePerCategory, 'each category keeps its own image budget')

  // A bad value in the array is reported rather than silently widening the search.
  const bad = await executeTool('search_wardrobe', args({ category: ['top', 'hats'] }), ctx())
  assert.match(bad[0].note || '', /Unknown category "hats"/)

  // A single string still works unchanged.
  const single = (await executeTool('search_wardrobe', args({ category: 'shoes' }), ctx())).filter(p => p.id)
  assert.ok(single.length && single.every(p => p.category === 'shoes'))
})

// The turn's shape, not just its size. The run row recorded 6 iterations and 7 tool calls and never
// which call happened in which, so a turn's structure had to be inferred from the model's prose.
test('the tool sequence records which tools ran in which provider iteration', async () => {
  const { recordFreeformToolIteration } = await import('../styling-engine/tools.js')
  const toolContext = {}
  recordFreeformToolIteration(toolContext, ['declare_intent', 'search_wardrobe'])
  recordFreeformToolIteration(toolContext, ['search_wardrobe'])
  recordFreeformToolIteration(toolContext, ['propose_outfit', 'propose_outfit', 'propose_outfit'])
  assert.equal(toolContext.freeformDiagnostics.toolSequence,
    'declare_intent,search_wardrobe;search_wardrobe;propose_outfit,propose_outfit,propose_outfit')
  // Iterations are ';'-separated and calls within one are ','-separated, so the number of provider
  // round-trips is countable from the string alone.
  assert.equal(toolContext.freeformDiagnostics.toolSequence.split(';').length, 3)
  recordFreeformToolIteration(toolContext, [])
  assert.equal(toolContext.freeformDiagnostics.toolSequence.split(';').length, 3, 'an empty iteration adds nothing')
})

// Review finding: the current question reached the model twice on every freeform request. The
// client appends it to chatHistory before sending, and the server appends it AGAIN as the final
// user turn built from `question`. Pure duplication, and repeating the latest wording verbatim
// also overweights it against the rest of the turn's context.
test('the question being asked is not sent twice', async () => {
  const { buildStylistConversationPayload } = await import('../styling-engine/core.js')
  const question = 'What should I wear for a nature walk?'

  const payload = await buildStylistConversationPayload({
    question,
    conversationMode: 'new_request',
    sessionId: 'dup-test',
    history: [
      { role: 'user', content: 'Earlier question about shoes.' },
      { role: 'assistant', content: 'Earlier answer.' },
      { role: 'user', content: question },   // what the client actually sends
    ],
  })
  const userTurns = payload.messages.filter(m => m.role === 'user')
  const asText = m => (typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join(' '))
  const occurrences = userTurns.filter(m => asText(m).includes(question)).length
  assert.equal(occurrences, 1, 'the question appears exactly once in the model input')
  assert.equal(payload.messages.length, 3, 'earlier history is untouched')
  assert.match(asText(payload.messages[0]), /Earlier question about shoes/)

  // A trailing assistant turn, or an older repeat of the same wording, must NOT be dropped.
  const keeps = await buildStylistConversationPayload({
    question,
    conversationMode: 'new_request',
    sessionId: 'dup-test-2',
    history: [
      { role: 'user', content: question },        // genuinely asked before
      { role: 'assistant', content: 'A previous answer.' },
    ],
  })
  assert.equal(keeps.messages.length, 3, 'an earlier identical question is left in place')
  assert.equal(keeps.messages[0].role, 'user')
  assert.equal(keeps.messages[1].role, 'assistant')
})

test('bounded multi-look routing is unconditional in the freeform controller prompt', async () => {
  // Default-on since 2026-08-19; the WARDROBE_FREEFORM_ATOMIC_MULTILOOK flag is gone. Setting it is
  // a no-op, asserted here so a stale env var can never be read as switching this off.
  const { buildStylistConversationPayload } = await import('../styling-engine/core.js')
  {
    const bounded = await buildStylistConversationPayload({
      question: 'Give me three outfits for one dinner.',
      conversationMode: 'new_request',
      sessionId: 'atomic-prompt-default'
    })
    // The guidance is unchanged in substance; it now lives in the volatile controller instead of in
    // the tool schemas. See docs/freeform-prompt-cache-levers.md lever 1.
    assert.match(String(bounded.system), /BOUNDED MULTI-LOOK EXCEPTION/)
    assert.match(String(bounded.system), /do NOT call declare_intent and do NOT call search_wardrobe/)
    assert.match(String(bounded.system), /defaults to limit:2/)
    assert.match(String(bounded.system), /Never flatten distinct contexts/)

    // …and it is scoped to a fresh request, which the volatile block can do for free.
    const followup = await buildStylistConversationPayload({
      question: 'why does that work?', conversationMode: 'followup', sessionId: 'atomic-prompt-followup'
    })
    assert.doesNotMatch(String(followup.system), /BOUNDED MULTI-LOOK EXCEPTION/)
  }
})

// docs/freeform-prompt-cache-levers.md lever 1, and the reason it exists.
//
// Anthropic's cached prefix is ordered tools -> system -> messages, so the breakpoint on the system
// block covers the tools ahead of it: one byte that varies in a tool description throws away the
// WHOLE prefix, not just the tools. A per-mode amendment used to move 97.8% of a 31,259-character
// block, so a thread going from a new request to a follow-up discarded ~35k tokens of warm prefix.
//
// Adding "just one line" to a tool description for a particular kind of turn is the easiest way to
// reintroduce that, and it is invisible in review. This makes it fail instead.
test('tool schemas are byte-identical across turn modes, so the cached prefix survives', () => {
  const modes = ['new_request', 'followup', 'correction', 'explanation', 'preference_reaction', undefined]
  const serialized = modes.map(turnMode => JSON.stringify(stylistToolsForTurn({ turnMode })))
  for (let i = 1; i < serialized.length; i++) {
    assert.equal(serialized[i], serialized[0],
      `tool schemas differ between ${modes[0]} and ${modes[i]} — that invalidates the whole cached prefix`)
  }

  // No tool description may carry request-mode policy: that belongs to the volatile controller.
  for (const tool of stylistToolsForTurn({ turnMode: 'new_request' })) {
    assert.doesNotMatch(tool.description, /this turn only|in a follow-up|on a new request|BOUNDED EXCEPTION/i,
      `${tool.name}'s description carries per-turn policy`)
  }

  // Offering FEWER tools is a different thing and stays legitimate: which tools exist is a
  // turn-ending boundary, not policy text inside a cached schema.
  assert.equal(stylistToolsForTurn({ atomicMultiLookCompleted: true }).length, 0)
  assert.equal(stylistToolsForTurn({ slotSwapCompleted: true }).length, 0)
})
