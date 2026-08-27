#!/usr/bin/env node
/**
 * Read-only sleeve taxonomy census for Closet.
 *
 * Usage from the Closet repo root:
 *   node scripts/sleeve-taxonomy-census.mjs
 *   node scripts/sleeve-taxonomy-census.mjs /absolute/path/to/wardrobe.db
 *
 * Optional:
 *   WARDROBE_DB_PATH=/path/to/wardrobe.db node scripts/sleeve-taxonomy-census.mjs
 *
 * This script opens SQLite in readonly mode and NEVER writes.
 */

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const dbPath = path.resolve(
  process.argv[2] ||
  process.env.WARDROBE_DB_PATH ||
  path.join(process.cwd(), 'wardrobe.db')
);

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

function safeJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function countBy(rows, keyFn) {
  const out = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    out.set(key, (out.get(key) || 0) + 1);
  }
  return Object.fromEntries(
    [...out.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
}

function fieldConfidence(row, field) {
  const profile = safeJson(row.style_profile_json, {}) || {};
  const overrides = safeJson(row.manual_overrides, []) || [];
  if (Array.isArray(overrides) && (
    overrides.includes(field) ||
    overrides.includes(`style_profile_json._confidence.${field}`)
  )) return 'manual';
  return profile?._confidence?.[field] || null;
}

const columns = db.prepare(`PRAGMA table_info(pieces)`).all().map(r => r.name);
const required = [
  'id','name','category','status','photo','worn_photo',
  'sleeve_type','sleeve_length','sleeve_shape',
  'fabric_weight','tagger_version','tag_state',
  'manual_overrides','style_profile_json'
];
const available = required.filter(c => columns.includes(c));
const missing = required.filter(c => !columns.includes(c));

const rows = db.prepare(`
  SELECT ${available.map(c => `"${c}"`).join(', ')}
  FROM pieces
  ORDER BY id
`).all();

const clothing = rows.filter(r =>
  ['top', 'dress', 'outerwear'].includes(String(r.category || '').toLowerCase())
);

const normalize = v => {
  const s = String(v ?? '').trim().toLowerCase();
  return s || '(null/blank)';
};

const currentValues = ['fitted','straight','relaxed','puff','bishop','bell','flutter','raglan','dolman','other','unknown'];
// 'other' and 'unknown' are already valid values in the new taxonomy (see
// styling-engine/attributes.js's SLEEVE_SHAPE_VALUES) — they map to themselves, not to a review
// candidate. Only 'relaxed' and 'raglan' have no deterministic target and need manual visual
// reclassification (db.js's queueSleeveTaxonomyReviews flags exactly these two on migration).
const deterministicOldToProposed = {
  fitted: 'fitted',
  straight: 'straight',
  puff: 'puff_shoulder',
  bishop: 'voluminous',
  bell: 'flared',
  flutter: 'flared',
  dolman: 'deep_armhole',
  other: 'other',
  unknown: 'unknown',
};
const reviewOldValues = new Set(['relaxed','raglan']);

const detail = clothing.map(r => {
  const shape = normalize(r.sleeve_shape);
  const length = normalize(r.sleeve_length);
  const legacy = normalize(r.sleeve_type);
  const overrides = safeJson(r.manual_overrides, []) || [];
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    status: r.status,
    sleeve_length: length,
    sleeve_shape: shape,
    legacy_sleeve_type: legacy,
    fabric_weight: normalize(r.fabric_weight),
    sleeve_shape_confidence: fieldConfidence(r, 'sleeve_shape'),
    sleeve_length_confidence: fieldConfidence(r, 'sleeve_length'),
    sleeve_shape_manual_override: Array.isArray(overrides) && overrides.includes('sleeve_shape'),
    sleeve_length_manual_override: Array.isArray(overrides) && overrides.includes('sleeve_length'),
    tagger_version: r.tagger_version || null,
    tag_state: r.tag_state || null,
    has_photo: Boolean(r.photo),
    has_worn_photo: Boolean(r.worn_photo),
    proposed_deterministic_shape: deterministicOldToProposed[shape] || null,
    needs_visual_review_for_shape: reviewOldValues.has(shape),
  };
});

const manualShapeRows = detail.filter(r => r.sleeve_shape_manual_override);
const reviewRows = detail.filter(r => r.needs_visual_review_for_shape);
const unexpectedRows = detail.filter(r =>
  r.sleeve_shape !== '(null/blank)' && !currentValues.includes(r.sleeve_shape)
);

const legacyShapeOnly = detail.filter(r =>
  r.sleeve_shape === '(null/blank)' &&
  r.legacy_sleeve_type !== '(null/blank)'
);

const report = {
  database: dbPath,
  generated_at: new Date().toISOString(),
  schema: {
    pieces_columns_found: available,
    expected_columns_missing: missing,
  },
  totals: {
    all_pieces: rows.length,
    sleeve_applicable_pieces: clothing.length,
    with_sleeve_shape: detail.filter(r => r.sleeve_shape !== '(null/blank)').length,
    with_sleeve_length: detail.filter(r => r.sleeve_length !== '(null/blank)').length,
    manual_sleeve_shape_overrides: manualShapeRows.length,
    likely_visual_review_candidates: reviewRows.length,
    unexpected_sleeve_shape_values: unexpectedRows.length,
    legacy_sleeve_type_present_but_shape_blank: legacyShapeOnly.length,
  },
  distributions: {
    sleeve_shape: countBy(detail, r => r.sleeve_shape),
    sleeve_length: countBy(detail, r => r.sleeve_length),
    legacy_sleeve_type: countBy(detail, r => r.legacy_sleeve_type),
    sleeve_shape_confidence: countBy(detail, r => r.sleeve_shape_confidence || '(none)'),
    sleeve_length_confidence: countBy(detail, r => r.sleeve_length_confidence || '(none)'),
    tagger_version: countBy(detail, r => r.tagger_version || '(none)'),
    tag_state: countBy(detail, r => r.tag_state || '(none)'),
    category_by_shape: Object.fromEntries(
      [...new Set(detail.map(r => r.sleeve_shape))].sort().map(shape => [
        shape,
        countBy(detail.filter(r => r.sleeve_shape === shape), r => r.category || '(none)')
      ])
    ),
  },
  migration_preview: {
    deterministic_mapping_counts: countBy(
      detail.filter(r => r.proposed_deterministic_shape),
      r => `${r.sleeve_shape} -> ${r.proposed_deterministic_shape}`
    ),
    review_candidate_counts: countBy(reviewRows, r => r.sleeve_shape),
    note: 'No rows are modified. relaxed/raglan are flagged for manual review rather than guessed; other/unknown/null are already valid taxonomy values and are not review candidates.',
  },
  manual_sleeve_shape_overrides: manualShapeRows,
  unexpected_sleeve_shape_rows: unexpectedRows,
  legacy_shape_blank_rows: legacyShapeOnly,
  visual_review_candidates: reviewRows,
};

console.log(JSON.stringify(report, null, 2));
db.close();
