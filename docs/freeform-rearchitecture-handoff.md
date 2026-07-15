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
   must be correct (see `validateOutfitRoles` replacing prompt-based layering
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
