# Spec 15: Model-plan friction fixes — cut resubmits, stop the weather clobber, tell the truth in gaps and chips

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


**Status:** Proposed (2026-07-15). Not implemented.
**Priority:** High — these are the blockers between the current model-mode state and spec 13's flip criterion. All five parts are small; ship together as one PR.
**Goal restated per Yuna (2026-07-15): the token budget is the constraint.** Model-in-control is the direction, but every round-trip the app forces re-pays the conversation as input. Every part here is deterministic code; parts 1–2 and 6 exist specifically to cut round-trips and per-round-trip weight (the live Paso turn made ~9 API calls: declare, plan, 4× view_pieces, 3× submit — each later call re-paying the workbench and ~54 thumbnails at full input price). Spec 16 (conversation prompt caching) is the companion structural fix.
**Files touched:** `styling-engine/outfitSetPlanner.js` (`buildPlanSlotWorkbench`, `validateSubmittedPlanOutfits`, `assembleSubmittedPlanOutfits`, `normalizePlanSlots`), `src/components/StylistChat.jsx` (`getCardAuthorLabel`), tests.

## Live evidence (first model-mode A/B, 2026-07-15)

Capsule run: clean — one submit, zero rejections, budget held. Paso run: 3 submits → partial accept, winery slot delivered 1 of 2. Forensics (piece categories verified against the live DB):

- Winery attempt "990392 + 260 + 214 + 990469" = **two tops, no bottom** — correctly rejected, but the error said only "structurally incomplete" and the model **resubmitted the identical outfit**. (Part 2)
- Winery attempt "260 + 261 + 214 + 990469 + 990362" = structurally valid (top/bottom/shoes/accessory/outerwear) — rejected on **roster membership**: the model had verified those pieces via `view_pieces` but they weren't among the slot's shown-40. Same for the dinner card's crossbody bag (359 → swapped to pendant 90 on retry). Gate-eligible pieces died on a display cap. (Part 1)
- Coastal slot: model declared `location: "Cambria, CA"` (the microclimate feature working) **and** copied the plan-level `weather: "warm"` onto the slot — stated weather wins, so the Cambria forecast was never fetched; "Coastal Day — warm". (Part 3)
- Final gap line: *"the wardrobe only supports 1 — not enough variety"* — false; the wardrobe was fine, the submissions failed validation. (Part 4)
- Every card chip read `engine · plan_outfit_set` despite model composition. (Part 5)

## Part 1 — Gate-check outside-roster submissions instead of flat-rejecting

**Principle: the shown-40 roster is a display constraint; the gates are the correctness constraint. A submitted piece should die only on a real gate, and with the gate's reason.**

`buildPlanSlotWorkbench` already computes everything needed — it just throws it away. Keep it on the pending plan:

- Per slot: `gateAllowedIds` = Set of **all** `allowedPieces` ids (pre-cap, not just the shown 40), and `suppressedReasonsById` = Map from `suppressedPieces` (id → reasons array — `filterWholeWardrobePiecesForGeneration` already returns these).
- Plan level: `piecesById` = Map over the compose pool, so an allowed-but-not-shown submission can be hydrated into a card.

`validateSubmittedPlanOutfits` replaces the flat `!slot.rosterIds.has(id)` rejection with a three-way check:

1. `id ∈ gateAllowedIds` → **accept** (hydrate from `piecesById`; every downstream constraint check runs as usual).
2. `id ∈ suppressedReasonsById` → reject with the truth: `piece 359 failed this slot's gates: <reasons>` — the model learns *why*, not just *no*.
3. Unknown id → reject: `piece N is not an active wardrobe piece`.

**Budgeted-capsule exception (preserves ruling #1, Yuna 2026-07-15):** when `pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET`, the compose pool IS the curated roster, so `gateAllowedIds` is naturally roster-scoped and nothing changes — the engine-curated capsule guarantee stays intact by construction. No special-case code needed; state it in a comment and pin it with a test.

Anchor guarantee interaction: `anchorAllowedSlots` should also check `gateAllowedIds` (not `rosterIds`) — with PR #98's force-add this is belt-and-suspenders, but it makes the check's semantics match the new rule.

## Part 2 — Coach the structure rejection

`isOutfitStructurallyValid` ([rules.js:4230](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/rules.js:4230)) is a boolean; the corrective message needs the diagnosis. New `describeOutfitStructureGap(pieces, { requireShoes = true })` in outfitSetPlanner.js mirroring its exact rules:

- `shoeCount === 0` → "has no shoes — add exactly one pair"
- `shoeCount > 1` → "has N pairs of shoes — keep exactly one"
- `dressCount > 1` / `bottomCount > 1` → "has two dresses/bottoms — keep one"
- `dress && bottom` → "has both a dress and a bottom — drop one"
- `!dress && topCount < 1` → "has no top or dress"
- `!dress && bottomCount === 0` → "has N tops and no bottom — add a bottom or swap a top for a dress" *(the live failure, verbatim)*

`validateSubmittedPlanOutfits` uses it in place of the generic string. Direct precedent: PR #50's "structure rejections now coach COMPLETION" — the model there stopped resending identical proposals once told what to add; the live Paso run reproduced exactly that failure mode in the new flow.

## Part 3 — Demote copied slot weather so a slot's live forecast can win

In `normalizePlanSlots`: when the slot's explicit weather string equals the plan-level fallback weather (case-insensitive, trimmed), treat it as **not stated** — it's propagation, not slot knowledge:

```js
const explicitWeather = String(slot?.weather || slot?.stated_weather || '').trim()
const isCopiedPlanWeather = explicitWeather &&
  explicitWeather.toLowerCase() === String(fallbackWeather || '').trim().toLowerCase()
const statedWeather = beachCoastalStatedWeather(isCopiedPlanWeather ? '' : explicitWeather, { environment }) || …
```

`slot.season` already falls back to `fallbackWeather`, so the heat context survives for the heuristic; the only change is that `resolveSlotWeather`'s precedence can now reach the live per-slot forecast (Cambria) instead of being blocked by a copied "warm". Genuinely slot-specific values (`indoor`, "cooler on the coast") differ from the plan string and keep winning — that's the exact property that makes this safe. Applies to both modes (engine mode benefits identically).

Optional micro-nudge, no new mechanism: append to the `location` schema description — "if you set a slot location for a different microclimate, omit that slot's weather". Prompt text is the assist; the demotion rule is the guarantee.

## Part 4 — Honest gap wording for model-mode shortfalls

`assembleSubmittedPlanOutfits` currently reuses `describeSlotCoverageGap`, whose engine-mode phrasing blames the wardrobe ("the wardrobe only supports 1 — not enough variety"). For a model-mode shortfall that's untrue and misdirects the user. Pass a mode through (`describeSlotCoverageGap(slot, { …, composedBy: 'model' })`) and emit: `"[coverage gap: 'Winery Exploring' needed 2 looks but only 1 valid outfit was submitted — the other attempts failed validation]"`. Keep the engine wording untouched for engine mode.

## Part 5 — Truthful card chip

`getCardAuthorLabel` (StylistChat.jsx:1231) hardcodes `'engine · plan_outfit_set'` from `source`. Thread a `composedBy` field onto plan cards — set `'model'` in `assembleSubmittedPlanOutfits` / `'engine'` in `composeOutfitSet`'s `attachTripPlanMetadata` path — and render `'AI · plan_outfit_set'` when `composedBy === 'model'`. **Do not change `source`**: `isPlannedSetSource`, `sourceLocked`, and the plan presentation all key off `source === 'plan_outfit_set'` and must keep treating both compositions identically. This chip is the QA label that caught the double-compose bug in #87–89; it earns its keep only if it tells the truth.

## Part 6 — Token diet for the plan turn

Two changes that shrink what a plan turn carries, both mechanical:

**6a. Deduplicate the workbench into a catalog.** Today each slot repeats full manifest lines for its 40 pieces — 8 slots × 40 lines with heavy overlap (the same hot-weather-gated wardrobe passes most slots). Restructure the workbench response:

```js
{
  status: "slot_rosters",
  piece_catalog: [ "…one manifest line per UNIQUE shown piece across all slots…" ],
  slots: [{ id, label, …, allowed_piece_ids: [67, 128, 136, …], suppressed_note }],
  …
}
```

The union of shown pieces is bounded by the wardrobe (~120–160 lines for 8 permissive slots), vs. up to 320 repeated lines today — roughly a 50–60% cut in workbench tokens, re-paid on *every* subsequent round-trip in the turn. The model already reads exactly this indirection (the manifest is ID-keyed); no comprehension risk.

**6b. Tell the model not to browse.** The Paso run spent 4 `view_pieces` calls (~54 thumbnails) before composing — image tokens that then sat in the conversation getting re-read by every later call. That habit comes from the propose_outfit contract ("view_pieces is the cheap way" in the declare ack). For plan turns it's mostly waste: the catalog lines carry the tag truth, and ruling #2 means nothing *requires* sight here. Add one line to the workbench `instructions`: "These pieces are already verified — do NOT call view_pieces for roster pieces; compose directly from the catalog lines. If you genuinely need to see a few pieces, make at most ONE small view_pieces call." Prompt text, zero mechanism; the diagnostics panel's `viewPiecesCalls`-per-plan-turn is the measure of whether it lands.

## Part 7 — Activity-aware footwear reserve in the capsule roster

**Ruling (Yuna, 2026-07-15): the model IS allowed to propose `piece_budget` on its own judgment** — no sanitizer stripping unrequested budgets. That ruling relocates the A-side Paso finding: when the model proposed `piece_budget: 20`, `selectCapsuleRoster` curated a roster whose 3 shoes were picked purely by `capsuleVersatilityScore` (neutral colors, solids, occasion breadth) — **activity-blind** — leaving the hiking slot with canvas slip-ons. In model mode the same blindness is worse: the curated pool scopes every slot's `gateAllowedIds`, so the model *cannot* reach the athletic shoes at all, and the footwear validator then rejects whatever it submits → resubmits → partial accept.

Fix in `selectCapsuleRoster`, mirroring the existing elevated-shoe reserve ([outfitSetPlanner.js:1667-1675](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js:1667)) — same swap-in shape, tag-driven predicate instead of a formality floor:

- For each distinct demanding activity across the plan's slots (`hiking`, `walking` — resolved via `resolveActivityProfile`), require **at least one** selected shoe whose `footwearComfortVerdict(shoe, excluded_heel_heights, excluded_walk_support)` is `allow` for that profile.
- Generalize `ensureCapsuleGroupFloorReserve` into a predicate-based `ensureCapsuleGroupPredicateReserve` (the floor version becomes a one-line wrapper); swap out the lowest-versatility non-compliant shoe, capped by `quotas.shoes`.
- No keyword lists anywhere — the predicate is the same shared verdict helper the gates use (spec-1 lineage), so this stays on the constraint side of the spec-14 boundary.

Tests: a plan with a hiking slot + budget ≥ 6 selects a roster containing ≥1 hiking-passing shoe (fixture with one athletic + several unsupported shoes); a no-demanding-activity plan is unchanged (assert roster identity with today's selection); elevated-shoe reserve still honored alongside (both reserves on one roster).

## Recorded watch item (no code in this spec)

**Reuse looseness without a budget:** Paso model run used 16 distinct pieces for 5 outfits vs. engine's 9, with `reuse: maximize` mostly ignored; the capsule run (hard budget) packed tightly. Per spec 13's risk register, the escalation if this repeats is a static workbench instruction for `maximize` ("aim to repeat bottoms and shoes across slots; every reused piece is one fewer to pack") — a string, not a scorer and not an extra LLM call. Collect 2–3 more packing runs before deciding.

## Tests

- Part 1: submit with an allowed-but-not-shown piece → accepted and hydrated onto the card; submit a gate-suppressed piece → rejected with the gate reason text; unknown id → the active-piece message; budgeted capsule + outside-roster piece → still rejected (pool-scoped), pinning ruling #1.
- Part 2: unit-test `describeOutfitStructureGap` per rule (two-tops-no-bottom asserts the "add a bottom or swap" phrasing); validator failure for the live repro shape includes it.
- Part 3: slot weather === plan weather → `statedWeather` empty (live forecast reachable); slot weather `indoor` with plan weather "warm" → still stated; engine mode unaffected assertion.
- Part 4: model-mode shortfall gap line says "failed validation", never "wardrobe only supports"; engine-mode string unchanged.
- Part 5: plan cards carry `composedBy`; chip renders `AI · plan_outfit_set` for model, `engine · plan_outfit_set` for engine (string test on the helper, StylistChat renders via the existing plain-JS test path if practical).

## Risks

Low. Part 1 widens what a submission may *reference* but not what passes gates — the identical gate stack runs either way, and the capsule pool stays engine-curated. Part 3 changes precedence only in the exact case where the stated value carries zero information. Parts 2/4/5 are message/label truthfulness.
