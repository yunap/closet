# Spec 17: Indoor slots lost their stated indoor weather — ba543ba regression + two latent gaps

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
**Priority:** High — regression introduced by `ba543ba` ("Fix model plan resubmit friction"), confirmed live in both 2026-07-15 model-mode tests. Restores the documented "indoor keeps winning" property of spec 15 Part 3.
**Files touched:** `styling-engine/outfitSetPlanner.js` (`normalizePlanSlots` stated-weather derivation, `isIndoorPlanSlot`), tests.

## Live evidence (model-mode A/B, 2026-07-15)

- **Paso Robles run:** the model declared `weather:"indoor"` on the Nice Restaurants slot. Plan line rendered **"Nice Restaurants — hot (live forecast, Paso Robles)"** — the stated indoor weather was silently discarded and the dinner slot composed against the hot outdoor forecast. Before `ba543ba` this slot would have been `indoor` (stated ≠ plan fallback "hot weather" → kept).
- **12-piece capsule run:** Smart Casual Brunch, Gallery Visit, and Casual Dinner each declared **both** `environment:"indoor"` and `weather:"indoor"`. All three plan lines rendered **"— hot weather"**. The model's explicit indoor declaration had zero effect on weather.

## Root cause chain

1. `ba543ba` routes the slot's raw `weather` string through `normalizePlanEnvironment` ([outfitSetPlanner.js:636](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js:636)) and zeroes `explicitWeather` whenever the result is truthy. But `normalizePlanEnvironment` accepts **three** enums — `'indoor'`, `'outdoor'`, `'beach_coastal'` — while the fix was aimed only at the live `weather:"beach_coastal"` incident. `weather:"indoor"` is now swallowed too.
2. The swallowed `'indoor'` does get promoted to `declaredEnvironment = 'indoor'`, but the `statedWeather` fallback keys **only** off `isIndoorPlanSlot` (a text regex over label/best_for/occasion) — the resolved `environment` value never implies indoor weather.
3. `isIndoorPlanSlot` ([outfitSetPlanner.js:1309](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js:1309)) misses the plural: its regex has `restaurant\b`, and "Nice Restaurant**s**" fails the word boundary. It also has no brunch/gallery/museum vocabulary (didn't matter before, because stated `weather:"indoor"` used to survive on its own).
4. Latent pre-existing gap surfaced by the same chain: an explicit `environment:"indoor"` **field** (capsule run) was also never consulted by `statedWeather` — the model declared indoor twice and still composed hot. `ba543ba` didn't create this one; it removed the accidental path (`weather:"indoor"` as stated weather) that had been masking it.

Why stated `indoor` matters mechanically: `weatherProfileFromContext('indoor')` neutralizes hot/cold — the office/restaurant design from the step-6 follow-ups ("indoor slots default to indoor weather"). Losing it re-exposes indoor slots to the summer forecast, the exact drift class (breezy/sleeveless in an office) the 2026-07-13-era fixes closed.

## Fix

### Part 1 — environment implies stated weather (the actual fix)

In `normalizePlanSlots`, replace the `statedWeather` derivation:

```js
const statedWeather = beachCoastalStatedWeather(explicitWeather, { environment }) || (
  environment === 'indoor'
    ? 'indoor'
    : environment
      ? ''   // explicit/derived outdoor or beach_coastal: the live forecast should win
      : (isIndoorPlanSlot(slot, { occasion, activity }) ? 'indoor' : '')
)
```

What this covers, case by case:

- `weather:"indoor"`, no environment field (Paso restaurants shape): `weatherAsEnvironment` promotes it to `declaredEnvironment:'indoor'` → statedWeather `'indoor'`. The round-trip that `ba543ba` broke is restored, via the environment it itself resolved.
- `environment:"indoor"` (capsule brunch/gallery/dinner shape): now honored directly — fixes the latent gap too.
- `weather:"beach_coastal"` (the incident `ba543ba` was for): unchanged — environment `beach_coastal`, statedWeather `''`, live forecast reachable. Its existing test must stay green.
- `environment:"beach_coastal"` + `weather:"indoor"` (contradictory beach slot): `explicitEnvironment` wins `declaredEnvironment`, so `environment !== 'indoor'` → statedWeather `''` — identical outcome to the existing `beachCoastalStatedWeather` contradiction rule.
- `weather:"indoor"` on a slot whose **prose** reads coastal: the `ba543ba` promotion condition (`weatherAsEnvironment === 'beach_coastal' || !proseEnvironment`) already lets the prose beach environment win; statedWeather `''` — consistent with the contradiction rule.
- **One deliberate behavior change:** an explicit `environment:"outdoor"` now suppresses the `isIndoorPlanSlot` text default (previously only `beach_coastal` did). If the model says a slot is outdoor, its declaration should beat a keyword inference from the label. Pin with a test.

Keep `weatherAsEnvironment` swallowing all three enums (do **not** narrow it to `beach_coastal`): with Part 1 in place, `weather:"indoor"` round-trips correctly through the environment, and `weather:"outdoor"` is noise-as-weather that *should* yield to the live forecast rather than become a stated string.

### Part 2 — `isIndoorPlanSlot` plural fix

`restaurant` → `restaurants?` in the regex. One-word fix; benefits engine mode and any model turn that omits both `weather` and `environment`. ("Nice Restaurants" is the literal live shape that missed.)

### Owner decision — NOT included, ask first

Extending `isIndoorPlanSlot`'s vocabulary (brunch, gallery, museum, dinner) would change **engine-mode** defaults for slots with no declaration at all. Per the gate-history discipline (missing gate ≠ bug — could be Decision A or B), this is flagged as a question, not shipped: in the capsule run the model declared `environment:"indoor"` for all three such slots, so model mode is already covered by Part 1. Only worth deciding if live runs show the model omitting both fields on indoor-ish slots.

## Tests

1. Paso restaurants shape: `{ label: 'Nice Restaurants', occasion: 'evening', weather: 'indoor' }` with `fallbackWeather: 'hot weather'` → `statedWeather === 'indoor'`, `environment === 'indoor'`.
2. Capsule brunch shape: `{ environment: 'indoor', weather: 'indoor' }` → `statedWeather === 'indoor'`.
3. `weather:"beach_coastal"` → existing `ba543ba` test unchanged (`statedWeather === ''`, environment `beach_coastal`, live forecast reachable).
4. `environment:"beach_coastal"` + `weather:"indoor"` → `statedWeather === ''` (contradiction rule preserved).
5. `weather:"outdoor"` on an office-labeled slot → `statedWeather === ''` (explicit outdoor beats the text default), environment `outdoor`.
6. `isIndoorPlanSlot` true for a "Nice Restaurants" label (plural), still false for winery/coastal/hiking text (the existing outdoor-words guard).
7. Engine-mode office/client slot with no declarations → still defaults `indoor` (regression pin on the step-6-era behavior).

## Verification (live)

Re-run both 2026-07-15 test prompts. Expected plan lines: "Nice Restaurants — indoor" (Paso), "Smart Casual Brunch — indoor; Gallery Visit — indoor; Casual Dinner — indoor" (capsule). Coastal Day must still read "(live forecast, Cambria, CA)".

## Risks

Low. The change is scoped to the `statedWeather` ternary and one regex plural. The only intentional behavior delta beyond the regression fix is `environment:"outdoor"` suppressing the indoor text-default, which is strictly more faithful to the model's declaration. Everything else is restoring pre-`ba543ba` outcomes through a cleaner mechanism (environment-implies-weather instead of weather-string-survives).
