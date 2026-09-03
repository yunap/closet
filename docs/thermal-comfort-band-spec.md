# Spec — decomposing `isCold` into a thermal comfort band

**Status:** **IMPLEMENTED AND MIGRATED 2026-09-03.** This is the shipped owner of thermal amount —
`requiredThermalBand` (§16) compared against `garmentWarmth` / `outfitThermalContribution` (§14, §17),
fed by `exposure.js`. Ranking, model evidence, outfit adequacy and projection surfaces all read it
(§19, §20, §22); no consumer derives thermal amount from a legacy cold flag.

**Deferred by ruling, not omission:** the parallel contracts — removable-layer need, transit sleeve
coverage, outdoor capability, footwear triggers — keep their own legacy triggers and **must never
take band semantics** (§21.1). Their calibration is a separate semantic project with its own spec.

Superseded within this document: §12's "no production code" framing, and §13's finding that the
candidate ordinal scale was internally inconsistent — §14 rebuilt it on coverage and §15 anchored it.
Sections 12-13 are the record of how that was reached, not live contract.

Verifiers: `node scratch/measure_warmth_placement.mjs` ·
`node scratch/compare_warmth_placement.mjs` · `node scratch/census_thermal_demand_consumers.mjs`
**Route:** [docs/README.md](README.md). Supersedes the *authority* of `isCold`, `transitIsCold` and
`isColdSevere`; amends [cold-severity-spec.md](cold-severity-spec.md) and
[cool-weather-tier-spec.md](cool-weather-tier-spec.md) §8, which required this audit.
**Absorbs** [layer-weight-ceiling.md](layer-weight-ceiling.md) as a required use case (§5).

## 1. Why an audit instead of another rule

Four weather rules shipped in one day, each correct, each fixing the previous one's blind spot:
severity from the high, a removable-layer tier, a transit consumer, an adequacy bar. A fifth
(#295's overshoot penalty) is queued.

That cadence is the symptom. `isCold` is a **single boolean carrying at least six distinct
questions**, so every fix necessarily lands beside the others rather than inside a shared model.
The next step is to name the questions, not to add a fifth answer.

## 2. The replacement model

```text
resolved weather + wearing/exposure context
                  ↓
        required thermal comfort band
                  ↓
   compare against outfit thermal contribution
   ↓                    ↓                    ↓
undershoot          appropriate          overshoot
finding / rank        prefer              rank penalty
```

One comparison, three outcomes — for **thermal adequacy only**.

### 2.1 What this model does NOT absorb

An earlier draft said "replacing a family of independent booleans". That is too strong, and the
audit below is itself the evidence: removable-layer need, transit sleeve coverage, outdoor-capability
and footwear construction exist as separate contracts **because total warmth does not answer them**.
The destination is a set of parallel axes, not one master object:

```text
              resolved conditions + exposure
                          ↓
        ┌──────── thermal comfort ────────┐
        │  undershoot / fit / overshoot   │
        └─────────────────────────────────┘
        + removable-layer requirement
        + environmental protection (rain/wind)
        + outerwear capability (Contract B)
        + footwear adequacy
```

Stated explicitly because the failure mode is predictable: a "thermal comfort band" is exactly the
kind of abstraction that slowly absorbs every neighbouring question until it is the next
`isCold` — one object carrying six meanings, which is the problem this document exists to end.
**Thermal fit ≠ removability ≠ rain protection ≠ outdoor capability ≠ footwear construction.**

## 3. Consumer audit

Every production reference to `isCold` / `transitIsCold` / `isColdSevere` /
`needsRemovableCoolLayer`, excluding tests, scratch and docs. Resolution and plumbing sites
(`weather.js`, `stylingContext.js`, `outfitSetPlanner.js` profile construction) are producers, not
consumers, and are listed separately in §4.

### 3.1 Thermal undershoot — "the outfit is too light for this"

| Site | Current behaviour | Notes |
|---|---|---|
| `rules.js:2618` cold-weather bottoms | excludes shorts, lightweight linen bottoms on `isCold` | discrete exclusion; the clearest undershoot case |
| `rules.js:2810` `missingWeatherGateField` | requires `length_hits_at` on medium/heavy non-pants bottoms when `isCold` | metadata completeness, gated on cold |
| `outfitEnvironmentalAdequacy.js:225` minimum-warmth floor | `isCold` → a layer or a heavy main | outfit-level, accepts base warmth |
| `outfitEnvironmentalAdequacy.js:245` severe-cold system | `isColdSevere` → outdoor-capable layer + system warmth | composes Contract A and B |
| `rules.js:3692` whole-wardrobe local gate | penalises lightweight pieces on `isCold` | ranking, not exclusion |

### 3.2 Removable-layer need — "you need something to put on"

| Site | Current behaviour |
|---|---|
| `outfitEnvironmentalAdequacy.js:186` | `needsRemovableCoolLayer` → a non-see-through layer |
| `outfitEnvironmentalAdequacy.js:225` | the `isCold` floor also satisfies here — **overlapping ownership**, currently kept disjoint by hand |

### 3.3 Thermal overshoot — "this is more than the day needs"

| Site | Current behaviour |
|---|---|
| **none** | No consumer exists. [layer-weight-ceiling.md](layer-weight-ceiling.md) documents the gap: a puffer on a 65°F museum day, five runs, two providers. The hot side has `hotWeatherInsulationReason`; the cold side has nothing. |

### 3.4 Outdoor cold-system adequacy

| Site | Current behaviour |
|---|---|
| `outfitEnvironmentalAdequacy.js:245` | severe cold + outdoor exposure → outdoor-capable layer, thermal floor, measured/unmeasured tiers |
| `core.js:2182` saved-outfit prompt | `isCold` → "avoid bare warm-weather footwear" prose |

### 3.5 Transit exposure adequacy

| Site | Current behaviour |
|---|---|
| `outfitEnvironmentalAdequacy.js:209` | `transitNeedsRemovableCoolLayer` → any warmth-contributing layer |
| `outfitEnvironmentalAdequacy.js:232` | `transitIsCold` → removable **sleeve-bearing** layer |
| `outfitEnvironmentalAdequacy.js:295` | `transitIsColdSevere` → outdoor-capable layer |
| `outfitSetPlanner.js:3681` | `transitIsCold` → prompt requirement text for indoor slots |
| `outfitSetPlanner.js:1387`, `:1703` | `isCold` forced false for indoor slots — the transit split's origin |

### 3.6 Footwear adequacy

| Site | Current behaviour |
|---|---|
| `rules.js:2645` open-toe/sandal | excluded on `isCold` \| `transitIsCold` \| `needsRemovableCoolLayer` \| transit variant |
| `rules.js:2657` ventilated/mesh | excluded on `isColdSevere` \| `transitIsColdSevere` |
| `rules.js:3724` bare-footwear coherence | `!isCold` → a bare shoe must not sit under a heavy/insulating piece |

### 3.7 Ranking from thermal fit

| Site | Current behaviour |
|---|---|
| `rules.js:3231` heavy-fabric bonus | `+10` when `isHeavy && isColdSevere` — **the direct cause of the original puffer incident** |
| `rules.js:3214` lightweight penalty | `isCold` → penalise light fabrics |
| `rules.js:196` `weatherFitForPiece` | `isCold` gates whether the graded cold score is applied at all |
| `rules.js:2218` piece priority | applies `weatherFitForPiece` only when `isHot \|\| isCold` |
| `tools.js:1454` `search_wardrobe` | attaches `weatherFit` labels only when `isHot \|\| isCold` |
| `routes/ai.js:2508` prompt assembly | `isHot \|\| isCold` decides whether weather text is sent at all |

**§3.7 is where the model is:** four of six sites use `isCold` as an on/off switch for whether graded
thermal reasoning happens at all. Below the threshold the engine says nothing about warmth — which is
exactly the 45–80°F blind spot, seen from the ranking side.

### 3.8 Display and disclosure

| Site | Current behaviour |
|---|---|
| `tools.js:3267` | `isColdSevere` → "cold weather", `isCold` → "cool weather", else "mild" |
| `outfitSetPlanner.js:871` | slot label wording |
| `rules.js:2574`, `lib/ownerGuidance.js:222` | applicability payloads exposing a `cold` boolean |

These are the only consumers that legitimately want a **coarse label**. A band model must still
project one for them.

## 4. Producers, not consumers

`weatherProfileFromContext` (`rules.js:100-167`), `resolveTemperatureField` and `BAND_FLAGS`
(`weather.js`), `profileFromResolvedWeatherContext` / `profileForEnvironment`
(`stylingContext.js`), and the planner's slot-profile construction (`outfitSetPlanner.js:1013-1031`).
These compute the flags. They are where a required-band field would be produced, and they are the
sites `[R1]` proved must be changed at the source rather than at a call site.

## 5. Required use cases

A replacement is not acceptable unless all of these hold:

1. **Undershoot** — the sleeveless tank with no layer on a 65/48 day is a finding.
2. **Overshoot** — the synthetic puffer is *not* preferred on a 65/45 museum day.
   [layer-weight-ceiling.md](layer-weight-ceiling.md) is absorbed here rather than implemented
   separately, so the penalty is not built and then immediately replaced.
3. **Owner's stated band reproduced** — that coat is right at −5 °C and wrong at +10 °C, and the
   model must land on the same side of that line without per-garment temperature ranges.
4. **Mild cold keeps its floor** — a cardigan is still a correct answer to "chilly evening".
   (`cool coastal summer`, `chilly work dinner` remain pinned.)
5. **Supply-poor wardrobes still get dressed** — overshoot is a rank penalty, never an exclusion, so
   a wardrobe whose only layer is a heavy coat still uses it.
6. **Unknown is never inadequacy** — acceptance criterion 8, violated twice in this arc already.
7. **Transit keeps its own answer** — an indoor destination excuses the base, never the trip.
8. **Coarse exposure conditions are consumed as uncertainty, never as measurement.** Added
   2026-09-03 with [exposure-conditions-spec.md](exposure-conditions-spec.md)'s implementation. That
   module now supplies `wakingLowF` — for the Vienna forecast, `53.3°F` where the old path used the
   `47°F` pre-dawn trough. **`53.3` is a stated assumption, not a measurement**, and it arrives
   flagged: `coarse: true` and `conditionsSource: seasonal_waking_window_estimate`.

   A band that reads `53.3` as a precise figure replaces *"47°F is falsely precise"* with
   *"53.3°F is falsely precise"* — the same defect, one step to the right. The band must read the
   provenance and widen its demand accordingly: a coarse window is a range, and
   `conditionsSource: unknown` is §5.6's "unknown is never inadequacy" arriving through the
   environmental input rather than the garment one.

## 6. What is deliberately NOT decided

**No replacement Fahrenheit thresholds.** The first question is which consumers genuinely need a
discrete boundary and which should consume graded fit. Provisional reading from §3:

* **genuinely discrete:** footwear exclusions (§3.6). A shoe is open-toe or it is not.
* **discrete projection, derived:** display labels (§3.8). These want a coarse word, but it should be
  computed *from* the band, not from a parallel flag.
* **genuinely graded:** relevance scoring (§3.7), outfit adequacy (§3.1, §3.4).
* **probably continuous / availability-based, needs design:** the prompt-projection switches —
  `search_wardrobe`'s `weatherFit` labels and `routes/ai.js:2508`'s decision to send weather text at
  all. Reclassified 2026-09-01: an earlier draft called these "genuinely discrete", which is wrong.
  **The binary point *is* one of the defects this audit found.** There is no good reason for the
  model to go from hearing nothing about thermal conditions to hearing full weather guidance at a
  threshold crossing; if the band says there is meaningful thermal evidence at 68/48, the model
  should receive it. The projection can be concise without being conditional. This may remove another
  threshold rather than replace it.
* **unclear, needs its own analysis:** the metadata-completeness gate (§3.2's
  `missingWeatherGateField`), which uses cold as a proxy for "this field now matters"

Choosing numbers before that split is what produced four thresholds in one day.

## 7. Missing information

* **No wearing-period / daypart weather.** [cool-weather-tier-spec.md](cool-weather-tier-spec.md)
  §5.2 records this; a band model wants it more, since a band is naturally per-exposure-window.
  **Confirmed 2026-09-03** as the only genuinely missing environmental variable of the four —
  [exposure-conditions-spec.md](exposure-conditions-spec.md) §2.2 found `activity` and wind already
  stored and thermally unconsumed, and §4.2 treats sourcing these conditions as a degradation tier
  rather than a `daypart` field.
* **No garment temperature range.** Deliberately so —
  [outerwear-weather-consolidation-spec.md](outerwear-weather-consolidation-spec.md) §20 rules out
  per-role temperature ranges, and §5.3 above shows the role+severity pairing already approximates
  one garment's real band.
* **`season` cannot express "winter".** `warm | cool | year-round` files a −5 °C puffer and a light
  trench identically. Forced mis-tag, same shape as the missing `knit` shoe value.
* **Fill type is unrecorded** — the puffer's `fiber_content` is `["unknown"]`, so the cold end of its
  band is not representable. Lowest priority.

## 8. Migration and deletion plan

1. **Define both contracts** (§9), as pure functions with no consumers. Thermal demand *and* outfit
   contribution, including exposure inputs and aggregation semantics. Behaviour unchanged.
2. **Ranking / model evidence** (§3.7). Highest value, lowest risk — a rank change cannot make an
   outfit invalid. Retires the `+10`/`−10` pair and, more importantly, removes `isCold` as the switch
   deciding whether graded weather reasoning exists at all. Delivers use cases 2 and 3.
3. **Outfit thermal adequacy** (§3.1, §3.4). Move actual undershoot/overshoot reasoning onto the
   band, preserving the measured/unmeasured discipline.
4. **Transit, removability and outdoor capability** (§3.2, §3.5). Decide **explicitly** which parts
   consume thermal demand and which remain independent contracts per §2.1. This slice exists to stop
   the thermal model swallowing non-thermal semantics by default.
5. **Footwear and projections** (§3.6, §3.8). Footwear likely stays discrete; the display label
   becomes derived *from* the band rather than parallel to it.
6. **Delete the authority.** `isCold` / `transitIsCold` / `isColdSevere` /
   `needsRemovableCoolLayer` survive only as derived labels, or are removed entirely. The arc's own
   standard: an engine carrying two overlapping cold models is the condition the consolidation work
   exists to prevent.

Each slice ships independently and is reversible. No slice may add a new threshold without recording
it here first.

### 8.1 Two pins for this arc, from the exposure work

Added 2026-09-03 on closing [exposure-conditions-spec.md](exposure-conditions-spec.md)'s PR, so this
arc starts with them rather than rediscovering them.

**`thermal_demand == 0` is the mechanical definition of done for step 6.** The exposure work's Slice
1 census classified every live reference to the cold/cool flag family into four classes and committed
the tool:

```bash
node scratch/census_thermal_demand_consumers.mjs     # → scratch/thermal_demand_consumer_inventory.json
```

Baseline 2026-09-03: **55 live sites — 20 `thermal_demand`, 16 `projection`, 15 `producer`, 4
`non_thermal`.** Re-run after each slice. The migration is complete when `thermal_demand` reaches
zero, and *only* then: a non-zero count with the band shipped means two overlapping cold models are
live, which is the exact condition §8.6 exists to prevent. The `non_thermal` 4 must NOT fall to zero
— footwear and wet-weather contracts stay independent, and their disappearance would mean the band
swallowed them.

**`isWeatherFiltered` must lose its threshold authority in step 5, not survive it.**
`routes/ai.js:2591` decides whether the model hears **any** weather guidance, at a threshold
crossing. §6 above already names this as a defect rather than a discrete consumer — *"there is no
good reason for the model to go from hearing nothing about thermal conditions to hearing full weather
guidance at a threshold crossing"* — and the census confirms it is live.

It is classified `projection`, which makes it easy to migrate mechanically and leave binary. Do not.
It is the last place an old-model switch could survive after every other cold flag is gone, and it
would be invisible: the flags would all read the band while this one quietly kept deciding whether
the band's output was mentioned at all.


---

## 9. The two contracts, before any code

Slice 1 defines both. Naming them precisely now, because a function signature becomes architecture
the moment it exists.

### 9.1 Thermal demand — exposure is an explicit input, not an afterthought

```text
requiredThermalBand(weather, exposureContext)
```

**Not** `requiredThermalBand(resolvedContext)`. §2's own diagram says *"resolved weather **+
wearing/exposure context**"*, and those are not the same object. The band for 50°F differs by
exposure in ways weather alone cannot express:

```text
50F · walking outside 3 hours          demanding, sustained
50F · five-minute restaurant transit   brief, removable coverage is enough
50F · vigorous hike                    output heat changes the answer entirely
50F · museum, outdoor transit only     two bands, one outfit
```

**The exposure half now exists.** `resolveExposureContext` (`styling-engine/exposure.js`, shipped
2026-09-03) supplies `exertion`, `exposureMode`, the transit split, wind, and conditions with
provenance. It computes no warmth and no threshold — a test enforces that it contains no Fahrenheit
constant — so this contract's demand side is still entirely unwritten and entirely this spec's.
Consume its `coarse` / `conditionsSource` fields as uncertainty (§5.8).

Passing a single blob and letting the function reach into it for exposure would repeat this arc's
signature failure: a correct primitive fed the wrong inputs. Whether the two arrive as separate
arguments or one canonical object, **exposure must be a named, required part of the contract** and
absent exposure must be an explicit `unknown`, not silently "outdoors, all day".

What exists today: **more than this section originally claimed.** Corrected 2026-09-03 by
[exposure-conditions-spec.md](exposure-conditions-spec.md) §2.2 and its Slice 1 census (§10.2).

A `plan_outfit_set` slot already carries `activity` (`none|walking|hiking` — the metabolic proxy the
standard model treats as a core input), `environment`, `occasion`, and its own `date` and `location`.
These are validated typed fields, not prose: `normalizeActivity` rejects off-vocabulary values, and
**measured across 53 real plan turns, `activity` was declared on 52 of them** (prose-inferred on 1).

They are thermally inert — `thermal.js` and `outfitEnvironmentalAdequacy.js` contain zero references
to `activity`, which currently drives footwear only. So the exposure input this contract needs is
substantially available and unconsumed, rather than absent.

**Still genuinely missing:** daypart/wearing-period conditions and duration (§7). That half of the
original claim stands.

### 9.2 Outfit thermal contribution — nothing owns it

**Audit answer: no function owns outfit-level thermal contribution.** The only aggregation in the
codebase is private to one module and one caller:

```js
// outfitEnvironmentalAdequacy.js — added in this arc's Slice D
function systemColdScore(pieces) {
  return pieces.reduce((total, piece) => total + (pieceWeatherScores(piece).cold || 0), 0)
}
```

A naive sum, consumed once, with a hand-tuned floor of 12. It should not be promoted by default.

**A scalar total is lossy in the specific way this model cannot afford.** Measured:

```text
A  heavy wool sweater + light shell + medium bottom    [ 20, -2, 0 ]   sum 18
B  light tee + heavy puffer + medium bottom            [ -8, 14, 0 ]   sum  6
```

The totals differ, but that is not the interesting part. In **A** essentially none of the warmth is
removable — take the shell off and the outfit is still warm. In **B** *all* of it is: remove the
puffer and the base is thermally negative. A single number cannot express that difference, and the
audit already proves the difference matters — removable-layer need (§3.2), transit sleeve coverage
(§3.5) and outdoor-capability (§3.4) exist as separate contracts precisely because total warmth does
not answer them.

So the contract likely needs to **preserve dimensions rather than collapse immediately**. Shape to be
designed, not asserted; something along the lines of:

```text
{ coreWarmth, legCoverage, armCoverage, removableWarmth, outerLayerWarmth }
```

Those field names are illustrative. What Slice 1 must actually settle, before any calibration:

1. Does aggregation belong in `thermal.js` beside `pieceWeatherScores`, or in a new module?
2. Scalar or structured — and if structured, which dimensions are load-bearing for the §3 buckets?
3. How does overlapping coverage combine? Summing two full-coverage garments double-counts, and
   `pieceWeatherEvidence` already exposes `hemCoverage`, `longSleeves` and `exposure` per piece.
4. What is the `unknown` contribution of an untagged garment — zero, or absent? Criterion 8 says the
   two must not be conflated, and `systemColdScore` currently conflates them.

### 9.3 Two things Slice 1 must not do

**Do not treat `pieceWeatherScores().cold` as the shared scale by default.** Slice 1 must determine
whether it is a suitable *contribution unit* or merely existing *evidence to be decomposed and
reused*. The new aggregation contract must not canonize its numeric scale without calibration. Those
weights were tuned for relative ranking inside the old system — the `[20, -2, 0]` and `[-8, 14, 0]`
readings above are informative about placement, not certified as a measure of absolute warmth
comparable against a temperature demand. An old implementation detail becoming the measurement unit
of the replacement architecture is how the replacement inherits the original's assumptions silently.

**Do not reverse-engineer the representation from §3's buckets.** Fields like `baseWarmth`,
`removableWarmth`, `outerWarmth`, `legWarmth` are tempting precisely *because* the current bugs
mention them, which makes them a description of today's failures rather than of the physics. Derive
the structure from the questions the comparison must actually preserve, and let the investigation
prove the **minimum** useful structure. The A/B measurement supplies one real requirement
(placement/removability); coverage overlap probably supplies a second; unknown evidence a third.
Three demonstrated requirements is a better starting point than seven inherited bucket names.

**No numerical calibration in Slice 1.** Ownership, shape, and the scale question above — nothing
else.

---

## 10. Slice 1 findings — measured, before any design

Three questions §9 said Slice 1 must settle. Measured against the reference wardrobe (268 active
pieces) rather than reasoned about.

### 10.1 Can `pieceWeatherScores().cold` serve as the shared scale? **No — not without calibration.**

```text
garments with thermal evidence   210
cold range                       -16 .. 17      median 0
```

Three properties disqualify it as a *demand unit*, while leaving it perfectly good as *evidence*:

1. **No temperature anchor.** The score is a sum of independent weights — `mass 8`,
   `insulatingMaterial 6`, `hemCoverage 6`, `neckline 3`, `sleeve 6`, `bare 8`. **No term references
   a temperature.** There is no mapping from a score to a °F band in either direction, so
   "contribution ≥ demand" is not a comparison the current numbers can express.
2. **No meaningful zero.** Zero is the middle of the observed range, not an origin. "12" is not
   "twice as warm" as "6"; the scale is ordinal-ish by construction and was tuned for *ranking
   pieces against each other* inside the old system.
3. **The range is narrow and centred**, which is fine for ranking and poor for expressing a
   requirement — a demand model needs headroom above and below the observed garment spread.

**Conclusion for Slice 1:** treat `pieceWeatherEvidence`'s structured terms as the reusable input and
`cold` as a derived convenience. The new contract may reuse the *evidence*; it must not adopt the
*scale* without calibrating it against something with a temperature meaning.

### 10.2 Does naive aggregation double-count coverage? **Yes.**

```text
one long-sleeve wool mid-layer            cold = 12
the same garment worn as an outer layer   cold = 12
naive sum (arms covered ONCE in reality)  cold = 24
```

`systemColdScore` sums exactly this way. Sleeve, hem and neckline terms are per-garment, so layering
two long-sleeved pieces counts the arms twice — and layering is the normal case in precisely the
conditions this model is for. Any aggregation contract must decide whether overlapping coverage
combines additively (it does not), by maximum, with diminishing returns, or by tracking covered
regions directly. `pieceWeatherEvidence` already exposes `hemCoverage`, `longSleeves`, `warmNeckline`
and `exposure` per piece, so the inputs for a region-aware answer exist.

### 10.3 Unknown vs neutral — **a real mechanism, but not a live defect here. Correcting myself.**

The mechanism is real:

```text
untagged garment   evidence = null      cold = 0
tagged, neutral    evidence = present   cold = 0
```

`systemColdScore`'s `(… .cold || 0)` maps both to the same number, so a garment nobody has measured
and a garment measured as neutral are indistinguishable once summed.

**But the incidence claim I was about to make is false.** Measured: of 58 pieces with null evidence,
**all 58 are shoes and accessories**, which `pieceWeatherEvidence` excludes deliberately.
**Zero garments** in this wardrobe hit the collision.

So this is a **latent** risk, not an observed one — worth designing against because the app is
multiuser and a freshly added or lightly tagged garment lands there immediately, but it must not be
presented as a bug currently producing bad cards. Recording the correction because overstating a
theoretical failure as a live one is a habit this arc has had to correct more than once.

### 10.4 What this implies for the contract's shape

Two of §9.2's four questions now have measured answers, and they point at the same thing: **the
aggregation cannot be a scalar sum of a scale with no origin.** The demonstrated requirements are
placement (§9.2's A/B), coverage overlap (§10.2), and unknown-vs-neutral (§10.3) — three, from
evidence, versus the seven bucket names §9.3 warns against reverse-engineering from.

Still open at the time of writing: where aggregation lives, what the structured shape is, and what
the demand side is measured *in* — which §10.1 shows is the question everything else waits on.

**§11 answers the last of those** (a small ordinal scale calibrated against published insulation
references, not `cold` points and not clo itself) and **simplifies the first** (§11.4: summation is a
sanctioned approximation for the total, with placement carried as separate information rather than
folded into it). §12 restates Slice 1 accordingly.

---

## 11. Established practice — what it validates, and what to refuse

Sources and reading in this section are **owner-supplied research (2026-09-01)**, recorded with links
so a later reader can check them. They have not been independently verified here; the value is that
they establish precedent, not that this document re-derives them.

### 11.1 The architecture in §2 is a known one

**ISO 11079** defines **IREQ — required clothing insulation**: how much insulation a person needs,
computed from climate *plus metabolic activity*, then compared against the insulation available from
their clothing. That is the same shape §2 arrived at independently:

```text
weather + exposure/activity → demand        ⟷  IREQ
clothing ensemble           → contribution  ⟷  available clothing insulation
compare the two
```

**Do not implement IREQ.** Its domain is occupational cold-stress assessment, and reference
implementations target ambient temperatures below +10 °C — the wrong end of the problem, since
Closet's failures live at 10–20 °C. Its value here is that it retires the objection that this design
is speculative.

### 11.2 It argues for deleting the threshold, not tuning it

**ASHRAE Standard 55** treats comfort as the interaction of environment **with clothing and
activity**, and explicitly accounts for individual variation. Temperature alone is not the answer.

That is a direct argument for §8's deletion step rather than a fifth threshold: the goal is retiring
the authority of `temperature <= X → cold behaviour`, not finding a better `X`.

### 11.3 Ensemble evaluation is mainstream

**ISO 9920** is specifically about estimating the thermal insulation of a clothing **ensemble** from
its garments, and ASHRAE publishes reference insulation values for individual garments and
ensembles. So §2's move from per-piece rules to outfit-level thermal adequacy is ordinary practice.

### 11.4 The most useful finding: summation is a sanctioned approximation, with a stated limit

ASHRAE permits summing individual garment insulation values as a practical ensemble estimate. **ISO
9920 states that the ensemble method does not address insulation distributed differently across body
areas, nor discomfort from asymmetric insulation.**

That is §9.2's A/B measurement and §10.2's double-counting arriving from the other direction, and it
**resolves the open aggregation question in a simplifying way**:

> Summation is an acceptable approximation for *total* insulation. Local coverage and layering
> behaviour are **separate information**, not a defect in the sum.

So Closet does not need a sophisticated region-aware aggregation algorithm to be legitimate. It needs
a defensible total **plus** separate placement facts — which is exactly the split §9.2 was circling
without being able to justify.

### 11.5 Removability is a recognised separate axis

Standard outdoor layering practice treats base / mid / outer as functional roles, with layers added
and removed as conditions and exertion change, and notes that weather-only advice misses exertion and
individual metabolism. §2.1's insistence that thermal amount and removability not be collapsed is
consistent with that.

### 11.6 Personal sensitivity is a legitimate input — later, and small

There is published work recommending from a user's *own* wardrobe using weather plus individual
thermal sensitivity. Not to be copied, but it supports a small future personalisation:

```text
runs warm  ·  neutral  ·  runs cold        (or learned from feedback)
```

**Not** a stored temperature range per garment — which
[outerwear-weather-consolidation-spec.md](outerwear-weather-consolidation-spec.md) §20 already rules
out, and which §7 above independently concluded was unnecessary.

### 11.7 Borrow the structure, refuse the apparatus

Explicitly **not** to be modelled: radiant temperature, evaporative resistance, metabolic watts/m²,
thermal-manikin corrections, wind-penetration coefficients, physiological strain, IREQ exposure-
duration calculations. Those matter for workplace safety and are excessive for choosing between a
cardigan and a puffer for a museum trip.

### 11.8 `clo` is a calibration reference, not Closet's unit

Reference insulation values are genuinely useful as **anchors** — a thin long-sleeve sweater sitting
around 0.25 clo tells us something real. But Closet must not claim:

> *"This outfit is 0.83 clo and your requirement is 0.71 clo."*

That precision would be **fictitious** given the available garment metadata, and inventing a
scientific-looking unit on top of `fabric_weight` and `fiber_content` would be worse than the
arbitrary weights it replaces — it would look calibrated while being no better founded.

Instead, published insulation data should calibrate a **small ordered warmth scale**. Illustrative,
not a proposed taxonomy:

```text
very light · light · moderate · warm · very warm
```

The difference from today's `cold` score is not granularity — it is that the levels would be
**anchored to known garment/ensemble insulation references** rather than to arbitrary `+8/+6`
weights. This is the answer to §10.1's open question, "what is the demand side measured in": neither
`cold` points nor clo, but a small ordinal scale that clo data is used to place garments into.

Comparison stays continuous enough for ranking, with no cliff:

```text
demand ≈ moderate
   light outfit      → undershoot
   moderate outfit   → preferred
   warm outfit       → acceptable / slight overshoot
   very warm outfit  → significant overshoot
```

## 12. The revised Slice 1 task

Research stops here. Slice 1 is now bounded to one investigation, still **no production code**:

> Build a reference calibration table from established clothing-insulation data against Closet's
> **actual** garment taxonomy. Do not implement IREQ, PMV, ASHRAE comfort calculations, or a new
> scientific unit. Use the external data only to determine whether Closet's existing garment facts
> can reliably place garments into a small ordered warmth representation. Separately identify the
> **minimum** layer-placement information needed to distinguish base warmth from removable warmth.
> Test that representation against the pinned cases below **before** choosing the demand mapping.

### 12.1 The acceptance test is ordering, not accuracy

Scientific accuracy is not the bar. Getting these orderings right is:

| Conditions / use | Expected ordering |
|---|---|
| 65/45 museum day | cardigan / transition layer **>** puffer |
| cool morning, mild afternoon | mild base + removable layer **>** permanently heavy base |
| genuinely cold outdoor period | puffer **>** cardigan |
| active cold walk | *less* insulation than sedentary exposure at the same temperature |
| only a puffer available | puffer remains usable |
| unknown garment evidence | **unknown**, never "neutral warmth" |

Rows one and three are the puffer incident and its inverse — the representation must reverse the
ordering between them on the strength of conditions alone. Row four is the activity input §11.1
supplies and §9.1 requires. Row five is the supply constraint. Row six is §10.3's latent collision,
which a new representation must not inherit.

**Only after those orderings hold** does the demand mapping get chosen. That is the point at which
this stops being "what Fahrenheit threshold fixes this card" and becomes a temperature model.


---

## 13. Revised Slice 1 findings — measured 2026-09-03

`node scratch/measure_warmth_placement.mjs` (deterministic, DB copy, no model calls). Run against
the real wardrobe after PR #304 and #305 landed. **No production code was written.**

§12 asked one question: can Closet's existing garment facts reliably place garments into a small
ordered warmth representation? **The facts can. The candidate formula cannot.** Those are different
answers and the distinction is the whole finding.

### 13.1 Coverage — the facts are sufficient

```text
active pieces 271 · clothing in thermal scope 213
placed 204/213 = 95.8%      all five levels used, largest holds 39.7%
unplaced 9                  all thermally_ambiguous
```

Placement is not blocked by missing data. §12's first question is answered yes.

### 13.2 Consistency — the candidate formula is not usable

`proposedWarmthLevel` (`warmthCalibration.js`) is `fabric_weight` + an insulating-material bonus.
Compared pairwise against `pieceWeatherScores().cold` — both built from the same stored facts:

```text
comparable pairs 13,740     agree 12,779 (93.0%)     INVERTED 961 (7.0%)
```

The inversions are systematic, not noise. **The levels are not monotonic against the evidence:**

```text
very light  n=74  cold -16 ..  1   median  -8
light       n=81  cold  -8 .. 10   median   0
moderate    n=11  cold  14 .. 19   median  14     <-- ABOVE "warm"
warm        n=30  cold  -2 .. 15   median  12
very warm   n= 8  cold   6 .. 23   median  22
```

`moderate` sits above `warm`. A scale whose own level order contradicts the evidence it is built
from cannot carry a demand comparison.

**The cause is a missing input, not a bad coefficient.** `proposedWarmthLevel` never reads coverage.
Five sleeveless garments are placed `warm` while scoring `cold <= 2`:

```text
Cream wool shell               sleeveless   cold  -2   → "warm"
black crochet lace tank top    sleeveless   cold  -2   → "warm"
Brown shell                    sleeveless   cold  -2   → "warm"
textured taupe scoop neck top  sleeveless   cold  -2   → "warm"
colorblock ribbed knit sheath  sleeveless   cold   2   → "warm"
```

A wool tank satisfying a `warm` demand is the failure this arc exists to prevent, arriving from the
supply side instead of the demand side. §10.1 already pointed at the fix: **treat
`pieceWeatherEvidence`'s structured terms as the reusable input.** They read mass, material,
coverage, neckline, sleeves and exposure; the ordinal placement must consume them rather than
re-deriving warmth from two fields.

### 13.3 Pinned case 6 fails today, at scale

> *unknown garment evidence → **unknown**, never "neutral warmth"*

```text
material verdicts   insulating 38 · non_insulating 4 · unknown 171
garments with UNKNOWN material evidence that still receive a warmth level: 162
```

**CORRECTION, same day, before building to this.** The first version of this section called all 162
a violation — "79% of placements come from `fabric_weight` alone". That conflates *unknown material
verdict* with *unknown evidence*, and it is too strong. Split by substance:

```text
light        74     unknown material cannot move a light piece far — placement is well founded,
                    and warmthCalibration.js's own comment already says exactly this
medium       78  ┐  unknown material CAN move these several levels
heavy        10  ┘  → 88 of 204 placements (43%) are genuinely at risk, not 79%
```

The finding survives at 43% and is sharper for being narrower. Within the at-risk band the failures
are real and legible — `mustard knit sweater`, medium, no material evidence, placed **`light`**. A
knit sweater is not light, and nothing in the record says otherwise.

Note what that example actually shows: a **data gap**, not a formula gap. The formula placed it
correctly given what it was told. Slice 2 must therefore make the at-risk band return `unknown`
rather than inventing a level for it — §5.6's "unknown is never inadequacy" enforced on the supply
side — and must not pretend the fix recovers the missing fibre data.

The existing `thermally_ambiguous` state was reaching for this predicate and fires on only 9 pieces,
because it keys on a `fabric_category` allowlist rather than on the evidence itself.

### 13.4 Layer placement needs no new field

§12's second question — the **minimum** information to distinguish base warmth from removable
warmth:

```text
category = outerwear    34 pieces     THE available signal
needs_base              6 of 213      populated too sparsely to use
outerwear_role          deprecated    ratified: replace, do not rescue
garment kind            no column     does not exist
```

`wardrobeCategoryGroup(p) === 'outerwear'` is one bit and it is sufficient: a cardigan is outerwear
and removable, a heavy sweater is a top and is base warmth. **Recommendation: add nothing.** The
minimum is already stored, and pinned case 2 (mild base + removable layer beats a permanently heavy
base) is expressible with it.

### 13.5 Reference anchors — ordinal, never a unit

§11.8 stands: published insulation data places garments into levels; Closet never claims `clo`.
Approximate single-garment reference values from the standard tables §11 already cites:

**SUPERSEDED 2026-09-03 by the verified table in §15.** The approximate values first recorded here
were close at the low and middle of the range and **wrong at the top**: they gave an insulated coat
`~0.50-0.70` where the verified table's heaviest entry is `0.48`. Read §15, not this paragraph.

Their use was and remains ordinal: a sleeveless top and a thick long-sleeved garment differ by
roughly 4-5x, which is the separation the placement must reproduce and which the old formula
collapsed.

### 13.6 Conclusion, and what Slice 2 is

The orderings in §12.1 do **not** hold today: rows 1/3 are supportable (puffer `very warm` cold 23
vs cardigan `warm` cold 12 are distinguishable and correctly ordered), row 2 is expressible via
§13.4, row 4 is now suppliable by `exposure.js`'s `exertion`, but **row 6 fails outright** and the
scale carrying rows 1/3 is internally inconsistent (§13.2).

Per §12, **the demand mapping is not chosen yet.** Slice 2 is:

1. Rebuild ordinal placement on `pieceWeatherEvidence`'s structured terms, so coverage is read.
2. Return `unknown` when material evidence is unknown and substance alone cannot carry the level —
   pinned case 6 becomes a test, not an aspiration.
3. Verify the §13.5 anchors against the primary ASHRAE 55 / ISO 9920 material before any boundary is
   treated as authoritative. Ordinary calibration work, not a checkpoint.
4. Only then choose the demand mapping.

#### Slice 2's acceptance gate

Corrected by owner ruling 2026-09-03, and the correction matters more than the rest of this section.

An earlier draft of this gate read *"inversions must approach zero and the level medians must be
monotonic"* — measured against `pieceWeatherScores().cold`. **That is wrong, and would have quietly
undone §10.1.** That section concluded `cold` is good evidence and **not** a calibrated warmth unit:
no temperature anchor, no meaningful zero, weights tuned historically for ranking. A Slice 2 that
optimises the new representation until it agrees with `cold` promotes the old score to the oracle —
canonizing the very scale this spec disqualified.

The gate is therefore:

```text
1. Unknown material evidence stays unknown WHERE IT CAN MOVE THE LEVEL.
2. Coverage is explicitly represented.
3. Pinned real-garment orderings hold (§12.1).
4. Published reference anchors verify BOTH:
     a. level ordering and boundaries
     b. the evidence-sufficiency boundary — when fabric_weight alone is enough
        to place, and when unknown material must force unknown
5. pieceWeatherScores().cold is a DIAGNOSTIC disagreement signal, never the target to fit.
```

**Criterion 1 is deliberately narrower than "unknown stays unknown", and this is the canonical
wording.** The implementation returns `null` for medium/heavy garments with unknown material and
still places light ones. That exception may well be right — a light garment's unstated material
cannot lift it far — **but it is a calibration claim, not something Slice 1 proved**, so criterion 4b
now has to support it before it is ratified. A reader who sees a light unknown garment receive a
level is looking at an unratified exception, not a broken invariant.

Keep measuring the disagreement — a large one is worth investigating — but zero inversions against
`cold` is neither necessary nor desirable. If the new representation places a sleeveless wool shell
at `light`/`moderate` while `cold` says `-2`, that may be evidence **the old score is wrong in a
different way**, not evidence the new scale should move toward `-2`. Monotonic medians against `cold`
remain a useful sanity check and are not a definition of success.

`proposedWarmthLevel` has no production consumer, so all of this is behaviour-neutral until the
migration in §8.


---

## 14. Slice 2 — ordinal placement rebuilt (2026-09-03)

`styling-engine/garmentWarmth.js`, `test/garmentWarmth.test.js` (8 tests), verifier
`node scratch/compare_warmth_placement.mjs`. **No production consumers** — §8 step 1: pure functions
first, behaviour unchanged. `proposedWarmthLevel` is superseded but untouched, and neither has a
caller.

### 14.1 The gate, against §13.6's five criteria

```text
1. unknown stays unknown        PASS   at-risk garments still placed: 0  (old formula: 88)
   where it can move the level
2. coverage represented         PASS   sleeveless wool shell: warm -> light
3. pinned orderings hold        PASS   puffer > cardigan > unlined jacket, on real rows
4a. anchors verify boundaries   PASS through `warm`; `very warm` accepted as an explicitly
                                       unanchored ordinal extension (§15.5)
4b. evidence sufficiency        PASS   coverage outweighs substance ~4x (§15.4)
5. cold as diagnostic only      OBSERVED, not optimised: 2.7% disagreement (was 7.0%)
```

**Final acceptance snapshot, after anchor verification** (`compare_warmth_placement.mjs`):

```text
very light 34 · light 47 · moderate 5 · warm 25 · very warm 5
placed 116/213 = 54.5%    material_unestablished 97
```

Anchor verification did not move any boundary, so this snapshot stands as Slice 2's acceptance
result. **Slice 2 is ratified** — see §15.5 for how the top of the scale is treated.

Criterion 5 is reported, never targeted. The improvement from 7.0% to 2.7% is a **side effect** of
reading coverage, which `cold` also reads — not evidence of fitting, and not a success metric. A
future change that raises disagreement while satisfying 1-4 is acceptable.

### 14.2 Placement coverage falls, on purpose

```text
placed 116/213 = 54.5%      (old: 204/213 = 95.8%)
material_unestablished 97
```

**That drop is criterion 1 being enforced, not a regression.** The 97 are medium or heavy garments
with no material evidence — the band where "there might be something warm in here" can move a
garment several levels. The old formula gave them a level anyway. Honest coverage of 54.5% is worth
more to a demand comparison than confident coverage of 95.8%, and §5.6 requires it.

It also names the real remedy: **97 garments are missing fibre data**, and no formula recovers that.
This is a tagging backlog the placement now makes visible instead of papering over.

### 14.3 Two calibration corrections made during the slice

**Clamped index → boundaries.** The first version used the raw sum as an array index and saturated:
a wool sweater, a knit cardigan and a down puffer all came out `very warm`, destroying the very
separation rows 1 and 3 depend on. Inputs span roughly −3..5.5, so five levels need real boundaries.

**Secondary coverage is half-steps.** Sleeves, hem and neckline first got a full step each, and a
medium fleece with a warm collar then tied a heavy down puffer. Three secondary terms outweighing a
fabric-weight class contradicts the §13.5 spread. A collar is not worth the difference between
medium and heavy cloth.

### 14.4 Still open

* **Anchor verification** against primary ASHRAE 55 / ISO 9920 material. The §13.5 table is
  reproduced from standard tables, not consulted at source; **the boundaries in `levelForRawScore`
  are provisional until it lands** and must not be treated as authoritative.
* **Demand mapping is still not chosen.** §12's gate now has 4 of 5 criteria met, with criterion 4
  outstanding. That is the remaining precondition.
* **Ensemble contribution** (§9.2) is untouched — this places one garment, not an outfit.


---

## 15. Criterion 4 — anchor verification (2026-09-03)

### 15.1 Source, and what "verified" honestly means here

ASHRAE 55 and ISO 9920 are **paywalled standards and were not obtained.** Two attempts at ASHRAE's
own published addendum PDFs returned unusable renderings.

What was obtained instead: the garment table encoded in the **CBE Thermal Comfort Tool**
(`ElsevierSoftwareX/SOFTX_2020_242`, `static/js/global.js`), an ASHRAE-55-compliant reference
implementation from UC Berkeley published alongside a peer-reviewed SoftwareX paper. **56 garment
entries**, extracted programmatically rather than transcribed.

That is a *compliant implementation*, not the standard itself. It is checkable, citable and vastly
better than an unattributed web table — but the distinction should not be lost: **if a boundary ever
turns on an exact value, buy the standard.** That is a cost decision, not an engineering one.

### 15.2 The verified table (extract)

```text
0.08  T-shirt                      0.25  Long sleeve shirt (thin)
0.10  Sleeveless vest (thin)       0.28  Sweatpants
0.12  Sleeveless scoop-neck blouse 0.34  Long-sleeve sweat shirt
0.14  Thin skirt                   0.36  Long sleeve shirt (thick)
0.15  Thin trousers                0.36  Single-breasted coat (thin)
0.17  Sleeveless vest (thick)      0.42  Double-breasted coat (thin)
0.23  Thick skirt                  0.44  Single-breasted coat (thick)
0.24  Thick trousers               0.48  Double-breasted coat (thick)
```

### 15.3 Criterion 4a — level ordering: PARTIALLY VERIFIED

The low and middle of the scale are confirmed. The ordering
`t-shirt < thin trousers < long-sleeve shirt < thin coat < thick coat` holds, and the 4-5x spread
§13.5 claimed is real (`0.08` → `0.36`).

**The top of Closet's scale is NOT covered.** The heaviest entry is a `0.48` double-breasted coat.
There is no down parka, no shearling, no filled outerwear — ASHRAE 55 is an **indoor comfort**
standard, exactly as §11.1 said of IREQ at the other end. So `very warm` (the puffers, the
shearling jacket) sits **above everything this source can anchor**, and its boundary remains
unverified. Recorded as a known limit, not papered over.

### 15.4 Criterion 4b — evidence sufficiency: VERIFIED, with a dependency

The question: is "light substance alone is enough to place, despite unknown material" defensible?

```text
SUBSTANCE axis — same garment, thin -> thick:      mean +0.089   (range +0.04 .. +0.14)
COVERAGE axis — thin garments across types:        0.08 .. 0.36 = 4.5x
```

**Coverage dominates substance by roughly 4x.** So a light garment's unstated material can move it
about one narrow band, while its cut moves it across most of the scale. The exception is defensible
— **but only because Slice 2 now reads coverage.** Under the old formula, which placed on substance
alone, light-unknown placement was *not* defensible, and that is worth stating plainly: criterion 4b
passes as a consequence of the §14 fix, not independently of it.

The physical argument does the rest: a `light` fabric_weight rules out substantial concealed
insulation by construction. You cannot have a light garment with a down fill.

**Ratified:** criterion 1's narrower wording stands, and the light-unknown exception is no longer
provisional. The `PROVISIONAL` markers in `garmentWarmth.js` and `test/garmentWarmth.test.js` can be
lifted for 4b — **but not for the `very warm` boundary**, which §15.3 leaves unanchored.


### 15.5 `very warm` — an explicitly unanchored ordinal extension

Owner ruling 2026-09-03, clearing Slice 2. The top bucket is accepted as unanchored rather than
blocked on obtaining a cold-weather standard.

```text
very warm
  = ordinal extension ABOVE the verified reference range
  = reserved for garments with strong positive insulation evidence
    AND sufficient substance/coverage
  = NOT assigned a clo value
  = boundary NOT claimed to be ASHRAE-calibrated
```

Closet never needs to claim *"this puffer corresponds to X clo."* It needs only the much weaker and
fully supported statement: **this garment is materially warmer than the highest class our indoor
anchors cover.** Heavy construction plus positive insulating-layer evidence is a qualitatively
different state from the cardigans, fleeces and ordinary coats below it, and that is enough for an
ordinal overflow bucket.

Both alternatives are worse. Collapsing `very warm` into `warm` destroys exactly the puffer/cardigan
separation pinned rows 1 and 3 depend on. Inventing a numeric anchor manufactures scientific
precision the source does not support — §11.8's own prohibition, arriving at the top of the scale.

**Corresponding constraint on the demand side.** The demand mapping must treat `very warm` as a
**bounded ordinal ceiling**. It may say:

```text
demand = moderate · puffer = very warm   ->  substantial overshoot
demand = very warm · puffer = candidate, cardigan = undershoot
```

It may **not** invent `very warm+`, an "extreme" tier, or numeric distances above the verified
range. No granularity above the anchors until there is product evidence that it is needed.


---

## 16. Slice 3 — the demand mapping (2026-09-03)

`styling-engine/thermalDemand.js`, `test/thermalDemand.test.js` (10 tests). **No production
consumers** — still §8 step 1. Authorized once §15.5 cleared the `very warm` question.

### 16.1 The pinned cases now hold end to end

Run through `exposure.js` → `requiredThermalBand` → `compareThermalFit`:

```text
row 1  65/45 museum, walking     puffer OVERSHOOT (dist 2) · cardigan adequate (dist 1)
row 3  30/20 outdoors, sedentary puffer adequate (dist 0)  · cardigan adequate (dist -1)
row 4  40/28  none -> very warm · walking -> warm · hiking -> moderate
row 5  overshoot ranks, never excludes
row 6  unknown garment -> { fit: 'unknown' }, never neutral
```

**Rows 1 and 3 reverse on conditions alone**, which §12.1 called the decisive pair. The Vienna
defect is resolved at the model level: on a 65/45 museum day the puffer is out-ranked, not excluded.

### 16.2 Two design points worth keeping

**Membership cannot express preference.** A first version returned only `fit`, and on a genuinely
cold day the uncertainty band spans `moderate..very warm`, so a cardigan and a puffer were both
`adequate` and row 3's ordering vanished. `compareThermalFit` now also reports `distance` from the
band's **target**, not its edges: ranking reads `distance`, gating reads `fit`.

**The indoor base is not the outdoor demand.** A first version gave a heated restaurant's base the
outdoor demand — the Vienna error inverted, over-dressing the base instead of the outing. An indoor
destination is an indoor-comfort problem, which is exactly the band the anchors DO cover; the
transit window keeps its own demand and is returned separately so it cannot be blended away.

### 16.3 The thresholds are a stated calibration

`SEDENTARY_DEMAND_F` is not derived from a comfort equation. §11.7 refuses that apparatus, so there
is none to derive from, and inventing one is the fake precision §11.8 prohibits. The boundaries were
chosen so the pinned cases hold, and are written as a plain table so they can be argued with.
Exertion shifts are ordinal steps, never a metabolic rate.

### 16.4 What is still not built

* **Ensemble contribution (§9.2).** This compares ONE garment against a demand. Pinned row 2 —
  a mild base plus a removable layer beating a permanently heavy base — needs outfit-level
  aggregation and is the one pinned case still unmet.
* **The migration (§8 steps 2-6).** Nothing consumes any of this. `thermal_demand` is still 20.
* **`isWeatherFiltered`** (§8.1) still holds binary authority.


---

## 17. Slice 4 — outfit thermal contribution (2026-09-03)

`styling-engine/outfitThermalContribution.js`, `test/outfitThermalContribution.test.js` (6 tests,
one per gate criterion). **No production consumers.** §9.2's "nothing owns it" is now answered, and
the research/design core of this spec is complete.

### 17.1 The gate

```text
1. row 2 passes                       PASS  mild base + cardigan adaptable; heavy base + puffer not
2. base vs removable distinguishable  PASS  returned as separate fields, never blended
3. ordinal levels not summed          PASS  bounded one-step combination; result is a LEVEL
4. unknown preserved, not zeroed      PASS  unplaceable base -> null + unknown.base, never a level
5. puffer usable as the only layer    PASS  overshoot ranks, never excludes
6. no non-thermal semantics absorbed  PASS  source-level ratchet on rain/footwear/capability
```

### 17.2 Row 2 is not a total — it is range coverage

The reframing that made it tractable. *"A mild base plus a removable layer beats a permanently warm
base"* is not a claim that one outfit is warmer. It is that the layered outfit answers **both ends**
of a variable exposure — the cold end with the layer on, the warm end with it off — while a
permanently heavy outfit answers only the cold end and is stranded overshooting the warm one.

Comparing totals cannot express that. Comparing range coverage can, **and needs no arithmetic at
all.** `outfitCoversRange` reports both ends separately and never returns a verdict.

### 17.3 What the anchors licensed, and what they did not

The ensemble entries measure layering directly:

```text
Trousers, long-sleeve shirt            0.61
Jacket, Trousers, long-sleeve shirt    0.96      adding a jacket: +0.35
Single-breasted coat (thin), alone     0.36      ~= its own garment value
```

Layering is approximately additive **in clo** — §11.4 already recorded ASHRAE permitting that as a
practical estimate. It is **not** additive in ordinal level, because the levels span different clo
widths. What this licenses is a bounded ordinal step: a real second layer moves the outfit one level
above the warmer component. Never a sum, never unbounded.

**The step turns on the WEAKER component**, and the clo evidence is why: trousers+long-sleeve (0.61)
plus a jacket reaches 0.96 because both are substantial, while a thin tee (0.08) under the same
jacket reaches 0.44 — barely above the jacket alone. A first version keyed on the removable layer
alone and pushed a light top under a knit cardigan to `very warm`: puffer territory, from a cardigan.

### 17.4 The design core is complete

```text
exposure.js                    conditions encountered + exertion + mode      SHIPPED (#305)
garmentWarmth.js               per-garment ordinal placement                 §14
thermalDemand.js               requiredThermalBand + compareThermalFit       §16
outfitThermalContribution.js   base / removable / withLayer / unknown        §17
```

All five §12.1 pinned rows now hold. **Nothing consumes any of it** — `thermal_demand` is still 20,
and `isWeatherFiltered` still holds binary authority (§8.1). What remains is the §8 migration, which
is where user-visible behaviour changes for the first time.

---

## 18. Prerequisite slice — the weather contract, before any migration

**PR A.** Contract cleanup only: no ranking change, no adequacy change, no behaviour broadening
beyond removing stale thermal authority. The ranking and adequacy migrations stack on top of this as
PR B, so that if ranking regresses later nobody has to disentangle whether the cause was the
weather-contract repair or the migration itself.

### 18.1 Explicit stated weather was losing its numbers

`stylingContext.js`'s `statedWeatherProfile` took the user's **stated** weather and ran it through
the *prose heuristic*, which parses Fahrenheit values and then discards them:

```text
"it will be 47°F"  ->  weatherProfileFromContext  ->  { isCold: true }      the number, gone
```

So a boolean was all that survived, on exactly the turns where the user was most explicit. That is
the same authority loss [stated-weather-authority-findings.md](stated-weather-authority-findings.md)
documents from the other direction. `validateUserWeather` already existed to parse this properly.

Now:

```text
stated "65/47"  ->  validateUserWeather -> resolveWeatherContext -> highF 65 / lowF 47 + provenance
stated "47F"    ->  high = low = 47      the temperature the user gave, NOT a synthesized envelope
stated prose    ->  no numbers -> heuristic profile -> no structured temperature at all
```

**Three constraints, all held.** Precedence is unchanged — this branch already sat above the
structured named-destination branch in `resolveWeatherProfile` and still does; nothing consults a
forecast or "improves" a stated value with live data. No high/low is synthesized from vague prose:
absent numbers means absent, which is the correct answer rather than a guessed envelope. And the
heuristic keeps the non-thermal reads it genuinely owns — rain, wet exposure — which are parsed from
the same prose and are not thermal (§2.1).

### 18.2 A stale `isCold` mutation, provably inert

```js
if (indoorSlot) slotWeatherProfile.isCold = false     // outfitSetPlanner.js, twice
```

Hand-setting the flag was how an indoor slot avoided cold handling. Removed: `slotWeatherProfile`
flows only into `evaluatePlannerAutomaticUsePool`, which reads `isHot` and never `isCold`. The
mutation had no consumer left — stale authority outliving its reader, removed as a demonstrable
no-op.

### 18.3 The census moved, and the half that did not is the point

```text
thermal_demand  20 -> 18          non_thermal  4 -> 4
```

(The earlier figure of 17 was measured with the ranking migration also applied; **18 is this slice's
own contribution** — the two removed indoor mutations. The ranking migration accounts for the
remaining one and belongs to PR B.)

`non_thermal` holding steady is the signal worth watching: the census measures **semantic authority
transfer**, not line deletion. If footwear or wet-weather contracts had begun dissolving into the
band, that number would have moved and nothing else would have said so.

Re-run with `node scratch/census_thermal_demand_consumers.mjs`.

### 18.4 What remains, and where it belongs

The remaining 17 are flag **readers**, not producers, and belong to the migration proper:

* **`outfitEnvironmentalAdequacy.js` (7)** — undershoot, removable-layer and severity findings.
* **`rules.js` (10)** — trust decision, composer roster, mission priority, whole-wardrobe scoring.

A scope note worth keeping: producers and readers are different sets, and conflating them mis-sizes
the work. Read against the success condition — *none derive thermal authority from flags* — several
producer sites need no change at all, because a profile without temperatures simply yields no band
opinion. **Unknown is a valid migration outcome, not a gap to close.**


---

## 19. PR B — ranking / model-evidence migration (§8 step 2)

The first user-visible behaviour change in this arc. `styling-engine/rules.js`,
`test/thermalRankingMigration.test.js`.

### 19.1 The composition invariant, pinned before anything else

> **Thermal demand informs wardrobe ranking and model evidence before outfit generation. It must not
> deterministically choose the outfit or collapse stylistic diversity; the model remains responsible
> for composition.**

Everything below is a *score adjustment*. Nothing here excludes a garment, and overshoot is a
ranking penalty by construction (§5.5).

### 19.2 What was migrated

**`weatherFitForPiece`** — the cold branch was `else if (weatherProfile?.isCold && cold !== 0)`, so
`isCold` decided whether graded warmth reasoning existed **at all**. At 65/47 it is false, the ranker
said nothing, and a down puffer ranked like a light jacket. Now reads `requiredThermalBand`, and
ranking keys on **`distance`** rather than `fit` — using `fit` alone scored every garment inside the
uncertainty band identically, turning the band into an equivalence class (§16.2 repeating one layer
down).

**`piecePriorityForMission`** — gated on `isHot || isCold`, so between the extremes piece priority
carried no thermal signal. The call is now unconditional; it returns 0 when there is nothing to say.

**`scoreWholeWardrobeCandidate`** — the outfit-level branch was `else if (weather.isCold)`, the same
blind spot at ensemble level. Now band-driven, with the ensemble warm-layer floor conditioned on
demand rather than on the flag.

**A latent defect the migration itself introduced**, found and fixed here: that function filtered on
the literal reason string `'cold weather: lightweight fabric'` to restrict the light-piece penalty to
bottoms and dresses. The band renamed the reason, so **the filter had silently stopped matching** and
the penalty was applying to every category. Re-expressed against the band's undershoot signal.

### 19.3 Acceptance

```text
Vienna 65/47          cardigan ranks ahead of the puffer
                      with the slot's exposure: light jacket > cardigan > puffer
genuinely cold 30/20  puffer > cardigan > light jacket        the ordering reverses
overshoot             the puffer scores low and stays available, never excluded
unknown               no thermal opinion — not a good one, not a bad one
no isCold switch      asserted at source: weatherFitForPiece may not read the flag
non_thermal census    4, unchanged
```

```text
census  thermal_demand 18 -> 15    non_thermal 4 -> 4
suite   1832 tests, 1830 pass, same 2 pre-existing failures
```

### 19.4 Scope — why the other rules.js sites are NOT in this PR

Eight thermal readers remain in `rules.js`, and none is ranking:

* **The roster's step-3 gate** (`afterStep3.push`, ~3032-3092) **excludes** pieces from the candidate
  pool. That is validity, and the migration order puts ranking before validity deliberately — a rank
  change cannot make an outfit invalid, which is what makes this step the low-risk one.
* **`wholeWardrobePieceTrustDecision`**'s `weather: { cold }` feeds `ownerConstraintApplies` — an
  owner-rule projection, §8 step 4.
* **`missingWeatherGateField`** uses cold as a proxy for "this field now matters". §6 already
  classifies it as *"unclear, needs its own analysis"*; it is not folded in here.

The remaining 7 are `outfitEnvironmentalAdequacy.js`, which is §8 step 3 and deliberately untouched.


---

## 20. §8 step 3 — outfit adequacy reads the band for thermal AMOUNT

`outfitEnvironmentalAdequacy.js`, `test/thermalAdequacyMigration.test.js`. Scoped to the amount
question only; removability, transit coverage and outdoor capability keep their own triggers (§2.1).

### 20.1 What it adds

Two findings the engine could never state before, both from `compareThermalFit`:

```text
THERMAL_OVERSHOOT    advisory   "more warmth than the conditions call for"
THERMAL_UNDERSHOOT   advisory   "less warmth than the conditions call for"
```

The existing `NO_WARM_LAYER_FOR_COLD` is a **presence** question keyed on `isCold` — "is there a warm
layer at all". It keeps its authority and stays an error. What the band adds is the **amount**, which
between the two temperature extremes nothing could express: that is how a puffer and a light jacket
were equally acceptable on a mild museum day, the failure
[layer-weight-ceiling.md](layer-weight-ceiling.md) recorded across five runs and two providers.

### 20.2 Both findings are ADVISORY, and undershoot learned that the hard way

Undershoot shipped as an error for exactly one test run. A synthetic *"sleeved wool coat"* tagged
`fabric_weight: light` with no fibre content placed as `light`, undershot a 65/45 day, and
**hard-blocked plan submission** — acceptance criterion 8 violated, and a barely-tagged wardrobe is
precisely the shape that produces it. Both are advisory now. The presence gate keeps the hard
authority; the band informs.

That also keeps §19.1's composition invariant intact one layer down: adequacy reports, it does not
compose.

### 20.3 The unknown asymmetry

```text
UNDERSHOOT  blocked by unknown evidence   an unplaceable base could be secretly warm, so
                                          "too light" is what the missing data could falsify
OVERSHOOT   not blocked                   an unknown base cannot make a `very warm` coat LESS
                                          excessive; the signal is carried by the PLACED layer
```

Requiring complete evidence for overshoot would have silenced it on nearly every real outfit — a
plain medium cotton top is itself unplaceable under §13.3's at-risk band, and most outfits contain
one. This is the same asymmetry `thermalMaterialVerdict` uses: positive evidence is decisive from an
incomplete record; negative evidence is not.

### 20.4 Honest limits

**The Vienna case does not fire here.** Adequacy builds its exposure from `environment` alone — it
has no activity, so exertion is `unknown`, the demand widens to `warm` and a puffer sits inside the
band. The ranking layer *does* receive slot exposure and does out-rank it (§19.3). Threading slot
exposure into adequacy is a separate question, not smuggled into this slice.

**The census did not move.** `thermal_demand` stays 15: this slice ADDS band-driven findings without
removing the four neighbouring contracts' flag triggers. Reaching 0 requires those triggers to come
from the band even though the contracts stay separate — steps 4-6, not this one.

```text
census  thermal_demand 15 (unchanged)   non_thermal 4    suite 1839 tests, 1837 pass, 2 pre-existing
```


---

## 21. §8 step 4 — measured first, and it needs a ruling

Step 4's premise is that the remaining contracts (removability, transit coverage, outdoor
capability, owner-rule projection) keep their own questions while their **triggers** move from flags
to the band. Measured against real thresholds before writing any of it:

```text
high/low   legacy(cool, cold, severe)            band demand
75/60      cool=false cold=false severe=false    moderate
70/55      cool=true  cold=false severe=false    moderate
65/50      cool=true  cold=false severe=false    warm        <- band fires COLD where legacy did not
65/45      cool=true  cold=true  severe=false    warm
58/44      cool=true  cold=true  severe=false    warm
50/40      cool=true  cold=true  severe=false    very warm   <- band fires SEVERE where legacy did not
42/38      cool=true  cold=true  severe=true     very warm
30/20      cool=true  cold=true  severe=true     very warm
```

**The obvious mapping broadens every tier.** `moderate → cool`, `warm → cold`,
`very warm → severe` would require a removable layer at **75/60** and an outdoor-capable layer at
**50/40** — strictly more demanding than today, in the direction this arc exists to move away from.
Shipping it would trade "the warmest coat is always safest" for "every day needs more than it did",
which is the same failure wearing different clothes.

**Why the scales do not line up.** The legacy tiers are thresholds on the 24-hour trough. The band's
levels are demands on the *waking exposure window*, which sits ~35% of the diurnal range above that
trough (§10.4), and they additionally shift with exertion. Two different quantities; a 1:1 mapping
between them was never going to hold.

**This is a product-semantic decision, not a mechanical migration** — §10.1's escalation bar. Three
shapes, none chosen here:

* **(a) Calibrate the mapping** so each contract fires where it fires today, then let it drift only
  deliberately. Preserves behaviour; the boundaries become a stated calibration like
  `SEDENTARY_DEMAND_F` (§16.3).
* **(b) Accept the broadening for some contracts and not others.** A removable layer at 70/55 is
  defensible; an outdoor-capable coat at 50/40 is not.
* **(c) Leave these contracts on their thresholds.** They are not thermal-amount questions —
  "is there something to put on" is a *presence* question, and §20.1 already established presence
  and amount as different. That would mean `thermal_demand` never reaches 0, and the census's
  completion test needs restating instead.

**(c) deserves real weight.** The census counts these as `thermal_demand` because they read a cold
flag, but three of the four are presence/capability contracts, and step 3 already found that
presence and amount are genuinely different questions. If that is right, the honest end state is a
smaller `thermal_demand` target plus a reclassification — not zero.

### 21.1 Ruling — keep the contracts independent, and change the completion criterion

Owner ruling 2026-09-03, closest to (c) with one qualification.

**Keep the parallel contracts independent of the thermal band.** Mapping the band's ordinal levels
onto them merely because both once read `isCold` would recreate the master-boolean problem in a new
form. **But do not preserve their 24-hour-trough thresholds forever either** — they may eventually
earn their own trigger calibration from relevant exposure conditions. That calibration is its own
semantic problem and must not be obtained by translating `moderate/warm/very warm` into booleans.

```text
ExposureContext
   ├── thermal demand              -> amount / fit / overshoot / undershoot
   ├── removable-layer trigger     -> presence / adaptability
   ├── transit coverage trigger    -> removable sleeve-bearing coverage
   └── outdoor-capability trigger  -> appropriate outerwear capability
```

**`thermal_demand == 0` is retired as the completion criterion.** It assumed every member of that
class carried obsolete thermal-demand authority; the census classified by **which flag a site reads**
rather than **what question it answers**, and steps 3-4 showed that assumption was too broad.

```text
DONE = no consumer derives thermal AMOUNT from legacy cold flags,
       AND no independent contract derives its semantics from the band.
```

### 21.2 The reclassified census

`scratch/census_thermal_demand_consumers.mjs`, revised to classify by question answered:

```text
projection         16    display, prompt, owner-rule and metadata surfaces — migrated separately
producer           15    builds/propagates the profile — legacy authority eventually derived
parallel_contract  13    presence / adaptability / coverage / capability — legacy trigger allowed
                         for now, must have NAMED independent ownership, must never take band
                         semantics
non_thermal         4    footwear / rain — independent, and must NOT fall to zero
thermal_amount      2    <- the real remaining target
```

**Reclassifying surfaced two sites PR B missed.** `rules.js:3251` and `3268` are heavy-fabric cold
bonuses and light-fabric penalties inside `buildVisualComposerRoster` — the amount question applied
to scoring clothes, and squarely in PR B's stated scope. They were skipped because the *enclosing
function* is a roster builder, so an owner-level classification hid them. That is the same lesson as
the reason-string bug: classify by what the code decides, not by where it sits.

Two census-tool corrections were needed to reach this, both recorded in the script. The context rules
guarded on the retired `thermal_demand` class, so every footwear site stayed `parallel_contract` and
**`non_thermal` fell to zero** — the exact alarm that class exists to raise, fired by the tool rather
than the code. And the thermal-amount rule matched the flag line, where the bonus sits two lines
below the guard, so it had to become windowed.

### 21.3 The last two thermal_amount readers — migrated

`buildVisualComposerRoster`'s per-piece `weatherBonus` was `else if (weatherProfile.isCold)` with
`fabric_weight` bonuses beneath it: between the two temperature extremes the roster carried no
thermal signal, and inside the cold tier it ranked by **mass** rather than by fit.

**Both original carve-outs survive, and one became unnecessary rather than re-tuned.**

The undershoot penalty still applies only to bottoms and dresses — a light TOP is not a problem in
the cold because it gets layered over, and that asymmetry has no band equivalent, so it stays an
explicit rule.

The heavy-fabric bonus used to require `isColdSevere` rather than `isCold`, because a merely-chilly
dinner had surfaced a long leather coat as the top-ranked outerwear pick
([cold-severity-spec.md](cold-severity-spec.md), `thread_1788050815289`). **The band removes the need
for that guard**, and more strongly than the guard did:

```text
chilly 55/45   leather coat -10 (warmer than conditions)   wool jacket +10 (well matched)
severe 30/20   leather coat +10 (well matched)             wool jacket  --
```

The old fix merely *withheld* a bonus. Ranking by fit actively penalises the coat and prefers the
piece that suits the evening. The incident's regression test was rewritten to assert that intent
under structured weather, rather than the absence of one particular bonus string.

### 21.4 Acceptance — the thermal-amount migration is complete

```text
thermal_amount      2 -> 0     the migration's real completion test, now met
parallel_contract  13 -> 13    untouched, as ruled
non_thermal         4 ->  4    held; the guard that contracts did not dissolve into the band
projection         16          unchanged — steps 5-6
producer           15          unchanged — steps 5-6
suite  1839 tests, 1837 pass, same 2 pre-existing failures
```

**No consumer derives thermal amount from a legacy cold flag any more.** What remains is projection
and producer cleanup, plus separate future work on the independent contracts' own trigger
calibration — which must not come from the band (§21.1).

### 21.5 What is actually left
* **`parallel_contract` (13)** — each needs *named independent ownership* recorded, not a band
  trigger. Documentation and boundaries rather than a behaviour migration:

```text
outfitEnvironmentalAdequacy  removable-layer presence      "is there something to put on"
outfitEnvironmentalAdequacy  transit removable presence    same question, transit window
outfitEnvironmentalAdequacy  minimum-warmth presence       "is there a warm layer at all"
outfitEnvironmentalAdequacy  transit sleeve coverage       "does it cover your arms"
outfitEnvironmentalAdequacy  outdoor capability            "is this garment for outdoors"
outfitEnvironmentalAdequacy  transit outdoor capability    same, transit window
wholeWardrobePieceTrustDecision  cold-appropriateness      "shorts / linen / bare in the cold"
buildVisualComposerRoster        eligibility gate          which pieces enter the roster
```

None of these asks how much insulation. Each may eventually earn its own trigger calibration from
exposure conditions; none may take it from the band.
* **`projection` (16)** and **`producer` (15)** — steps 5-6, unchanged.

No code was written for step 4's original premise.


---

## 22. §8 step 5 — projection migration

The other half of the composition problem: not only ranking the right garments, but ensuring the
model *receives* graded thermal context instead of hearing nothing below a threshold.

### 22.1 §8.1's pin named the wrong site

That pin singled out `isWeatherFiltered` as "the last place an old-model switch could survive". It
was the wrong target. `routes/ai.js`'s `isWeatherFiltered` gates a **disclosure sentence** —
*"everything shown is weather-optimized"* — while the weather guidance around it is unconditional.

**The real binary was `tools.js`'s search-evidence gate:**

```js
if (resolvedWeather.isHot || resolvedWeather.isCold) {   // attach weatherFit to search results
```

At 65/47 neither flag fires, so `search_wardrobe` returned **no thermal evidence at all** and the
model composed with nothing to go on. That is §6's defect on the evidence side, and it is the one
that actually affects composition. Correcting the pin rather than leaving it: naming a site in a spec
does not make it the important one.

### 22.2 What changed

**Search evidence** — the gate is gone. `weatherFitForPiece` already returns 0 with no adjustments
when there is nothing to say, so labels appear whenever a temperature exists and a garment whose
placement is unknown still gets none.

**The coarse label** the model reads is now computed from the band's demand, which is what §3.8
asked for. Only the blind spot moves:

```text
75/60   legacy: mild weather    band: mild weather      unchanged
55/45   legacy: cool weather    band: cool weather      unchanged
38/30   legacy: cold weather    band: cold weather      unchanged
65/47   legacy: mild weather    band: cool weather      <- the blind spot, closed
```

**This is the §21 mistake avoided.** Deriving the label from the band closes a gap without broadening
any tier — every other row is identical. That is the difference between a projection reading the band
and a contract being forced through it.

**The disclosure** now tracks whether weather actually shaped the roster, rather than whether a flag
fired.

**Heat is untouched.** This arc migrated the cold side; `isHot` and `isExtremeHeat` keep their own
paths, asserted by a test.

### 22.3 Census

```text
projection         16 -> 12
producer           15      unchanged — step 6
parallel_contract  13      untouched, as ruled
non_thermal         4      held
thermal_amount      0      held
suite  1844 tests, 1842 pass, same 2 pre-existing failures
```

The remaining 12 projections are display/debug evidence payloads and slot descriptions, not
model-facing composition evidence.


---

## 23. §8 step 6 — producer inventory

Inventoried before touching anything, per the ruling: **not a blanket deletion pass, and not
`producer 15 -> 0` chased mechanically.** The end condition is that no legacy producer holds semantic
authority independent of ExposureContext, thermal demand, or the named parallel contracts.

### 23.1 Eleven of the fifteen were never producers

Splitting the class by **where the cold truth comes from** collapses most of it:

| Function | Sites | Source of its flags | Class |
|---|---|---|---|
| `profileFromResolvedWeatherContext` | 2 | `resolved.temperature` — real numbers | derivation |
| `profileForEnvironment` | 5 | transforms a profile it was handed (indoor/transit split) | derivation |
| `resolveSlotWeather` | 3 | `context.temperature` — real numbers | derivation |
| `projectStylingApplicabilityContext` | 1 | reshapes an existing profile for owner-rule matching | derivation |
| **`weatherProfileFromContext`** | **4** | **prose, with no structured temperature at all** | **producer** |

```text
derivation  11    carries no independent authority
producer     4    the only class step 6 has to justify
```

None of the eleven invents a temperature. They compute the flag shape the parallel contracts still
consume, from weather that was already resolved — which is exactly what a compatibility layer should
do, and is not authority.

### 23.2 The one real producer, and why it stays for now

`weatherProfileFromContext` parses text like *"chilly work dinner"* and emits `isCold` with nothing
structured behind it. It genuinely creates cold truth, and it is the last-resort heuristic tier PR A
deliberately kept (§18).

**It cannot be removed yet, and the reason is a dependency rather than a preference.** Its consumers
are the 13 named parallel contracts, which by ruling (§21.1) still take legacy triggers. A producer
serving contracts that legitimately consume flags is a compatibility source, not stray authority.

**The condition for removing it is therefore already written down:** when the parallel contracts earn
their own trigger calibration from exposure conditions, this producer loses its last consumer and
goes with them. It should not be removed before that, and it must not acquire new consumers in the
meantime.

### 23.3 End state

```text
thermal_amount      0    no consumer derives thermal AMOUNT from legacy flags
parallel_contract  13    named, independent, must never take band semantics
projection         12    display and debug payloads; model-facing evidence migrated (§22)
derivation         11    computes the flag shape from resolved weather — no authority
producer            4    one function, one justified consumer set, one stated removal condition
non_thermal         4    held throughout
```

**The migration is complete on its stated terms.** No consumer derives thermal amount from a legacy
cold flag; no independent contract derives its semantics from the band; and the single remaining
producer has a named dependency and a stated end. What is left is not migration work — it is the
parallel contracts' own future calibration, which is its own semantic problem (§21.1).


---

## 24. Arc closed — final state

Merged to `main` 2026-09-03 across eight PRs (#305, #306, #309, #310, #311, #312, #313, #314).

```text
thermal_amount      0    no consumer derives thermal AMOUNT from a legacy cold flag
parallel_contract  13    named, independent — must never take band semantics (§21.1)
projection         12    display and debug payloads; model-facing evidence migrated (§22)
derivation         11    computes the flag shape from already-resolved weather — no authority
producer            4    one function, justified consumers, stated removal condition (§23.2)
non_thermal         4    held throughout — the guard that nothing dissolved into the band
```

`non_thermal` holding at 4 across every step is the load-bearing half of that table: it is the
evidence that footwear and wet-weather contracts were never quietly absorbed. A migration measured
only by the number falling would not have shown it.

**Two completion criteria were changed by evidence during the arc**, both recorded where they were
decided: `thermal_demand -> 0` was retired when §21 measured that forcing contracts through the band
would demand a removable layer at 75/60, and `producer -> 0` was never adopted once §23 showed 11 of
15 sites carried no authority at all.

**Handoff.** The parallel contracts' calibration against exposure conditions is the next semantic
project and needs its own spec. It is deliberately not designed here — §21's measurement is the
evidence for why those triggers cannot be inferred from the thermal band, and that is the starting
point rather than a conclusion to re-derive.
