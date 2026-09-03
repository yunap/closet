# Spec — relevant exposure conditions

**Status:** **Ratified 2026-09-03.** **All owned work implemented** — `styling-engine/exposure.js`,
`test/exposureContext.test.js` (12 tests). **Case A passes**; the waking-exposure fallback replaces
the pre-dawn trough (§10.4). **Steps 4-6 are EXTERNAL**, gated on the thermal-band implementation
under its own spec (§10, §10.3). Case B is gated by design, not by omission. **No human stop/go checkpoint is required** — see §10.1. **Route:**
[docs/README.md](README.md).

**Supplies the input [thermal-comfort-band-spec.md](thermal-comfort-band-spec.md) §9.1 declares
missing.** That spec defines `requiredThermalBand(weather, exposureContext)` and states that
exposure must be a named, required part of the contract — then records *"What exists today:
nothing."* This spec defines where `exposureContext` comes from. **It does not define the band, the
scale, or any threshold**; §9.1–§9.3 and §12 of the band spec own those and are not restated here.

**Adapts an established model rather than inventing one.** The band spec's §11 already established
that `weather + activity → required insulation`, compared against a clothing ensemble, is ISO 11079's
IREQ shape and ASHRAE 55's input model. §11 settled that the *architecture* is legitimate. What has
never been done — and what §2.2 below does — is map Closet's **actual fields** onto that model's
input variables to find which are genuinely missing. The answer turns out to be much smaller than
this spec's first draft assumed.

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

### 2.2 Closet's fields against the standard input model

The variables every established model takes — environmental conditions, metabolic rate, clothing
insulation, exposure — mapped onto what this codebase actually stores. Measured 2026-09-03.

| Standard input | Closet's field | Exists | Thermally consumed |
|---|---|---|---|
| Air temperature | `highF` / `lowF` | yes | **yes — but sampled from the wrong window (§1)** |
| Air movement | `WIND_VALUES` = `calm\|breezy\|windy\|unknown`, resolved per turn | yes | **no** — reaches `weather_protection` only, never the thermal model |
| Precipitation | `PRECIPITATION_VALUES`, resolved per turn | yes | no — **correctly**, see §7 |
| Metabolic rate | `ACTIVITY_VALUES` = `none\|walking\|hiking` | yes, populated per slot | **no** — drives footwear walkability and discouraged materials; `thermal.js` and `outfitEnvironmentalAdequacy.js` contain zero references to it |
| Exposure mode | `environment` = `indoor\|outdoor\|beach_coastal` + the transit split | yes, populated | label only — produced `"indoor; transit: …"` and changed no selection |
| Exposure duration | — | **no** | — (only trip-length prose in `outfitSetPlanner.js`) |
| Garment insulation | `pieceWeatherScores().cold`, `thermalMaterialVerdict` | yes, PR #304 | yes |
| Ensemble insulation | — | **no** | — (band spec §9.2 owns this; not this spec) |

**Two findings, and they reshape the work.**

**A three-level metabolic proxy already exists and is thermally inert.** `none | walking | hiking` is
the variable ASHRAE 55 and IREQ treat as a core input alongside environment — the reason a hiker
needs *less* insulation than a stationary person at the same ambient temperature. Closet has it,
typed and populated on every slot, and spends it entirely on shoes.

**Wind is resolved and thermally unused.** The second environmental variable in every model is
stored per turn and only ever asks "is this garment a windbreaker", never "is this day colder than
its number".

**What is genuinely missing is smaller than it looked:** exposure duration, ensemble insulation
(owned elsewhere), and *conditions during the exposure* as a sourced value rather than a daily
envelope. Everything else is present and unconsumed.

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
resolveExposureContext(slot, resolvedWeather) → ExposureContext
```

Not *"derive the hours this outfit is worn"*. **"Resolve the environmental exposure this outfit is
expected to experience."** The first framing makes clock time the domain concept and leads to
designing a `daypart` field; the second matches how established models are structured, where the
thermal calculation consumes environmental conditions and *sourcing* those conditions is a separate
concern.

That distinction is what keeps this spec small.

### 4.1 The three inputs, lined up with the standard model

```text
resolved environmental conditions      what the air is actually doing during exposure
+ activity / exertion                   metabolic proxy — ALREADY EXISTS (§2.2)
+ exposure mode / duration              sustained outdoor · brief transit · indoor destination
→ ExposureContext

ExposureContext + requiredThermalBand  ⟷  outfit thermal contribution
```

**No semantic rules.** An earlier draft of this section derived exposure from meanings — *"an
`evening` occasion is an evening window"*, *"museum means daytime"*. That is inventing a conceptual
model Closet has no business owning, and it was removed. The inputs are the standard model's
variables; Closet supplies what it has and marks the rest `unknown`.

### 4.2 Conditions during exposure — a sourcing tier, not a field

The daily high/low is a **coarse source** for the environmental-conditions variable. It is not the
variable. Sourcing degrades explicitly:

```text
live forecast + explicit event time      → sample the hour
live forecast + approximate exposure mode → sample the window
seasonal estimate + evening slot          → the estimate states evening conditions
seasonal estimate + timing unknown        → represent a RANGE, or unknown
                                            never the daily low as though it were the answer
```

The Vienna trip is the last row: `weatherSource: model_estimate`, five weeks out. The failure was
not that the estimate was bad — it was that its 24-hour minimum was consumed as the temperature a
museum visitor experiences. An estimate that cannot express exposure conditions should say so and
carry uncertainty, which the band can then treat as a range rather than a point.

Whether the estimate schema gains a field for this is §8's measured question, not a decision here.

### 4.3 What the contract must carry

* **environmental conditions during exposure** — sourced per §4.2, with provenance, as the existing
  resolved-weather contract already does for high/low.
* **exertion** — from `activity`. Available today.
* **exposure mode** — sustained outdoor / brief transit / indoor destination, with the transit split
  preserved: an indoor destination excuses the base, never the trip (band spec §5.7). Available today.
* **duration when known** — genuinely absent; must be optional and explicitly `unknown`, never
  defaulted to all-day.
* **`unknown` as a first-class value** on every field, per the band spec's requirement that absent
  exposure be explicit rather than silently "outdoors, all day".

**Wind belongs here too** (§2.2): it is an environmental condition, it is already resolved, and it
is currently visible only to `weather_protection`. Whether it shifts the demand or is merely carried
is the band's decision, not this spec's — but it must reach the band, which today it cannot.

### 4.4 Two independent defects, staged — not one defect with an optional half

The census uncovered **two** failures, and the standard model requires both inputs to be right:

```text
correct environmental condition  +  ignored exertion   →  wrong demand
wrong environmental condition    +  correct exertion   →  ALSO wrong demand
```

**Defect 1 — existing variables are unconsumed.** Museum, hike and indoor dinner differ in
`activity` (`walking` / `hiking` / `none`) and exposure mode (`outdoor` / `outdoor` /
`indoor`+transit). Both are stored, populated and thermally inert today (§2.2), so the three slots
currently resolve to one demand. Fixing this needs no new data.

**Defect 2 — the environmental condition is wrong.** The demand for the museum slot is computed from
a 47°F pre-dawn trough nobody is dressed for. That was the original owner ruling, and it is
independent: a demand that correctly accounts for exertion is still wrong if the temperature feeding
it is the wrong one.

**Discovering that the metabolic and exposure inputs already exist does not demote environmental
conditions to optional precision.** It only means there is less new data to invent for defect 1.

The two failures have two acceptance cases and neither substitutes for the other:

```text
case A  →  the owner READS the right contextual variables      (defect 1)
case B  →  the owner RECEIVES the right environmental conditions (defect 2)
```

This matters for how the staging in §10 is read. Step 2 can deliberately prove A against today's
coarse high/low, which is a real and checkable milestone — but it **must not be reported as the
Vienna defect being fixed**. Case A can pass perfectly while the museum still gets too much coat:

```text
walking museum  → demand X
hiking          → demand X-2      activity is finally working
indoor dinner   → demand Y

...and if X is still computed from 47°F, the museum is still over-coated.
```

Step 4 is therefore **required, not optional**. Only after both does the Vienna plan satisfy case B.

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
* **Does not let the thermal band swallow adjacent axes.** ISO 9920's ensemble-insulation model
  explicitly does not cover rain and snow effects; ASHRAE and ISO keep insulation, air movement and
  evaporative effects as distinct variables. That is the standards world agreeing with the split this
  codebase already has, and it must survive:

  ```text
  thermal fit  ≠  rain protection  ≠  removability  ≠  outdoor capability
  ```

  Precipitation is resolved (§2.2) and deliberately stays with `weather_protection`. Removability
  stays its own axis (band spec §2.1, §11.5). The apparatus refused in band spec §11.7 — radiant
  temperature, evaporative resistance, metabolic watts, wind-penetration coefficients — is refused
  here too. `activity` is an **ordinal exertion proxy**, not a metabolic rate.
* Does not implement overshoot. Overshoot falls out of the band comparison once the band has the
  right input; building it separately is what
  [layer-weight-ceiling.md](layer-weight-ceiling.md) was absorbed to prevent.

## 8. Open questions

Answer with measurement, not preference. **Reordered after the §2.2 census** — the questions that
looked hardest are no longer on the critical path.

1. **Does `activity` + `exposure mode` alone produce acceptable divergence on case A?** They must
   differentiate thermal demand *before* better weather sourcing is added — that is what proves the
   existing variables are actually being consumed, and it is checkable with today's coarse high/low.
   **Correct conditions-during-exposure are independently required** to size that demand against the
   weather the outfit will actually encounter; this question establishes sequencing, not sufficiency.
   Measure it first because it decides what step 2 can claim, not whether step 4 happens.
2. **What ordinal exertion levels does `none | walking | hiking` support?** The standard model says
   higher exertion lowers required insulation at the same ambient temperature. Three levels is what
   exists; whether the demand shift is one step or two is calibration, and belongs with the band's
   scale (band spec §11.8), not here.
3. **Should wind shift the demand, or only be carried?** It is resolved today and reaches nothing
   thermal (§2.2). Establishing the pipe is this spec; whether the band reads it is the band's call.
4. **Where do exposure conditions come from when the forecast is live?** Does any provider path
   already return hourly data the resolver discards? Cheap to check, and it decides whether §4.2's
   top tier is reachable at all.
5. **And when it is a model estimate?** Adding an exposure-conditions figure to the estimate schema
   is a prompt-cost change; measure it the way `docs/tagger-cost-spec.md` measures schema growth
   before assuming it is free.
6. **Which of the 83 flag references** (§5) need a discrete boundary rather than graded fit? Band
   spec §6 has the provisional split; confirm it covers the cool-tier flags.

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

**This case must pass at step 2 of §10, before any weather-sourcing work.** The three slots differ on
`activity` and `environment` — both stored and populated today — and the principled reason is the
standard model's own: higher exertion lowers required insulation at the same ambient temperature.
A design that needs daypart data to separate a hike from a dinner has not understood the inputs.

**A passing is not the Vienna defect fixed.** This case tests that the owner READS the right
contextual variables (§4.4, defect 1). It says nothing about whether the conditions it read them
against are the right ones — case B tests that, and requires step 4.

**B — the puffer. This is the Vienna defect, and the case A does not cover.** On the plan's city
slots, `996775` (`cold 23`) is not preferred over `996767` (6) / `996764` (10). Overshoot is a
ranking penalty, never an exclusion — a wardrobe whose only layer is a heavy coat still gets dressed
(band spec §5.5).

**B requires step 4 and must not be expected to pass at step 2.** The museum slot is over-coated
because its demand is computed from a 47°F pre-dawn trough; correcting exertion alone leaves that
input untouched. A run where the hike and the dinner finally differ while the museum still wears a
puffer sized for 5am has passed A and failed B, and is **not** a fixed Vienna plan.

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

Reordered after §2.2. **The variables that already exist come first**, so the first slice can be
proved against case A without touching weather sourcing.

**Scope, after the Slice 1-2 census (owner ruling 2026-09-03).** This document's implementation
covers the exposure side only. Step 3 is an **external dependency**, not work this spec performs:

```text
THIS SPEC (#305)                       THERMAL-BAND SPEC (separate work)
  canonical ExposureContext              calibrated ordered thermal representation
  exertion / exposure-mode plumbing      requiredThermalBand
  explicit coarse/unknown provenance     outfit thermal contribution
  weather-sourcing fallback policy       overshoot/undershoot comparison
                                         migration of the old cold-tier authorities
        └────────────── seam: requiredThermalBand(weather, exposureContext) ─────┘
```

`requiredThermalBand` **must not be implemented here.** The band spec states its own `cold` score
cannot serve as the demand scale without calibration against published insulation references, and
that demand mapping comes only after those orderings are validated. Inventing a scale and
coefficients inside `exposure.js` would smuggle another spec's open questions into this one.

This spec can therefore complete its owned work — through exposure sourcing — without the downstream
band existing, and **cannot deliver the Vienna behaviour change end to end on its own.** Case B is
gated on the band, by design, not by an oversight here.

```text
1. VERIFICATION CENSUS — confirm the ownership model, then continue (§10.1).
   Every site that answers "how much warmth does this context need", including the 83 flag
   references in §5 and band spec §6's prompt-projection switches.
   Correct band spec §9.1/§7's "what exists today: nothing" with §2's measurement.

2. ExposureContext from what EXISTS: activity, exposure mode, transit split, `unknown` everywhere
   else. Conditions still sourced from today's high/low, unchanged and openly coarse.
   → Acceptance case A must already pass here (§4.4). If it does not, the model is wrong and no
     amount of daypart precision will rescue it.

3. Conditions during exposure — the §4.2 sourcing tier. Where the 47°F stops being the number.
   DONE (§10.4). Reordered ahead of the seam once the census showed the band does not exist; it
   depends on nothing downstream.

--- everything below is EXTERNAL: gated on the thermal-band implementation ---

4. Seam into requiredThermalBand as its named exposure input. Wind reaches the band for the
   first time. Cannot start until the band exists under its own spec.

5. Migrate consumers off the flags; needsRemovableCoolLayer becomes derived (§5).
   The census-tool completion test is `thermal_demand` reaching zero.

6. Acceptance cases B-E and H, then the Vienna plan re-run offline as the regression fixture.
```

### 10.1 The implementation contract

**No human stop/go checkpoint is required. Slice 1 is a verification census, not a decision gate.**
Continue through all slices when the census confirms the ownership model. Resolve ordinary
measurement, sourcing, calibration, consumer-classification and stale-code findings during
implementation. Return for an owner ruling only if measured code contradicts a ratified requirement
or exposes a genuinely new product-semantic decision.

The earlier draft required a stop here. That made sense while the architecture was unsettled; it no
longer does. This document already determines what to do with every likely census outcome, and once
an architectural owner is ratified, a human should not have to re-adjudicate implementation details
the owner contract already answers — which is the consolidation principle applied to this spec's own
process.

**Findings that are implementation work, not checkpoints:**

| Census finding | Determined by | Do this |
|---|---|---|
| No hourly provider data exists | §4.2 | Fall down the sourcing tiers; preserve uncertainty as a range |
| `none\|walking\|hiking` needs coefficient calibration | §8.2, band spec §11.8 | Calibrate against the band's ordinal scale |
| That vocabulary cannot separate the cases at all | §8.2 | Report it as evidence the vocabulary is insufficient — **do not fake precision with coefficients**; widening `ACTIVITY_VALUES` is a tagging change, specified separately |
| N of the 83 references are mere projections | §5, band spec §6 | Classify and migrate; graded consumers read the band, discrete ones read a derived projection |
| A legacy flag consumer turns out to be non-thermal | §7 | Keep that contract independent — removability, footwear and rain do **not** fold into the band |
| Stale or dead thermal code | — | Remove it with the migration, as PR #304 did with completeness |

**Findings that DO warrant returning:**

* `activity` (or `environment`) turns out not to be authoritative slot state — e.g. it is
  model-supplied prose rather than validated typed data, or it is routinely absent on real plans.
  §2.2's census is the load-bearing claim of this spec and its falsification changes the design.
* `requiredThermalBand` cannot represent the exposure distinctions §4 requires without changing its
  fundamental semantics. That is a band-contract change, and the band is not this spec's to redefine.
* A genuinely new product-semantic decision surfaces — of the kind the owner has ruled on throughout
  this arc, such as whether calendar season may ever override a thermal verdict (§6).

Everything else is the implementer's to resolve and report.

## 10.2 Slice 1 findings — measured 2026-09-03

Run `node scratch/census_thermal_demand_consumers.mjs`; inventory at
`scratch/thermal_demand_consumer_inventory.json`. Deterministic, no DB, no model calls.

### The ownership assumption holds — no escalation

§2.2's load-bearing claim is that `activity` and `environment` are authoritative slot state. §10.1
makes its falsification the reason to stop. Measured against **real history**, not the schema:

```text
53 real plan turns (freeform_generation_runs, submit_plan or plan_outfit_set)
   activity prose-inferred on     1 turn  (3 slots)
   environment prose-inferred on  1 turn
```

**52 of 53 plan turns had `activity` declared** by the model as validated enum data —
`normalizeActivity` rejects off-vocabulary values, and `hasDeclaredPlanSlotActivity` separates
declared from inferred from fallback. The claim survives contact with production. Slice 1 continues.

**One caveat worth recording, not escalating.** `normalizeActivity` returns `'none'` for both *"the
wearer is stationary"* and *"nobody said"*. As a metabolic proxy `none` is a real thermal claim, so
the exposure context must distinguish them — the plan path already can (`hasDeclaredPlanSlotActivity`),
and §4.3's `unknown`-as-first-class requirement covers it. This is the same `null`-vs-`[]` discipline
`insulating_layer_materials` needed, arriving on a different field.

### The 83 references are 55 live sites, in four classes

The 83 figure counted comment lines. Live, comment-excluded, and every one classified:

| Class | Count | Migration |
|---|---|---|
| `thermal_demand` | **20** | Migrate to `requiredThermalBand`. The actual work. |
| `projection` | 16 | Read a derived projection of the band, never a parallel flag |
| `producer` | 15 | Moves with the contract — not a reclassification |
| `non_thermal` | 4 | **Stays independent** — footwear and wet-weather contracts (§7) |

The `thermal_demand` 20 concentrate in seven owners: `evaluateOutfitEnvironmentalAdequacy` (7),
`wholeWardrobePieceTrustDecision` (3), `scoreWholeWardrobeCandidate`, `buildVisualComposerRoster`,
`weatherFitForPiece`, `piecePriorityForMission`, `slotGateEligiblePieces`, `elevatedCapsuleDemands`.
That is a tractable migration surface, and it confirms band spec §3's provisional split rather than
contradicting it.

**The projection class contains a defect the band spec already named.** `routes/ai.js:2591`'s
`isWeatherFiltered` decides whether the model hears *any* weather guidance, at a threshold crossing —
band spec §6 calls this out as having "no good reason", and this census confirms it is live. It is
projection, so it is not this slice's fix, but it should not survive the migration as a binary.

### Two corrections to the band spec

1. **§9.1's "What exists today: nothing"** is wrong about exposure signals. `activity` is typed,
   validated and declared on 52 of 53 real plan turns; `environment` likewise. Replace with §2.2.
2. **§7's "No wearing-period / daypart weather"** stands, and is the *only* genuinely missing
   variable of the four (§2.2). Duration and ensemble insulation remain missing as recorded.

### Census-tool notes

The classifier needed three corrections during this slice, each recorded in the script: a
column-0-only owner match with a 900-line lookback (a relaxed version reported local helpers like
`corroborate` as owners); context rules that refine only demand-ish sites (a stray "rain" nearby was
flipping a producer to `non_thermal`); and next-line matching for the prompt-requirement switches.
Re-run after each migration step — `thermal_demand` falling to zero is the migration's completion
test.

## 10.3 Slice 2 complete; steps 3-5 blocked, with reasons

**Slice 2 shipped.** `styling-engine/exposure.js` is the canonical owner; `test/exposureContext.test.js`
carries 10 acceptance tests including **case A, which passes**. Museum, hike and indoor dinner resolve
to materially different exposure contexts from the same date, location and forecast:

```text
museum   exertion walking   sustained_outdoor    transit false
hike     exertion hiking    sustained_outdoor    transit false
dinner   exertion none      indoor_destination   transit true
```

The divergence comes only from `activity` and `environment` — all three share `highF 65 / lowF 47`,
asserted, so nothing is smuggled in through the weather. **Defect 1 is fixed.** `conditions.coarse`
is `true` and a test fails if it is ever reported otherwise, so **defect 2 remains live and visible**.

### Blocking finding 1 — `requiredThermalBand` does not exist

Step 3 seams into it; steps 5 and case B consume it. It is unimplemented: zero references in code,
and [thermal-comfort-band-spec.md](thermal-comfort-band-spec.md) is **"No code. Thresholds
deliberately not chosen (§6)"**.

Building it means choosing the scale (band spec §11.8 sketches an ordinal one anchored to published
insulation data), the thresholds (§6, deliberately open), and how far exertion shifts demand (§8.2
here, explicitly left to the band's calibration). **This spec's §7 forbids exactly that**, and doing
it anyway would be one spec quietly deciding another's open questions.

Per §10.1 that is a genuinely new product-semantic decision. **Owner ruling needed.**

### Blocking finding 2 — no clock information exists anywhere

§8.4 is answered, and the answer has two halves.

**Hourly data is available but never requested.** The live forecast asks Open-Meteo for
`daily=temperature_2m_max,temperature_2m_min`. The provider supports `hourly=temperature_2m`; the URL
does not ask for it. So §4.2's top tier is a query change, not a provider limitation — cheap.

**But nothing says which hours the outfit is worn.** A search for any typed clock field —
`time`, `start_time`, `hour`, `time_of_day`, `daypart` — across the engine and routes returns exactly
one hit: the comment in `weather.js` acknowledging the gap. A slot carries a `date`, never a time.

This falsifies an assumption in §4.1 of this spec, which said *"the fixed assumption is the fallback,
not the design centre."* For **exertion and exposure mode** that held — they are declared on 52 of 53
real plan turns. For **conditions** it does not: there is no time information to derive a window
from, so a stated assumption is the only available path, and it is therefore the design centre for
this variable whether or not that is comfortable.

The owner deferred the fixed-hours question on the grounds that the plan might already know enough.
The census now shows it does not. **That deferral is resolved by evidence rather than prematurely,
and the question returns as a real ruling**, with two shapes:

* **(a) A stated assumption per exposure mode** — e.g. `sustained_outdoor` samples daytime hours,
  an `indoor_destination`'s transit samples the shoulders. One constant, disclosed, and the
  `ExposureContext` can already carry it honestly via `coarse` and `unknownFields`.
* **(b) A new typed slot field** for the exposure window, which the model fills like `activity` and
  `environment`. Higher fidelity, but it is a schema, prompt and tagging change with a token cost,
  and it asks the model for something users rarely state.

Recommendation: **(a) first**, because it is reversible, disclosable, and makes the hourly query
immediately useful; **(b) only if measurement shows the assumption is wrong often enough to matter**.
Not decided here.

### What remains unblocked

Nothing further. Step 4 needs finding 2 ruled; steps 3, 5 and case B need finding 1. Slices 1 and 2
are complete, green, and independently useful: the exposure owner exists, is consumed by nothing yet,
and changes no behaviour — an additive, provable no-op in the sense AGENTS.md principle 6 requires.

## 10.4 Step 3 done — the waking-exposure fallback

Owner ruling 2026-09-03, on blocking finding 2: use a **disclosed waking-exposure fallback** before
adding any typed daypart field, and make it a **weather-sourcing policy**, not a semantic one.

`resolveConditions` now returns provenance rather than a bare number:

```text
explicit_hourly                  an exposure window is known and sampled from real hourly data
waking_window_estimate           live daily high/low, waking window estimated
seasonal_waking_window_estimate  model-estimated high/low, waking window estimated
unknown                          nothing usable
```

`coarse: true` for both estimate tiers — the window is inferred, not observed. On the Vienna
forecast:

```text
daily 47-65°F   →   waking 53.3-65°F   ·   seasonal_waking_window_estimate   ·   coarse true
```

The daily envelope is **kept** as real data; nothing thermal should read it. `wakingLowF` is what a
demand model consumes.

**The policy is slot-independent, and tested to be.** It answers *"what part of the 24-hour envelope
is plausibly met while a person is out?"* — never *"when does a museum happen?"*. Museum, hike and
dinner on the same day get byte-identical conditions, `estimateWakingWindow(highF, lowF)` takes only
two numbers, and a test asserts its body references no slot field. A per-occasion window would
reintroduce exactly what §4.1 rejects.

**The offset is a stated assumption, not a calibrated constant.** It exists to stop the daily minimum
being used as exposure temperature, and the comment says so at the definition. The upgrade path is
sampling real hourly data, **not tuning the fraction**. If it proves materially wrong, that is the
evidence that would justify a typed exposure-window field — and per the ruling, only then.

`explicit_hourly` is named in the tier list and is **deliberately unreachable**: the forecast query
asks Open-Meteo for `daily=temperature_2m_max,temperature_2m_min` and never for
`hourly=temperature_2m`, and no clock fact exists to key a window. A test asserts no code path claims
that tier, so the day it becomes reachable, that test is what says so.

**What this does and does not fix.** Defect 2's *input* is corrected: the exposure temperature is no
longer the pre-dawn trough. Whether the museum stops getting a puffer depends on a demand model that
does not exist yet — case B stays gated on the band (§10.3). The spec claims no more than that.

## 11. Why this is worth doing as architecture

The last arc made garment thermal evidence trustworthy for the first time and changed no
recommendation, because nothing owned the question the evidence answers. `cold 23` versus `cold 6`
is inert until something asks *"how much thermal capacity does this context call for?"*

Four weather rules shipped in one day, each correct, each patching the previous one's blind spot;
`needsRemovableCoolLayer` was the fourth, and it produced this bug. A fifth rule is not the answer.
The answer is that the question has an owner.
