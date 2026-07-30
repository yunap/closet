# Capsule wardrobe rules — what the established frameworks actually say

> **Start at [capsule-index-and-plan.md](capsule-index-and-plan.md)** — the map of every capsule
> document, the live-run findings, and the sequenced plan. This document is one piece of that.


Researched 2026-07-30. Every citation below is linked; nothing in this document is
inferred from the engine's own behaviour.

## Why this document exists

`capsuleQuotas` in `styling-engine/outfitSetPlanner.js` decides how many tops, bottoms,
dresses, outerwear pieces and shoes a capsule gets. **Every one of those numbers was
invented in code**, each with a plausible-sounding comment attached. None traces to a
ratified rule, an owner ruling, or an external source:

- the ratified Style Constitution contains **zero** mentions of `capsule`, `outerwear` or `quota`
- `docs/capsule-roster-selection-spec.md` justifies no category figure
- the owner's own confirmed-outfit history is too thin to derive one (1 of 5 warm-season
  confirmed outfits includes outerwear — n=5)

The owner's question was the right one: *"why are we guessing? shouldn't there be a rule
around this? we are not inventing the capsules."* There are rules. They are quantitative,
widely published, and they converge. This document records them so the next person
changing a quota argues with a source instead of a comment.

### Relationship to the earlier research pass

`docs/stylist-bugfix-spec.md` → "Research done 2026-07-25 — what the capsule number should be"
covers a **different axis**: how many *looks* an N-piece capsule should promise, answered mostly
by measuring this engine's own combinatorial capacity. It is not superseded by this document, and
this document does not revisit the outfit cap.

Two things about it are worth noting here. It concerns the plan's output, not the roster's
category composition — so no figure in it constrains `capsuleQuotas`. And its "published
practice" strand **cites no external source**; the file contains no URL. The capacity table in it
is solid measurement; the practice claim beside it is the same kind of unsourced assertion this
document exists to replace.

## The frameworks

| framework | total | tops | bottoms | dresses | layers/outerwear | shoes | notes |
|---|---|---|---|---|---|---|---|
| [Project 333](https://bemorewithless.com/project-333-challenge/) | 33 | — | — | — | counted in total | counted in total | Courtney Carver, 2010. No category split — 33 items for 3 months, **including** shoes, outerwear, accessories and jewellery. Excludes underwear, sleepwear, in-home loungewear, workout clothes. The most widely referenced framework by name. |
| [Un-Fancy 37-piece](https://www.un-fancy.com/capsule-wardrobe-101/how-to-build-a-capsule-wardrobe/) | 37 | 15 | 9 | 2 | **2** jackets/coats | 9 | Caroline Rector. The most-copied *category breakdown*. |
| [37-piece, as restated elsewhere](https://theeleganceedit.com/capsule-wardrobe-formula-guide/) | 37 | 15 | 9 | 2 | **4** layers | 4 | Same total, same tops/bottoms/dresses, but 4 layers + 4 shoes + 3 wildcards instead of 2 jackets + 9 shoes. **The sources disagree** — see caveat below. |
| [24-piece summer](https://capsulewardrobestyle.com/summer-capsule-wardrobe/) | 24 | 8 | 4 | 3 | **2** layering items | 4 | Plus 3 accessories. Directly comparable to this app's default `piece_budget` of 24. |
| [20-piece](https://theeleganceedit.com/capsule-wardrobe-formula-guide/) | 20 | 5 | 5 | 1 | **4** layers | 3 | Plus 2 "completer" accessories. |
| [30–40 piece range](https://modernminimalism.com/how-to-build-a-capsule-wardrobe/) | 30–40 | 8–10 | 5–6 | 2–3 | 3–5 sweaters/cardigans | 3–4 | The most commonly cited *range* rather than a fixed number. |

## What the frameworks agree on

These hold across sources that otherwise disagree about totals.

### 1. A summer capsule carries two layers — never zero

> "Even in summer, evenings cool down and over air-conditioned restaurants exist, so two
> layers are enough."
> — [Hey Shannon Lee, *The Only Summer Layers You'll Need*](https://www.heyshannonlee.com/blogs/the-only-summer-layers-youll-need-for-your-capsule-wardrobe-pkbgl-p2bsh)

The canonical pair is a denim jacket plus a lightweight cardigan or knit. The 24-piece
summer capsule allots exactly 2 layering items.

**No source treats summer as a no-layer season.** The stated reasons are air conditioning
and evening temperature drop — both of which apply to a capsule that has to cover whole
days.

### 2. Outerwear count is season-invariant; the *pieces* change, not the *number*

Un-Fancy applies the same 37-piece framework year round and swaps which outerwear is
active — a wool coat goes into under-bed storage in summer, a lightweight layer takes its
place. The allocation stays at 2.

This is the single most important finding for this engine: **season should decide which
outerwear qualifies, never how many.**

### 3. Roughly 3 tops per bottom

> "A 3:1 ratio of tops to bottoms is generally recommended… tops endure more wear and are
> closer to your face… while pants and skirts can be repeated more frequently without
> anyone noticing."
> — [The Belle Voyage](https://www.thebellevoyage.com/travel-capsule-wardrobe/)

Also stated as a "golden ratio" of one waist piece per three to five shoulder pieces
([MioLook](https://miolook.com/en/wardrobe-tops-bottoms-ratio)). The published breakdowns
bear it out: 15:9 (1.7:1), 8:4 (2:1), 8–10:5–6 (~1.7:1).

The rationale given is combinatorial, and it matches what this engine measures as outfit
cores: tops create the visible variety, bottoms recur unnoticed.

### 4. Shoes cluster at 3–4 for a 20–40 piece capsule

The 24-piece summer capsule and the 30–40 range both land at 3–4. Un-Fancy's 9 is the
outlier, and it is the figure the other retelling of the same 37-piece framework replaces
with 4.

### 5. Dresses: 2–3, and they count as a whole outfit

Every breakdown that lists dresses separately allots 2–3, treating a dress as a complete
core rather than as a top-equivalent.

## How this app's quotas compare

`capsuleQuotas(24, { isSummer: true })` currently returns:

| | this engine (budget 24) | 24-piece summer framework | published tops:bottoms |
|---|---|---|---|
| tops | 10 | 8 | |
| bottoms | 9 | 4 | |
| dresses | 1 | 3 | |
| outerwear | **0** | **2** | |
| shoes | 4 | 4 | |
| tops:bottoms ratio | **1.1 : 1** | 2 : 1 | 3 : 1 recommended |

Two clear divergences:

1. **Summer outerwear is zeroed.** `outerwear = isWinter && budget >= 12 ? 2 : (budget >= 8 && (!isSummer || budget < 12) ? 1 : 0)` — for a summer capsule at any budget this
   evaluates to 0. No framework supports it. The winter special-case for `2` is, per
   finding 2 above, simply the correct number for every season.
2. **Bottoms are over-allocated.** At 1.1:1 the engine buys roughly three times the
   bottoms the conventions call for, at the direct expense of the tops that generate
   outfit variety.

Measured consequence, from live thread `thread_1785380251549`: reallocating three slots
(two unused outerwear pieces and one accessory) into tops took the same roster from **45
to 63 outfit cores, +40%** — with no change to any other rule.

## Implementation status, 2026-07-30

| finding | status |
|---|---|
| summer outerwear zeroed | **fixed** — season conditional removed, `budget >= 12 ? 2 : budget >= 8 ? 1 : 0` |
| no category ceilings, only floors | **fixed** — `maximum` post-conditions, declared for outerwear |
| dresses 1 vs published 2–3 | **fixed** — `budget >= 24 ? 3 : budget >= 12 ? 2 : budget >= 6 ? 1 : 0` |
| tops:bottoms 1.1:1 vs published 3:1 | **attempted and held — see below** |

### Why the tops:bottoms ratio was not changed

Implemented as `remaining * 0.35` (giving ~1.9:1, the observed breakdown ratio), measured, and
reverted. Two reasons, both discovered by measurement rather than argument:

**1. The published ratio does not maximise combinations — it trades them away deliberately.**
For a fixed number of top+bottom slots, distinct top×bottom pairs are maximised when the two are
*equal*; skewing toward tops necessarily reduces them. Measured on the live plan's own slots at
budget 24, moving to 1.9:1 took capacity from **79 cores to 53**. The frameworks are not making a
combinatorial claim: their argument is perceptual — a repeated bottom goes unnoticed while a
repeated top does not. That is a real claim about how outfits are *read*, but it is not the claim
this engine's core-capacity metric measures, and the two genuinely conflict.

(Note for anyone reading an earlier version of this analysis: the +40% figure below comes from
*adding* three garment slots that were being wasted on unused layers and an accessory. It does
**not** transfer to rebalancing tops against bottoms at a fixed total, which moves capacity the
other way. Those are different operations and were briefly conflated.)

**2. It broke a ratified guarantee.** With bottoms cut to ~35% of the discretionary remainder, a
mixed-register winter plan came back with two bottoms, neither elevated, and lost the evening
separates path that `capsuleDemandReserve` exists to protect (`test/plan_outfit_set.test.js` →
"mixed winter capsule preserves an evening separates path"). The register reserve needs bottoms at
more than one register tier; a flat ratio is blind to that.

**What a correct version would need:** the ratio should apply to the *discretionary* remainder,
after the plan's reserved register demands are satisfied — which means `capsuleQuotas` would need
the plan's slots, which it does not currently receive. That is a real design change, not a
constant. Until then the ratio stays at 0.45.

**One live defect was surfaced by the attempt and has been fixed independently:** giving the
selector more top slots let a cool-season piece into a summer roster, exposing that season
filtering was asymmetric — winter excluded warm-season pieces, summer excluded nothing. See
`capsuleSeasonEligiblePool`. The fix is deliberately not a mirror rule; a blanket summer exclusion
would have removed the lightweight jacket that this document's own layer research says a summer
capsule needs.

## Caveats — read before citing this document

- **These are practitioner frameworks, not a standard.** They are style writers and
  wardrobe consultants, consistent with one another but not authoritative in the way a
  specification is. Treat convergence across independent sources as the evidence, not any
  single page.
- **The sources disagree about the 37-piece split.** Un-Fancy's own page says 2 jackets
  and 9 shoes; a widely-copied restatement says 4 layers and 4 shoes. Both sum to 37. The
  disagreement is recorded above rather than resolved.
- **They count accessories; this engine deliberately does not.** Project 333 counts
  jewellery and bags toward the total. This app's capsule composition prompt forbids
  accessories in a look, so accessories are excluded from the bench entirely — a
  framework total therefore is not directly comparable to a `piece_budget`.
- **They assume curation, not composition.** These frameworks tell a person what to buy
  or keep. This engine selects from a closet that already exists and may be unbalanced —
  a ratio the frameworks treat as a shopping target is, here, a preference that has to
  yield when the wardrobe cannot supply it.
- **Climate qualifies the layer count, not the principle.** Portland-specific sources note
  evenings falling to the mid-50s even after the warmest days and recommend one to two
  light layers ([Oregon Essential](https://oregonessential.com/what-to-pack-portland-oregon/),
  [The Mom Edit](https://themomedit.com/vacation-packing-list-portland-oregon-in-summer/)).
  That is consistent with the general figure of 2, not an exception to it.

## Sources

- [Project 333 Challenge — Be More with Less](https://bemorewithless.com/project-333-challenge/)
- [Un-Fancy — How to build a capsule wardrobe](https://www.un-fancy.com/capsule-wardrobe-101/how-to-build-a-capsule-wardrobe/)
- [Summer Capsule Wardrobe 2026: The Only 24 Pieces You Need](https://capsulewardrobestyle.com/summer-capsule-wardrobe/)
- [3 Capsule Wardrobe Formulas & How to Use Them — The Elegance Edit](https://theeleganceedit.com/capsule-wardrobe-formula-guide/)
- [The Only Summer Layers You'll Need — Hey Shannon Lee](https://www.heyshannonlee.com/blogs/the-only-summer-layers-youll-need-for-your-capsule-wardrobe-pkbgl-p2bsh)
- [How I Build My Summer Capsule Wardrobe — Modern Minimalism](https://modernminimalism.com/how-to-build-a-capsule-wardrobe/)
- [How to Create the Perfect Travel Capsule Wardrobe — The Belle Voyage](https://www.thebellevoyage.com/travel-capsule-wardrobe/)
- [The perfect balance of tops and bottoms — MioLook](https://miolook.com/en/wardrobe-tops-bottoms-ratio)
- [What to Pack for Portland, Oregon](https://oregonessential.com/what-to-pack-portland-oregon/)
- [Packing List: Visiting Portland in Summer — The Mom Edit](https://themomedit.com/vacation-packing-list-portland-oregon-in-summer/)
