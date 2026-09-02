# Findings — which garment facts can carry an ordered warmth level

**Status:** active — Slice 1 investigation, 2026-09-01. **No code. No ordinal levels assigned yet.**
**Route:** [docs/README.md](README.md). Step one of
[thermal-comfort-band-spec.md](thermal-comfort-band-spec.md) §12.

## 0. Scope, and the boundary that keeps it honest

This document answers exactly one question:

> **How warm is this garment, relative to another?**

It does **not** answer "is that warmth appropriate here" — that is the demand comparison, and it
lives elsewhere. No weather input, no threshold, no context appears below. Keeping weather out of
garment calibration is the whole point of splitting the two.

**The acceptance condition that follows from that split**, and the reason rows 1 and 3 of §12.1 are
the real test:

```text
garment warmth (calibration)    cardigan  <  puffer          monotonic in evidence
preference (demand comparison)  65/45 museum  cardigan > puffer
                                genuine cold  puffer > cardigan
```

**The calibration must be monotonic in garment evidence; the final preference must not be monotonic
in warmth.** If this document ever produces an ordering that already "knows" a puffer is wrong for a
museum, weather logic has leaked into it and the split has failed.

Measured against 210 active garments (`top`/`bottom`/`dress`/`outerwear`) in the reference wardrobe.

## 1. Facts that carry real thermal signal

| Fact | Population | Evidence strength | Notes |
|---|---|---|---|
| `fabric_weight` | **100%** | **substance, not warmth** — strong only in combination | see §1.1, the most important correction here |
| insulating material (`fabric_category` + `fiber_content`) | 16% carry it | **strongest single signal** when present | wool, cashmere, fleece, tweed, corduroy, shearling, flannel |
| `fabric_category` | 100% | **moderate–strong**, and better than weight alone | separates denim / leather / fleece / wool / knit |
| `fiber_content` | 89% usable, 11% `["unknown"]` | strong when specific | the 11% is where warmth becomes unreadable |
| `sleeve_length` | 70% | strong for arm exposure | lowest population of the coverage facts |
| `length_hits_at` | 98% | strong for leg coverage | |
| `neckline` | 96% | weak–moderate | small contribution in the existing model (`neck 3` vs `mass 8`) |

### 1.1 `fabric_weight: heavy` means substantial, not warm

All 17 heavy garments:

```text
6 × denim jeans          heavy, not insulating
Olive cargo pants, utility pants, wide-leg pants, trousers, technical pants
tweed vest               heavy, insulating
plum wool midi dress     heavy, insulating
black leather zip jacket heavy, not insulating
brown long leather coat  heavy, not insulating
plaid fleece coat        heavy, insulating
Black puffer coat        heavy, NOT insulating  ← see §3.1
```

**Six pairs of denim jeans sit in the same weight class as the puffer.** Heavy denim is substantial
fabric; it is not warm the way an insulated coat is. Any calibration that leans on `fabric_weight` as
its primary warmth axis inherits that confusion — and today's `cold` score does exactly that, with
`mass` weighted 8, the largest single term.

### 1.2 Coverage facts are well populated and genuinely independent

`length_hits_at` (98%) and `neckline` (96%) are nearly complete; `sleeve_length` (70%) is the weak
one. These answer *where* a garment covers, which §11.4 establishes is separate information from how
much it insulates — not a component of it.

## 2. Facts that must NOT directly set warmth

| Fact | Why not |
|---|---|
| `season` | wearer **intent**, not physics. Already fixed as corroboration-only in [piece-season-as-weather-evidence.md](piece-season-as-weather-evidence.md), and this wardrobe files a −5 °C puffer and a light trench both as `cool`. |
| `outerwear_role` | **capability**, not magnitude. `cold_weather_outerwear` says the garment can do a job; it does not say how many degrees. Contract B's own boundary. |
| `weather_protection` | a hazard axis (rain/wind). Orthogonal to insulation — a shell blocks rain and adds ~nothing thermally. |
| `occasion`, `formality`, register | social axes with no thermal content. |
| style labels, `reads_as`, name text | garment-text interpretation, excluded everywhere else in this engine for the same reason. |
| `opacity` | used for the see-through layer test; a proxy for *usefulness as a layer*, not for warmth magnitude. |

The recurring failure this table guards against: a field that *correlates* with warmth being promoted
to *measuring* it. `season` and `outerwear_role` both correlate strongly and mean something else.

## 3. Where the mapping becomes unknown

### 3.1 The warmest garment in the wardrobe reads as non-insulating

```text
996775  Black puffer coat   fabric_category synthetic   fiber_content ["unknown"]
        pieceHasInsulatingMaterial → FALSE
```

`INSULATING_FABRIC_CATEGORIES` covers wool, cashmere, fleece, tweed, corduroy, shearling, flannel —
not `synthetic`, and the fill is unrecorded. So the single warmest piece registers **no insulation
signal at all**, and its `cold: 14` comes entirely from *heavy + long sleeves + coverage* — the same
route six pairs of jeans take.

This is the concrete form of §11.8's warning: the existing score gets the puffer roughly right by
accident, through substance rather than insulation.

### 3.2 `heavy + synthetic/leather` cannot be resolved from stored facts

```text
Black puffer coat        heavy · synthetic · fiber unknown     → very warm
black leather zip jacket heavy · synthetic · fiber leather     → moderate
brown long leather coat  heavy · leather   · fiber leather     → moderate, wind-blocking
```

Same weight, same non-insulating verdict, materially different warmth. Fill type is the missing fact
and it is not represented anywhere (§7 of the band spec). **This is an honest `unknown`, not a
tagging error.**

### 3.3 Large collisions in the middle of the range

Garments sharing an identical thermal signature (`weight | insulating | sleeve | group`):

```text
light  · not · sleeveless · top      20 garments
medium · not · short      · top      15    ← "mustard knit sweater" and "Band tee" together
medium · not · long       · top      11
light  · not · sleeveless · dress     9
```

The 15-way collision is the clearest: a knit sweater and a graphic tee are indistinguishable on these
facts. `fabric_category` separates them (`knit` vs `cotton`/`jersey`) which is why §1 rates it above
weight — but the current score does not use it except through the insulating-material test.

**Implication:** the mid-range needs `fabric_category` to be load-bearing, not just weight and
coverage. That is a finding about which facts a scale must consume, not yet a scale.

## 4. What this means for the smallest candidate scale

Not proposing levels yet, per §12. What the evidence constrains:

1. **No single fact orders warmth.** Weight conflates substance with insulation; insulating material
   is present on only 16% and misses the warmest garment; coverage answers a different question.
   A defensible level must combine at least *weight + fabric_category + insulating material*, with
   coverage carried **separately** per §11.4.
2. **`fabric_category` must be load-bearing**, not merely a route into a boolean insulation test —
   it is the fact that separates the mid-range collisions in §3.3.
3. **Two documented `unknown` classes must survive into the representation**: unrecorded fill
   (§3.2), and `fiber_content: ["unknown"]` (11% of garments). Per row 6 of §12.1 these must read as
   *unknown*, never as *neutral warmth* — the collision
   [thermal-comfort-band-spec.md](thermal-comfort-band-spec.md) §10.3 showed is latent in the
   current sum.
4. **Whatever scale is chosen must place the puffer above heavy denim** using facts that are actually
   present. Today's score does so via `mass`, which is the wrong reason and is why §3.1 matters.

## 5. Next, still no code

Build the reference calibration table proper: map published garment-insulation anchors onto these
Closet facts, propose the smallest ordered representation the evidence supports, and test it against
[thermal-comfort-band-spec.md](thermal-comfort-band-spec.md) §12.1's six orderings — checking, per
§0, that the calibration itself remains weather-free and that the puffer/cardigan reversal comes
entirely from the later demand comparison.
