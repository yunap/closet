# Spec — decomposing `isCold` into a thermal comfort band

**Status:** Audit and design, 2026-09-01. **No code.** Thresholds deliberately not chosen (§6).
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

One comparison, three outcomes, replacing a family of independent booleans. `pieceWeatherScores`
already produces the graded contribution; what does not exist is the **required band** and the
comparison against it.

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

* genuinely discrete: footwear exclusions (§3.6), the prompt-text switches (§3.7's last two), display
  labels (§3.8)
* genuinely graded: relevance scoring (§3.7), outfit adequacy (§3.1, §3.4)
* unclear, needs its own analysis: the metadata-completeness gate (§3.2's `missingWeatherGateField`),
  which uses cold as a proxy for "this field now matters"

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

1. **Shared evaluator.** A `requiredThermalBand(resolvedContext)` producer and a
   `compareOutfitToBand(pieces, band)` verdict returning `undershoot | appropriate | overshoot` with
   graded distance. Pure, tested, consumed by nobody. Behaviour unchanged.
2. **Ranking first** (§3.7). Highest value, lowest risk: a rank change cannot make an outfit invalid.
   Retires the `+10`/`−10` pair and the `isCold` on/off switches, and delivers use case 2 and 3.
3. **Outfit adequacy** (§3.1, §3.4, §3.5). Migrate Contract C's branches onto the band, preserving
   the measured/unmeasured discipline and the transit split.
4. **Footwear** (§3.6). Likely stays discrete; confirm against §6 rather than assume.
5. **Display** (§3.8). Project a coarse label *from* the band, so the label is derived rather than
   parallel.
6. **Delete the authority.** `isCold` / `transitIsCold` / `isColdSevere` /
   `needsRemovableCoolLayer` survive only as derived labels for §3.8, or are removed entirely. The
   arc's own standard: an engine carrying two overlapping cold models is the condition the
   consolidation work exists to prevent.

Each slice ships independently and is reversible. No slice may add a new threshold without recording
it here first.
