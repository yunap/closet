# Question — should `piece.season` be weather evidence?

**Status:** Open question, 2026-09-01. Not implemented. Needs an owner ruling.
**Route:** [docs/README.md](README.md). Raised by the tier split in
[outerwear-weather-consolidation-spec.md](outerwear-weather-consolidation-spec.md) Appendix K.

## The observation

A live trip card, *"Trail Tee, Pants & Puffer"*, paired a warm-season tee and warm-season track
pants under a winter puffer:

```text
990356  cream botanical print t-shirt    fabric_weight light   season warm    cold  -8
990359  black drawstring pocketed pants  fabric_weight light   season warm    cold  -2
996775  Black puffer coat                fabric_weight heavy   season cool    cold  14
```

Both base pieces are tagged **`season: warm`**. The outer layer is tagged **`season: cool`**. The
incoherence is stated plainly in the stored data — and **nothing in the weather path reads
`piece.season`.** The shortfall was caught only indirectly, through `fabric_weight` feeding the
thermal score.

## What already covers part of it

The Appendix K tier split now hard-fails this specific card, because every base piece is thermally
tagged and the total falls below the severe-cold floor. So the *thermal* half is handled by
`fabric_weight`, `fiber_content` and coverage — the evidence the graded model was built on.

`piece.season` would add something different: a **wearer-intent** signal. "I think of this as a
summer garment" is not the same claim as "this fabric is light", and the two can disagree — a light
merino base layer is summer-weight and winter-appropriate; a heavy velvet dress is warm and
summer-evening.

## Why it is not obviously a good idea

1. **It is a different KIND of evidence.** Everything the thermal model reads is a physical property
   of the garment. `season` is a styling/occasion judgment. Mixing them means a gate can reject a
   physically appropriate garment because of how the owner files it.
2. **The vocabulary is coarse.** `warm` / `cool` / `year-round` (and per-piece free text in places)
   cannot distinguish "too light for this" from "wrong register for this".
3. **It duplicates a signal that is already better measured.** For the thermal question specifically,
   `fabric_weight` + fiber + coverage is strictly more informative than a season word.
4. **Precedent.** [outerwear-weather-capability-spec.md](outerwear-weather-capability-spec.md) §6.5
   refused an all-purpose `weather_suitability` tag for exactly this reason: garment type, thermal
   behaviour, coverage and function stay separate fields, combined at decision time. A season word
   used as thermal evidence walks that back.

## Why it might still be right

A season tag catches cases the thermal model cannot see. A linen shirt and a cotton poplin shirt can
score identically on weight and fiber while one is unmistakably summer clothing. And unlike the
fabric-technician distinctions rejected elsewhere, **`season` is a question the owner can already
answer and has already answered** — it is an existing, populated, user-editable field, not a new
burden.

## The narrow version, if the answer is yes

Do **not** feed `season` into `pieceWeatherScores`. That would blend intent into a physical model and
change every consumer of the graded score at once.

Instead use it only where intent is the actual question — as **corroboration inside Contract C**,
where a severe-cold shortfall is already being decided:

```text
base layers all tagged `season: warm`  +  resolved severe cold
  → strengthens an existing shortfall finding; never creates one on its own
```

That keeps the physical model untouched, and keeps `season` from ever excluding a garment by itself.

## Ruling needed

1. Leave `piece.season` out of the weather path entirely (status quo; the tier split already covers
   the observed card).
2. Use it as corroboration inside Contract C only, per the narrow version above.
3. Something else.

Recorded now so the next person finds the reasoning rather than re-deriving it — this is the third
time in one arc that a field which *looks* like weather evidence turned out to need its own
decision, after `outerwear_role` and footwear lining.
