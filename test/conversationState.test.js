import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-conversation-state-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { db } = await import('../db.js')
const { getStylistConversationState, saveStylistConversationState } = await import('../styling-engine/conversationState.js')

after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('shared conversation state round-trips independently by session', () => {
  saveStylistConversationState({ occasion: 'city', weather: 'hot' }, 'thread-a')
  saveStylistConversationState({ occasion: 'museum', activity: 'walking' }, 'thread-b')

  assert.deepEqual(getStylistConversationState('thread-a'), { occasion: 'city', weather: 'hot' })
  assert.deepEqual(getStylistConversationState('thread-b'), { occasion: 'museum', activity: 'walking' })
  assert.deepEqual(getStylistConversationState('missing-thread'), {})
})

test('shared conversation state updates an existing session', () => {
  saveStylistConversationState({ occasion: 'casual' }, 'thread-a')
  assert.deepEqual(getStylistConversationState('thread-a'), { occasion: 'casual' })
})
