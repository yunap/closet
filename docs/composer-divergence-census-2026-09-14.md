# Composer divergence census (M0, part 1: static)

**Status:** active — static census of the working tree on 2026-09-14, for [unified-composer-design.md](unified-composer-design.md) §0. Research evidence only: no ruling, no code change, no provider call.

**Method and limits.**
- Read from code and flow docs, with a citation for every cell. Line numbers are for this working tree and will drift.
- Cells marked **verify in capture** are inferred from docs or a partial read. The M0 capture harness (not built yet) replaces this table's claims with byte-level extracts from stub-provider requests for one fixed intent.
- Per the framework, card count, the output card array, the token cap and orchestration are **declared differences**: listed here for completeness, not counted as divergence.
- Trip-wide packing, rotation and set-level coverage are plan inputs, outside per-card equivalence.

## Entry points in scope

| # | Entry point | Composer call |
|---|---|---|
| E1 | Whole Wardrobe, `POST /generate-wardrobe-outfits-visual` (`routes/ai.js:4207`) | `generateWholeWardrobeOutfitsVisualInternal` (`routes/ai.js:2462`), one N-card call (`routes/ai.js:3033`) |
| E2 | `/ask` `bounded_multi`, tool `generate_outfits` (`styling-engine/tools.js:4180`) | the same internal function (`styling-engine/tools.js:4343`), or the selected-piece composer when an anchor is present |
| E3 | `/ask` `single_outfit` tool loop (`routes/ai.js:6710`) | the general stylist with tools: `search_wardrobe` catalog, then `view_pieces`, then `propose_outfit` |
| E4 | Selected piece, `POST /generate-outfits-for-piece` (`routes/ai.js:2317`) | `generateOutfitsForPieceInternal` (`routes/ai.js:2058`), composer call at `routes/ai.js:1577` |
| E5 | Saved-outfit variants, `POST /generate-saved-outfit-variants` | the shared whole-wardrobe text composer (per `docs/flows/saved-outfit-variants.md`); **verify in capture** |
| E6 | Trip slot cards, `plan_outfit_set` (`styling-engine/tools.js:3338`) | `composeTripPlanOnce` (`routes/ai.js:5746`), one call for the whole rotation (`styling-engine/tools.js:3849`); tool-loop fallback uses `submit_plan_outfits` |
| E7 | Capsule cards, `plan_outfit_set` | `composeCapsulePlanOnce` (`routes/ai.js:5638`, `styling-engine/tools.js:3626`) |

## Invariant components: where they differ

### D1 · Roster source

| Path | Roster |
|---|---|
| E1, E2 | Deterministic: `evaluateVisualComposerPiecePool` into `buildVisualComposerRoster` (`styling-engine/eligibility.js:74`, `styling-engine/rules.js:2958`); image cap 90 per the flow doc |
| E3 | Model-chosen: the complete eligible catalog as text (`buildSingleOutfitStylistCatalog`, `styling-engine/tools.js:407`); the model picks 8–12 to view. Stage 1: search categories chosen by the model can drop dresses |
| E4 | Anchor plus about 32 pre-ranked supports, image cap 54 (flow doc); a vision ranking call runs before composition (`rankSelectedPieceCandidatesWithVision`, `routes/ai.js:2191`) |
| E5 | **verify in capture** |
| E6 | Trip roster: model-chosen when `modelTripRosterEnabled` (`routes/ai.js:5014`, `chooseTripRosterWithProvider` at `routes/ai.js:5522`), otherwise deterministic (**verify** which is live). The roster itself is a trip-plan decision, so it is outside per-card equivalence; the slot's evidence given that roster is not |
| E7 | Capsule roster: `selectCapsuleRoster` or `selectCapsuleRosterViaModel` (`styling-engine/outfitSetPlanner.js:2075`, `:3379`); plan-level, as E6 |

### D2 · Garment fact line

There are five distinct builders for the same garment:

| Builder | Used by | Content |
|---|---|---|
| `composerPieceLineSuffix` (`routes/ai.js:1241`), through `composerExperimentGarmentLine` production (`routes/ai.js:2875`) | E1, E2, E4 (`routes/ai.js:1547`, with an anchor/support label prefix) | B0 line: no length_hits_at, sleeve, silhouette, season, neckline, stretch, interior construction, pattern, colours, formality or fiber (cause matrix §8) |
| `singleOutfitStylistCatalogLine` (`styling-engine/tools.js:325`) | E3 catalog rows and `view_pieces` truth (`styling-engine/tools.js:2871`) | the complete field set (the B1 superset content) |
| `buildPieceText` (`styling-engine/rules.js:2017`) | E6, E7 atomic composition truth catalogs (`routes/ai.js`, in `composeTripPlanOnce` and `composeCapsulePlanOnce`) | the full truth text, including pairing requirements and do-not-pair rules |
| `planWorkbenchPieceLine` (`styling-engine/outfitSetPlanner.js:2619`) | E6 tool-loop fallback workbench | the compact line; the trip parity spec §3.2 records what it omits |
| repair line: `composerPieceLineSuffix` plus `sleeveFacts` (`routes/ai.js:3636`) | E1 layer-repair call | B0 plus sleeve facts |

`thermalFactsForPieceLine` (`styling-engine/rules.js:222`) is attached in E3 search results (`styling-engine/tools.js:1873`) and in `planWorkbenchPieceLine`; **verify in capture** whether the composer line in E1 carries the same thermal facts.

**Audit hook (framework §3).** Before any builder becomes canonical, every whole-garment field above is checked for unsupported part-specific inference (the 238 `weight: medium` case).

### D3 · Photographs

| Path | Policy |
|---|---|
| E1, E2 | Worn photo first (`p.worn_photo \|\| p.photo`); size and detail from `pieceVisualDetailPolicy`. E2 passes `adaptiveVisualDetail: true` for bounded multi-look (`allowLow`), so the same garment can be sent at a lower detail than in E1 |
| E3 | Only the pieces the model chooses to view, through `view_pieces` |
| E4 | Worn first, a single composer thumbnail size and detail for the roster (`routes/ai.js:1540`–`1550`) |
| E6, E7 | Worn first, every roster piece unconditionally, `maxPx: 800` |

All model paths are worn first, while the Stylist Chat card shows the hanger first (cause matrix §2).

### D4 · Weather statement

| Path | Statement |
|---|---|
| E1 | `Temperature:` range with "each piece states its own `warmth:`; judge the outfit against the range" (`routes/ai.js:2974`), plus the outerwear heading "(ordered for these conditions)" unless neutral verdicts are on |
| E2 | Same as E1, but `resolvedWeatherProfile` is passed only for bounded multi-look (`styling-engine/tools.js:4351`); otherwise the route resolves weather itself — **verify in capture** |
| E3 | Cold endpoint only: "Outdoor conditions call for '<level>' total upper-body warmth with the outer layer on" (`styling-engine/tools.js:~453`). No warm-endpoint target is stated |
| E4 | Shared context authority `resolveStylingContext` (flow doc); wording **verify in capture** |
| E6 | Per-slot `Weather used:` line (`buildWeatherLine`, `styling-engine/outfitSetPlanner.js:261`); whether it reaches `composeTripPlanOnce` **verify in capture** |

No path states both endpoint targets in the warmth vocabulary together with a removable-layer configuration statement (framework §4).

### D5 · System prompt and guidance

| Path | System |
|---|---|
| E1, E2, E4 | `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` (E4 uses it through the selected-piece composer) |
| E3 | `stylistSystemTemplate`, the general ~5,000-word `/ask` system prompt, plus the single-outfit catalog instruction (`styling-engine/tools.js:~458`) |
| E6 | `tripPlanCompositionSystemPrompt` (tool-loop fallback: `stylistSystemTemplate` with `ATOMIC_TRIP_TOOL_LOOP_ONLY_INSTRUCTION`, `routes/ai.js:5739`) |
| E7 | `capsulePlanCompositionSystemPrompt` (`routes/ai.js:5582`) |
| E5 | E1's composer with `comparisonSetGuidance: false` in formula mode (flow doc) |

The neutral sleeve sentence is present on every path since the 2026-09-14 log-only change.

### D6 · Judging stages after composition

| Stage | E1 / E2 | E3 | E4 | E6 / E7 |
|---|---|---|---|---|
| Structural gate | `locallyGateWholeWardrobeOutfits` (`routes/ai.js:3371`), `evaluateWearableOutfit` with `requireShoes` only (`routes/ai.js:3105`) | `evaluateWearableOutfit` role-aware inside `propose_outfit` (`styling-engine/tools.js:2366`) | `evaluateWearableOutfit` (`routes/ai.js:1621`) | `validateSubmittedPlanOutfits` (`styling-engine/tools.js:3916`, `:4076`) |
| Weather evaluation | role-aware weather screen used by the repair (`routes/ai.js:3495`) | inside the gate; findings go back to the model | **verify in capture** | inside the plan validator (**verify** exact options) |
| Evaluator feedback to the model | none | yes: findings returned, model may resubmit | none | tool-loop fallback only |
| Backfill | local backfill (`routes/ai.js:3388`, `:3397`) | none | validated local direction, then basic backfill (flow doc); a comment at `routes/ai.js:2267` says basic backfill no longer feeds the response — **verify** | none (coverage-gap note instead) |
| Repair | layer repair model call (`routes/ai.js:3707`) | none found (**verify**) | comfort footwear repair (`routes/ai.js:1667`, `:2257`) | `repairTripColdLayerCards` (`styling-engine/tools.js:3930`) |
| Critic | clash critic `reviewComposedWholeWardrobeOutfitsForClash` (`routes/ai.js:3175`, `:3877`), given occasion, season and mood but no weather or construction evidence (`styling-engine/core.js:1421`) | none | pre-composition vision ranker only | none |

### D7 · Declared differences (not divergence)
- **Count:** E1/E2/E4/E5 N cards in one call; E3 one card; E6/E7 the whole rotation in one call.
- **Schema:** composer card array; `propose_outfit` arguments; plan composition schema (`capsulePlanCompositionSchema`, `routes/ai.js:4944`).
- **Orchestration:** single call; tool loop; plan-level call with the planner owning rotation.

## Summary of what closing M0 requires

1. **One roster rule per resolved intent** for E1–E5 (D1). E6/E7 rosters stay plan-level.
2. **One garment fact builder**, subject to the §3 truthfulness audit, replacing five (D2).
3. **One photo policy**, including the E2 detail exception (D3).
4. **One weather statement** stating both endpoint targets (D4).
5. **One composition system text per card**, with count and schema as declared fields (D5).
6. **The same gate, weather evaluation, repair eligibility, backfill disclosure and critic inputs on every path** (D6). Today no two path families share the same stage set.

**Next:** the stub-provider capture harness, to confirm every "verify" cell and replace this static table with request extracts.
