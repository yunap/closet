# Spec 5: Register-ceiling gate missing from the trip-precompose path

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


**Status:** Implemented (2026-07-09). Implementation notes below.

## Implementation notes (2026-07-09)

- **Scope extended by one call site beyond the original spec text.** While implementing, found `maybePrecomposeStructuredOutfitsForAsk` ([routes/ai.js:1191](../routes/ai.js:1191) — the sibling function for *new* trip-planning requests, not just follow-ups) has its own separate fallback tier (used when trip-slot planning produces nothing) with the exact same `filterWholeWardrobePiecesForGeneration` call shape and the exact same gap. Since it's the same bug class in the same feature, opted it in too (`applyRegisterCeiling: true`), not just `buildLocalTripSlotOutfits`'s own internal call.
- **Caught and fixed a real regression during implementation, before it shipped:** the first draft of the `wholeWardrobePieceTrustDecision` edit passed `activityProfile` into `profileRuleFit` unconditionally (alongside the opt-in `registerCeiling`). Since `profileRuleFit`'s footwear-enum gate checks `if (isShoe && activityProfile)` independently of the register-ceiling check, this silently turned on footwear-enum gating for **every** caller of `wholeWardrobePieceTrustDecision`, not just ones that opted in — an unreviewed scope expansion beyond "register ceiling only." Caught by the full test suite (`test/hot_weather_ranking.test.js`'s "Trail active outdoor profile" test failed — a piece expected to survive an unfiltered pre-roster pool was being excluded). Fixed by passing only `registerCeiling` into `profileRuleFit`, never `activityProfile`, from this function — the two gates are independently checked in `profileRuleFit`, so `registerCeiling` alone is sufficient for spec 5's actual scope.
- **Tests:** `test/trip_precompose_register_gate.test.js` (6) — covers the opt-in/mode-switch on both `wholeWardrobePieceTrustDecision` and `filterWholeWardrobePiecesForGeneration` directly. Did **not** write a full `buildLocalTripSlotOutfits`/`maybePrecomposeStructuredOutfitsForAsk` end-to-end test — neither function is exported, and the composer's internal candidate-scoring pipeline (`buildWholeWardrobeCandidateOutfits`/`wholeWardrobeOutfitsFromCandidates`/`locallyGateWholeWardrobeOutfits`) has zero existing test coverage to build on, making a from-scratch integration test a real risk of fragility/false confidence. The two unit tests directly exercise the actual new code; the downstream `allowedPieces` propagation is pre-existing, already-relied-upon behavior (not new integration risk). **Recommend live-testing the original repro** (gallery/art-event trip follow-up) to confirm end-to-end.
- Full suite: 346/346 green (up from 340 — 6 new tests).

---

**Status (original):** Ready for implementation. Root cause confirmed by direct code inspection (2026-07-09), triggered by a live bug: a "dressy"-formality maxi dress appeared in a "Gallery Stroll Alternative" proposal for a `gallery / art event` occasion, whose profile has `register_ceiling: "elevated"` — dressy (rank 3) exceeds elevated (rank 2) and should have been excluded.
**Priority:** High — same class of grounding miss specs 1–3 exist to close (register/footwear enforcement absent from a live-traffic path), just discovered in a fourth code path none of specs 1–4 touched.
**Files touched:** `styling-engine/rules.js` (`wholeWardrobePieceTrustDecision`), `routes/ai.js` (`buildLocalTripSlotOutfits`), tests.

---

## Finding

`search_wardrobe` (spec 1) and the composer's own roster gate (`buildVisualComposerRoster`) both correctly resolve `resolveRegisterCeiling(...)` and exclude pieces whose formality exceeds it — confirmed by re-reading both, and confirmed for this exact case: `"gallery / art event"` resolves to the `gallery_art_event` occasion profile ([occasions.js:59-68](../styling-engine/occasions.js:59)), which carries `register_ceiling: "elevated"`.

But the outfit that surfaced the bug did not go through either of those. It came from `maybePrecomposeStructuredFollowupForAsk` → `buildLocalTripSlotOutfits` ([routes/ai.js:996](../routes/ai.js:996)) — a **third, pre-existing server-side heuristic** that auto-runs on "give me another outfit"-style follow-ups in `/ask`, before the model gets a turn at all. It filters candidate pieces via `filterWholeWardrobePiecesForGeneration` → `wholeWardrobePieceTrustDecision` ([rules.js:1816](../styling-engine/rules.js:1816)), which calls `profileRuleFit(piece, mergedRules, { weatherProfile, occasionProfile })` — **no `activityProfile`, no `registerCeiling`, ever**. A codebase-wide grep for `registerCeiling`/`register_ceiling`/`resolveRegisterCeiling` confirms it appears in exactly three places: `profileRuleFit`'s own definition, `registerCeilingVerdict`, and `buildVisualComposerRoster`'s internal resolution. Nowhere in the trip-precompose call chain.

This gap predates all of specs 1–4 — it isn't a regression introduced by this arc, it's a pre-existing hole that spec 1 didn't touch because spec 1's scope was explicitly `search_wardrobe`.

## Why the fix is safe: `wholeWardrobePieceTrustDecision` already has what it needs

Unlike `profileRuleFit` (which required new inputs threaded in from callers), `wholeWardrobePieceTrustDecision` **already resolves `occasionProfile` and `activityProfile` internally** for every caller, unconditionally ([rules.js:1844-1850](../styling-engine/rules.js:1844)):
```js
const occasionProfile = resolveOccasionProfile(occasion, options.mood || '')
const activityProfile = resolveActivityProfile({ activity: options.activity, occasion, mood: options.mood || '', request: options.request || options.question || '' })
```
So the fix doesn't need new plumbing to reach this function — only to *use* what it already computes, and to accept an explicit `registerCeiling` for the (rare) callers that already resolved one themselves.

## Part 1 — Thread register-ceiling into `wholeWardrobePieceTrustDecision` (opt-in, mirroring spec 1's mode-switch)

```js
export function wholeWardrobePieceTrustDecision(piece = {}, options = {}) {
  // ...existing code through mergedRules/checkOccasion/decision unchanged...

  const registerCeiling = options.registerCeiling !== undefined
    ? options.registerCeiling
    : (options.applyRegisterCeiling
        ? resolveRegisterCeiling({ occasion, activity: options.activity, mood: options.mood || '', request: options.request || options.question || '', occasionProfile, activityProfile })
        : null)

  // ...existing weatherProfile.isHot / isCold blocks unchanged...

  const profileFit = profileRuleFit(piece, mergedRules, { weatherProfile, occasionProfile, activityProfile, registerCeiling })
  if (profileFit.tier === 'prohibited') {
    reasons.push(profileFit.reason)
  }
  // ...unchanged
}
```
**Opt-in via `options.applyRegisterCeiling: true`** (or an already-resolved `options.registerCeiling`) — not a default-on change. This preserves the existing three production callers' behavior exactly unless they explicitly ask for the gate:
- `search_wardrobe`'s pre-filter ([tools.js:317](../styling-engine/tools.js:317)) — unaffected (doesn't opt in); its *later*, authoritative register-ceiling exclusion already runs via the direct `profileRuleFit` call spec 1 added, so this pre-filter doesn't need it.
- `rankedComplementaryWardrobeFor` ([rules.js:888](../styling-engine/rules.js:888)) — unaffected (doesn't opt in); out of scope for this fix, revisit separately if it turns out to surface register-inappropriate pieces too.
- `filterWholeWardrobePiecesForGeneration` / `buildLocalTripSlotOutfits` — **opts in**, per Part 2.

## Part 2 — Opt in from `buildLocalTripSlotOutfits`

```js
// routes/ai.js, inside the per-slot loop in buildLocalTripSlotOutfits:
const { allowedPieces } = filterWholeWardrobePiecesForGeneration(allPieces, {
  occasion: slot.occasion,
  explorationMode: 'moderate',
  weatherProfile,
  mood: mood || question,
  activity: slot.activity,
  request: question,
  applyRegisterCeiling: true   // NEW — closes the gap; matches search_wardrobe/composer behavior
})
```
`filterWholeWardrobePiecesForGeneration` already forwards its whole `options` object into `wholeWardrobePieceTrustDecision` unchanged ([rules.js:1899-1905](../styling-engine/rules.js:1899)), so no change needed there beyond this one caller passing the new flag.

## Tests

1. ✗ Regression test replaying the exact bug: a `dressy`-formality dress piece, occasion `"gallery / art event"`, run through `wholeWardrobePieceTrustDecision(piece, { occasion: 'gallery / art event', applyRegisterCeiling: true })` → `allowed: false`, reason mentions the register ceiling.
2. Same piece/occasion WITHOUT `applyRegisterCeiling` → unchanged from current behavior (`allowed: true`) — proves the mode-switch, not a silent default-on change.
3. `filterWholeWardrobePiecesForGeneration` with `applyRegisterCeiling: true` excludes the dressy piece from `allowedPieces` for a gallery-occasion slot.
4. Full existing suite green — especially `test/hot_weather_ranking.test.js` and `test/occasion_exclusion.test.js`, which call `wholeWardrobePieceTrustDecision` directly across many occasions; none of those calls pass `applyRegisterCeiling`, so none should change.
5. End-to-end: a trip-precompose follow-up ("give me one other outfit") for a `gallery / art event` occasion no longer offers a dressy-formality piece.

## Out of scope

- `rankedComplementaryWardrobeFor` and `search_wardrobe`'s pre-filter — deliberately not opted in here; flagged as a possible future follow-up, not silently changed.
- Any change to `profileRuleFit`, `search_wardrobe`, or `buildVisualComposerRoster` themselves — all three are already correct; this spec only closes the one path that was never wired.
- The "ideal/wishlist mode" piece-anchored flow (`rankSelectedPieceCandidatesWithVision` + `composeStructuredOutfitsForPiece`) — see the comprehensive freeform-chat review (delivered alongside this spec) for why that one is treated as a separate, lower-priority, and arguably by-design gap rather than folded into this fix.
