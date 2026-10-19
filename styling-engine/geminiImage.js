// Google's image model as an alternative renderer for the single-outfit render
// (createWholeWardrobeOutfitImage), switched on by IMAGE_PROVIDER=gemini and off by default.
//
// Why it exists (2026-10-18): the OpenAI path hands our prompt to gpt-4o, which rewrites it before
// the image model sees it, and leaves edit-versus-generate to the tool. On 2026-10-17 both of those
// broke the renders (docs/engine-behaviour-map.md, "The producers"). Google's image model takes our
// prompt and reference photos directly, in one call, with no rewrite step.
//
// It is sent exactly what the OpenAI path is sent, in the same order and with the same captions —
// calibration photos, then each garment's worn and hanger photos, then the prompt. Google documents
// up to 14 reference images, up to 10 "images of objects" and up to 4 "images of characters"; a
// four-garment render is 10 images, six of them showing the owner. "Character" is not defined and
// exceeding it is not documented as an error, so nothing is trimmed until a render shows it must be.
import { GoogleGenAI } from '@google/genai'
import { resolveGeminiKey } from '../lib/apiKeys.js'

// Google's published Standard-tier rates (ai.google.dev/gemini-api/docs/pricing, read 2026-10-18).
// Output is priced at the image rate; the page lists no separate rate for the model's thinking
// tokens, so the estimate treats every output token as an image token, which can only overstate.
export const GEMINI_IMAGE_PRICING = {
  'gemini-nano-banana-2.1': { inputPerMTok: 1.5, outputPerMTok: 30 },
  'gemini-3.1-flash-image': { inputPerMTok: 0.5, outputPerMTok: 60 },
  'gemini-3-pro-image': { inputPerMTok: 2, outputPerMTok: 120 },
}

export function getImageRenderProvider() {
  const wanted = String(process.env.IMAGE_PROVIDER || '').trim().toLowerCase()
  return wanted === 'gemini' && resolveGeminiKey() ? 'gemini' : 'openai'
}

export function getGeminiImageModel() {
  return String(process.env.GEMINI_IMAGE_MODEL || '').trim() || 'gemini-nano-banana-2.1'
}

// 2:3 is the shape of the OpenAI renders (1024x1536). 2K rather than 1K so the garment detail the
// owner judges renders by is not reduced; GEMINI_IMAGE_SIZE overrides.
export function getGeminiImageResponseFormat() {
  return { type: 'image', aspect_ratio: '2:3', image_size: String(process.env.GEMINI_IMAGE_SIZE || '').trim() || '2K' }
}

// The render builds OpenAI Responses content parts; Google takes the same sequence as
// { type: 'text' } / { type: 'image', data, mime_type } blocks.
export function openAIContentPartsToGeminiInput(contentParts = []) {
  return contentParts.map(part => {
    if (part?.type === 'input_text') return { type: 'text', text: part.text }
    if (part?.type === 'input_image') {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(part.image_url || '')
      if (!match) throw new Error('Gemini image input must be an inline data URL')
      return { type: 'image', data: match[2], mime_type: match[1] }
    }
    throw new Error(`Unsupported content part for Gemini image input: ${part?.type}`)
  })
}

// The last image the model produced. interim images from its thinking steps are not the answer.
export function geminiInteractionImage(interaction) {
  if (interaction?.output_image?.data) return interaction.output_image
  const outputs = (interaction?.steps || []).filter(step => step?.type === 'model_output')
  const images = outputs.flatMap(step => (step.content || []).filter(block => block?.type === 'image' && block.data))
  return images.at(-1) || null
}

export function estimateGeminiImageCostUsd(model, usage) {
  const rates = GEMINI_IMAGE_PRICING[model]
  if (!rates || !usage) return null
  const input = Number(usage.total_input_tokens ?? usage.input_tokens) || 0
  // Thinking cannot be switched off on these models and is reported apart from the output.
  const output = (Number(usage.total_output_tokens ?? usage.output_tokens) || 0) + (Number(usage.total_thought_tokens) || 0)
  if (!input && !output) return null
  return (input * rates.inputPerMTok + output * rates.outputPerMTok) / 1e6
}

// What Google reports it ran, never the image bytes: the counterpart of openAIImageResponseEvidence.
export function geminiImageResponseEvidence(interaction, model) {
  const text = (interaction?.steps || [])
    .filter(step => step?.type === 'model_output')
    .flatMap(step => (step.content || []).filter(block => block?.type === 'text').map(block => block.text))
    .join('\n').trim()
  return {
    provider: 'gemini',
    requestedModel: model,
    responseModel: interaction?.model || null,
    status: interaction?.status || null,
    usage: interaction?.usage || null,
    modelText: text || null,
  }
}

export async function renderWithGeminiImageModel({ contentParts, ai = null }) {
  const model = getGeminiImageModel()
  const client = ai || new GoogleGenAI({ apiKey: resolveGeminiKey() })
  const interaction = await client.interactions.create({
    model,
    input: openAIContentPartsToGeminiInput(contentParts),
    response_format: getGeminiImageResponseFormat(),
  })
  const image = geminiInteractionImage(interaction)
  if (!image?.data) throw new Error(`Gemini ${model} did not return an image (status ${interaction?.status || 'unknown'})`)
  return {
    base64: image.data,
    mimeType: image.mime_type || 'image/png',
    model,
    estimatedCostUsd: estimateGeminiImageCostUsd(model, interaction?.usage),
    evidence: geminiImageResponseEvidence(interaction, model),
  }
}
