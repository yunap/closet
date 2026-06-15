import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const uploadsDir = process.env.WARDROBE_UPLOADS_DIR || path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir)

const db = new Database(process.env.WARDROBE_DB_PATH || 'wardrobe.db')
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
    completed       INTEGER DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS stylist_conversation_state (
    session_id   TEXT PRIMARY KEY,
    state_json   TEXT NOT NULL,
    updated_at   TEXT DEFAULT (datetime('now'))
  );
`)

// ── Migrate: add new columns to existing DB ───────────────────────────────────
const NEW_COLUMNS = [
  'worn_photo TEXT',
  'pattern_type TEXT', 'pattern_scale TEXT', 'pattern_complexity TEXT',
  'reads_as TEXT', 'hem_finish TEXT',
  'neckline TEXT', 'sleeve_type TEXT', 'length_hits_at TEXT',
  'silhouette TEXT', 'fabric_category TEXT', 'fabric_weight TEXT',
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

// ── Seed data (first run only) ─────────────────────────────────────────────────
const seeded = db.prepare("SELECT value FROM app_meta WHERE key = 'seeded'").get()
if (!seeded) {
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

  const insTodo = db.prepare('INSERT INTO todos (type, description) VALUES (@type, @description)')
  ;[
    { type: 'repair',   description: 'Fix zipper on mustard corduroy skinnies' },
    { type: 'shopping', description: 'Replace worn black sleeveless tank with better quality version — fitted, structured, not clingy' },
    { type: 'donate',   description: 'Consider donating: grey tunic' },
    { type: 'donate',   description: 'Consider donating: olive drapey tank' },
    { type: 'donate',   description: 'Consider donating: worn black tank' },
    { type: 'shopping', description: 'Shop for: tan/cognac flat mule sandal' },
    { type: 'shopping', description: 'Shop for: quality black sleeveless top (fitted, structured, not clingy)' },
  ].forEach(t => insTodo.run(t))

  db.prepare("INSERT INTO app_meta (key, value) VALUES ('seeded', 'true')").run()
  console.log('✓ Wardrobe seeded with sample data')
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
  recommendation_status: p.recommendation_status || 'trusted',
  fit_confidence:        p.fit_confidence        || 'unknown',
  role_permission:       p.role_permission       || 'auto',
  engine_notes:          p.engine_notes          || '',
  tag_state:             p.tag_state             || 'untagged',
  manual_overrides:      safeJsonParse(p.manual_overrides, [])   || [],
  favorite: Boolean(p.favorite)
}) : null

export { db, uploadsDir }
