# Spec — a category-aware hard season exclusion for trip roster selection

**Status:** Ratified 2026-09-05, ready to implement — dress hard-excluded as drafted; the outerwear
asymmetry corrected in §4 (an earlier draft stated it backwards, in terms of trip "direction" rather
than the piece's own season tag) and confirmed to match `capsuleSeasonEligiblePool`'s actual
behavior; the season-boundary-trip simplification (§5) stays explicitly out of scope. **Route:**
[docs/README.md](README.md). Extends the season axis
`seasonFitPieceAdvisory` introduced ([outfitSetPlanner.js:2698](../styling-engine/outfitSetPlanner.js))
and the owner ruling behind it. Does **not** touch capsule roster selection
(`capsuleSeasonEligiblePool`, already a hard filter — see §2) or per-outfit ranking within a slot
(`seasonFitPieceAdvisory` stays exactly as it is for every category).

## 1. The problem, evidenced

Live thread `thread_1788650429394`: "plan my outfits for a Christmas week trip to Vienna, Virginia,"
resolved to a genuine 7-day winter trip (45°F/30°F). The 14-piece trip roster included
`oatmeal textured elastic waist pants` and `taupe knit lace-up sneakers`, both tagged `season: warm`.
Both were placed in all 3 delivered cards. `seasonFitPieceAdvisory` correctly scored both
`discouraged`, but by the existing, deliberate owner ruling (docs/README.md:
`piece-season-as-weather-evidence.md`'s sibling ruling — a warm-season piece is marked, never
removed) that verdict is advisory-only, so it changed nothing.

The owner's objection is not that the advisory failed to override the model here — the ruling that
a discouraged piece can still legitimately win was made deliberately, for the *outfit-selection*
question ("is this outfit choice defensible"). The objection is at a different, earlier stage: **trip
roster selection has exactly 14 slots, chosen once for the whole trip.** A pair of pants that has no
business on a winter trip taking one of those 14 slots is not "the model can override" — it is a
roster-construction defect regardless of what the model does next, and it also inflates the number of
candidates the model has to reason about with no possible upside (per the owner: "if these items are
taking up space in the roster the model has to use... this is not a good thing").

Capsule roster selection already has a hard exclusion for exactly this failure mode
(`capsuleSeasonEligiblePool`, §2) — trip roster selection has no equivalent. This spec ports that
mechanism to trip, with one refinement capsule's own filter does not make (§3).

## 2. What capsule already does, and why it is not simply reused as-is

```js
function capsuleSeasonEligiblePool(pool, { isSummer, isWinter }) {
  if (isWinter) return pool.filter(piece => seasonOf(piece) !== 'warm')
  if (isSummer) return pool.filter(piece => !['cool','cold'].includes(seasonOf(piece)) || wardrobeCategoryGroup(piece) === 'outerwear')
  return pool
}
```

This is **category-blind** — a winter capsule excludes a warm-tagged piece regardless of category,
tops included. That is the wrong shape to reuse directly, per the owner's own clarification this
session: the "don't throw away light items" instruction was specifically about pieces that can serve
as **an indoor base layer under something warmer** — a sleeveless top under a sweater or cardigan —
never about bottoms or shoes, which have no equivalent indoor role. Capsule's blanket exclusion
already over-reaches on tops; it is not extended here, only trip gets its own, narrower version.

## 3. Non-goals

- **Not a change to `seasonFitPieceAdvisory` or its ranking role.** Every category still gets the
  existing advisory nudge during per-slot piece ordering (`rosterFitScore`) and the existing
  `piece_assessments` disclosure to the model. This spec only removes certain pieces from the trip
  roster **candidate pool**, before that ranking ever runs.
- **Not a change to capsule.** `capsuleSeasonEligiblePool` is unmodified. If its category-blind
  shape is also wrong, that is a separate finding requiring its own owner ruling — out of scope here.
- **Not a per-outfit gate.** `evaluateOutfitEnvironmentalAdequacy` gains no new hard finding. A piece
  that makes it into the roster (because it wasn't excluded, or because it's a top) is still only
  ever advisory at the outfit level, exactly as ruled.
- **Not a general "layerable" ontology.** This does not attempt to determine which specific tops are
  *good* indoor base layers (sleeve length, opacity, etc.) — it exempts the whole `top` category from
  the hard exclusion, the same coarse granularity `wardrobeCategoryGroup` already uses everywhere
  else in this file. A future refinement narrowing "top" further is a separate, later question.
- **Not a cocktail-dress-style exception for `dress`.** The owner's own earlier framing floated dress
  as a possible rare exception ("maybe an open cocktail dress"); this spec does not build that
  carve-out — §4 hard-excludes `dress` along with `bottom`/`shoes`/`outerwear`. A dress-specific
  exception, if wanted, is a deliberately separate, later ruling, not a default assumption here.

## 4. The decision rule

Stated entirely in terms of **the piece's own season tag**, never "which direction the trip runs" —
that framing is what produced the inverted, backwards-sounding draft this revision replaces. The
question for every piece is always the same: *does this piece's own season tag make it wrong for
this trip, and if so, does its category give it another plausible job anyway?*

```text
tripSeasonEligiblePool(pool, calendarSeason):
    for each piece in pool:
        mismatched = piece.season is set, not 'year-round',
                     and equals OUT_OF_SEASON[calendarSeason]
        if not mismatched:
            keep piece  (identical test seasonFitPieceAdvisory already uses — one shared mapping)
        else if wardrobeCategoryGroup(piece) == 'top':
            keep piece  (may serve as an indoor base layer under a warmer layer)
        else if wardrobeCategoryGroup(piece) == 'outerwear' and piece.season != 'warm':
            keep piece  (a piece tagged for COOL/COLD weather may still be the one thing warm
                         enough for an unexpectedly cold day or evening, on ANY trip — the same
                         plausible job capsule's own summer exemption already grants it)
        else:
            exclude piece  (bottom / shoes / dress / any WARM-tagged outerwear)
```

Put plainly: **a piece tagged for warm weather (`season: 'warm'`) is excluded from a trip where warm
is the wrong season, in every category except `top`** — a warm-tagged blazer is exactly as useless on
a cold trip as a warm-tagged pair of pants, because "warm-season" describes lightweight, low-warmth
construction, not insulation. **A piece tagged for cool/cold weather is never excluded when it's
`outerwear`**, on any trip, because a genuine cold-weather layer can always plausibly be needed for
one unexpectedly cold moment — the one asymmetry this spec keeps, and it runs in the opposite
direction from what an earlier draft of this spec said.

`OUT_OF_SEASON` is the exact existing map at
[outfitSetPlanner.js:2692](../styling-engine/outfitSetPlanner.js) (`fall→warm, winter→warm,
summer→cool, spring→cold`) — one definition of "which season tag is wrong for which calendar
season," shared by the advisory (all categories, ranking-only) and this new hard filter.

### Worked cases

| Piece | Category | season tag | Calendar | Result |
|---|---|---|---|---|
| oatmeal elastic-waist pants | bottom | warm | winter | **excluded** — warm-tagged, wrong category for the top exemption |
| taupe knit lace-up sneakers | shoes | warm | winter | **excluded** |
| a warm-season sleeveless top | top | warm | winter | kept — advisory-only, may layer indoors |
| a warm-season sundress | dress | warm | winter | **excluded** (§3: no dress exception) |
| a summer linen blazer | outerwear | warm | winter | **excluded** — warm-tagged outerwear has no job on a cold trip |
| a cool-season cardigan | outerwear | cool | summer | **kept** — cool/cold-tagged outerwear is never excluded, any trip |
| a heavy wool coat | outerwear | cold | spring | **kept** — same rule, cold-tagged, not warm-tagged |
| a wool sweater | top | year-round | winter | kept — not mismatched at all |

## 5. Where this plugs in, and the one open timing question

`buildTripBench` ([outfitSetPlanner.js:3696](../styling-engine/outfitSetPlanner.js)) currently calls
`capsulePiecesEligibleForAnySlot(pool, slots, {})` with no season filtering at all. This spec adds
`tripSeasonEligiblePool` as a filter on `pool` before that call, mirroring exactly where
`selectCapsuleRoster` applies `capsuleSeasonEligiblePool` (§2) before its own eligibility filter.

**Open question for ratification:** by the time `buildTripBench`/`selectTripRosterViaModel` run
(inside `buildPlanSlotWorkbench`), each slot already carries its own resolved
`slot.stylingContext.calendarSeason` (the per-slot loop that resolves it runs earlier in the same
function). A trip roster is chosen ONCE for the whole trip, not per slot, so this spec proposes using
**the first slot's resolved `calendarSeason`** as representative for the whole roster pool — correct
for the overwhelming majority of trips (one contiguous date range), and a known, documented
simplification for the rare trip whose slots span a season boundary (e.g. late-Feb into March). That
edge case is not solved here; flag if it needs to be.

## 6. What must not change

`seasonFitPieceAdvisory` (ranking-only role, every category, unchanged), capsule roster selection
(§2, untouched), `evaluateOutfitEnvironmentalAdequacy` (no new finding), per-outfit `piece_assessments`
disclosure to the model (unchanged — the model still sees raw facts for whatever survives the pool
filter), and every non-trip caller of any function this touches.

## 7. Tests

Through the real trip path (`buildTripBench` / `selectTripRosterViaModel` / `buildPlanSlotWorkbench`):

- The exact live-thread shape: a winter trip's candidate pool containing a warm-tagged bottom and a
  warm-tagged shoe never reaches the roster, even when they are the only bottom/shoe options in the
  pool that would otherwise be gate-eligible (roster selection must degrade honestly — e.g. surface a
  coverage gap — rather than silently leaving a use case unfillable).
- A warm-tagged top in the same winter trip IS still eligible for the roster (and still carries the
  existing `discouraged` advisory in `piece_assessments` once selected).
- A warm-tagged dress and a warm-tagged outerwear piece are excluded on a winter trip; a cool-tagged
  outerwear piece is NOT excluded on a summer trip (the asymmetry in §4's last worked case).
- A year-round-tagged piece of any category is never excluded, on any trip.
- An all-indoor or otherwise season-neutral trip (`calendarSeason` unresolved/empty) excludes nothing
  — identical to `seasonFitPieceAdvisory`'s own existing `!calendar` early return.
- Capsule roster selection tests are unaffected — this spec touches no capsule code path.

## 8. Acceptance criterion

A trip's roster never spends one of its scarce slots on a bottom, pair of shoes, dress, or
season-mismatched outerwear piece that has no plausible job on that trip, while a season-mismatched
top remains eligible on the understanding that it may serve as an indoor layering piece — matching
the owner's own stated distinction exactly, not a blanket "keep light things" or "remove light
things" rule.
