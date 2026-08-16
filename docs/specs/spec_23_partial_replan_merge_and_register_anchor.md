# Spec 23: Partial re-plan must merge, register floor becomes anchor-based, reuse instruction gets teeth

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


**Status:** Proposed (2026-07-16). Not implemented.
**Priority:** Part 1 is **P0** — a live regression introduced by spec 19's escape hatch: any multi-slot plan where one slot needs a register re-plan currently delivers ONLY that slot's card and silently destroys the rest (office week shipped 1/5, wedding 1/3 on 2026-07-16). Parts 2–3 ride along. Ship as one PR.
**Files touched:** `styling-engine/tools.js` (`plan_outfit_set` handler — merge semantics), `styling-engine/outfitSetPlanner.js` (`validateSubmittedPlanOutfits` floor semantics, `slotFloorViability`, workbench instructions, assembly/report over merged plans), tests.

## Live evidence (post-#106 scenario re-runs, 2026-07-16, wardrobe-dev.log.claude10)

**Office week:** submit 1 → **4 outfits accepted and held**, Thursday rejected on the dressy floor with the spec-19 hatch message. The model obeyed the hatch exactly — re-called `plan_outfit_set` with just Thursday at `register:"elevated"`. That call **unconditionally overwrote `toolContext.pendingPlan`** ([tools.js:1463](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/tools.js:1463)), destroying the 4 held outfits before they were ever assembled. The single-slot plan succeeded (1 card), `generatedOutfits` was replaced with just it, and when the model tried to rebuild Monday via `propose_outfit`, the duplicate-composition gate blocked the recovery. **Delivered: 1 of 5.** The UI confirms: only the Thursday card rendered.

**Wedding weekend:** identical trap — 2 held (rehearsal, brunch), ceremony re-planned at a lower register, final delivery **1 of 3** (ceremony only).

**Thursday's register arc, same log (Part 2's evidence):** at `register:"dressy"`, "wide leg trousers is below the dressy register floor" (an everyday-tagged basic). Re-planned at `"elevated"`: "olive gold silk blouse: register: dressy exceeds elevated ceiling" — the wardrobe's best presentation piece. Floor is per-piece and ceiling equals the declared register, so the band is exactly one rank wide; "dressy blouse + quiet trousers" — how people actually dress up — is unreachable at ANY register setting.

**Paso re-run (Part 3's evidence):** `reuse:"maximize"` + `allow_repeat:["shoes"]` + the spec-18 workbench instruction → 18 distinct pieces and **five different pairs of footwear across five outfits**. Instruction-as-written confirmed ineffective; trend now 16/18/20/18.

## Part 1 (P0) — A plan_outfit_set call while a plan is in progress is a PARTIAL RE-PLAN, not a new plan

The spec-19 hatch instruction ("re-call plan_outfit_set with just this slot") is correct; the plan lifecycle predates it and assumes one plan per turn. Give the handler merge semantics:

When `plan_outfit_set` is called and `toolContext.pendingPlan` exists with `heldOutfits` (and/or `generatedOutfits` already carries `plan_outfit_set` cards from this turn):

1. **Carry forward everything not being re-planned.** New `pendingPlan.slots` = prior slots whose ids are NOT in the new call (with their existing `_modelWorkbench` metadata, weather labels, `originalIndex`) + the new call's normalized slots (which take the re-planned slot's original position when the label/id matches, so Monday–Friday order survives). `heldOutfits` carry forward for the kept slots. `slotWeather` merges.
2. **Constraints inherit unless restated.** The wedding re-call omitted `constraints` entirely — the merged plan keeps the original's (`no_repeat`, `allow_repeat`, `reuse`, `pieceBudget`). An explicitly passed constraints object on the re-call replaces them. The used-piece/no-repeat/budget ledgers rebuild from the carried `heldOutfits` so cross-slot rules stay coherent over the union.
3. **A re-planned slot supersedes its own prior outfits.** If the slot being re-planned already had accepted outfits (not the live case — both had 0), drop them and disclose with a plan line (`[slot re-planned: "Thursday" — 1 earlier look replaced]`).
4. **Assembly is over the union.** Final submit success assembles carried + new accepted outfits in original slot order; plan lines (roster, repeat schedule, coverage, weather) recompute over the whole set; `generatedOutfits` is the full set. The declare-intent NOTE ("N verified cards are ALREADY composed") then reports the true count.
5. Fresh-turn calls (no pending plan, no plan cards this turn) behave exactly as today.

Do NOT loosen the duplicate-`propose_outfit` gate as part of this — with merge semantics the model never needs propose to recover, and that gate has correctly held in every live run since #87–89.

Tests: the verbatim office repro (5 slots → 4 held + floor rejection → single-slot re-call at lower register → one submit → **5 cards, Mon–Fri order**); the wedding repro (3 → 2 held → ceremony re-call → 3 cards); constraints inherited when the re-call omits them (assert no_repeat still enforced across the union); re-call restating constraints overrides; re-planned slot with a prior accepted outfit → superseded + disclosure line; fresh plan unchanged.

## Part 2 — Register floor demands an ANCHOR, not uniformity

Replace the per-piece floor check in `validateSubmittedPlanOutfits` with: **the outfit passes the floor if at least one non-shoe, non-accessory piece (dress, top, bottom, or outerwear) has formality at or above the floor.** The ceiling (spec 19's `max(occasion ceiling, declared register)` reconciliation) continues to bound every piece individually — that part is right and stays.

Why this is restoration, not invention: the owner-endorsed precedent is exactly this shape — the capsule-era smart-casual rule required "an elevated-or-better NON-SHOE ANCHOR," never elevated-everything (handoff doc, 2026-07-14 follow-up quality fix). Per-piece floors reject the quiet basics that real dressed-up outfits are built on.

Effect on the live repro: at the model's original `register:"dressy"`, silk blouse (dressy anchor ✓) + everyday trousers (≤ dressy ceiling ✓) + flats passes on the FIRST submit — no re-plan, no Part 1 trap even triggered, Thursday keeps the best outfit. The ceremony guard is unaffected: an all-elevated outfit at a formal floor still has no formal anchor and still rejects.

Also update: the floor rejection message names the semantic ("no piece meets the dressy floor — include at least one dressy-or-better main piece, or re-call this slot at a lower register"); `slotFloorViability` (spec 19's unfillable detection) becomes "does ANY main-category roster piece clear the floor."

Tests: the live Thursday shape (dressy blouse + everyday trousers + flats) accepted at dressy floor; an outfit with no floor-clearing main rejected with the anchor wording + hatch; formal-floor ceremony rejection of an all-elevated outfit still fires; undeclared-register slots byte-identical (ceiling-only, as today); ceiling still rejects an above-ceiling piece on an undeclared slot.

## Part 3 — Reuse instruction gets a number

Replace the maximize instruction line in `buildPlanSlotWorkbench` with: "Reuse is set to maximize: pack at most 2 pairs of shoes across the whole set — a third only if a demanding activity (hiking, trail) requires it — and aim to repeat bottoms across slots. Every reused piece is one fewer to pack. Accessories alone do not count as reuse." A checkable number instead of a vibe. Explicitly still prompt-side per the spec-13 risk register (packing hints, never a scorer, never a validator rule — under-reuse is visible in the report and is taste, not correctness).

Measure on the next unbudgeted maximize trip: footwear count ≤ 3 and distinct pieces meaningfully under the 16–20 band = landed; unchanged = the next escalation is an owner decision (accept looser packing, or make shoe-count a disclosed soft constraint).

## Recorded watch items (no code)

- Double layer on the dinner card (sheer cardigan + wrap shawl) and the polka-dot-cardigan-over-botanical coastal layer — deleted-scorer taste territory, arriving as predicted. Owner levers: Not for me / piece rules; an instruction line only if a pattern clusters.
- Post-success `propose_outfit` rebuild urge appeared again in all three runs (blocked correctly each time). If Part 1's merge doesn't dissolve it (much of it looks like re-render-what-exists confusion), consider one line in the submit success message before any new mechanism.

## Risks

Part 1 touches the plan lifecycle's most stateful path — the repro tests are the guard, and the fresh-plan path must be pinned byte-identical. Part 2 loosens only the floor (ceiling untouched), in the direction of the documented owner precedent. Part 3 is a string.
