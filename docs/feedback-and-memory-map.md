# Feedback and memory map — where user input is stored, and who consumes it

Third map alongside [`app-surface-map.md`](app-surface-map.md) (what the user touches) and
[`engine-behaviour-map.md`](engine-behaviour-map.md) (how the engine behaves). This one covers the
plumbing between them: **everything the user tells the app about a garment or an outfit, where it
is written, and which consumer — if any — reads it back.**

Written 2026-08-08. It describes; it does not propose. Recommendations live in
[`feedback-flows-and-proposal.md`](feedback-flows-and-proposal.md) and must cite this map rather
than restate it.

## 0. How to verify this document

**Every number here regenerates.** Run:

```bash
node scratch/measure_feedback_surface.js
```

Read-only, runs no migrations, safe against a live database. Its section numbers match this
document's. If a figure here disagrees with the script, **trust the script** — counts move as the
owner edits garments, and several moved during the session this was written in.

The script is committed (`scratch/*` is gitignored with an allowlist; it has an entry). Worth
knowing when checking the other maps: **`engine-behaviour-map.md` cites `scratch/measure_provenance.js`
and `scratch/measure_plural_gap.js`, and neither is tracked** — those numbers cannot currently be
reproduced from a clean checkout.

**Every enumeration here states the search that produced it**, so it can be re-run when the code
moves. A claim of the form "nothing reads X" is only as good as its search, and the search is
printed so you can widen it.

**Markers follow the existing maps' convention:** **[by design]** behaviour a code comment or
ratified doc states is intentional · **[unverified]** read from code but not executed ·
**[owner check wanted]** a question about intent that the code cannot answer · **[bug]** behaviour
that contradicts stated intent · **[latent inconsistency]** two things that will disagree eventually.

---

## 1. The stores

Derived from the schema, not from memory — `sqlite3 wardrobe.db ".tables"` then a column scan for
`note|rule|feedback|learn|reject|exclus|pair|label`:

| store | what it holds |
|---|---|
| `stylist_feedback` | every reaction, verdict and standing rule. The canonical feedback record. |
| `pieces.notes` | free-text styling note on one garment |
| `pieces.styling_rules_learned` | the editor's **"Rules learned — AUTHORITATIVE"** list |
| `pieces.pairs_well_with`, `pieces.tried_and_rejected` | two more per-garment lists |
| `pieces.occasion_exclusions` | the **only** per-garment channel that is structured, not prose |
| `pieces.engine_notes` | engine-facing note, separate from `notes` |
| `pieces.style_profile_json._confidence` / `manual_overrides` | per-field provenance ("protected edits") |
| `saved_boards.payload.feedback_labels` | reactions attached to a saved board |
| `outfits.notes` | free-text note on a saved outfit |
| `todos` (`type='retag-suggestion'`) | the one destination that converts feedback into a task |

`calibration_images.labels/notes` also exists and is out of scope here — it belongs to the image
calibration surface, not garment or outfit feedback.

## 2. The six channels

### A · Tagged garment truth
Structured columns on `pieces` (`season`, `occasions`, `fabric_category`, `needs_base`, …). Written
by the tagger and by the piece editor. **Covered in depth by `engine-behaviour-map.md`** — listed
here only because manual tag edits are user input, and because `_confidence`/`manual_overrides`
record who set each field.

### B · Per-garment user memory
`notes`, `styling_rules_learned`, `pairs_well_with`, `tried_and_rejected`. Prose. See §2 of the
measurement script for how many garments carry each — `notes` is by a wide margin the most used and
`pairs_well_with` is empty.

### C · Occasion exclusions
`pieces.occasion_exclusions`. **[by design]** The Style-profile panel states it plainly: *"This is a
hard rule — the piece will never be offered for that occasion again until you restore it here."*
Enforced in `pieceOccasionCompatible` (`rules.js:2216`), inside the shared gate, so it binds both
model-chosen and engine-chosen selections. Its only axis is occasion — it cannot express season,
weather or material.

### D · Model-authored garment intelligence
`style_profile_json.garment_intelligence` — `do_not_pair_rules`, `pairing_requirements`,
`failure_risks`, `formula_compatibility`, `real_wear_notes`. Written by the tagger, not the user.
Included because it travels with the garment through the same readers as channel B.

### E · Standing prose rules
`stylist_feedback` rows selected by `feedback_type='owner_rule' OR (feedback_type='preference_reaction'
AND target_type='message')` — see `getOwnerRuleNotes` (`rules.js:1373`) and the shared predicate
`isOwnerRuleRow` (`rules.js:1291`).

**[latent inconsistency]** The Style-profile panel labels rows "OWNER RULE" and "PREFERENCE
REACTION", but the discriminator for delivery is **`target_type`**, which the UI never shows. A
`preference_reaction` on a *message* is delivered; the same type on a *piece* is not. Script §4
prints both counts.

### F · Outfit and board feedback
Everything else in `stylist_feedback` — the largest group by volume. Taxonomy in
[`lib/feedbackTaxonomy.js`](../lib/feedbackTaxonomy.js): 4 overall verdicts, 15 style-direction
reasons, 7 fit-and-shape reasons, 4 image-fidelity reasons plus 6 wrong-length sub-reasons.
**[by design]** image fidelity is kept separate from styling: the modal says *"Report rendering
problems separately—they do not mean the outfit idea is wrong."*

---

## 3. Writers

> Search: `grep -rn "INSERT INTO <table>\|UPDATE <table>\|DELETE FROM <table>" --include=*.js routes/ styling-engine/ lib/`
> Run it per table rather than searching for route names — two routes here are named for a column
> they do not write.

### Into `stylist_feedback`

| site | function | writes |
|---|---|---|
| `crud.js:775` | `POST /stylist-feedback` | every reaction chip in the chat |
| `crud.js:883` | `PATCH /stylist-feedback/:id` | edit note/label, set gold, archive |
| `crud.js:894` | `DELETE /stylist-feedback/:id` | archives (**does not delete**) |
| `crud.js:629/643` | `syncStructuredReasonsFromSavedBoard` | mirrors board reasons into rows |
| `crud.js:673/688` | `syncFeedbackFromSavedBoard` | mirrors saved-board labels into rows |
| `tools.js:2438` | `storeUserCorrection` | the model's `store_user_correction` tool |
| `core.js:4194` | `storeUserCorrection` | **a second copy of the same function** |

**[latent inconsistency]** `storeUserCorrection` exists twice, in `tools.js` and `core.js`, writing
identical rows. Both dedupe on exact note text. **[unverified]** which one production calls — I did
not trace the import at each call site.

**[by design]** Both write `feedback_type='owner_rule'`, `target_type='message'`. Note the
consequence: a correction that names a garment in its prose is still stored with
`context_type='general'` and no `context_id`, so the rule is not attached to that garment.

### Into per-garment memory

| site | function | writes |
|---|---|---|
| `crud.js:296` | `PUT /pieces/:id` | the whole editor save, including all of channel B |
| `crud.js:378` | `POST /pieces/:id/occasion-exclusion` | `occasion_exclusions` **and** an `Excluded from …` note into `styling_rules_learned` |
| `crud.js:494` | `PATCH /pieces/:id/append-note` | **writes `styling_rules_learned`, not `notes`** |

**[bug]** `PATCH /pieces/:id/append-note` writes to `styling_rules_learned` while its sibling
`PATCH /outfits/:id/append-note` (`crud.js:504`) writes to `outfits.notes`. Same route name, two
different destinations, and on the piece side it lands in the field the UI calls "AUTHORITATIVE".
Its UI trigger is `saveMessageToNotes` (`StylistChat.jsx:1726`), the *"Save as styling rule for
&lt;piece&gt;"* button, which saves the **entire assistant message** verbatim.

**Removed 2026-08-08:** a fourth writer, the `appendToPiece` branch on `POST /stylist-feedback`,
copied board/outfit reaction prose into `styling_rules_learned` as `[feedback:<type>] (label) note`.
Owner ruling: board critique does not belong on the garment card. Script §5 still counts the rows it
left behind.

### Into `todos` (retag suggestions)

| site | function | writes |
|---|---|---|
| `crud.js:720` | `syncRetagSuggestionsFromSavedBoard` | wrong-length board feedback → a retag task naming the garment **and the field** |
| `crud.js:1258` | `POST /todos` | manual |
| `rules.js:2468` | `ensureMetadataTodo` | a missing gate-relevant field → a metadata todo |

**[by design]** The retag task never changes tags: its own text is *"Review the garment metadata; no
tags were changed automatically."* It clears when the field is saved, via
`resolved_retag_suggestion_ids` (`crud.js:312`). This is the only feedback destination that converts
a complaint into corrected data rather than into prompt text.

---

## 4. Readers

> Search: `grep -rn "FROM stylist_feedback" --include=*.js routes/ styling-engine/` then
> `grep -rn "<function>(" --include=*.js routes/ styling-engine/ scratch/` for each call site.

| reader | consumed by | kind |
|---|---|---|
| `getStylistFeedbackMemory` (`rules.js:1296`) | freeform stylist chat (`core.js:4019/4026/4031`), `/evaluate-piece` (`ai.js:1139/1143`) | prompt text |
| `getWholeWardrobeFeedbackMemory` (`rules.js:1388`) | whole-wardrobe generator (`ai.js:1510`, `core.js:2821`) | prompt text |
| `buildGoldStandardFeedbackMemory` (`rules.js:564`) | `/evaluate-piece` (`ai.js:1140`) | prompt text |
| `getSavedBoardRendererMemory` (`rules.js:803`) | the image renderer, via `withSavedBoardRendererMemory` (`core.js:57`) — 5 render call sites | prompt text |
| `getOwnerRuleNotes` (`rules.js:1373`) | capsule roster selection **and** capsule composition (`tools.js:1966`) | prompt text |
| `getLastOutfitEvaluation` (`tools.js:2398`) | the model's tool loop (`tools.js:1857`) | prompt text |
| **`getFeedbackInfluenceForPair`** (`rules.js:516`) | `compatibilityScoreForSelectedItem` → `rankedComplementaryWardrobeFor` → `selectCandidatesForOutfitGeneration` / `complementaryWardrobeFor` | **deterministic score** |
| **`buildVisualComposerRoster`** (`rules.js:2378`, feedback block at `:2649`) | Visual Composer roster (`ai.js:617`, `ai.js:1516`) | **deterministic score** |
| `buildWholeWardrobeFeedbackInfluence` (`rules.js:1425`) | **no production caller** — only `scratch/run_agent_styling.js:34` | dead |

**There are two deterministic consumers, not one.** Both convert feedback into signed weights via
`feedbackWeight()` (`rules.js:~490`); `buildVisualComposerRoster` adds ±18 for `is_gold`.

**[bug]** Both scorers guard image-fidelity feedback with
`row.target_type === 'generated_visual_board' && IMAGE_FIDELITY_FEEDBACK_TYPES.has(...)`. Rows with
`target_type='renderer_calibration'` therefore fall through and score against garment selection —
see script §7 for how many, and note they all carry `context_type='piece'`, so they pass the
context filter too.

**`renderer_calibration` has no reader at all.** `getSavedBoardRendererMemory` queries
`target_type='generated_visual_board'` only. The only other source references are a dedupe key
(`StylistChat.jsx:3876`) and a cleanup guard (`crud.js:582`).
**[owner check wanted]** retire the target type, or wire it into render calibration?

---

## 5. What each surface actually receives

| surface | channels it sees |
|---|---|
| freeform stylist chat | A, B, C, D, E, **F** |
| whole-wardrobe generator | A, B, C, D, E, **F** |
| `/evaluate-piece` | A, B, C, D, E, **F** |
| image renderer | image-fidelity subset of F |
| single-piece outfit ranking | A, C + **F as a score** |
| Visual Composer roster | A, C + **F as a score** |
| **capsule roster selection** | A, B, C, D, **E only** |
| **capsule composition** | A, B, C, D, **E only** |

The capsule path reads `getOwnerRuleNotes` and no other feedback reader. Verify with:

```bash
grep -nE "(getStylistFeedbackMemory|getWholeWardrobeFeedbackMemory|getFeedbackInfluenceForPair|buildGoldStandardFeedbackMemory|getSavedBoardRendererMemory)\(" \
  styling-engine/tools.js styling-engine/outfitSetPlanner.js
```

The trailing `(` matters: without it the search also matches a prose mention of
`getStylistFeedbackMemory` in a comment at `outfitSetPlanner.js:3428`, which is not a call.

**Two piece-text builders**, and which one runs decides how much of B and D a prompt sees:

- `buildPieceText` → `buildWardrobePieceTruthText` (`src/utils/wardrobeAiContext.js:199`) — carries
  all of B and D. Used by capsule roster selection (`ai.js:2997`) **and** the atomic capsule
  composer (`ai.js:3153`), which deliberately overrides the compact catalog. Its comment records
  why: the compact line's omission *"allowed a relaxed hoodie under a relaxed cardigan even though
  both records explicitly prohibit another loose top."*
- `planWorkbenchPieceLine` (`outfitSetPlanner.js:2420`) — compact. Carries
  `styling_rules_learned` and `tried_and_rejected` but **not** `notes`, `pairs_well_with`, or any of
  D. It survives as `workbench.piece_catalog`, read by the `submit_plan_outfits` tool loop
  (`tools.js:2026`) and by ordinary non-capsule plans.

---

## 6. Provenance of per-field edits

`_confidence.<field>` and `manual_overrides` both record owner edits and agree exactly;
`getFieldConfidence` falls back between them. **[by design]** the piece editor marks a field
`manual` on *any* interaction, and `pinManualConfidence` (`crud.js:228/282`) persists it on save.

**[bug]** `normalizeConfidenceMap` (`taggerMerge.js:39`) turns any unrecognised value into `low`, so
a field edited before the provenance mechanism existed is indistinguishable from one the tagger
declined to judge. Script §8 shows the signature: pre-v2 pieces carry **zero** medium or high on
every structural field. Full analysis in `engine-behaviour-map.md` → *"Amendment, 2026-08-08"*.

---

## 7. Open questions the code cannot answer

- **[owner check wanted]** `renderer_calibration` — retire or wire in? (§4)
- **[owner check wanted]** Should board reactions influence capsule *selection* at all?
  `getStylistFeedbackMemory` already separates scoped reactions ("taste signals, not global
  directives") from standing rules; §5 shows the capsule sees neither.
- **[owner check wanted]** `pairs_well_with` has an input, a reader and a matcher (`rules.js:453`)
  and zero rows. Populate, merge into `styling_rules_learned`, or remove?
- **[unverified]** Which `storeUserCorrection` copy production uses (§3).
- **[unverified]** What wrote the three short owner-shaped rules in script §5. No current code
  produces their `— rejected by <name> (<date>)` format, and `git log -S` finds no removed writer.
