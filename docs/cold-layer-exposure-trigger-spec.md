# Spec — a narrow exposure-aware relaxation of the ordinary cold-layer trigger

**Status:** Ratified 2026-09-05 — ready to implement. **Route:** [docs/README.md](README.md).
Amends [cold-severity-spec.md](cold-severity-spec.md), which deferred exactly this question
("If the daily low is largely irrelevant to what someone wears, `isCold` keying on it is also
questionable... it needs its own measurement and ruling rather than riding along with this
amendment") without resolving it. Does **not** touch `isColdSevere`, `thermal-comfort-band-spec.md`'s
firewall between the legacy hard-gate family and the band, or `isCold` itself.

## 1. The problem, evidenced

Live run 1337 (`thread_1788584505940`): a resolved 65°F/45°F trip week, a nature-walk slot with
`activity: hiking`. `weather.isCold = lowF(45) <= COLD_F(45)` fired the ordinary minimum-warmth
floor (`NO_WARM_LAYER_FOR_COLD`, [outfitEnvironmentalAdequacy.js:386](../styling-engine/outfitEnvironmentalAdequacy.js)),
hard-rejecting both submitted nature-walk cards. The same weather, run through the already-shipped,
already-ratified exposure model (`exposure.js`'s waking-window estimate, crediting hiking's
exertion), rates the slot's actual thermal demand as `light` — the raw overnight low overstates
what an active midday hiker experiences by the same margin `cold-severity-spec.md` already
documented for `isColdSevere`. Confirmed by direct reproduction this session (`docs/README.md`'s
trip-roster acceptance audit): once an unrelated register-ceiling bug was fixed, the roster's
*only* structural problem left standing was this one — `cold_floor_infeasible`, driven entirely by
the raw-low trigger.

## 2. Non-goals (read before objecting)

- **Not a `requiredThermalBand()` integration.** The relaxation reuses `resolveExposureContext`'s
  raw waking-window *temperature* only — never the band's level/undershoot/overshoot judgment.
  `thermal-comfort-band-spec.md`'s ruling that the legacy hard-gate family "must never take band
  semantics" is preserved by construction, not by exception.
- **Not an exertion-degree formula.** No "+7°F for hiking." The relaxation is a binary trust
  decision — an explicitly active slot's own resolved exposure temperature is trusted over the
  overnight trough; nothing is arithmetically added or subtracted.
- **Not a global `isCold` change.** `isCold` keeps its current meaning and its 51 other consumers
  untouched. This spec adds one narrow, additive fact alongside it.
- **Not activity/exertion literacy for shared Contract C.** `evaluateOutfitEnvironmentalAdequacy`
  does not learn to resolve activity, exertion, or exposure. It receives one pre-computed boolean
  from a caller that already has every fact, with a legacy fallback for every caller that doesn't.
- **Not inferring time-of-day from activity names.** ("museum means daytime" was tried and reverted
  once already — [exposure-conditions-spec.md](exposure-conditions-spec.md) §4.1.) The relaxation
  keys on the activity's already-resolved exertion classification (`hiking`, one of three
  `ACTIVITY_VALUES`) and on occasion, both already-resolved facts — never on parsing request text.

## 3. The one slot-level fact, computed once

```text
requiresWarmLayerForColdExposure(slot)
```

Computed **once**, where the trip slot already holds every needed fact — occasion, activity,
resolved `weatherProfile`, environment — inside `buildPlanSlotWorkbench`
([outfitSetPlanner.js](../styling-engine/outfitSetPlanner.js)), alongside where `cold_layer_required`
is already assembled today. Both consumers read the *same* computed fact; neither recomputes it
independently:

- **`cold_layer_required`** (governs whether `assigned_layer_piece_ids` is legal/expected for the
  slot — [outfitSetPlanner.js:1416](../styling-engine/outfitSetPlanner.js), `slotColdLayerRequired`)
  becomes exactly this fact, replacing its current `weather.isCold`-only formula.
- **`NO_WARM_LAYER_FOR_COLD`** (the whole-outfit hard floor —
  [outfitEnvironmentalAdequacy.js:386](../styling-engine/outfitEnvironmentalAdequacy.js)) reads the
  same fact, carried onto the resolved `weatherProfile` the trip path already passes as
  `weatherContext.weatherProfile`:

  ```js
  // Producer (trip-slot resolution, outfitSetPlanner.js) — additive field, nothing removed:
  weatherProfile = { ...weatherProfile, requiresWarmLayerForColdExposure }

  // Consumer (outfitEnvironmentalAdequacy.js) — legacy fallback for every caller that doesn't
  // set the field, i.e. everything except the trip path, unchanged:
  const requiresWarmLayer = weather.requiresWarmLayerForColdExposure ?? weather.isCold
  if (requiresWarmLayer && !indoorDestination && !hasMinimumWarmLayer(list)) { ... }
  ```

  `evaluateOutfitEnvironmentalAdequacy`'s signature does not change (still `pieces,
  resolvedContext`); only a field on the already-passed `weatherProfile` object is read. The five
  existing `weatherContext` construction sites ([rules.js:5347](../styling-engine/rules.js),
  [outfitSetPlanner.js:4913](../styling-engine/outfitSetPlanner.js), three in
  [tools.js](../styling-engine/tools.js)) need **zero** changes — none of them currently set this
  field, so `?? weather.isCold` makes every one of them byte-identical to today.

## 4. The decision rule — deliberately this simple

```text
Start from legacy:
    requiresWarmLayerForColdExposure = isCold

Relax to false ONLY when ALL of the following hold:
    - isCold is true AND isColdSevere is false        (ordinary cold only; severe cold untouched)
    - the slot's destination is not indoor
    - the slot's activity is in the qualifying-exertion set: exactly {"hiking"}
      (the one ACTIVITY_VALUES entry above baseline "walking"/"none" — no new taxonomy)
    - the slot's occasion is NOT the explicit "evening" value
      (resolveOccasionProfile('evening').id === 'evening_social' — an already-resolved fact,
      never inferred from prose)
    - resolveExposureContext({activity, environment}, weatherProfile).conditions.known is true
      (a real waking-window temperature exists; otherwise conditions unavailable -> no relaxation)
    - that conditions.wakingLowF is STRICTLY GREATER than COLD_F (45)
      (the smoothed exposure temperature is genuinely above the existing threshold, not merely
      "not worse" — a tie stays conservative)

Otherwise: requiresWarmLayerForColdExposure = isCold (unchanged)
```

No new threshold, no degree arithmetic, no thermal-band dependency, no exertion formula. The claim
this rule makes is narrow and falsifiable: *"for a slot with genuinely elevated activity, in
genuinely non-severe, non-evening, non-indoor cold, with a real resolved exposure temperature, that
exposure temperature is more representative than the overnight trough."* Nothing else changes.

### Worked cases

| Case | isCold | isColdSevere | activity | occasion | wakingLowF | Result |
|---|---|---|---|---|---|---|
| 1 — Vienna hiking (the failing case) | true | false | hiking | outdoor_daytime_social / casual | ~52°F | relaxed → **false** |
| 2 — same weather, low exertion | true | false | none/walking | (non-evening) | ~52°F | **stays true** (exertion gate fails) |
| 3 — evening outing, same weather | true | false | hiking | evening | ~52°F | **stays true** (evening gate fails) |
| 4 — genuinely cold day (e.g. 35°F/20°F) | true | true or false | hiking | non-evening | <=45°F | **stays true** (wakingLowF gate fails, or severe-cold gate fails) |
| 5 — no usable exposure signal | true | false | hiking | non-evening | unknown | **stays true** (`conditions.known` gate fails) |

Case 2 is the one that makes this rule legitimate rather than a special case for hiking: the exact
same 65°F/45°F weather, absent hiking's exertion, is not relaxed. The rule is not "this trip is
warm," it is "this specific slot's own activity earns trust in the smoothed exposure figure."

## 5. What must not change (unchanged by construction, verified by test)

`requiredThermalBand`, `isColdSevere` and severe-cold validation, `transitIsCold`, sleeve-bearing
transit coverage ([outfitEnvironmentalAdequacy.js:461](../styling-engine/outfitEnvironmentalAdequacy.js)),
rain/wet logic, wind (still unwired, untouched), `hasMinimumWarmLayer` itself (the warmth-adequacy
check is not what changes — only whether it's consulted at all), assigned-layer thermal validation
(`outerwearLayerPositivelyInadequate`), roster selection prompts and schema, and every non-trip
`weatherContext` caller (§3).

## 6. Tests

Through the real trip/plan path (`validateSubmittedPlanOutfits` / `buildPlanSlotWorkbench`), one
per row of the worked-cases table in §4, plus:

- Severe cold (`isColdSevere: true`) is unaffected by this rule even with qualifying activity —
  the severe-cold branch and its own outdoor-capability checks still fire exactly as before.
- Cold transit (`transitIsCold`) and sleeve-bearing transit coverage fire unchanged — this rule
  never reads or sets any `transit*` field.
- Rain/wet exposure findings (`RAIN_PROTECTION_MISSING`) are unaffected — this rule touches only
  the `isCold` family.
- A non-trip caller (a `weatherContext` built without `requiresWarmLayerForColdExposure`, matching
  today's four other call sites) falls back to legacy `isCold` behavior exactly — a direct
  `evaluateOutfitEnvironmentalAdequacy` unit test pinning the `?? weather.isCold` fallback.

## 7. Acceptance criterion

Run-1337-style mild, active, non-severe, non-evening, non-indoor outdoor conditions no longer lose
valid outfits to the pre-dawn daily low, while genuinely cold, ambiguous, evening, indoor, and
low-exertion cases remain exactly as conservative as before. `cold_layer_required` and
`NO_WARM_LAYER_FOR_COLD` never disagree with each other, because both read the one fact computed
once at the trip slot.
