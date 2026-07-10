import path from 'path'
import fs from 'fs'
import { db, uploadsDir, safeJsonParse } from '../db.js'
import { parsePiece, buildPieceText, pieceOccasionCompatible, wholeWardrobePieceTrustDecision, weatherFitForPiece, getMergedProfileRules, profileRuleFit, resolveRegisterCeiling } from './rules.js'
import { prepareImageForClaude, prepareWardrobeThumb } from './provider.js'
import { resolveOccasionProfile } from './occasions.js'
import { resolveActivityProfile } from './footwear-comfort.js'
import { getCurrentWeatherProfile } from './weather.js'
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

// Spec 3 (freeform observability): per-turn counters accumulated on toolContext across every tool
// call in a chat turn, surfaced by routes/ai.js in the /ask response and logged to
// freeform_generation_runs — the freeform-chat equivalent of the composer's roster debug/excludedCounts.
export function bumpFreeformDiagnostic(toolContext, field, amount = 1) {
  if (!toolContext) return
  if (!toolContext.freeformDiagnostics) {
    toolContext.freeformDiagnostics = {
      searchCalls: 0,
      gateExcludedTotal: 0,
      proposeCalls: 0,
      proposeValidationFails: 0,
      outfitProseWithoutToolCall: 0,
      zeroResultContradictionBlocks: 0,
      destinationClarificationRetries: 0,
      showRequestRetries: 0,
      weatherSource: ''
    }
  }
  toolContext.freeformDiagnostics[field] = (toolContext.freeformDiagnostics[field] || 0) + amount
}

// Spec 4: records whether weather resolved live or fell back to the text heuristic, for spec 3's
// per-turn observability (freeform_generation_runs.weather_source).
export function setFreeformWeatherSource(toolContext, source) {
  if (!toolContext) return
  bumpFreeformDiagnostic(toolContext, 'searchCalls', 0)
  toolContext.freeformDiagnostics.weatherSource = source
}

export const OUTFIT_ROLES = ['primary_top', 'layer_top', 'primary_bottom', 'layer_bottom', 'dress', 'shoes', 'outerwear', 'accessory']

// Validate an outfit's role structure (roles only, no layerOf). Returns a list of human-readable
// issues; empty means valid. Represents intentional layering as valid (primary_top + layer_top) while
// catching unresolved slot collisions (two primary_top) — the malformed-vs-intentional distinction.
export function validateOutfitRoles(pieces = []) {
  const issues = []
  const counts = Object.fromEntries(OUTFIT_ROLES.map(r => [r, 0]))
  for (const p of pieces) {
    if (!OUTFIT_ROLES.includes(p.role)) issues.push(`piece ${p.id} has an invalid or missing role`)
    else counts[p.role] += 1
  }
  if (issues.length) return issues

  // Single-occupancy core slots — a second one is an unresolved collision, not a style choice.
  if (counts.primary_top > 1) issues.push('two primary_top pieces — unresolved top slot (use layer_top for intentional layering)')
  if (counts.primary_bottom > 1) issues.push('two primary_bottom pieces — unresolved bottom slot (use layer_bottom for intentional layering)')
  if (counts.dress > 1) issues.push('two dress pieces — unresolved dress slot')
  if (counts.shoes > 1) issues.push('more than one shoes — unresolved shoes slot')

  // Core coverage: separates (top+bottom) OR a single dress, and the two are mutually exclusive.
  const hasSeparatesCore = counts.primary_top >= 1 && counts.primary_bottom >= 1
  const hasDressCore = counts.dress === 1
  if (!hasSeparatesCore && !hasDressCore) issues.push('outfit needs a primary_top plus primary_bottom, or a single dress')
  if (counts.dress >= 1 && (counts.primary_top >= 1 || counts.primary_bottom >= 1)) {
    issues.push('a dress cannot be combined with a primary_top/primary_bottom — choose separates or a dress')
  }
  // A layer must have a primary (or dress) to layer with — distinguishes intentional layering from a stray second piece.
  if (counts.layer_top >= 1 && counts.primary_top < 1 && counts.dress < 1) issues.push('layer_top has no primary_top or dress to layer with')
  if (counts.layer_bottom >= 1 && counts.primary_bottom < 1 && counts.dress < 1) issues.push('layer_bottom has no primary_bottom or dress to layer with')
  return issues
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
        location: { type: "string", description: "City/place if a real destination is known (e.g. a trip). When set, weather is resolved from a live forecast for that place instead of the text-heuristic fallback — pass it whenever a concrete location is established in the conversation." },
        activity: { type: "string", enum: ACTIVITY_VALUES, description: "Established activity (walking/hiking). With occasion, flags pieces by profile-rule fit; pass it whenever known." },
        visual: { type: "boolean", description: "When true, attach low-detail thumbnails for the top ranked matches so you can judge color, texture, print, and proportion by sight. Use before proposing or refining outfits; leave false for quick text lookups." },
        intent: { type: "string", enum: ["compose", "explain"], description: "Default 'compose': pieces that are prohibited for the given occasion/activity are filtered OUT of results, so you compose only from wearable pieces (no need to self-reject anything). Set 'explain' ONLY when the user is asking ABOUT a constraint rather than for outfit material (e.g. 'why can't I wear heels hiking', 'what's wrong with these shoes here') — then prohibited pieces ARE returned, each with its ruleFitLabel, so you can show and explain them." }
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
    name: "propose_outfit",
    description: "Propose (or show/render) a structured outfit from verified wardrobe pieces, rendered as a card. Call 'search_wardrobe' first to get real piece IDs, then pass those IDs here — never names, never prose outfit sections. Call once per outfit; write conversational prose (intro, transitions, follow-up questions) around the call, but put the outfit's actual pieces in this tool, not in text.",
    input_schema: {
      type: "object",
      properties: {
        pieces: {
          type: "array",
          description: "The outfit's pieces, each a verified wardrobe piece ID plus its structural role.",
          items: {
            type: "object",
            properties: {
              id: { type: "integer", description: "Wardrobe piece ID from search_wardrobe." },
              role: { type: "string", enum: OUTFIT_ROLES, description: "Structural role. Core = primary_top + primary_bottom, OR a single dress. Use layer_top/layer_bottom for INTENTIONAL layering (e.g. a base layer under a sheer top, shorts under a skirt) — not a second competing top/bottom. outerwear/accessory are add-ons. Exactly one shoes, at most one of each primary slot." }
            },
            required: ["id", "role"]
          }
        },
        label: { type: "string", description: "Creative outfit title." },
        occasion_context: { type: "string", description: "The occasion / vibe / style lane this outfit is for." },
        why_it_works: { type: "string", description: "Brief styling rationale." },
        missing_gaps: { type: "array", items: { type: "string" }, description: "Slots the wardrobe can't fill (e.g. 'lightweight rain shell'). List the gap here instead of inventing a piece." },
        occasion: { type: "string", enum: OCCASION_VALUES, description: "Occasion for card context. Optional." },
        season: { type: "string", description: "Season/weather context. Optional." }
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
        const { query, category, color, occasion, pattern_type, silhouette, fabric_weight, fabric_category, neckline, weather: weatherText, activity, visual, intent, location } = args
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
        let gateExcludedCount = 0
        if (toolContext && toolContext.allowedPieceIds) {
          const allowedSet = toolContext.allowedPieceIds instanceof Set 
            ? toolContext.allowedPieceIds 
            : new Set(Array.isArray(toolContext.allowedPieceIds) ? toolContext.allowedPieceIds.map(Number) : [])
          
          const beforeFilterLength = filtered.length
          filtered = filtered.filter(p => allowedSet.has(Number(p.id)))
          excludedCount = beforeFilterLength - filtered.length
        }
        
        let results = filtered
        // Spec 4: live weather when a real location is known (this call's arg or carried over on
        // toolContext from earlier in the turn); resilient fallback to the text heuristic otherwise —
        // profileRuleFit/weatherFitForPiece consume the same {isHot, isCold} shape either way.
        const resolvedWeather = await getCurrentWeatherProfile({
          date: toolContext.currentDate ? new Date(toolContext.currentDate) : new Date(),
          location: location || toolContext.location || '',
          mood: toolContext.mood || '',
          season: weatherText || toolContext.weather || toolContext.season || ''
        })
        setFreeformWeatherSource(toolContext, resolvedWeather.weatherSource)
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
          // Resolve the register ceiling once per call (matching the composer), then let profileRuleFit
          // apply the footwear-enum + register gates per piece. Passing activityProfile/registerCeiling
          // switches profileRuleFit into enum-gate mode for this consumer.
          const registerCeiling = resolveRegisterCeiling({
            occasion: resolvedOccasion,
            activity: resolvedActivity,
            mood: toolContext.mood || '',
            request: toolContext.request || toolContext.mission || '',
            question: query || '',
            occasionProfile,
            activityProfile
          })
          const tierRank = { preferred: 0, neutral: 1, discouraged: 2, prohibited: 3 }
          results = results
            .map(p => {
              const fit = profileRuleFit(p, mergedRules, { weatherProfile: resolvedWeather, occasionProfile, activityProfile, registerCeiling })
              return { ...p, ruleFit: fit.tier, ruleFitLabel: fit.label }
            })
            .sort((a, b) => (tierRank[a.ruleFit] ?? 1) - (tierRank[b.ruleFit] ?? 1))

          // Compose mode (default): exclude prohibited-tier pieces entirely so the model composes
          // only from wearable pieces (matching the composer roster's discipline). Explain mode keeps
          // them, annotated, because showing-and-explaining the constraint is the point of that query.
          // discouraged/unknown stay in both modes — legitimate judgment calls, not hard exclusions.
          if (intent !== 'explain') {
            const beforeGate = results.length
            results = results.filter(p => p.ruleFit !== 'prohibited')
            gateExcludedCount = beforeGate - results.length
          }
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

        if (gateExcludedCount > 0) {
          resultList.push({
            note: `(${gateExcludedCount} piece(s) filtered out as prohibited for this occasion/activity; re-query with intent:'explain' to see and discuss them)`
          })
        }

        bumpFreeformDiagnostic(toolContext, 'searchCalls')
        if (gateExcludedCount > 0) bumpFreeformDiagnostic(toolContext, 'gateExcludedTotal', gateExcludedCount)

        // Spec 3 Part 0b: a free-text named-garment query that returned nothing is a known-false claim
        // waiting to happen — track it so the final answer can be checked for describing it as real.
        if (query && !results.length && toolContext) {
          if (!Array.isArray(toolContext.zeroResultQueries)) toolContext.zeroResultQueries = []
          toolContext.zeroResultQueries.push(String(query))
        }

        return resultList
      }
      case 'propose_outfit': {
        const { pieces = [], label = '', occasion_context = '', why_it_works = '', missing_gaps = [], occasion, season } = args
        const rawPieces = Array.isArray(pieces) ? pieces : []
        if (!rawPieces.length) {
          return { status: "validation_error", message: "propose_outfit needs at least one piece, each with an id and a role.", issues: ["no pieces provided"] }
        }

        // Resolve each {id, role} to a verified active wardrobe piece (IDs, not names — the model has
        // real IDs from search_wardrobe, so there is no name-matching seam to fall into).
        const resolved = []
        const unresolvedIds = []
        for (const entry of rawPieces) {
          const id = Number(entry?.id)
          const role = String(entry?.role || '').trim()
          if (!Number.isFinite(id)) { unresolvedIds.push(entry?.id ?? null); continue }
          const row = db.prepare("SELECT * FROM pieces WHERE id = ? AND status = 'active'").get(id)
          if (!row) { unresolvedIds.push(id); continue }
          resolved.push({ ...parsePiece(row), role })
        }
        if (unresolvedIds.length) {
          return {
            status: "error",
            message: "One or more piece IDs did not resolve to an active wardrobe item. Re-check via search_wardrobe before proposing.",
            unresolvedIds
          }
        }

        // Validate role/slot structure (mechanically enforced — replaces the prompt's layering rules).
        const issues = validateOutfitRoles(resolved)
        if (issues.length) {
          // Spec 3 Part 1: a failed validation must be visible, not silently dropped/retried — push a
          // broken diagnostic card (same "needs review" treatment as the composer's rejected proposals)
          // so the attempt is inspectable in chat, alongside returning the error to the model to retry.
          const brokenOutfit = {
            label: label || 'Outfit',
            broken: true,
            rejectionReason: issues.join('; '),
            pieceIds: resolved.map(p => Number(p.id)),
            pieces: resolved,
            previewOnly: true
          }
          const existingBroken = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []
          toolContext.generatedOutfits = [...existingBroken, brokenOutfit]
          bumpFreeformDiagnostic(toolContext, 'proposeValidationFails')
          return {
            status: "validation_error",
            message: `The proposed outfit has an unresolved structure: ${issues.join('; ')}. Fix the roles and call propose_outfit again.`,
            issues
          }
        }

        const resolvedOccasion = occasion ? normalizeOccasion(occasion) : (toolContext.occasion || 'casual')
        const resolvedSeason = season || toolContext.season || 'current season'
        toolContext.source = 'proposed_outfit'
        toolContext.occasion = resolvedOccasion
        toolContext.season = resolvedSeason
        const proposedOutfit = {
          label: label || 'Outfit',
          occasion: resolvedOccasion,
          season: resolvedSeason,
          occasionContext: occasion_context || '',
          why: why_it_works || '',
          reason: why_it_works || '',
          pieceIds: resolved.map(p => Number(p.id)),
          pieces: resolved,
          missingPieces: Array.isArray(missing_gaps) ? missing_gaps.filter(Boolean).map(String) : [],
          source: 'proposed',
          previewOnly: true
        }
        const existingOutfits = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []
        toolContext.generatedOutfits = [...existingOutfits, proposedOutfit]
        bumpFreeformDiagnostic(toolContext, 'proposeCalls')
        return {
          status: "success",
          message: `Proposed "${label || 'Outfit'}" as a card with ${resolved.length} pieces${proposedOutfit.missingPieces.length ? ` and ${proposedOutfit.missingPieces.length} wardrobe gap(s)` : ''}.`,
          pieceNames: resolved.map(p => p.name)
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
        const { generateOutfitsForPieceInternal, generateWholeWardrobeOutfitsVisualInternal } = await import('../routes/ai.js')
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
          result = await generateWholeWardrobeOutfitsVisualInternal({
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
