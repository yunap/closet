# Handoff — freeform stylist chat re-architecture ("router → stylist")

> **Architecture ownership completion, 2026-08-25:** freeform search, proposal, slot swaps, and
> bounded generation now resolve named request/artifact/thread/inference evidence through
> `resolveToolStylingContext` → `resolveStylingContext`; the former tool-local stated/live weather
> resolver is retired. Proposal/correction/swap hard meaning now comes from
> `evaluateWearableOutfit`. Unknown evidence may request sight, while known hard incompatibility
> remains hard and visible as Needs review. Tool schemas and the ten-iteration protocol are
> unchanged.

> **Projection/result ownership, 2026-08-25:** `propose_outfit` no longer owns a separately worded
> definition of explicit-role structure. Its tool description and validation retry project the
> contract from `outfitValidation.js`. Proposal cards use the shared versioned `outfitResult.js`
> envelope: successful cards are accepted (or annotated after a validated correction), and visible
> validation failures are repairable with a retry action. Tool arguments, tool-loop sequencing,
> cache boundaries, and the current top-level UI fields are unchanged.

> **2026-08-18 bounded-execution expansion:** the philosophy below remains authoritative: the
> conversational model owns intent and code owns truth/constraints. The next cost phase does not
> add a keyword pre-route. It promotes the existing one-call visual `generate_outfits` pipeline for
> 2–5 fresh looks sharing one context, following the atomic capsule precedent, while retaining the
> full loop for open-ended work. See [freeform-bounded-execution-spec.md](freeform-bounded-execution-spec.md).
>
> **Live tightening, 2026-08-18:** `thread_1787079261414` completed the same three-look nature-walk
> request in three paid iterations at $0.267537 (17.6% below the six-iteration $0.324696 baseline),
> with live destination weather and three structurally valid cards. Its first reason exposed the
> visual composer's recent-piece comparisons and discarded IDs. The flagged contract now asks the
> controller to call `generate_outfits` directly—its call declares the bounded cards intent—and
> locally withholds composer deliberation that does not describe the final card. The general
> `declare_intent` contract and recent-piece memory remain unchanged outside this bounded profile.
>
> **Owner ruling after `thread_1787089704692`, 2026-08-18:** an ordinary “what should I wear?”
> should offer options and defaults to two. It goes directly to bounded `generate_outfits`; explicit
> one/best/pick-one language keeps the one-card path and explicit counts win. The third run’s hybrid
> search-plus-composer path cost about $0.3376, proving the preliminary search is not harmless.
> Composer deliberation is now withheld independently from `reason`, `watchFor`, and
> `stylingInstructions`.
>
> **Memory visibility, 2026-08-18:** bounded freeform cards write and consult the same
> `whole_wardrobe_sessions` rotation memory as Visual Composer. A header control beside Weather
> names the recent-piece count and offers *Include all pieces again*. It appears only while a flow
> that consults this memory is active: Visual Composer, saved-outfit variants, or a bounded
> whole-wardrobe freeform result. It is absent from ordinary advice, critique, and selected-piece
> styling. A blank new chat is the necessary preflight exception: it shows the control while its
> first request is still unresolved so the user can reset before a bounded call, then hides it if
> the resulting flow does not consult rotation memory. The reset clears only short-lived rotation
> memory, not feedback, durable learning, or thread context.
>
> **Comparison quality, 2026-08-18:** the first accepted two-option bounded run returned two valid
> but structurally near-identical tee + shorts + athletic-shoe looks. Root cause was not roster
> scarcity: the composer returned exactly the requested two candidates, advisor mode correctly
> preserved them (`applyDiversity:false`), and “different visual thesis” allowed variation without
> structural choice. Multi-option requests now carry a volatile-tail comparison contract asking the
> visual model for a different formula or silhouette when eligible pieces support it, while allowing
> activity-safe footwear to repeat. Debug output records unique formula/silhouette counts and a
> collapsed-set flag; it does not post-select or censor the model's visual judgment.
>
> **Exact-weather and closing-tone correction, 2026-08-18:** the Sausalito art-fair run proved that
> `weather_source:live` was not enough: `getCurrentWeatherProfile` reduced a 69°F forecast to
> `mild weather` before composition, producing generic warm-weather cards. Live profiles now retain
> `highF`/`lowF`; bounded composition receives the range, while existing hot/cold gates remain
> unchanged. The paid closing call stays removed. Its robotic local replacement (*“wardrobe-verified
> outfits for this request”*) is replaced by a contextual no-call line naming forecast and place.
>
> **Small execution router, 2026-08-18 (flagged):** `thread_1787093817045` showed that the
> bounded outer controller still wrote ~40,353 cache-creation tokens merely to choose
> `generate_outfits`; the nested visual composer then wrote ~41,105. Under
> both `WARDROBE_FREEFORM_ATOMIC_MULTILOOK=true` and
> `WARDROBE_FREEFORM_EXECUTION_ROUTER=true`, eligible fresh requests first reach a compact
> structured model call with only request/date/timezone. A confident 2–5-look same-context route
> calls the existing visual composer directly; one-look, advice, critique, selected-piece,
> revision, capsule, packing, multi-context and ambiguous requests—and every failure—fall back to
> the full stylist. This preserves the inversion: a model still owns intent, while code owns the
> narrow contract and the photograph-aware model owns styling judgment. Diagnostics persist router
> and composer usage separately in the same turn total. Its initial cold-cost projection was
> ~$0.17–$0.18; the later corrected run measured ~$0.146.
>
> **First router live result, 2026-08-18:** `thread_1787096409835` measured ~$0.186 versus ~$0.324
> immediately before it (about 43% lower), with `execution_router;generate_outfits` and no full
> manifest controller. Owner ruling: the router's `casual` classification for this app's farmers'
> market is correct. Quality was not yet accepted because its `summer` label overrode a live
> 78°F/56°F non-hot profile inside the composer and suppressed 59 insulating pieces plus 20 fiber
> matches. The resolved live profile now owns hard weather gates; season remains styling context.
>
> **Adaptive-evidence experiment:** the corrected Larkspur roster reconstructs to 80 photographed
> pieces, evenly split by the existing visual-detail policy: 40 complex/expressive/textured pieces
> at 800px and 40 plain pieces at 448px. That is 28.7% fewer aggregate pixels than forcing all 80 to
> 768px while increasing detail for the hard-to-read half. `WARDROBE_FREEFORM_ADAPTIVE_VISUALS=true`
> enables this only for bounded freeform; roster identity and other flows stay unchanged. Pixel
> reduction was subsequently live-measured in `thread_1787097967248`: cache creation fell from
> 43,682 to 32,398 tokens while two valid cards were returned.
>
> **Do not cite `thread_1787097350838` as a result.** It repeated the old hot roster and 43,682
> cache-creation tokens because both new arguments were mistakenly wired to the selected-piece
> generator rather than the whole-wardrobe generator used here. The branch wiring is corrected and
> its test now inspects the two call blocks independently. This wrong turn matters: the earlier
> source assertion proved only that the argument text existed somewhere in `tools.js`, not that the
> executing branch received it.
>
> **Corrected live result, 2026-08-18:** `thread_1787097967248` carried the live 77.9°F/56.2°F
> profile into composition, removed the erroneous hot-weather exclusions, and returned two valid
> cards. Adaptive evidence reduced cache creation from 43,682 to 32,398 tokens. Total measured
> usage (2,436 input, 1,145 output, 32,398 cache creation) estimates to ~$0.146 at the recorded
> provider rates—about 55% below the original ~$0.324 call. This is one accepted architecture run,
> not yet a broad quality distribution.

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
  Follow-up capsule hardening: if the model invents `constraints.no_repeat`
  while also setting `reuse: "maximize"` and a `piece_budget`, the executor
  strips that no-repeat rule unless the user's actual question explicitly asked
  not to repeat/reuse pieces. This preserves intentional "no shirt twice" work
  weeks, but prevents reusable capsules from starving their own roster (live
  24-piece test: the model added `no_repeat: ["tops"]` even though the user
  asked for a mix-and-match capsule).
  **FOLLOW-UP replan pre-route RETIRED (2026-07-14) — step 8's second half,
  now COMPLETE too:** `maybePrecomposeStructuredFollowupForAsk` used to run
  unconditionally regardless of the `plan_outfit_set` flags — the one
  meaningful gap the 2026-07-13 architecture review flagged. Path: diagnostics
  (`followupPathOutcome`) → first canary run showed the model breaking on
  roster edits (packing 5 shoes / 7 tops into one `propose_outfit`) → fixed via
  two prompt clarifications (`propose_outfit` is ONE coherent outfit; a capsule
  roster EDIT re-runs `plan_outfit_set`, never a same-role propose card) → a
  second canary run (`WARDROBE_FOLLOWUP_PREROUTE=off`) showed EVERY
  set-modification followup ("add a dinner option", "make it dressier", "add a
  rainy-day option") self-routing to the model with valid `model_propose`
  cards, no precompose-loss regression. `followupPrerouteEnabled()` now
  defaults OFF; `WARDROBE_FOLLOWUP_PREROUTE=on` restores the legacy replan
  precompose as a reversible fallback (`aiEndpointContracts`'s follow-up
  precompose test runs with the flag on to guard that path). **Follow-on
  weather-context bug surfaced by the same canary — FIXED (2026-07-14):** a
  followup stating NEW weather ("add a rainy-day option" on an established
  hot/summer thread) still got rejected by the propose gate — the model
  recovered with an odd substitute (linen for rain). Root cause was deeper
  than "established weather wins": `getCurrentWeatherProfile` (weather.js)
  ALWAYS attempts a live geocode+forecast lookup whenever a location is known,
  regardless of any stated season/weather text — that text was only ever a
  fallback for when live lookup is unavailable. So `search_wardrobe`'s own
  `weather:"rainy weather"` arg was silently discarded in favor of LIVE
  weather for the thread's home location (sunny/hot LA in July), and that
  wrong profile got cached onto `toolContext.weatherProfile` for the rest of
  the turn, including the `propose_outfit` call. Same failure class as the
  #56 coastal-microclimate fix and outfitSetPlanner.js's `resolveSlotWeather`
  precedent ("user-stated weather wins outright... otherwise live forecast"),
  just never applied to `tools.js`'s two direct `getCurrentWeatherProfile`
  call sites. Fix: new `resolveStatedOrLiveWeather` helper (tools.js) —
  `search_wardrobe`'s own `weather` arg and `propose_outfit`'s own `season`
  arg are each treated as a stated override that short-circuits BEFORE any
  live lookup is attempted (`weatherSource: 'stated'`); `propose_outfit`'s own
  stated season now also overrides a `toolContext.weatherProfile` cached by an
  earlier call this turn, not just a fresh lookup. Established
  `toolContext.weather`/ambient season text is unchanged (still only a
  fallback) — this fix is scoped to THIS-CALL stated weather, the literal
  "the model just told the gate what weather to expect" signal.
- **Retire the context clauses** (tripScope/destination in
  `applyFreeformOutputChecks`) when live evidence shows thread-state-informed
  judgment holds. The code history is explicit that prompt guidance alone
  failed before — require evidence, not vibes.
  **tripScope — DONE (2026-07-15, spec 18 Part 2), evidence-backed.** The
  Apple-skirt live incident was stronger than "proved unnecessary": the model
  had already produced a well-scoped, fully valid 3-card answer (anchor
  viewed large, searched, 3 valid anchored cards), and the clause blocked it
  anyway on a keyword miss ("weekend" = multi-day, only one use-case keyword
  matched), forcing a fake clarifying question displayed ABOVE the three
  finished cards. `tripScopeClarificationEnabled()` (`styling-engine/
  provider.js`) now gates the clause behind `WARDROBE_TRIP_SCOPE_CLARIFICATION
  =on`, off by default — same reversible-flag pattern as
  `followupPrerouteEnabled`. `tripRequestNeedsScopeClarification` itself stays
  exported/tested; only the enforcement retired. **destination — still
  pending evidence**, no misfire observed yet; stays live.
- **Volatile prompt tail** (~10.4k tokens: feedback memory, controller text) is
  a future cache/size optimization candidate.
- ~~Known pre-existing failure: `npm test`'s text-matching ratchet fails on two
  inherited lines~~ **REBASELINED (2026-07-14)** — see architecture review
  finding #2 below for the resolution. `npm test` is green end-to-end again.
  **Any new code must stay ratchet-net-zero** (no new `.test(`/`.includes(` on
  the flagged variable names in styling-engine/* or routes/*;
  `// ratchet-allow: <reason>` for legitimate non-garment string uses).

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
2. **`npm test` is permanently red — FIXED (2026-07-14, rebaselined).** The
   ratchet gate was failing on the inherited baseline overage (core.js 61 vs
   60, rules.js 119 vs 116) BEFORE `node --test` ever ran, so the suite result
   was invisible to anyone running `npm test`. Re-verified before fixing:
   `core.js`/`rules.js` have not been touched since PR #53 (well before this
   whole re-architecture arc), so the overage was 100% stale, unchanging,
   inherited debt — not a live annotate-vs-refactor decision, just a baseline
   file that had drifted from reality. Individually annotating ~180 matched
   lines with `// ratchet-allow:` across two files neither of us is actively
   touching would have been high-effort and risky (misjudging even a few lines
   as "not garment matching" would quietly defeat the gate's real purpose).
   Chose **rebaseline**: `scratch/ratchet_baseline.json` regenerated from live
   counts (61/119, `total` 234→238) via the script's own baseline-writer, diffed
   against the old file to confirm ONLY those two numbers moved (nothing else
   silently drifted). `npm test` now passes end-to-end (497/497, exit 0) for
   the first time in this arc. The ratchet still fires on any FUTURE addition
   beyond this floor — same protective behavior, just an honest baseline.
3. **Dead ternary — FIXED (2026-07-14).** `/ask` (routes/ai.js ~3030) had
   `source: activePrecompose ? 'whole_wardrobe' : 'whole_wardrobe'` — both
   branches identical. `git log -L` on the line traced it to a 2026-06-17
   commit ("Improve freeform trip outfit planning") that replaced a plain
   `source: 'whole_wardrobe'` with this ternary, apparently intending real
   branching that never landed — genuinely dead code, not a deliberate no-op.
   Simplified to `source: 'whole_wardrobe'`; zero behavior change.
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
2. **Per-occasion coverage with explicit gaps — FIXED (2026-07-14, this PR).**
   `composeOutfitSet` (`styling-engine/outfitSetPlanner.js`) now tracks, per
   slot, how many distinct outfits it managed to compose (`slotChoices.length`)
   against how many were requested (`targetOutfits`) and how many candidates
   even existed pre-selection (`scoredOutfits.length`), and emits a
   `describeSlotCoverageGap()` line into that slot's `tripPlanLines` via the
   existing `attachTripPlanMetadata` report-building path — the SAME
   `[missing wardrobe gap: …]` bracket convention the model already uses in
   prose (`styling-engine/prompts.js`), so this is the engine proactively
   emitting it deterministically instead of leaving it to the model to notice.
   Two distinct cases, deliberately NOT collapsed into one message: (a) some
   candidates existed but not enough distinct ones cleared the gates → "needed
   N distinct looks but the wardrobe only supports M"; (b) zero candidates at
   all → "no candidate outfit could be assembled." A wrong specific guess at
   WHICH category is missing (top vs shoes vs weather-appropriate anything)
   would be worse than an honest general gap note, so the message names the
   slot and points at "a category," not a specific piece type.
   **Scope boundary, left as-is on purpose:** if EVERY slot in a multi-slot
   plan fails outright, `attachTripPlanMetadata`'s early return
   (`if (!tripOutfits.length) return outfits`) discards `coverageGaps` before
   they're ever attached, since there's no outfit object left to hang the line
   on — that total-failure case still falls back to `tools.js`'s existing
   generic `plan_outfit_set` error message. Only worth revisiting if a
   total-failure report becomes a real complaint; per-slot gaps (the actual
   Point 2 ask — SOME slots come back thin while others are fine) are covered.
   **Test-fixture gotcha found building this:** an all-plain/neutral minimal
   wardrobe (e.g. one white tee + black trousers + white sneakers) qualifies
   for NONE of the whole-wardrobe composer's 5 curated "missions"
   (`qualifiesWholeWardrobeMission` in `rules.js`) and produces ZERO
   candidates — not a bug, a pre-existing property of mission-gated candidate
   generation. A minimal fixture needs at least one piece carrying a "focal
   color" (olive, rust, terracotta, etc.) to qualify for `color_anchor`, the
   cheapest mission to satisfy by hand. Separately, a piece's `occasions` tag
   is NOT itself a hard per-shoe gate — leftover seeded pieces with
   `occasions: ['city','evening']` can still combine with an unrelated neutral
   shoe to accidentally compose an "evening" outfit; a fixture aiming for
   "zero candidates for occasion X" needs ALL other tops/bottoms/shoes removed,
   not just the ones in the target category.
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
- ~~**NOW** — non-redundancy in `selectCapsuleRoster` (Point 4)~~ — **FIXED**,
  PR #77.
- ~~**NEXT** — per-slot coverage gaps (Point 2)~~ — **FIXED**, this PR (see
  full writeup above).
- ~~**NEXT** — shoe rotation + shoe seasonality~~ — **FIXED** (2026-07-14,
  same day, follow-up PR). See the DEFERRED entry below for the resolution —
  including an owner correction to the original ruling made mid-implementation.
- **BIGGER, evidence-gated** — true interconnection scoring / a
  combination-maximizing roster (Point 3): decide whether the MVP heuristic is
  enough before building the real subset optimizer. Not yet greenlit.
- ~~**DEFERRED to the capsule pass**~~ — **FIXED.** A 14-piece capsule composed
  with a single pair (black suede lace-ups) worn in every look, and it was
  SUEDE in a SUMMER capsule. Two issues, both now fixed in
  `styling-engine/outfitSetPlanner.js`:
  - **(a) No shoe rotation.** Root cause: `reuse:'maximize'`'s sort scored ANY
    already-used piece as reuse "savings," so once a shoe was picked, reusing
    it scored higher than any roster alternative on every later pass — the
    roster's other 2-3 shoe options never got picked at all. Fix: `maximize`
    now scores packing reuse on non-shoe pieces only (`nonShoeOverlapCount`)
    and breaks ties toward whichever roster shoe has been used least so far
    (`shoeUseCount`) — tops/bottoms still pack light, but shoes rotate.
  - **(b) Shoe seasonality — owner correction mid-implementation.** The
    original ruling recorded here ("no suede/winter shoes in summer, as a
    material-based signal... do not improvise") was walked back by the owner
    before it was ever built: *"I never meant for all suede shoes to be
    banned in summer or for hiking. There are some suede hiking boots, and
    there are some suede pumps. Let's just use season and occasion
    appropriate shoes."* A material name says nothing about season on its
    own. Fix: a new `tripShoeSeasonScore()` checks the piece's own `season`
    tag (`warm`/`cool`/`year-round`, the field the owner already tags each
    piece with in `PieceForm`) against the slot's hot/cold weather — never
    the material/fabric words. No material-word matching of any kind.
  - **Bonus find while wiring (b), bigger than either shoe issue:** proving
    the season check required tracing why it silently had zero effect, which
    surfaced that `outfit.pieces` throughout this whole scoring pipeline had
    been trimmed to `{id, name, category, photo, worn_photo}` since
    `candidateObjectFromPieces`/`normalizeWholeWardrobeOutfitObject` in
    `rules.js` — *before* any of this file's scoring runs. Every structured
    check downstream (`formality`, `fabric_category`, `colors`,
    `pattern_type`, now `season`) had been silently seeing `undefined`.
    Confirmed live with a temporary debug print: `pieceOfficePolishScore`'s
    `formality` check (added in #86 specifically to stop judging register by
    name/print) was `undefined` on every call, even inside #86's own test —
    that test still passed only because the fixture dress's NAME happened to
    contain the word "jersey," the exact print/name-matching pattern #86 was
    meant to eliminate. Fixed with a `rehydrateOutfitPieces()` step that maps
    `outfit.pieces` back to the full objects in the slot's `allowedPieces`
    pool by id, run immediately before scoring in `composeOutfitSet`. Full
    suite (503/503) stayed green after this change — no other test's
    expected outcome depended on the dead checks staying dead. **Scope
    boundary:** `buildWholeWardrobeCandidateOutfits`/`candidateObjectFromPieces`
    is also called from 3 sites in `routes/ai.js` (outside `plan_outfit_set`)
    — those were NOT touched or audited for the same bug; if a similar
    "fix looks right in the diff, does nothing at runtime" symptom shows up
    there, check for the same trimmed-pieces cause first.

## Plan-level total-outfit cap trim notice (2026-07-14, PR #89)

Found live-testing the shoe fixes above (PR #88): a 14-piece, 5-slot capsule
request asked for 10 outfits total (3+2+2+2+1) and only 8 came back — with no
error, no plan line, nothing telling the user or the model that 2 outfits were
silently dropped. Root cause: `PLAN_TOTAL_OUTFIT_CAP = 8` in
`normalizePlanSlots` trims slot `targetOutfits` values (from the back of the
slots array forward) whenever the requested total exceeds it — this predates
this session and is unrelated to the shoe fixes; it just happened to be what
the live test's 10-outfit ask tripped over.

This is a **different cause** from the per-slot coverage-gap lines (capsule
review Point 2, PR #87): those fire when the WARDROBE can't fill the
(already-trimmed) count; this fires when the PLAN itself asked for more than
the cap allows, before the wardrobe was ever consulted. Both can legitimately
fire for the same slot.

Fix: `normalizePlanSlots` now records the pre-trim count on
`slot.requestedOutfits` (only set on a slot the cap actually touched — its
presence IS the trim signal), and `composeOutfitSet` emits a
`[plan trimmed: "<label>" reduced from N to M looks — the plan asked for more
outfits than the 8-outfit total across the set allows]` line via
`describePlanCapTrim()`, using the same `tripPlanLines`/`coverageGaps`
plumbing PR #87 already built. Verified against the exact live-test slot
shapes: `Smart Casual Day` and `Beach Day` (both requested 2, cut to 1) now
report the trim; `Everyday City Outing` and `Gallery Visit` (untouched by the
cap) correctly report nothing.

## Plan-notes UI truncation was silently eating disclosure lines — FIXED (2026-07-14)

Found live-testing PR #89 above: a "10 outfits, no specific instructions"
capsule request (7 slots, 3+2+2+2+1+1+2=13, over the 8-cap) came back with
only 4 outfits and zero explanation — three whole slots vanished with no
`[plan trimmed: ...]` or `[missing wardrobe gap: ...]` line anywhere in the
chat UI, even though PRs #87/#88/#89's engine code was suspected working.

Two-step investigation, both confirmed by a local `composeOutfitSet` repro
against the real wardrobe DB (no LLM calls):

1. **The model itself was the first-order problem in earlier test turns —
   root cause found and fixed.** `plan_outfit_set`'s tool result explicitly
   says "the cards are already attached to this turn... do not compose
   another set," but for a *specific* 10-outfit ask the model called
   `plan_outfit_set`, got that instruction, and immediately re-composed every
   card anyway via `search_wardrobe` + `propose_outfit` — discarding the
   engine's cards and `tripPlanLines` entirely. This did NOT reproduce on a
   vaguer "no specific instructions" capsule ask, which pointed at a
   conflicting instruction rather than pure model flakiness: `declare_intent`
   (always called before `plan_outfit_set`) told the model, unconditionally,
   "every card goes through propose_outfit" — a contract written before
   `plan_outfit_set` existed and never updated to exempt it. Fixed in
   `tools.js`'s `declare_intent` handler: the `propose_outfit` contract is now
   scoped to a single outfit / small fixed set, with an explicit instruction
   to call `plan_outfit_set` once for a multi-slot plan and NOT also use
   `propose_outfit` to rebuild or top up that same set — including when its
   total comes in under what the user asked for (that shortfall is a real cap
   or wardrobe gap, already disclosed via `plan_lines`, not something to paper
   over with hand-composed cards).

   **Round 2 finding (2026-07-14, same day):** re-tested live after the fix
   above — the duplicate-`propose_outfit` behavior was gone, but a new
   failure appeared: `plan_outfit_set` succeeded (4 cards, 3 honest
   `[missing wardrobe gap: ...]` lines, confirmed via local repro), and the
   model discarded all 4 cards and re-declared intent as `text`, answering
   with a vague "the wardrobe can't fully satisfy this" apology instead of
   presenting the cards it already had. Likely an overcorrection from the
   round-1 wording ("do not paper over a shortfall with hand-composed
   cards") being read as license to abandon the turn rather than present the
   partial-but-honest result. Fixed by making both `declare_intent` and
   `plan_outfit_set`'s own success message state explicitly: a
   `plan_outfit_set` success response — even one whose `plan_lines` disclose
   trimmed/unfillable slots — IS the complete answer; present the cards plus
   `plan_lines` verbatim, never downgrade to text-only, and only skip cards
   entirely if `plan_outfit_set` itself returned `status:"error"`.

   **Round 3 finding: prompt wording alone did not hold.** Re-tested live a
   third time with an explicit numeric slot breakdown (3+2+2+1=8, within the
   cap) after round 2's fix — the authorship badge (built in round 2)
   immediately showed all three cards tagged `AI · propose_outfit`: the model
   called `plan_outfit_set` once, then hand-composed every card via
   `propose_outfit` anyway, the same duplication round 1 was meant to fix.
   Two rounds of stronger instruction text did not reliably prevent this.

   **Fixed mechanically instead**, consistent with this codebase's existing
   preference for hard gates over prompt-only compliance on anything that
   must be correct (see `evaluateOutfitRoles` replacing prompt-based layering
   rules). `propose_outfit`'s contract-issue check (`tools.js`, alongside the
   existing declared-intent / unverified-piece / unseen-layer blocks) now
   also blocks when `toolContext.source === 'plan_outfit_set'` and
   `sourceLocked` and this turn's `generatedOutfits` already contains
   `plan_outfit_set`-sourced cards — i.e. propose_outfit cannot duplicate a
   plan_outfit_set composition within the same turn, full stop, regardless of
   what the model reasons its way into. The block message redirects the
   model to present the existing cards, or call `plan_outfit_set` again with
   an additional slot for a genuinely new use case.

   Not yet re-verified live. The per-card authorship badge is now the
   fastest way to check: if `propose_outfit` duplication recurs, the gate
   above should hard-block it and force the model back onto the composed
   cards rather than merely discouraging the duplicate call.
2. **The actual bug for the "no specific instructions" case: a UI truncation.**
   `StylistChat.jsx`'s `getTripPlanNotes()` built the "Outfit plan" box
   correctly from `outfit.tripPlanLines` (confirmed via direct repro: all
   gap/trim lines were present in the engine's return) but then did a flat
   `.slice(0, 7)` on the combined notes array. The 5 baseline lines (plan
   length, coverage, weather, piece roster, budget) plus per-slot coverage
   lines already crowd that budget on anything past a 2-3 slot plan, so on a
   7-slot capsule (11 total lines, 6 of them gap/trim disclosures) the last 4
   lines — all disclosures — were cut with no signal to the user that
   anything was missing.

   Fixed: the slice now protects bracket-prefixed disclosure lines
   (`[plan trimmed: ...]`, `[missing wardrobe gap: ...]`) from truncation —
   cosmetic lines (weather, piece roster wording) are trimmed first to make
   room, and only if disclosures alone exceed 7 do they extend past the old
   cap (better to show all of them than silently hide a gap).

Also added: a small per-card authorship label (`engine · plan_outfit_set` vs
`AI · propose_outfit`, etc., from `outfit.source`) so future live-testing can
tell at a glance whether a card came from the deterministic composer or the
model's own `propose_outfit` — this would have made finding #1 above
immediate instead of requiring console-log archaeology.

## Cross-slot mood/request text leakage silently zeroed out plan_outfit_set — FIXED (2026-07-14)

Found while investigating why `plan_outfit_set` kept returning `status:"error"`
(zero outfits composed) on live capsule tests, forcing the model into its
documented — and, after the fixes above, now gated-but-legitimate —
`propose_outfit` fallback. Suspected model misbehavior at first; turned out
to be a real engine bug, isolated with a controlled pair of local
`composeOutfitSet` runs (same 8 slots, same wardrobe, only the `question`
text changed):

- `question: 'warm summer weather'` → 4 outfits composed successfully
- `question: 'Build me a summer capsule wardrobe: 3 Smart Casual looks, 2
  Beach Day looks, 2 Everyday City Outing looks, 1 Gallery Visit look — 10
  outfits total, warm summer weather.'` → 0 outfits, total failure

Root cause: every per-slot gating call inside `composeOutfitSet`'s slot loop
(`filterWholeWardrobePiecesForGeneration`, `resolveComfortFootwearConstraint`,
`buildWholeWardrobeCandidateOutfits`, `wholeWardrobeOutfitsFromCandidates`,
`locallyGateWholeWardrobeOutfits`, `applyComfortFootwearRepair`, and
`resolveSlotWeather`) fell back to `mood: mood || question` /
`request: question` — using the PLAN-LEVEL `question` (the user's entire
original request) as every individual SLOT's mood/request text whenever no
explicit `mood` was set (the normal case). Since a multi-slot capsule
request naturally names every slot together in one sentence ("3 Smart
Casual looks, 2 Beach Day looks, ... 1 Gallery Visit look"), each slot's
gating was seeing keywords from every OTHER slot too — strict enough,
apparently, to zero out candidates for all 8 slots simultaneously in this
case. This is likely why several live tests earlier tonight saw
`plan_outfit_set` fail outright rather than partially succeed with disclosed
gaps: this bug, not a model or gating-logic problem, was silently deciding
whether the whole engine path worked at all.

Fixed: each slot now builds its own `slotRequestText` from
`[slot.label, slot.best_for, slot.plan_note]` (falling back to the
plan-level `question` only if a slot genuinely has none of its own text) and
every in-loop gating call uses that instead of the raw plan-level `question`.
The plan-wide `isSummerContext` check (a single boolean, not per-piece
keyword matching) was left untouched — it's legitimately plan-scoped.
Verified via the same controlled pair: the full multi-slot question now
composes the same 4/8 outfits the short question did. 506/506 tests still
green; no test depended on the old cross-slot leakage.

## `normalizePlanSlots` had its OWN silent slot-count cap — FIXED (2026-07-14)

Found immediately after the fix above, while re-verifying live: an 8-slot
capsule request (all the round-3 fixes applied, badges all reading
`engine · plan_outfit_set`, gap lines rendering correctly) looked like a
genuine success at first glance — until a closer read caught that only 3 of
8 requested use cases ever appeared, with no error and no disclosure for two
of them (`City Outing 2`, `Gallery Visit` — not even a `[missing wardrobe
gap: ...]` line, they just weren't there). Traced to `normalizePlanSlots`
(`outfitSetPlanner.js`): a `.slice(0, maxSlots)` (`maxSlots = 6` by default)
silently drops any slots past the 6th, entirely independent of
`PLAN_TOTAL_OUTFIT_CAP` (PR #89's cap) — this is the identical class of bug
PR #89 fixed (a real cap trimming a plan with zero disclosure), in a
different spot #89 never touched, since #89 only covers the total-OUTFIT-
count cap, not this separate total-SLOT-count cap.

Fixed the same way: `normalizePlanSlots` now records the dropped raw slots'
labels as `.droppedSlotLabels` on the returned array (arrays can carry extra
properties; kept the return shape a plain slot array so no caller needed to
change), and `composeOutfitSet` seeds `coverageGaps` with a
`[plan trimmed: N use cases dropped — "Label1", "Label2" — a plan can only
include up to {maxSlots} use-case slots at once; ask again with the dropped
ones as a follow-up]` line before the per-slot loop runs. Verified against
the exact live 8-slot input: the line now names `City Outing 2` and
`Gallery Visit` explicitly. 506/506 tests still green.

**Follow-up fix (2026-07-14):** after the register-demand reserve and
plan-level weather fixes, the same 8-slot capsule ask showed the disclosure was
working but still prevented the full ask from running. `normalizePlanSlots` now
defaults `maxSlots` to `PLAN_TOTAL_OUTFIT_CAP` (8), so 8 one-look use cases are
attempted and only a 9th+ use case is dropped with the same disclosure metadata.
The total outfit cap remains 8.

**Honest state after those four fixes**, re-verified on the same 8-slot live
request: 8 requested → 6 slots even attempted (now disclosed) → only 3
actually composed (all three `Smart Casual` looks). `Beach Day 1`,
`Beach Day 2`, `City Outing 1` failed. That's a 3/8 real fill rate. Do not
read "no propose_outfit duplication + badges correct + some gap lines
visible" as "the capsule rework works" — always check the actual composed
count against the actual requested count before calling a test result good.
This exact mistake was made once already tonight before being caught on a
second look.

## `selectCapsuleRoster` had zero visibility into the plan's occasions — FIXED (2026-07-14)

Traced why `Beach Day`/`City Outing` (occasion `casual`) were failing while
`Smart Casual` succeeded, using the same 6-piece roster for both: `casual`
enforces an `everyday` register ceiling, and the roster was 5/6 pieces tagged
`elevated` — only one pair of shoes cleared it, so no top+bottom/dress
survived for any `casual`-occasion slot. Not a real "wardrobe is missing
beach clothes" gap (the `[missing wardrobe gap: ...]` message was
misleading) — `selectCapsuleRoster(pool, { budget, isSummer })` never
receives the plan's occasions at all, so its scoring
(`capsuleVersatilityScore`: neutral color, tagged-occasion breadth, solid
pattern, fabric weight for summer) optimizes for generic "versatility" with
zero awareness of register/formality spread. A roster that scores well on
that formula can still read uniformly dressy and fail every stricter-ceiling
occasion in the plan at once.

Fixed: `composeOutfitSet` now passes `occasions: slots.map(slot =>
slot.occasion)` into `selectCapsuleRoster`. A new `strictestRegisterCeilingRank()`
resolves the lowest (strictest) `register_ceiling` among those occasions via
`resolveOccasionProfile` (`occasions.js`). After the existing quota-based
selection, a register-floor guarantee pass checks each category (top,
bottom, dress, shoes) for at least one selected piece whose own `formality`
clears that ceiling — if none do, it swaps in the best ceiling-compliant
candidate from the pool for the category's lowest-scoring pick. Skipped
entirely when the plan's occasions don't resolve to a ceiling, so it only
tightens an otherwise-blind selection and never loosens anything for plans
where it doesn't apply.

Verified against the same live 8-slot input: composed count went from 3/6
attempted slots to 5/6 (`Beach Day 1` and `Beach Day 2` now both succeed).
`City Outing 1` still fails, but with a narrower, different message now —
"no outfit passed the casual/weather/register gates" rather than the
earlier blanket "no candidate outfit could be assembled" — meaning pieces
now survive the roster/register floor and the initial per-piece filter, but
the assembled outfit still gets rejected at a later scoring/gating stage.
That remaining gap is diagnosed (not fixed) in the next entry.

## Remaining gap: register-floor guarantees PRESENCE, not enough QUANTITY — diagnosed, NOT fixed (2026-07-14)

Traced why `City Outing 1` still failed after the `selectCapsuleRoster`
register-floor fix above. In isolation it composes exactly 2 valid outfits:

```
blue botanical sleeveless dress + navy solid canvas slip shoes
blue botanical sleeveless dress + navy solid canvas slip shoes + navy technical hoodie
```

Both are the EXACT combos already assigned to `Beach Day 1` and `Beach Day
2` (also `casual`-occasion slots, processed earlier in the slot order).
`composeOutfitSet`'s `chooseScoredOutfit` unconditionally excludes any
outfit whose exact piece combo (`tripOutfitKey`) is already in `usedKeys` —
that check is never relaxed across any of the four fallback passes, unlike
the formula/no-repeat relaxations. So by the time `City Outing 1` runs, its
entire candidate pool is already consumed. The gap message ("no outfit
passed the casual/weather/register gates") is misleading here — the real
cause is "the roster has too few `everyday`-tier pieces to produce a THIRD
distinct outfit," not a gating failure.

This is the register-floor fix's real limitation, not a bug in it: it
guarantees ONE register-compliant piece per category exists, which is
enough for the FIRST `casual`-occasion slot processed, but this plan had
FOUR `casual`-occasion slots (`Beach Day` ×2, `City Outing` ×2) all drawing
from the same thin `everyday` slice (1 dress, 1 top, 1 bottom, 1 outerwear,
1 shoe pair post-fix) — enough combinatorial variety for ~2-4 distinct
outfits before it runs dry. Presence was fixed; quantity was not — the
quota reserved per register tier should scale with how many plan slots
actually need that tier, not just guarantee a single representative piece.

**Not implemented.** This is a design decision (how `piece_budget` gets
allocated across register tiers when a plan has several same-tier slots),
not a mechanical correctness fix like the others tonight — flagged for the
next assistant/owner decision rather than patched silently. A plausible
direction: count slots per resolved register tier in `composeOutfitSet`
before calling `selectCapsuleRoster`, and pass a per-tier minimum-piece-count
(not just "at least one") into the roster quota logic.

### Capsule allocator spec — register demand reserve — IMPLEMENTED 2026-07-14

Goal: make the capsule roster match the plan's actual slot demand, not just a
generic "versatile piece" formula. A capsule with four casual/everyday use
cases needs enough everyday-compatible ingredients to produce multiple
distinct formulas before exact-combo exhaustion; one compliant piece per
category is not coverage.

Implementation landed in `styling-engine/outfitSetPlanner.js`: `composeOutfitSet`
passes the normalized slots into `selectCapsuleRoster`; the roster derives a
strictest register-demand reserve from `slot.targetOutfits`, then swaps
lower-scoring non-compliant picks inside the existing category quotas until
repeated same-tier demand has enough compliant tops/bottoms/shoes where the
wardrobe and `piece_budget` allow. It stays budget-capped and preserves the
near-duplicate suppression pass. Coverage gaps now distinguish generic
gate failure from "compatible combinations existed but were already consumed by
earlier same-tier slots."

**Demand model.**

- For each normalized slot, resolve its effective register ceiling from
  `resolveOccasionProfile(slot.occasion).register_ceiling`; slot-level
  escalation (`slot.register`) should only make demand stricter when it already
  maps to a known formality rank.
- Count demanded looks by ceiling rank, using `slot.targetOutfits` after
  `PLAN_TOTAL_OUTFIT_CAP` trimming. Example: `Beach Day` x2 + `City Outing` x2
  under an everyday ceiling means four everyday-demanded looks, not "casual is
  present."
- Treat unknown ceilings as non-reserved demand. They still compose from the
  roster, but they should not distort the reserve math.

**Budget allocation.**

- Keep `capsuleQuotas(budget)` as the outer category budget so a 10- or
  14-piece capsule still reads like a capsule (separates-heavy, limited shoes,
  optional layer/dress).
- Replace the current register-floor guarantee with a register demand reserve:
  within each category quota, reserve more than one ceiling-compliant piece
  when a tier has repeated demand. The reserve should scale gently with looks,
  not one-for-one; a good first invariant is:
  - one demanded look: at least one compliant main path is enough;
  - two to three demanded looks: at least two compliant choices in the relevant
    main categories (`top`/`bottom` or `dress`) plus enough shoes;
  - four or more demanded looks: at least two distinct main formulas, preferably
    three compatible mains if the quota and wardrobe allow it.
- Dresses count as a main formula path; tops and bottoms need pairability. Do
  not satisfy all everyday demand with one dress plus one shoe if several
  everyday looks are requested.
- The reserve is category-local and budget-aware: swap lower-scoring,
  non-compliant pieces out of the existing quota before increasing the roster.
  Never exceed `piece_budget` to satisfy the reserve.
- Non-redundancy still applies inside each reserved tier: two near-identical
  black tees should not satisfy a two-top reserve unless the wardrobe has no
  distinct alternative.

**Fallback and reporting.**

- If the wardrobe cannot supply enough compliant pieces inside the budget, keep
  the best roster and disclose the real limitation. The message should name the
  exhausted tier/use case, e.g. `[missing wardrobe gap: "City Outing" needed a
  third distinct everyday-compatible combination, but the capsule roster only
  supports 2]`.
- Do not relax hard register/weather/activity gates to fill the count. A
  capsule under-delivering honestly is better than quietly upgrading a casual
  slot into dressy pieces.
- Improve `describeSlotCoverageGap()` or pass it richer cause data so
  "candidate combos existed but were already consumed by earlier same-tier
  slots" does not appear as "no outfit passed the gates."

**Acceptance tests.**

- Added a fixture with several casual/everyday capsule slots and a
  `piece_budget`; before the fix, later slots fail because exact combos were
  already used by earlier same-tier slots. After the fix, the selected roster
  must include enough everyday-compatible variety to compose the requested
  attempted slots within budget.
- Added a constrained fixture where the wardrobe truly lacks enough everyday
  pieces; it should keep the budget and emit the more truthful "not enough
  distinct everyday-compatible combinations" line.
- Existing tests for near-duplicate suppression, shoe rotation, summer
  shorts, budget enforcement, and plan trim disclosures green.

## Session verdict: is the PR #86-89 capsule feature usable? (2026-07-14)

Goal of this session was to determine whether PR #86-89's capsule-feature
work actually produces a usable capsule, not just to spot-check individual
fixes. Progression on the same 8-slot live capsule request, tracked
end-to-end rather than accepted at face value:

- Before tonight's fixes: `plan_outfit_set` failed outright (0 outfits),
  the model silently fell back to hand-composing duplicate/lower-quality
  cards via `propose_outfit`, and — separately — 2 of 8 requested use cases
  were dropped with zero disclosure by an unrelated `maxSlots` cap.
- After tonight's five fixes (duplicate-composition gate, UI truncation,
  cross-slot mood/request leakage, silent slot-count drop, blind capsule
  roster curation): 5 of 6 attempted slots compose successfully, the 2
  silently-dropped slots are now disclosed by name, and the 1 remaining
  failure has a diagnosed (if unfixed) cause instead of a misleading
  message.

**Verdict at that point: real, verified progress — not yet a reliably usable
feature.** 0/8 → 5/8-ish was a large improvement, but a capsule request with
several slots at the same stricter register tier (the common case — a real
capsule naturally has multiple `casual`/`everyday` use cases) could still
under-deliver once that tier's thin roster ran out of distinct combinations.
The `maxSlots = 6` cap was also still low for a realistic multi-occasion capsule
ask (this session's request needed 8). 506/506 tests were green throughout every
fix in this session.

**Follow-up status (2026-07-14):** the register-demand reserve is implemented,
plan-level `weather` now feeds the slots, and `maxSlots` now defaults to 8. The
remaining live-test question is whether the full 8-slot capsule composes with
acceptable quality, not whether the engine silently drops the last two slots.

**Follow-up quality fix (2026-07-14):** the 8/8 live capsule still had two
quality failures: `Smart Casual Look 1` used an everyday `Casual/City` dress,
and three slots reused that same dress with different shoes. The planner now
requires smart-casual slots to contain an elevated-or-better non-shoe anchor,
so an everyday city dress plus nicer shoes is not enough. Enforced capsules also
block repeated dress-as-main formulas across slots unless the user explicitly
pins that dress as a shared anchor. That exposed a candidate-generation blind
spot: the mission candidate builder emitted only dress formulas for `Beach Day`
even though the already-allowed capsule roster had valid top/bottom/shoe
separates. `composeOutfitSet` now appends a structural-separates fallback for
enforced capsules from already-allowed pieces only, preserving occasion/weather
gates while giving the selector enough non-dress formulas to fill the rotation.
The exact 8-slot summer capsule ask now composes 8/8 locally, with the blue
botanical dress appearing once and not in smart casual. `test/plan_outfit_set`
has regression coverage for both failures.

**Follow-up generalization fix (2026-07-14):** a nearby ask using
`warm-weather` instead of `summer` under-filled to 4/8. The engine was honest
about the gaps, but the roster was wrong: warm text on normalized slots was not
feeding `isSummerContext`, so the capsule did not prioritize warm casual bottoms
and later Beach/City/Outdoor slots had no bottom path. `composeOutfitSet` now
derives warm context from question, mood, and slot weather/season text
(`summer|warm|hot|80s|90s|heat`). Regression coverage confirms the
12-piece warm-weather capsule fills the repeated Beach and City slots without
gap lines.

**Follow-up scale fix (2026-07-14):** the 12-piece capsule ask was a useful
stress test, but a realistic 24-piece seasonal capsule exposed a separate
normalization bug: `PLAN_TOTAL_OUTFIT_CAP = 8` forced a 14-look request into
only 8 attempted cards before the wardrobe was consulted, reducing every later
slot to one look. `planTotalOutfitCapForBudget()` now keeps compact/travel
capsules at 8 cards, raises 18-piece capsules to 12 cards, 24-piece capsules to
16 cards, and 30-piece capsules to 20 cards. `executeTool('plan_outfit_set')`
infers or reads `piece_budget` before slot normalization and passes the dynamic
cap through. Regression coverage confirms the exact 24-piece/14-look seasonal
shape is no longer trimmed by the compact cap.

**Follow-up shoe/register fix (2026-07-14):** the first 24-piece live retest
proved the card cap was fixed, but showed two quality issues: `Casual Dinner`
arrived from the model as `occasion:"casual"`, and smart-casual brunch still
looked underpowered because the 24-piece roster carried only the compact
capsule's shoe allowance. Slot normalization now corrects contradictory
casual/city dinner labels to `evening`. Capsule quotas now reserve 4 shoes for
24-piece capsules and 5 shoes for 30-piece capsules, and the elevated-shoe
floor scales with actual smart-casual/gallery/evening demand instead of
guaranteeing only one polished pair. Regression coverage checks both the
misclassified dinner normalization and multiple elevated shoes in a roomy
mixed-register capsule.

**Follow-up beach/coastal environment + render-boundary fix (2026-07-15):**
the exact warm-weather trip ask exposed two separate issues. First, a beach
slot can arrive from the model as contradictory weather (`weather:"indoor"`)
or as generic `occasion:"casual"`; either way the planner must treat "beach"
as an environment, not just a casual use case. `normalizePlanSlots` now
preserves beach/coastal environment intent and beach/coastal slots ignore
contradictory indoor weather, falling back to plan/live weather. Beach/coastal
slots also get earlier composition priority and a scorer that favors real
beach-appropriate pieces (technical/performance/swim/cover-up/terry/sport
signals, dresses/shorts in heat) while penalizing hot trousers, cargo, and
tailored/wide-leg paths. Second, gallery/dinner/smart-casual slots were being
shoe-repaired like all-day walking slots, so they lost elevated shoes in roomy
capsules/trips. Those slots now keep elevated shoe intent even when the model
mentions walking, and dinner/galleries suppress beach/technical/canvas drift.
Regression coverage includes contradictory indoor beach weather and the exact
warm trip shape reserving elevated shoes for gallery/dinner.

The same live test also showed the model calling `render_preview` after a
cards-only `plan_outfit_set` success, producing an unasked generated image.
`render_preview` is now mechanically gated on `declare_intent({ want:"image" })`;
a `want:"cards"` turn returns a validation error and tells the model to present
the existing cards. Image-intent render tests were updated so legitimate "show
me a rough preview" follow-ups still work.

**Follow-up slot-prose normalization fix (2026-07-15):** the next Bay Area
coastal trip retest exposed a subtler version of the same model/tool boundary:
the model put important slot meaning in `best_for` while omitting structured
fields. `City Walking Days` had `best_for:"walking around the city"` but no
`activity:"walking"`, so the walking footwear gate never activated. Inside
`composeOutfitSet`, normalized slots also store `bestFor`/`planNote`, but the
slot request text was still reading snake-case `best_for`/`plan_note`, dropping
that prose before weather, comfort, and candidate generation. Fix: slot
normalization now infers walking/hiking from label/best-for prose when the model
omits activity, excluding gallery/museum/dinner contexts so elevated gallery
shoes are not flattened into walking shoes. The composer now scopes request text
from `label + bestFor + coverage + planNote`.

The same retest showed `cool mild weather` + `windy beach outing` was not cold
enough to trigger the generic cold-weather layer hard gate, so the beach card
could still be a bare sleeveless dress. Beach/coastal slots now treat cool,
windy, breezy, chilly, foggy, or marine-layer wording as layer-worthy when the
weather is not hot, and `composeOutfitSet` can add a light coastal layer from
already-allowed roster pieces before final scoring. Regression coverage uses the
live-style `cool mild weather` / `windy beach outing` language instead of only a
literal cold forecast.

## Spec 19 — register floor/ceiling reconciliation, unfillable-floor escape hatch, piece_ids truthfulness, and the model-mode default flip — IMPLEMENTED (2026-07-15)

Four parts, shipped as one PR, all in `styling-engine/outfitSetPlanner.js`
unless noted. Live evidence: two Anthropic model-mode scenario runs the same
evening (office-week and wedding-weekend) surfaced three distinct
validator-boundary misses on top of the already-good register-floor work.

- **Part 1 — unfillable register floor now names its own escape hatch.**
  `validateSubmittedPlanOutfits` always appends a re-call-with-a-lower-register
  message to a register-floor rejection (the model previously had no legal
  move inside `submit_plan_outfits` and nothing told it so — the office-week
  run blind-resubmitted three times against an unfillable `dressy` floor
  before hitting the resubmit cap). When the slot's `gateAllowedIds` genuinely
  contain no floor-clearing main path (no dress AND no top+bottom pair, or no
  shoes) — arithmetic over tags already on the pending plan, no new gating — a
  stronger message says so outright instead of leaving the model to discover
  it by trial and error. `slotFloorViability()` does the counting.
- **Part 2 — a declared register above the occasion ceiling now reconciles
  instead of contradicting.** Root cause was two-layered: (a)
  `effectiveSlotRegisterCeilingRank` took `Math.min(occasionRank, slotRank)`
  — a declared `elevated` register on a `casual` (`everyday`-ceiling) slot
  made the ceiling STRICTER, the opposite of what an explicit escalation
  should do; fixed to `Math.max`, so a declared register only ever lifts the
  ceiling, never lowers it (undeclared/non-escalating slots are unchanged).
  (b) Deeper bug: the actual piece-level gate
  (`filterWholeWardrobePiecesForGeneration` → `wholeWardrobePieceTrustDecision`
  → `resolveRegisterCeiling`) never saw the slot's structured `register` field
  at all — it resolved its own ceiling from occasion/activity/mood TEXT, so
  even the workbench's *displayed* reconciled ceiling was cosmetic; pieces
  were still gated against the unreconciled occasion ceiling. Fixed by having
  `buildPlanSlotWorkbench` pass an explicit `registerCeiling` override into
  the gate call, but ONLY in the genuine escalation case (declared rank above
  the occasion ceiling) — an undeclared or non-escalating register leaves the
  gate's own occasion/activity ceiling logic untouched, so nothing loosens for
  plans that don't declare an escalation. New invariant, tested across an
  occasion × register matrix: effective ceiling ≥ effective floor for every
  normalized slot. (Also fixed in the same pass: `register: "formal"` isn't
  one of the four `FORMALITY_VALUES` pieces are tagged with — it was already
  special-cased to `dressy` for floor derivation in three separate places but
  silently ignored in the ceiling calc, which would have broken the new
  invariant for a `formal`-declared slot; consolidated into one
  `slotRegisterRank()` helper used everywhere a slot's register maps to a
  rank.)
- **Part 3 — "the piece_ids ARE the outfit."** One line added to
  `buildPlanSlotWorkbench`'s workbench instructions (same family as spec 18
  Part 5 — an instruction against an observed fabrication shape, no
  mechanism, since prose-vs-IDs consistency isn't mechanically checkable).
  Live evidence: a submitted card's reason said "Actually revising: emerald
  v-neck top + oatmeal textured elastic waist pants..." while `piece_ids`
  still carried the abstract midi dress the prose had just rejected.
- **Part 4 — `WARDROBE_PLAN_COMPOSE` default flipped to `model`.** The
  spec-13 flip criterion is met: all six scenario families ran live in model
  mode, resubmits converged, no validator-missed correctness class remains
  open, and the owner judged quality ≥ engine mode. The read in `tools.js`
  (`planComposeMode`) now defaults to `'model'`; `WARDROBE_PLAN_COMPOSE=engine`
  still fully restores engine composition (same reversible-flag convention as
  the retired pre-routes) — no engine code deleted this PR, that's spec 14's
  job on its own `hardRejects` audit. The repo-local (gitignored) `.env`'s now-
  redundant `WARDROBE_PLAN_COMPOSE=model` line was removed so the real default
  isn't masked in dev. **Spec 13 flip: DONE. Spec 14 (scorer-layer deletion)
  is unblocked — owner ruling 2026-07-15: no soak period, sequential PRs, git
  history is the fallback if anything regresses; spec 14's own `hardRejects`
  audit is its gate, not a waiting period.**

`test/plan_outfit_set.test.js` carries the regression coverage for all four
parts (escape hatch + unfillability wording, ceiling-reconciliation +
undeclared-stays-identical + the ceiling≥floor matrix, the instructions
string, and both the default-model and `WARDROBE_PLAN_COMPOSE=engine` tool
responses). Full suite green (563/572 node --test passes; the 9 failures are
pre-existing environment gaps in a fresh clone — untracked local `scratch/`
scripts two tests read via `fs.readFileSync`, plus date/fixture-sensitive
hot-weather tests — identical on a clean `origin/main` checkout, unrelated to
this PR). Ratchet unchanged (238/238, no new text-matching debt).

## Spec 14 — retire the taste-scorer layer of outfitSetPlanner.js — IMPLEMENTED (2026-07-16)

Spec 13's flip criterion was met (model mode default since spec 19, PR #105)
and the owner ruled no soak period — sequential PRs, git history is the
rollback path. Step 0 first made the suite's own pre-existing fresh-clone gaps
hermetic (see "Step 0" below), then the deletion itself.

**hardRejects audit (by grep, since the spec's 2026-07-15 line numbers had
drifted — the file grew from 2108 to 2756 lines across specs 15-19 before this
PR touched it):** every `hardRejects.push` inside `tripSlotFitScore`'s family
reduces one of three ways once `composeOutfitSet` is gone: (a) a tag/profile
check already duplicated in spec 13's `validateSlotOutfitConstraints` (cold-
layer, hot-heavy mains, register floor for dressy+, footwear/activity comfort);
(b) a piece already excluded upstream before the model ever sees it, via
`filterWholeWardrobePiecesForGeneration`'s register-ceiling/footwear-enum
gates (used by `buildPlanSlotWorkbench`, spec 19 Part 2's `registerCeiling`
override included) — this is why the formal-slot denim/jacket/shoe rejects and
the outdoor-active loafer reject need no replacement: model mode never offers
those pieces as candidates in the first place; or (c) genuinely retired taste
(office/client structural judgment, smart-casual anchor, dinner register,
double-cardigan, athletic-piece demotion) — the model's job now, no
mechanical replacement, matching the spec's own framing.

**Deleted from `styling-engine/outfitSetPlanner.js`** (2756 → ~1450 lines):
the whole `tripSlotFitScore` family (`tripOutfitDinnerRegisterScore`,
`tripOutfitOfficeRegisterScore`, `tripOutfitSmartCasualRegisterScore`,
`tripOutfitRegisterEscalationScore`, `tripOutfitBeachCoastalScore`,
`tripOutfitElevatedOccasionShoeScore`, `tripOutfitAestheticGravityScore`,
`tripShoeSeasonScore`, `tripPieceFabricBreathabilityScore`,
`tripPieceWalkabilityScore`, `tripDaytimeBottomScore`,
`tripPieceIsDelicateForDay`, plus all the dinner/office helper predicates);
`isOfficePlanSlot`, `isClientPlanSlot`, `isOutdoorActivePlanSlot`,
`isBeachCoastalPlanSlot`; the layer injectors
(`chooseEveningLayerForOutfit`, `chooseBeachCoastalLayerForOutfit`,
`withEveningLayerIfUseful`, `withBeachCoastalLayerIfUseful`,
`beachCoastalNeedsLayer`); `tripStructuredValueSet` / `tripPieceHasStructuredValue`
/ `tripShoeMatchesAny` (after rewriting their two real keeper-side call sites —
`capsuleVersatilityScore`'s fabric-weight check and `selectCapsuleRoster`'s
shorts-float check — to read `fabric_category`/`fiber_content`/`bottomKind`
directly, no structured-value indirection); `buildCapsuleStructuralSeparateOutfits`,
`rehydrateOutfitPieces`, `slotCompositionPriority`, `seedTripUsedSets`,
`tripOutfitFormulaKey`, `tripBottomSilhouetteKey`; and `composeOutfitSet`
itself, wholesale, per the scope decision — its only other callers were the
two pre-routes, deleted in the same pass (see below), so nothing was left
calling it. **Audit surprise:** several functions the spec's draft expected to
delete turned out to still be load-bearing for `normalizePlanSlots` (KEEP) —
`isIndoorPlanSlot`, `isSmartCasualPlanSlot`, `textLooksLikeEveningPlanSlot`,
`textLooksLikeCoastalPlanSlot`, `normalizePlanSlotEnvironment`,
`normalizePlanEnvironment`, `normalizePlanSlotOccasion`, `slotWantsElevatedShoe`
(via `shoeReserveDemands`), `beachCoastalStatedWeather`, `REGISTER_LEVELS` /
`normalizeRegisterLevel`, and `inferPlanSlotActivity` / `hasDeclaredPlanSlotActivity`
/ `inferPlanSlotActivityFromProse` — all of these stayed, exactly the kind of
drift the grep-audit instruction was meant to catch instead of trusting the
spec's stale line-number inventory.

**Deleted from `routes/ai.js`:** both pre-routes wholesale —
`maybePrecomposeStructuredOutfitsForAsk` (broad-planning/travel),
`maybePrecomposeStructuredFollowupForAsk` (follow-up replan),
`shouldEngageAskPrecompose`, `planPrerouteEnabled`, `followupPrerouteEnabled`,
`isBroadOutfitPlanningText`, `structuredOutfitContextText`,
`planFreeformUseCases` + its `USE_CASE_PLANNER_SYSTEM` prompt +
`normalizePlannerSlots`/`normalizePlannerTripSummary`/`tripCitySlotImpliesWalking`.
The `/ask` handler no longer calls any precompose function — `toolContext` is
built directly from the request body and the model owns every planning turn
via `plan_outfit_set`. `WARDROBE_PLAN_PREROUTE`, `WARDROBE_BROAD_PLAN_PREROUTE`,
and `WARDROBE_FOLLOWUP_PREROUTE` no longer do anything (left in any local
`.env` files harmlessly).

**Deleted from `styling-engine/tools.js`:** the `plan_outfit_set` handler's
engine-mode branch (`WARDROBE_PLAN_COMPOSE=engine` no longer restores
anything — it always returns the model-mode workbench now); the
`classifyPlanPath` / `classifyFollowupPath` / `recordPlanPathDiagnostics`
diagnostics apparatus and the `planComposeMode` / `planKeywordMatched` /
`planPrerouteComposed` / `planModelCalled` / `planPathOutcome` /
`followupEligible` / `followupPrerouteComposed` / `followupPathOutcome`
counters — all of it existed solely to gather evidence for retiring the
pre-routes, a decision now permanent, so the evidence-gathering machinery is
dead weight. `freeform_generation_runs.plan_compose_mode` stays as an inert,
additive DB column (this codebase's migrations are additive-only) but the
insert no longer writes to it.

**Tests:** scorer/classifier unit tests deleted with their subjects, not
ported onto the validator (spec 13 already owns the validator's own tests) —
`test/ask_precompose_gate.test.js` deleted outright (its whole subject,
`shouldEngageAskPrecompose`/`followupPrerouteEnabled`, is gone);
`test/plan_outfit_set.test.js` (2410 lines, ~100 tests) had every test
exercising `composeOutfitSet`, `WARDROBE_PLAN_COMPOSE=engine`, or
`classifyPlanPath`/`classifyFollowupPath`/`recordPlanPathDiagnostics` deleted,
while every test exercising still-live code (`normalizePlanSlots`,
`normalizePlanConstraints`, `buildPlanSlotWorkbench`,
`validateSlotOutfitConstraints`, `validateSubmittedPlanOutfits`,
`assembleSubmittedPlanOutfits`, `selectCapsuleRoster` and its capsule/quota/
reserve helpers, `describeOutfitStructureGap`, `describeSlotCoverageGap`,
`describePlanCapTrim`, or the model-mode `plan_outfit_set`/`submit_plan_outfits`
tool flow) was kept — 57/57 green. Three tests in `test/aiEndpointContracts.test.js`
that specifically exercised the legacy pre-routes behind their reversible flags
(`WARDROBE_FOLLOWUP_PREROUTE=on`, `WARDROBE_PLAN_PREROUTE=on`, plus one
source-scan pinning `composeOutfitSet`'s internals) were deleted for the same
reason. `test/spec9_advisor_mode_precompose_fallbacks.test.js` lost only its
source-scan test (pinned the two now-deleted call sites' exact call shape);
its three direct `locallyGateWholeWardrobeOutfits` regression tests stayed —
that KEPT function is unchanged.

**Taste-shaped incidents with no more automated coverage** (the scorers
retired without a validator replacement, per the spec's "flag, don't guess"
philosophy — these are now live-test-plan items, not unit tests, matching the
house rule that `npm test` can't verify model judgment):
- Office/client structural judgment (a dress "lacks enough office structure",
  shorts/open shoes too casual for a client meeting) — verify a model-composed
  client-meeting slot still reads structured/polished, not casual, on a live
  office-week or client-meeting test.
- Dinner register (casual layers/shoes demoted at a marquee dinner slot) —
  verify a live dinner-slot plan doesn't compose a casual-registering look
  when dressier pieces are available.
- Smart-casual anchor (an elevated-or-better non-shoe anchor required, not an
  everyday city dress plus nicer shoes) — verify a live smart-casual slot.
- Double open-knit-cardigan-under-cardigan layering — verify a live cool-
  weather multi-slot plan doesn't stack two open-knit layers.
- Athletic/sporty piece demotion on non-outdoor-active slots — verify a live
  "everyday"/dinner slot doesn't pull in gym-coded pieces.
- Outdoor-active loafer/dress-shoe demotion — mostly covered by
  `filterWholeWardrobePiecesForGeneration`'s footwear-enum gate now, but
  loafers specifically aren't hard-prohibited in the hiking activity profile
  (only "discouraged"), so worth a live hiking-slot spot-check.

**Ratchet:** verified unchanged, not rebaselined — the ratchet's specific
patterns (`.name.includes(`, `.test(reads_as)`, etc.) already scored 0 for
`outfitSetPlanner.js` before this PR (confirmed by running the pattern scan
against the pre-deletion file directly): the deleted code checked structured
tag Sets (`tripPieceHasStructuredValue`) and wrapped its regex `.test()` calls
in `String(...)`, neither of which this ratchet's naive per-variable-name
patterns catch. Total stayed 238/238. The spec's expectation that this file
was "regex-dense" enough to move the baseline was accurate for the file's
prose-classifier surface area, just not for literal garment-name matching,
which specs 13/18/19's earlier "no name-matching" rulings had already
eliminated from this file before spec 14 ever started.

**Step 0 — pre-existing fresh-clone gaps made hermetic** (found while
verifying "green suite before deletion lands" — turned out the suite had
*never* actually been green on a truly fresh clone, only on this repo's own
long-lived dev checkout):
- Two scratch/ scripts (`check_style_claims.js`, required directly by
  `npm test`'s own prerequisite chain; `backfill_retagger.js`, read by
  `test/gateMetadataPhase1.test.js`) were gitignored and never tracked —
  tracked them now (`.gitignore`).
- Several tests hardcode real personal-wardrobe piece IDs (106, 200, 233, 242)
  that only exist in the developer's local `wardrobe.db` (gitignored). Added
  `test/helpers/dbFixtures.js`'s `ensureFixturePieces()` — seeds exactly those
  IDs, but only when missing, so real local data is never touched or
  overwritten; used by `test/agent_tool_scoping.test.js` and
  `test/hot_weather_ranking.test.js`. Getting the fixtures to actually
  round-trip through the real composer pipelines (not just exist in the DB)
  needed real tag data, not placeholders — e.g. `buildVisualComposerRoster`
  hard-requires a `photo` value and a `formality` tag before a piece survives
  its gates, and `buildWholeWardrobeCandidateOutfits`'s mission-qualification
  step requires a genuine focal color / structured fabric token before ANY
  candidate composes, matching this repo's own documented gotcha ("a minimal
  fixture needs at least one piece carrying a focal color to qualify for
  color_anchor"). Also found and fixed: `buildVisualComposerRoster`'s
  category-cap/scoring path (and the `relevanceAdjustments` debug object,
  including the "hot weather: shorts" adjustment reason) only engages once the
  survivor pool exceeds `maxImages` (90) — true "by accident" on a real
  wardrobe of hundreds of tagged pieces, never true on a small fixture set.
  Fixed by padding the fixture pool past that threshold instead of lowering
  `maxImages` in the test call (tried that first — it shrinks per-category
  quotas too, which broke the SAME test against the real dev DB by crowding
  real shorts out of a shrunk bottom-category cap; verified this failure mode
  live before reverting to the padding approach).
- `db.js`'s first-run wardrobe seed had a genuine check-then-act race: `node
  --test` runs test files in parallel by default, and multiple workers
  importing `db.js` against a brand-new (missing) `wardrobe.db` could all pass
  the `SELECT ... WHERE key='seeded'` check before any of them committed the
  sentinel row, then collide on the `INSERT INTO app_meta` — reproduced
  directly (flaky: 2 different runs against the same fresh clone gave 573/0
  and 559/14 respectively). Fixed with an atomic `INSERT OR IGNORE` claim
  (only the process whose insert actually lands, i.e. `changes > 0`, seeds).
  This closed the crash but not full cross-file interference from parallel
  workers sharing one sqlite file with no per-file isolation, so `npm test`
  now also pins `node --test --test-concurrency=1` — confirmed deterministic
  green across multiple repeated runs on both a fresh clone and the real dev
  checkout after that.

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
   deferred. Still-open follow-up: `indoor` neutralizes weather so
   summer-inappropriate heavy fabrics (a wool dress) can appear in a summer
   office slot (indoor could still respect season for fabric weight).
   **OFFICE scorer print-by-name demotion — FIXED (2026-07-15).** The OFFICE
   scorer kept the same flaw #68 removed from the register scorer:
   `pieceOfficePolishScore` demoted any piece matching
   botanical/floral/tropical/beach/resort by NAME, and the dress-specific
   penalty in `tripOutfitOfficeRegisterScore` did the same plus
   maxi/flowing/full_skirt/a_line_skirt (silhouette) and — inconsistently with
   #68's own reward list — 'lace' (a POSITIVE dressy-fabric signal
   elsewhere in this file). Both replaced with the identical #68 pattern:
   demote by the piece's own `formality` tag (everyday/casual) and casual
   FABRIC (gauze/jersey/terry/fleece/canvas), never by print or hemline. Shoe
   CONSTRUCTION-type demotion (open-toe/espadrille/cork) stayed but moved out
   of the blindly-applied-to-every-role `pieceOfficePolishScore` into the
   already-role-scoped shoe block (it was redundant and unsafely un-scoped
   there — a latent bug independent of the print issue). New isolated test
   (`composeOutfitSet` with the seeded wardrobe's separates cleared so the
   comparison can't be sidestepped): an elevated silk botanical sheath dress
   is kept, a casual jersey dress is demoted. One test-authoring gotcha this
   surfaced: `city`/`smart casual`'s register CEILING is `elevated`, not
   `dressy` — a `dressy`-tagged piece is excluded by that separate, unrelated,
   pre-existing gate before it ever reaches the office scorer at all, so
   fixture formality values must respect the occasion's ceiling or a test can
   silently pass/fail for the wrong reason.

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
   **Smoke criterion updated (spec 25, 2026-07-16):** delivery counts alone no
   longer pass this scenario. The office-week run is green only when it is
   **5/5 cards AND Mon–Wed read office-quiet** (≤1 bold print per outfit, no
   statement wraps/shawls, every accessory's register matches the outfit's
   register). Friday may stay Friday (a legitimately more relaxed end-of-week
   day). This closes the gap the spec-25 live evidence found: 5/5 delivery
   with three of five days composing print-led/artisan was previously read as
   a pass.

Interpretation: blocks-counters firing occasionally = rails working; firing on
every turn = rails too expensive or prompt unclear (find which counter).
Scenarios 3–5 passing is the generalization proof; 1–2 are regressions of known
bugs and must pass; 8 accumulates the retirement evidence for the keyword pre-route.

## Spec 27: sight for visual judgment — IMPLEMENTED (2026-07-16)

**Owner ruling recorded:** norms enumeration (encoding per-occasion styling
norms — office hemlines, print counts — as prompt bullets) is DEAD. It is
scorer whack-a-mole reborn in prompt form. The architecture's thesis holds:
the model's world knowledge covers occasion norms for free; the failures were
never missing knowledge, they were **visual judgments made blind**. Fix the
evidence, not the doctrine.

**Part 1 — print-pairing sight gate (hard, evidence-backed).** A shared
helper, `printPairingSightIssue` (`styling-engine/outfitSetPlanner.js`,
alongside `printedMainPieceIds`), triggers when an outfit's MAIN pieces
(top/bottom/dress/outerwear via `wardrobeCategoryGroup` — accessories
excluded, see the registry below) include 2+ pieces with a known non-solid
`pattern_type` (`pattern_type` present and not `solid`/`none`/empty —
unknown/missing `pattern_type` never triggers; tags are the truth surface).
Every one of those printed piece ids must be in this turn's
`visuallySeenPieceIds` (the seen-set spec 24 Part 3 built for the
layer-over-dress rule — extended, not duplicated) or the outfit is rejected
with coaching naming the unseen ids and `view_pieces`. Wired into both
composition paths, parallel to the existing layer-sight rule each already
had:
- `validateSubmittedPlanOutfits` (`outfitSetPlanner.js`) — plan/submit path.
- `propose_outfit`'s contract-issue block (`tools.js`) — single/small-set path.

**Part 2 — 6b instruction rewrite.** The plan-mode workbench's old default
("Do not call view_pieces for roster pieces; make at most one small
view_pieces call only if genuinely needed" — `buildPlanSlotWorkbench` in
`outfitSetPlanner.js`) is replaced with judgment-to-the-model: view pieces
whose visual coherence is uncertain (prints, statement pieces, layering,
sheer/revealing, unfamiliar silhouette pairings); compose directly from the
catalog for solids/conventional combos; don't bulk-browse the whole roster.
Same principle as the rest of the architecture — license WHEN to look
instead of enumerating cases. Part 1's gate still holds the floor if the
model under-looks on a printed pairing. **Watch `viewCalls` per plan turn**
(diagnostics): expected 1–3 small calls on print-heavy plans, 0 on
solid-basics plans — a drift back to always-browsing-everything is the
regression signal.

**Part 3 — sight-registry (recorded, no code yet).** Candidate future hard
gates, promoted only when live evidence shows Part 2's soft policy missing
them (the same evidence path that earned layering its spec-24 gate and
prints Part 1 above): sheer-as-coverage in a coverage-bearing role;
high-`bareness` piece in a professional-context slot; printed accessories
(scarves/wraps) joining the print-pairing trigger; silhouette bulk pairings
(voluminous over voluminous); unknown-`pattern_type` pieces in
multi-statement outfits. None implemented — this is a watchlist, not a plan.

Tests: `test/plan_outfit_set.test.js` (blind two-print rejected + coached
ids, seen accepted, one-print-plus-solids passes unseen, unknown
`pattern_type` doesn't count, printed accessory doesn't trigger) and
`test/aiEndpointContracts.test.js` (same three shapes on the `propose_outfit`
path: blind rejected, seen accepted, printed scarf accessory doesn't gate a
single printed top). 577/577 full suite green.

## Spec 21: the cleanup PR — hermetic tests, dead-code sweep, trip-scope machinery, and the prose-parser ruling — IMPLEMENTED (2026-07-17)

Evidence source for every deletion in this PR: `docs/cleanup-inventory.md`
(spec 20's read-only audit, re-verified 2026-07-17 against `origin/main`
after specs 22-27 landed — still held). This PR is the delete-only follow-up
that inventory recommended.

- **Part 1 (P0, live data-safety fix).** `test/occasion_exclusion.test.js`,
  `test/hot_weather_ranking.test.js`, `test/freeform_observability.test.js`,
  and `test/visual_composer_roster.test.js` imported `db.js` (and, transitively,
  `rules.js`/`tools.js`/`routes/ai.js`) statically, before any test-local env
  var could take effect — so they read/wrote the developer's real
  `wardrobe.db`, including `hot_weather_ranking.test.js`'s
  `DELETE FROM todos WHERE type = 'metadata'` and
  `freeform_observability.test.js`'s `DELETE FROM freeform_generation_runs`,
  both global wipes of real tables. Fixed with the established
  dynamic-import-after-env-var pattern (`test/plan_outfit_set.test.js`'s
  precedent): a `tmpRoot`/`WARDROBE_DB_PATH`/`WARDROBE_UPLOADS_DIR` setup
  block first, then every module that touches `db.js` (directly or
  transitively) imported via `await import(...)` instead of a static
  `import`. `hot_weather_ranking.test.js`'s `ensureFixturePieces` real-ID
  fixture pattern was kept, now seeding into the isolated tmp DB instead of
  the live one. **Acceptance check, verified directly, not assumed:**
  `wardrobe.db`'s mtime (`Jul 16 22:19:26 2026`) was captured before this PR's
  changes and confirmed byte-identical after every subsequent full `npm test`
  run in this PR, including the Part 1-3 combined run and the final Part 4
  run.
- **Part 2 (mechanical, zero behavior change).** The dead
  `tripRequestNeedsScopeClarification` import in `routes/ai.js` died as part
  of Part 3 (its real subject was deleted, not just the unused import). The
  ~23-line `WARDROBE_PLAN_COMPOSE` save/restore ceremony in
  `test/plan_outfit_set.test.js` (module-level baseline + four per-test
  try/finally blocks) was removed — the flag has had zero production reads
  since PR #106; every wrapped assertion already only checked model-mode
  behavior, so removing the ceremony changed no test outcome.
  `scratch/diagnose_anchor_selectivity.js` (tracked, `.gitignore`-whitelisted,
  referenced nowhere) was deleted along with its whitelist line.
- **Part 3 (owner-ruled retirement, flag window closed).** The
  `WARDROBE_TRIP_SCOPE_CLARIFICATION` clause — spec 18 Part 2's reversibility
  window — is deleted outright: `tripScopeClarificationEnabled` and the
  clause body in `applyFreeformOutputChecks` (`provider.js`),
  `tripRequestNeedsScopeClarification` + `TRIP_ACTIVITY_OR_USE_CASE_PATTERNS`
  (`stylingIntent.js`), the `tripScopeClarificationRetries` counter
  (`tools.js` — it had no `persistFreeformGenerationRun` write to remove;
  census 3 flagged it as DB-only but it turned out to only ever reach the
  client-side `debug` object), and both the flag-on guard test
  (`aiEndpointContracts.test.js`) and the flag-off default-behavior test that
  exercised the same now-fully-deleted mechanism, plus
  `tripRequestNeedsScopeClarification`'s three unit tests
  (`stylingIntent.test.js`). `destinationClarification` is untouched, per the
  spec's explicit instruction — no misfire evidence exists for it.
- **Part 4 — owner ruling: DELETE.** `parseStructuredOutfitsFromAssistantText`
  (`StylistChat.jsx`) is deleted, along with everything that existed solely to
  feed it: `mergeCurrentOutfitSet`, `normalizeOutfitPieceName`,
  `resolveNamedWardrobePiece`, `OUTFIT_CARD_RESPONSE_PATTERN`, the dead
  `replyConversationMode` tracking variable (write-only once its one reader
  was gone), the `freeform_current_set` branch in
  `compactGeneratedOutfitContext` (no caller has passed that source string
  since the parser's call site was removed), and the
  `outfit.unresolvedPieceNames` card-rendering block (nothing produces that
  field anymore). The real guarantee against unproposed-outfit prose was
  already server-side (`outfitProseWithoutToolCall`'s hard block, spec 11) —
  this was a dead client-side safety net for a prose format `STYLIST_SYSTEM`
  has forbidden the model from writing since the `propose_outfit` migration.
  The source-scan test pinning this machinery
  (`'StylistChat parses freeform outfit sections into current outfit
  memory'` in `aiEndpointContracts.test.js`) was deleted with its subject.
  **`dist/` rebuilt** in this PR (frontend change, repo convention).
- **Documentation hygiene.** `.env.example` gained a note that
  `WARDROBE_PLAN_PREROUTE`, `WARDROBE_BROAD_PLAN_PREROUTE`,
  `WARDROBE_FOLLOWUP_PREROUTE`, and `WARDROBE_PLAN_COMPOSE` are dead flags
  (deleted with spec 14); the repo-local gitignored `.env`'s now-pointless
  `WARDROBE_FOLLOWUP_PREROUTE=off` canary line was removed so the real
  (nonexistent) behavior isn't masked in dev, same precedent as spec 19 Part
  4's `WARDROBE_PLAN_COMPOSE=model` cleanup.

**Carried forward from the inventory, still open, not addressed by this PR**
(both explicitly out of scope per the spec):
- The devtools-only diagnostics UI gap — `intentDeclared`, `viewCalls`,
  `renderCalls`, `coverageCalls`, `composeWithoutDeclaredIntent`,
  `proposeAfterPlanOutfitSetBlocked`, `proposeUnverifiedPieceBlocks`,
  `proposeUnseenLayerBlocks`, `planOutfitSetCalls` reach the client via the
  `debug` object but aren't rendered in the visible "Search & validation
  details" panel. Optional wiring, owner's call someday.
- `rules.js`, `core.js`, `attributes.js`, `occasions.js`, `weather.js`,
  `taggerMerge.js`, `softScoreFloors.js`, and `routes/crud.js` were never
  given a line-by-line reachability audit — needs its own commissioned pass
  if ever wanted, not assumed clean by omission.

Full suite: 571/571 (`npm test`, fresh run against this PR's final state,
Part 1 acceptance re-verified). Ratchet: unchanged in every file except
`stylingIntent.js`'s allowed-debt ceiling, which dropped from 3 to 1 as a
side effect of Part 3 deleting `TRIP_ACTIVITY_OR_USE_CASE_PATTERNS` — no new
debt, a real reduction.

## Spec 29 — post-audit fixes and cleanup — IMPLEMENTED (2026-07-17)

The audit arc that opened with spec 20 and continued through spec 21 (cleanup)
and spec 28 (whole-app inventory) is now **complete**: every app surface either
audit named has been walked at least once, and every finding from spec 28 has
been fixed, deleted, renamed, or explicitly closed as intentional — nothing is
being carried forward into a future spec. One PR, Part 1 (the P0 gate fix) as
its own first commit:

- **Part 1 (P0):** `normalizeWholeWardrobeOutfitObject` was silently trimming
  outfit pieces to `{id, name, category, photo, worn_photo}` before
  `/evaluate-piece`'s two candidate paths reached `locallyGateWholeWardrobeOutfits`,
  so every structured gate downstream read `undefined` and quietly degraded to
  name-text matching — a second, independent live occurrence of the same bug
  class this doc's capsule-builder section already found and fixed once in
  the now-superseded `outfitSetPlanner.js` composer. Fixed by rehydrating
  `outfit.pieces` against `candidatePieces` by id inside
  `locallyGateWholeWardrobeOutfits`, immediately before `profileFits` runs —
  every caller gets it automatically, regardless of `repair`/`advisorMode`.
  Regression test runs the real production sequence and was verified red
  against pre-fix code.
- **Part 2 (P0):** `test/threadRail.test.js` was the fifth non-hermetic DB
  test — spec 21 Part 1's isolation fix had covered four others but missed
  this one. Same dynamic-import-after-env-var pattern applied.
- **Part 3:** mechanical dead-code sweep — ~60 unused imports in `core.js`,
  five dead functions, one always-null response field. Zero behavior change,
  576/576 tests green throughout.
- **Parts 4–5:** deleted the never-shipped identity-feedback family (7 files)
  and `VisualLab.jsx`'s dead `activeContext` prop/branch + stale doc comment.
  `dist/` rebuilt in the same PR.
- **Part 6:** renamed `attributes.js`'s duplicate `pieceTextBlob` to
  `attributePieceTextBlob` — kills the identical-name footgun against
  `rules.js`'s own (already-diverged) implementation, zero behavior change.
  Consolidation stays deliberately deferred.
- **Part 7:** `docs/cleanup-inventory.md` closed out with this spec's
  execution record, including the devtools-diagnostics UI gap now marked
  **CLOSED — affirmed keep-as-is** by owner ruling (two prior audits had
  independently recommended the same thing).

## 2026-08-19 — bounded-router review hardening and shared-composer boundaries

The bounded ordinary-request architecture is accepted; this pass hardened its boundaries without
adding a paid step. `boundedAtomicMultiLookResponse` now writes the actual ready count.
`boundedConversationStateFromToolContext` persists the generated set and established context before
the direct `/ask` return, while every browser `/ask` branch supplies its real thread ID. The prose
integrity detector no longer erases legitimate instructions containing “wait” or “must use”; it
continues to catch recognizable rebuilding/checking/recent-memory deliberation.

Two changes are explicitly global by owner ruling: direct Visual Composer “Current season” resolves
saved-home live weather, and every shared whole-wardrobe composer receives wear facts plus the
explicit `styling_instructions` renderer contract. These are not flag leakage. Comparison guidance
is narrower: bounded options, direct Visual Composer, and adjacent exploration receive it;
formula-similar saved-outfit variants do not. Failed named-location forecasts remain neutral for
all callers, but plan weather labels now state that the forecast is unavailable and temperature is
unknown rather than claiming a seasonal estimate.

Live dinner thread `thread_1787101448245` proved that ordinary prose produces explicit renderer
instructions without application inference. It also showed a 70°F/55°F evening card without a
layer. The shared composer now judges the time-relevant end of the numeric range and asks for a
removable arrival/departure layer when supported, including for indoor destinations. This remains
model judgment inside the mild band, not a new deterministic weather gate.

Live dinner thread `thread_1787103270104` then showed why “plausible layer” was too loose: a
sleeveless vest over a light top was narrated as handling a 55°F transit. The shared prompt now
rejects that specific physical claim and requires sleeve-bearing outerwear, a genuinely warm
long-sleeved base plus an adequate layer, or a wardrobe-gap disclosure. The same hardening closes
the review's hybrid run-3 loss: bounded generation is ineligible once a valid card already exists,
so it cannot overwrite that card. Composite display-season strings still round-trip through
memory; carrying resolved weather physics separately is recorded as follow-up work.

The same live thread exposed a separate truth-surface omission: the composer saw lace visually but
did not receive the stored `opacity:opaque` and `needs_base:no`, so it invented sheerness and a nude
camisole. `composerPieceLineSuffix` now transmits opacity plus either explicit base status, and the
shared prompt forbids contradicting those fields or inventing an underlayer for an independently
wearable garment.

**2026-08-24 required-base consolidation:** the whole-wardrobe composer no longer owns a separate
list of acceptable base-layer fits. Its instruction is projected by
`requiredBaseLayerPromptRule` from the same module that executes `evaluateBaseLayerCandidate` and
`evaluateRequiredBaseLayers`. The established card fact remains “Needs a base layer.” For that
specific dependency, known sheer/open coverage or a known loose fit is incompatible; incomplete
legacy fit/opacity requires seeing both garments in `propose_outfit`, after which visual success is
still model judgment. Ordinary inner-garment/outer-layer styling is explicitly outside the
close-fit rule. The prompt no longer promotes visual inference over an explicit `needs_base` value.
Tool schemas and the model-call sequence did not change.

## 2026-08-19 — compact text-profile follow-up arc

`docs/freeform-followup-profiles-spec.md` begins the next cost phase without changing visual
composition. Slice 1 makes provider entry points fail closed under `NODE_ENV=test`, even when a
real credential exists in dotenv/operator state. Slice 2 persists normalized live/stated weather
physics separately from display season prose, so follow-ups do not reclassify a mild numeric range.

Behind `WARDROBE_FREEFORM_COMPACT_ANSWERS=true`, the small model-owned router may now select one of
three no-tools answer profiles: explanation/comparison of the verified current cards; an answer
from structured facts for verified garment subjects; or general styling education with no wardrobe
context. Each makes one bounded answer call and returns before the full manifest is built. Missing
cards, unresolved IDs, composition/revision intent, visual questions, or ambiguity fall through to
the existing full stylist. Provider-free contracts are green; paid live validation remains owner-
approved only.

Slice 6 is implemented separately behind `WARDROBE_FREEFORM_BOUNDED_HISTORY=true`. The full tool
loop keeps at most four recent exchanges/eight messages, 12,000 characters total and 3,500 per
message. This caps only browser-supplied prose: server-owned cards, established context, normalized
weather physics, durable feedback memory and the wardrobe manifest remain outside the window. It
is deterministic and records count-only reduction diagnostics; it does not spend a model call on a
summary. Slices 7–10—prompt ownership, deferred tools, bounded discovery and measured rollout—are
specified but remain independent later phases.

Slice 7's first pass is now implemented. `docs/freeform-prompt-ownership.md` assigns each instruction
family one owner. The volatile controller keeps one `Turn directive` and only irreducible cross-tool
routing; tool descriptions own their eligibility, arguments and mechanical result. The duplicate
mode paragraph, four unconditional mode reminders and repeated intent/swap/render schemas are gone.
The stable cached Style Constitution/profile/manifest prefix is intentionally untouched pending a
separate quality-and-cache review.

Slice 8 is implemented as an Anthropic-only experiment behind
`WARDROBE_FREEFORM_DEFERRED_TOOLS=true`. The measured catalog is 14 tools/~7.3k rough schema tokens.
Five core tools stay eager; nine use Anthropic BM25 tool search and `defer_loading:true`, keeping
more than half the schema characters out of initial model context while preserving the cached
prefix. Server search blocks are not sent to the local executor. A compatibility 400 retries once
with the unchanged full catalog. OpenAI remains unchanged because this app uses Chat Completions
with `gpt-4o`; `allowed_tools` restricts calls but does not defer definitions. No paid validation has
run. See `docs/freeform-deferred-tools-spec.md` before enabling the flag.

### 2026-08-19 — slice 9: tiered wardrobe discovery

Owner ruling: preserve wardrobe omniscience at the identity and discovery level, not at the
full-detail prompt level. No active garment may become undiscoverable because it was omitted from a
shortlist; expand when identity, coverage or viable choice is uncertain.

Implemented behind `WARDROBE_FREEFORM_TIERED_DISCOVERY=true`. Every active ID/name/category plus a
brief visual read remains in the full-stylist prompt. Named-piece truth expands through view/details,
composition through full-database search, and exact coverage through `wardrobe_coverage`; sparse or
uncertain searches must broaden before declaring a gap. Recently-shown memory cannot remove an index
identity. The lightweight presence flag is separate from `wardrobeManifestIncluded`, so detailed
search rows remain untrimmed. A read-only current-wardrobe copy measured 57,817 → 15,941 characters
(−72.4%) while retaining all 251 active identities. No paid validation has run. The specification
and four-case live matrix are in `docs/freeform-tiered-discovery-spec.md`.

The first exact-count live run, `thread_1787116405571`, was correct (251 active pieces; zero
searches) but still took three provider iterations because `full_stylist` called `declare_intent`
before answering. The compact router now has a narrow `wardrobe_inventory` outcome for exact active
counts/breakdowns. Code formats database counts and returns after the router; sufficiency, gaps and
styling judgment deliberately stay on `full_stylist`.

Named-piece run `thread_1787116925244` found the correct tee but answered against its saved
`tucks_anywhere` value because the cheap view truth omitted `tuck_behavior` and the model inferred a
hard no from `straight_loose`. Owner correction: do not make tags infallible either. Direct garment
questions use an evidence hierarchy—manual/high tag strong, missing/low inferred cautiously from
the full construction evidence, visible contradiction disclosed, hem alone never decisive—while
automatic composition remains conservative. Tuck behavior now rides view/search truth and compact
facts with confidence; an exact unique saved name can seed compact garment-fact routing without the
full stylist.

The corrected live run `thread_1787117547066` passed judgment and cost (two small calls, no cached
prefix) but narrated `tuck_behavior`, `tucks_anywhere`, and “manual confidence” to the owner. Compact
fact prompts now use confidence silently and forbid raw field names/enums/JSON-like language unless
the user explicitly asks about metadata.

The next live run, `thread_1787117753981`, established why “compact” cannot mean tag-only for garment
mechanics. Piece 364's fabric was mistagged, its construction confidence was low, and tuck behavior
was absent; the model treated a straight hem as an untucked design signal and asked for a photo that
was already stored. The saved worn photo visibly demonstrates a clean full tuck. The garment-fact
profile now receives a bounded saved-visual supplement through `compactGarmentVisualEvidence`: worn
then hanger, no more than four 640px low-detail images, only for already-resolved subjects. This is an
evidence expansion of the compact profile, not a return to wardrobe-wide visual composition.
Owner clarification: a worn photo proves that a configuration can be done, not that it looks good.
The model must evaluate the shown result separately and may not declare an unseen alternative better.

Slice 10's offline routing corpus is now tracked at
`test/fixtures/freeform_execution_routing_corpus.json`: 22 cases, all six profiles and ten request
classes. Its hermetic provider hook proves the structured routing boundary and supplied context, not
the live model's semantic accuracy. The economical live sequence and per-flag default-on thresholds
are in `docs/freeform-measured-rollout.md`.

First rollout call `thread_1787119133701` proved the cheap path (two calls, 2,530 input / 522 output,
zero cache or wardrobe access) but failed quality: it made fitted structure and upgraded finishing
elements sound mandatory for smart casual, used “real bag,” and reduced casual to shapeless errands.
The general-advice prompt now requires multiple valid pathways, optional whole-outfit signals,
tendency-versus-rule clarity, and non-denigrating language.
Corrected run `thread_1787119607911` passed at two calls, 2,638 input / 525 output and zero cache or
wardrobe access. It called tailoring one pathway rather than a requirement and preserved contextual
variation. The remaining conventional polish bias was phrased as optional signals, so the rollout
moved on rather than paying for another wording iteration.

Saved-photo rollout `thread_1787120404670` exposed a routing gap: “look good tucked” remained a
generic visual-fit fallback even though the exact resolved garment had saved photos. It paid three
calls and ~25k cache creation, then guessed cotton-blend from appearance; no DB fiber fact existed,
so the error was overclaiming what sight can establish, not ignoring stored viscose/modal truth.
The router now gets a presence-only saved-photo count and may choose bounded `garment_fact` for a
shown wear-mechanics result. Compact and `view_pieces` contracts restrict photos to visible drape,
bulk, texture and behavior—never exact fiber composition or automatic styling preference.

The 2026-08-19 rerun (`thread_1787121042557`) showed that “may choose” was too weak: despite exact
identity and saved photos, the model router again selected the full tool loop and guessed
“cotton-feel.” Exact-name + saved-photo tuck/untuck requests therefore receive a deterministic,
narrow `garment_fact` override after routing. This is request-shape routing, not a garment judgment;
pairing, outfit construction, ambiguous identity and broad fit critique still use the full stylist.
The compact visual contract requires a direct, respectful judgment of the visible garment-and-body
interaction. It may say a tuck fights the wearer’s proportions and recommend an untucked comparison
as the likely stronger presentation. It must not invent a hidden cause, claim the unseen result is
proven, diagnose the wearer’s body, or generalize one photographed interaction into a body rule.

The subsequent live attempt reached the compact branch but its image blocks lacked Anthropic’s
required `source.type: "base64"`; the surrounding router catch mislabeled that answer-call 400 and
paid for the full stylist. `compactGarmentVisualEvidence` now emits provider-valid internal image
blocks. For this deterministic saved-photo wear-mechanics route, any router or compact-answer
failure is surfaced rather than silently converted into a costly full-manifest retry.

`thread_1787121983218` passed the repaired path at two calls, 4,124 input / 510 output, zero cache and
two saved images. The answer correctly judged the photographed tuck rather than mere feasibility,
but invented a partial front tuck as the remedy. Unseen alternatives must now stay mechanically
simple and adjacent: compare fully untucked before prescribing partial/French/asymmetric treatments,
unless supplied evidence specifically supports the more elaborate mechanic.

Coverage thread `thread_1787122233484` exposed the next open-loop failure: four calls, one ordinary
search treated as exhaustive, a heavy winter coat counted in a lightweight audit, and material
treated as rain evidence. `qualified_coverage` is now a generic bounded profile. The router extracts
category, requested clothing weight and practical capability; code supplies the complete category
census plus up to eight lexical-relevance-ranked saved visuals. The answer separates all-qualifier
matches from backups and states the failed dimension. Clear purpose-built visual identity can
correct weak metadata, but leather/cotton/twill/nylon alone cannot prove rain handling.

The first bounded run (`thread_1787123008051`) achieved two calls and zero cache but was too literal:
it audited sheer cardigans because they shared `outerwear`, exposed IDs/`fabric_weight`, and equated
the `light` enum with practical lightweight outerwear. Owner ruling: a lightweight-jacket request
must not inspect a sheer cardigan. The router now supplies a generic garment kind, resolved by the
centralized `garmentKind` reader; practical weight uses tags plus visual evidence. Weekly sufficiency
means repeatability/maintenance/backup, and final prose hides internal fields and deliberation.

Owner architecture correction: do not anticipate every possible coverage question through more
property-specific prompt clauses. The router now emits an arbitrary constraint array plus usage
context. A structured bounded judge classifies census pieces as primary, plausible-but-unverified,
backup-with-missed-dimensions, or unknown. Code rejects IDs outside the census and renders names.
The reusable authority is evidence provenance—explicit/owner fact, visual observation, provisional
inference, unknown—and inference cannot silently become a verified fact.

`thread_1787123957953` showed the generic prompt still did not enforce that authority: the model
promoted visible utility hardware into confirmed latent rain performance and treated a week as a
seven-piece need. Constraints now carry observability; result rows carry evidence basis. Code
downgrades latent primary matches supported only by sight/inference. Router `coverage_minimum`
defaults to one unless the request explicitly needs simultaneous use, rotation, maintenance,
drying, or backup. Deterministic rendering computes the verdict, strips IDs/internal fields, and
bounds every reason plus the whole response.

The 2026-08-19 non-outerwear run (`thread_1787126412249`) exposed the opposite overreach. The
bounded judge found only two elevated-labelled flats and called both unverified, while pieces 169
and 361 have owner-confirmed medium walk support and can participate in polished dinner outfits;
piece 190 is also contextually plausible. Owner ruling: do not solve this with dinner, loafer or
shoe-specific branches. Deterministic eligibility owns hard scope only (active status, category,
requested garment kind and other physical validity). Contextual qualities such as “dressy” remain
model judgment about the garment in the requested use, not equality against `formality`, occasion
or style labels. Latent physical claims such as walkability keep their stricter same-dimension
evidence requirement. The bounded prompt now states both halves explicitly and requires contextual
judgment across the complete census, including unpictured pieces.

The immediate rerun (`thread_1787127928718`) proved that instruction alone was insufficient. It
changed the verdict to sufficient but still discussed only the four visually sampled shoes and
omitted the owner-identified contextual candidates. The single judge was visually anchored: 33
text rows and four photographs were presented as if they were equivalent evidence, while input
cost stayed at ~16.5k tokens. Coverage therefore uses staged evidence. The complete kind census is
first judged as compact text with no photographs, requiring every credible candidate to survive.
Only that bounded candidate set may receive a second visual refinement, and only when a constraint
is observable or mixed and a saved photograph exists. Unpictured candidates remain in scope;
visual evidence can refine a visible contextual claim but cannot erase stronger physical facts or
prove latent performance. Coverage-specific census rows also omit unrelated wear-mechanics fields.
This path intentionally permits a third small provider call (router, census, optional visual
refinement) when sight materially helps; latent-only audits remain two calls.

The staged live run (`thread_1787128659041`) retained piece 361 but still omitted pieces 169 and
190 before visual refinement. It cost three iterations, 19,384 input and 2,867 output tokens—more
than the single-judge path—then exposed evidence machinery, malformed ID references and truncated
multiple sentences. This is not accepted for default-on. The next coverage design must make the
text census a recall stage that excludes only clear physical failures, then present the complete
physically viable candidate set to contextual visual judgment (for example as a bounded contact
sheet rather than four privileged individual photographs). The final answer must come from shorter
structured fields plus deterministic natural-language rendering. Do not add shoe-, dinner- or
garment-specific branches to force the observed candidates.

Sparse-discovery run `thread_1787128902650` tested the gallery-opening request from the live matrix.
Discovery quality passed: the first narrow top lookup returned nothing, the model broadened, found
piece 996783, retrieved support categories and submitted one valid structured outfit with pieces
996783, 92, 196 and 996771. Execution cost failed: nine provider iterations, five searches, 60,532
cache-creation tokens, 212,147 cache-read tokens, 2,174 uncached input and 1,875 output. The answer
also leaked search narration and IDs, repeated the accepted composition, contradicted itself about
piece 359, and left the card's `stylingInstructions` empty despite an explicit untucked mechanic.
Tiered discovery therefore preserves wardrobe reach but does not yet bound an ordinary composition
loop. Next work is a batched discovery primitive that returns broadened anchor candidates and the
needed support categories together, followed by one composition/submission call. Intermediate
narration must be discarded, requested wear mechanics must reach the verified card, and local final
prose should not duplicate that card.

### 2026-08-19 — qualified coverage removed; coverage becomes a batched-discovery use case

Owner ruling: coverage is worth pursuing as a product capability; `qualified_coverage` as a separate
execution architecture is not. Five versions each moved the same problem — full stylist (expensive,
non-exhaustive), census plus selected photographs (visually anchored), text census plus visual
refinement (still incomplete and more expensive than the single judge), strong deterministic
constraints (an expanding rules engine), loose model judgment (misses owner-valid options). An
arbitrary coverage question combines physical fact, owner experience, wrong metadata, visual
judgment, contextual styling judgment and quantity requirements, which is the whole stylist problem;
a generic coverage pipeline was becoming a second stylist architecture.

The profile was removed rather than moved behind its own flag. With the architecture decided against,
a flag would have kept frozen code reachable while still costing 42.7% of the router schema and 26.6%
of the router prompt on every request, and would have required dynamic schema/prompt construction.
Static removal makes every router call smaller instead. Deleted: the enum value, five `coverage_*`
schema fields, the router prompt paragraph, a 99-line execution branch, seven coverage-only helpers
and eight tests. The routing corpus row now expects `full_stylist`, which is what actually happens.

Also fixed in the same pass: `/api/ai/ask` returned a 500 on the **flags-off default path** —
`Object.assign(toolContext.freeformDiagnostics, …)` ran before any `bumpFreeformDiagnostic` had
lazily created that object, since every other initializer sits inside a compact-profile branch
(21 failing tests). And slice 7's prompt dedup had quietly relaxed "ask exactly one clear clarifying
question" to "one", plus dropped the placeholder-list prohibition; both were restored, because dedup
was contracted to preserve behaviour, not to loosen it.

Cost finding recorded for whoever builds batched discovery: turn cost is driven by **iteration
count**, not prompt size. `withMovingCacheBreakpoint` stamps a fresh breakpoint per tool-loop
iteration, so each iteration writes a new cache entry over the whole conversation at 1.25×. In
`thread_1787128902650` that was 69.8% of the turn. Tiered discovery's 72.4% smaller wardrobe block
saves ~$0.064 there while the extra iterations its expansion contract induces cost ~$0.076. Rollout
row 5's OFF arm was never run, so tiered discovery has no baseline.

### 2026-08-19 — compact-router eligibility narrowed

Enabling `WARDROBE_FREEFORM_COMPACT_ANSWERS` previously bought a router call on **every** text turn:
`boundedRouterEligible` was guarded by `new_request && !activeContext && !pieceIds.length`, but
`compactRouterEligible` was the bare flag. Corrections and follow-ups that cannot reach a compact
profile therefore paid the router on top of the full loop. Eleven of the twenty-two routing-corpus
rows expect `full_stylist`.

`compactRouterTurnHasContext(conversationMode, context)` (exported from `routes/ai.js`, unit-tested)
now gates it: a fresh request reaches any profile; a verified current outfit set reaches
`existing_card_explanation`; a resolved garment subject reaches `garment_fact`. One subject test
suffices because `compactFreeformContext` already folds activeContext, body `pieceIds`, exact named
pieces and current-card pieces into `pieceIds`.

**Accepted miss, recorded deliberately.** `general_advice` and `wardrobe_inventory` need no context,
so a follow-up in a thread that never produced a card or subject falls through to the full stylist —
the cheapest profiles landing in the most expensive path. This is a heuristic trade, not a derivable
rule: general education is always answerable, so no turn is *provably* compact-ineligible and any
narrowing costs something. Do not widen it by argument. The proxy for the real miss rate is already
persisted — rows with `execution_router_calls = 0 AND search_calls = 0` are turns the full stylist
answered without ever touching the wardrobe. The in-memory diagnostics also carry
`compactRouterSkippedNoContext` for the dev debug panel; promote it to a column if the query proxy
proves too coarse.

### 2026-08-19 — dormant experiments removed rather than shipped

Owner ruling: do not ship dormant architecture. An experiment nobody intends to enable is
maintenance and prompt cost without benefit, and provider-specific machinery constrains the next
redesign. Removed entirely, not flag-gated:

- **Deferred tools** (`WARDROBE_FREEFORM_DEFERRED_TOOLS`) — flag, `anthropicDeferredToolPlan`,
  `anthropicModelSupportsToolSearch`, the compatibility fallback, the eager-tool set, server
  tool-search accounting, four diagnostics, four `freeform_generation_runs` columns, three tests. It
  hid schema characters without touching the iteration/cache pattern that drives cost.
- **Tiered discovery** (`WARDROBE_FREEFORM_TIERED_DISCOVERY`) — flag, the index prompt assembly and
  its expansion contract, `buildWardrobeDiscoveryIndex`/`buildWardrobeDiscoveryIndexLine`, the
  `wardrobeDiscoveryIndexIncluded` diagnostic, and its tests. The principle survives in batched
  discovery; the implementation was coupled to the loop that failed the cost test.
- **Qualified coverage** — removed earlier the same day (see above).

`wardrobeManifestIncluded` stays: it drives search-row trimming, and with the index gone the manifest
is the single wardrobe representation again. The over-cap case — no manifest in the prompt, so search
must return full stable truth — is still covered by a renamed test; it was previously only exercised
through the tiered path.

**Kept dormant, deliberately:** `WARDROBE_FREEFORM_BOUNDED_HISTORY` alone. Small, isolated,
deterministic, offline-tested, and not tied to the failed discovery architecture — it lacks only a
long-conversation validation, so removing and recreating it would cost more than keeping it.

**Kept regardless of flags:** provider-usage accounting, history diagnostics, server-owned
conversation state, weather-physics persistence, prompt ownership/dedup, API-key test guardrails, and
the `freeform_generation_runs` observability needed to measure the next architecture.

Documentation was marked historical, never deleted: both specs keep their measurements, and the
tiered spec's wardrobe-independence clause remains a requirement for any successor.

**Note on existing databases.** The four `deferred_tool_*` columns are dropped from the schema and
the INSERT, but an already-migrated dev database keeps them as vestigial `DEFAULT 0` columns. They
are harmless and unread; no destructive migration was added to remove them.

### 2026-08-19 — cross-turn cache prefix restored (measured, 89% less cache creation)

The current turn's user message carried a `Today is …` line that browser history never replays, so
message 0 differed between the turn that sent it and the turn that replayed it. Anthropic matches
prompt cache on exact prefix, so that one difference invalidated the **entire message array** on every
follow-up: each turn rewrote the conversation instead of reading it. The date already sits in the
volatile system half with its usage instruction, so the copy in the user turn was pure duplication.

Live confirmation on `thread_1787128902650`, two consecutive follow-ups: cache creation
**43,191 → 4,730 (−89.0%)**, cache cost per follow-up **$0.1749 → $0.0418 (−76.1%)**, with 4 uncached
input tokens on both turns. Anthropic treats the plain string and single text-block representations
compatibly, so no wire-shape normalisation was needed.

**Do not re-add anything to the user turn that history will not replay.** Guarded by
`the message array stays a cacheable prefix across turns until the history window slides`
(`freeform_observability.test.js`), which also asserts the stable system prefix is byte-identical
across turns and that a slid history window is *expected* to change message 0.

Three earlier cost hypotheses were tested and disproven along the way — iteration count dominating,
TTL expiry between turns, and the moving breakpoint duplicating writes. All three are recorded with
their evidence in `docs/freeform-batched-discovery-spec.md` so they are not re-proposed. Iterations
drive cache *reads*, which are only 13.2% of recorded spend.

Bounded history is now proven for both trimming and pre-slide cache reuse. Its sliding window
necessarily ends prefix reuse once full — an accepted, asserted tradeoff, not a regression. A stepped
window (drop N exchanges every N turns rather than one every turn) would convert "miss every turn"
into "miss every Nth turn" and is recorded as an untaken option.

### 2026-08-19 — step 6: the freeform architecture is unconditional

All five validated flags removed and made default behaviour. **There are now zero
`WARDROBE_FREEFORM_*` flags in the codebase**, and a test asserts they cannot come back
(`assert.doesNotMatch(routeSrc, /WARDROBE_FREEFORM_/)` in `freeform_observability.test.js`).

| Removed flag | Now |
|---|---|
| `WARDROBE_FREEFORM_ATOMIC_MULTILOOK` | bounded 2–5 look composition, always |
| `WARDROBE_FREEFORM_EXECUTION_ROUTER` | model-owned execution routing, always |
| `WARDROBE_FREEFORM_ADAPTIVE_VISUALS` | adaptive image detail, scoped structurally to the bounded path |
| `WARDROBE_FREEFORM_COMPACT_ANSWERS` | compact profiles, always, within the eligibility rule |
| `WARDROBE_FREEFORM_BOUNDED_HISTORY` | bounded prose window, always |

Scoping that used to come from a flag now comes from turn shape, which is where it belonged:
`declareBoundedMultiLookIntent` gates on `turnMode === 'new_request'`, no `pieceId`, count ≥ 2 and no
prior declared intent; `stylistToolsForTurn` amends tool descriptions only for `new_request`;
`compactRouterTurnHasContext` gates the compact router; adaptive visuals ride `boundedMultiLook`.

Earlier in the same day, three unshipped experiments were deleted rather than left dormant
(`qualified_coverage`, deferred tools, tiered discovery), and the cross-turn cache prefix was
restored. Net effect: nothing in the freeform path is behind a flag, and nothing dormant ships.

### 2026-08-19/20 — batched retrieval, and what three live turns actually showed

`search_wardrobe` was promoted rather than duplicated: it already took `category` as an array and
already budgeted thumbnails per category, so the multi-category batch existed and nothing told the
model to use it. Added: the batching instruction, an automatic relaxation ladder (free text → soft
descriptive filters → occasion tag confidence, never category/status/exclusions), and a `retrieval`
summary reporting what was relaxed and which categories are genuinely empty. The summary is appended
only when there is a compromise to report, so the 37 existing call sites see no shape change.

**Three live turns, measured** (`scratch/measure_freeform_turns.js`, which reads the answers back out
of `chat_threads`):

- An ordinary "what should I wear?" routes to `bounded_multi` — 2 iterations, **zero searches**,
  $0.1613 — so it never touches this work. Batching only applies to the one/best/anchored path that
  goes to `full_stylist`. **Whether the model batches is still unverified**, deliberately: it is a
  latency change, not a cost one, and `tool_sequence` records it for free on the next natural
  one/best request.
- Coverage now costs **$0.2138 at 4 iterations** against the deleted profile's $0.0708–$0.1012.
  Removing `qualified_coverage` made it 2–3× more expensive. The cost is iterations re-reading ~125k
  cached tokens, which is what round-trip reduction targets — an argument for finishing the work.
- The evidence rules restored earlier that day **did not hold in prose**. Two pieces got latent
  claims from appearance despite saved `walk_support: medium`, and two owner-confirmed (`conf:
  manual`) pieces were absent entirely. The original fix for this class was code that downgraded
  visual-only latent claims, deleted with the profile; restoring the instruction without the
  enforcement reproduced the original behaviour. **Second time this arc that prompt-only provenance
  has proved insufficient.**

Owner judged the coverage advice sound despite the misses, so the interim is "more expensive but
good", not broken.

Three tooling bugs found while measuring, each of which would have corrupted a result: copying
`wardrobe.db` without its `-wal` missed 13 of 140 rows; the prose reader showed the newest answer
against every row of a multi-turn thread; and a single-category turn was being reported as proof of
batching.

## Gotchas for the next assistant

**Layer-direction ownership landed 2026-08-24.** `evaluateLayerDirections` is now the shared
over/under contract for plan submission, `propose_outfit`, and participating slot swaps. Missing
legacy direction facts are `unknown`: both photos must be seen, then the model may make a
provisional judgment for that turn. The allowance is separately counted as
`proposeVisualLayerDirectionAllows`, stores no garment truth, and should be removed centrally if
live styling quality is poor. The former tee/tank keyword veto is gone; required coverage beneath
a `needs_base` garment remains a separate hard contract.

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
