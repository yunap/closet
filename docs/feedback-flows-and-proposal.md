# User feedback — the whole picture, and what to do about it

Written 2026-08-08. Companion to
[garment-memory-and-feedback-audit.md](garment-memory-and-feedback-audit.md), which mapped where
garment memory goes. This one covers **all** feedback, garment and outfit, and proposes what should
change. Measured against the live wardrobe read-only. Nothing here is implemented.

## The short version

You have **9 places** that collect feedback and **7 things** that read it. They were built at
different times and were never reconciled, so today:

- about **a third of what you record is read by nothing at all**;
- some of it is read by the *wrong* thing;
- several labels mean the same thing, and one means nothing to anybody;
- the parts that are read get sent as raw lists that grow forever, which is why nobody wants to
  add more of them to a prompt.

The proposal is not "send more feedback to the model." It is **route each kind of feedback to the
destination that can actually act on it**, of which the prompt is only one of four.

---

## Part 1 — Where feedback comes from

| # | surface | what it writes |
|---|---|---|
| 1 | Board/picture modal — overall verdict | `signature` / `works` / `almost` / `not_me` |
| 2 | Board/picture modal — "what feels wrong" | 15 style-direction reasons |
| 3 | Board/picture modal — "fit and shape" | 7 shape reasons |
| 4 | Board/picture modal — rendering problems | 4 image-fidelity reasons + 6 length sub-reasons |
| 5 | Outfit card chips | "More like this" → `works`, "Not for me" → `not_me` |
| 6 | Card piece menu → "Replace in this outfit" | `wrong_item_read` |
| 7 | Card piece menu → "Wrong for X" | `occasion_exclusions` on the garment (hard rule) |
| 8 | Whole-wardrobe outfit feedback | `good_pieces`, `good_formula`, `bad_occasion`, `fit_issue` |
| 9 | Chat corrections + garment edit modal | `owner_rule` / `preference_reaction`; garment memory fields |

## Part 2 — What reads it

| reader | feeds | kind |
|---|---|---|
| `getStylistFeedbackMemory` | freeform stylist chat, `/evaluate-piece` | prompt text |
| `getWholeWardrobeFeedbackMemory` | whole-wardrobe generator | prompt text |
| `buildGoldStandardFeedbackMemory` | `/evaluate-piece` | prompt text |
| `getSavedBoardRendererMemory` | the image renderer | prompt text |
| `getFeedbackInfluenceForPair` | single-piece outfit candidate ranking | **deterministic score** |
| `getOwnerRuleNotes` | capsule roster + capsule composition | prompt text |
| `syncRetagSuggestionsFromSavedBoard` | **retag to-dos** | **a task for you** |

That last row is the important one, and it is the model for the whole proposal — see Part 5.

## Part 3 — What is broken, dead, or duplicated

### Dead — recorded, read by nothing

| thing | volume | why |
|---|--:|---|
| `renderer_calibration` rows | 23 | No reader queries this target type. Only source references are a dedupe key and a cleanup guard. |
| `wrong_energy` | 19 | No weight, no reader, no reason payload. **Owner, 2026-08-08: it meant "boring / meh," and it was supposed to be remapped when we moved away from it. The remap never happened.** |
| `buildWholeWardrobeFeedbackInfluence` | — | A full per-piece/combination/formula influence builder. Imported into `routes/ai.js` and **never called**; only a scratch script uses it. |
| `pairs_well_with` | 0 pieces | Input, reader and matcher exist; no data. |
| `close_but_off` | 3, all archived | VisualLab legacy. |
| reason-less group rows | 4 | `shape_balance` rows with no `feedback_reason` — the group label alone carries no information. |

**11 of the 30 stored feedback types have no weight at all**, so they are inert in every
deterministic scorer: `preference_reaction`, `wrong_energy`, `wrong_length`, `style_direction`,
`shape_balance`, `wrong_garment_details`, `owner_rule`, `close_but_off`, `body_proportions_drift`,
`strong_direction`, `identity_drift`. Some of those *should* be inert (they are prompt-only or
render-only by design). Others are simply unfinished.

### Read by the wrong thing

`renderer_calibration` rows are excluded from the render memory but **included** in outfit scoring,
because the image-fidelity guard checks `target_type === 'generated_visual_board'` only. Ten rows
(`wrong_proportions` ×3 at −24, `wrong_silhouette` ×6 at −8, `too_safe` ×1 at −22) push garments
down in outfit ranking on the strength of a complaint about a *picture*. This is the precise
inverse of the contract the UI states.

### Duplicates and near-duplicates

- **"Boring"** is expressible four ways: `too_safe`, `too_subdued`, `too_generic`, `wrong_energy`.
- **"Proportions are off"** three ways: `wrong_proportions`, `proportion_problem`,
  `unbalanced_proportions` — the first two even share the same −24 weight.
- **The 4 verdicts appear on two surfaces** (board modal, card chips) writing the same types with
  different target types, so they aggregate inconsistently.

## Part 4 — Why nobody wants to add feedback to a prompt

The readers that build prompt text concatenate raw rows: `getStylistFeedbackMemory` takes 24 global
rows plus 16 scoped, `getWholeWardrobeFeedbackMemory` takes 20 and emits up to 22 lines. Every line
is a full sentence naming an outfit, its pieces and a note. This grows forever, is mostly
irrelevant to the garment at hand, and lands in the prompt tail where this codebase has already
measured stored rules losing (spec 25/26).

That is the real reason the capsule was never given feedback: not principle, but cost. **The fix is
not a bigger budget — it is to stop sending raw history.**

## Part 5 — The proposal: four destinations, not one

Every piece of feedback answers one of four different questions. Today almost all of it is routed
as if it answered the last one.

### Destination A — "the garment data is wrong" → a retag task

This already exists and works: a "top hem rendered too long" becomes a `retag-suggestion` to-do
linked to the garment and the exact field (`length_hits_at`), which you complete from the garment
editor and which then stops firing. **It is the only feedback destination that improves the system
permanently rather than steering one prompt.**

It currently covers **only** the 6 wrong-length reasons. It should also cover:

| feedback | field it implicates |
|---|---|
| `wrong_garment_details` | `reads_as`, `pattern_*`, `neckline`, `sleeve_type` |
| `wrong_item_read` ("Replace in this outfit") | `occasions`, `formality`, `reads_as` |
| `bad_occasion` | `occasions` |
| `fit_issue` | `fit_on_body`, `fit_confidence` |
| repeated `not_me` on one garment | the garment's tags generally — a review prompt, not a field |

The tagger-accuracy case for this is already proven: the taupe suede ankle boots have
`fabric_category: "other"` despite "suede" being in their name, which is why no material rule could
ever have caught them. Feedback is the cheapest available signal for finding mistagged garments,
and today it is thrown away instead.

### Destination B — "the picture is wrong" → render calibration

Already exists and is correctly separated. Two repairs: stop `renderer_calibration` leaking into
outfit scoring, and either wire that channel into the render memory or retire it (see Part 6).

### Destination C — "this garment or pairing is wrong for me" → a score

Already exists as `getFeedbackInfluenceForPair`, per-user and weighted, and it is the mechanism
that lets a preference bind *without* a prompt and *without* a global rule. It is used by exactly
one path. It should also serve capsule roster selection.

`buildWholeWardrobeFeedbackInfluence` — the dead one — already computes per-piece, per-combination,
per-formula and per-occasion influence. It should be revived rather than rewritten.

### Destination D — "this is a standing instruction" → the prompt

Only what genuinely cannot be expressed as a score or a tag: standing prose rules. This is what
`getOwnerRuleNotes` already does, and it is small (6 rows) by design.

### The routing rule

> Feedback goes to the prompt **only** when it cannot be a tag correction or a score. Prompt text
> is the destination of last resort, not the default.

### Prompt-size discipline

Where feedback does reach a prompt, three rules:

1. **Scope to the pieces in play.** Send only feedback touching a garment actually on the bench or
   in the outfit. `getSavedBoardRendererMemory` already does this correctly — copy its overlap
   check.
2. **Consolidate, do not concatenate.** "Marked *too plain* on 4 outfits containing this jacket" is
   one line and more useful than four. Counts carry the strength a raw list only implies.
3. **Cap by destination, not globally.** A garment with 20 reactions should contribute a summary,
   not 20 lines.

Applied to the capsule, this is roughly 5–10 lines for a 24-piece roster, not the 40+ that raw
concatenation would produce.

## Part 6 — The plan

Ordered so each step is independently shippable and the cheap correctness fixes land first.

### Phase 0 — stop the bleeding *(small, no design decisions)*

1. Close the `renderer_calibration` scoring leak — widen the image-fidelity guard to skip the
   target type, not just board-scoped fidelity types.
2. Remap `wrong_energy` → `too_subdued` ("Feels too quiet or dull"), which is the existing label
   that matches what you meant. 19 rows become meaningful and gain a weight; the orphan label is
   retired from the display list.
3. Delete or revive `buildWholeWardrobeFeedbackInfluence`. Phase 2 revives it, so leave it until
   then and just record that it is dead.
4. Decide `renderer_calibration`'s fate — retire (archive the 23 rows) or wire it in. Needs a
   ruling; everything else in Phase 0 does not.

### Phase 1 — route the "your data is wrong" signals to retag tasks

Extend `syncRetagSuggestionsFromSavedBoard` beyond wrong-length to the table in Destination A.
Same shape as today: a to-do naming the garment, the suspected field, and the feedback that raised
it; completing it in the editor clears it. No prompt cost at all, and it attacks tagger accuracy,
which is upstream of several open problems.

**Check first:** measure how many to-dos the existing 290 rows would generate before shipping.
If it is hundreds, add a threshold (e.g. two independent complaints on the same field).

### Phase 2 — one consolidated influence layer

Revive `buildWholeWardrobeFeedbackInfluence` as the single scorer behind both existing consumers,
and give it a summary renderer that emits consolidated lines instead of raw rows. Deterministic, so
it needs a ranking A/B and the #44 caution about stored text getting mechanical authority.

### Phase 3 — give the capsule its share

Roster selection consults the influence layer (score), and both capsule prompts receive the
consolidated, piece-scoped summary (text). Prompt first, scoring second — the prompt half is cheap
and reversible, the scoring half changes deterministic output.

### Phase 4 — taxonomy cleanup

Collapse the duplicate labels, decide `pairs_well_with`, and make the Style Profile panel show
which stored rules are actually delivered. Cosmetic relative to the above, but it is what stops
this drifting again.

## Part 7 — Open questions for the owner

1. **`renderer_calibration`** — retire, or wire in? (Phase 0 item 4.)
2. **Should board reactions steer capsule selection at all?** "Looks too bulky" on one rendered
   outfit is evidence about that outfit; treating it as evidence about a garment's place in a
   24-piece capsule is a bigger step. `getStylistFeedbackMemory` already labels scoped reactions
   "taste signals, not global directives." Phase 3 should respect that line, and where it sits is
   your call.
3. **Retag-task threshold** — should one complaint raise a retag suggestion, or two?
