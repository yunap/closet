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

export function installMockAiHandler(db) {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    const systemPrompt = String(system || '')
    const latestMessage = Array.isArray(messages) ? messages.at(-1) : null
    const latestText = Array.isArray(latestMessage?.content)
      ? latestMessage.content.map(part => part?.text || '').join('\n')
      : String(latestMessage?.content || '')

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
