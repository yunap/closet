// The gpt-4o renderers once sent OpenAI's image_generation tool no model, so OpenAI chose it, and
// a provider-side change replaced the tuned look without any change here (thread_1791604684826,
// 2026-10-17). Every tool request must name its model, and each render must record which one.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-image-tool-model-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { getOpenAIImageToolModel, openAIImageGenerationTool, openAIImageResponseEvidence, wholeWardrobeImagePrompt, editorialImagePrompt, savedOutfitImagePrompt, openAIContentPartsToImageEdit, runOpenAIImageEditFromContentParts, CALIBRATED_PERSON_LINE } = await import('../styling-engine/core.js')
const coreSource = fs.readFileSync(new URL('../styling-engine/core.js', import.meta.url), 'utf8')

test('the image tool names a model by default and honours the override', () => {
  delete process.env.OPENAI_IMAGE_TOOL_MODEL
  assert.equal(getOpenAIImageToolModel(), 'gpt-image-2.5-flare')
  assert.deepEqual(openAIImageGenerationTool('1024x1536'), {
    type: 'image_generation', model: 'gpt-image-2.5-flare', size: '1024x1536', quality: 'medium',
  })
  process.env.OPENAI_IMAGE_TOOL_MODEL = 'gpt-image-2'
  assert.equal(openAIImageGenerationTool('1024x1024').model, 'gpt-image-2')
  delete process.env.OPENAI_IMAGE_TOOL_MODEL
})

test('no renderer builds its own image_generation tool without the shared helper', () => {
  const literalTools = coreSource.match(/tools:\s*\[\s*\{\s*type:\s*'image_generation'/g) || []
  assert.equal(literalTools.length, 0)
  const helperCalls = coreSource.match(/tools:\s*\[openAIImageGenerationTool\(/g) || []
  assert.equal(helperCalls.length, 3)
})

test('every render that records its image size also records the model it asked for', () => {
  const sizeRecords = (coreSource.match(/timings\.imageSize = /g) || []).length
  const modelRecords = (coreSource.match(/timings\.imageModel = getOpenAIImageToolModel\(\)/g) || []).length
  assert.ok(sizeRecords > 0)
  assert.equal(modelRecords, sizeRecords)
})

test('each render keeps what OpenAI reports it ran, without the image bytes', () => {
  const evidence = openAIImageResponseEvidence(
    { model: 'gpt-4o-2024-08-06' },
    { type: 'image_generation_call', id: 'ig_1', result: 'BASE64', revised_prompt: 'a woman in grey' },
  )
  assert.deepEqual(evidence, {
    responseModel: 'gpt-4o-2024-08-06',
    imageCall: { type: 'image_generation_call', id: 'ig_1', revised_prompt: 'a woman in grey' },
  })
  const recorded = (coreSource.match(/timings\.imageEvidence = (openAIImageResponseEvidence\(|imageEvidence\b|edited\.evidence\b)/g) || []).length
  const sizeRecords = (coreSource.match(/timings\.imageSize = /g) || []).length
  assert.equal(recorded, sizeRecords)
})

test('the outfit render says the woman is the calibrated person whenever a real photo is attached', () => {
  const pieces = [{ id: 1, name: 'grey linen wide-leg trousers', category: 'bottom' }]
  const anchored = wholeWardrobeImagePrompt({ outfit: { label: 'x' }, pieces, hasIdentityReference: true })
  assert.match(anchored, /The woman is the person in the identity\/proportion calibration photos/)
  assert.doesNotMatch(anchored, /single adult woman/)
  const plain = wholeWardrobeImagePrompt({ outfit: { label: 'x' }, pieces })
  assert.match(plain, /single adult woman/)
  assert.doesNotMatch(plain, /calibration photos/)
})

test('the construction list states a tagged neckline, so a shawl collar survives the rewrite', () => {
  const jacket = { id: 250, name: 'charcoal textured cropped jacket', category: 'outerwear', neckline: 'shawl', silhouette: 'structured' }
  const tee = { id: 2, name: 'plain tee', category: 'top', neckline: 'none' }
  const prompt = wholeWardrobeImagePrompt({ outfit: { label: 'x' }, pieces: [jacket, tee] })
  assert.match(prompt, /charcoal textured cropped jacket: [^\n]*keep its shawl neckline\/collar exactly as in the reference photo/)
  assert.doesNotMatch(prompt, /plain tee: [^\n]*neckline\/collar/)
})

test('every render that fetches calibration photos records which ones it used', () => {
  const fetches = (coreSource.match(/const calibrationRefs = await getCalibrationReferenceImagesForGeneration\(/g) || []).length
  const records = (coreSource.match(/timings\.calibrationReferenceIds = calibrationRefs\.map\(img => img\.id\)/g) || []).length
  assert.ok(fetches >= 3)
  assert.equal(records, fetches)
})

// "Generate outfit image" skips gpt-4o: its rewrite dropped the identity line on 2026-10-19, and the
// ideal-piece rewrites described her from the style profile's subject sentence instead.
test('the outfit render sends our prompt to the image edit endpoint word for word', async () => {
  const png = Buffer.from('fake-png')
  const parts = [
    { type: 'input_image', image_url: `data:image/jpeg;base64,${png.toString('base64')}` },
    { type: 'input_text', text: 'Identity/proportion reference only.' },
    { type: 'input_text', text: 'Next image is REQUIRED wardrobe reference: grey trousers.' },
    { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}` },
    { type: 'input_text', text: 'PROMPT BODY with the calibrated person line.' },
  ]
  const converted = openAIContentPartsToImageEdit(parts)
  assert.equal(converted.images.length, 2)
  assert.deepEqual(converted.images.map(img => img.mime), ['image/jpeg', 'image/png'])
  const lines = converted.prompt.split('\n')
  assert.deepEqual(lines.slice(1), ['[Image 1]', 'Identity/proportion reference only.', 'Next image is REQUIRED wardrobe reference: grey trousers.', '[Image 2]', 'PROMPT BODY with the calibrated person line.'])

  let sent = null
  let contextModel = null
  const { getAiTelemetryContext } = await import('../lib/aiCallTelemetry.js')
  const client = { images: { edit: async (args) => { sent = args; contextModel = getAiTelemetryContext().imageRequestModel; return { created: 1, quality: 'medium', size: '1024x1536', usage: { input_tokens: 10 }, data: [{ b64_json: 'QUJD' }] } } } }
  const { base64, evidence, estimatedCostUsd } = await runOpenAIImageEditFromContentParts({ client, contentParts: parts, size: '1024x1536' })
  assert.equal(contextModel, 'gpt-image-2.5-flare')
  assert.ok(Math.abs(estimatedCostUsd - 10 * 8 / 1e6) < 1e-12)
  assert.equal(base64, 'QUJD')
  assert.equal(sent.model, 'gpt-image-2.5-flare')
  assert.equal(sent.image.length, 2)
  assert.equal(sent.prompt, converted.prompt)
  assert.equal(sent.quality, 'medium')
  assert.deepEqual(evidence, { path: 'images.edit', requestModel: 'gpt-image-2.5-flare', imageCount: 2, promptChars: converted.prompt.length, created: 1, quality: 'medium', size: '1024x1536', usage: { input_tokens: 10 } })
})

test('the single-outfit and saved-outfit renderers no longer hand their prompt to gpt-4o', () => {
  for (const name of ['createWholeWardrobeOutfitImage', 'createSavedOutfitImage']) {
    const start = coreSource.indexOf(`export async function ${name}(`)
    const body = coreSource.slice(start, coreSource.indexOf('\nexport ', start + 10))
    assert.match(body, /runOpenAIImageEditFromContentParts\(/, name)
    assert.doesNotMatch(body, /responses\.create/, name)
  }
})

test('saved-outfit images say the woman is the calibrated person whenever a real photo is attached', () => {
  const pieces = [{ id: 1, name: 'grey linen wide-leg trousers', category: 'bottom' }]
  assert.ok(savedOutfitImagePrompt({ outfit: { label: 'x' }, pieces, hasIdentityReference: true }).includes(CALIBRATED_PERSON_LINE))
  assert.ok(!savedOutfitImagePrompt({ outfit: { label: 'x' }, pieces }).includes(CALIBRATED_PERSON_LINE))
})

test('ideal-piece renders say the woman is the calibrated person whenever a real photo is attached', () => {
  const selectedPiece = { id: 7, name: 'mauve corduroy pants', category: 'bottom' }
  const anchored = editorialImagePrompt({ selectedPiece, direction: {}, occasion: 'casual', season: 'fall', hasIdentityReference: true })
  assert.ok(anchored.includes(CALIBRATED_PERSON_LINE))
  const plain = editorialImagePrompt({ selectedPiece, direction: {}, occasion: 'casual', season: 'fall' })
  assert.ok(!plain.includes(CALIBRATED_PERSON_LINE))
  const sheetStart = coreSource.indexOf('export async function createIdealAdditionsComparisonSheetImage(')
  const sheet = coreSource.slice(sheetStart, coreSource.indexOf('\nexport ', sheetStart + 10))
  assert.match(sheet, /CALIBRATED_PERSON_LINE/)
  assert.match(sheet, /promptTextFor\(calibrationRefs\.some\(img => img\.kind === 'real_photo'\)\)/)
})
