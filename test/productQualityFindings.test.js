import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  createDirectProductQualityFinding,
  resolveProductQualityFinding,
  syncProductQualityFindingForDraft,
} from '../lib/productQualityFindings.js'

function fixtureDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE product_quality_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      synthesis_draft_id INTEGER NOT NULL UNIQUE,
      finding_type TEXT NOT NULL DEFAULT 'general_styling_failure',
      status TEXT NOT NULL DEFAULT 'open',
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      source_feedback_ids TEXT NOT NULL DEFAULT '[]',
      evidence_snapshot TEXT NOT NULL DEFAULT '[]',
      resolution_type TEXT DEFAULT '',
      resolution_note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)
  db.exec(`
    CREATE TABLE feedback_synthesis_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, feedback_ids TEXT, compact_input TEXT,
      input_hash TEXT, provider TEXT, model TEXT, estimated_input_tokens INTEGER,
      estimated_output_tokens INTEGER, estimated_cost_usd REAL, actual_usage TEXT, completed_at TEXT
    );
    CREATE TABLE feedback_synthesis_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER, disposition TEXT, title TEXT,
      proposed_text TEXT, boundary TEXT, rationale TEXT, confidence TEXT,
      source_feedback_ids TEXT, status TEXT, payload TEXT
    );
  `)
  db.exec(`
    CREATE TABLE stylist_feedback (
      id INTEGER PRIMARY KEY, feedback_type TEXT, target_type TEXT, context_type TEXT,
      context_id INTEGER, context_name TEXT, label TEXT, note TEXT, payload TEXT, created_at TEXT
    )
  `)
  return db
}

test('reviewed general styling failures become open product findings with provenance', () => {
  const db = fixtureDb()
  db.prepare(`INSERT INTO stylist_feedback
    (id, feedback_type, target_type, context_type, context_name, label, note, payload, created_at)
    VALUES (404, 'wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', 'Point Reyes', 'Fog walk', 'Canvas absorbs water', ?, '2026-08-10')
  `).run(JSON.stringify({
    board: { imageUrl: '/uploads/generated-boards/fog-walk.png', pieces: [{ id: 44, name: 'Canvas sneakers', category: 'shoes', fabric_category: 'canvas' }] },
    feedbackEvidence: { source: { threadId: 'thread-fog' }, context: { weather: 'foggy coastal walk' }, explicitReason: 'Canvas absorbs water' },
  }))
  const draft = {
    id: 12,
    disposition: 'general_styling_failure',
    title: 'Canvas footwear selected for wet coastal walking',
    proposed_text: 'Absorbent footwear should not be selected for credible wet exposure.',
    source_feedback_ids: '[404]',
  }
  const finding = syncProductQualityFindingForDraft(db, draft, { status: 'accepted' })
  assert.equal(finding.status, 'open')
  assert.equal(finding.title, draft.title)
  assert.deepEqual(JSON.parse(finding.source_feedback_ids), [404])
  const snapshot = JSON.parse(finding.evidence_snapshot)
  assert.equal(snapshot[0].image_url, '/uploads/generated-boards/fog-walk.png')
  assert.equal(snapshot[0].thread_id, 'thread-fog')
  assert.equal(snapshot[0].pieces[0].fabric_category, 'canvas')
  db.prepare('DELETE FROM stylist_feedback WHERE id = 404').run()
  assert.equal(JSON.parse(db.prepare('SELECT evidence_snapshot FROM product_quality_findings WHERE id = ?').get(finding.id).evidence_snapshot)[0].image_url, '/uploads/generated-boards/fog-walk.png')
  assert.equal(syncProductQualityFindingForDraft(db, { ...draft, disposition: 'personal_contextual_lesson' }, { status: 'accepted' }), null)
  db.close()
})

test('an explicitly confirmed reaction can enter product review without a model call', () => {
  const db = fixtureDb()
  db.prepare(`INSERT INTO stylist_feedback
    (id, feedback_type, target_type, context_type, context_name, label, note, payload, created_at)
    VALUES (405, 'wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', 'Dinner', 'Layering failure', ?, ?, '2026-08-10')
  `).run('Fitted cardigan cannot layer over bishop sleeves', JSON.stringify({
    board: { imageUrl: '/uploads/generated-boards/layering.png', pieces: [{ id: 177, name: 'Fitted cardigan', category: 'outerwear' }] },
  }))
  assert.match(createDirectProductQualityFinding(db, {
    feedbackId: 405, title: 'Layering problem', description: 'Narrow sleeves over bishop sleeves.',
  }).error, /confirmation/)
  const created = createDirectProductQualityFinding(db, {
    feedbackId: 405,
    title: 'Layering problem',
    description: 'Narrow sleeves were proposed over bishop sleeves.',
    confirmProductIssue: true,
  })
  assert.equal(created.finding.status, 'open')
  assert.equal(created.draft.disposition, 'general_styling_failure')
  assert.equal(JSON.parse(created.draft.payload).provider_calls, 0)
  assert.equal(JSON.parse(created.finding.evidence_snapshot)[0].image_url, '/uploads/generated-boards/layering.png')
  db.close()
})

test('product findings require an explicit resolution destination and preserve resolved state', () => {
  const db = fixtureDb()
  const draft = {
    id: 13,
    disposition: 'general_styling_failure',
    title: 'Narrow layer over bishop sleeves',
    proposed_text: 'The proposed layers are physically incompatible.',
    source_feedback_ids: '[405]',
  }
  const finding = syncProductQualityFindingForDraft(db, draft, { status: 'accepted' })
  assert.match(resolveProductQualityFinding(db, finding.id, { status: 'resolved' }).error, /resolution type/)
  const resolved = resolveProductQualityFinding(db, finding.id, {
    status: 'resolved',
    resolutionType: 'shared_rule',
    resolutionNote: 'Added construction-compatibility validation.',
  }).finding
  assert.equal(resolved.status, 'resolved')
  assert.equal(resolved.resolution_type, 'shared_rule')
  assert.match(resolved.resolution_note, /construction-compatibility/)

  syncProductQualityFindingForDraft(db, draft, { status: 'accepted', editedText: 'Updated explanation.' })
  assert.equal(db.prepare('SELECT status FROM product_quality_findings WHERE id = ?').get(finding.id).status, 'resolved')
  syncProductQualityFindingForDraft(db, draft, { status: 'retired' })
  assert.equal(db.prepare('SELECT status FROM product_quality_findings WHERE id = ?').get(finding.id).status, 'resolved')
  db.close()
})
