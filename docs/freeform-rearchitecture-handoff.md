# Handoff — freeform stylist chat re-architecture ("router → stylist")

For any assistant (or human) continuing this effort. Written 2026-07-12, mid-way
through live testing. The architecture rationale and migration plan live in
[docs/flows/freeform-stylist-chat.md](flows/freeform-stylist-chat.md) (the
"Proposed architecture" section); this file is the operational state.

## Mission

Make `/api/ai/ask` a real user↔LLM stylist conversation that generalizes to
unanticipated questions. Inversion: **the model owns the conversation;
deterministic code guarantees only garment truth and output form.** Gates live
in the data layer; guards are one turn-contract validator; intent is declared,
not keyword-guessed.

## What has shipped (all merged)

| PR | What |
|----|------|
| #37 | Step 1 — wardrobe manifest in the prompt (all active pieces, compact truth lines, `?` low-confidence markers, `[flags]` trust limits) + structured THREAD STATE (persisted per session, restored on follow-ups; body wins, state fills gaps) |
| #38 | Step 3 — retrieval rule: pieces must be verified this turn (`retrievedPieceIds`/`visuallySeenPieceIds` on toolContext); layer_top/layer_bottom must be visually SEEN; prose ID-citation guard; test-mode short-circuit now mirrors real guard retries |
| #39 | Step 4 — `declare_intent` tool (want: text/cards/image + outfit_count); composing tools blocked until cards declared; guards consume the declaration, phrasing regexes demoted to undeclared-turn fallbacks |
| #40 | Step 5 — one turn-contract validator, three clauses in precedence order: truth → context (legacy travel clarifications, explicit retire-candidates) → delivery (`cardsNotDelivered`, count, prose backstop); Set-based single retry budget |
| #41 | Step 2 (pulled forward — the rails were too expensive to follow) — `view_pieces` (batch 448px thumbs + manifest truth lines; records retrieved AND seen), `render_preview` (in-chat render via conditional GPT-4o/collage; `imageNotDelivered` clause), `wardrobe_coverage` (exact counts), `opacity` truth field (tagger→db→manifest/truth/search) |
| #42 | Prompt caching — system reordered (constitution + profiles + manifest = stable prefix, `PROMPT_CACHE_BREAKPOINT`, volatile tail); Anthropic path splits into blocks with cache_control. Stable prefix ≈18.2k of ≈28.6k tokens. **Keep the stable prefix byte-stable.** |
| #43 | opacity was dropped by the piece form — form state, both retag paths, edit-card chip row, BatchAdd. See the "new tag field checklist" below |
| #44 | Memory pollution fix — the pre-model auto-save (stored raw questions as absolute-precedence preferences; 11 dupes of "…polished outfit ideas…" steered styling) REMOVED; `store_user_correction` tool is the only save path, deduped. Anchor bypass: `propose_outfit` pieces accept `anchor:true` for user-requested pieces (skips suitability gates; supports stay gated). Live db junk archived (reversible), crochet note refiled piece-scoped (piece 132) |
| #47 | Hot-weather gate false positive — ANY medium pants counted "insulating"; now composer parity (full-insulating coverage only). Gate rejection message teaches the `anchor:true` recovery |

## Remaining work

- **Step 6 — the planning engine** (resolved by design, PR #54/#56/#57; see the
  flow doc's "Step 6 resolution"): precompose's trip planner generalizes into a
  model-called `plan_outfit_set` tool instead of being demoted wholesale.
  Build steps 1–3 SHIPPED: the trip-slot engine lives in
  `styling-engine/outfitSetPlanner.js` (`composeOutfitSet`, now async), the
  `plan_outfit_set` tool composes multi-slot sets (source `plan_outfit_set`,
  source-locked, plan lines), and per-slot live weather is wired — each slot
  resolves its own forecast via `getWeatherProfileForPlan` from `slot.location`
  + `slot.date` or the plan `date_range` (tool schema gained per-slot
  `location`/`date` and plan-level `location`/`date_range`); user-stated per-slot
  `weather` wins over the forecast; a live forecast is authoritative in
  `tripSlotFitScore` (an inherited hot season text can't re-inject heat into a
  cool coast slot — the #56 microclimate fix); plan lines carry a
  `Weather used: <slot> — <label>` line. Remaining: the reuse dial +
  per-category repeat rules, objective-driven plan reports, prompt
  decomposition guidance, parallel-path diagnostics, keyword pre-route
  retirement (evidence-gated).
- **Retire the context clauses** (tripScope/destination in
  `applyFreeformOutputChecks`) when live evidence shows thread-state-informed
  judgment holds. The code history is explicit that prompt guidance alone
  failed before — require evidence, not vibes.
- **Volatile prompt tail** (~10.4k tokens: feedback memory, controller text) is
  a future cache/size optimization candidate.
- Known pre-existing failure: `npm test`'s text-matching ratchet fails on two
  inherited lines (core.js 61/60 from 247031c; rules.js from #36). A task chip
  exists for annotate-vs-refactor. **Any new code must stay ratchet-net-zero**
  (no new `.test(`/`.includes(` on the flagged variable names in
  styling-engine/* or routes/*; `// ratchet-allow: <reason>` for legitimate
  non-garment string uses).

## Live-testing findings so far (why each fix exists)

1. Crochet top proposed as base layer → tags had no opacity; sight was optional
   → steps 2+3 (opacity field, layer visual gate, view_pieces).
2. "Generate a rough preview" answered with prose → no image tool → render_preview.
3. Results thin after steps 3–5 → verification was expensive (full-size photos)
   → view_pieces (cheap thumbs).
4. Casual cargo pants styled "polished"/elevated → memory pollution (see #44).
5. "Style these pants" → zero ideas → gates rejected the asked-about piece →
   anchor rule (#44) + hot-weather overblock fix (#47).

## High-leverage test scenarios (run in this order)

Before testing: retag piece 132 (crochet) so `opacity` populates; optionally
retag 353 (cargo pants — `length_hits_at` is mis-tagged mid-thigh). After each
turn, capture a screenshot AND expand "Search & validation details" — the
freeformDiagnostics counters (`intentDeclared`, `viewCalls`, `renderCalls`,
`proposeUnverifiedPieceBlocks`, `proposeUnseenLayerBlocks`,
`unverifiedCitationBlocks`, `cardsNotDeliveredBlocks`,
`composeWithoutDeclaredIntent`) are the evidence.

1. **Crochet regression (founding incident):** "Can we add a top as a base
   layer under the olive silk blouse? Use my wardrobe." → must NOT pick the
   crochet top; expect viewCalls ≥ 1 (photos checked before layering).
2. **Cargo pants two-turner (fresh fixes):** exact repeat of the screenshot
   conversation → turn 1 fit-concern prose; turn 2 real cards KEEPING the
   pants, register-coherent supports, no insulating rejection.
3. **Coverage generalization:** "What pieces am I missing to create a boho
   outfit?" → manifest/coverage reasoning, owned IDs cited, honest gaps; few or
   zero searches needed.
4. **Preview end-to-end (original incident):** after any cards turn: "show me a
   rough preview of the second one" → declare image → render_preview → image in
   chat (renderCalls = 1), positional resolution via THREAD STATE.
5. **Regex-proof intent:** "you know what I need for Saturday's gallery — three
   of them" → declared cards with outfit_count 3 → exactly 3 cards or an honest
   gap explanation (no phrasing keywords for the old regexes to catch).
6. **Cross-turn state:** turn 1 "hot day in the city" cards; turn 2 just "swap
   the shoes on #2" → context retained server-side, right outfit updated.
7. **Memory hygiene:** state a real preference ("no ankle boots in summer") →
   ONE deduped store_user_correction save; a later turn respects it; no raw
   questions accumulating in stylist_feedback.

Interpretation: blocks-counters firing occasionally = rails working; firing on
every turn = rails too expensive or prompt unclear (find which counter).
Scenarios 3–5 passing is the generalization proof; 1–2 are regressions of known
bugs and must pass.

## Gotchas for the next assistant

- **Branch off fresh main before every piece of work** (recurring slip: twice a
  new family/step was committed onto the previous branch).
- **User conventions:** they merge PRs to view them; they may have uncommitted
  feature work in the tree — commit it as THEIR feature branch/PR first
  (precedent: #25, #36), never mix with yours. Rebuild `dist/` with frontend
  changes (repo convention commits it).
- **New tagged garment field = 9 wiring points** (tagger prompts ×2, db column,
  crud ×2, taggerMerge CONFIDENCE_FIELDS, PieceForm state + both retag paths +
  UI, BatchAdd ×2, truth surfaces, dist). The form silently drops unknown fields.
- **Test harness:** `globalThis.__WARDROBE_AI_TEST_HANDLER__` receives the
  marker-stripped system prompt; `PHOTO_PRESERVING_VISUALS=true` in tests makes
  renders local collages; direct compose tests need
  `declaredIntent: { want: 'cards' }` and `retrievedPieceIds` in toolContext.
- **Gate history:** before calling any missing/loose gate a bug, check whether
  it was a deliberate decision (the app has a long hard-gate-vs-LLM-judgment
  history). The owner's live ruling wins (e.g. #47).
- **`docs/flows/`** is the model-facing flow atlas (all 16 flows diagrammed);
  keep the freeform doc's status note current as steps land.
