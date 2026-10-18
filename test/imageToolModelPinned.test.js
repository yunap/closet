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

const { getOpenAIImageToolModel, openAIImageGenerationTool, openAIImageResponseEvidence, wholeWardrobeImagePrompt } = await import('../styling-engine/core.js')
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
  assert.equal(helperCalls.length, 5)
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
  const recorded = (coreSource.match(/timings\.imageEvidence = /g) || []).length
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
