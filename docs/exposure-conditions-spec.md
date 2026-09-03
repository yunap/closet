# Spec — relevant exposure conditions

**Status:** Proposed 2026-09-03, no implementation. **Route:** [docs/README.md](README.md).

**Supplies the input [thermal-comfort-band-spec.md](thermal-comfort-band-spec.md) §9.1 declares
missing.** That spec defines `requiredThermalBand(weather, exposureContext)` and states that
exposure must be a named, required part of the contract — then records *"What exists today:
nothing."* This spec defines where `exposureContext` comes from. **It does not define the band, the
scale, or any threshold**; §9.1–§9.3 and §12 of the band spec own those and are not restated here.

Deliberately NOT a weather spec. No new forecast source, no new heuristic, no Fahrenheit constant.
The object being added is an ownership seam.

---

## 1. The defect

`thread_1788401611165`, 2026-09-03. A week in Vienna, Virginia from October 12: museums, city
sightseeing, nature walks with friends. Six cards shipped. Every one carries the **same** weather:

```text
city · walking          65°F high / 47°F low — seasonal estimate
city · walking          65°F high / 47°F low — seasonal estimate
city · walking          65°F high / 47°F low — seasonal estimate
casual · hiking         65°F high / 47°F low — seasonal estimate
casual · hiking         65°F high / 47°F low — seasonal estimate
smart casual · none     indoor; transit: 65°F high / 47°F low — seasonal estimate
```

A museum day, a woodland hike and an indoor dinner were sized against one 24-hour envelope.

The visible symptom was a **down puffer coat on all three 65°F city days**, and
`light beige linen wide-leg pants` (`season: warm`, `fabric_weight: light`) on the same trip. The
puffer is the failure [layer-weight-ceiling.md](layer-weight-ceiling.md) already recorded across
five runs and two providers.

**The puffer was not chosen badly. It was required.** `needsRemovableCoolLayerForRange`
([weather.js](../styling-engine/weather.js)) keys on `lowF` alone:

```text
65/47  →  isCold: false · isColdSevere: false · needsRemovableCoolLayer: true
```

A layer is mandatory, nothing bounds how warm it may be, so the warmest coat owned is the safest
answer. The code already knows this is a compromise:

> *"visit does not really need a layer mandated by the 5am low; narrowing that needs daypart weather
> the planner does not have, so the conservative all-day answer ships first."*

**Owner ruling, 2026-09-03:** the layer is genuinely needed — mornings and evenings out are cool.
**47°F is simply not the temperature to size it for.** It is a pre-dawn trough that nobody is
dressed for. The 47°F is not wrong weather *data*; it is the wrong *decision input*.

That distinction is the whole spec. A ceiling built on top of the wrong window would make the
distortion more sophisticated, not smaller.

## 2. Census — this is not a missing-input problem

The band spec's §9.1 says the only exposure signals are `environment` and the transit split, and §7
lists daypart as missing information. **Measured on the live plan path, that understates what
exists.** A `plan_outfit_set` slot already carries, as typed fields the model fills:

| Field | Values | Present in the Vienna plan |
|---|---|---|
| `occasion` | enum, includes a distinct `evening` | `city`, `casual`, `smart casual` |
| `activity` | enum — the physical-demand axis | `walking`, `hiking`, `none` |
| `environment` | `indoor` / `outdoor` / `beach_coastal` | `indoor` on the dinner slot |
| `date` | per-slot `YYYY-MM-DD`, overrides the plan range | inherited |
| `location` | per-slot, geocoded — "this is how microclimates get caught" | inherited |
| `count`, `register`, `label` | — | populated |

`planSlotEnvironmentInferred: 0` and `planSlotActivityInferred: 0` for this turn: **nothing had to
be guessed.** The model supplied them.

The signal even reaches prose today. `environment: indoor` produced the label
`"indoor; transit: 65°F high / 47°F low"` — the transit-versus-base distinction, correctly stated,
**changing nothing about what was selected.** The schema's own description already asserts the
principle: *"the outside temperature still governs transit and cold-weather coverage, while the
indoor base may stay light."*

**Conclusion.** Museum, hike and dinner are already distinguishable from stored, typed, populated
fields. The system collapses them into one envelope on the way to the thermal decision. What is
missing is not daypart data — it is an owner for the question *"what will this outfit actually
encounter?"*

Correct the band spec's §9.1 and §7 accordingly when this lands; do not leave "nothing" standing.

## 3. The ownership chain

```text
slot context            occasion · activity · environment · date · location   [EXISTS, §2]
      ↓
relevant exposure conditions                                                  [THIS SPEC, §4]
      ↓
thermal demand band                          thermal-comfort-band-spec §9.1   [that spec, not this]
      ↓
garment thermal evidence   pieceWeatherScores / thermalMaterialVerdict        [EXISTS, PR #304]
      ↓
selection · adequacy · ranking · disclosure
```

Two properties make this an ownership fix rather than another rule:

1. **One place answers "what will this outfit meet."** Not the adequacy check, not the ranker, not
   the prompt projection — each of which currently reaches for `lowF` on its own.
2. **Overshoot and undershoot become the same mechanism.** A puffer at `cold 23` on a mild museum
   day and a linen bottom on a genuinely cold one are one comparison against one band, not two rules
   bolted to opposite ends of a threshold.

The garment half is already trustworthy — PR #304 established the ordering (`996767` at `cold 6`,
`996764` at 10, `996775` at 23). **That work produced evidence with no consumer able to change a
selection.** This spec adds the consumer, which is what makes the ordering load-bearing.

## 4. The canonical object

```text
relevantExposureConditions(slot, resolvedWeather) → ExposureConditions
```

`ExposureConditions` answers, for one outfit: **which part of the day's weather this outfit is
actually worn through, and how hard.** Its fields are named in §4.2 as a contract, with values left
to Slice 2 measurement — this spec does not choose numbers.

### 4.1 Derivation, in priority order

1. **Explicit slot facts first.** `environment`, `activity`, `occasion` and any per-slot `date` /
   `location` are read as given. They are typed, model-supplied and already validated.
2. **Derived, never invented.** An `evening` occasion is an evening window; `walking` with
   `environment: outdoor` is sustained daytime exposure; `environment: indoor` splits into a light
   base window and a transit window — the split the label already describes.
3. **Fallback only when the slot supplies nothing.** A bare at-home question with no plan has no
   slot; that case gets a stated default and **must mark itself `unknown`**, per the band spec's
   requirement that absent exposure be explicit rather than silently "outdoors, all day".

**No global daypart constant.** An earlier draft of this work proposed asking the owner to rule on
fixed active hours (8am–9pm) versus activity-shifted hours. That was rejected: it converts a
product-modelling problem into a preference, and creates a constant that later has to be unwound.
The window is derived from what the slot knows; the fixed assumption is the fallback, not the
design centre.

### 4.2 Contract shape

The object must carry at least:

* **the conditions actually encountered** — not the 24h envelope. For a daytime outdoor slot this is
  warmer than `lowF`; for an evening slot it is cooler than `highF`. Sourcing is Slice 2's question
  (§8): hourly data where a live forecast exists, and a stated figure from the model estimate where
  it does not — the Vienna trip resolved `weatherSource: model_estimate` five weeks out, so an
  estimate must be able to express this the same way it already expresses high and low.
* **duration / sustained-ness** — three hours of walking is not a five-minute transit.
* **exertion** — `activity: hiking` generates output heat; `activity: none` does not.
* **the transit split** — an indoor destination excuses the base, never the trip. Band spec §5.7.
* **`unknown` as a first-class value**, never silently defaulted.

Whether these arrive as one object or several named arguments is an implementation choice. What is
not optional: **exposure is a named, required input to the band, and absent exposure is explicit.**

## 5. `needsRemovableCoolLayer` loses authority

This is a **transfer of authority, not a retune.** The flag does not get a better threshold.

It stops being the thing that decides the thermal problem. If a boolean is still wanted at a call
site, it becomes a **derived consequence** of the band — "this band requires removable outer
coverage" — computed from the demand, never a parallel flag consulted alongside it. The same
demotion the band spec §8 plans for `isCold` / `transitIsCold` / `isColdSevere`, extended to the
cool tier, which that spec's migration predates.

Current surface, to be migrated rather than left in place:

```text
needsRemovableCoolLayer            7 references outside weather.js
transitNeedsRemovableCoolLayer     6
isColdSevere                      19
isCold                            51
```

The `isCold` family's consumer audit is [thermal-comfort-band-spec.md](thermal-comfort-band-spec.md)
§3 and is **not repeated here**. This spec adds only the cool-tier flags to that migration and
states the rule: after this work, **no consumer reads a temperature threshold to decide how much
thermal capacity a context calls for.** They read the band.

`cool-weather-tier-spec.md`'s behaviour must not regress while this happens: a 65/48 day still
produces a removable-layer finding for a sleeveless tank (band spec §5.1, §5.4). The requirement
survives; only its *sizing input* changes.

## 6. Calendar season stays outside

Drawn here only to fix the boundary, because the two problems keep being solved with one mechanism:

```text
exposure conditions  →  what physical weather will this outfit encounter
calendar season      →  what is contextually right for the time of year
```

October at 70°F does not become summer. The linen wide-leg pants in §1 are wrong for an October
trip **whether or not** the afternoon is mild — that is a calendar-suitability judgment, not a
thermal one, and it must not be laundered through the thermal band to have an effect.

This retires the framing in
[piece-season-as-weather-evidence.md](piece-season-as-weather-evidence.md), which asks whether
`piece.season` should count as *corroborating weather evidence*. **Owner ruling 2026-09-03: no.**
Season is its own axis of contextual suitability. Temperature may override some seasonal
expectations — an unusually hot October day plainly changes what is wearable — but season should not
have to masquerade as thermal evidence to matter.

`calendarSeason` and `currentDate` already exist in the styling applicability context, and a plan
slot already carries its own `date`. **Designing that axis is out of scope here** and needs its own
spec; naming the boundary is what keeps this one from absorbing it.

## 7. What this spec does NOT do

* Does not define the band, its scale, its units, or any threshold — band spec §9.1, §12.
* Does not choose active hours as a constant (§4.1).
* Does not add a forecast provider or an hourly data source; it states what the contract needs and
  leaves sourcing to Slice 2.
* Does not touch `outerwear_role`, still the sole gate consumer in `outfitEnvironmentalAdequacy.js`.
* Does not design the calendar-season axis (§6).
* Does not implement overshoot. Overshoot falls out of the band comparison once the band has the
  right input; building it separately is what
  [layer-weight-ceiling.md](layer-weight-ceiling.md) was absorbed to prevent.

## 8. Open questions for Slice 2 measurement

Answer with data, not preference:

1. **Where does the encountered condition come from when the forecast is hourly?** Does any live
   provider path already return hourly data the resolver discards?
2. **And when it is a model estimate?** The estimate schema commits to a numeric high/low today.
   Adding an encountered-conditions figure is a schema change with a prompt-cost implication; measure
   it against `docs/tagger-cost-spec.md`-style budgeting before assuming it is free.
3. **How much of the Vienna plan's divergence comes from `activity` alone** versus needing a real
   daypart figure? If `hiking` vs `none` vs `walking` already separates the three cards acceptably,
   the daypart sourcing question is less urgent than it looks.
4. **Which of the 83 flag references** (§5) genuinely need a discrete boundary rather than graded
   fit? Band spec §6 has the provisional split; confirm it against the cool-tier flags.

## 9. Acceptance cases

**A — the case that exposed the defect. Same date, same location, same forecast:**

```text
museum day        occasion city        · activity walking · environment outdoor
woodland hike     occasion casual      · activity hiking  · environment outdoor
indoor dinner     occasion smart casual· activity none    · environment indoor

→ MUST NOT resolve to identical thermal demand
```

If the model cannot make these diverge **for principled reasons stated in the derivation**, the
problem is not solved. Divergence produced by an arbitrary per-occasion constant does not count.

**B — the puffer.** On the Vienna plan's city slots, `996775` (`cold 23`) is not preferred over
`996767` (6) / `996764` (10). Overshoot is a ranking penalty, never an exclusion — a wardrobe whose
only layer is a heavy coat still gets dressed (band spec §5.5).

**C — the layer requirement survives.** The same city slot still requires removable outer coverage.
The owner's ruling is that 47°F is the wrong size, not that no coat is needed. A run that answers
"no layer needed" fails this spec.

**D — a 65/48 sleeveless tank with no layer is still a finding.** `cool-weather-tier-spec.md` must
not regress.

**E — indoor destination, outdoor transit.** The dinner slot's base may stay light while its transit
window still demands coverage. One outfit, two windows, and the card says so.

**F — unknown stays unknown.** A bare at-home question with no slot context produces an explicitly
`unknown` exposure, never a silent "outdoors, all day".

**G — October is not summer, and not thermal.** A calendar-season objection to the linen pants must
be reachable **without** the thermal band changing. If §6's boundary holds, this case is failed by
the band and answered elsewhere — that is the correct outcome for this spec, and the marker that
the two axes did not get fused.

**H — one owner.** Source-level ratchet, the pattern PR #304 established: no flow outside the
exposure/band layer reads `lowF`, `highF`, or a cool/cold flag to decide how much thermal capacity a
context calls for.

## 10. Implementation order

```text
1. CENSUS ONLY — stop for review.
   Every site that currently answers "how much warmth does this context need", including the
   83 flag references in §5 and the prompt-projection switches in band spec §6.
   Correct band spec §9.1/§7's "what exists today: nothing" with §2's measurement.

2. relevantExposureConditions: contract, derivation, `unknown`, fallback. No consumers yet.

3. Seam into requiredThermalBand as its named exposure input (band spec §9.1 owns the band itself).

4. Migrate consumers off the flags; needsRemovableCoolLayer becomes derived (§5).

5. Acceptance cases A-H, then the Vienna plan re-run offline as the regression fixture.
```

Slice 1 stops for owner review before any code, matching
[architecture-ownership-consolidation-spec.md](architecture-ownership-consolidation-spec.md)'s
census-first protocol.

## 11. Why this is worth doing as architecture

The last arc made garment thermal evidence trustworthy for the first time and changed no
recommendation, because nothing owned the question the evidence answers. `cold 23` versus `cold 6`
is inert until something asks *"how much thermal capacity does this context call for?"*

Four weather rules shipped in one day, each correct, each patching the previous one's blind spot;
`needsRemovableCoolLayer` was the fourth, and it produced this bug. A fifth rule is not the answer.
The answer is that the question has an owner.
