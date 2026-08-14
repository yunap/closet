import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { db, userUploadsDir, safeJsonParse, parsePiece } from '../db.js'
import { prompts, loadUserProfile, refreshPrompts } from '../styling-engine/promptRuntime.js'
import { CONSTITUTION_LAYER_KEYS, DEFAULT_CONSTITUTION } from '../styling-engine/prompts.js'
import { DEMO_WARDROBE_PIECES, seedDemoWardrobe, demoWardrobeCount, removeDemoWardrobe } from '../demoWardrobe.js'
import { collectPieceIdsFromSavedBoardRow, getPieceUsageStats } from '../styling-engine/rules.js'
import { ownKeyStatus, setOwnKey } from '../lib/apiKeys.js'
import {
  mergeWithManualOverrides,
  normalizeAccessorySubtype,
  normalizeBottomSubtype,
  normalizeFormality,
  normalizeHeelHeight,
  normalizeJewelryType,
  normalizeNecklaceLength,
  normalizeManualOverrides,
  normalizeWalkSupport,
  pinManualConfidence,
  tagStateForPhotos
} from '../styling-engine/taggerMerge.js'
import { applySoftScoreFloors } from '../styling-engine/softScoreFloors.js'
import { compactChatThreadMemory } from '../lib/chatThreadMetadata.js'
import {
  cachedThumbnailUrl,
  cachedThumbnailUrlForUpload,
  ensureCachedThumbnail,
  subjectThumbnailUrl
} from '../lib/subjectThumbnails.js'
import { COLOR_TAXONOMY, colorTaxonomyEntry } from '../lib/colorTaxonomy.js'
import { queueColorTaxonomyReviews } from '../lib/colorTaxonomyReview.js'
import { activeMemoryMetadata } from '../lib/activeMemory.js'
import { buildFeedbackEvidence } from '../lib/feedbackEvidence.js'
import {
  buildLegacyOutfitSnapshotEvidence,
  buildOutfitLogicEvidence,
  canonicalFeedbackType,
  KNOWN_FEEDBACK_TYPES,
  POSITIVE_OUTFIT_LOGIC_TYPES,
  REASONED_OUTFIT_VERDICT_TYPES,
  WRONG_PIECE_FOR_OUTFIT_FEEDBACK,
} from '../lib/feedbackTaxonomy.js'

const router = express.Router()

// Multer storage setup matching server.js
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, userUploadsDir()),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, unique + path.extname(file.originalname))
  }
})
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } })

function prepareUploadedThumbnails(variants) {
  return async (req, res, next) => {
    const files = [
      ...(req.files?.photo || []),
      ...(req.files?.worn_photo || []),
      ...(req.file ? [req.file] : [])
    ]
    try {
      await Promise.all(files.flatMap(file => (
        variants.map(variant => ensureCachedThumbnail(file.filename, userUploadsDir(), variant))
      )))
      next()
    } catch (err) {
      next(err)
    }
  }
}

const preparePieceThumbnails = prepareUploadedThumbnails(['subject'])
const prepareOutfitThumbnails = prepareUploadedThumbnails(['subject', 'relationship-outfit'])
const prepareCalibrationThumbnails = prepareUploadedThumbnails(['visual-reference'])

function normalizeCalibrationRow(row) {
  return {
    ...row,
    thumbnail_url: cachedThumbnailUrlForUpload(row.image_url, 'visual-reference'),
    favorite: Boolean(row.favorite),
    archived: Boolean(row.archived),
    labels: safeJsonParse(row.labels, []) || []
  }
}

function retagSuggestionsForPieces(pieceIds = []) {
  const ids = [...new Set(pieceIds.map(Number).filter(Boolean))]
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT * FROM todos
    WHERE completed = 0 AND type = 'retag-suggestion'
      AND linked_piece_id IN (${placeholders})
    ORDER BY id DESC
  `).all(...ids)
  const byPiece = new Map()
  for (const row of rows) {
    const suggestion = { ...row, payload: safeJsonParse(row.payload, {}) || {} }
    const list = byPiece.get(Number(row.linked_piece_id)) || []
    list.push(suggestion)
    byPiece.set(Number(row.linked_piece_id), list)
  }
  return byPiece
}

function withRetagSuggestions(piece, suggestionsByPiece = null) {
  const parsed = parsePiece(piece)
  const suggestions = suggestionsByPiece
    ? (suggestionsByPiece.get(Number(piece.id)) || [])
    : (retagSuggestionsForPieces([piece.id]).get(Number(piece.id)) || [])
  return { ...parsed, retag_suggestions: suggestions }
}

// ── Pieces API ─────────────────────────────────────────────────────────────────
router.get('/pieces', (req, res) => {
  const { category, occasion, season, status, search, favorites, color, color_family, fabric } = req.query
  let q = 'SELECT * FROM pieces WHERE 1=1'
  const params = []
  if (category)  { q += ' AND category = ?';              params.push(category) }
  if (season && season !== 'all') { q += " AND (season = ? OR season = 'year-round')"; params.push(season) }
  if (status)    { q += ' AND status = ?';                params.push(status) }
  if (search)    {
    const searchVal = String(search).trim()
    const isNum = /^\d+$/.test(searchVal)
    q += ` AND (
      ${isNum ? 'id = ? OR' : ''}
      name LIKE ? OR
      colors LIKE ? OR
      reads_as LIKE ? OR
      silhouette LIKE ? OR
      fabric_category LIKE ? OR
      pattern_type LIKE ? OR
      neckline LIKE ? OR
      sleeve_length LIKE ? OR
      sleeve_shape LIKE ?
    )`
    const term = `%${search}%`
    if (isNum) {
      params.push(Number(searchVal))
    }
    params.push(term, term, term, term, term, term, term, term, term)
  }
  if (occasion)  { q += ' AND occasions LIKE ?';          params.push(`%"${occasion}"%`) }
  if (color)     { q += ' AND colors LIKE ?';             params.push(`%"${color}"%`) }
  else if (color_family) {
    const familyColors = COLOR_TAXONOMY.filter(entry => entry.family === color_family).map(entry => entry.name)
    if (familyColors.length) {
      q += ` AND (${familyColors.map(() => 'colors LIKE ?').join(' OR ')})`
      params.push(...familyColors.map(name => `%"${name}"%`))
    }
  }
  if (fabric)    { q += ' AND fabric_category = ?';       params.push(fabric) }
  if (favorites === 'true') { q += ' AND favorite = 1' }
  q += ' ORDER BY favorite DESC, date_added DESC'
  const rows = db.prepare(q).all(...params)
  const suggestions = retagSuggestionsForPieces(rows.map(row => row.id))
  res.json(rows.map(row => withRetagSuggestions(row, suggestions)))
})

router.get('/pieces/meta', (req, res) => {
  const rows = db.prepare("SELECT colors, fabric_category FROM pieces WHERE status = 'active'").all()
  const colorsSet = new Set()
  const colorCounts = {}
  const familyPieceIds = new Map()
  const fabricsSet = new Set()
  rows.forEach((row, rowIndex) => {
    if (row.fabric_category) {
      fabricsSet.add(row.fabric_category.toLowerCase())
    }
    try {
      const colors = JSON.parse(row.colors || '[]')
      for (const c of colors) {
        const name = c.toLowerCase()
        colorsSet.add(name)
        colorCounts[name] = (colorCounts[name] || 0) + 1
        const family = colorTaxonomyEntry(name).family
        if (family !== 'unknown') {
          if (!familyPieceIds.has(family)) familyPieceIds.set(family, new Set())
          familyPieceIds.get(family).add(rowIndex)
        }
      }
    } catch {}
  })
  res.json({
    colors: Array.from(colorsSet).sort(),
    color_counts: colorCounts,
    family_counts: Object.fromEntries([...familyPieceIds].map(([family, ids]) => [family, ids.size])),
    fabrics: Array.from(fabricsSet).sort()
  })
})

// Per-piece usage, for the Wardrobe "Most worn" / "Recently used" sort — "used"
// means referenced by a saved Visual Composer board or a Stylist chat
// recommendation, not literal real-world wear (the app has no way to know that).
router.get('/pieces/usage-stats', (req, res) => {
  res.json(getPieceUsageStats())
})

// C3 fix (panel-stage1-findings.md → B1): occasion_exclusions is a hard, durable, one-click
// edit written from the Stylist chat, but had no view anywhere in the wardrobe UI — a false
// positive was effectively unreachable to undo, since the only control lived on the exact
// outfit card that would no longer be offered once excluded. This lists every current exclusion
// so it can be reviewed and restored from Style Profile instead. Must be registered before
// GET /pieces/:id, or that route's :id param would swallow this path.
// `occasion_exclusions` stores only the occasion strings — there is no per-exclusion timestamp
// anywhere on `pieces` (its only date column, `date_added`, is when the garment was added). The one
// record of WHEN an exclusion was set is the prose receipt the same handler writes into
// `styling_rules_learned`: "Excluded from <occasion> by <name> (YYYY-MM-DD)". Parse it here, once,
// and expose a real `changedAt` so callers can order by recency without re-reading prose. The
// receipt stays display-only provenance — `occasion_exclusions` is still the enforcement record.
const EXCLUSION_RECEIPT = /^Excluded from (.+?) by .*\((\d{4}-\d{2}-\d{2})\)\s*$/i
const normalizeOccasionKey = value => String(value || '').toLowerCase().replace(/[-_]+/g, ' ').trim()

function exclusionChangedAt(rules, occasion) {
  const wanted = normalizeOccasionKey(occasion)
  // Last matching line wins: excluded → restored → excluded again all append in order.
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const match = EXCLUSION_RECEIPT.exec(String(rules[index] || '').trim())
    if (match && normalizeOccasionKey(match[1]) === wanted) return { changedAt: match[2], order: index }
  }
  return { changedAt: null, order: -1 }
}

router.get('/pieces/occasion-exclusions', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, category, photo, occasion_exclusions, styling_rules_learned FROM pieces
    WHERE occasion_exclusions IS NOT NULL AND occasion_exclusions != '[]' AND occasion_exclusions != ''
    ORDER BY name COLLATE NOCASE
  `).all()
  const entries = []
  for (const row of rows) {
    const occasions = safeJsonParse(row.occasion_exclusions, [])
    const rules = safeJsonParse(row.styling_rules_learned, []) || []
    for (const occasion of occasions) {
      const { changedAt, order } = exclusionChangedAt(rules, occasion)
      entries.push({ pieceId: row.id, name: row.name, category: row.category, photo: row.photo, occasion, changedAt, receiptOrder: order })
    }
  }
  // Newest first so a preview can show what actually changed recently; entries with no receipt
  // (set before receipts existed) sort last and keep their alphabetical order.
  entries.sort((left, right) => {
    if (left.changedAt !== right.changedAt) return String(right.changedAt || '').localeCompare(String(left.changedAt || ''))
    return right.receiptOrder - left.receiptOrder
  })
  res.json(entries)
})

router.get('/pieces/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  res.json(withRetagSuggestions(p))
})

router.post('/pieces', upload.fields([{ name: 'photo' }, { name: 'worn_photo' }]), preparePieceThumbnails, (req, res) => {
  const { name, category, colors, occasions, season, notes, status,
    recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes,
    pattern_type, pattern_scale, pattern_complexity, reads_as, background_color, hem_finish,
    neckline, sleeve_length, sleeve_shape, length_hits_at, silhouette,
    fabric_category, fabric_weight, visual_weight, fiber_content, formality, heel_height, walk_support, opacity, stretch,
    fit_on_body, tuck_behavior, waistband_type, needs_base, accessory_subtype, jewelry_type, necklace_length, bottom_subtype, shoe_type, toe_shape,
    styling_rules_learned, pairs_well_with, tried_and_rejected, style_profile_json, tagger_version,
    tag_state, manual_overrides, color_taxonomy_gaps } = req.body
  const photo      = req.files?.photo?.[0]?.filename || null
  const worn_photo = req.files?.worn_photo?.[0]?.filename || null
  const finalManualOverrides = normalizeManualOverrides(manual_overrides)
  const parsedStyleProfile = safeJsonParse(style_profile_json, {}) || {}
  const confidencePinnedProfile = pinManualConfidence(parsedStyleProfile, finalManualOverrides)
  const finalStyleProfile = applySoftScoreFloors({
    ...req.body,
    photo,
    worn_photo,
    manual_overrides: finalManualOverrides,
    style_profile_json: confidencePinnedProfile
  }).style_profile_json
  const finalTagState = tag_state || tagStateForPhotos({ photo, worn_photo })
  const r = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, photo, worn_photo,
      recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes,
      pattern_type, pattern_scale, pattern_complexity, reads_as, background_color, hem_finish,
      neckline, sleeve_length, sleeve_shape, length_hits_at, silhouette,
      fabric_category, fabric_weight, visual_weight, fiber_content, formality, heel_height, walk_support, opacity, stretch, fit_on_body, tuck_behavior, waistband_type, needs_base, accessory_subtype, jewelry_type, necklace_length, bottom_subtype, shoe_type, toe_shape,
      styling_rules_learned, pairs_well_with, tried_and_rejected, style_profile_json, tagger_version,
      tag_state, manual_overrides)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, category, colors||'[]', occasions||'[]', season||'year-round', notes||'', status||'active', photo, worn_photo,
    recommendation_status||'trusted', fit_confidence||'unknown', role_permission||'auto', occasion_permissions||'[]', engine_notes||'',
    pattern_type||null, pattern_scale||null, pattern_complexity||null, reads_as||null, background_color||null, hem_finish||null,
    neckline||null, sleeve_length||null, sleeve_shape||null, length_hits_at||null, silhouette||null,
    fabric_category||null, fabric_weight||null, visual_weight||null, fiber_content||'[]', normalizeFormality(formality), normalizeHeelHeight(heel_height), normalizeWalkSupport(walk_support), opacity||null, stretch||null, fit_on_body||null, tuck_behavior||null, waistband_type||null, needs_base||null, normalizeAccessorySubtype(accessory_subtype), normalizeJewelryType(jewelry_type), normalizeNecklaceLength(necklace_length), normalizeBottomSubtype(bottom_subtype), shoe_type||null, toe_shape||null,
    styling_rules_learned||'[]', pairs_well_with||'[]', tried_and_rejected||'[]', JSON.stringify(finalStyleProfile), tagger_version||null,
    finalTagState, JSON.stringify(finalManualOverrides))
  queueColorTaxonomyReviews(db, {
    pieceId: r.lastInsertRowid,
    pieceName: name,
    colors: safeJsonParse(color_taxonomy_gaps, []),
  })
  res.json(withRetagSuggestions(db.prepare('SELECT * FROM pieces WHERE id = ?').get(r.lastInsertRowid)))
})

router.put('/pieces/:id', upload.fields([{ name: 'photo' }, { name: 'worn_photo' }]), preparePieceThumbnails, (req, res) => {
  const existing = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const { name, category, colors, occasions, season, notes, status, favorite, clear_photo, clear_worn_photo,
    recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes,
    pattern_type, pattern_scale, pattern_complexity, reads_as, background_color, hem_finish,
    neckline, sleeve_length, sleeve_shape, length_hits_at, silhouette,
    fabric_category, fabric_weight, visual_weight, fiber_content, formality, heel_height, walk_support, opacity, stretch,
    fit_on_body, tuck_behavior, waistband_type, needs_base, accessory_subtype, jewelry_type, necklace_length, bottom_subtype, shoe_type, toe_shape,
    styling_rules_learned, pairs_well_with, tried_and_rejected, style_profile_json, tagger_version,
    tag_state, manual_overrides, resolved_retag_suggestion_ids, color_taxonomy_gaps } = req.body
  const photo      = req.files?.photo?.[0]?.filename      || (clear_photo      === 'true' ? null : existing.photo)
  const worn_photo = req.files?.worn_photo?.[0]?.filename  || (clear_worn_photo === 'true' ? null : existing.worn_photo)
  const final_tagger_version = tagger_version === undefined ? existing.tagger_version : tagger_version
  const existingManualOverrides = normalizeManualOverrides(existing.manual_overrides)
  const finalManualOverrides = manual_overrides === undefined ? existingManualOverrides : normalizeManualOverrides(manual_overrides)
  const existingProfile = safeJsonParse(existing.style_profile_json, {}) || {}
  const submittedProfile = style_profile_json === undefined ? existingProfile : (safeJsonParse(style_profile_json, {}) || {})
  const profileOverrides = finalManualOverrides.map(path => (
    path.startsWith('style_profile_json.') ? path.replace(/^style_profile_json\./, '') : path
  ))
  const confidencePinnedProfile = pinManualConfidence(
    mergeWithManualOverrides(existingProfile, submittedProfile, profileOverrides),
    finalManualOverrides
  )
  const finalStyleProfile = applySoftScoreFloors({
    ...parsePiece(existing),
    ...req.body,
    photo,
    worn_photo,
    manual_overrides: finalManualOverrides,
    style_profile_json: confidencePinnedProfile
  }).style_profile_json
  const finalTagState = tag_state || tagStateForPhotos({ photo, worn_photo })
  db.prepare(`
    UPDATE pieces SET name=?,category=?,colors=?,occasions=?,season=?,notes=?,status=?,favorite=?,photo=?,worn_photo=?,
      recommendation_status=?,fit_confidence=?,role_permission=?,occasion_permissions=?,engine_notes=?,
      pattern_type=?,pattern_scale=?,pattern_complexity=?,reads_as=?,background_color=?,hem_finish=?,
      neckline=?,sleeve_length=?,sleeve_shape=?,length_hits_at=?,silhouette=?,
      fabric_category=?,fabric_weight=?,visual_weight=?,fiber_content=?,formality=?,heel_height=?,walk_support=?,opacity=?,stretch=?,fit_on_body=?,tuck_behavior=?,waistband_type=?,needs_base=?,accessory_subtype=?,jewelry_type=?,necklace_length=?,bottom_subtype=?,shoe_type=?,toe_shape=?,
      styling_rules_learned=?,pairs_well_with=?,tried_and_rejected=?,style_profile_json=?,tagger_version=?,
      tag_state=?,manual_overrides=?
    WHERE id=?
  `).run(name, category, colors||'[]', occasions||'[]', season||'year-round', notes||'', status||'active',
    favorite==='true'?1:0, photo, worn_photo,
    recommendation_status||'trusted', fit_confidence||'unknown', role_permission||'auto', occasion_permissions||'[]', engine_notes||'',
    pattern_type||null, pattern_scale||null, pattern_complexity||null, reads_as||null, background_color||null, hem_finish||null,
    neckline||null, sleeve_length||null, sleeve_shape||null, length_hits_at||null, silhouette||null,
    fabric_category||null, fabric_weight||null, visual_weight||null, fiber_content||'[]', normalizeFormality(formality), normalizeHeelHeight(heel_height), normalizeWalkSupport(walk_support), opacity||null, stretch||null, fit_on_body||null, tuck_behavior||null, waistband_type||null, needs_base||null, normalizeAccessorySubtype(accessory_subtype), normalizeJewelryType(jewelry_type), normalizeNecklaceLength(necklace_length), normalizeBottomSubtype(bottom_subtype), shoe_type||null, toe_shape||null,
    styling_rules_learned||'[]', pairs_well_with||'[]', tried_and_rejected||'[]', JSON.stringify(finalStyleProfile),
    final_tagger_version, finalTagState, JSON.stringify(finalManualOverrides), req.params.id)
  const resolvedSuggestionIds = safeJsonParse(resolved_retag_suggestion_ids, []).map(Number).filter(Boolean)
  if (resolvedSuggestionIds.length) {
    const placeholders = resolvedSuggestionIds.map(() => '?').join(',')
    db.prepare(`UPDATE todos SET completed = 1 WHERE type = 'retag-suggestion' AND linked_piece_id = ? AND id IN (${placeholders})`)
      .run(Number(req.params.id), ...resolvedSuggestionIds)
  }
  queueColorTaxonomyReviews(db, {
    pieceId: req.params.id,
    pieceName: name,
    colors: safeJsonParse(color_taxonomy_gaps, []),
  })
  res.json(withRetagSuggestions(db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)))
})

router.delete('/pieces/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  if (p.photo) { const fp = path.join(userUploadsDir(), p.photo); if (fs.existsSync(fp)) fs.unlinkSync(fp) }
  db.prepare('DELETE FROM pieces WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

router.patch('/pieces/:id/favorite', (req, res) => {
  const p = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  const newVal = p.favorite ? 0 : 1
  db.prepare('UPDATE pieces SET favorite = ? WHERE id = ?').run(newVal, req.params.id)
  res.json({ favorite: Boolean(newVal) })
})

router.post('/pieces/:id/occasion-exclusion', (req, res) => {
  const { id } = req.params
  const { occasion, excluded } = req.body || {}
  if (!occasion) {
    return res.status(400).json({ error: 'occasion is required' })
  }
  const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(id)
  if (!piece) {
    return res.status(404).json({ error: 'Piece not found' })
  }

  const parsed = parsePiece(piece)

  const normOccasion = String(occasion || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
  let exclusions = (parsed.occasion_exclusions || []).map(o => String(o || '').toLowerCase().replace(/[-_]+/g, ' ').trim())

  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const date = `${year}-${month}-${day}`

  const rules = parsed.styling_rules_learned || []

  if (excluded) {
    if (!exclusions.includes(normOccasion)) {
      exclusions.push(normOccasion)
    }
    const note = `Excluded from ${occasion} by ${prompts.PROFILE_NAME} (${date})`
    rules.push(note)
  } else {
    exclusions = exclusions.filter(o => o !== normOccasion)
    const note = `Restored for ${occasion} by ${prompts.PROFILE_NAME} (${date})`
    rules.push(note)
  }

  db.prepare('UPDATE pieces SET occasion_exclusions = ?, styling_rules_learned = ? WHERE id = ?')
    .run(JSON.stringify(exclusions), JSON.stringify(rules), id)

  const updated = db.prepare('SELECT * FROM pieces WHERE id = ?').get(id)
  res.json(parsePiece(updated))
})

// ── Outfits API ────────────────────────────────────────────────────────────────
router.get('/outfits', (req, res) => {
  const { occasion, season, favorites } = req.query
  let q = 'SELECT * FROM outfits WHERE 1=1'
  const params = []
  if (occasion) { q += ' AND occasion = ?'; params.push(occasion) }
  if (season && season !== 'all') {
    if (season === 'indoor') {
      q += ' AND season = ?'
      params.push('indoor')
    } else if (season === 'year-round') {
      q += ' AND (season = ? OR season = ?)'
      params.push('year-round', 'indoor')
    } else {
      q += ' AND (season = ? OR season = ? OR season = ?)'
      params.push(season, 'year-round', 'indoor')
    }
  }
  if (favorites === 'true') { q += ' AND favorite = 1' }
  q += ' ORDER BY favorite DESC, date_added DESC'

  const outfits = db.prepare(q).all(...params)
  const result = outfits.map(o => {
    const pieces = db.prepare(`
      SELECT p.* FROM pieces p JOIN outfit_pieces op ON p.id = op.piece_id WHERE op.outfit_id = ?
    `).all(o.id).map(parsePiece)
    return { ...o, favorite: Boolean(o.favorite), pieces }
  })
  res.json(result)
})

router.post('/outfits', upload.single('photo'), prepareOutfitThumbnails, (req, res) => {
  const { name, occasion, season, notes, status, pieceIds, mainPieceId } = req.body
  const photo = req.file?.filename || null
  const linkedIds = pieceIds ? JSON.parse(pieceIds).map(Number).filter(Boolean) : []
  const mainId = Number(mainPieceId) && linkedIds.includes(Number(mainPieceId)) ? Number(mainPieceId) : null
  const r = db.prepare(`
    INSERT INTO outfits (name, occasion, season, notes, status, photo, main_piece_id) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, occasion||'casual', season||'year-round', notes||'', status||'confirmed', photo, mainId)
  const outfitId = r.lastInsertRowid
  if (linkedIds.length) {
    const insLink = db.prepare('INSERT OR IGNORE INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)')
    linkedIds.forEach(pid => insLink.run(outfitId, pid))
  }
  const o = db.prepare('SELECT * FROM outfits WHERE id = ?').get(outfitId)
  res.json({ ...o, favorite: Boolean(o.favorite), pieces: [] })
})

router.put('/outfits/:id', upload.single('photo'), prepareOutfitThumbnails, (req, res) => {
  const existing = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const { name, occasion, season, notes, status, favorite, pieceIds, mainPieceId } = req.body
  const photo = req.file?.filename || existing.photo
  const linkedIds = pieceIds ? JSON.parse(pieceIds).map(Number).filter(Boolean) : null
  const mainId = Number(mainPieceId) && (!linkedIds || linkedIds.includes(Number(mainPieceId))) ? Number(mainPieceId) : null
  db.prepare(`
    UPDATE outfits SET name=?,occasion=?,season=?,notes=?,status=?,favorite=?,photo=?,main_piece_id=? WHERE id=?
  `).run(name, occasion||'casual', season||'year-round', notes||'', status||'confirmed', favorite==='true'?1:0, photo, mainId, req.params.id)
  if (linkedIds) {
    db.prepare('DELETE FROM outfit_pieces WHERE outfit_id = ?').run(req.params.id)
    const insLink = db.prepare('INSERT OR IGNORE INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)')
    linkedIds.forEach(pid => insLink.run(req.params.id, pid))
  }
  const o = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  const pieces = db.prepare(`SELECT p.* FROM pieces p JOIN outfit_pieces op ON p.id = op.piece_id WHERE op.outfit_id = ?`).all(req.params.id).map(parsePiece)
  res.json({ ...o, favorite: Boolean(o.favorite), pieces })
})

router.delete('/outfits/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  if (!o) return res.status(404).json({ error: 'Not found' })
  if (o.photo) { const fp = path.join(userUploadsDir(), o.photo); if (fs.existsSync(fp)) fs.unlinkSync(fp) }
  db.prepare('DELETE FROM outfits WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

router.patch('/outfits/:id/favorite', (req, res) => {
  const o = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  if (!o) return res.status(404).json({ error: 'Not found' })
  const newVal = o.favorite ? 0 : 1
  db.prepare('UPDATE outfits SET favorite = ? WHERE id = ?').run(newVal, req.params.id)
  res.json({ favorite: Boolean(newVal) })
})

router.get('/pieces/:id/outfits', (req, res) => {
  const outfits = db.prepare(`
    SELECT o.* FROM outfits o
    JOIN outfit_pieces op ON o.id = op.outfit_id
    WHERE op.piece_id = ?
    ORDER BY o.date_added DESC
  `).all(req.params.id)
  res.json(outfits.map(o => ({
    ...o,
    favorite: Boolean(o.favorite),
    thumbnail_url: o.photo ? cachedThumbnailUrl(o.photo, 'relationship-outfit') : ''
  })))
})

router.put('/outfits/:id/pieces', (req, res) => {
  const { pieceIds, mainPieceId } = req.body
  const linkedIds = (pieceIds || []).map(Number).filter(Boolean)
  const mainId = Number(mainPieceId) && linkedIds.includes(Number(mainPieceId)) ? Number(mainPieceId) : null
  db.prepare('DELETE FROM outfit_pieces WHERE outfit_id = ?').run(req.params.id)
  const ins = db.prepare('INSERT OR IGNORE INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)')
  linkedIds.forEach(pid => ins.run(req.params.id, pid))
  db.prepare('UPDATE outfits SET main_piece_id = ? WHERE id = ?').run(mainId, req.params.id)
  res.json({ success: true, main_piece_id: mainId })
})

// ── Stylist feedback / learning API ───────────────────────────────────────────
function feedbackBoardImage(rowOrPayload) {
  const payload = typeof rowOrPayload?.payload === 'string'
    ? safeJsonParse(rowOrPayload.payload, {})
    : (rowOrPayload?.payload || rowOrPayload || {})
  return payload?.board?.imageUrl || payload?.board?.image_url || ''
}

const sortedBoardPieceIds = value => {
  const pieces = Array.isArray(value?.pieceIds) ? value.pieceIds : (Array.isArray(value?.pieces) ? value.pieces : [])
  return [...new Set(pieces.map(piece => Number(typeof piece === 'object' ? (piece?.id || piece?.pieceId) : piece))
    .filter(id => Number.isInteger(id) && id > 0))].sort((a, b) => a - b)
}

function exactSourceOutfitLogic(row, boardPayload) {
  const board = boardPayload?.board || {}
  const targetIds = sortedBoardPieceIds(board).length
    ? sortedBoardPieceIds(board)
    : sortedBoardPieceIds({ pieces: safeJsonParse(row?.pieces, []) })
  if (!targetIds.length) return null
  let threadId = boardPayload?.threadId
  if (!threadId && row?.image_url) {
    threadId = db.prepare('SELECT id FROM chat_threads WHERE payload LIKE ? LIMIT 1').get(`%${row.image_url}%`)?.id
  }
  if (!threadId) return null
  const thread = db.prepare('SELECT payload FROM chat_threads WHERE id = ?').get(threadId)
  if (!thread) return null
  const threadPayload = safeJsonParse(thread.payload, {}) || {}
  const candidates = []
  for (const message of Array.isArray(threadPayload.messages) ? threadPayload.messages : []) {
    for (const outfit of Array.isArray(message?.structuredOutfits) ? message.structuredOutfits : []) {
      const ids = sortedBoardPieceIds(outfit)
      if (ids.length !== targetIds.length || ids.some((id, index) => id !== targetIds[index])) continue
      const evidence = buildOutfitLogicEvidence('works', { outfit })
      if (evidence) candidates.push(evidence)
    }
  }
  const unique = [...new Map(candidates.map(evidence => [JSON.stringify(evidence), evidence])).values()]
  return unique.length === 1 ? unique[0] : null
}

function positiveEvidenceForSavedBoard(feedbackType, row, boardPayload) {
  if (!POSITIVE_OUTFIT_LOGIC_TYPES.has(feedbackType)) return null
  const direct = buildOutfitLogicEvidence(feedbackType, boardPayload)
  if (direct) return direct
  const recovered = exactSourceOutfitLogic(row, boardPayload)
  if (recovered) return { ...recovered, verdict: feedbackType, sourceConfidence: 'exact_source_recovery' }
  const board = boardPayload?.board || {}
  const storedPieces = Array.isArray(row?.pieces) ? row.pieces : safeJsonParse(row?.pieces, [])
  const sourcePieces = Array.isArray(board?.pieces) && board.pieces.length ? board.pieces : storedPieces
  const ids = [...new Set(sourcePieces.map(piece => Number(typeof piece === 'object' ? (piece?.id || piece?.pieceId) : piece))
    .filter(id => Number.isInteger(id) && id > 0))]
  let enrichedPieces = storedPieces
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',')
    const byId = new Map(db.prepare(`SELECT * FROM pieces WHERE id IN (${placeholders})`).all(...ids)
      .map(piece => [Number(piece.id), parsePiece(piece)]))
    const hydrated = ids.map(id => byId.get(id)).filter(Boolean)
    if (hydrated.length) enrichedPieces = hydrated
  }
  return buildLegacyOutfitSnapshotEvidence(feedbackType, boardPayload, {
    ...row,
    pieces: enrichedPieces,
  })
}

function setSavedBoardFeedbackLabel(imageUrl, feedbackType, enabled) {
  if (!imageUrl || !feedbackType) return
  const boards = db.prepare('SELECT id, payload FROM saved_boards WHERE image_url = ?').all(imageUrl)
  for (const board of boards) {
    const payload = safeJsonParse(board.payload, {}) || {}
    const labels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
    const nextLabels = enabled
      ? [...new Set([...labels, feedbackType])]
      : labels.filter(label => label !== feedbackType)
    const reasonRows = db.prepare(`
      SELECT feedback_type, payload FROM stylist_feedback
      WHERE target_type = 'generated_visual_board' AND COALESCE(archived, 0) = 0
        AND json_extract(payload, '$.board.imageUrl') = ?
        AND feedback_type IN ('style_direction','shape_balance','wrong_length')
    `).all(imageUrl)
    const feedbackDetails = { ...(payload.feedback_details || {}) }
    for (const category of ['style_direction', 'shape_balance']) {
      feedbackDetails[category] = [...new Set(reasonRows
        .filter(reasonRow => reasonRow.feedback_type === category)
        .map(reasonRow => safeJsonParse(reasonRow.payload, {})?.feedback_reason)
        .filter(Boolean))]
    }
    feedbackDetails.wrong_length = reasonRows
      .filter(reasonRow => reasonRow.feedback_type === 'wrong_length')
      .map(reasonRow => safeJsonParse(reasonRow.payload, {})?.length_correction)
      .filter(correction => Number(correction?.piece_id) && correction?.issue)
    db.prepare('UPDATE saved_boards SET payload = ? WHERE id = ?')
      .run(JSON.stringify({ ...payload, feedback_labels: nextLabels, feedback_details: feedbackDetails }), board.id)
  }
}

function syncSavedBoardFromFeedback(row) {
  const imageUrl = feedbackBoardImage(row)
  if (!imageUrl) return
  const otherActive = db.prepare(`
    SELECT id FROM stylist_feedback
    WHERE id != ? AND feedback_type = ? AND target_type = 'generated_visual_board'
      AND COALESCE(archived, 0) = 0
      AND json_extract(payload, '$.board.imageUrl') = ?
    LIMIT 1
  `).get(row.id || 0, row.feedback_type, imageUrl)
  setSavedBoardFeedbackLabel(imageUrl, row.feedback_type, !row.archived || Boolean(otherActive))
}

// A board with no `saved_boards` row (never explicitly "Saved") has no canonical record for
// StylistChat.jsx's boardFeedbackActive to read live — it falls back to a per-thread snapshot
// (chat_threads.payload.boardFeedbackLabels) written once, on save, and never otherwise touched.
// Un-toggling a chip inside the same open chat session now clears its own client copy
// (StylistChat.jsx's toggleStylistFeedback), but that fix can't reach a removal that happens
// elsewhere — Style Profile's Remove button, in particular, is a different component with no
// access to that thread's live state. This is the one place both paths converge, so it clears
// the persisted snapshot directly. The bucket key is reconstructed the same way
// StylistChat.jsx's feedbackBucketKey does — both sides must be kept in sync if that changes.
function clearThreadBoardFeedbackSnapshot(row) {
  try {
    const payload = safeJsonParse(row.payload, {}) || {}
    const threadId = payload.threadId
    if (!threadId) return
    if (!Number.isInteger(payload.messageIndex) || !Number.isInteger(payload.boardIndex)) return
    if (!['generated_visual_board', 'board'].includes(row.target_type)) return
    const bucket = `${row.target_type}:${payload.messageIndex}:${payload.boardIndex}`
    const thread = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(threadId)
    if (!thread) return
    const threadPayload = safeJsonParse(thread.payload, {}) || {}
    const labels = threadPayload.boardFeedbackLabels || {}
    if (!Array.isArray(labels[bucket]) || !labels[bucket].includes(row.feedback_type)) return
    threadPayload.boardFeedbackLabels = { ...labels, [bucket]: labels[bucket].filter(t => t !== row.feedback_type) }
    db.prepare('UPDATE chat_threads SET payload = ? WHERE id = ?').run(JSON.stringify(threadPayload), threadId)
  } catch (err) {
    console.error('Failed to clear thread board-feedback snapshot:', err)
  }
}

// style_direction/shape_balance are group labels that can carry many distinct reasons at
// once (e.g. both 'weak_structure' and 'too_safe' under 'style_direction'). The chat surface
// already writes one stylist_feedback row per specific reason (payload.feedback_reason set).
// syncFeedbackFromSavedBoard below only tracks whether the group label is present at all, so
// it can't represent that — it would collapse to one reason-less row per group. This syncs at
// the individual-reason level instead, so a reason picked in Visual Lab produces the same
// specific row the chat would have produced, and the model-facing prompt text
// (styling-engine/rules.js's FEEDBACK_REASON_LABELS lookup) gets the specific reason rather
// than falling back to generic text.
const STRUCTURED_FEEDBACK_CATEGORIES = ['style_direction', 'shape_balance']

export function syncStructuredReasonsFromSavedBoard(row, previousDetails, nextDetails) {
  const imageUrl = row.image_url
  const boardPayload = safeJsonParse(row.payload, {}) || {}
  const boardInfo = boardPayload.board || { imageUrl, label: row.title, pieces: safeJsonParse(row.pieces, []) }
  const findRows = db.prepare(`
    SELECT * FROM stylist_feedback
    WHERE feedback_type = ? AND target_type = 'generated_visual_board'
      AND json_extract(payload, '$.board.imageUrl') = ?
      AND json_extract(payload, '$.feedback_reason') = ?
    ORDER BY id DESC
  `)
  for (const category of STRUCTURED_FEEDBACK_CATEGORIES) {
    const previous = new Set(Array.isArray(previousDetails?.[category]) ? previousDetails[category] : [])
    const next = new Set(Array.isArray(nextDetails?.[category]) ? nextDetails[category] : [])
    for (const reason of new Set([...previous, ...next])) {
      const matches = findRows.all(category, imageUrl, reason)
      if (next.has(reason)) {
        const existing = matches[0]
        if (existing) {
          if (existing.archived) db.prepare('UPDATE stylist_feedback SET archived = 0 WHERE id = ?').run(existing.id)
        } else {
          db.prepare(`
            INSERT INTO stylist_feedback
            (feedback_type, target_type, context_type, context_id, context_name, label, note, payload, is_gold, archived)
            VALUES (?, 'generated_visual_board', ?, ?, ?, ?, ?, ?, 0, 0)
          `).run(
            category,
            row.context_type || 'wardrobe',
            row.context_id || null,
            row.context_name || 'Whole wardrobe',
            row.title || '',
            row.reason || '',
            JSON.stringify({ board: boardInfo, feedback_reason: reason })
          )
        }
      } else if (previous.has(reason)) {
        matches.forEach(match => db.prepare('UPDATE stylist_feedback SET archived = 1 WHERE id = ?').run(match.id))
      }
    }
  }
}

export function syncFeedbackFromSavedBoard(row, previousLabels, nextLabels) {
  // style_direction/shape_balance are handled at the specific-reason level by
  // syncStructuredReasonsFromSavedBoard above; skip them here so this generic,
  // group-label-only sync doesn't insert a reason-less duplicate row alongside it.
  const previous = new Set(previousLabels.filter(label => !STRUCTURED_FEEDBACK_CATEGORIES.includes(label)))
  const next = new Set(nextLabels.filter(label => !STRUCTURED_FEEDBACK_CATEGORIES.includes(label)))
  const imageUrl = row.image_url
  const boardPayload = safeJsonParse(row.payload, {}) || {}
  const boardInfo = boardPayload.board || { imageUrl, label: row.title, pieces: safeJsonParse(row.pieces, []) }
  const findRows = db.prepare(`
    SELECT * FROM stylist_feedback
    WHERE feedback_type = ? AND target_type = 'generated_visual_board'
      AND json_extract(payload, '$.board.imageUrl') = ?
    ORDER BY id DESC
  `)

  // "Almost right" / "Not for me" carry their reason in feedback_details.owner_comment on the
  // board, not in scoped_evidence — mirror it onto the synced receipt so REASONED_OUTFIT_VERDICT_TYPES
  // rows can be recognized as reasoned evidence downstream (lib/activeMemory.js, feedbackSynthesis.js)
  // without a second lookup back to saved_boards.
  const ownerComment = String(boardPayload.feedback_details?.owner_comment || '').trim()

  for (const label of new Set([...previous, ...next])) {
    const matches = findRows.all(label, imageUrl)
    if (next.has(label)) {
      const scopedEvidence = boardPayload.scoped_evidence?.verdict === label &&
        boardPayload.scoped_evidence?.kind === 'outfit_logic'
        ? boardPayload.scoped_evidence
        : positiveEvidenceForSavedBoard(label, row, boardPayload)
      const feedbackPayload = {
        board: boardInfo,
        ...(boardPayload.outfit ? { outfit: boardPayload.outfit } : {}),
        ...(scopedEvidence ? { scopedEvidence } : {}),
        ...(REASONED_OUTFIT_VERDICT_TYPES.has(label) && ownerComment ? { ownerComment } : {}),
      }
      const existing = matches[0]
      if (existing) {
        const existingPayload = safeJsonParse(existing.payload, {}) || {}
        const mergedPayload = {
          ...existingPayload,
          board: boardInfo,
          ...(boardPayload.outfit ? { outfit: boardPayload.outfit } : {}),
          ...(scopedEvidence ? { scopedEvidence } : {}),
        }
        if (REASONED_OUTFIT_VERDICT_TYPES.has(label)) {
          if (ownerComment) mergedPayload.ownerComment = ownerComment
          else delete mergedPayload.ownerComment
        }
        db.prepare('UPDATE stylist_feedback SET archived = 0, payload = ? WHERE id = ?')
          .run(JSON.stringify(mergedPayload), existing.id)
      } else {
        db.prepare(`
          INSERT INTO stylist_feedback
          (feedback_type, target_type, context_type, context_id, context_name, label, note, payload, is_gold, archived)
          VALUES (?, 'generated_visual_board', ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(
          label,
          row.context_type || 'wardrobe',
          row.context_id || null,
          row.context_name || 'Whole wardrobe',
          row.title || '',
          row.reason || '',
          JSON.stringify(feedbackPayload),
          0
        )
      }
    } else if (previous.has(label)) {
      matches.forEach(match => db.prepare('UPDATE stylist_feedback SET archived = 1 WHERE id = ?').run(match.id))
    }
  }
}

export function backfillPositiveSavedBoardEvidence({ apply = false } = {}) {
  const rows = db.prepare(`
    SELECT * FROM saved_boards
    WHERE COALESCE(archived, 0) = 0
      AND COALESCE(json_array_length(json_extract(payload, '$.feedback_labels')), 0) > 0
    ORDER BY id
  `).all()
  const result = {
    scanned: 0, alreadyStructured: 0, exactSourceRecovered: 0, legacySnapshots: 0,
    skipped: 0, updated: 0, receiptScanned: 0, receiptStructuredRecovered: 0,
    receiptLegacySnapshots: 0, receiptSkipped: 0, receiptUpdated: 0,
  }
  const updates = []
  for (const row of rows) {
    const payload = safeJsonParse(row.payload, {}) || {}
    const labels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
    const verdict = ['signature', 'works', 'almost'].find(label => labels.includes(label))
    if (!verdict) continue
    result.scanned += 1
    const existing = payload.scoped_evidence
    const evidence = existing?.verdict === verdict && existing?.kind === 'outfit_logic'
      ? existing
      : positiveEvidenceForSavedBoard(verdict, row, payload)
    if (!evidence) {
      result.skipped += 1
      continue
    }
    if (evidence.kind === 'outfit_logic' && evidence.sourceConfidence === 'exact_source_recovery') result.exactSourceRecovered += 1
    else if (evidence.kind === 'outfit_logic') result.alreadyStructured += 1
    else if (evidence.kind === 'legacy_outfit_snapshot') result.legacySnapshots += 1
    if (existing && JSON.stringify(existing) === JSON.stringify(evidence)) continue
    updates.push({ row, payload: { ...payload, scoped_evidence: evidence }, labels })
  }
  if (apply && updates.length) {
    db.transaction(() => {
      for (const update of updates) {
        db.prepare('UPDATE saved_boards SET payload = ? WHERE id = ?').run(JSON.stringify(update.payload), update.row.id)
        const refreshed = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(update.row.id)
        syncFeedbackFromSavedBoard(refreshed, update.labels, update.labels)
      }
    })()
    result.updated = updates.length
  }
  result.pendingUpdates = updates.length
  const receiptUpdates = []
  const receipts = db.prepare(`
    SELECT * FROM stylist_feedback
    WHERE COALESCE(archived, 0) = 0
      AND feedback_type IN ('signature', 'works', 'almost')
      AND (json_extract(payload, '$.scopedEvidence.kind') IS NULL
        OR json_extract(payload, '$.scopedEvidence.kind') = 'legacy_outfit_snapshot')
      AND target_type != 'message'
    ORDER BY id
  `).all()
  for (const receipt of receipts) {
    result.receiptScanned += 1
    const payload = safeJsonParse(receipt.payload, {}) || {}
    const board = payload.board || payload.visual || {}
    const imageUrl = board.imageUrl || board.image_url || ''
    const canonical = imageUrl
      ? db.prepare('SELECT payload FROM saved_boards WHERE image_url = ? AND COALESCE(archived, 0) = 0 ORDER BY id DESC LIMIT 1').get(imageUrl)
      : null
    const canonicalEvidence = safeJsonParse(canonical?.payload, {})?.scoped_evidence
    const normalizedPayload = payload.board ? payload : { ...payload, board }
    const evidence = canonicalEvidence?.verdict === receipt.feedback_type
      ? canonicalEvidence
      : positiveEvidenceForSavedBoard(receipt.feedback_type, {
          title: receipt.label,
          reason: receipt.note,
          context_name: receipt.context_name,
          image_url: imageUrl,
          pieces: board.pieces || payload.pieces || payload.outfit?.pieces || [],
        }, normalizedPayload)
    if (!evidence) {
      result.receiptSkipped += 1
      continue
    }
    if (evidence.kind === 'legacy_outfit_snapshot') result.receiptLegacySnapshots += 1
    else result.receiptStructuredRecovered += 1
    const nextPayload = { ...payload, scopedEvidence: evidence }
    if (JSON.stringify(payload) !== JSON.stringify(nextPayload)) receiptUpdates.push({ id: receipt.id, payload: nextPayload })
  }
  if (apply && receiptUpdates.length) {
    db.transaction(() => {
      const update = db.prepare('UPDATE stylist_feedback SET payload = ? WHERE id = ?')
      receiptUpdates.forEach(item => update.run(JSON.stringify(item.payload), item.id))
    })()
    result.receiptUpdated = receiptUpdates.length
  }
  result.receiptPendingUpdates = receiptUpdates.length
  return result
}

// One-time backfill for the 2026-08-13 reasoned-Almost/Not-for-me eligibility fix. Before that fix,
// syncFeedbackFromSavedBoard never mirrored a board's feedback_details.owner_comment onto its
// stylist_feedback receipt, so any Almost/Not-for-me reaction commented before the fix landed has a
// stale mirror missing ownerComment — it stays synthesisEligible: false until re-synced. Re-running
// syncFeedbackFromSavedBoard with unchanged before/after labels forces exactly that resync using the
// current (fixed) logic; it writes nothing else and does not touch boards without an owner comment.
export function backfillReasonedOutfitVerdictComments({ apply = false } = {}) {
  const rows = db.prepare(`
    SELECT * FROM saved_boards
    WHERE COALESCE(archived, 0) = 0
      AND EXISTS (
        SELECT 1 FROM json_each(json_extract(payload, '$.feedback_labels'))
        WHERE value IN ('almost', 'not_me')
      )
      AND COALESCE(TRIM(json_extract(payload, '$.feedback_details.owner_comment')), '') != ''
    ORDER BY id
  `).all()
  const result = { scanned: rows.length, resynced: 0 }
  if (apply && rows.length) {
    db.transaction(() => {
      for (const row of rows) {
        const payload = safeJsonParse(row.payload, {}) || {}
        const labels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
        syncFeedbackFromSavedBoard(row, labels, labels)
      }
    })()
    result.resynced = rows.length
  }
  return result
}

const RETAG_ISSUE_LABELS = {
  sleeves_too_long: 'Sleeves rendered too long',
  sleeves_too_short: 'Sleeves rendered too short',
  upper_hem_too_long: 'Top or jacket hem rendered too long',
  upper_hem_too_short: 'Top or jacket hem rendered too short',
  lower_hem_too_long: 'Pants, skirt, or dress rendered too long',
  lower_hem_too_short: 'Pants, skirt, or dress rendered too short',
}

function syncRetagSuggestionsFromSavedBoard(row) {
  const payload = safeJsonParse(row.payload, {}) || {}
  const labels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
  const corrections = labels.includes('wrong_length') && Array.isArray(payload.feedback_details?.wrong_length)
    ? payload.feedback_details.wrong_length
    : []
  const completedKeys = new Set(db.prepare(`
    SELECT linked_piece_id, payload FROM todos
    WHERE type = 'retag-suggestion' AND source_type = 'saved_board' AND source_id = ? AND completed = 1
  `).all(Number(row.id)).map(todo => {
    const todoPayload = safeJsonParse(todo.payload, {}) || {}
    return `${Number(todo.linked_piece_id)}:${todoPayload.issue || ''}`
  }))
  db.prepare(`
    DELETE FROM todos
    WHERE type = 'retag-suggestion' AND source_type = 'saved_board' AND source_id = ? AND completed = 0
  `).run(Number(row.id))
  const insert = db.prepare(`
    INSERT INTO todos (type, description, linked_piece_id, completed, field, source_type, source_id, payload)
    VALUES ('retag-suggestion', ?, ?, 0, ?, 'saved_board', ?, ?)
  `)
  for (const correction of corrections) {
    const pieceId = Number(correction?.piece_id)
    const issue = String(correction?.issue || '')
    const issueLabel = RETAG_ISSUE_LABELS[issue]
    if (!pieceId || !issueLabel) continue
    if (completedKeys.has(`${pieceId}:${issue}`)) continue
    // sleeves_too_long/sleeves_too_short are unambiguously length complaints — route to
    // sleeve_length specifically, not the shape field.
    const field = issue.startsWith('sleeves_') ? 'sleeve_length' : 'length_hits_at'
    const pieceName = correction.piece_name || db.prepare('SELECT name FROM pieces WHERE id = ?').get(pieceId)?.name || `Piece ${pieceId}`
    insert.run(
      `Retag suggested for ${pieceName}: ${issueLabel}. Review the garment metadata; no tags were changed automatically.`,
      pieceId,
      field,
      Number(row.id),
      JSON.stringify({ board_id: Number(row.id), board_title: row.title || '', piece_id: pieceId, piece_name: pieceName, issue, issue_label: issueLabel })
    )
  }
}

function referencedThreadForFeedback(row, payload) {
  if (payload?.threadId && payload.threadId !== 'new_chat') return payload.threadId
  if (row.feedback_type !== 'not_me' || row.target_type === 'generated_visual_board' || feedbackBoardImage(payload)) return null
  const label = String(row.label || '').trim()
  if (!label || !row.created_at) return null
  const candidates = db.prepare(`
    SELECT id, ABS(strftime('%s', updated_at) - strftime('%s', ?)) AS seconds_away
    FROM chat_threads
    WHERE payload LIKE ?
      AND ABS(strftime('%s', updated_at) - strftime('%s', ?)) <= 900
    ORDER BY seconds_away ASC
    LIMIT 2
  `).all(row.created_at, `%${label}%`, row.created_at)
  if (!candidates.length) return null
  if (candidates.length > 1 && Number(candidates[1].seconds_away) - Number(candidates[0].seconds_away) < 60) return null
  return candidates[0].id
}

router.post('/stylist-feedback', (req, res) => {
  try {
    const {
      feedbackType,
      targetType = 'message',
      contextType = null,
      contextId = null,
      contextName = '',
      label = '',
      note = '',
      payload = {},
    } = req.body || {}

    if (!feedbackType) return res.status(400).json({ error: 'feedbackType is required' })
    if (targetType === 'renderer_calibration') {
      return res.status(410).json({
        error: 'renderer_calibration is retired; use generated-board image-fidelity feedback',
      })
    }
    if (!KNOWN_FEEDBACK_TYPES.includes(feedbackType)) {
      return res.status(400).json({ error: `Unknown feedbackType: ${feedbackType}` })
    }

    const storedFeedbackType = canonicalFeedbackType(feedbackType)
    const outfit = payload?.outfit || {}
    const outfitLogicEvidence = positiveEvidenceForSavedBoard(storedFeedbackType, {
      title: label,
      reason: note,
      context_name: contextName,
      image_url: payload?.board?.imageUrl || payload?.board?.image_url || '',
      pieces: payload?.board?.pieces || [],
    }, payload)
    const feedbackEvidence = buildFeedbackEvidence({
      feedbackType: storedFeedbackType,
      targetType,
      contextType,
      contextId,
      contextName,
      sourceSurface: payload?.sourceSurface,
      payload,
    })
    const storedPayload = storedFeedbackType === WRONG_PIECE_FOR_OUTFIT_FEEDBACK ? {
      ...(payload || {}),
      ...(feedbackEvidence ? { feedbackEvidence } : {}),
    } : (outfitLogicEvidence ? {
      ...(payload || {}),
      scopedEvidence: outfitLogicEvidence,
    } : (payload || {}))

    const result = db.prepare(`
      INSERT INTO stylist_feedback
      (feedback_type, target_type, context_type, context_id, context_name, label, note, payload, is_gold)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      storedFeedbackType,
      targetType,
      contextType,
      contextId ? Number(contextId) : null,
      contextName || '',
      label || '',
      note || '',
      JSON.stringify(storedPayload),
      0
    )

    const insertedFeedback = db.prepare('SELECT * FROM stylist_feedback WHERE id = ?').get(result.lastInsertRowid)
    syncSavedBoardFromFeedback(insertedFeedback)

    // Reactions to a BOARD or an OUTFIT are not garment rules, and this endpoint
    // only ever records those. It used to copy the reaction's prose into the
    // reacted-piece's styling_rules_learned as `[feedback:<type>] (label) note`,
    // which the piece editor labels "AUTHORITATIVE — STYLIST FOLLOWS THESE FIRST"
    // and buildWardrobePieceTruthText prints as `RULES (authoritative)`. So a
    // compliment about one outfit — "the fitted black knit top complements the
    // bold skirt" — became a standing rule about a garment that outfit merely
    // contained, and a `not_me` rejection became an authoritative rule whose text
    // praised the look it rejected.
    //
    // Owner ruling 2026-08-08: keep the writers that concern the garment (the
    // occasion-exclusion note, and explicitly saving a chat message while that
    // piece is open); drop the one that files board and outfit critique onto the
    // garment card. The reaction itself is unaffected — the stylist_feedback row
    // above is the canonical record and every reader of it still sees it.

    const learningMessages = {
      signature: 'Learning saved as a signature direction. The board itself is not saved unless you click Save board.',
      works: 'Learning saved as scoped outfit feedback. The board itself is not saved unless you click Save board.',
      good_formula: 'Learning saved about this formula without promoting every exact piece.',
      good_pieces: 'Learning saved: these pieces look promising together.',
      almost: 'Learning saved: treating this as close but not fully solved.',
      not_me: 'Learning saved as scoped feedback about this direction.',
      bad_occasion: 'Learning saved for this formula and occasion.',
      fit_issue: 'Learning saved: treating this as a fit-risk combination.',
      too_safe: 'Learning saved: this outfit felt too safe or over-balanced.',
      too_boho: 'Learning saved: this outfit drifted toward a costume/festival stereotype, not away from bohemian or folk-artisan style itself.',
      too_generic: 'Learning saved: this outfit felt generic.',
      too_soft: 'Learning saved: this outfit felt excessively soft.',
      wrong_silhouette: 'Learning saved: this silhouette is wrong for this selected piece/board, not a global silhouette ban.',
      weak_structure: 'Learning saved: requiring stronger structure next time.',
      weak_contrast: 'Learning saved: requiring clearer contrast/tension next time.',
      bad_grounding: 'Learning saved: improving shoe/grounding logic next time.',
      [WRONG_PIECE_FOR_OUTFIT_FEEDBACK]: 'Learning saved for this garment in this outfit context; it is not a global garment rejection.',
      bad_reference: 'Learning saved: using this as a negative reference.',
      style_direction: 'Learning saved: correcting this part of the outfit’s overall feel.',
      shape_balance: 'Learning saved: correcting this fit or shape issue.',
      wrong_garment_details: 'Rendering correction saved: preserve the garment details.',
      body_proportions_drift: 'Rendering correction saved: preserve body proportions.',
      identity_drift: 'Rendering correction saved: preserve identity and resemblance.',
      wrong_length: 'Rendering correction saved: preserve garment length.'
    }

    res.json({ success: true, id: result.lastInsertRowid, learningMessage: learningMessages[storedFeedbackType] || 'Learning saved.' })
  } catch (err) {
    console.error('Stylist feedback error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/stylist-feedback', (req, res) => {
  const { contextType, contextId, limit = 100, includeArchived = 'false' } = req.query
  const clauses = []
  const params = []
  if (contextType) { clauses.push('context_type = ?'); params.push(contextType) }
  if (contextId) { clauses.push('context_id = ?'); params.push(Number(contextId)) }
  if (includeArchived !== 'true') clauses.push('COALESCE(archived,0) = 0')
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db.prepare(`
    SELECT * FROM stylist_feedback
    ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, Number(limit))
  const boardIdsByImage = new Map(db.prepare('SELECT id, image_url FROM saved_boards WHERE image_url IS NOT NULL AND image_url != ?').all('').map(row => [row.image_url, row.id]))
  res.json(rows.map(r => {
    const payload = safeJsonParse(r.payload, {})
    const projected = {
      ...r,
      is_gold: Boolean(r.is_gold),
      archived: Boolean(r.archived),
      payload,
      referenced_board_id: boardIdsByImage.get(feedbackBoardImage(payload)) || null,
      referenced_thread_id: referencedThreadForFeedback(r, payload),
    }
    return { ...projected, memory: activeMemoryMetadata(projected) }
}))
})

export function syncPieceRuleReceipt(row, { note = row.note, archived = Boolean(row.archived) } = {}) {
  if (row.feedback_type !== 'piece_rule_receipt') return
  const payload = safeJsonParse(row.payload, {}) || {}
  const pieceId = Number(payload.pieceId || row.context_id)
  if (!pieceId) throw new Error('Piece-scoped correction is missing its canonical piece ID')
  const piece = db.prepare('SELECT styling_rules_learned FROM pieces WHERE id = ?').get(pieceId)
  if (!piece) throw new Error(`Piece ${pieceId} no longer exists`)
  const rules = safeJsonParse(piece.styling_rules_learned, []) || []
  const previousNote = String(row.note || '').trim()
  const nextNote = String(note || '').trim()
  const previousRuleExists = rules.some(rule => String(rule).trim() === previousNote)
  const isReactivating = Boolean(row.archived) && !archived
  if (!archived && !previousRuleExists && !isReactivating) {
    const error = new Error('This garment rule was edited or removed on the garment card. Refresh Conversation Memory before editing its receipt.')
    error.status = 409
    throw error
  }
  let nextRules = rules.filter(rule => String(rule).trim() !== previousNote)
  if (!archived && nextNote && !nextRules.some(rule => String(rule).trim() === nextNote)) {
    nextRules.push(nextNote)
  }
  db.prepare('UPDATE pieces SET styling_rules_learned = ? WHERE id = ?')
    .run(JSON.stringify(nextRules), pieceId)
}

router.patch('/stylist-feedback/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM stylist_feedback WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Feedback not found' })
    const { archived, note, label } = req.body || {}
    const next = {
      archived: typeof archived === 'boolean' ? (archived ? 1 : 0) : row.archived || 0,
      note: typeof note === 'string' ? note : row.note,
      label: typeof label === 'string' ? label : row.label,
    }
    // Guidance is read-only in Style Profile: a memory can be stopped, never reworded in place, so
    // nothing here re-derives its applicability. A stored envelope only ever changes by the owner
    // saying something new in chat, which writes its own row through store_user_correction.
    const updateFeedback = db.transaction(() => {
      syncPieceRuleReceipt(row, { note: next.note, archived: Boolean(next.archived) })
      db.prepare('UPDATE stylist_feedback SET archived = ?, note = ?, label = ? WHERE id = ?')
        .run(next.archived, next.note, next.label, req.params.id)
    })
    updateFeedback()
    const updated = db.prepare('SELECT * FROM stylist_feedback WHERE id = ?').get(req.params.id)
    syncSavedBoardFromFeedback(updated)
    res.json({ ...updated, is_gold: Boolean(updated.is_gold), archived: Boolean(updated.archived), payload: safeJsonParse(updated.payload, {}) })
  } catch (err) {
    console.error('Update stylist feedback error:', err)
    res.status(err.status || 500).json({ error: err.message })
  }
})

router.delete('/stylist-feedback/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM stylist_feedback WHERE id = ?').get(req.params.id)
    const archiveFeedback = db.transaction(() => {
      if (row) syncPieceRuleReceipt(row, { archived: true })
      db.prepare('UPDATE stylist_feedback SET archived = 1 WHERE id = ?').run(req.params.id)
    })
    archiveFeedback()
    const updated = db.prepare('SELECT * FROM stylist_feedback WHERE id = ?').get(req.params.id)
    if (updated) {
      syncSavedBoardFromFeedback(updated)
      clearThreadBoardFeedbackSnapshot(updated)
    }
    res.json({ success: true })
  } catch (err) {
    console.error('Archive stylist feedback error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Renderer calibration image library API ───────────────────────────────────
router.post('/calibration-images', upload.single('photo'), prepareCalibrationThumbnails, (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'photo is required' })
    const kind = String(req.body.kind || 'good_reference')
    const labels = safeJsonParse(req.body.labels, []) || []
    const notes = String(req.body.notes || '')
    const source = String(req.body.source || 'uploaded')
    const imageUrl = `/uploads/${req.file.filename}`

    const result = db.prepare(`
      INSERT INTO calibration_images (image_url, kind, labels, notes, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(imageUrl, kind, JSON.stringify(labels), notes, source)

    const row = db.prepare('SELECT * FROM calibration_images WHERE id = ?').get(result.lastInsertRowid)
    res.json(normalizeCalibrationRow(row))
  } catch (err) {
    console.error('Save calibration image error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/calibration-images', (req, res) => {
  try {
    const { kind, includeArchived = 'false', limit = 120 } = req.query
    const clauses = []
    const params = []
    if (kind) { clauses.push('kind = ?'); params.push(kind) }
    if (includeArchived !== 'true') clauses.push('COALESCE(archived,0) = 0')
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT * FROM calibration_images
      ${where}
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(...params, Number(limit))
    res.json(rows.map(normalizeCalibrationRow))
  } catch (err) {
    console.error('List calibration images error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.patch('/calibration-images/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM calibration_images WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Calibration image not found' })
    const labels = Array.isArray(req.body.labels) ? JSON.stringify(req.body.labels) : row.labels
    const notes = typeof req.body.notes === 'string' ? req.body.notes : row.notes
    const kind = typeof req.body.kind === 'string' ? req.body.kind : row.kind
    const favorite = typeof req.body.favorite === 'boolean' ? (req.body.favorite ? 1 : 0) : row.favorite
    const archived = typeof req.body.archived === 'boolean' ? (req.body.archived ? 1 : 0) : row.archived
    db.prepare('UPDATE calibration_images SET kind = ?, labels = ?, notes = ?, favorite = ?, archived = ? WHERE id = ?')
      .run(kind, labels, notes, favorite, archived, req.params.id)
    res.json(normalizeCalibrationRow(db.prepare('SELECT * FROM calibration_images WHERE id = ?').get(req.params.id)))
  } catch (err) {
    console.error('Update calibration image error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/calibration-images/:id', (req, res) => {
  try {
    db.prepare('UPDATE calibration_images SET archived = 1 WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('Archive calibration image error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Saved outfit/editorial boards API ─────────────────────────────────────────
function indexSavedBoardPieceLinks(row) {
  const linkedIds = collectPieceIdsFromSavedBoardRow(row)
  const replaceLinks = db.transaction(() => {
    db.prepare('DELETE FROM saved_board_pieces WHERE board_id = ?').run(row.id)
    const insert = db.prepare('INSERT OR IGNORE INTO saved_board_pieces (board_id, piece_id) VALUES (?, ?)')
    linkedIds.forEach(pieceId => insert.run(row.id, pieceId))
    db.prepare('UPDATE saved_boards SET links_indexed = 1 WHERE id = ?').run(row.id)
  })
  replaceLinks()
  return linkedIds
}

function backfillSavedBoardPieceLinks() {
  const pending = db.prepare('SELECT * FROM saved_boards WHERE COALESCE(links_indexed, 0) = 0').all()
  pending.forEach(indexSavedBoardPieceLinks)
}

router.post('/saved-boards', async (req, res) => {
  try {
    const {
      boardType = 'wardrobe',
      contextType = null,
      contextId = null,
      contextName = '',
      title = '',
      imageUrl = '',
      pieces = [],
      missingPieces = [],
      reason = '',
      watchFor = '',
      payload = {},
      favorite = false,
      hidden_from_lookbook = false,
    } = req.body || {}

    if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' })
    const boardThumbnailUrl = cachedThumbnailUrlForUpload(imageUrl, 'relationship-board')
    const boardSourceRelative = boardThumbnailUrl ? imageUrl.slice('/uploads/'.length) : ''
    if (boardSourceRelative && fs.existsSync(path.join(userUploadsDir(), boardSourceRelative))) {
      await ensureCachedThumbnail(boardSourceRelative, userUploadsDir(), 'relationship-board')
    }

    const existingFeedbackLabels = db.prepare(`
      SELECT DISTINCT feedback_type FROM stylist_feedback
      WHERE target_type = 'generated_visual_board' AND COALESCE(archived, 0) = 0
        AND json_extract(payload, '$.board.imageUrl') = ?
    `).all(imageUrl).map(row => row.feedback_type)
    const existingFeedbackReasonRows = db.prepare(`
      SELECT feedback_type, payload FROM stylist_feedback
      WHERE target_type = 'generated_visual_board' AND COALESCE(archived, 0) = 0
        AND json_extract(payload, '$.board.imageUrl') = ?
        AND feedback_type IN ('style_direction','shape_balance','wrong_length')
    `).all(imageUrl)
    const suppliedFeedbackLabels = Array.isArray(payload?.feedback_labels) ? payload.feedback_labels : []
    const syncedFeedbackDetails = { ...(payload?.feedback_details || {}) }
    for (const category of ['style_direction', 'shape_balance']) {
      syncedFeedbackDetails[category] = [...new Set(existingFeedbackReasonRows
        .filter(row => row.feedback_type === category)
        .map(row => safeJsonParse(row.payload, {})?.feedback_reason)
        .filter(Boolean))]
    }
    syncedFeedbackDetails.wrong_length = existingFeedbackReasonRows
      .filter(row => row.feedback_type === 'wrong_length')
      .map(row => safeJsonParse(row.payload, {})?.length_correction)
      .filter(correction => Number(correction?.piece_id) && correction?.issue)
    const syncedFeedbackLabels = [...new Set([...suppliedFeedbackLabels, ...existingFeedbackLabels])]
    const activeLogicVerdict = ['signature', 'works', 'almost'].find(label => syncedFeedbackLabels.includes(label))
    const provisionalRow = { title, reason, context_name: contextName, image_url: imageUrl, pieces }
    const scopedEvidence = activeLogicVerdict
      ? positiveEvidenceForSavedBoard(activeLogicVerdict, provisionalRow, payload)
      : null
    const syncedPayload = {
      ...(payload || {}),
      feedback_labels: syncedFeedbackLabels,
      feedback_details: syncedFeedbackDetails,
      ...(scopedEvidence ? { scoped_evidence: scopedEvidence } : {}),
    }

    const result = db.prepare(`
      INSERT INTO saved_boards
      (board_type, context_type, context_id, context_name, title, image_url, pieces, missing_pieces, reason, watch_for, payload, favorite, hidden_from_lookbook)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      boardType || 'wardrobe',
      contextType || null,
      contextId ? Number(contextId) : null,
      contextName || '',
      title || '',
      imageUrl,
      JSON.stringify(pieces || []),
      JSON.stringify(missingPieces || []),
      reason || '',
      watchFor || '',
      JSON.stringify(syncedPayload),
      favorite ? 1 : 0,
      hidden_from_lookbook ? 1 : 0
    )

    let saved = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(result.lastInsertRowid)
    indexSavedBoardPieceLinks(saved)
    saved = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(result.lastInsertRowid)
    res.json({
      ...saved,
      favorite: Boolean(saved.favorite),
      archived: Boolean(saved.archived),
      hidden_from_lookbook: Boolean(saved.hidden_from_lookbook),
      pieces: safeJsonParse(saved.pieces, []),
      missing_pieces: safeJsonParse(saved.missing_pieces, []),
      payload: safeJsonParse(saved.payload, {}),
      thumbnail_url: boardThumbnailUrl
    })
  } catch (err) {
    console.error('Save board error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/saved-boards', (req, res) => {
  try {
    const { contextType, contextId, pieceId, limit = 100, includeArchived = 'false', excludeHidden = 'false' } = req.query
    const clauses = []
    const params = []
    if (contextType) { clauses.push('context_type = ?'); params.push(contextType) }
    if (contextId) { clauses.push('context_id = ?'); params.push(Number(contextId)) }
    if (pieceId) {
      backfillSavedBoardPieceLinks()
      clauses.push('EXISTS (SELECT 1 FROM saved_board_pieces sbp WHERE sbp.board_id = saved_boards.id AND sbp.piece_id = ?)')
      params.push(Number(pieceId))
    }
    if (includeArchived !== 'true') clauses.push('COALESCE(archived,0) = 0')
    if (excludeHidden === 'true') clauses.push('COALESCE(hidden_from_lookbook,0) = 0')
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rowLimit = Number(limit)
    const rows = db.prepare(`
      SELECT * FROM saved_boards
      ${where}
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(...params, rowLimit)
    const normalized = rows.map(row => {
      const linked_piece_ids = collectPieceIdsFromSavedBoardRow(row)
      const payload = safeJsonParse(row.payload, {})
      if (!payload.threadId && row.image_url) {
        try {
          const match = db.prepare('SELECT id FROM chat_threads WHERE payload LIKE ? LIMIT 1')
            .get(`%${row.image_url}%`)
          if (match) {
            payload.threadId = match.id
            db.prepare('UPDATE saved_boards SET payload = ? WHERE id = ?')
              .run(JSON.stringify(payload), row.id)
          }
        } catch (e) {
          console.error('Failed to look up or backfill threadId for saved board:', e)
        }
      }
      return {
        ...row,
        favorite: Boolean(row.favorite),
        archived: Boolean(row.archived),
        hidden_from_lookbook: Boolean(row.hidden_from_lookbook),
        pieces: safeJsonParse(row.pieces, []),
        missing_pieces: safeJsonParse(row.missing_pieces, []),
        payload,
        linked_piece_ids,
        thumbnail_url: cachedThumbnailUrlForUpload(row.image_url, 'relationship-board'),
      }
    })
    res.json(normalized)
  } catch (err) {
    console.error('List saved boards error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/saved-boards/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Saved board not found' })
    res.json({
      ...row,
      favorite: Boolean(row.favorite),
      archived: Boolean(row.archived),
      hidden_from_lookbook: Boolean(row.hidden_from_lookbook),
      pieces: safeJsonParse(row.pieces, []),
      missing_pieces: safeJsonParse(row.missing_pieces, []),
      payload: safeJsonParse(row.payload, {}),
      linked_piece_ids: collectPieceIdsFromSavedBoardRow(row),
      thumbnail_url: cachedThumbnailUrlForUpload(row.image_url, 'relationship-board'),
    })
  } catch (err) {
    console.error('Get saved board error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.patch('/saved-boards/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Saved board not found' })
    const { favorite, archived, title, reason, watchFor, feedbackLabel, feedbackLabels, feedbackDetails, hidden_from_lookbook } = req.body || {}
    const payload = safeJsonParse(row.payload, {}) || {}
    let nextFeedbackLabels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
    if (Array.isArray(feedbackLabels)) {
      nextFeedbackLabels = [...new Set(feedbackLabels.map(x => String(x || '').trim()).filter(Boolean))]
    } else if (typeof feedbackLabel === 'string' && feedbackLabel.trim()) {
      const label = feedbackLabel.trim()
      nextFeedbackLabels = nextFeedbackLabels.includes(label)
        ? nextFeedbackLabels.filter(x => x !== label)
        : [...nextFeedbackLabels, label]
    }
    const nextFeedbackDetails = feedbackDetails && typeof feedbackDetails === 'object' && !Array.isArray(feedbackDetails)
      ? feedbackDetails
      : (payload.feedback_details || {})
    const activeLogicVerdict = ['signature', 'works', 'almost'].find(label => nextFeedbackLabels.includes(label))
    const scopedEvidence = activeLogicVerdict
      ? positiveEvidenceForSavedBoard(activeLogicVerdict, row, payload)
      : null
    const nextPayload = { ...payload, feedback_labels: nextFeedbackLabels, feedback_details: nextFeedbackDetails }
    if (scopedEvidence) nextPayload.scoped_evidence = scopedEvidence
    else delete nextPayload.scoped_evidence
    const next = {
      favorite: typeof favorite === 'boolean' ? (favorite ? 1 : 0) : row.favorite || 0,
      archived: typeof archived === 'boolean' ? (archived ? 1 : 0) : row.archived || 0,
      hidden_from_lookbook: typeof hidden_from_lookbook === 'boolean'
        ? (hidden_from_lookbook ? 1 : 0)
        : (typeof hidden_from_lookbook === 'number' ? hidden_from_lookbook : row.hidden_from_lookbook || 0),
      title: typeof title === 'string' ? title : row.title,
      reason: typeof reason === 'string' ? title : row.reason,
      watch_for: typeof watchFor === 'string' ? watchFor : row.watch_for,
      payload: JSON.stringify(nextPayload),
    }
    next.reason = typeof reason === 'string' ? reason : row.reason
    db.prepare('UPDATE saved_boards SET favorite = ?, archived = ?, hidden_from_lookbook = ?, title = ?, reason = ?, watch_for = ?, payload = ? WHERE id = ?')
      .run(next.favorite, next.archived, next.hidden_from_lookbook, next.title, next.reason, next.watch_for, next.payload, req.params.id)
    const updated = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(req.params.id)
    if (Array.isArray(feedbackLabels) || (typeof feedbackLabel === 'string' && feedbackLabel.trim())) {
      syncFeedbackFromSavedBoard(updated, Array.isArray(payload.feedback_labels) ? payload.feedback_labels : [], nextFeedbackLabels)
    }
    if (feedbackDetails && typeof feedbackDetails === 'object' && !Array.isArray(feedbackDetails)) {
      syncStructuredReasonsFromSavedBoard(updated, payload.feedback_details || {}, nextFeedbackDetails)
    }
    syncRetagSuggestionsFromSavedBoard(updated)
    res.json({
      ...updated,
      favorite: Boolean(updated.favorite),
      archived: Boolean(updated.archived),
      hidden_from_lookbook: Boolean(updated.hidden_from_lookbook),
      pieces: safeJsonParse(updated.pieces, []),
      missing_pieces: safeJsonParse(updated.missing_pieces, []),
      payload: safeJsonParse(updated.payload, {})
    })
  } catch (err) {
    console.error('Update saved board error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/saved-boards/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM saved_boards WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('Delete saved board error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Todos API ──────────────────────────────────────────────────────────────────
router.get('/todos', (req, res) => {
  const todos = db.prepare(`
    SELECT t.*, p.name AS piece_name, p.photo AS piece_photo, p.status AS piece_status
    FROM todos t
    LEFT JOIN pieces p ON t.linked_piece_id = p.id
    ORDER BY t.completed ASC, t.id ASC
  `).all()
  res.json(todos.map(t => ({
    ...t,
    completed: Boolean(t.completed),
    piece: t.linked_piece_id ? {
      id: t.linked_piece_id,
      name: t.piece_name,
      photo: t.piece_photo,
      status: t.piece_status
    } : null
  })))
})

router.post('/todos', (req, res) => {
  const { type, description, linked_piece_id, field } = req.body
  const r = db.prepare('INSERT INTO todos (type, description, linked_piece_id, field) VALUES (?, ?, ?, ?)').run(type, description, linked_piece_id||null, field||null)
  const t = db.prepare(`
    SELECT t.*, p.name AS piece_name, p.photo AS piece_photo, p.status AS piece_status
    FROM todos t
    LEFT JOIN pieces p ON t.linked_piece_id = p.id
    WHERE t.id = ?
  `).get(r.lastInsertRowid)
  res.json({
    ...t,
    completed: Boolean(t.completed),
    piece: t.linked_piece_id ? {
      id: t.linked_piece_id,
      name: t.piece_name,
      photo: t.piece_photo,
      status: t.piece_status
    } : null
  })
})

router.post('/todos/clear-orphaned', (req, res) => {
  const r = db.prepare(`
    DELETE FROM todos
    WHERE type = 'metadata'
      AND (
        linked_piece_id IS NULL
        OR linked_piece_id NOT IN (SELECT id FROM pieces WHERE status = 'active')
      )
  `).run()
  res.json({ success: true, deletedCount: r.changes })
})

router.patch('/todos/:id/toggle', (req, res) => {
  const t = db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: 'Not found' })
  db.prepare('UPDATE todos SET completed = ? WHERE id = ?').run(t.completed ? 0 : 1, req.params.id)
  res.json({ completed: !t.completed })
})

router.delete('/todos/:id', (req, res) => {
  db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

// ── Chat Threads API ───────────────────────────────────────────────────────────
router.get('/chat-threads', (req, res) => {
  try {
    const showArchived = req.query.archived === 'true' ? 1 : 0
    const rows = db.prepare(`
      SELECT id, title, user_renamed, kind, created_at, updated_at, pinned, archived,
             json_extract(payload, '$.activeContext') as activeContext,
             json_extract(payload, '$.activeContext.type') as subjectType,
             COALESCE(
               CASE json_extract(payload, '$.activeContext.type')
                 WHEN 'piece' THEN (
                   SELECT COALESCE(NULLIF(worn_photo, ''), NULLIF(photo, ''))
                   FROM pieces
                   WHERE id = json_extract(payload, '$.activeContext.id')
                 )
                 WHEN 'outfit' THEN (
                   SELECT NULLIF(photo, '')
                   FROM outfits
                   WHERE id = json_extract(payload, '$.activeContext.id')
                 )
               END,
               ''
             ) as subjectPhoto,
             json_extract(payload, '$.threadMemory.source') as memorySource,
             json_extract(payload, '$.threadMemory.stylingContext') as stylingContext,
             json_extract(payload, '$.threadMemory.latestOutfits') as latestOutfits,
             COALESCE(
               json_extract(payload, '$.chatHistory[0].content'),
               json_extract(payload, '$.messages[1].text'),
               json_extract(payload, '$.messages[0].text')
             ) as originalFirstMessage,
             COALESCE(json_array_length(payload, '$.messages'), 0) as message_count
      FROM chat_threads
      WHERE COALESCE(archived, 0) = ?
      ORDER BY pinned DESC, updated_at DESC
    `).all(showArchived)
    res.json(rows.map(r => {
      const { memorySource, stylingContext, latestOutfits, ...metadata } = r
      return {
        ...metadata,
        user_renamed: Boolean(r.user_renamed),
        pinned: Boolean(r.pinned),
        archived: Boolean(r.archived),
        activeContext: safeJsonParse(r.activeContext),
        subjectType: r.subjectType || '',
        subjectPhoto: subjectThumbnailUrl(r.subjectPhoto),
        threadMemory: compactChatThreadMemory({ memorySource, stylingContext, latestOutfits }),
        originalFirstMessage: r.originalFirstMessage || ''
      }
    }))
  } catch (err) {
    console.error('Error fetching chat threads:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/chat-threads/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    res.json({
      ...row,
      user_renamed: Boolean(row.user_renamed),
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived),
      payload: safeJsonParse(row.payload, {})
    })
  } catch (err) {
    console.error('Error fetching chat thread:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/chat-threads', (req, res) => {
  try {
    const { id, title, user_renamed, kind, payload, created_at, updated_at, pinned, archived } = req.body
    if (!id) return res.status(400).json({ error: 'id is required' })

    const stringifiedPayload = typeof payload === 'object' ? JSON.stringify(payload) : (payload || '{}')
    const userRenamedInt = user_renamed === true || user_renamed === 1 ? 1 : 0
    const pinnedInt = pinned === true || pinned === 1 ? 1 : 0
    const archivedInt = archived === true || archived === 1 ? 1 : 0

    const createdAtVal = created_at || null
    const updatedAtVal = updated_at || null

    db.prepare(`
      INSERT INTO chat_threads (id, title, user_renamed, kind, payload, pinned, archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        user_renamed = excluded.user_renamed,
        kind = excluded.kind,
        payload = excluded.payload,
        updated_at = datetime('now')
    `).run(id, title || 'New Chat', userRenamedInt, kind || 'chat', stringifiedPayload, pinnedInt, archivedInt, createdAtVal, updatedAtVal)

    const row = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id)
    res.json({
      ...row,
      user_renamed: Boolean(row.user_renamed),
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived),
      payload: safeJsonParse(row.payload, {})
    })
  } catch (err) {
    console.error('Error upserting chat thread:', err)
    res.status(500).json({ error: err.message })
  }
})

router.patch('/chat-threads/:id/pin', (req, res) => {
  try {
    const row = db.prepare('SELECT pinned, archived FROM chat_threads WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (row.archived) return res.status(400).json({ error: 'Cannot pin an archived thread' })
    
    const nextPinned = row.pinned ? 0 : 1
    db.prepare('UPDATE chat_threads SET pinned = ? WHERE id = ?').run(nextPinned, req.params.id)
    res.json({ pinned: Boolean(nextPinned) })
  } catch (err) {
    console.error('Error pinning chat thread:', err)
    res.status(500).json({ error: err.message })
  }
})

router.patch('/chat-threads/:id/archive', (req, res) => {
  try {
    const row = db.prepare('SELECT pinned, archived FROM chat_threads WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    
    const nextArchived = row.archived ? 0 : 1
    const nextPinned = nextArchived ? 0 : row.pinned
    db.prepare('UPDATE chat_threads SET archived = ?, pinned = ? WHERE id = ?').run(nextArchived, nextPinned, req.params.id)
    res.json({ archived: Boolean(nextArchived), pinned: Boolean(nextPinned) })
  } catch (err) {
    console.error('Error archiving chat thread:', err)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/chat-threads/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM chat_threads WHERE id = ?').run(req.params.id)
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('Error deleting chat thread:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Settings (app_meta key-value) ───────────────────────────────────────────
// 2026-07-10: the app previously had no configured home location at all — freeform chat's model was
// found silently mistreating the app's hardcoded timezone string as a location for plain local asks.
// This is the real fix: a real, structured home location the server injects itself (routes/ai.js's
// /ask handler), never inferred by the model.
// ── Spec 32: user profile + style constitution ──────────────────────────────
// Profile follows the home_location precedent (app_meta keys). Constitution layers live in
// style_constitution; EVERY write appends the prior text to constitution_history (owner
// ruling 2026-07-18 — ruling archaeology survives the move out of git). Both PUTs call
// refreshPrompts() so the live prompt bindings pick the change up without a restart.
// First-run detection for the onboarding wizard (spec 32 Part 3). A fresh instance needs
// onboarding until it is completed or skipped; a pre-existing (legacy-seeded) instance never
// does — its profile arrived via the migration and must never be funneled through the wizard.
router.get('/settings/onboarding-status', (req, res) => {
  try {
    const meta = key => db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)?.value
    const needsOnboarding = meta('constitution_migrated') !== 'legacy-seeded'
      && !meta('profile_display_name')
      && !meta('onboarding_complete')
    res.json({ needsOnboarding })
  } catch (err) {
    console.error('Error reading onboarding status:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/settings/onboarding-complete', (req, res) => {
  try {
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('onboarding_complete', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'").run()
    res.json({ ok: true })
  } catch (err) {
    console.error('Error completing onboarding:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/profile', (req, res) => {
  try {
    res.json(loadUserProfile())
  } catch (err) {
    console.error('Error reading profile:', err)
    res.status(500).json({ error: err.message })
  }
})

router.put('/settings/profile', (req, res) => {
  try {
    const displayName = String(req.body?.displayName || '').trim()
    if (!displayName) return res.status(400).json({ error: 'displayName is required' })
    const pronouns = req.body?.pronouns
    const upsert = db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    upsert.run('profile_display_name', displayName)
    if (pronouns && typeof pronouns === 'object') {
      const cleaned = {
        subject: String(pronouns.subject || 'they').trim() || 'they',
        object: String(pronouns.object || 'them').trim() || 'them',
        possessive: String(pronouns.possessive || 'their').trim() || 'their',
        plural: Boolean(pronouns.plural)
      }
      upsert.run('profile_pronouns', JSON.stringify(cleaned))
    }
    refreshPrompts()
    res.json(loadUserProfile())
  } catch (err) {
    console.error('Error saving profile:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/constitution', (req, res) => {
  try {
    const rows = db.prepare('SELECT layer, body, updated_at FROM style_constitution').all()
    const stored = Object.fromEntries(rows.map(row => [row.layer, { body: row.body, updatedAt: row.updated_at }]))
    res.json({
      layers: CONSTITUTION_LAYER_KEYS.map(layer => ({
        layer,
        body: stored[layer]?.body ?? DEFAULT_CONSTITUTION[layer],
        updatedAt: stored[layer]?.updatedAt ?? null,
        isDefault: !(layer in stored)
      }))
    })
  } catch (err) {
    console.error('Error reading constitution:', err)
    res.status(500).json({ error: err.message })
  }
})

router.put('/settings/constitution/:layer', (req, res) => {
  try {
    const layer = String(req.params.layer || '')
    if (!CONSTITUTION_LAYER_KEYS.includes(layer)) {
      return res.status(400).json({ error: `Unknown constitution layer: ${layer}` })
    }
    const body = String(req.body?.body || '').trim()
    if (!body) return res.status(400).json({ error: 'body is required' })
    const source = req.body?.source === 'interview' ? 'interview' : 'edit'
    const prior = db.prepare('SELECT body FROM style_constitution WHERE layer = ?').get(layer)
    db.transaction(() => {
      db.prepare("INSERT INTO constitution_history (layer, prior_body, source) VALUES (?, ?, ?)").run(layer, prior?.body ?? null, source)
      db.prepare("INSERT INTO style_constitution (layer, body, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(layer) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at").run(layer, body)
    })()
    refreshPrompts()
    res.json({ layer, body })
  } catch (err) {
    console.error('Error saving constitution layer:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/constitution/:layer/history', (req, res) => {
  try {
    const layer = String(req.params.layer || '')
    if (!CONSTITUTION_LAYER_KEYS.includes(layer)) {
      return res.status(400).json({ error: `Unknown constitution layer: ${layer}` })
    }
    const rows = db.prepare('SELECT id, layer, prior_body, source, created_at FROM constitution_history WHERE layer = ? ORDER BY id DESC LIMIT 50').all(layer)
    res.json({ history: rows })
  } catch (err) {
    console.error('Error reading constitution history:', err)
    res.status(500).json({ error: err.message })
  }
})

// Demo wardrobe (owner ruling 2026-07-19): fresh instances start empty; the former
// auto-seeded sample pieces are opt-in and removable in one action.
router.get('/settings/demo-wardrobe', (req, res) => {
  try {
    res.json({ count: demoWardrobeCount(db), available: DEMO_WARDROBE_PIECES.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/settings/demo-wardrobe', (req, res) => {
  try {
    if (demoWardrobeCount(db) > 0) return res.status(400).json({ error: 'Demo wardrobe is already loaded.' })
    const count = seedDemoWardrobe(db)
    res.json({ loaded: count })
  } catch (err) {
    console.error('Demo wardrobe load error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/settings/demo-wardrobe', (req, res) => {
  try {
    const removed = removeDemoWardrobe(db)
    res.json({ removed })
  } catch (err) {
    console.error('Demo wardrobe remove error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/home-location', (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'home_location'").get()
    res.json({ homeLocation: row?.value || '' })
  } catch (err) {
    console.error('Error reading home location:', err)
    res.status(500).json({ error: err.message })
  }
})

router.put('/settings/home-location', (req, res) => {
  try {
    const homeLocation = String(req.body?.homeLocation || '').trim()
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('home_location', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(homeLocation)
    res.json({ homeLocation })
  } catch (err) {
    console.error('Error saving home location:', err)
    res.status(500).json({ error: err.message })
  }
})

// Spec 33 Part 4 — BYOK. Only ever reports whether a key is set, never the value itself.
router.get('/settings/api-keys', (req, res) => {
  try {
    res.json(ownKeyStatus())
  } catch (err) {
    console.error('Error reading API key status:', err)
    res.status(500).json({ error: err.message })
  }
})

router.put('/settings/api-keys', (req, res) => {
  try {
    const { anthropicKey, openAiKey } = req.body || {}
    if (anthropicKey !== undefined) setOwnKey('anthropic', String(anthropicKey).trim())
    if (openAiKey !== undefined) setOwnKey('openai', String(openAiKey).trim())
    res.json(ownKeyStatus())
  } catch (err) {
    console.error('Error saving API keys:', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
