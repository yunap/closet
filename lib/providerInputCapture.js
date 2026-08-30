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
// Enable with WARDROBE_CAPTURE_PROVIDER_INPUT_DIR=/path/to/dir. Unset (the default): every export
// here is a no-op, zero behavioral or performance cost on the real request path.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

let callCounter = 0

export function providerInputCaptureEnabled() {
  return Boolean(process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR)
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

// Replaces base64 image payloads with a hash+length placeholder — the point of this capture is
// prompt/instruction content, not re-storing wardrobe photos we already have on disk. Walks the
// three shapes this app's canonical messages and each provider's own request objects actually use.
function redact(value) {
  if (typeof value === 'string') {
    // A bare base64 JPEG/PNG data URI or raw base64 blob long enough to be image data, not text.
    if (value.length > 2000 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 200))) {
      return `[redacted base64, ${value.length} chars, sha256:${sha256(value).slice(0, 16)}]`
    }
    return value
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'data' || k === 'base64' || k === 'inline_data') {
        out[k] = typeof v === 'string' && v.length > 200
          ? `[redacted, ${v.length} chars, sha256:${sha256(v).slice(0, 16)}]`
          : redact(v)
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

function writeCapture(record) {
  if (!providerInputCaptureEnabled()) return
  try {
    const dir = process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR
    fs.mkdirSync(dir, { recursive: true })
    callCounter += 1
    const stamp = String(callCounter).padStart(4, '0')
    const safeProvider = String(record.provider || 'unknown').replace(/[^a-z0-9_-]/gi, '_')
    const safeStage = String(record.stage || 'call').replace(/[^a-z0-9_-]/gi, '_')
    const file = path.join(dir, `${stamp}-${safeProvider}-${safeStage}.json`)
    fs.writeFileSync(file, JSON.stringify(record, null, 2))
  } catch (err) {
    console.warn('[provider-input-capture] failed to write capture:', err.message)
  }
}

// Call right before callProviderTurn/askStylistWithUsage/askStylistStructuredWithUsage dispatch to
// a provider branch. `messages` should be this app's own canonical shape (canonicalMessages, or
// the plain {role,content} messages array for the non-tool-loop callers) -- not yet
// provider-serialized.
export function captureNormalizedProviderInput({ provider, model, subflow = '', iterationIndex = null, system, messages, tools = [] }) {
  if (!providerInputCaptureEnabled()) return
  const redactedSystem = redact(typeof system === 'string' ? system : JSON.stringify(system))
  const redactedMessages = redact(messages)
  const redactedTools = redact((tools || []).map(t => ({ name: t?.name, description: t?.description })))
  writeCapture({
    stage: 'normalized',
    provider, model, subflow, iterationIndex,
    system: redactedSystem,
    messages: redactedMessages,
    tools: redactedTools,
    ...digestsFor({ system: redactedSystem, messages: redactedMessages, tools: redactedTools }),
    capturedAt: new Date().toISOString(),
  })
}

// Call immediately before the actual SDK call (client.messages.create / ai.interactions.create /
// client.chat.completions.create), passing the exact object about to be sent.
export function captureWireProviderInput({ provider, model, subflow = '', iterationIndex = null, request }) {
  if (!providerInputCaptureEnabled()) return
  const redactedRequest = redact(request)
  writeCapture({
    stage: 'wire',
    provider, model, subflow, iterationIndex,
    request: redactedRequest,
    requestSha256: sha256(redactedRequest),
    capturedAt: new Date().toISOString(),
  })
}
