# Feedback routing — proposal

**What exists is described in [`feedback-and-memory-map.md`](feedback-and-memory-map.md).** This
document does not restate it and carries no measurements of its own; where a number is needed, run
`node scratch/measure_feedback_surface.js` and cite the section. If this document and the map
disagree, the map is right.

Written 2026-08-08, after mapping the surface.

## The problem in one sentence

Feedback is collected in six channels and treated as if it answered one question, so most of it
either lands in a prompt or lands nowhere, and several reactions carry authority in two places at
once. Prompt text is also the destination with the worst cost-to-value ratio of the five available.

## Product direction: learn the logic, diversify the closet

The purpose of positive outfit feedback is **not** to consolidate existing combinations or keep
putting the same garments together. The app exists to help a person rediscover their closet.

When a look works, the future capability must extract its transferable styling logic:

- **formula** — the roles and relationships among the garments;
- **silhouette** — the proportion and shape relationship that worked;
- **mood** — the emotional or aesthetic register;
- **context** — where, when and under what practical conditions it worked.

The stylist should then use that logic to discover other viable combinations, subject to recency
and diversity. Literal garments and pairs from the original look receive no permanent selection
advantage. Reassembling the same items is the opposite of the intended learning behaviour.

## 1. Five destinations, and one primary reader each

Every piece of feedback answers one of five different questions. Route by the question.

| question answered | canonical destination | authority |
|---|---|---|
| Is the garment description wrong? | structured metadata / retag task | **factual** |
| Is this garment prohibited in this context? | structured scoped constraint | **hard gate** |
| Did this garment, pairing or formula work *here*? | scoped combination evidence | **soft influence** |
| Is this a durable personal principle? | consolidated owner rule / constitution | **prompt** |
| Is the generated image wrong? | renderer calibration | **renderer only** |

> **One reaction, one primary behavioural reader.** A reaction may leave an audit receipt
> elsewhere, but it must not independently move a score *and* repeat the same instruction in a
> prompt unless that duplication is deliberately justified and tested. Most of the mess this
> document addresses is accumulated double authority: the same click becoming a score, a prompt
> line, and an authoritative garment rule.

### A · "The garment data is wrong" → a retag task

The only destination that **fixes the system permanently** instead of steering one generation. It
already exists and works: a wrong-length board complaint becomes a `retag-suggestion` to-do naming
the garment *and* the field, which clears when that field is saved, and which never changes a tag
by itself. See the map §3 → *Into `todos`*.

It currently covers only the six wrong-length reasons. **The routing unit is the sub-reason, not
the feedback type** — a complaint routes only when it names **one garment and one field**:

| feedback | routes? | field it implicates |
|---|---|---|
| `wrong_length` sub-reasons | ✅ shipped | `length_hits_at`, `sleeve_type` |
| `bad_occasion` | ✅ candidate | `occasions` |
| `layer_too_long`, `competing_hemlines` | ✅ candidate | `length_hits_at` |
| `wrong_item_read` | ⚠️ aggregate only | `occasions`, `formality`, `reads_as` |
| `wrong_garment_details` | ❌ **not yet** | ambiguous — see below |
| `fit_issue`, `too_much_volume`, `shape_lost`, `unbalanced_proportions`, `too_columnar` | ❌ relational | none — these describe two garments against each other |

**`wrong_garment_details` fails this rule on both halves and stays in destination B.** It names one
garment but implicates several fields at once (`reads_as`, `pattern_*`, `neckline`, `sleeve_type`)
with no field-level sub-reason to disambiguate — unlike `wrong_length`, which ships six. And it is
classified as **image fidelity**, so the complaint may be that the *render* drifted rather than that
the wardrobe metadata is wrong; routing it to a retag task would ask the owner to correct data that
may be correct. It becomes a candidate only if the UI first collects an explicit field-level
correction, the way the wrong-length flow already does.

`fit_issue` is `target_type='whole_wardrobe_outfit'`: a judgment about how an outfit hangs together,
not about the garment field `fit_on_body`. Relational complaints belong in destination C.

The safety property that makes imperfect routing acceptable here: a wrong suggestion costs one
dismissed to-do, never a corrupted tag.

### B · "The picture is wrong" → render calibration

**Two things share this destination and only one of them works.**

- **Saved-board image-fidelity feedback** (`wrong_length`, `wrong_garment_details`,
  `body_proportions_drift`, `identity_drift` on `target_type='generated_visual_board'`, plus
  `saved_boards.payload.feedback_labels`) — reaches the image prompt via
  `getSavedBoardRendererMemory`, and is correctly excluded from both pair scorers. This half is
  **[by design]** and working.
- **`renderer_calibration` rows** — the retired experimental path. It reached no renderer and
  formerly leaked into garment selection. New writes now receive HTTP 410; historical rows remain
  untouched and defensively excluded from both scorers.

The active calibration capability is the saved-board image-fidelity path above plus uploaded
calibration/reference images. Retiring the dead target does not remove either working mechanism.

### C1 · "This garment is prohibited in this context" → a scoped constraint

**Hard, and it already works.** `occasion_exclusions` is the only per-garment channel that is both
personal and deterministic (map category 1). *"Never use these shorts for hiking"* belongs here, and
the answer is binary — the garment is removed from consideration for that context.

Its one axis is occasion. Extending it to other axes (season, weather) is the change that would let
a personal rule bind the deterministic layer without becoming a global rule — the requirement the
2026-08-07 ruling created.

### C2 · "Did this garment or pairing work *here*?" → scoped evidence

**Soft, and currently too broad.** *"I didn't like these shorts in this outfit"* is weak evidence
about one context, not a standing judgment on the garment. Evidence must therefore carry its scope:

- garment × occasion
- garment × garment
- formula × context
- garment globally — **only when the person says so explicitly**

A rejection of one outfit must not become a permanent negative on every garment in it. That is not
hypothetical: it is what `wrong_item_read` does today (plan item 0.3).

**Do not simply revive `buildWholeWardrobeFeedbackInfluence`.** An earlier draft of this document
recommended that on the grounds that it already computes per-piece, per-combination, per-formula and
per-occasion influence. That reasoning was wrong — *the mechanism existing is not evidence that
mechanical scoring is the right product behaviour*, and switching on a dormant aggregate scorer
would amplify exactly the loops this document is trying to break. Define the canonical evidence
model and the ranking behaviour first; then adapt, replace or delete it.

### D · "This is a standing instruction" → the prompt

Only what cannot be a tag correction or a score.

> **The routing rule: the prompt is the destination of last resort, not the default.**

## 1b. Retire the generic "Save as styling rule" button

Its destination is not the problem — the button says "Save as
styling rule" and `styling_rules_learned` is what that means. Three product concerns are:

- it makes an **entire assistant message** authoritative, unedited;
- it **duplicates** the automatic capture that `store_user_correction` already performs;
- it can freeze **temporary outfit context** as permanent garment guidance — live example in map
  §2b, a saved reply about one outfit's trousers now standing as a rule on a cardigan.

Proposed direction:

1. Remove the generic button.
2. Keep garment-level Rules learned as a field, for short authored rules.
3. **Extend `store_user_correction` to accept a verified `piece_id`** — this is the actual missing
   capability. Correction capture exists; what it cannot do is scope a correction to a garment,
   even when the model has just named that garment and its ID in the note it wrote.
4. Show a piece-scoped correction in **both** Conversation Memory and the garment card, backed by
   **one** canonical record rather than the two unreconciled stores that exist now.
5. Where a correction maps cleanly onto an enforceable field — an occasion above all — write the
   structured exclusion rather than prose.

Point 3 is the highest-value item in this document. It is what would have made
*"never use the beige tailored linen shorts (ID 242) for home outfits"* binding rather than
advisory, without a global rule and without a prompt line.

## 1c. Favourites — decide what they mean

Three "favourite" flags exist and none of them is documented as a selection instruction, yet two
carry deterministic weight (map §1):

| flag | effect found by the audit | rows at audit time |
|---|---|---|
| `saved_boards.favorite` ("Use strongly") | **+45** per garment pair in that board, capped at 70 | 0 |
| `pieces.favorite` | **+4**, **+10**, and a sort tie-break | 0 |
| `outfits.favorite` / `status='confirmed'` | prompt memory, ordered `favorite DESC` | 3 / 24 |

**The question to settle: is "favourite" an organisational label, or an instruction to select this
more often?** Recommendation — **organisational only**. If more-frequent selection is wanted, it
should be a separate, explicitly labelled control, because a heart that silently triples a garment's
ranking weight is not a thing the person agreed to.

**Both weighted flags had zero rows**, which made this the cheapest moment to decide: neutralizing
the saved-board pair scorer required no migration and deleted no feedback.

**The live sameness risk was the other branch of the same scorer.** `getSavedBoardInfluenceForPair`
awarded **+18** to every pair in any board carrying positive feedback, favourite or not, and **+6**
for an `almost` reaction — and
**36 of 243 boards currently pass that filter, boosting 70 distinct garment pairs.** If the concern
is that the system keeps proposing the same combinations, that is where it is happening now, not in
the dormant +45. The scorer is now neutral: the reaction remains outfit-level evidence and
provenance, with no exact-pair boost.

## 1d. Saved outfits are prompt memory too

24 confirmed and 3 favourited outfits reach the prompt through `getConfirmedOutfitMemory` and
`getOutfitsForPieceMemory`. The discipline in §2 was written for feedback rows and applies here
equally: summarise them into **formula evidence** — the relationship that worked — and include
literal examples only when relevant to the garment in play. A list of past outfits invites literal
reuse, which is the same failure as an evergreen preference.

## 1e. Structured constraints must be canonical

An occasion exclusion is currently both a structured hard gate and a generated prose line in
`styling_rules_learned`. The UI now removes them coherently, but the prose receipt can still repeat
the same instruction in a prompt. Keep the structured exclusion as the sole behavioural authority;
show its provenance in the UI without delivering the generated receipt as a second rule.

## 1f. Calibration approval must say what was approved

`calibration_images.favorite` does not distinguish approval of likeness, garment depiction,
silhouette, styling, or rendering quality. Those meanings cannot safely share styling authority.
Replace the undifferentiated signal with purpose-specific labels; only an explicit styling label
may enter styling memory.

## 1g. Positive feedback must not defeat diversity

Prompt size and selection diversity are separate concerns; compact feedback can still dominate if
its weight is high enough. There is already a mechanism pulling the other way — the 6-day recency
suppression in `whole_wardrobe_sessions` (map category 8) — and nothing reconciles the two.

> **Principle.** Positive feedback may raise confidence in a *transferable formula*. It must not
> defeat recency suppression, and it must not create an evergreen preference for the same garments.

Any scoring change in the plan below has to be evaluated against this, not only against whether the
weights look reasonable in isolation.

## 2. Prompt-size discipline

Where feedback does reach a prompt, three rules. This is what makes it affordable to give the
capsule its share at all. The readers **are** capped — 8, 10, 12, 16, 20, 24 rows depending on the
call site, and several truncate each note. Phase 1 now consolidates identical structured
outfit-logic observations. The remaining risk is raw legacy evidence within those caps, where
repeated observations about one garment can still spend N slots saying similar things and land in
the prompt tail where this codebase has already measured stored rules losing (spec 25/26).

1. **Scope to the pieces in play.** Only feedback touching a garment on the bench or in the outfit.
   `getSavedBoardRendererMemory` already does this correctly — copy its overlap check.
2. **Consolidate, don't concatenate.** *"Marked too plain on 4 outfits containing this jacket"* is
   one line and stronger evidence than four lines.
3. **Cap per destination, not globally.** A garment with 20 reactions contributes a summary.

## 3. The plan

Ordered so that everything in phase 0 is a **removal or a narrowing** — no new mechanism, nothing
that needs a model of evidence first. Phases 1+ depend on decisions that phase 0 does not.

| # | change | status |
|---|---|---|
| ~~0.1~~ | Stop `renderer_calibration` scoring against garment selection | **shipped** |
| ~~0.2~~ | Make garment and outfit favourites organizational; remove their literal-piece ranking authority | **shipped** (§1c) |
| ~~0.3~~ | Scope `wrong_item_read` to the flagged piece, not every garment in the outfit | **shipped** |
| ~~0.4~~ | Give each reaction one primary behavioural reader | **shipped** |
| ~~0.5~~ | Remove the generic "Save as styling rule" | **shipped** (§1b) |
| ~~0.6~~ | Audit whether any `wrong_energy` record can be safely remapped to `too_subdued` | **closed — verified no-op; zero eligible rows** |
| ~~0.7~~ | Retire the dead `renderer_calibration` target while preserving working calibration paths and historical rows | **shipped** |
| ~~0.8~~ | Make the occasion-exclusion chip's ✕ restore the exclusion | **shipped** |
| ~~0.9~~ | Stop board/outfit critique landing on the garment card | **shipped** (`96c3246`) |
| ~~0.10~~ | Stop positive board feedback giving every contained pair a permanent `+18`; retain it as scoped outfit evidence | **shipped** (§1c) |
| ~~0.11~~ | Make structured occasion exclusions the sole behavioural authority; keep prose as display-only provenance | **shipped** (§1e) |
| ~~1~~ | Define the canonical **scoped** evidence model — garment × occasion, garment × garment, formula × context | **shipped — garment × occasion/activity and outfit-logic × context implemented; garment × garment resolved to existing “Tried and rejected”** |
| ~~2~~ | Verified piece-scoped chat corrections (`store_user_correction` takes a `piece_id`) | **shipped — exact ID is mechanically verified; garment rule is canonical; Conversation Memory receipt is display-only** |
| 3 | Consolidate and summarise prompt memory, including saved outfits (§1d) | open |
| 4 | Evaluate any scoring change against ranking **and diversity** tests (§1g) | open |
| 5 | Expose all active memory with source, scope, effect and undo | open |
| 6 | Taxonomy and lifecycle cleanup: every feedback control and mechanism is kept, replaced, migrated or removed; none ends with no reader | open |
| 7 | Replace ambiguous calibration-image favourites with purpose-specific labels (§1f) | open |
| 8 | Extract formula, silhouette, mood and context from positively received looks, then use them to discover different closet combinations | open — product direction; no exact-piece reinforcement |

**On ordering.** 0.2 is placed high because both weighted favourite flags have **zero rows today**,
so the decision is free now and gets more expensive with every heart. 0.1 and 0.3 are ahead of it
only because they are actively wrong on current data.

**Phase 1 before phase 2.** Defining the evidence model first is what stops piece-scoped corrections
from becoming another undifferentiated global signal — the exact failure this document exists to
correct.

**0.1** — the guard is keyed on `target_type === 'generated_visual_board'`
(`rules.js:532` and `rules.js:2656`), so `renderer_calibration` rows fall through in both. Same
one-line widening in two places, but the urgency differs: **confirmed today in Visual Composer**
(10 weighted rows scoring against garment selection), **latent in the pair scorer**, whose extra
`touchesCandidate` test no current row satisfies. Map §4 has the evidence for both.

**0.3** — `wrong_item_read`'s payload carries the whole outfit's `pieceIds`, so the −24 reaches
every garment in it (3.1 per click on live data) rather than the one flagged. Either narrow what the
scorers collect for this type, or stop writing the sibling IDs into its payload.

**0.6 — closed without a migration.** The cross-user audit found twelve `wrong_energy` rows, all
historical rows on the now-retired `renderer_calibration` target. None carries a
`feedback_details.wrong_energy` sub-reason, and their prose spans softer, sharper, contemporary and
structured directions; remapping any of them to `too_subdued` would invent meaning. The one live
saved board that explicitly says `too_subdued` is already stored correctly under
`feedback_details.style_direction`. Zero rows are safely eligible, so the correct backfill is no
backfill.

**0.4 — one enforced routing policy.** `feedbackBehaviour` in
`lib/feedbackTaxonomy.js` is now the shared authority used before reaction rows enter selection
scores or stylist prompt memory. The primary destinations are:

| reaction family | primary behavioural reader |
|---|---|
| explicit owner rules, including legacy `preference_reaction/message` | owner-memory prompt |
| outfit/board verdicts and relational critiques (`works`, `almost`, `not_me`, formula, style direction, shape and context) | scoped styling prompt |
| explicitly selected `wrong_item_read` garment | scoped styling prompt; no score until Phase 1 can preserve occasion/activity |
| image-fidelity corrections (`wrong_length`, garment detail, body/identity drift, bad reference) | renderer |
| historical `renderer_calibration` | retired; display/provenance only |
| unknown legacy types | display/provenance only until deliberately classified |

This removes the second authority that converted relational judgments such as “this outfit is too
soft” into permanent weights on every garment the outfit happened to contain. A rendering
correction may still create a visible retag task, and every reaction may retain an audit receipt;
those are follow-up/display effects, not another styling reader. Positive saved-board evidence
continues to reach the scoped styling prompt without literal-pair scoring. Prompt consolidation
within that one destination remains phase 3.

`wrong_item_read` was initially retained as a −24 garment score during Phase 0, then removed after
the owner clarified the control's meaning: “replace in this outfit” may mean the garment is wrong
for this occasion or activity (for example, high heels for a long museum walk), not that the garment
should be selected less often everywhere. The receipt remains scoped prompt evidence. Phase 1 must
model garment × occasion/activity before any contextual selection adjustment is reintroduced.

### Phase 1 pilot — garment × occasion/activity

New `wrong_item_read` writes carry `payload.scopedEvidence` version 1:

- kind: `garment_context_suitability`;
- the structured subject garment ID;
- weak strength;
- occasion, activity, season and mood captured at the reaction;
- the original outfit remains in the surrounding payload as provenance.

The behavioural reader matches only structured version-1 evidence. Every populated meaningful
dimension among occasion and activity must match the current request. One matching observation is
−6 and repeated matches cap at −12. This is a soft pre-model candidate/roster adjustment: one click
is a tie-breaker, repetition can approach an ordinary suitability penalty, and neither becomes a
hard exclusion. The debug reason states the matched context. New version-1 rows do not also enter
stylist prompt memory. Historical rows have no canonical context and remain prompt-only; none is
backfilled by inference. Season and mood are recorded for future evidence-model work but do not
participate in this first match rule.

`feedbackBehaviour` is the single classifier for this reader, including the requirement for a
valid positive `subjectPieceId`; malformed rows remain visible prompt evidence instead of being
routed into a scorer that cannot apply them. Candidate ranking loads active evidence once per
ranking operation and reuses it for every candidate rather than querying per garment.

### Phase 1 pilot — transferable outfit logic × context

New positive whole-outfit reactions (`signature`, `works`, `almost`) create version-1
`outfit_logic` evidence when the generated outfit already carries at least one structured logic
field. The evidence block contains no garment IDs or names. It records:

- formula or archetype;
- silhouette;
- dominant direction and mood;
- occasion, activity and season;
- the verdict, with `almost` retained as qualified rather than promoted to positive proof.

The styling-memory reader consolidates identical evidence into one counted observation. It tells
the model to reproduce the transferable logic with different suitable garments and explicitly not
to repeat the original combination merely because it received praise. Literal pieces remain in the
surrounding feedback payload only as provenance/display and are never copied into this memory line.
No model call is used to invent missing logic: outfits without structured formula, silhouette,
direction or mood keep their existing reaction record but do not gain an `outfit_logic` block.

The chat writer and saved-board/Visual Lab writer use the same evidence builder. Saved boards retain
the evidence on their canonical payload, and their mirrored `stylist_feedback` receipt is excluded
from the reader so the same reaction cannot acquire duplicate prompt authority. Changing a verdict
updates the evidence; removing it removes the board's transferable authority and archives the
mirrored receipt. Older image-only boards remain legacy reaction memory because their formula
cannot be reconstructed safely from a title, prose rationale or list of garment names.
Re-synchronizing an existing receipt merges into its payload, preserving renderer fields such as
`length_correction`, piece references and specific reason provenance.

### Phase 1 disposition — garment × garment

Do not add a new feedback mechanism. Exact construction-specific incompatibility between two
garments remains an explicit owner-authored **Tried and rejected** relationship on the garment
card. That existing mechanism covers the useful case without inferring pair failure from a broad
outfit reaction. Positive reactions never create exact-pair reinforcement; they teach transferable
outfit logic instead. A new chat control, writer or store is out of scope unless a demonstrated
workflow later shows the existing editor is insufficient.

**1** — define scope, strength, decay and conflict resolution before choosing a storage schema or
reviving a scorer. A reaction to one outfit starts as weak, contextual evidence; only an explicit
user statement can create a global garment judgment.

**2 — shipped.** Piece scope is explicit and verified against a current garment ID. The model may
pass `piece_id` only for a garment retrieved this turn, already established in the current outfit,
or selected as the active garment context. The tool verifies both conversational membership and
database existence; failure stores nothing and never falls back to a global owner rule.

The canonical rule is appended to `pieces.styling_rules_learned`, so it appears on the garment card
and reaches the garment-truth prompts that already treat this field as authoritative. A
`piece_rule_receipt` row makes the same correction visible and editable in Conversation Memory but
is deliberately display-only: it never becomes a second prompt reader. Editing or retiring that
receipt updates the canonical garment rule in the same database transaction. Global corrections
without `piece_id` retain the existing `owner_rule` path. Structured mappings such as an explicit
occasion exclusion remain a later taxonomy/lifecycle concern; this change does not infer a hard
gate from arbitrary prose.

**3** — consolidate stored evidence before it reaches a prompt: relevant scope first, repeated
observations summarized once, and literal outfit examples included only when they help the current
decision. Measure both prompt size and whether the compressed memory preserves the intended advice.
**Shipped 2026-08-09:** selected-piece feedback, boards, and confirmed outfits are now delivered
once: scoped records take precedence and are excluded from the following global blocks. The former
`buildGoldStandardFeedbackMemory` duplicate was removed because it repeated signature/works rows
and reintroduced literal garment combinations. Structured outfit logic remains consolidated by
formula, silhouette, direction, mood, and context. The small legacy free-text corpus is handled
without a migration or fuzzy inference: identical rendered prompt lines are delivered once, and
deduplication happens before the delivery cap so repeated historical rows cannot crowd out a
distinct observation. Differently worded notes remain separate evidence.

**Lifecycle cleanup 2026-08-09:** `signature` no longer silently writes `is_gold=1`. The hidden
flag had no separate user action and no remaining score, but still forced old rows ahead of newer
feedback in prompt selection and displayed an unexplained “Gold” badge. New reactions write zero,
prompt/API ordering is now recency-based, and historical values remain as inert provenance.

**4** — every scoring change requires a ranking A/B and a diversity check, including whether
recency suppression still rotates literal garments while preserving the learned formula.

**6 — shipped 2026-08-09.** The dormant generic score channel,
`buildWholeWardrobeFeedbackInfluence`, and its candidate/pair/board consumers were removed.
The label taxonomy now keeps three distinct styling meanings: “Too plain,” “Doesn’t feel like me,”
and “Looks generic or store-styled”; legacy `catalog_drift` is an alias of the last rather than a
fourth meaning. Legacy `wrong_proportions` and `proportion_problem` are aliases of renderer-only
`body_proportions_drift`, not outfit advice. Detached calibration receipts and one stale Board 131
receipt were removed; calibration boards retain the canonical body-proportion label. The unused
`pairs_well_with` UI, parser, prompt authority, matcher, and +16 score were removed with zero stored
values; **Tried and rejected** remains the explicit garment-pair mechanism. The two live
`— rejected by Yuna` rules were owner-verified as valid garment rules captured through stylist chat,
so they remain authoritative rather than being treated as unexplained historical debris.

## 4. Decisions needed before building

Decisions about the plan. Questions about *what exists* live in the map's `[owner check wanted]`
markers.

1. **Should board reactions influence capsule selection at all?** A reaction to one rendered outfit
   is evidence about that outfit; treating it as evidence about a garment's place in a 24-piece
   capsule is a larger inferential step. `getStylistFeedbackMemory` already separates scoped
   reactions ("taste signals, not global directives") from standing rules.
2. **Retag threshold** — one complaint, or two?
3. **Where does an explicit global rejection get stated?** The evidence model in phase 1 defaults
   everything to scoped. Something has to let the person say *"never, anywhere"* — and it should be
   an explicit act rather than an inference from repetition.
