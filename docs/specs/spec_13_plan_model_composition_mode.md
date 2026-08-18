# Spec 13: plan_outfit_set model-composition mode — the model picks pieces, the engine enforces constraints

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


**Status:** Proposed (2026-07-15). Not implemented. **This is the big one** — read the "Evidence that triggers this" section first; the whole spec is conditional on agreeing that threshold has been met.
**Priority:** High. Depends on nothing (spec 12 is complementary but independent; implementing 12 first is recommended since the workbench echoes declared slot semantics).
**Files touched:** `styling-engine/tools.js` (plan_outfit_set executor + one new tool), `styling-engine/outfitSetPlanner.js` (new `buildPlanSlotWorkbench`, new `validateSlotOutfitConstraints`; existing pipeline untouched), `styling-engine/prompts.js` (STYLIST_SYSTEM bullet), diagnostics/db plumbing, tests.

## Evidence that triggers this

The 2026-07-13 architecture review (recorded in the handoff doc via PR #75) set an explicit criterion: *"correctness cost has moved to composeOutfitSet's scorers (#66–#72 all whack-a-mole there — if patch rate doesn't taper, consider model-picks-pieces/engine-enforces-constraints, evidence first)."*

Since that review (2 days): #86 (office register by fabric not print — the #68 bug class recurring), #88 (shoe rotation + seasonality + dead-scoring bug), #89, #90 (five reliability bugs), the capsule-reliability fix, #93/#94/#95 (three PRs for ONE new environment: beach). **The rate accelerated.** The beach work's structural tells:

- `isDayWalking = isWalking && !isDinner && !isBeachCoastal && !slotWantsElevatedShoe` ([outfitSetPlanner.js:949](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js:949)) — every slot type edits this chain.
- PR #95 had to teach the *dinner* scorer about *beach* signals (cover-up penalty in `tripOutfitDinnerRegisterScore`) — N×N cross-contamination between slot-type scorers.
- The planner now carries ~12 `trip*Score` functions and ~10 slot-type prose classifiers, each with hand-picked keyword vocab (`'terry'`, `'cargo'`, `'marine layer'`…), partially matched against garment **names** (`tripStructuredValueSet` includes `name` — the exact brittleness the owner ruling behind PR #86 rejected).

The root cause is a line-drawing choice, not sloppiness: step 6's resolution kept the engine as piece-picker because it owns real capabilities (reuse math, budgets, gates). But piece-picking bundles **constraint satisfaction** (closed-vocabulary, tag/profile-driven — generalizes, proven by the whole gate arc) with **appropriateness judgment** ("what does a beach day want" — open-ended world knowledge the engine can never finish encoding). Every unpredictable future occasion lands on the judgment side. This spec splits along that line.

## Design summary

`plan_outfit_set` gains a second mode, behind env flag **`WARDROBE_PLAN_COMPOSE`** (`'engine'` = today's behavior, default; `'model'` = new). In model mode the call becomes **phase 1 of a two-phase, in-turn flow**:

1. **Phase 1 — `plan_outfit_set` (args unchanged):** the engine runs everything it's uniquely good at — slot normalization, per-slot live weather, roster hard-gating, capsule-budget curation, reuse-ledger setup — but instead of composing outfits, returns a **slot workbench** for the model to compose from.
2. **Phase 2 — new tool `submit_plan_outfits`:** the model picks pieces per slot (its taste, its world knowledge) and submits ALL slots' outfits in ONE call. The engine validates mechanically — roster membership, structure, constraint gates, ledger — with all failures merged into one corrective error (the round-4/PR #52 lesson). On success it assembles cards, computes the objective-driven report from the final set, and sourceLocks as today.

Nothing about the trust model changes: this is the house pattern that has worked every time — **model proposes, code verifies mechanically**. The scorer layer was the inverse (code proposes, nothing verifies taste, so taste had to be hand-coded), and that's what's been generating the patch stream.

## Phase 1 — the slot workbench

In the executor ([tools.js:1348](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/tools.js:1348)), everything through `normalizePlanSlots` + the piece load is shared with engine mode. Then, model mode calls a new `buildPlanSlotWorkbench(planSlots, { constraints, allPieces, dateRange, mood, question, fetchImpl })` in outfitSetPlanner.js, which reuses the existing per-slot machinery **verbatim** (same calls composeOutfitSet makes at [outfitSetPlanner.js:1804-1813](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js:1804)):

- `resolveSlotWeather(slot, …)` — per-slot live forecast, the microclimate machinery.
- `filterWholeWardrobePiecesForGeneration(pool, { occasion, weatherProfile, activity, … })` — the Decision-A hard gates (register ceiling, footwear enums, weather, occasion profiles).
- When `piece_budget >= MIN_ENFORCED_CAPSULE_BUDGET`: `selectCapsuleRoster` curates the pool first, exactly as today — the workbench pool IS the roster, so the budget is enforced by construction (see "Capsule ownership" under Open rulings).

Tool result shape (a normal tool result the model reads; no new client surface):

```js
{
  status: "slot_rosters",
  instructions: "Compose the outfits yourself and submit ALL slots in ONE submit_plan_outfits call. Pick only from each slot's allowed piece IDs.",
  slots: [{
    id, label, occasion, activity, environment, register,
    target_outfits,                     // slot.targetOutfits after the cap trim
    weather_used,                       // resolveSlotWeather's label, e.g. "60°F coastal, windy (live)"
    register_ceiling, register_floor,   // resolved ranks as names, when present
    allowed_pieces: [ "…manifest-format line per piece…" ],  // reuse buildWardrobeManifest's line format — the model already reads it
    suppressed_note: "18 pieces excluded by register/weather/footwear gates"
  }],
  constraints: {
    reuse, no_repeat, allow_repeat, shared_anchor_ids, piece_budget,
    previously_worn_ids: [/* seed outfits' ids, for diversify replans */]
  }
}
```

Cap `allowed_pieces` at ~40/slot (largest-roster slots note the truncation). Persist the pending plan on `toolContext.pendingPlan = { slots (with weatherProfile + roster id Sets), constraints, heldOutfits: [], resubmits: 0 }` — turn-scoped, same lifecycle as `retrievedPieceIds`.

**Verification semantics:** roster membership replaces the step-3 retrieval rule for this flow — a piece the engine itself gated onto the slot roster is verified by construction (stronger than retrieved-this-turn). The layer-must-be-SEEN visual rule is NOT enforced here, matching engine-mode cards today (which never went through it either); the opacity tag + weather gates carry that class now. **Ruled (Yuna, 2026-07-15): roster is enough** — no view_pieces requirement on layer picks.

## Phase 2 — `submit_plan_outfits`

New tool, listed after plan_outfit_set:

```js
{
  name: "submit_plan_outfits",
  description: "Submit the outfits you composed for this turn's plan_outfit_set slot rosters. ONE call carrying every slot. Each outfit: pieces chosen ONLY from that slot's allowed piece IDs.",
  input_schema: { …
    outfits: [{ slot_id, piece_ids: [int], title?: string, reason?: string }]
  }
}
```

Executor validation, per outfit, **all failures merged into ONE `validation_error`** naming each failing outfit + every reason + what to fix (the round-4 lesson — sequential bounces burned the iteration budget):

1. `toolContext.pendingPlan` exists (else: "call plan_outfit_set first"); `slot_id` known.
2. `piece_ids ⊆` that slot's roster Set (corrective error lists the offending IDs and says pick from the slot's allowed list).
3. `isOutfitStructurallyValid(pieces, { requireShoes: true })` — same helper engine mode uses.
4. **`validateSlotOutfitConstraints(outfit, slot, { weatherProfile })`** — NEW, and deliberately small. This is the extraction of the *keeper* hardRejects from `tripSlotFitScore` — only the tag/profile-driven correctness rules, no keyword lists:
   - cold slot → an outerwear layer is required ("no warm layer for cold weather", [outfitSetPlanner.js:980](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js:980));
   - hot slot → reject `fabric_weight:'heavy'` mains (the :966/:970 rules);
   - `slot.register` dressy/formal → register FLOOR on mains via formality tags (the generalization of the :729/:733/:740 formal-slot rejects);
   - activity footwear via `footwearComfortVerdict` / the comfort-constraint enums (the walking/hiking shoe rules).
   Everything else in the scorers — dinner-top vibes, office prints, beach terry bonuses, aesthetic gravity — is taste, and taste is now the model's proposal, not the validator's business.
5. Ledger: `no_repeat` by category (anchor-exempt, reusing `normalizePlanConstraints` + the `violatesNoRepeat` logic); within-slot duplicate outfit keys (`tripOutfitKey`); total distinct pieces ≤ `piece_budget`.
6. Anchor guarantee (ruled — see Rulings): if `shared_anchor_ids` is set and NO submitted outfit contains any anchor piece, **and** at least one slot's roster allowed one, that's a merged corrective error ("include the anchor in at least one outfit where it fits — these slots' rosters allow it: …"). One anchored outfit anywhere satisfies the check; per-slot recurrence stays the model's judgment. If the gates excluded the anchor from every roster, that's NOT an error — it's an honest plan-line disclosure ("the anchor piece didn't clear any slot's gates"), the same shape as engine mode's fall-back-without-anchor behavior.

Valid outfits are **held** in `pendingPlan.heldOutfits`; the corrective error says "N outfits accepted and held — resubmit ONLY the failed slots." Resubmit budget: **2**; after that, partial-accept what's held and emit honest coverage-gap plan lines per unfilled slot (reuse `describeSlotCoverageGap`'s shape — "the wardrobe/model couldn't fill this" disclosure, the house's honest-under-delivery pattern).

On success (or partial-accept): annotate via the existing `annotateTripOutfit` + `attachTripPlanMetadata` (slot chips, weather labels, plan order), `source: 'plan_outfit_set'`, `sourceLocked` — the client's `isPlannedSetSource` presentation works unchanged. The objective-driven report (reuse stats, repeat schedule, roster + combination count) is computed by the ENGINE from the final accepted set — counting stays code's job; the model never self-reports reuse numbers.

**Abandoned phase 2:** if the model gets rosters and never submits, the existing `cardsNotDelivered` delivery clause already blocks a declared-cards turn ending with zero cards — no new guard needed. Phase 1's `instructions` string is the nudge; the contract check is the backstop.

## What deliberately stays OUT of v1 (recorded deferrals)

- **Layer injectors** (`withEveningLayerIfUseful`, `withBeachCoastalLayerIfUseful`): layering judgment moves to the model — it sees `weather_used` including wind/fog text and owns "windy beach → add the cardigan." The cold-weather layer *gate* (mechanical) backstops the correctness end. If live tests show the model under-layers on cool-not-cold slots, the fix is workbench wording, not a new injector.
- **Engine seed/suggestion outfits in the workbench**: tempting (anchor the model on engine candidates), but it re-couples the two layers and anchors taste on exactly the scorers we're sunsetting. Evidence first.
- **Model-curated capsule rosters**: v1 keeps `selectCapsuleRoster` as the budget pool (see Open rulings).

## Prompt + plumbing

- plan_outfit_set tool description: in model mode append the two-phase contract ("returns slot rosters; you compose; submit ALL slots via submit_plan_outfits in one call").
- STYLIST_SYSTEM: one bullet in the plan section describing the flow; do NOT rely on it mechanically (the validator is the guarantee — prompt text is just efficiency).
- Diagnostics (established pattern: toolContext.freeformDiagnostics → db column → client details panel): `planComposeMode` (which mode served the turn), `submitPlanCalls`, `submitPlanValidationFails`, `submitPlanResubmits`, `submitPlanPartialAccepts`.
- Iteration budget: flow costs 2–4 tool calls (declare → plan → submit → ≤2 resubmits) against the cap of 10 — comfortable, but the merged-error rule is what keeps it so.
- Test harness: `executeTool` is directly unit-testable (existing `test/plan_outfit_set.test.js` pattern). Confirm `askStylistWithTools`' test short-circuit (the PR #38 harness fix) exercises the submit path end-to-end through `/ask`; if not, extend it the same way.

## Evidence plan and the flip criterion (state it now, argue about it never)

Run the live scenario families in model mode (flag on, dev server): trip with a coastal microclimate slot; budgeted capsule; work week with `no_repeat: ['tops']`; event weekend with register escalation; a beach day; new-piece anchor integration. Flip the default to `'model'` when: (a) Yuna judges card quality ≥ engine mode across those runs, (b) `submitPlanValidationFails` converges to ≤1 resubmit per plan typically, and (c) no correctness class appears that the validator misses (a miss = add a TAG-DRIVEN rule to `validateSlotOutfitConstraints`, never a keyword scorer). Engine mode stays behind the flag for a stretch after the flip; deletion is spec 14, on its own evidence.

## Risks

- **Model taste worse than the scorers somewhere.** Possible — the scorers encode ~30 live incidents. Mitigation: the flag reverts instantly; the scenario list above IS those incidents' regression suite, run live.
- **Packing tightness.** `reuse:'maximize'` was a combinatorial optimization; the model may pack looser. The budget is the hard bound and the report *discloses* distinct-piece count, so regressions are visible, not silent. If live packing quality drops, the recorded escalation is workbench pairing hints — not resurrecting the scorer.
- **Token cost.** ~8 slots × ~40 manifest lines ≈ 2–4k tokens of workbench + the submit payload, per plan turn. Real but bounded; plans are the highest-value turns in the app.
- **Two-phase non-compliance** (model hand-composes via propose_outfit instead of submitting): the existing sourceLock + the propose_outfit description's anti-double-compose language already fight this class; extend the sourceLock check to pendingPlan turns (a propose_outfit call while a pendingPlan awaits submission gets the same corrective redirect).

## Rulings (Yuna, 2026-07-15 — all three resolved, none open)

1. **Capsule roster ownership: engine curates.** v1 keeps `selectCapsuleRoster` as the budget pool (engine-guaranteed budget, quotas, register reserves; zero extra round-trips); the model composes from it. `capsuleVersatilityScore`'s keyword taste survives as an accepted remnant — revisit model-proposed rosters only on live evidence that the engine's roster choices are the quality bottleneck.
2. **Layer verification: roster membership is enough.** No view_pieces requirement on layer picks — parity with engine-mode plan cards today; the opacity tag + weather gates own the crochet class. Do not silently tighten this later without a live incident.
3. **Anchor recurrence: hard-reject on zero use.** Implemented as validation rule 6 above. A "style this piece" plan is guaranteed to honor the anchor when any slot's gates allow it; gated-out-everywhere degrades to disclosure, never a forced weak outfit.
