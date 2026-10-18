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

const { getOpenAIImageToolModel, openAIImageGenerationTool } = await import('../styling-engine/core.js')
const coreSource = fs.readFileSync(new URL('../styling-engine/core.js', import.meta.url), 'utf8')

test('the image tool names a model by default and honours the override', () => {
  delete process.env.OPENAI_IMAGE_TOOL_MODEL
  assert.equal(getOpenAIImageToolModel(), 'gpt-image-1.5')
  assert.deepEqual(openAIImageGenerationTool('1024x1536'), {
    type: 'image_generation', model: 'gpt-image-1.5', size: '1024x1536', quality: 'medium',
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
