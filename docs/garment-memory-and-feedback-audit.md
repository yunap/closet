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
| E | **Conversation feedback** | `stylist_feedback` rows | chat reactions, `store_user_correction` |

"Protected edits" is not a sixth channel — it is `style_profile_json._confidence.<field> = 'manual'`,
which makes `trustedFieldText` emit that field as owner-confirmed rather than a tagger guess.

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
| E owner rules (6 rows) | ❌ | ✅ | ✅ | ✅ |
| E everything else (~290 rows) | ❌ | ❌ | ❌ | ❌ |

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

### 4e. No personal rule can reach the deterministic layer

Channels B, D and E are prose. `selectCapsuleRoster` and `buildCapsuleBench` take no rules
argument, so a personal rule constrains a model-chosen roster and cannot constrain an
engine-chosen one. Only C (`occasion_exclusions`) is both personal and deterministic — and its
only axis is occasion, so it cannot express season, material, or weather.

This is the structural gap behind the boots observation, and per §0 the fix must be per-user data,
not a shipped profile.

## 5. Proposed order

Cheapest and least contentious first. None of this is implemented.

1. **Close the compact catalog's gap on the non-capsule path.** Extend `planWorkbenchPieceLine`
   with `notes` and the D fields, or have it call `buildWardrobePieceTruthText` — one builder, no
   drift. Closes 4a. Prompt-only, and the capsule composer's override is the precedent; measure the
   workbench token growth first, since the compact line exists because the ordinary path shows many
   more pieces than a fixed roster.
2. **Decide `pairs_well_with`'s fate** — populate, merge into `styling_rules_learned`, or remove.
3. **Make the feedback panel show what is delivered.** Either surface the distinction, or widen
   the selector so a piece-targeted correction is delivered too. Closes 4d.
4. **Extend `occasion_exclusions` to a general per-user garment exclusion** with a season/weather
   axis, or add an optional structured predicate to a stored rule. This is the only item that
   makes 4e go away, it is the only one that is a design change rather than a repair, and it needs
   an owner ruling before design.

## 6. Standing constraints that apply here

- Personal preferences are per-user data, never a shipped profile (§0).
- Stored prose must never get absolute mechanical authority — the #44 memory-pollution lesson,
  recorded in `getOwnerRuleNotes`'s own comment.
- Do not retag the wardrobe to work around a missing rule; fix the tagger first, then retag once.
- A field that decides output needs a source, an owner ruling, or a measurement.
