# Garment memory and user feedback — what exists, what reaches the model, what is dead

Audited 2026-08-07 by reading the code and measuring the live wardrobe (242 active pieces,
read-only queries, no writes and no model calls). Written because the surface has grown to
**five independent channels** that look equivalent in the UI and are not equivalent in the engine.

Nothing in this document is a proposal that has been implemented. It is the map.

## 0. The ruling that scopes this

**Owner, 2026-08-07: a seasonal material or category ban must not be global.** "I do not want
boots being excluded from summer capsules for everyone. Some people keep wearing boots in the
summer with no problems at all."

This retires the option floated the day before — filling `prohibited_materials_warm` on the
occasion profiles — because those profiles ship with the app and now serve every user. A personal
preference must live in that person's own data. It also means the target is not "make boots-in-
summer work"; it is that a personal rule should reach the places that decide, whichever they are.

## 1. The five channels

| # | channel | stored as | written from |
|---|---|---|---|
| A | **Tagged garment truth** | `pieces` columns (`season`, `fabric_category`, `needs_base`, `occasions`, `opacity`…) | tagger, plus manual edits |
| B | **Per-garment user memory** | `pieces.styling_rules_learned`, `pairs_well_with`, `tried_and_rejected`, `notes` | Edit modal → "What the stylist should remember" / "Styling notes" |
| C | **Occasion exclusions** | `pieces.occasion_exclusions` | Stylist chat → "Wrong for" |
| D | **Model-authored garment intelligence** | `pieces.style_profile_json.garment_intelligence` (`do_not_pair_rules`, `pairing_requirements`, `failure_risks`, `formula_compatibility`, `real_wear_notes`) | the tagger |
| E | **Standing prose rules** | `stylist_feedback` rows where `target_type='message'` | chat, `store_user_correction` |
| F | **Outfit and board feedback** | `stylist_feedback` rows, other target types | verdict + reason chips, card actions, piece menu |

"Protected edits" is not another channel — it is `style_profile_json._confidence.<field> = 'manual'`,
which makes `trustedFieldText` emit that field as owner-confirmed rather than a tagger guess.

### Channel F in detail — the largest one by volume

This is where almost all the feedback actually is, and it has its own taxonomy in
[lib/feedbackTaxonomy.js](../lib/feedbackTaxonomy.js):

- **Overall verdict**, 4 values — `signature` / `works` / `almost` / `not_me` ("This feels exactly
  like me" … "Not for me"). The same 4 back the card-level "More like this" / "Not for me".
- **Style direction**, 15 reasons — too plain, too polished, feels too delicate, does not feel
  personal, feels like a costume, looks like a generic store outfit, shoes do not ground the look…
- **Fit and shape**, 7 reasons — looks too bulky, my shape disappears, top and bottom do not work
  together, the layer lengths look awkward…
- **Image fidelity**, 4 reasons plus 6 wrong-length sub-reasons — deliberately separate, because a
  bad render is not a bad outfit idea. The UI says so explicitly.
- **Per-piece menu on a card** — "Edit piece details" writes channel A/B, "Replace in this outfit"
  writes a scoped per-piece negative, "Wrong for `<occasion>`" writes channel C.

## 2. How much of each is actually used

Measured on the live wardrobe, 242 active pieces:

| field | pieces carrying it |
|---|---:|
| `notes` | **197 (81%)** |
| `styling_rules_learned` | 44 |
| `occasion_exclusions` | 7 |
| `tried_and_rejected` | 2 |
| `engine_notes` | 2 |
| `pairs_well_with` | **0** |

And in `stylist_feedback`, non-archived, by delivery eligibility:

- 6 rows qualify as owner rules (`owner_rule`, or `preference_reaction` with `target_type='message'`)
- ~290 rows do not, across roughly 40 `feedback_type`/`target_type` combinations

## 3. The reach matrix — capsule flow

Three consumers decide a capsule: the deterministic gate (which both roster paths share), the
roster-selection prompt, and the composition prompt.

| channel | deterministic gate | roster selection | capsule composer | ordinary plan catalog |
|---|:--:|:--:|:--:|:--:|
| A tagged truth | ✅ | ✅ | ✅ | ✅ |
| C `occasion_exclusions` | ✅ | ✅ | ✅ | ✅ |
| B `styling_rules_learned` | ❌ | ✅ | ✅ | ✅ |
| B `tried_and_rejected` | ❌ | ✅ | ✅ | ✅ |
| B `notes` (197 pieces) | ❌ | ✅ | ✅ | **❌** |
| B `pairs_well_with` | ❌ | ✅ | ✅ | **❌** |
| D `do_not_pair_rules` | ❌ | ✅ | ✅ | **❌** |
| D `pairing_requirements`, `failure_risks` | ❌ | ✅ | ✅ | **❌** |
| E standing prose rules (6 rows) | ❌ | ✅ | ✅ | ✅ |
| F outfit/board feedback (~290 rows) | ❌ | ❌ | ❌ | ❌ |

### Where channel F does go

It is not dead — it is just absent from the capsule. Every other generation surface reads it:

| reader | consumed by | deterministic? |
|---|---|:--:|
| `getStylistFeedbackMemory` (piece-scoped, outfit-scoped, and global) | freeform stylist chat ([core.js:4019-4031](../styling-engine/core.js)), `/evaluate-piece` | no — prompt text |
| `getWholeWardrobeFeedbackMemory` | whole-wardrobe generator ([routes/ai.js:1510](../routes/ai.js), [core.js:2821](../styling-engine/core.js)) | no — prompt text |
| `buildGoldStandardFeedbackMemory` | `/evaluate-piece` | no — prompt text |
| `getSavedBoardRendererMemory` | the renderer ([core.js:57](../styling-engine/core.js)) | no — prompt text |
| **`getFeedbackInfluenceForPair`** | `compatibilityScoreForSelectedItem` → `rankedComplementaryWardrobeFor` → `selectCandidatesForOutfitGeneration` | **yes — weighted score** |

That last row matters: outfit feedback **does** have mechanical force somewhere in this app.
`getFeedbackInfluenceForPair` carries a full signed weight table — positives (`good_pieces` +16,
`good_formula` +14, `almost` +4) and negatives (`bad_reference` −36, `catalog_drift` −34,
`fit_issue` −34, `not_me` −32, `too_generic` −26, `bad_occasion` −22 …) — and moves deterministic
candidate ranking for single-piece outfit generation. So "a personal preference cannot be enforced
deterministically" is not a law of this codebase: a structured, per-user, weighted consumer already
exists. It was simply never wired to the capsule.

**Both capsule prompts get full garment truth.** There are two piece-text builders, and the
capsule path deliberately uses the rich one in both places:

- `buildPieceText` → `buildWardrobePieceTruthText`
  ([src/utils/wardrobeAiContext.js:199](../src/utils/wardrobeAiContext.js)) — rich, includes all of
  B and D. Used by roster selection ([routes/ai.js:2997](../routes/ai.js)) **and** by the atomic
  capsule composer ([routes/ai.js:3153](../routes/ai.js)), which overrides the workbench's compact
  catalog for exactly this reason — its own comment records that the compact line's omission "allowed
  a relaxed hoodie under a relaxed cardigan even though both records explicitly prohibit another
  loose top."
- `planWorkbenchPieceLine`
  ([styling-engine/outfitSetPlanner.js:2420](../styling-engine/outfitSetPlanner.js)) — the compact
  line. It carries `styling_rules_learned` and `tried_and_rejected` but **not** `notes`,
  `pairs_well_with`, or anything from D. It survives as `workbench.piece_catalog`, which is what the
  model tool-loop `submit_plan_outfits` path reads
  ([styling-engine/tools.js:2026](../styling-engine/tools.js)) and what an ordinary non-capsule plan
  uses.

So the drift is real but it does **not** affect the capsule flow. It affects the ordinary plan path.

## 4. Defects this exposes

### 4a. The compact catalog is missing `notes` — on the non-capsule path only

`notes` is populated on 197 of 242 pieces, by a wide margin the most-used memory field. It reaches
both capsule prompts. It does **not** reach `planWorkbenchPieceLine`, so an ordinary plan and the
`submit_plan_outfits` tool-loop compose without it, as they do without `do_not_pair_rules` and the
rest of D. The capsule composer's own override is the precedent that this omission causes real
defects; the same argument applies to the path that still has it.

### 4b. Do-not-pair rules ARE in capsule context — the standing note is correct

`capsule-do-not-pair-rules-unenforced` records that the composer sees a piece's `do_not_pair_rules`
and can violate them anyway. **This audit initially contradicted that and was wrong**;
`composeCapsulePlanOnce` sends full truth text, so the rules were in context and the model composed
the pairing regardless. Nothing is missing from the plumbing.

The consequence stands as the note already framed it: for a capsule, a stated do-not-pair conflict
is advisory prose with no deterministic backstop after the fact. `do_not_pair_rules` only affects
scoring in the separate whole-wardrobe soft-score path, which the capsule composer never calls.

### 4c. `pairs_well_with` is a field with a UI, a reader, and no data

Zero of 242 pieces carry it. It has an input in the Edit modal, a clause in
`buildWardrobePieceTruthText`, and a matcher in `rules.js:453`. Either it is not discoverable,
not useful, or redundant with `styling_rules_learned` (44 pieces). Worth deciding rather than
leaving as furniture.

### 4d. The feedback panel implies a parity that does not exist

"Learned rules & preferences" lists rows that are delivered to the model beside rows that are
not, with identical styling. The discriminator is `target_type`, which is invisible in the UI, and
it does not correspond to the "OWNER RULE" / "PREFERENCE REACTION" labels shown. Live example: the
cream crochet top rule (id 337, `preference_reaction`/`piece`) reaches nothing, while
"I don't wear boots in the summer" (id 234, `preference_reaction`/`message`) reaches both prompts.

### 4e. The capsule is the least feedback-aware surface in the app

Every other generation path reads channel F. The capsule reads **6 rows** — the standing prose
rules — and nothing else. Roughly 290 recorded verdicts and reason chips, including every
"Not for me", every "my shape disappears", and every "shoes do not ground the look", inform the
freeform chat, the whole-wardrobe generator, the renderer and the deterministic pair scorer, and
inform neither capsule roster selection nor capsule composition.

Two corollaries worth stating plainly, because they were each assumed wrong once during this audit:

1. **This is not a "prose cannot be enforced" problem.** `getFeedbackInfluenceForPair` already
   turns per-user feedback into a weighted deterministic score. The mechanism exists, is per-user,
   and is exactly the shape §0's ruling requires. It was simply never called from the capsule path.
2. **It is also not only a deterministic problem.** The capsule's *prompts* don't get channel F
   either, so even the model-chosen roster is composed by a stylist that cannot see what the person
   has said about ~290 previous outfits.

Separately, `selectCapsuleRoster` and `buildCapsuleBench` take no rules argument at all, so a
personal rule constrains a model-chosen roster and cannot constrain an engine-chosen one. Only C
(`occasion_exclusions`) is both personal and deterministic today — and its only axis is occasion,
so it cannot express season, material, or weather. That is the structural gap behind the boots
observation, and per §0 the fix must be per-user data, not a shipped profile.

## 5. Proposed order

None of this is implemented. Ordered by what it buys, not by what is cheapest — the volume
finding in 4e changed the ranking.

1. **Give the capsule channel F.** The two capsule prompts should receive the same outfit-feedback
   memory the freeform chat already gets, and the capsule roster should consult
   `getFeedbackInfluenceForPair` — or an equivalent — the way single-piece generation already does.
   Closes 4e, which is the only item that changes output quality on the surface being actively
   worked. Do it in that order: prompt first (cheap, reversible, measurable on one run), scoring
   second (deterministic force, so it needs the #44 caution and a ranking A/B).
2. **Make the feedback panel show what is delivered.** Either surface the `target_type`
   distinction, or widen the selector so a piece-targeted correction is delivered too. Closes 4d.
   A rule the person believes they stored that reaches nothing is the worst failure here.
3. **Close the compact catalog's gap on the non-capsule path.** Extend `planWorkbenchPieceLine`
   with `notes` and the D fields, or have it call `buildWardrobePieceTruthText` — one builder, no
   drift. Closes 4a. Prompt-only, and the capsule composer's override is the precedent; measure the
   workbench token growth first, since the compact line exists because the ordinary path shows many
   more pieces than a fixed roster.
4. **Decide `pairs_well_with`'s fate** — populate, merge into `styling_rules_learned`, or remove.
5. **Extend `occasion_exclusions` to a general per-user garment exclusion** with a season/weather
   axis, or add an optional structured predicate to a stored rule. The remaining half of 4e: it is
   what lets a personal rule bind the deterministic selector rather than only the model. A design
   change rather than a repair; needs an owner ruling before design.

### One question this audit cannot answer

Whether feedback given on a *rendered board* should steer *capsule roster selection* at all. A
"looks too bulky" on one visualised outfit is evidence about that outfit; treating it as evidence
about a garment's place in a 24-piece capsule is a bigger inferential step than the existing
readers make. `getStylistFeedbackMemory` already draws this line — it labels scoped reactions
"taste signals, not global directives" and severs them from standing rules. Item 1 should respect
that line rather than flatten it.

## 6. Standing constraints that apply here

- Personal preferences are per-user data, never a shipped profile (§0).
- Stored prose must never get absolute mechanical authority — the #44 memory-pollution lesson,
  recorded in `getOwnerRuleNotes`'s own comment.
- Do not retag the wardrobe to work around a missing rule; fix the tagger first, then retag once.
- A field that decides output needs a source, an owner ruling, or a measurement.
