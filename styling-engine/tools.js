import path from 'path'
import fs from 'fs'
import { db, uploadsDir, safeJsonParse } from '../db.js'
import { parsePiece, buildPieceText, pieceOccasionCompatible, wholeWardrobePieceTrustDecision, weatherProfileFromContext, weatherFitForPiece, getMergedProfileRules, profileRuleFit } from './rules.js'
import { prepareImageForClaude, prepareWardrobeThumb } from './provider.js'
import { resolveOccasionProfile } from './occasions.js'
import { resolveActivityProfile } from './footwear-comfort.js'
import { OCCASION_VALUES, ACTIVITY_VALUES, MISSION_VALUES, normalizeStylingIntent, normalizeActivity, normalizeOccasion } from './stylingIntent.js'

const SEARCH_WARDROBE_VISUAL_CAP = 16
const OCCASION_VALUE_SET = new Set(OCCASION_VALUES)
const SEARCH_QUERY_OCCASION_SYNONYMS = new Map([
  ['dinner', 'evening'],
  ['dining', 'evening'],
  ['restaurant', 'evening'],
  ['wine bar', 'evening'],
  ['theater', 'evening'],
  ['night', 'evening'],
  ['night out', 'evening'],
  ['wedding', 'evening'],
  ['brunch', 'city'],
  ['museum', 'city'],
  ['shopping', 'city'],
  ['office', 'city'],
  ['work', 'city'],
  ['everyday', 'city'],
  ['gallery', 'gallery / art event'],
  ['art event', 'gallery / art event'],
  ['gallery event', 'gallery / art event'],
  ['gallery opening', 'gallery / art event'],
  ['outdoor daytime social', 'outdoor_daytime_social'],
  ['outdoor daytime', 'outdoor_daytime_social'],
  ['daytime social', 'outdoor_daytime_social'],
  ['wine festival', 'outdoor_daytime_social'],
  ['outdoor cafe', 'outdoor_daytime_social'],
  ['picnic', 'outdoor_daytime_social']
])
const PROFILE_TO_CANONICAL_OCCASION = new Map([
  ['city_smart_casual', 'city'],
  ['evening_social', 'evening'],
  ['outdoor_daytime_social', 'outdoor_daytime_social'],
  ['home_loungewear', 'casual']
])

function normalizePieceLookupName(name = '') {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function resolveActivePieceByName(name = '') {
  const exact = db.prepare("SELECT * FROM pieces WHERE status='active' AND name = ?").get(name)
  if (exact) return exact

  const caseInsensitive = db.prepare("SELECT * FROM pieces WHERE status='active' AND lower(name) = lower(?)").get(name)
  if (caseInsensitive) return caseInsensitive

  const normalizedName = normalizePieceLookupName(name)
  if (!normalizedName) return null
  const activePieces = db.prepare("SELECT * FROM pieces WHERE status='active'").all()
  return activePieces.find(piece => normalizePieceLookupName(piece.name) === normalizedName) || null
}

function canonicalOccasionFromQuery(query = '') {
  const raw = String(query || '').toLowerCase().trim()
  if (!raw) return ''
  if (OCCASION_VALUE_SET.has(raw)) return raw
  const synonymOccasion = SEARCH_QUERY_OCCASION_SYNONYMS.get(raw)
  if (synonymOccasion) return synonymOccasion
  const profile = resolveOccasionProfile(raw, '')
  return PROFILE_TO_CANONICAL_OCCASION.get(profile?.id) || ''
}

function isOccasionOnlySearchQuery(query = '') {
  return Boolean(canonicalOccasionFromQuery(query))
}

function shouldBroadenSparseOccasionSearch(occasion = '') {
  const profile = resolveOccasionProfile(occasion, '')
  if (!profile) return true
  const rules = profile.rules || {}
  const hardLists = [
    rules.prohibited_materials,
    rules.prohibited_materials_warm,
    rules.prohibited_footwear,
    rules.prohibited_footwear_summer,
    rules.prohibited_pieces,
    rules.discouraged_pieces
  ]
  return !hardLists.some(list => Array.isArray(list) && list.length > 0)
}

export const STYLIST_TOOLS = [
  {
    name: "search_wardrobe",
    description: "Search the wardrobe database for matching active garments. Returns a list of pieces with their ID, name, category, reads_as, visual parameters (pattern, silhouette, fabric, neckline, sleeves, length, hem), and simple notes.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query matching against name or notes" },
        category: { type: "string", description: "Filter by category (e.g. top, bottom, shoes, outerwear, dress, accessory)" },
        color: { type: "string", description: "Filter by color description or reads_as tag" },
        occasion: { type: "string", description: "Filter by occasion (e.g. city, casual, evening)" },
        pattern_type: { type: "string", description: "Filter by pattern type, e.g. solid, floral, stripe, botanical, geometric, abstract, animal, graphic, plaid, other" },
        silhouette: { type: "string", description: "Filter by silhouette type, e.g. fitted, slim, relaxed, boxy, A-line, drop-shoulder, oversized" },
        fabric_weight: { type: "string", description: "Filter by fabric weight, e.g. ultralight, light, medium, heavy" },
        fabric_category: { type: "string", description: "Filter by fabric category, e.g. jersey, knit, linen, silk, satin, cotton, wool, cashmere, viscose, denim, twill, canvas, corduroy, tweed, velvet, leather, suede, ponte, synthetic, fleece, other" },
        neckline: { type: "string", description: "Filter by neckline style, e.g. V, scoop, crew, boat, mock, cowl, off-shoulder, square, wrap, other, none" },
        weather: { type: "string", description: "Established conditions (e.g. hot, highs 80-90F, cold). Ranks and flags results by weather fit; pass it whenever conditions are known." },
        activity: { type: "string", enum: ACTIVITY_VALUES, description: "Established activity (walking/hiking). With occasion, flags pieces by profile-rule fit; pass it whenever known." },
        visual: { type: "boolean", description: "When true, attach low-detail thumbnails for the top ranked matches so you can judge color, texture, print, and proportion by sight. Use before proposing or refining outfits; leave false for quick text lookups." }
      }
    }
  },
  {
    name: "get_garment_details",
    description: "Retrieve full detailed styling rules, fit cautions, and AI garment intelligence for specific garment IDs.",
    input_schema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "integer" },
          description: "List of garment IDs to retrieve details for."
        }
      },
      required: ["ids"]
    }
  },
  {
    name: "get_last_outfit_evaluation",
    description: "Retrieve the most recent outfit critique/evaluation notes from database for an outfit ID.",
    input_schema: {
      type: "object",
      properties: {
        outfit_id: { type: "integer", description: "The ID of the outfit." }
      },
      required: ["outfit_id"]
    }
  },
  {
    name: "get_current_image_inventory",
    description: "Retrieve description of currently visible/attached images in the current chat state.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "store_user_correction",
    description: "Store a taste preference or correction (e.g., 'I do not wear flats') into the database.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "The user preference or correction text." },
        context_type: { type: "string", description: "Context type: 'outfit' or 'general'" },
        context_id: { type: "integer", description: "Optional outfit ID if context is outfit" }
      },
      required: ["note"]
    }
  },
  {
    name: "generate_outfits",
    description: "Compose fresh visual outfit card options from Yuna's wardrobe. Use only when the user explicitly asks the system to generate/compose fresh cards from scratch, not for ordinary text styling advice or to show an outfit already discussed.",
    input_schema: {
      type: "object",
      properties: {
        occasion: { type: "string", enum: OCCASION_VALUES, description: "The occasion. Pick the closest allowed value; do not invent. casual/gallery/concert/travel are intentionally permissive." },
        activity: { type: "string", enum: ACTIVITY_VALUES, description: "Physical-demand axis, orthogonal to occasion. Set ONLY when the request implies physical demand (lots of walking, hiking). Omit it to carry forward any activity already established in the conversation." },
        season: { type: "string", description: "Season/weather context (e.g. warm, cool, year-round). Infer from the date when not stated." },
        mood: { type: "string", description: "Optional vibe/aesthetic direction only (e.g. artistic minimal, earthy structure). Do NOT put activity here; use the activity parameter." },
        mission: { type: "string", enum: MISSION_VALUES, description: "Styling mission. Default 'mix'." },
        limit: { type: "integer", description: "Maximum number of outfits to generate (1 to 5, default 5)." },
        piece_id: { type: "integer", description: "Optional database ID of a specific garment if styling outfits around that piece. If omitted, generates outfits from the whole wardrobe." }
      },
      required: ["occasion", "season"]
    }
  },
  {
    name: "render_outfit",
    description: "Turn a specific outfit already proposed into a visual card using its EXACT pieces. Use when the user asks to see/show/render a proposed outfit. Renders the given pieces as-is; does NOT compose a new outfit and does NOT generate an image.",
    input_schema: {
      type: "object",
      properties: {
        pieces: { type: "array", items: { type: "string" }, description: "Exact wardrobe piece names of the outfit to render, as named in the proposal. Each must be a real DB garment name." },
        label: { type: "string", description: "The outfit title from the proposal." },
        occasion: { type: "string", enum: OCCASION_VALUES, description: "The occasion this outfit is for." },
        season: { type: "string", description: "Season/weather context." }
      },
      required: ["pieces"]
    }
  }
]

export async function executeTool(name, args, toolContext = {}) {
  console.log(`\n🤖 [Agent Tool Call] ${name} (${JSON.stringify(args)})`)
  try {
    switch (name) {
      case 'search_wardrobe': {
        const { query, category, color, occasion, pattern_type, silhouette, fabric_weight, fabric_category, neckline, weather: weatherText, activity, visual } = args
        let sql = "SELECT * FROM pieces WHERE status = 'active'"
        const params = []
        if (category) {
          sql += " AND category = ?"
          params.push(category)
        }
        if (pattern_type) {
          sql += " AND pattern_type = ?"
          params.push(pattern_type)
        }
        if (silhouette) {
          sql += " AND silhouette = ?"
          params.push(silhouette)
        }
        if (fabric_weight) {
          sql += " AND fabric_weight = ?"
          params.push(fabric_weight)
        }
        if (fabric_category) {
          sql += " AND fabric_category = ?"
          params.push(fabric_category)
        }
        if (neckline) {
          sql += " AND neckline = ?"
          params.push(neckline)
        }
        const rows = db.prepare(sql).all(...params).map(parsePiece)
        
        let filtered = rows
        if (color) {
          const cLower = color.toLowerCase()
          filtered = filtered.filter(p => 
            (p.reads_as && p.reads_as.toLowerCase().includes(cLower)) || 
            p.colors.some(c => c.toLowerCase().includes(cLower))
          )
        }
        let fallbackNote = ''
        if (occasion) {
          const beforeOccasionFilter = filtered
          const occasionFiltered = filtered.filter(p => {
            if (!pieceOccasionCompatible(p, occasion)) return false
            const trust = wholeWardrobePieceTrustDecision(p, { occasion })
            return trust.allowed
          })
          if (occasionFiltered.length) {
            filtered = occasionFiltered
          } else {
            filtered = beforeOccasionFilter
            fallbackNote = `No active pieces are explicitly tagged for "${occasion}"; showing flexible active wardrobe pieces instead, with ruleFit/weatherFit annotations for the requested context.`
          }
        }
        if (query) {
          const qLower = query.toLowerCase()
          const queryOccasion = isOccasionOnlySearchQuery(query) ? canonicalOccasionFromQuery(query) : ''
          if (queryOccasion) {
            const beforeOccasionQueryFilter = filtered
            const occasionQueryFiltered = filtered.filter(p => pieceOccasionCompatible(p, queryOccasion))
            if (occasionQueryFiltered.length || !shouldBroadenSparseOccasionSearch(queryOccasion)) {
              filtered = occasionQueryFiltered
            } else {
              filtered = beforeOccasionQueryFilter
              fallbackNote = `No active pieces are explicitly tagged for "${queryOccasion}"; showing flexible active wardrobe pieces instead, with ruleFit/weatherFit annotations for the requested context.`
            }
          } else {
            filtered = filtered.filter(p => 
              p.name.toLowerCase().includes(qLower) || 
              (p.notes && p.notes.toLowerCase().includes(qLower))
            )
          }
        }

        let excludedCount = 0
        if (toolContext && toolContext.allowedPieceIds) {
          const allowedSet = toolContext.allowedPieceIds instanceof Set 
            ? toolContext.allowedPieceIds 
            : new Set(Array.isArray(toolContext.allowedPieceIds) ? toolContext.allowedPieceIds.map(Number) : [])
          
          const beforeFilterLength = filtered.length
          filtered = filtered.filter(p => allowedSet.has(Number(p.id)))
          excludedCount = beforeFilterLength - filtered.length
        }
        
        let results = filtered
        const resolvedWeather = weatherProfileFromContext({ season: weatherText || toolContext.weather || toolContext.season || '' })
        if (resolvedWeather.isHot || resolvedWeather.isCold) {
          results = results
            .map(p => {
              const fit = weatherFitForPiece(p, resolvedWeather)
              return { ...p, weatherFit: fit.label, weatherFitScore: fit.score }
            })
            .sort((a, b) => (b.weatherFitScore || 0) - (a.weatherFitScore || 0))
        }

        const resolvedOccasion = occasion || toolContext.occasion || ''
        const resolvedActivity = activity !== undefined && activity !== null && activity !== ''
          ? normalizeActivity(activity)
          : (toolContext.activity || '')
        const occasionProfile = resolveOccasionProfile(resolvedOccasion, '')
        const activityProfile = resolveActivityProfile({ activity: resolvedActivity })
        if (occasionProfile || activityProfile) {
          const mergedRules = getMergedProfileRules(occasionProfile, activityProfile)
          const tierRank = { preferred: 0, neutral: 1, discouraged: 2, prohibited: 3 }
          results = results
            .map(p => {
              const fit = profileRuleFit(p, mergedRules, { weatherProfile: resolvedWeather, occasionProfile })
              return { ...p, ruleFit: fit.tier, ruleFitLabel: fit.label }
            })
            .sort((a, b) => (tierRank[a.ruleFit] ?? 1) - (tierRank[b.ruleFit] ?? 1))
        }
        
        console.log(`🔍 [Agent Tool Call] search_wardrobe returned ${results.length} items.`)
        const resultList = await Promise.all(results.map(async (p, index) => {
          let image = null
          if (visual && index < SEARCH_WARDROBE_VISUAL_CAP) {
            const photoFile = p.worn_photo || p.photo || ''
            if (photoFile) {
              const filePath = path.join(uploadsDir, photoFile)
              if (fs.existsSync(filePath)) {
                try {
                  const thumb = await prepareWardrobeThumb(filePath, `${p.id}:${photoFile}`)
                  image = {
                    mime: thumb.media_type,
                    base64: thumb.data
                  }
                } catch (err) {
                  console.error(`Error loading thumbnail for piece ${p.id}:`, err)
                }
              }
            }
          }
          return {
            id: p.id,
            name: p.name,
            category: p.category,
            reads_as: p.reads_as,
            colors: p.colors,
            occasions: p.occasions,
            pattern_type: p.pattern_type,
            pattern_scale: p.pattern_scale,
            pattern_complexity: p.pattern_complexity,
            silhouette: p.silhouette,
            fabric_category: p.fabric_category,
            fabric_weight: p.fabric_weight,
            neckline: p.neckline,
            sleeve_type: p.sleeve_type,
            length_hits_at: p.length_hits_at,
            hem_finish: p.hem_finish,
            weatherFit: p.weatherFit,
            ruleFit: p.ruleFit,
            ruleFitLabel: p.ruleFitLabel,
            notes: p.notes ? p.notes.slice(0, 120) : '',
            ...(image ? { image } : {})
          }
        }))

        if (fallbackNote) {
          resultList.push({ note: fallbackNote })
        }

        if (excludedCount > 0) {
          resultList.push({
            note: `(${excludedCount} pieces hidden: unavailable for this occasion/weather)`
          })
        }

        return resultList
      }
      case 'render_outfit': {
        const { pieces = [], label = '', occasion, season } = args
        const names = Array.isArray(pieces) ? pieces : []
        const resolved = names.map(name => {
          const fallback = resolveActivePieceByName(name)
          return fallback ? parsePiece(fallback) : null
        }).filter(Boolean)

        const unresolved = names.filter(name => !resolved.some(p => normalizePieceLookupName(p.name) === normalizePieceLookupName(name)))
        if (!resolved.length) {
          return {
            status: "error",
            message: "Could not resolve any named piece to a wardrobe item. Re-check the exact garment names.",
            unresolved
          }
        }
        if (unresolved.length) {
          return {
            status: "error",
            message: "Could not render the outfit because one or more named pieces did not resolve to wardrobe items. Re-check the exact garment names before rendering.",
            pieceNames: resolved.map(p => p.name),
            unresolved
          }
        }

        const resolvedOccasion = occasion ? normalizeOccasion(occasion) : (toolContext.occasion || 'casual')
        const resolvedSeason = season || toolContext.season || 'current season'
        toolContext.source = 'rendered_outfit'
        toolContext.occasion = resolvedOccasion
        toolContext.season = resolvedSeason
        const renderedOutfit = {
          label: label || 'Outfit',
          occasion: resolvedOccasion,
          season: resolvedSeason,
          pieceIds: resolved.map(p => Number(p.id)),
          pieces: resolved,
          previewOnly: true
        }
        const existingOutfits = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []
        toolContext.generatedOutfits = [...existingOutfits, renderedOutfit]
        return {
          status: "success",
          message: `Rendered "${label || 'Outfit'}" as a card with ${resolved.length} pieces.`,
          pieceNames: resolved.map(p => p.name),
          unresolved
        }
      }
      case 'get_garment_details': {
        const { ids } = args
        if (!Array.isArray(ids) || !ids.length) return []
        
        const details = []
        for (const id of ids) {
          const numId = Number(id)
          let allowed = true
          if (toolContext && toolContext.allowedPieceIds) {
            const allowedSet = toolContext.allowedPieceIds instanceof Set 
              ? toolContext.allowedPieceIds 
              : new Set(Array.isArray(toolContext.allowedPieceIds) ? toolContext.allowedPieceIds.map(Number) : [])
            allowed = allowedSet.has(numId)
          }

          if (!allowed) {
            details.push({
              id: numId,
              text: `piece ${numId} is not available for Yuna's current request`
            })
            continue
          }

          const p = db.prepare(`SELECT * FROM pieces WHERE id = ?`).get(numId)
          if (!p) {
            continue
          }
          const parsed = parsePiece(p)
          
          let imageData = null
          const photoFile = parsed.worn_photo || parsed.photo || ''
          if (photoFile) {
            const filePath = path.join(uploadsDir, photoFile)
            if (fs.existsSync(filePath)) {
              try {
                console.log(`📸 [Agent Vision] Resizing reference photo for piece ${parsed.id} (${photoFile})`)
                imageData = await prepareImageForClaude(filePath)
              } catch (err) {
                console.error(`Error loading photo for piece ${parsed.id}:`, err)
              }
            }
          }
          details.push({
            id: parsed.id,
            name: parsed.name,
            text: buildPieceText(parsed),
            image: imageData
          })
        }
        return details
      }
      case 'get_last_outfit_evaluation': {
        const { outfit_id } = args
        return getLastOutfitEvaluation(outfit_id) || { note: "No evaluation found." }
      }
      case 'get_current_image_inventory': {
        const state = getStylistConversationState('default')
        return getCurrentImageInventory(state)
      }
      case 'store_user_correction': {
        const { note, context_type, context_id } = args
        storeUserCorrection(note, context_type || 'general', context_id)
        return { status: "success", message: "Correction stored successfully." }
      }
      case 'generate_outfits': {
        const { occasion, season, mood, mission, limit, piece_id, activity } = args
        const { generateOutfitsForPieceInternal, generateWholeWardrobeOutfitsInternal } = await import('../routes/ai.js')
        const intent = normalizeStylingIntent({ occasion, season, mood, mission })
        const resolvedActivity = (activity !== undefined && activity !== null && activity !== '')
          ? normalizeActivity(activity)
          : (toolContext.activity || 'none')
        const resolvedSeason = toolContext.weather ? `${intent.season}; ${toolContext.weather}` : intent.season
        
        toolContext.occasion = intent.occasion
        toolContext.season = resolvedSeason
        toolContext.mood = intent.mood
        toolContext.mission = intent.mission
        toolContext.activity = resolvedActivity

        let result
        if (piece_id) {
          toolContext.source = 'selected_piece'
          result = await generateOutfitsForPieceInternal({
            pieceId: Number(piece_id),
            occasion: intent.occasion,
            season: resolvedSeason,
            mission: intent.mission,
            mood: intent.mood,
            includeMissingPieces: false,
            idealOnly: false,
            question: toolContext.question || '',
            activity: resolvedActivity
          })
        } else {
          toolContext.source = 'whole_wardrobe'
          result = await generateWholeWardrobeOutfitsInternal({
            occasion: intent.occasion,
            season: resolvedSeason,
            mood: intent.mood,
            mission: intent.mission,
            limit: limit || 5,
            explorationMode: 'moderate',
            question: toolContext.question || '',
            activity: resolvedActivity
          })
        }
        
        if (result && result.structuredOutfits) {
          toolContext.generatedOutfits = result.structuredOutfits
          return {
            status: "success",
            message: `Successfully generated ${result.structuredOutfits.length} outfits.`,
            outfit_summaries: result.structuredOutfits.map(o => ({
              label: o.label,
              dominantDirection: o.dominantDirection,
              pieceNames: (o.pieces || []).map(p => p.name)
            }))
          }
        } else {
          return {
            status: "error",
            message: "No outfits were generated or failed to invoke generation pipeline."
          }
        }
      }
      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    console.error(`Error executing tool ${name}:`, err)
    return { error: err.message }
  }
}

export function getLastOutfitEvaluation(outfitId) {
  if (!outfitId) return null
  try {
    const row = db.prepare(`
      SELECT note, payload FROM stylist_feedback 
      WHERE COALESCE(archived, 0) = 0 AND context_type = 'outfit' AND context_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(Number(outfitId))
    if (!row) return null
    return {
      note: row.note,
      evaluation: safeJsonParse(row.payload, null)
    }
  } catch (err) {
    console.error('getLastOutfitEvaluation error:', err)
    return null
  }
}

export function getCurrentImageInventory(state) {
  if (!state || !state.visible_image_inventory) return []
  return state.visible_image_inventory
}

export function storeUserCorrection(note, contextType = 'general', contextId = null) {
  try {
    db.prepare(`
      INSERT INTO stylist_feedback (feedback_type, target_type, context_type, context_id, note)
      VALUES ('preference_reaction', 'message', ?, ?, ?)
    `).run(contextType, contextId, note)
  } catch (err) {
    console.error('storeUserCorrection error:', err)
  }
}

export function getStylistConversationState(sessionId = 'default') {
  try {
    const row = db.prepare('SELECT state_json FROM stylist_conversation_state WHERE session_id = ?').get(sessionId)
    if (!row) return {}
    return JSON.parse(row.state_json || '{}')
  } catch (err) {
    console.error('getStylistConversationState error:', err)
    return {}
  }
}

export function saveStylistConversationState(state, sessionId = 'default') {
  try {
    const stateJson = JSON.stringify(state || {})
    db.prepare(`
      INSERT INTO stylist_conversation_state (session_id, state_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = datetime('now')
    `).run(sessionId, stateJson)
  } catch (err) {
    console.error('saveStylistConversationState error:', err)
  }
}
