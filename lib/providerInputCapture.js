// Diagnostic-only, off by default: writes what a provider call actually received to disk so a
// live comparison ("did Gemini and Sonnet get the same input?") can be answered from real captured
// data instead of inference. Built after tracing a specific gap: installAiCallTelemetry.js parses
// the outbound Anthropic/OpenAI request body but discards everything except `model`, and never
// covers Gemini at all (a separate SDK, no shared transport hook). Neither existing mechanism can
// answer "what did the model actually see."
//
// Two capture stages, matching the two questions that matter:
//   'normalized' -- this app's own provider-agnostic representation (system/canonicalMessages/
//                   tools), captured once per callProviderTurn/askStylistWithUsage/
//                   askStylistStructuredWithUsage invocation, BEFORE the provider-specific branch.
//                   This is what "the model was asked" means independent of wire format.
//   'wire'       -- the actual per-provider request object, captured inside callAnthropicTurn/
//                   callOpenAiTurn/callGeminiTurn immediately before the SDK call. Two calls with
//                   identical 'normalized' captures but different 'wire' captures means the
//                   difference is serialization, not information — e.g. Gemini's continuation
//                   mechanism (previous_interaction_id) means iteration 2+ only wire-sends the
//                   delta, even though the normalized capture (canonicalMessages) shows the full
//                   accumulated history it logically has.
//
// A third, separately enabled stage records what came BACK:
//   'output'     -- the provider's raw returned text (or, for an Anthropic forced tool call, the raw
//                   content blocks) captured before any parsing, normalization or resolution. Built
//                   after thread_1789346300319's spliced card could only be attributed to the model
//                   by elimination: input capture proved what the composer was asked, nothing proved
//                   what it answered. It is on whenever input capture is on, in the same directory:
//                   a capture is only complete with both halves, so there is no second variable to
//                   remember. Each call's input and output records share a `callId`.
//
// Every record also carries the request it belongs to -- threadId (the chat thread / session id),
// turnToken (one /ask turn), requestPath and nested -- read from the same request-scoped telemetry
// context ai_call_log uses, so a capture can be matched to a thread without comparing timestamps.
// Structured calls add schemaName (e.g. trip_roster_selection, trip_plan_composition): several of
// them share the default subflow label and were otherwise indistinguishable inside one trip turn.
//
// Images (2026-10-21, owner request): every image a call sends is saved once, as a plain image file
// named by its full sha256, under <dir>/images/, and its placeholder in the record names that file.
// The JSON records still never hold base64. Before this, images were reduced to a hash on the theory
// that the wardrobe photos are already on disk, but what a call sends is a resized derivative (and
// sometimes a browser-drawn collage that is stored nowhere), so a review package had to rebuild
// them by hash-matching and could not recover the collage at all (thread_1792569468413).
// Tool definitions keep their parameter schemas for the same reason: name and description alone
// did not show what arguments a tool accepted.
//
// Enable with WARDROBE_CAPTURE_PROVIDER_INPUT_DIR=/path/to/dir. Unset (the default): every export
// here is a no-op, zero behavioral or performance cost on the real request path. Filenames begin
// with a unique process-session ID before their monotonic call number. A dev-server restart resets
// the in-memory counter, so the session ID is what prevents a later run from overwriting 0001...
// captures from an earlier process.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

let callCounter = 0
const captureSessionId = [
  new Date().toISOString().replace(/[-:.]/g, ''),
  `p${process.pid}`,
  crypto.randomBytes(4).toString('hex'),
].join('-')

// lib/aiCallTelemetry.js registers its request-context reader here at load. Registered rather than
// imported so this module stays free of db.js and remains a no-op-safe leaf.
let captureContextReader = null
export function registerProviderCaptureContextReader(reader) {
  captureContextReader = typeof reader === 'function' ? reader : null
}

function requestAttribution() {
  let context = {}
  try { context = captureContextReader?.() || {} } catch { context = {} }
  return {
    threadId: String(context.sessionId || ''),
    turnToken: String(context.freeformTurnToken || ''),
    requestPath: String(context.originalUrl || '').split('?')[0],
    nested: Boolean(context.isNested),
  }
}

export function providerInputCaptureEnabled() {
  return Boolean(process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR)
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

// The image type of a base64 payload, from its first bytes; null for anything that is not an image
// (Gemini thought signatures, for one, are long base64 too).
const IMAGE_SIGNATURES = [['/9j/', 'jpg'], ['iVBORw0KGgo', 'png'], ['R0lGOD', 'gif'], ['UklGR', 'webp']]
function imageExtension(base64) {
  return IMAGE_SIGNATURES.find(([prefix]) => base64.startsWith(prefix))?.[1] || null
}

// Writes an image payload to <dir>/images/<sha256>.<ext> once and returns the record's reference to
// it, or '' when the payload is not an image or the write fails.
function saveImage(base64, fullSha) {
  const dir = process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR
  const ext = imageExtension(base64)
  if (!dir || !ext) return ''
  const name = `${fullSha}.${ext}`
  try {
    const imagesDir = path.join(dir, 'images')
    const file = path.join(imagesDir, name)
    if (!fs.existsSync(file)) {
      fs.mkdirSync(imagesDir, { recursive: true })
      fs.writeFileSync(file, Buffer.from(base64, 'base64'))
    }
    return `, saved images/${name}`
  } catch (err) {
    console.warn('[provider-input-capture] failed to save image:', err.message)
    return ''
  }
}

// Replaces base64 payloads with a hash+length placeholder, so the JSON records stay readable; an
// image payload is saved beside them (saveImage) and the placeholder names the file. Walks the
// three shapes this app's canonical messages and each provider's own request objects actually use.
function redact(value) {
  if (typeof value === 'string') {
    // A bare base64 JPEG/PNG data URI or raw base64 blob long enough to be image data, not text.
    if (value.length > 2000 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 200))) {
      const fullSha = sha256(value)
      return `[redacted base64, ${value.length} chars, sha256:${fullSha.slice(0, 16)}${saveImage(value, fullSha)}]`
    }
    return value
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'data' || k === 'base64' || k === 'inline_data') {
        if (typeof v === 'string' && v.length > 200) {
          const fullSha = sha256(v)
          out[k] = `[redacted, ${v.length} chars, sha256:${fullSha.slice(0, 16)}${saveImage(v, fullSha)}]`
        } else {
          out[k] = redact(v)
        }
      } else {
        out[k] = redact(v)
      }
    }
    return out
  }
  return value
}

function digestsFor({ system, messages, tools }) {
  return {
    systemSha256: sha256(system ?? ''),
    messagesSha256: sha256(messages ?? []),
    toolsSha256: sha256(tools ?? []),
    normalizedInputSha256: sha256({ system: system ?? '', messages: messages ?? [], tools: tools ?? [] }),
  }
}

export function providerOutputCaptureEnabled() {
  return providerInputCaptureEnabled()
}

// Pairs one call's input and output records. null when neither capture is on, so the default path
// does no work at all.
export function newProviderCaptureCallId() {
  if (!providerOutputCaptureEnabled()) return null
  return crypto.randomBytes(6).toString('hex')
}

function writeCapture(record, dir = process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR) {
  if (!dir) return
  try {
    fs.mkdirSync(dir, { recursive: true })
    callCounter += 1
    const stamp = String(callCounter).padStart(4, '0')
    const safeProvider = String(record.provider || 'unknown').replace(/[^a-z0-9_-]/gi, '_')
    const safeStage = String(record.stage || 'call').replace(/[^a-z0-9_-]/gi, '_')
    const file = path.join(dir, `${captureSessionId}-${stamp}-${safeProvider}-${safeStage}.json`)
    fs.writeFileSync(file, JSON.stringify({
      captureSessionId,
      captureIndex: callCounter,
      ...requestAttribution(),
      ...record,
    }, null, 2))
  } catch (err) {
    console.warn('[provider-input-capture] failed to write capture:', err.message)
  }
}

// Call right before callProviderTurn/askStylistWithUsage/askStylistStructuredWithUsage dispatch to
// a provider branch. `messages` should be this app's own canonical shape (canonicalMessages, or
// the plain {role,content} messages array for the non-tool-loop callers) -- not yet
// provider-serialized.
export function captureNormalizedProviderInput({ provider, model, subflow = '', schemaName = '', iterationIndex = null, callId = null, system, messages, tools = [] }) {
  if (!providerInputCaptureEnabled()) return
  const redactedSystem = redact(typeof system === 'string' ? system : JSON.stringify(system))
  const redactedMessages = redact(messages)
  const redactedTools = redact((tools || []).map(t => ({
    name: t?.name,
    description: t?.description,
    ...(t?.input_schema ? { input_schema: t.input_schema } : {}),
    ...(t?.parameters ? { parameters: t.parameters } : {}),
  })))
  writeCapture({
    stage: 'normalized',
    provider, model, subflow, schemaName, iterationIndex, callId,
    system: redactedSystem,
    messages: redactedMessages,
    tools: redactedTools,
    ...digestsFor({ system: redactedSystem, messages: redactedMessages, tools: redactedTools }),
    capturedAt: new Date().toISOString(),
  })
}

// Call immediately before the actual SDK call (client.messages.create / ai.interactions.create /
// client.chat.completions.create), passing the exact object about to be sent.
export function captureWireProviderInput({ provider, model, subflow = '', schemaName = '', iterationIndex = null, callId = null, request }) {
  if (!providerInputCaptureEnabled()) return
  const redactedRequest = redact(request)
  writeCapture({
    stage: 'wire',
    provider, model, subflow, schemaName, iterationIndex, callId,
    request: redactedRequest,
    requestSha256: sha256(redactedRequest),
    capturedAt: new Date().toISOString(),
  })
}

// Call with the provider's response BEFORE parsing, so a malformed or truncated answer is captured
// exactly as returned. Diagnostic-only and off by default; never alters the value it is given.
export function captureProviderOutput({ provider, model, subflow = '', schemaName = '', iterationIndex = null, callId = null, stopReason = null, output }) {
  if (!providerOutputCaptureEnabled()) return
  const redactedOutput = redact(output ?? null)
  writeCapture({
    stage: 'output',
    provider, model, subflow, schemaName, iterationIndex, callId, stopReason,
    output: redactedOutput,
    outputSha256: sha256(redactedOutput ?? ''),
    capturedAt: new Date().toISOString(),
  })
}
