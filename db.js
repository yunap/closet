import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { LEGACY_PROFILE, LEGACY_CONSTITUTION } from './styling-engine/constitutionSeed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const uploadsDir = process.env.WARDROBE_UPLOADS_DIR || path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir)

const db = new Database(process.env.WARDROBE_DB_PATH || 'wardrobe.db')
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const LEGACY_SEED_TODOS = [
  { type: 'repair', description: 'Fix zipper on mustard corduroy skinnies' },
  { type: 'shopping', description: 'Replace worn black sleeveless tank with better quality version — fitted, structured, not clingy' },
  { type: 'donate', description: 'Consider donating: grey tunic' },
  { type: 'donate', description: 'Consider donating: olive drapey tank' },
  { type: 'donate', description: 'Consider donating: worn black tank' },
  { type: 'shopping', description: 'Shop for: tan/cognac flat mule sandal' },
  { type: 'shopping', description: 'Shop for: quality black sleeveless top (fitted, structured, not clingy)' },
]

db.exec(`
  CREATE TABLE IF NOT EXISTS pieces (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL,
    colors       TEXT DEFAULT '[]',
    occasions    TEXT DEFAULT '[]',
    season       TEXT DEFAULT 'year-round',
    notes        TEXT DEFAULT '',
    status       TEXT DEFAULT 'active',
    recommendation_status TEXT DEFAULT 'trusted',
    fit_confidence TEXT DEFAULT 'unknown',
    role_permission TEXT DEFAULT 'auto',
    occasion_permissions TEXT DEFAULT '[]',
    occasion_exclusions  TEXT DEFAULT '[]',
    engine_notes TEXT DEFAULT '',
    favorite     INTEGER DEFAULT 0,
    photo        TEXT,
    tagger_version TEXT,
    date_added   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS outfits (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    occasion     TEXT DEFAULT 'casual',
    season       TEXT DEFAULT 'year-round',
    notes        TEXT DEFAULT '',
    status       TEXT DEFAULT 'confirmed',
    favorite     INTEGER DEFAULT 0,
    photo        TEXT,
    main_piece_id INTEGER REFERENCES pieces(id) ON DELETE SET NULL,
    date_added   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS outfit_pieces (
    outfit_id    INTEGER REFERENCES outfits(id) ON DELETE CASCADE,
    piece_id     INTEGER REFERENCES pieces(id)  ON DELETE CASCADE,
    PRIMARY KEY (outfit_id, piece_id)
  );

  CREATE TABLE IF NOT EXISTS todos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT NOT NULL,
    description     TEXT NOT NULL,
    linked_piece_id INTEGER REFERENCES pieces(id) ON DELETE SET NULL,
    completed       INTEGER DEFAULT 0,
    field           TEXT
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS stylist_feedback (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_type   TEXT NOT NULL,
    target_type     TEXT DEFAULT 'message',
    context_type    TEXT,
    context_id      INTEGER,
    context_name    TEXT,
    label           TEXT,
    note            TEXT DEFAULT '',
    payload         TEXT DEFAULT '{}',
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS saved_boards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    board_type      TEXT DEFAULT 'wardrobe',
    context_type    TEXT,
    context_id      INTEGER,
    context_name    TEXT,
    title           TEXT,
    image_url       TEXT,
    pieces          TEXT DEFAULT '[]',
    missing_pieces  TEXT DEFAULT '[]',
    reason          TEXT DEFAULT '',
    watch_for       TEXT DEFAULT '',
    payload         TEXT DEFAULT '{}',
    favorite        INTEGER DEFAULT 0,
    archived        INTEGER DEFAULT 0,
    hidden_from_lookbook INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS calibration_images (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url       TEXT NOT NULL,
    kind            TEXT DEFAULT 'good_reference',
    labels          TEXT DEFAULT '[]',
    notes           TEXT DEFAULT '',
    source          TEXT DEFAULT 'uploaded',
    favorite        INTEGER DEFAULT 0,
    archived        INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS whole_wardrobe_sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    occasion         TEXT NOT NULL DEFAULT '',
    piece_ids        TEXT NOT NULL DEFAULT '[]',
    formula_families TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS generation_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    flow          TEXT NOT NULL,
    occasion      TEXT DEFAULT '',
    weather       TEXT DEFAULT '',
    roster_count  INTEGER,
    pool_size     INTEGER,
    cap_applied   INTEGER DEFAULT 0,
    cut_ids       TEXT DEFAULT '[]',
    requested     INTEGER,
    delivered     INTEGER,
    coverage_gaps TEXT DEFAULT '[]',
    roster_counts TEXT DEFAULT '{}',
    activity_source TEXT DEFAULT '',
    unresolved_references_count INTEGER DEFAULT 0,
    structural_rejection_reasons TEXT DEFAULT '{}',
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS freeform_generation_runs (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id              TEXT DEFAULT '',
    occasion                TEXT DEFAULT '',
    search_calls            INTEGER DEFAULT 0,
    gate_excluded_total     INTEGER DEFAULT 0,
    propose_calls           INTEGER DEFAULT 0,
    propose_validation_fails INTEGER DEFAULT 0,
    outfit_prose_without_tool_count INTEGER DEFAULT 0,
    zero_result_contradiction_blocks INTEGER DEFAULT 0,
    destination_clarification_retries INTEGER DEFAULT 0,
    plan_slot_environment_inferred INTEGER DEFAULT 0,
    plan_slot_activity_inferred INTEGER DEFAULT 0,
    plan_compose_mode      TEXT DEFAULT '',
    submit_plan_calls      INTEGER DEFAULT 0,
    submit_plan_validation_fails INTEGER DEFAULT 0,
    submit_plan_resubmits  INTEGER DEFAULT 0,
    submit_plan_partial_accepts INTEGER DEFAULT 0,
    weather_source          TEXT DEFAULT '',
    created_at              TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stylist_conversation_state (
    session_id   TEXT PRIMARY KEY,
    state_json   TEXT NOT NULL,
    updated_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_threads (
    id           TEXT PRIMARY KEY,
    title        TEXT,
    user_renamed INTEGER DEFAULT 0,
    kind         TEXT DEFAULT 'chat',
    payload      TEXT DEFAULT '{}',
    pinned       INTEGER DEFAULT 0,
    archived     INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
  );
`)

// Migrate chat_threads to add pinned and archived columns
;[
  'pinned INTEGER DEFAULT 0',
  'archived INTEGER DEFAULT 0'
].forEach(col => {
  try { db.exec(`ALTER TABLE chat_threads ADD COLUMN ${col}`) } catch {}
})

// Migrate todos to add field column
;[
  'field TEXT'
].forEach(col => {
  try { db.exec(`ALTER TABLE todos ADD COLUMN ${col}`) } catch {}
})

// Migrate outfits to remember the user-selected main linked garment.
;[
  'main_piece_id INTEGER REFERENCES pieces(id) ON DELETE SET NULL'
].forEach(col => {
  try { db.exec(`ALTER TABLE outfits ADD COLUMN ${col}`) } catch {}
})

// ── Migrate: add new columns to existing DB ───────────────────────────────────
const NEW_COLUMNS = [
  'worn_photo TEXT',
  'pattern_type TEXT', 'pattern_scale TEXT', 'pattern_complexity TEXT',
  'reads_as TEXT', 'hem_finish TEXT',
  'neckline TEXT', 'sleeve_type TEXT', 'length_hits_at TEXT',
  'silhouette TEXT', 'fabric_category TEXT', 'fabric_weight TEXT',
  'opacity TEXT',
  'fiber_content TEXT DEFAULT "[]"',
  'formality TEXT',
  'heel_height TEXT',
  'walk_support TEXT',
  'stretch TEXT', 'fit_on_body TEXT', 'tuck_behavior TEXT', 'waistband_type TEXT',
  'styling_rules_learned TEXT', 'pairs_well_with TEXT', 'tried_and_rejected TEXT',
  'background_color TEXT',
  'recommendation_status TEXT DEFAULT "trusted"',
  'fit_confidence TEXT DEFAULT "unknown"',
  'role_permission TEXT DEFAULT "auto"',
  'occasion_permissions TEXT DEFAULT "[]"',
  'occasion_exclusions TEXT DEFAULT "[]"',
  'engine_notes TEXT DEFAULT ""',
  'style_profile_json TEXT DEFAULT "{}"',
  'tagger_version TEXT',
  'tag_state TEXT DEFAULT "untagged"',
  'manual_overrides TEXT DEFAULT "[]"',
]
NEW_COLUMNS.forEach(col => {
  try { db.exec(`ALTER TABLE pieces ADD COLUMN ${col}`) } catch {}
})

// Additive learning-schema migrations. Existing local databases keep working.
;[
  'is_gold INTEGER DEFAULT 0',
  'archived INTEGER DEFAULT 0'
].forEach(col => {
  try { db.exec(`ALTER TABLE stylist_feedback ADD COLUMN ${col}`) } catch {}
})

;[
  'hidden_from_lookbook INTEGER DEFAULT 0'
].forEach(col => {
  try { db.exec(`ALTER TABLE saved_boards ADD COLUMN ${col}`) } catch {}
})

;[
  'requested INTEGER',
  'delivered INTEGER',
  'coverage_gaps TEXT DEFAULT "[]"',
  'roster_counts TEXT DEFAULT "{}"',
  'activity_source TEXT DEFAULT ""',
  'unresolved_references_count INTEGER DEFAULT 0',
  'structural_rejection_reasons TEXT DEFAULT "{}"'
].forEach(col => {
  try { db.exec(`ALTER TABLE generation_runs ADD COLUMN ${col}`) } catch {}
})

;[
  'outfit_prose_without_tool_count INTEGER DEFAULT 0',
  'zero_result_contradiction_blocks INTEGER DEFAULT 0',
  'destination_clarification_retries INTEGER DEFAULT 0',
  'plan_slot_environment_inferred INTEGER DEFAULT 0',
  'plan_slot_activity_inferred INTEGER DEFAULT 0',
  'plan_compose_mode TEXT DEFAULT ""',
  'submit_plan_calls INTEGER DEFAULT 0',
  'submit_plan_validation_fails INTEGER DEFAULT 0',
  'submit_plan_resubmits INTEGER DEFAULT 0',
  'submit_plan_partial_accepts INTEGER DEFAULT 0'
].forEach(col => {
  try { db.exec(`ALTER TABLE freeform_generation_runs ADD COLUMN ${col}`) } catch {}
})

// One-time repair for metadata todos with NULL or empty field
try {
  const nullFieldTodos = db.prepare("SELECT id, description FROM todos WHERE type = 'metadata' AND (field IS NULL OR field = '')").all()
  for (const todo of nullFieldTodos) {
    const match = todo.description.match(/missing\s+([a-z0-9_-]+)\s+—/i)
    if (match) {
      db.prepare('UPDATE todos SET field = ? WHERE id = ?').run(match[1].toLowerCase().trim(), todo.id)
    }
  }
} catch (err) {
  console.warn('Failed to backfill metadata todo fields:', err.message)
}

// Backfill lifecycle state only. Do not clear historical structure/fit fields:
// existing rows may contain hand-corrected truth from before manual_overrides existed.
try {
  const untagged = db.prepare("SELECT * FROM pieces WHERE tag_state IS NULL OR tag_state = 'untagged'").all()
  if (untagged.length > 0) {
    db.transaction(() => {
      const updateProvisional = db.prepare(`
        UPDATE pieces 
        SET tag_state = 'provisional'
        WHERE id = ?
      `)
      const updateFullyTagged = db.prepare(`
        UPDATE pieces 
        SET tag_state = 'fully_tagged'
        WHERE id = ?
      `)
      for (const piece of untagged) {
        if (piece.worn_photo) {
          updateFullyTagged.run(piece.id)
        } else {
          updateProvisional.run(piece.id)
        }
      }
    })()
  }
} catch (err) {
  console.warn('Backfill migration warning:', err.message)
}

// ── Spec 31: batch wardrobe import (sessions, ingested images, evidence) ──────
// import_sessions/import_images carry an import run through its phases
// (ingesting → classified → clustered → tagged → reviewed). piece_import_evidence
// is the durable output: extra worn/reference photos attached to a piece by an
// accepted import merge (owner ruling: attachment is permanent on accept).
db.exec(`
  CREATE TABLE IF NOT EXISTS import_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    status      TEXT DEFAULT 'ingesting',
    counts_json TEXT DEFAULT '{}',
    spent_usd   REAL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS import_images (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER REFERENCES import_sessions(id) ON DELETE CASCADE,
    file        TEXT NOT NULL,
    origin      TEXT DEFAULT 'upload',
    album_hint  TEXT DEFAULT '',
    kind        TEXT,
    status      TEXT DEFAULT 'pending',
    meta_json   TEXT DEFAULT '{}',
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS import_garments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER REFERENCES import_sessions(id) ON DELETE CASCADE,
    image_id    INTEGER REFERENCES import_images(id) ON DELETE CASCADE,
    crop_file   TEXT NOT NULL,
    category    TEXT DEFAULT '',
    color       TEXT DEFAULT '',
    descriptor  TEXT DEFAULT '',
    cluster_id  INTEGER,
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS import_clusters (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id            INTEGER REFERENCES import_sessions(id) ON DELETE CASCADE,
    canonical_garment_id  INTEGER,
    category              TEXT DEFAULT '',
    color                 TEXT DEFAULT '',
    descriptor            TEXT DEFAULT '',
    merge_target_piece_id INTEGER,
    status                TEXT DEFAULT 'proposed',
    created_at            TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS piece_import_evidence (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id    INTEGER REFERENCES pieces(id) ON DELETE CASCADE,
    session_id  INTEGER,
    file        TEXT NOT NULL,
    note        TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  );
`)

// ── Spec 32: style constitution + user profile storage ────────────────────────
// Additive tables. style_constitution holds the per-user constitution layers that
// prompts.js assembles into system prompts (promptRuntime.js reads them);
// constitution_history is the append-only ruling-archaeology log (owner ruling
// 2026-07-18) — every write to a layer records the prior text and its source.
db.exec(`
  CREATE TABLE IF NOT EXISTS style_constitution (
    layer TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS constitution_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    layer TEXT NOT NULL,
    prior_body TEXT,
    source TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

// One-time migration for PRE-EXISTING databases (detected by the 'seeded' sentinel
// already present before this code ever ran): seed the legacy owner constitution and
// profile verbatim so the instance's assembled prompts stay byte-identical to what it
// shipped before the constants moved out of prompts.js (the prompt_equivalence test
// pins this). Brand-new databases get NO rows here — promptRuntime falls back to the
// generic DEFAULT_CONSTITUTION/DEFAULT_PROFILE until onboarding writes real ones.
try {
  // The 'constitution_migrated' marker makes this a strictly one-shot decision. A DB is
  // "pre-existing" only if the 'seeded' sentinel exists AND this migration has never run —
  // without the marker, a brand-new DB (which acquires 'seeded' on its first boot) would
  // wrongly look pre-existing on its SECOND boot and get the legacy owner constitution.
  const migrated = db.prepare("SELECT value FROM app_meta WHERE key = 'constitution_migrated'").get()
  if (!migrated) {
    const preexisting = db.prepare("SELECT value FROM app_meta WHERE key = 'seeded'").get()
    const hasConstitution = db.prepare("SELECT COUNT(*) AS n FROM style_constitution").get().n > 0
    const insLayer = db.prepare("INSERT INTO style_constitution (layer, body) VALUES (?, ?)")
    const insHistory = db.prepare("INSERT INTO constitution_history (layer, prior_body, source) VALUES (?, NULL, 'migration')")
    const insMeta = db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)")
    db.transaction(() => {
      if (preexisting && !hasConstitution) {
        for (const [layer, body] of Object.entries(LEGACY_CONSTITUTION)) {
          insLayer.run(layer, body)
          insHistory.run(layer)
        }
        insMeta.run('profile_display_name', LEGACY_PROFILE.displayName)
        insMeta.run('profile_pronouns', JSON.stringify(LEGACY_PROFILE.pronouns))
      }
      insMeta.run('constitution_migrated', preexisting && !hasConstitution ? 'legacy-seeded' : 'fresh')
    })()
  }
} catch (err) {
  console.warn('Constitution migration warning:', err.message)
}

// ── Seed data (first run only) ─────────────────────────────────────────────────
// Claim the "first run" atomically via INSERT OR IGNORE so concurrent
// processes touching a brand-new DB (e.g. node --test running multiple test
// files in parallel against a fresh clone) can't both pass a check-then-act
// race and collide inserting the sentinel row — only the process whose
// INSERT actually lands (changes > 0) seeds.
const claimedSeed = db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('seeded', 'true')").run()
if (claimedSeed.changes > 0) {
  const ins = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status)
    VALUES (@name, @category, @colors, @occasions, @season, @notes, @status)
  `)
  const seedPieces = db.transaction(() => {
    const pieces = [
      // Tops
      { name: 'Whale stripe tee',        category: 'top',       colors: '["navy","white"]',      occasions: '["casual"]',                         season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black sleeveless tank',   category: 'top',       colors: '["black"]',             occasions: '["casual","city"]',                  season: 'warm',       notes: 'Replace with better quality version',          status: 'active' },
      { name: 'Daisy print tee',         category: 'top',       colors: '["white","yellow"]',    occasions: '["casual"]',                         season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Orange ribbed tank',      category: 'top',       colors: '["orange"]',            occasions: '["casual","home"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Botanical wrap top',      category: 'top',       colors: '["green","cream"]',     occasions: '["casual","smart-casual"]',           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Black blouse',            category: 'top',       colors: '["black"]',             occasions: '["city","evening"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Navy pinstripe shirt',    category: 'top',       colors: '["navy"]',              occasions: '["city","smart-casual"]',            season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Floral blouse',           category: 'top',       colors: '["multi"]',             occasions: '["city","smart-casual"]',            season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Striped button-down',     category: 'top',       colors: '["navy","white"]',      occasions: '["city"]',                           season: 'year-round', notes: 'Wear open as a layer over navy top',           status: 'active' },
      { name: 'Navy top',                category: 'top',       colors: '["navy"]',              occasions: '["city","casual"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black button-detail top', category: 'top',       colors: '["black"]',             occasions: '["evening","city"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Cashmere tee',            category: 'top',       colors: '["grey"]',              occasions: '["smart-casual","casual"]',          season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Fitted Breton tee',       category: 'top',       colors: '["navy","white"]',      occasions: '["smart-casual","casual"]',          season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black tank',              category: 'top',       colors: '["black"]',             occasions: '["outdoor","casual","home"]',        season: 'warm',       notes: 'Base layer',                                   status: 'active' },
      { name: 'Navy graphic tee',        category: 'top',       colors: '["navy"]',              occasions: '["home","casual"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Plum cap-sleeve top',     category: 'top',       colors: '["plum"]',              occasions: '["home","casual"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      // Bottoms
      { name: 'Dark jeans',              category: 'bottom',    colors: '["dark blue"]',         occasions: '["casual","city","evening","smart-casual"]', season: 'year-round', notes: '',                                    status: 'active' },
      { name: 'Orange pink floral mini skirt', category: 'bottom', colors: '["orange","pink"]', occasions: '["casual"]',                         season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Emerald green pants',     category: 'bottom',    colors: '["green"]',             occasions: '["casual"]',                         season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Cream wide-leg pants',    category: 'bottom',    colors: '["cream"]',             occasions: '["casual","city"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Mustard corduroy skinnies', category: 'bottom', colors: '["mustard"]',            occasions: '["casual","smart-casual"]',          season: 'cool',       notes: 'Zipper needs repair',                          status: 'needs-repair' },
      { name: 'Cream cropped wide-leg pants', category: 'bottom', colors: '["cream"]',           occasions: '["city"]',                           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Dark wide-leg pants',     category: 'bottom',    colors: '["dark grey"]',         occasions: '["city","smart-casual","evening"]',  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Cream knit skirt',        category: 'bottom',    colors: '["cream"]',             occasions: '["city"]',                           season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Light grey denim',        category: 'bottom',    colors: '["light grey"]',        occasions: '["evening","casual"]',               season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Grey lace-waist pants',   category: 'bottom',    colors: '["grey"]',              occasions: '["smart-casual"]',                   season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Brown-cream midi skirt',  category: 'bottom',    colors: '["brown","cream"]',     occasions: '["smart-casual"]',                   season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Dark fuller pants',       category: 'bottom',    colors: '["dark grey"]',         occasions: '["outdoor","casual"]',               season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Dark leggings',           category: 'bottom',    colors: '["black"]',             occasions: '["outdoor","home"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'White terry pants',       category: 'bottom',    colors: '["white"]',             occasions: '["home"]',                           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Floral leggings',         category: 'bottom',    colors: '["multi"]',             occasions: '["home"]',                           season: 'year-round', notes: '',                                             status: 'active' },
      // Dresses
      { name: 'Plum dress',              category: 'dress',     colors: '["plum"]',              occasions: '["evening"]',                        season: 'year-round', notes: 'Versatile — styles up or down easily',         status: 'active' },
      { name: 'Green maxi dress',        category: 'dress',     colors: '["green"]',             occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Charcoal ruched dress',   category: 'dress',     colors: '["charcoal"]',          occasions: '["city","evening"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      // Outerwear
      { name: 'Grey vest',               category: 'outerwear', colors: '["grey"]',              occasions: '["casual","smart-casual"]',          season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Leather jacket',          category: 'outerwear', colors: '["black"]',             occasions: '["evening","casual"]',               season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Oatmeal cardigan',        category: 'outerwear', colors: '["oatmeal"]',           occasions: '["evening","casual","city"]',        season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Tweed vest',              category: 'outerwear', colors: '["brown","cream"]',     occasions: '["smart-casual"]',                   season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Plum hoodie',             category: 'outerwear', colors: '["plum"]',              occasions: '["outdoor"]',                        season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Olive hoodie',            category: 'outerwear', colors: '["olive"]',             occasions: '["outdoor","casual"]',               season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Cream cardigan',          category: 'outerwear', colors: '["cream"]',             occasions: '["city","evening","casual"]',        season: 'cool',       notes: '',                                             status: 'active' },
      // Shoes
      { name: 'White sneakers',          category: 'shoes',     colors: '["white"]',             occasions: '["casual","smart-casual"]',          season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black sandals',           category: 'shoes',     colors: '["black"]',             occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Brown ankle boots',       category: 'shoes',     colors: '["brown"]',             occasions: '["casual","smart-casual","city","evening"]', season: 'cool', notes: '',                                          status: 'active' },
      { name: 'Black mules',             category: 'shoes',     colors: '["black"]',             occasions: '["city","evening"]',                 season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Black flats',             category: 'shoes',     colors: '["black"]',             occasions: '["city","smart-casual","evening"]',  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Tan ankle boots',         category: 'shoes',     colors: '["tan"]',               occasions: '["evening","smart-casual","city"]',  season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Navy slip-ons',           category: 'shoes',     colors: '["navy"]',              occasions: '["smart-casual","casual"]',          season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Flat sandals',            category: 'shoes',     colors: '["brown"]',             occasions: '["smart-casual","casual"]',          season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Hiking boots',            category: 'shoes',     colors: '["brown"]',             occasions: '["outdoor"]',                        season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Flip-flops',              category: 'shoes',     colors: '["tan"]',               occasions: '["home"]',                           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Platform sandals',        category: 'shoes',     colors: '["tan"]',               occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Grey pointed flats',      category: 'shoes',     colors: '["grey"]',              occasions: '["city","evening"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Taupe sneakers',          category: 'shoes',     colors: '["tan"]',               occasions: '["home","casual"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      // Accessories
      { name: 'Red/orange crossbody bag',   category: 'accessory', colors: '["red","orange"]',  occasions: '["casual","city"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Amber pendant necklace',     category: 'accessory', colors: '["amber"]',          occasions: '["city","evening","smart-casual"]',  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Green beaded necklace',      category: 'accessory', colors: '["green"]',          occasions: '["evening","city"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Turquoise pendant',          category: 'accessory', colors: '["turquoise"]',      occasions: '["casual","city"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Colorful loop scarf',        category: 'accessory', colors: '["multi"]',          occasions: '["casual","city","evening"]',        season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Brown leather belt',         category: 'accessory', colors: '["brown"]',          occasions: '["smart-casual","city"]',            season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Woven/rattan crossbody bag', category: 'accessory', colors: '["tan","brown"]',    occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Green bucket hat',           category: 'accessory', colors: '["green"]',          occasions: '["outdoor"]',                        season: 'warm',       notes: '',                                             status: 'active' },
    ]
    pieces.forEach(p => ins.run(p))
  })
  seedPieces()

  const constitutionMigration = db.prepare("SELECT value FROM app_meta WHERE key = 'constitution_migrated'").get()?.value
  if (constitutionMigration !== 'fresh') {
    const insTodo = db.prepare('INSERT INTO todos (type, description) VALUES (@type, @description)')
    LEGACY_SEED_TODOS.forEach(t => insTodo.run(t))
  }

  console.log('✓ Wardrobe seeded with sample data')
}

// Spec 32 follow-up: fresh/onboarded users must not inherit the legacy owner's
// personal task list. Clean up only the exact demo rows that briefly leaked into
// fresh DBs; legacy-seeded owner databases keep their existing todos untouched.
try {
  const cleanupMarker = db.prepare("SELECT value FROM app_meta WHERE key = 'legacy_todos_fresh_cleanup'").get()
  const constitutionMigration = db.prepare("SELECT value FROM app_meta WHERE key = 'constitution_migrated'").get()?.value
  if (!cleanupMarker && constitutionMigration === 'fresh') {
    const delLegacyTodo = db.prepare(`
      DELETE FROM todos
      WHERE type = ?
        AND description = ?
        AND linked_piece_id IS NULL
        AND completed = 0
    `)
    const insMeta = db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('legacy_todos_fresh_cleanup', 'true')")
    db.transaction(() => {
      LEGACY_SEED_TODOS.forEach(t => delLegacyTodo.run(t.type, t.description))
      insMeta.run()
    })()
  }
} catch (err) {
  console.warn('Legacy todo cleanup warning:', err.message)
}

// ── Helpers ────────────────────────────────────────────────────────────────────
export function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value || '') } catch { return fallback }
}

export const parsePiece = p => p ? ({
  ...p,
  colors:                JSON.parse(p.colors                || '[]'),
  occasions:             JSON.parse(p.occasions             || '[]'),
  occasion_permissions:   JSON.parse(p.occasion_permissions  || '[]'),
  occasion_exclusions:    JSON.parse(p.occasion_exclusions   || '[]'),
  styling_rules_learned: JSON.parse(p.styling_rules_learned || '[]'),
  pairs_well_with:       JSON.parse(p.pairs_well_with       || '[]'),
  tried_and_rejected:    JSON.parse(p.tried_and_rejected    || '[]'),
  style_profile_json:    safeJsonParse(p.style_profile_json, {}) || {},
  fiber_content:         safeJsonParse(p.fiber_content, [])      || [],
  formality:             p.formality             || null,
  heel_height:           p.heel_height           || null,
  walk_support:          p.walk_support          || null,
  recommendation_status: p.recommendation_status || 'trusted',
  fit_confidence:        p.fit_confidence        || 'unknown',
  role_permission:       p.role_permission       || 'auto',
  engine_notes:          p.engine_notes          || '',
  tag_state:             p.tag_state             || 'untagged',
  manual_overrides:      safeJsonParse(p.manual_overrides, [])   || [],
  favorite: Boolean(p.favorite)
}) : null

export { db, uploadsDir }
