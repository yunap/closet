# Capsule Step 5 — live evaluation and V1 decision

Written 2026-07-30 from `thread_1785448241452`, the first live rerun after the bench, quota,
season-gate, colour-taxonomy and disclosure corrections. This is a design decision, not an
implementation brief. No generation behaviour changed while writing it.

## 1. Decision

**Stage 3 does not earn default-on status from this run.**

The call worked mechanically: the model selected a 24-piece roster, one bounded repair produced a
validator-accepted result, composition returned 12 valid cards, and no deterministic fallback or
composition auto-completion fired. The result nevertheless failed as a capsule:

- it spent five slots on shoes but offered only one clearly elevated summer option;
- it selected taupe suede ankle boots for summer and never demonstrated them;
- it selected two tops that require a base, with both demonstrations dependent on the same orange
  tank;
- it met the binary statement-piece post-condition but presented no convincing spread of hero-led
  choices;
- it selected only one of the two season-invariant layer slots, then never demonstrated that layer;
- its 92% utilization headline concealed that the two unused pieces were the only layer and the
  questionable fifth shoe;
- it reached 10 colour families and an 83% neutral base, outside the published 5–9 and 60–70%
  guidance.

This meets Step 5's severe-failure exception. Formula diversity and roster demonstration are no
longer merely hypothetical V2 refinements: the rotation claimed versatility that its category
allocation, hero balance and footwear did not convincingly demonstrate. The feature remains behind
`WARDROBE_MODEL_CAPSULE_ROSTER`.

## 2. What actually happened

### Run mechanics

- request: “I want a summer capsule”
- budget: 24 pieces
- requested cards: 12 across At Home, Errands, City/Museums, Restaurants/Social, and Nature
- roster calls: 1 initial + 1 repair
- roster fallback: 0
- accepted cards: 12
- composition auto-completions: 0
- approximate total provider cost: $0.37

The accepted category allocation was:

| category | engine guidance | accepted roster |
|---|---:|---:|
| tops | 8 | 8 |
| bottoms | 7 | 7 |
| dresses | 3 | 3 |
| layers/outerwear | 2 | **1** |
| shoes | 4 | **5** |

The validator rejected neither the missing layer nor the extra shoe. `capsuleRosterPostConditions`
declares the researched layer allowance as an outerwear **ceiling**, but no summer outerwear floor
exists. Shoe ceilings were deliberately omitted because they could conflict with register-demand
reserves. Since the roster budget is exact, accepting one fewer layer necessarily let another
category consume the slot.

### Formula diversity

The 12 cards were not near-duplicates, but they had only two macro structures:

- 9 separates looks (including two dependent-top + base variants);
- 3 dress + shoe looks.

There was useful variation within the separates: skirt, trousers, shorts, cargo capris, a dark
column, texture, and different registers. This would not independently justify a generation
change. The more important failure is that the formula set did not make the roster's claimed
functional breadth visible: no layer formula appeared, and the two dependent tops reused one base.

### Roster demonstration

Twenty-two of 24 pieces appeared, but raw utilization gave the wrong verdict. The two omissions
were:

1. the roster's **only** outerwear piece;
2. taupe suede ankle boots, the questionable extra summer shoe.

Demonstration must therefore be evaluated by **jobs shown**, not only IDs used. A rotation can use
most pieces while failing to demonstrate a whole category, a transition strategy, an elevated
shoe wardrobe, or independent wearability.

### Hero, support and grounding balance

The current deterministic guarantee asks only for one statement piece. It is a presence check,
not a capsule-quality judgment. Once the black geometric crop cleared it, the validator had no
concept of:

- more than one visually distinct hero option;
- hero choices serving different contexts;
- whether dresses that look expressive in text actually lead in the image;
- whether neutral support pieces dominate the roster so thoroughly that its personality collapses.

Do not solve this with colour-word counts, role labels alone, or a larger statement quota. Hero /
support / grounding is a relational visual judgment and belongs with the roster model and human
evaluation. Deterministic code may verify declared structure, never substitute a keyword rule for
that judgment.

### Footwear

The shoe reserve check passed because structured register data found casual and elevated paths.
That proves technical eligibility, not that the shoe wardrobe is convincing for this summer
capsule. In the rendered result, sneakers and slip-ons carried almost every context and the brown
wedges were the sole clearly elevated option. The accepted taupe suede ankle boots added neither a
demonstrated formula nor useful summer breadth.

This is evidence that the existing shoe register check is necessary but insufficient. Do not
tighten global shoe-formality classification from this one capsule and do not retag the boots.
The roster model must judge season, visual quality and the job each shoe earns within this
particular set.

## 3. Acceptance criteria for the next captured run

These criteria are deliberately falsifiable from the roster, cards and garment images. They do
not require a wardrobe retag or a separate paid evaluator.

### Deterministic

1. **Layer allocation survives model selection.** At budget 24, the accepted roster contains the
   researched two layers when the bench can supply them. The existing maximum remains; the model
   may not trade a layer slot into a fifth shoe.
2. **Structural shoe paths survive.** Existing casual/elevated shoe-demand validation continues
   to pass; the layer correction must not weaken it.
3. **Dependent pieces remain operable.** Every `needs_base` piece has at least one standalone base
   that is gate-valid in every slot where the dependent is offered. Today the post-condition checks
   only that one standalone top exists somewhere in the roster; it does not prove slot-level
   availability or visual compatibility. Deterministic code can close the first gap. The roster
   model must judge the second. The run is not proof that two dependent pieces is always too many.
4. **The result discloses jobs, not just utilization.** A category or special role selected for
   the capsule but absent from all representative looks is reported as an undemonstrated job.

### Model-judged and owner-reviewable

5. **Summer footwear earns its slots.** Each selected shoe has a credible job in the requested
   summer contexts. If the plan includes restaurants/social use, the set offers more than one
   convincing polished option or explicitly explains why the wardrobe cannot.
6. **The capsule has visible protagonists.** A reviewer can identify at least two visually
   distinct hero-led options in the representative rotation, serving more than one context. This
   is an evaluation threshold, not a deterministic statement-piece quota.
7. **Dependent tops add formulas rather than bookkeeping.** If multiple `needs_base` tops are
   selected, their demonstrated combinations differ meaningfully in silhouette, context, or base;
   repeating the same tank under both is not sufficient evidence of breadth.
8. **Functional categories are demonstrated.** The representative looks show how selected layers
   and specialized shoes participate in the capsule. Omitting one may be justified; omitting an
   entire function is a failure.
9. **Palette remains observational for this correction.** Family breadth and neutral-base share
   are reviewed and disclosed, but they do not hard-filter the roster. This run's 10 families /
   83% neutral result remains V2 evidence unless the corrected roster repeats the failure.

## 4. Enforcement boundary

| finding | enforcement layer | reason |
|---|---|---|
| one layer instead of the researched two | deterministic roster validation | exact, sourced, free to verify; the model path must not bypass a settled allocation |
| casual/elevated shoe path exists | existing deterministic validation | structured validity and capacity, not taste |
| every dependent top and a standalone base share its offered slots | deterministic roster/slot validation | structural availability; visual compatibility still belongs to the model |
| summer shoes are convincing and earn distinct jobs | roster-model instruction + owner review | contextual visual judgment; metadata eligibility already produced a false-positive-quality result |
| hero/support/grounding balance | roster-model instruction + owner review | relational aesthetic judgment; a keyword or numeric taste score belongs in the wrong layer |
| dependent pieces demonstrate distinct value | roster-model instruction and composition brief | a piece can be structurally valid yet add no useful formula |
| selected functional jobs appear in the rotation | composition brief + post-composition disclosure | concerns what the cards demonstrate, not whether the roster is valid |
| colour breadth and neutral share | existing disclosure, V2 evaluation | preference, not validity; one corrected rerun should precede pressure |

## 5. Smallest V1 correction to propose

The smallest defensible correction has three parts:

1. Make the season-invariant layer allocation a validator floor as well as a ceiling when supply
   exists. Preserve the exact-budget fallback and disclose a real supply shortfall rather than
   failing forever.
2. Close the dependent-top validator's roster-level loophole: a standalone base must share each
   offered slot with its dependent. This verifies availability, not visual compatibility.
3. Amend the roster-selection brief—not garment scores—to require the model to account for
   hero/support/grounding balance, independent wearability, seasonally credible footwear, and the
   distinct job each chosen piece earns. Give the repair call the same brief.
4. Amend the composition brief to demonstrate the roster's functional logic across the requested
   contexts, including layers, dependent pieces and specialized shoes where selected. Extend the
   disclosure so unused **jobs** cannot hide behind a high piece-utilization percentage.

This is generation behaviour, justified only because the live acceptance run met the previously
defined severe-failure exception. It should be implemented with the captured roster and cards as
offline regression fixtures, then reviewed before one explicitly approved paid rerun.

Do **not** add:

- a deterministic hero score or a larger hard statement quota;
- colour-family or neutral-share filters;
- a blanket cap on `needs_base` pieces from one example;
- garment IDs, names or special cases;
- wardrobe retagging;
- another provider evaluation call or an unbounded repair loop.

## 6. Evidence required before default-on

1. Offline tests prove that a model roster cannot exchange the second layer for a fifth shoe when
   the bench supplies both layers.
2. Offline fixtures prove the roster and repair briefs state the qualitative jobs without
   inventing owner preferences.
3. Offline composition contracts prove the model is asked to demonstrate functional breadth and
   the result names any undemonstrated job.
4. Existing deterministic-roster output and ranking A/B remain unchanged.
5. After owner review of the implementation, one explicitly approved Step 5 rerun is captured.
6. The rerun is reviewed against all nine criteria above. Passing structural validation alone is
   not sufficient for default-on.
