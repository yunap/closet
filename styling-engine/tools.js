import path from 'path'
import fs from 'fs'
import { db, uploadsDir, safeJsonParse } from '../db.js'
import { parsePiece, buildPieceText } from './rules.js'
import { prepareImageForClaude } from './provider.js'

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
        fabric_category: { type: "string", description: "Filter by fabric category, e.g. jersey, knit, linen, silk, satin, cotton, wool, denim, ponte, synthetic, fleece, other" },
        neckline: { type: "string", description: "Filter by neckline style, e.g. V, scoop, crew, boat, mock, cowl, off-shoulder, square, wrap, other, none" }
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
  }
]

export async function executeTool(name, args) {
  console.log(`\n🤖 [Agent Tool Call] ${name} (${JSON.stringify(args)})`)
  try {
    switch (name) {
      case 'search_wardrobe': {
        const { query, category, color, occasion, pattern_type, silhouette, fabric_weight, fabric_category, neckline } = args
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
        if (occasion) {
          const oLower = occasion.toLowerCase()
          filtered = filtered.filter(p => p.occasions.some(o => o.toLowerCase().includes(oLower)))
        }
        if (query) {
          const qLower = query.toLowerCase()
          filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(qLower) || 
            (p.notes && p.notes.toLowerCase().includes(qLower))
          )
        }
        
        console.log(`🔍 [Agent Tool Call] search_wardrobe returned ${filtered.length} items.`)
        return filtered.map(p => ({
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
          notes: p.notes ? p.notes.slice(0, 120) : ''
        }))
      }
      case 'get_garment_details': {
        const { ids } = args
        if (!Array.isArray(ids) || !ids.length) return []
        const placeholders = ids.map(() => '?').join(',')
        const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${placeholders})`).all(...ids.map(Number)).map(parsePiece)
        
        const details = []
        for (const p of rows) {
          let imageData = null
          const photoFile = p.worn_photo || p.photo || ''
          if (photoFile) {
            const filePath = path.join(uploadsDir, photoFile)
            if (fs.existsSync(filePath)) {
              try {
                console.log(`📸 [Agent Vision] Resizing reference photo for piece ${p.id} (${photoFile})`)
                imageData = await prepareImageForClaude(filePath)
              } catch (err) {
                console.error(`Error loading photo for piece ${p.id}:`, err)
              }
            }
          }
          details.push({
            id: p.id,
            name: p.name,
            text: buildPieceText(p),
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
