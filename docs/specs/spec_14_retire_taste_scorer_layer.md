# Spec 14: Retire the taste-scorer layer of outfitSetPlanner.js (evidence-gated)

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


**Status:** Proposed (2026-07-15). **BLOCKED on spec 13's flip criterion** — do not start until `WARDROBE_PLAN_COMPOSE=model` is the default and has survived the live scenario families. This spec exists now so the deletion boundary is drawn while the inventory is fresh, not re-derived later.
**Priority:** Follows spec 13 mechanically.
**Files touched:** `styling-engine/outfitSetPlanner.js` (large deletion), `test/plan_outfit_set.test.js` + scorer tests, `docs/freeform-rearchitecture-handoff.md`, the text-matching ratchet baseline.

## Precondition (restated so it can't be skipped)

Spec 13 default `'model'`, N live plans across the scenario families with quality holding, `submitPlanValidationFails` converged. If any of that reverted, this spec is frozen — the engine path must stay runnable until then, which is why spec 13 touches none of the code listed below.

## The deletion boundary

The split line: **tag/profile-driven constraint = keep; keyword/prose-driven judgment = delete.** Everything below is grounded in the 2026-07-15 inventory of [outfitSetPlanner.js](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js) (2108 lines at time of writing).

### Delete — taste scorers (~700 lines)

`tripSlotFitScore` and its whole family: `tripOutfitDinnerRegisterScore`, `tripOutfitOfficeRegisterScore`, `tripOutfitSmartCasualRegisterScore`, `tripOutfitRegisterEscalationScore`, `tripOutfitBeachCoastalScore`, `tripOutfitElevatedOccasionShoeScore`, `tripOutfitAestheticGravityScore`, `tripShoeSeasonScore`, `tripPieceFabricBreathabilityScore`, `tripPieceWalkabilityScore`, `tripDaytimeBottomScore`, `tripPieceIsDelicateForDay`.

**Audit step before deleting each:** any `hardRejects.push` inside it that is tag/profile-driven must already exist in spec 13's `validateSlotOutfitConstraints` (cold-layer, hot-heavy, register floor, footwear-activity, missing shoes). Grep `hardRejects.push` and check off every line — the 2026-07-15 list is: :729/:733/:740 (formal-slot register → validator's register floor), :777/:795/:802 (client-slot rules → register floor + footwear enum; verify the "dress lacks office structure" case reduces to tags or is accepted as retired taste), :824 (smart-casual anchor — taste, retire), :962 (shoes — structural check), :966/:970 (hot-heavy — validator), :980 (cold-layer — validator), :986 (walking shoes — footwear enum), :1035 (dinner register — floor), :1070 (double cardigan — taste/structure judgment, model's job now), :1079 (loafers outdoors — footwear enum territory; verify covered or accept).

### Delete — slot-type prose classifiers

`isOfficePlanSlot`, `isClientPlanSlot`, `isSmartCasualPlanSlot`, `textLooksLikeEveningPlanSlot`, `textLooksLikeBeachPlanSlot`, `textLooksLikeCoastalPlanSlot`, `isOutdoorActivePlanSlot`, `isIndoorPlanSlot`, `slotWantsElevatedShoe`'s prose leg, and — if spec 12's inference counters have hit ~0 — `normalizePlanSlotEnvironment` + `inferPlanSlotActivity`'s regex bodies. `isBeachCoastalPlanSlot` reduces to an inline `slot.environment === 'beach_coastal'` read wherever a constraint still needs it. The `isDayWalking` exception chain dissolves with its consumers.

### Delete — layer injectors and keyword machinery

`chooseEveningLayerForOutfit`, `chooseBeachCoastalLayerForOutfit`, `withEveningLayerIfUseful`, `withBeachCoastalLayerIfUseful`, `beachCoastalNeedsLayer`; `tripStructuredValueSet` / `tripPieceHasStructuredValue` / `tripShoeMatchesAny` **after** re-expressing any keeper-gate usage via real tag reads (this also finally removes garment-`name` matching from the planner — the PR #86 owner ruling applied structurally).

### Delete — the engine composition inner loop

`composeOutfitSet`'s candidate generation + scoring + `chooseScoredOutfit` reuse re-ranking ([outfitSetPlanner.js:1791-2011](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js:1791)), `buildCapsuleStructuralSeparateOutfits`, `seedTripUsedSets`' scorer-side consumers. **Scope decision to make at implementation time:** the two retired-by-default pre-routes (behind `WARDROBE_PLAN_PREROUTE`) are `composeOutfitSet`'s only other callers — if their own retirement evidence is in by then, delete the pre-routes and `composeOutfitSet` wholesale in this same pass; otherwise `composeOutfitSet` shrinks to the legacy-flag path only.

### Keep (the engine's real, generalizing capabilities)

`normalizePlanSlots` + `normalizePlanConstraints` + the cap/trim disclosure; `resolveSlotWeather` and the per-slot live-weather machinery; `filterWholeWardrobePiecesForGeneration` (lives in rules.js — untouched); `validateSlotOutfitConstraints` (spec 13's validator — now the planner's correctness heart); the ledger primitives (`violatesNoRepeat`, use-count maps, `tripOutfitKey` dedup); `selectCapsuleRoster` + quotas + register reserves; `describeSlotCoverageGap` / `describePlanCapTrim`; `annotateTripOutfit` / `attachTripPlanMetadata` and the objective-driven report functions.

**Known remnant, explicitly accepted:** `capsuleVersatilityScore`'s neutral-color/fabric keyword lists are the last taste island (it curates the capsule pool, not outfits). It stays with the roster per spec 13's ruling #1 (Yuna 2026-07-15: engine curates); if roster curation later moves to the model on evidence, it retires the same way. Do not expand it in the meantime.

## Tests

- Scorer/classifier unit tests are deleted WITH their subjects — do not port them onto the validator; the validator gets its own tag-driven tests in spec 13.
- The live incidents the scorers encoded (beach fussy fabrics, dinner cover-up drift, office prints, shoe rotation) split two ways: constraint-shaped ones become `validateSlotOutfitConstraints` unit tests; taste-shaped ones become entries in the handoff doc's live test plan — per the house rule, `npm test` cannot verify model judgment, only live runs can, and pretending otherwise is how the scorers grew in the first place.
- Source-scan tests (spec 9, observability registry) re-point where symbols moved/died — the PR #58 precedent.
- The text-matching ratchet baseline drops substantially (this file is regex-dense); rebaseline downward in the same PR so the ratchet's teeth stay at the new floor.

## What this buys

The next "day at the beach" — sailing, festival, monsoon week, ski trip — costs: possibly one enum value (spec 12), possibly one tag-driven validator rule *if it carries a genuine correctness constraint*, and zero scorer code. The model's world knowledge covers the taste for free, which is the only thing that scales to occasions nobody predicted.
