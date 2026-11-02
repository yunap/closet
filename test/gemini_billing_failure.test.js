// thread_1793604578459: every Gemini call was refused with a 402 and the app called it a styling
// failure. These run the real SDK against a local stub, so they pin the error shape it produces.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import nodePath from 'node:path'
import { GoogleGenAI } from '@google/genai'

const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gemini-billing-test-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')

const { markGeminiBillingFailure } = await import('../styling-engine/provider.js')

async function sdkErrorFor(status, body) {
  const server = http.createServer((req, res) => {
    req.resume()
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const ai = new GoogleGenAI({ apiKey: 'test', httpOptions: { baseUrl: `http://127.0.0.1:${server.address().port}` } })
    await ai.interactions.create({ model: 'gemini-3.7-flash', input: 'hi' })
    throw new Error('the stub must make the SDK throw')
  } catch (err) {
    return err
  } finally {
    server.close()
  }
}

test('a 402 with an empty body is marked as billing and the SDK text replaced', async () => {
  for (const body of ['', '{}']) {
    const err = markGeminiBillingFailure(await sdkErrorFor(402, body))
    assert.equal(err.isBilling, true)
    assert.match(err.message, /payment required \(HTTP 402/)
    assert.doesNotMatch(err.message, /httpMeta/)
  }
})

test('a 402 that says why keeps what it said', async () => {
  const body = JSON.stringify({ error: { code: 402, message: 'Your credits are depleted.' } })
  const err = markGeminiBillingFailure(await sdkErrorFor(402, body))
  assert.equal(err.isBilling, true)
  assert.match(err.message, /Your credits are depleted\./)
})

test('other provider errors are left alone', async () => {
  const original = await sdkErrorFor(500, '{}')
  const message = original.message
  const err = markGeminiBillingFailure(original)
  assert.equal(err.isBilling, undefined)
  assert.equal(err.message, message)
  assert.doesNotThrow(() => markGeminiBillingFailure(new Error('network down')))
})
