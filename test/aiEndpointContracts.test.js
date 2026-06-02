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

  if (text.includes('Outfit Composer') || text.includes('Outfit Gate')) {
    return {
      outfits: [selectedPieceOutfit()],
      rejected: [],
      skip: '',
      saveableLearning: 'mock selected-piece learning',
    }
  }

  if (text.includes('personal visual stylist agent') || text.includes('whole-wardrobe outfit composer')) {
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
  assert.equal(json.pipeline, 'visual_candidate_reviewer_composer_evaluator_renderer_handoff')
  assert.ok(Array.isArray(json.structuredOutfits))
  assert.ok(json.structuredOutfits.length >= 1)
  assert.ok(json.structuredOutfits[0].pieceIds.includes(seeded.bottom))
  assert.ok('visualCritic' in json.debug)
})

test('whole-wardrobe generator returns cards and records resettable session memory', async () => {
  const json = await postJson('/api/ai/generate-wardrobe-outfits', {
    occasion: 'city',
    season: 'current season',
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

  const response = await fetch(`${baseUrl}/api/ai/whole-wardrobe-session-memory`, { method: 'DELETE' })
  const resetJson = await response.json()
  assert.equal(response.status, 200)
  assert.equal(resetJson.mode, 'reset_whole_wardrobe_session_memory')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM whole_wardrobe_sessions').get().count, 0)
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
  assert.match(latestUserMessage.content[1].text, /Current turn mode: explanation/)
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
  assert.match(lastCall.system, /acknowledge the correction/)
  assert.match(lastCall.system, /revise only the relevant mistaken point/)
  assert.match(lastCall.system, /Do not regenerate the full prior list/)
  assert.match(lastCall.system, /1–3 short sentences/)
  assert.match(lastCall.system, /User is correcting a previous seasonal assumption/)
  assert.equal(typeof latestUserMessage.content, 'string')
  assert.match(latestUserMessage.content, /Current turn mode: correction/)
  assert.match(latestUserMessage.content, /do not restart the prior task/)
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
  assert.match(lastCall.system, /Turn directive: This turn is a correction or challenge/)
  assert.match(lastCall.system, /Do not regenerate the prior list/)
  assert.equal(typeof latestUserMessage.content, 'string')
  assert.match(latestUserMessage.content, /Current turn mode: correction/)
  assert.match(latestUserMessage.content, /Turn directive: This turn is a correction or challenge/)
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
  assert.match(latestUserMessage.content[1].text, /Current turn mode: explanation/)
  assert.match(latestUserMessage.content[1].text, /Turn directive: This turn asks for explanation or context inspection/)
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
  assert.match(lastCall.system, /Turn directive: This turn asks for explanation/)
  assert.match(lastCall.system, /Explain how the prior answer was made/)
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
  const lastCall = aiCalls.at(-1)
  assert.match(lastCall.system, /ask exactly one clear clarifying question/)
  assert.match(lastCall.system, /do not generate a placeholder list/)
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

test('executeTool get_garment_details loads text and base64 photo blocks', async () => {
  // Write a dummy temp image to uploads directory to mock the photo file
  const topPhotoFilename = 'mock-top-photo.jpg'
  const mockFilePath = path.join(uploadsDir, topPhotoFilename)
  
  // Ensure uploads directory exists and write a valid dummy 1x1 JPEG to satisfy sharp resizing
  fs.mkdirSync(uploadsDir, { recursive: true })
  const dummy1x1Jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
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



