import { db, uploadsDir, parsePiece } from '../db.js';
import { tagPieceWithProvider } from '../routes/ai.js';
import { normalizeManualOverrides, getPath } from '../styling-engine/taggerMerge.js';
import path from 'path';
import fs from 'fs';

// Simple CLI argument parser
const args = process.argv.slice(2);
const targetId = args.includes('--id') ? Number(args[args.indexOf('--id') + 1]) : null;
const targetField = args.includes('--field') ? args[args.indexOf('--field') + 1] : null;
const targetConfidence = args.includes('--confidence') ? args[args.indexOf('--confidence') + 1] : null;
const targetLimit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : null;
const runAllBoth = args.includes('--all-both');
const runWiped = args.includes('--wiped');
const isWrite = args.includes('--write');

// Budget cap variables
let cumulativeCost = 0;
const COST_PER_PIECE_ESTIMATE = 0.018; // conservative USD cost per successful piece tagging call
const MAX_COST_LIMIT = 3.00; // stop when estimated spend reaches $3.00

function getDiff(oldVal, newVal) {
  const diff = {};
  for (const key of Object.keys(newVal)) {
    const oldStr = typeof oldVal[key] === 'object' ? JSON.stringify(oldVal[key]) : String(oldVal[key] || '');
    const newStr = typeof newVal[key] === 'object' ? JSON.stringify(newVal[key]) : String(newVal[key] || '');
    if (oldStr !== newStr) {
      diff[key] = { old: oldVal[key], new: newVal[key] };
    }
  }
  return diff;
}

async function retagPiece(id) {
  const rawPiece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(id);
  if (!rawPiece) {
    console.error(`Piece ${id} not found.`);
    return;
  }
  const piece = parsePiece(rawPiece);

  const photos = [];
  if (piece.photo) {
    const hangerPath = path.join(uploadsDir, piece.photo);
    if (fs.existsSync(hangerPath)) {
      photos.push({
        path: hangerPath,
        label: 'HANGER PHOTO',
        guidance: 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.'
      });
    }
  }
  if (piece.worn_photo) {
    const wornPath = path.join(uploadsDir, piece.worn_photo);
    if (fs.existsSync(wornPath)) {
      photos.push({
        path: wornPath,
        label: 'WORN PHOTO',
        guidance: 'Use for fit, drape, scale, real-wear behavior, outfit role, and risks. Do not override literal garment color/category from this styling context.'
      });
    }
  }

  if (photos.length === 0) {
    console.log(`Piece ${id} (${piece.name}) has no photos in uploads/. Skipping.`);
    return;
  }

  console.log(`\n[Process] Retagging Piece ${id}: "${piece.name}" (${photos.length} photo(s))...`);
  try {
    const tags = await tagPieceWithProvider(photos, piece);
    cumulativeCost += COST_PER_PIECE_ESTIMATE;
    console.log(`[Cost Tracker] Model call succeeded. Cumulative estimated cost: $${cumulativeCost.toFixed(3)}`);
    
    // Build proposed updates object with field isolation
    const proposedUpdates = {
      category:           piece.category,
      colors:             JSON.stringify(piece.colors || []),
      occasions:          JSON.stringify(piece.occasions || []),
      season:             piece.season,
      name:               piece.name || '',
      notes:              piece.notes || '',
      background_color:   piece.background_color,
      pattern_type:       piece.pattern_type,
      pattern_scale:      piece.pattern_scale,
      pattern_complexity: piece.pattern_complexity,
      reads_as:           piece.reads_as,
      hem_finish:         piece.hem_finish,
      neckline:           piece.neckline,
      sleeve_type:        piece.sleeve_type,
      length_hits_at:     piece.length_hits_at,
      silhouette:         piece.silhouette,
      fabric_category:    piece.fabric_category,
      fabric_weight:      piece.fabric_weight,
      fit_on_body:        piece.fit_on_body,
      fiber_content:      JSON.stringify(piece.fiber_content || []),
      formality:          piece.formality,
      heel_height:        piece.heel_height,
      walk_support:       piece.walk_support,
      style_profile_json: JSON.stringify(piece.style_profile_json || {})
    };

    const shouldUpdate = (f) => !targetField || targetField === f;

    if (shouldUpdate('category')) proposedUpdates.category = tags.category || piece.category;
    if (shouldUpdate('colors')) proposedUpdates.colors = tags.colors ? JSON.stringify(tags.colors) : JSON.stringify(piece.colors || []);
    if (shouldUpdate('occasions')) proposedUpdates.occasions = tags.occasions ? JSON.stringify(tags.occasions) : JSON.stringify(piece.occasions || []);
    if (shouldUpdate('season')) proposedUpdates.season = tags.season || piece.season;
    if (shouldUpdate('name')) proposedUpdates.name = piece.name || tags.name_suggestion || '';
    if (shouldUpdate('notes')) proposedUpdates.notes = piece.notes || tags.notes_suggestion || '';
    if (shouldUpdate('background_color')) proposedUpdates.background_color = tags.background_color || piece.background_color;
    if (shouldUpdate('pattern_type')) proposedUpdates.pattern_type = tags.pattern_type || piece.pattern_type;
    if (shouldUpdate('pattern_scale')) proposedUpdates.pattern_scale = tags.pattern_scale || piece.pattern_scale;
    if (shouldUpdate('pattern_complexity')) proposedUpdates.pattern_complexity = tags.pattern_complexity || piece.pattern_complexity;
    if (shouldUpdate('reads_as')) proposedUpdates.reads_as = tags.reads_as || piece.reads_as;
    if (shouldUpdate('hem_finish')) proposedUpdates.hem_finish = tags.hem_finish || piece.hem_finish;
    if (shouldUpdate('neckline')) proposedUpdates.neckline = tags.neckline || piece.neckline;
    if (shouldUpdate('sleeve_type')) proposedUpdates.sleeve_type = tags.sleeve_type || piece.sleeve_type;
    if (shouldUpdate('length_hits_at')) proposedUpdates.length_hits_at = tags.length_hits_at || piece.length_hits_at;
    if (shouldUpdate('silhouette')) proposedUpdates.silhouette = tags.silhouette || piece.silhouette;
    if (shouldUpdate('fabric_category')) proposedUpdates.fabric_category = tags.fabric_category || piece.fabric_category;
    if (shouldUpdate('fabric_weight')) proposedUpdates.fabric_weight = tags.fabric_weight || piece.fabric_weight;
    if (shouldUpdate('fit_on_body')) proposedUpdates.fit_on_body = (tags.fit_on_body && tags.fit_on_body !== 'none') ? tags.fit_on_body : piece.fit_on_body;
    if (shouldUpdate('fiber_content')) proposedUpdates.fiber_content = tags.fiber_content ? JSON.stringify(tags.fiber_content) : JSON.stringify(piece.fiber_content || []);
    if (shouldUpdate('formality')) proposedUpdates.formality = tags.formality || piece.formality;
    if (shouldUpdate('heel_height')) proposedUpdates.heel_height = tags.heel_height || piece.heel_height;
    if (shouldUpdate('walk_support')) proposedUpdates.walk_support = tags.walk_support || piece.walk_support;

    // For style_profile_json
    let mergedProfile = { ...piece.style_profile_json };
    if (targetField) {
      if (!mergedProfile._confidence) mergedProfile._confidence = {};
      const targetConfKey = targetField.replace(/^style_profile_json\./, '');
      const taggerConf = tags.style_profile_json?._confidence?.[targetConfKey] || tags._confidence?.[targetConfKey];
      if (taggerConf) {
        mergedProfile._confidence[targetConfKey] = taggerConf;
      }
      if (targetField.startsWith('style_profile_json.')) {
        const profileKey = targetField.replace(/^style_profile_json\./, '');
        const val = tags[profileKey] ?? tags.style_profile_json?.[profileKey];
        if (val !== undefined) {
          mergedProfile[profileKey] = val;
        }
      }
      proposedUpdates.style_profile_json = JSON.stringify(mergedProfile);
    } else if (tags.style_profile_json) {
      proposedUpdates.style_profile_json = JSON.stringify(tags.style_profile_json);
    }

    // Standardize comparison values
    const oldComparison = { ...piece };
    const newComparison = {
      ...piece,
      ...proposedUpdates,
      colors: JSON.parse(proposedUpdates.colors),
      occasions: JSON.parse(proposedUpdates.occasions),
      fiber_content: JSON.parse(proposedUpdates.fiber_content),
      style_profile_json: JSON.parse(proposedUpdates.style_profile_json)
    };

    const diff = getDiff(oldComparison, newComparison);
    
    if (Object.keys(diff).length === 0) {
      console.log(`✓ No changes proposed for Piece ${id}.`);
      return;
    }

    // Write-path guard: check if any manually overridden field is being modified
    const overrides = normalizeManualOverrides(piece.manual_overrides);
    if (overrides.length > 0) {
      for (const override of overrides) {
        const oldVal = getPath(oldComparison, override);
        const newVal = getPath(newComparison, override);
        const oldStr = typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal || '');
        const newStr = typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal || '');
        if (oldStr !== newStr) {
          throw new Error(`Write-path guard: Attempted to overwrite manual override field '${override}' on piece ${id} (${piece.name})`);
        }
      }
    }

    console.log(`Proposed Diffs for Piece ${id} ("${piece.name}"):`);
    for (const [field, change] of Object.entries(diff)) {
      if (field === 'style_profile_json') {
        console.log(`  - style_profile_json:`);
        const oldLanes = change.old.style_lanes || {};
        const newLanes = change.new.style_lanes || {};
        console.log(`    * style_lanes:`, JSON.stringify(oldLanes), `->`, JSON.stringify(newLanes));
        console.log(`    * best_use:   `, JSON.stringify(change.old.style_notes?.best_use), `->`, JSON.stringify(change.new.style_notes?.best_use));
        console.log(`    * risk:       `, JSON.stringify(change.old.style_notes?.risk), `->`, JSON.stringify(change.new.style_notes?.risk));
      } else {
        console.log(`  - ${field}: ${JSON.stringify(change.old)} -> ${JSON.stringify(change.new)}`);
      }
    }

    if (isWrite) {
      db.prepare(`
        UPDATE pieces
        SET category = ?, colors = ?, occasions = ?, season = ?, name = ?, notes = ?,
            background_color = ?, pattern_type = ?, pattern_scale = ?, pattern_complexity = ?,
            reads_as = ?, hem_finish = ?, neckline = ?, sleeve_type = ?, length_hits_at = ?,
            silhouette = ?, fabric_category = ?, fabric_weight = ?, fit_on_body = ?, 
            fiber_content = ?, formality = ?, heel_height = ?, walk_support = ?, style_profile_json = ?
        WHERE id = ?
      `).run(
        proposedUpdates.category,
        proposedUpdates.colors,
        proposedUpdates.occasions,
        proposedUpdates.season,
        proposedUpdates.name,
        proposedUpdates.notes,
        proposedUpdates.background_color,
        proposedUpdates.pattern_type,
        proposedUpdates.pattern_scale,
        proposedUpdates.pattern_complexity,
        proposedUpdates.reads_as,
        proposedUpdates.hem_finish,
        proposedUpdates.neckline,
        proposedUpdates.sleeve_type,
        proposedUpdates.length_hits_at,
        proposedUpdates.silhouette,
        proposedUpdates.fabric_category,
        proposedUpdates.fabric_weight,
        proposedUpdates.fit_on_body,
        proposedUpdates.fiber_content,
        proposedUpdates.formality,
        proposedUpdates.heel_height,
        proposedUpdates.walk_support,
        proposedUpdates.style_profile_json,
        id
      );
      console.log(`✓ Database successfully updated for Piece ${id}.`);
    } else {
      console.log(`[Dry Run] Database NOT updated. (Run with --write to save)`);
    }

  } catch (error) {
    console.error(`✗ Error retagging Piece ${id}:`, error);
  }
}

async function main() {
  if (targetId) {
    await retagPiece(targetId);
  } else if (targetField && targetConfidence) {
    const rows = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece);
    const targetIds = [];
    for (const r of rows) {
      const overrides = normalizeManualOverrides(r.manual_overrides);
      if (overrides.includes(targetField)) continue; // skip manual overrides

      const confMap = r.style_profile_json?._confidence || {};
      const confidence = String(confMap[targetField] || '').toLowerCase();
      if (confidence === targetConfidence.toLowerCase()) {
        targetIds.push(r.id);
      }
    }
    let selectedIds = targetIds;
    if (targetLimit) {
      selectedIds = targetIds.slice(0, targetLimit);
    }
    console.log(`Starting batch run for ${selectedIds.length} garments (filtered from ${targetIds.length}) with ${targetField} confidence = '${targetConfidence}'...`);
    for (const id of selectedIds) {
      if (cumulativeCost >= MAX_COST_LIMIT) {
        console.log(`[Budget Cap] Stopping batch: cumulative cost has reached $${cumulativeCost.toFixed(3)} (Limit: $${MAX_COST_LIMIT.toFixed(2)})`);
        break;
      }
      await retagPiece(id);
    }
  } else if (runAllBoth) {
    const rows = db.prepare("SELECT id FROM pieces WHERE photo IS NOT NULL AND worn_photo IS NOT NULL").all();
    console.log(`Starting batch run for all ${rows.length} garments with both photos...`);
    for (const r of rows) {
      if (cumulativeCost >= MAX_COST_LIMIT) {
        console.log(`[Budget Cap] Stopping batch: cumulative cost has reached $${cumulativeCost.toFixed(3)} (Limit: $${MAX_COST_LIMIT.toFixed(2)})`);
        break;
      }
      await retagPiece(r.id);
    }
  } else if (runWiped) {
    const rows = db.prepare("SELECT id, style_profile_json FROM pieces WHERE photo IS NOT NULL OR worn_photo IS NOT NULL").all().map(parsePiece);
    const targetIds = [];
    for (const r of rows) {
      const sum = Object.values(r.style_profile_json.style_lanes || {}).reduce((a, b) => a + Number(b || 0), 0);
      if (sum === 0 || sum === 1) {
        targetIds.push(r.id);
      }
    }
    console.log(`Starting batch run for ${targetIds.length} wiped garments that have photos...`);
    for (const id of targetIds) {
      if (cumulativeCost >= MAX_COST_LIMIT) {
        console.log(`[Budget Cap] Stopping batch: cumulative cost has reached $${cumulativeCost.toFixed(3)} (Limit: $${MAX_COST_LIMIT.toFixed(2)})`);
        break;
      }
      await retagPiece(id);
    }
  } else {
    console.log('Please provide a target command option:');
    console.log('  --id <number>               Retag a specific garment by ID');
    console.log('  --field <field> --confidence <level>   Retag garments with specific confidence level in a field');
    console.log('  --all-both                  Retag all garments that have both hanger and worn photos');
    console.log('  --wiped                     Retag all wiped garments that have photos');
    console.log('Add --write to save updates to the database.');
  }
}

main();
