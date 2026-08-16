// Canned stylist responses for WARDROBE_MOCK_AI sandbox mode (see provider.js
// mockAiEnabled/takeTestAiResponse). Dispatches on distinctive substrings of
// the system prompt, mirroring test/aiEndpointContracts.test.js's mockAiHandler,
// but pulls real pieces from the live db so outfit cards resolve to actual
// wardrobe photos instead of test-fixture ids.

function samplePieces(db, count) {
  try {
    return db.prepare(
      "SELECT id, name, category FROM pieces WHERE status != 'removed' ORDER BY RANDOM() LIMIT ?"
    ).all(count)
  } catch {
    return []
  }
}

function sampleOnePerCategory(db, categories) {
  const rows = []
  for (const category of categories) {
    try {
      const row = db.prepare(
        "SELECT id, name, category FROM pieces WHERE category = ? AND status != 'removed' ORDER BY RANDOM() LIMIT 1"
      ).get(category)
      if (row) rows.push(row)
    } catch {
      // ignore
    }
  }
  return rows
}

function buildMockOutfit(db, overrides = {}) {
  let pieces = sampleOnePerCategory(db, ['top', 'bottom', 'shoes'])
  if (pieces.length < 2) pieces = samplePieces(db, 3)
  return {
    label: 'Mock sandbox outfit',
    strength: 'signature',
    dominantDirection: 'clean tonal column',
    silhouette: 'structured top over grounded lower line',
    bestFor: 'everyday',
    pieceIds: pieces.map(p => p.id),
    pieces: pieces.map(p => ({ id: p.id, name: p.name, category: p.category })),
    reason: 'Mock sandbox reasoning — WARDROBE_MOCK_AI is on, no billed AI call was made.',
    watchFor: 'This is a canned sandbox response, not a real styling opinion.',
    ...overrides
  }
}

function mockCritique() {
  return {
    summary: 'Mock sandbox evaluation (WARDROBE_MOCK_AI is on).',
    inferredIntent: { label: 'everyday styling', successCriteria: ['clear proportions'] },
    visibleFacts: {
      floorLine: 'shoes are visible',
      fitPlacement: 'garments sit naturally',
      proportionRead: 'mock proportion read',
      shoeAnalysis: { visibility: 'visible/readable', read: 'mock shoe read', confidence: 'high' }
    },
    evaluation: {
      summary: 'Mock sandbox evaluation.',
      verdict: 'keep',
      tensionType: 'productive',
      maintenanceBurden: 'low',
      scores: { tensionQuality: 4, silhouetteIntegrity: 4 },
      roles: { heroPiece: 'mock hero piece', supportPieces: ['mock support piece'], groundingPiece: 'mock grounding piece' },
      ideaViability: 'keep',
      executionGap: 'none — this is a canned sandbox response',
      mainSuccess: 'Mock evaluation only; no real AI call was made.',
      firstVisibleIssue: 'No real issue — sandbox mock.'
    },
    works: ['mock: garment placement reads cleanly'],
    risks: [],
    recommendation: { smallestAdjustment: 'None needed — this is a mock response.', avoidForNow: 'N/A' },
    critiqueProse: 'Mock sandbox critique: WARDROBE_MOCK_AI is on, so this text is canned rather than a real styling opinion.'
  }
}

function mockTaggerResult() {
  // Deliberately gives structural fields different values than any typical existing piece
  // (fit_on_body/silhouette/length_hits_at etc.) so a re-tag against the mock reliably produces
  // a real, non-zero diff — useful for exercising the "AI updated N details" vs. "no new details"
  // toast path in PieceForm.jsx, which had no mock coverage before this branch existed.
  return {
    name_suggestion: 'mock sandbox tagged item',
    notes_suggestion: 'Mock sandbox tagger output — WARDROBE_MOCK_AI is on, no billed AI call was made.',
    category: 'top',
    background_color: 'sage',
    colors: ['sage', 'cream'],
    occasions: ['casual', 'city'],
    season: 'year-round',
    pattern_type: 'solid',
    pattern_scale: 'none',
    pattern_complexity: 'solid',
    reads_as: 'clean mock sandbox top',
    hem_finish: 'straight_loose',
    neckline: 'crew',
    sleeve_length: 'short',
    sleeve_shape: 'straight',
    length_hits_at: 'hip',
    silhouette: 'relaxed',
    fabric_category: 'jersey',
    fabric_weight: 'light',
    stretch: 'moderate',
    fit_on_body: 'skims',
    fiber_content: ['cotton'],
    formality: 'everyday',
    opacity: 'opaque',
    needs_base: null,
    style_profile_json: {
      style_lanes: { artistic_minimal: 0, modern_bohemian: 0, folk_artisan: 0, boho_romantic: 0, boho_festival: 0, graphic_casual: 2, earthy_structured: 0, polished_classic: 2, romantic_soft: 0, workwear_utilitarian: 0 },
      visual_roles: ['support_piece'],
      coverage: 'normal',
      bareness: 'normal',
      style_notes: { best_use: 'mock sandbox support piece', risk: 'reads plain without a texture partner' },
      garment_intelligence: {
        auto_use_trust: 'trusted',
        best_outfit_role: 'support',
        pairing_requirements: ['needs a textured or patterned partner piece'],
        failure_risks: ['may pill with heavy wear'],
        occasion_confidence: { casual: 'high', city: 'medium', evening: 'low', 'smart-casual': 'medium', outdoor: 'low', home: 'low' },
        formula_compatibility: ['compact top + patterned bottom'],
        real_wear_notes: { fit: 'skims through the body', drape: 'light, moves with the body', scale: 'compact', placement: 'sits at hip', maintenance: '' },
        do_not_pair_rules: ['avoid another loud pattern']
      },
      _confidence: {
        category: 'high', colors: 'high', background_color: 'high', pattern_type: 'high', pattern_scale: 'high', pattern_complexity: 'high', reads_as: 'high', neckline: 'high', sleeve_length: 'high', sleeve_shape: 'high', length_hits_at: 'medium', silhouette: 'medium', hem_finish: 'high', fabric_category: 'high', fabric_weight: 'medium', fiber_content: 'low', formality: 'medium', fit_on_body: 'low', stretch: 'medium', opacity: 'high', accessory_subtype: 'high', bottom_subtype: 'high', jewelry_type: 'high', necklace_length: 'high', shoe_type: 'high', toe_shape: 'high', heel_height: 'high', walk_support: 'high', tuck_behavior: 'high', waistband_type: 'high', visual_weight: 'high', needs_base: 'low'
      },
      photo_properties: {
        'HANGER PHOTO': { fit_visible: false, real_context: false, notes: 'Mock sandbox hanger read — flat garment shot.' }
      }
    }
  }
}

export function installMockAiHandler(db) {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    const systemPrompt = String(system || '')
    const latestMessage = Array.isArray(messages) ? messages.at(-1) : null
    const latestText = Array.isArray(latestMessage?.content)
      ? latestMessage.content.map(part => part?.text || '').join('\n')
      : String(latestMessage?.content || '')

    if (systemPrompt.includes('You tag wardrobe items')) {
      return mockTaggerResult()
    }

    if (systemPrompt.includes('visual support-piece critic')) {
      const rows = samplePieces(db, 4)
      return { rankedPieceIds: rows.map(r => r.id), rejectedPieceIds: [], visualLearning: 'Mock sandbox visual pass.' }
    }

    if (systemPrompt.includes('visual wardrobe critic')) {
      return { rankedCandidateIds: ['cand-1', 'cand-2', 'cand-3'], rejectedCandidateIds: [], visualLearning: 'Mock sandbox whole-wardrobe visual pass.' }
    }

    if (systemPrompt.includes('visual editorial stylist')) {
      return {
        directions: [{
          title: 'Mock editorial direction',
          missingPieces: ['tailored trench', 'block-heel boot'],
          reason: 'Mock sandbox reasoning — no billed call was made.',
          watchFor: 'Grounding watch.',
          visualPrompt: 'Neutral studio mood board.'
        }]
      }
    }

    if (systemPrompt.includes('FREEFORM_STYLIST_USE_CASE_PLANNER')) {
      return { shouldCompose: false, reason: 'Mock sandbox: conversational follow-up does not require new structured cards.', slots: [] }
    }

    if (systemPrompt.includes('constrained feedback-memory editor')) {
      let evidence = []
      try { evidence = JSON.parse(latestText || '{}').evidence || [] } catch { evidence = [] }
      return {
        results: evidence.map(item => {
          const positive = item.evidenceKind === 'positive_outfit_logic'
          const positiveEnough = positive && ['signature', 'works'].includes(item.verdict)
          const context = item.context || {}
          const logic = item.logic || {}
          const logicText = [logic.formula, logic.silhouette, logic.direction, logic.mood].filter(Boolean).join('; ')
          return {
            source_feedback_ids: [Number(item.evidenceId)],
            disposition: positiveEnough ? 'personal_contextual_lesson' : (item.ownerReason ? 'general_styling_failure' : 'insufficient_evidence'),
            title: positiveEnough ? 'Mock transferable outfit lesson' : (item.ownerReason ? 'Mock reviewed styling issue' : 'No safe lesson proposed'),
            proposed_text: positiveEnough
              ? `Reuse this styling logic with different garments: ${logicText}`
              : (item.ownerReason ? `Review the stated issue: ${String(item.ownerReason).slice(0, 240)}` : ''),
            boundary: positiveEnough ? 'Mock sandbox context boundary.' : (item.ownerReason
              ? 'Mock sandbox classification only; this is not an owner preference.'
              : 'No sufficient evidence was supplied.'),
            rationale: 'Canned sandbox synthesis — no billed AI call was made.',
            confidence: positiveEnough ? 'bounded_context' : (item.ownerReason ? 'explicit_owner' : 'insufficient'),
            related_draft_id: 0,
            applicability: {
              scope: 'context',
              piece_ids: [],
              occasions: context.occasion ? [context.occasion] : [],
              activities: context.activity && context.activity !== 'none' ? [context.activity] : [],
              seasons: context.season ? [context.season] : [],
              weather_terms: [],
            },
          }
        }),
      }
    }

    if (
      systemPrompt.includes('Outfit Composer') ||
      systemPrompt.includes('Outfit Gate') ||
      systemPrompt.includes('personal visual stylist agent') ||
      systemPrompt.includes('whole-wardrobe outfit composer') ||
      systemPrompt.includes('personal stylist. You are looking at photos')
    ) {
      return {
        outfits: [buildMockOutfit(db)],
        rejected: [],
        skip: '',
        saveableLearning: 'Mock sandbox learning.'
      }
    }

    if (systemPrompt.includes('evaluating one proposed whole-wardrobe outfit')) {
      if (/Response mode:\s*followup/i.test(latestText)) {
        return { answer: 'Mock sandbox follow-up answer (WARDROBE_MOCK_AI is on, no billed AI call was made).' }
      }
      return mockCritique()
    }

    return 'Mock sandbox stylist answer — WARDROBE_MOCK_AI is on, no billed AI call was made.'
  }
}
