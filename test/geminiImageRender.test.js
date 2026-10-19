// IMAGE_PROVIDER=gemini routes the single-outfit render to Google's image model
// (styling-engine/geminiImage.js). Offline: the Google client is a fake that records the request.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-gemini-image-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const {
  getImageRenderProvider,
  getGeminiImageModel,
  openAIContentPartsToGeminiInput,
  geminiInteractionImage,
  estimateGeminiImageCostUsd,
  renderWithGeminiImageModel,
} = await import('../styling-engine/geminiImage.js')

const coreSource = fs.readFileSync(new URL('../styling-engine/core.js', import.meta.url), 'utf8')

const CONTENT_PARTS = [
  { type: 'input_image', image_url: 'data:image/jpeg;base64,CALIBRATION' },
  { type: 'input_text', text: 'Identity/proportion reference only' },
  { type: 'input_text', text: 'Next image is REQUIRED wardrobe reference: trousers — worn photo' },
  { type: 'input_image', image_url: 'data:image/jpeg;base64,WORN' },
  { type: 'input_text', text: 'Generate one realistic full-outfit styling image' },
]

test('Gemini is used only when asked for and a Gemini key resolves', () => {
  const saved = { provider: process.env.IMAGE_PROVIDER, key: process.env.GEMINI_API_KEY }
  delete process.env.IMAGE_PROVIDER
  process.env.GEMINI_API_KEY = 'test-key'
  assert.equal(getImageRenderProvider(), 'openai')
  process.env.IMAGE_PROVIDER = 'gemini'
  assert.equal(getImageRenderProvider(), 'gemini')
  delete process.env.GEMINI_API_KEY
  assert.equal(getImageRenderProvider(), 'openai')
  process.env.IMAGE_PROVIDER = saved.provider ?? ''
  if (saved.key === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = saved.key
})

test('the same photos and captions reach Gemini, in the same order', () => {
  assert.deepEqual(openAIContentPartsToGeminiInput(CONTENT_PARTS), [
    { type: 'image', data: 'CALIBRATION', mime_type: 'image/jpeg' },
    { type: 'text', text: 'Identity/proportion reference only' },
    { type: 'text', text: 'Next image is REQUIRED wardrobe reference: trousers — worn photo' },
    { type: 'image', data: 'WORN', mime_type: 'image/jpeg' },
    { type: 'text', text: 'Generate one realistic full-outfit styling image' },
  ])
  assert.throws(() => openAIContentPartsToGeminiInput([{ type: 'input_image', image_url: 'https://x/y.jpg' }]))
})

test('the final image is the last model output, not an interim thinking image', () => {
  assert.equal(geminiInteractionImage({ output_image: { data: 'FINAL', mime_type: 'image/png' } }).data, 'FINAL')
  const interaction = {
    steps: [
      { type: 'thought', summary: [{ type: 'image', data: 'INTERIM' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'here' }, { type: 'image', data: 'FIRST' }] },
      { type: 'model_output', content: [{ type: 'image', data: 'LAST', mime_type: 'image/png' }] },
    ],
  }
  assert.equal(geminiInteractionImage(interaction).data, 'LAST')
  assert.equal(geminiInteractionImage({ steps: [] }), null)
})

test('cost uses Google\'s published rates, thinking billed as output', () => {
  const cost = estimateGeminiImageCostUsd('gemini-nano-banana-2.1', { total_input_tokens: 10000, total_output_tokens: 1680, total_thought_tokens: 320 })
  assert.equal(Number(cost.toFixed(4)), Number(((10000 * 1.5 + 2000 * 30) / 1e6).toFixed(4)))
  assert.equal(estimateGeminiImageCostUsd('unknown-model', { total_input_tokens: 1 }), null)
  assert.equal(estimateGeminiImageCostUsd('gemini-nano-banana-2.1', null), null)
})

test('one call carries the model, a 2:3 portrait, and the full input', async () => {
  delete process.env.GEMINI_IMAGE_MODEL
  delete process.env.GEMINI_IMAGE_SIZE
  let request = null
  const ai = { interactions: { create: async (body) => {
    request = body
    return { model: body.model, status: 'completed', usage: { total_input_tokens: 9000, total_output_tokens: 1680 }, output_image: { data: 'PNGDATA', mime_type: 'image/png' }, steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Rendered.' }] }] }
  } } }
  const rendered = await renderWithGeminiImageModel({ contentParts: CONTENT_PARTS, ai })
  assert.equal(request.model, 'gemini-nano-banana-2.1')
  assert.equal(getGeminiImageModel(), 'gemini-nano-banana-2.1')
  assert.deepEqual(request.response_format, { type: 'image', aspect_ratio: '2:3', image_size: '2K' })
  assert.equal(request.input.length, CONTENT_PARTS.length)
  assert.equal(rendered.base64, 'PNGDATA')
  assert.equal(rendered.evidence.modelText, 'Rendered.')
  assert.equal(rendered.evidence.usage.total_input_tokens, 9000)
  assert.ok(rendered.estimatedCostUsd > 0)
})

test('a response with no image fails loudly so the render falls back to the collage', async () => {
  const ai = { interactions: { create: async () => ({ status: 'failed', steps: [] }) } }
  await assert.rejects(renderWithGeminiImageModel({ contentParts: CONTENT_PARTS, ai }), /did not return an image/)
})

test('the single-outfit render branches to Gemini before building an OpenAI client', () => {
  const start = coreSource.indexOf('export async function createWholeWardrobeOutfitImage(')
  const body = coreSource.slice(start, coreSource.indexOf('\nexport ', start + 10))
  assert.ok(body.indexOf("imageProvider === 'gemini'") > 0)
  assert.ok(body.indexOf("imageProvider === 'gemini'") < body.indexOf('new OpenAI('))
  assert.match(body, /imageProvider === 'openai' && !hasOpenAiKey\(\)/)
})
