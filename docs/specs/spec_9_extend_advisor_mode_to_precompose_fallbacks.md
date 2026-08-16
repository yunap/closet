# Spec 9: Extend advisor mode to the `/ask` precompose fallback tiers (Paths C/E)

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


**Status:** Ready for implementation — but sequence after spec 8 (see Out of scope).
**Priority:** Medium — matches an already-ratified decision (Decision B, 2026-06-25 "Restore visual composer fidelity" commit) to two call sites that never received it, rather than introducing anything new.
**Files touched:** `routes/ai.js` (two call sites), tests.

---

## Finding

`locallyGateWholeWardrobeOutfits` (rules.js:4072) supports two modes: `'gate'` (default — silently discard an outfit that fails a soft/subjective check: body-shape framing, mood-miss, pattern volume, soft-neutral drift, profile-discouraged) and `'advisor'` (keep the outfit, attach a caution flag via `appendSystemFlag` instead). On 2026-06-25, the primary visual composer was migrated to `mode: 'advisor'` specifically to stop "missing outfit counts / broken cards" — outfits silently vanishing from the result set because of a soft check, not a real correctness failure.

Four call sites total, traced this session:

| Call site | Context | Mode |
|---|---|---|
| ai.js:1034 | Trip-slot ranking, inside `buildLocalTripSlotOutfits` | `gate` (default, unset) |
| ai.js:1268 | `/ask` precompose's own last-resort fallback tier, inside `maybePrecomposeStructuredOutfitsForAsk` | `gate` (default, unset) |
| ai.js:2647 | Visual composer, model-proposed outfits | `advisor` |
| ai.js:2659 | Visual composer, local backfill | `advisor` |

The two `gate`-mode call sites are both inside `/ask`'s own precompose — meaning the exact "missing outfit count" failure mode the June decision fixed for the composer is still live on every freeform chat turn that reaches either of these tiers (trip planning, or the fallback used when the primary composer and trip-precompose both come up short).

## Approach

Pass `mode: 'advisor'` at both call sites (ai.js:1034, ai.js:1268), following the same `{ mode: 'advisor', requireShoes: true, rejectProfileDiscouraged: true, applyDiversity: false, ... }` shape the composer already uses (ai.js:2647) as the starting point — but two per-site questions need a decision, not an assumption of parity:

1. **`applyDiversity`** — the composer turns this off. Trip-slot ranking (ai.js:1034) is arguably a context where diversity across the whole trip matters more, not less (repeat-wear across days is exactly the kind of thing `/ask`'s prompt-side "Current Outfit Set" logic already cares about) — worth deciding per-site rather than copying the composer's setting.
2. **`rejectProfileDiscouraged`** — the composer sets this `true`, meaning a profile-*discouraged* (not prohibited) piece still gets hard-rejected even in advisor mode. Decide whether that's right for the fallback tier too, or whether the fallback — already scraping the bottom of the barrel by the time it's reached — should be more permissive here specifically.

## Interaction with spec 8 — read before implementing

`locallyGateWholeWardrobeOutfits`'s mode ternary (rules.js:4086-4088) is:
```js
let repaired = advisorMode
  ? { ...outfit }
  : repairWholeWardrobeOutfit(outfit, candidatePieces, occasion, mood, { season, weatherProfile: resolvedWeatherProfile, activity })
```
Switching these two call sites to `advisor` mode means they **stop calling `repairWholeWardrobeOutfit` entirely** — which is one of spec 8's fix targets (it's one of the `wholeWardrobePieceTrustDecision` callers with no register/footwear gate). If spec 9 ships first, these two call sites lose `repairWholeWardrobeOutfit`'s slot-repair behavior *and* never got spec 8's fix in the first place — need to separately confirm outfits arriving here are already structurally complete enough not to need repair (check `isOutfitStructurallyValid`'s `requireShoes` gate immediately below, rules.js:4094, still runs in both modes and would reject an incomplete outfit outright — so the practical risk is losing a slot-*fill* that would have turned an otherwise-rejected outfit into a kept one, not a correctness regression, but worth confirming with a live check).

**Recommend implementing spec 8 first**, so that by the time these two call sites stop repairing, the repair path they're leaving behind was already fully gated — otherwise there's a brief window where the fix removes a partially-gated repair step and nothing replaces its register/footwear coverage until spec 8 lands separately.

## Tests

1. Assert both call sites pass `mode: 'advisor'` (source-string test, matching this codebase's existing convention for asserting call-site config — see `test/gateMetadataPhase1.test.js` for the pattern).
2. A targeted behavioral test on each of the two fixed call sites: construct an outfit that fails a soft/subjective check (e.g. `wholeWardrobeMissesMood`) and confirm it's now kept-with-flag rather than dropped — mirror `test/outfit_structure.test.js`'s existing advisor-mode test structure (see the "does not post-filter walking footwear" test as a template for shape, though its assertion itself needs updating per spec 8).
3. Confirm the hard checks (`isOutfitStructurallyValid`, non-owned-piece, user-excluded, duplicate-formula) still reject outright in advisor mode — these aren't part of Decision B and must keep working exactly as before; the composer's own advisor-mode tests already establish this contract, just re-confirm it holds for these two call sites too.
4. Full existing suite green.

## Out of scope

- The register-ceiling/footwear-enum gates themselves — these remain hard-reject in both modes, confirmed directly by Yuna as a separate axis from Decision B; advisor mode does not touch them. That's spec 8's territory.
- Any change to `repairWholeWardrobeOutfit` itself.
