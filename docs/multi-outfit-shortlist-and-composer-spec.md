# One shortlist and one composer for multi-outfit chat requests (spec, 2026-10-27)

**Status:** owner-approved direction (2026-10-27). **Coordinated plans implemented and verified offline (§10); `generate_outfits` not yet migrated.**
- First version: coordinated plans only ("sounds good to me, spec the change").
- Revised the same day into one shared design for `generate_outfits` and coordinated plans ("revise the coordinated-plan spec into one shared design … taking 1..k slots").
- Owner decisions already taken: a whole-request photo limit of 60, follow-ups stay within the shortlist, and the shared stylist model ("I like your proposed items").

**Scope:** two chat entry points that compose several outfits from the whole wardrobe:
- `generate_outfits` ("give me N outfits for …", 2–5 fresh looks for one situation);
- `plan_outfit_set` with `plan_kind: 'coordinated_plan'` (a work week, an event weekend, guests at home).

Trips, seasonal capsules, single outfits, slot swaps and the selected-piece flow keep their own paths (§7).

## 1 · The problem

**Two chat paths compose several outfits from the whole wardrobe, and in both, code decides most of what the model sees.**

| | `generate_outfits` | coordinated plan |
|---|---|---|
| Request | N looks for **one** situation | a set across **several** situations (slots) |
| Who chooses what the model sees | **code:** `buildVisualComposerRoster` (`styling-engine/rules.js`) scores every eligible piece, applies per-category limits and keeps ≤ 90 photos | **code:** `selectPlanWorkbenchPieces` keeps the top 40 per slot by `planWorkbenchPieceScore` |
| Measured | `thread_1792701395406`: **254 eligible, 83 shown** | `thread_1793148122720`: **288 and 273 allowed, 40 + 40 shown** (62 distinct, as text) |
| How it composes | one no-tools call with photos of the 83 (`generateWholeWardrobeOutfitsVisualInternal`) | inside the chat tool loop, from text, with photos only of the 16 pieces the model asked to see |

Neither cap was ever decided on styling grounds:
- **The plan cap:** `allowedPieces.slice(0, 40)` arrived with the flow in #97 (2026-07-15), and #98 replaced it with scoring the same day.
- **The visual roster cap** is the image ceiling under Claude's 100-image limit. The selection under it is a code score.

The engine map measured the plan score: two of its "quality" weights are inert on this wardrobe.

**Meanwhile the newer paths let the model choose:**
- **Trip:** the packer chooses from the full bench, and one call composes with every photo (`docs/trip-composition-parity-spec.md`).
- **Selected piece:** the stylist shortlists from the full catalog, then one call composes with every shortlist photo (`docs/selected-piece-model-roster-spec.md`).
- The 10-24 replay found the better garments missing from the code-ranked roster. The owner's ruling: "the model can't do much if it does not know about the garments."

**The incident behind this spec:** the guests-at-home request (`thread_1793148122720` on Gemini 3.7 Flash, `thread_1793149288511` on Flash-Lite).
- The owner rated the four-day set stylistically weak on both models.
- 3.7 Flash cost about four times as much with no gain. Its advantage elsewhere comes from choosing from the full catalog and judging photos, and this path offers neither.

## 2 · One design, 1..k slots

A `generate_outfits` request is a coordinated plan with **one slot**. A coordinated plan is the same request with **k slots**, each with its own occasion, date, weather, register and count. The design treats them as one:

1. **Stage 1, the shortlist** (§3): the stylist chooses what to look at, from every gate-eligible piece, for every slot, in one call.
2. **Stage 2, the composer** (§4): one call composes every slot's outfits, with a photo of every shortlisted piece.
3. **Follow-ups** (§5) stay in the chat tool loop.

**Kept:** each objective.
- A coordinated plan stays not-a-trip: no suitcase, no shared roster across days, no reuse requirement, no journey. Each slot may use the whole wardrobe that passes its gates.
- `generate_outfits` stays "N distinct looks for one situation".

**Hard invariant** (trip spec §7): this changes who chooses and what they see. It never changes what is accepted. Every gate, validator, required base layer, cold-layer rule and owner constraint judges the cards exactly as today:
- the shared wearable evaluator and slot checks for `generate_outfits`;
- `submit_plan_outfits`' acceptance for plans.

## 3 · Stage 1: the shortlist

**Input:** one call per request. It contains:
- **The slots:** label, occasion, activity, environment, date, register ceiling, `cold_layer_required`, and per-slot weather only where the slot is outdoors or the user asked about weather (2026-10-19 ruling). A `generate_outfits` request has one slot, built from its own resolved styling context.
- **The full eligible catalog:** every active piece that passes at least one slot's gates. Those are today's gates, unchanged: `slotGateEligiblePieces` for plans, and the gate stage of `evaluateVisualComposerPiecePool` for `generate_outfits`, **without its 90-photo cap**. Each piece is one sparse row (`sparseGarmentCatalogRow`, the format the selected-piece and trip catalogs use), annotated with **which slots it is eligible for** (the trip bench's `slotLabelsById` precedent: a recorded fact, not advice).
- **Owner rules and rejections,** through the shared source-labelled notes channel (`garmentNotesBlock`).
- **Recent wear** (`generate_outfits` today: `getRecentWholeWardrobeSessionInfluence`), stated as a fact per piece ("worn in a look 3 days ago"). It is information for her to weigh, not a filter.
- **No garment photos.** On 2026-10-03 the trip packer was shown every photo while choosing and made the same mistakes at higher cost (`TRIP_ROSTER_PHOTOS_ENABLED = false`). Photos are spent in Stage 2, where outfits are judged.

**Output:** for each slot, the IDs she wants to see for that slot, plus a one-line `selection_note` on the directions she's choosing for.

**Prompt contract:** the selected-piece roster's wording (`selectedPieceRoster.js`, as amended in Explore §13):
- It is a shortlist to compare, not the final choice.
- Bring several real alternatives for every part each slot's outfits need.
- A garment whose facts leave you unsure is worth seeing.
- Leave out only what clearly cannot work.
- No packing language. For the up-to-N looks of one situation, keep the Explore-style intent: the looks should differ.

**Limits** (owner-approved):
- **Whole request:** 60 distinct pieces (`MULTI_OUTFIT_SHORTLIST_PHOTO_LIMIT`). Each becomes one photo in Stage 2.
- **Per slot:** 40 when there are several slots. With one slot, the slot limit is the whole-request limit (60).

**Mechanical checks** (no styling choice by code), as `validateSelectedPieceRosterPick` already does:
- An ID not eligible for the slot it's listed under is dropped and reported.
- A slot without a complete outfit path is completed by the shared structural contract (`completeOutfitSupplyRequirement` / `buildCoveredCandidateSet`). The completion takes the existing code order, only for the missing structure, and every addition is reported.
- If the call fails or is truncated, the request falls back to today's roster for that entry point: `buildVisualComposerRoster` or the plan workbench. The debug output records it.
- The output cap is set with thinking headroom. Gemini bills thinking against the cap: the Explore shortlist was truncated at 1,500 tokens on 2026-10-27, and the trip shortlist earlier at 1,480.

## 4 · Stage 2: one composer for 1..k slots

The composer is the existing whole-wardrobe visual composer, extended to take slots. `generate_outfits` already uses it, and the trip and capsule atomic composers share its shape. **No third composer is built** (`docs/freeform-bounded-execution-spec.md`: "do not build a second composer").

**Evidence:**
- **Garment facts:** the shared fact line plus source-labelled notes for every shortlisted piece. No tagger "best use" prose (2026-09-15 ruling).
- **Photos:** one photo for every shortlisted piece, unconditionally. Worn first where one exists, labelled by ID and name.
- **Slots:** each slot's structured context as in Stage 1.

**The count is a ceiling** (owner ruling 2026-10-27). Each slot's count is the most she may return. Where she can't make that many she'd recommend, she returns fewer and says why. For plans that goes in `slot_gaps` (the trip schema's per-slot decline), through the existing coverage-gap disclosure. For `generate_outfits` it goes in `skip`.

**Kept from `generate_outfits`' current pipeline, for every slot:**
- **Comparison-set guidance** when a slot asks for more than one look (`comparisonSetGuidance`).
- **The stylist note:** for `/ask`'s "a few options" turn, the composer writes the reply in the same call (`stylistNote`). For plans, the existing `plan_lines` disclosure is unchanged.
- **The stylist's brief** (`stylistBrief`), when the chat hands off with one.
- **Validation:** the shared evaluator and slot checks. A rejected card becomes a needs-review card, as today. Plans keep `submit_plan_outfits`' acceptance.
- **The weather-layer repair, the clash critic, and the deterministic fill when the model returns no structurally valid outfit:** each keeps exactly its current trigger and scope. This spec adds no repair and widens none.
  - **The deterministic fill is an open owner decision** (§8). It is the one stage that can put a code-composed card where the model declined, which sits close to the count-is-a-ceiling ruling.

**Model and thinking:** the configured stylist model at the structured-call default (`low` on Gemini). No per-flow model.

## 5 · Follow-ups

- **Edits stay in the chat tool loop,** as ruled for trips (`trip-composition-parity-spec.md` §6). That includes "swap the shoes on Thursday", "more options for the dinner" and "make Wednesday dressier", with `submit_plan_outfits`, `suggest_slot_swaps` and `propose_outfit` unchanged.
- **The loop's working set is the Stage 1 shortlist** (owner-approved). Today it is the plan workbench's code-ranked 40, or nothing persistent after `generate_outfits`. This applies to both entry points.
- **Single-outfit tools are untouched.** `search_wardrobe` and `view_pieces` still reach the full catalog.

## 6 · Cost

Estimates from today's measured calls:

| Request | Today | After (Stage 1 + Stage 2) |
|---|---|---|
| Guests at home, 2 slots, Flash-Lite | $0.029 (measured, `thread_1793149288511`, loop turn 1) | ≈ $0.035–0.05: shortlist ≈ 25k text tokens; composer ≈ 60 photos + text |
| Same, Gemini 3.7 Flash | $0.121 (measured, `thread_1793148122720`) | ≈ $0.08–0.11 |
| `generate_outfits`, 1 slot, Flash-Lite | composer only, with **83 photos** | shortlist call added (≈ 25k text, ≈ $0.008); composer with **≤ 60 photos** instead of 83. Roughly the same total |

**Why the totals move as they do:**
- **The plan's first turn** costs a little more on Flash-Lite, because every shortlisted piece is now seen.
- **3.7 Flash** costs about the same or less, because one composition call replaces several loop iterations.
- **`generate_outfits`** gains a shortlist call but sends fewer photos.

All of these are estimates. The verification runs measure them.

## 7 · What stays different

**Entry-point options that stay:**
- **The Whole Wardrobe page** (`POST /generate-wardrobe-outfits-visual`) keeps its own controls: the season dropdown, the mood and request fields, typed weather (`userWeather`), `explorationMode`, and the card count.
  - It is **not** in this spec's first scope: it keeps `buildVisualComposerRoster` until the chat entry points are verified.
  - Moving it onto the shortlist is a later owner decision (§8). If moved, its controls become the single slot's context.
- **Saved-outfit variants** (`POST /generate-saved-outfit-variants`) keep their source-outfit seed:
  - the prompt modes: `formula` (similar versions) and `adjacent` (explore around it);
  - the source outfit photo;
  - the main-piece pin and "use only my wardrobe".
  - Variants keep their current roster in this spec, since the seed shapes what is relevant. They are a later decision.
- **Coordinated-plan disclosures** keep their place: `plan_lines` and coverage gaps, stating trims and gaps across the set.
- **`generate_outfits`' reply:** the stylist note stays a single-call product of the composer.

**Paths this spec doesn't touch:**
- **Trips:** a shared suitcase, reuse across days, the journey and the packing approach. A different objective.
- **Seasonal capsules:** a piece budget, palette, rotation and the 70-piece capsule bench. Its code-built bench is a separate, recorded question.
- **The selected-piece flow:** already a model shortlist plus a composer from photos.
- **Single outfits and slot swaps:** already choose from the full catalog.
- **`resolvePlanKind`:** classification is unchanged. The guests-at-home request was correctly a coordinated plan.

## 8 · Owner decisions

**Taken (2026-10-27):** a 60-piece whole-request photo limit; follow-ups stay within the shortlist; the shared stylist model.

**Taken (2026-10-27, later):** coordinated plans first, verified, then `generate_outfits`. The Whole Wardrobe page and saved-outfit variants stay on their current rosters for now.

**Open:**
1. **The deterministic fill** when the model returns no valid outfit for a slot: keep it, or show the slot as a disclosed gap, consistent with "the count is a ceiling".

## 9 · Verification

**Offline** (no model calls, isolated database copy per `docs/database-safety.md`):
1. **Stage 1 tests:**
   - the catalog carries every gate-eligible piece with its slot annotations and recent-wear facts;
   - ineligible IDs are dropped and reported;
   - structural completion adds only missing structure, and reports it;
   - fallback on failure to each entry point's current roster;
   - the per-slot and whole-request limits.
2. **Stage 2 tests:**
   - every shortlisted photo is attached;
   - the shared fact line is used;
   - count-as-ceiling (`slot_gaps` / `skip`);
   - the unchanged acceptance;
   - the critic, the repair and needs-review keep their current triggers.
3. **Rebuilds with the provider stubbed:**
   - the guests-at-home turn (`thread_1793149288511`);
   - one `generate_outfits` turn (`thread_1792701395406`);
   - for each: catalog size against today's roster, photo count, request token estimate;
   - trip, capsule, single-outfit, Whole Wardrobe page and variants requests byte-identical before and after.

**Paid, owner-approved, one run per migrated entry point** on Flash-Lite, rated by the owner against the threads above.

## 10 · Implementation: coordinated plans (2026-10-27, verified offline)

**Stage 1** (`styling-engine/outfitSetPlanner.js`):
- **Gates first.** `buildPlanSlotWorkbench` now runs each slot's gates once (`gateSlot`, unchanged gate code), before any slot's working set is chosen.
- **One shortlist call.** For a coordinated plan, `selectPlanShortlistViaModel` makes one call with every gate-eligible piece and enforces the limits:
  - 40 per slot, or 60 for a one-slot plan;
  - 60 distinct pieces in all, taken in turn by slot in her order.
- **Each slot's working set.** `selectPlanWorkbenchFromShortlist` keeps her eligible picks in her order and reports any ID that isn't eligible. The shared contract adds only missing structure, after her picks, and never pads.
- **On failure** each slot uses `selectPlanWorkbenchPieces`, as before.
- **The record.** `pendingPlan.planShortlist` holds the source, her note, the catalog size and the picks per slot. The slot note reads "showing N you shortlisted of M allowed pieces".

**The model calls** (`routes/ai.js`):
- **Shortlist:** `shortlistCoordinatedPlanWithProvider`, with its system prompt, schema and user text (one sparse row per piece, ending in `| slots: …`, plus the shared notes block). Output cap 3,000–6,000 tokens.
- **Composition:** `composeCoordinatedPlanOnce`, with the shared fact line plus occasions, the notes, every shortlisted photo at 800px, and `coordinatedPlanCompositionSchema` (the trip schema without `worn_on_date`, with `slot_gaps`).
- **Its system prompt** has no packing contract. `target_outfits` is the most a slot may have, not a quota.
- **Wiring:** both are wired into `/ask` beside the trip composer (`toolContext.shortlistPlanRoster`, `toolContext.composeCoordinatedPlanOnce`).

**Acceptance** (`styling-engine/tools.js`): on the first plan of a turn, the composed outfits go through `executeToolInternal('submit_plan_outfits', …)` itself, so validation, assembly, `plan_lines` and the reply instructions are the existing ones.
- **A decline** lowers its slot's target by one and adds a coverage-gap line with her reason.
- **The cold-layer correction** the one-shot trip path applies is now a shared helper (`correctUnpermittedColdLayerDecisions`) used by both paths.
- **If composition fails or returns nothing,** the plan falls through to the tool loop with the same shortlisted working sets.
- **Follow-ups and partial re-plans** use the tool loop, as before.

**Verified offline:**
- `test/coordinated_plan_shortlist.test.js` (6 tests):
  - order, eligibility and no padding;
  - the limits and the fallback;
  - one shortlist call over the full catalog and one composition call, accepted by `submit_plan_outfits`, with a decline disclosed;
  - composition failure falls back to the loop with the shortlist;
  - trips never call the shortlist;
  - the prompts and schema.
- `node --test test/`: 2,621 of 2,621.
- **Rebuild of the guests-at-home turn** (the `plan_outfit_set` arguments from the `thread_1793148122720` capture, on a database copy, with the provider stubbed):
  - the shortlist request carries **316** eligible pieces as text (≈ 23.5k tokens, no photos), where the model used to see 62 pieces chosen by code;
  - each slot then reads "40 you shortlisted of 300 / 285 allowed";
  - the composition request carries 41 photos (the stub's picks) and ≈ 12k tokens of text;
  - with the stub's empty composition, the plan fell back to the tool loop as designed.
- The rebuild also caught a crash: usage recording on a call that reports no usage. It is fixed before any paid run.

**Not verified:** output quality and real cost. That needs one paid run of the same request on Flash-Lite, owner-approved.

### First live run and the per-part change (2026-10-27)

**The live run.** `plan_outfit_set` was called directly with the guests-at-home slots (Flash-Lite, $0.0288, 16 s), and the result was saved as `thread_1793157581231`.
- **What worked:** the shortlist call (304 pieces offered) and the composition call (42 photos) both ran, and all 4 cards were accepted first time.
- **What didn't:** the shortlist was not a choice. For the hosting slot Flash-Lite returned catalog rows 0–39 in order, and nearly the same for dinner. It picked no shoes out of 28, so structural completion added exactly one pair per slot, and all three hosting looks wore the same lace-up boots.
- **The trip shortlist has failed this way before:** Flash-Lite took "the first 90 lines" in `thread_1791015882776`.
- **Two earlier attempts through the full chat turn** ($0.088) didn't reach this path:
  - the first exposed `resolvePlanKind` treating the wearer's home city as a destination, which made an at-home plan a trip (fixed: `isWearerHomeLocation`, `styling-engine/tools.js`);
  - the second time, the router chose a prose answer.

**Change (owner, 2026-10-27): one list per part.**
- **The answer.** It's now `tops`, `bottoms`, `dresses`, `layers` and `shoes` per slot, with limits of 8 / 8 / 5 / 5 / 6 (32 per slot; `PLAN_SHORTLIST_PARTS`).
- **The catalog** is shown in one section per part, with counts, in identity order within each. Accessories are left out, because plan composition doesn't use them.
- **The prompt** asks her to "read the whole section, not its first lines". A list may stay empty only when that part has no place in the use case.
- **A garment in the wrong list** is dropped and reported (`misfiled`).
- **A list that copies its section** (the first N rows in order, N ≥ 4) is flagged in `planShortlist.inOrderLists` and the `planShortlistInOrderLists` diagnostic. It is recorded, never acted on.

**Verified offline:**
- `test/coordinated_plan_shortlist.test.js`: 8 tests, covering the part limits, the misfiled drop, and the in-order flag firing on a copy but not on a choice.
- **Rebuild of the guests-at-home plan, with a stub that copies the top of every section:** the sections read TOPS 116, BOTTOMS 75, DRESSES 22, LAYERS 45, SHOES 40. All 10 lists were flagged, and even that copied answer gives the composer 6 shoes per slot instead of 1. The request is ≈ 22.6k tokens.

**Not verified:** whether Flash-Lite now chooses rather than copies. That needs one paid run.

### First live app turn: the limit trimmed the shoes (2026-10-27)

**The turn.** `thread_1793158823046` was the owner's own app turn, Flash-Lite, with the per-part shortlist live. The stylist planned three slots: Hosting Days, Restaurant Dinner, and Weekend Outings (which the user didn't ask for). Shortlist and composition (63 photos) both ran. All 4 cards were accepted. The turn cost **$0.064**:

| Call | Cost |
|---|---|
| router | $0.001 |
| first loop call, with `plan_outfit_set` | $0.019 |
| shortlist | $0.011 |
| composition | $0.027 |
| closing reply | $0.007 |

No part list was flagged as copied: she chose, and her shoe lists suited each slot.

**The bug.** Each slot's ids were concatenated part by part, with shoes last. The 60-piece whole-request limit, shared across three slots, trimmed each slot to about 24 and cut every chosen shoe:
- the dinner card's pink flats came from structural completion;
- both hosting looks borrowed the Weekend slot's mesh sneakers. That was accepted, because the validator checks a slot's gates, not its shortlist.

**Fix.** Each slot's ids are now interleaved part by part before the limit applies. A test covers a three-slot plan at the limit.
- **Replayed on her captured answer:** each slot keeps 4–6 of every part, including 4 of her own shoes (hosting: canvas slip-ons, suede slip-ons, cutout flats, canvas sneakers; dinner: wedges, heels, two ankle boots).
- **Limit raised (owner, 2026-10-27):** a plan with three or more slots may show **90** photos (`MULTI_SLOT_SHORTLIST_PHOTO_LIMIT`, `planShortlistPhotoLimit`); one or two slots keep 60. The prompt states the slot's own limit.
  - **Replay on her captured answer:** every slot keeps all 32 of her picks (8/8/5/5/6), 85 distinct pieces.
  - **Cost:** the three-slot composition call grows from ~60 to ~85 photos, roughly +$0.008 on Flash-Lite.

### Follow-ups: the stylist's own looks, and dates in the user's time zone (2026-10-27)

**The incident.** `thread_1793165996825`. Turn 1 was routed to words, and the stylist wrote a four-day plan. Turn 2, "show me these outfits", was routed to cards. The stylist called `plan_outfit_set` with one slot per day, so the no-rotation fix held. Two things then went wrong:
- **New outfits, not hers.** The new plan path recomposed every slot from its own shortlist, producing five outfits unrelated to the ones she had described. Before this spec, the plan returned working sets and she submitted her own outfits. §5 meant follow-ups to stay in the loop, but only re-plans were exempt.
- **The wrong week.** The plan moved to 4–7 November. The stylist had passed 28–31 October, but the stated-date override (`extractStatedTripDateRange`, routes/ai.js → tools.js) read "this coming Wednesday" from a UTC instant. At 10:48 pm Pacific on Tuesday it was already Wednesday in UTC, so the override chose the next week and ignored "through Saturday". Every slot date was then shifted by +7 days.

**Change.**
- **Slot `looks`** (`plan_outfit_set`): each slot may carry up to 3 looks, each with its exact piece IDs. This is for when the looks are already decided, for example "show me the outfits you described".
  - **When every slot of a coordinated plan carries looks:** no shortlist and no composition. Each slot's target is her look count, and the looks go through `submit_plan_outfits`' unchanged validation. A rejection comes back to the loop to fix, as any submission does.
  - **Looks on only some slots** are ignored, and the plan is composed as usual.
- **`extractStatedTripDateRange`:**
  - takes `timeZone` (the app sends `America/Los_Angeles`) and reads "today" in it;
  - a weekday followed by "through / to / until / –" another weekday ends the range on that day (`hasExplicitDuration`);
  - without a time zone it behaves as before.

**Verified offline** in `test/coordinated_plan_shortlist.test.js`:
- given looks are carded exactly, with no shortlist or composition call;
- partial looks don't bypass composition;
- the guests request at 05:48 UTC with Pacific time resolves to 28–31 October, 4 days.
`node --test test/`: 2,628 of 2,628.

**Not verified:** whether the stylist uses `looks` when asked to show what she described. That is her choice from the tool description, and it needs a paid follow-up turn.

**Noted:** the client's time zone is hard-coded to `America/Los_Angeles` (`StylistChat.jsx`), which is wrong for other users of a multiuser app.

### The season, stated (2026-10-27)

**The incident.** `thread_1793167020175` produced warm-season looks for a late-October stay at home: three of four looks were sleeveless dresses tagged `season: warm`.
- The season gate is off (owner ruling 2026-09-12). Before, the code-ranked workbench still sank out-of-season pieces through the ranking advisory. The model shortlist doesn't rank, so that signal was lost.
- Each catalog row showed `season:warm`, but no use-case line stated the season. Only the composer's buried `calendar_season` field said "fall".
- A follow-up turn then invented "you mentioned running cold" (the explanation path), and "go ahead" kept two of the same dresses.

**Change (owner, 2026-10-27, no new gate):**
- Each plan shortlist use-case line states `season: fall (the current season)`, via `seasonPromptLabel`.
- The composer's slot view puts `season` beside each slot's label.
- Both conventions say a garment's season is the season it is tagged to be worn in.
- An unresolved "current season" is left out.

**Verified offline:**
- One test covers the slot line and the convention. `node --test test/`: 2,629 of 2,629.
- **Rebuild of the thread's first plan call** (its exact `plan_outfit_set` arguments, database copy, provider stubbed): every shortlist use case reads "season: fall (the current season)", and the composer's slots carry `season` second after `label`. The warm-tagged dress rows keep `season:warm` beside it.

**Not verified:** whether she now weighs the tag. That needs a paid turn.

## 11 · Superseded: one plan_outfit_set roster step and one prompt per stage (2026-10-28)

**§10's per-part shortlist is removed.** Owner, 2026-10-27: "the same garment selection mechanism as the trip flow"; 2026-10-28: "a generic plan_outfit_set flow".

**Selection.** Every plan that is not a budgeted capsule chooses its roster in `buildPlanSlotWorkbench` through `selectPlanRosterViaModel` (`selectTripRosterViaModel` is kept as an alias). The steps:
1. Every gate-eligible piece, each with the use cases it can serve.
2. One roster call.
3. The trip's coverage check (`validateTripRoster`), with one repair.
4. On failure, every eligible piece, disclosed.

For a plan that is not a trip:
- no season exclusion (the season is stated in each use-case line instead);
- no shortlist and no candidate photos;
- the roster reaches each slot whole, with no 40-piece cut.

The chooser is `chooseTripRosterWithProvider({ planKind })` (`choosePlanRosterWithProvider` wraps it).

**Prompts.** `tripRosterSelectionSystemPrompt({ planKind })` and `tripPlanCompositionSystemPrompt({ planKind })` are the only roster and composer prompts. For `planKind: 'trip'` they are byte-identical to before. For any other plan, only what packing adds is left out or reworded.

The first version (2026-10-27) used separate prompts for non-trip plans. Live `thread_1793168664810` and `thread_1793170279858` then dressed indoor hosting days at 64–70°F in cashmere. Those prompts had dropped the trip's warmth, layer and indoor-base lessons along with the packing.

Roster prompt, trip-only:
- the suitcase and 5-4-3-2-1 sizing paragraph;
- picturing the destination;
- THE USE CASES ARE NOT A SCHEDULE;
- HOW A DAY AWAY WORKS;
- HOW THE TRAVELLER PACKS;
- REUSE ACROSS USE CASES;
- the WHAT TRAVELS WELL header and its bullets on creasing, room, the journey, a long day, how much of the suitcase a piece works with, and wearing again;
- the second-pair-of-shoes sentence;
- A DISTINCT JOB FOR EVERY BULKY PIECE.

Roster prompt, reworded for other plans:
- the intro;
- the request paragraph (THE REQUEST, the person's own words, replaces HOW THE TRAVELLER PACKS);
- the outfit count as a ceiling;
- the "Where the warmth comes from" and "What layers are for" bullets, under WHAT A DAY ASKS OF A GARMENT;
- needs-base;
- shoes;
- LAYERING / OUTERWEAR;
- piece jobs and reasoning;
- the photo sentence.

Composer prompt, trip-only:
- the itinerary, destination and suitcase-reuse sentences;
- the exact-count sentence (a count is a ceiling for other plans);
- HOW A DAY AWAY WORKS.

Composer prompt, reworded: "packed roster" and "suitcase" become the allowed pieces or the wardrobe.

**Verified offline.**
- Tests: 2,627 pass.
- Trip roster and composer prompts: byte-identical to before the change.
- Both threads' first plan requests were rebuilt from their captured `plan_outfit_set` arguments on a DB copy, with stubs in place of the provider. Each roster call gets the shared prompt, the request in the person's own words (once), the season and outdoor conditions in each use-case line, and all 286 candidates.
- Not run live.

### Nothing about packing in a plan that packs nothing (2026-10-28)

Owner: "'Reuse: maximize' is not a small thing … make sure nothing leaks." A review of the code trips and other plans share found these, all now fixed:
- **`reuse: 'maximize'`** means packing light. On any plan kind it added "pack at most 3 pairs of shoes … fewer to pack" to the composer and rejected a 4th pair of shoes. Now only a trip or a capsule takes it; `buildPlanSlotWorkbench` drops it for every other plan, and the shoe cap checks the plan kind too.
- **The plan summary** said "Packing reuse: …" (shown as a "Packing" row) on a plan with no reuse setting. Other plans now report their repeats ("Every look is distinct" / "Repeat schedule").
- **A piece outside the stylist's chosen set** was rejected as "not an active wardrobe piece". It is now checked against the slot's gates and accepted, as on a trip; only a trip adds it to the packed set. The layer messages name "the pieces chosen for this plan" instead of the packing roster.
- **The roster call never saw the plan's shared rules.** It is now told the pieces the looks are built around (`shared_anchor_ids`) and the categories where nothing repeats (`no_repeat`), for trips as well. A selection that leaves out a piece the looks are built around fails with `anchor_missing` and gets the one repair. With no shared rules the prompt is unchanged.

Not changed: the schema's enum value `assigned_packed_layer` (an identifier the composer prompt explains for every plan).

### The layering contract, for every plan (2026-10-28) — set aside 2026-10-29

Built and verified offline (the one-layer sentence dropped, `allowMiddleLayer: true` for every plan kind), but live
runs showed no better outfits. Owner, 2026-10-29: set aside with the situation read, `get_weather`,
`wearing_strategy` and `time_outside`; all of it is kept on branch `wip/situation-read-set-aside`. Other plans keep
the one-layer sentence for now.

### No reuse line for a plan that packs nothing (2026-10-29)

`thread_1793264604857`: the plan summary handed to the stylist carried "Repeat schedule: tan leather slip-on shoes
(Friday: Daytime Hosting, Saturday: Hosting & Relaxing)", and her reply turned it into a "Repeat Schedule" section.
Owner: it does not belong in an at-home plan. `buildPlanReport` now writes no reuse line ("Repeat schedule",
"Every look is distinct", "Packing reuse") for any plan kind but a trip; trips keep their lines as before (the
2026-10-28 change that sent other plans the repeat line is undone). Offline: the thread's captured plan call, roster
and composed looks rebuilt on a DB copy return plan lines with no reuse line. Pinned in `test/plan_roster.test.js`.
