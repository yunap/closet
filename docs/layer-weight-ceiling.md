# Findings — every weather tier is a floor; nothing is a ceiling

**Status:** Diagnosed 2026-09-01, not implemented. Needs an owner ruling (§6).
**Route:** [docs/README.md](README.md). Sits alongside
[cool-weather-tier-spec.md](cool-weather-tier-spec.md) and
[cold-severity-spec.md](cold-severity-spec.md), whose thresholds this does not change.

## 1. The observation

Across five runs of the same week-long October trip prompt (65°F highs, mid-40s lows), one garment
keeps appearing where it does not belong — a **black puffer coat**, on museum days and city
sightseeing:

```text
07:18  65/45  severe=true    puffer in 5/5 cards
07:54  65/48  severe=false   puffer in 1/6
08:51  68/45  severe=false   puffer in 4/10
09:09  65/48  severe=false   puffer in 0/4
09:36  65/45  severe=false   puffer in 3/6
```

The first row was a gate defect and is fixed: severity inherited `isCold` from the low, so the
heavy-fabric `+10` relevance bonus ranked the puffer top for every slot
([cold-severity-spec.md](cold-severity-spec.md)'s amendment). **Every row after it is not a gate
defect.** `isColdSevere` is false, no bonus fires, nothing requires a coat. The model simply chooses
the warmest layer available, and nothing objects.

The owner has raised it in three separate threads.

## 2. Why nothing objects

Every weather requirement built in this arc is a **floor**:

| Tier | Requirement | Direction |
|---|---|---|
| `needsRemovableCoolLayer` | a layer that is not see-through | at least |
| `isCold` minimum-warmth floor | a layer, or a heavy main | at least |
| `isColdSevere` | an outdoor-capable layer, adequate system warmth | at least |

A puffer satisfies all three **maximally**. There is no rule anywhere that says a garment can be
*too warm* for cool weather, so the safest-scoring choice for any cold-ish context is always the
heaviest coat owned.

## 3. The architecture already has this concept — on one side only

Heat has a real ceiling. `hotWeatherInsulationReason` (`styling-engine/rules.js`) **excludes** pieces
for being too warm:

```text
hot weather: insulating fiber      wool/fleece/down, at any weight above light
hot weather: insulating piece      heavy fabric_weight on a main
```

and the planner has `extremeHeatPieceAdvisory` — *"too warm to solve extreme-heat transit; use only a
light removable AC layer"*.

So the engine can say "this garment is too warm for these conditions". It only ever says it about
**heat**. Cool and cold have floors and no ceiling, which is the asymmetry this document is about.

## 4. Why it is not simply a model-behaviour problem

It is tempting to call this a prompt issue. Two reasons not to:

1. **It survives a provider change.** The pattern appears on both `gemini-3.5-flash-lite` and
   `claude-sonnet-4-6` runs of the same prompt.
2. **The model is answering the question the engine asks.** Every signal it receives about cool
   weather is a minimum. Given "you need a layer" and no upper bound, the warmest layer is the most
   defensible answer — it maximally satisfies the only constraint stated. The engine is getting what
   it asked for.

This is the same shape as the incident that produced `isColdSevere` in the first place — *"why did
you suggest a winter coat for a summer chilly evening?"* — arriving this time through the model's own
preference rather than through a relevance score.

## 5. What a ceiling would have to avoid

The failure mode of a naive fix is worse than the defect:

* **It must not exclude the puffer from cold days.** A ceiling keyed on the wrong signal turns a
  wardrobe's only winter coat into an unusable piece.
* **It must not fire on supply-poor wardrobes.** A user whose only outer layer is a heavy coat must
  still be dressed. Scarcity belongs to the disclosed-shortfall path, not to a rule that removes
  their sole option — the lesson from the mesh footwear ruling.
* **It must not become a fourth threshold.** This arc has already walked back three.
* **It must not read `season`.** [piece-season-as-weather-evidence.md](piece-season-as-weather-evidence.md)
  fixed `season` as corroboration-only; a ceiling that excluded a `season: cool` coat from a 65°F day
  would make wearer intent a physical gate.

## 6. Options

1. **Do nothing.** It is a comfort/taste complaint, not a correctness one; no card is *invalid*.
   Worth stating explicitly so it is a decision rather than a default.
2. **Advisory only** — when the resolved context is cool-but-not-severe and the chosen layer is a
   `cold_weather_outerwear` role or heavy weight, annotate the card ("warmer than this day needs")
   without rejecting it. Cheap, visible, no supply risk, and it tells the model something it
   currently never hears.
3. **Ranking, not gating** — the mirror of the `+10` heavy-fabric bonus: a small penalty for
   heavy outerwear when `isColdSevere` is false, so a transition layer outranks a puffer without
   either being excluded. Closest to how the hot side actually behaves, and invisible when the
   wardrobe has nothing lighter.
4. **A hard ceiling** — exclude `cold_weather_outerwear` in cool-but-not-cold contexts. Simplest to
   state, worst on supply, and the option most likely to need walking back.

**Recommendation: 3, with 2 as its disclosure.** A penalty degrades gracefully when the wardrobe has
no alternative — the piece still wins if nothing else qualifies — which is exactly the property a
hard rule cannot have. The existing `+10` bonus proves the mechanism already exists and that this
scoring surface is the one the model actually responds to.

## 7. Non-goals

* No new threshold, and no change to `isCold`, `isColdSevere` or `needsRemovableCoolLayer`.
* No new user-entered field.
* Not a ceiling on base warmth — only on the outer layer. A warm base under a mild day is a different
  question, already partly covered by the hot-side rules.
