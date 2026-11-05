// POST /api/ai/ask with progress (server: lib/turnProgress.js). Returns an object with the two things
// every caller already uses from a fetch Response — `ok` and `json()` — so call sites change only
// in how they call it. A server that answers with ordinary JSON (no stream) is passed straight through.
export async function postAskWithProgress(body, { onStart = () => {}, onProgress = () => {}, fetchImpl = fetch } = {}) {
  try { onStart() } catch { /* display only */ }
  const res = await fetchImpl('/api/ai/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stylist-Progress': 'ndjson' },
    body: JSON.stringify(body),
  })
  const type = String(res.headers?.get?.('content-type') || '')
  if (!res.body || !type.includes('application/x-ndjson')) return res

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = null
  const take = line => {
    if (!line.trim()) return
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    if (parsed?.type === 'result') result = parsed
    else if (parsed?.type === 'progress') {
      try { onProgress(parsed) } catch { /* display only */ }
    }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      take(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
    }
  }
  take(buffer + decoder.decode())
  if (!result) throw new Error('The stylist stopped before finishing. Try again.')
  const status = Number(result.status) || 200
  return { ok: status >= 200 && status < 300, status, json: async () => result.body }
}
