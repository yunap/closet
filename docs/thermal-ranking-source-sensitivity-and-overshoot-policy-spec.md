# Spec — a shared, raw-score-aware, overshoot-weighted thermal ranking primitive

**Status:** Ratified and implemented 2026-09-06. **Route:** [docs/README.md](README.md). Extends
[source-sensitive-insulating-credit-spec.md](source-sensitive-insulating-credit-spec.md), whose
fiber-credit fix regressed the pinned Vienna incident test (`thermalRankingMigration.test.js`) by
collapsing two previously-distinct thermal levels into one bucket. Does **not** touch
`compareThermalFit`'s `fit`/`steps`/`distance` (adequacy classification, range-tolerant, unchanged)
or `garmentWarmthLevel` (the model-facing named scale, unchanged).

## 1. The problem, evidenced

The fiber-credit fix correctly moved a wool cardigan from `warm` to `moderate`. Two ranking
consumers read `garmentWarmthLevel` through `compareThermalFit`'s bucket-index `distance`, and both
broke:

- **Vienna 65/47°F** (`thermalRankingMigration.test.js`, the founding incident this whole arc traced
  back to): the cardigan (`moderate`, one bucket below the `warm` demand) and a down puffer
  (`very warm`, one bucket above) now sit at the same `|distance|` in opposite directions and score
  identically — reopening the exact "puffer ranks like anything else" failure the arc exists to fix,
  from the opposite side.
- **Genuinely cold 30/20°F**: the cardigan and a plain, unlined cotton jacket both now read
  `moderate`, tying two garments the ranking is supposed to tell apart.

Also found: **two independently-drifting scoring implementations** — `weatherFitForPiece`
(rules.js) with a symmetric `4 - 4·|distance|` formula, and `buildVisualComposerRoster`'s inline
scoring with its own, differently-shaped asymmetry (flat undershoot penalty for bottom/dress only,
magnitude-scaled overshoot penalty). Fixing one would not have fixed the other.

## 2. Non-goals

- **Not another face-fiber coefficient search.** The `+0.5` credit is ratified
  ([source-sensitive-insulating-credit-spec.md](source-sensitive-insulating-credit-spec.md)); this
  spec fixes the ranking layer that consumes its output, not the credit itself.
- **Not a change to adequacy classification.** `compareThermalFit`'s `fit`/`steps`/`distance` are
  untouched, range-tolerant exactly as before. A hard adequacy gate reading them never sees anything
  new. The overshoot-ranking-weight is a ranking preference, applied to a new, separate `offset`
  field only — never a claim that an overshooting garment is inadequate (§5.5's "overshoot ranks,
  never excludes" is unchanged).
- **Not "closest raw numeric score wins."** `offset` is still anchored to the discrete level system
  at every step — measured from `demand.level`'s own raw interval/center, itself derived from
  `garmentWarmthLevel`'s boundaries. It refines the existing bucket-index distance; it does not
  replace it with an unconstrained continuous comparison.
- **Not new numeric distance beyond the verified range.** `very light`/`very warm` stay exactly what
  `levelForRawScore` says they are: unanchored ordinal extensions with no numeric distance claimed
  beyond the verified range (§4.3.1's mid-implementation finding — an early draft violated this and
  was caught before merge).

## 3. The decision: `garmentWarmthScore` + `thermalRankingFit`

**`garmentWarmthScore(piece)`** (`garmentWarmth.js`): the raw calculation extracted verbatim from
`garmentWarmthLevel`, which now just maps it through `levelForRawScore`'s boundaries
(`LEVEL_RAW_BOUNDARIES`, also newly exported so `thermalDemand.js` shares the exact numbers rather
than a second, drifting copy). Never exposed to the model — named levels stay the only model-facing
representation, unchanged from before.

**`thermalRankingFit(garmentLevel, garmentScore, demand)`** (`thermalDemand.js`): calls
`compareThermalFit` internally (adequacy classification, unchanged) and adds one new field, `offset`
— a signed, continuous, overshoot-weighted ranking distance, replacing bare `distance` for every
ranking consumer.

```text
target = the raw interval for demand.level (NOT demand.range — see §4.1)

if garmentScore < target.low:   raw = garmentScore - target.low         (undershoot, real anchored edge)
if garmentScore > target.high:  raw = garmentScore - target.high        (overshoot, real anchored edge)
else (garment is inside demand.level's own bucket):
    center = rawCenterForLevel(demand.level)                            (null for very light/very warm)
    raw = center === null ? 0 : garmentScore - center

offset = raw > 0 ? raw * OVERSHOOT_RANKING_WEIGHT(1.5) : raw
```

Both `weatherFitForPiece` (rules.js) and `buildVisualComposerRoster`'s inline scoring now call this
one function instead of `compareThermalFit` directly, reading `.offset` where they previously read
`.distance` — the consolidation. `buildVisualComposerRoster` keeps its own, pre-existing,
independently-justified rules on top (undershoot penalized only for bottom/dress, its own magnitude
scaling for overshoot) — those are a separate, deliberate product decision (`"a light top gets
layered over"`) predating this spec, not touched here.

## 4. Two bugs found and fixed during implementation, not before

Both were caught by the pinned regression tests themselves, before merge — recorded here so the
reasoning isn't lost.

### 4.1 — Measuring against `demand.range` instead of `demand.level`

First implementation measured `offset` against `demand.range`'s edges (the uncertainty-widened
tolerance `fit` already checks). At Vienna 65/47°F, weather is coarse enough that
`range = ['moderate', 'very warm']` — three levels wide — so both the cardigan and the puffer fell
*inside* it and both read `offset: 0`. This is the exact distinction `compareThermalFit`'s own
pre-existing comment already draws between `fit` (validity, range-based) and `distance` (preference,
level-based) — `offset` needed to inherit `distance`'s convention, not `fit`'s. Fixed by measuring
against `demand.level`'s own raw interval/center, never `demand.range`.

### 4.2 — Inventing a center for the unanchored extremes

Second implementation gave `very light`/`very warm` a nominal center (borrowing the adjacent
bucket's width), reasoning that leaving them at `offset: 0` unconditionally would just push the
tie further out. This reopened `thread_1788050815289`: a down puffer (`very warm`, raw `4.5`) scored
against a `very warm` demand landed *below* the invented nominal center (`4.75`), reading as a
spurious tiny undershoot and losing the "well matched" credit a clean, dead-on match deserves.
`levelForRawScore`'s own comment already forbids this ("no numeric distance above the verified
range") — the fix was to listen to it: `rawCenterForLevel` returns `null` for these two levels, and
`thermalRankingFit` leaves `offset` at exactly `0` for a garment sharing that same unanchored bucket
with the demand, rather than measuring it against a fabricated position. Undershoot/overshoot
*approaching* `very light`/`very warm` from the anchored side still works normally — only the
inside-the-same-unanchored-bucket case is left undifferentiated.

## 5. Worked cases (all pinned as tests)

| Scenario | Garments | Result |
|---|---|---|
| Vienna 65/47°F, no exposure | cardigan (`moderate`) vs. puffer (`very warm`) | cardigan outranks puffer — equal bucket-distance, opposite direction, overshoot weighted more |
| Vienna 65/47°F, museum exposure | lightJacket vs. cardigan, both land in the demand's own target bucket | lightJacket outranks cardigan — same-bucket refinement by distance from the target's center |
| Genuinely cold 30/20°F | cardigan (`moderate`) vs. lightJacket (`moderate`) | cardigan outranks lightJacket — same-bucket refinement, undershoot direction |
| Severe cold 30/20°F | down puffer (`very warm`) vs. `very warm` demand | reads as a clean, undifferentiated match — no spurious undershoot from an invented center |
| Isolated asymmetry check | two synthetic pieces at equal raw distance either side of a `moderate` demand's center | undershoot outranks overshoot, with every other adjustment (isHot/isCold/fabric-mass) held constant |
| Excessive undershoot / excessive overshoot | a very-light piece in genuinely cold conditions; a down puffer in genuinely hot conditions | both floor at the same magnitude (`-8`); neither direction escapes the floor or silently wins by clamping first |

## 6. What must not change

`compareThermalFit`'s exported `fit`/`steps`/`distance` (byte-identical for every existing caller
that doesn't read `.offset`). `garmentWarmthLevel`'s output for every piece (verified — the
extraction into `garmentWarmthScore` is behavior-preserving, confirmed by the full pre-existing
`garmentWarmth.test.js` suite passing unchanged before any ranking work began).
`buildVisualComposerRoster`'s bottom/dress-only undershoot carve-out. Every non-ranking consumer of
`requiredThermalBand`/`compareThermalFit`.

## 7. Acceptance criterion

A wool cardigan and a plain cotton jacket that share a named warmth bucket still rank apart by their
real, underlying warmth. A garment that is too warm for the conditions ranks below one that is
comparably too light, at equal raw distance from the target — a ranking preference, not an adequacy
judgment. Neither correction invents numeric precision the underlying ordinal scale doesn't support,
and the two independently-drifting ranking formulas this session found are now one.
