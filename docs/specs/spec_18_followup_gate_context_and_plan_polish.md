# Spec 18: Follow-up gate context, trip-scope clause retirement, and plan-turn polish

> ## ⚠️ HISTORICAL ARCHIVE — NOT A DESIGN AUTHORITY
>
> This spec is a **frozen record of intent at the time it was written**. It spans generations of an
> app that has been redesigned several times, and decisions in it have been revisited, reversed, or
> deleted since.
>
> **The `Status:` line below is frozen at authoring time and is frequently WRONG today.** Several
> specs marked "Proposed. Not implemented." shipped long ago (spec 29, 32 and 33 all say this, and
> all are merged).
>
> **Authority order when this disagrees with anything (owner ruling, 2026-07-30):**
> **1. the code** — what actually runs · **2. ratified docs**
> ([occasion profiles](../occasion_profiles_ratification.md), [style constitution](../style_constitution.md),
> the three maps) · **3. this archive** — only *why* something was once done that way.
>
> A decision made from fresh evidence — a live run, a measurement — **stands**. "An old spec decided
> otherwise" is an **unverified claim, not a finding**. Record the disagreement and let testing
> settle it; do not revert working behaviour on the strength of this file.
>
> Read [docs/specs/README.md](README.md) before acting on anything below.


**Status:** Implemented (2026-07-15). All six parts + Step 0 shipped on branch `spec-18-followup-gate-context-and-plan-polish`, 564/564 tests green, Part 6 reverified against the live wardrobe DB.
**Priority:** Parts 1 and 6 are the bugs (Part 6 is now the most severe — it empties whole slots on the common capsule shape "demanding activity + one dressy slot"); Part 2 is an owner-ruled retirement; Parts 3–5 are one-line friction/truthfulness fixes from the 2026-07-15 Claude live runs. Ship as one PR.
**Files touched:** `styling-engine/tools.js` (`propose_outfit` context resolution, `plan_outfit_set` args coercion, workbench instructions via `outfitSetPlanner.js`), `styling-engine/provider.js` (turn-contract context clause), `styling-engine/outfitSetPlanner.js` (`buildPlanSlotWorkbench` instructions), tests.

## Step 0 — make `npm test` green FIRST (pre-existing, do before any part)

Main fails 13 tests (536 pass), and has since at least commit `7623938` (#97, the model-compose flow) — verified by running `test/plan_outfit_set.test.js` at every commit from #97 through #103: 13 failures at each. Not db-dependent (tests use a temp `WARDROBE_DB_PATH`). All 13 are in the plan_outfit_set family, and the inspected one fails with `actual: 'slot_rosters'` / `expected: 'success'` — an ENGINE-mode test receiving a MODEL-mode response. Prime suspects, in order: (a) a `WARDROBE_PLAN_COMPOSE='model'` env leak inside `test/plan_outfit_set.test.js` (several tests set it before their `try` block — a throw between set and `try` skips the `finally` restore), (b) the mode-resolution logic around [tools.js:1473](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/tools.js:1473) having a second trigger beyond the env var. Diagnose the real cause — do NOT just re-baseline or skip the tests; if the product code turns out to route engine turns into model mode under some condition, that's a live bug, not a test bug. Fix as its own commit before implementing Parts 1–6, so each part's tests land on a green suite.

## Live evidence (Claude model-mode runs, 2026-07-15)

All three from the mountain-capsule / follow-up / Apple-skirt test sequence:

- **Follow-up turn** ("Make the dinner look dressier, and add one rainy-day option"): the dinner proposal (`occasion:"evening"`, no `activity` key) was rejected with "register: dressy exceeds everyday ceiling; sleek black cutout flats: activity profile: low heel unsuitable." The broken-card debug trace shows why: **"Resolved Activity: hiking (tool_context)"** and **"Register Ceiling: everyday"** — the *capsule turn's* hiking context gated a dinner proposal. The model then re-proposed with `anchor:true` on pieces the user never named, twice, and the gates folded. Right outcome, wrong mechanism: wrong gates are training the model that anchor is the universal unlock.
- **Apple-skirt turn** ("Plan 3 outfits for a long weekend in the city built around my Apple skirt — use it wherever it makes sense"): the model behaved perfectly (viewed the anchor large, searched, 3 valid anchored cards), then its final answer was **blocked by `tripScopeClarification`** ([provider.js:160](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/provider.js:160)) — "weekend" matched multi-day, "city" counted as only one use-case keyword. The forced retry ("You're right — I jumped ahead… What kinds of activities…?") was displayed to the user **above three finished cards**, addressed to the validator as if the user had complained. The good 365-token presentation was discarded. `tripScopeClarificationRetries: 1` in diagnostics.
- **First plan call of the capsule turn**: Claude sent `slots` as a JSON-encoded **string** (with the sibling plan fields flattened into it), burned a round-trip on "plan_outfit_set needs at least one slot with a label," then retried correctly.
- **Paso trip turn (earlier same day)**: card reason described the Tropical pants (catalog: `pattern: floral`, six colors) as "solid-base… muted print" — a fabricated visual claim, exposed when the gpt-4o render drew the real garments. The model had the truth in its catalog line and rationalized past it.
- **Reuse watch item is over threshold**: three `reuse:"maximize"` packing runs used 16, 18, and 20 distinct pieces with only accessories repeating. Spec 15 said collect 2–3 runs, then escalate to the static instruction.

## Part 6 — Capsule shoe reserves must not evict each other's guarantees

**Live evidence (2026-07-15, the decisive Part 7 probe):** after the owner retagged the canvas slip-ons to `walk_support: medium` (tag truth), the mountain-capsule ask (2 hiking days + town stroll + smart-casual dinner, `piece_budget: 10`) delivered **2 of 4 cards** — both hike slots empty. The model's recovery was flawless and doomed: "missing shoes" → added the only visible shoe → truthful gate reason ("activity profile: medium support unsuitable") → searched the wardrobe, found the real trail shoes (990397, 214) → rejected with "not an active wardrobe piece for this plan" (outside the curated capsule pool) → resubmit cap → honest partial accept. Every message was true; the roster was wrong.

**Root cause, reproduced deterministically against the live DB** (`selectCapsuleRoster`, budget 10, those four slots):

- Without the dinner slot: shoes = slip-ons + **taupe knit lace-up sneakers (support: high)** — the spec-15 Part 7 activity reserve works.
- With the dinner slot: shoes = slip-ons + **wedges** — the elevated-shoe floor reserve ([outfitSetPlanner.js:1782](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js:1782) region) runs *after* the activity reserve, picks its swap target as the lowest-versatility non-elevated shoe — which is exactly the sneaker the activity reserve just installed — and evicts it. Last reserve wins; the hiking guarantee is silently destroyed. (This also explains why the pre-retag run showed no athletic shoe: the eviction happened there too, masked because the then-`high` slip-ons satisfied the hiking predicate.)

**Fix — one demand-aware pass instead of sequential blind swaps.** Collect all shoe demands up front as predicates: one per demanding activity profile (`footwearComfortVerdict` pass) + one for the elevated floor (`pieceMeetsFloorRank`). Then guarantee them together:

- When a reserve needs to swap a shoe in, choose the swap target among selected shoes that satisfy **zero** demand predicates first; only if none exist, evict the shoe whose demands are otherwise still covered by another selected shoe.
- A shoe satisfying multiple demands (athletic sneaker: hiking + walking) counts for all of them — the 2-shoe quota comfortably covers "hiking + elevated" (sneaker + wedge; the slip-ons are the correct eviction).
- If the quota genuinely cannot cover all demands, keep the best assignment and emit a coverage-gap line naming the uncovered demand ("the shoe quota under this budget cannot cover both hiking and a dressy dinner") — disclose, don't silently drop (the PR #87/#89 convention).

**Message truthfulness rider:** the pool rejection for enforced capsules should say the truth — "piece 990397 is outside this capsule's curated 10-piece roster" — not "is not an active wardrobe piece" (it is active; the model had just verified it via search, making the current message read as a contradiction).

Tests: the exact live repro (4 slots, budget 10, fixture with slip-on/wedge/athletic) asserts the final roster contains BOTH a hiking-passing and an elevated shoe; dinner-only plan keeps today's elevated behavior; hiking-only plan keeps the Part 7 behavior; over-constrained quota emits the gap line; capsule pool rejection message names the roster, not "active".

## Part 1 — This-call stated context must beat stale tool_context in propose gates

The `resolveStatedOrLiveWeather` precedent ("the model just told the gate what to expect" wins over cached context), applied to occasion/activity.

Current code ([tools.js:1069-1073](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/tools.js:1069)):

```js
const resolvedOccasion = occasion ? normalizeOccasion(occasion) : (toolContext.occasion || 'casual')
const resolvedActivity = activity !== undefined && activity !== null && activity !== ''
  ? normalizeActivity(activity)
  : (toolContext.activity || '')
```

The stated occasion already wins — but a proposal that states an occasion and *omits* activity inherits `toolContext.activity` from whatever turn set it (here: `hiking` from the capsule plan). The hiking activity then drags the register ceiling down to `everyday` via `resolveRegisterCeiling`, so an evening proposal is gated as a hike.

**Rule: inherit `toolContext.activity` only when the call does not contradict the context it came from.**

```js
const statedOccasion = occasion ? normalizeOccasion(occasion) : ''
const contextOccasion = toolContext.occasion || ''
const occasionSwitched = statedOccasion && contextOccasion && statedOccasion !== contextOccasion
const resolvedActivity = activity !== undefined && activity !== null && activity !== ''
  ? normalizeActivity(activity)
  : (occasionSwitched ? '' : (toolContext.activity || ''))
```

- Dinner follow-up after a hiking capsule (`stated evening` ≠ `context casual`): stale hiking dropped, evening's own dressy ceiling applies. The live failure, fixed.
- "Swap the shoes on #2" (no occasion stated): everything inherits, exactly as today — cross-turn state (handoff scenario 6) untouched.
- Same-occasion follow-up ("another walking look"): inherits, as today.

Do NOT touch the season/weather line — that precedence was already fixed (`resolveStatedOrLiveWeather`). The rainy-look rejection in the same turn was the model's own slip (`season:"warm"` on a rain ask), not a context bug; no code change for it.

**Watch item (no code now): anchor-after-rejection.** With Part 1 the incentive to anchor through wrong gates should drop. If live runs still show `anchor:true` added to non-user-named pieces right after a rejection, add a diagnostic counter (`anchorBypassAfterReject`) first — measure before mechanism.

## Part 2 — Retire the tripScopeClarification clause (owner ruling, 2026-07-15)

The Apple-skirt misfire is the retirement evidence the handoff's standing item demanded ("require evidence, not vibes") — and it's stronger than required: the clause didn't just prove unnecessary on a well-scoped turn, it actively vandalized one (blocked a valid 3-card answer, forced a fake clarifying question that contradicted the delivered cards on screen).

- Follow the pre-route retirement pattern exactly ([routes/ai.js:221](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/routes/ai.js:221) `followupPrerouteEnabled`): a `tripScopeClarificationEnabled()` helper reading `WARDROBE_TRIP_SCOPE_CLARIFICATION === 'on'`, clause skipped by default, flag restores it.
- **`destinationClarification` stays live** — different trigger (weather/destination question with zero searches), no misfire evidence. Only the trip-scope clause retires.
- Tests: existing trip-scope tests in `test/aiEndpointContracts.test.js` / `test/freeform_observability.test.js` run with the flag on (the same guard-the-flagged-path convention as the precompose tests); add one flag-off test pinning that a multi-day low-scope question with composed cards passes the contract untouched.
- Update the handoff doc's "Retire the context clauses" item: tripScope done with this evidence, destination still pending evidence.
- `tripRequestNeedsScopeClarification` itself stays exported/tested — only the enforcement retires.

## Part 3 — Coerce stringified `slots` in plan_outfit_set

The live bad call was `slots: "[ {...}, {...} ],\n\"location\": \"Paso Robles, CA\", …"` — the entire remaining args object flattened into the string. Recovery that handles both shapes, tried in order before the "needs at least one slot" rejection:

1. `JSON.parse(slots)` → use if it yields an array.
2. `JSON.parse('{"slots":' + slots + '}')` → recovers the observed shape (array + flattened siblings); merge recovered sibling keys into args with **explicitly-passed args winning**.
3. Both fail → existing validation error unchanged.

Test with the verbatim live string; test that a proper array is untouched; test sibling-merge precedence.

## Part 4 — Static reuse instruction for maximize plans

The spec 15 watch item's agreed escalation, now past its 3-run threshold (16/18/20 distinct pieces). In `buildPlanSlotWorkbench`, when `reuseMode === 'maximize'`, append to `instructions`: "Reuse is set to maximize: aim to repeat bottoms and shoes across slots — every reused piece is one fewer to pack. Accessories alone do not count as reuse." A string, no scorer, no extra call. Measure: next packing run's distinct-piece count in the plan report.

## Part 5 — Pattern-truth instruction

Append one line to the workbench `instructions` (and the propose-path prompt bullet if one exists for card reasons): "The catalog's pattern and color fields are the truth about prints — never describe a piece as solid, muted, or subtle unless its line says so." Attacks the fabrication directly at zero image cost; deliberately does NOT widen the view_pieces allowance (the tags already carried the truth in the live miss).

## Open questions for the owner (recorded, no code in this spec)

1. ~~**Piece 169 tag truth**~~ — RESOLVED 2026-07-15: owner retagged to `medium`; the probe ran and surfaced Part 6's reserve-eviction bug.
2. **Per-slot 3-look cap** ([outfitSetPlanner.js:2588](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js:2588)): `count: 4` silently becomes 3 with no `requestedOutfits` marker or `[plan trimmed:]` line, unlike the total-cap trim beside it. Deliberate ceiling or missing disclosure?

## Tests

- Part 1: evening propose after hiking-context turn → no hiking activity profile, dressy ceiling (the live repro); no-occasion propose → context inherited (scenario-6 pin); same-occasion propose → inherited.
- Part 2: flag-off multi-day/low-scope turn with cards → no block; flag-on → clause fires (guard test).
- Part 3: verbatim live string parses to 4 slots + recovered location/constraints; array passthrough; args-win merge.
- Parts 4–5: instruction strings present under the right conditions (maximize only; always for pattern-truth).

## Risks

Low. Part 1 changes inheritance only when the call *names a different occasion* than the context — the contradiction case; all silent-inheritance flows are pinned by tests. Part 2 is flag-reversible and evidence-backed. Parts 3–5 are input tolerance and prompt strings.
