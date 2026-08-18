# Spec 8: Retire `wholeWardrobePieceTrustDecision`'s partial gate reimplementation

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


**Status:** Ready for specification review — one behavior-change consideration flagged below needs your sign-off before implementation starts, consistent with how register-ceiling work has always been ratified in this codebase (chapter 6's per-occasion ratification doc).
**Priority:** High — this is the "root cause" item from the 2026-07-09 architecture review's verdict: every gate-coverage bug found this cycle (specs 5, 7, plus two gaps found live during that review) traced to this one function's partial, opt-in reimplementation of gates that already exist, fully, elsewhere.
**Files touched:** `styling-engine/rules.js` (`wholeWardrobePieceTrustDecision`, `locallyGateWholeWardrobeOutfits`), tests.

---

## Finding

Two shared, correct verdict helpers already exist — `footwearComfortVerdict` and `registerCeilingVerdict` (rules.js:1688, 1700) — and two composition paths already call them with full coverage: `search_wardrobe` (tools.js:403, resolves `activityProfile`+`registerCeiling` unconditionally) and `buildVisualComposerRoster` (rules.js:2085/2094, calls the verdict helpers directly). Both are correct and out of scope for this spec.

A third function, `wholeWardrobePieceTrustDecision` (rules.js:1816), calls `profileRuleFit` but only ever passes `registerCeiling`, and only when a caller opts in via `options.applyRegisterCeiling`/`options.registerCeiling` (spec 5). It never passes `activityProfile`, by deliberate spec-5-era scope decision (its own code comment, rules.js:1905-1909): passing `activityProfile` would also switch on the footwear-enum gate for every caller, which spec 5 called out of scope for a register-ceiling-only fix.

**Traced this session — the complete caller inventory (not previously fully mapped):**

| Call site | Opts into `registerCeiling` today? | Gets `activityProfile` (footwear-enum) today? |
|---|---|---|
| `rankedComplementaryWardrobeFor` (rules.js:888) | No | No |
| `filterWholeWardrobePiecesForGeneration` → `chooseEveningLayerForOutfit` (ai.js:937) | No | No |
| `filterWholeWardrobePiecesForGeneration` → `buildLocalTripSlotOutfits` main loop (ai.js:998) | Yes (spec 5) | No |
| `filterWholeWardrobePiecesForGeneration` → `/ask` precompose fallback pre-filter (ai.js:1235) | Yes (spec 5) | No |
| `filterWholeWardrobePiecesForGeneration` → `generateWholeWardrobeOutfitsVisualInternal` pre-filter (ai.js:2362) | No | No — but harmless, re-gated fully downstream by `buildVisualComposerRoster` |
| `filterWholeWardrobePiecesForGeneration` → `repairWholeWardrobeOutfit` (rules.js:3700) | No | No |
| `scoreWholeWardrobeCandidate`'s support-only soft-penalty signal (rules.js:2953) | No | No (uses `decision.supportOnly`, a soft score adjustment, not a hard filter) |
| `search_wardrobe`'s stage-1 occasion pre-narrowing (tools.js:318) | No | No — but harmless, re-gated fully downstream by the same function's own direct `profileRuleFit` call (tools.js:403) |

A third, independent direct caller of `profileRuleFit` also lacks both gates and isn't part of the `wholeWardrobePieceTrustDecision` family at all:

- `locallyGateWholeWardrobeOutfits`'s own final check (rules.js:4145): `profileRuleFit(piece, mergedRules, { weatherProfile: resolvedWeatherProfile, occasionProfile })` — no `activityProfile`, no `registerCeiling`. This is the last gate an outfit passes through before shipping in the `/ask` precompose fallback tier and the trip-slot ranking tier — confirmed via `test/outfit_structure.test.js`'s own test title ("advisor mode does not post-filter walking footwear by structured enums") that this is currently true by construction, not accident.

**Net: two genuinely live, unpatched gaps** (the ones with "No / No" and reachable in production, not the two "harmless" ones with downstream re-gating) — `rankedComplementaryWardrobeFor`, `chooseEveningLayerForOutfit`, `repairWholeWardrobeOutfit`, and `locallyGateWholeWardrobeOutfits`'s final check — plus **two already-patched-but-incomplete ones** (`buildLocalTripSlotOutfits`, the `/ask` fallback pre-filter — register-ceiling only, still no footwear-enum).

## Approach

Retire the opt-in machinery. Make `wholeWardrobePieceTrustDecision` **always** resolve `activityProfile` (it already does, unconditionally, at the top of the function — line ~1845) and pass **both** `activityProfile` and `registerCeiling` into its `profileRuleFit` call (rules.js:1910), removing `options.applyRegisterCeiling`/`options.registerCeiling` as a gate on whether that happens. Every caller in the table above gets full coverage automatically, with no per-call-site changes needed — this is "closing the gap structurally, at its root" as the architecture review's verdict put it, instead of patching one call site per spec (which is what specs 1 and 5 each did once, and which is exactly how the two live gaps above went unnoticed).

Separately, add `activityProfile`+`registerCeiling` to `locallyGateWholeWardrobeOutfits`'s own direct `profileRuleFit` call (rules.js:4145) — it isn't part of the `wholeWardrobePieceTrustDecision` family, so the change above doesn't reach it; it needs its own one-line fix. This function already resolves `occasionProfile`/`activityProfile` locally (rules.js:4081-4082) for its `mergedRules` computation, so `activityProfile` is already in scope — resolve `registerCeiling` the same way `buildVisualComposerRoster` does (via `resolveRegisterCeiling`) and pass both through.

## Behavior change — needs your sign-off before implementation

Enabling `activityProfile` inside `profileRuleFit` does two things at once for every one of these call sites, for the first time (this already happened for `search_wardrobe` in spec 1, so the mechanism itself is proven, just not yet applied here):

1. Turns **on** the structured `heel_height`/`walk_support` enum check.
2. Turns **off** the legacy phrase-list footwear checks (`prohibited_footwear`/`discouraged_footwear` string matching, rules.js:1754-1765 and 1793-1797) for that call — `profileRuleFit`'s own branching is `if (isShoe && !activityProfile)` for the legacy path.

This is the intended replacement (structured enums over phrase-matching is the whole thrust of chapter 6's work), but because it's landing on 6+ call sites at once rather than one, a piece that currently passes one of these paths only because of a footwear phrase-list miss — or that has an untagged `heel_height`/`walk_support` — could now come back excluded, or newly flagged `unknown` (untagged, enum-gated) instead of silently passing. Worth a quick before/after check against a representative wardrobe slice before shipping, the way register-ceiling rollout got checked per occasion in chapter 6 — not a full ratification doc, just a sanity pass.

Also: `scoreWholeWardrobeCandidate`'s soft support-only signal (rules.js:2953) is a separate, lower-priority question — should it also get `activityProfile`/`registerCeiling` passed through `options` for consistency, or is a soft scoring signal fine staying as-is since it never hard-excludes anything? Recommend yes for consistency, but this is easily separable if you'd rather defer it.

## Tests

1. Direct unit tests on `wholeWardrobePieceTrustDecision`: a piece with an excluded `heel_height` is now excluded without needing `options.applyRegisterCeiling`; a piece over a resolved register ceiling is now excluded without needing `options.registerCeiling`.
2. Regression tests confirming pieces that were already correctly gated (occasion exclusions, weather) are unaffected.
3. A test on `locallyGateWholeWardrobeOutfits`'s final check confirming a footwear-enum-excluded piece is now caught (this directly contradicts and should replace/update `test/outfit_structure.test.js`'s existing "does not post-filter walking footwear by structured enums" test — that test's current behavior is exactly the gap this spec closes, so its assertion needs to flip, not just get a new sibling test).
4. Full existing suite green — this is the highest-blast-radius change of the three specs in this batch; expect some existing fixture data (pieces without `heel_height`/`walk_support`/`formality` tags) may need attention if tests start returning `unknown` where they previously returned a tier.

## Out of scope

- `footwearComfortVerdict`/`registerCeilingVerdict` themselves (already correct, spec 1).
- `search_wardrobe`'s and `buildVisualComposerRoster`'s already-full gating (unaffected — no behavior change there).
- The `mode: 'gate'` vs `mode: 'advisor'` (reject vs. flag) question — that's spec 9, and touches some of the same call sites (`locallyGateWholeWardrobeOutfits`'s advisor-mode ternary at rules.js:4086 skips calling `repairWholeWardrobeOutfit` entirely, which is one of this spec's targets) — **recommend implementing this spec before spec 9**, since spec 9's behavior for these paths depends on whether `repairWholeWardrobeOutfit` is even in the call path by the time it runs.
