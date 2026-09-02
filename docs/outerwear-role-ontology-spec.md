# Spec — what `outerwear_role` is supposed to own

**Status:** Proposed 2026-09-02. **No implementation, deliberately** — the first question is
ontological and needs an owner ruling before any prompt or code changes. **Route:**
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

### 6.1 Proposed replacement

```text
can_serve_as_outdoor_layer:  yes | no | unknown
```

One question: **can this piece legitimately be the outermost layer for outdoor exposure?** Note
this is *not* "is it worn indoors" — a cardigan can be worn outdoors in mild weather, and the
current `indoor_layer` name conflates the two.

## 7. Measurement — what the engine actually uses

### 7.1 The enum already collapses to one bit

`outerwearCapability.js` is the only place the values branch:

```js
const OUTDOOR_CAPABLE_ROLES = new Set(['transition_layer', 'protective_shell', 'cold_weather_outerwear'])
```

Three to one. Every other reference passes the raw string through to a prompt or a cache key. The
field's own comment states the intent outright: *"indoor_layer is the whole point of the field."*
**So replacing four values with `yes|no|unknown` discards no deterministic behaviour** — it removes
three distinctions nothing reads.

### 7.2 The bit is largely predicted by `garmentKind` already

Across all 33 tagged outerwear pieces, `garmentKind ∈ {jacket, coat}` predicts the current
outdoor-capable bit **27/33 = 82%** of the time. All six disagreements are the same shape —
`garmentKind: jacket` filed as `indoor_layer`:

```text
141     sheer black shrug                    plausibly indoor
184     patchwork knit buttoned top          plausibly indoor
250     charcoal textured cropped jacket     tweed — reads outdoor
990358  navy technical hoodie                technical/performance — reads outdoor
990441  grey layered zip jacket              technical/performance — reads outdoor
996768  Duster                               a duster is an outdoor layer by definition
```

Two readings, and they point the same way. Either the field contributes almost nothing beyond
garment kind, or its unique contribution is **four probable mis-tags out of six**. Neither
supports keeping a four-way enum.

This also closes a loop with Appendix F, which found three separate rules reconstructing
indoor-wearability from `garmentKind === 'cardigan'`. The tagger appears to be doing the same thing
implicitly — 13 of 19 `indoor_layer` pieces are cardigans or vests.

### 7.3 `indoor_layer = no` is too coarse

Confirmed by the same six rows. A technical hoodie and a layered zip jacket are outdoor-wearable by
any ordinary reading; filing them as "not what you put on to walk outside" is wrong, not merely
debatable.

## 8. What must be measured before implementing

**The open question is whether a tagger can reliably answer `yes|no|unknown` from photos.** §7.2
suggests the current boundary is being drawn largely from garment kind, with errors where it is
not — so a rename alone may reproduce the same mistakes under a cleaner label.

Proposed screen, cheap now that tagging is on Gemini 3.1 Flash-Lite at ~$0.008/garment:

1. Re-tag the six §7.2 disagreements plus a control set of clear yes/no cases under a prompt that
   asks the new question directly, with the examples in §8.1.
2. Adjudicate against the photos, owner-ruled, the way §6b/§6d of the cost spec did.
3. **Stop condition:** if the model cannot separate a technical hoodie from a knit shrug, the
   capability is not reliably taggable and belongs at outfit time instead — derived from
   `garmentKind` + thermal evidence + weather demand rather than stored.

### 8.1 Examples the prompt should carry

```text
yes:      wool coat · leather jacket · denim jacket · trench · puffer · windbreaker · rain shell
          · a substantial cardigan genuinely usable outside
no:       lightweight indoor cardigan · knit shrug · house/indoor-only layer
unknown:  evidence insufficient
```

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
