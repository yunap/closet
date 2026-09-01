# Spec — cold severity (`isColdSevere`)

**Status:** ratified — implemented 2026-08-29; amended 2026-09-01 (see "Amendment" below)
**Route:** [docs/README.md](README.md). Companion to the hot-side asymmetry fixed in
[specs/spec_24_packing_enforcement_weather_parse_layer_parity.md](specs/spec_24_packing_enforcement_weather_parse_layer_parity.md)
Part 2.

## The incident

`thread_1788050815289`, turn 1 (2026-08-29 area). User: "chilly work dinner tonight." Established
weather stored as "cool mild weather" — a reasonable paraphrase. Internally,
`weatherProfileFromContext` (`styling-engine/rules.js`) set `isCold: true` for "chilly" through the
exact same path as "freezing"/"snow"/"winter". The whole-wardrobe composer's scoring then gave a
flat `+10` relevance bonus to every heavy-fabric candidate — with no distinction between "cold
enough that heavy is fine" and "cold enough that heavy is what you actually want" — and surfaced a
long leather coat as the top-ranked outerwear candidate. The model picked it, reasoning it "carries
real warmth for a cold evening arrival and departure." Turn 3: the user called it out directly —
"why did you suggest a winter coat for a summer chilly evening?"

## Why cold was previously left alone (spec 24) — and what changed

The comment above `explicitCold` said cold was "deliberately untouched" because the hot-side defect
(a bare season word losing to an explicit heat word) had no cold-side evidence yet, and a winter
capsule's cold gating is load-bearing. That reasoning stands for the *bare-season-word* asymmetry —
there is no equivalent bug here, since "chilly" is itself the explicit condition being parsed, not
a calendar guess being overridden. This is a different defect: **`isCold` has no gradation at all**,
so "chilly" and "frigid" drive identical downstream behavior. `extractWeatherContext`
(`styling-engine/stylingIntent.js`) already independently buckets "chilly" under a `cool mild
weather` label, separate from the `cold weather` bucket (cold/freezing/frigid/snow/winter/icy) —
confirming this file's cold list, which lumps "chilly" in with "frigid", is the odd one out, not
the norm.

## The fix

`isCold` itself is unchanged in meaning and stays the *minimum-warmth* signal it always was: any
cool/cold word still excludes bare/lightweight bottoms and dresses, still requires a warm layer
somewhere in the outfit, still keeps the "cool coastal summer" and "summer rain, cool mountain"
pinned fixtures passing exactly as before. What's new is a sibling flag —
`isColdSevere` — mirroring the existing `isExtremeHeat` pattern on the hot side:

```js
const hasSevereColdSignal = /\b(cold|freezing|frigid|snow|winter)\b/.test(text) || hasColdTemperature
const explicitCold = hasSevereColdSignal || (hasCoolSignal && !strongHotSignal)
...
...(explicitCold && !explicitHot && hasSevereColdSignal ? { isColdSevere: true } : {})
```

"chilly" is removed from the severe word list (it was always redundant there — it also matches
`hasCoolSignal`, so `isCold` itself is unaffected) and now only ever produces mild cold
(`isCold: true`, `isColdSevere` absent/false). "cold", "freezing", "frigid", "snow", "winter", and
an actual temperature ≤45°F still produce `isColdSevere: true`.

Two consumers change to treat `isCold` as a floor rather than a maximization target:

1. **`getRelevanceScore`'s cold-weather bonus** (`styling-engine/rules.js`, whole-wardrobe
   composer scoring) — the `+10` heavy-fabric bonus that pushed the leather coat to the top of the
   ranking now requires `isColdSevere`, not just `isCold`. The `-10` lightweight-bottom/dress
   penalty is untouched (still fires on any `isCold`) — a linen dress is still wrong for a chilly
   evening; a leather coat is not the only right answer to one.
2. **The bounded-multi-look weather label** (`styling-engine/tools.js`, the physical-weather string
   handed to the model) — was a flat `hot weather` / `cold weather` / `mild weather` trichotomy;
   now inserts a `cool weather` tier for `isCold && !isColdSevere`, matching the wording
   `extractWeatherContext` already uses elsewhere.

## Explicit non-goals

- Does not touch `pieceWeatherScores()`/`weatherFitForPiece()` (the continuous #243/#244 thermal
  model) — that model already grades warmth continuously rather than as a flat bonus, so it isn't
  the mechanism behind this incident. Whether its monotonic "warmer is better on any cold day"
  behavior needs a ceiling is a separate, larger question, not scoped here.
- Does not wire `outerwear_role`/`weather_protection` — ratified as a future consumer in
  [outerwear-weather-capability-spec.md](outerwear-weather-capability-spec.md) §8, explicitly not
  part of this pass.
- Does not touch `validateSlotOutfitConstraints`'s "no warm layer for cold weather" check
  (`styling-engine/outfitSetPlanner.js`) — that's already a minimum ("at least one layer or a heavy
  top/dress"), not a maximization, so it needed no change.

## Regression fixtures

- `weatherProfileFromContext({ season: 'chilly work dinner tonight' })` → `isCold: true`,
  `isColdSevere` falsy.
- `weatherProfileFromContext({ season: 'freezing cold morning' })` → `isCold: true`,
  `isColdSevere: true`.
- `weatherProfileFromContext({ season: 'winter, 30F' })` → `isColdSevere: true` (existing cold
  fixture, now also asserting severity).
- `weatherProfileFromContext({ season: 'cool coastal summer' })` (pinned spec 24 fixture) →
  unchanged: `isHot: false`, `isCold: true`, `isColdSevere` falsy.
- `getRelevanceScore` (exercised via `buildVisualComposerRoster`): a heavy wool coat and a medium
  jacket, mild-chilly weather → no heavy-fabric bonus, ranking unaffected by weight; same two
  pieces under severe cold → heavy coat still gets the `+10` bonus.


---

## Amendment, 2026-09-01 — severity on a temperature RANGE comes from the daytime high

### The regression

PR #288 propagated `isColdSevere` through the structured weather path (`resolveTemperatureField` in
`styling-engine/weather.js`) by setting it equal to `isCold`, justified as *"identical thresholds:
`COLD_F` is 45, and this spec's severe rule is an actual temperature ≤45°F."*

That holds for a **single stated reading**. It is wrong for a **range**, and it reproduced the exact
incident this document exists to prevent — through the structured path instead of the prose one.

Live thread, a week-long trip:

```text
resolved: high_f 65, low_f 45  →  is_cold: true, is_cold_severe: true
```

`isCold` came from `lowF <= 45`, and severity inherited it. Two consumers then acted on it:

1. `getRelevanceScore`'s heavy-fabric `+10` bonus — **the bonus this spec gated behind
   `isColdSevere` in the first place** — ranked the puffer coat top for every slot.
2. Contract C required an outdoor-capable layer in every non-indoor slot.

Result: a black puffer coat in **all five cards** of a 65°F autumn trip, including a city walk and
nature walks. The owner called it out twice in the same thread; the model conceded both times
(*"putting the Black puffer coat on a city walk when it's 65°F is definitely too warm"*). It also
flattened variety — three `transition_layer` coats that suit 65/45 were outranked by the bonus.

### The fix, and the reasoning that shaped it

```js
const coldSevereForRange = ({ highF, lowF } = {}) =>
  Number.isFinite(highF) ? highF <= COLD_F : Number.isFinite(lowF) ? lowF <= COLD_F : false
```

The first instinct was `highF <= COLD_F || lowF <= DEEP_COLD_F`. The owner rejected the second arm
with the observation that settles it:

> the daily **low occurs before dawn**, when the wearer is asleep.

Using it to decide outfit warmth dresses someone for a temperature they experience in bed. The
**high** is the temperature they are actually out in, so *"the day never gets out of cold"* is the
honest test for this spec's own definition of the severe tier — "cold enough that heavy is what you
actually want" rather than "cold enough that heavy is fine."

```text
65/45 → isCold ✓  isColdSevere ✗     the regression case
50/30 → isCold ✓  isColdSevere ✗     a cold morning, a mild afternoon
45/45 → isCold ✓  isColdSevere ✓
40/20 → isCold ✓  isColdSevere ✓
72/58 → neither
```

**`isCold` is deliberately unchanged** and still derives from the low. It is the minimum-warmth
floor, and a 45°F morning genuinely wants a layer. Only the maximize-toward-winter tier moved.

A qualitative `cold` band still sets severity outright: someone saying "it will be cold" is
describing the day, not one pre-dawn hour. The prose path (`weatherProfileFromContext`) is untouched
— a stated single temperature has no high/low to distinguish.

### Open question, not decided here

If the daily low is largely irrelevant to what someone wears, **`isCold` keying on it is also
questionable.** A 65/45 day is currently "cold" because of 5am. The counter-argument is that evening
slots are real and the low is the only signal pointing at them — but the low overstates evening by
roughly the same margin it overstates morning.

Changing `isCold` is a far larger blast radius than changing severity: it drives the minimum-warmth
floor, bare-bottom exclusions, footwear gates and plan slot construction. It needs its own
measurement and ruling rather than riding along with this amendment.
