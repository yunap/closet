// Progress for a long /ask turn (owner, 2026-11-04: "just showing '...' to the user is not good
// enough"). A turn routinely takes 20 seconds to two minutes behind one POST, with nothing to say
// what it is doing. The client opts in with `X-Stylist-Progress: ndjson`; the response is then a
// stream of JSON lines — `{ type: 'progress', stage, ... }` as each real step starts, and one final
// `{ type: 'result', status, body }` carrying exactly what res.status(status).json(body) would have
// sent. A request without the header gets the ordinary JSON response, so every other caller and
// test is unchanged.
//
// Stages are short codes plus plain facts (counts, categories, the router's reading of the
// request). The wording is the client's (src/utils/turnProgressCopy.js), so nothing model-facing,
// no model name, token count or cost, and no engine internal is ever sent for display.
//
// The reporter lives on the request's AsyncLocalStorage telemetry store, so a step deep inside a
// tool or a nested composer reports without a parameter threaded through every function. A turn
// with no stream (or outside a request) makes reportTurnProgress a no-op.
import { getAiTelemetryContext, updateAiTelemetryContext } from './aiCallTelemetry.js'

export const TURN_PROGRESS_HEADER = 'x-stylist-progress'

export function wantsTurnProgress(req) {
  return String(req?.get?.(TURN_PROGRESS_HEADER) || req?.headers?.[TURN_PROGRESS_HEADER] || '').trim().toLowerCase() === 'ndjson'
}

export function startTurnProgressStream(req, res) {
  if (!wantsTurnProgress(req)) return null
  let statusCode = 200
  let finished = false
  res.status(200)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const write = line => {
    if (finished || res.writableEnded || res.destroyed) return
    res.write(`${JSON.stringify(line)}\n`)
  }
  // The handler's own exits stay as written: res.status(n).json(body) becomes the final line.
  res.status = code => {
    statusCode = Number(code) || statusCode
    return res
  }
  res.json = body => {
    write({ type: 'result', status: statusCode, body })
    finished = true
    res.end()
    return res
  }
  const report = (stage, facts = {}) => write({ type: 'progress', stage: String(stage), ...facts })
  updateAiTelemetryContext({ turnProgress: report })
  return report
}

export function reportTurnProgress(stage, facts = {}) {
  const report = getAiTelemetryContext()?.turnProgress
  if (typeof report !== 'function') return
  try {
    report(stage, facts)
  } catch {
    // Progress is a courtesy; it never fails a turn.
  }
}
