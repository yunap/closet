# Spec — decomposing `isCold` into a thermal comfort band

**Status:** active — audit and design, 2026-09-01. **No code.** Thresholds deliberately not chosen
(§6).
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

Passing a single blob and letting the function reach into it for exposure would repeat this arc's
signature failure: a correct primitive fed the wrong inputs. Whether the two arrive as separate
arguments or one canonical object, **exposure must be a named, required part of the contract** and
absent exposure must be an explicit `unknown`, not silently "outdoors, all day".

What exists today: nothing. `environment` (indoor/outdoor) and the transit split are the only
exposure signals, and there is no daypart or duration anywhere (§7).

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

Still open for Slice 1, and deliberately not answered here: where aggregation lives, what the
structured shape is, and what the demand side is measured *in* — which §10.1 shows is the question
everything else waits on.
