# Engine behaviour map

**Status:** twelfth pass, 2026-07-26; **amended 2026-09-11** for cool layer advisory transition, visual composer temperature prompt disclosure, whole-wardrobe advisory system flags, single-note advisory collapse, and the required cool-layer prompt contract; **amended 2026-09-11** for database safety guardrails, script isolation, and prohibition of live db bypass under test; **amended 2026-09-11** for trip roster duration context, crossover reusability, and vacation dining defaults; **amended 2026-09-11** for biometeorological weather unification with the Matzarakis PET scale; **amended 2026-09-10** for freeform stylist chat parity with ratified weather physics, catalog salience, and advisory findings; **amended 2026-08-25** for the shared eligibility API retirement
audit and canonical applicability projection; **amended 2026-08-12** to add the owner-constraint gate (which
shipped with item 12 and had never been recorded here) and the capsule roster prompt cache, the
seventh cache and the only one covering images; **amended 2026-08-14** to trace `fiber_content`'s
two other consumers (`pieceHasWetSensitiveFootwearMaterial`, `capsuleVersatilityScore`'s summer
term) alongside the already-documented hot-weather clause, finding one live gap and one latent one;
**amended 2026-08-25** also to remove two undocumented provider-side prompt-cache writes
(whole-wardrobe generation, critique/feedback `full` and `followup`) that were never read back;
**amended 2026-08-26** to remove an eighth, message-level image-manifest cache on the whole-wardrobe
composer (measured 0 reads against 30-49k written tokens on every sampled call) — see
`docs/deferred-conversational-cache-spec.md`; **amended 2026-08-26** again to add the new
`evaluateLayerPairConstruction` sleeve layer-pair verdict and its `evaluateWearableOutfit` stage;
**amended 2026-08-26** once more for `layerDirectionPromptRule()` and the verified
`OUTFIT_EVALUATOR_GATE_SYSTEM` register/footwear fix.
Companion to `docs/app-surface-map.md`.
**[amended 2026-09-11 — cool layer advisory transition, visual composer temperature prompt disclosure, and whole-wardrobe advisory system flags]**
Investigation of Whole Wardrobe Visual Composer run `thread_1789171122124` (smart casual, fall in Walnut Creek, CA at 65°F high / 46°F low) identified hard rejection of valid indoor separates under `NO_REMOVABLE_COOL_LAYER` and missing numerical temperatures in the prompt tail:
1. **Cool Layer Findings Demoted to Advisory**: In `styling-engine/outfitEnvironmentalAdequacy.js`, `NO_REMOVABLE_COOL_LAYER`, `NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT`, and `COOL_LAYER_IS_SEE_THROUGH` are demoted from hard errors (`severity: 'error'`) to advisory warnings (`severity: 'warning'`, `kind: 'advisory'`, `remedy: false`). Cool-tier conditions (`needsRemovableCoolLayer` / `transitNeedsRemovableCoolLayer`) recommend something to put on, but lack of a layer or a sheer layering piece is a weather note rather than a physical invalidity blocking delivery. Hard presence gates (`NO_WARM_LAYER_FOR_COLD`) remain strictly reserved for severe cold (`coldPresenceRequirement.state === 'required'`).
2. **Whole Wardrobe Visual Composer Advisory Flags**: In `styling-engine/rules.js` (`locallyGateWholeWardrobeOutfits`), non-blocking advisory findings (`validation.advisoryFindings`) are mapped and appended to `repaired.systemFlags` as `{ type: 'Weather note' | 'Fit note', message }`, mirroring `outfitSetPlanner.js`. In `src/components/StylistChat.jsx`, valid cards (`!isBrokenCard`) render these flags cleanly as `.stylist-outfit-flag-chip` chips.
3. **Visual Composer Temperature & Location Prompt Disclosure**: In `routes/ai.js` (`generateWholeWardrobeOutfitsVisualInternal`), numerical high/low temperatures (`Temperature: ${tempText}`) and resolved location (`Location: ${location}`) are explicitly injected into the prompt tail alongside occasion and season, giving the model clear physical awareness of diurnal temperature drops rather than generic seasonal inference.

4. **One shortfall, one card-face note**: a layerless cool day trips three findings at once — `NO_REMOVABLE_COOL_LAYER` (removability), `WARM_LAYER_RECOMMENDED` (presence) and `THERMAL_UNDERSHOOT` (amount) — and live run `thread_1789174415595` showed all three as near-identical `Weather note` chips. The engine still records all three (each carries its own evidence, and §2.1 keeps the three questions apart deliberately); the **projection** now collapses them. `collapseWarmthAdvisoryFindings()` in `styling-engine/outfitEnvironmentalAdequacy.js` keeps only the most informative member of that family, and `advisoryFindingsToSystemFlags()` is the single shared findings-to-chips projection, replacing the prose-identical copies in `styling-engine/rules.js` (`locallyGateWholeWardrobeOutfits`) and `styling-engine/outfitSetPlanner.js`. Freeform (`styling-engine/tools.js`) collapses the same family before building its advisory notes, keeping its own THERMAL_UNDERSHOOT elaboration. An undershoot on an outfit that HAS a layer, and every non-warmth advisory (rain, overshoot, fit), are untouched.
5. **Cool-layer prompt stated as a requirement**: the composer's `COOL/COLD WEATHER GUIDANCE` line read *"When the shown pieces support it, pair the outfit with an appropriate outerwear layer"* and was taken as optional — three of five cards in that run carried no layer at all from a roster showing nine outerwear pieces. It now states the layer as required, sized against the measured demand level (`requiredThermalBand`, the same 5-level vocabulary each piece line already carries in its own `warmth:` field), names see-through layers as not counting, and gives one honest way out: say so in that outfit's reason rather than shipping a layerless outfit in silence.


**[amended 2026-09-12 — the cool-end layer block becomes evidence, and the roster disclosure stops overclaiming]**
Live run `2077` (`thread_1789195830570`, same 65°F/46°F Walnut Creek context) tested the previous day's requirement wording and **reversed its own premise**. The composer did layer all five cards — but four used a `moderate` or `very light` layer against a `warm` demand, and every one drew a `THERMAL_UNDERSHOOT` note. The full provider capture (`/tmp/provider-capture`, `WARDROBE_CAPTURE_PROVIDER_INPUT_DIR`) shows why, and the reasons are prompt-authoring defects, not model failure:
1. **The requirement contradicted itself.** "must include a removable layer … whose stated `warmth:` reads about warm" was followed by "A midweight knit or cardigan counts" — a licence for exactly the layers the demand excludes. The model took the licence.
2. **The roster disclosure overclaimed.** "Off-season pieces have been deprioritized or removed; everything shown is weather-optimized" fired whenever a demand existed, asserting the roster had settled a question it had only partly settled — weather removal on run 2077 was 12 footwear pieces (`cold weather: open-toe/warm-weather footwear`) and nothing else, while every layer from `very light` to `warm` stayed and was described as "weather-optimized". Note for future readers: the two removal stages are reported in DIFFERENT debug fields — `suppressedReasonCounts` (automatic-use, pre-roster) and `excludedCounts` (pool evaluation). Reading only the second says "nothing was removed for weather" on a run that removed twelve pieces; the first pass of this investigation made exactly that error, and so did the first version of the replacement counter until the hot-weather contract test caught it.
3. **Three contracts could not all hold.** "different visual thesis" + "consistent thermal weight across the batch" + "every outfit reaches `warm`", with exactly ONE owned piece reading `warm` (996867) and no roster base above `moderate` — so `outfitThermalContribution`'s both-halves-≥-`warm` step-up can never fire in this wardrobe and the coat is the only route to the demand. The model resolved the impossibility by levelling down.
Per AGENTS.md principle 3 (*code constrains, the model judges*), `generateWholeWardrobeOutfitsVisualInternal` now **discloses evidence instead of issuing an instruction** — the same shape the trip flow already ships via `slotThermalDemandLabel` (reused here, not reimplemented):
- the `Temperature:` line carries the demand in the **label vocabulary** (`… the whole outfit needs to read about \`warm\`; every piece states its own \`warmth:\``);
- `COOL-END LAYER` replaces `COOL/COLD WEATHER GUIDANCE`: it states the need for something removable, **counts how many shown outerwear pieces read the demand level or above** (untagged layers counted neither way — criterion 8), notes that sheer/semi-sheer adds no warmth, and says explicitly that repeating one layer over different bases is not a variety failure — the fact that resolves conflict 3 without choosing for the model;
- the roster disclosure now states **what actually happened**: a count of pieces removed for weather (summed across BOTH stages — automatic-use `suppressedPieces.reasons[]` and the pool's `excluded.reason`), or "No piece was removed for weather". The ordering half of that sentence was corrected in the same pass for the same species of defect: the roster is ordered by `getRelevanceScore`, which blends occasion score, confirmed-outfit history and session recency with the thermal ranking fit — calling that "ordered by weather fit" is an overclaim, and the run's own outerwear order proves it (a `moderate` tweed jacket ahead of the `warm` wool coat, a `very light` vest third).
**Follow-up the same day, after live run `thread_1789199118192` tested the evidence wording:** the block was delivered verbatim (capture confirms, repetition permission included) and changed nothing material — 5/5 cards layered again, but still exactly ONE layer met the demand; the chip count fell 4→3 only because the model picked the one untagged layer, whose `unknown` fit silences the finding rather than satisfying it. The tell was in its own prose: a `warmth: very light` cashmere vest described as worn "for warmth", contradicting a label it had been handed. The demand was stated ~2,000 characters from the labels it had to be compared against, so `generateWholeWardrobeOutfitsVisualInternal` now puts it **at the point of choice**:
- the OUTERWEAR section heading carries it — `=== OUTERWEAR (these conditions call for \`warm\`; listed best-fit first) ===` — and no other category heading does, since warmth is the layer's question and re-ranking tops or shoes by it would let one axis outrank the roster's whole relevance ordering;
- within that section, layers are ordered best-fit-first by `orderLayersByThermalFit()` (exported for its contract test), which reads the shared `thermalRankingFit` primitive rather than `compareThermalFit` — fit membership alone flattens a puffer and a cardigan into one bucket on a coarse forecast, which is the ordering this exists to produce. Ranking, never gating: every layer is still shown, and an **untagged** layer holds its incoming relevance slot instead of being demoted, so missing metadata never behaves like inadequacy. That slot reservation is deliberately not a comparator branch — a comparator that falls back to index whenever one side is `unknown` is non-transitive, and the first version of it put a `light` vest ahead of a `warm` coat for exactly that reason.
Not in this pass, recorded as open: the tail still carries four separate weather voices (`TIME-OF-DAY WEATHER`, `COOL-END LAYER`, `THERMAL & SEASONAL COHERENCE`, the occasion profile's "light outerwear") with no stated precedence between occasion and weather, the shared system template spends ~11 mentions on accessories and jewelry in a call where accessories are excluded from the roster entirely, and the feedback-memory block ships duplicate and mid-sentence-truncated entries.
**[amended 2026-09-15 — removed from the default path]** `COOL-END LAYER`, the ordered-outerwear heading and the whole `TIME-OF-DAY WEATHER` paragraph are gone from the Whole Wardrobe composer tail, and `/ask`'s `thermal_guidance` band target with its prompt sentences is gone too. The stated range and request text remain (`docs/garment-evidence-parity-2026-09-15.md` §7).

**[amended 2026-09-15 — the remaining two weather voices in the tail, plus the shared cold-guidance
formula, are rewritten (owner ruling)]** Three prompt blocks changed, all named in the "four separate
weather voices" and "coat / three-layer weather formula" open items above:
- `COMPARISON SET CONTRACT` (`routes/ai.js`, `generateWholeWardrobeOutfitsVisualInternal`) dropped
  "use meaningfully different outfit formulas or clearly different silhouettes/proportion logic" —
  forced cross-formula diversity meant a card could be pushed toward a WEAKER alternative merely to
  look different from its neighbor. Replaced: each card must be worthwhile on its own; a meaningful
  alternative is welcome, never mandatory over a sound repeat.
- `THERMAL & SEASONAL COHERENCE` (same block) is renamed `OUTFIT CONDITIONS FIT` and dropped the
  blanket "must share a consistent thermal and seasonal weight" / "do not mix warm-weather pieces
  with cool-weather pieces across the batch" rule — the old heading named a BATCH property that no
  longer exists as a requirement, so it kept implying uniformity across cards even after the rule
  under it stopped requiring one. Uniform thermal weight across a comparison SET is not itself a
  correctness criterion; each card is judged individually against the user's stated conditions and
  exposure. A removable layer now counts only when the card actually includes it and it is
  realistically wearable in that outfit — the rule no longer permits crediting a layer the model
  merely gestures at via invented indoor stops or timing.
- `PHYSICAL_WEARABILITY_REALISM_RULES`'s "Thermal Adequacy" line (`styling-engine/prompts.js`,
  shared by every composer that interpolates the block — Whole Wardrobe, single-outfit,
  propose_outfit, saved-variant) dropped the "insulating coat over a top, or an intentional 3-layer
  system with a middle knit layer" formula and its implicit garment-category prescription. First
  replaced with a judgment instruction that still named the retired formula to disclaim it
  ("there is no required insulating-coat-or-three-layer-system prescription"); on a second owner
  pass that meta-negation was removed too — spelling out the old formula to reject it still gave it
  presence in the prompt. Final wording states only the positive task: judge the whole worn system's
  protection against the stated exposure, from each garment's own recorded facts, photographs, and
  construction, and explain the concrete shortfall if protection looks inadequate. No formula, no
  named category, no reference to what used to be required. Full before/after text and rationale:
  `docs/model-flow-prompt-ownership-audit.md` "Carried forward for the categorical-prompt audit."

**[amended 2026-09-16 — thread_1789526496845, four findings, reopened once for a wrong first pass]**

1. **Weather timing — reopened twice.** A request stated "walking around outdoors from 1–6 p.m."
   alongside "the forecast is 50°F high and 40°F low". **First attempt:** hedged the composer's
   `Temperature:` line itself ("timing within the day unknown") — contradicted the ratified contract
   (`docs/app-surface-map.md`, 2026-09-12 ruling, the "Temperatures you'll be out in" UI field this
   same composer serves) that `weatherProfile.highF/lowF` is taken VERBATIM as the range the wearer
   will actually be outside in. Reverted. **Second attempt:** fixed the real upstream cause — the
   model translating a daily-forecast sentence into the certain `user_weather.high_f/low_f` field —
   by having the schema instruct the model to convert an ambiguous daily-forecast statement into a
   qualitative `temperature_band` instead of a numeric range. This discarded real numeric evidence:
   `requiredThermalBand` returns `level: null` for a band-only input (no resolvable `wakingLowF`), so
   the evaluator went completely silent — no thermal opinion at all, which is not the same thing as a
   fixed timing defect, and is arguably worse (a genuine 40-50°F day should still inform footwear,
   layer, and fabric-weight judgment). **Final design:** preserve the exact numbers and add
   provenance. `validateUserWeather` (`styling-engine/weather.js`) accepts a new `scope` field on a
   numeric range — `exposure_window` (default, the only prior behavior — a temperature genuinely
   scoped to the outing, or two timed observations) vs `daily_forecast` (the day's overall high/low,
   stated separately from a narrower outing window). Carried through `resolveTemperatureField` into
   `exposure.js`'s `resolveConditions`: `exposure_window` keeps the certain
   `stated_user_exposure_range` treatment unchanged; `daily_forecast` gets a new
   `stated_user_daily_forecast` tier that routes the SAME real numbers through the identical
   waking-window estimate a live/model-estimated daily envelope already receives — `dailyHighF`/
   `dailyLowF` preserved exactly, `coarse: true`/`certain: false`, and (verified)
   `requiredThermalBand` WIDENS the acceptable range around the resolved level (`[moderate, very
   warm]` instead of a certain `[warm, warm]`) rather than manufacturing a false-certain single value
   or going silent. `USER_WEATHER_SCHEMA` (`styling-engine/tools.js`) now requires `scope` alongside
   any numeric range and explicitly tells the model NOT to convert real numbers into
   `temperature_band` itself. No hourly data is invented anywhere; none exists in this codebase
   (live weather fetches only Open-Meteo's daily max/min). The 2026-09-12 UI ruling is fully
   preserved — omitting `scope` (every caller that predates this field, including the dedicated
   "Temperatures you'll be out in" numeric fields) defaults to `exposure_window`, byte-identical to
   prior behavior.

2. **The five-card weather conclusion was withdrawn.** A prior report called all five raw cards
   "proportionate" for the outing. That was not established: one card (the knit sheath + light
   leather jacket) already discloses its own possible shortfall, the cropped unlined jacket and the
   non-insulating leather jacket are questionable if the outing runs toward the colder end, and the
   strongest thermal card carries the unresolved sleeve finding below. With the actual outing
   temperature genuinely unknown (no hourly data), the honest state is "not fully adjudicated" —
   recorded as such, not re-scored.

3. **Sleeve finding wording, and the critic gate.** `layer_construction_sleeve_conflict`'s message
   (`styling-engine/outfitValidation.js`, both the pairwise and chain builders) previously read as a
   confirmed defect ("has no room to accommodate"). Reworded to state plainly what it is: a
   shape-only heuristic (recorded sleeve length/shape only; fabric compressibility and inner
   construction are not recorded fields), explicitly disclosing it may be a false positive — matching
   why this finding has been log-only since 2026-08-26/2026-09-14. Diagnosed why the olive-top/puffer
   card never reached the existing visual clash critic despite the conflict being real: the ONLY
   gate deciding whether a card is "questionable" enough for that paid photo review
   (`wholeWardrobeOutfitVisualReviewFindings`, `styling-engine/rules.js`) checked pattern count
   alone — a two-solid-piece card had no path into review at all, regardless of any construction
   concern. Fixed by making a genuine `layer_construction_sleeve_conflict` shadow finding ALSO
   request that same existing review (reusing the identical critic call, contact sheet and
   reject/note/omit contract — no new mechanism, no second veto). Extended
   `WHOLE_WARDROBE_OUTFIT_CLASH_CRITIC_SYSTEM` with one added criterion: judge a layered sleeve pair
   from the photo only (real crowding or distortion, never an assumption from shape or a label), and
   say plainly when the photo cannot settle it — a "note", never a "reject", when uncertain. The
   shadow signal is used only to trigger the request; its own verdict is never sent to the critic or
   otherwise exposed as truth.

4. **Language-flag detection/scrub boundary.** Following the 2026-09-15 fix (dropping "confidence"
   from the trigger, and scrubbing whichever field actually matched instead of always `reason`), the
   detection side still scanned `label`+`dominantDirection`+`silhouette`+`reason`+`watchFor`+piece
   names while the scrub only ever touched `reason`+`watchFor` — the same species of boundary
   mismatch, one field narrower. Piece names are wardrobe data, not composer prose, and were dropped
   from BOTH detection and scrub (a piece literally named with a flagged word cannot be "scrubbed"
   without rewriting the garment's own name). `label`/`dominantDirection`/`silhouette` are real
   model-authored prose and now both scanned AND scrubbed, consistently — one field list
   (`BODY_SHAPE_PROSE_FIELDS`) drives both halves.

**[amended 2026-09-16 — direct cause found in the full capture: a standing composition rule conflicted with the ratified comparison-set wording]**
The complete provider capture for `thread_1789526496845` showed the actual mechanism behind five
different outerwear choices across five cards: `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM`'s
"Composition rules" (`styling-engine/prompts.js`) carried its OWN standing set-wide diversity
requirement — *"Each outfit must have a different visual thesis — different grounding strategy,
proportion logic, or focal/support relationship. Do not return five variations of one formula."* —
separate from, and in direct conflict with, the per-request `COMPARISON SET CONTRACT` text
(`routes/ai.js`) already corrected on 2026-09-15 to say the opposite ("do not choose a weaker outfit
merely to avoid repeating a sound formula"). One prompt told the model diversity was optional-but-
welcome; the other, standing rule told it every card MUST differ. In this run, varying the outerwear
was the cheapest way to satisfy the standing rule, even where repeating one of two sound cold-weather
choices would have produced stronger outfits. Retired outright and replaced: *"Select each outfit on
its own merits. Repeating a strong garment, outerwear choice, or outfit formula is fully acceptable.
Prefer a meaningfully different alternative only when it is at least as strong; never weaken an
outfit to increase variety across the set."* Both texts now agree.

**[amended 2026-09-16 — general weather-advice diagnosis: thread_1789532397982 (5-card), thread_1789532668263 (2-card), thread_1789536455443 (single-outfit)]**

Owner truth for the single-outfit result: a medium knit shirt + heavy trousers + boots + a
medium-weight, fully-lined, wind-protective cotton trench works to about 55°F — not for an outdoor
walk declining 50°F→40°F. `propose_outfit` accepted it with zero findings. Six connected causes,
diagnosed offline against the real capture and replayed against the real evaluator:

1. **Workbench-selection pressure (single-outfit).** `buildSingleOutfitStylistCatalog`'s
   `instruction` (`styling-engine/tools.js`) told the model to pick "2–3 potential visual
   leaders/heroes with distinct silhouettes or character" plus generic "layers" — nothing tied
   layer selection to the stated thermal demand. The catalog itself carried
   `insulation:polyester`/`insulation:shearling` for the puffer and shearling jacket right there in
   text, but the model's own `view_pieces` call named only the trench and a lambskin jacket
   (`insulation:none` both) — the puffer, wool coat and shearling never entered the visual
   workbench and were structurally unavailable at `propose_outfit`. Fixed: one added sentence,
   present verbatim regardless of weather (the model still decides whether conditions call for
   warmth), pointing at the catalog's own insulation/weight fields — no count, no garment category,
   no computed injection. Kept deliberately different in kind from the 2026-09-10 "pull 2–3
   insulating coats" mechanism retired 2026-09-15 for being an engine-computed formula; the
   mild/cold instruction-identity invariant that retirement established is unchanged and still
   tested. **Reworded 2026-09-16 (owner review):** the first phrasing named "insulation/weight
   facts" as if those were the only route to real warmth. It now asks the model to preserve
   candidates with "construction plausibly relevant to the exposure (insulation, substantial
   weight, weather protection, or other stated construction)" — a non-exhaustive list, so a
   wind-protective shell or a multi-garment system is not structurally excluded from the workbench
   just because it lacks a dedicated insulation tag.
   **Live validation, 2026-09-16 (`thread_1789543565383`, capture session
   20260916T072500260Z-p33193-328b5958):** for the same stated 50→40°F walking outing, the model's
   own `view_pieces` call inspected both the insulated puffer and the heavy lined wool coat — the
   workbench fix's intended effect — and selected 144 (black turtleneck) + 183 (heavy cotton
   wide-leg pants) + 996867 (heavy, fully lined, wind-protective wool coat) + 996859 (leather ankle
   boots). Materially more plausible for the stated outing than the earlier light-trench result; the
   sleeve heuristic remained shadow-only and did not block the wearable turtleneck/coat pairing. This
   is one live observation, not a bench — recorded as evidence the reworded instruction is working as
   intended, not as proof the workbench-narrowing defect is closed for every wardrobe/context.
2. **Evaluator false negative (`propose_outfit` accepted the trench outfit, zero findings) — STILL
   UNRESOLVED, recorded honestly rather than papered over.** Replayed the exact four pieces through
   `evaluateWearableOutfit`/`evaluateOutfitEnvironmentalAdequacy` at the real 50/40°F
   `exposure_window`-scope resolution. Two independent, both DELIBERATE designs compound: (a)
   `hasMinimumWarmLayer`'s presence/substance floor treats a full lining as legitimate substance
   evidence (2026-09-13 amendment, above) — the trench clears that low bar on construction alone, so
   `WARM_LAYER_RECOMMENDED` never fires; (b) the thermal-contribution bucket
   (`outfitThermalContribution`) reads the whole worn system (medium top + medium lined trench) as
   `warm` — an EXACT match to the certain `[warm, warm]` cold-end target (`bestDelta: 0`,
   `verdict: 'fits'`) — so `THERMAL_UNDERSHOOT` never fires either. Owner truth: this exact system is
   adequate to about 55°F, not for a 50→40°F outdoor walk — the evaluator's aggregated contribution
   genuinely OVERVALUES it. A dedicated advisory keyed on "no outer layer carries recorded
   insulation" was tried and **reverted** (2026-09-16 owner review): missing insulation is a
   per-GARMENT fact, not independently a whole-OUTFIT shortfall — it ignores a system that carries
   real warmth from a medium insulating base, from multiple garments together, or from wind
   protection genuinely mattering at the exposure, and it manufactured a second, narrower verdict
   that competed with the bucket above rather than repairing it. Re-tuning the floor or the bucket
   itself was ALSO tried (2026-09-13) and reverted for miscalibrating seven other real garments the
   other direction (inverting verified clo anchors). **No fix has shipped for this false negative.**
   The mitigation that shipped instead is evidence, not a verdict: giving the model complete
   construction facts and photographs (item 3 below) so it can judge the system itself, without the
   engine manufacturing a second deterministic conclusion to disagree with the first.
3. **Circular explanation ("what weather does this work for?" → repeats 50/40).**
   `compactFreeformAnswerMessage`/`compactFreeformAnswerSystem` (`routes/ai.js`) handed the
   explanation model the card's own stored `reason` (already calling the outfit "weather-ready for
   50/40"), `weatherUsed`, and `needsRemovableCoolLayer` labeled "Verified current cards" — while
   `compactFreeformPieceFacts` omitted `insulating_layer_materials`, `interior_construction` and
   `weather_protection` entirely, and `existing_card_explanation` received zero photographs (its own
   system prompt forbade even claiming to see one). The model had no way to independently
   distinguish the trench from genuinely warmer outerwear and no reason not to repeat its own prior
   claim sitting right there in the prompt. First fix (2026-09-16, same date): the three missing
   construction facts were added, photographs were supplied, and the card block was RELABELED
   "Cards as composed (the composer's own prior claims... not verified facts)" while still including
   `reason`/`weatherUsed` verbatim next to that caveat.
   **Revised 2026-09-16 (owner review): relabeling was not enough.** A prompt telling the model to
   disregard a conclusion placed immediately in front of it is not reliable — "what weather does
   this work for?" still repeated 50/40 with the caveat attached. A first correction added a
   function (named isWeatherSuitabilityQuestion, since removed — see below), a word-boundary regex
   classifying the CURRENT question (weather/temperature/warm/cold/climate/forecast terms), so
   `sanitizeOutfitForExplanation()` would strip `reason`/`weather_used`/`resolved_weather_context`/
   `needs_removable_cool_layer`/`system_flags` only when that classifier fired, leaving them in
   place for an ordinary "why did you choose this?" question.
   **Revised again 2026-09-16 (owner review, second pass): the classifier itself was the wrong
   mechanism.** A local keyword regex deciding WHEN a prior conclusion is dangerous is a second
   guess, brittle by construction (a rephrased question without a listed word would have sailed the
   old reason straight through), and the underlying problem — the model repeating a conclusion
   sitting in the prompt — is not actually specific to questions that happen to contain a weather
   word. That classifying function is removed entirely. `existing_card_explanation` now
   projects a card as structural membership only on EVERY question, unconditionally:
   `sanitizeOutfitForExplanation()` always strips `reason`, `weather_used`/`weatherUsed`,
   `resolved_weather_context`/`resolvedWeatherContext`, `needs_removable_cool_layer`/
   `needsRemovableCoolLayer`, and `system_flags`/`systemFlags`. Outfit membership (`label`,
   `piece_ids`, `pieces`, `styling_instructions`) is kept — it is a fact about what the card
   contains, not a conclusion about it. An ordinary "why did you choose this?" question now gets a
   FRESH explanation from the garment facts and photographs too, not a repetition of the stored
   reason — which is the more honest answer to that question regardless: the composer's own claim is
   not verified any more than its weather claim was. The user's original stated conditions are never
   deleted; they survive in `recentHistory`, the turn that actually asked for the outfit, never in
   the technical-conclusion fields above.
   `compactFreeformPieceFacts` was also audited field-by-field against
   `garmentEvidenceLine.js`'s `garmentEvidenceFields` — the shared fact set every other chat surface
   already sends — rather than declaring parity from the three fields above alone; `fiber_content`
   and `season` were the remaining weather-relevant gaps and are now included (`stretch` is on that
   shared line too but is a fit/comfort fact, not a weather one, and is deliberately excluded).
   Separately, `compactGarmentVisualEvidence`'s allocation was piece-major/photo-type-minor — worn
   AND hanger photo for the outfit's first two pieces before any later piece got one — so a 4-image
   budget on a 4-piece outfit could leave the outerwear with no photo at all. It is now two-pass:
   every garment gets one useful image (worn preferred, hanger fallback) before any garment gets a
   second (pinned by a production-path HTTP test, `test/bounded_multi_context_continuity_e2e.test.js`).
   **Revised again 2026-09-16 (owner review, second pass): the ceiling itself was still stale.** The
   two-pass fix kept the image budget hard-capped at 4 — a number observed on one thread, not the
   outfit role invariant's own maximum. A card's role invariant (`outfitValidation.js`: at most one
   `primary_top`/`primary_bottom`/`dress`/`shoes` role, plus at most one middle layer and one outer
   layer) caps a valid outfit at **five** distinct garments, so a valid 5-piece card (base + middle
   layer + outer layer) could still lose one of its two layers to the old ceiling. The ceiling is now
   `MAX_STRUCTURAL_OUTFIT_PIECES = 5`, the real structural maximum, so pass one always has room for
   one image per unique garment on any valid card before pass two spends anything on a second photo
   — proven by a second production-path HTTP test covering a base + middle-layer + outer-layer
   5-piece card.
   **This item is a payload-honesty fix, not a fix for item 2.** The evaluator still says this
   outfit fits with zero findings; the model is now given complete facts and photographs to judge
   the system itself, without the engine manufacturing a second deterministic verdict to compete
   with (or paper over) the first.
   **Corrected again 2026-09-16 (owner review, third pass): conversation history and continuation
   must survive, and a label can leak a conclusion too.** Two further findings from a live capture
   (`thread_1789543565383`):
   (a) The user must be able to ask "what did you mean?", challenge a prior answer, or request more
   outfits for the same outing — so recent conversation history is intentionally preserved for
   `existing_card_explanation`, never stripped. The live risk this creates (an earlier assistant
   turn's own prose can still carry a fallible claim) is addressed generally, not with another
   weather-specific mechanism: the system instruction now states plainly that "Conversation history
   is provided to preserve continuity and resolve references. Previous assistant statements are
   fallible prior claims, not authoritative garment evidence. Reassess them against the structured
   garment facts and photographs, and correct them plainly when they conflict." This covers any
   prior claim conversation history can carry, not only a temperature one.
   (b) A composer-written card `label` ("Polished Urban Walk at 50° to 40°F") reached the model
   verbatim in the same capture — the exact class of conclusion-bearing text item 3's field-stripping
   was built to keep out, just carried through a field that survives because a bundle of several cards
   genuinely needs SOME way to tell them apart. Deleting it outright would break that legitimate
   case, so it is renamed instead of caveated: `sanitizeOutfitForExplanation()` now projects it as
   `untrusted_display_label`, a key that states what it is rather than depending on the model reading
   and honoring a nearby prompt sentence. Once a card is resolved, its index/piece_ids/pieces are the
   neutral way to refer back to it.
3b. **Provider truncation stored/served as a completed answer.** The same live capture ended with
   `stopReason: max_tokens` and stored the fragment *"Based on the garment construction and
   photographs, this outfit can be trusted for an outdoor temperature range of 40°F to"* as if it
   were a finished reply. Root cause: `maxTokens: 700` on this call was sized for the visible prose
   alone, but Gemini bills thinking tokens out of the SAME cap and `thinking_level: 'low'` still lets
   that vary a lot per request — the identical failure class already diagnosed and fixed for the
   execution router (`routeFreeformExecutionProfile`, 350→900, same date, above). Fixed in two parts:
   the ceiling is raised to 1500 (matching the ordinary full-turn free-text ceiling used elsewhere in
   this file for a prose answer of comparable length), and a simple defensive backstop,
   `compactAnswerWithTruncationGuard()`, retries once with a "give a shorter, complete answer" nudge
   (the same shape as the full tool loop's own `providerTruncation` retry in
   `styling-engine/provider.js`) and returns an honest disclosure — never the stored fragment — if
   still truncated after the retry. No elaborate retry system: one bounded retry, reusing an existing
   idiom.
3c. **Continuation silently dropped the established temperature range.** Same capture's follow-on
   scenario: after an `existing_card_explanation` turn, "give me three more outfits for the same
   outing" must leave that profile and reach the composer while carrying the same 50/40°F range
   forward, even though that turn's own words never restate it. The router's `bounded_multi` shortcut
   (`routes/ai.js`) calls `generate_outfits` with only `occasion`/`activity`/`season`/`mood`/
   `mission`/`limit`/`location`/`date` — never weather. Setting `toolContext.weatherProfile` before
   the call (the same carry-forward `resolveToolStylingContext` already performs for the full-stylist
   path) was tried first and verified, by the regression test below, to be **ineffective**:
   `generate_outfits` always states `season` explicitly (a required field), and `resolveWeather`
   (`styling-engine/stylingContext.js`) deliberately refuses its established-state weather-profile
   fallback whenever season provenance is `explicit_request` — "a current explicit seasonal brief is
   a new instruction... must not silently inherit a derived snapshot from an older card or thread" —
   so that fallback is structurally unreachable through this call shape, not merely unset. The actual
   fix passes the persisted range as an explicit `user_weather` tool argument instead, which
   `resolveWeather` checks FIRST regardless of season provenance — the same authority a model's own
   restated `user_weather` would carry. This is gated on `!freshExecutionRequest`, the SAME
   structural continuation-vs-fresh-pivot signal this function already computes for the router-
   eligibility decision above (non-empty `current_outfit_set`/history/etc.) — not a new keyword or
   weather-specific rule. A genuine fresh pivot ("actually, three hiking outfits tomorrow" with no
   current outfit set) has `freshExecutionRequest === true` and never carries a stale profile
   forward. Proven by a three-turn production-path HTTP test
   (`test/bounded_multi_context_continuity_e2e.test.js`): turn 1 seeds an established outing, turn 2
   (`existing_card_explanation`) is proven to touch only `recently_discussed_piece_ids`, and turn 3
   is proven — via the real `executeTool` call-site log, not a mock — to send
   `user_weather:{high_f:50,low_f:40,scope:'exposure_window'}` to `generate_outfits`, with the
   composer's own resolved-and-persisted `weather_profile` confirming the carried-forward value won.
4. **Forecast scope (5-card thread).** The daily "50°F high and 40°F low" statement — decoupled from
   the stated 1–6pm outing — was classified `exposure_window` by the model despite the schema's own
   worked example naming exactly this phrasing as the `daily_forecast` case (§ the weather-scope
   work earlier this date). This is a MODEL COMPLIANCE gap, not a missing mechanism — the schema
   already asks for the right classification. No deterministic override was added (explicitly
   ruled out); items 2 and 3 above reduce the damage of a wrong classification by no longer letting
   a resolved "certain" bucket, or a stored claim built on it, go unquestioned downstream.
5. **Cross-flow evidence contract.** Confirmed both the bundle composer's per-piece line and the
   single-outfit sparse catalog line already carry insulation/interior/protection facts (verified
   directly from a live capture: `insulation:polyester;interior:full_lining;protect:wind` on the
   sparse line, `insulating layer polyester; interior full_lining; protection wind` on the composer's
   line — same facts, different formatting, both present). The single-outfit flow's own
   WORKBENCH-NARROWING step (item 1) — which the bundle composer's broader pre-filtered visual
   roster does not have — was the actual asymmetry, not a missing fact.
6. **Role/competence framing.** All three surfaces (`WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM`,
   `SINGLE_OUTFIT_STYLIST_SYSTEM`, `compactFreeformAnswerSystem`) opened as a bare "personal
   stylist" with scattered, sometimes-contradicting per-surface thermal sentences layered on top —
   no stated competence in judging clothing as a worn system. Added one shared paragraph,
   `STYLIST_COMPETENCE_CONTRACT` (`styling-engine/prompts.js`), to all three: role framing only — no
   temperature cutoff, no prescribed garment, no instruction to defer to the evaluator. Explicitly
   NOT a substitute for items 2–3: a well-framed expert still cannot judge insulation it is never
   shown, which is why this shipped alongside the payload fixes rather than instead of them.

Not touched: `resolveExposureContext`/`exposure.js`'s scope-based certain/coarse treatment (already
correct per the earlier same-date work); the 2026-09-13 thermal-contribution/presence-floor
calibration (re-opening it was explicitly tried before and reverted); any garment ID, Fahrenheit
threshold, or prescribed formula.

**[amended 2026-09-12 — the visual composer finally gets calendar season]**
Same run (`thread_1789247972106`, 65/50, fall, casual), second and larger defect: the cards were built on summer clothing — a white octopus graphic tee, an ivory graphic crew, cropped utility pants — and two of them drew the `baseIsWarmSeasonOnly` corroboration *"every piece under it is tagged as warm-season clothing"*. Measured on that exact context: **18 of the roster's 60 base pieces were tagged `season: warm`, and ZERO exclusions mentioned season.** `buildVisualComposerRoster` had no calendar-season handling of any kind. Its only cool-side content gates — `cold weather: shorts`, `cold weather: lightweight linen bottom`, `cold weather: bare/sleeveless` — sit behind `isCold` (lowF <= 45), so at a 50°F low none of them run: the entire `needsRemovableCoolLayer` tier shaped FINDINGS and never SUPPLY.
The trip planner had solved this and the composer never inherited it, because `rules.js` cannot import `outfitSetPlanner.js` (that module imports rules.js). Both helpers moved to `lib/seasonContext.js` — byte-identical implementations, re-exported from `outfitSetPlanner.js` so every existing caller and test keeps its path:
- `seasonFitPieceAdvisory()` — ranking only, every category, every day. Now part of the composer's `getRelevanceScore`, with its reason pushed to `debug.relevanceAdjustments` like every other adjustment.
- `seasonEligibleForCalendar()` (the predicate behind `tripSeasonEligiblePool`, docs/trip-roster-season-eligibility-spec.md) — a new Step 2.5 in the roster, **gated on the cool tier**: tops exempt (a warm-season top is a legitimate base under something warmer), dresses not (outfit-defining, not a layering component), outerwear judged on its own tag (a warm-season blazer is lightweight construction, not insulation).
Measured on the live wardrobe at that run's context: **warm-season base pieces in the roster 18 → 1** (the survivor is a top), 38 off-season exclusions, roster 81 → 75. Both pieces that actually shipped in those cards — `122` olive utility cropped pants, `129` beige pleated wide-leg — are now cut. Provably additive: with no calendar season resolved, or on a mild day, the roster is unchanged (both pinned by tests).

**[amended 2026-09-12 — "ordered for these conditions" was ordering by the wrong key]**
Owner ran `thread_1789247972106` at `casual` specifically so the everyday-register pool would include `996866` (navy quilted puffer, `warm`, the one layer in that roster whose fit is `adequate`) — and neither the composer nor the corrective pass used it on any of five cards, every one of which the owner confirmed *"does not clear 59 and below"*. The capture shows why: the puffer was listed **fifth of seven**, below four undershooting `moderate` cardigans and fleeces, in a section headed `=== OUTERWEAR (ordered for these conditions) ===`.
`orderLayersByThermalFit` sorted by `Math.abs(fit.offset)`. `offset` is **overshoot-weighted by design** — it encodes "prefer the garment that is not too hot", the right preference when ranking a garment for wear and the wrong one for a list whose entire job is "which of these covers the cool end". The puffer sits 0.75 above `warm`'s raw centre, weighted to 1.125; the cardigans sit 0.5-0.75 below, unweighted. The only adequate layer sorted last among the plausible ones.
Ordering is now by **level distance** (symmetric, `fit.distance`), with the signed offset breaking ties toward the warmer piece — on a cool day that is the right way to lean. Verified against that run's own seven pieces: the puffer leads, the four `moderate` layers follow, the two `light` ones last.
Recorded because it corrects a wrong reading in the amendment above: the 10-of-10 and 5-of-5 flag rates were NOT evidence that the demand is too strict. The outfits genuinely did not clear the cool end — the engine's verdicts were right, and the defect was in the supply we presented to the model, not in the judging.

**[amended 2026-09-12 — 46°F was never the dressing temperature: a UI ruling, not an engine change]**
With the target language removed, both composer and corrective pass independently chose mild layers on a stated 65/46 day and the engine flagged **10 of 10 cards** as too light — including runs where the one `warm` coat was an available swap candidate and was declined five times over. Owner: *"46 is the low, so nothing but the nightgown should be there for 46° unless the user is planning a sunrise jog."* The engine agrees with that principle already — `resolveExposureContext` lifts a forecast's low by `WAKING_WINDOW.troughOffsetFraction` (0.35), "the share of the day's range the pre-dawn trough sits below by the time people are ordinarily out" — but exempts `stated_user` ranges, correctly, because a stated range is what the user says they will ENCOUNTER (`thread_1788767789621`: 60°F departure, 48°F return, silently lifted to 52.2°F). The two statements were collapsed by one form: the Create Outfits brief's `high °F` / `low °F` fields, labelled "overrides the forecast", invite a daily envelope and are then read as an encountered range. Measured difference on the same ten cards: verbatim `[warm, warm]` → 10 flagged; as an envelope (`wakingLow` 52.7, band `[moderate, very warm]`) → 3 flagged, and the three that remain are the genuinely light ones.
**Ruling: no engine change.** Stated numbers stay verbatim as the exposure window; the UI now says that is what they are (see `docs/app-surface-map.md`, same date). Recorded here because a future reader will find the `stated_user` exemption and this evidence together, and should not "fix" the engine to lift a stated low.

**[amended 2026-09-12 — reversal: the target level and the pass's middle-layer move are removed]**
Live run `thread_1789241567145` shipped a card pairing a structured cropped tweed jacket UNDER a double-breasted wool coat. Owner ruling, and the reasoning behind it, recorded because it governs future work here: *"this is common sense, not something that has to be stated and directed"* — the response to a nonsense output is not another gate, it is to ask what the process did to invite it. The capture answered:
1. **The corrective pass makes layering decisions on far less evidence than the composer.** Its input is a contact sheet of 150×132px tiles plus `Layers that suit these conditions, by ID: …` — names and IDs only. No `fit_on_body: structured` on the tweed jacket, no `warmth:`, no `fabric`, no `do not pair`. The composer's own call carries all of that per garment. Asked to ADD a garment on that evidence, with a candidate list that was three-quarters coats and a prompt saying a middle layer "is often the better answer", it stacked two coats. The middle-layer move is therefore REMOVED — the pass is swap-only, and composing a layered outfit belongs to the call that has the photos and the labels. Layering itself is unaffected: it lives in the composer's structure rule and roles, which produced a genuine three-layer card in `thread_1789238243751` before this move existed.
2. **The published target level invited arithmetic.** `Temperature: … — the whole outfit needs to read about \`warm\`` and `=== OUTERWEAR (these conditions call for \`warm\`…)` named a number the outfit had to hit, alongside a per-garment `warmth:` ladder, on a wardrobe whose bases are all `moderate` — where one `moderate` layer visibly does not reach `warm` and the arithmetic route to the target is a second layer. Both are removed. The tail now states the CONDITIONS (`65°F high / 46°F low`), points at the label vocabulary, and says to judge against the range rather than a number; the heading says only `(ordered for these conditions)`, keeping the ordering that carries the same information without inviting a sum. The `N of M suit these conditions` count went with them — once the layer band admitted every ordinary layer it read "7 of 7", which is the `everything shown is weather-optimized` false reassurance in new clothes.
Kept: the layer band itself (it determines SUPPLY — which layers the roster and the swap candidates draw from — without telling the model to hit a level), the per-direction acceptance floor (now unreachable through the swap-only path by construction, retained as a defensive guard), and role emission.
Not implemented, and deliberately so: the proposed "soft layer only" structural gate for the inner of two outerwear pieces, and switching `includeLayerDirections` on for this path. Both were offered and set aside under the same ruling — the first is a floor for a situation the pass manufactured, and the second cannot answer this pair anyway (`sleeve_shape` is tagged on 35% of upper-body pieces, so `evaluateLayerPairConstruction` returns `layer_construction_bulk_unknown` here). They stay available if a well-informed composer, given full labels and no target, still produces a jacket under a coat.

**[amended 2026-09-12 — wear order becomes data; the corrective pass can add a middle layer and stops vetoing styling]**
Live run `thread_1789240498939` (layer band + both-direction pass, clean rotation) removed every winter coat — 0 overshoot flags, down from 3 — and then flagged **4 of 5 cards as too light**, with the corrective pass producing `revisedCount: 0` from `misfitCount: 4`. The pass was working correctly and had nothing to offer: every qualifying layer except the single `warm` wool coat is `light` or `moderate`, the two-piece step-up needs BOTH halves at `warm`, and no base in this wardrobe exceeds `moderate` — so no swap could change any card's verdict. The app was simultaneously telling the model "7 of 7 shown layers suit these conditions" and flagging four cards built from them.
The one mechanism that resolves it was switched off. `orderedSubstantialUpperStackContribution` credits a genuine three-layer system (base and middle `moderate`+, outer `light`+) with a bounded step — `moderate` top + `moderate` cardigan + `light` jacket → **`warm`**, demand met, no wool coat required — and it reads `piece.role`, which `normalizeWholeWardrobeOutfitObject` trimmed away. Three changes:
1. **Roles are emitted and preserved.** The composer states `role` per upper piece (`primary_top` / `dress` / `layer_top` / `outerwear`); a cardigan worn under a coat is `layer_top` though its category is outerwear, because the role names the JOB. `roleMatchesCategory()` validates against structured truth — the same split `propose_outfit` already enforces, where a model-authored role cannot manufacture a garment the category does not support — and `deriveWholeWardrobeRoles()` reconstructs the stack from the wear order the prompt already requires when a role is absent or dropped. Both rehydration points (`locallyGateWholeWardrobeOutfits`, the composer's misfit check) now MERGE the card's role onto the full garment record instead of replacing the piece; dropping it there would have left the credit unreachable for exactly the cards that earn it.
2. **The corrective pass can add a middle layer** (`middleLayerId`), not only swap the outer one, and states the resulting wear order as roles on the revised card. On a wardrobe where no swap can help, "a cardigan under that jacket" is the move that clears the day.
3. **Acceptance is NOT WORSE, not strictly better, and rejections are itemised.** The strict rule silently discarded re-compositions the stylist preferred whenever they were thermally neutral — the engine settling a styling question by omission, which is the authority it does not have (owner: *"engine is not qualified to decline on styling grounds"*). It keeps the veto it IS qualified for: a revision may not increase the misfit count. `layerRevision.rejections` now separates `unknown_layer` / `missing_reason` / `gate_rejected` / `made_it_worse`, replacing a single counter that covered all four.
**Immediate correction from the next run (`thread_1789241567145`).** Roles shipped on every card and the pass revised two, but one revision added a middle layer under the single `warm` coat, the three-layer credit stepped the system to `very warm`, and the card traded a shortfall for an OVERSHOOT — which the new "not worse" rule accepted, because it counted findings and a bare count makes too-light and too-warm interchangeable. Acceptance is now per DIRECTION: a revision may not increase the shortfall count OR the overshoot count. Curing a fault by causing its opposite is not neutral.

For the record, since it was raised: the `skipped` entries in that run were the MODEL's own words (its `skipped` array, e.g. *"the lambskin … creates a sleek monochrome look that any available alternative layer would disrupt"*), not an engine refusal. The engine's contribution was the two rejections, on arithmetic alone.

**[amended 2026-09-12 — outerwear answers the LAYER band, and the corrective pass works in both directions]**
Live run `thread_1789238243751` produced the first three-layer card this composer has ever made (base + open vest + lambskin jacket, with wear order in `styling_instructions`) — and three of five cards carrying `THERMAL_OVERSHOOT`, a shearling twice and a down-lined leather coat once, on a 65°F afternoon. Both halves trace to one line: the qualifying-layer test was `fit !== 'undershoot'` against the BASE band.
1. **The layer band replaces the base band for outerwear supply.** `requiredThermalBand` returns two ranges: `range` (`[warm, warm]` on a 65/46 day) is what the whole outfit must reach at the cold end, and `layer.range` (`[light, warm]`) is what a REMOVABLE layer may be — wider, because it spans the day since the layer comes off. `weatherFitForPiece` already carries this doctrine ("Outerwear answers to the LAYER demand, not the base's") but gates it on a supplied `exposure`, which the roster path never has. Reading the base band produced a failure at each end: a trench or cardigan counted as undershoot and was cut, while "not undershoot" swept `very warm` winter coats in as adequate. Both the reserve membership (`styling-engine/rules.js`) and the composer's `qualifyingLayers` (`routes/ai.js`, feeding the tail disclosure and the corrective pass) now test `fit === 'adequate'` against `layer`, with `unknown` still eligible in the reserve. Measured on the live wardrobe: the roster's outerwear went from 1 `warm` + 2 `very warm` to **seven layers all inside the band** (`warm` wool coat, three `moderate`, three `light`) — winter coats out at the top, the `very light` vest out at the bottom.
2. **The corrective pass gained the overshoot direction** and was renamed accordingly (`reviseWholeWardrobeOutfitsForLayerFit`, `WHOLE_WARDROBE_LAYER_REVISION_SYSTEM`, debug key `finalSelection.layerRevision`, `isLayerFitFinding` in `outfitEnvironmentalAdequacy.js`). It previously knew only about shortfall and had nothing to say about those three winter-coat cards. Same single capped pass, same re-gate-and-compare acceptance (a revision is kept only if it strictly reduces the misfit count), same decline-and-explain clause — which in that run produced a genuinely good refusal: *"None of the available warm layers complement the casual denim-and-loafer register…"*, leaving the card honest rather than bolting a shearling onto it.
**Not fixed here, and visible in that run:** outfit 5's three-layer stack still drew a shortfall note, correctly. The stack credit (`orderedSubstantialUpperStackContribution`) requires the middle layer at `moderate` or above and that vest is `light` even after the vest re-calibration, so no credit is due — and the card carries a `very light`-tier vest plus a `light` jacket over a `moderate` top, which genuinely is not a 46°F system. Roles are still unemitted (see the layering amendment); they remain the follow-up, but they would not have changed this card.

**[amended 2026-09-12 — bounded upper-body layering: the middle-layer ban moves from prose into the validator]**
Owner observation, and the deeper one of this arc: *"this app's styling advice is chronically missing interesting layering."* Measured on the live DB — of 27 saved outfits, 7 (26%) carry any outerwear and **0 carry a middle layer**. The cause was the visual composer's structure sentence, `categoryOutfitStructurePromptRule({ strictSingleTop: true, maxOuterwear: 1, allowAccessories: false })`: *"optional single outerwear; never two pieces occupying the same slot (no two bottoms, no two tops)"*. Every cardigan in this wardrobe is `category: outerwear` and the tweed vest is `category: top`, so that one sentence forbade both a cardigan under a coat and a vest over a blouse — while the SAME system prompt asked for "an intentional 3-layer system with a middle knit layer (such as a cardigan or vest) beneath an outer jacket" under Thermal Adequacy, and the owner's own Layer 2 constitution says "open shirt or vest over a fitted base is almost always better than the top alone". Three voices in one prompt; the restrictive one won because it reads as mechanical.
That sentence was **load-bearing**, and the owner is right that it prevented real malformation — but it was load-bearing because nothing else enforced it: `evaluateOutfitStructure` counted tops only when a bottom was missing and never counted outerwear at all, so a card carrying three coats passed structure silently. The guarantee was on the honour system. So the bound moved into code:
1. **`styling-engine/outfitValidation.js`** — `evaluateOutfitStructure` now bounds upper-body layering: `MAX_UPPER_LAYERS = 3` (one base + one middle + one outer), `MAX_OUTERWEAR_LAYERS = 2`, `MAX_TOP_LAYERS = 2`, emitting hard findings `too_many_upper_layers`, `multiple_outerwear`, `multiple_tops` alongside the existing `multiple_bottoms`/`multiple_shoes` family. This is strictly STRONGER than what shipped before, and it applies to every consumer of `evaluateWearableOutfit` (whole wardrobe, freeform, trip submissions).
2. **`categoryOutfitStructurePromptRule` gains `allowMiddleLayer`, default `false`.** Capsule expansion (`routes/ai.js`) and the planner (`outfitSetPlanner.js`) keep the byte-for-byte strict contract; only the visual composer opts in. Its new text permits one middle layer and one outer layer, asks that a middle layer do "a real job — warmth the base cannot carry on its own, or a deliberate visual relationship such as an open layer framing a fitted base — never to fill out a card", and requires wear order plus a `styling_instructions` note. The layered JSON example gains the third garment, since the example is what gets imitated.
Registered as accepted byte deltas in `test/prompt_equivalence.test.js` rather than by re-freezing the fixture, per that rail's existing convention.
**Known follow-up, not done here:** the engine's three-layer thermal credit (`orderedSubstantialUpperStackContribution`) reads `piece.role`, and `normalizeWholeWardrobeOutfitObject` trims whole-wardrobe pieces to `{id, name, category, photo, worn_photo}` — so a permitted cardigan-under-coat card still computes its warmth from the two-piece rule and can carry a shortfall note despite being a genuine three-layer system. Emitting and preserving roles is the next step. The layer-band membership question (using `requiredThermalBand().layer` instead of the base band for outerwear) is deliberately parked behind it: it was sized against a wardrobe that could only wear one layer at a time, which turned out to be a prompt rule rather than a fact.

**[amended 2026-09-12 — the cold-coat reserve was defeating itself; roster, not wardrobe, was the bottleneck]**
The question "did the roster even have enough warm outerwear" turned out to be the root of the whole arc. Captures for runs 2077-2079 show **7 outerwear pieces shown, exactly 1 of them `warm` or above**, every run — while the wardrobe owns **five** warm+ coats (four `very warm`, one `warm`), all five passing automatic-use eligibility. The four `very warm` coats were cut at `buildVisualComposerRoster`'s Step 4 category ceiling (outerwear ceiling 7 = floor(8 × 90/93)) carrying `score=-10` from the adjustment *"thermal band: warmer than the conditions call for"*: a stated 65/46 range produces a CERTAIN `[warm, warm]` band, so `very warm` overshoots by one step and takes a flat penalty.
`Step 4`'s cold-coat reserve exists precisely to prevent that, and instrumentation showed it firing — and then filling itself wrongly:
```
partition: coats=[996867, 996760, 996761, 996762, 996765, 996775, 996866, 996868]
           targetCoats=3
           keptCoats=[996867, 996760, 996761]   ← the wool coat and two `moderate` fleeces
```
Two independent defects, both fixed in `styling-engine/rules.js`:
1. **Membership was too broad.** `isColdCoat` matched on ANY insulating evidence, so `moderate` fleece coats counted as cold coats and consumed reserved slots on a day whose demand they do not meet. Membership now also requires answering the demand (`thermalRankingFit(...).fit !== 'undershoot'`), with `unknown` still eligible — a structurally-tagged coat with no warmth evidence is not evidence of a bad coat.
2. **The reserve was filled in RELEVANCE order** (`coats.slice(0, targetCoats)`) — the same score that had just penalized every genuinely warm coat −10. Inside the reserve, ordering is now thermal fit (`thermalRankingFit`, shared primitive), with relevance only breaking ties; `unknown` fit ranks behind measured layers, since absence of evidence must not outrank a garment that demonstrably answers the conditions.
Measured against the owner's real wardrobe on run 2079's own weather profile: **warm+ layers shown went from 1 to 3** (the wool coat plus the brown leather coat and tan shearling). This reframes the three preceding prompt iterations — requirement wording, tail evidence, demand at the point of choice — all of which were arguing with a roster that contained exactly one qualifying layer for five outfits. The corrective pass above has the same ceiling: it can only offer layers that made the roster.
Still open, deliberately not changed here (ratified calibration, owner's call): the flat −10 overshoot penalty for outerwear on a narrow certain band, when `requiredThermalBand` already returns a separate, wider `layer: {range: [light, warm]}` that this penalty ignores — a removable `very warm` coat on a 46°F low is not meaningfully "too warm".

**[amended 2026-09-12 — one corrective pass for the whole-wardrobe visual composer (owner ruling, capped at a single pass)]**
Runs 2077, 2078 and 2080 shipped ~4 cards carrying `THERMAL_UNDERSHOOT` each, under three successive prompt wordings (requirement → tail evidence → demand at the point of choice), and used the wardrobe's one adequate layer exactly once every time. The diagnosis was NOT model capability — the same `gemini-3.5-flash-lite` runs the trip and freeform flows — but **loop structure**, and this is the only composition path in the app without one:
| flow | what happens to a validation finding |
|---|---|
| trip plan | returned to the model via `submit_plan_outfits` ("Fix these plan outfit issues in ONE submit_plan_outfits call…"), up to 2 resubmits |
| freeform `/ask` | returned as `retryPending` broken cards plus the error text |
| whole-wardrobe visual | **nothing** — "single model call, no tools", "exactly one provider request with no in-call retry" |
The finding was computed on every run and printed on the card for the owner; the composer was never told. `generateWholeWardrobeOutfitsVisualInternal` now runs ONE corrective pass after `locallyGateWholeWardrobeOutfits` (`reviseWholeWardrobeOutfitsForLayerFit` in `styling-engine/core.js`, `WHOLE_WARDROBE_LAYER_REVISION_SYSTEM` in `prompts.js` — renamed from `…ForCoolLayer` when the pass gained the overshoot direction, see the amendment below):
- **Fires only when it can change something**: at least one delivered card with a warmth-shortfall finding (`isWarmthShortfallFinding`, the same family the chip collapse uses — read as codes, never as message prose) AND at least one shown layer that answers the demand. A wardrobe with nothing warmer pays nothing and keeps its honest disclosure; `finalSelection.coolLayerRevision` records which branch ran.
- **Contact sheet, not the manifest**: rows are the affected outfits plus one row of the adequate layers, so the pass costs a fraction of the ~40k-token 83-image first call. Images rather than a text list because a layer swap is a composition decision (visual-grounding precedent), and the sheet is built from `makeGarmentTile` exactly as the clash critic's is.
- **Revision is a styling decision, not a substitution**: the prompt states that repeating one layer across outfits is not a variety failure, and that an outfit the only adequate layer would fight should be left alone and reported in `skipped`.
- **Cannot make the set worse**: each revised card is re-run through the SAME gate with the same options, is kept only if its warmth shortfall is strictly smaller than the original's, and is dropped otherwise. A revision with no replacement `reason` is refused outright — a swapped layer under the old card's prose is the auto-completion title/reason mismatch this app has already shipped once.
- **Capped at one pass, never recursive**; revised cards are never re-revised. Failure is non-fatal (the original cards ship), and the pass's usage is folded into `composerUsage` so the turn's reported cost is not an undercount — the same correction the clash critic needed.

**[amended 2026-09-11 — database safety guardrails, script isolation, and prohibition of live db bypass under test]**
Audit of a live diagnostic error where an eval script executed against the root `wardrobe.db` connection:
1. **Mandatory Script Isolation**: All standalone scripts, diagnostics, and test runners must run against isolated databases. Root `wardrobe.db` is live owner data and cannot be opened implicitly.
2. **Prohibition of Bypass under NODE_ENV=test**: `assertDefaultDatabaseAccess` in `lib/databaseSafety.js` strictly forbids `WARDROBE_ALLOW_LIVE_DB=1` when `NODE_ENV === 'test'`. Automated tests can never access the live database.
3. **Safe Snapshot Helper**: `createIsolatedDbSnapshot` in `lib/databaseSafety.js` provides a standard utility for diagnostics that copies `wardrobe.db` along with `-wal` and `-shm` sidecars to an isolated temporary directory with a clean `cleanup()` callback.
4. **Agent Policy Elevation**: Mandatory rule elevated to `AGENTS.md` and `.agent/rules/styling-engine.md`, referencing canonical docs in `docs/database-safety.md`.


**[amended 2026-09-11 — trip roster duration context, bottoms variety, crossover reusability, and vacation dining defaults]**
Audit of live trip planning runs `thread_1789097714089` and `thread_1789106847519` (Vienna, VA in mid-October: 1-week sightseeing, museums, and nature walks with friends) identified interconnected issues leading to an over-packed 29-piece suitcase, single-bottom overload across outdoor and dinner contexts, rejected evening dining cards, and cross-slot duplicate submissions:
1. **Trip Duration & Date Range Forwarding**: In `styling-engine/outfitSetPlanner.js` (`selectTripRosterViaModel`), `dateRange` is forwarded into `chooseTripRosterWithProvider`. In `routes/ai.js` (`tripRosterSelectionUserText`), the prompt displays start/end dates and calculated duration (e.g. `Dates: 2026-10-12 to 2026-10-18 (7 days / 1 week)`), giving the model duration awareness.
2. **Suitcase Scale & Crossover Versatility**: In `routes/ai.js` (`tripRosterSelectionSystemPrompt`), prompt instructions define suitcase scale expectations (~10–14 pieces for a 1-week trip; 2–3 pairs of shoes).
3. **Bottoms Variety & Activity Separation**: In `routes/ai.js` (`tripRosterSelectionSystemPrompt`), instructions require that a multi-day trip (especially 5–7+ days) spanning varied activities (active outdoor walks, city sightseeing, museum visits, dinners out) must pack at least 2 distinct bottoms (or 2 bottoms + a dress/skirt). Relying on a single pair of pants to cover both outdoor hikes and polished gallery strolls or evening dinners is an operational and travel planning failure; distinct bottoms must be provisioned for active outdoor utility versus polished/social settings.
4. **Vacation Dining & Formal Gate Protection**: In `styling-engine/prompts.js` (`Planning a Coordinated Multi-Outfit Set`), vacation dinners, social evenings, and dining out with friends/family default to `occasion: 'smart casual'` and `environment: 'indoor'`; `register` is omitted or set to `elevated`. Prompts strictly forbid escalating vacation dining to `occasion: 'evening'` (which triggers `wholeWardrobePieceTrustDecision` in `styling-engine/rules.js` hard-prohibiting bottoms without explicit evening tags) or `register: 'dressy'` (which triggers `checkOutfitFormalityFloor` in `styling-engine/outfitSetPlanner.js` requiring a dressy-or-better formality floor anchor) unless the user explicitly requested a formal gala or black-tie event.
5. **Cross-Slot Deduplication & Rotation Hygiene**: In `routes/ai.js` (`tripPlanCompositionSystemPrompt`), the atomic trip composer is instructed that every look across the entire plan must have a distinct combination of core pieces (never reusing the exact same combination of top + bottom + footwear in different slots, e.g. city museums and nature walks). Casual/active bottoms from hikes are also barred from being assigned to polished gallery strolls or dinners when alternative bottoms or dresses are packed in the suitcase.


**[amended 2026-09-11 — biometeorological scale framing, cold presence resolution, and removal of master booleans]**
Unified biometeorological scale and cold-layer presence resolution:
1. **Biometeorological Thermal Scale Framing**: In `styling-engine/biometeorology.js`, `petReportingCategory` is calibrated as an owner-calibrated ambient thermal scale inspired by PET reporting categories (Matzarakis sedentary baseline). It is strictly ambient mapping, not calculated physiological PET. Garment prescriptions (`dressingGuidance`) and physiological stress claims (`extreme_cold_stress`, `thermal_neutrality`) are purged from ambient bands. Contiguous ambient bands define `VERY_COLD` (< 39°F, `demandLevel: 'very warm'`), `COLD` (39°F–46°F, `demandLevel: 'warm'`), `COOL` (46°F–55°F, `demandLevel: 'warm'`), `SLIGHTLY_COOL` (55°F–64°F, `demandLevel: 'moderate'`), `COMFORTABLE` (64°F–73°F, `demandLevel: 'light'`), `SLIGHTLY_WARM` (73°F–84°F, `demandLevel: 'very light'`), `HOT` (> 84°F, `demandLevel: 'very light'`), and `EXTREME_HEAT_F` (>= 100°F). Pure classification functions include `classifyPetTemperature`, `classifyPetRange`, and `petBandToThermalDemand`.
2. **Cold Layer Presence Resolution**: In `styling-engine/environmentalRequirements.js`, `resolveColdLayerPresenceRequirement` cleanly separates exposure facts from presence decisions. Ordinary cool/cold exposure (`wakingLowF < 55°F`) without duration facts produces `state: 'recommended'` (advisory `WARM_LAYER_RECOMMENDED`), eliminating arbitrary 1-degree ambient hard validity cliffs. Hard gating (`state: 'required'`, `NO_WARM_LAYER_FOR_COLD`) is strictly reserved for verified severe cold (Contract D: daytime high `highF <= 45°F` or explicit user severe cold statements) or explicit user constraints. Base presence and transit presence are kept separate: `exposureMode === 'indoor_destination'` resolves base requirement as `not_needed`, while transit exposure is evaluated independently under `transitColdPresenceRequirement`.
3. **Master Booleans Purged**: Deprecated master booleans (`requiresOuterwear`, `transitRequiresOuterwear`, `requiresWarmLayerForColdExposure`, `computeRequiresWarmLayerForColdExposure`) are completely eliminated from active code in favor of explicit `state: 'required' | 'recommended' | 'not_needed' | 'unknown'`.
4. **Contract C Decision Consumption**: In `styling-engine/outfitEnvironmentalAdequacy.js`, `evaluateOutfitEnvironmentalAdequacy` (Contract C) evaluates the pre-computed `coldPresenceRequirement` attached by canonical styling context resolution (`resolveStylingContext` in `styling-engine/stylingContext.js`). Contract C never reconstructs decisions or falls back to arbitrary temperature thresholds.
5. **Outerwear Sleeve Capacity Accommodates Logic**: In `styling-engine/outfitValidation.js`, `layerConstructionPair` requires `outerFullyKnown && outerAccommodatesAllInner` when inner sleeves have elevated volume. Straight outerwear without generous cut returns `null` capacity, producing `verdict: 'unknown'` with `sightRequired: 'both'`, while generous cuts (`boxy`, `oversized`) return `'accommodates'` and fitted silhouettes or sleeves return `'restricted'`.
6. **Whole-Wardrobe Feedback Memory Safety**: In `styling-engine/rules.js` (`getWholeWardrobeFeedbackMemory`), `occasion` is safely resolved from `payload.occasion || outfit.bestFor || ''` without ReferenceError and correctly formatted in prompt text.
7. **Batch Thermal Coherence Removed**: The speculative multi-look `evaluateBatchThermalCoherence` post-filter and its file have been deleted to avoid cross-outfit artificial filtering.




**[amended 2026-09-10 — trip planning roster feasibility, weather context injection, and occasion realism]**
Audit of live trip planning run `thread_1789088956759` (Vienna, VA in mid-October: 65°F high / 45°F low, sightseeing, museums, nature walks) identified five structural and prompt defects across the trip packing and composition pipeline:
1. **Stage 2 Weather & Destination Context**: In `routes/ai.js` (`tripRosterSelectionUserText`), destination, dates, and per-slot forecast temperatures are now injected into the prompt so the model chooses suitcase candidates with accurate physical climate awareness rather than guessing seasonal temperatures.
2. **Occasion Realism & Style Constitution in Stage 2**: In `routes/ai.js` (`tripRosterSelectionSystemPrompt`), occasion realism guidance forbids relying solely on dressy, elevated, or high-maintenance outerwear (belted trench coats, blazers) for active outdoor slots (nature walks, hikes) when casual alternatives exist. Furthermore, the ratified Style Constitution (`BODY_CONTRACT`, `PROVEN_FORMULAS`, `AESTHETIC_GRAVITY`, `LANE_NEUTRALITY`, `WORKING_STYLE`) is interpolated into the stage-2 prompt.
3. **Outerwear on Cards & Prompt Realignment**: In `styling-engine/tools.js` (`coldLayerDecisionSchemaProperty`), `styling-engine/outfitSetPlanner.js` (`workbenchInstructions`), and `routes/ai.js` (`tripPlanCompositionSystemPrompt`), instructions to "omit outerwear from piece_ids" were removed. Outerwear is welcomed directly in `piece_ids` when styling outdoor looks. In `styling-engine/outfitSetPlanner.js` (`buildTripPackingLines`), `shownIds` now includes `assignedLayerIds` so assigned packed layers are recognized as used across the rotation and not falsely flagged as "Packed but not shown on a card".
4. **Trip Roster Cold/Cool Feasibility Gate**: In `styling-engine/outfitSetPlanner.js` (`tripRosterFailures`), the cold-floor feasibility check now enforces that any slot with outdoor cool or cold exposure (`isCold` or `needsRemovableCoolLayer`) has at least one slot-eligible, non-inadequate outer layer or warm main in the roster, preventing hiking exertion from bypassing the layer check and trapping downstream composition.
5. **Footwear Construction Diversity & Evening Dining Realism**: In `styling-engine/outfitSetPlanner.js` (`tripBenchBucketKey`), footwear candidates are partitioned by `piece.shoe_type` (e.g. `boot`, `loafer`, `flat`, `sneaker`, `pump`) rather than collapsing all shoes into a single monolithic bucket (`shoes:shoes`), and bottom candidates are partitioned by `bottomKind(piece)`. This prevents low-ID casual sneakers and slip-ons from exhausting the candidate bench during round-robin truncation. In `routes/ai.js` (`tripRosterSelectionSystemPrompt`), occasion realism guidance explicitly directs the roster chooser to provision footwear matching distinct occasion registers across the itinerary (e.g. sneakers/support shoes for nature walks and sightseeing; polished boots, loafers, or elevated flats for evening dining).


**[amended 2026-09-10 — trip outerwear visual representation and cold layer decision clarification]**
Investigation of live run `thread_1789087645325` (weekend trip to Carmel-by-the-Sea) revealed that an outerwear piece (e.g. plaid fleece coat) assigned for warmth on an outdoor coastal walk was omitted from the outfit card's `piece_ids` because schema descriptions and prompt instructions explicitly instructed the model that assigned layers were "not part of the card's visual identity, do not also put it in piece_ids". Per product owner clarification, outerwear is not forbidden from outfit cards:
1. **Outerwear Directly in `piece_ids`**: When an outfit is meant to be worn with outerwear (e.g. an outdoor coastal bluff walk where the coat/fleece is part of the look), the outerwear piece can and should be included directly in `piece_ids` (with `cold_layer_decision.mode = 'core_is_warm_enough'` and `assigned_layer_piece_id = null`).
2. **Non-Punitive Tolerance for Packed Layers**: The intent of `assigned_packed_layer` is tolerance, not exclusion: if a trip's suitcase already contains a packed outerwear piece, the model is not penalized with an under-warmth failure when a card shows an indoor or milder base alone (without outerwear in `piece_ids`), as long as it names a compatible packed layer via `mode: 'assigned_packed_layer'`.
3. **Prompt & Schema Alignment**: In `styling-engine/tools.js` (`coldLayerDecisionSchemaProperty`), `styling-engine/outfitSetPlanner.js` (`workbenchInstructions`), and `routes/ai.js` (`tripPlanCompositionSystemPrompt`), prohibitions ("do not put it in piece_ids just to satisfy this", "do not also put it in piece_ids", "rather than forcing it into piece_ids") were removed and replaced with positive guidance that outerwear may be directly included in `piece_ids` or named as a packed layer without penalty.

**[amended 2026-09-10 — trip-planning wearability parity, occasion realism, and cool-weather assigned layer preservation]**
Investigation of live trip planning test (`thread_1789078763664` — weekend trip to Carmel-by-the-Sea: coastal bluff walk, polished dinner, relaxed Sunday brunch) identified two styling/composition defects:
1. **Trip Plan Prompt Parity & Occasion Realism**: In `routes/ai.js` (`tripPlanCompositionSystemPrompt`), `PHYSICAL_WEARABILITY_REALISM_RULES` from `styling-engine/promptRuntime.js` is now interpolated into the atomic trip composer's prompt. Occasion realism and outdoor utility rules were added to prevent inappropriate assignments (e.g. assigning a formal belted trench coat to a casual coastal bluff walk). In nature/scenic walk/coastal walk slots, outerwear must offer weather utility (wind/chill protection, mobility) and match casual footwear/bottoms rather than formal/urban tailoring.
2. **Cool-Weather Assigned Packed Layer Preservation**: When trip slots have cool transition weather (e.g. 52°F–65°F breezy conditions where `slotColdLayerRequired` is false but `needs_removable_cool_layer` is true), the model is encouraged to assign a packed outerwear layer via `cold_layer_decision: { mode: 'assigned_packed_layer', assigned_layer_piece_id: ... }`. In `styling-engine/outfitSetPlanner.js`, exported `slotColdLayerPermitted(slot)` and updated `validateSubmittedPlanOutfits` to accept `mode: 'assigned_packed_layer'` when cool layers are permitted. In `styling-engine/tools.js`, `sanitizedOutfits` was updated to preserve model-assigned packed layers when `slotColdLayerPermitted(slot)` is true, rather than destructively clearing the decision to `not_required` / `null`, resolving the advisory under-warmth flag on transition cards.

**[amended 2026-09-10 — multi-look batch thermal coherence and relative date / qualitative weather translation]**
Evaluation of multi-outfit conversational queries (such as `thread_1789078671806`: "Friday evening art gallery opening followed by dinner at a nice wine bar (indoor evening, mild weather)") revealed two styling engine gaps in multi-look generation:
1. **Conversational Date and Qualitative Weather Resolution**: When users specify relative dates ("Friday", "tomorrow") or qualitative atmospheric descriptions ("mild weather", "chilly evening", "warm afternoon"), earlier turns either discarded the weather entirely (defaulting to null / unconstrained neutral heuristics) or failed to resolve relative days into concrete calendar dates for live forecast lookup. In `styling-engine/tools.js` (`USER_WEATHER_SCHEMA`) and `styling-engine/prompts.js` (`Destination & Weather Clarification`), instructions now require the stylist to resolve relative days of the week into explicit `YYYY-MM-DD` date strings and map qualitative weather statements into structured `user_weather: { temperature_band: 'mild' | 'cold' | 'hot' }`. Stated qualitative bands take precedence over peak daytime forecasts for evening or indoor events where diurnal drop occurs.
2. **Multi-Outfit Batch Thermal Coherence Gate**: In `styling-engine/outfitThermalCoherence.js`, `evaluateBatchThermalCoherence(outfits, { candidatePieces, weatherProfile, maxSpread = 1 })` evaluates the thermal level (`effectiveIdx`, `baseIdx`, and `upperIdx`) of each generated outfit in a comparison set. When multiple outfits are requested for the same occasion and weather context, all delivered outfits must share a consistent thermal baseline (within `maxSpread` ordinal warmth levels, anchored by the target weather profile or the batch median). In `routes/ai.js` (`generateWholeWardrobeOutfitsVisualInternal`), prompt guidance instructs the visual composer on `THERMAL & SEASONAL COHERENCE`, and candidate proposals failing `evaluateBatchThermalCoherence` are routed into `batchThermalRejected` and surfaced via `paidRejectedDiagnostics` as transparent diagnostic cards rather than contaminating the delivered set with contradictory thermal extremes (e.g. high-summer sleeveless linen alongside cool-autumn wool knits).

**[amended 2026-09-10 — single-outfit card replacement and thermal layering discipline]**
Live evaluation of `thread_1789030900626` (46°F brisk walk) exposed two styling issues: the model stacked a heavy down puffer coat over a knit cardigan and gathered mock-neck turtleneck (causing thermal overshoot and sleeve binding), and submitted a second proposal during its advisory retry turn that resulted in two cards rendered for a single-outfit (`limit: 1`) request. Three targeted fixes resolve these behaviors:
1. **Coats vs. Middle Knits as Alternatives (Not Mandatory Stacks)**: In `buildSingleOutfitStylistCatalog` (tools.js) and `singleOutfitStylistTemplate` / `stylistSystemTemplate` (prompts.js), cold weather instructions now direct the model to pull insulating coats OR middle layer knits. A warm coat over a top is sufficient on its own; prompts explicitly forbid layering cardigans under heavy coats/puffers in cool weather, reserving 3-layer systems strictly for lightweight uninsulated outer shells.
2. **Sleeve Volume Discipline**: Prompt guidance mandates checking sleeve shape and volume before pairing: extra arm volume (gathered/ruched or voluminous sleeves) cannot fit inside narrow or structured outerwear sleeves.
3. **Single-Outfit Proposal Replacement**: In `executeTool('propose_outfit')` (tools.js), when `toolContext.executionProfile === 'single_outfit'`, a subsequent proposal replaces the existing card in `toolContext.generatedOutfits` rather than appending, guaranteeing that exactly one card represents the single-outfit request.

**[amended 2026-09-10 — outer sleeve accommodation, weather key parity, and visual composer thermal scoring]**
Follow-up evaluation on `thread_1789033112546` and sleeve layering physics surfaced three corrections across layering validation and multi-outfit visual composition:
1. **Outer Sleeve Accommodation**: In `styling-engine/attributes.js`, `pieceOuterSleeveCapacity` identifies that outerwear with generous cut (`silhouette` or `fit_on_body` in `boxy`, `oversized`, `relaxed`, `loose`) or heavy cold-weather insulation (puffer coats, down parkas, quilted jackets) has ample sleeve volume to accommodate gathered or voluminous inner sleeves. In `styling-engine/outfitValidation.js`, `layerConstructionPair` now only flags sleeve bunching when the outer sleeve capacity is explicitly `restricted`, avoiding false-positive sleeve warnings when generous puffers or oversized coats are layered over gathered tops.
2. **Snake-Case Temperature Resolution**: In `styling-engine/exposure.js`, `resolveConditions` resolves `t?.high_f` and `t?.low_f` in addition to camelCase properties, preventing weather profiles from defaulting to `no_conditions` when temperature objects use database/serialized snake_case keys.
3. **Visual Composer Thermal Scoring Parity**: In `styling-engine/rules.js` (`buildVisualComposerRoster`), Step 4 thermal ranking now properly awards well-matched pieces with `rosterFit.fit === 'adequate'` a positive bonus (`weatherBonus += (10 - fineAdjustment)`) instead of mistakenly penalizing non-negative offsets as overshoots. Furthermore, in `routes/ai.js` (`generateWholeWardrobeOutfitsVisualInternal`), an explicit cool/cold weather outer layer mandate is injected into model instructions when `needsRemovableCoolLayer` or `isCold` is set.

**[amended 2026-09-10 — freeform stylist chat parity: universal wearability physics, catalog salience, and advisory findings]**
The weather physics, catalog salience, and model communication improvements calibrated and ratified in PR #316 on `single_outfit` are now propagated across all primary freeform stylist chat flows (`full_stylist`, `bounded_multi_look`, `trip_capsule`, and conversational follow-ups):
1. **Catalog & Visual Salience**: In `src/utils/wardrobeAiContext.js` (`buildWardrobeManifestLine`), `warmth:${level}` is promoted to the front of garment attributes, and middle knits/cardigans/vests are explicitly tagged as `outerwear (layer_top)`. In `styling-engine/tools.js`, `singleOutfitStylistCatalogLine` is exported as `stylistCatalogLine` and projected unconditionally beside photographs in `view_pieces` across all execution profiles, ensuring identical visual salience of warmth, layering capability, and separated textile tokens.
2. **Universal Physical Wearability & Realism Prompt**: In `styling-engine/prompts.js` (`stylistSystemTemplate`), the ratified `PHYSICAL WEARABILITY & DRESSING REALISM` section is ported into the universal stylist prompt. It codifies thermal adequacy & exposure duration realism (uninsulated shells suited for 55–65°F, prolonged sub-50°F cold requiring an insulating coat or an intentional 3-layer system with a middle knit layer), low-exertion walking vs. hiking physics, sleeve bulk/geometry checks, middle-layer 3-tier gathering, and candor over rationalization. It also explicitly forbids `<card>` XML tags, raw JSON, and markdown table/bullet garment summaries in model prose.
3. **Advisory Wearability & Multi-Look Parity**: In `styling-engine/tools.js` (`propose_outfit`), inferred wearability findings (`environmental_adequacy` / thermal undershoot and `layer_construction` / sleeve bunching) are treated as non-blocking advisory notes across all execution profiles (`full_stylist`, `bounded_multi_look`, etc.). Hard blocking is strictly reserved for role/structural validity (`kind === 'role_structure' || kind === 'structure'`) and candidate pool autogates on unanchored pieces. Non-blocking findings populate `outfit.systemFlags`, set `disposition: 'annotated'`, and return `systemNotes` to the model. In `styling-engine/outfitSetPlanner.js` (`validateSubmittedPlanOutfits` and `assembleSubmittedPlanOutfits`), advisory wearability findings attach to `outfit.systemFlags` and mark multi-look cards with `disposition: 'annotated'`, enabling `.stylist-outfit-flag-chip` chips to render across multi-look, capsule, and trip cards.

**[amended 2026-09-10 — bounded multi-look visual composer parity and delivery resilience]**
The PR #316 improvements (catalog warmth salience, physical wearability prompt parity, cold outerwear allocation, and delivery resilience) are migrated into the bounded multi-outfit visual composition flow (`generate_outfits` -> `generateWholeWardrobeOutfitsVisualInternal`):
1. **Outerwear Cold Allocation Partitioning**: In `styling-engine/rules.js` (`buildVisualComposerRoster`), when cold conditions demand warmth (`isCold` or `rosterDemand` level is `warm`/`very warm`) and category limits apply, the outerwear category cap partitions slots to reserve at least half (minimum 2) for cold-weather outerwear, filled coats, and insulating jackets. This prevents knit cardigans with casual-material bonuses from displacing all true cold-weather coats (puffer coats, fleece coats, leather coats) from reaching the composer's visual roster.
2. **Visual Composer Thumbnail Labels**: In `routes/ai.js` (`composerPieceLineSuffix`), candidate thumbnail labels accompany each image with physical wearability facts: `warmth:${level}`, `weight:`, `insulation:`, and `protect:`.
3. **Physical Wearability Prompt Parity**: In `styling-engine/prompts.js`, `PHYSICAL_WEARABILITY_REALISM_RULES` is exported as a shared constant and interpolated into `wholeWardrobeVisualComposerTemplate` (`WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM`), enforcing dressing realism, cold exposure insulation requirements, and sleeve volume physics.
4. **Rejection & Shortfall Delivery Contract**: In `routes/ai.js` (`generateWholeWardrobeOutfitsVisualInternal`), when the visual composer AI produces zero structurally valid outfits (`!modelOutfits.length`), the system recovers via `validatedFallback` from local candidate generation (`buildVisualLocalBackfill`), while partial shortfalls with rejected model proposals surface candidates as transparent diagnostic cards (`buildBrokenModelCard`).
5. **Prompt Tail & Catalog Cleanliness**: In `routes/ai.js`, activity-profile footwear discouragement rules (`discouraged_footwear_warm`, `discouraged_materials_warm`) are conditionally gated on `weatherProfile?.isHot` and `season === 'summer'` so cold-weather walking prompts never discourage boots; visual composer category section headings are normalized to clean grammatical plurals (`DRESSES`, `SHOES`, `OUTERWEAR`, `ACCESSORIES`); and renderer/wear mechanics guidance in the prompt tail is consolidated into one authoritative instruction block. In `styling-engine/rules.js` (`getWholeWardrobeFeedbackMemory`), feedback note suppression is trimmed at word boundaries to eliminate broken partial words.
6. **Shared Prompt Primitive Cleanliness & Sleeve Harmony**: In `styling-engine/prompts.js`, `PHYSICAL_WEARABILITY_REALISM_RULES`'s sleeve layering bullet is streamlined to harmonize with the canonical `layerConstructionPromptRule()` from `styling-engine/outfitValidation.js`. It removes the inaccurate conflation of fabric bulk with sleeve volume and clarifies outer sleeve capacity: a structured or narrow outer sleeve cannot accommodate an inner sleeve with excess volume (puff, gathered/ruched, voluminous, or flared), but generous, relaxed cuts and roomy puffer coats have space to accommodate layered sleeves without binding.
7. **Selected-Piece Flow Catalog & Activity Rules Parity**: In `routes/ai.js` (`composeSelectedPieceVisualWardrobeOutfits`), activity-profile footwear and material discouragement rules are conditionally gated on `weatherProfile?.isHot` and `season === 'summer'`, eliminating false discouragement of boots and warm materials on cold-weather selected-piece turns. Support category section headings are normalized to clean grammatical plurals (`SUPPORT DRESSES`, `SUPPORT SHOES`, `SUPPORT OUTERWEAR`, `SUPPORT ACCESSORIES`), matching the visual composer standard.
**[amended 2026-09-15 — items 5 and 7 are superseded: the taste lists left the prompt entirely]**
The occasion and activity `preferred_*` / `discouraged_*` lists are no longer rendered into any
model-facing prompt, so there is nothing left to weather-gate in the prompt tail. They remain what
`docs/occasion_profiles_ratification.md` ratified them as — soft roster scoring (+8/+10 preferred,
−8/−10 discouraged in `rules.js`), never suppression. See the 2026-09-15 amendment below.

**[amended 2026-09-15 — items 1, 2 and 8 (below) are superseded]** Model-facing garment lines no longer carry a derived `warmth:` level or the name-derived `outerwear (layer_top)` label, and the composer thumbnail labels no longer come from `composerPieceLineSuffix` (removed). Whole Wardrobe, selected-piece and repair composers and trip composition use the shared fact line; `/ask` uses its sparse rendering; the plan workbench line, search thermal facts and the manifest line state recorded construction without a warmth level. See `docs/garment-evidence-parity-2026-09-15.md` §7.
8. **Plan and Capsule Workbench Warmth & Layering Salience**: In `styling-engine/outfitSetPlanner.js` (`planWorkbenchPieceLine`), middle-layer cardigans and knit vests are tagged distinctly as `outerwear (layer_top)`, and `warmth:${level}` is promoted to the front of garment attributes for non-shoe/accessory pieces, giving trip packing and seasonal capsule models immediate salience of thermal facts and layer roles across multi-look slots.
9. **Universal Stylist Tool Loop Prompt Cleanliness**: In `styling-engine/prompts.js` (`stylistSystemTemplate`), removed redundant duplicate parenthetical phrasing in the card presentation instruction (`Focus your prose on explaining the silhouette, visual proportion, texture interplay, and practical wearing advice`). Verified alignment between the tool-level cold layering logic and the shared physical wearability prompt primitives, with all byte deltas tracked in `test/prompt_equivalence.test.js`.
10. **Natural Single-Temperature Summary Phrasing**: In `styling-engine/tools.js` (`toolContext.boundedWeatherSummary` and `resolvedSeason`), when the high and low temperatures are identical (such as from a single user observation like 'around 58°F'), the summary formats as `a temperature around ${highF}°F` rather than repeating `a forecast high of ${highF}°F and low of ${highF}°F`. Ranges where high and low differ continue formatting as `a forecast high of ${highF}°F and low of ${lowF}°F`.

**[amended 2026-09-09 — ordered middle-layer thermal contribution]** The environmental validator
previously reduced every removable upper-body garment to the single warmest garment. An explicit
`primary_top`/`dress` → `layer_top` → outermost `outerwear` chain therefore received the same
thermal contribution as its light jacket alone, even when all three garments were known
substantial and `evaluateLayerPairConstruction` found both adjacent relationships wearable.
`outfitThermalContribution` now gives that exact ordered three-layer system one bounded ordinal
step above its strongest member when every member is at least `moderate`. It does not numerically
sum levels. Two-piece systems, flat arrays without roles, unknown evidence, and simpler outfits are
unchanged; `evaluateWearableOutfit` still independently owns physical construction and final
environmental validity. On the copied live wardrobe, the provider-free
`scratch/diagnose_single_outfit_layering.mjs` used a diagnostic-only name split for obvious middle
versus outermost layers and found 508 compatible systems whose middle layer changes
the exact 60→48°F cold result from undershoot to adequate while leaving an adequate top-plus-middle
system at 60°F after the outermost layer is removed. The model still authors the outfit.

**[amended 2026-09-09 — explicit activity and pre-photo candidate validity]** Live acceptance
`thread_1788985997110` routed a five-hour Santa Fe “outing” as `activity:walking` even though the
request contained no walking language and the router prompt explicitly forbade that inference. The
result wrongly activated hard footwear exclusions. `routeFreeformExecutionProfile` now projects
activity from an explicit structured UI value when supplied, otherwise `extractExplicitActivity`:
only affirmative walk/stroll/on-foot or hike/trail language can establish the structured activity;
location, outing, sightseeing, and outdoor duration alone
remain `none`, and negated mentions remain inactive.
**[amended 2026-09-15 — a default `none` is not authority]** The chat UI's activity picker defaults to "No special activity"
and sends `activity: none` on every turn, and `routeFreeformExecutionProfile` treated that as the structured value, discarding
explicit language. Live threads `thread_1789501326521` (/ask, "walking around the city outdoors from 4–8 p.m.") and
`thread_1789501370356` (Whole Wardrobe) were locked to `none`: the /ask search and the Whole Wardrobe roster never applied the
walking footwear gate (`excluded_heel_heights: mid, high`), so mid-heel wedges and pointed heels were delivered for a four-hour
walk. Now only a structured `walking`/`hiking` selection is authority; a structured `none` or empty value falls back to
`extractExplicitActivity`, which still returns `none` for outings without walking language. The same run spent its initial photo budget on
two `warm:moderate` outerwear directions for a certain 60→48°F breezy range, then repeated the error
with another moderate jacket. The first `view_pieces` call now runs each model-authored direction
through the same shared `evaluateWearableOutfit` hard-fact stages before loading images. Invalid
directions return factual findings and spend no photo budget; code still supplies no alternative,
rank, or aesthetic verdict. A sparse default for dominant `formal:everyday`, with missing values
explicitly emitted as `formal:unknown`, reduces the copied 208-piece catalog from 44,301 to 42,646
characters without dropping information.

**[amended 2026-09-09 — visual workbench, upfront thermal guidance, and advisory feedback loop in single_outfit]**
The mandatory `candidate_directions` pre-photo validation in `single_outfit`'s first `view_pieces` call is superseded by a visual workbench approach. The model pulls 8–12 piece IDs across roles directly onto a visual workbench (`view_pieces({ ids: [...] })`), with an optional second view of up to 4 replacement IDs. Pre-photo wearability gates (thermal undershoot, sleeve geometry) on candidate directions are removed. `search_wardrobe` computes the target upper-body thermal band from resolved conditions and includes `thermal_guidance` directly on the sparse catalog. In `propose_outfit`, hard validation blocks solely for unverified/non-existent IDs, structural incompleteness (missing bottom/dress, missing shoes, slot collisions), and explicit user exclusions (e.g. "no shorts"). Inferred metadata concerns (thermal adequacy, sleeve bunching, footwear activity, occasion/register fit) attach as advisory system notes and system flags (`disposition: 'annotated'`) on the accepted card. When a proposal is accepted cleanly without advisory notes, the tool loop terminates immediately; when advisory notes attach, the tool loop allows one follow-up iteration so the model sees the system notes, enabling it to either swap pieces or address the physical trade-off candidly in its final prose rather than delivering premature text generated before seeing the validator's notes. Other flows (`full_stylist`, trip, capsule, batch) retain existing behavior.

**[amended 2026-09-09 — visible advisory card face chips and voice candor]** To ensure advisory wearability findings (e.g. thermal undershoot or sleeve bunching) are clearly disclosed to the user rather than hidden inside the collapsed 'Why this outfit' accordion, `StylistChat.jsx` renders `outfit.systemFlags` directly beneath the card title as styled advisory chips (`.stylist-outfit-flag-chip`). Furthermore, `SINGLE_OUTFIT_STYLIST_SYSTEM` includes universal candor guidance: the model must not invent warmth, wind protection, or comfort capabilities to justify an outfit, but must candidly disclose physical trade-offs when prioritizing venue style over outdoor weather extremes.

**[amended 2026-09-10 — single-outfit declare_intent bypass, catalog token separation, and prompt streamline]**
To eliminate attention sinks and cognitive overload on smaller models (Gemini Flash-Lite), `single_outfit`'s tool surface is reduced from four tools to three (`search_wardrobe`, `view_pieces`, `propose_outfit`). The router already establishes `outfitCount: 1` and `want: 'cards'`; `declareSingleOutfitIntent` seeds `toolContext.declaredIntent` directly in `routes/ai.js`, removing the redundant `declare_intent` model roundtrip. In `singleOutfitStylistCatalogLine`, fabric category (`fab:cotton`) and textile weight (`weight:medium`) are separated into distinct tokens rather than combined with a slash, and warmth is explicitly tagged as `warmth:${level}` to avoid model conflation of fabric weight with thermal warmth. `SINGLE_OUTFIT_STYLIST_SYSTEM` is streamlined into a direct four-step workflow with positive dressing physics (insulating coat or 3-layer system for sub-50°F cold outdoor exposure) and explicit instructions not to re-list pieces in markdown bullet points or tables since the interactive UI card already displays them. In `propose_outfit`, thermal undershoot advisory notes provide actionable advice (`Outdoor conditions call for warmer upper coverage. Swap to an insulating outer layer, add an insulating middle layer (cardigan/vest), or address this trade-off candidly in your final note.`).

**[amended 2026-09-10 — weather salience levers and advisory findings pass-through in single_outfit]**
Investigation of thread `thread_1789016992434` (46°F outdoor walk) showed the model defaulted to lightweight jackets (`warmth:light`) because insulating coats and middle layers were not salient during initial workbench candidate gathering, and `propose_outfit` dropped advisory wearability findings because line 2388 previously read only `wearableValidation.hardFindings` (which contains only `severity === 'error'`). Five complementary levers resolve this without rigid engine rejection:
1. Warmth Salience: In `singleOutfitStylistCatalogLine`, `warmth:${warmth}` is promoted to the very first token in the facts segment immediately following the category/group, giving immediate scanning priority over fabric texture or sleeve cut.
2. Workbench Seeding: In `buildSingleOutfitStylistCatalog` and `SINGLE_OUTFIT_STYLIST_SYSTEM`, when conditions call for substantial warmth (`warm` or `very warm`), the instruction explicitly directs the model to pull 2–3 insulating outer coats and 2–3 middle layer knits onto its visual workbench alongside tops and bottoms so it has the visual candidates needed to construct an adequate system.
3. Middle-Layer Tagging: In `singleOutfitStylistCatalogLine`, outerwear cardigans and vests are distinctly tagged as `outerwear (layer_top)` (e.g. `#88 striped knit cardigan | outerwear (layer_top) | warmth:moderate;...`), visually distinguishing them from outermost protective shells and signaling their layering role.
4. Exposure Duration Realism: In `SINGLE_OUTFIT_STYLIST_SYSTEM`, prompt guidance explicitly grounds convective cooling: 2–3 hours walking outdoors in 46°F wind is prolonged cold exposure; a single uninsulated shell (`warmth:light`) is suited for 55°F–65°F, not extended sub-50°F cold.
5. Advisory Findings Pass-Through: In `propose_outfit` (tools.js), `wearableValidation.advisoryFindings` is merged into `nonBlockingFindings` for `single_outfit`. Inferred thermal adequacy undershoots (when `requireThermalAdequacy: false`) now cleanly reach `singleOutfitAdvisoryNotes`, attach visible chips to the card, and give the model a follow-up turn to either swap pieces or address the physical trade-off candidly.

**[amended 2026-09-10 — suppression of raw <card> machine markup from conversational prose]**
In live acceptance thread `thread_1788877846`, the model emitted an inline `<card>{"label": "...", "pieces": [...]}</card>` XML block inside its conversational prose reply. Because `exposesRawStructuredPayload` (rules.js) previously only checked fenced code blocks (```` ```...``` ````), unfenced or `<card>`-tagged JSON payloads survived `applyAcceptedCardAuthority` (provider.js). Three coordinated layers suppress this leakage:
1. Prompt Instruction: `singleOutfitStylistTemplate` Step 4 explicitly directs the model not to output `<card>` tags, raw JSON, or machine markup in its text, as the UI card is rendered solely by `propose_outfit`.
2. Authority Filter: `exposesRawStructuredPayload` detects `<card>` / `</card>` tags and unfenced outfit JSON containing keys like `pieces`, `label`, or `why_it_works`, allowing `applyAcceptedCardAuthority` to withhold leaked machine paragraphs.
3. Response Boundary Scrubbing: `stripPieceIdCitations` scrubs any remaining `<card>...</card>` blocks and dangling `<card>` tags at the final delivery boundary in `routes/ai.js`.

**[amended 2026-09-09 — model-owned comparison is now observable]** Live acceptance
`thread_1788939301104` proved that complete catalog access alone did not create meaningful choice:
the stylist viewed exactly one top, bottom, shoe, and coat, then repaired only the rejected coat.
The first `single_outfit` `view_pieces` call now carries 2–3 model-authored complete candidate
directions. Each names its own hero, visual thesis, and role-assigned IDs. Code checks catalog
membership, shared role structure, distinct heroes/piece sets, the explicit outerwear obligation,
known hard wearability facts, and the twelve-identity visual ceiling; it constructs no direction
and makes no aesthetic comparison.
The model may choose or recombine any viewed pieces. The optional second call remains a four-ID
targeted repair. The same run showed that the large catalog contained `fit:clings_stretchy` and
`warm:moderate` for the chosen top while `view_pieces`' later truth line dropped both. On this profile,
viewed candidates now repeat `singleOutfitStylistCatalogLine`, preserving the exact selection facts
beside the photograph; other flows retain `buildWardrobeManifestLine` unchanged.

**[amended 2026-09-09 — stated-temperature syntax and single-temperature preservation]** The
canonical request previously stated either its wearing-window endpoints separately—“60°F when I leave”
and “48°F after sunset”—or a single flat temperature like “It's 46°F, overcast, and breezy”.
`extractStructuredUserWeather` previously required two endpoints and returned `null` for a single
stated temperature, which led downstream prompts to inject "No numeric weather range was stated" and
invented seasonal climate estimates (e.g. 65°F replacing 46°F). `extractStructuredUserWeather` now
accepts both paired endpoints and single Fahrenheit observations (projected as flat `high_f: temp, low_f: temp`),
excluding only explicit past references (e.g. "yesterday") or ambiguous text requiring climate
interpretation. Literal dry and breeze language is projected as precipitation/wind fact.

**[amended 2026-09-09 — model-owned single-outfit catalog supersedes system selection]** The
2026-09-08 system-aware roster below was a failed ownership experiment and has been removed from the
`single_outfit` flow. `search_wardrobe` now returns every hard-eligible garment in an identity-ordered,
sparse `stylist_catalog`; it attaches no photographs and constructs, evaluates, or selects no outfit
paths. Model-authored descriptive filters cannot narrow that complete catalog; categories and shared
hard context gates still apply. The model authors 2–3 complete candidate directions spanning up to
twelve catalog IDs for its first `view_pieces` comparison, with one optional targeted
second view of up to four IDs when the first photographs expose a real problem, then composes one proposal.
`propose_outfit` retains shared structural, environmental, removable-state, sight, and ID validation.
Catalog identities do not count as retrieved or seen: a photo-bearing proposal must have been viewed.
The search response also reports every hard-excluded identity count grouped by the actual gate reason,
so a visual subset can no longer be mistaken for wardrobe absence. On the copied 208-survivor live
fixture, `buildSingleOutfitStylistCatalog` now measures 42,646 catalog characters versus the prior
54,709-character compact index, with zero search images and zero engine-selected paths; reproduce
the copied-database measurement with `scratch/diagnose_single_outfit_catalog.mjs`. This change
is scoped to `single_outfit`; trip, capsule, batch, swap, and ordinary full-stylist retrieval are
unchanged.

**[amended 2026-09-07 — single-outfit retrieval cap]** A fresh `single_outfit` execution profile
does not receive the whole-wardrobe manifest, so `search_wardrobe` returns full stable garment truth
but caps the post-validity, post-context-order roster at ten pieces per category. Its photograph
budget is six per category. The cap is scoped by `toolContext.executionProfile`; every other search
consumer retains the existing complete row behavior and 16-per-category / 40-total visual budget.
The narrow route's exact stated `user_weather` is retained in tool context as a structured fallback,
so omission by a model tool call cannot revert the action to a lossy prose range or live weather.

**[superseded 2026-09-09 — system-aware one-outfit roster]** When a
`single_outfit` compose search requests enough categories for a complete outfit,
`buildSystemAwareWeatherRoster` receives the complete post-gate pool. It preserves every survivor in
a compact identity/fact index, builds a bounded structured-construction frontier, validates complete
dress-or-separates paths through `evaluateWearableOutfit`, and allocates rich rows/images only as the
atomic union of up to four feasible paths. Required removable layers are ordinary outerwear IDs;
range requests compare the full cold state and the actual remaining warm state. Selection prefers
known adequate paths, then shared thermal distance and new physical construction facts, with at most
one warmer boundary for a genuinely variable demand. No resolved demand preserves structural order.
Construction diversity is projected from `pieceWeatherEvidence`'s derived thermal degree; the roster
does not read or reinterpret stored `interior_construction` values as a second flow-level authority.
The old ten-row/per-warmth cap remains only for narrow or incomplete single-outfit searches that
cannot form whole systems; every other flow is unchanged. The response and internal diagnostics name
logical versus actually evaluated path counts, hard findings, budget skips, omitted photograph IDs,
and the final proposal's relationship to the supplied roster.

**[superseded 2026-09-09 — adaptive role-chain roster correction]** Fixed per-category construction
frontiers are not candidate quotas. Each role frontier stops when no remaining garment adds a new
structured physical facet. Under a required variable-weather layer, the system grammar admits one
outerwear-category middle layer assigned `layer_top` beneath one outermost `outerwear` piece; the
shared direction/construction stages validate both adjacent relationships, and warm-state coverage
removes only the outermost piece. Path deduplication is keyed by the primary core rather than making
outerwear the lead whenever a coat is required.
Double-layer joins stop when no remaining middle/outermost ordering adds a new role-prefixed,
shared-construction-verdict, or warmth-pair physical facet, and known warmer-middle/lighter-
outermost reversals are not constructed. Footwear is
piece-gated before this stage and projected across only the selected clothing systems because no
current validator reads shoe-to-garment relationships. `layerConstructionPromptRule` now matches
the executable owner explicitly: overall `fabric_weight` is not sleeve-volume evidence. Logical and
evaluated path counts remain internally observable but are no longer copied into the stylist
model's compact selection report.

**[amended 2026-09-07 — removable range coverage]** `requiredThermalEndpointBands` owns the warm
and cold demands for an encountered range. `outfitRangeCoverage` evaluates actual configurations:
the full outfit at the cold endpoint, then every configuration produced by removing one real
outerwear piece at the warm endpoint. The warm comparison uses upper-body contribution, so heavy
trousers cannot hide a light top; another cardigan or layer that remains worn still counts.
`evaluateOutfitEnvironmentalAdequacy` hard-rejects a known warm-end undershoot only for the same
narrow contract that already hard-rejects cold undershoot: an explicitly required removable layer
plus a certain stated exposure range. Unknown upper-body evidence remains non-invalidating.

Pass 1 covered side effects, thread state, recency memory, retry loops, prompt splices and sweeps.
Pass 2 added scoring, caches, CI ratchets and the import pipeline's model calls. Pass 3 added the
gates — every layer, in order, with measured exclusion counts per context. Pass 4 added the
outfit-level pass after the gate and closed every question the earlier passes had raised. Pass 5
measured the diversity classifiers, traced what repair actually does, and measured
`compatibilityScoreForSelectedItem`. Pass 6 mapped **the image-generation path** — producers,
models, reference payloads, the fallback ladder, and how cost is reported. Pass 7 mapped **the
image prompts themselves**, pass 8 **the tagger prompt** — the upstream call that populates
every column the rest of this document measures — pass 9 **provenance**, which columns are
owner-set versus model-set, pass 10 **the role vocabulary** behind formula-family
classification, and a sweep that found **the singular/plural gap** — a bug class that understates
several of this document's own measurements — and `extract-pieces`, the tagger's weaker sibling.

**Start at [Findings this map produced](#findings-this-map-produced)** — thirty-four things that
were not known before this document existed, including one unreachable code path, a billed render
that reports no cost, a cost gate that under-quotes by 1.6x, two fully-built features with zero
adoption, and a fidelity gap that lines up exactly with the most common recorded render complaint.

Three of those findings **withdraw or reorder recommendations made earlier in this same
document**; each is marked in place. All three were caught the same way: by checking **provenance**
— whether a value was set by the owner or by the tagger, and which prompt version produced it.
There is now a section and a script for exactly that check. **Run it before acting on any column
conflict.**

**A note on method:** an `[unverified]` tag is a debt, not a disclosure. Where a question was
answerable against the read-only wardrobe or by tracing call sites, it was answered here rather
than recorded. What remains tagged is genuinely undecidable without an owner ruling or a billed
call.

## What this is for

The surface map is derived UI-first — routes, tabs, mode gates, dialogs — so it is **structurally
blind to anything that never renders**. Every non-UI behaviour that reached it got there by
accident: one from a screenshot, one from an unrelated grep, one because the owner pointed at a
panel footer.

This map walks the other axis: **writes, prompt splices, retry loops, caches and sweeps.** That is
where the expensive surprises live, because none of it is visible to the owner or to a review panel.

Derived by `scratch/derive_engine_behaviours.js`, with the numbers measured against the real
wardrobe by `measure_scoring_terms.js` (per-term scoring frequencies), `measure_gate_impact.js`
(per-context gate exclusions), `measure_diversity_classifiers.js` (repeat-detection buckets),
`measure_image_path.js` (image-generation inputs) and `measure_open_questions.js` (the findings
below). All are read-only and make no model call — the image script never even constructs an
OpenAI client. The derivation finds *mechanisms*, not intent — a side effect is not automatically wrong. Same tags as the surface map:
**[by design]**, **[known bug → ref]**, **[unverified]**, **[owner check wanted]**.

---

## Side effects — writes that happen as a consequence of something else

Ninety-two write sites exist across the codebase. Most are ordinary CRUD, where a request says
"save this" and the handler saves it. **Seven originate inside `styling-engine/`**, which means
they fire as a side effect of composing or answering, not because anyone asked:

| write | trigger | entry |
|---|---|---|
| `stylist_conversation_state` | every stylist turn | thread state, below |
| `stylist_feedback` (`owner_rule`) | model decides you stated a durable preference | surface map → message-level actions |
| `whole_wardrobe_sessions` INSERT + DELETE | every whole-wardrobe generation | recency memory, below |
| `todos` (`metadata`) | a hard gate excludes a garment for missing data | surface map → Tasks |

Plus, from `routes/crud.js`, a single `PATCH /api/saved-boards/:id` fans out to **three** further
writes — retag-suggestion todos, a feedback mirror, and a structured-reason sync. One user action,
four writes, one of them landing in a different feature.

---

## Server-side thread state

**[by design]** `stylist_conversation_state` stores, per session, the established context and the
current outfit set — occasion, activity, season, mood, mission, the active outfit and its piece
ids. On any follow-up turn (anything not flagged `new_request`) the server **restores it and fills
gaps the client omitted**. Body values always win; state only fills blanks.

Why it exists: a follow-up like *"make it warmer"* carries almost nothing, and the thread would
otherwise lose what it was talking about. The comment is explicit that this exists so the thread
*"survives the client omitting fields."*

**Consequence worth knowing:** the same request can behave differently depending on what the server
remembered from earlier in the session, and nothing in the UI shows what was restored. If a
follow-up produces something unexpected, restored state is a candidate — check
`getStylistConversationState` before assuming the prompt or the gates changed.

> `styling-engine/core.js` (restore), `:3824` (read), `:3839` (write); mirrored in
> `tools.js`.

---

## Recency memory, and its cap

**[by design]** Every whole-wardrobe generation appends a row to `whole_wardrobe_sessions` holding
the piece ids and formula families it used, then immediately **deletes everything outside the
newest 10**. So the memory is a rolling window of the last ten generations, not an unbounded log.

That window is what produces *"Skipping N recently used pieces"* in the composer footer, penalising
recent pieces in scoring and reordering the roster. **Include them again** clears the table
outright.

**[by design]** The trim runs on every save, so the table cannot grow. Worth knowing when reasoning
about why a piece reappeared: eleven generations ago is invisible.

> `styling-engine/rules.js`. Surface counterpart: surface map → composer landing panels.

---

## Retry loops around model calls

Two mechanisms live in `askStylistWithTools`, with a second bounded operating profile for critique
follow-ups. All cost money when they advance to another provider iteration.

**[by design] The tool loop runs up to 10 iterations.** The comment records the reasoning and the
history: the disciplined flow — declare, search, view supports, view layers, propose ×N —
legitimately needs 6–8, and *"the old cap of 7 left no margin for a single corrective bounce and
live turns died with zero cards."* So 10 is a deliberate margin, raised after live failures.

**[by design, 2026-08-18] The disclosure pass enumerates EVERY clause, and narration does not
survive a retry.** Two correctness bugs in the first cut of the above, both found in review:

- `applyFreeformOutputChecks` short-circuits on the first failure — that is its job, since it exists
  to pick the next correction to send. Disclosing from a single call therefore surfaced at most one
  unresolved clause, and a newly-introduced failure that had *not* been retried would be returned
  first and mask a retried one behind it, shipping the reply with nothing said at all. The pass now
  re-runs with each found type suppressed, walking the whole list without duplicating a predicate.
- The narration accumulator spanned the whole loop, so a rejected answer's prose was prepended again
  after the model corrected itself — *"Use piece #999."* followed by *"Correction: use verified piece
  #12"* in one reply, with the clause that caught it already out of budget.
  `supersedeNarrationOnRetry` clears it at the correction boundary; narration written afterwards
  accumulates normally, so this is a boundary rather than a discard.

**[by design, 2026-08-17] A guard that spends its retry and still fails now says so.** Each clause
gets exactly one retry; after that `retriedChecks` suppressed it and the answer was returned
unchanged and unremarked, so a fired-but-unfixed guard left the person holding a flawed answer with
no sign of it. The turn contract now adopts capsule's ending — deliver, and state the unmet thing,
the way a bounded capsule ships as `model_repaired_with_gaps`. Not a second retry: the one-per-clause
budget exists to prevent that spiral. `discloseUnresolvedFreeformChecks` re-runs the same predicates
without recording diagnostics; counted as `unresolvedCheckDisclosures`.

**[by design] Output guards retry up to 6 times, one retry per guard.** `applyFreeformOutputChecks`
inspects the finished answer; if it violates a guard, the model is re-prompted with a correction
message. `retriedChecks` ensures each distinct guard only triggers one retry, so the loop cannot
ping-pong on the same violation.

**[by design] Critique follow-ups reuse the tool loop but not its broad authority.** Their
`allowedToolNames` list contains only `search_wardrobe`, `view_pieces`, and
`get_garment_details`; `stylistToolsForTurn` filters the provider-visible schemas to that set.
Their loop ceiling is 3 rather than 10, and `skipFreeformOutputChecks` disables the six general
freeform correction retries. A question answerable from the board/photo and linked pieces therefore
finishes in one call. A semantically phrased request for another owned garment can search and
continue without any client keyword classifier; verification can consume the third and final call.
The aggregate telemetry reports all iterations and tokens as one critique response.

**[flagged, 2026-08-18] Same-context multi-look requests can use one bounded visual-composer
call.** A model-declared new request for 2–5 fresh
looks sharing one occasion, activity and weather context routes through `generate_outfits` once.
The existing whole-wardrobe visual composer retains photograph-based aesthetic judgment and all
deterministic gates. After it returns, the provider loop ends immediately; deterministic code
writes the short introduction and any validation shortfall, and `applyFreeformOutputChecks` does
not reopen the generic card-count retry. One-look requests,
existing-card revisions and multi-context plans retain their existing paths. The nested composer's
usage is accumulated into the parent freeform diagnostics, so cost comparisons include the largest
call rather than only the outer loop. See `docs/freeform-bounded-execution-spec.md`.

**[corrected after live evidence, 2026-08-18] The bounded tool result is the terminal paid step.**
The first live run generated three valid hiking cards but then made a tool-free full-prefix closing
call, creating 32,745 cache tokens and raising total cost from the $0.3247 baseline to $0.3840.
`askStylistWithTools` now returns deterministic introduction/shortfall prose immediately after the
bounded composer succeeds. `generate_outfits` also resolves a supplied location and date before
roster construction and records whether weather was live, stated, or heuristic.

**[tightened after second live evidence, 2026-08-18] Bounded composition no longer buys a separate
intent declaration, and internal deliberation cannot become card advice.** For an eligible flagged
request, calling `generate_outfits` directly establishes `want:"cards"` and the requested count;
all other composing paths retain the declaration gate. The visual composer still reads recent-piece
memory as a soft diversity signal—repetition remains legal when it is best or necessary. Before
delivery, `sanitizeWholeWardrobeOutfitProse` withholds a reason that exposes rebuilding/checking or
cites IDs outside its final card, adds a visible resolution note, and records the issue in composer
debug without making another provider call. This follows `thread_1787079261414`, whose first card
contained the composer’s discarded alternatives while its actual IDs remained valid.

**[owner ruling after third live run, 2026-08-18] Ordinary “what should I wear?” means two
options.** `thread_1787089704692` searched first and only then invoked the bounded composer for two
looks, producing three paid iterations and about $0.3376. Under the flag, the controller and tool
schema now direct this ordinary request straight to `generate_outfits` with a default of two. An
explicit one/best/pick-one request keeps the targeted one-card path, and an explicit count wins.
The same run leaked recent-memory justification through `watchFor`; local prose integrity now
checks `reason`, `watchFor`, and `stylingInstructions` independently.

**[owner-ratified, implemented 2026-09-06] One outfit has one serial route and an explicit layer
obligation is mechanical.** `generate_outfits` is now a 2–5 whole-wardrobe batch tool. In
`executeTool`, a whole-wardrobe request resolving to one card returns a local validation error before
the nested composer; selected-piece generation and unrelated direct endpoints are unchanged. This
closes the alternate `limit:1` path that sat outside `declareBoundedMultiLookIntent`'s bounded profile
and therefore passed `null` as the nested composer's resolved weather.

For the serial path, `declare_intent` requires `layer_requirement:'required'|'unspecified'` whenever
`want:'cards'`. Missing or invalid values do not mutate `toolContext.declaredIntent`; they return a
local validation error. The implicit 2–5 batch declaration records `unspecified` without another
provider iteration. When `required`, `propose_outfit` checks the resolved pieces with
`outerwearPieces`—structured `wardrobeCategoryGroup === 'outerwear'`, never names or the model-written
role—and refuses a card with none. A fake `layer_top` role cannot satisfy it. The existing sight gate
now includes the ordinary `outerwear` role, so a photographed required layer must also have been seen
this turn. The gate decides only presence; existing eligibility and environmental validity remain
hard, while the model still chooses the layer from images and thermal facts. See
`docs/single-outfit-weather-layer-vertical-slice-spec.md`.

**[live-acceptance correction, implemented 2026-09-07] Presence was necessary but not sufficient.**
The first live check accepted a deep-armhole top beneath fitted-sleeve outerwear because
`layeringCandidatePairs` enumerated only `layer_top`; the dedicated `outerwear` role now enters the
same existing direction/construction verdict, making the known sleeve-zone conflict hard-invalid.
No sleeve taxonomy or garment-specific exception was added.

The same capture showed a model-facing evidence distortion and a sight-coverage failure.
`thermalFactsForPieceLine` now separates `insulating layer:<material|none|not recorded>` from
`insulating face material:yes`; a wool face no longer becomes the stronger phrase
`insulation:insulated`. `searchVisualEvidenceOrder` leaves search rows and eligibility unchanged but,
when numeric weather is resolved, allocates the finite outerwear photographs across structured
interior/fill evidence groups (constructed interior, construction unknown, engineered insulation,
verified unfilled). It does not read deprecated `outerwear_role`, names, or a thermal-fit verdict.
Finally, a new-request execution router's structured occasion/activity remains established state for
the later full-stylist tool loop. Explicit occasion can still refine the request; router activity is
locked so a later model tool call cannot invent exertion and change thermal or footwear policy.

**[historical; superseded 2026-09-09 — single-outfit capped-roster correction, 2026-09-07]** The row cap itself was a second evidence
loss surface. In `thread_1788822538467`, numeric weather was resolved correctly, but the
single-outfit ten-row outerwear cap ran before visual allocation and retained ten early
shrugs/cardigans. Every known `warm` or `very warm` layer was absent from the model's roster; the
model found one only after a separate text search and ran out of iterations after viewing it.
`capSingleOutfitSearchResults` now reserves the first outerwear representative of every observed
structured `garmentWarmthLevel`, then fills the remaining category slots in retrieval order and
returns all retained rows in their original order. This is finite evidence coverage, not a
condition-relative verdict: it reads no demand, request prose, garment name, or deprecated
`outerwear_role`; changes no eligibility; and is a no-op outside numeric-weather
`single_outfit` searches. `searchVisualEvidenceOrder` then distributes that retained roster's image
slots across construction groups as before.

The model-owned catalog amendment at the top removes this cap and automatic image allocation from
the current `single_outfit` path; the paragraph remains the incident history that motivated the
subsequent, also-superseded system roster.

**[owner correction, 2026-09-07] Walking is not a clothing-warmth credit.** Live acceptance
`thread_1788770518010` exposed two independent leaks behind one accepted light trench. First, the
router's authoritative `activity:none` blocked a later structured argument but not the secondary
request-text inference inside `createStylingContextResolver`; model-authored `occasion_context`
containing “gallery walk” therefore recreated `walking`. A locked router activity now disables that
secondary inference in both consumers: `resolveActivityProfile` cannot alter thermal/activity state,
and `resolveComfortFootwearConstraint` cannot independently recreate an all-day-walking footwear
gate from the same prose. Second, ordinary walking itself no longer shifts thermal demand down one
level. It remains authoritative for footwear and observable exposure context, while only genuinely
exertive `hiking` receives a **base-clothing** thermal discount. Removable-layer demand receives no
activity discount: even on a hike that layer answers to trailheads, stops, shade and the return, not
the heat-producing middle of the climb. Thus sightseeing at a stated 60→48°F remains `warm` demand
rather than becoming `moderate` merely because it involves walking.

**[second live-acceptance correction, implemented 2026-09-07] A stated exposure stays literal, and
known inadequacy cannot satisfy an explicit layer request.** `resolveConditions` recognizes the flat
and nested production projections of `stated_user`, preserves the supplied endpoints as a non-coarse
`stated_user_exposure_range`, and reserves waking-window estimation for live/model daily envelopes.
For `propose_outfit` only, `layer_requirement:'required'` opts into hard thermal-undershoot validation
when that exposure is certain and all thermal contribution evidence is known. Default, plan, coarse,
unknown-evidence, and overshoot behavior remains advisory.

Overall `fabric_weight` no longer creates a sleeve-construction conflict: it is garment weight, not
sleeve volume. Known conflicts require the existing directional sleeve-zone evidence. Rejected
diagnostic cards remain visible within their originating turn but are removed before
`current_outfit_set` is persisted, so follow-ups inherit accepted cards only.

**[SUPERSEDED 2026-09-13 — see "Amendment (2026-09-13) — blanket outerwear warmth cap removed" below]** **[ratified correction, 2026-09-09] Uninsulated outerwear shells stay capped at `light`.** Outerwear
pieces with no insulating fill (`insulating_layer_materials: []` or unset) and no positive insulating fiber
evidence (e.g. cotton, linen, rayon, polyester shell, or uninsulated leather/suede) are shells (wind/rain barriers), not thermal insulators.
Coverage adjustments (long sleeves, knee length) and medium fabric weight previously combined in
`garmentWarmthScore` to promote a classic cotton trench coat (`#996759`), unlined utility jacket (`#996767`),
or soft unlined leather jacket (`#207`) to `moderate` warmth, causing both the model and the deterministic thermal
validator to treat an uninsulated shell as adequate for sub-50°F cold walking without an insulating mid-layer.
`garmentWarmthScore` in `styling-engine/garmentWarmth.js` now universally caps uninsulated outerwear at
`LEVEL_RAW_BOUNDARIES[1]` (`0.5`, `light`), restoring the physical distinction in `docs/garment-warmth-calibration.md` §3.1.
In `orderedSubstantialUpperStackContribution` (`styling-engine/outfitThermalContribution.js`), an outer shell
rated at least `light` over a moderate base and moderate middle layer (`layer_top`, e.g. cardigan) qualifies for the bounded ensemble step to `warm`.

**Consequence:** a single user turn can be several model calls — tool iterations plus guard
retries. **Instrumented 2026-07-28:** every tool-loop iteration now accumulates input, output,
cache-read, and cache-creation tokens in the turn's `freeformDiagnostics`; `/ask` returns them in
its existing debug payload and `freeform_generation_runs` persists them. This makes a four-call
capsule turn distinguishable from a nine-call retry spiral without another live reproduction.
Nested calls made by `generate_outfits` are included in the same totals as of 2026-08-18.

**[by design] Capsule “Show another” does not enter either retry loop.** New capsule cards persist
their bounded roster and normalized use-case slot. The explicit expansion action sends that state
to `/api/ai/expand-capsule`, which reloads only those active garments, makes one JSON composition
call, and runs the normal deterministic plan validator. A failed composition returns visibly
after that one call; it is not corrected by another billed call. Legacy capsule threads without
the saved state do not offer this action and must be regenerated once. The response shape is
provider-enforced (forced Anthropic tool / strict OpenAI JSON Schema), not merely requested in
prompt prose; this was hardened after the first live one-call attempt narrated until its token cap.
Each saved slot also carries its distinct core capacity. Exhausted slots suppress the expansion
action, and the endpoint repeats that capacity check before the provider boundary (`providerCalls:
0`), so stale clients cannot purchase a composition the roster cannot possibly supply. **Amended
2026-08-25:** a persisted zero is an authoritative exhausted-slot verdict, not missing data. If a
version-1 card lacks the field, the route derives it through `capsuleOutfitCoreCapacity`; the
former route-local top × bottom + dress fallback was deleted because it overcounted unsupported
dependent tops.

**[by design] Plan validation requirements are disclosed before composition.** Each model workbench
slot carries `submission_requirements` generated from the same structured context the validator
uses: exact count, complete outfit roles, and—only when applicable—winter indoor cardigan,
transition-layer coverage, and recurring shoe range. This does not relax validation; it prevents
paid discovery of deterministic rules through rejection. **Live measurement did not support this
as a sufficient cost control:** the next winter-capsule run grew from 8 to 10 provider iterations,
from 2 to 4 validation failures, and delivered only 5 looks. The requirements prevented some earlier
structural mistakes, so they remain truthful guidance, but the model instead split overlapping slots,
searched outside the curated roster, re-planned after partial success, and invented new slot IDs.

**[by design] Seasonal capsules are explicit and compose atomically after the model calls
`plan_outfit_set`.** The conversational model still owns the turn and decomposes the request into
use-case slots; there is no client or server capsule keyword pre-route. The tool schema requires
`plan_kind` (`trip`, `seasonal_capsule`, or `coordinated_plan`). An unnumbered seasonal capsule gets
the owner-ruled 24-piece working ceiling; an explicit number wins. Capsule-only roster selection,
validation, display capacity, and atomic composition are gated by `plan_kind`, never merely by a
piece budget, so a budgeted trip remains on the ordinary trip workbench.

Once a seasonal capsule has produced its fixed roster and slot workbench, `plan_outfit_set` makes
one provider-enforced structured composition call, validates the whole response once, and returns
accepted cards. Validation failures remain in server logs and numeric diagnostics rather than
being promoted into production `tripPlanLines`; the model's internally chosen target counts are
not user promises, and raw validator coaching is not stylist copy. After success, the outer
conversational model gets one final
prose turn with no tools exposed; it cannot call `submit_plan_outfits`, search broadly, re-plan, or
start generic card-delivery retries. The nested call's usage is added to the existing turn
diagnostics. Trips, work weeks, event sets, and other non-capsule plans retain the ordinary model
workbench path. **Visual/truth correction before the first live test:** the atomic call now
attaches a 448px thumbnail for every fixed-roster piece with a photo and replaces the ordinary
compact workbench line with `buildPieceText`'s full truth, including pairing requirements,
do-not-pair rules, real-wear notes, and learned authoritative rules. Only successfully attached
photos are marked visually seen. This adds image input to the one bounded call, but prevents the
cheaper path from becoming a blind composer; `atomicCapsuleVisualPieces` reports the image count in
the turn debug payload.

There is no remaining numeric-budget fallback in the planner: direct callers, like production,
must pass `planKind:"seasonal_capsule"` to activate capsule roster selection. A `trip` or
`coordinated_plan` may still carry `piece_budget`; that constraint is reported and enforced without
changing the plan's identity.

**[by design] Atomic-capsule final prose never opens a retry loop.** The outer model may naturally
introduce the accepted rotation, but it may not add an unvalidated outfit in prose, cite a garment
ID absent from the accepted cards, or invent an engine/card ceiling. `boundedCapsuleFinalAnswer`
checks those mechanically. On a violation it returns a deterministic accepted-card summary
locally, without another provider call; compliant prose is unchanged. Replacements increment
`capsule_final_fallbacks` in `freeform_generation_runs`.

Seasonal-capsule `reuse:maximize` does not apply the packing-light three-shoe ceiling: every shoe
already selected into the finite capsule roster may appear in its representative rotation. Trips
and other packing-light plans retain the ceiling. The atomic composer also treats each slot's
`best_for` as lived context, not decorative narration; broad occasion eligibility cannot erase a
piece's more specific context truth.

Before capsule quotas rank and select garments, the selector takes the union of pieces admitted by
the existing deterministic gates for at least one requested use-case slot. Failing one slot is
normal; failing every slot means the piece has no capsule job and cannot consume the finite
budget. This is preselection, not a new taste score, and it is a provable no-op when no slots are
provided. “Eligible but not shown in the representative rotation” remains distinct from
“ineligible”: the rotation demonstrates the capsule rather than enumerating every roster piece.

> `styling-engine/provider.js` (guard retries), `:758` (tool loop).
> `routes/ai.js` (`composeCapsulePlanOnce`, `POST /expand-capsule`).

**[by design] Repeated ordinal names do not create artificial capsule coverage slots.**
At the `normalizePlanSlots` boundary, structurally identical slots whose labels are clearly
numbered variants of the same use case (for example, `Casual Indoor Day 1` and `Casual Indoor
Day 2`) merge into one slot and their requested counts are added. The merge is deliberately
conservative: occasion, activity, environment, register, season/weather, location, date,
best-for text, coverage text, and plan note must agree after ordinal normalization. A numbered
pair also remains separate when each entry requests exactly one look, since those may be real
calendar days; the captured artificial split is identifiable because one numbered “day” itself
requests multiple looks. Different dates or conditions likewise remain separate. This prevents displayed looks from
being credited to one bookkeeping variant while another variant falsely reports zero submitted.

> `styling-engine/outfitSetPlanner.js` (`normalizePlanSlots`,
> `mergeEquivalentOrdinalPlanSlots`).

**[by design] Multi-use-case trip requests may still need one material clarification.**
Listing several activities is not proof that the styling brief is complete. Before declaring
cards intent, the conversational model may ask one concise question when the answer changes
occasion coverage, activity safety, formality/register, footwear, or another required garment
role. It should otherwise proceed directly, must not ask users to repeat supplied facts, and
must not ask for weather when a named location can resolve it. This restores the useful Tucson
pattern: nice lunch versus backyard time and trail hike versus nature walk are styling decisions,
not conversational overhead.

> `styling-engine/prompts.js` (`STYLIST_SYSTEM`, coordinated multi-outfit planning).

---

## Prompt splice sites — what actually reaches the model

Where accumulated memory becomes prompt text. Traced 2026-07-26; each was verified by running the
builder against the real wardrobe rather than read from source alone.

- **`getSavedBoardMemory`** → board verdicts *and* specific reasons, in plain language, under
  *"Bias future outfit suggestions toward these successful formulas"* / *"Avoid repeating these
  drift/problem patterns"*. ~3.2 KB on the current wardrobe. Spliced at `core.js→:2737` and
  `routes/ai.js→:1116` (per-garment, flagged *"high-authority outfit memory"*) and
  `:1119` (global, *"should bias ranking"*).
- **Owner rules** → injected as **hard requirements**: *"OWNER RULES — hard requirements, not
  suggestions. Do not construct exceptions or conditional workarounds… If a rule makes a slot
  impossible, disclose the conflict instead of bending the rule."* (`outfitSetPlanner.js`.)
- **Style Constitution layers** → all four reach **eight** prompt templates, not just the image
  prompt: `STYLIST_SYSTEM`, `STYLE_SELECTED_ITEM_SYSTEM`, `GENERATE_OUTFIT_IDEAS_SYSTEM`,
  `OUTFIT_COMPOSER_SYSTEM`, `OUTFIT_BOARD_PLANNER_SYSTEM`, `EDITORIAL_NEW_PIECES_SYSTEM`,
  `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` (twice), plus `editorialImagePrompt`. Cached per user and
  invalidated on any write (`promptRuntime.js`), so an edit takes effect next request.
- **[by design, confirmed still true 2026-07-27 → `docs/board-feedback-desync-spec.md`]** The
  `stylist_feedback` mirror of grouped reasons reaches nothing: `getStylistFeedbackMemory` excludes
  rows whose board already exists in `saved_boards`, which is every row that mirror produces. Not
  a bug — `getSavedBoardMemory` already reads `saved_boards.payload` directly for saved boards, so
  the mirror was never load-bearing. The *display* desync this was originally filed under (chat
  showing stale chip state) is fixed as of that date; this specific sub-finding about the mirror
  itself was deliberately left as-is, not part of that fix.

---

## Sweeps

- **[by design]** `whole_wardrobe_sessions` trimmed to the newest 10 on every write.
- **[by design]** `POST /api/todos/clear-orphaned` deletes `metadata` todos whose linked piece is
  gone or inactive. Only `metadata`; user-created and retag tasks are never auto-deleted.
- **[by design]** Retag-suggestion todos for a board are deleted and rebuilt whenever that board's
  feedback changes — but completed `piece:issue` pairs are collected first and skipped, so a
  suggestion you have handled never returns.

---

## Scoring — the numbers that decide what you see

Mapped 2026-07-26. Weights read from source; **firing frequencies measured against the real
236-piece wardrobe** by `scratch/measure_scoring_terms.js` (read-only, no model call). A weight is
only a claim about what the engine cares about; it matters only if its condition is ever true, and
it only *discriminates* if its condition is sometimes false.

### The scorers, and what each one decides

| scorer | decides | scale |
|---|---|---|
| `planWorkbenchPieceScore` | which ≤40 pieces the model may compose a plan slot from | ~0–265, +100000 for anchors |
| all-slot capsule eligibility union | which pieces may compete for finite capsule roster slots; existing trust/register/weather/activity gates, no score |
| `capsuleVersatilityScore` | which eligible pieces the capsule roster buys inside the piece budget | ~-24 to +50 |
| `capsuleOutfitCoreCapacity` | reports unique gate-valid top+bottom or dress cores across requested capsule use cases; requires eligible shoes and deduplicates cross-slot overlap | count, report-only |
| `allocateCapsuleRepresentativeRotation` | reserves one displayed card per coverable capsule use case, then spends remaining cards on recurring demand without exceeding slot capacity | 0…`min(piece_budget, 12)` cards |
| `compatibilityScoreForSelectedItem` | ranking of partners for one selected garment | unbounded sum of clamped terms |
| `getRelevanceScore` (visual composer roster) | which pieces get an image slot | unbounded sum |
| `scoreWholeWardrobeCandidate` | ranking of whole-wardrobe outfit candidates | unbounded sum |
| ~~`scopedWrongItemInfluenceForRows`~~ | retired 2026-08-10: occasion/activity scoring discarded the actual correction reason | no current score |

The remaining feedback score is deliberately mild and context-bound. Relational outfit feedback
is prompt guidance; it does not mechanically reinforce literal garments or combinations.

### `planWorkbenchPieceScore` — measured

`(outfitSetPlanner.js)`. Terms, with how often each fires on the real wardrobe:

| term | fires | note |
|---|---|---|
| `+100000` anchor piece | n/a | not a weight — a hard pin. Anchors always survive the 40-piece cut |
| `+80` core group (top/bottom/dress/shoes) | 83% | |
| `+30` support group (outerwear/accessory) | 17% | the complement of the above |
| `+50` `recommendation_status = trusted` | **96%** | 226 of 236 pieces are `trusted` |
| `+30` `fit_confidence = high` | 62% | the term with the most real spread |
| `+20` `role_permission` hero or auto | **100%** | 235 of 236 are `auto` |
| `+35` piece tagged with the slot's occasion | 76% | |
| `0…+20` register proximity to the slot floor | 97% resolvable | `20 − |rank distance| × 5` |
| `+5` light fabric | 33% | |

**Measured consequence — tested, not inferred.** Two of the four "quality" terms do not affect the
selection at all. Re-running the selection with each term deleted:

- **Removing the `role_permission` +20 produces a byte-identical top 40.** 235 of 236 pieces are
  `auto`, so the term shifts every score equally and orders nothing. It is inert.
- **Removing the `trusted` +50 changes one piece out of 40.** 226 of 236 are `trusted`.

What actually orders the workbench is category group (+80/+30), slot-occasion tagging (+35),
`fit_confidence` (+30) and register proximity (0–20). This is a property of *this* wardrobe — a
fresh user with mixed `recommendation_status` would see the trusted term do real work — but on the
data the engine actually runs against, two of its weights are decoration. Re-derive with
`scratch/measure_open_questions.js` (Q3).

The 40-piece cut (`PLAN_WORKBENCH_PIECE_LIMIT`) is not purely score-ordered: anchors go in first,
then a per-group coverage sweep (8 slots each for top/bottom/dress/shoes, 4 for outerwear and
accessory), and only then the remaining score order. So a low-scoring bottom can beat a
high-scoring top — coverage outranks score. **[by design]** — otherwise a slot could be handed 40
tops and no bottoms.

### `capsuleVersatilityScore` — measured

`(outfitSetPlanner.js)`. `+12` neutral color, `+4` per occasion tag (capped at 4, so `+16` max),
`+8` solid/no pattern, `+4` trusted, and a summer block (`+10` light, `−24` heavy or
wool/cashmere/fleece/corduroy/tweed/flannel, `+6` linen/cotton/viscose/tencel/gauze).

| term | fires |
|---|---|
| `+12` neutral color | 84% |
| `+8` solid / no pattern | 62% |
| `+16` four or more occasion tags | **8%** |

**Measured consequence — and the reason for it.** The occasion-breadth term, conceptually the most
"capsule" of the three and the largest, fires on 19 of 236 pieces. The cause is not sparse tagging;
it is that **the term's cap sits exactly at the wardrobe's ceiling.** The full distribution is
0 occasions → 3 pieces, 1 → 16, 2 → 89, 3 → **109**, 4 → 19, and nothing above 4. So the score is
`4 × min(4, count)`, and 4 is the most any piece has: the term separates the top 8% from a mass of
109 pieces sitting one step below the cap, and can never reward more range than the tagging
vocabulary produces. Not a broken weight — a weight calibrated against a wider tagging range than
exists. On this wardrobe the roster's versatility ranking is carried by color and pattern. This
matters to the open capsule-cap work in `docs/stylist-bugfix-spec.md`, which is a
`selectCapsuleRoster` question, and this is the score that roster sorts on.

The source comment is explicit that this score **has no idea what registers the plan needs**
(`outfitSetPlanner.js`) — a roster can score high on "versatility" while reading uniformly
`elevated` and then failing every `casual` slot's ceiling. That is a live-tested failure from
2026-07-14, and is what `strictestRegisterCeilingRank` / `capsuleDemandReserve` exist to correct.

### The keyword-scored surfaces

`scoreWholeWardrobeCandidate` (`rules.js`) and `getRelevanceScore`
(`rules.js`) score largely by **regex over a concatenated text blob** of the pieces, not over
structured tags: `-24` "soft stack risk" when three soft words appear, `-28` catalog/librarian
drift, `-20` wide+wide, `-24` generic light-neutral, `+8` artistic texture/structure, and so on.
`bohoSignalForPiece` is the same shape with fractional weights.

This is **[by design] but frozen**: the text-matching ratchet (below) records 119 such sites in
`rules.js` and 58 in `attributes.js` as *debt with a baseline*, and fails the build if the count
rises. The existing sites are grandfathered; new ones are not permitted without an explicit
`// ratchet-allow:` comment. So the right reading of a keyword weight here is "legacy mechanism,
deliberately capped, not a pattern to copy" — the standing owner rule is to write new rules against
structured tags (season, formality, occasion), not against material or name words.

**Consequence worth knowing:** because these terms match a *blob*, a word in one piece's `notes`
can trigger a penalty attributed to the whole outfit. The `-60` occasion-incompatibility term and
the `-18` support-only term are the structured exceptions.

### Feedback authority

The former generic `feedbackWeight` table and its pair, board, roster and whole-outfit consumers
have been removed. Outfit reactions are classified for prompt memory as positive, qualified, or
negative evidence; they do not become literal garment weights. Image-fidelity feedback reaches
renderer memory only. Version-2 wrong-choice evidence is provisional: it may be delivered verbatim
and in bounded form inside an already-requested styling call when its subject garment is considered,
but it does not alter candidate or roster scores.

Reasonless evidence carries only the exact-outfit reminder and is not synthesis-eligible. Older
unstructured rows sharing the `wrong_item_read` storage value are display-only because their UI
meaning cannot be recovered safely. The 28 live legacy rows were removed on 2026-08-10 after owner
confirmation; display-only routing remains as stale-import protection. Broader interpretation happens only through an owner-authorized
synthesis call. The call creates reviewable `feedback_synthesis_drafts`, not prompt authority. The
free preview's output estimate is the enforced output-token cap, and paid failures retain any
provider usage returned before parsing failed. `getAcceptedFeedbackSynthesisMemory`
reads at most eight owner-accepted `personal_contextual_lesson` drafts into styling prompts, with
per-line length caps. These accepted personal lessons remain visible, editable, and retireable;
retirement removes them from prompt memory. Accepted `general_styling_failure` and
`garment_fact_correction` drafts remain visible review/provenance records: they neither become owner
preferences nor silently edit garment truth.

### The two sub-scorers, measured

`formalityFitForPiece` and `weatherFitForPiece` are summed into four different scorers, which made
them the largest unmeasured terms in the system. They turn out to be **switches, not dials**:

| sub-scorer | context | pieces with a non-zero score | range |
|---|---|---|---|
| `formalityFitForPiece` | dressy request | **229 / 236** | −18 … +10 |
| | walkable request | 10 / 236 | −18 … +8 |
| | no register intent | **0 / 236** | — |
| `weatherFitForPiece` | hot | 177 / 236 | −32 … +18 |
| | cold | 171 / 236 | −20 … +18 |
| | mild | **0 / 236** | — |

Both return exactly zero for every piece when their trigger is absent — `formalityFitForPiece`
short-circuits on `!intent.active`, and `weatherFitForPiece` has no adjustments outside hot/cold.
When the trigger *is* present they touch nearly the whole wardrobe. So the same outfit request
scored with and without a stated register is not "slightly differently weighted"; it is scored by a
materially different function. The walkable case is the exception — it applies to shoes only, so 10
pieces.

This is why a request's phrasing changes results so much: saying "something dressy" switches a
±18-per-piece term on across 229 pieces, and `resolveFormalityIntent` derives that intent from
**regex over the user's own words** (`rules.js`) — one of the few keyword paths that is about
user intent rather than garment text, and correctly `ratchet-allow`ed as such.

### `compatibilityScoreForSelectedItem` — measured

The historical feedback-pair sampling below is retired with the generic scorer. The live personal
pair terms are explicit garment metadata only:

| term | fires |
|---|---|
| `+16` confirmed pairing note | **0** |
| `−40` rejected pairing note | **0** |
| contextual garment reaction | no deterministic score; bounded provisional prompt evidence only |

Saved-board and garment favourites remain organization/display metadata and prompt evidence where
explicitly described; they do not mechanically promote literal pieces or pairs.

### Recency, again — as a score

`getRecentWholeWardrobeSessionInfluence` (`rules.js`) converts the 10-row session memory into
a *penalty*: `18 × decay` per piece and `30 × decay` per formula family, where
`decay = max(0.2, 1 − sessionIndex × 0.16)` times an occasion factor. So the most recent session
penalises a piece by 18 and a formula by 30; by the sixth session back the decay floor (0.2) has
been reached, at 3.6 and 6. That penalty is subtracted directly in `getRelevanceScore` and is also
the **first tie-breaker** in `comparePieces`. Surface counterpart: *"Skipping N recently used
pieces"* in the composer footer.

---

## Caches

Seven cache systems now outlive a request. The original derivation script reported 47 `new Map()`
hits; most are local lookups inside one function and are not caches at all. PR 188 added the
outfit-evaluation result cache and a paired in-flight registry; the seventh is the capsule roster
prompt cache described below, which is provider-side rather than a `Map` and so appears in no
`new Map()` sweep:

| cache | scope | key | eviction |
|---|---|---|---|
| `promptsByUser` (`promptRuntime.js`) | server, per user | user id | none — rebuilt on profile/constitution write via `refreshPrompts` |
| `wardrobeThumbCache` (`provider.js`) | server, module-wide | `userId:cacheKey:maxPx` | oldest entry dropped past 300 |
| `geocodeCache` / `weatherCache` (`weather.js`) | server, module-wide | location / `dates|lat,lon` | 3-hour TTL |
| `threadCache` (`src/utils/chatThreadCache.js`) | browser tab | thread id | none — lives until reload |
| `relationshipCache` (`src/utils/garmentRelationships.js`) | browser tab | piece id | none, but `loadGarmentRelationships(id, {refresh:true})` bypasses it |
| `outfitEvaluationResultCache` (`core.js`) | server, module-wide | SHA-256 of cache version + provider/model + mode/token cap + complete system/messages (including images and garment/memory context) | 10-minute TTL; LRU insertion order; max 50 |
| capsule roster prompt cache (`routes/ai.js`, `capsuleRosterSelectionContent`) | Anthropic-side, per exact content prefix | the literal `content[0]` text plus every thumbnail before the last `cache_control` | provider TTL; invalidated by any byte change in the prefix — see below |

`outfitEvaluationInFlight` uses the same key but is a coalescing registry rather than a retained
cache: concurrent identical evaluations await one promise, report `providerCalls: 0` to the
followers, and delete the entry when that request settles. Exact-result hits also report zero
provider calls and zero estimated cost. Tests disable the result cache by default unless
`WARDROBE_TEST_EVALUATION_CACHE=true`, keeping endpoint contracts isolated.

**[by design]** The thumbnail cache is user-id-prefixed as defense-in-depth — the comment is
explicit that no leak was observed, but the cache is module-wide across concurrent requests and
should not rely on upload-filename entropy for tenant scoping.

**[by design]** The prompt cache is invalidated on write, so a constitution edit takes effect on the
next request, not the next restart.

**Two more provider-side prompt caches, found and removed 2026-08-25.** Like the capsule roster
cache below, these are `cache_control` on a system string rather than a `Map`, so they never showed
up in the `new Map()` sweep that produced the table above. `generateWholeWardrobeOutfitsVisualInternal`
and `evaluateOutfitThroughSharedPipeline` (both `full` and `followup`) were requesting the same 1h
ephemeral `cache_control` the freeform stylist prompt uses (`PROMPT_CACHE_BREAKPOINT`,
`freeform-prompt-cache-levers.md`), but neither write was ever read back: a one-shot generation
thread that never gets a follow-up has no second turn to amortize it against, and critique's `full`
and `followup` variants are different system text, so they never shared a prefix with each other
either. Both writes were removed rather than documented as a cache, since there was no reuse to
describe — see `docs/deferred-conversational-cache-spec.md` for the full trace and the follow-up
routing (`message-lifecycle.md` dispatch branches 10–12) that made the writes provably wasted.

**A third, message-level cache found and removed 2026-08-26, while measuring the two above.**
`generateWholeWardrobeOutfitsVisualInternal` also put a plain 5-minute `cache_control` directly on
the last candidate thumbnail in the *message* content (not the system string, so `grep
PROMPT_CACHE_BREAKPOINT` also misses this one — same blind spot as the capsule roster cache, a
different mechanism than the two paragraphs above). Shared by three callers: standalone
whole-wardrobe generation, `/generate-saved-outfit-variants`, and freeform's `generate_outfits` tool.
Traced: the function makes exactly one provider call with no in-call retry, so unlike the capsule
roster cache's genuine attempt-1/attempt-2 relationship, this one could only ever be read by a
*separate, later* call landing within 5 minutes with an identical roster — and measured attribution
(new `providerImageManifestCache*` fields, `normalizeAiUsage`'s TTL-based creation split) found zero
such reads across every real call sampled, historical or freshly run. Removed for the same reason as
the two above — see `docs/deferred-conversational-cache-spec.md` Part 2.

### Which garments get a photo — fixed 2026-08-12

Image generation and outfit critique attach at most **five** garment references (`pieces.slice(0, 5)`
at three call sites in `core.js`). Until 2026-08-12 the five were chosen by **array order**, so which
garment lost its photo was arbitrary: on a real 8-garment board, a black herringbone pointed heel and
a floral cutout mule were described in prose while a solid coral maxi dress kept its reference. That
inverts this project's founding visual-grounding lesson — the pieces hardest to describe in words are
exactly the ones that must be shown.

`visuallyPrioritizedPieces` (`attributes.js`) now orders them: photographed **complex** pieces first
(the same hero/colour-accent/loud-or-medium-pattern/textured-fabric test `pieceVisualDetailPolicy`
already used to pick 800px vs 448px), then photographed plain ones, then anything with no usable
photo — those return `[]` from `garmentReferenceImages` and previously consumed a slot while
contributing nothing. Stable within each tier.

**[unverified]** whether five is still the right cap; it was not measured, only re-ordered.
**20.5%** of saved boards carry more than five pieces, though the largest counts are multi-outfit
collages rather than single looks.

**[by design]** The photo-preserving collage fallback (`createPhotoPreservingCollageImage`) still
uses array order. It is a rendered artifact the owner looks at, not a model input, so "hardest to
describe" is the wrong ranking there.

### The capsule roster prompt cache — measured 2026-08-12

**A seventh cache, and the only one that caches *images*.** It does not use
`PROMPT_CACHE_BREAKPOINT` (that marker splits a *system* prompt), so a grep for it misses this
entirely. `capsuleRosterSelectionContent` (`routes/ai.js`) instead puts `cache_control` directly on
content blocks:

```
content[0]  season + size + palette + OWNER RULES + accepted lessons + use cases + candidates
            └─ cache_control: ephemeral
imageParts  one text label + one thumbnail per bench piece
            └─ cache_control: ephemeral on the last one
[volatile]  repair text, appended only on attempt 2 — after both breakpoints
```

**Measured against the real wardrobe**, 40-piece bench, 39 with photos (18 hi-res 800px, 21 low
448px), using the production `capsuleRosterSelectionUserText` and `pieceVisualDetailPolicy`.
Regenerate with:

```bash
node scratch/measure_capsule_prompt_cache.js
```

Read-only, no provider call, safe against a live database.

| block | tokens |
|---|---|
| `content[0]` catalog text | 11,344 |
| thumbnails | 21,000 |
| **cacheable prefix** | **32,344** |
| owner rules + accepted lessons, at the **front** of that prefix | **162 (0.50%)** |

Text estimated at ~4 chars/token; images at Anthropic's `(w × h) / 750` — both local estimates, not
provider-reported usage, so treat them as an order-of-magnitude split rather than a bill. Re-run the
script if the hi-res/low mix changes: the image half dominates, and `pieceVisualDetailPolicy`
decides it per piece.

**[by design] The 162 tokens now vary per request, and that is accepted.** Since the owner-guidance
work, `getOwnerRuleNotes` filters by request context, so the rules block differs between two capsule
requests whose occasions/seasons differ. Because it sits at the *front* of the prefix, any such
difference invalidates all 32,344 tokens behind it, thumbnails included — a 0.5% cause with a 100%
effect.

**The invariant this cache was built for still holds.** Its stated purpose is intra-run: attempt 1
writes the cache, the attempt-2 repair reads it instead of re-paying for every thumbnail.
`ownerRules` is computed once per run upstream (`outfitSetPlanner.js` passes the same array into
both `chooseRoster` calls), so relevance filtering cannot change it between attempts. What
weakened is only opportunistic *cross-request* reuse, which was never the stated goal and already
required an identical bench.

**[by design] Not fixed, and the reason is a measured tradeoff.** The only way to restore
cross-request caching is to move the rules block behind the images, into the volatile tail — which
puts it roughly 21k tokens deep. The block is positioned early *deliberately*; the comment above it
cites this codebase's own measurement that stored rules lose out from tail position (spec 25/26,
`workbenchInstructions`). Trading a measured correctness failure for an unmeasured cache saving is
the wrong side of that bargain. Revisit only with a measurement showing the rules still bind from
the tail.

**The two browser caches never expire — and it does not matter, because both consumers
revalidate.** Traced: `StylistChat.jsx` and `PieceDetail.jsx` use the same idiom,
`load…(id, { refresh: Boolean(cached) })` — if a cached copy exists they refetch anyway and use the
cache only for the first paint. So neither cache can serve stale data beyond one frame, and there
is no cross-tab staleness bug here. The pattern is worth copying for any future cache: paint from
cache, revalidate unconditionally.

Two further per-piece caches are `WeakMap`s keyed on the piece object (`pieceTextBlobCache`,
`bohoSignalCache`) — they memoize within a request and are collected with the objects.

---

## CI ratchets — what future code is not allowed to do

Both run on every `npm test`, before the test suite: `check_style_claims.js && check_text_matching_ratchet.js && node --test`. **A failure here fails the build before a single test runs**, which
is why they are invisible until they bite.

**The text-matching ratchet** (`scratch/check_text_matching_ratchet.js`) counts keyword-matching
sites — `textIncludesAny(`, and `.includes(` / `.test(` against a named list of text-ish variables
(`blob`, `text`, `name`, `reads_as`, `notes`, `silhouette`, `piece.name`, …) — across
`styling-engine/` and `routes/`, and compares each file against
`scratch/ratchet_baseline.json`. Current state: **238 total, exactly at baseline** —
`rules.js` 119, `attributes.js` 58, `core.js` 61, everything else 0. A file going *over* fails the
build; going under just prints `DROPPED`. A line may be exempted with a trailing
`// ratchet-allow:` comment (32 in use, mostly in `tools.js` and `outfitSetPlanner.js`), which is
counted separately and never trips the baseline.

**The style-claims guard** (`scratch/check_style_claims.js`) does three things:

1. Fails on style-claim phrases (`best color`, `favorite color`, `signature color`, personalized
   "not your style" phrasings) anywhere in `styling-engine/` or `routes/` — the ratified
   constitution text is the one sanctioned home, so `constitutionSeed.js` is skipped whole and
   `prompts.js`'s `DEFAULT_CONSTITUTION` block is stripped before scanning.
2. Fails on a `prohibited_pieces` / `prohibited_footwear` entry naming dresses, skirts, blouses,
   sandals or mules unless the line carries a `// ratified:` comment — the categories the owner
   ruled may not be banned by an agent's own judgement.
3. Freezes the occasion-profile id list, so a new profile cannot be added silently.

**Consequence:** these two encode owner rulings as build failures rather than review comments. If a
change here is genuinely wanted, the baseline or allow-list is edited deliberately, with the
ruling attached — not routed around.

---

## The import pipeline's own model calls

Six model call sites, five of them cheap-tier and one full-tier. All spend is recorded per session
into `import_sessions.spent_usd` via `addSpend`, from **actual usage**, not estimates.

| stage | model | batching | max tokens |
|---|---|---|---|
| classification | cheap (`claude-haiku-4-5` by default) | 10 images per call | 1200 |
| garment detection | cheap | **one call per image** | 1600 |
| crop verification | cheap | 10 crops per sheet | 600 |
| crop relocation | cheap | one call per failed crop | 300 |
| clustering | cheap | 12 per sheet | 1500 |
| merge matching | cheap | one call per cluster | 400 |
| **tagging** | **full stylist model** | **one call per new-piece cluster** | schema-bound |

The cheap tier is overridable via `WARDROBE_IMPORT_CHEAP_MODEL`.

**[by design] Tagging is the only gated step.** `POST /sessions/:id/tag` refuses to run without
`{approve: true}`, and `GET /sessions/:id/preflight` exists to price it first — estimating
6000 input / 1400 output tokens per new-piece cluster at the full stylist model, and reporting
spend so far. Nothing else in the pipeline asks.

**[by design] `askCheapJson` has two recovery layers, one of which costs money.** A chatty response
is salvaged locally (free); a genuine mid-JSON truncation triggers **one retry at 3× the token
cap** (paid). So a detection call can cost up to 4× its nominal cap.

**Consequence worth knowing:** detection and relocation are per-image and per-failed-crop, so import
cost scales with photo count *and* with how badly the cheap detector performs — a batch of hard
photos silently costs more, and pass 2 of crop verification is a second per-garment call on top.
Crop verification is designed to fail open: a failed verify sheet leaves its crops trusted rather
than blocking the pipeline.

---

## The gates — what is excluded before the model chooses anything

Mapped 2026-07-26. Structure read from source; **exclusion counts measured against the real
236-piece wardrobe** by `scratch/measure_gate_impact.js`, which calls the real gate function with no
model call.

### One function, three composition paths

`wholeWardrobePieceTrustDecision` in `rules.js` is the hard gate. Pool consumers should call
`evaluateAutomaticUsePiecePool` in `eligibility.js`, which executes that verdict for every piece and
returns typed findings plus eligible/excluded projections. `evaluateAutomaticUsePiecePoolCore`
owns the dependency-neutral pool mechanics used by that public adapter and by recovery inside
`rules.js`. As of Slice 7 (2026-08-25), the legacy
`filterWholeWardrobePiecesForGeneration` response adapter is deleted; tracked tests and diagnostics
consume the shared pool result directly. `scoreWholeWardrobeCandidate` uses the piece verdict as a `-18`
support-only *penalty*, not a block. The hard gate itself returns
`{allowed, supportOnly, reasons}`; `allowed` is simply `reasons.length === 0`.

**[by design]** A user-requested **anchor changes disposition, not evidence**. The shared pool still
records the hard-gate findings and marks the underlying verdict, while anchor policy keeps the
explicit user premise eligible. Freeform proposal validation does not surface those findings as
errors for the anchor. Verification (retrieval + layer photos) still applies.

### The layers, in the order they run

1. **Evening bottoms.** For any evening occasion, a bottom is blocked unless it is *explicitly*
   tagged `evening` — and blocked regardless if it reads as utility/cargo. **[by design]**, and by
   far the bluntest rule in the stack.
2. **User occasion exclusions.** `piece.occasion_exclusions` matching the request. This is the
   owner's own per-piece veto and is the intended route for personal rules — `occasions.js` is
   frozen (`FROZEN, Yuna 2026-06-12: no new profiles`) precisely so that new rules land here
   instead.
   Plan slots retain their public broad occasion, but an unambiguous home-only label/use case now
   supplies `home` specifically to the owner-exclusion lookup. Other occasion gates still receive
   the public occasion, so an AI-generated `home: low` confidence remains advisory. Mixed
   **home + errands** slots deliberately remain broad because one veto cannot safely describe both uses.
3. **Owner constraints** (`ownerConstraintApplies`, `lib/ownerConstraints.js`), read by
   `wholeWardrobePieceTrustDecision` before roster assembly, slot replacement, complementary
   ranking and each capsule-plan slot. **[added 2026-08-12 — this layer was missing from every
   earlier pass of this document; it shipped with item 12 and was never recorded here.]** A row is
   an owner-confirmed standing prohibition that one garment's `occasion_exclusions` cannot express:
   a selector of verified piece IDs, wardrobe category, structured material or **footwear type**,
   crossed with one context dimension (occasion, activity, season or weather). Missing context is a
   no-op — the gate never fires on an unspecified dimension. A match hard-blocks the garment and
   emits the constraint ID and dimension in the suppression reason; retiring the row is the undo.
   Season comparison runs through `resolveCalendarSeason` (`lib/seasonContext.js`), so `warm` → summer, `autumn` → fall, and the
   composer's unresolved default `current season` resolves against `requestContext.currentDate`
   rather than always "now". **[unverified]** no exclusion counts have been measured for this layer;
   the counts elsewhere in this section predate it.
4. **Auto-use trust** (`autoStylingTrustDecision`, `src/utils/wardrobeAiContext.js`), with a
   dead escape hatch — see *Exploration mode* below.
   `recommendation_status` of `avoid` / `do_not_recommend` / `needs_fit_review` / `experimental`,
   `role_permission` of `never_auto` / `only_when_requested`, `fit_confidence: low`, the AI
   profile's own `auto_use_trust`, low occasion confidence without an explicit tag, an
   `occasion_permissions` list that omits the request, and a phrase scan of notes for
   *"too small"*, *"do not auto"*, *"testing only"* and similar. Most of these relax under
   `explorationMode: 'aggressive'`.
5. **Weather physics.** Hot: insulating fiber, or heavy weight, or (medium+ weight *and* insulating
   coverage / warm neckline / long sleeves). Cold: shorts, lightweight linen bottoms, high bareness.
   Credible wet exposure excludes footwear whose structured material is canvas or suede. Explicit
   rain, drizzle, wet ground, puddles or mud qualifies; a foggy coastal outdoor walk also qualifies
   from the combined environment and activity. Fog alone and dry beach walking do not.
   The exemptions here are all scar tissue and are commented as such — open-front layers
   (cardigans, kimonos) are exempt from the sleeve/coverage clauses (ratified 2026-07-12 after
   summer layering requests kept dying); shoes and accessories are never "insulating"; the
   weight qualifier exists because a light silk maxi was flagged purely for being full-length.
6. **Profile rules and the register ceiling** (`profileRuleFit`, `rules.js`). Prohibited
   materials → footwear-comfort enums → **register ceiling** → prohibited footwear → prohibited
   pieces → `unknown` → discouraged. **This function returns on the FIRST prohibition it finds**,
   so a piece has exactly one profile reason no matter how many it violates.

**Consequence:** layers 1–5 *push* reasons onto a list, layer 6 returns one. A blocked piece can
therefore carry several reasons, and the counts below sum to more than the blocked total. It also
means reason counts are **order-dependent** — under a walking activity, twelve shoes exit at the
footwear-comfort check and never reach the register check, so the register count drops by ten
without the underlying population changing.

### Measured: how much each context excludes

Fraction of the 236-piece wardrobe blocked, with the dominant reasons:

| context | blocked | dominant reasons |
|---|---|---|
| casual, mild | **113 (48%)** | register ceiling 108 (91 elevated + 17 dressy) |
| casual, hot | 146 (62%) | register 108, hot-weather insulating 66 |
| casual, cold | 148 (63%) | register 108, bare/sleeveless 58, shorts 11 |
| city smart casual, mild | **49 (21%)** | low occasion confidence 22, dressy over elevated ceiling 17 |
| evening, mild | 158 (67%) | low occasion confidence 96, prohibited evening bottom 51 |
| evening, cold | 176 (75%) | + bare/sleeveless 47 |
| outdoor daytime social, hot | 89 (38%) | hot-weather insulating 66, dressy over ceiling 17 |
| casual + walking | 114 (48%) | register 94, mid-heel unsuitable 12 |
| casual + hiking | 123 (52%) | register 90, mid-heel 12, medium-support 9 |
| home loungewear, mild | **197 (83%)** | low occasion confidence 169, register 108 |

Across every context, the same ~13 pieces are blocked by trust reasons (8 `needs fit review`, 3
engine-notes suppression, 2 low fit confidence) — that floor is context-independent.

### The register ceiling is the dominant layer

The wardrobe is tagged `everyday` 117, `elevated` 92, `dressy` 17, untagged 7. The `casual`
occasion profile's `register_ceiling` is `everyday`. `registerCeilingVerdict` exempts accessories
and passes untagged pieces, so:

> **Every one of the 91 non-accessory `elevated` pieces, and all 17 `dressy` pieces, is blocked
> from every `casual` request.** That is 108 of 236 — the single largest exclusion in the system,
> and it fires on the app's most common occasion.

This is not a defect. The register ceiling was rolled out deliberately (spec 8 made it
unconditional across all three composition paths, closing a gate-parity bug class), and blocking
dressy pieces from a coffee run is the behaviour it was built for.

**But the wardrobe's own data disagrees with itself, and the size of the disagreement is
measurable.** Of those 91 elevated pieces, **52 are also tagged with the `casual` occasion** — by
the owner or the tagger. Those 52 are pieces the `occasions` column says are casual-appropriate and
the `formality` column causes to be blocked from every casual request. The two columns are not
reconciled anywhere, and the gate reads only `formality`.

So the open item is not "is the ceiling right" — it is a **column conflict affecting 52 garments**.

> **Provenance settles most of it — see *The tagger prompt → owner corrections*.** Of those 52,
> **49 have owner-corrected `formality`** and only **5 have owner-corrected `occasions`**. The
> conflict is an owner ruling against an auto-tag, so the gate reading `formality` is reading the
> more authoritative column, and `elevated` has not drifted — it is the wardrobe's most curated
> field (202 of 236 pieces corrected by hand). An earlier draft of this document suggested letting
> an explicit `casual` occasion tag override the ceiling; that would let tagger output override the
> owner on 47 garments, and is withdrawn. The remaining question is the **5 pieces the owner tagged
> both ways** — a five-row list, not a policy decision.
>
> **And the ceiling itself is ratified — do not reopen it.**
> `docs/occasion_profiles_ratification.md` → *Ratified Amendment: Register Ceilings For Roster
> Gating*, **ratified by Yuna 2026-07-05**, sets `casual → everyday` explicitly, with this note
> recorded at the time: *"`casual -> everyday` is the largest behavior change. It would make
> park-friend, coffee, errands, and low-key social rosters reject `elevated` and `dressy`
> pieces."* The 108-piece exclusion measured above is the **documented, intended consequence of a
> ratified decision**, not a discovery. An earlier draft of this section offered "raise `casual`'s
> ceiling to `elevated`" as an open taste call; **that is withdrawn.** The only live question is
> whether a given piece's `formality` value is right — a tagging question, not a ceiling question.

This is upstream of the capsule-cap work, and is the mechanism behind the live-tested 2026-07-14
failure recorded at
`outfitSetPlanner.js` (a roster of `elevated` pieces producing zero outfits for casual
slots). Escalating a slot's `register` lifts the ceiling — that is what the field is for.

`city_smart_casual`, whose ceiling is `elevated`, blocks only 21%. The gap between those two
numbers is the whole story of this layer.

### Occasion confidence, the other big lever

For `evening_social` and `home_loungewear` the dominant reason is not a rule but
*"AI profile low confidence for X"* — 96 and 169 pieces respectively. These are auto-tagger
confidence judgements, not owner rulings, and an explicit occasion tag on the piece overrides them
(`explicitOccasionMatches` short-circuits the check).

**This is judgement, not missing data — checked.** All 96 and all 169 have a populated
`occasion_confidence` map; **zero** were blocked because the map was absent. The tagger looked at
each piece and returned `low`. The composition is what you would expect from a real wardrobe:
`home` blocks 72 tops, 53 bottoms and 19 outerwear — the tagger is saying ordinary clothes are not
loungewear, which is defensible. `evening` blocks 60 tops and 18 outerwear. The lever here is the
per-piece occasion tag, which overrides the tagger; there is nothing to fix in the gate.

### Gate-field coverage — and the todos side effect

`missingGateFields` (`attributes.js`) lists the columns the gate needs: `formality`,
`fabric_weight`, `fiber_content`, `occasions`, plus `heel_height` and `walk_support` on shoes. When
a hard gate excludes a garment for missing data, a `metadata` todo is written (surface map → Tasks;
side-effects table above).

Measured: **39 of 236 pieces are missing at least one gate field** — 35 `fiber_content`, 7
`formality`, 3 `occasions`. Shoes are fully tagged for `heel_height` and `walk_support`.

**The `fiber_content` gap is real in structure and empty in practice — checked.**
`pieceHasInsulatingFiber` reads `fiber_content` and nothing else, so it returns false for all 35,
and the hot-weather insulating-fiber clause blocks **none** of them — even though 32 are
medium/heavy weight, exactly the population the clause exists to catch. But scanning those 35 for
warm-fiber words in name, notes or `fabric_category` finds **one**: a pair of tweed heels, which is
a shoe (categorically exempt from the insulating check) and is blocked by the register ceiling
anyway. So no garment currently escapes hot-weather gating through this hole. It is a latent gap —
worth knowing before someone adds an untagged wool sweater — not a live defect, and the heavy-weight
and coverage clauses catch most of what the fiber clause would.

**`fiber_content` has two other real consumers, checked the same way — one is live, one is not.**
`fiber_content` is not single-purpose: `pieceHasWetSensitiveFootwearMaterial` (`attributes.js`)
also reads it, gating footwear out of wet-exposure requests when `'suede'` is present (or
`fabric_category = 'canvas'`); `capsuleVersatilityScore` (`outfitSetPlanner.js`) reads it inside
its summer-only term, penalizing `wool`/`cashmere`/`fleece` and rewarding `linen`/`cotton`/etc. via
the same `fiber_content`-or-`fabric_category` check. Both settled by
`scratch/measure_open_questions.js` (Q7, Q8):

- **The wet-exposure clause is a live miss, not a latent one.** Of the 27 no-`fiber_content` shoes,
  1 is still caught via `fabric_category = 'canvas'`, but **2 are missed entirely**: piece 199
  ("burgundy suede cork wedge sandals") and piece 200 ("taupe suede ankle boots") both name `suede`
  in their own title, have empty `fiber_content`, and `fabric_category = 'other'` — so
  `pieceHasWetSensitiveFootwearMaterial` returns false and neither is excluded from a wet-exposure
  request today. (Piece 200 is the same taupe suede boots already flagged in the capsule-bench work
  as under-selected with "nothing structural" explaining why — this is the structural reason.)
- **The capsule summer term is latent, like the hot-weather clause.** 0 of the 35 no-`fiber_content`
  pieces would score differently in `capsuleVersatilityScore`'s summer term if `fiber_content` were
  populated — every one of them either already gets the same answer through `fabric_category`, or
  doesn't match either list. Also: this term is additive scoring, not a hard gate, so even a real
  miss here would be a ranking effect, not a visibility one — unlike the wet-exposure clause, which
  hides a piece from the roster outright.

(Measured against the live wardrobe at 242 active pieces, 6 more than this section's 236-piece
baseline — the population count above may drift slightly on a fresh run; re-run
`scratch/measure_open_questions.js` rather than trusting these counts indefinitely.)

### Exploration mode — a relaxation that can never fire

**[known bug — string mismatch, unfiled]** `autoStylingTrustDecision` computes
`const aggressive = explorationMode === 'aggressive'` and uses it to disable **six** separate trust
clauses: `needs_fit_review`, `experimental`, `fit_confidence: low`, the AI profile's
`needs_fit_review` and `experimental`, low occasion confidence, and the engine-notes phrase scan.

**Nothing in the codebase ever passes `'aggressive'`.** Every call site is traced:
`tools.js` and `outfitSetPlanner.js` hard-code `'moderate'`; `rules.js` defaults to
`'moderate'`; the parameter default is `'moderate'`; `routes/ai.js` forwards a request value.
The only non-default value produced anywhere is **`'adventurous'`** (`routes/ai.js`, the
saved-outfit *adjacent* variant mode) — a different string, which fails the equality check and
relaxes nothing. No test sets it either.

The two strings have separate origins: `'aggressive'` arrived with the original
`wardrobeAiContext.js` (`c307a9b`, 2026-05-31); `'adventurous'` arrived later with the saved-outfit
variants feature (`0d3481f`, PR #36). Nobody reconciled them. So the "adjacent / explore further
afield" mode a user selects does **not** loosen any trust gate — it changes only the prompt text.

Two clean resolutions: align the strings so `'adventurous'` relaxes the clauses, or delete the
`aggressive` branch as dead. Which one depends on whether adjacent mode is *meant* to surface
experimental and needs-fit-review pieces — that is a product call, but the code question is
settled: today it does not, and no path can make it.

### What is not in this stack

Structural validity (`evaluateOutfitStructure` with its `describeOutfitStructureGap` message
projection, plus typed `evaluateOutfitRoles` — needs shoes, needs primary top+bottom or a dress, and
a layer role needs its primary) is a *separate* check on the assembled outfit, and
it runs **before** the piece gate in `propose_outfit`. Diversity, dedup and repair run after — see
the next section. None of those are piece-eligibility questions, which is why they are not here.

**[validation-ownership consolidation, first foundation migration, 2026-08-24] Category structure
now has one typed owner.** `evaluateOutfitStructure` returns ordered error findings for missing or
multiple shoes, multiple bottoms/dresses, dress-plus-bottom conflicts, and incomplete separates,
with category-count evidence. `describeOutfitStructureGap` returns only its primary message. The
former boolean adapter preserved the earlier contract during migration and was retired after its
last consumer moved. This removes duplicate category counting. A top over a dress
remains legal. Role intent, layer/base mechanics, ownership/context checks, plan slot/set rules, and
advisor disposition remain separate validators.

**[validation-ownership consolidation, second consumer migration, 2026-08-24] Whole-wardrobe and
submitted-plan gates now read typed structure findings directly.** `locallyGateWholeWardrobeOutfits`
maps any structural error to its existing `not a complete wardrobe outfit` rejection before
ownership/context/advisor policy. `validateSubmittedPlanOutfits` uses the primary finding's existing
message before its dependency, slot, repetition, and set checks. The former plan-side boolean-plus-
diagnosis double evaluation is gone. Structural acceptance, rejection wording, advisor behavior,
and model-call sequence are unchanged.

**[validation-ownership consolidation, third consumer migration, 2026-08-24] Route-level visual
composition no longer reimplements or repeatedly recomputes category structure.** Selected-piece
resolution filters on `evaluateOutfitStructure(...).valid`. Whole visual composition caches one
typed result per normalized model outfit and reuses it for structural diagnostics, clash-review
eligibility, saved-variant accounting, and final filtering. Its public diagnostic vocabulary is a
projection from finding codes, so existing strings and generation-run counts remain stable. Visual
critic policy, local fallback, saved-Main handling, and accepted-card behavior are unchanged.

**[validation-ownership consolidation, explicit-role migration, 2026-08-24] Freeform role
structure now has a typed owner outside the tool executor.** `evaluateOutfitRoles` returns ordered
error findings and role-count evidence for explicit role validity/cardinality, footwear and core
completeness, dress/primary conflicts, orphan layers, and role/category mismatches.
`propose_outfit` and slot-swap validation project the same messages and
retain the same reject/retry behavior. The former tool-local prose validator and its unused
`missingGaps` parameter are gone. This does not settle pair mechanics, direction, sight, plan
slot/set findings, or advisor disposition.

**[validation-ownership consolidation, layer direction, 2026-08-24] Ordinary over/under direction
is now a shared typed verdict.** `evaluateLayerDirections` resolves explicit overlay, underlayer,
dependent-garment, role, and outerwear evidence. Missing direction is `unknown`, requires sight of
both garments, and may then be accepted as a provisional one-turn model judgment; it is not saved
as garment truth. Freeform diagnostics distinguish blocked unknown direction from visually allowed
unknown direction, so the allowance can be evaluated and removed centrally. Submitted plans and
direction-participating slot swaps consume the same verdict. The former tee/tank keyword veto was
removed; required coverage mechanics remain a separate hard contract.

---

## The shape of a turn, and how many round-trips it takes

**Added 2026-08-17.**

**[by design] `tool_sequence` records which tools ran in which provider iteration.** Iterations are
`;`-separated, the calls within one `,`-separated, so a turn's structure is a query rather than an
inference. Before it, `freeform_generation_runs` recorded that a turn took 6 iterations and made 7
tool calls and never which call sat where — the shape had to be read out of the model's own prose.
Same provenance gap that hid a composer regression from 1,192 passing tests.

**[by design] `search_wardrobe` accepts several categories in one call.** Three searches differing
only by category cost three round-trips, and each one re-reads the entire conversation *and* the
cached prefix — the `thread_1786994644421` A/B established that prefix size is multiplied by
iteration count, so a round-trip is not cheap merely because the prompt is cached. Verified: one
batched call returns exactly what three separate calls did, 117 pieces, same tokens.

Stated structurally rather than as prompt guidance asking the model to batch, because prompt-only
instruction has failed every time it has been tried here (capsule criterion 8; freeform specs 3, 7
and 11).

**[by design] The image budget is per CATEGORY, not per call.** `SEARCH_WARDROBE_VISUAL_CAP` applied
per call, so collapsing three searches into one would have handed the model a third of the photos it
used to get. Visual grounding is a founding principle of this app and starving it to save a
round-trip would be the wrong trade; the cap now ranks within each category. Measured identical:
shoes 4, tops 16, bottoms 16, both ways.

**[flagged, 2026-08-18] The small execution router removes the full-prefix controller from a narrow
same-context batch.** An eligible fresh request is
classified from only its sentence, date and timezone. A `bounded_multi` decision invokes the
existing visual composer directly; all other decisions or failures fall through to the general
tool loop. The router cannot inspect or rank garments. Photographs, garment truth, memory, weather
physics and Style Constitution guidance remain in the nested composition call. Its decision and
cost are observable through `execution_router_calls`, aggregate provider usage, and
`tool_sequence`. The flag-off path is unchanged. See `routeFreeformExecutionProfile`
(`styling-engine/provider.js`) and `/ask` (`routes/ai.js`).

**[flagged, 2026-08-19] Compact text profiles avoid the wardrobe-wide controller when no
composition is requested.** The small router also has
three conservative outcomes: explain verified current cards, answer from verified structured
garment facts, or give wardrobe-independent general styling education. Each outcome gets one
bounded no-tools answer call and returns before `buildStylistConversationPayload`; general advice
receives no wardrobe/thread context at all. Requests to compose, revise, render, discover pieces,
or resolve ambiguous identity remain on the full stylist path. Usage is included in the parent
diagnostics and `tool_sequence` names the selected compact profile.

**[flagged, 2026-08-19] Full-stylist prose history is bounded independently from structured
state.** Bounded history is unconditional:
`boundFreeformConversationHistory` retains the newest four exchanges, at most eight messages,
12,000 total characters and 3,500 per message. It runs after duplicate-current-question removal.
Current cards, established context, resolved weather, feedback memory and the wardrobe manifest
are assembled separately and are not evicted. Oversized messages retain their beginning and end
around an omission marker; there is no paid summary call. `freeform_generation_runs` records
received/included message counts and removed characters without copying conversation text.

**[amended 2026-08-19] Tool-local contracts have one prompt owner.**
`freeformToolRoutingInstruction` replaces the volatile controller's duplicate mode and schema prose.
`buildStylistConversationDirective` now supplies the one mode directive; individual `STYLIST_TOOLS`
descriptions own local eligibility, arguments and mechanical output; the controller retains only
cross-tool selection boundaries. The stable cached prefix is unchanged. Ownership and deferred
stable-prefix questions are recorded in `docs/freeform-prompt-ownership.md`.

**[flagged, 2026-08-19] Anthropic can defer the long-tail tool catalog.**
`anthropicDeferredToolPlan` activates only for a supported Claude model, Anthropic provider, the
`WARDROBE_FREEFORM_DEFERRED_TOOLS=true` flag and at least ten currently available tools. It leaves
intent, search, view, correction storage and proposal eager; nine long-tail schemas load through
Anthropic BM25 tool search. OpenAI and unsupported/small catalogs are no-ops. Compatibility 400s
retry once with the original full catalog. Run diagnostics count mode iterations, server searches,
fallbacks and initially hidden schema characters. Full rationale and acceptance matrix:
`docs/freeform-deferred-tools-spec.md`.

**[owner-ratified correction, 2026-08-18] Live numeric weather outranks router season language.**
When bounded freeform has resolved a live forecast, `generateWholeWardrobeOutfitsVisualInternal`
uses that profile directly for hard hot/cold gates. The season string remains in the visual brief
but cannot reclassify 78°F as hot merely because it contains `summer`. Without a live profile, the
existing text/calendar heuristic is unchanged. This was measured on `thread_1787096409835` after
`summer` incorrectly removed 59 insulating pieces plus 20 fiber matches from a 78°F roster.

**[follow-up correction, 2026-08-19] Resolved weather physics is thread state, not a display
string.** `serializeWeatherProfile` stores source, numeric high/low, and hot/cold/extreme booleans
in `stylist_conversation_state.weather_profile`; `restoreWeatherProfile` supplies them to the next
tool context. Explicit weather in the new turn clears/supersedes the stored profile. Otherwise a
composite label containing `summer` cannot re-hot a live 78°F/56°F profile.

**[direct Visual Composer correction, 2026-08-19] "Current season" means current local weather.**
The direct `/generate-wardrobe-outfits-visual` route now reads the saved home location and resolves
today's live numeric forecast before roster gates run. An explicit seasonal or extreme-weather
selection remains an authored hypothetical and bypasses the live lookup, preserving the brief.
See `resolveStylingContext` (`styling-engine/stylingContext.js`) and
`generateWholeWardrobeOutfitsVisualInternal` (`routes/ai.js`).

**[forecast-failure correction, 2026-08-19] A named place is never converted from unknown weather
to guessed heat.** `getCurrentWeatherProfile` and `getWeatherProfileForPlan` return a neutral,
observable `weatherSource:"unavailable"` profile when a real location lookup fails. Hard hot/cold
gates remain off; shared context resolution preserves that neutral result instead of re-parsing
router season text. Bounded freeform removes the calendar label from the composer weather
brief and visibly says the forecast could not be verified. Requests without a location still use
the existing text/calendar heuristic. This follows `thread_1787098654251`, where failed Berkeley
weather became `summer; hot weather` and wrongly removed 79 weather-related candidates.

**[biometeorological scale unification, 2026-09-11] Matzarakis PET Scale thermal boundaries unified across weather classification and presence resolution.**
`styling-engine/biometeorology.js` provides contiguous ambient bands inspired by Matzarakis PET categories, mapping ambient temperatures to thermal demand without physiological stress claims or garment prescriptions. `styling-engine/weather.js` aligns `COLD_F` with `COLD_THRESHOLD_F` (46°F) and defines `SEVERE_COLD_F` (45°F). In `styling-engine/outfitEnvironmentalAdequacy.js` (Contract C) and `styling-engine/outfitSetPlanner.js` (`slotColdLayerRequired`), hard layer gating is strictly owned by `coldPresenceRequirement.state === 'required'` (reserved for verified severe cold outdoor exposure, `highF <= 45°F`, or explicit user severe cold statements). Ordinary cool exposure (< 55°F waking low) produces an advisory recommendation (`state: 'recommended'`, `WARM_LAYER_RECOMMENDED`) rather than an arbitrary hard invalidity cliff. Indoor destinations excuse the base outfit (`state: 'not_needed'`), while transit cold exposure is evaluated independently under Contract D (`transitIsCold`, `transitNeedsRemovableCoolLayer`). Master booleans (`requiresOuterwear`) and fallback reconstructions are eliminated in favor of explicit typed presence states.

**[structured weather contract, 2026-08-30] Weather for `plan_outfit_set` is now typed at the tool
boundary, never parsed from prose.** `docs/future-trip-weather-estimate-spec.md` §1-6 implemented:
the model translates language into typed `user_weather` (only when the current message explicitly
states weather — a numeric range or a qualitative `hot|cold|mild` band, never both) and
`weather_estimate` (the model's own conservative seasonal numeric guess, used only as a fallback)
tool arguments; `styling-engine/weather.js` owns validation (`validateUserWeather`/
`validateWeatherEstimate`), field-level resolution (`resolveWeatherContext`: each of
temperature/precipitation/wind resolves independently as `stated_user` → `live` →
`model_estimate` → `unavailable`, so a stated condition and a live temperature coexist rather than
one erasing the other), and the async orchestrator every call resolves through before retrieval
(`resolveWeatherForRequest`). `classifyTemperatureRange` reuses the same HOT_F/COLD_F thresholds as
live weather and supports non-exclusive classification, so a genuinely wide range (a model estimate
or a user-stated range spanning both extremes) registers as both hot and cold instead of silently
collapsing to neutral via the single-day exclusivity `weatherProfileFromContext`'s own text branch
still applies elsewhere. A named destination/date with no resolved temperature returns a typed
`weather_context_required` stop before any roster/pendingPlan is built — checked via each slot's
actual `resolvedWeatherContext.status`, and via `.some()` so a mixed plan (one resolved slot, one
not) still stops rather than proceeding partially gated. Cold-transit footwear
(`wholeWardrobePieceTrustDecision`, `styling-engine/rules.js`) now hard-rejects open-toe/sandal
shoes (structured `shoe_type`/`toe_shape` fields, never garment names) whenever
`weatherProfile.isCold` or the indoor-transit-preserved `weatherProfile.transitIsCold` is true.
Corrected root-cause note (`thread_1788147143882`, a Vienna VA October trip): the live incident was
never a `propose_outfit`-vs-`plan_outfit_set` routing failure or a missing gate — both providers
called `plan_outfit_set` correctly, and the hard cold-bareness gate already existed. The actual
defect was that arbitrary model prose in `slot.weather` (e.g. "crisp outdoor walking weather")
became authoritative physical weather ahead of the live forecast, and a failed future-date forecast
read as neutral with no structured fallback. `environment` (indoor/outdoor/beach_coastal) is now
the sole model-facing setting field; the free-text `weather` field is removed from the tool schema
entirely.

**[amended 2026-09-15 — one-sided stated endpoints, not just complete ranges or a single point]**
`user_weather` and its supporting parsers now carry three genuinely distinguishable shapes: a
complete range ("50/40°F", both endpoints), a point temperature ("it's 46°F", ratified equal
endpoints, spec §4.1), and a one-sided forecast ("highs near 85F", one endpoint stated, the other
left `null` rather than manufactured equal to it). `validateUserWeather` accepts `high_f` XOR
`low_f` alone as valid (previously rejected as an "incomplete range"). `classifyTemperatureRange`
computes `isHot`/`isCold` independently off whichever endpoint is finite, instead of requiring both
finite and returning `{isHot:false, isCold:false}` for a one-sided input — a reading that used to be
indistinguishable from "weather unresolved". `stylingIntent.extractStructuredUserWeather` and
`stylingContext.js`'s `statedTemperatures` (the prose-parsing sibling behind
`weatherProfileFromStatedText`, used by `buildStylistConversationPayload`) both detect a `highs?`/
`lows?`/`up to`/`down to`/etc. qualifier immediately before the sole stated number and return only
that endpoint. Both had the same latent bug during implementation: the qualifier-adjacency check
used a trailing `\b`, which never matches between a digit and the unit letter directly following it
("85F", "40F" — both word characters, no boundary) — so a one-sided statement with its unit
immediately adjacent silently fell through to the point-temperature branch and manufactured the
very equal-endpoint reading the sided branch exists to prevent. Fixed with `(?!\d)` in place of the
trailing `\b`. `docs/future-trip-weather-estimate-spec.md` §4.1 amended to match. `restoreWeatherProfile`/`serializeWeatherProfile` already omitted a non-finite endpoint rather than
coercing it, so the one-sided shape round-trips through THREAD STATE unchanged.

**[single-outfit parity, 2026-08-31] `search_wardrobe`/`propose_outfit`/`generate_outfits` resolve
weather through the same structured contract as `plan_outfit_set`.** `stylingContext.js`'s shared
`resolveWeather` — used by every direct/non-chat generation caller too — gains
`resolveNamedDestinationWeather`. Explicit structured `user_weather`/`weather_estimate` resolves
first; a direct already-resolved `weatherProfile` or direct explicit stated-weather input remains
authoritative; named destination/date resolution then precedes lower-authority artifact/state prose
or snapshots. Live lookup remains gated by the same `isCurrentSeason` check the legacy branch used
(an explicit hypothetical season still bypasses live resolution). It triggers on a fresh
`location`+`date` or a bare structured `user_weather`/`weather_estimate` with no destination at all;
reuses the injectable
`weatherResolver` seam (not a separate fetch mechanism) so existing test mocks intercept it
transparently. `toolContext.resolvedWeatherContext` caches the result — a matching second call
(`propose_outfit` after `search_wardrobe`, no location/date of its own) reuses the cache instead of
re-resolving. Deliberately does not fall back to `toolContext.location` (the route-level
home-location default) as a trigger, so an ordinary "what should I wear today" request is
unaffected. `search_wardrobe`'s free-text `weather` field is removed from its schema; `propose_outfit`
keeps its unrelated `season:'indoor'` convention as-is (a separate, pre-existing mechanism, not
weather prose about temperature).

**[typed unresolved stop, 2026-08-31]** `search_wardrobe`, `propose_outfit`, and `generate_outfits`
now stop with the same typed `weather_context_required` response `plan_outfit_set` already returns
(`weatherContextRequiredStop` in `styling-engine/tools.js`, called right after
`resolveToolStylingContext` in each of the three tools, before any retrieval/scoring). It only fires
when `resolvedWeatherContext.location` is non-empty — a genuine named destination/date that stayed
unresolved — never for a bare structured claim with no place attached (e.g. "it's raining" with no
destination), which legitimately carries `status: 'unavailable'` on temperature alone while still
resolving precipitation/wind, and must proceed as an ordinary local turn rather than stop. The
system prompt's Destination & Weather Clarification bullet now teaches this for all three tools, not
just `plan_outfit_set`.

**[§7 continuity persistence, 2026-08-31]** Every accepted card now carries `weatherUsed` (the
truthful display label, `truthfulWeatherLabel` in `outfitSetPlanner.js`, exported for reuse) and a
serialized `resolvedWeatherContext` alongside it — attached in `validateSubmittedPlanOutfits` for
plan/capsule cards (from the slot's own already-resolved `weatherProfile`), and via a shared
`weatherCardFields(stylingContext)` helper in `tools.js` for `propose_outfit` and `generate_outfits`.
No-op when nothing was structurally resolved (an ordinary at-home heuristic call). Both current-set
projections read these per-outfit fields as `weather_used`/`resolved_weather_context`:
`boundedConversationStateFromToolContext` (`routes/ai.js`, the router's direct-routing path) and the
`outfitSetFromBody` closure inside `buildStylistConversationPayload` (`styling-engine/core.js`, the
full-stylist tool-loop path) — this is per-outfit specifically because a multi-slot trip can have
different weather per slot, which the single shared `weather_profile`/`weatherProfile` field already
on both projections cannot represent. `freeform_generation_runs.weather_source` now reads
`resolvedWeatherContext.overallSource` (mixed-aware — e.g. user-stated rain + live temperature) when
the structured resolver ran, falling back to the old plain per-field source otherwise;
`plan_outfit_set` sets it from its own per-slot precheck (the shared source when every slot agrees,
`'mixed'` when slots differ).

**[§9 item 1, provider-schema parity, 2026-08-31]** Anthropic reads `STYLIST_TOOLS`' `input_schema`
with no projection of its own; Gemini (`toGeminiFunctionDeclaration`) and the newly-extracted OpenAI
equivalent (`toOpenAiFunctionTool`, `styling-engine/provider.js` — previously an inline map at the
`callOpenAiTurn` call site, now the same shape as the pre-existing Gemini helper) both wrap that
exact `input_schema` object unchanged rather than holding an independent copy, so `user_weather`/
`weather_estimate` parity across all three providers is structural, not merely tested — a test in
`test/gemini_tool_loop_adapter.test.js` asserts both the object-reference reuse and that every one
of the four composition tools (plus `plan_outfit_set`'s own per-slot schema) actually carries both
fields.

**[§9 checklist audit, 2026-08-31]** Cross-referenced all 31 acceptance items against the test suite.
Items 2-12, 14, 18, 20-22, 24, 27, 29 were already covered by earlier phases (`test/weather.test.js`,
`test/plan_outfit_set.test.js`, `test/freeform_observability.test.js`). This pass closed the remaining
gaps: item 13 (a different-location slot does not inherit the plan's `weather_estimate` —
`normalizePlanSlots`' `locationMatchesPlan`/`inheritsPlanWeather` binding, not previously tested
directly), item 15/17 (a single test feeding every prose phrase from the spec's own anti-regression
list — dates, counts, Celsius, styling adjectives — through both `requestText` and malformed
`user_weather`/`weather_estimate` shapes, proving none of it can create or alter resolved weather),
item 16 (an undeclared `weather` HTTP arg is silently ignored by `search_wardrobe`, proven end to
end via `executeTool`), item 19 (a submitted card with no outerwear/heavy main piece is rejected once
`weather_estimate` establishes cold — `validateSlotOutfitConstraints`'s pre-existing "no warm layer"
gate, now proven against the new resolver), item 23 (a shared coat repeats across two cold-weather
slots under `reuse:'maximize'` with no `no_repeat` set — the default, unrestricted case), item 25 (the
exact Vienna 65/45 request reaches `plan_outfit_set` once and `submit_plan_outfits` once, zero
retries, via `replayStylistToolScript`), item 26 (the same provider-free replay stands in for
per-provider fixtures: `executeTool` has zero `AI_PROVIDER`-conditional branching anywhere in the
weather-resolution/gating path — confirmed by grep — so behavior cannot diverge by provider; only the
wire-format adapters differ, and those are proven identical elsewhere), and item 28 (a mismatched
location on a second `resolveToolStylingContext` call re-resolves rather than reusing the cache — the
negative case of item 27's existing test). Item 30 (a follow-up states the exact range and calls it a
seasonal estimate) is covered at the data layer only — the persisted `weatherUsed` label already reads
`"65°F high / 45°F low — seasonal estimate, not a live forecast"` verbatim (spec §7's persistence
work) — the model's actual follow-up prose is live behavior an offline test cannot exercise. Item 31
is the full suite staying green, checked after every commit in this arc.

**[external review before §10 verification, 2026-08-31] Five confirmed P1 correctness gaps found and
fixed before any live call was made — the audit above was thorough but incomplete; these were real,
reproducible, and would have let the original bug class recur.**

1. `validateSlotOutfitConstraints`'s cold-layer check read only `weatherProfile.isCold` — an indoor
   slot deliberately zeroes that (its base may stay light) and carries the outside cold as
   `transitIsCold` instead, so the "museum T-shirt with no layer" bug was untouched by any of this
   arc's work. Fixed: the check now also fires on `transitIsCold`, requiring an actual layer piece
   (not a heavy top/dress — those aren't removable indoors).
2. `propose_outfit`/`generate_outfits` still funneled their own `season` argument into legacy
   `statedWeather` whenever it wasn't a recognized calendar-season word (`extractSeasonRequest`
   returns `''` for e.g. "hot weather") — and `resolveWeather` checks `statedWeatherCandidate` BEFORE
   any structured resolution runs, so an arbitrary model-invented season string silently outranked a
   genuine `weather_estimate` for a named destination. Reproduced: Vienna 65/45 estimate + `season:
   'hot weather'` resolved as `isHot:true` from `stated`, no `resolvedWeatherContext` at all. Fixed:
   both tools now pass `statedWeather` only for the literal `'indoor'` sentinel (`propose_outfit`'s own
   documented convention); every other season string no longer reaches it.
3. An unresolved named destination fell back to whatever `toolContext.weatherProfile` already held
   from an earlier call this turn (or a stale established-state snapshot) instead of surfacing as
   unresolved — that snapshot carries no `resolvedWeatherContext`, so `weatherContextRequiredStop`
   could never fire. Fixed: `resolveWeather`'s named-destination branch no longer falls back to
   `savedSnapshot`; an unavailable destination always returns its own `'unavailable'` resolved context.
4. The full-stylist tool loop's post-turn save only wrote `recently_discussed_piece_ids` —
   `buildStylistConversationPayload`'s own save runs BEFORE the tool loop and only persists cards the
   browser already echoed from the PREVIOUS turn, so a freshly accepted `plan_outfit_set` result
   depended entirely on the browser echoing it back next turn to survive at all (the exact gap spec §7
   prohibits). Fixed: the post-loop save now also writes `current_outfit_set`/`weather_profile` from
   `toolContext.generatedOutfits` via `boundedConversationStateFromToolContext`, whenever the loop
   produced fresh cards.
5. Cache reuse in `resolveNamedDestinationWeather` returned the cached context for ANY call with no
   fresh destination/date, before ever checking whether a NAMED location on this call actually matched
   the cache's — a location-only follow-up naming a different place with no date of its own silently
   inherited the wrong destination's weather. A second leak existed one layer up: even after fixing
   that, `resolveToolStylingContext`'s `establishedState.weatherProfile` carryover (a separate flat
   field, unconditionally threaded forward) still leaked the same stale profile across a mismatched
   location. Fixed both: the cache function now refuses to reuse across a location mismatch even
   without a date, and the establishedState carryover is now gated the same way.

Also fixed while reproducing: `validateWeatherEstimate`/`validateUserWeather` coerced their inputs
with `Number(...)` before range-checking, so `{high_f:null,low_f:null}` silently validated as 0°F/0°F
and a model-hallucinated string `"65"` passed as a real number; `resolveConditionField` treated a
user-stated `'unknown'` as a truthy, authoritative value that overrode a real lower-precedence
value — both now require an actual `typeof === 'number'` and treat `'unknown'` as "not stated." And a
genuinely pre-existing, unrelated bug surfaced while testing fix 1: `weatherProfileFromContext`'s
temperature regex matched a bare "10" in "Build a 10-piece capsule" as a 10°F reading (`hasColdTemperature`
true from a piece count) — real production phrasing, not just test noise. Fixed with a negative
lookahead excluding a number immediately followed by a hyphenated word.

**[closure pass, 2026-08-31] The remaining review findings are implemented, not deferred.**
`resolveWeather` now gives explicit structured user/model evidence first authority, preserves an
already-resolved explicit profile or direct explicit stated-weather input, and resolves a named
destination/date before any lower-authority artifact/state prose or snapshot. Consequently,
`resolveToolStylingContext` no longer gives blended `toolContext.weather` executable authority.
An unbound flat snapshot cannot cross into a newly named location. Cache reuse and plan inheritance
share `normalizedWeatherLocationIdentity`, so punctuation/case and US state-name variants such as
"Vienna VA" / "Vienna, Virginia" match while different places do not. Planner automatic-use
evaluation now receives `shared_anchor_ids`, using the existing explicit-anchor bypass without
erasing the underlying cold-footwear finding. Indoor cold-transit slots state the removable,
sleeve-bearing layer requirement before composition, and submission validation checks it. The
representative Vienna acceptance replay now includes city sightseeing, a museum day, and a nature
walk; all three cards pass the first submission from one `plan_outfit_set` call with the 65/45
estimate. The documentation warning ratchet remains 54; it was repaired with a real status header
rather than raised.

**[independent-review closure, 2026-08-31]** Cache identity now checks both normalized location and
date range: a date-only follow-up binds to the cached named destination and resolves the new date.
`season:'indoor'` is treated as an environment projection, so a matching cached destination keeps
its structured source and outdoor temperature under `transit*` fields instead of becoming neutral
prose weather. In compose mode, `search_wardrobe` consumes the automatic-use hard verdict before
returning a roster; cold-open footwear and other engine validity failures no longer reach the model
for later repair, while `intent:'explain'` remains inspectable. The architecture fixture replaces
legacy weather prose with structured ranges and preserves its reviewed candidate outputs; only the
truthful structured weather labels change.

**[independent-review follow-up, 2026-08-31]** Reusing a matching resolved destination is now
independent of permission to perform a live lookup: an offline/disabled-live indoor follow-up still
projects cached cold physics into `transitIsCold`. A fresh partial `user_weather` update with no
repeated location/date inherits the cached identity and resolves field by field, so newly stated
rain augments rather than erases the cached temperature and its source. Search relaxation carries
sets of excluded piece IDs across internal rungs and increments `gateExcludedTotal` only after the
terminal pass; one model-visible search therefore counts each hard-gated piece once, matching the
returned exclusion note rather than the number of implementation retries.

**[field-authority correction, 2026-08-31]** A matching cached field participates at its retained
authority, not as an unavailable-only fallback. `resolveWeatherContext` compares fresh and cached
sources independently for temperature, precipitation, and wind under
`stated_user → live → model_estimate → heuristic → unavailable`; a fresh field wins ties. Thus a
partial rain update cannot demote cached user-stated 50/40°F to a newly fetched live 82/70°F, while
a genuinely fresh live temperature still replaces a cached model estimate.

**Not yet done:** §10's live paid Vienna VA verification — requires printing estimated cost and the
owner's explicit confirmation before running, per the spec's own rule; not something to do
unilaterally.

**[context-ownership consolidation, 2026-08-24] Selected-piece and whole-wardrobe generation now
resolve the same evidence through one authority.** `resolveStylingContext` owns per-field source
precedence, normalization, occasion/activity profile construction, comfort constraints, and weather
selection. Explicit stated weather outranks physical inference; current-season requests refresh
live weather when a location exists; saved snapshots are used when that lookup is unavailable; and
explicit hypothetical seasons bypass live weather. Declared activity remains separate from
request-inferred activity so inference can guide the model without activating a hard footwear gate.
Both generators expose resolved values, provenance, and conflicts under response debug
`stylingContext`.

**[context-ownership consolidation completed, 2026-08-25] Freeform and plan slots now use the same
field resolver.** `resolveToolStylingContext` passes explicit request, action artifact, established
thread state, and inference to `resolveStylingContext`; it no longer owns a second stated/live
weather branch. `buildPlanSlotWorkbench` resolves each slot through the shared owner before roster
selection and preserves the result/provenance on the workbench and pending slot. Explicit supplied
weather profiles, including indoor-transit profiles, are authoritative evidence. Saved artifacts
and persistent thread state remain separate sources rather than overwriting one another.

**[calendar-season projection correction, 2026-08-25] A resolved request season and its executable
season are distinct fields.** `resolveStylingContext` preserves `season: "current season"` for live
weather and display behavior while deriving `calendarSeason` from the authoritative request date.
`resolveCalendarSeason` is also the shared defensive projection for direct/freeform/plan prompt
memory, hard owner constraints and historical exact-outfit reactions. This closes the live
`thread_1787651275782` gap where accepted summer guidance was omitted before the model call because
one reader compared the placeholder literally. It does not add a suede taste rule, alter ranking,
or turn a prompt preference into a hard eligibility gate.

**[applicability projection completed, 2026-08-25] Calendar Season and physical weather now cross
flow boundaries as one canonical executable shape.** `projectStylingApplicabilityContext` in
`stylingContext.js` derives Calendar Season against the authoritative request date and normalizes
hot, cold, rainy, and wet-exposure flags from the resolved Weather Profile. Direct selected/whole,
freeform search/propose/swap/generation, plan workbenches, and capsule feedback readers consume
that projection. Plan slots preserve Requested Season separately from `statedWeather`, so an
indoor summer slot remains summer for seasonal applicability without treating `indoor` as a
calendar season. Composite bounded labels such as `current season; mild weather` are parsed only
at the resolver boundary; they are not a new semantic source. The hard gate receives the same
Calendar Season and request date, so it cannot independently reinterpret the turn.

**[eligibility-ownership consolidation, 2026-08-24] Primary visual composition and selected-piece
recovery now consume one finite-pool verdict.** `evaluateVisualComposerPiecePool` classifies every
roster exclusion as validity, presentation, or capacity. The photo roster remains bounded, while
the recovery projection may reuse accessories, no-photo pieces, and cap cuts but cannot reintroduce
a weather, register, activity, footwear, metadata, or other validity exclusion. Selected local
fallback, absolute fallback, and comfort-footwear repair all use that recovery projection. A
shoe-anchor repair evaluates the full wardrobe through the same authority before choosing a
substitute; it does not reopen raw `allPieces`.

**[eligibility-ownership consolidation, second consumer migration, 2026-08-24] Freeform search,
proposal validation, and slot swaps now consume one hard-gate pool result.**
`evaluateAutomaticUsePiecePool` preserves the hard gate's underlying findings and labels owner
authority explicitly. `search_wardrobe` continues its deliberate retrieval disposition: owner
vetoes remain fixed while non-owner profile findings proceed to the existing rule-fit annotation
and `intent:"explain"` path. `propose_outfit` and `suggest_slot_swaps` keep their stricter
dispositions, and an explicit anchor remains usable without erasing the evidence that ordinary
automatic selection would have blocked it. No scoring, profile rule, or broadening order changed.

**[eligibility-ownership consolidation, third consumer migration, 2026-08-24] Selected support
ranking and whole-wardrobe suppression now consume the same automatic-use pool.**
`selectAutomaticUseCandidatesForOutfitGeneration` evaluates supporting pieces once, then injects
those decisions into the existing compatibility score and category-quota strategy; selected-piece
generation and concept-board planning no longer independently invoke the hard gate. Whole-wardrobe
generation also consumes `evaluateAutomaticUsePiecePool` directly. Its former hot-weather
outerwear behavior is an explicit capacity policy (keep the three lightest, deterministic by ID),
and a saved Main may bypass that disposition without erasing the hard-gate or capacity finding.
At this point the legacy whole-filter function still served plan, capsule, and recovery consumers.

**[eligibility-ownership consolidation, fourth consumer migration, 2026-08-24] Coordinated plans
and capsules now consume the same automatic-use pool before applying their own strategy.**
`evaluatePlannerAutomaticUsePool` carries each slot's resolved weather, activity, register ceiling,
and `ownerExclusionOccasion` into `evaluateAutomaticUsePiecePool`. It also declares the existing
three-piece hot-weather outerwear cap as capacity policy. `slotGateEligiblePieces`,
`elevatedCapsuleDemands`, and `buildPlanSlotWorkbench` consume the resulting eligible projection;
the workbench's suppression diagnostics retain `underlyingExcludedPieces`. Plan ranking and caps,
capsule slot union, quota/roster selection, structural coverage, and representative rotation do not
move into eligibility and do not change behavior. The legacy whole-filter adapter remains only in
recovery logic in `rules.js`.

**[eligibility-ownership consolidation, fifth consumer migration, 2026-08-24] Footwear recovery
now consumes the same automatic-use pool mechanics, completing the active-caller migration.**
`repairWholeWardrobeOutfit` uses `evaluateAutomaticUsePiecePoolCore` with
`wholeWardrobePieceTrustDecision` before its existing required-footwear match and relevance sort.
The core was extracted below `eligibility.js` to avoid a circular dependency; it owns owner-
constraint loading, typed findings, effective/underlying dispositions, and capacity policy, while
the public `evaluateAutomaticUsePiecePool` remains the domain entry point for every caller outside
`rules.js`. The legacy whole-filter export delegates to this core and remains only for contract
tests. Hiking activation, eligible shoe supply, scoring, tie-breaking, and the single-swap behavior
are unchanged.

**[candidate-set ownership, 2026-08-25] Hard caps preserve executable outfit supply before they
preserve category abundance.** `buildCoveredCandidateSet` is the shared bounded-set owner for
selected support candidates, visual photo rosters, coordinated-plan workbenches, and capsule model
benches. Caller-specific ranking remains intact, but a cap may replace a lower-priority duplicate
category piece with the ranked top/bottom/shoe or dress/shoe path needed to leave composition
possible. A `needs_base` anchor or path also reserves a base whose shared construction verdict is
not known incompatible. Already-complete selections keep their exact order. Missing wardrobe
supply and insufficient hard capacity are distinct report codes. Direct visual flows make no
composer call and return no fallback card when the final gated roster is incomplete; plan slots
continue only for the coverable portion and disclose each unfilled slot. Search remains retrieval
and does not inherit the composition-coverage requirement.

**[recovery ownership, 2026-08-25] A fallback or mutation cannot weaken the primary hard
contract.** `recovery.js` owns four mechanics: `validatedSubstitute`, `validatedComplete`,
`validatedFallback`, and `discloseRecoveryShortfall`. The first three require a validator callback
and run it immediately against each exact mutated/replacement result; rejected attempts remain
attempt evidence and are never returned as recovered. Selected local/absolute fallbacks inject
anchor, structure, and required-base checks; whole backfill injects
`locallyGateWholeWardrobeOutfits`; comfort and required-footwear swaps inject category structure;
plan/capsule mutations inject `validateSubmittedPlanOutfits` or `validateCapsuleRoster`; freeform
correction supersession injects explicit-role and required-base checks. Candidate ordering, whether
unknown visual evidence may proceed, retry/provider budgets, and visible disposition remain local
policy. Exhaustion uses one structured `recovery_shortfall` report while existing human-facing
wording stays flow-specific.

**[projection and result ownership, 2026-08-25] One finding has one model-visible definition and
one delivered disposition.** `outfitValidation.js` now projects its category-core, explicit-role,
and typed-finding contracts into whole-wardrobe, freeform proposal, coordinated-plan, and capsule
expansion prompts. The flows retain their distinct strategies and output schemas. After validation,
`outfitResult.js` gives selected, whole, freeform proposal, plan/capsule, expansion, and repair
cards a versioned `result` containing exactly one of `accepted`, `annotated`, `repairable`, or
`rejected`, plus findings, annotations, provenance, and an optional repair capability. Existing
top-level fields remain as UI compatibility aliases, so this is an additive no-op for ranking,
provider sequence, persistence, and current card actions.

**[visual-review authority correction, 2026-08-24] Unversioned tagger prose cannot buy or decide a
visual clash review.** `wholeWardrobeOutfitVisualReviewFindings` now requires two concrete structured
pattern signals. The mere presence of `garment_intelligence.do_not_pair_rules` is a no-op for review
routing: these notes came from multiple tagger generations, were not normalized or continuously
corrected, and remain composer guidance rather than executable authority. This follows
`thread_1787621859177`, where two already-satisfied legacy notes sent an ordinary emerald top,
beige tailored shorts, and brown leather shoes to a paid critic; unusual photo lighting then caused
a false mauve-shoe rejection.

**[forecast-failure integration correction, 2026-08-19] Neutral failure is global and disclosure
must match it.** `resolveSlotWeather` now labels failed named-place plan forecasts as unavailable
with unknown temperature, including indoor-transit slots. It no longer emits “winter (estimated)”
while applying neutral gates. The neutral policy remains deliberate: a calendar season cannot
reliably substitute for the climate of an unresolved place.

**[bounded-state correction, 2026-08-19] The direct router writes cross-turn authority before its
early response.** `/ask` calls `saveStylistConversationState` with
`boundedConversationStateFromToolContext`: normalized `established` context plus the generated
`current_outfit_set`. Every frontend `/ask` branch supplies its actual thread ID. The router still
does not build the large controller payload merely to persist state.

**[bounded-router correction, 2026-08-19] Social company does not define event register, and
location does not imply activity.** The compact router now maps a generic restaurant dinner,
including dinner with friends, to city smart casual; explicit dinner dates, nights out and dressy
dinners map to evening; only explicitly casual/low-key events map to casual. Walking is emitted only
when the request actually includes walking rather than merely naming a destination. This follows
`thread_1787099389227`, where `casual + walking` removed 48 elevated and 11 dressy pieces before the
composer saw a Berkeley dinner request.

**[whole-wardrobe evidence correction, 2026-08-19] Wear mechanics reach visual composition but are
not narrated back as garment facts.** `composerPieceLineSuffix` now places `tuck_behavior`,
`hem_finish`, `waistband_type`, `opacity`, and the explicit `needs_base` value beside the photograph and existing fabric/read
facts. The model must silently honor settled mechanics. `styling_instructions` remains conditional:
it records a useful action or chosen relationship, not an owner's already-known fixed garment truth.

**[garment-truth correction, 2026-08-19] Visual lace does not override stored opacity.** After
`thread_1787103886848` called an opaque, independently wearable lace top sheer and invented a nude
camisole, the shared composer contract made `opacity` and both `needs_base` values authoritative.
An opaque `needs_base:no` garment cannot acquire an unverified underlayer from visual inference.

**[architecture consolidation, 2026-08-24] `needs_base` has one runtime fact reader.**
`pieceRequiresBaseLayer` returns true only for normalized explicit `yes`; unset and explicit `no`
retain the historical independent default. Capsule capacity and outfit checks, protagonist
ordering, selected local fallback, renderer instructions, and freeform primary-top/dress swaps now
consume that reader instead of interpreting the field independently. This is a fact consolidation,
not a new coverage or pair-compatibility rule; the ranking A/B diagnostic reported zero changes.

**[validation-ownership consolidation, required-base contract, 2026-08-24] “Needs a base layer”
now has one construction verdict after the garment fact.** `evaluateBaseLayerCandidate` and
`evaluateRequiredBaseLayers` in `outfitValidation.js` consume the canonical `needs_base` fact plus
structured `opacity` and `fit_on_body`. A candidate is incompatible when it also needs a base, is
`sheer`/`semi_sheer`/`open_weave`, or has a known non-close fit (`drapes`, `hangs_straight`,
`structured`, `none`). It is known compatible only with recorded opaque coverage and a close fit
(`skims`, `clings_stretchy`, `clings_drapey`). Missing fit or opacity is `unknown`, never silently
converted into a fact. Capsule roster/capacity policy may reserve an unknown candidate so legacy
metadata does not erase supply; submitted plans and freeform `propose_outfit` require both garments
to have been visually seen before the model may submit that unknown pairing. Known incompatibility
still rejects after sight. The rule applies only to coverage required by a dependent garment;
ordinary inner-garment/outer-layer combinations do not inherit a close-fit requirement. Colour,
neckline, texture, bulk, and proportion remain model judgment.

**[validation-ownership consolidation completed, 2026-08-25] Wearable-outfit validity now has one
composed owner.** `evaluateWearableOutfit` combines category or explicit-role structure,
required-base mechanics, optional layer-direction evidence, and sight state into typed hard,
advisory, and unresolved results. Selected, whole, freeform proposal/swap, plan submission, and
recovery validators consume that result before their bounded extensions. Unknown evidence is not
invalid; it blocks only when sight is needed to prove a hard requirement and has not occurred.
Hard-invalid paid selected/whole model attempts remain visible as Needs review cards with the actual
finding, alongside valid sibling cards. A selected dependent anchor with no compatible base is
preserved as an incomplete Needs review premise. Concept boards intentionally retain their lighter
allowlist/anchor validation.

**[validation-ownership consolidation, sleeve layer-pair construction, 2026-08-26] Sleeve-bulk
compatibility between two layered garments now has one owner, closing a gap the 2026-08-25 composed
owner above did not yet cover.** `thread_1787728618995`: asked whether a lace-sleeve blouse could
layer over a turtleneck, the compact `garment_fact` answer confidently said the pairing worked even
though both garments were long-sleeve — a private prose rule was added directly to that one prompt
(citing the retired `sleeve_type` field, which `garment_fact` is never even supplied). A follow-up
census confirmed the same gap existed in `evaluateWearableOutfit` itself: `propose_outfit`, plan
submission, and capsule composition could already accept a genuine sleeve-bulk conflict, because
neither `evaluateRequiredBaseLayers` (scoped to `needs_base` dependents only) nor
`evaluateLayerDirections` (over/under direction only) reads `sleeve_length`, `sleeve_shape`, or
`fabric_weight`. `evaluateLayerPairConstruction` in `outfitValidation.js` is the new canonical
verdict, composed into `evaluateWearableOutfit` behind the same `includeLayerDirections` flag every
existing consumer already passes — no call-site changes were needed. Two cuffed sleeves (elbow-length
or longer) worn one over the other is deliberately **not** incompatible by itself: the verdict is
`incompatible` only with actual bulk evidence (a voluminous `sleeve_shape` — puff, bishop, bell — on
either garment, or both tagged a medium/heavy `fabric_weight`), `compatible` when both are known
fitted and lightweight, and `unknown` when the deciding fields are unrecorded. Unlike the required-base
contract, an `unknown` construction verdict does **not** force sight verification before composing —
most ordinary layered pairs in this wardrobe simply lack `sleeve_shape`/`fabric_weight` tags, and
escalating every one of those to a mandatory-photo gate would have blocked routine composition for a
data-completeness issue rather than a suspected conflict (verified against the live test suite: the
broader escalation broke an existing layered-outfit fixture with no real conflict). Only a *proven*
conflict is a hard `evaluateWearableOutfit` finding; an unresolved one remains a visible advisory
finding. `garment_fact` now computes the same verdict server-side and cites it as a "Layering evidence
(computed)" block instead of restating sleeve/fabric thresholds in prompt prose.

**[prompt-projection follow-up, 2026-08-26] The composed owner above closed validation; composition
itself was still blind until this pass.** The first landing gave every composer post-composition
enforcement through `evaluateWearableOutfit`, but no active composer told the model the rule *before*
it composed — each would otherwise have had to restate the same thresholds independently to give
advance guidance, exactly the private-prompt-rule pattern this fix exists to close. A new
`layerConstructionPromptRule()` projection (mirroring `requiredBaseLayerPromptRule()`'s existing
pattern) is now cited, not restated, by every active layering-capable composer: `WHOLE_WARDROBE_
VISUAL_COMPOSER_SYSTEM` (covers both the whole-wardrobe and selected-anchor visual composer, which
share one template), the static `propose_outfit` tool description, and the shared plan/capsule slot
workbench (`buildPlanSlotWorkbench` in `outfitSetPlanner.js`) — one wiring point for both, since
`composeCapsulePlanOnce` forwards that same workbench's `instructions` and per-slot `submission_
requirements` straight into the atomic capsule composer's prompt payload. The workbench projection is
gated to slots whose own roster can actually form a layering pair; most slots cannot, and an
unconditional projection would be cost, not signal. A contract test
(`styling_context_consumers.test.js`) proves the visual composer and `propose_outfit` cite the rule
text verbatim at the source/runtime level; a live-fixture test (`plan_outfit_set.test.js`) proves the
workbench projects it only for a slot that can layer and withholds it for one that cannot.

**[gate correction, 2026-08-26 same day] The first version of that gate reinvented "can these pieces
layer" as its own local definition and got it wrong.** It counted only `top`/`dress`-category pieces,
so a slot whose only layering candidate was a jacket over a top (`layer_top` assigned to an
`outerwear`-category piece — a legitimate assignment per `evaluateOutfitRoles`' own role/category
map) silently never received the projection. Fixed by exporting `ROLE_CATEGORY_EXPECTATIONS` (the map
`evaluateOutfitRoles`' `role_category_mismatch` check already used internally) and a new
`wardrobeSupportsLayeringPair()` built from that same map, so the workbench gate and the role
validator can no longer independently define who is eligible to layer. `outfit_structure.test.js`
covers the helper directly (outerwear+top, top+dress, two tops, and the negative single-piece cases);
`plan_outfit_set.test.js` adds the live outerwear-layer_top fixture the original gate missed.

**[prompt-projection follow-up, 2026-08-26] Layer direction was the one layering verdict with no
prompt projection at all, and one composer had quietly filled the gap itself.**
`evaluateLayerDirections` was validated post-composition for `propose_outfit` and plan submission,
but no composer received pre-composition guidance about which piece sits over/under which — until
`capsulePlanCompositionSystemPrompt` invented a private "TOP + DRESS LAYERING" paragraph,
independently worded from the actual evidence sources (`pieceHasExplicitTopLayerEvidence`,
`pieceHasExplicitBaseLayerEvidence`, `pieceDressSupportsUnderlayer`, `pieceRequiresBaseLayer`) and
covering only the dress case. Fixed with `layerDirectionPromptRule()`, describing the executable
contract without inventing new thresholds, wired at the same three points as
`layerConstructionPromptRule()` (visual composer, `propose_outfit`, plan/capsule workbench — gated by
the same `wardrobeSupportsLayeringPair()` supply check) and deleting the private paragraph. Disposition
is unchanged: `evaluateLayerDirections`'s `unknown`/sight-required behavior was not touched, only its
pre-composition visibility.

**[sleeve taxonomy + directional construction rewrite, 2026-08-26] `sleeve_shape`'s fashion-name enum
(`fitted|straight|relaxed|puff|bishop|bell|flutter|raglan|dolman|other|unknown`) and the symmetric
`layer_construction_sleeve_conflict` verdict above were both replaced in the same pass — the symmetric
check was the direct consequence of the old enum having no shared semantics to be directional about.**
The new enum (`fitted|straight|puff_shoulder|gathered_ruched|voluminous|flared|deep_armhole|other|
unknown`, canonically owned by `SLEEVE_SHAPE_VALUES`/`SLEEVE_SHAPE_OPTIONS` in `attributes.js`) is a
functional sleeve-VOLUME taxonomy: every value states *where* a sleeve's volume sits, not what it's
called. `raglan` is deliberately dropped (armhole attachment construction, not a volume profile) — see
docs/garment-field-reference.md's "Sleeve taxonomy" writeup for the full mapping and the DB migration.
`pieceSleeveInterference(piece)` derives `{ shoulder, arm, lowerArm, armhole }` zones
(`'none'|'elevated'|null`) from the new enum, replacing the old `VOLUMINOUS_SLEEVE_SHAPES` boolean set.
`evaluateLayerPairConstruction()`/`evaluateLayerPairConstructionFor()` now resolve which garment in a
pair is outer vs inner via a `resolveLayerDirection()` helper shared with `evaluateLayerDirections`
(same PR #264/#265 evidence — outerwear category, explicit overlay/underlay notes, dependent-needs-
base), then flag a conflict only when the INNER garment has elevated volume at a zone where the OUTER
garment is known `fitted`/`straight` (zero capacity) at that same zone — a voluminous outer garment
over a fitted inner one is no longer flagged, closing the "the old rule couldn't tell top-under from
top-over" gap the previous entry's writeup already named as future work. Direction unresolved or
either shape unrecorded still returns `unknown` (sight required), never a guessed incompatibility,
except when both garments carry fully-known zero-volume geometry (compatible regardless of direction).
**Correction (2026-09-14):**
- **Not implemented.** An earlier version of this entry also listed a whole-garment-weight "fabric-bulk conflict" (both garments medium or heavy `fabric_weight`). Current code does not implement it: no sleeve verdict reads `fabric_weight`, and the `isBulkyFabric` flag the sleeve evidence reader computes is unused.
- **Not sleeve evidence.** Garment-level `fabric_weight` must not be treated as sleeve-specific evidence of thickness, bulk, structure or compressibility.
- **Nowhere to record it.** No sleeve-specific construction field exists (`docs/stage1-cause-matrix-2026-09-14.md` §10a). `layerConstructionPromptRule()` was
rewritten to describe the zone/direction mechanics; its three wiring points (visual composer,
`propose_outfit`, plan/capsule workbench) are unchanged. Migration and visual-backfill of existing
wardrobe data are a separate, deterministic-only DB pass (no AI calls in server-startup migration) —
see `scripts/sleeve-taxonomy-census.mjs` and `docs/garment-field-reference.md`.

**[no-silent-local-fallback policy, selected-piece flow, 2026-08-27] A composer timeout revealed that
"local fallback" and "user-facing recommendation" had never actually been kept separate for the
selected-piece flow — testing the sleeve fix above on real data (thread_1787803856242) surfaced a
shrug the model never evaluated, paired with a shirt, presented as a "Signature / strongest
direction" card.** Tracing it: the selected-item visual composer (`composeSelectedPieceVisualWardrobeOutfits`
in `routes/ai.js`) timed out at 90s (bumped to 120s the same pass, per the historical latency data —
one outlier in 20+ recorded calls, payload size normal, no evidence of a caused regression) and
returned zero outfits, and the code silently substituted `buildLocalFallbackOutfitDirections()`'s
category-fill picks — no photo judgment, no layering awareness, no `evaluateWearableOutfit` validation
of any kind — labeled identically to a real composition. A companion violation was found in
`composeStructuredOutfitsForPiece`'s closet-only branch (`styling-engine/core.js`, exported but not
reachable from the live `/generate-outfits-for-piece` route today, which only ever invokes this
function in ideal/ideal-only mode — fixed anyway as a dormant landmine, not left as a trap for a
future direct caller): mergeOutfitDirections() (deleted) blended real model outfits with local-fallback picks
up to `minCount: 4` with no visible distinction (an internal `isFallback` flag existed but was never
surfaced), and validated the merged set with `validateSelectedRecoveryOutfit()` — checked and
confirmed weaker than the canonical `evaluateWearableOutfit`: only `evaluateOutfitStructure` and
`evaluateRequiredBaseLayers`, no layer-direction or layer-construction check, so it would not have
caught this pairing either. `composeStructuredOutfitsForPiece`'s `idealMode` branch had the same
shape (`ensureIdealMissingCompletion(outfits.length ? outfits : localFallback, ...)`) and was fixed
too. The governing rule, applied uniformly: **local/deterministic logic may prepare, rank, filter,
validate, or recover candidate space, but it may not supply a user-facing outfit recommendation
unless a styling model actually selected/evaluated that outfit.** A composer that returns nothing now
sets `compositionSkipped: 'composer_failed'` (mirroring the existing `'incomplete_candidate_supply'`
early-return shape `composeSelectedPieceVisualWardrobeOutfits` already used for a different failure
mode) and a clear retry message, surfaced at both the top level and in `debug`; the outer shared
post-composer block in `generateOutfitsForPieceInternal` respects the same flag, so neither composer
path can reintroduce a substitute once one signals failure. The now-unused mergeOutfitDirections()
helper was deleted outright rather than left dormant, along with the "absolute basic backfill"
tier (a second, weaker local-fallback layer that fired when even the first fallback returned nothing).
`buildLocalFallbackOutfitDirections()` itself is kept, exported, currently uncalled — available if a
genuine internal recovery/retry mechanism needs it later, but its output must never reach
recommendation UI without model judgment again. Provenance was tightened alongside this:
`composedBy` used to default to `'model'` unconditionally; it now honestly distinguishes
`idealOnlyMode`'s outfits (`buildIdealOnlyCompletionsForPiece` — a deterministic, template-based
missing-piece/shopping-idea generator, a distinct feature from closet/mixed styling, never a model
call, left out of scope for this fix) as `'engine'`. Deliberately **not** touched: whole-wardrobe's
local backfill (`buildVisualLocalBackfill`/`buildDiagnosticLocalBackfill` in `routes/ai.js`), which
already gates fill-in candidates through `locallyGateWholeWardrobeOutfits()` and marks its diagnostic
tier `broken`/`diagnosticOnly` — the same "gate or mark broken, never silently present as real" shape
this fix establishes, just already in place there; and capsule roster selection's own deterministic
fallback (`paletteSafeDeterministic()`), which constructs candidate space (which pieces are eligible
for the capsule), not a final styled recommendation — explicitly out of scope by the same rule.
Regression coverage: `test/selected_piece_no_local_fallback.test.js` pins both fixed violations (empty
composer → explicit failure, not a substitute; partial model result → shown as-is, not padded) and
two same-file positive cases (a real composed outfit still reaches the user; the fix doesn't suppress
genuine model output).

**[follow-up, same day] `validateSelectedRecoveryOutfit()`'s weaker parallel contract — flagged above
but deliberately left untouched in the first pass — was resolved as its own reviewed change.** It
used to run only `evaluateOutfitStructure` and `evaluateRequiredBaseLayers` directly; now it is a
thin adapter around the canonical `evaluateWearableOutfit(pieces, { requireShoes: true,
includeLayerDirections: true })`, returning `{ valid: hardValid, primaryFinding }` — the shape
`recovery.js`'s `validatedFallback` already expected, so no caller-side changes were needed. This is
the one remaining place `composeStructuredOutfitsForPiece`'s closet-only branch validates real
model-composed outfits (`buildLocalFallbackOutfitDirections`'s own internal use of the same function
is unaffected in behavior terms — it's just now checked against the same canonical bar, though that
helper remains uncalled by any live path). The individual missing checks were deliberately not copied
in one at a time — the adapter projects through the canonical gate so a future check added to
`evaluateWearableOutfit` is inherited automatically rather than needing to be remembered here too.
`test/selected_piece_no_local_fallback.test.js` gained a fifth case: two model-composed candidates
sharing a voluminous-sleeve dress, one paired with a structured (zero-capacity) cardigan layer and one
with a roomy one — proving the sleeve-construction conflict is now rejected in this path exactly as it
already was in the visual composer path, not merely deprioritized.

**[image-generation grounding gap, 2026-08-27] `/editorial-render-one` (the "Generate image" button
on a selected-piece outfit card) rendered wrong pants/shoes details, and regenerating did not help —
thread_1787813410728 caught this on a real "style this piece using my existing wardrobe" direction.**
Root cause: `createEditorialConceptImage`/`editorialImagePrompt` were built for the genuine "ideal
missing piece" concept-board feature, where the non-anchor items are invented archetypes with no real
garment to preserve (`direction.missingPieces`, text only, by design). The same function is also used
to render a direction composed entirely of real, owned wardrobe pieces (pants, shoes) — for those,
nothing described the non-anchor garments at all: no reference photo, no structured fidelity text,
only `direction.reason`'s prose rationale. The model had nothing to ground the pants/shoes on and
invented them, and a re-render can't fix a prompt that never had the evidence — this is the same
failure mode the visual-grounding principle already names (composing/rendering from text alone
produces wrong results), just in the render step rather than composition. `wholeWardrobeImagePrompt`
(the correctly-built sibling used by `/generate-wardrobe-outfit-image` and the comparison sheet)
already solved this for its own callers with a per-piece fidelity checklist (category-level "don't
substitute" constraints) and a construction checklist (structured silhouette/length/sleeve/hem/tuck/
waistband/opacity facts) — both were factored out into shared `pieceFidelityChecklist(pieces)` /
`pieceConstructionChecklist(pieces)` helpers rather than reimplemented, so the two prompts can't drift
into different fidelity vocabularies. `createEditorialConceptImage` now resolves `direction.pieceIds`
to real DB rows (excluding the anchor) as `supportingPieces`, loads their reference photos via the
same `garmentReferenceImages()` every other multi-piece render path uses, and passes both the photos
and the two checklists through — `runGPT4oImageGeneration` gained a `supportingGarmentImages` param,
injected with "must also appear as shown" framing (one notch below the anchor's stricter "do not
redesign" language, since these are secondary to the anchor, not the premise). Genuinely invented
ideal-addition directions are unaffected: `supportingPieces` is empty whenever `direction.pieceIds`
resolves to nothing but the anchor, and `missingPieces` still reaches the prompt as prose exactly as
before. `test/editorialIdealAdditions.test.js` pins both: a real multi-piece direction produces the
supporting-garment fidelity/construction sections with the expected per-category constraints, and a
genuine ideal-addition direction (no owned pieceIds) produces neither section.

**[follow-up, same day] Garment photos were not the only evidence this renderer was dropping —
`styling_instructions` (how the pieces relate to each other: layering order, tuck/belt mechanics)
never reached it either, despite both selected-piece composer prompts already generating it and
documenting it as "the ONLY field the image renderer treats as authoritative for how pieces relate to
each other".** It survives `normalizeGeneratedOutfitObject` onto the outfit card — `editorialImagePrompt`
simply never read `direction.stylingInstructions`. Fixed the same way `wholeWardrobeImagePrompt`
already treats it: an "Authoritative styling instructions (how these garments relate to each other —
follow exactly)" line, ordered ahead of the non-authoritative `reason` prose. Also echoed on the
`/editorial-render-one` response body (alongside the existing `reason`/`watchFor`/`missingPieces`
fields) for consistency, though the prompt injection is the actual fix. `test/editorialIdealAdditions.test.js`
gained two more cases: a direction with `stylingInstructions` produces the authoritative line ordered
before `Stylist logic:`, and one without it produces neither.

**[projection-accuracy correction, 2026-08-26 same day] The first projection dropped a real evidence
branch and conflated relationship with direction.** It omitted `pieceRequiresBaseLayer` — the
role-aware `layer_top + primary_top` path treats a dependent `layer_top` (`needs_base: yes`) as
direction evidence on its own, resolving `layer_top_over_primary_top` with no overlay text required
(`evidence.source: 'dependent_layer_requires_base'`). It also claimed "two pieces merely appearing
together is not evidence of a layering relationship," which is wrong for a role-aware pairing — role
assignment already establishes the relationship; only the supported direction can be unknown. Fixed
to state both: role/category assignment can establish a pairing; construction/intent/dependency
evidence (including `needs_base` on either the added piece or the dress) decides direction.
`outfit_structure.test.js` pins the prose against the same `needs_base`-only fixture
`propose_outfit.test.js` uses for the executable verdict.

**[second projection-accuracy correction, 2026-08-26 same day] The fix above still over-claimed.**
It said role/category assignment never decides direction by itself — false for an
outerwear-category `layer_top`: `categoryGroup === 'outerwear'` alone resolves
`layer_top_over_primary_top` (`evidence.source: 'outerwear_category'`), no notes or dependency
required, unlike a `layer_top` role on an ordinary top (relationship only, direction still unknown
without other evidence). The projection now distinguishes the two explicitly, with the same
behavioral-fixture-plus-prose-check test pattern as the `needs_base` correction above.

**[verified duplication, 2026-08-26] `OUTFIT_EVALUATOR_GATE_SYSTEM` really could diverge from the
canonical register/footwear verdicts — traced, not assumed.** Call chain:
`composeStructuredOutfitsForPiece` (`core.js`) is reached only from the selected-piece ideal/missing-
piece branch of `generateOutfitsForPieceInternal`. Its supporting candidates come from
`selectAutomaticUseCandidatesForOutfitGeneration` → `evaluateAutomaticUsePiecePool`, so they already
passed `registerCeilingVerdict`/`footwearComfortVerdict` before the composer ever sees them — the
evaluator's prose could never actually disagree with the canonical verdict for those. The selected
anchor is different: it bypasses automatic-use eligibility by ratified 2026-08-25 design (the whole
point of an anchor), so it never runs those checks anywhere upstream, and every audited outfit must
include it (`evaluateOutfitRoles`'s sibling audit criterion "includes the selected garment"). The
evaluator's free prose ("clearly exceeds", "stilettos, delicate sandals, high heels") was therefore
the only place register/footwear suitability was ever decided for the anchor, using vaguer criteria
than the mechanical functions (no `walk_support` dimension at all, keyword shoe-name matching instead
of `heel_height`). Fixed by computing the anchor's own verdicts server-side
(`anchorRegisterFootwearComputedChecks()`, `core.js`) and citing the result; the evaluator no longer
re-derives either semantic and is told not to flag register/footwear absent a computed line, since
every other candidate is already guaranteed compliant. `EDITORIAL_NEW_PIECES_SYSTEM`'s near-identical
doctrine was traced separately and left alone: it reasons about conceptual, not-yet-tagged pieces
with no fields to compute a verdict from, so there is no canonical owner it could cite — legitimate
overlap, not duplication.

**[owner-ratified shared-composer scope, 2026-08-19] Wear mechanics and renderer instructions are
global; comparison pressure is not universal.** Evidence labels, the explicit
`styling_instructions` renderer contract, and prose integrity apply wherever
`generateWholeWardrobeOutfitsVisualInternal` is used. Multi-option freeform, direct Visual Composer,
and adjacent saved-outfit exploration receive comparison guidance. Formula-similar saved-outfit
variants pass `comparisonSetGuidance:false`, because manufacturing a new formula would violate that
flow's purpose.

**[weather-judgment clarification, 2026-08-19] A daily range is interpreted at the requested time.**
The shared composer is told to style evening/early-morning requests toward the relevant cooler end
of a numeric forecast and include a removable transition layer when the wardrobe supports one.
Indoor context governs the base but not arrival/departure. This is model guidance inside the mild
band, not a new score, cap, filter, or cold threshold. It follows `thread_1787101448245`, whose
70°F/55°F indoor-dinner first card had no layer.

**[weather-adequacy correction, 2026-08-19] A named layer must actually cover the cooler transit.**
After `thread_1787103270104` called a sleeveless vest over a light top sufficient at 55°F, the
shared composer contract was made falsifiable: at roughly that temperature it must choose
sleeve-bearing outerwear, combine an actually warm long-sleeved base with an adequate layer, or
state the wardrobe gap. This remains model judgment rather than a new deterministic cold gate.

**[card-consistency correction, 2026-08-19] Silhouette nouns must match the garments shown.**
`sanitizeWholeWardrobeOutfitProse` compares model
silhouette language with structured `bottom_kind`; if it calls a skirt trousers (or pants a skirt),
only the false silhouette field is withheld while a correct reason remains. A phrase such as
“boxy top over structured wide-leg trouser” already communicates the garment relationship to the
owner, but the image generator treats `stylingInstructions` as its authoritative mechanics field.
The composer contract therefore requires the model to state that relationship explicitly in
`styling_instructions` as well. **[owner correction, 2026-08-19]** Application code does not infer
renderer instructions from silhouette prose: `normalizeWholeWardrobeOutfitObject` transports only
the model's explicit field. Silhouette validation remains an independent card-integrity check and
does not rewrite explicit renderer instructions. This follows `thread_1787100432612`.

**[flagged experiment, 2026-08-18] Bounded adaptive visual detail.** With
bounded freeform uses the existing
`pieceVisualDetailPolicy`: complex/expressive/textured garments at 800px and plain garments at
448px, rather than forcing every image to 768px. No roster item or photograph is removed. The
corrected Larkspur roster measured 40/40 and 28.7% fewer aggregate pixels. Other visual-composer
flows and flag-off behavior retain 768px. On corrected live thread `thread_1787097967248`, this
reduced cache creation from 43,682 to 32,398 tokens while returning two valid cards; the total turn
estimated to ~$0.146, about 55% below the original ~$0.324 baseline.

## What a search result carries — judgment, not a re-description

**Added 2026-08-17.** [search-payload-spec.md](search-payload-spec.md).

**[by design] The wardrobe manifest is the one home for stable garment truth.** It sits in the
cached stable prefix and is paid for once per turn. `search_wardrobe` used to re-transmit most of the
same facts per call: one tops search measured **~13,764 tokens against the entire 251-piece
manifest's ~12,506** — and unlike the manifest it was written to cache at 1.25× input every time,
then re-read by every later iteration.

**[by design] A search result now returns only what cannot be cached** — which pieces passed, and how
they were judged for *this* occasion/activity/weather (`ruleFit`, `ruleFitLabel`, `weatherFit`), plus
`id`/`name`/`category` as the join key, `notes` (the one free-text field the manifest lacks), and the
thumbnail. Measured on `thread_1786954464459`'s three searches: **25,747 → 9,613 tokens, −63%**,
roster identity unchanged.

**[by design] Trimming is conditional on the manifest actually being in the prompt.** Above
`WARDROBE_MANIFEST_MAX_PIECES` (400) the manifest is omitted, and a trimmed row would then be the
model's only view of a garment; `wardrobeManifestIncluded` carries that fact from the payload builder
to the tool. Pinned by a test.

**[flagged experiment, owner-ratified 2026-08-19] Identity omniscience may replace full-truth
omniscience.** With `WARDROBE_FREEFORM_TIERED_DISCOVERY=true`, every active ID, exact name, category
and brief visual read remains in a deterministic discovery index, while construction/fit/suitability
truth is retrieved only when needed. This is not a shortlist and recently-shown memory cannot remove
an identity. `wardrobeManifestIncluded` is deliberately false and
`wardrobeDiscoveryIndexIncluded` true, so `search_wardrobe` returns full stable truth rather than the
trimmed judgment row. Broad category counts come directly from exact index headings; qualified
counts expand through `wardrobe_coverage`; known-piece questions through view/details; composition
and sparse uncertainty through database search. See
[freeform-tiered-discovery-spec.md](freeform-tiered-discovery-spec.md).

**[owner amendment 2026-08-19] Direct tuckability answers use an evidence hierarchy.** Automatic
composition continues to obey the saved `tuck_behavior` conservatively. In conversation, a
manual/high-confidence tag is strong evidence, not an unchallengeable fact; missing/low tags permit
inference from the full construction evidence, and a visible contradiction may be explained. A hem
shape alone cannot decide. `view_pieces`, untrimmed search rows and compact garment facts now expose
the field (plus confidence in compact facts), closing the omission found in
`thread_1787116925244`.

**[owner amendment 2026-08-19] Resolved garment mechanics may use bounded saved sight.** Tags can
be absent or mistagged while the wardrobe already contains direct evidence. For compact
`garment_fact` turns, `compactGarmentVisualEvidence` supplies only the resolved subjects' worn then
hanger photographs, capped at four 640px low-detail images. Clearly visible worn behavior outranks
a weak/missing tag for feasibility only. The shown result is judged separately; possibility does
not imply preference, and an unseen alternative cannot be ranked. It does not change the conservative metadata authority used by automatic
composition. The call records `compactVisualImages` and never loads a wardrobe-wide visual roster.

**[rollout contract 2026-08-19] Routing coverage is a tracked corpus.**
`test/fixtures/freeform_execution_routing_corpus.json` exercises every execution profile and the
full-stylist fallback classes through `routeFreeformExecutionProfile`. The provider is hermetically
mocked, so this proves schema/context wiring rather than live semantic accuracy; default-on still
requires the bounded live matrix in `docs/freeform-measured-rollout.md`.

**[live correction 2026-08-19] Compact education cannot turn signals into dress-code gates.**
`compactFreeformAnswerSystem` requires multiple valid pathways and labels structure, fabric, finish,
cohesion, accessories and footwear as optional whole-outfit signals. It distinguishes tendencies
from requirements and cannot characterize casual dress as careless/shapeless errand wear or use
status-loaded accessory contrasts. This corrects `thread_1787119133701` without changing routing.

**[live correction 2026-08-19] Saved sight is a routable capability, not fiber truth.** For resolved
garment subjects, `/ask` tells `routeFreeformExecutionProfile` only how many have saved photos. This
allows a visibly shown wear-mechanics judgment to use bounded `garment_fact`; names and image data
remain outside the router. `compactFreeformAnswerSystem` and the `view_pieces` tool contract both
limit photographs to visible drape, bulk, texture and behavior. They cannot establish exact fiber
composition, and a feasible shown configuration is not automatically a successful styling choice.

**The invariant that keeps this safe:** no field may be absent from *both* surfaces. A field in
neither is invisible to the model, and the failure is silent — worse composition, no error.
`test/wardrobeAiContext.test.js` asserts the union covers every stable field for a fully-populated
piece, and fails loudly if either side drops one.

**Live-verified 2026-08-17** (`thread_1786954464459` → `thread_1786994644421`, identical prompt):
cache creation 71,611 → 58,723, cost **$0.380 → $0.325 (−14.6%)**, iterations unchanged at 6, and the
model still names the right trail shoe unprompted from `walk_support` now that it arrives via the
manifest. **Note the multiplier this exposed:** anything added to the cached prefix is re-read on
every iteration, so the manifest's +3,557 tokens cost ~21,300 reads across six of them and ate a
third of the saving. Prefix size × iteration count is the real term.

**Two incidental fixes.** The manifest printed the tagger's literal `'none'` for inapplicable fields
(`silhouette none` on every shoe), and it showed `reads_as` **or** the colour list but never both, so
most pieces had no palette in the manifest at all. Both corrected; the manifest grew 12,506 → 16,063
tokens, a cache read costing ~$0.001 per iteration against ~16,100 tokens removed from cache writes.

## Activity — how it is resolved, and what it can do to a roster

**Added 2026-08-17.** [activity-and-roster-spec.md](activity-and-roster-spec.md).

**[by design] The declared activity is no longer final; request text may escalate it — one way.**
`resolveActivityProfile` used to return immediately on a supplied activity, so a model that declared
`walking` for a nature walk could not be corrected, even though its own reply discussed the trail.
Text may now lift `none`/`walking` → `hiking` and may **never** lower `hiking` → `walking`; an
explicit denial ("no hiking", "just a stroll") blocks escalation. The asymmetry is deliberate:
treating a city walk as a hike costs comfortable shoes nobody needed, treating a hike as a city walk
costs grip on a trail. `mood` is NOT scanned — it is the vibe axis, and a test pins that.

**[by design] A nature walk is a hike — and that ruling changed CLASSIFICATION only.** Owner ruling
2026-08-17: *"not climbing a mountain, but a hike."* One profile rather than a third enum value,
since another value would add exactly the classification choice the bug came from. **The hiking
profile's own rules are unchanged**: a revision that relaxed `excluded_walk_support` to `['low']`
shipped and was reverted the same day on the owner's correction — *"walk_support: medium is correct
and makes it eligible for outdoor social or museum with lots of walking, NOT a hike"*, and *"nothing
should have changed for the definition of hiking."* Verified by re-running the composer against the
recorded `suppressedReasonCounts` of `thread_1786908644157`: 150 suppressed, all seventeen counts
matching.

**[latent inconsistency] Hiking's footwear name-lists are unreachable.** `discouraged_footwear`
(sandals, mules) and `prohibited_footwear` (heels, wedges, flip-flops) sit behind
`if (isShoe && !activityProfile)` — skipped precisely when an activity IS set. Nothing depends on it
today because `excluded_walk_support: ['low','medium']` catches those shoes anyway. It bites only if
that floor is ever relaxed: measured on an instance with no owner constraints, relaxing it alone
scored strap sandals `neutral` for a hike. See activity-and-roster-spec.md §5.3a.

**[by design] Activity can now promote, not only remove.** `search_wardrobe` returns `walk_support`
and `heel_height` — the gate read them to exclude and showed them to nobody, so the model inferred
grip from garment names. Within a tier, shoes now order by support when an activity is set; nine
shoes used to tie at `preferred` in id order, ballet flats indistinguishable from trail sneakers.
Ordering never removes.

**[by design] The tag discouragement is the LAST check in `profileRuleFit`, after every hard gate.**
A soft signal must never pre-empt a hard one. An earlier revision returned from it before the
register ceiling, and measuring the composer against the recorded live run `thread_1786908644157`
showed elevated/dressy pieces losing their suppression for a casual hike — 45 register exclusions
collapsing to 8, admitting 20 pieces that should not have been in the roster. Caught only because
that run's `suppressedReasonCounts` was on record to compare against; the freeform tests were green
throughout. Pinned by a test that passes a `registerCeiling` explicitly.

**[by design] `required_occasion_tags` reaches the freeform path as a DISCOURAGEMENT.** Enforced only
in the composer before, so a correct hike gated the shoes and left city-only tops untouched. It is
deliberately not a hard gate: that would contradict the 2026-06-12 ratification keeping a day dress
allowed for outdoor-active, and would make the roster depend on how well one user tagged their
wardrobe. Untagged garments still appear, ranked below tagged ones and labelled.

**[by design] Owner constraints reach the roster, not only the proposal.** `search_wardrobe`'s
occasion filter passed `occasion` alone, so an `owner_constraints` row scoped to activity, season or
weather could never apply to what the model composes from. It now receives all four — but rejects at
that stage **only** for the owner's own standing decisions. Letting the full profile gate reject
there would move exclusions ahead of the pass that counts, labels and re-exposes them under
`intent:'explain'`, and a piece would vanish with no number and no way to ask why.

## A card must describe the card — the consistency clause

**Added 2026-08-16.** [card-consistency-spec.md](card-consistency-spec.md) Part 1. The turn
contract's clauses ask whether a card's pieces are real (*truth*), whether context is settled
(*context*), and whether cards arrived (*delivery*). None asks whether the card's **own words
describe the card**, so an internally inconsistent card passed every one of them.

**[by design] A top worn with a dress is legal and is never removed.** Owner ruling 2026-08-16: a
styling decision, not a hard ban. `evaluateOutfitStructure` preserves that ruling — with a dress
present it still rejects only a bottom, a second dress, or a second pair of shoes.

**[by design] What is enforced is that the card accounts for it.** `outfitLayersTopWithDress` is a
category-group fact; `unexplainedLayeredTops` then checks whether the card's own prose names the
top. Deliberately weak — a substring match against a name already known to be in the card, in the
spirit of `findZeroResultContradiction`: checking a known fact, not fact-checking prose. It cannot
judge whether an explanation is *good*; that is taste, and taste stays with the model.

A word shared with another garment in the same outfit does not count as naming the piece. "black
blouson v-neck top" beside "black brown lace floral midi dress" share *black*, so prose about the
dress would otherwise read as prose about the top — the exact false negative of the live case.

**[by design] Freeform retries once; the card ships either way.** `cardProseInconsistent` is a
fourth turn-contract clause in the truth family, using the existing per-`blockType` retry budget,
counted as `card_prose_inconsistent_blocks`. If the retry produces no explanation the top is
**kept** and the card carries a visible flag. It is never silently dropped: capsule ships
`model_repaired_with_gaps` with the gap stated, advisor mode exists so code does not censor composer
output, and Decision B (2026-06-25) ruled against filtering results down.

**[by design] The archetype no longer asserts a shape it did not check.** Because every dress outfit
is forced into `dress_grounded_sharp`, its "one-piece column" silhouette was being stamped onto
outfits carrying extra tops; that text is now replaced with what the pieces actually are. The
remaining half — giving the dress family more than one archetype so the label discriminates and the
`avoidRoles` penalty can bite — is styling content and **needs owner sign-off** (spec §5.2).

## Who writes the words on a card — the model, or the archetype template

**Amended 2026-08-16.** Two producers can author a card's `label`, `dominantDirection`,
`silhouette`, `reason` and `watchFor`: the composing model, or the archetype template
(`rewriteWholeWardrobeOutfitWithArchetype` → `buildOutfitMechanicsReason`).

**[by design] The model's own notes are preferred, and the template is the fallback.** The
whole-wardrobe and capsule paths get this for free: advisor mode sets `shouldRepair = !advisorMode`,
so repair never runs and the model's text is untouched. That is why those cards read in the model's
voice, keep its creative labels, and close with its `*Skipped directions:*` and
`**Saveable learning:**` lines.

**[bug, fixed 2026-08-16] The selected-piece path threw that away.** `routes/ai.js` repairs
unconditionally, and `repairWholeWardrobeOutfit`'s **first** step called the archetype rewriter,
which overwrote `reason` and `label` unconditionally — before the guard 100 lines below it
(`hasWholeWardrobePlaceholder || hasGenericWholeWardrobeText || !reason`) that exists to preserve
authored text could ever apply. That guard was dead code on this path, so the template was the
default rather than the fallback. Two visible consequences:

- Distinct model outfits collapsed into one name. A live response returned two different cards
  both labelled *"Grounded Dress Edit: standard wear"*.
- The prose omitted a garment the card contained. `buildOutfitMechanicsReason` had no branch for a
  top alongside a dress, so a card pairing a blouse with a lace midi dress described only the dress
  and the layer — the person was told to wear a piece the explanation never mentioned.

`rewriteWholeWardrobeOutfitWithArchetype` now takes `preserveAuthoredText`. The entry call passes
it (nothing has changed yet, so the model's words still describe this outfit); the call **after a
footwear substitution** deliberately does not, because the model's sentences then describe an
outfit that no longer exists. The template also names a top when a dress is present.

**[by design] Any outfit containing a dress is labelled `dress_grounded_sharp` ("Grounded Dress
Edit").** `inferOutfitArchetype` skips every other archetype when a dress is present, so this is
the only label a dress outfit can receive — it is not selected on fit. Its `avoidRoles:
['extra_pattern']` scores −12 but cannot disqualify, since no competing archetype survives. Worth
knowing before reading such a label as a judgment about the outfit. **[owner check wanted]**

## Candidate generation with a Main piece — the structural fallback

**Amended 2026-08-16.** `buildWholeWardrobeCandidateOutfits` (`rules.js`) composes candidates per
Outfit Mission. When the caller pins a Main piece (`requiredPieceId` / `mainPieceId` — saved-outfit
"Similar variants" does, via `routes/ai.js`), every candidate must contain it, and a mission that
does not qualify for the resulting combination yields nothing.

**[by design] A Main piece that no mission can place falls back to structural candidates.**
`addStructuralCandidate` skips mission qualification and the `-18` score floor, so the person still
gets outfits built around the garment they picked.

**[bug, fixed 2026-08-16] That fallback used to run only for an add-on Main.** It was gated on
`requiredIsAddOn` (outerwear/accessory). A top, bottom or dress Main in the same situation produced
**zero candidates** — the missions rejected every combination and nothing caught it. Live shape: a
saved two-top outfit asking for Similar variants returned nothing, and its layer-capable top could
not keep its base top. The gate is now `requiredPieceId && !hasRequiredCandidate()`, with the same
role guards the mission path uses (no dress appended onto a complete top+bottom+shoes look), and a
layer-capable top Main tries the two-top formula before falling back to a single-top look.

**[by design] The Main piece is appended only when a slot has not already supplied it.**
For an add-on the slot lists never contain it; for a top/bottom/dress Main the slot list *is*
`[requiredPiece]`, and appending unconditionally put the same garment in the outfit twice.
`withRequiredPiece` is that check. Covered by a no-repeated-piece assertion in
`test/aiEndpointContracts.test.js`.

**Measured effect on the live wardrobe (30 scenarios: 5 occasions × {no Main, 5 Main pieces}):**
28 identical, including **every** no-Main scenario — the default whole-wardrobe path is untouched.
Two changed, both with a Main whose `color_anchor` mission previously starved: `casual` gained one
candidate and removed none; `outdoor` stayed at its cap of 60, gaining the intended `color_anchor`
candidate and displacing two lower-ranked tail entries (adding to a capped list evicts the tail,
and the cross-mission `seenKeys` dedupe then admits a combination it had previously suppressed).

## After the gate — the outfit-level pass

`locallyGateWholeWardrobeOutfits` (`rules.js`) is where assembled outfits are repaired,
rejected, deduped and diversified. It has **two modes, and the mode changes the meaning of every
check in it.**

### `mode: 'gate'` rejects; `mode: 'advisor'` annotates

Seven checks run per outfit — body-shape/flattery language, missed mood, excess volume, soft-neutral
drift, a profile-prohibited piece, an untagged (`unknown`) piece, and a profile-discouraged piece.
In `gate` mode each one **drops the outfit**. In `advisor` mode each one instead attaches a
`systemFlag` and the outfit survives:

| check | gate mode | advisor mode |
|---|---|---|
| flattery language | rejected | sentence scrubbed, flagged *"Removed body-shape framing…"* |
| misses boho mood | rejected | flagged *"May miss the requested mood"* |
| ≥3 volume words | rejected | flagged *"Reads volume-heavy"* |
| ≥5 soft words, no grounding | rejected | flagged *"Soft neutral read"* |
| profile-prohibited piece | rejected | flagged with the profile reason |
| `unknown` (untagged) piece | rejected | flagged *"Not yet tagged for this gate"* |
| profile-discouraged piece | rejected | flagged |

This is the "hard gate vs LLM judgment" split made concrete: advisor mode trusts the model's
composition and reports concerns; gate mode enforces. **[by design]** — and the reason a check
"not firing" in one flow is not evidence it is absent.

**[amended 2026-09-16 — thread_1789526496845, two bugs in the flattery-language check]** A card's
watchFor read *"Mixing olive and emerald requires confidence in saturated earth tones"* — a
color-boldness remark, not body-shape framing — and the check fired anyway, purely on the bare word
"confidence": unlike `flattering`/`elongating`/`slimming`/`draws attention upward`/`balance the
body`, "confidence" carries no inherent body reference and is common, legitimate styling prose
("this print requires confidence to pull off"). Dropped from the trigger word list rather than
special-cased. Separately: the trigger scans label+direction+silhouette+reason+watchFor+piece names,
but the scrub (`scrubBodyShapeFraming`) only ever rewrote `reason` — so a match landing in `watchFor`
alone (as here) left the flag claiming *"Removed body-shape framing from the explanation"* when
nothing had been removed from anywhere. Fixed to scrub every prose field the card actually ships
(`reason` and `watchFor`) and attach the flag only when a sentence was genuinely dropped from one of
them. `rules.js`'s `BODY_SHAPE_FRAMING_PATTERN` (was inlined at two call sites, now one constant).

Four checks are **unconditional in both modes** and always reject: structurally invalid, contains a
non-owned piece, user-excluded for the occasion, duplicate formula.

### Repair — what it actually does

`repairWholeWardrobeOutfit` (`rules.js`) does **not** fill missing slots. Traced end to end,
it does two things, and only one of them touches a garment:

1. **It rewrites the outfit's prose.** `label`, `dominantDirection`, `silhouette`, `reason` and
   `watchFor` are regenerated from the inferred archetype, but only where the existing text is a
   placeholder (`hasWholeWardrobePlaceholder`), generic boilerplate (`hasGenericWholeWardrobeText`),
   empty, or — for `silhouette` — identical to `dominantDirection`. Under a
   `modern_bohemian_restraint` mood with a boho signal ≥ 2 it rewrites label, direction, reason and
   watchFor unconditionally.
2. **It substitutes exactly one shoe**, and only when the resolved occasion or activity profile
   declares `required_footwear` and the current shoe does not match it. The replacement is chosen
   from gate-passing shoes by a small local relevance score (occasion score, ±10 preferred /
   discouraged footwear, −8 discouraged material, ties broken by id). If no qualifying shoe exists
   it appends *"footwear is not trail-rated — closest available match"* to `watchFor` and changes
   nothing.

**That shoe swap can only ever fire under the `hiking` activity profile.** It is the only profile
in the codebase with a populated `required_footwear` — `walking` declares `[]` and no occasion
profile declares the key at all. So outside hiking, repair is a **prose pass**: it cannot add a
missing bottom, cannot swap a top, cannot complete an incomplete outfit.

This reframes the mode split. Repair runs when `repair !== undefined ? repair : !advisorMode` —
on by default except in advisor mode, where a caller may force it on. The source comment justifies
the skip on the grounds that a mechanical slot-fill would "reinvent" a model's composition; what is
actually being protected in the overwhelming majority of cases is **the model's own prose**, since
that is what repair overwrites. The standing owner ruling (do not re-propose repair for
LLM-composed advisor-mode outfits) is unaffected and still correct — the reasoning behind it is
just narrower than it reads.

**[by design] Pieces are rehydrated before any gate runs** (spec 29 Part 1).
`normalizeWholeWardrobeOutfitObject` trims outfit pieces to `{id, name, category, photo,
worn_photo}` upstream, so every structured check would otherwise read `undefined` and silently
degrade to name-text matching. The rehydration against `candidatePieces` is a local variable only;
the response shape is untouched.

### Diversity — the largest penalties in the system

`applyWholeWardrobeDiversity` picks the final set greedily, scoring each candidate against what is
already selected with `wholeWardrobeDiversitySelectionScore` (`rules.js`). The repeat
penalties, per prior outfit sharing the trait:

| repeated trait | penalty each |
|---|---|
| same formula family | **−45** |
| same top | **−40** |
| same silhouette family | −35 |
| same bottom / same shoes | −20 each |
| print or stripe already used | −20 |
| same grounding strategy | −18 |
| same visual rhythm | −16 |
| same shoe shape | −14 |
| `compact_top_dark_column` repeated | −25 extra |

These dwarf every composition score in the system — a −45 formula repeat is larger than the whole
usable range of `capsuleVersatilityScore`. **That is the point**: after the first outfit, novelty
outranks quality, which is why a strong second look can lose to a weaker but more different one.
It also explains the reused-shoe complaint recorded in the handoff — shoes carry only −20, the
weakest of the three core slots, so the selector will repeat a shoe long before it repeats a top.

A mood profile can override all of it: under `modern_bohemian_restraint`, an outfit whose boho
signal is below 2 takes **−45**, which alone cancels a formula repeat.

### The classifiers those penalties key on — measured

A penalty is only as meaningful as the bucket it compares. Measured over 600 structurally-valid
top+bottom+shoe outfits built from the 123 pieces that pass the `casual` gate
(`scratch/measure_diversity_classifiers.js`):

| classifier | penalty | distinct buckets | largest bucket |
|---|---|---|---|
| formula family | −45 | **4** | 42% |
| silhouette | −35 | 4 | 42% |
| grounding strategy | −18 | 3 | 47% |
| visual rhythm | −16 | 3 | 52% |
| shoe shape | −14 | **2** | **93%** |
| print/stripe present | −20 | 2 | 66% |

**Four is the entire formula-family vocabulary, not a sampling artifact.** Formula family comes
from `WHOLE_WARDROBE_OUTFIT_ARCHETYPES` (`prompts.js`), which defines five families, one of
which (`dress_grounding_shoe`) requires a dress. Every separates outfit in the wardrobe therefore
falls into one of exactly four buckets, and two of them hold 82%.

**The consequence is arithmetic: a five-outfit set cannot avoid a formula repeat.** Five outfits
into four buckets is a guaranteed collision by pigeonhole, and in practice it happens by the third
outfit, because the top two buckets hold 82% of candidates. So the −45 — the largest single number
in the engine — is not an occasional tie-breaker; it fires on most sets. Every look after the
second is effectively selected on *which* repeat is cheapest, not on whether to repeat.

**Shoe shape is nearly a constant.** 93% of sampled outfits classify as `rounded`, the default
branch; `pointed`, `almond/oval` and `square` never appeared. Its −14 is close to a fixed offset,
in the same way `role_permission`'s +20 is in the workbench score.

This also explains the reused-shoe complaint in the handoff from a second direction: shoes carry
the weakest core-slot penalty (−20 against a top's −40) *and* the classifier that would otherwise
distinguish two shoes is effectively single-valued.

### The classifiers cannot see a third of the pattern data

`wholeWardrobeVisualRhythm`, `wholeWardrobeHasPrintOrStripe`, `wholeWardrobeFormulaType` and
`wholeWardrobeHeroPieceId` all test a regex —
`floral|print|graphic|stripe|striped|pattern|abstract|tapestry` — against `pieceNameBlob`, which is
`name + category + reads_as` (`rules.js`). They never read the structured `pattern_type`
column, which is populated.

Measured: **90 pieces have a non-solid `pattern_type`; 30 of them are invisible** to these
classifiers because their pattern word is not in the regex. The misses are systematic, not
marginal — `botanical`, `geometric`, `paisley`, `polka dot`, `lace` are all real `pattern_type`
values with no corresponding term:

> `paisley sleeveless blouse` (abstract) · `black cream botanical tiered midi skirt` (botanical) ·
> `black cream geometric maxi skirt` (geometric) · `white yellow polka dot cardigan` (geometric) ·
> `beige lace relaxed top` (other)

So a third of the patterned wardrobe reads as solid to the rhythm classifier and to the −20
print-repeat penalty. Two visibly patterned skirts can be selected back to back without either
penalty firing. One piece runs the other way: a single solid-tagged piece reads as patterned
because of a word in its name.

This is one of the grandfathered keyword sites the text-matching ratchet caps. Reading
`pattern_type` instead would make the classifier correct *and* lower the ratchet count — the
sanctioned direction of travel, not an exception to it.

Recency also lands here, clamped: `−min(piecePenalty, 40) − min(formulaPenalty, 35)` on
`localScore`, from the same 10-row session memory described above.

**Ranking differs by mode too:** `gate` mode sorts by stylistic strength before diversity; advisor
mode preserves the model's own order. Then `normalizeWholeWardrobeStrengths` labels positionally —
index 0 is `signature`, 1–2 `strong`, the rest `usable`. **Those labels are positions, not
judgements**, which is worth knowing before reading "signature" as an engine verdict.

**[expanded 2026-08-18] Multi-option comparison quality stays model-judged.** The visual composer
receives a volatile-tail contract asking for different formulas or silhouettes when the eligible
roster supports them; repeated activity-safe shoes remain legal. The advisor path intentionally
keeps `applyDiversity:false`, so the deterministic diversity selector does not replace a visually
judged card. `finalSelection.uniqueFormulaCount`, `uniqueSilhouetteCount`, and
`comparisonSetCollapsed` make a same-formula + same-silhouette result measurable for live review.
The collapsed flag describes the set; it neither rejects a card nor triggers another paid call.

**[expanded 2026-08-18] Live weather has two layers of authority.** `isHot`/`isCold` remain the
stable physical-gate contract. `highF`/`lowF` now travel alongside those booleans so the visual
stylist can judge sleeves, optional layers, and lived comfort inside the broad mild band. Bounded
freeform composition includes the numeric range in its volatile request tail and its deterministic
introduction; no additional provider call is made.

---

## The image-generation path

Mapped 2026-07-26. The app's most expensive operation. Traced by reading; the input payloads are
measured by `scratch/measure_image_path.js`, which runs the real reference builders (sharp only) and
**never constructs an OpenAI client**, so it costs nothing.

### One switch decides whether any of this is billed

`photoPreservingVisualsEnabled()` (`core.js`) returns true when `PHOTO_PRESERVING_VISUALS` is
set **or** `WARDROBE_MOCK_AI` is on. When true, every producer renders a **local sharp collage** of
real garment photos instead of calling a model. `hasOpenAiKey()` failing does the same. So there are
two renderer families, and the free one is the default in the sandbox.

**[known bug — dead duplicate, unfiled]** There are **two** functions with this name.
`rules.js` is a copy that checks only `PHOTO_PRESERVING_VISUALS` and **not** `mockAiEnabled()`.
`routes/ai.js` imports *that* one (its import block spans lines 52–116, from `rules.js`) — and never
calls it; the symbol appears exactly once in the file. So this is a latent trap, not a live leak:
the mock-mode protection is intact today because every live call site uses the `core.js` version.
But `routes/ai.js` is precisely where the image endpoints live, and the mock-unaware copy is already
imported and in scope there. Deleting the `rules.js` duplicate would remove the hazard outright.

### The producers

| function | renders | AI inputs |
|---|---|---|
| `createWholeWardrobeOutfitImage` | one outfit | ≤5 garments, with worn + hanger refs when both exist, + 2 calibration refs + prompt |
| `createSavedOutfitImage` | saved-outfit variants | source photo + worn + hanger refs when both exist |
| `createWholeWardrobeComparisonSheetImage` | up to 5 outfits on one sheet | one ref per unique piece across the 5, preferring worn evidence to cap cost |
| `createIdealAdditionsComparisonSheetImage` | directions sheet | worn + hanger refs for the selected garment when both exist |
| `createEditorialConceptImage` | ideal-addition concept | refs + anchor garment |
| `createOutfitBoardImage` | 2-3 candidate boards from the ad hoc "Generate visual boards" button (`POST /generate-outfit-boards`) | selected piece + owned/missing board pieces | **found 2026-07-27 — missing from this table since it was first written**; see `scratch/derive_board_producer_fanout.js`. |

All five call `client.responses.create` with **`model: 'gpt-4o'`** and
`tools: [{ type: 'image_generation', size, quality: 'medium' }]`. Quality is hard-coded. Size
resolves to **1024x1536** by default (`OPENAI_EDITORIAL_IMAGE_SIZE` / `OPENAI_IMAGE_SIZE` override).

`getOpenAIImageModel` / `getOpenAIImageFallbackModels` exist and explicitly reject `dall-e-2/3`,
but the five main paths never consult them — they hard-code `gpt-4o`. The chain resolves to
**gpt-image-1 → gpt-image-1.5 → gpt-image-1-mini → chatgpt-image-latest** and is reachable only
through `runOpenAIImageGeneration`, which has exactly one live caller: the editorial path's fallback.

### What actually gets sent — measured

Garment references are resized to 768px, JPEG q84, base64'd. Final single-outfit renders now send
both a worn and hanger photo when both exist: the worn image is labelled as authority for fit,
drape, body placement and real hem position; the hanger image is authority for construction,
colour, print scale, texture and garment shape. With no worn photo, the hanger caption explicitly
marks body fit and drape unconfirmed and tells the renderer to infer them conservatively from
structured garment data. Comparison sheets remain capped at one reference per garment, preferring
the worn photo, because they may contain 18 unique garments.

This improves the renderer's evidence but does not replace the wrong-length metadata-review path.
Some image complaints have correctly exposed mislabeled `length_hits_at` or `sleeve_type` values;
the field-specific task remains the way to correct those facts. Better photo delivery and metadata
review address different causes of the same visible symptom.

Across a 24-piece spread of the real
wardrobe (235 of 236 pieces have a usable photo): **min 50 KB, median 88 KB, max 152 KB, mean
95 KB** per photo. A five-garment final outfit can now send up to ten garment photos rather than
five, plus two calibration images and the prompt. This deliberately spends more input budget on
the final render; the many-garment comparison preview does not double its photo count.

At OpenAI's ~750 tokens for a 768px image, a three-garment final outfit with both photos for every
piece plus two calibration images is roughly **6,000 input tokens of imagery alone**, before prompt
text. The generated image is billed separately and dominates. Garments with only one photo retain
the prior cost shape.

Calibration references come from `getCalibrationReferenceImagesForGeneration`, which pulls a pool of
`max(limit × 4, 15)` rows, splits starred from unstarred, shuffles each, and takes starred first.
The real pool is **28 eligible rows — 13 `good_reference`, 15 `real_photo` — of which 15 are
starred.** Note this is the one `favorite` column in the database that *is* populated; the piece and
saved-board ones are not (see *Scoring → dead terms*). `real_photo` rows are captioned as identity
and proportion reference, `good_reference` as taste calibration.

### The fallback ladder

Editorial is the deepest: **gpt-4o → the four-model image chain → a hand-built SVG placeholder.** A
single failing editorial render can therefore attempt up to five billed generations before giving
up. The other four producers have a shallower ladder — gpt-4o, then straight to a local collage
tagged `fallback_collage`, which is free.

### Cost reporting — and where it is wrong

Cost is **not** computed by the server. `estimateAiUsageCost` (`provider.js`) prices text
tokens only, and its OpenAI table (`provider.js`) has entries for `gpt-5.x` and `gpt-4o` and
**no image model at all** — so it would return `pricingAvailable: false` for one.

Instead the number the user sees is computed **client-side** in
`StylistChat.jsx`, `calculateOpenAICost`, which re-hard-codes the rates ($2.50/Mtok in,
$10/Mtok out) and adds a **flat constant for the image**: `$0.08` for 1024x1536, `$0.04` for
1024x1024. That constant ignores quality, model, and how many attempts the server actually made.
It is rendered as *"Measured cost"* and is deliberately always visible, even with the debug flag
off — the comment cites "the product's paid-action honesty".

Two consequences follow directly:

1. **The label overstates its own precision.** Only the token half is measured; the image half —
   the dominant term — is a constant keyed on a string. A five-attempt editorial failure and a
   clean first-try render both report `$0.08`.
2. **[known bug — unfiled] The `gpt-image-1` fallback renderer reports no cost at all.**
   `calculateOpenAICost` returns `null` when `timings.usage` is absent. The collage paths set no
   usage and correctly show nothing — they are free. But the editorial `gpt-image-1` branch
   (`core.js`) also never sets `timings.usage`, so a **billed** generation renders with
   no cost line. The user sees a generated image and is told nothing about what it cost.

This is the concrete answer to panel finding A6 in the handoff: the `~$0.07` figures are neither
user pricing nor fully measured instrumentation. They are a client-side estimate with a constant
image term, and they silently vanish on one billed path.

### The prompts themselves

Two builders, and they describe the same garment very differently. Sizes measured against real
pieces: `wholeWardrobeImagePrompt` is **~3,900 chars (~980 tokens)** for a three-piece outfit;
`editorialImagePrompt` is **~5,800 chars (~1,455 tokens)** for a *single* anchor garment — larger,
because it splices four Style Constitution layers that the whole-wardrobe prompt does not.

**`wholeWardrobeImagePrompt`** (`core.js`) is four blocks: six blanket garment-fidelity rules
("do not simplify a printed top into a plain tee", "if two listed garments are both printed, keep
both actual prints recognizable", "do not add extra hero garments, belts, scarves"); a
**per-piece fidelity checklist**; a person/scene block (full figure, single adult woman, ordinary
realistic proportions, no beauty retouching, no text or watermark, "closer to a real try-on than a
fashion ad"); and the outfit's own label, direction, silhouette, mechanics and `watchFor` — the
`watchFor` line is passed as *"Avoid drift:"*, so the outfit-level warning becomes a rendering
instruction. Pieces are described with `buildPieceText`, the structured truth text.

**PR 188 closes a card-to-render truth gap.** Generated outfit/card payloads now retain the linked
piece records needed by the renderer instead of relying on the card's short rationale. Planner
rosters preserve the same render-relevant structural fields. `wholeWardrobeImagePrompt` converts
those records into positive visual directions — what the garment must visibly do — so a constraint
such as `tuck_behavior: wear_over_only` becomes an instruction to show the shirt hanging naturally
over the waistband. This is deliberately a general constraint-composition rule, not a catalogue of
forbidden tuck/belt/layer cases. Structured garment truth outranks card prose throughout.

The same provenance continues into evaluation. A generated render carries
`visualEvidenceType: generated_board`; its image block is labelled as an AI-generated styling
visualization, and linked reference images are individually labelled with garment identity and
category. The evaluator may judge the composition or call out a renderer error, but cannot infer
real tuck, fit, hem, placement, or construction from the synthetic board. A final cross-garment
validity instruction rejects a proposed action if any affected linked record forbids it. Saved
**My Outfits** do not use this rule: their first image remains the actual worn-photo authority.

**`editorialImagePrompt`** (`core.js`) splices `BODY_CONTRACT`, `PROVEN_FORMULAS`,
`AESTHETIC_GRAVITY`, `LANE_NEUTRALITY` and `EXPRESSIVE_HIERARCHY_RULES`, then a
category-conditional silhouette rule (a bottom or dress anchor gets "keep that exact length; do not
force a full-length lower half"), then `anchorFidelityInstructions`.

**Both are appended with `withSavedBoardRendererMemory`** — and unlike most of the memory systems
in this app, **this one is live.** On the real database it produces **6 correction lines**, all
genuine:

> *"denim mid-thigh shorts: prior render had pants, skirt, or dress rendered too short; match the
> saved garment reference length."* · *"black cream botanical tiered midi skirt: prior render had
> … rendered too long…"*

This is also the **only behavioural** consumer of the image-fidelity feedback types. It supplies
text only when the identified garment is being rendered; the rejected generated board is retained
as evidence and is **never** attached as a future visual reference. Recall that
`wrong_length`, `wrong_garment_details`, `body_proportions_drift`, `identity_drift` and
`bad_reference` are deliberately excluded from styling influence (*Scoring → feedback weights*).
The split is clean and worth stating: **image feedback steers the renderer, styling feedback steers
the composer, and neither leaks into the other.** A field-specific wrong-length reason can also
create a separate metadata-review task, but never changes garment truth automatically. Note one
asymmetry — `bodyProportionsDrift` and
`identityDrift` are latched *before* the piece-overlap check, so those two corrections fire from
any board's feedback, not just boards involving the requested pieces. They are properties of the
person, not the garment, so that reads as intended.

### The prompts ask about garments in keywords, not columns

Every fidelity rule in both builders is derived by regex over text, never from the structured
columns — the same pattern as the diversity classifiers, and here it is load-bearing for the
app's most expensive call.

**Three different regexes now answer "is this patterned?", and all three disagree:**

| asked by | reads | sees, of the 90 non-solid pieces |
|---|---|---|
| `pattern_type` column | — | **90** |
| image fidelity checklist | `pieceTextBlob` | 60 |
| diversity / rhythm classifier | `pieceNameBlob` | 72 |

The checklist's list has `botanical` and `paisley`; the classifier's has `print` and `graphic`
instead. Neither reads the column that knows the answer.

**The editorial path is the thinner of the two, and measurably so.** Its `pieceDesc` is
`name; category; colors; notes` — no `length_hits_at`, `sleeve_type`, `silhouette`, `fit_on_body`,
`hem_finish` or `fabric_category`. It also references **`selectedPiece.fabric`, a column that does
not exist** (the real ones are `fabric_category` / `fabric_weight` / `fiber_content`), so that line
never renders. `anchorFidelityInstructions` (`core.js`) then derives its rules from
`name + notes` alone:

| column | populated | stated in name/notes | resulting clause |
|---|---|---|---|
| `sleeve_type` | 207 / 236 | 48 | sleeve clause reaches 48 |
| `length_hits_at` | 207 / 236 | 53 | **no length clause exists in the builder at all** |
| `fit_on_body` | 164 / 236 | 84 | fit clause reaches 84 |
| `pattern_type` | 228 / 236 | 17 | stripe clause only; no floral/botanical clause |

**49 of 236 pieces produce no anchor fidelity instruction whatsoever.**

Put beside the renderer memory above, that is a closed loop worth naming: the most common recorded
render complaint is **wrong length**; `length_hits_at` is populated on **207 of 236 pieces**; and
the editorial fidelity builder has **no length clause**. The wardrobe knows the answer, the prompt
never states it, and the correction arrives afterwards as feedback. The whole-wardrobe path does
better here — `buildPieceText` carries `length_hits_at`, `silhouette`, `hem_finish` and
`fit_on_body` — which makes this an asymmetry between the two paths rather than a system-wide gap,
and the same shape as the Visual Composer athletic-pants incident already on record.

> **FIXED 2026-07-29.** `anchorFidelityInstructions` now reads the structural columns first and
> keeps the `name + notes` regexes only as the fallback for pieces that carry no tagged value, so
> nothing that produced a clause before stopped producing one. Measured over the live wardrobe:
> **206 of 243 active pieces now carry a length clause** (was 0), and the count producing no anchor
> fidelity instruction at all fell from **49 to 1**. `editorialImagePrompt` now describes the anchor
> with `buildPieceText` — the same truth text the whole-wardrobe path uses — which closes the
> asymmetry and removes the `selectedPiece.fabric` line that read a non-existent column. One clause
> was added beyond restoring parity: a tagged sleeve now says *do not cover it with a layer that
> would crush it*, from the bishop-sleeve incident. Also fixed at the source: `trustedFieldText`
> suppresses the tagger's not-applicable sentinel, so the truth text no longer emits `sleeve: none`
> on 59 bottoms, 13 accessories and 6 shoes. Tests: `test/editorialIdealAdditions.test.js`.
> The 900-character truncation below is **not** fixed.

**One more loss on the better path:** `wholeWardrobeImagePrompt` truncates each piece's truth text
at 900 characters, and the real median is **1,130** — so **169 of 236 pieces lose their tail**.
`buildWardrobePieceTruthText` appends in a fixed order, with `fit_on_body`, tuck behavior,
occasions and trust status last, so those are the fields that fall off the end.

---

## The tagger prompt — where every column comes from

Mapped 2026-07-26. `tagPieceWithProvider` (`routes/ai.js`) is the call that populates
`formality`, `fabric_weight`, `length_hits_at`, `sleeve_type`, `pattern_type`, `occasions`, the
style lanes and the whole `style_profile_json`. **Every number elsewhere in this document is
downstream of it.** Measured by `scratch/measure_image_path.js`.

### What is sent

| part | size |
|---|---|
| `TAG_PIECE_PROMPT` | **21,151 chars ≈ 5,290 tokens** |
| `TAG_PIECE_SYSTEM` | ~1,100 chars |
| wardrobe calibration anchors (text) | 2,059 chars, 18 anchors |
| garment photo @1568px | ~2,220 tokens each (import sends 1; add-piece can send 2) |
| up to 8 anchor thumbnails @448px | ~1,560 tokens total |
| output cap | 2,500 tokens |

The prompt has four sections: a **photo property authority map**, a **physical property framework**,
**descriptive cues and labels**, and **calibration anchors**.

### The authority map is the most interesting part

Before tagging anything the model must classify each image on two booleans — `fit_visible` and
`real_context` — and authority then follows those properties rather than the photo's label:

- Flat, even-lit garment photos are authoritative for colour, pattern, fabric surface,
  construction, neckline, sleeve existence.
- Fit-visible photos are authoritative **only** for `fit_on_body`, drape, `length_hits_at`,
  `tuck_behavior`, `waistband_type`, on-body silhouette.
- Real-context photos are positive evidence for occasion register, never negative.

Then seven conflict rules, of which two are doing real work: *"the worn photo owns how the garment
behaves, never what the garment is"*, and an explicit **context-insulation** rule — *"a polished
shell photographed at home with shorts is still a polished shell; home setting, shorts, bare legs,
or casual styling must not drag its lanes or occasion confidence toward casual."* When photos
disagree the instruction is to **lower confidence rather than silently pick**, and to emit a
`cross_photo_agreement_note`. That is why `_confidence` exists on every field, and it is the
mechanism behind `trustedFieldText` and `getFieldConfidence` used downstream.

### Two kinds of calibration anchor

**Static** — three archetypes hard-coded in the prompt (basic ribbed tank, stiff cotton
button-down, refined textured statement top), each with full expected lane scores and occasion
confidences, framed as *"range calibration, NOT templates to match."* They exist to set the width
of the scoring range so quiet pieces do not collapse to 1/5 across every lane.

**Dynamic** — `buildAnchorBlock` (`taggerMerge.js`) injects real pieces from *this* wardrobe
under the header *"These assignments are ground truth for THIS wardrobe — calibrate to them, not to
general fashion norms."* Two fields are anchored: `formality` and `fabric_weight`, up to 3 examples
per distinct value, each with a low-detail 448px thumbnail (capped at 8 images, so 18 anchors are
listed in text but only 8 illustrated).

**The anchors are built exclusively from pieces the owner has manually corrected** — the bucket
loop skips any piece whose field is not in `manual_overrides`. So the tagger's calibration is
literally a feedback loop on owner corrections, and it currently carries **18 anchors, 11 for
`formality` and 7 for `fabric_weight`.** Its cost also grows with correction count.

### Owner corrections — and what they settle

**228 of 236 pieces carry at least one manual override.** By field:

| field | pieces corrected |
|---|---|
| **`formality`** | **202** |
| `fit_confidence` | 72 |
| `occasions` | 38 |
| `fiber_content` | 37 |
| `fabric_category` | 28 |
| `fabric_weight` | 13 |

**This resolves the register-ceiling question, and reverses the recommendation made earlier in this
document.** Under *The gates* the finding was that 52 of the 91 blocked `elevated` pieces are also
tagged `casual`, and one suggested resolution was to let an explicit `casual` occasion tag override
the ceiling — on the precedent that user tags override AI profile confidence. **Checking
provenance shows that precedent does not apply here.** Of those 52 pieces:

- **49 have owner-corrected `formality`** — `elevated` is a deliberate ruling, not tagger drift.
- **Only 5 have owner-corrected `occasions`** — for 47 of the 52 the conflicting `casual` tag is
  *auto-tagger output*.

So the conflict is overwhelmingly **an owner ruling against an auto-tag**, and the gate reading
`formality` is reading the more authoritative column. Letting the occasion tag win would let tagger
output override the owner on 47 garments — the opposite of the precedent it was justified by. The
`elevated` tag has not drifted; it is the most curated field in the wardrobe.

What remains is a genuinely small question: **the 5 pieces where the owner set both** `elevated`
and `casual` by hand. That is a five-row list, not a policy decision.

### Merge protection

`applyTaggerResult` (`taggerMerge.js`) normalises `fiber_content`, `formality`, `heel_height`
and `walk_support`, then merges through `mergeWithManualOverrides` — **a manually-overridden field
is never overwritten by a re-tag**, at both top level and inside `style_profile_json`, with
`pinManualConfidence` forcing confidence on those fields. This is what makes re-tagging safe and
why the anchor loop can trust `manual_overrides` as ground truth.

### The prompt is scar tissue, and it shows

Much of both prompts is corrections for specific past failures, stated as prohibitions: *"do not
collapse lavender into taupe"*, *"do not mark every floral or botanical item as
modern_bohemian"*, *"leather and suede jackets default to elevated, not dressy"*, *"knit dresses
are not inherently dressy"*, *"ruffle detailing alone does not lift a piece out of everyday"*. The
`home` occasion is constrained **three separate times** across system and user prompt — twice in
the system prompt alone — which is a reliable signal of a mis-tag that kept recurring.

Note the formality definitions are explicitly calibrated to *"THIS wardrobe's artisan-nice
baseline"*, with `everyday` defined so that *"artisan texture, linen, and basic knits do NOT lift a
piece out of everyday on their own."* Read alongside the 202 formality corrections, the picture is
of a field that was hard to get right and was fixed by hand at scale.

### The cost gate under-quotes

`routes/importer.js` prices bulk tagging at `TAG_EST_INPUT_TOKENS = 6000` and
`TAG_EST_OUTPUT_TOKENS = 1400` per new-piece cluster, and that estimate is what the preflight
endpoint shows before asking for `{approve: true}`. Measured against the real payload:

| | preflight | measured |
|---|---|---|
| input | 6,000 | **~9,880** (6,097 text + ~2,220 photo + ~1,557 anchor thumbs) |
| output | 1,400 | cap is **2,500** |

**The prompt text alone is 6,097 tokens — it exceeds the entire input estimate before a single
image is attached**, so the estimate cannot have accounted for imagery at all. Input is
under-quoted by roughly **1.6×**. The output figure is only an underestimate if the tagger emits
near its cap, which this cannot measure without a billed call — so treat the input number as the
solid finding and the output number as unverified.

Two consequences: the one place the app asks permission before spending systematically quotes low,
and because the anchor block grows with owner corrections, **the gap widens as the wardrobe gets
better curated.**

---

## Roles — what decides an outfit's formula family

Mapped 2026-07-26 by `scratch/measure_roles.js`. `inferOutfitArchetype` scores each archetype by
which **roles** a piece set yields, and the winning archetype's `formulaFamily` is what the **−45**
diversity repeat penalty keys on. So this classifier sits upstream of the largest number in the
engine.

### It is the one classifier that respects confidence — by dropping data

`inferWholeWardrobePieceRoles` (`rules.js`) builds its text from `pieceNameBlob` **plus**
structured columns — `pattern_type`, `pattern_complexity`, `fabric_category`, `fabric_weight`,
`background_color`, `reads_as`, colors, notes. That already makes it better informed than the
pattern classifiers, which read names only.

But `silhouette` and `fit_on_body` are wrapped in `trustedField()`, and **`trustedField` drops a
low-confidence value entirely** rather than annotating it the way `trustedFieldText` does. Given
the confidence distribution under *Provenance*:

> `silhouette` reaches the role blob on **38 of 236** pieces.
> `fit_on_body` reaches it on **35 of 236**.

So for ~85% of the wardrobe, formula-family classification runs with no silhouette or fit signal at
all. This is the stale-tagger problem propagating into diversity: re-tagging would change what
counts as a repeat, not just what the image prompt says.

### The vocabulary comes from two sources and they do not agree

Roles arrive from the tagger (`style_profile_json.roles`, `visual_roles`, `best_outfit_role`) *and*
from hard-coded regex rules. The two use different names for the same concept:

| tagger-written | code-written |
|---|---|
| `support` (77) | `support_piece` (92) |
| `hero` (51) | `hero_piece` (58) |
| `grounding` (33) | `grounding_piece` (71) |

The archetypes reference only the code-written forms, so the tagger's `hero`, `support` and
`grounding` — plus `texture_piece` (86), `color_accent` (48), `quiet_anchor` (36),
`movement_piece` (25), `sharpener_piece` (8), `column_piece` (8) and `texture_accent` (11) — are
produced on every generation and **matched by no archetype**. They are inert vocabulary, carried
through the whole pipeline and scored on by nothing.

Most-frequent roles overall: `soft_texture` 45%, `support_piece` 39%, `texture_piece` 36%,
`graphic_element` 36%, `beige_sludge` 31%, `grounding_piece` 30%. Only 5 of 236 pieces yield no
role at all.

### [known bug — unfiled] Singular-only regexes miss plural garment names

Garment names are overwhelmingly plural for footwear — *"black slip-on loafers"*, *"brown leather
zip ankle boots"*. The classifiers test **singular** forms with word boundaries, and `\bloafer\b`
does not match `loafers`.

Measured on the 33 shoes, against `wholeWardrobeShoeShape`'s
`/\b(round|loafer|boot|sneaker)\b/`:

| | default `rounded` | `rounded/square` | `pointed` |
|---|---|---|---|
| as written | **30** | 1 | 2 |
| plural-tolerant | 22 | **9** | 2 |

**Eight shoes leave the default bucket the moment plurals match.** This substantially explains the
"93% of outfits classify as `rounded`" result reported under *After the gate → classifiers* — that
was read as real uniformity in the wardrobe, and it is largely a regex bug. Correcting it would
make the −14 shoe-shape diversity penalty discriminate where today it is nearly a constant.

The same miss hits `inferWholeWardrobePieceRoles`: four shoes fail to earn `sharp_finish` purely on
plural forms — *black floral cutout mules*, *brown leather zip ankle boots*, *black slip-on
loafers*, *taupe suede ankle boots*. `sharp_finish` is a `preferredRole` of `dress_grounded_sharp`,
so this changes archetype scoring too.

This is a bug class, not one site — swept below.

---

## [known bug — unfiled] The singular/plural gap, swept

Mapped 2026-07-26 by `scratch/measure_plural_gap.js`, which extracts every literal keyword
alternation (`/\b(a|b|c)\b/`) from `styling-engine/` and tests each term against the real wardrobe
in singular and plural form. **512 distinct singular keywords** across 16 files. Garment names are
overwhelmingly plural — *"dark blue bootcut denim jeans"*, *"black slip-on loafers"* — and a
word-boundaried singular does not match them.

**19 keywords miss garments whose own name carries the plural; 122 garment-matches are lost.**
Counting by *name* rather than by text blob, so these are unambiguous — the garment **is** the
thing, not merely mentioned in another piece's notes:

| keyword | pieces matched | garments missed by name | sites using it | |
|---|---|---|---|---|
| `shoe` | 1 | **33** | 4 | |
| `pant` | 1 | **28** | 10 | |
| `short` | 7 | 11 | 5 | |
| `jean` | **0** | 8 | **16** | **never fires** |
| `sandal` | 1 | 8 | 7 | |
| `trouser` | 3 | 7 | 17 | |
| `sneaker` | **0** | 5 | 8 | **never fires** |
| `heel` | 3 | 5 | 2 | |
| `flat` | 3 | 3 | 5 | |
| `boot` | 1 | 2 | **28** | |
| `loafer` | **0** | 1 | **25** | **never fires** |
| `clog` | **0** | 1 | 4 | **never fires** |
| `pointed heel` · `tailored trouser` · `linen short` | **0** | 2 · 2 · 1 | 1 each | **never fire** |

**Six keywords never fire at all on this wardrobe** — `jean`, `sneaker`, `loafer`, `clog`,
`pointed heel`, `tailored trouser`, `linen short` — and they are referenced at 16, 8, 25, 4 and 1
sites respectively. `boot` is used at **28 sites** and matches **one** garment. `shoe` matches one
garment while 33 are named `…shoes`.

**Why this matters more than its size suggests.** These are not exotic terms; they are the core
garment vocabulary the engine reasons in. Rules keyed on them — grounding strategy, shoe shape,
formula type, boho signal, occasion scoring, `isLightweightLinenBottom`, the image fidelity
checklist — are silently inert for the garments they were written for.

**It also means several distributions reported earlier in this document are understated.** The
"93% of outfits classify as `rounded`" result under *After the gate → classifiers* was read as real
uniformity in the wardrobe; eight of 33 shoes leave that bucket the moment plurals match. Any
keyword-derived number in this map should be re-measured against the plural-tolerant form before it
is acted on. That is what the script is for.

**What it is not.** Profile lists (`preferred_footwear: ["loafers", "sandals"]`) already use
plurals and go through `pieceMatchesFootwear`, which builds its regex from the profile string — so
the occasion and activity profiles are unaffected. This is confined to hard-coded regexes in
`rules.js`, `core.js` and `attributes.js`.

### But a blanket `s?` sweep is the wrong fix — measured

The obvious remedy is to add `s?` everywhere. Running the two shoe classifiers both ways over the
same 600 outfits shows that would help one and harm the other:

| classifier | as written | plural-tolerant |
|---|---|---|
| shoe shape (−14) | 93% in default `rounded` | **53% / 47% split** — now discriminates |
| grounding strategy (−18) | 47% in `soft casual grounding` | **80%** in `soft casual grounding` — worse |

Shoe shape improves exactly as expected. **Grounding gets more concentrated, not less**, because
the newly-matching plurals (`sneakers`, `sandals`, `flats`) all fall into the same
`soft casual grounding` branch, collapsing three buckets toward one. The −18 penalty would then
fire on 80% of pairs instead of 47%.

So the bug is real everywhere, but **the fix has to be evaluated per classifier**: correcting the
regex changes which bucket a garment lands in, and for grounding the branch order is what needs
attention, not the plurals. Anyone applying a mechanical `s?` sweep across the 19 keywords would
improve the shoe-shape penalty and quietly degrade the grounding one.

The ratchet counts these sites as text-matching debt already, so fixing them in place does not
raise the baseline — and reading the structured column instead, where one exists, would lower it.
`heel_height` and `walk_support` already exist as enums for exactly this footwear question.

---

## `extract-pieces` — the tagger's weaker sibling

`POST /api/ai/extract-pieces` (`routes/ai.js`) takes one outfit photo and returns every garment
in it. It shares the tagger's *schema* and almost none of its *machinery*. What it does **not**
send, all of which the tagger does:

- **No calibration anchors.** No wardrobe ground-truth block, no *"calibrate to THIS wardrobe"*
  instruction, no anchor thumbnails. It tags against general fashion norms.
- **No photo-property authority map.** No `fit_visible` / `real_context` classification, so none of
  the conflict-resolution or context-insulation rules apply — from a single worn photo, which is
  exactly the case the authority map was written for.
- **No `_confidence` map.** The schema has no confidence field at all. Downstream,
  `getFieldConfidence` falls back to **`medium`** for anything not in
  `STRUCTURE_FIT_CONFIDENCE_FIELDS`. So extract-pieces output is treated as *more* trusted than the
  real tagger's own low-confidence output, despite being derived from less evidence.
- **No `style_profile_json`.** No style lanes, no `garment_intelligence`, no occasion confidence,
  no roles — so pieces created this way contribute nothing to `profileRoles` in the role classifier
  and have no `auto_use_trust` for the gate to read.
- **No salvage on parse failure.** The tagger catches a chatty response with `salvageFirstJson`;
  this calls `parseModelJson(raw)` bare and 500s.

It is also the one call site that logs the **entire raw model response** to the server log on every
request (`console.log('RAW RESPONSE LENGTH:', raw?.length, 'RAW RESPONSE:', raw)`) — left-in debug
output, not a mechanism.

**[latent inconsistency] It instructs a fabric-weight vocabulary the engine cannot read.** The
schema says: *"for SHOES use the shoe scale instead: delicate|slim|medium|chunky."* But
`fabricWeight()` (`attributes.js`) recognises only `heavy`, `ultralight`, `light`,
`lightweight`, `medium` — anything else returns `null`, and nothing normalises the shoe scale.
A shoe tagged `chunky` would read as having no fabric weight at all, silently skipping the capsule
summer terms and the `+5 light` workbench term.

No such value exists in the database today (`fabric_weight` is only medium/light/heavy/ultralight),
so this is **not currently firing** — the value is presumably dropped before persistence, which is
the enumerate-and-drop behaviour already on record for the piece forms. Latent, not live; worth
fixing when the shoe scale is either implemented or removed from the prompt.

---

## Provenance — who set the value the engine decides on

Mapped 2026-07-26 by `scratch/measure_provenance.js`. **This section exists because provenance
reversed two recommendations in this document.** A conflict between two columns is not symmetric
when one side is a hand-correction and the other is model output — check which is which *before*
proposing a fix that resolves one against the other.

    node scratch/measure_provenance.js                      # the whole table
    node scratch/measure_provenance.js formality occasions   # cross-tab two columns

### The table

| column | owner-set | populated | what it decides |
|---|---|---|---|
| **`formality`** | **202** | 229 | register ceiling — the largest single exclusion |
| `fit_confidence` | 72 | 236 | +30 workbench term, auto-use trust |
| `occasions` | 38 | 233 | occasion gate, +35 workbench term |
| `fiber_content` | 37† | 201† | hot-weather insulating-fiber clause, wet-exposure footwear clause, capsule summer term |
| `fabric_category` | 28 | 230 | weather + profile material rules |
| `name` | 17 | 236 | **every keyword classifier in the engine** |
| `season` | 16 | 236 | not gated directly |
| `fabric_weight` | 13 | 236 | hot/cold weather gate |
| `notes` | 12 | 191 | engine-notes suppression, image prompts |
| `colors` | 10 | 234 | capsule neutral term |
| `fit_on_body` | 10 | 164 | image truth text |
| `length_hits_at` | 8 | 207 | image truth text |
| `walk_support` | 4 | 33 | activity footwear gate |
| `sleeve_type` / `silhouette` | 3 each | 207 / 190 | bareness gate, image truth |
| `pattern_type` | 1 | 228 | capsule solid term |
| **`heel_height`** | **0** | 33 | activity footwear gate — **entirely tagger-set** |
| **`recommendation_status`** | **0** | 236 | auto-use trust gate — **entirely tagger-set** |
| **`role_permission`** | **0** | 236 | auto-use trust gate — **entirely tagger-set** |

† `fiber_content`'s owner-set/populated counts are as of the 236-piece pass and not re-measured
here — only its "what it decides" cell was corrected, after tracing two consumers this table
previously omitted (`pieceHasWetSensitiveFootwearMaterial`, `capsuleVersatilityScore`'s summer
term — see *Gate-field coverage* above for what's actually live vs. latent about each). The
wardrobe is 242 active pieces as of this correction, 6 more than this table's baseline. Re-run
`node scratch/measure_provenance.js` for current counts on any row before relying on them.

`formality` is an outlier by an order of magnitude — 86% hand-corrected. Everything else the gates
read is predominantly or entirely model output. Note the two trust-gate columns with **zero**
owner input: they are also the two shown under *Scoring* to be non-discriminating (`trusted` on
226/236, `auto` on 235/236). A field nobody has ever corrected and that has one value everywhere is
not a signal.

### The tagger hedges on most of what it reports

`getFieldConfidence` returns the tagger's own `_confidence` value per field. Across the wardrobe:

| field | low | high | medium | manual |
|---|---|---|---|---|
| `length_hits_at` | **191** | 33 | 4 | 8 |
| `fit_on_body` | **201** | 19 | 6 | 10 |
| `silhouette` | **198** | 27 | 8 | 3 |
| `hem_finish` | **200** | 29 | 5 | 2 |
| `sleeve_type` | **191** | 39 | 3 | 3 |
| `formality` | 0 | 18 | 16 | **202** |

**The tagger reports `low` confidence on roughly 85% of its own structural predictions.** That is
not a malfunction — it is the prompt working as designed. The authority map instructs it to *"never
infer fit, drape, or length from a photo that is not fit_visible"* and to leave such fields
low-confidence.

> #### Amendment, 2026-08-08 — most of that 85% is not a tagger judgment at all
>
> The paragraph above reads every `low` as the tagger hedging. On pre-v2 pieces it is not: it is a
> **normalization default for an absent value**, and some of those values were typed by the owner.
>
> `normalizeConfidenceMap` ([`taggerMerge.js`](../styling-engine/taggerMerge.js)) ends with:
>
> ```js
> return [field, VALID_CONFIDENCE.has(confidence) ? confidence : 'low']
> ```
>
> Anything not already `high`/`medium`/`low`/`manual` becomes `low`. A garment tagged before the
> `_confidence` map existed has no entry, so it normalises to `low` — recording "provenance
> unknown", not "the tagger was unsure".
>
> **The distribution proves it. A rating process does not emit exactly one value.** `fit_on_body`,
> by tagger era, across 242 active pieces:
>
> | era | pieces | low | medium | high | manual |
> |---|--:|--:|--:|--:|--:|
> | (unversioned) | 164 | **134** | **0** | **0** | 28 |
> | `v1.0.0` | 11 | 7 | **0** | **0** | 4 |
> | `v2.0.0-photo-property-authority` | 67 | 28 | 6 | 25 | 8 |
>
> **Zero mediums before v2 on every structural field**, against a genuine spread after it. The
> claim is about the *shape* of the distribution, not a categorical absence: pre-v2 `length_hits_at`
> carries a handful of `high` values (`silhouette` and `hem_finish` carry none). **[unverified]**
> where those came from — an older tagger that emitted confidence, or an import. They are the
> exception that the wording must survive, not evidence against the reading: a rating process that
> never once returns `medium` across hundreds of pieces is not rating.
>
> Counts here are a 2026-08-08 snapshot and move as fields are re-confirmed; regenerate with
> `node scratch/measure_feedback_surface.js` §9.
>
> **Owner, 2026-08-08:** *"those values are there bc I put them there… probably just done before the
> user-tagged tag was introduced."* Provenance is recorded from v2 onward — `manual_overrides` and
> `_confidence.<field> = 'manual'` agree exactly, and `getFieldConfidence` falls back between them —
> but a value entered before either mechanism existed cannot be distinguished from an absent one.
>
> **Consequences, both live.** `trustedFieldText` renders these as
> `fit: [low confidence - add worn photo] skims` — telling the model to discount owner-entered data,
> and asking for a photo most of those garments already have (119 of the 132 fit-relevant pieces
> still at `low` on 2026-08-08; the count falls as the owner re-confirms fields by hand, so re-measure
> rather than citing it). `manifestValue` appends `?`
> to the same values throughout the wardrobe manifest. And `trustedField`
> ([`attributes.js`](../styling-engine/attributes.js)) accepts only `manual`/`high`/`medium`, so
> `attributePieceTextBlob` **drops** `fit_on_body`, `silhouette`, `tuck_behavior` and
> `waistband_type` entirely on these pieces — the value exists and search cannot see it.
>
> **Do not "fix" this by re-tagging.** That would overwrite owner-entered values with model guesses.
> Two options: introduce a provenance value distinct from `low` — `legacy` or `unrated`, meaning
> "recorded before provenance was tracked" — and exempt it from the low-confidence warning, the `?`
> suffix and the `trustedField` rejection; **or** the owner re-confirms the fields by hand, which
> marks them `manual` correctly, since the piece editor sets a field manual on any interaction with
> it. A new value must be added to `VALID_CONFIDENCE` (`taggerMerge.js`) or
> `normalizeConfidenceMap` will convert it straight back to `low`, and to all three
> `getFieldConfidence` implementations (`wardrobeAiContext.js`, `attributes.js`,
> `rules.js`) or they will disagree about the same garment.

**[by design]** Low confidence does **not** suppress the value downstream. `trustedFieldText`
(`wardrobeAiContext.js`) prefixes it instead: `length: [low confidence - add worn photo] midi`.
So the image prompts *do* carry the length — annotated with a disclaimer that it is unreliable, on
81% of pieces. That refines the finding under *The image-generation path*: the whole-wardrobe
prompt states a length, and simultaneously tells the renderer not to trust it.

### The real cause of the length problem — stale tags, not prompt construction

| tagger_version | pieces |
|---|---|
| **(unversioned)** | **167** |
| `v2.0.0-photo-property-authority` | 58 |
| `v1.0.0` | 11 |

**71% of the wardrobe was tagged before the photo-authority prompt existed.** Only **64** pieces
carry any photo-property judgment, and 57 have `fit_visible` set on some photo — essentially
exactly the v2 population.

Where the authority section actually ran, it works:

> low-confidence `length_hits_at` across all pieces: **191 / 236 (81%)**
> low-confidence `length_hits_at` among `fit_visible` pieces: **24 / 57 (42%)**

Structural confidence is roughly **twice as good** on pieces the current prompt tagged. And this is
not simply "no worn photos" — **176 of 236 pieces have a worn photo**; 144 of the 191
low-confidence-length pieces have one. The photos exist; the old tagger never classified them.

**This reorders the fix list under *The image-generation path*.** The editorial prompt's missing
length clause is real, but it is the second-order problem. The first-order problem is that the data
it would state is low-confidence on 81% of the wardrobe because those pieces were tagged by a
prompt that predates the section designed to fix exactly this. Re-tagging is upstream of every
prompt change.

**Re-tagging is billed, and here is the number.** 167 unversioned pieces at the measured ~9,880
input and the 2,500-token output cap, priced with the app's own table for
`anthropic / claude-sonnet-4-6`:

> **≈ $11.21** — $4.95 input, $6.26 output. Output is priced at the *cap*, so this is an upper
> bound; actual emission is likely lower.

`applyTaggerResult` never overwrites a manually-overridden field, so a re-tag **cannot undo the 202
formality corrections** or any other owner ruling. That is what makes this safe to consider — and
it is the reason the merge protection mapped under *The tagger prompt* matters.

**This is an owner decision, not something to run.** It is recorded here as a costed option.

### Re-tagging is not the first move — owner ruling, 2026-07-26

An earlier draft of this section said "re-tag first, then fix the prompt." **That is wrong and is
withdrawn.** The owner's position, which the data supports:

> This wardrobe has already been re-tagged **multiple times**. Each pass is only as good as the
> tagger was on the day it ran. The 167 unversioned pieces are not evidence that a re-tag is
> overdue — they are the *residue of previous re-tags* that predate the current prompt. Doing it
> again against a tagger with known gaps just buys another generation of data to redo.

So the ordering is: **raise the tagger's ceiling first, re-tag once afterwards.** The $11 is not
the constraint; spending it on a tagger that is not yet at its best is. Treat every item below as
blocking the next re-tag, not as optional polish.

### What would raise the tagger's ceiling — findings from this map

**1. Calibration anchors cover two fields out of the several that gate.**
`tagPieceWithProvider` calls `buildAnchorBlock` with `fields: ['formality', 'fabric_weight']`
(`routes/ai.js`). Measured, on the corrections that already exist:

| anchor fields | anchors produced |
|---|---|
| `formality` + `fabric_weight` (today) | **18** — 11 + 7 |
| add `occasions` | **49** — +31 |
| add `fit_on_body` + `length_hits_at` too | **67** |

`occasions` is the second-largest gate input (the occasion gate, the +35 workbench term, capsule
versatility) and **38 owner corrections for it already exist and are unused for calibration.**
Adding it to that array is a one-line change.

**Two honest caveats before doing it.** `occasions` is an *array*, and `buildAnchorBlock` buckets by
the joined string — so each distinct combination becomes its own bucket, which is why 38
corrections yield 31 anchors. Anchoring on a set is weaker calibration than anchoring on a scalar
like `formality`, and 31 near-unique anchors may read as noise rather than as a range. And more
anchors means more tokens per tag, on a call whose cost is already under-quoted by 1.6×. Worth
measuring the anchor block's token cost against its benefit before shipping — not an obvious win.

**2. Two gate columns cannot be anchored at all.** `heel_height` has **0** owner corrections and
`walk_support` has **4**, so no anchor bucket can form for either. Both feed the activity
footwear-comfort gate, and `heel_height` is 100% tagger-set (see the provenance table). If that
gate matters, the missing input is owner corrections, not prompt text.

**3. Only 8 of 18 anchors get a thumbnail.** `anchorThumbsForTagger` caps at `limit = 8`
(`routes/ai.js`) while the text block lists all 18. Which 8 depends on bucket iteration order,
not on importance — so the illustrated anchors are effectively arbitrary. Worth making
deliberate before a run that re-tags the whole wardrobe against them.

**4. The singular/plural gap is upstream of tagging too.** The tagger writes `name` and `reads_as`;
every downstream keyword rule then reads those. Re-tagging into an engine where `jean`, `loafer`,
`sneaker` and `clog` never match is spending money to feed classifiers that cannot see the result.

**5. `extract-pieces` emits no `_confidence` map**, so anything added through it is treated as
`medium` trust. If a re-tag is meant to establish a confidence baseline, that endpoint currently
undermines it.

**Not blocking:** the editorial image prompt's missing length clause and the `pattern_type` blind
spot in the classifiers are *consumer-side* — they misread good data rather than producing bad
data, so they can be fixed on either side of a re-tag.

### Tagging cost — the adoption barrier, not a personal budget line

**Owner reframing, 2026-07-26:** *"it's not just my tagging — the largest barrier for my users to
start using the app is bringing in/tagging their wardrobes."* So tagger spend is a **per-signup
onboarding cost**, paid on the user's own key (BYOK shipped in spec 33). Optimising it is an
adoption problem, and everything below is scoped that way.

**[known bug — unfiled] A new user gets zero calibration anchors.** `buildAnchorBlock` only buckets
pieces whose field is in `manual_overrides`, so a wardrobe with no corrections yields an **empty
anchor block** — verified. The wardrobe-calibration mechanism, the thing that makes the tagger
good, is **unavailable to precisely the population whose first impression decides adoption**. It is
rich-get-richer by construction: the tagger is at its worst on day one and improves only as the
user corrects it. Any cold-start quality work has to come from the static prompt, because the
dynamic half does not exist yet.

**Cost of onboarding, measured** (cold start: no anchors, no anchor thumbnails, so ~5,582 prompt
tokens + one ~2,226-token photo + up to 2,500 output):

| | 50 garments | 200 garments |
|---|---|---|
| today — sonnet-4-6, no caching | $3.05 | **$12.18** |
| + prompt caching | $2.29 | $9.17 |
| + haiku-4-5 | **$0.76** | **$3.06** |

**Output is 56% of the bill** ($0.0375 of $0.0671 per garment at sonnet), so prompt trimming
attacks the smaller half. The levers in order of measured value:

1. **Model tier — 67%.** The importer already runs haiku for classification, detection, crop
   verification, clustering and merge matching; only tagging uses the full stylist model. This is
   the one lever with real quality risk, and it is exactly what an evaluation harness should
   decide.
2. **Prompt caching — 31%, quality-neutral, currently impossible.** `tagPieceWithProvider` sets no
   `cache_control` at all, and cannot benefit until the content array is reordered: the per-piece
   photo is pushed **first** (`routes/ai.js`), before the anchors and the prompt, and a cache
   prefix must be contiguous from the start. Reorder to *[prompt + anchors] → [photo]*, then mark
   the prefix. The machinery already exists (`provider.js` → `PROMPT_CACHE_BREAKPOINT`,
   `systemToAnthropicBlocks`) and is used by the stylist conversation path.
3. **Output schema — attacks the expensive half.** `cross_photo_agreement_note` is explicitly
   demanded by the prompt (*"Always emit a brief cross-photo agreement note"*) and then **deleted**
   in `applyTaggerResult` (`taggerMerge.js`) — paid tokens discarded on arrival. The rest of
   the schema needs the same field-by-field trace; several sub-fields *are* consumed, so this is an
   audit, not a guess.
4. **Latency is a second adoption barrier.** Tagging is one call per garment, sequential, while the
   importer batches every other stage (10 images per classify call, 12 per cluster sheet). A
   200-garment onboarding is 200 serial calls. Batching amortises the prompt, but caching already
   does most of that — the real prize here is wall-clock, not dollars.

**Consequence for the evaluation harness:** the question it must answer is no longer "did my prompt
edit help" but **"does haiku tag well enough for a cold-start user"** — and it must be tested in the
*cold-start configuration*, with the anchor block stripped, not against this wardrobe's 18 anchors.
Testing warm would measure a configuration no new user ever sees.

### Prior rulings a tagger spec must respect

Checked across `docs/` 2026-07-26, because several of these would have made the suggestions above
wrong or redundant.

- **Optimising the tagger is already owner-sanctioned as a priority.**
  `ui-v1-design-handoff.md` (issue 5, owner 2026-07-26): *"The single most expensive step is AI
  tagging… **Optimising the tagging step may be the better first move**, and it pays off across
  every import path and the wardrobe generally — not just video."* So the spec's frame is **not**
  "make re-tagging cheaper" — it is "make tagging better everywhere", with the video-import
  decision explicitly downstream of it.
- **[ratified] "AI retagging reports what changed, leaves results reviewable, and cannot race
  Save."** `ui-v1-design-handoff.md`, PieceDetail acceptance criteria. Capture-then-apply is this
  principle at batch scale — cite it rather than proposing it as new.
- **[by design] Nothing is retagged automatically.** Surface map → Tasks: retag-suggestion todos
  name the field to review, and *"the sheet states at the point of capture that nothing is
  retagged automatically."* Any apply step stays a deliberate owner action.
- **[OPEN — needs owner agreement, do not assume] Worn-photo scope.**
  `ui-v1-design-handoff.md`: *"the UI promises a fit note, while the current AI tagging path can
  revise broader identity and style fields. Prefer scoping worn-photo analysis to fit, drape, and
  wear behavior unless the broader draft is made explicit and separately reviewable."* The engine's
  photo-authority map already approximates this — worn photos are authoritative only for
  `fit_on_body`, drape, `length_hits_at`, `tuck_behavior`, `waistband_type`, on-body silhouette —
  but the product decision is unresolved, so a spec must not quietly settle it.
- **Any field change costs 9 wiring points**, and *"tagger prompts ×2"* is the first of them
  (`freeform-rearchitecture-handoff.md` → new tag field checklist). That settles the scope
  question: **`extract-pieces` travels with `tag-piece`**; they are already treated as a pair.
- **`occasions.js` is frozen and its standing rules bind.**
  `occasion_profiles_ratification.md`: profile prohibitions may encode **validity only**,
  taste-adjacent entries are always SOFT; mood text may trigger a profile only via strong activity
  words, never generic ones; model-added entries are `[proposed]` and inert until ratified. A
  tagger spec may change what the tagger *emits*, not what the profiles *mean*.
- **Adjacent dead code:** `setPath` (`taggerMerge.js`) is marked **DEAD — delete in next spec**
  by `cleanup-inventory.md`. Cheap to fold in.
- **Known mis-tag for a test case:** piece **353** (cargo pants) has `length_hits_at` mis-tagged as
  `mid-thigh` (`freeform-rearchitecture-handoff.md`). Useful as a fixed regression case in any
  evaluation sample.

---

## Findings this map produced

Things that were not known before it was written, each settled against real data or a full call
trace rather than left as a question:

1. **`explorationMode: 'aggressive'` is unreachable.** Six trust-relaxation clauses that no caller
   can trigger; the mode a user selects emits `'adventurous'`. String mismatch, two separate
   origins, traced. → *The gates → Exploration mode.*
2. **52 of the 91 blocked `elevated` pieces are also tagged `casual`.** The `formality` and
   `occasions` columns contradict each other and only `formality` is read. → *The gates → register
   ceiling.*
3. **Two `planWorkbenchPieceScore` weights are decoration.** Removing `role_permission` gives a
   byte-identical top-40; removing `trusted` moves one piece. → *Scoring.*
4. **The two big sub-scorers are switches, not dials** — exactly 0/236 pieces scored in mild
   weather or with no register intent, 229/236 with one. → *Scoring → sub-scorers.*
5. **Advisor mode converts seven rejections into annotations.** The same check drops an outfit or
   merely flags it depending on mode. → *After the gate.*
6. **Diversity penalties are the largest numbers in the engine** (−45 formula, −40 top), and shoes
   are the cheapest core slot to repeat at −20. → *After the gate → diversity.*
7. **`signature` / `strong` / `usable` are positional labels**, assigned by index. → *After the
   gate.*
8. **The `fiber_content` gap is latent, not live** — no garment currently escapes hot-weather
   gating through it. → *The gates → gate-field coverage.*
9. **Neither browser cache can serve stale data** — both consumers revalidate on open. → *Caches.*
10. **The capsule occasion-breadth term caps exactly at the wardrobe's ceiling** (4), so it can
    never reward more range than the tagging vocabulary has. → *Scoring.*
11. **A five-outfit set cannot avoid a −45 formula repeat.** There are exactly four formula
    families for separates outfits, and two hold 82% of them. → *After the gate → classifiers.*
12. **The pattern classifiers cannot see a third of the patterned wardrobe** — they regex over
    piece names and never read the populated `pattern_type` column; `botanical`, `geometric`,
    `paisley`, `polka dot` and `lace` have no matching term. → *After the gate → classifiers.*
13. **`repairWholeWardrobeOutfit` does not fill missing slots.** It rewrites prose; its only
    garment substitution is a single shoe swap that can fire under the `hiking` activity profile
    alone — the one profile with a populated `required_footwear`. → *After the gate → repair.*
14. **The engine's strongest positive signals have never been switched on.** `pieces.favorite` is
    0 of 236 and `saved_boards.favorite` ("Use strongly") is 0 of 237, disabling four scoring terms
    including the `+45` high-authority board branch. Both controls are fully built and wired. →
    *Scoring → dead terms.*
15. **Pair-history terms are silent even on the most-annotated pieces** — 0 of 1410 pairs hit a
    confirmed or rejected pairing note; feedback influence fires on 0.9%. → *Scoring →
    compatibilityScoreForSelectedItem.*
16. **The `gpt-image-1` fallback renderer reports no cost**, because it never sets `timings.usage`
    and the cost line returns null without it — a billed generation that displays nothing. → *The
    image-generation path → cost reporting.*
17. **"Measured cost" is half-measured.** The image term — the dominant one — is a client-side flat
    constant ($0.08 / $0.04 by size string), not a measurement, and the server's pricing table has
    no image model in it at all. → *The image-generation path → cost reporting.*
18. **A second `photoPreservingVisualsEnabled` exists in `rules.js` that ignores mock mode**, and
    `routes/ai.js` — where the image endpoints live — imports that one. It is never called, so the
    mock-mode protection holds today; deleting the duplicate removes the trap. → *The
    image-generation path.*
19. **The editorial image prompt has no length clause, and length is the top render complaint.**
    `length_hits_at` is populated on 207 of 236 pieces; `anchorFidelityInstructions` derives rules
    from name and notes only and never emits a length instruction; the renderer memory is
    dominated by "rendered too long/short" corrections. 49 pieces produce no anchor fidelity
    instruction at all. → *The image-generation path → prompts.*
20. **Three regexes answer "is this patterned?" and all three disagree** — the `pattern_type`
    column says 90, the image fidelity checklist sees 60, the diversity classifier sees 72. →
    *The image-generation path → prompts.*
21. **The whole-wardrobe image prompt truncates piece truth text at 900 chars; the median is
    1,130**, so 169 of 236 pieces lose their tail — `fit_on_body`, tuck behavior, occasions and
    trust status are last in the string and fall off first. → *The image-generation path →
    prompts.*
22. **The renderer memory is one memory system that demonstrably works** — 6 real correction lines
    on the live database — and it is the sole consumer of the image-fidelity feedback types that
    are deliberately excluded from styling influence. → *The image-generation path → prompts.*
23. **The import cost gate under-quotes by ~1.6x.** The preflight prices tagging at 6,000 input
    tokens per garment; the prompt text alone is 6,097 before any image, and the real payload is
    ~9,880. It is the one place the app asks permission before spending. → *The tagger prompt.*
24. **`elevated` has not drifted — it is the wardrobe's most curated field.** 202 of 236 pieces
    carry an owner-corrected `formality`. Of the 52 elevated-and-casual conflicts, 49 have
    owner-set formality and only 5 have owner-set occasions, so the gate is reading the
    authoritative column. This **withdraws an earlier recommendation** in this document. → *The
    tagger prompt → owner corrections.*
25. **The tagger calibrates on owner corrections only.** `buildAnchorBlock` skips any piece whose
    field is not in `manual_overrides`, so the 18 anchors sent are a feedback loop on manual
    fixes — and per-tag cost grows as the wardrobe gets better curated. → *The tagger prompt.*
26. **71% of the wardrobe was tagged before the photo-authority prompt existed** (167 of 236
    unversioned). Where it ran, low-confidence `length_hits_at` drops from 81% to 42% — so the
    length problem is stale tag data first, prompt construction second. A re-tag costs ~$11 and
    cannot overwrite owner corrections. → *Provenance.*
27. **The tagger reports `low` confidence on ~85% of its own structural predictions**, and low
    confidence does not suppress the value — it ships to the image prompt with an
    "[low confidence - add worn photo]" disclaimer attached. → *Provenance.*
28. **Three trust-gate columns have never been corrected by anyone** — `heel_height`,
    `recommendation_status` and `role_permission` are 100% tagger-set, and the latter two are the
    same columns shown to be non-discriminating under *Scoring*. → *Provenance.*
29. **[bug] The singular/plural gap — six core keywords never fire at all.** `jean`, `sneaker`,
    `loafer`, `clog`, `pointed heel`, `tailored trouser` and `linen short` match **zero** pieces
    because the engine tests word-boundaried singulars against plural garment names; they are
    referenced at 16, 8, 25 and 4 sites. `boot` is used at 28 sites and matches one garment.
    19 keywords, 122 garment-matches lost. **This understates other distributions in this
    document** — the "93% rounded" shoe-shape uniformity is largely this bug. **But a blanket
    `s?` sweep is the wrong fix**: measured both ways, it fixes shoe shape (93%->53%) and makes
    grounding *worse* (47%->80%). → *The singular/plural gap.*
30. **`trustedField` drops low-confidence values; `trustedFieldText` annotates them.** The role
    classifier uses the dropping variant, so `silhouette` reaches formula-family classification on
    38 of 236 pieces and `fit_on_body` on 35. → *Roles.*
31. **A third of the role vocabulary is matched by no archetype.** Tagger-written `hero`,
    `support`, `grounding`, `texture_piece`, `color_accent` and five others are produced on every
    generation and scored on by nothing; the archetypes use the code-written `*_piece` forms. →
    *Roles.*
32. **`extract-pieces` output is trusted more than the tagger's, on less evidence.** It emits no
    `_confidence` map, so `getFieldConfidence` defaults its fields to `medium` — while the real
    tagger self-reports `low` on ~85% of the same fields. It also sends no calibration anchors, no
    photo-authority rules, and no `style_profile_json`. → *`extract-pieces`.*
33. **The `gpt-image-*` fallback chain has exactly one live caller.** The five main producers
    hard-code `gpt-4o`; only the editorial path can reach it, and it can attempt up to five billed
    generations before falling back to an SVG placeholder. → *The image-generation path.*
34. **`fiber_content` has a live wet-exposure gap, not just the already-documented latent
    hot-weather one.** Two owned pieces — "burgundy suede cork wedge sandals" and "taupe suede
    ankle boots" — name `suede` in their own title but have empty `fiber_content` and
    `fabric_category = 'other'`, so `pieceHasWetSensitiveFootwearMaterial` returns false and
    neither is excluded from a wet-exposure request today. The parallel capsule-scoring consumer
    checked clean (0 pieces affected, and it's additive scoring rather than a hard gate regardless).
    → *The gates → Gate-field coverage.*

## Still to map

- **`getRelevanceScore`'s occasion/activity profile terms per-context.** Its structure and weights
  are recorded under *Scoring*; the profile-rule terms (±8 materials, ±10 footwear, −10 pieces)
  fire off merged profile lists that vary per request, so a firing rate needs a context matrix
  rather than a single wardrobe pass. `scratch/measure_scoring_terms.js` is the place to extend.

Every area the first pass listed as unmapped is now covered, and the follow-on gaps each pass
opened have been closed in the next. What is left:

- **The comparison-sheet and identity/edit prompts** — `wholeWardrobeComparisonSheetPrompt` is
  summarised under the producers table but its layout rules are not walked line by line, and the
  `kind: 'identity'` image-edit branch of `runOpenAIImageGeneration` has no live caller to trace.
- **The surface map's own thin spots** — per-endpoint mapping (106 endpoints), onboarding step
  content, and the import review-gate UI. Those belong to `docs/app-surface-map.md`, not here.

**Before acting on any keyword-derived number in this document**, re-measure it plural-tolerant:
`node scratch/measure_plural_gap.js`. Before resolving any conflict between two columns, check
provenance: `node scratch/measure_provenance.js <colA> <colB>`.

**To check this map is still true:** run the scripts — `derive_surface_skeleton.js`,
`derive_engine_behaviours.js`, `measure_scoring_terms.js`, `measure_gate_impact.js`,
`measure_diversity_classifiers.js`, `measure_image_path.js`, `measure_roles.js`,
`measure_plural_gap.js`, `measure_provenance.js`, and `measure_open_questions.js`. They report mechanisms and numbers; they cannot tell you an entry has
gone *wrong*, only that the shape underneath it moved.
### Seasonal capsule bounded composition

For a seasonal capsule, deterministic roster selection and slot-capacity checks happen before the
single bounded model composition call. The composition response schema requires exactly the sum of
the requested slot counts; an empty or partial array is not a valid successful response. The
output-token ceiling scales with the requested representative-look count (within a fixed cap), but
billing remains based on actual generated tokens rather than that ceiling.

If the bounded composer nevertheless returns no outfits, `plan_outfit_set` returns an engine error,
locks the atomic attempt, and exposes no alternate outfit-building tools for that turn. It must not
report zero accepted cards as success or invite the conversational model to reconstruct the capsule
slot by slot.

### Amendment (2026-09-12) — the corrective layer pass is deleted; thermal amount is judged across configurations

Two entries above are superseded.

**The corrective pass is gone, not disabled.** `reviseWholeWardrobeOutfitsForLayerFit`,
`makeLayerRevisionContactSheet` and `WHOLE_WARDROBE_LAYER_REVISION_SYSTEM` have been removed. Its
application step dropped every outerwear-category piece and appended one replacement — destroying a
legitimate `layer_top` + `outerwear` composition and adding a layer to a card that had none, while
its own comment claimed it never added a garment. Changing its trigger underneath that application
would have been unsafe, and leaving it unreachable would have invited its revival. The debug key
`finalSelection.layerRevision` survives and reports `{ attempted: false, parked: true, reason }`, so
a run still discloses that no repair was attempted. The contract any replacement must satisfy —
deterministic per-card repairs, swap-only, role and wear order preserved, re-gated, per-direction
acceptance, prose consistency — is written at the top of the corrective-pass section of
`test/aiEndpointContracts.test.js`.

**Thermal amount is no longer a single-target comparison.** `evaluateOutfitEnvironmentalAdequacy`
now judges configurations against the two PET endpoints via `wornConfigurations` and
`evaluateEndpointFit`; adjacency is ranking evidence (`evidence.endpointFit`) and only a substantial,
single-direction, fully-known mismatch produces `THERMAL_UNDERSHOOT` or `THERMAL_OVERSHOOT`. Severe
cold still runs off `isColdSevere` — which decides whether the PHYSICAL backstops run, never what
the thermal demand is — while its capacity measurement moved from the retired `systemColdScore`
floor to the same PET-endpoint evaluator (`evidence.severeColdFit`). With severity but no
temperature, thermal amount is `no_target` and produces no finding; 45/45 is the fixture proving the
severe classifier and the PET target can legitimately disagree. See
`docs/thermal-comfort-band-spec.md` §25.8 for the full contract, including the unknown-evidence
semantics and the one live outcome that changed severity.

**Not in these commits, and deliberately so:** the calendar-season hard exclusion from supply remains
unratified and unimplemented — the roster ranks out-of-season pieces down and excludes nothing.

### Amendment (2026-09-14) — sleeve geometry is log-only across production

**Owner ruling.** Sleeve shape and relative length cannot establish layering compatibility, and no field records sleeve structure or compressibility (`docs/stage1-cause-matrix-2026-09-14.md` §1, §10a). The geometry verdict is now log-only everywhere, and every model-facing layering rule states one neutral sentence.

**What changed.**
- **Evaluator.** `evaluateWearableOutfit` still runs `evaluateLayerPairConstruction` (pairs and chain fold) when `includeLayerDirections` is set, but the `layer_construction` stage is marked `shadow`. Its findings appear only in `shadowFindings` and `evidence.shadowStages`, never in `findings`, `hardFindings` or `advisoryFindings`.
  - **Consequences.** It cannot make an outfit invalid, reject or demote a card, exclude a backfill or repair candidate, trigger a repair or substitution, or become a system note or flag.
  - **Thermal configurations.** The thermal evaluator's worn configurations are no longer filtered by the construction verdict; only a caller-supplied validator can mark one invalid.
- **Model-facing text.** `layerConstructionPromptRule()` returns only `NEUTRAL_SLEEVE_LAYERING_STATEMENT`: "Sleeve shape and relative sleeve length alone do not establish whether two garments layer. Inspect the photographs for sleeve structure, compressibility and the intended treatment, and state uncertainty when the evidence is insufficient." That covers the Whole Wardrobe and selected-piece composer system, the `propose_outfit` tool description, and the plan/capsule workbench. The same sentence also replaces:
  - the categorical "Layering & Sleeve Physics" bullet in `PHYSICAL_WEARABILITY_REALISM_RULES`;
  - the missing-layer repair prompt's sleeve wording, which now also says sleeve compatibility is not decided mechanically;
  - `garment_fact`'s instruction to treat a computed layering verdict as authoritative.
- **`garment_fact`.** It no longer receives a "Layering evidence (computed)" block.
- **Debug.** The verdict remains in structured debug: Whole Wardrobe `debug.sleeveGeometryShadow` (per composer card, rehydrated garment facts) and `propose_outfit` card `debug.sleeveGeometryShadow`.

**Scope note.** Whole Wardrobe card validation never ran the construction stage (it does not set `includeLayerDirections`). In Whole Wardrobe the verdict acted only through the missing-layer repair candidate screen. It acted directly in `propose_outfit`, where it was a blocking finding in freeform turns and a model-facing note in single-outfit turns, as well as in plan/capsule validation, the thermal configuration filter and `garment_fact`.

**Pins and tradeoff.** `test/sleeveGeometryLogOnly.test.js` uses the owner's recorded facts under the fitted puffer 996866:
- 144 (ruched turtleneck) and 184 (voluminous patchwork knit) are not rejected;
- **238 (substantial knit cardigan) is also not mechanically rejected**, a deliberate temporary false negative until a sleeve structure/compressibility dimension exists, because shape evidence alone would reject the wearable 144 and 184 too.

The file also covers prompt text, gate and backfill. Cross-flow route tests (LOG-ONLY SLEEVE GEOMETRY, `test/aiEndpointContracts.test.js`) cover Whole Wardrobe delivery, missing-layer repair candidates and `propose_outfit` in single-outfit and freeform turns.

**Ranking A/B (required).** `scratch/rankings_ab_diff.js` against a copy of the pre-change working tree, on the frozen Stage 2 snapshot, reported **0 scenarios with differences** in capsule rosters, benches and plan workbenches. The production Whole Wardrobe composer request for S1–S3 was also captured before and after: roster (83 garments, same order), user text, image bytes and token budget are identical. The only change is two system-prompt lines, the sleeve-layering rule and the physical-wearability sleeve bullet, both now the neutral sentence. No eligibility or ranking difference exists to attribute.

**Not in this change.** No sleeve taxonomy field, no new compatibility rule, no broader construction logic.

### Amendment (2026-09-13) — sleeve construction is judged across the worn chain

`evaluateLayerPairConstruction` now folds the assigned wear chain inside-out
(`chainConstructionFindings`) in addition to comparing adjacent pairs. Accommodation no longer erases
volume: a layer judged able to contain an elevated sleeve still presents that volume to the next
layer, so a gathered sleeve under an accommodating cardigan under a narrow, structured outer sleeve
is now a **hard** `layer_construction_sleeve_conflict` — the same code and severity the direct-pair
case has always produced, carrying the origin garment, the zone, and the intermediate layer the
volume is still inside.

**Superseded 2026-09-14:** the chain fold still computes this verdict, but it is log-only shadow evidence, never a hard finding. See the 2026-09-14 amendment above.

Scope and limits, all deliberate:

- **Propagated volume only.** A conflict with the garment directly inside is the pair rule's finding;
  the fold never re-reports it. Two-garment outfits are unchanged — verified across all 3060
  top × outerwear pairs in the owner's wardrobe.
- **One owner.** Construction lives in `evaluateLayerPairConstruction`; `evaluateLayerDirections`
  answers only which garment is worn over which. `evaluateWearableOutfit` composes both stages, so a
  chain fold in either one would report a single conflict twice — which it briefly did, and
  `test/outfit_structure.test.js` now pins uniqueness through the composed evaluator.
- **Qualitative.** The existing `elevated`/`none`/`null` and `accommodates`/`restricted`/`null`
  vocabulary, with no magnitudes, no counting of cuffed layers and no fabric-weight arithmetic.
- **Unknown propagates and never hard-fails.** A conflict requires both participants known to have a
  sleeve; anything unresolved is a mandatory visual review instead.
- **Sleeve length is not a bulk proxy.** Rejected during review for lack of evidence; see
  `docs/garment-field-reference.md`, which also records sleeve wall thickness as an unresolved
  dimension pending its own audit.

Live `thread_1789274442146` is the origin: the model held photographs of all three garments, composed
the card anyway, and justified it by asserting that the puffer's ribbed TORSO panels supply sleeve
capacity. Visual judgment alone was not an adequate enforcement layer — the engine returning nothing
is what left the invention unchallenged.

### Amendment (2026-09-13) — the missing-layer repair pass, and the nested debug boundary

Live `thread_1789274358263`: five cards at 65/50, **four** carrying `NO_REMOVABLE_COOL_LAYER`. Every
one was detected, `visualDebugLog.advisorFlaggedCount` counted them, and nothing consumed that
number — detection with no return path. The set shipped knowing four of its five cards lacked the
configuration the conditions call for.

**One bounded missing-layer repair pass** now runs after the gate. It is not the retired revision
pass, which mutated piece lists field-wise (dropping every outerwear garment and appending one
replacement). This one:

- fires only when **both** halves are real — at least one card carrying the configuration finding
  AND at least one shown layer that suits the conditions — so a wardrobe with no adequate layer pays
  nothing;
- sends each deficient card back with **its own garments' photographs and structured lines**, plus
  the layer candidates', the same evidence the composer had (sleeve construction added, since that
  decides whether a layer can be worn over that base);
- asks for **one layer added** to a card whose other garments are preserved. The card is rebuilt
  from the ORIGINAL pieces plus that layer; the model's `pieceIds` is a tamper check, never the card
  (a disagreeing list is rejected as `not_a_layer_repair`);
- validates the whole resulting card through the complete evaluator (`evaluateWearableOutfit` with
  roles, structural caps, wear order, sleeve construction and the weather stage), then applies
  **typed acceptance**: the original configuration finding is gone, no NEW hard finding appears, and
  no new weather or construction deficiency is introduced. A new *unknown* is not a deficiency —
  inability-to-judge findings (`*_unknown`) never block a repair, because absence of evidence is
  not a fault and 122 pieces in this wardrobe have no recorded sleeve length;
- is capped at one batched call and is never recursive.

**Tier 2 (owner ruling):** when repairs are declined or rejected, the cards ship **unchanged** with
their own advisory — the engine never adds a garment deterministically and never drops a card — and
the run returns `coolLayerSetDisclosure`, one set-level sentence naming how many cards still have
nothing to put on. The advisory stays advisory; what changed is that the set can no longer ship a
known deficiency silently.

**The repair's bench is not the composer's shortlist (2026-09-13).** Candidates are sourced from
`recoveryEligiblePieces` — the existing authority for "omitted only for presentation or capacity,
never rejected by a validity gate", already used by the comfort-footwear repair.

*What the live run actually did:* `thread_1789288270913` offered seven candidates —
`[996866, 88, 131, 996760, 996762, 159, 990362]` — so the navy puffer **was** shown to that repair.
Under the code active during that run, `996759` and `996761` were register-excluded, while `996767`
and `996764` were cap-cut.

*Current-branch replay* (same wardrobe, occasion and 65/50 weather, after the register change):
**33** hard-eligible outerwear pieces, **25** of them weather-qualifying, against **7** the composer
shows — so 18 qualifying layers would be invisible to a repair that inherited the roster's
presentation cap. Image cost measured from the live run's telemetry is ~1,081 tokens per image
(37 images ≈ 44k input tokens for a four-card repair), small enough that the full bench is shown
directly and no shortlisting stage was added. This matches PR 315 (broad trip bench, model-owned
roster selection, then full catalog/photo visibility for the selected roster) and PR 316 (complete
sparse catalog → model-selected visual workbench): a later stage gets the full eligible set rather
than the first stage's presentation cut.

**Nested debug boundary.** `generate_outfits` reached through `/ask` previously kept only
`result.debug.composerUsage`, discarding the composer's whole `visualDebugLog`. That is why
thread_1789274358263 could not be explained from its own record. `toolContext.freeformDiagnostics.nestedComposer`
now carries `finalSelection` across, along with the resolved exposure.

**Resolved exposure** (`visualDebugLog.resolvedExposure`: activity, weather source, high/low,
cold-presence state) is recorded in RUN debug, not stamped on every card — no card renderer consumes
it, and a per-card copy would duplicate what the run already knows. It is what lets a capture verify
that `sedentary` versus `hiking` actually reached evaluation.

**Closed 2026-09-13 (live thread_1789341140366 made it concrete: `visualClashReview.reviewedCount: 0`
while four repaired combinations shipped).** The clash critic still runs before the repair on the
composer's own cards; a second review now runs afterwards, scoped to the repaired subset only. A
repaired card the critic rejects is RESTORED to its original form with its weather advisory and
rejoins `coolLayerSetDisclosure` — never re-repaired, never dropped. Recorded under
`layerRepair.repairedCardReview`.

**Season ranking is separate evidence.** For that run the signal ran and was honoured by the roster:
the warm-season pieces that survived (beige wide-leg trousers, pink ballet flats, grey sneakers) each
carried `season: tagged warm-season clothing; this is a fall trip (−6)` and ranked 32nd, 56th and
58th of 82. That proves the signal reached ranking — not that the model preferred what it ranked
higher. The calendar-season exclusion remains parked and unratified.

### Amendment (2026-09-13) — register is a preference below a stated dress code, and capability outranks it

Live `thread_1789288270913`: an ordinary "five casual outfits" request excluded **80** owned pieces
as `prohibited` — 27 tops, 18 dresses, 13 bottoms, 11 outerwear, 11 shoes — while four `elevated`
BASE garments shipped in the same set. There was never a category rule. The survivors carried an
explicit `casual` occasion tag and the excluded pieces did not, so the effective rule was *"elevated
is invalid for casual unless you already typed casual onto this piece"* — tagging completeness in
the costume of occasion invalidity. The pre-existing explicit-tag exemption is the proof: if one
rank up were genuinely invalid, an owner tag could not make it valid.

**The rule now** (`registerCeilingVerdict`, `registerCeilingIsExplicit`):

| ceiling source | any distance above |
| --- | --- |
| wearer stated a MAXIMUM ("nothing above casual", "nothing dressy") | `exclude` |
| occasion default, activity default, or a stated TARGET | `above_request` — eligible, ranked down **by distance** |

**No ordinal cutoff survives without a stated maximum** (final ruling 2026-09-13). The one-step bound
came from Amendment 1 (2026-07-30), which the record itself calls a preference *"marked for revisit
during testing"* — not an independently provable incompatibility. A dressy garment for a casual
request ranks poorly without being declared invalid; what makes a piece invalid is the wearer saying
so, or an independent physical gate.

**Register is strictly subordinate to weather adequacy.** The advisory scales per rank
(`REGISTER_ADVISORY_PER_RANK`) and is then floored at `REGISTER_ADVISORY_FLOOR` — one less than the
thermal band's smallest adjustment magnitude — so a weather-appropriate candidate can never be
displaced by a weather-inadequate one on register distance alone, at any distance and under any
ceiling. This is an invariant, not arithmetic luck: measured before the floor existed, the ordering
held at one rank (weather ahead by 14) and two ranks (by 8), but a three-rank distance would have
inverted it. Reproduce with `scratch/audit_register_ranking_subordination.js`, which prints the
paired comparisons and exits non-zero on any inversion.

**A target is not a maximum.** "Casual outfit" and "something dressy" say what the wearer is going
FOR; neither says what they will not wear. Only a stated maximum is a constraint.

**An activity's register ceiling is not a capability claim either** (owner ruling 2026-09-13).
Formality does not establish whether a garment can physically serve an activity — movement
allowance, footwear support, maintenance/delicacy, construction and weather protection do, and each
keeps its own hard gate. An elevated fleece is the case that settles it. The consequence, recorded
rather than hidden: **nothing hard now excludes an elevated city trench from a hiking slot.**
`required_occasion_tags` is deliberately `discouraged, never prohibited` (ratified 2026-06-12, so a
day dress stays allowed for outdoor-active) and applies only to top/bottom/dress, so register was
the only gate reaching outerwear there. The trench is now eligible and must be beaten on ranking;
`rosterFitScore` gained the shared register advisory so the plan path ranks it rather than merely
admitting it.

**Authority for the retired two-rank cutoff.** Asked and answered from the record rather than from
tests: `docs/occasion_profiles_ratification.md` — *"Ratified Amendment: Register Ceilings For Roster
Gating"* (2026-07-05) established that a ceiling excludes pieces above it, and *Amendment 1*
(2026-07-30) capped the explicit-tag exemption at one register step, measured at the time (52
tagged-casual pieces above the ceiling: 50 `elevated` admitted, 2 `dressy` excluded). Both were
intentional; both were preferences, and Amendment 1 was explicitly marked for reassessment. The
owner's 2026-09-13 ruling completes that reassessment: preferences rank, constraints gate. The
ratification table's ceilings remain — as ranking targets.

**Every consumer receives the distinction explicitly.** `profileRuleFit` defaults
`registerCeilingExplicit` to `true` so an un-migrated caller fails closed, which is safe but silent —
and that silence is exactly how the automatic-use pool went on suppressing one-rank-above pieces
after the composer had been migrated. That pool runs UPSTREAM of `recoveryEligiblePieces`, so
anything it drops is unavailable to composition and repair alike. The audited call sites, all now
passing it: `wholeWardrobePieceTrustDecision` (automatic use), `locallyGateWholeWardrobeOutfits`,
`buildVisualComposerRoster`, `search_wardrobe`, the swap tool, the plan slot pool, and the
selected-anchor check in `core.js`. `test/register_explicitness_cross_consumer.test.js` drives one
garment pair through all four flows and asserts, by scanning the sources, that no `profileRuleFit`
call passes a ceiling without its explicitness.

**Negation defect fixed (was recorded as pre-existing).** `resolveFormalityIntent`'s negation
alternation was `not|no|avoid|less`, so "nothing dressy" matched nothing, survived the stripping step
and was read by the positive matcher as a dressy TARGET — raising the ceiling to dressy and admitting
exactly what the wearer excluded. The vocabulary now includes `nothing|none|never`, and an explicit
maximum ("nothing above casual") is recognised in its own right and expressed through `intent.avoid`
over the rank ladder.

**Both consumers changed, not just the composer.** `profileRuleFit` returns `discouraged` rather
than `prohibited` for the default case, so `search_wardrobe` returns the piece in compose mode and
stops describing it as prohibited under `intent: 'explain'`. The prohibited tier holds prohibitions.

**Capability outranks register at the roster boundary.** Register is a −6 relevance advisory, the
same weight as the season advisory and deliberately smaller than the thermal band's ±10. Inside the
cold-coat reserve the endpoint evaluator's ranking distance is the PRIMARY key and register only
separates coats of comparable capability. An intermediate version made register an absolute sort key
and was measured evicting a warm wind-protective layer for a less suitable elevated coat — the exact
priority inversion the ruling forbids. `test/outfit_structure.test.js` pins the key ORDER.

**Measured on the owner's wardrobe** (casual, 65/50, fall): register exclusions 80 → 15 (dressy
only); roster 82 → 83; 8 elevated pieces enter, 7 everyday leave under the per-category cap. Every
one of the seven lost on capability or season, not on register: the two dropped dresses carry
`thermal band: lighter than the conditions call for (−20)` plus a warm-season penalty; both dropped
bottoms carry −10; and the dropped puffer (996866) sits at ranking distance **1.125** from the
`warm` layer demand while the elevated coat that replaced it (996867) sits at **0.25** with the same
`warm` level and the same wind protection. The capability ordering promoted a better-matched coat;
it did not trade capability for register.

**Ranking A/B for the register scoring change** (`scratch/rankings_ab_diff.js`, owner wardrobe).
Run against an **isolated baseline**, not against `HEAD`: a copy of this working tree with only the
register delta reverted (`registerCeilingIsExplicit` forced true, the ranking advisory zeroed), so
every other change on the branch is held constant. Build it with
`node scratch/audit_register_ranking_subordination.js --baseline`, which prints the path to pass to
`rankings_ab_diff.js --baseline-dir` and fails loudly if `rules.js` no longer has the entry points it
patches. The diff is identical to the HEAD-based run,
which is what establishes that these differences come from the register change and from nothing
else on the branch. **9 scenarios differ**, all from the same cause — an inferred ceiling no longer
removing pieces from eligibility:

- *Eligible supply grows*: summer 220 → 231 (85T 56B 18D 33O 28S → 87T 58B 21D 34O 31S), winter
  +1T +1B. These are one-rank-above pieces that were previously `prohibited`.
- *Per-slot capacity rises* (Casual/Home/Errands 44 → 59, At Home 8 → 15): the same pieces, now
  countable toward a slot's supply.
- *Bench membership shifts*: out 996788, 990441, 139; in 208, 246, 996794. The additions are
  `dressy`/`everyday` pieces whose occasion tags put them one rank above the capsule's register, now
  competing on rank; the drops are within-register pieces they outranked on the bench's own
  target-fill, not pieces the register rule removed.
- *Freeform workbench assessments change for 3 pieces* (256, 141, 996778) — all `elevated`,
  previously absent from the assessment list because they were gated out, now present and ranked.

No difference is unexplained, and none is a piece losing eligibility.

On the owner's own wardrobe at 65/50 casual, register exclusions are now **0** (from 80 before this
arc): the roster carries 56 everyday, 24 elevated, 2 dressy and 1 lounge, with the cap — not the
register — deciding what fits. Nine pieces enter and eight leave, every departure explained by
capability or season rather than register (see the ranked adjustments recorded per piece in
`debug.relevanceAdjustments`).

**Known pre-existing defect, recorded not fixed:** `resolveFormalityIntent` matches the register WORD
and drops the negation, so *"nothing dressy"* resolves to a dressy TARGET and raises the ceiling to
dressy, and *"nothing above casual"* is not recognised at all. That now also decides whether a
ceiling is hard. Fixing it means touching prose parsing shared with the rest of formality intent and
needs its own review; `test/outfit_structure.test.js` pins the behaviour so it cannot be mistaken for
intent.

### Amendment (2026-09-13) — conservative critic, delivered repair accounting, diagnostic-card evidence

Live `thread_1789346300319` exposed three defects in the repair work and one composer failure.

**The clash critic is conservative.** It answered flag-or-pass, flagged "colors that clash despite
similar tags", and received taste-suppression memory — so it restored a conventional navy-stripe /
olive-cargo / grey-cardigan repair on a tone-harmony opinion. It now answers `reject`, `note` or
nothing: reject only for a clear photograph-grounded failure (prints fighting, a garment plainly
wrong in place); colour harmony and uncertainty are notes that attach a Visual note. Anything not
literally `reject` is a note. The critic no longer receives suppression memory. Why the busier
tank / botanical-skirt / grey-fleece card passed while the conventional one was restored was not a
judgement inconsistency: the pre-repair critic only sees cards with two or more patterned pieces, so
the botanical card (one pattern) never reached a model critic, while the repaired-card review sends
every repaired card to the model.

**Repair accounting describes what ships.** Accepted counts (`acceptedRepairCount`,
`acceptedCleanCount`) are fixed at validation; delivered counts are recomputed after the
repaired-card critic restores anything. The live run had reported 3/3 while two repairs shipped.

**The disclosure counts ready outfits only** — the live run said "1 of these 5" over four ready cards
and one broken diagnostic.

**Diagnostic cards keep all their evidence.** A structurally invalid model card stays visible during
development with its original fields verbatim, marked broken/diagnostic, and now carries every
structural finding (`structuralFindings`); it previously recorded only the first. It is excluded from
ready counts, repair targets and the disclosure denominator only. No partial-card local backfill:
backfill remains a last resort for a composer that returned nothing.

**The spliced fifth card was emitted by the model**, established by elimination because provider
capture records inputs only: `unresolvedReferences` was empty, de-duplication and
`normalizeWholeWardrobeOutfitObject` are per-card, saved-variant mode was off, and the diagnostic
builder only appends `: standard wear` to the model's own label. `modelMissingMainRejected` never
measured a missing top (it counts cards missing the saved main piece in saved-variant mode), and
`proseIntegritySanitizedCount` only checks `ID 123` citations, deliberation phrasing and skirt/pants
silhouette words. The durable fix — provider-enforced structured output with category slots — is
proposed separately rather than more prompt prose, since the captured prompt already prohibits two
bottoms.

### Amendment (2026-09-13) — atomic structured composer output

The spliced card in `thread_1789346300319` was not answered with more anti-splicing prose; the captured
prompt already prohibited two bottoms. Both visual composers (whole-wardrobe and selected-piece, which
share `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM`) now call `askStylistStructuredWithUsage` with
`COMPOSER_OUTFIT_SLOTS_SCHEMA` (`styling-engine/composerSlots.js`): six nullable integer ID slots per
card, every field required, `additionalProperties: false`, no per-slot enums and no `anyOf`, so one
schema serves OpenAI (strict json_schema), Anthropic (forced tool) and Gemini (`response_format`).
Gemini acceptance was checked by one text-only probe (2026-09-13, `gemini-3.5-flash-lite`, 175 input /
373 output tokens, ≈$0.001): the schema — nullable integer slots plus `minItems`/`maxItems` — was
accepted, both cards came back with exactly two outfits, unused slots as `null`, and zero slot findings.
One compliant answer shows acceptance, not strict enforcement, so local validation remains the
guarantee. If a provider ever refuses the schema, the composer call fails into the existing
`composerError` path; it is not silently simplified. The image-bearing composer call itself has not
been run under the schema yet.

What the schema does not make unrepresentable is checked locally by `resolveComposerSlotOutfit`, and
the shared `evaluateWearableOutfit` still runs on every card:

| Slot | Admits (from `ROLE_CATEGORY_EXPECTATIONS`) | Role it states |
|---|---|---|
| `base_top_id` | top | `primary_top`; `layer_top` beside a dress (a top worn under it) |
| `bottom_id` | bottom | `primary_bottom` |
| `dress_id` | dress | `dress` |
| `middle_layer_id` | top or outerwear | `layer_top` |
| `outer_layer_id` | outerwear | `outerwear` |
| `shoes_id` | shoes | `shoes` |

**Count.** `composerOutfitSlotsSchema({ minOutfits, maxOutfits })` puts the requested count in the
schema — exactly `limit` for whole-wardrobe, 3–4 for selected-piece (the same range its user message
asks for). OpenAI strict mode and Gemini `response_format` enforce `minItems`/`maxItems`; an Anthropic
forced tool treats them as guidance. `composerOutfitCountCheck` records `{ minOutfits, maxOutfits,
returned, withinRequest }` on every provider; a mismatch is reported, not repaired — shortfall keeps its
existing path and extras are cut by the flow's own limit.

**Diagnostic de-duplication.** Ready cards stay de-duplicated by garment set. Model diagnostic cards are
de-duplicated by slot signature (`modelSlots`), or card index when absent, so a slot-misassigned card
using a ready card's garments is shown. Garment keys are still recorded for the unchanged local-fill
diagnostic loop.

**Direction wording.** The composer projects `layerDirectionPromptRule({ vocabulary: 'slots' })` — the
same evidence rule stated in `middle_layer_id`/`outer_layer_id`/`base_top_id` terms — so the prompt
carries no `layer_top`/`primary_top` vocabulary it does not emit. `propose_outfit` and the set planner
keep the role wording.

Permitted: top+bottom; dress alone; top under a dress; a middle layer over top or dress; an outer
layer over any valid base; middle plus outer. `test/composerSlots.test.js` proves each is valid under
both the category and the role-aware evaluator. Top-under-dress plus middle plus outer is four
upper-body pieces and was already `too_many_upper_layers`; it stays invalid. Slot findings:
`slot_category_mismatch`, `unknown_piece_id`, `duplicate_slot_piece`, `invalid_slot_value`,
`missing_shoes`, `missing_top_or_dress`, `missing_bottom`, `dress_with_bottom`, and on the
selected-piece flow `missing_selected_anchor` (reported first). Evaluator findings that repeat a slot
code are dropped as the same fact.

Nothing is derived or inserted. Stated slot roles are the only roles on a composer card
(`deriveWholeWardrobeRoles` no longer runs for it); a misplaced garment stays on the card with no role;
stale IDs are no longer rescued by name; the selected anchor is no longer unshifted into a card that
omitted it; required-footwear repair on the selected-piece flow runs only on cards without slot
findings. Every invalid card is preserved as a diagnostic / Needs review card carrying `modelSlots`.

Known limits, recorded rather than changed here:
- The role vocabulary cannot say which of a top and a dress is outside; `base_top_id` beside
  `dress_id` means "under" to the model, but the direction evaluator still decides from garment
  evidence, as before.
- Selected-piece required-footwear repair replaces the shoe object without carrying its `role`; that
  flow validates by category, so nothing reads it today.

**Raw output capture.** `lib/providerInputCapture.js` gains an `output` stage, on whenever
`WARDROBE_CAPTURE_PROVIDER_INPUT_DIR` is set and written to the same directory — a complete capture
needs no second variable — written from `askStylistWithUsage` and
`askStylistStructuredWithUsage` before any parsing (Anthropic structured calls record the raw content
blocks). Input and output records of one call share a `callId`; `askStylistStructuredWithUsage` now
takes a `subflow` (the composers pass `whole_wardrobe_visual_composer` /
`selected_piece_visual_composer`; the router keeps `execution_router`, which it was previously
hard-coded to for every structured caller). The tool loop is covered too (2026-09-13, Stage 1
contract): every `stylist_tool_loop` turn records its raw response before parsing — Anthropic content
blocks, the OpenAI message with unparsed tool-call arguments, and Gemini's status and steps (captured
before the usability check, so an unusable turn is kept). Wire records carry `callId` too, and every
single-shot call (`askStylistWithUsage`, including its Anthropic path through `askClaudeWithUsage`, and
`askStylistStructuredWithUsage`) now records the exact SDK request object as its wire capture. So every
captured call, tool-loop turns included, has exactly three records — normalized, wire, output — sharing
one `callId` and `iterationIndex`. `test/providerCaptureCallIdPairing.test.js` drives the real functions
for all three providers against stubbed SDK methods and asserts this.


### Amendment (2026-09-13) — A/B instrumentation: neutral-verdict flag and Stage 1 preflight harness

`WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS=true` (read at call time, default off, payloads byte-identical when
unset) removes collapsed verdict words from model-facing text for the production-path comparison only:
the Whole Wardrobe composer's `(ordered for these conditions)` heading, the repair payload's
`(acceptable)` suffix and its "acceptable neighbour" sentence,
and the `WARM_LAYER_RECOMMENDED` message, which states the recorded construction facts
instead of "is recommended" (same code and severity). Ordering itself, supply selection, validation,
repair and critic sequencing are unchanged. The selected-piece composer's activity guidance is out of
scope: it is not a Stage 1 arm.

**[amended 2026-09-15 — the `/ask` context boundary]** `buildStylistConversationPayload` no longer
treats the activity picker's default `'none'` as a structured choice (it falls back to
`extractExplicitActivity`, matching the execution router), and no longer deletes the weather profile
when a turn states weather — it replaces it with the stated profile built by
`weatherProfileFromStatedText`. Both `THREAD STATE` endpoints and the stated activity now survive
into the tool loop. `extractWeatherContext` and `extractStructuredUserWeather` also accept `/` as a
range separator, so "50/40°F" no longer parses as a single temperature. See
`docs/garment-evidence-parity-2026-09-15.md` §11(a).

**[amended 2026-09-15 — one filter for every prompt that serializes profiles]**
`selectedItemVisualComposerSystemPrompt()` serialized both `OCCASION_PROFILES` and
`ACTIVITY_PROFILES` as RULES-AS-DATA, republishing the soft taste lists that had been removed from
the composer tails and `/ask`. Every serializing path now goes through `stripSoftRankingRules()`
(`styling-engine/occasions.js`); hard keys are unchanged. See §11(b).

**[amended 2026-09-15]** Two items left this flag's scope by becoming the default. The occasion and
activity taste lists are no longer rendered into any prompt (see the amendment above), and
`search_wardrobe` results and photo labels no longer carry the soft `preferred` / `discouraged` /
`neutral` tiers on either arm — `ruleFit` now appears only as `prohibited` (a hard-gate exclusion,
with its reason, in `intent:'explain'` and in the annotated supply fallback) or `unknown` (a field
the gate reads is untagged). Both are ratified soft scoring, which still ranks the roster in
`rules.js`; neither is model-facing text any more. See `docs/garment-evidence-parity-2026-09-15.md`
§9–§10.

`scratch/ab_stage1_production_paths.mjs` runs each scenario × arm in its own child process on a copy of
one frozen snapshot, so session rotation memory ("Recently shown garments") cannot leak between runs.
Both arms receive the snapshot's home location and the same date explicitly in the request body, with
the scenario's stated weather passed structurally. The default `--mode preflight` is a **tool/payload
preflight only, never comparison evidence**: it serves every model call locally, blocks non-loopback
fetches, blanks provider keys and removes BYOK rows from the copy. The test hook short-circuits the
router and the tool loop, so the single-outfit arm's tool results are produced by calling the real tools
with a route-shaped context. `--mode live` runs the real router and the real single-outfit model/tool
loop. Every attempt captures normalized and wire input and raw output for every provider call, each
tool-loop turn included, and the contract report counts paired captures per attempt. Live mode is
refused without `--approved` and unless the replicate count equals the pre-registered two.

The pre-registration is `scratch/ab_stage1_preregistration.json`; its sha256 is recorded in every
manifest, alongside the sha256 of all six snapshot files (`wardrobe.db` and `system.db`, each with `-wal`
and `-shm`). The design is exactly two replicates per scenario × arm cell, each run once. There is no
extension, replacement or selective rerun. An inconclusive result needs a new pre-registration with
symmetric sampling. Routing is an end-to-end outcome: single_outfit routing success, technical success
and the conditions check are reported over every attempt in `manifest.contract` and
`contract-report.md`. The outfit-quality comparison is conditional on successful routing.
`scratch/ab_stage1_contract.mjs` holds the checks the harness and the sheet share. Before either cell of
a scenario/replicate enters a review sheet, the sheet builder recomputes from each route's recorded debug
that both arms resolved identical high and low temperatures and the same location. It also confirms that
both routes answered and that the one-outfit attempt routed to single_outfit. Excluded pairs are listed
only in the sealed key. For this check `/ask` now records `resolvedWeather` (highF, lowF, location,
source) in its diagnostics, debug only.

The manifest keeps each returned card's user-visible fields, the composer's `modelSlots` and every
piece's role as returned, and the evaluator reads those roles; nothing derives a role from category. The
sheet shows each card as the product shows a user (StylistChat with the debug flag off): title, rank
label or Needs-review status, review notice and "What didn't clear" reason, flags, the model's reason,
styling instructions and watchFor. Only the arm and replicate are blinded. A blinded ratings export
carries the sheet seed, the pre-registration hash and each card position with its ratings and notes.

Contract pass (owner review, 2026-09-13). The harness's completeness check counts a call as complete only
when all three capture stages share its `callId`. Attempts run in the pre-registered counterbalanced
order: replicate 1 is S1-S2-S3 with one before bundle, and replicate 2 is S2-S3-S1 with bundle before
one. Each attempt records its `executionIndex`. The sheet shows and rates every card the product
displays, Needs-review cards included, and the report counts ready and Needs-review cards separately.
The three rating items are separate pre-registered outcomes per arm, scenario and replicate. The primary
outcomes are mean weather adequacy, mean style and intent, and would-wear proportion; best weather and
best style are secondary. `scratch/ab_stage1_score.mjs` joins the blinded export with the sealed key to
compute them and refuses unrated cards. An attempt with zero displayable cards has non-computable
outcomes, never imputed, and is reported as a zero-card outcome; the other arm is still rated. The
sheet's single strongest-card pick is descriptive only and feeds no comparison. On the sheet, flags
render once, and the "Why this outfit" block renders when any of reason, styling instructions or watchFor
exists (`test/ab_stage1_contract.test.js`).

Live-readiness pass (owner review, 2026-09-13). Cells run under `NODE_ENV=test`, where `assertProviderKey()`
refuses provider requests. The provider-network gate in `scratch/ab_stage1_contract.mjs` grants `WARDROBE_ALLOW_TEST_PROVIDER_NETWORK=true` only
to an approved live run and removes it in preflight; the ordinary suite never has it
(`test/ab_stage1_contract.test.js`). `--boundary-check` runs a cell's exact environment against a blocked
network and a Gemini SDK stub that throws at the request. It shows the live environment passing the key
guard and building structured and tool-loop requests up to the SDK, and the preflight environment being
refused — no billing, no attempt consumed. The review-sheet builder reads a private copy of the snapshot, so
building a sheet can no longer create WAL/SHM files in it or checkpoint into its `system.db`. Manifests record the source state: git HEAD, the sha256 of
`git diff --binary HEAD` and untracked files, which live mode refuses. A technically successful live
attempt with incomplete normalized/wire/output capture is reported as a capture-integrity failure before
any sheet is built. The attempt is kept, stays ratable and is not rerun.

**Stage 1 results record (2026-09-14).** The approved live run completed as pre-registered: 12 attempts
in the counterbalanced order, no reruns or replacements, routing 6/6, technical success 12/12, identical
resolved conditions in all six pairs, capture integrity complete for all 44 provider calls, and snapshot
and source hashes unchanged.

- **Round 1 — the pre-registered result.** The owner rated all 36 displayed cards blind, and the
  pre-registered scorer (`scratch/ab_stage1_score.mjs`) computed the outcomes. Would-wear, verified
  directly from the untouched original exports: one-outfit 3 of 6 cards (S1 0/1 and 1/1, S2 0/1 and 0/1,
  S3 1/1 and 1/1), bundle 14 of 30. An earlier chat summary stated 4 of 6 for the one-outfit flow; that
  aggregate was wrong, and the per-replicate values were right.
- **Presentation defect in round 1.** The round-1 sheet builder chose each garment's worn photo first
  (worn photo, else hanger photo). The Stylist Chat outfit cards in `src/components/StylistChat.jsx` do
  the opposite: they show the hanger photo and fall back to the worn photo. So round 1 did not show the
  garments as a user sees them on a card. The owner also reported that worn photos made weather harder to
  judge. `scratch/ab_stage1_review_sheet.mjs` now defaults to hanger-first; `--photo worn` reproduces
  round 1.
- **Round 2 — a blinded robustness round.** A second blinded owner-rating round used newly randomized,
  hanger-first review sheets and was completed with more time. The owner remained blind to which flow
  produced each card. These are fresh ratings under the UI-representative visual evidence, not a numeric
  transformation of round 1. Round 1 stays the pre-registered result. Round 2 is the more
  UI-representative robustness round and is reported alongside it, with its own sealed keys and scores.
  Round 2 would-wear: one-outfit 3 of 6, bundle 10 of 30.

**Supply boundary, by ID (preflight, snapshot of 2026-09-13).** Both routes now record their supply
boundary per piece in debug only: `singleOutfitCatalogEligibleIds` and `singleOutfitCatalogExclusions`
in the single-outfit diagnostics, and `suppressedPieces` (id, reasons) in the Whole Wardrobe debug. At
65/50 and 72/62 the single-outfit catalog holds 237 garments and the bundle's pre-cap pool 220. All 220
are in the catalog. The 17 catalog-only garments are exactly the accessories, which the visual composer
roster excludes by design (`accessories excluded from visual composer`). Neither arm excludes a garment
the other admits for any other reason. Two evening-tagged dresses (246, 993006) are outside both
supplies. The bundle records `AI profile low confidence for casual`, but the single-outfit catalog drops
them with no entry in its exclusion map. That is an observability gap in the catalog's reason map, not a
supply difference. At 46°F walking the counts are 231 and 214, with the same 17
accessories as the only difference. The bundle then shows 83 of its pool after the roster cap.

Reconciled evidence from live runs (captures in `/tmp/provider-capture-slot-schema`): piece 88 reads
`warmth: moderate` in both the wire capture and the evaluator (an earlier offline check read unparsed
rows and wrongly reported unknown warmth); the botanical-dress card was one level under the cold-end
target. The 65/50 single-outfit weather stop came from `extractStructuredUserWeather` returning null for
a message with three Fahrenheit values (65, 50, 50), after which the payload stated "No numeric weather
range was stated" (capture 0011) and the first search returned `weather_context_required` (0013).

**Measurement rule for the A/B (owner, 2026-09-13).** The outcome is the owner's independent lived-wear
rating. One-level adjacency is recorded as raw evidence and is never reported as proof an outfit is
practically warm enough. The review sheet hides every engine output — endpoint values and garment
warmth labels — until the card is rated, and shows targets, completed levels and signed distances rather
than evaluator verdict words. Owner ratings of the scripted dry-run sheet are recorded as a sheet
usability check only.

### Amendment (2026-09-13) — blanket outerwear warmth cap removed; severe-cold capacity backstop separates protection, substance and insulation evidence

**The cap was not a shell detector.** `garmentWarmthScore` clamped every outerwear garment whose
material verdict was not `insulating` to `light` (0.5). On the real wardrobe it demoted seven garments
from `moderate` to `light` — a fully lined leather jacket, a fully lined knee-length trench, a
second-face windbreaker, an unlined olive jacket, a technical zip jacket, a cotton/rayon knit jacket and
a cotton knit cardigan — and placed the lined trench below a long-sleeved cotton tee, inverting the
verified clo anchors (thin coat 0.36 > thin long-sleeve shirt 0.25). It is removed. No lining or
coat-length magnitude replaces it: the verified anchor extract has no lined/unlined rows and the
wardrobe has no garment pair differing only in lining (`interior_construction` is recorded on 6
outerwear pieces). Removing the cap alone does not create a lined-vs-unlined distinction.

**Why it could not be removed alone.** The cap was accidentally holding up a severe-cold safeguard.
`outerwearLayerPositivelyInadequate` (the presence/substance floor) needs two of ultralight,
non-insulating and unlined, so lining lets a garment escape it by absence; wind protection makes a
jacket outdoor-capable. Uncapped, a tee under the lined trench at 45/35 is one level short of the
`very warm` PET target and the capacity rule, which only convicts a substantial shortfall, went silent.
The floor itself is unchanged: as a presence/substance floor, lining is admissible substance evidence.

**The replacement, endpoint-gated.** `upperGarmentInsulationEvidence` classifies each upper-body
garment from its material verdict alone: a recorded fill or insulating fibre is positive evidence;
an answered "no insulating layer", or a base garment with a recorded face fabric, is `none`; an outer
layer whose interior was never answered is `unknown`. Weather protection and lining never count —
they prove exposure protection and construction substance. Cotton, rayon and silk still insulate
physically; the classifier only says they carry no special insulating-fibre or fill evidence.

In the severe outdoor branch, `outfit_thermal_capacity_short_without_insulation_evidence` (hard)
fires only when all hold: a numeric PET cold target exists; the completed upper system is exactly one
level short (`fits`, best delta −1); the outer layer is outdoor-capable or of unknown capability; and no
upper garment carries positive evidence. Decision order: any positive evidence → pass; otherwise any
`unknown` → advisory `outfit_thermal_capacity_insulation_evidence_unknown` (an inability-to-judge
code); otherwise → hard. Without a temperature there is no target and nothing is judged (the flag-only
and 45/45 contracts hold); a system that reaches its target is never failed on fibre names; a
substantial shortfall stays with `outfit_thermal_capacity_insufficient_for_severe_cold`. The evidence
is recorded as `evidence.severeColdInsulation`.

**One owner-facing explanation.** Typed findings are all kept in evaluation and debug.
`collapseThermalErrorFindings` / `primaryUserFacingFinding` choose what the owner reads, in the
approved order: no outer layer → indoor layer only → no sufficiently warm layer → substantial capacity
shortfall → one-level shortfall without positive insulation evidence. Consumer audit:
- `propose_outfit` needs-review card `rejectionReason` — collapsed; the model's validation message keeps every finding.
- trip-plan rejected cards (`rejectionReason`, `brokenPieces[].reason`) — collapsed through `displayReasons`; `failures[].reasons` sent to the model keeps every finding.
- selected-piece Needs-review cards (routes/ai.js) — `primaryUserFacingFinding`; `result.findings` keeps every finding.
- Whole Wardrobe gate rejections (`locallyGateWholeWardrobeOutfits`, which feeds direct composer and local-fill diagnostic cards) — `primaryUserFacingFinding`.
- advisory chips (`advisoryFindingsToSystemFlags`) — already collapsed by `collapseWarmthAdvisoryFindings`.
- not owner-facing, unchanged: slot-swap `rejected` (tool result), recovery reason codes, the repair pass's typed evidence; the Whole Wardrobe structural check runs without weather and emits no thermal findings.

**Measured (isolated A/B, frozen snapshot).** Roster membership and overall roster order are unchanged
in every scenario (65/50, 50°F walking, 45/35, no weather). The model-facing outerwear subsection
sequence changes wherever a demand exists: the seven garments move into the `moderate` group, and
because unplaceable layers keep reserved slots, 12 unchanged garments sit at a new index — but the
relative order of unchanged placeable garments is identical, and unplaceable slot positions are
identical. The repair bench is unchanged. At 45/35, 16 cards (4 bases × lined trench, leather jacket,
windbreaker, olive jacket) keep a hard finding (now the typed one-level code); outdoor-capability and
presence findings are identical to before. `scratch/audit_ensemble_thermal_calibration.js` was re-run
before and after: only the two formerly capped layers it includes change, and its quilted-puffer-over-
moderate-sweater case at 35/25 (one level short, acceptable) is unchanged.

### Amendment (2026-09-16) — Hill Hiking slot (thread_1789585467294): evidence loss, reuse-over-suitability prompt pressure, no weak-fit disclosure, and a travel exclusion silently bypassed

**Incident.** A 4-day Paso Robles trip plan (Winery Days / Hill Hiking / Dinner Out) delivered the
Hill Hiking slot elevated city clothing (211 black solid long shirt + 251 gray stretch slim pants)
with hiking boots (996865) attached, and the composer described it as an optimal hiking outfit.
Corrected framing (owner, after two rounds of diagnosis review): the upstream roster-selection model
did see several lighter, more hot-weather-plausible tops (990351 explicitly tagged `outdoor`; 990582,
228, 174, 225) and appropriate footwear, but those tops never reached the final composer — they were
already dropped from the fixed capsule roster by the time composition ran. The wardrobe bench did not
clearly contain a strong hot-weather hiking bottom; 114 and 251 are possible compromises, not
established good answers. The five lighter tops are "worth visual consideration," not asserted here
or anywhere in this fix as proven hiking-appropriate — that remains stylist judgment (photos,
movement, maintenance, pairing), never inferred from a score or a category.

**Four separate, bounded fixes — no hard formality gate, no protected garment formula, no childcare-
advisory extension to hiking, no `rosterFitScore`-derived validity floor** (all explicitly ruled out):

1. **Evidence gap at the final composer.** The shared garment fact line
   (`docs/garment-evidence-parity-2026-09-15.md`) deliberately omits occasion tags everywhere, on the
   stated rationale that "every row already survived this request's occasion gate" — true for a
   single-occasion request, **false for a trip roster**, which is deliberately a multi-occasion
   capsule serving distinct slots (a daytime walk, a hike, an evening dinner) in one call. Trip's
   catalog line (`tripPlanTruthCatalog`, routes/ai.js) now appends each piece's recorded occasions as
   a structured fact — `TRIP_GARMENT_FACT_CONVENTIONS` states why. This is a recorded field, not
   tagger prose, and is not a reopening of the 2026-09-15 ruling that tagger `best_use`/`style_risk`
   stay omitted from every model path (owner ruling 2026-09-16: keep that decision as-is).
2. **Reuse-over-suitability prompt pressure.** `tripRosterSelectionSystemPrompt`'s "REUSE ACROSS USE
   CASES IS THE POINT... should be preferred... all else equal" had no suitability check attached, so
   the model could — and did — prefer a cross-slot-reusable dressier piece over a hiking-only-useful
   lighter one. Reworded: reuse only counts when the shared piece is genuinely suited to each use
   case on its own merits, and a use case's own strongest fit is never traded away for cross-use-case
   versatility. `tripPlanCompositionSystemPrompt`'s "aiming... to showcase the core versatile pieces...
   avoid leaving large portions of the packed suitcase untouched" is reworded the same way: slot
   quality outranks showcasing, an unused packed piece beats a worse-fitting outfit chosen to use it.
3. **No honest decline path.** The composer had no way to say "I could not compose a credible outfit
   here" — so it wrote confident language ("optimal") over a real roster gap. A required per-card
   self-rating was considered and explicitly rejected (owner ruling 2026-09-16): requiring the model
   to grade and explain its own choice on every card risks producing exactly the kind of confident
   post-hoc justification that caused the incident, the same failure family as the day-wear
   explanation experiment (`docs/day-wear-explanation-experiment-2026-09-15.md`), and it would have
   added schema/card-face prose no root-cause fix needed. Instead, `tripPlanCompositionSchema` gained
   a distinct, optional **slot-level DECLINE**: the composer may omit a specific outfit from `outfits`
   (relaxed from an exact per-request count to `minItems: 1`) and add a `{slot_id, gap_reason}` entry
   to a new top-level `slot_gaps` array. `styling-engine/tools.js`'s atomic branch folds each declined
   outfit's reason into the same `coverageGaps` list an under-supplied slot's generic message already
   uses (`describeSlotCoverageGap`), so both reach the user through the one existing disclosure path
   (`plan_lines`) with no new UI. A card the model does submit carries no confidence rating of any
   kind — `structural_capacity` on the slot payload stays a factual, non-suitability diagnostic, and
   suitability remains entirely the model's judgment, including the ability to decline honestly.
4. **`coverage_report` renamed `structural_capacity`.** `buildCoveredCandidateSet`'s `complete` flag
   is a pure supply-shape check (does a top/bottom-or-dress + shoes + any required base layer exist
   among the slot's allowed pieces) computed with zero knowledge of activity or weather — a
   structurally complete slot can still have no genuinely suitable combination for what it is
   actually for. The old model-facing key name invited exactly that misreading. `workbenchInstructions`
   now states this explicitly; see `docs/model-facing-signal-inventory.md` row 9.
5. **Travel exclusion silently bypassed (separate, cleanly-isolated defect).** Piece 256 (black
   abstract midi dress) carries `occasion_exclusions: ["travel"]`, yet appeared in the trip's Winery
   Days and Dinner Out cards — `wholeWardrobePieceTrustDecision`'s exclusion check
   (styling-engine/rules.js) only ever received the slot's own occasion
   (`slot.eligibilityOccasion || slot.occasion`), never `"travel"`, so a trip-level owner exclusion
   could never match inside any individual slot. `wholeWardrobePieceTrustDecision` now accepts
   `options.ownerExclusionOccasion` as an array and matches against any entry (existing single-string
   callers are unaffected); `buildPlanSlotWorkbench`'s one call site passes
   `[slot.eligibilityOccasion || slot.occasion, 'travel']` when `planKind === 'trip'`. Fixed through the
   existing evaluator, not a parallel ad hoc travel check.

**Regression coverage** (`test/hill_hiking_incident_regression.test.js`, plus an integration test in
`test/plan_outfit_set.test.js`) pins the evidence and priority contract, not a garment-specific
expected outfit or specific temperature: trip catalog occasions (recorded vs `unknown`, never
inferred), the reworded roster/composition prompt text, the `slot_gaps` decline schema (and that no
per-card confidence field exists anywhere), `structural_capacity`'s wording and key name, the travel
exclusion binding inside a non-"travel"-occasioned trip slot while staying inert for a non-trip plan
kind, and — end to end through `executeTool('plan_outfit_set', ...)` — that a composer honestly
declining one slot's outfit via `slot_gaps` still accepts the other slot's card, with the decline
reason surfacing in `plan_lines` and no confidence rating anywhere on the accepted card.

**Open finding, out of scope here — tracked in a separate session.** The app currently collapses a
multi-day forecast into one trip-wide maximum/minimum envelope and presents that envelope as every
slot's weather; an activity with no assigned date within the trip must not be treated as occurring at
the trip maximum. Not implemented, fixed, or resolved by this Hill Hiking change — see the dedicated
weather-resolution workstream for design and status.

### Amendment (2026-09-16) — a genuinely failed trip roster no longer proceeds to composition as a success (thread_1789598100140)

**Incident.** A live Paso Robles re-run hit a real (not simulated) roster-selection failure:
`selectTripRosterViaModel`'s model attempt, and its one repair, both failed structural validation
(`missing_removable_cool_layer`/`cold_floor_infeasible` for Winery Days and Hiking), so the roster
fell back to the raw 60-piece coverage-guaranteed bench (`source: 'bench_fallback'`). The atomic
composer then composed real cards from that bench and the tool returned `status: 'success'`, with
the fallback disclosed only as a `[trip roster: ...]` line inside `plan_lines`. The model's own final
answer dropped that line, and the Hiking slot's own `[coverage gap: ...]` line, from its prose
entirely — the user saw 3 real-looking cards and a "Complete Packed Roster (60 pieces)" with no
signal any of it was a fallback, and the Hiking activity the trip was explicitly about got nothing.

**Fix, scoped to exactly this.** `tools.js`'s atomic trip branch now checks, before composing
anything: `tripRosterSource === 'bench_fallback'` **and** a non-empty `tripRosterFailureCodes` (the
second field distinguishes a genuine two-strikes structural failure from the same `bench_fallback`
source string used when no `chooseTripRoster` was wired at all — a deliberate no-op with
`failures: []`, not a failure). When both hold, the tool returns `status: 'error'` immediately: no
cards, no roster, `pendingPlan` cleared — nothing structurally exists that could be displayed as if
it were a valid result, regardless of what the model's own prose says. Scoped to the atomic path
only; the ordinary (non-atomic) tool-loop trip path keeps its own, different honest-gap disclosure
through `submit_plan_outfits`' resubmission loop, which several existing tests exercise deliberately
with a fallback-triggering roster and must keep working.

**The general "does a disclosure survive the model's own prose" concern was investigated and found
already handled** — not new work. `StylistChat.jsx`'s `getTripPlanNotes`/`planNotesMissingFromProse`
already read `structuredOutfits[0].tripPlanLines` directly (not the model's text) and render a
"Stylist's notes" panel of exactly the bracket-prefixed lines (`[coverage gap: ...]`,
`[trip roster: ...]`, `[missing wardrobe gap: ...]`, `[plan trimmed: ...]`) missing from the model's
own prose — this predates the current session and is already pinned by
`test/aiEndpointContracts.test.js`. It would have surfaced both dropped lines in this incident had
any cards existed to attach `tripPlanLines` to; the actual gap was that the bench-fallback case
produced cards (and therefore a `plan_lines` disclosure) at all, which this fix now prevents.

Regression: `test/trip_roster_fallback_rejection.test.js` pins the error status, the empty
outfit/roster state, that composition never runs, that the two `bench_fallback` situations are
distinguished, and that a genuinely model-chosen roster is unaffected.

### Amendment (2026-09-16) — trip roster selection: removed the 60-piece bench cap and its reuse ranking entirely (thread_1789598100140)

**Root cause, traced precisely.** `buildTripBench` ranked every gate-eligible piece by
`tripReuseScore` (how many of the trip's slots it passes), round-robinned the ranked list across
construction buckets (`diversityInterleavedByBucket`, a real 2026 fix for a different defect — see
the amendment above it in this file), then truncated to 60 via `buildCoveredCandidateSet`. The
round-robin softened truncation but did not remove it: bucket *processing order* was still driven by
each bucket's best member's reuse score, so a bucket whose only members are single-slot-eligible (a
hiking-only pair of shorts, reuse score 1) got its first turn very late — after every 2-or-3-slot-
reusable bucket's first pick — and could be pushed past the cap entirely before either the roster-
selection model or the composer ever saw it. Confirmed live: real hot-weather hiking shorts (247) and
technical outdoor layers (990441, 996764, 990358) existed in the 273-piece wardrobe and never reached
the 60-piece bench.

**Why the cap existed, and why it no longer needs to.** `chooseTripRosterWithProvider`
(routes/ai.js) attached a base64 photo thumbnail per bench candidate — expensive at 60 images, and
the entire reason the pruning heuristic existed. Meanwhile `composeTripPlanOnce` (the composition
stage) already attaches full photos unconditionally for the much smaller *chosen* roster, when actual
outfits are being judged for drape/volume/layering — roster selection never needed images to do its
job of choosing what to pack.

**The fix.** Roster selection is now text-only, using the same sparse fact-line format `/ask`'s
`single_outfit` uses for its own whole-wardrobe candidate list (`stylistCatalogLine`/
`sparseGarmentCatalogRow`), at a fraction of the token cost of even the old 60-image bench (~10-12k
tokens for the wardrobe's full season-eligible pool, vs 60 images). `buildTripBench` no longer ranks,
buckets, or caps at all — every active, season-eligible, composable-group piece gate-eligible for at
least one requested slot goes into the bench, annotated with exactly which of the trip's own slots it
is gate-eligible for (`slots: Winery Days, Hiking`), a recorded fact instead of a hidden reason a
piece was never shown at all. `tripReuseScore`, `tripBenchBucketKey`, `diversityInterleavedByBucket`
and `TRIP_BENCH_SIZE` are removed — nothing else called them. The model's own judgment (already
reworded, per the Hill Hiking fix, to state that reuse is a strength but never outranks suitability)
now operates on the true candidate pool instead of one code had already pre-filtered by a taste
proxy.

**Two things the format switch had to preserve, not silently drop:**
- **Occasions**, the same reasoning as `tripPlanTruthCatalog`'s addition for the composition catalog
  (docs' evidence-parity migration): the sparse format omits occasion tags on the premise that "every
  row already survived this request's occasion gate," true for a single-occasion request, false for a
  trip roster spanning multiple slot occasions. `TRIP_ROSTER_CATALOG_CONVENTIONS` states the addendum.
- **Owner rules/rejections**: `buildPieceText` (the old format) folded `RULES (authoritative)`/
  `REJECTED` inline; the sparse fact line carries no notes channel at all (that's deliberately
  separate — docs/garment-evidence-parity-2026-09-15.md). `garmentNotesBlock` (the same function trip
  composition already uses) is now appended to the roster-selection text, so an owner's stored rule
  keeps its authority over roster selection, not just over composition.

**Also removed as dead code**: `pieceVisualDetailPolicy`'s `useVisualRoles:false` opt-out
(styling-engine/attributes.js), added originally so image-fidelity allocation for the old
thumbnail-based roster bench wouldn't grant a capsule-era styling-role special treatment. Its only
caller was `chooseTripRosterWithProvider`, which no longer loads any images; the function now has one
behavior for every caller again.

Regression: `test/tripPackingRoster.test.js`'s bench-construction tests were rewritten from "survives
truncation" to "nothing is truncated at all," including a new test reproducing the exact live shape —
70 cross-slot-reusable pieces (reuse score 2, the old ranking's favorite) alongside one single-use-
case hiking piece (reuse score 1, the old ranking's first casualty) — and asserting all 71 survive.

### Amendment (2026-09-16) — the roster-level cold-layer gate now reads the same waking-window estimate composition already does (thread_1789598100140, issue 4)

**Root cause.** `tripRosterFailures`' `missing_removable_cool_layer` and `cold_floor_infeasible`
checks read `weatherProfile.needsRemovableCoolLayer`/`weatherProfile.isCold` directly —
`needsRemovableCoolLayer` is set in `weather.js` from the raw 24-hour daily **minimum**, the exact
"Vienna failure" `exposure.js`'s own header documents ("a 5am trough nobody is dressed for"). By the
time composition runs, `exposure.js`'s `estimateWakingWindow` already corrects this — a waking-hours
estimate, not the pre-dawn low — for the `exposure_conditions` text and thermal-demand calculation
the model actually sees. The roster-level gate never adopted that correction. For the live incident's
52°F/94°F trip day, the raw minimum (52°F) crosses `COOL_LOW_F` (64°F) and looks cold; the
waking-window estimate (52 + (94−52)×0.35 = 66.7°F) does not. The roster-selection model reasonably
packed no cold layer for a hot hiking day, and the roster-level check rejected it twice — over a
requirement that was never real once the pre-dawn trough is excluded from actual outing hours,
triggering the bench-fallback this session's earlier amendment (above) now also refuses to compose
from silently.

**One thing verified before implementing, not assumed:** the diagnosis this fix started from
attributed the correct composition-stage behavior to `weatherProfile.coldPresenceRequirement`
(`environmentalRequirements.js`'s `resolveColdLayerPresenceRequirement`), citing `stylingContext.js`
as the place it gets computed. Traced directly: `resolveColdLayerPresenceRequirement` is imported
into `outfitSetPlanner.js` but **never invoked there** — `resolveSlotWeather` (the function that
actually builds a trip slot's `weatherProfile`) never computes or attaches it. That field is real and
correctly wired for the general/freeform `stylingContext.js` path, but trip slots never carry it. The
new helper below does not branch on it for that reason — a check against a field this pipeline never
populates would silently never fire, which is worse than not writing it, per this map's own "new
structure must earn its keep" discipline (AGENTS.md principle 7, the silence test). If trip slots
start carrying it, `slotNeedsRemovableCoolLayer` is where that check belongs.

**The fix.** `slotNeedsRemovableCoolLayer(slot)` calls `resolveExposureContext` and reads
`conditions.wakingLowF`; when a numeric waking-window estimate exists, that decides the check instead
of the raw flag. A hand-built fixture with no `highF`/`lowF` (several existing unit tests) falls back
to the flag exactly as before. The two call sites keep their own, different relationship to `isCold`:
`missing_removable_cool_layer` (roster has no layer at all) still excludes an already-`isCold` slot —
that is the more severe, separate failure `cold_floor_infeasible` exists to catch — while
`cold_floor_infeasible` itself must keep firing for an `isCold` slot exactly as readily as a merely-
cool one, which is the original shape of the bug it was built for (thread_1788516198449); folding
`!isCold` into the shared helper unconditionally would have silently stopped that check from ever
firing for a genuinely cold slot, a regression caught by a real test failure before it shipped.

Regression: `test/tripPackingRoster.test.js` pins both directions — the 52°F/94°F live shape no
longer flags `missing_removable_cool_layer`/`cold_floor_infeasible`, and a genuinely cool day (waking
estimate still under `COOL_LOW_F`) keeps flagging exactly as before, so this narrows a false positive
without weakening the real check.

### Amendment (2026-09-17) — activity time windows: a slot can carry a genuine `time_window`, resolve against sliced hourly weather instead of the day's envelope, and a materially time-ambiguous slot pauses for one clarifying question before any roster or card is built

**Why.** Every prior fix in this file that touches trip weather still asks one question per slot per
day — a single high/low, or the waking-window estimate derived from it. That is correct for a slot
whose timing genuinely doesn't matter, but wrong the moment a slot's actual clock time would change
what should be packed (a 6am summit push and a 2pm valley stroll are the same "hiking" activity, the
same day, and can require materially different garments). This amendment adds a model-owned,
optional `time_window` slot fact and a deterministic check for when its ABSENCE is itself a problem
worth surfacing before composing.

**`time_window` is model-extracted only, never inferred or defaulted by code** (`tools.js`'s
`plan_outfit_set` schema: `{period: enum[morning, midday, afternoon, evening], start_local,
end_local}`). Nothing in `outfitSetPlanner.js` or `weather.js` guesses a time from activity type or
season — a slot with no stated time_window has none, full stop, matching this map's long-standing
"structured data over text inference" principle everywhere else a slot fact is optional.

**Hourly resolution (`styling-engine/weather.js`).** `resolveExposureWindowHourly({location, date,
timeWindow, fetchImpl})` fetches Open-Meteo's hourly series (new `fetchHourlyRange`, its own
`hourlyCache`, separate from the existing daily-series cache) and slices it to the stated window's
canonical hours via `DAYPARTS` (`morning: 8-12, afternoon/midday: 12-17, evening: 17-21` — night is
deliberately out of scope, no trip slot in this codebase composes for it). `resolveDaypartHourlyEvidence`
slices all three dayparts at once for the materiality check below. Both return `null` on any failure
(geocode miss, fetch error, date beyond Open-Meteo's ~16-day horizon) — never a fabricated estimate;
the caller falls through to the existing waking-window path exactly as if no hourly data had been
attempted.

**`resolveSlotWeather` (`outfitSetPlanner.js`)** tries the hourly path first, only when the slot
states a `time_window`, is not indoor, and has a resolvable date/location — an explicit opt-in, not a
new default. On success the resolved weather's `highF`/`lowF` are the WINDOW's own extremes, not the
day's, with `source: 'live_hourly'` surfaced through `truthfulWeatherLabel`'s new `case 'live_hourly'`
branch so the label itself discloses the narrower basis ("...live hourly forecast, sliced to this
activity's actual time window"). `exposure.js`'s `resolveConditions` gained a matching
`source === 'live_hourly' && scope === 'exposure_window'` branch that sets `wakingHighF`/`wakingLowF`
directly from the sliced values and `conditionsSource: 'explicit_hourly'` — the fourth, most-precise
tier in the existing priority ladder (`stated_user_exposure_range` > `explicit_hourly` >
`waking_window_estimate` > `seasonal_waking_window_estimate` > `unknown`). `test/exposureContext.test.js`
had a deliberate tripwire test asserting this tier was unreachable ("no code path may claim
explicit_hourly until hourly data is actually sampled... asserted so the day it becomes reachable,
this test is what says so") — that comment named exactly this day; the test now asserts the positive
case instead of the negative one.

**The materiality check (`resolveSlotTimeSensitivity`, `outfitSetPlanner.js`) answers a narrower
question than "what's the weather": does the slot's UNSTATED timing create enough physical
uncertainty that packing the right thing depends on knowing when it happens.** It samples all three
dayparts via `resolveDaypartHourlyEvidence` and returns `not_material`/`material`/`unknown` — never a
weather verdict itself, never fired at all when the slot already states its own `time_window` (nothing
left to disambiguate) or is indoor (climate-controlled, time never matters). Three independent,
deterministic triggers, matched to the three ways a slot's identity can actually change across the
day rather than one blended score:

- **Thermal-band shift ≥ 2 ordinal levels.** Compares `requiredThermalEndpointBands(exposure).cold`
  AND `.warm` (not `requiredThermalBand.level` alone, which is deliberately cold-end-only per its own
  doc comment) across all three dayparts' endpoints flattened together, using `WARMTH_LEVELS`'
  5-level ordinal scale. Verified against the real thermal model, not assumed: a hiking slot's `-2`
  `EXERTION_SHIFT` credit can suppress a large real-world swing down to a 0-1 level shift (confirmed
  via diagnostic scripts run against `requiredThermalEndpointBands` directly for a 55-89°F range,
  which showed no material shift for `hiking` at either endpoint) — this is a real, activity-specific
  dulling of the signal, not a bug in the comparison; a genuinely cold morning (a mountain-hike low in
  the 30s rather than the 50s) is what actually clears the threshold for an exertion-discounted
  activity, exactly as it should, since a milder morning genuinely doesn't need different gear.
- **Precipitation divergence** — rain in one plausible window, dry in another.
- **Severe-cold-requirement divergence** — `resolveColdLayerPresenceRequirement(exposure).state` is
  `'required'` for at least one daypart and not for another (this is the one place this session's
  trip-planning work newly INVOKES that function per-daypart on an exposure context built for the
  purpose — unlike the trip-slot `weatherProfile.coldPresenceRequirement` field the prior amendment
  found was never populated, this call passes a fresh `resolveExposureContext` result directly).

**The conversational seam (`tools.js`'s `plan_outfit_set`).** The existing per-slot weather pre-check
loop now also computes `timeSensitivity`; if any slot comes back `material`, `plan_outfit_set` returns
`status: 'clarification_recommended'` before calling `chooseTripRoster` or composing anything, with
the specific divergence reason and an instruction to ask ONE natural question about roughly what time
the slot happens, then re-call with `time_window` set — mirroring the existing
`unresolvedSlot`/`weather_context_required` short-circuit's shape (a status the model must react to
conversationally, not an error) rather than inventing a new response contract.

**A load-bearing test-fixture lesson, not a code bug:** three new integration tests
(`test/activityTimeWindows.test.js`) initially failed for a reason unrelated to time-sensitivity at
all — resolving against a genuinely-sampled hourly/waking-window low that dips under `COOL_LOW_F`
correctly makes `missing_removable_cool_layer`/`cold_floor_infeasible` (the Issue 4 amendment above)
fire for a roster with no outerwear piece, exactly as designed. The fix was adding a qualifying layer
piece to those fixtures' rosters, not touching the gate — a reminder that this session's own prior
amendment is now live on every hourly-resolved slot, not only the daily-envelope ones it was written
against.

Regression/coverage: `test/weather.test.js` (hourly fetch/slice/cache, `DAYPARTS`,
`resolveExposureWindowHourly`/`resolveDaypartHourlyEvidence`), `test/exposureContext.test.js`
(`explicit_hourly` tier), `test/activityTimeWindows.test.js` (12 tests: hourly slot-weather
resolution vs. day's envelope, indoor exemption, all three materiality triggers independently, a
stated `time_window` short-circuiting the check, far-term/no-hourly-coverage degrading to `unknown`
rather than fabricating a verdict, and the full `clarification_recommended` → answered → `success`
conversational round-trip through `executeTool`).

### Amendment (2026-09-17) — a piece with no genuine outdoor affinity no longer claims a Hiking slot's label, and the roster prompt stops letting a base top double as a layer (thread_1789628875203)

**Incident.** A live Paso Robles run (real dev pair, real wardrobe) labeled `#996782` (a collared
rayon/viscose popover blouse — no `"outdoor"` occasion tag at all) `slots: Winery Days, Hiking` in
the trip roster candidate catalog. The model then packed it and reasoned, in its own words, that it
would be "a lightweight layer for varied outdoor temps," choosing it over the wardrobe's actual
cotton tees and tanks. A separate reviewer proposed fixing this by hard-disqualifying rayon/viscose,
collared, or long-sleeve pieces from hiking slots outright — rejected (owner ruling 2026-09-17):
this codebase has repeatedly, deliberately kept fabric/silhouette suitability advisory-only for
tops/bottoms (the identical territory as the "sleeve shape is not incompatibility" and "print
judgment is case by case" rulings, and `rules.js`'s own `required_occasion_tags` comment: "a hard
gate would contradict the 2026-06-12 ratification... and would make the roster depend on tagging
density"). The chosen fix is narrower and does not touch suitability judgment at all.

**Root cause.** `buildTripBench`'s per-slot label loop (`slotLabelsById`, `outfitSetPlanner.js`)
called `slotGateEligiblePieces`, which checks a piece's occasion tags against the slot's own generic
`occasion` field only (`"casual"` for both Winery Days and Hiking in this trip) — any casual-tagged
piece trivially passes, regardless of activity. Nothing consulted the Hiking activity profile's own
`required_occasion_tags` (`footwear-comfort.js`: `["outdoor", "outdoor active", "hiking"]`) at all,
even though that field already exists and is already used elsewhere (`rules.js`) as a ranking signal
for the single-outfit/freeform path.

**The fix, scoped to the label only.** Two new helpers in `outfitSetPlanner.js`:
`slotRequiresGenuineOutdoorAffinity(slot)` resolves the slot's activity profile and checks whether
`required_occasion_tags` includes `"outdoor"`; `pieceHasGenuineOutdoorAffinity(piece)` checks the
piece's own `occasions` for an `"outdoor"` tag AND that `getOccasionConfidence(piece, 'outdoor')`
(newly exported from `attributes.js`) is not `'low'`. `buildTripBench`'s label loop now skips
attaching a slot's label to a piece that fails this check when the slot requires it. **This changes
nothing about bench membership or roster eligibility** — `capsulePiecesEligibleForAnySlot` and
`slotGateEligiblePieces` are untouched, so a day dress stays roster-eligible for outdoor-active
exactly as the 2026-06-12 ratification requires; the piece is still packable, still visible, still
labeled for whichever slots it does honestly qualify for (Winery Days, here). Only the specific
"gate-eligible for Hiking" claim — a claim `TRIP_ROSTER_CATALOG_CONVENTIONS` already documents as
"structurally computed, not a suitability verdict" — is corrected to actually be true.

**The prompt fix (Fix 2b).** `tripRosterSelectionSystemPrompt`'s existing LAYERING/OUTERWEAR section
gained one sentence: a button-up, popover, or collared woven blouse is a base top, not a layering
garment or outerwear substitute, and must not double as both a look's base and its own layer. This
addresses the model's stated reasoning directly, as a clarification alongside the section's existing
"never rely solely on dressy... outerwear" guidance, not a new rule family.

Regression: `test/tripPackingRoster.test.js` — a piece with no outdoor tag never claims a Hiking
label despite sharing the slot's generic occasion; a piece tagged outdoor but recorded
low-confidence for it (`occasion_confidence.outdoor: 'low'`) is treated the same way; a genuinely
outdoor-tagged piece with no low-confidence marker still gets the label (no over-suppression); and
the new prompt sentence is present.

