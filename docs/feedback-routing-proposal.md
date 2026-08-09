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
- **`renderer_calibration` rows** — reach **no renderer at all** (map §4), and because the scorers'
  exclusion is keyed on `target_type === 'generated_visual_board'`, these rows fall *through* it and
  score against garment selection. Exactly inverted: the channel named for calibration does not
  calibrate, and does steer styling.

So this destination needs the 0.1 fix before it can be described as separated, and the 0.7 ruling
before `renderer_calibration` has a defined purpose at all.

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

| flag | current effect | rows today |
|---|---|---|
| `saved_boards.favorite` ("Use strongly") | **+45** per garment pair in that board, capped at 70 | 0 |
| `pieces.favorite` | **+4**, **+10**, and a sort tie-break | 0 |
| `outfits.favorite` / `status='confirmed'` | prompt memory, ordered `favorite DESC` | 3 / 24 |

**The question to settle: is "favourite" an organisational label, or an instruction to select this
more often?** Recommendation — **organisational only**. If more-frequent selection is wanted, it
should be a separate, explicitly labelled control, because a heart that silently triples a garment's
ranking weight is not a thing the person agreed to.

**Both weighted flags currently have zero rows**, which makes this the cheapest moment to decide:
changing them today alters no current output, and there is no migration.

**The live sameness risk is the other branch of the same scorer.** `getSavedBoardInfluenceForPair`
also awards **+18** to every pair in any board carrying positive feedback, favourite or not — and
**36 of 243 boards currently pass that filter, boosting 70 distinct garment pairs.** If the concern
is that the system keeps proposing the same combinations, that is where it is happening now, not in
the dormant +45.

## 1d. Saved outfits are prompt memory too

24 confirmed and 3 favourited outfits reach the prompt through `getConfirmedOutfitMemory` and
`getOutfitsForPieceMemory`. The discipline in §2 was written for feedback rows and applies here
equally: summarise them into **formula evidence** — the relationship that worked — and include
literal examples only when relevant to the garment in play. A list of past outfits invites literal
reuse, which is the same failure as an evergreen preference.

## 1e. Positive feedback must not defeat diversity

Prompt size and selection diversity are separate concerns; compact feedback can still dominate if
its weight is high enough. There is already a mechanism pulling the other way — the 6-day recency
suppression in `whole_wardrobe_sessions` (map category 8) — and nothing reconciles the two.

> **Principle.** Positive feedback may raise confidence in a *transferable formula*. It must not
> defeat recency suppression, and it must not create an evergreen preference for the same garments.

Any scoring change in the plan below has to be evaluated against this, not only against whether the
weights look reasonable in isolation.

## 2. Prompt-size discipline

Where feedback does reach a prompt, three rules. This is what makes it affordable to give the
capsule its share at all. Today's readers **are** capped — 8, 10, 12, 16, 20, 24 rows depending on
the call site, and several truncate each note. The defect is not unbounded growth; it is that within
those caps they **concatenate raw rows and never consolidate**, so repeated evidence about one
garment spends N slots saying the same thing once each, and the budget lands
in the prompt tail where this codebase has already measured stored rules losing (spec 25/26).

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
| 0.1 | Stop `renderer_calibration` scoring against garment selection | open — **confirmed live** in Visual Composer, latent in the pair scorer |
| 0.2 | Decide what "favourite" means; remove the weighted boosts, or label them | open — needs owner ruling (§1c) |
| 0.3 | Scope `wrong_item_read` to the flagged piece, not every garment in the outfit | open — **live**, 3.1 garments per click |
| 0.4 | Give each reaction one primary behavioural reader | open |
| 0.5 | Remove the generic "Save as styling rule" | open (§1b) |
| 0.6 | Remap `wrong_energy` → `too_subdued` | open — one-time backfill |
| 0.7 | Decide `renderer_calibration`'s fate | needs owner ruling |
| ~~0.8~~ | Make the occasion-exclusion chip's ✕ restore the exclusion | **shipped** |
| ~~0.9~~ | Stop board/outfit critique landing on the garment card | **shipped** (`96c3246`) |
| 1 | Define the canonical **scoped** evidence model — garment × occasion, garment × garment, formula × context | open |
| 2 | Verified piece-scoped chat corrections (`store_user_correction` takes a `piece_id`) | open — highest value |
| 3 | Consolidate and summarise prompt memory, including saved outfits (§1d) | open |
| 4 | Evaluate any scoring change against ranking **and diversity** tests (§1e) | open |
| 5 | Expose all active memory with source, scope, effect and undo | open |
| 6 | Taxonomy cleanup | open |

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

**0.6** — `wrong_item_read`'s payload carries the whole outfit's `pieceIds`, so the −24 reaches
every garment in it (3.1 per click on live data) rather than the one flagged. Either narrow what the
scorers collect for this type, or stop writing the sibling IDs into its payload.

**0.2** — `too_subdued` is already one of `wrong_energy`'s own seven sub-reasons
(`wrongEnergyReasonLabels`, `rules.js:729`), so the target is not invented. Do it as a **one-time
backfill of existing rows**, not as a rule in code: the seven sub-reasons mean different things and
guessing between them is only safe for rows whose author has said what they meant.

**1** — measure how many to-dos the existing rows would generate before shipping. If it is hundreds,
add a threshold (two independent complaints on the same field) — and `wrong_item_read` should never
be one-strike.

**2** — deterministic, so it needs a ranking A/B and the #44 memory-pollution caution about stored
text gaining mechanical authority.

**3** — prompt half first (cheap, reversible, measurable on one run), scoring half second.

**4** — collapse the duplicate labels (four ways to say "boring", three to say "proportions are
off"), decide `pairs_well_with`, and make the Style-profile panel show which stored rules are
actually delivered.

## 4. Decisions needed before building

Decisions about the plan. Questions about *what exists* live in the map's `[owner check wanted]`
markers.

1. **What does "favourite" mean?** Organisational label, or an instruction to select more often?
   (§1c.) Free to decide today — both weighted flags have zero rows.
2. **Should board reactions influence capsule selection at all?** A reaction to one rendered outfit
   is evidence about that outfit; treating it as evidence about a garment's place in a 24-piece
   capsule is a larger inferential step. `getStylistFeedbackMemory` already separates scoped
   reactions ("taste signals, not global directives") from standing rules.
3. **Retag threshold** — one complaint, or two?
4. **`renderer_calibration`** — retire the target type, or wire it into render calibration?
5. **Where does an explicit global rejection get stated?** The evidence model in phase 1 defaults
   everything to scoped. Something has to let the person say *"never, anywhere"* — and it should be
   an explicit act rather than an inference from repetition.
