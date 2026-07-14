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
  `Weather used: <slot> — <label>` line. Build step 4 SHIPPED: shared
  `constraints` on the tool — a signed `reuse` dial (`maximize`/`diversify`/
  `none`), per-category `no_repeat`/`allow_repeat` (mapped to category groups,
  allow_repeat wins conflicts), and `shared_anchor_ids` (hard-pinned into
  candidate generation via `requiredPieceId`, soft-pinned in selection, and
  exempt from `no_repeat`); `normalizePlanConstraints` parses them. Build step 5
  SHIPPED: the plan report is objective-driven (`buildPlanReport`) — a
  `piece_budget` (new constraint) leads with the piece roster + combination
  count and flags over/under budget (capsule); a `diversify`/`no_repeat` plan
  leads with the repeat schedule ("every look is distinct" is the win);
  everything else keeps the packing-reuse headline. Build step 6 SHIPPED: the
  prompt now teaches the tool — a "Planning a Coordinated Multi-Outfit Set"
  bullet in `STYLIST_SYSTEM` tells the model to call `plan_outfit_set` on the
  initial planning turn (trip/work-week/event/capsule/around-a-piece),
  decompose into slots itself, set per-slot `location`/`date`, and choose
  `constraints` from the objective; the returned cards become the Current
  outfit set that `propose_outfit` revises. (Until this, the tool was live but
  unreachable — nothing in the prompt named it, which also blocked the step-8
  retirement evidence.) Build step 7 SHIPPED: parallel-path diagnostics —
  `recordPlanPathDiagnostics` (tools.js), called per /ask turn in routes/ai.js,
  records `planKeywordMatched` (regex fired), `planPrerouteComposed` (the
  pre-route actually seeded a set), `planModelCalled` (the model called
  `plan_outfit_set`), and a single `planPathOutcome`
  (`both`/`model_only`/`preroute_only`/`planning_uncomposed`/`not_planning`)
  into the debug block. Watch `planPathOutcome` in "Search & validation
  details": a steady stream of `model_only` on planning turns the regex missed
  is the retirement evidence. Follow-up hardening after live office-week tests
  also SHIPPED: model-called plans use generic `Outfit plan` / `Plan length`
  framing instead of trip copy; office/work/client/restaurant slots default to
  indoor weather when the model omits weather; and office/client slots now get a
  narrow register scorer that reads piece names and demotes garden-party,
  resort, lace, maxi/flowy, open-toe/wedge drift. Slot-register escalation
  SHIPPED (the contract's `slot.register`): a slot marked `dressy`/`formal`
  (`tripOutfitRegisterEscalationScore`) pushes away denim, casual jackets, tees,
  and sneakers and toward a dress/tailored separates + heels — the wedding-
  ceremony miss where the marquee slot composed in denim flares + a leather zip
  (the evening scorer credits any dark layer as "elevated" and never penalizes
  denim). The prompt teaches the model to escalate (rehearsal `dressy`, ceremony
  `formal`, brunch `elevated`) and to not `no_repeat` the category the marquee
  slot needs. Build step 8 SHIPPED: the broad-planning (non-travel) keyword
  pre-route is retired by default — `shouldEngageAskPrecompose` (routes/ai.js)
  lets work-week / capsule / event turns fall through to the model +
  `plan_outfit_set` instead of precomposing an unconstrained set (live evidence:
  those turns self-route `model_only`; the pre-route had been intercepting the
  capsule and dropping its budget/roster entirely). The TRAVEL pre-route is now
  retired too — COMPLETE: a real trip ("5 days in Paso Robles… wineries, a
  dinner, a hike, the coast") self-routed `model_only` with better decomposition
  than the pre-route ever produced (it made its own hiking slot and set a
  per-slot coastal location, resolving weather live from `location` so no stated
  forecast was needed). `shouldEngageAskPrecompose` now returns false for BOTH
  branches by default; `WARDROBE_PLAN_PREROUTE=on` (or legacy
  `WARDROBE_BROAD_PLAN_PREROUTE=on`) restores the whole precompose as a
  reversible fallback (the `aiEndpointContracts` trip-precompose test runs with
  the flag on to guard that path). The 8-step plan is DONE. Capsule builder
  SHIPPED: `piece_budget` is now ENFORCED, not just reported — a budget ≥ 6
  triggers `selectCapsuleRoster`, which curates ~budget versatile pieces with
  category coverage (separates-heavy: e.g. 5 tops + 4 bottoms + 1 dress for a
  14-piece; a summer capsule floats in shorts) and the slots compose ONLY from
  that roster, so the distinct-piece count lands within budget. Below the floor
  it stays a soft report. **Gotcha rescued:** #73 (this builder) merged into its
  stacked base `feat/casual-register-scorers` instead of retargeting to main and
  never reached main (same trap as #57→#58) — recovered by cherry-pick. Also a
  server-side safety net now infers `piece_budget` from an "N-piece capsule"
  question when the model omits it (it forgot on the 14-piece live test).
- **Retire the FOLLOW-UP replan pre-route — step 8's unfinished second half**
  (found in the 2026-07-13 architecture review, below).
  `maybePrecomposeStructuredFollowupForAsk` (routes/ai.js) runs
  unconditionally — it does NOT check `shouldEngageAskPrecompose` or the
  `WARDROBE_PLAN_PREROUTE` flag. On any turn the client classifies as
  `followup`, on a thread that already holds an outfit set, the app still
  front-runs the model: it calls `planFreeformUseCases` (the fragile
  JSON-scraping LLM planner step 6 was meant to retire) and composes an
  UNCONSTRAINED set via `composeOutfitSet` — no reuse dial, no constraints,
  none of `plan_outfit_set`'s intelligence. Because `classifyChatTurn`
  classifies nearly everything as `followup` once thread memory exists (the
  spec-10 ruling, deliberate), this sits on the highest-traffic path of any
  multi-turn conversation and can clobber a model-planned, constraint-carrying
  set with a constraint-free replan. The model already has what it needs to
  own these turns — `plan_outfit_set` seeds from the thread's current outfit
  set specifically so replans vary. Recommended play: same as step 8 —
  parallel diagnostics → live evidence → retire behind the same flag. (No
  recorded decision says this branch was deliberately kept; if it was, record
  that here instead.) **Diagnostics SHIPPED (evidence phase, like step-8 build
  7):** `recordPlanPathDiagnostics` now also records `followupEligible`,
  `followupPrerouteComposed`, and a `followupPathOutcome` (`classifyFollowupPath`)
  in the debug block — `preroute` (the replan front-ran the model) /
  `model_plan` / `model_propose` / `model_prose` / `''` (not a followup turn).
  Watch `followupPathOutcome` in "Search & validation details": a steady stream
  of `model_plan` / `model_propose` on followup turns where the pre-route
  abstained is the green light to retire it behind `WARDROBE_PLAN_PREROUTE`.
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

## Architecture review — 2026-07-13 (post step 8)

Full read-through of the shipped system against the plan, after the 8-step
build completed. Verdict: **the architecture is the designed one and the
inversion is real** — all five pillars verifiable in code, turn contract
matches the step-5 design exactly (truth → context → delivery, Set-based
per-clause retry budget, declaration authoritative), both keyword pre-routes
retired by default behind the reversible flag, `plan_outfit_set` carries the
full v1.1 contract. `node --test`: 485/485 pass. Findings, ranked:

1. **The follow-up replan pre-route was never retired** — promoted to the
   Remaining-work list above; the one meaningful architectural leftover.
2. **`npm test` is permanently red**: the ratchet gate fails on the inherited
   baseline overage (core.js 61 vs 60, rules.js 119 vs 116) BEFORE
   `node --test` ever runs, so the suite result is invisible to anyone running
   `npm test`. Verified 2026-07-13 that the overage is entirely pre-existing
   (no unannotated `.test(`/`.includes(` added to either file since the
   handoff commit — recent work stayed ratchet-net-zero). A permanently
   failing gate protects nothing; do the annotate-vs-rebaseline task chip.
3. **Dead ternary** in `/ask` (routes/ai.js ~3017):
   `source: activePrecompose ? 'whole_wardrobe' : 'whole_wardrobe'` — both
   branches identical, leftover from the source-lock work. Trivial cleanup.
4. **Where the ongoing cost now lives**: the correctness burden moved from
   routing regexes to `composeOutfitSet`'s scorers — #66–#72 are all
   whack-a-mole in that engine (double cardigans, beachy office looks, denim
   at ceremonies). Expected: it's now the only place deterministic code makes
   taste judgments. If the scorer patch rate doesn't taper, the
   evidence-gated future move is letting the model pick pieces per slot while
   the engine enforces only constraints (reuse, budget, gates). Watch the
   patch rate; don't act on vibes.
5. **Deletion candidates once evidence accumulates**: the context clauses and
   the flag-preserved legacy precompose machinery (`USE_CASE_PLANNER_SYSTEM`,
   `planFreeformUseCases`, both `maybePrecompose*` functions). Carrying dead
   layers indefinitely is where this codebase's orphan code came from (one
   such layer was already deleted once, 2026-07-09 reachability audit).

## Capsule builder — external review + plan (2026-07-14)

Sonnet (previous-arc author) sanity-checked the capsule against a four-point
framework. His mental model is the PRE-inversion *monolithic generator* — a
standalone optimizer that owns occasion decomposition and combination-counting.
Post-inversion the job is split: the MODEL decomposes into use-case slots; the
engine composes per slot from a curated roster (`selectCapsuleRoster`). With
that translation, the four points map to our actual code as:

1. **Reuse hard gates, don't reinvent — HELD.** Roster pieces still flow through
   the per-slot `filterWholeWardrobePiecesForGeneration` (real weather / register
   / activity gates). Only `capsuleVersatilityScore` carries its own
   summer-fabric weighting, and it's a soft RANK, not a gate — worth watching,
   not the "two detectors disagree" bug class.
2. **Per-occasion coverage with explicit gaps — PARTIAL.** Each slot IS a target
   occasion and structural validity is reused (`isOutfitStructurallyValid`), but
   we do NOT surface per-slot coverage gaps: a slot the roster can't fill just
   goes thin, no `[missing wardrobe gap: elevated top]`. **Gap (medium).**
3. **Combinatorics: valid = structural AND coherent — DIVERGES.** Our builder
   does NOT count or maximize valid combinations; `selectCapsuleRoster` is
   top-N-by-per-piece-versatility + category quotas — a PROXY for "pairs with
   many," not measured interconnection. His core insight (score a piece by how
   it interconnects with the *rest of the subset*) is exactly what we don't do.
   **Gap (biggest — the real "capsule-ness"). Matches review finding #4: watch
   the scorer patch rate before investing.**
4. **Selection: versatility / register-flex / NON-REDUNDANCY — DIRECT HIT.** We
   have versatility + register-flex proxies but ZERO redundancy avoidance, so
   naive top-N can pick three near-identical black tees. **Gap (quick, high
   value).**

The swap-and-optimize "dropped a load-bearing piece" warning is N/A — our
selection is single-pass quota, no iterative optimization.

**Plan (agreed with owner):**
- **NOW** — non-redundancy in `selectCapsuleRoster` (Point 4): dedup
  near-identical pieces (same category + dominant color + garment kind + pattern),
  backfilling a near-dupe only when the quota can't be met with distinct pieces.
- **NEXT** — per-slot coverage gaps (Point 2): surface `[missing wardrobe gap: …]`
  when the roster can't cover a slot's occasion, instead of a thin slot.
- **BIGGER, evidence-gated** — true interconnection scoring / a
  combination-maximizing roster (Point 3): decide whether the MVP heuristic is
  enough before building the real subset optimizer.
- **DEFERRED to the capsule pass (owner said postpone, 2026-07-14 live test)** —
  shoes. A 14-piece capsule composed with a single pair (black suede lace-ups)
  worn in every look, and it was SUEDE in a SUMMER capsule. Two issues: (a) no
  shoe rotation — `reuse:'maximize'` reused one pair and nothing enforces shoe
  variety across a capsule; the roster quota picks ~3 shoes but composition
  collapsed to one. (b) Shoe SEASONALITY — this is the already-parked owner
  ruling (no suede/winter shoes in summer, as a material-based signal, NOT via
  `fabric_weight`; "do not improvise"). Fix both when we return to the capsule.

## Live-testing findings so far (why each fix exists)

1. Crochet top proposed as base layer → tags had no opacity; sight was optional
   → steps 2+3 (opacity field, layer visual gate, view_pieces).
2. "Generate a rough preview" answered with prose → no image tool → render_preview.
3. Results thin after steps 3–5 → verification was expensive (full-size photos)
   → view_pieces (cheap thumbs).
4. Casual cargo pants styled "polished"/elevated → memory pollution (see #44).
5. "Style these pants" → zero ideas → gates rejected the asked-about piece →
   anchor rule (#44) + hot-weather overblock fix (#47).
6. Step-6 live test, two turns: (a) "Put together outfits for my work week…" hit
   the keyword pre-route (`isBroadOutfitPlanningText` matches `outfits` +
   `put together`) → `preroute_only`, and the pre-route composes via
   `composeOutfitSet` with NO constraints → an unconstrained, register-off set
   (shorts-for-office, two maxi dresses, a flagged sandal repeat). (b) A
   regex-dodging rephrase ("get dressed for five days at the office…") stayed off
   the pre-route but the model asked for WEATHER instead of calling
   `plan_outfit_set` → `not_planning`. Fix: prompt reinforcement — an at-home
   multi-day plan with no place named routes to `plan_outfit_set` on the calendar
   season, never a weather question (the planning instinct must beat the
   weather-clarification reflex). Consequence for step 8: the pre-route can't be
   retired until the model reliably composes here (else these turns regress from
   "a flawed set" to "a clarifying question"). Re-test AFTER the fix: routing
   worked (model self-routed → `plan_outfit_set` with diversify + allow_repeat
   shoes, `model_only`), BUT the office looks read beachy — the office slots were
   composed off the OUTDOOR home forecast (Walnut Creek, hot) → sleeveless/breezy
   dresses. First fix: prompt teaches the model to pass `weather:'indoor'` for
   indoor slots (office/work day, indoor event, restaurant) — the existing
   `weatherProfileFromContext('indoor')` short-circuit neutralizes hot/cold — and
   to reserve the live forecast for slots actually spent outdoors. Retest after
   that: routing was good and the tool call carried `weather:'indoor'`, but
   office/client output was still too general-smart-casual (garden-party dresses,
   open-toe/wedge drift). Root cause: `'city'` / `'smart casual'` both resolve to
   the SAME `city_smart_casual` "elevated" profile, and slot scoring did not read
   piece names, so the planner had no narrow office/client register. Fix: slot
   normalization deterministically defaults indoor office/client slots to
   `indoor` when the model omits weather; `tripStructuredValueSet` now includes
   piece names; office/client slot scoring rewards structured/office-coded pieces
   and demotes botanical/floral/lace/resort/flowy/maxi and open-toe/wedge/cork
   client-meeting drift. Related UX fix from the same live test: model-called
   plans now display as `Outfit plan` / `Plan length`, and the stylist route gets
   its own fixed-height app shell so chat history scrolls independently and the
   composer no longer pins itself to the viewport floor on short threads.
7. Wedding-weekend + capsule live tests (post step 8). Register escalation
   (`slot.register`) fixed the ceremony (no more denim), but two follow-on
   corrections fell out: (a) the escalation scorer had demoted a *silk dressy*
   botanical maxi purely for the print words "botanical"/"maxi" — owner ruling:
   print and hemline are NOT formality, so demotion now keys on the piece's own
   `formality` + fabric (jersey/terry/fleece/canvas) + casual shoe TYPES, never
   print/length (#68). (b) Step 8 verified: the capsule now routes to
   `plan_outfit_set` with `piece_budget` and the roster/over-budget report — BUT
   the model decomposed it by garment CATEGORY (Tops/Bottoms/Shoes slots) and ran
   4 pieces over budget. Fix (prompt-only, owner's call): a capsule slots by
   USE-CASE not category, "10-piece" = ~10 PIECES not 10 outfits, re-call tighter
   if the report says over budget. NOTE: `piece_budget` is still a soft report,
   not hard composition enforcement — engine-side roster capping was explicitly
   deferred. Still-open follow-ups: the OFFICE scorer keeps the same
   print-by-name demotion (#66) that #68 removed from the register scorer — same
   flaw, deliberately left pending an owner ruling; and `indoor` neutralizes
   weather so summer-inappropriate heavy fabrics (a wool dress) can appear in a
   summer office slot (indoor could still respect season for fabric weight).

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
8. **Model-initiated planning (step 6–8 evidence):** a planning turn the keyword
   pre-route MISSES — e.g. "I need to get dressed for five days at the office
   next week, and one of those days I'm meeting a client." → the model should
   call `plan_outfit_set` itself, decompose into office/client slots, set indoor
   weather (or let normalization do so), and set `constraints` (diversify +
   no_repeat tops, shoes repeat allowed when sensible). Check the debug block:
   `planPathOutcome: model_only` is the routing win. Then inspect the actual
   cards: the office set should read indoor/professional rather than
   hot-weather/weekend, and the client slot should avoid garden-party, beachy,
   or open-toe/wedge drift when structured options exist. A steady stream of
   `model_only` plus acceptable cards across planning turns is the evidence to
   retire the keyword pre-route (step 8).

Interpretation: blocks-counters firing occasionally = rails working; firing on
every turn = rails too expensive or prompt unclear (find which counter).
Scenarios 3–5 passing is the generalization proof; 1–2 are regressions of known
bugs and must pass; 8 accumulates the retirement evidence for the keyword pre-route.

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
