# Day-wear explanation pilot (2026-09-15)

**Status:** historical — pilot run 2026-09-15 (approved sha256 `a1e4107f…d00216`, 12 calls, ≈$0.19); **no useful signal**. Per the pre-registration, nothing is carried into production or chat flows, no bundle follow-up is proposed, and no further prompt change is made before the raw choices are investigated. Production is unchanged: the change runs only behind `WARDROBE_EXPERIMENT_COMPOSER_MANIFEST`.

**What this is.** An incremental pilot of the **current, weather-guided** Whole Wardrobe composer at count 1. It does **not** test neutral model judgment (production verdict words and weather guidance stay on), the actual `/ask` one-outfit tool loop, or bundle (five-card) quality. A pilot result is never carried into chat flows on its own.

**Scope held by the owner (2026-09-15).** No warmth-score, tolerance, gate or garment-field changes. The change asks the stylist to explain; it adds no engine verdict, no layer requirement and no garment ban. An improvement is carried into the shared chat logic only if the owner's blinded ratings demonstrate one.

## 1 · What the diagnosed cards received and chose

The inspection used the saved provider captures (`scratch/endpoint_audit_runs/2026-09-15/request-inspection.md`, gitignored). It covered:
- the dress too hot at 72°F;
- cardigan 131 as the only layer at 50°F;
- the sleeveless base under the puffer at 46°F;
- turtleneck 144 with the olive jacket at 46°F.

Every diagnosed bundle card is the composer's own raw choice, not a repair.

- **Both weather endpoints:** present in every request ("Temperature: 72°F high / 62°F low" plus the owner's time course). The `/ask` one-outfit catalog guidance restates only the cold-end target.
- **Photos:** every chosen piece's photo was sent, including the one-outfit loop's viewed photos.
- **Construction and coverage were received, inferred or chosen by the model itself:**
  - The dress: the model wrote "fitted midi sheath" and "single-piece column".
  - Cardigan 131: the model styled it "worn open". No closure fact exists.
  - The sleeveless tank: "Light upper layer requires the heavy puffer zipped for core warmth."
- **Stronger eligible alternatives:** the garments the owner rated strongly in each scenario (wool coat, fleece, puffer, tops 84/86/220/137) were in every one of these rosters or catalogs.
- **What no card did** was say what is worn, and what that leaves covered, at each end of the conditions. Cards treated the presence of a layer as the answer to changing temperature:
  - "trench for temperature shifts" over a dress that stays on at 72°F;
  - "an open layering piece for the dropping evening temperature";
  - a plan that works only if a puffer stays zipped for the whole walk.
- **Exception:** the 144 + olive-jacket card in replicate 2 was steered by the old sleeve-construction verdict (the model first chose the puffer). That verdict is now log-only.

## 2 · The proposed change (experiment-only)

Two parts, and nothing else:
- one instruction appended to the composer system prompt (`DAY_WEAR_EXPLANATION_INSTRUCTION`, `routes/ai.js`);
- one required output string, `wear_through_day`, in the composer schema (`composerOutfitSlotsSchema`, `styling-engine/composerSlots.js`).

The instruction, verbatim:

> WEARING IT THROUGH THE STATED CONDITIONS: for each outfit, fill `wear_through_day` with how you intend it to be worn across the stated conditions. Describe the warmest part and the coolest part separately; when the conditions do not change, describe the whole period once. For each, name which of the outfit's pieces are worn and how (for example open, closed, zipped or carried), and what that leaves covered or uncovered: arms, neck, torso and legs. Say what changes between the two, or that nothing changes. This describes your intention; say where the photographs and facts do not show something, and do not present warmth as certain.

- **`wear_through_day` is an output slot, not a garment field.** If the owner counts it under the paused field changes, the alternative is to ask for the same explanation inside `reason`. That is a different change and needs re-registration.
- **Permanent tests** (`test/aiEndpointContracts.test.js`):
  - Without a manifest, production neither states the instruction nor has the property.
  - The control manifest equals production.
  - For one and five cards, the explain arm differs only by the appended instruction and the one schema property: same roster, garment lines, photographs and token budget.
  - An invalid value refuses before any model call.
  - The instruction contains no verdict or requirement vocabulary and names no garment category.

## 3 · Pilot protocol

The authority is `scratch/ab_stage3_preregistration.json`, approved by its sealed sha256.

**What it replaces.** The earlier 24-call protocol (one card and five cards; sealed `d406d3d2…3d620`) was **not approved** and is withdrawn.

- **Harness and model.** `scratch/ab_stage3_day_wear.mjs` runs composer-only on the frozen Stage 2 final snapshot, with Gemini 3.5 Flash-Lite and the production verdict words on.
- **Arms.**
  - **Control:** the exact production composer request at count 1. The preflight proves it byte for byte against the actual production request.
  - **Explain:** control plus the change.
- **Cells.** Two arms × the saved 65/50, 46°F-walking and 72/62 scenarios × 2 replicates = **12 calls**, in a pre-registered counterbalanced order. There are no reruns or substitutions; timeouts are technical failures.
- **Rating burden.** At most 12 cards, then at most 6 explanations.
- **Stage 1: blinded card ratings.**
  - One sheet, hanger photo first, with conditions on every card.
  - Seeded random order with a sealed key; arm and replicate hidden.
  - `wear_through_day` is not shown.
  - Fields: weather adequacy, style and intent, would wear, notes. The export is locked before stage 2 is built.
- **Stage 2: explanation validity (required).**
  - Every explain card is shown with its photos, its own stage-1 rating and its verbatim `wear_through_day`.
  - Mark (a) whether it is a physically believable plan for these conditions (yes / partly / no).
  - Mark (b) whether its coverage statements are accurate for these garments (yes / partly / no).
  - Mark (c) whether it rationalizes a poor garment choice rather than describing a sound plan (yes / no / unsure).
  - Add notes.
- **Useful signal** requires every one of these:
  - pooled mean weather, explain − control ≥ +0.5;
  - no scenario where explain is lower;
  - style not lower by more than 0.5;
  - would-wear count not lower;
  - at least 4 explain plans marked believable, and at most 1 marked as rationalizing;
  - at most 1 technical failure of 12.

  With 6 cards per arm this is a descriptive pilot signal only.
- **Cost.** About $0.10–$0.40 for 12 calls.

## 4 · After the pilot

- **If there is a useful signal:** propose a separate, small bundle follow-up with its own pre-registration and a stated rating burden. Nothing is carried into production or chat flows on the pilot alone.
- **If there is no useful signal:** make no further prompt change until the raw choices and explanations have been investigated. That covers especially plans marked believable on cards rated inadequate, and explanations that rationalize a poor choice.
- **Any eventual carry** into shared chat logic is its own reviewed change, with offline request diffs and the ranking A/B. No gate, verdict or ranking consumes the text.

## 5 · Pilot result (2026-09-15)

These are the owner's blinded card ratings, locked by export sha256 `7e2d0c93…41e2ed`, followed by the required explanation-validity marks. Evidence (gitignored): `scratch/ab_stage3_runs/2026-09-15/`.

| | Control (6 cards) | Day-wear (6 cards) |
|---|---|---|
| Mean weather | 4.83 | 3.83 |
| Mean style | 5.00 | 4.83 |
| Would wear | 5 | 2 |
| Weather ≤3 | 0 | 2 |

- **By scenario, explain − control weather:** 65/50 −2.0; 46°F walk −0.5; 72/62 −0.5. There were no technical failures.
- **Explanation validity (6 plans):** believable yes 3, partly 2, no 1; coverage accurate yes 5, no 1; rationalizes a poor choice yes 3, unsure 2, no 1.
- **Useful-signal rule: not met.**
  - Failed: weather, the per-scenario comparison, would-wear and validity.
  - Passed: style and technical failures.

**Preliminary observations for the raw-choice investigation.** These are descriptive only; nothing is concluded from six cards.

- **Worse garment choices after an explanation was requested, stated as plans.**
  - At 65/50, one card stacked a fleece under a wool coat. Its plan invented an indoor option ("carrying or leaving the heavier fleece and coat behind if indoors").
  - Another chose knit sneakers and described them as "wool sneakers". The owner noted they are not wool and not for 50°F walking.
  - At 72/62, one card chose linen trousers with no layer; the plan asserts "cotton and linen fabrics remain comfortable" at 62°F (owner: rationalization).
  - At 46°F, one card chose pleated pants and planned to remove the puffer "as movement builds warmth" (owner: those pants and that top won't do without a jacket).
- **The explanation did not correct choices; it described them.** The one plan marked sound and non-rationalizing (72/62, open olive jacket put on at 5 p.m.) was on a card the owner rated 5.
- **The control arm was strong this run** (5 of 6 would wear). The diagnosed Stage 1 and 2 misses were not reproduced in these six control cards, so this pilot cannot show whether the instruction helps the cases that motivated it.

## 6 · Offline raw-choice comparison (2026-09-15)

No provider calls and no new ratings. The comparison matches each day-wear card to the control card from the same scenario and replicate. It uses the captured requests (garment lines as sent, photo kind) and the frozen snapshot record. Captures show what the model **selected or mentioned**, not every alternative it weighed. The six control cards did not reproduce the earlier diagnosed misses, so this comparison does not explain those misses.

**Evidence labels.**
- **Contradicted:** the claim conflicts with a recorded garment field or with the request text the model received.
- **Unsupported:** the record does not establish the claim, but does not contradict it either.
- **Out-of-scope plan:** the plan relies on a garment, activity or condition that is not in the outfit or the request, or is a comfort judgment the record cannot settle.

| Pair | Control pick → rating | Day-wear pick (what changed) → rating | Contradicted | Unsupported | Out-of-scope plan |
|---|---|---|---|---|---|
| 65/50 r1 | 137 top, wool coat 996867, pants 129, wool sneakers 996862 → 5, yes | fleece 996762, jeans 105, **knit sneakers 198** → 4, no | — | "wool sneakers": 198 has no recorded fibre (`fabric: woven`, fibre list empty); the phrase matches the *name* of 996862, which control chose | — |
| 65/50 r2 | 137, fleece 996762, jeans 109, 996862 → 5, yes | **fleece 996762 under wool coat 996867**, jeans 109, 996862 → 2, no | "if indoors": the request says "outside from about 4–8 p.m." | — | carrying or leaving the fleece and coat behind for an indoor period the request does not contain |
| 46°F r1 | mock neck 266 (extra-long sleeves), puffer, corduroy 115 → 5, yes | **base 137**, puffer, jeans 109 → 5, yes (marked rationalizing) | "long-sleeve striped top": 137 is recorded `sleeve_length: short` (not in the sent line; visible only in the worn photo) | — | — |
| 46°F r2 | 266, puffer, **heavy cargo 230**, 996862 → 5, yes | 266, puffer, **medium twill wide-leg 129** → 4, no | — | "beige utility pants": 129 reads_as "structured wide-leg pants" | removing the jacket mid-walk "as movement builds warmth" (a comfort judgment the owner rejected) |
| 72/62 r1 | 137, grey jeans 121, no layer → 4, no | 137, **linen pants 125**, no layer → 3, no (rationalizing) | — | "cotton and linen fabrics remain comfortable" at 62°F (fibres are recorded; comfort is not) | "an optional transition layer could be added": no layer is in the outfit |
| 72/62 r2 | 137, olive jacket 996767, trousers 89 → 5, yes | 137, olive jacket 996767, crop jeans 110, slip-ons 215 → 5, yes ("works well") | — | "fully insulated by the jacket": 996767 is unlined cotton with no insulating material recorded | — |

**Record inconsistencies noticed, not claims:** 125 and 110 have `length_hits_at: full_length`, while their names or reads_as say cropped (diagnosed separately; data unchanged).

**Conclusion.**
- **This negative result is about this specific `wear_through_day` prompt.** It does not show that day-long wearability is unimportant.
  - Requiring a written plan came with different, often weaker component picks, which the plan then described.
  - In 4 of 6 pairs the day-wear card changed exactly the component the owner criticized: lighter shoes, a lighter bottom, or a stacked second outer layer. The control picks for those slots were rated 5.
- **Contradicted claims: two.** One contradicts a recorded field (137's sleeve length, which was absent from the sent line). One contradicts the request (an invented indoor period).
- **Unsupported claims: four.** A shoe fibre borrowed from another shoe's name, a garment descriptor, a comfort statement about fibres, and an insulation overstatement.
- **Out-of-scope plans: three.**
- **What supplying the record would and would not do.** Supplying 137's recorded sleeve length could prevent the invented "long-sleeve" explanation. This pilot does not show that it would change garment selection.
- **Actionable:** no further plan-writing prompt in the composer call, and nothing from this pilot goes into production. If day-long wearability is revisited, the question needs a design that does not ask the same call to justify its own choice. Before any such design, the diagnosed misses need their own evidence, because this pilot's control arm did not reproduce them.
- **Record notes, reported, not acted on:** two bottoms (125, 110) have `length_hits_at: full_length` while their names or reads_as say cropped.
