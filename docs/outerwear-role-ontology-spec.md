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

The heavy or insulating-verdict subset, which is where the boundary should be legible:

```text
cold_weather_outerwear
  996765  brown long leather coat    heavy   verdict: unknown       ← no insulating evidence
  996775  Black puffer coat          heavy   verdict: insulating
  996866  navy quilted puffer        heavy   verdict: unknown

transition_layer
  996867  black wool coat            heavy   verdict: insulating
  996760  cream fleece coat          heavy   verdict: insulating
  207     black leather zip jacket   heavy   verdict: unknown
```

**Two pieces whose composition establishes nothing outrank two heavy coats whose composition
establishes insulation.** Read as a warmth ordering this is incoherent. Read correctly, it is
evidence that **the labels cannot be interpreted consistently under their own documented
definition** — the assignments are not obviously wrong under a "what outdoor job" reading, and not
obviously right under a "substantial insulation" one, because the definition asks for both.

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

## 6. Two end states to evaluate

### Option A — keep the taxonomy, fix the boundary

Admit that thermal evidence *is* relevant to distinguishing `transition_layer` from
`cold_weather_outerwear`, and rewrite the description so the field no longer claims independence
from warmth while defining its top tier by insulation.

- **For:** smallest change; no new field; no migration; the enum and its consumers are untouched.
- **Against:** it makes `outerwear_role` a **second warmth authority**. This session just spent an
  entire arc establishing one — `thermalMaterialVerdict()` and `warmthCalibrationEvidenceState()` —
  specifically so that "how warm is this" has a single owner. A tagger-assigned ordinal that ranks
  warmth independently is the duplication that work exists to prevent, and it would be assigned by
  a model from a photo rather than derived from stored facts.

### Option B — role owns functional placement only

`outerwear_role` answers *what outdoor job can this layer do*. Warmth is answered by the thermal
machinery. "Can it reasonably stay on indoors" becomes its own fact rather than being smuggled into
`transition_layer`.

- **For:** one question per field. It completes Appendix F's diagnosis rather than working around
  it, and it retires the `garmentKind === 'cardigan'` proxy in three rules. Warmth stays with the
  owner that has evidence semantics — including `unknown`, which a tagger-assigned ordinal cannot
  express.
- **Against:** needs the missing axis actually built, which Appendix F left as an open ruling with
  three candidate shapes (a fifth enum value; a separate tagged boolean; a derived reader over open
  front / knit / no closure hardware). §20 of the consolidation spec rules out new **user-entered**
  garment fields, so a derived reader or a tagged-only value are the live candidates.

**Recommendation: B**, on the same principle the rest of this work has followed — one semantic
question, one owner. A is cheaper today and produces a field that quietly competes with the thermal
layer tomorrow.

## 7. Why nothing is implemented yet

**No consumer currently distinguishes `transition_layer` from `cold_weather_outerwear`.**
`OUTDOOR_CAPABLE_ROLES` in `outerwearCapability.js` contains `transition_layer`,
`protective_shell` and `cold_weather_outerwear` alike, and the capsule cold-layer selector uses
`garmentKind`, not the role. So today's incoherence costs nothing at runtime — the same position
`structured` vs `hangs_straight` is in.

That is a luxury, and it should be spent on getting the ontology right rather than on a prompt
tweak that makes the labels *look* ordered while leaving the field owning two questions. A prompt
change now would also be unfalsifiable: with no consumer reading the distinction, a "better"
assignment cannot be shown to improve any behaviour.

## 8. What would decide it

1. **Owner ruling on §6** — A or B. This is the ontological question and nothing else proceeds
   without it.
2. If **B**: pick the missing-axis shape from Appendix F's three candidates. A derived reader is
   testable against the existing wardrobe with no tagging spend at all, which makes it the cheapest
   to evaluate first.
3. Only then: prompt wording, and a re-tag of the six §3 pieces to check the boundary is legible.

## 9. Not proposed

- **No retagging.** §3 is a diagnostic sample, not a correction list.
- **No change to `weather_protection`,** or to its separation from role (§4).
- **No new consumer** of the role distinction until the ontology is settled — adding one now would
  turn an incoherent label into runtime policy.
