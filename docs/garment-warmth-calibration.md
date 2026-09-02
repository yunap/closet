# Findings — candidate ordered warmth representation

> **Amended 2026-09-01.** The scale now consumes `thermalMaterialVerdict()` rather than a boolean,
> and its "composition unresolved" test — previously hand-rolled from the fibre list — is replaced
> by the owned verdicts. Re-measuring exposed a third fact the old heuristic was silently carrying:
> "fabricAdmitsHiddenMaterial". Without it the migrated scale refuses to score 134 of 268 pieces
> instead of 15. See [fiber-evidence-completeness-spec.md](fiber-evidence-completeness-spec.md) §13.
> **The puffer, which this document recorded as landing in UNKNOWN, now scores `very warm`.**


**Status:** active — Slice 1 step two, 2026-09-01. **No code. No weather input. No demand mapping.**
**Route:** [docs/README.md](README.md). Follows
[garment-warmth-evidence-map.md](garment-warmth-evidence-map.md); feeds
[thermal-comfort-band-spec.md](thermal-comfort-band-spec.md) §12.

## 1. Anchors, and how far they are trusted

Published garment-insulation tables (ASHRAE 55 / ISO 9920) give approximate `clo` values per garment.
Used here **for ordering only**, at the resolution the ordering is robust:

```text
tee / light blouse        lowest
light trousers
denim trousers
thin long-sleeve sweater
thick sweater
light jacket
insulated winter coat     highest
```

The numeric values are recalled reference points, **not independently verified in this document**,
and per [thermal-comfort-band-spec.md](thermal-comfort-band-spec.md) §11.8 they must never become
Closet's unit — only a calibration reference for an ordinal scale.

### 1.1 An anchor property that constrains the whole design

Published per-garment `clo` values are **body-region specific**. Denim trousers and a thin sweater
sit at similar `clo` while warming entirely different parts of a person. So:

> **A single warmth scale is meaningful *within* a garment role, not *across* body regions.**
> "Are these jeans warmer than that cardigan?" is a category error.

The measured distribution confirms this is not academic: `moderate` contains 11 bottoms and **0
tops**, because heavy denim is the only thing that reaches it below the waist. Every pinned ordering
in §12.1 is a *within-role* comparison (cardigan vs puffer — both outer layers), which is the case
the scale can actually serve.

## 2. The candidate representation

Two axes from §1 of the evidence map, deliberately nothing else:

```text
substance          light 0 · medium 1 · heavy 2        (fabric_weight)
insulating evidence  no 0 · yes +2                     (fabric_category + fiber_content)

level = min(4, substance + insulating)
        very light · light · moderate · warm · very warm
```

**No `name`, no `outerwear_role`, no `season`, no `occasion` input.** That is the §0 boundary from the
evidence map, and it is what makes the puffer result below meaningful rather than circular.

### 2.1 The `unknown` rule

```text
UNKNOWN when substance ≥ medium
         AND fabric_category is non-committal (synthetic | other | technical/performance | unset)
         AND fiber_content is empty or ["unknown"]
```

That is the honest boundary: *we can see there is material here, and we cannot tell what it does.*

## 3. How the wardrobe distributes

```text
             very light   light  moderate    warm  very warm  UNKNOWN
top                  42      38         0       9          1        0
bottom               17      27        11       6          0        2
dress                11       9         0       3          1        2
outerwear             4      11         2      12          1        1
                    ---     ---       ---     ---        ---      ---
total                74      85        13      30          3        5
```

Bottom-heavy, which matches a warm-climate wardrobe. **Only 5 of 210 garments (2.4%) land in
`UNKNOWN`** — the rule is narrow, not a catch-all.

### 3.1 Outerwear, ordered — the comparison that matters

```text
very light   sheer shrug · polka dot cardigan · lilac knit cardigan · navy technical hoodie
light        gray jacket · ribbed cardigan · cream trench · pink raincoat · Duster
             navy plaid jacket · olive lightweight jacket · grey layered zip jacket
moderate     black leather zip jacket · brown long leather coat
warm         knit cardigans (×6) · wool vests · tweed cropped jacket · fleece jackets
very warm    cream and taupe plaid fleece coat
UNKNOWN      Black puffer coat
```

Two properties worth noting, both correct:

* **Knit cardigans outrank the trench and the raincoat.** Thermally that is right — an unlined
  gabardine trench is not warm — and it is a good sign that the scale did **not** quietly encode
  "coat > cardigan". Outdoor capability is a *separate* axis (§2.1 of the band spec) and is where the
  trench wins.
* **Leather sits at `moderate`**, above light jackets and below knits. Substantial, not insulating.

## 4. The pinned case: the puffer — **resolved 2026-09-01, and how it resolved matters**

> **Correction.** §4 below was written when the coat's fill was recorded as `["unknown"]` and the
> owner had described it as synthetic. Its care label reads **60% duck down / 40% waterfowl
> feathers**; the *shell and lining* are polyester. The owner added `down` to `fiber_content`, and
> the whole chain moved:
>
> ```text
> fiber_content ["unknown"]                  → UNKNOWN     cold 14   honest
> fiber_content ["polyester","nylon"]        → moderate    cold 17   CONFIDENTLY WRONG — ties with heavy denim
> fiber_content ["polyester","nylon","down"] → very warm   cold 23   correct
> ```
>
> §12.1 row 3 (`puffer > cardigan` in genuine cold) now holds, earned from `down` being an
> insulating fibre rather than from the word *puffer*. The representation in §2 needed no change.
>
> **Three findings from that sequence, one of which corrects §4.1:**
>
> 1. **`down` was never missing from the schema.** It is in `INSULATING_FIBERS` and in the piece
>    editor's chip list. §4.1's conclusion — that a new "is this filled?" field was the
>    highest-leverage gap — **was wrong**. The field existed; the *information* did not.
> 2. **Fill is a care-label fact, not a photo fact.** The middle row above was produced by a
>    re-tag from a good hanger photo, which correctly read a shiny polyester shell and could not see
>    inside. The garment went from `tag_state: fully_tagged` and honestly unplaceable to
>    `fully_tagged` and confidently wrong. **The middle state is worse than the first**, and no
>    photo-based tagging pass can avoid it.
> 3. **The owner's correction pinned itself.** `manual_overrides` now contains `fiber_content`, so a
>    future retag cannot overwrite it — the mechanism from
>    [outerwear-weather-consolidation-spec.md](outerwear-weather-consolidation-spec.md) Appendix B
>    working as intended.

## 4bis. The original analysis, retained

```text
dark blue bootcut denim jeans     → moderate
cream and taupe plaid fleece coat → very warm
striped knit cardigan             → warm
Black puffer coat                 → UNKNOWN   "substantial but fill/fibre unresolved"
```

**The calibration cannot establish that the puffer is warmer than heavy denim.** Its
`fabric_category` is `synthetic` and its `fiber_content` is `["unknown"]`; nothing stored says it is
filled or quilted. Reaching the "right" answer would have required reading the word *puffer* from its
name or trusting `outerwear_role: cold_weather_outerwear` — both explicitly excluded, and doing so
would have made the test pass while defeating the boundary that gives the test meaning.

So this is a **pass by the standard set for it**: the representation admits it does not know, rather
than guessing correctly for the wrong reason.

### 4.1 The single highest-leverage missing fact

Everything else in the wardrobe places. The gap is narrow and specific:

> **Is this outer layer insulated/filled?**

That fact is:

* **visible in a photograph** — quilting, baffles, channel stitching are exactly what a tagger can see;
* **not a temperature range**, so it does not cross
  [outerwear-weather-consolidation-spec.md](outerwear-weather-consolidation-spec.md) §20;
* **not a fabric-technician question** — "does it look quilted/filled" is answerable by an owner,
  unlike "coated PU or textile";
* **distinct from `outerwear_role`**, which states a job rather than a construction.

Note the shape: this is the *fourth* time in this arc that a rule failed because a garment's
construction had no field to live in — `knit` for shoes, footwear lining, `season` lacking a cold
value, and now fill. That pattern is itself a finding.

## 5. Coverage: separate from insulation, not irrelevant to warmth

Recording an important nuance so a later reader does not over-apply §11.4:

```text
garment insulation evidence   ≠   body coverage          ← the separation that holds
body coverage has no thermal effect                       ← NOT implied, and false
```

Coverage does not define a garment's insulation **magnitude**, which is why it is absent from §2's
level. But when an outfit is later compared against demand, insulation and covered area **interact** —
a warm garment covering little warms a person less than the same garment covering more. The scale
above is a per-garment property; the outfit comparison will need both it and the coverage facts,
which is precisely why §11.4 says the two travel as separate information rather than being folded
together.

## 6. State, and the next review point

Ready for review, per the agreed checkpoint: a candidate ordinal representation exists, the wardrobe
distribution across it is measured, and the collisions and unknowns are documented — **before** any
weather-demand mapping.

Open, and deliberately not started:

1. Whether `fabric_category` should be load-bearing beyond the insulating-material test — the
   evidence map's §3.3 collision (a knit sweater and a Band tee sharing `medium|not|short|top`) is
   *not* resolved by §2's level; both land at `light`.
2. Whether five levels is the right count, or whether the evidence only supports four.
3. The fill fact of §4.1 — an owner ruling, not a coder decision.
4. The demand mapping, which stays untouched until the above settle.
