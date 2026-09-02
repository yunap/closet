# Spec — what `outerwear_role` is supposed to own

**Status:** Active ruling, 2026-09-02, **no implementation**. Conclusion: `outerwear_role` is deprecated
with **no replacement tag** — outdoor adequacy is a contextual verdict, not a garment fact. Two
earlier positions in this document were superseded during the discussion and are kept visible
(§6, §6.1) because the reasoning is the point. **Route:**
[docs/README.md](README.md). Amends
[outerwear-weather-capability-spec.md](outerwear-weather-capability-spec.md); continues the open
ruling recorded in
[outerwear-weather-consolidation-spec.md](outerwear-weather-consolidation-spec.md) Appendix F.

## 1. The question

**What is `outerwear_role` actually supposed to own?** Two questions are currently entangled in one
four-value enum:

```text
1. Is this a real outdoor layer, and what environmental job can it do?
2. How thermally substantial is it — would you normally keep it on indoors?
```

`transition_layer` vs `cold_weather_outerwear` is trying to encode both, and that is the defect.
Everything below is evidence for *that* claim. **It is not evidence that role should follow
insulation monotonically** — that reading would repeat the mistake in the other direction.

## 2. The contract contradicts itself

The tagger schema says, in the same field description:

> *"This is a functional judgment about what job the garment can do as an OUTER layer outdoors,
> **independent of fabric_weight/warmth**"*

> *"`cold_weather_outerwear` = genuine cold-weather outer layer with **substantial insulation** as
> the outside layer (insulated coat, puffer, down coat)"*

> *"**None** of fabric weight, wool/insulating fiber, nylon/polyester… in isolation is sufficient to
> pick a value"*

Those cannot all hold. The top tier is *defined* by insulation while the field is *declared*
independent of warmth, and the model is told not to reason from the two facts that would establish
insulation. A tailored wool coat matches the concept of the top tier and none of its examples —
which are all filled constructions — so `transition_layer` is what the instruction produces.

## 3. Measured incoherence

All 33 active outerwear pieces, roles cross-referenced with `thermalMaterialVerdict()`:

```text
indoor_layer            19
transition_layer         9
protective_shell         2
cold_weather_outerwear   3
```

The heavy or insulating-verdict subset, split by **who assigned the role** — a distinction the
first draft of this section missed, and which changes what the evidence supports:

```text
                                                     verdict      role set by
cold_weather_outerwear
  996765  brown long leather coat    heavy   unknown       OWNER (manual_overrides)
  996775  Black puffer coat          heavy   insulating    tagger
  996866  navy quilted puffer        heavy   unknown       tagger

transition_layer
  996867  black wool coat            heavy   insulating    tagger
  996760  cream fleece coat          heavy   insulating    OWNER (manual_overrides)
  207     black leather zip jacket   heavy   unknown       tagger
```

### 3.1 Correction: two of the six are owner rulings

The two rows that looked most anomalous — a leather coat with no insulating evidence in the top
tier, and a heavy insulating fleece coat below it — are **manually set**, not tagger output. An
earlier draft of this spec presented all six as evidence of tagger incoherence. That was wrong.

**Among tagger-authored assignments the pattern is much weaker.** Three of four are defensible
under a "what outdoor job" reading: both puffers in the top tier, a leather zip jacket below it.
**The single genuine anomaly is `996867`** — heavy, wool, insulating verdict, mid-thigh, filed as
`transition_layer`.

### 3.2 What the manual values *are* evidence of

They are not noise, and they are not errors to correct. They are **how a human reading the same
labels applied them**, and the two owner rulings do not follow insulation either: a non-insulated
leather coat was placed in the top tier, and a heavy insulating fleece coat below it. Both are
defensible under "what job does this do for me" and neither is derivable from thermal facts.

So the boundary is ambiguous **to a human reader as well as to the model** — which supports §1's
claim that the field is carrying two questions, while removing the stronger claim that the tagger
is assigning roles incoherently. The owner should be asked what they meant by those two rulings
before any definition is rewritten around them; they may encode exactly the "would I keep this on
/ is this my actual winter coat" axis §6's Option B wants to separate out.

## 4. What already works and must not be disturbed

`996867` was tagged `weather_protection: ["wind"]` and `outerwear_role: transition_layer`. **Wind
protection did not collapse into `protective_shell`.** A tailored wool coat that blocks some wind
stayed a warmth-and-coverage garment rather than becoming a shell.

That separation — role answers the layering job, `weather_protection` answers the environmental
barrier — is working, and it is exactly what would have failed under a single conflated field. Any
repair here must leave it intact.

## 5. Prior art — this is a continuation, not a discovery

Appendix F of the consolidation spec (2026-08-31) already measured and ruled on the neighbouring
half of this problem, and its verifier is re-runnable
(`scratch/audit_indoor_layer_parity.mjs`):

- Substituting roles for `garmentKind` in the capsule indoor-layer rule admitted **22 pieces vs 9**,
  including a trench coat and a long leather coat, *"because the tagger legitimately files
  substantial coats as `transition_layer`."*
- The cold-layer direction admitted **1 piece vs 8**, which *"would leave a winter capsule with a
  single possible cold layer."*
- Its conclusion, verbatim: **"'Indoor-wearable' is a missing axis."** Neither `outerwear_role` nor
  `weather_protection` expresses whether a layer can stay on indoors, and *three separate rules*
  reconstruct it from `garmentKind === 'cardigan'`. *"Re-tagging would not close this; the axis does
  not exist."*

**That ruling calls the current `transition_layer` behaviour legitimate.** Any repair must either
be consistent with it or explicitly supersede it — not quietly overrule it.

## 6. Direction changed — replace the enum, do not rescue it

**Owner ruling 2026-09-02, superseding §6's earlier A/B framing.** Both options assumed the
four-value enum survives. It should not. The field mixes at least three questions that are not
values on one axis:

```text
1. Where is the layer intended to be worn?      indoors / outdoors / both
2. What job does it do?                          adds warmth / blocks weather / completes the outfit
3. How thermally substantial is it?              light / transitional / genuinely cold-weather
```

That is why `indoor_layer`, `transition_layer`, `protective_shell` and `cold_weather_outerwear`
are hard to compare — a cardigan is *indoors and outdoors, adds warmth, no protection, light*; a
summer windbreaker is *outdoors, little warmth, wind, light*. Forcing both into one enum is the
defect, and better definitions cannot fix a bad factoring.

Each meaning already has a better owner:

```text
warmth / insulation        → thermalMaterialVerdict + warmthCalibrationEvidenceState
rain / wind protection     → weather_protection (already separate, already working — §4)
garment identity           → garmentKind (coat/jacket/cardigan/vest)
removability indoors       → outfit/context logic, or its own fact if ever proven necessary
```

`transition_layer` in particular may not be a garment fact at all. "Transitional" is a relationship
between a garment's warmth and a day's demand — which is precisely what the thermal-comfort work
now computes. Storing it as an intrinsic tag duplicates that authority in a field a model assigns
from a photo.

### 6.1 A replacement was proposed, and then withdrawn

The first replacement was `can_serve_as_outdoor_layer: yes | no | unknown`. **Owner objection, and
it is decisive: that field still has no stable answer.**

```text
74°F   light cardigan          → yes
58°F   light cardigan          → probably insufficient
58°F   substantial wool cardigan → yes
35°F   both                    → insufficient as the sole outer layer
```

"Can serve outdoors" is not a property of a garment. It is a relationship between a garment and a
day. Storing it as an intrinsic tag smuggles weather demand into a garment fact — the same defect
as `transition_layer`, wearing a cleaner name.

**This reached §8's stop condition analytically, before spending anything on the screen.** The
screen was going to ask whether a tagger can answer the question reliably; the question has no
condition-free answer, so no tagging accuracy could have rescued it.

## 7. Conclusion — the capability is a verdict, not a tag

Nothing replaces `outerwear_role`. Its one live job becomes a contextual judgment, computed where
the conditions are already known.

```text
intrinsic garment facts          contextual verdict
  garmentKind                      given these facts AND today's conditions,
  thermal evidence                 is this adequate as the outermost layer
  coverage                         for THIS outing?
  insulating_layer_materials
  weather_protection
  construction
```

`transition_layer`, `cold_weather_outerwear` and `can_serve_as_outdoor_layer` are all the same
mistake at different resolutions: a stored answer to a question that only has answers in context.

### 7.1 The contextual home already exists — and is already the only caller

**`outfitEnvironmentalAdequacy.js` (Contract C) is the sole consumer of `requireOutdoorLayer`.**
Both call sites are inside weather branches that already hold the temperature:

```js
if (weather.isColdSevere && !indoorDestination) {
  const verdicts = layers.map(piece => evaluateOuterwearCapability(piece, { requireOutdoorLayer: true }))
```

So a condition-free garment tag is being consulted from the one place in the codebase that knows
the condition. That is the whole argument in one line: the evaluator can ask "is this adequate at
28°F" directly, and does not need the tagger to have guessed "is this adequate outdoors" at tagging
time with no temperature in hand.

Contract C already computes exactly this shape of judgment for warmth — `hasMinimumWarmLayer`,
`someLayerContributesWarmth`, `systemColdScore`, `baseLayersAreFullyMeasured`. Outdoor adequacy is
the same question about the outer layer, and it belongs beside them.

Note the existing comment at the severe-cold branch already concedes the direction: *"the role is
evidence rather than a gate — a shell over real insulation passes."* The field was already being
demoted to evidence by the code that reads it.

### 7.2 The one possible survivor

A genuinely construction-based fact — *"built as an external shell"* — is condition-free and might
deserve to exist. But it is probably already expressible as `garmentKind` + `weather_protection`,
and §4 shows that pair working. Not proposed here; noted so it is a decision rather than an
oversight.

## 8. What this means for the field

- **Deprecate `outerwear_role`.** No replacement tag.
- **Do not run the §8 screen.** Its stop condition was reached by argument; spending Gemini calls
  to confirm a question is unanswerable would be waste.
- **Contract B keeps its shape** for the parts that are genuinely intrinsic — `weather_protection`
  hazards. Its `requireOutdoorLayer` requirement moves to Contract C as a weather-aware judgment.
- **Nothing is deleted until the replacement judgment exists.** Removing the field first would
  silently drop the severe-cold outdoor check.

## 9. Migration notes

- **`outerwearCapability.js` needs one change**: `OUTDOOR_CAPABLE_ROLES` becomes a direct read of
  the new field. Contract B's verdict shape, codes and messages are unaffected.
- **The raw role string reaches models** at `tools.js:244`, `tools.js:1627` and in a cache key at
  `outfitSetPlanner.js:2535`. Replacing the vocabulary changes prompt content and cache keys, so it
  needs the usual accepted-delta treatment rather than a silent swap.
- **No backfill.** Old rows keep their four-way value; a derived reader can map the three
  outdoor-capable values to `yes` and `indoor_layer` to `unknown` rather than `no`, given §7.3
  shows `no` was over-applied. Re-tagging is how a row gets a real answer.

## 10. Not proposed

- **No retagging of the wardrobe**, and §7.2's six rows are a screening set, not a correction list.
- **No change to `weather_protection`** or its independence from role (§4). A shell is
  `garmentKind` + `weather_protection`; it does not need a role value of its own.
- **No new consumer** until the screen in §8 says the fact is reliably taggable.
