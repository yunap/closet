# Stage 1 cause matrix and next-experiment contracts (2026-09-14)

**Status:** active — owner-accepted diagnosis of the Stage 1 live run, with the owner's garment rulings and the revised contracts for experiments A–C (A approved in principle). No provider call is approved; nothing is implemented.

This is the durable record of the diagnosis. The rulings in §1 are the authority against re-adding a shape-based sleeve gate. When implementation begins they must also enter the ratified maps and permanent tests; this document alone is not the enforcement.

Evidence (local, gitignored, not committed): `scratch/ab_stage1_runs/2026-09-14/`
- `live_run/` — manifest, contract report, provider captures (normalized, wire, output), both rating rounds, sealed keys, scores.
- `frozen_snapshot/` — the run's wardrobe and system databases.
- `diagnosis/` — per-card extraction, metadata diff, and evaluator runs on the frozen snapshot and a corrected copy.

The corrected copy is the frozen snapshot plus the owner's corrections read from a WAL-safe copy of the current wardrobe at 2026-09-14 16:03 PDT: pieces 84, 131, 184, 238 and 349. No provider calls were made for this diagnosis.

## 1 · Owner rulings (2026-09-14)

**Truth table.**

| Control | Garments | Recorded construction (corrected) | Owner ruling | Current evaluator (corrected data) |
|---|---|---|---|---|
| Wearable | 144 black extra-long ruched turtleneck under 996866 fitted puffer | sleeve extra_long / gathered_ruched | **Wearable.** Soft, compressible ruching; the longer sleeve may bunch softly inside or intentionally show at the cuff. | Hard sleeve conflict (returned in S2 one-outfit r2). **False positive with downstream harm.** |
| Wearable | 184 patchwork knit under 996866 | sleeve 3/4 / voluminous | **Wearable.** Voluminous but soft enough to compress. | Hard sleeve conflict. **False positive.** |
| Incompatible | 238 green floral cardigan under 996866 | sleeve extra_long / voluminous | **Incompatible.** Substantial sleeve that does not fit comfortably. | Hard sleeve conflict. Right answer for the wrong reason: sleeve shape does not encode the structure or compressibility that separates 238 from 144 and 184. |
| Length | 131 cardigan under 996866 | length knee (was mid_thigh) versus the puffer's low_hip | A real overhang; even the old mid_thigh value exposed it. | No finding: the bundle composer never received length, and no hem-overhang question exists. |
| Preference | 142 long vest under 996866 | length mid_thigh (correct) | Potentially plausible; the owner would not wear it. **Owner preference, not a universal length rule.** | No finding. Not a defect. |
| Weather | 349 striped boat-neck top at 72°F with outerwear | warmth moderate (medium-weight wool/rayon blend; `moderate` is correct) | Too hot for 72°F. A **warm-end thermal selection and calibration issue**: why did the model select a moderate knit, sometimes with outerwear, across a 72/62 range? It is not warm merely because it contains some wool. Sleeve unknowns are unrelated raw metadata evidence only, and missing fiber metadata was not the cause. | Warm end +1 tolerated with no flag. |

**Principles.**
- Sleeve shape alone cannot support a hard incompatibility verdict. The deciding dimension is sleeve structure or compressibility, not geometry or relative sleeve length. The current strict sleeve-geometry rule is **unvalidated** and must not gate any experiment.
- None of these is proof of incompatibility, and each is a legitimate intentional styling choice: a longer sleeve showing below a shorter one; a short-sleeved layer worn over a long sleeve; visible or gathered volume (which is not rigid bulk).
- What the system must show instead is that the model:
  1. received the relevant facts and photographs;
  2. noticed the non-obvious relationship;
  3. chose it intentionally;
  4. described the intended treatment in `styling_instructions`;
  5. made no unsupported construction claims.

  Silence or invented construction claims are the failure, not an unconventional combination.
- Piece 84 has been retagged; there is no open metadata question about it. Sleeve warnings that appear in the raw evidence but relate to no owner-reported problem are not explanations for any rating.

## 2 · What Stage 1 proves and does not prove

**It proves:**
- Both production paths ran end to end under identical resolved conditions; routing succeeded in 6 of 6 attempts; the capture contract held.
- These component failures are reproducible from frozen evidence:
  - the bundle composer and repair payloads omit length and sleeve facts;
  - no hem-overhang evaluation exists;
  - unknown construction findings stay in debug;
  - the geometry-only sleeve rule is unvalidated, with two false positives, one of which caused weather harm;
  - one-level tolerance at both weather endpoints goes unflagged;
  - the critic sees no weather or construction evidence;
  - model-chosen search categories can drop dresses;
  - every model path attaches the worn photo first while the Stylist Chat card shows the hanger photo first.

**It does not prove:**
- Which flow is better.
- Which reasoning component improves results. Too much differs at once:
  - metadata;
  - garment-fact payloads;
  - photo exposure;
  - card count;
  - repair and critic;
  - the evaluator feedback loop, which only the one-outfit arm has.
- The magnitude of weather miscalibration.
- That any deterministic rule would help; 144 and 184 show a rule can make results worse.

The ratings remain valid usability evidence and are confounded as a flow comparison.

## 3 · Card matrix (all 36 rated cards)

Positions: roster group position for bundle; catalog row for one-outfit ("unviewed" means no photograph was requested). Endpoint gives cold..warm targets and each configuration's level with signed distance ("on" = all layers on; "-id" = that layer removed). "raw" lists evaluator codes on frozen data; they are evidence, not explanations, unless the classification says so.

| Card | Pieces (role) | Owner (round 1 → round 2) | Metadata in snapshot (relevant) | Facts the composing model saw | Pre-composition position | Evaluator on frozen data | Delivery / critic / repair | Classification | Counterfactual on corrected data |
|---|---|---|---|---|---|---|---|---|---|
| S1 bundle r1 #1<br>Earthy Knit and Corduroy | 84 top, 104 bottom, 131 outer, 215 shoes | R1 W4 S5 no → R2 W3 S4 no | 84: corrected: sleeve_shape None→voluminous<br>131: len mid_thigh, slv long/fitted, corrected: length_hits_at mid_thigh→knee | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 84 top 6/29<br>104 bot 12/24<br>131 out 2/7<br>215 sho 7/14 | endpoint warm..light; on:Lwarm/cold0 -131:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | Weather calibration: the evaluator reads a moderate knit plus a moderate cardigan as reaching the warm cold-end target (distance 0); owner rates it insufficient at 50°F.<br><i>84 corrected by owner retag; no open metadata question.</i> | identical |
| S1 one r2 #0<br>Chic Trench & Denim Evening Outing | 996793 top, 107 bottom, 996759 outer, 996859 shoes, 358 accessory | R1 W5 S5 yes → R2 W4 S5 yes | 996759: len knee, slv long/straight | catalog and view truth line, incl. length, sleeve, silhouette, season, interior; worn-first photos of 11 viewed pieces | 996793 cat 82/237<br>107 cat 96/237<br>996759 cat 208/237<br>996859 cat 183/237<br>358 cat 225/237 | endpoint warm..light; on:Lwarm/cold0 -996759:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); no flags | No problem. | identical |
| S1 bundle r2 #0<br>Graphic Tee and Cargo Casual | 254 top, 230 bottom, 996867 outer, 996862 shoes | R1 W5 S5 yes → R2 W4 S5 no | 996867: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 254 top 16/29<br>230 bot 24/24<br>996867 out 1/7<br>996862 sho 4/14 | endpoint warm..light; on:Lwarm/cold0 -996867:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); flags: Contains a piece the occasion/activity profile usually discourages.; critic: not flagged; repair: unchanged | No recorded cause: rating fell in round 2 with no note. | identical |
| S1 bundle r1 #4<br>Ribbed Knit and Cargo Utility | 228 top, 230 bottom, 996762 outer, 198 shoes | R1 W4 S5 no → R2 W4 S4 no | 228: len hip, slv sleeveless/∅<br>996762: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 228 top 14/29<br>230 bot 24/24<br>996762 out 5/7<br>198 sho 5/14 | endpoint warm..light; on:Lmoderate/cold-1 -996762:Lvery light/warm-1<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | Weather calibration: −1 at the cold end tolerated; the sleeveless base is very light, −1 at the warm end, once the fleece comes off. Model judgment: sleeveless base at 50°F. | identical |
| S1 bundle r1 #0<br>Structured Striped Ease | 137 top, 109 bottom, 996867 outer, 996862 shoes | R1 W5 S5 yes → R2 W5 S5 yes | 996867: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 137 top 8/29<br>109 bot 14/24<br>996867 out 1/7<br>996862 sho 4/14 | endpoint warm..light; on:Lwarm/cold0 -996867:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); flags: Contains a piece the occasion/activity profile usually discourages.; critic: not flagged; repair: unchanged | No problem (control). | identical |
| S1 bundle r2 #2<br>Ribbed Tank and Dark Denim | 228 top, 106 bottom, 142 mid, 996867 outer, 196 shoes | R1 W4 S5 no → R2 W3 S4 no<br>"cute, but not good enough for 50 degree weather. bare arm not even great for 65" | 228: len hip, slv sleeveless/∅<br>142: len mid_thigh, slv sleeveless/∅<br>996867: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 228 top 14/29<br>106 bot 10/24<br>142 out 6/7<br>996867 out 1/7<br>196 sho 6/14 | endpoint warm..light; on:Lwarm/cold0 -142:Lwarm/warm2 -996867:Llight/warm0 -all_layers:Lvery light/warm-1<br>raw: no findings | ready (not diagnostic); flags: Contains a piece the occasion/activity profile usually discourages.; critic: not flagged; repair: unchanged | Weather calibration: arm exposure is not weighed; owner finds bare arms poor even at 65°F while the evaluator reads the system as fitting. | identical |
| S1 one r1 #0<br>Cozy Coastal Casual in Walnut Creek | 1 top, 107 bottom, 131 mid, 198 shoes | R1 W4 S5 no → R2 W3 S5 no<br>"cute, but not good enough for 50 degree weather - both sneakers and cardigan" | 131: len mid_thigh, slv long/fitted, corrected: length_hits_at mid_thigh→knee | catalog and view truth line, incl. length, sleeve, silhouette, season, interior; worn-first photos of 9 viewed pieces | 1 cat 1/219<br>107 cat 96/219<br>131 cat 173/219<br>198 cat 153/219 | endpoint warm..light; on:Lwarm/cold0 -131:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); no flags | Weather calibration: the cardigan-only system reads as reaching the target. Deterministic-model gap: footwear carries no thermal evidence (198 warmth unknown), so "sneakers not warm enough" cannot be evaluated.<br><i>The model saw length and sleeve for 131 and viewed its photo.</i> | identical |
| S1 bundle r1 #3<br>Botanical and Wide-Leg | 133 top, 129 bottom, 990397 shoes, 996759 outer | R1 W4 S4 no → R2 W4 S4 no<br>"pants are not great for 50 degree weather. would not wear those sneakers with the trench coat / the sneakers do not work with trench, the pants are not warm enough for low range, the trench is plausible but probably also wont do m" | 996759: len knee, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 133 top 7/29<br>129 bot 2/24<br>990397 sho 3/14<br>996759 not in roster (repair candidate) | endpoint warm..light; on:Lwarm/cold0 -996759:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); flags: Reads volume-heavy; check that one piece anchors the outfit. / Contains a piece the occasion/activity profile usually discourages.; critic: not flagged; repair: added layer | Weather calibration: a moderate trench reads as reaching the target; owner doubts it below 55°F. Model judgment in repair: the trench was added over athletic sneakers and wide-leg pants; repair is add-only by design.<br><i>Repaired card (trench added by repair).</i> | identical |
| S1 bundle r1 #2<br>Monochrome Texture Play | 220 top, 108 bottom, 142 outer, 213 shoes | R1 W4 S5 no → R2 W3 S4 no | 142: len mid_thigh, slv sleeveless/∅ | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 220 top 3/29<br>108 bot 13/24<br>142 out 6/7<br>213 sho 14/14 | endpoint warm..light; on:Lmoderate/cold-1 -142:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | Weather calibration: one level short at the cold end (−1) is tolerated and not disclosed. Model judgment: a light vest as the only layer at 50°F; the composer saw warmth: light. | identical |
| S1 bundle r2 #3<br>Knit Tee and Straight Trousers | 363 top, 89 bottom, 996760 outer, 996862 shoes | R1 W5 S5 yes → R2 W5 S5 yes | 996760: len mid_thigh, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 363 top 25/29<br>89 bot 22/24<br>996760 out 4/7<br>996862 sho 4/14 | endpoint warm..light; on:Lwarm/cold0 -996760:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | No problem (control). | identical |
| S1 bundle r2 #4<br>Boat Neck Knit and Utility Pants | 349 top, 119 bottom, 996762 outer, 213 shoes | R1 W5 S5 yes → R2 W5 S5 yes | 349: corrected: sleeve_shape None→straight; length_hits_at hip→high_hip; fiber_content ["unknown"]→["wool","rayon"]<br>996762: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 349 top 22/29<br>119 bot 6/24<br>996762 out 5/7<br>213 sho 14/14 | endpoint warm..light; on:Lwarm/cold0 -996762:Lmoderate/warm1<br>raw: layer_construction_bulk_unknown(warning) | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | No problem (rated wearable).<br><i>Sleeve warnings in the raw evidence are not an explanation for any rating.</i> | hard: none; advisory: none |
| S1 bundle r2 #1<br>Striped Mock Neck and Corduroy | 266 top, 104 bottom, 131 outer, 198 shoes | R1 W4 S5 no → R2 W3 S4 no<br>"not warm enough for 50 degree weather" | 131: len mid_thigh, slv long/fitted, corrected: length_hits_at mid_thigh→knee | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 266 top 20/29<br>104 bot 12/24<br>131 out 2/7<br>198 sho 5/14 | endpoint warm..light; on:Lmoderate/cold-1 -131:Llight/warm0<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | Weather calibration: −1 at the cold end tolerated and not disclosed. Model judgment: light base plus moderate cardigan at 50°F; owner: not warm enough. | identical |
| S2 bundle r1 #3<br>Mock Neck and Denim Layers | 266 top, 105 bottom, 184 mid, 996866 outer, 996862 shoes | R1 W5 S4 yes → R2 W5 S5 yes | 184: len low_hip, slv 3/4/∅, corrected: sleeve_shape None→voluminous<br>996866: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece<br>model watchFor: "Ensure sleeve bulk does not pull at the puffer jacket shoulders." | 266 top 20/29<br>105 bot 4/24<br>184 out 4/7<br>996866 out 1/7<br>996862 sho 3/14 | endpoint warm..warm; on:L?/cold0 -184:Lwarm/warm0 -996866:L?/warm-2 -all_layers:Llight/warm-2<br>raw: layer_construction_bulk_unknown(warning), layer_construction_bulk_unknown(warning) | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | 184 is a wearable positive control. Surfacing failure: two unknown-bulk findings stayed in debug while the card was delivered as ready, and the model's own watchFor warned of sleeve bulk. Deterministic false positive (counterfactual): the corrected voluminous shape produces a hard sleeve conflict for a combination the owner confirms wearable. | hard: layer_construction_sleeve_conflict(error); advisory: none |
| S2 one r1 #0<br>Brisk Morning Walking Set | 144 top, 121 bottom, 996767 outer, 996862 shoes | R1 W4 S4 no → R2 W3 S5 no | 144: len hip, slv extra_long/gathered_ruched<br>996767: len hip, slv long/straight | catalog and view truth line, incl. length, sleeve, silhouette, season, interior; worn-first photos of 8 viewed pieces | 144 cat 27/213<br>121 cat 107/213<br>996767 cat 191/213<br>996862 cat 162/213 | endpoint warm..warm; on:Lwarm/cold0 -996767:Lmoderate/warm-1<br>raw: outfit_warm_layer_recommended_for_cool_conditions(advisory) | ready (not diagnostic); flags: every outer layer here is recorded with at least two thin-construction | Weather calibration: the evaluator reads a turtleneck plus a moderate jacket as reaching the warm target (0). Model judgment: it received the thin-outer-layer system note, also shown on the card, and delivered anyway. It never viewed insulated outerwear. | identical |
| S2 bundle r2 #0<br>Structured Casual Motion | 137 top, 104 bottom, 996866 outer, 990397 shoes | R1 W5 S5 yes → R2 W5 S5 yes | 996866: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 137 top 8/29<br>104 bot 12/24<br>996866 out 1/7<br>990397 sho 2/14 | endpoint warm..warm; on:Lwarm/cold0 -996866:Lmoderate/warm-1<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | No problem (control). | identical |
| S2 bundle r2 #3<br>Ribbed Knit Active Layer | 225 top, 121 bottom, 996866 outer, 990397 shoes | R1 W4 S4 no → R2 W3 S5 no<br>"slevveless top does not make it a good fit for 46 degree weather" | 225: len high_hip, slv sleeveless/∅<br>996866: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 225 top 11/29<br>121 bot 7/24<br>996866 out 1/7<br>990397 sho 2/14 | endpoint warm..warm; on:Lwarm/cold0 -996866:Lvery light/warm-3<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | Weather calibration: at a flat 46°F a sleeveless very-light base under the puffer is tolerated; owner: a sleeveless top is not a good fit for 46°F. Model judgment. | identical |
| S2 bundle r2 #4<br>Graphic Utility Stride | 351 top, 230 bottom, 996866 outer, 990397 shoes | R1 W4 S5 no → R2 W4 S5 no | 996866: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 351 top 24/29<br>230 bot 24/24<br>996866 out 1/7<br>990397 sho 2/14 | endpoint warm..warm; on:Lwarm/cold0 -996866:Lmoderate/warm-1<br>raw: no findings | ready (not diagnostic); flags: combining a black graphic tee with olive cargo pants and a navy puffer; critic: noted; repair: unchanged | No recorded weather cause; the critic noted tone (surfaced). | identical |
| S2 bundle r2 #2<br>Classic Stripe & Denim Walk | 266 top, 109 bottom, 996866 outer, 990397 shoes | R1 W5 S5 yes → R2 W5 S5 yes | 996866: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece<br>model watchFor: "Check sleeve length at the wrist under the jacket." | 266 top 20/29<br>109 bot 14/24<br>996866 out 1/7<br>990397 sho 2/14 | endpoint warm..warm; on:Lwarm/cold0 -996866:Llight/warm-2<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | No problem. | identical |
| S2 bundle r1 #4<br>Ribbed Tank and Utility Denim | 225 top, 109 bottom, 131 mid, 996866 outer, 990397 shoes | R1 W5 S5 no → R2 W5 S5 no<br>"this cardigan is longer then this jacket / cardigan is longer then the jacket" | 225: len high_hip, slv sleeveless/∅<br>131: len mid_thigh, slv long/fitted, corrected: length_hits_at mid_thigh→knee<br>996866: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 225 top 11/29<br>109 bot 14/24<br>131 out 3/7<br>996866 out 1/7<br>990397 sho 2/14 | endpoint warm..warm; on:Lwarm/cold0 -131:Lwarm/warm0 -996866:Lmoderate/warm-1 -all_layers:Lvery light/warm-3<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | Payload omission: length never reached the composer. Deterministic-model gap: no hem-overhang question. Metadata defect: 131 length (mid_thigh→knee, corrected). | identical |
| S2 bundle r1 #0<br>Textured Knit and Corduroy | 84 top, 104 bottom, 131 mid, 996866 outer, 990397 shoes | R1 W4 S5 no → R2 W4 S5 no<br>"this cardigan is longer then this jacket / the cardigan is longer then the jacket and it overshoots 46 for a brisk walk, also too bulky bc of the mustard knit sweater sleeves" | 84: corrected: sleeve_shape None→voluminous<br>131: len mid_thigh, slv long/fitted, corrected: length_hits_at mid_thigh→knee<br>996866: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 84 top 6/29<br>104 bot 12/24<br>131 out 3/7<br>996866 out 1/7<br>990397 sho 2/14 | endpoint warm..warm; on:Lvery warm/cold1 -131:Lwarm/warm0 -996866:Lwarm/warm0 -all_layers:Lmoderate/warm-1<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | Payload omission: the composer never received length_hits_at, although even the old mid_thigh value already exceeds the puffer's low_hip hem. Deterministic-model gap: no hem-overhang question exists. Metadata defect: 131 length (mid_thigh→knee, corrected). Weather calibration: very warm (+1 at the cold end) tolerated for a brisk walk.<br><i>84 corrected by owner retag; the owner also reported sleeve bulk in this stack; no open metadata question.</i> | identical |
| S2 bundle r2 #1<br>Earthy Walk Layer | 254 top, 230 bottom, 996866 outer, 990397 shoes | R1 W4 S5 no → R2 W4 S5 no | 996866: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 254 top 16/29<br>230 bot 24/24<br>996866 out 1/7<br>990397 sho 2/14 | endpoint warm..warm; on:Lwarm/cold0 -996866:Lmoderate/warm-1<br>raw: no findings | ready (not diagnostic); flags: the brown graphic tee and olive cargo pants present tones that are som; critic: noted; repair: unchanged | No recorded weather cause; the critic noted tone (surfaced). | identical |
| S2 bundle r1 #1<br>Stripe and Denim Movement | 137 top, 109 bottom, 142 mid, 996866 outer, 996862 shoes | R1 W5 S5 yes → R2 W5 S5 no<br>"good fit for the weather, but the vest is longer then the jacket" | 142: len mid_thigh, slv sleeveless/∅<br>996866: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 137 top 8/29<br>109 bot 14/24<br>142 out 5/7<br>996866 out 1/7<br>996862 sho 3/14 | endpoint warm..warm; on:Lwarm/cold0 -142:Lwarm/warm0 -996866:Lmoderate/warm-1 -all_layers:Lmoderate/warm-1<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | Owner-only preference: a long vest below the puffer is potentially plausible; owner would not wear it. Not a physical rule. Payload omission: length never reached the composer. | identical |
| S2 one r2 #0<br>Brisk Morning Walk Outfit | 144 top, 107 bottom, 996767 outer, 996862 shoes | R1 W4 S4 no → R2 W3 S5 no | 144: len hip, slv extra_long/gathered_ruched<br>996767: len hip, slv long/straight | catalog and view truth line, incl. length, sleeve, silhouette, season, interior; worn-first photos of 8 viewed pieces | 144 cat 27/213<br>107 cat 96/213<br>996767 cat 191/213<br>996862 cat 162/213 | endpoint warm..warm; on:Lwarm/cold0 -996767:Lmoderate/warm-1<br>raw: outfit_warm_layer_recommended_for_cool_conditions(advisory) | ready (not diagnostic); flags: every outer layer here is recorded with at least two thin-construction | **Deterministic false positive → downstream weather harm.** The model proposed the puffer first. The sleeve rule returned a "checkable sleeve conflict" for 144 (extra_long / gathered_ruched) under 996866, which the owner rules wearable. The model swapped to the thin olive jacket, which drew the thin-layer note, and the result was rated weather 3, would not wear.<br><i>Weather calibration (moderate plus moderate read as warm) also applies, as in r1.</i> | identical |
| S2 bundle r1 #2<br>Graphic Tee and Cargo Utility | 351 top, 230 bottom, 238 mid, 996866 outer, 990397 shoes | R1 W5 S5 no → R2 W4 S5 no<br>"the cardigan sleeves are too bulky, wont fit under this jacket / good fit for the weather, but the cardigans sleeves are too bulky and won't fit under this jacket" | 238: len hip, slv long/∅, corrected: sleeve_length long→extra_long; sleeve_shape None→voluminous<br>996866: len low_hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 351 top 24/29<br>230 bot 24/24<br>238 out 6/7<br>996866 out 1/7<br>990397 sho 2/14 | endpoint warm..warm; on:L?/cold0 -238:Lwarm/warm0 -996866:L?/warm-1 -all_layers:Lmoderate/warm-1<br>raw: layer_construction_bulk_unknown(warning) | ready (not diagnostic); flags: combining the green floral knit cardigan with the olive cargo pants an; critic: noted; repair: unchanged | 238 is the incompatible control. Metadata defect: 238 sleeve length and shape (corrected). Surfacing failure: the unknown-bulk finding stayed in debug. Payload omission: sleeve facts never reached the composer. The critic noted only tone.<br><i>The corrected-data verdict matches the owner, but for the wrong reason: shape does not encode the non-compressible sleeve structure.</i> | hard: layer_construction_sleeve_conflict(error); advisory: none |
| S3 one r2 #0<br>Ditsy Floral Popover & Slim Denim with Layering Cardigan | 996782 top, 131 mid, 107 bottom, 218 shoes | R1 W5 S5 yes → R2 W5 S5 yes | 131: len mid_thigh, slv long/fitted, corrected: length_hits_at mid_thigh→knee | catalog and view truth line, incl. length, sleeve, silhouette, season, interior; worn-first photos of 8 viewed pieces | 996782 cat 80/219<br>131 cat 173/219<br>107 cat 96/219<br>218 cat 161/219 | endpoint moderate..light; on:Lmoderate/cold0 -131:Llight/warm0<br>raw: no findings | ready (not diagnostic); no flags | No problem. | identical |
| S3 bundle r2 #2<br>Textured Knit & Corduroy | 990395 top, 104 bottom, 996859 shoes, 142 outer | R1 W4 S4 no → R2 W4 S4 no | 142: len mid_thigh, slv sleeveless/∅ | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 990395 top 9/29<br>104 bot 13/24<br>996859 sho 8/14<br>142 not in roster (repair candidate) | endpoint moderate..light; on:Lmoderate/cold0 -142:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); flags: Reads volume-heavy; check that one piece anchors the outfit. / the muted mauve top and vibrant emerald green corduroy pants introduce; critic: noted; repair: added layer | No recorded weather cause; the critic noted tone and the proportion flag surfaced.<br><i>Repaired card (vest 142 added by repair).</i> | identical |
| S3 bundle r1 #0<br>Stripe and Denim Ease | 349 top, 109 bottom, 996767 outer, 198 shoes | R1 W5 S5 yes → R2 W4 S5 no<br>"top overshoot for 72, great for 62" | 349: corrected: sleeve_shape None→straight; length_hits_at hip→high_hip; fiber_content ["unknown"]→["wool","rayon"]<br>996767: len hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 349 top 7/29<br>109 bot 20/24<br>996767 out 6/7<br>198 sho 5/14 | endpoint moderate..light; on:Lwarm/cold1 -996767:Lmoderate/warm1<br>raw: layer_construction_bulk_unknown(warning) | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | Warm-end weather-selection and calibration issue only: the model chose a visibly and structurally moderate long-sleeved knit plus outerwear at 72°F, having been shown warmth: moderate. The evaluator silently tolerates +1 at the warm end.<br><i>Missing fiber metadata was not the primary cause; sleeve construction is not an explanation for this rating.</i> | hard: none; advisory: none |
| S3 one r1 #0<br>Classic Striped Knit with Dark Denim & Cardigan | 137 top, 107 bottom, 88 outer, 196 shoes | R1 W5 S5 yes → R2 W5 S5 yes | 88: len low_hip, slv long/deep_armhole | catalog and view truth line, incl. length, sleeve, silhouette, season, interior; worn-first photos of 10 viewed pieces | 137 cat 23/237<br>107 cat 96/237<br>88 cat 190/237<br>196 cat 170/237 | endpoint moderate..light; on:Lwarm/cold1 -88:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); no flags | No problem. | identical |
| S3 bundle r2 #0<br>Nautical Stripe & Linen Ease | 137 top, 129 bottom, 996862 shoes, 142 outer | R1 W5 S5 yes → R2 W4 S5 no | 142: len mid_thigh, slv sleeveless/∅ | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 137 top 10/29<br>129 bot 2/24<br>996862 sho 4/14<br>142 not in roster (repair candidate) | endpoint moderate..light; on:Lmoderate/cold0 -142:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); flags: Reads volume-heavy; check that one piece anchors the outfit.; critic: not flagged; repair: added layer | No recorded cause; rating fell in round 2 with no note. Proportion flag surfaced.<br><i>Repaired card (vest 142 added by repair).</i> | identical |
| S3 bundle r1 #1<br>Knit Shell and Wide-Leg Linen | 996793 top, 129 bottom, 131 outer, 215 shoes | R1 W5 S5 yes → R2 W5 S5 yes | 131: len mid_thigh, slv long/fitted, corrected: length_hits_at mid_thigh→knee | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 996793 top 25/29<br>129 bot 2/24<br>131 out 1/7<br>215 sho 7/14 | endpoint moderate..light; on:Lwarm/cold1 -131:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); flags: Reads volume-heavy; check that one piece anchors the outfit.; critic: not flagged; repair: unchanged | No problem. | identical |
| S3 bundle r2 #4<br>Graphic Tee & Tapestry Pants | 990354 top, 114 bottom, 131 outer, 215 shoes | R1 W5 S5 yes → R2 W5 S5 yes | 131: len mid_thigh, slv long/fitted, corrected: length_hits_at mid_thigh→knee | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 990354 top 19/29<br>114 bot 22/24<br>131 out 1/7<br>215 sho 7/14 | endpoint moderate..light; on:Lwarm/cold1 -131:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | No problem. | identical |
| S3 bundle r1 #2<br>Artisan Midi Skirt with Knit | 84 top, 92 bottom, 250 outer, 996859 shoes | R1 W4 S5 no → R2 W5 S5 yes | 84: corrected: sleeve_shape None→voluminous<br>250: len waist, slv long/∅ | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 84 top 4/29<br>92 bot 5/24<br>250 out 3/7<br>996859 sho 8/14 | endpoint moderate..light; on:Lwarm/cold1 -250:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); flags: Contains a piece the occasion/activity profile usually discourages.; critic: not flagged; repair: unchanged | No problem in round 2 (round 1 weather 4, would not wear; no note). | identical |
| S3 bundle r1 #4<br>Graphic Tee and Utility Pants | 351 top, 114 bottom, 996764 outer, 990397 shoes | R1 W5 S5 yes → R2 W5 S5 yes | 996764: len hip, slv long/voluminous | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 351 top 16/29<br>114 bot 22/24<br>996764 out 5/7<br>990397 sho 3/14 | endpoint moderate..light; on:Lwarm/cold1 -996764:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: unchanged | No problem. | identical |
| S3 bundle r1 #3<br>Button-Up and Corduroy Utility | 133 top, 104 bottom, 996862 shoes, 142 outer | R1 W5 S5 yes → R2 W4 S5 no | 142: len mid_thigh, slv sleeveless/∅ | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 133 top 5/29<br>104 bot 13/24<br>996862 sho 4/14<br>142 not in roster (repair candidate) | endpoint moderate..light; on:Lmoderate/cold0 -142:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); no flags; critic: not flagged; repair: added layer | No recorded cause; rating fell in round 2 with no note.<br><i>Repaired card (vest 142 added by repair).</i> | identical |
| S3 bundle r2 #1<br>Utility Trench & Striped Knit | 349 top, 109 bottom, 996759 outer, 196 shoes | R1 W4 S5 no → R2 W4 S5 no<br>"might be too warm / top overshoot for 72, great for 62" | 349: corrected: sleeve_shape None→straight; length_hits_at hip→high_hip; fiber_content ["unknown"]→["wool","rayon"]<br>996759: len knee, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 349 top 7/29<br>109 bot 20/24<br>996759 out 7/7<br>196 sho 6/14 | endpoint moderate..light; on:Lwarm/cold1 -996759:Lmoderate/warm1<br>raw: layer_construction_bulk_unknown(warning) | ready (not diagnostic); flags: Contains a piece the occasion/activity profile usually discourages.; critic: not flagged; repair: unchanged | Warm-end weather-selection and calibration issue only: the moderate wool-blend knit plus a trench at 72°F, warmth: moderate shown. Evaluator: +1 at the warm end tolerated.<br><i>Missing fiber metadata was not the primary cause; sleeve construction is not an explanation for this rating.</i> | hard: none; advisory: none |
| S3 bundle r2 #3<br>Black Dress & Field Jacket | 996791 dress, 996767 outer, 198 shoes | R1 W4 S4 no → R2 W3 S4 no<br>"dress is too warm / dress is too hot for 72" | 996767: len hip, slv long/straight | bundle line: warmth, weight, fabric, fit, tuck, hem; no length, sleeve, silhouette, season or interior; worn-first photo of every roster piece | 996791 dre 4/9<br>996767 out 6/7<br>198 sho 5/14 | endpoint moderate..light; on:Lwarm/cold1 -996767:Lmoderate/warm1<br>raw: no findings | ready (not diagnostic); flags: Contains a piece the occasion/activity profile usually discourages.; critic: not flagged; repair: unchanged | Model judgment: the knit sheath dress at 72°F. Weather calibration: +1 at the warm end with the jacket off tolerated.<br><i>Dresses were absent from the one-outfit catalog in 4 of 6 attempts (model-chosen search categories).</i> | identical |

## 4 · Experiment-wide rules (owner, 2026-09-14)

- **Order.** A (construction probe), then B (payload completeness), then C (controlled count). No provider call is made until each contract is pre-registered and approved.
- **Composer-only boundary.** B and C preserve the complete upstream production process that builds the composer request:
  - context resolution (occasion, activity, weather, location, date);
  - hard eligibility and automatic-use suppression;
  - ranking, category caps and roster order;
  - photograph selection and thumbnailing;
  - prompt assembly.

  The run stops **immediately after the composer response**. Skipped, and only these: post-composition slot repair, local outfit gating, backfill, critic, and missing-layer repair. "Composer-only" never bypasses the production candidate-pool logic. A permanent contract test proves that, before the declared substitutions (garment line, sleeve sentence, held-out paragraph, token budget, count), the composer receives the same roster, order and resolved context as production. Later stages may be replayed separately against the frozen raw outputs. Repair-usage instrumentation is not a prerequisite.
- **Sleeve guidance in model-facing text.** The current categorical sleeve rule is a known false judgment. It is not kept merely because it could be applied identically to both arms. In A it is withheld entirely. In B and C, both arms receive this neutral sentence in its place:

  > Sleeve shape and relative sleeve length alone do not establish whether two garments layer. Inspect the photographs for sleeve structure, compressibility and the intended treatment, and state uncertainty when the evidence is insufficient.

- **Deterministic sleeve finding.** In every experiment it is log-only. It is computed offline against the frozen raw outputs, hidden from every model, and has no effect on eligibility, ranking, delivery, critic or repair. Because B and C stop at the raw composer output, no downstream consumer of the finding runs at all (§9).
- **Photographs.** A shows both labelled photographs of every garment. B and C keep the current production photograph selection (worn photo first, hanger photo only when no worn photo exists) identically in both arms. Every harness records, per garment, exactly which image file was sent and its sha256. A hanger-versus-worn experiment may be designed separately later.
- **Snapshot and source.** One new frozen snapshot, taken after the owner's metadata review, serves all three contracts. The pre-registration records the six database-file hashes, git HEAD, the `git diff --binary HEAD` sha256, and zero untracked files. Each call runs on a fresh copy.
- **Provider.** Gemini 3.5 Flash-Lite, thinking low. Normalized, wire and output capture share one callId per call. Every attempt is kept, with no reruns or replacements; failures are reported as outcomes.

## 5 · Contract A — controlled construction-discrimination probe (approved in principle)

**Question.** Given complete facts and photographs, and no engine verdict, can the model distinguish soft, compressible sleeve volume from substantial, non-compressible sleeve volume?

- **Pairings.** Three separate pairings, each with outer garment 996866: inner 144, inner 184, inner 238. One call per pairing.
- **Shown.**
  - For both garments: name, category, and the complete structured truth line (§8).
  - For both garments: two clearly labelled photographs, "hanger photo" then "worn photo".
  - A neutral instruction: the inner garment is worn under the outer garment with both sleeves on.
- **Withheld.** Weather, occasion, any engine verdict, the current categorical sleeve rule, the neutral sleeve sentence, rotation and feedback memory, and the truth table.
- **Required output (schema).**
  - `verdict`: `workable` | `unworkable` | `genuinely_uncertain`.
  - `construction_evidence`: at least one `{ garment: inner|outer, source: photo|fact, observation }`.
  - `sleeve_treatment`: required for `workable` — how the inner sleeve sits (compresses, bunches softly, shows at the cuff intentionally, …).
  - `uncertainty_reason`: required for `genuinely_uncertain`.
- **Replicates.** 3 per pairing (9 calls), in a pre-registered randomized order with a recorded seed.
- **Truth table.**
  - 144 under 996866: workable. Soft, compressible ruching; an intentionally visible longer cuff is legitimate.
  - 184 under 996866: workable. The voluminous sleeve is soft enough to compress.
  - 238 under 996866: unworkable, because its sleeve has substantial non-compressible volume — not because its shape tag is voluminous.
- **Scoring.**
  - **Primary:** verdict agreement per call, reported per pairing. `genuinely_uncertain` is reported separately and never counted as correct.
  - **Secondary:** grounding. The owner marks each evidence item supported or unsupported by what was shown; an unsupported construction claim is a grounding failure. For `unworkable` on 238, the stated reason must identify substantial non-compressible volume; a shape-tag-only reason is scored as a correct verdict with incorrect grounding.
  - Descriptive only; no pooling threshold.

## 6 · Contract B — payload completeness (composer-only; runs before C)

**Question.** Is the bundle's thin garment payload itself causing the selection failures?

- **Arms.**
  - **B0:** the current thin composer garment line.
  - **B1:** the complete fact line already available to the one-outfit flow (§8).
  - The garment line is the only difference.
- **Held fixed.**
  - The Whole Wardrobe composer request builder, provider and model.
  - Prompt, including the neutral sleeve sentence in both arms.
  - Schema and requested count 5.
  - Output token budget: the current five-card budget.
  - Roster membership and order, and the production photograph selection.
  - Weather evidence and all request context.
  - The production five-card instruction text, including the comparison-set paragraph, in both arms.

  B is not a replay of production composition. Both arms also substitute the neutral sleeve sentence for the categorical rule, and both stop before production's downstream stages. **The garment line is the only difference between B0 and B1**, and that is the causal claim B makes.
- **Scenarios.** S1 65/50, S2 46°F walking, S3 72/62 × 2 arms × exactly 2 replicates = **12 composer calls**. Counterbalanced pre-registered order; each on a fresh snapshot copy.
- **Preserved.** Raw composer output, parsed slots, the complete request (normalized and wire), and the per-garment image manifest.
- **Rated object.** Raw composer cards, rendered on blind hanger-first review sheets. Sheet rendering is a presentation choice and is separate from what the model saw.
- **Outcomes.**
  - Per-card owner ratings: weather adequacy, style and intent, would wear.
  - Construction acknowledgement per card for each non-obvious sleeve or hem interaction: grounded intentional treatment stated in `styling_instructions` / silent / unsupported construction claim.
  - Truth-table coding wherever 131, 142, 144, 184, 238 or 349 appears.
  - S3 (72/62) warm-end coding. A moderate base with outerwear is **not** an automatic weather failure: outerwear may serve the 62°F end and come off at 72°F. For every S3 card, record:
    - the lightest realistic configuration (every removable layer off);
    - that configuration's warmth evidence at the warm endpoint (level and signed distance);
    - whether the model explained the layer's endpoint purpose (for example, worn at 62°F, removed at 72°F);
    - the owner's rating.

    349 is an owner-confirmed miss at 72°F in Stage 1. That does not make every moderate garment, or every removable layer, invalid at 72/62.
  - Avoidance is scored only when the model explicitly shows it considered and rejected the relationship.

## 7 · Contract C — controlled count experiment (composer-only)

**Label.** A controlled count experiment. It is **not** a replay of the complete production five-card flow.

**Question.** Does composing five cards change the model's ability to apply the same evidence to each card?

- **Arms.** Exact output count **1** versus **5**, on the same Whole Wardrobe composer.
- **Identical in both arms.**
  - Prompt.
  - Roster, order and garment facts: **always the B1 complete line**, regardless of Contract B's result. B has only two replicates per scenario, so a null result cannot show the omitted construction facts are unnecessary. B measures their effect; it is not a gate that could authorize returning to the thin payload.
  - Photographs (production selection).
  - Weather and context.
  - Neutral sleeve sentence.
  - Output token budget: the current five-card budget in both arms.
- **Held out of both arms.** The five-card-only COMPARISON SET CONTRACT and THERMAL & SEASONAL COHERENCE paragraph.
- **Only differences.**
  - The exact count, as one number in `Compose N outfits.`.
  - The schema's `minItems` and `maxItems` (1 or 5).

  The pre-registration pins the full request text of both arms and lists every character-level difference.
- **Scenarios.** S1, S2, S3 × 2 arms × exactly 2 replicates = **12 composer calls**. Counterbalanced pre-registered order; fresh snapshot copy each. Raw outputs, requests and image manifests preserved.
- **Outcome 1 — per-card quality.** Primary for the count question, reported separately from outcome 2.
  - Mean weather, mean style and would-wear proportion across all raw cards of each attempt.
  - Per-attempt means are the primary per-card measure.
  - Secondary equal-card comparison: the single card against **one card at a pre-registered, seeded position** of the same scenario and replicate's five-card output. Positions are balanced across positions 1–5 over the six five-card attempts. Position 1 is not treated as the strongest card, because the prompt does not order cards by strength, and no ordering instruction is added.
  - Construction acknowledgement and truth-table coding per card, as in B.
- **Outcome 2 — product utility.**
  - Best weather and best style of the attempt.
  - Whether the attempt produced at least one would-wear card.
  - Best-of-five has four more chances than best-of-one, so outcome 2 is never presented as evidence that each generated card is better.

## 8 · Garment evidence supplied per contract

| Evidence | A (probe) | B0 | B1 | C (both arms) |
|---|---|---|---|---|
| name, category group | yes | yes | yes | as B1 (always) |
| warmth, fabric weight, insulation, protection, fabric category | yes | yes | yes | same |
| reads_as, opacity, fit on body, tuck, hem finish, waistband, needs base, do-not-pair | yes | yes | yes | same |
| length_hits_at, sleeve length, sleeve shape (appended in B1; B0 text kept byte-for-byte) | yes | no | yes | same |
| sleeve length / sleeve shape | yes | no | yes | same |
| silhouette, season, neckline, stretch, interior construction, pattern, colours, formality | yes | no | yes | same |
| fiber content (as the one-outfit truth line states it) | yes | no | yes | same |
| photographs | hanger and worn, labelled, for both garments | production selection (worn first), source file and sha256 of the sent image recorded | same as B0 | same as B0 |
| weather, occasion | none | production scenario context | same | same |
| categorical sleeve rule | none | replaced by the neutral sentence | same | same |
| neutral sleeve sentence | none | yes | yes | yes |
| engine sleeve verdict | none | none (offline, log-only) | none | none |
| five-card comparison-set / thermal-coherence paragraph | n/a | production text (count 5) | same | **held out of both arms** |

The complete line is exactly the field set the one-outfit catalog row already carries in production; no new field is introduced.

## 9 · Sleeve verdict: how it is kept out of every arm

- **Contract A.** No engine runs. The model receives no verdict, no rule text and no neutral sentence.
- **Contracts B and C.** The composer-only harness stops after the single composer call. None of the verdict's downstream consumers runs:
  - composer slot validation;
  - the local gate;
  - backfill validation;
  - the repair screen and repair payload;
  - post-repair re-gate;
  - footwear substitution.

  `propose_outfit` and garment-fact answers are not used. The only model-facing sleeve text is the neutral sentence, identical in both arms. The deterministic finding is computed afterwards, offline, on the frozen raw outputs, and logged for comparison as evidence, not a verdict.
- **Production.** The neutral-sentence substitution and the composer-only mode exist only behind an explicitly manifested experiment. They are off by default, with permanent tests proving:
  - with the experiment off, the composer request is byte-identical to production;
  - with it on, the categorical rule text is absent, the neutral sentence is present, the five-card paragraph is absent in C, and no critic, repair or backfill call is made.
- **Implementation (2026-09-14, offline only).**
  - `WARDROBE_EXPERIMENT_COMPOSER_MANIFEST` names a manifest file that activates the mode inside the Whole Wardrobe composer function in `routes/ai.js`. With the variable unset, the route is production.
  - A named but missing or invalid manifest refuses the request instead of running production.
  - Harnesses: `scratch/ab_stage2_construction_probe.mjs` (A) and `scratch/ab_stage2_composer_only.mjs` (B and C), with the pre-registration draft `scratch/ab_stage2_preregistration.json`.
  - Permanent boundary tests in `test/aiEndpointContracts.test.js`, all labelled COMPOSER-ONLY EXPERIMENT, prove:
    - no manifest means unchanged production;
    - a manifest with no substitutions gives the composer the same system prompt, garment text, photographs (byte for byte) and token budget as production, with exactly one model call;
    - the declared substitutions change only the garment line, the sleeve sentence, the held-out paragraph and the budget;
    - one versus five cards differ only in the stated count and the schema bounds;
    - invalid manifests refuse.
- **B1 garment line (owner ruling 2026-09-14): superset.**
  - The exact production B0 line, byte-for-byte, followed by appended structured facts in the composer's own `; field: value` vocabulary. The appended fields are the ones the one-outfit catalog carries that the composer line lacks: length_hits_at, sleeve_length, sleeve_shape, silhouette, season, neckline, stretch, colours, pattern, formality, bottom and shoe construction, and outerwear interior construction.
  - Nothing is dropped or reinterpreted (hem finish, do-not-pair, reads_as, tuck, fit and explicit opacity stay), no sparse convention is assumed, and no role vocabulary such as `layer_top` or `primary_top` is added.
  - A permanent regression asserts B1 line = exact B0 line + appended fields.
  - C always uses this superset, and the Contract A probe shows the same superset line.
- **Experimental prompt condition, not production identity.** `WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS` stays enabled in both arms of B and C: the experiment tests what the model does with garment and weather evidence, not whether it follows engine labels.
- **Infrastructure.**
  - The full suite no longer rewrites any tracked file; the recall-at-cap test writes its report to a temporary directory.
  - `test/composerOnlyCaptureIntegration.test.js` drives the experiment route through the real provider path, with only the Gemini SDK request method stubbed, and proves:
    - one composer call;
    - normalized, wire and output capture records under one callId;
    - no downstream call.
- **Experiment versus production (measured, not assumed).** The earlier preflight "identity check" ran with neutral verdict words on, so it was not a production comparison. `--production-diff` now captures the actual production composer request (no manifest, neutral verdict words off) and diffs it against experimental B0 on the same snapshot.
  - **Identical:** every garment line, every image byte for byte, and the token budget.
  - **Intentional deltas:**
    1. the categorical sleeve rule replaced by the neutral sleeve sentence;
    2. the outerwear heading losing "(ordered for these conditions)";
    3. the occasion taste list removed;
    4. the activity taste list removed where the scenario has an activity (S2);
    5. the run stopping after the composer response.
  - The neutral-verdict flag's other effects act only on stages composer-only runs never reach.
  - B0 and B1 share every one of these conditions.
- **Sealed live runs.**
  - `scratch/ab_stage2_seal.mjs` writes into the pre-registration:
    - git HEAD;
    - the tracked-file diff hash, excluding the pre-registration itself, which is approved by its own sha256;
    - the six snapshot database hashes;
    - every cell's complete request identity: system text, user text parts, image bytes with media type and detail, schema, resolved model and token budget.
  - Live runners refuse, before any child process or provider call, on any mismatch. Each fresh snapshot copy is re-verified.
  - The route (B, C) and the probe (A) compare the cell's request identity immediately before the provider call and refuse on mismatch. Photographs are covered by the hash of the image bytes actually sent.
  - Tests: `test/stage2_live_guard.test.js` and the sealed-request COMPOSER-ONLY test.
- **Production (2026-09-14, owner ruling).** The sleeve-geometry verdict is now log-only across production, and the neutral sentence replaces the categorical rule in every model-facing prompt. Pins: 144 and 184 not rejected; 238 also not mechanically rejected (temporary false negative). The required ranking A/B showed 0 differences. See `docs/engine-behaviour-map.md`, amendment 2026-09-14.
- **Confirmation status.** Before any declared substitution, the composer receives the production roster, order, photographs and resolved context (proven by test); nothing runs after the composer response. The consumer inventory of the current verdict, for later production work:
  1. composer slot validation;
  2. Whole Wardrobe local gate;
  3. backfill validation;
  4. repair viability screen and payload;
  5. post-repair re-gate;
  6. footwear substitution;
  7. `propose_outfit` system notes;
  8. garment-fact layering evidence;
  9. the categorical rule text in the composer prompt and the `propose_outfit` tool description.

## 10 · Call count and cost

Rates observed in Stage 1 for Gemini 3.5 Flash-Lite: $0.30/M input, $0.03/M cached input, $2.50/M output.

| Contract | Paid calls | Basis | Estimate |
|---|---|---|---|
| A | 9 | about 4 images (about 1,080 tokens each) plus about 2k text in, about 400 out | ≈ $0.03 |
| B | 12 composer calls | about 101k input (about 90k image tokens), 1.1–1.4k out; B1 adds about 3–4k text | ≈ $0.08–0.41 |
| C | 12 composer calls | same input; the 1-card arm has much less output | ≈ $0.08–0.40 |
| **Total** | **33** | no critic, repair, backfill or other downstream calls | **≈ $0.19–0.84**; point estimate ≈ $0.40 at Stage 1's observed average composer cost (about $0.017 per call) |

The upper bound assumes no prompt caching on any composer call: about $0.033 each. Caching is likely lower in B than in Stage 1, because B1 changes text interleaved with the images.

## 10a · Contract A result, revised after owner evidence marking (2026-09-14)

**Run.** 9 calls, sealed pre-registration `fa891a49…`.
- **144 (wearable):** 3/3 `workable`.
- **184 (wearable):** 1/3 `workable`.
- **238 (incompatible):** 0/3 `unworkable`.
- No call answered `genuinely_uncertain`. All 26 evidence items were marked supported, with no invented inference.

**What "supported" measured.** A supported mark means the claim is traceable to the record or photographs the model received. It is not owner agreement with the physical claim. For 238, calls 3 and 4 were marked supported because the model was given `weight: medium`; the real knit and sleeve are fairly thick, and the owner does not agree they compress or fit.

**Evaluation-schema limitation.** The probe schema required `sleeve_treatment` only for `workable` verdicts. Calls 2 and 9 (184, `unworkable`) do give factual observations (sleeve lengths, and in call 9 the shape tag). What they lack is an explicit, parallel `compatibility_mechanism` explaining how those facts make the pairing unworkable. Their rationale is recorded as incomplete and nonparallel. Any future construction probe must require that mechanism for every verdict. A is not rerun.

**Garment-truth confounds.**
- **144:** recorded `stretch: minimal` is inaccurate (owner: `moderate`). **Pending owner retag**; the sealed Stage 2 snapshot keeps `minimal`.
- **238:** its thick, non-compressible sleeve has no field to be recorded in.

**Taxonomy audit.** The taxonomy cannot express sleeve-specific thickness, structure or compressibility.
- `sleeve_length` records length, and `sleeve_shape` records only where excess volume sits.
- Every related field (`fabric_weight`, `stretch`, `fabric_category`, `fiber_content`, `fit_on_body`, `silhouette`) describes the whole garment.

Existing garment-level proxies, recorded for later work and not changed here:
- the outer-sleeve capacity reader infers sleeve room from whole-garment silhouette and fit;
- the sleeve evidence reader computes an unused `isBulkyFabric` flag from whole-garment `fabric_weight`;
- the field reference and the engine behaviour map described a garment-weight "fabric-bulk conflict" that current code no longer implements; both were corrected on 2026-09-14 to say it is not implemented and that garment-level weight must not be treated as sleeve-specific evidence.

Owner direction: do not change a garment's whole `fabric_weight` to express a thick sleeve, and do not use garment-level weight as a sleeve-compatibility proxy.

**Revised conclusion.** A is a **metadata-representation-confounded result**.
- The current garment truth plausibly caused the model's incorrect judgments. It does not encode the physical distinction the probe tested: soft compressible versus substantial non-compressible sleeve volume.
- The model supplied no explicit photo-grounded evidence: every one of its 26 evidence items named `fact` as its source. That shows it did not cite the photographs; it cannot show whether the model internally looked at them.
- A does not show that correct construction facts would be ineffective.

Full analysis, with the owner's sheet notes verbatim: `scratch/ab_stage2_runs/2026-09-14/review/results/A-analysis-revised.md` (local, gitignored).

**Construction work stops here (owner, 2026-09-14).**
- No sleeve field and no new compatibility rule are added during the weather arc.
- The strict sleeve-geometry verdict stays disabled or log-only wherever this work controls it.
- 144's stretch retag is pending with the owner.

## 11 · Separate follow-up (outside these experiments)

The metadata To-Do audit:
- Covers every garment field that can affect eligibility, scoring or construction review, including sleeve shape and length and the newer thermal evidence.
- Asks whether an actionable task is generated when a real evaluation hits that missing field.
- Also covers the orphan-task bug visible in the UI.

Existing tasks do clear after a correct retag. The audit stays out of experiments A–C.
