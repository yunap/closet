import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { LEGACY_PROFILE, LEGACY_CONSTITUTION } from './styling-engine/constitutionSeed.js'
import { DEFAULT_USER_ID, getCurrentUserId } from './lib/requestContext.js'
import {
  assertDefaultDatabaseAccess,
  createRotatingSqliteBackup,
  isServerEntrypoint,
} from './lib/databaseSafety.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const usersRootDir = process.env.WARDROBE_USERS_DIR || path.join(__dirname, 'data', 'users')
const defaultDbPath = path.join(__dirname, 'wardrobe.db')
const serverPath = path.join(__dirname, 'server.js')

const LEGACY_SEED_TODOS = [
  { type: 'repair', description: 'Fix zipper on mustard corduroy skinnies' },
  { type: 'shopping', description: 'Replace worn black sleeveless tank with better quality version — fitted, structured, not clingy' },
  { type: 'donate', description: 'Consider donating: grey tunic' },
  { type: 'donate', description: 'Consider donating: olive drapey tank' },
  { type: 'donate', description: 'Consider donating: worn black tank' },
  { type: 'shopping', description: 'Shop for: tan/cognac flat mule sandal' },
  { type: 'shopping', description: 'Shop for: quality black sleeveless top (fitted, structured, not clingy)' },
]

// ── Per-user path resolution ───────────────────────────────────────────────────
// Spec 33 Part 1: no auth exists yet, so DEFAULT_USER_ID is the only user that can ever
// be resolved. Its paths stay exactly where they are today (project-root wardrobe.db /
// uploads/, or the WARDROBE_DB_PATH / WARDROBE_UPLOADS_DIR env overrides used by all
// existing tests) so this refactor is a no-op for the one instance that exists right now.
// Part 3's adoption script is what later moves an instance's files into data/users/{id}/;
// non-default userIds (which can't exist until Part 2 ships auth) resolve there already.
export function resolveDbPath(userId) {
  if (process.env.WARDROBE_DB_PATH) return process.env.WARDROBE_DB_PATH
  if (userId === DEFAULT_USER_ID) {
    if (process.env.NODE_ENV === 'test' && process.env.WARDROBE_USERS_DIR) {
      return path.join(usersRootDir, String(userId), 'wardrobe.db')
    }
    assertDefaultDatabaseAccess({
      explicitDbPath: process.env.WARDROBE_DB_PATH,
      allowLiveDb: process.env.WARDROBE_ALLOW_LIVE_DB,
      entrypoint: process.argv[1],
      serverPath,
    })
    return defaultDbPath
  }
  return path.join(usersRootDir, String(userId), 'wardrobe.db')
}

export function resolveUploadsDir(userId) {
  if (process.env.WARDROBE_UPLOADS_DIR) return process.env.WARDROBE_UPLOADS_DIR
  if (userId === DEFAULT_USER_ID) return path.join(__dirname, 'uploads')
  return path.join(usersRootDir, String(userId), 'uploads')
}

export function userUploadsDir() {
  const dir = resolveUploadsDir(getCurrentUserId())
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ── Schema + migrations, run per-file on first open ────────────────────────────
function initDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

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
      is_demo      INTEGER DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS feedback_synthesis_batches (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      status                   TEXT NOT NULL DEFAULT 'authorized',
      feedback_ids             TEXT NOT NULL DEFAULT '[]',
      compact_input            TEXT NOT NULL DEFAULT '',
      input_hash               TEXT NOT NULL,
      provider                 TEXT DEFAULT '',
      model                    TEXT DEFAULT '',
      estimated_input_tokens   INTEGER DEFAULT 0,
      estimated_output_tokens  INTEGER DEFAULT 0,
      estimated_cost_usd       REAL,
      actual_usage             TEXT DEFAULT '{}',
      error                    TEXT DEFAULT '',
      created_at               TEXT DEFAULT (datetime('now')),
      completed_at             TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback_synthesis_drafts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id            INTEGER NOT NULL REFERENCES feedback_synthesis_batches(id) ON DELETE CASCADE,
      disposition         TEXT NOT NULL,
      title               TEXT DEFAULT '',
      proposed_text       TEXT DEFAULT '',
      boundary            TEXT DEFAULT '',
      rationale           TEXT DEFAULT '',
      confidence          TEXT DEFAULT '',
      source_feedback_ids TEXT NOT NULL DEFAULT '[]',
      related_draft_id    INTEGER,
      status              TEXT NOT NULL DEFAULT 'draft',
      edited_text         TEXT DEFAULT '',
      payload             TEXT DEFAULT '{}',
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_quality_findings (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      synthesis_draft_id  INTEGER NOT NULL UNIQUE REFERENCES feedback_synthesis_drafts(id) ON DELETE CASCADE,
      finding_type        TEXT NOT NULL DEFAULT 'general_styling_failure',
      status              TEXT NOT NULL DEFAULT 'open',
      title               TEXT DEFAULT '',
      description         TEXT DEFAULT '',
      source_feedback_ids TEXT NOT NULL DEFAULT '[]',
      evidence_snapshot   TEXT NOT NULL DEFAULT '[]',
      resolution_type     TEXT DEFAULT '',
      resolution_note     TEXT DEFAULT '',
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS owner_constraints (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      source_feedback_id  INTEGER REFERENCES stylist_feedback(id) ON DELETE SET NULL,
      status              TEXT NOT NULL DEFAULT 'active',
      selector_type       TEXT NOT NULL,
      selector_values     TEXT NOT NULL DEFAULT '[]',
      context_dimension   TEXT NOT NULL,
      context_values      TEXT NOT NULL DEFAULT '[]',
      reason              TEXT DEFAULT '',
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now'))
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
      links_indexed   INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saved_board_pieces (
      board_id INTEGER NOT NULL REFERENCES saved_boards(id) ON DELETE CASCADE,
      piece_id INTEGER NOT NULL,
      PRIMARY KEY (board_id, piece_id)
    );
    CREATE INDEX IF NOT EXISTS idx_saved_board_pieces_piece_id
      ON saved_board_pieces(piece_id, board_id);

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
      capsule_final_fallbacks INTEGER DEFAULT 0,
      capsule_supply_gaps INTEGER DEFAULT 0,
      capsule_looks_auto_completed INTEGER DEFAULT 0,
      capsule_roster_model_calls INTEGER DEFAULT 0,
      capsule_roster_model_repairs INTEGER DEFAULT 0,
      capsule_roster_model_fallbacks INTEGER DEFAULT 0,
      capsule_roster_failure_codes TEXT DEFAULT '',
      turn_failed             INTEGER DEFAULT 0,
      provider_iterations    INTEGER DEFAULT 0,
      provider_input_tokens  INTEGER DEFAULT 0,
      provider_output_tokens INTEGER DEFAULT 0,
      provider_cache_read_input_tokens INTEGER DEFAULT 0,
      provider_cache_creation_input_tokens INTEGER DEFAULT 0,
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
    'field TEXT',
    'source_type TEXT',
    'source_id INTEGER',
    "payload TEXT DEFAULT '{}'"
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
    // sleeve_type is superseded by the sleeve_length/sleeve_shape split below.
    // The old column is kept (never dropped, per this file's additive-only
    // migration convention) so historical data isn't destroyed, and its
    // values are one-time backfilled into the new columns further down. New
    // reads/writes should use sleeve_length/sleeve_shape, not sleeve_type.
    'sleeve_length TEXT', 'sleeve_shape TEXT',
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
    // 'yes'|'no'|NULL. NULL is "no dependency" to the engine (strict no-op) —
    // NOT the same as an owner-judged 'no'; only the second is evidence. See
    // docs/capsule-roster-selection-spec.md §7b.
    'needs_base TEXT',
    // accessory_subtype: belt|bag|jewelry|scarf|hat|watch|gloves|other. NULL
    // for all non-accessory categories. jewelry_type only meaningful
    // when accessory_subtype is 'jewelry'.
    'accessory_subtype TEXT',
    'jewelry_type TEXT',
    // necklace_length: choker|short|long. Only meaningful when jewelry_type is
    // 'necklace' — how it sits/falls, the detail that matters for neckline pairing.
    'necklace_length TEXT',
    // bottom_subtype: pants|shorts|skirt|culottes|overalls|other|unknown. NULL
    // for all non-bottom categories. Type only, deliberately no length baked
    // in — bottomKind() combines this with length_hits_at for skirt
    // granularity instead of encoding both into one value.
    'bottom_subtype TEXT',
  ]
  NEW_COLUMNS.forEach(col => {
    try { db.exec(`ALTER TABLE pieces ADD COLUMN ${col}`) } catch {}
  })

  // One-time backfill: sleeve_type -> sleeve_length / sleeve_shape split. The old
  // enum conflated two axes (sleeveless/cap/short/3-4/long/none are lengths;
  // bell/bishop are shapes with no length ever captured), so this is lossy by
  // construction for bell/bishop pieces — sleeve_length is left null for those
  // rather than guessed, and they surface through the normal missing-field
  // review flow like any other ungated attribute. Guarded to only touch rows
  // that haven't been split yet, so it's safe to run on every startup.
  try {
    const SLEEVE_LENGTH_VALUES = new Set(['sleeveless', 'cap', 'short', 'elbow', '3/4', 'long', 'extra_long'])
    const SLEEVE_SHAPE_VALUES = new Set(['fitted', 'straight', 'relaxed', 'puff', 'bishop', 'bell', 'flutter', 'dolman'])
    const unsplit = db.prepare(`
      SELECT id, sleeve_type FROM pieces
      WHERE sleeve_type IS NOT NULL AND sleeve_type != ''
        AND sleeve_length IS NULL AND sleeve_shape IS NULL
    `).all()
    const update = db.prepare('UPDATE pieces SET sleeve_length = ?, sleeve_shape = ? WHERE id = ?')
    for (const piece of unsplit) {
      const value = String(piece.sleeve_type || '').toLowerCase().trim()
      if (value === 'none' || value === 'unknown') continue
      const length = SLEEVE_LENGTH_VALUES.has(value) ? value : null
      const shape = SLEEVE_SHAPE_VALUES.has(value) ? value : null
      if (length || shape) update.run(length, shape, piece.id)
    }
  } catch (err) {
    console.warn('Failed to backfill sleeve_length/sleeve_shape from sleeve_type:', err.message)
  }

  // One-time remap: length_hits_at from one flat shared enum to a per-category
  // (and, for bottoms, per-bottom_subtype) vocabulary. Same column, values
  // rewritten in place — idempotent by construction: renamed values (e.g.
  // 'crop' -> 'cropped') never match an old-format key again on a later run,
  // and values already in the new format simply aren't keys in the rename
  // map, so they pass through untouched. Bottom pieces need bottom_subtype to
  // know which vocabulary applies; for pieces where that's still unset this
  // also backfills it from the same name/reads_as heuristic bottomKind() in
  // attributes.js already uses as its own fallback — not a superior
  // classifier, just enough to route this migration and give bottom_subtype
  // a real value instead of leaving it perpetually null pending re-tagging.
  try {
    const RENAME = {
      'crop': 'cropped', 'above-knee': 'above_knee', 'below-knee': 'below_knee',
      'mid-thigh': 'mid_thigh', 'full-length': 'full_length', 'mid-calf': 'mid_calf',
      'over-knee': 'over_knee',
    }
    const TOP_VALID = new Set(['cropped', 'waist', 'high_hip', 'hip', 'low_hip', 'tunic'])
    const OUTERWEAR_VALID = new Set(['cropped', 'waist', 'high_hip', 'hip', 'low_hip', 'mid_thigh', 'knee', 'mid_calf', 'ankle'])
    const SKIRT_VALID = new Set(['mini', 'above_knee', 'knee', 'below_knee', 'midi', 'ankle', 'maxi'])
    const PANTS_VALID = new Set(['shorts', 'knee', 'mid_calf', 'ankle', 'full_length', 'floor_length'])
    const SHOES_VALID = new Set(['low', 'below_ankle', 'ankle', 'high_top', 'mid_calf', 'knee', 'over_knee'])

    function remapLength(raw, validSet, extraRename = {}) {
      const value = String(raw || '').toLowerCase().trim()
      if (!value || value === 'unknown') return null
      const renamed = extraRename[value] || RENAME[value] || value
      return validSet.has(renamed) ? renamed : null
    }

    function guessBottomSubtype(name, readsAs) {
      const text = `${name || ''} ${readsAs || ''}`.toLowerCase()
      if (/\bskirt\b/.test(text)) return 'skirt'
      if (/\bshorts?\b/.test(text)) return 'shorts'
      return 'pants'
    }

    const rows = db.prepare(`
      SELECT id, category, bottom_subtype, name, reads_as, length_hits_at FROM pieces
      WHERE length_hits_at IS NOT NULL AND length_hits_at != ''
    `).all()
    const updateLength = db.prepare('UPDATE pieces SET length_hits_at = ? WHERE id = ?')
    const updateBoth = db.prepare('UPDATE pieces SET length_hits_at = ?, bottom_subtype = ? WHERE id = ?')
    for (const piece of rows) {
      const category = String(piece.category || '').toLowerCase().trim()
      let remapped = null
      let subtypeToWrite = null
      if (category === 'top') {
        remapped = remapLength(piece.length_hits_at, TOP_VALID)
      } else if (category === 'outerwear') {
        remapped = remapLength(piece.length_hits_at, OUTERWEAR_VALID)
      } else if (category === 'dress') {
        remapped = remapLength(piece.length_hits_at, SKIRT_VALID, { short: 'mini', 'full-length': 'maxi' })
      } else if (category === 'shoes') {
        remapped = remapLength(piece.length_hits_at, SHOES_VALID, { open: 'low', closed: null })
      } else if (category === 'bottom') {
        const subtype = String(piece.bottom_subtype || '').toLowerCase().trim() || guessBottomSubtype(piece.name, piece.reads_as)
        if (!piece.bottom_subtype) subtypeToWrite = subtype
        remapped = subtype === 'skirt'
          ? remapLength(piece.length_hits_at, SKIRT_VALID, { short: 'mini', 'full-length': 'maxi' })
          : remapLength(piece.length_hits_at, PANTS_VALID, { short: 'shorts' })
      } else {
        continue // accessory: length_hits_at not applicable
      }
      if (remapped !== String(piece.length_hits_at || '').toLowerCase().trim()) {
        if (subtypeToWrite) updateBoth.run(remapped, subtypeToWrite, piece.id)
        else updateLength.run(remapped, piece.id)
      } else if (subtypeToWrite) {
        db.prepare('UPDATE pieces SET bottom_subtype = ? WHERE id = ?').run(subtypeToWrite, piece.id)
      }
    }
  } catch (err) {
    console.warn('Failed to remap length_hits_at to per-category vocabulary:', err.message)
  }

  // Additive learning-schema migrations. Existing local databases keep working.
  ;[
    'is_gold INTEGER DEFAULT 0',
    'archived INTEGER DEFAULT 0'
  ].forEach(col => {
    try { db.exec(`ALTER TABLE stylist_feedback ADD COLUMN ${col}`) } catch {}
  })

  ;[
    "evidence_snapshot TEXT NOT NULL DEFAULT '[]'"
  ].forEach(col => {
    try { db.exec(`ALTER TABLE product_quality_findings ADD COLUMN ${col}`) } catch {}
  })

  ;[
    'hidden_from_lookbook INTEGER DEFAULT 0',
    'links_indexed INTEGER DEFAULT 0'
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
    'submit_plan_partial_accepts INTEGER DEFAULT 0',
    'capsule_final_fallbacks INTEGER DEFAULT 0',
    'capsule_supply_gaps INTEGER DEFAULT 0',
    'capsule_looks_auto_completed INTEGER DEFAULT 0',
    'capsule_roster_model_calls INTEGER DEFAULT 0',
    'capsule_roster_model_repairs INTEGER DEFAULT 0',
    'capsule_roster_model_fallbacks INTEGER DEFAULT 0',
    // A fallback used to record only that it happened. thread_1785451253837
    // fell back and the reason was discarded, so the next step was one more
    // paid run rather than a lookup.
    'capsule_roster_failure_codes TEXT DEFAULT ""',
    // A turn that throws used to record NOTHING. persistFreeformGenerationRun
    // ran only on the success path, so when the composition call failed
    // (thread_1785902365403: provider credit exhausted mid-capsule) the roster
    // call that had already completed — and been paid for — left no trace of
    // what it chose or whether it passed. The row is now written either way,
    // and says which it was, so a failed turn is not silently indistinguishable
    // from a successful one in the same table.
    'turn_failed INTEGER DEFAULT 0',
    'provider_iterations INTEGER DEFAULT 0',
    'provider_input_tokens INTEGER DEFAULT 0',
    'provider_output_tokens INTEGER DEFAULT 0',
    'provider_cache_read_input_tokens INTEGER DEFAULT 0',
    'provider_cache_creation_input_tokens INTEGER DEFAULT 0'
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
      crop_ok     INTEGER DEFAULT 1,
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
      tags_json             TEXT DEFAULT NULL,
      result_piece_id       INTEGER,
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

  // Additive migrations for import_clusters (pre-existing scratch DBs).
  ;['tags_json TEXT DEFAULT NULL', 'result_piece_id INTEGER'].forEach(col => {
    try { db.exec(`ALTER TABLE import_clusters ADD COLUMN ${col}`) } catch {}
  })
  ;['crop_ok INTEGER DEFAULT 1'].forEach(col => {
    try { db.exec(`ALTER TABLE import_garments ADD COLUMN ${col}`) } catch {}
  })
  ;['is_demo INTEGER DEFAULT 0'].forEach(col => {
    try { db.exec(`ALTER TABLE pieces ADD COLUMN ${col}`) } catch {}
  })

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
  db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('seeded', 'true')").run()
  // Owner ruling 2026-07-19: fresh instances start with an EMPTY wardrobe. The former
  // auto-seeded 62 sample pieces are now the opt-in demo wardrobe (demoWardrobe.js),
  // loadable from the import screen or Settings and removable in one action.

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

  if (path.resolve(dbPath) === path.resolve(defaultDbPath) && isServerEntrypoint(process.argv[1], serverPath)) {
    const backupPath = createRotatingSqliteBackup(db, { dbPath })
    console.log(`🛟 Wardrobe backup verified → ${backupPath}`)
  }

  return db
}

// ── Per-user connection cache ───────────────────────────────────────────────────
// better-sqlite3 handles many open files fine and its calls are synchronous
// (microseconds), but an unbounded cache would mean N users = N permanently open
// file handles. Idle-eviction keeps that bounded without adding any async layer.
const MAX_OPEN_DB_CONNECTIONS = Number(process.env.MAX_OPEN_DB_CONNECTIONS) || 50
const connectionsByUser = new Map() // userId -> { conn, lastUsed }

function getDbForUser(userId) {
  const existing = connectionsByUser.get(userId)
  if (existing) {
    existing.lastUsed = Date.now()
    return existing.conn
  }
  if (connectionsByUser.size >= MAX_OPEN_DB_CONNECTIONS) {
    let oldestId = null
    let oldestTime = Infinity
    for (const [id, entry] of connectionsByUser) {
      if (entry.lastUsed < oldestTime) { oldestTime = entry.lastUsed; oldestId = id }
    }
    if (oldestId !== null) {
      connectionsByUser.get(oldestId).conn.close()
      connectionsByUser.delete(oldestId)
    }
  }
  const conn = initDb(resolveDbPath(userId))
  connectionsByUser.set(userId, { conn, lastUsed: Date.now() })
  return conn
}

// `db` forwards every call (prepare/exec/transaction/pragma/...) to the current
// request's connection. This is the whole reason for the Proxy: the ~250 existing
// `db.prepare(...)` call sites across 8 modules don't need to change at all.
const db = new Proxy({}, {
  get(_target, prop, _receiver) {
    const conn = getDbForUser(getCurrentUserId())
    const value = conn[prop]
    return typeof value === 'function' ? value.bind(conn) : value
  }
})

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

export { db, getDbForUser }
