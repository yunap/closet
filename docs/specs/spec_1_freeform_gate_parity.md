# Spec 1/3: Gate parity for search_wardrobe (freeform chat catch-up)

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


**Status:** Ready for implementation. First of a sequence bringing freeform chat's grounding discipline up to the composer's standard.
**Priority:** High — closes a known, reproducible behavioral gap (register/footwear enforcement absent from the app's most-used surface)
**Files touched:** `rules.js` (`profileRuleFit`, new shared verdict helpers), `tools.js` (`search_wardrobe` handler), `prompts.js` (`STYLIST_SYSTEM` — remove now-redundant soft instructions), tests
**Sequence note:** this spec is deliberately mechanical/fast — it ports existing hard-gate logic into an additional consumer. Spec 2 (structured outfit proposals) is the deeper architectural fix; this spec makes the current prose-based flow behaviorally correct in the meantime, since spec 2 is larger and shouldn't block closing this gap.

## Scope corrections (verified against code, 2026-07-08)

Three facts the original draft got wrong, confirmed by reading the actual code:

1. **Live weather is split out into [spec 4](spec_4_freeform_live_weather.md).** Audit confirmed `getCurrentWeatherProfile`/`getWeatherProfileForPlan` have zero references — Part 3 was greenfield, not a port, and does not belong in this "mechanical/fast" spec. Specs 1–2 keep using the existing `weatherProfileFromContext` heuristic; spec 4 upgrades the input later. **This spec is now footwear + register only.**

2. **`profileRuleFit` is a shared 3-consumer function, not `search_wardrobe`'s helper.** It is also called by `wholeWardrobePieceTrustDecision` ([rules.js:1836](../styling-engine/rules.js:1836)) and `repairWholeWardrobeOutfit` ([rules.js:4077](../styling-engine/rules.js:4077)) — both composer-path code this spec must NOT change. Therefore the new gates are **additive and mode-switched**: the enum footwear gate and register gate activate only when the caller passes the new context (`activityProfile` / `registerCeiling`). Only `search_wardrobe` passes them; the two composer-path callers pass neither and are byte-for-byte unchanged. The phrase-list footwear path is **kept for now** (still exercised by the two composer-path callers, which already have the roster's enum gate as their primary footwear guard); fully deleting it is a clean follow-up once activity context is deliberately threaded into those callers and verified.

3. **`excluded_heel_heights`/`excluded_walk_support` live on `activityProfile.rules`, NOT `mergedRules`.** `getMergedProfileRules` does not merge them in ([rules.js: getMergedProfileRules](../styling-engine/rules.js:1638)). The composer's own footwear gate reads them from `resolvedActivityProfile.rules` ([rules.js:2024](../styling-engine/rules.js:2024)). The pseudocode below is corrected accordingly.

---

## Finding (audit, 2026-07-08)

`search_wardrobe` (`tools.js:197`) computes `ruleFit` tiers (`preferred`/`neutral`/`discouraged`/`prohibited`) via `profileRuleFit` and returns **every** matching piece regardless of tier, annotated, trusting `STYLIST_SYSTEM`'s prompt instructions ("never use a piece flagged prohibited") for enforcement. `profileRuleFit` itself checks footwear via the deprecated phrase-list matcher (`pieceMatchesFootwear` against `prohibited_footwear`/`discouraged_footwear` string arrays) — not the `heel_height`/`walk_support` enums built this arc. It has no concept of `formality`/register ceiling at all. No live weather. This is the same class of soft-guidance failure the composer's hard gates were built to eliminate, unaddressed in this surface.

## Part 1 — Footwear: enum-based, matching the composer gate

Factor the composer's footwear decision (currently inlined in `buildVisualComposerRoster`'s `footwearGateReason`, [rules.js:2019](../styling-engine/rules.js:2019)) into a **shared verdict helper** both the composer and `profileRuleFit` call — one implementation, two consumers:
```js
// rules.js — pure decision, no string formatting (consumers format their own labels)
export function footwearComfortVerdict(piece, excludedHeels = [], excludedSupport = []) {
  const isShoe = piece.category === 'shoes' || wardrobeCategoryGroup(piece) === 'shoes'
  if (!isShoe || (!excludedHeels.length && !excludedSupport.length)) return { verdict: 'pass' }
  const heel = pieceHeelHeight(piece), support = pieceWalkSupport(piece)
  if (heel === null && support === null) return { verdict: 'unknown' }
  if (heel !== null && excludedHeels.includes(heel)) return { verdict: 'exclude', dimension: 'heel', value: heel }
  if (support !== null && excludedSupport.includes(support)) return { verdict: 'exclude', dimension: 'support', value: support }
  return { verdict: 'pass' }
}
```
The composer's `footwearGateReason` becomes a thin wrapper that calls this and keeps its **exact** existing reason strings (so composer telemetry/`excludedCounts` are untouched). In `profileRuleFit`, gated on `activityProfile` being passed (mode-switch, see scope correction #2):
```js
if (activityProfile) {                         // new-style consumer (search_wardrobe) → enum path
  const fw = footwearComfortVerdict(piece,
    activityProfile.rules?.excluded_heel_heights || [],
    activityProfile.rules?.excluded_walk_support || [])
  if (fw.verdict === 'exclude') {
    const label = fw.dimension === 'heel' ? `${fw.value} heel unsuitable` : `${fw.value} support unsuitable`
    return { tier: 'prohibited', label, reason: `activity profile: ${label}` }
  }
  if (fw.verdict === 'unknown') unknownLabel = 'footwear comfort not tagged'
  // note: when activityProfile is passed, SKIP the legacy phrase-list footwear path below
}
```
The legacy `pieceMatchesFootwear`/phrase-list footwear path stays in place for callers that don't pass `activityProfile` (the two composer-path consumers). Deleting it entirely is deferred per scope correction #2.

## Part 2 — Formality/register ceiling

Same shared-helper pattern. Factor the composer's register decision (`registerGateReason`, [rules.js:2010](../styling-engine/rules.js:2010)) into a shared verdict helper:
```js
export function registerCeilingVerdict(piece, registerCeilingRank) {
  if (registerCeilingRank === null || registerCeilingRank === undefined || isAccessory(piece)) return { verdict: 'pass' }
  const formality = pieceFormality(piece)
  const rank = formalityRank(formality)
  if (rank === null) return { verdict: 'unknown' }
  if (rank > registerCeilingRank) return { verdict: 'exclude', formality }
  return { verdict: 'pass' }
}
```
Composer's `registerGateReason` becomes a thin wrapper keeping its exact strings. In `profileRuleFit`, gated on a `registerCeiling` option being passed:
```js
const rv = registerCeilingVerdict(piece, formalityRank(registerCeiling))
if (rv.verdict === 'exclude') return { tier: 'prohibited', label: `${rv.formality} exceeds ${registerCeiling} ceiling`, reason: `register: ${rv.formality} exceeds ${registerCeiling} ceiling` }
if (rv.verdict === 'unknown' && !unknownLabel) unknownLabel = 'formality not tagged'
```
**Precedence:** an `exclude` from either gate wins (returns `prohibited`) over an `unknown` from the other — resolve both before returning `unknown`. `search_wardrobe` resolves the ceiling **once** before the per-piece loop (matching the composer) via `resolveRegisterCeiling({ occasion, activity, mood, request, question, occasionProfile, activityProfile })` and passes it into `profileRuleFit`. Intent text available in `toolContext` (mood/request/mission) is threaded in; the `query` arg serves as `question`.

## Part 4 — Default to exclusion; keep annotation as an explicit escape hatch

This is the core behavioral change. `search_wardrobe` gains a mode distinction:

- **Default (composing an outfit):** `prohibited`-tier results are **excluded from the returned list entirely**, not merely annotated — matching the composer roster's discipline. `discouraged` stays in results, annotated, letting the model's judgment operate on real taste tradeoffs (the same "ceiling not a target" principle from the register work — discouraged-but-permitted pieces are legitimate style choices, prohibited ones aren't).
- **Explanatory mode:** when the user is asking *about* a constraint rather than requesting outfit material ("why can't I wear heels hiking," "what's wrong with this pairing") — detectable via a tool parameter the prompt sets (`intent: 'explain'` vs default `'compose'`) — prohibited pieces ARE returned, with full reasoning, since showing-and-explaining is the actual point of that query.
- `STYLIST_SYSTEM` updates: the "Honor ruleFit tiers" instruction changes from "never use prohibited, avoid discouraged" (asking the model to self-enforce) to "results are already filtered to what's wearable for this context; discouraged pieces are shown as judgment calls" (the model no longer needs to remember to reject anything — mechanically true now, not just requested).

## Tests

1. ✗ A `heel_height: 'high'` shoe fixture excluded from `search_wardrobe` results for a walking-context query (regression: reproduces and fixes the strap-sandals-on-a-dog-walk class of miss in freeform chat).
2. ✗ A `dressy`-formality fixture excluded for a `casual`/everyday-ceiling query.
3. Explanatory-intent query returns the prohibited piece with reasoning; compose-intent query for the same context excludes it.
4. `discouraged`-tier pieces remain present and annotated in compose-intent results (not over-excluded).
5. **Composer non-regression (the load-bearing test for the shared-helper refactor):** the two composer-path callers (`wholeWardrobePieceTrustDecision` at [rules.js:1836](../styling-engine/rules.js:1836), `repairWholeWardrobeOutfit` at [rules.js:4077](../styling-engine/rules.js:4077)) produce identical output before/after, since they pass no `activityProfile`/`registerCeiling` (mode-switch off). Assert the composer's `footwearGateReason`/`registerGateReason` reason strings are byte-identical after the wrapper refactor (telemetry parity).
6. Full `npm test`; verify the shared verdict helpers are the single implementation both the composer wrappers and `profileRuleFit` call (grep: one definition, two consumers).

(Live-weather resolution tests moved to [spec 4](spec_4_freeform_live_weather.md).)

## Out of scope

- Structured outfit proposals / eliminating prose-then-parse — spec 2.
- Diagnostic/observability parity — spec 3.
- Any change to the composer's own roster gates (source of truth, unmodified).
