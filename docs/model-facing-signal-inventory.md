# Model-facing thermal/season/layer signal inventory

**Status:** inventory complete, **no implementation**. Owner-requested 2026-09-03 after the Vienna
runs oscillated between opposite failures. **Live spending is paused** until this is decided.

## Why this exists

Four commits on `fix/plan-roster-thermal-evidence` moved the Vienna packing plan from "down puffer on
four of six 65/48°F outfits" to "no real jacket at all on a mid-October trip". Each individual fix was
correct against its own defect. The oscillation is the finding: a system that swings between opposite
errors under correct local fixes is not miscalibrated, it is mis-layered.

Owner's diagnosis, adopted here as the frame:

> deterministic code → garment truth + environmental truth + real hard constraints
> model → styling judgment

against what we actually built:

> deterministic code → preferred/discouraged/base target/layer target/etc.
> model → try to reconcile all of it

### The demonstration case

Piece 990358, "navy technical hoodie" — a thin UPF/sun layer. Its complete stored record:

```
category            outerwear
fabric_weight       light
fabric_category     technical/performance
fiber_content       ["polyester","spandex","unknown"]
sleeve_length       long
season              year-round
weather_protection  []
reads_as            "simple technical hoodie"
```

`interior_construction` and `insulating_layer_materials` are both **absent**. The engine reads that
absence as *a little* insulation rather than *none*, places it at `light`, and on a 65°F October hike
the base demand is also `light` — so the sun hoodie comes out **`preferred`**, ahead of the trench.
Formally consistent with the scale, and obviously wrong.

The scale collapses four functionally different garments into one bucket:

| garment | coverage | insulation | protection |
|---|---|---|---|
| UPF/sun hoodie | long sleeve | **none** | none |
| thin cardigan | long sleeve | modest | none |
| wind shell | long sleeve | none | **wind** |
| light jacket | long sleeve | **real transitional warmth** | some |

**This must not be fixed with a temperature rule** ("sun hoodies cannot be used below X°F"). It is a
gap in garment truth: `insulation: none` is a fact the record cannot currently state, distinct from
"insulation: not recorded".

## The inventory

Everything below is what a model actually receives. Sources: the `plan_outfit_set` result
(`buildPlanSlotWorkbench`, `styling-engine/outfitSetPlanner.js`), `submit_plan_outfits` rejections
(`styling-engine/outfitEnvironmentalAdequacy.js`), and `search_wardrobe` results
(`styling-engine/tools.js`). Verified against the captured provider input for
`thread_1788427130315` — not read off the source alone.

Classification per the owner's three categories:
**F** = factual garment/environment evidence · **H** = true hard feasibility/safety constraint ·
**J** = derived styling judgment.

### Per-slot fields (plan workbench)

| # | signal | shape | class | note |
|---|---|---|---|---|
| 1 | `weather_used` | label string | **F** | the resolved conditions, honestly sourced |
| 2 | `calendar_season` | `fall` | **F** | a calendar fact |
| 3 | `activity` / `environment` | `hiking` / `outdoor` | **F** | |
| 4 | `thermal_demand` | `moderate (estimated exposure window)` | **J** | a target the engine computed *for* the model |
| 5 | `register_ceiling` / `register_floor` | enum | **H** | occasion feasibility, not thermal |
| 6 | `allowed_piece_ids` | ids, **thermally ordered** | **F**/**J** | membership is F (gates); *order* is J |
| 7 | `submission_requirements[]` | prose rules | mixed | itemised below |
| 8 | `suppressed_note` | counts | **F** | |
| 9 | `coverage_report` | structural | **H** | can this slot form a complete outfit |

### Per-piece assessments (`piece_assessments`, aligned to `allowed_piece_ids`)

| # | signal | values | class |
|---|---|---|---|
| 10 | `thermal_fit` | preferred/workable/neutral/discouraged | **J** |
| 11 | `season_fit` | neutral/discouraged | **J** |
| 12 | `extreme_heat` | preferred/workable/discouraged/prohibited | **J** (the `prohibited` tier alone is **H**) |
| 13 | `movement` | tiers | **J** |
| 14 | `operational_ease` | tiers | **J** |

### Shared instructions

| # | signal | class | note |
|---|---|---|---|
| 15 | tier vocabulary + "reach past `discouraged` only when…" | **J** | added 61c209a — teaches the model to obey #10–14 |
| 16 | "`discouraged` is wrong by AMOUNT; too warm is as wrong as too thin" | **J** | added 61c209a |
| 17 | "This slot's conditions call for `<level>` warmth" | **J** | added 61c209a, per slot |
| 18 | catalog line (`piece_catalog`) | **F** | itemised below |

### Validator rejections (`submit_plan_outfits`)

| # | signal | class | note |
|---|---|---|---|
| 19 | `NO_WARM_LAYER_FOR_COLD` | **H** | presence in genuine cold — the one defensible hard thermal gate |
| 20 | removable-layer requirement (`needsRemovableCoolLayer`) | **J** | keys on `lowF`; its own spec says it lost authority |
| 21 | `demandHint()` appended to #20 | **J** | |
| 22 | `THERMAL_UNDERSHOOT` / `THERMAL_OVERSHOOT` | **J** | advisory findings |
| 23 | transit-coverage requirement | **J** | parallel contract, uncalibrated (band spec §21.1) |

### Search results

| # | signal | class | note |
|---|---|---|---|
| 24 | `weatherFit` label + `weatherFitScore` | **J** | |
| 25 | tool description: "Each result carries a weatherFit… **honour them**" | **J** | instructs obedience to a judgment |

## Finding 1 — the ratio is inverted

**19 of 25 model-facing signals are derived styling judgments. The garment thermal facts behind them
are not in the payload at all.**

`planWorkbenchPieceLine` — the only per-piece fact channel — emits `weight:`, `fabric:`,
`sleeve_length:`, `weather_protection:`, `fit:`, `opacity:`, `reads:` and the owner-authored rules.
It does **not** emit:

- the garment's warmth level (the engine's own thermal placement)
- whether it is insulated
- `interior_construction`
- `season`
- whether it is removable

So the model is told the trench is `discouraged` but is never told the trench is `moderate`,
uninsulated, removable, year-round. **It cannot check the verdict, because the facts the verdict was
computed from are withheld.** That is the strongest available evidence for the owner's diagnosis, and
it was not visible from reading the code — the provider capture is what showed it.

This also explains the oscillation directly. When the only thermal channel is a verdict, moving the
verdict moves the whole outfit. There is no fact layer underneath for the model's own judgment to
land on, so every calibration change is a full swing.

## Finding 2 — selection is where it actually bites

`planWorkbenchPieceScore` decides *what the model is offered* (4 outer layers per slot from 29 owned).
Until commit 6a4204a it was thermally blind and carried a blanket `+5 for light fabric`; that commit
made it read #10 and #11 instead. **Both versions are wrong for the same reason:** selection was
ranking by a styling verdict either way.

Selection cannot be removed — some 40 pieces must be chosen. But its criterion should be **range, not
rank**: offer at least one layer at each available warmth level, so the model can actually choose.
That single change fixes both oscillations without any verdict crossing the contract — the puffer run
and the sun-hoodie run were both "the roster only contained one kind of layer."

## Finding 3 — `insulation: none` is unrepresentable

The hoodie case is a garment-truth gap, not a scale-calibration gap. `insulating_layer_materials: []`
and "we never asked" are the same value today. `interior-construction-spec.md` established
`interior_construction` for exactly this class of problem and `unlined` is already a legal value — the
hoodie simply does not carry it. Whether the tagger can determine it, and what a bulk re-tag would
cost, are open (see `dont-propose-retagging-the-wardrobe`: fix the tagger first, retag once after).

## Proposed target contract

Facts to the model, judgment from the model:

```
Conditions:  54-65°F likely waking exposure · mid-October · hiking · outdoor
             (source: seasonal estimate, coarse)

Cream trench      warmth moderate · uninsulated · removable · season year-round
Black puffer      warmth very warm · insulated · removable · season cool
Navy sun hoodie   warmth very light · uninsulated · removable · sun/UV layer
Denim jeans       warmth moderate · season year-round
Light cotton pants warmth light · season warm
```

Retain as hard constraints only: #19 (`NO_WARM_LAYER_FOR_COLD` in genuine cold), #12's `prohibited`
tier, #5, #9 — plus the non-thermal structural rules this document does not cover.

Remove from the model contract: #4, #10, #11, #13, #14, #15, #16, #17, #20, #21, #22, #24, #25.
Keep them internally where they serve a deterministic job (#6's ordering, selection) — but a
deterministic ranking the model never sees is not part of the contract and cannot be argued with.

## Open — deliberately not closed here

- **The known weather gap stays on the finish plan.** `ExposureContext` still cannot distinguish a
  brief 65°F October peak from a June day sitting near 65°F for hours. That is an upstream
  weather-representation problem and **must not be papered over with calendar-season scoring**
  (which is what #11 currently does).
- Whether removing #10–#17 regresses the puffer case. Unknown, and not assumable in either
  direction — it needs one live run *after* the fact channel exists, not before.
- Parallel-contract calibration (#20, #23) remains its own project per band spec §21.1.
- Whether the tagger can determine `interior_construction` for a shell garment at all.
