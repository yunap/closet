# Spec — source-sensitive insulating credit for garmentWarmthLevel

**Status:** Ratified 2026-09-06 (face-fiber credit only — see §5 for what remains open), ready to
implement. **Route:** [docs/README.md](README.md). Narrows `garmentWarmthLevel`
([garmentWarmth.js:170](../styling-engine/garmentWarmth.js)). Supersedes the earlier
outerwear-only draft of this spec — the 35°F live-thread census showed the defect is not an
outerwear/non-outerwear boundary question at all (see §1).

## 1. The problem, evidenced

Live thread `thread_1788656298713` (35°F coordinated-plan QA): a `grey wool black stripe knit
dress` (short sleeve, base garment) and a `grey textured fleece` (removable layer) both reached
`garmentWarmthLevel: 'warm'`. Traced:

```
fleece:  substance(medium)=1 + insulating(+2) + coverage(+1.0, long sleeve + warm neckline) = 4.0 -> warm
dress:   substance(medium)=1 + insulating(+2) + coverage(0, short sleeve, neutral neckline)  = 3.0 -> warm
```

The `+2` in both comes from `thermalMaterialVerdict(piece) === 'insulating'`, which is decisive
whether the positive evidence is a **recorded fill/construction** (`insulating_layer_materials`
containing e.g. `down`) or a **face-fabric fiber name alone** (`wool`, `fleece`, `cashmere`, ... —
`hasPositiveInsulatingEvidence`, [attributes.js:550](../styling-engine/attributes.js)). An initial
draft of this spec proposed withholding credit for outerwear specifically when fill was confirmed
absent. A follow-up census showed that framing was wrong: **the identical mechanism was the sole
reason the non-outerwear dress also reached `warm`** (without the fiber credit, both pieces compute
to exactly `moderate` — see §2's arithmetic), so outerwear was never the real boundary.

## 2. What the full census established (summary; raw numbers in the investigation, not repeated here)

- **34 real wardrobe pieces** carry `thermalMaterialVerdict: 'insulating'` via face-fabric evidence
  alone (no recorded fill). Under the current flat `+2`, **23 of 34** land at `warm` — full
  winter-outerwear tier — regardless of cut, coverage, or garment type. 4 genuinely filled pieces
  (real `insulating_layer_materials`) are a separate, correctly-unaffected group, all `very warm`.
- **The cleanest isolated comparison** (no sleeve-coverage bonus, no bare-cut penalty — both terms
  neutral): five real medium-weight, short-sleeve, non-insulating tops (ids 363, 137, 265, 150, 220 —
  cotton/modal/rayon/unknown fiber) all compute `substance(1) + coverage(0) = 1.0 → moderate`. A
  real medium-weight short-sleeve **wool** dress (`Charcoal ruched dress`) computes `1 + 2 + 0 = 3.0
  → warm` under the current rule — a **two-bucket jump** (moderate → warm) from the fiber term
  alone, isolated from every other variable. Under a candidate `+0.5` face-fiber credit, the same
  wool dress computes `1.5 → moderate` — a half-step above the cotton tops' `1.0`, same bucket,
  correctly ordered, not inflated.
- **A data-state note, not a finding**: those five tops return `thermalMaterialVerdict: 'unknown'`,
  not `'non_insulating'` — none has `insulating_layer_materials` explicitly recorded `[]`, only
  unset. This is a distinct question from whether their FACE material is known (`fabric_weight` is
  recorded for all five, which is what makes them placeable at all, per `warmthPlacementState`'s own
  fabric-weight-vs-insulating-evidence distinction). Do not read "unknown insulating verdict" as
  "unknown material" — they are different axes, already separated elsewhere in this file.
- **The sleeveless case is a confound, not counter-evidence.** Seven real sleeveless wool/cashmere
  pieces currently land at `moderate` only because two oversized, opposite terms cancel
  (`substance(1) + insulating(2) + bare(-2) = 1`). Reducing the fiber credit to `+0.5` without
  touching the bare-cut penalty drops them to `very light` (`1 + 0.5 - 2 = -0.5`), tying them with an
  actual bare cotton tank — but the short-sleeve comparison above already proves the `+0.5` fiber
  term correct on its own, with no sleeve coverage or bare-cut term involved at all. The sleeveless
  overcorrection is evidence the **separate** `-2` bare-cut penalty is *also* oversized, not evidence
  against `+0.5`. See §5.

## 3. The decision rule (ratified)

```text
insulatingCreditWeight(piece):
    if thermalMaterialVerdict(piece) !== 'insulating': return 0        // unchanged
    layer = insulatingLayerMaterials(piece)                             // null | [] | [...]
    if layer is a non-empty array: return 2                             // genuine fill/construction evidence
    return 0.5                                                          // face-fabric/fiber evidence alone
```

Applies to **every category** — the outerwear-only boundary from the earlier draft is dropped.
`garmentWarmthLevel` calls this instead of its current inline
`thermalMaterialVerdict(piece) === 'insulating' ? 2 : 0`. Nothing else in the formula (`substance`,
`coverageAdjustment`, `levelForRawScore`'s boundaries) changes.

### Worked cases (from the census)

| Piece | fabric_weight | fill evidence | Credit | raw | Level |
|---|---|---|---|---|---|
| grey textured fleece (live case) | medium | `[]` (explicit) | 0.5 | 2.5 | moderate |
| grey wool black stripe knit dress (live case) | medium | `null` (unset) | 0.5 | 1.5 | moderate |
| Black puffer coat | heavy | `["down"]` | 2 (unchanged) | 5.0 | very warm |
| Charcoal ruched dress (wool, short sleeve) | medium | `null` | 0.5 | 1.5 | moderate |
| ids 363/137/265/150/220 (cotton/modal/rayon, short sleeve) | medium | n/a (`unknown` verdict) | 0 (unaffected) | 1.0 | moderate |

## 4. Non-goals

- **Not a change to `thermalMaterialVerdict`, `hasPositiveInsulatingEvidence`, or
  `outerwearLayerPositivelyInadequate`.** The first two answer "is there positive insulating
  evidence at all" (binary-ish, many consumers need exactly that). The third is a categorical
  layer-adequacy gate, a different question from graded ranking — this session's prior
  `rosterHasQualifyingWarmLayer` fix already depends on that separation staying clean. None change.
- **Not the sleeveless/bare-cut penalty.** Explicitly deferred — see §5. Do not fold a coverage-
  dependent adjustment into the fiber-credit rule to compensate for it; the two are independent
  physical signals and the short-sleeve census proves the fiber term is correct without touching it.
- **Not `outfitThermalContribution`'s body-region blindness.** A separate, larger, already-identified
  abstraction gap (a warm upper-body layer can mask an independently under-warm lower body in the
  combined `withLayer` figure) — unrelated to this fix and not addressed by it.
- **Not the `moderate`/`warm` boundary itself**, or any other `levelForRawScore` threshold.

## 5. Explicitly open, not ratified here: the sleeveless bare-cut penalty

The census's strongest candidate for the `-2` exposure-driven penalty
([garmentWarmth.js:116](../styling-engine/garmentWarmth.js)) is `-0.5`, which — combined with this
spec's `+0.5` fiber credit — would place a sleeveless wool/cashmere piece at `moderate` (`1 + 0.5 -
0.5 = 1.0`), distinctly above a hypothetical sleeveless non-insulating piece (`1 + 0 - 0.5 = 0.5 →
light`). But this wardrobe has **zero real medium-weight sleeveless or short-sleeve non-insulating**
tops/dresses/outerwear to validate that second number against — the comparison is reasoned, not
measured. This is tracked as a separate, independent follow-up calibration, to be ratified on its
own evidence rather than bundled into this implementation.

## 6. Tests

The regression invariant that protects the actual principle, not just one pinned garment:

> For otherwise comparable medium-weight, short-sleeve garments (no bare-cut penalty, no long-sleeve
> coverage bonus — both terms neutral), a piece with insulating face-fabric evidence must rank
> **above** a piece with none in raw warmth score, but must **not** by itself cross from `moderate`
> to `warm`.

Concretely:

- The five real cotton/modal/rayon short-sleeve tops (or equivalent fixtures) compute `moderate`
  (`raw 1.0`), unaffected by this change (`thermalMaterialVerdict` is `unknown`/`non_insulating` for
  all of them, never `insulating`).
- A matched medium-weight, short-sleeve wool/cashmere fixture with no recorded fill computes
  `moderate` (`raw 1.5`) — same bucket, higher raw score. Assert both the raw distance (`+0.5`
  relative to the cotton fixture) and that neither crosses into `warm`.
- The live fleece and dress fixtures both move from `warm` to `moderate` under this change.
- A genuinely filled fixture (`insulating_layer_materials` populated, e.g. `["down"]`) is
  byte-identical before and after — full `+2` credit preserved.
- A heavy-weight face-fiber-only fixture (e.g. a heavy wool coat, no separate lining) is checked
  explicitly: confirm it still reaches a sensibly warm tier from `substance(heavy)=2 + credit(0.5) +
  coverage`, not held to the same standard as a genuinely filled heavy coat — record the actual
  resulting level as a pinned fact rather than assuming it.
- `thermalMaterialVerdict`, `outerwearLayerPositivelyInadequate`, and `hasMinimumWarmLayer` outputs
  for every fixture above are asserted unchanged — this spec touches only the credit size
  `garmentWarmthLevel` applies to an existing verdict, never the verdict itself.

## 7. Acceptance criterion

A face-fabric-only insulating signal (wool, cashmere, fleece, ... with no recorded fill) contributes
a real, positive, correctly-ordered amount to a garment's warmth score — never zero, never equal to
genuine fill/construction evidence. The two-bucket inflation the census found (23 of 34 real
wardrobe pieces reaching `warm` from this signal alone) is gone; the short-sleeve invariant in §6
pins the general principle so it can't silently regress one piece at a time.
