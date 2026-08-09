# Feedback and memory map — where user input is stored, and who consumes it

Third map alongside [`app-surface-map.md`](app-surface-map.md) (what the user touches) and
[`engine-behaviour-map.md`](engine-behaviour-map.md) (how the engine behaves). This one covers the
plumbing between them: **everything the user tells the app about a garment or an outfit, where it
is written, and which consumer — if any — reads it back.**

Written 2026-08-08. It describes; it does not propose. Recommendations live in
[`feedback-routing-proposal.md`](feedback-routing-proposal.md) and must cite this map rather
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

**Completeness is checkable, not asserted.** Every SQLite table and every `localStorage` key
resolves to either §1 or the exclusion ledger in §8:

```bash
for t in $(sqlite3 -readonly wardrobe.db ".tables" | tr -s ' ' '\n' | grep -v '^$'); do
  grep -q "$t" docs/feedback-and-memory-map.md || echo "MISSING: $t"; done
grep -rhoE "localStorage\.(get|set|remove)Item\('[^']+'" --include=*.jsx --include=*.js src/ \
  | sed "s/.*('//;s/'//" | sort -u | while read k; do
  grep -q "$k" docs/feedback-and-memory-map.md || echo "MISSING: $k"; done
```

Silence means complete. Run it before trusting any claim about what this map does *not* contain.

**Markers follow the existing maps' convention:** **[by design]** behaviour a code comment or
ratified doc states is intentional · **[unverified]** read from code but not executed ·
**[owner check wanted]** a question about intent that the code cannot answer · **[bug]** behaviour
that contradicts stated intent · **[latent inconsistency]** two things that will disagree eventually.

---

## 0b. The four persistence media — the audit boundary

*Added after review round 4, 2026-08-09.* Rounds 1–3 of this document each missed stores because
the search kept starting from "things that look like feedback in SQLite". A complete audit has to
sweep **four media**, and the third and fourth are invisible to any `grep "FROM <table>"`:

| medium | what lives there | swept by |
|---|---|---|
| **1 · SQLite** | every table in §1 | `sqlite3 wardrobe.db ".tables"` then per-table writer/reader search |
| **2 · Uploaded files** | hanger, worn, outfit, board and calibration images | the DB columns that reference them, plus `uploads/` |
| **3 · Browser storage** | `localStorage` thread cache and migration sources | `grep -rhoE "localStorage\.(get\|set\|remove)Item\('[^']+'" src/` |
| **4 · Runtime / prompt caches** | prompts built from persisted user state and cached per user | `promptRuntime.js`, and anything calling `refreshPrompts` |

Medium 4 is the one with no row count and the widest blast radius: `buildForUser`
(`promptRuntime.js:55`) interpolates the style constitution and the user profile into the **system
prompts themselves**, caches the result per user, and rebuilds on any constitution or profile write.
Nothing about it appears in a table scan.

---

## 1. The stores, by category

**Twelve category entries**, not twelve stores — several aggregate more than one physical table
(`outfits` + `outfit_pieces`, `saved_boards` + `saved_board_pieces`, `chat_threads` +
`stylist_conversation_state`) and two split one table by meaning (`stylist_feedback`, categories 5
and 6). *"Nine stores" in an earlier draft was not a defensible count and has been withdrawn.*

Derived from the schema, not from memory: `sqlite3 wardrobe.db ".tables"`, then a column scan for
`note|rule|feedback|learn|reject|exclus|pair|label|favorite|status|state|payload|photo`, then the
three non-SQLite media in §0b.

**Every store carries four facts: what writes it, what user action does that, what reads it, and
what authority the result has.** Authority is one of — **hard gate** (a garment is removed from
consideration), **score** (deterministic weighting), **prompt** (text the model may or may not
follow), **thread-only** (affects the current conversation, nothing durable), or **display**.
Counts regenerate via script §1.

| # | category | store | authority of its strongest reader |
|---|---|---|---|
| 1 | Durable garment truth and preferences | `pieces` columns, `pieces.favorite`, `style_profile_json._confidence` / `manual_overrides` | **hard gate** + score |
| 2 | Saved outfit / formula memory | `outfits`, `outfit_pieces` | prompt |
| 3 | Board feedback and favourites | `saved_boards` (+ `payload.feedback_labels`, `favorite`) | **score** |
| 4 | Calibration / reference memory | `calibration_images` (`labels`, `notes`, `kind`, `favorite`) | prompt |
| 5 | Global owner rules | `stylist_feedback` where `owner_rule` / `preference_reaction`+`message` | prompt |
| 6 | Board and outfit reactions | all other `stylist_feedback` | **score** + prompt |
| 7 | Thread-scoped conversation state | `chat_threads.payload`, `stylist_conversation_state.state_json` | **thread-only** |
| 8 | Short-lived recency / diversity | `whole_wardrobe_sessions` | **score** (suppression) |
| 9 | Tasks created from feedback | `todos` (`retag-suggestion`, `metadata`) | display → owner action |
| **10** | **Style constitution and global user context** | `style_constitution`, `app_meta` (`home_location`, `profile_display_name`, `profile_pronouns`) | **system prompt** + structured context |
| **11** | **Visual evidence** | the uploads filesystem, referenced by `pieces.photo` / `worn_photo`, `outfits.photo`, board and calibration rows | **model evidence** + hard availability gate |
| **12** | **Intake and provenance** | `import_*`, `piece_import_evidence`, `constitution_history` | staging / provenance; accepted output flows into 1 and 4 |

Categories 7 and 8 are deliberately separated from 1–6: they are **not durable preference memory**.
Thread state governs one conversation and is replaced on the next turn; recency memory expires on a
6-day cutoff and exists to stop repetition, not to record taste. Mixing them with owner rules is how
a temporary context gets mistaken for a standing instruction.

### 1 · Durable garment truth and preferences

- **Writes** — `PUT /pieces/:id` (`crud.js:296`, the editor save, which cannot touch
  `occasion_exclusions`); `PATCH /pieces/:id/favorite` (`crud.js:338`);
  `POST /pieces/:id/occasion-exclusion` (`crud.js:378`); the tagger.
- **User action** — editing a garment, hearting it, "Wrong for X".
- **Reads** — everything. `occasion_exclusions` in `pieceOccasionCompatible` (`rules.js:2216`);
  `favorite` as **+4** in `compatibilityScoreForSelectedItem` (`rules.js:1008`), **+10** in
  `rules.js:1904`, and as a sort tie-break (`rules.js:1199`).
- **Authority** — **hard gate** for exclusions and the structured gates; **score** for `favorite`.
- **[latent inconsistency]** `pieces.favorite` currently has **zero** rows. Completeness here does
  not depend on adoption: the mechanism is live and weighted.

### 2 · Saved outfit / formula memory

- **Writes** — `POST /outfits` and `PUT /outfits/:id` (`crud.js:422/441`), which also rewrite
  `outfit_pieces` (`crud.js:444/457`); the favourite toggle; `PATCH /outfits/:id/append-note`
  (`crud.js:504`).
- **User action** — saving an outfit, confirming it, favouriting it, saving a stylist message
  against it.
- **Reads** — `getConfirmedOutfitMemory` (`core.js:216`) → `routes/ai.js:1034/1137`, `core.js:268`,
  `core.js:3762`; `getOutfitsForPieceMemory` (`rules.js:1259`) → `ai.js:1035/1138`, ordered
  `favorite DESC`.
- **Authority** — **prompt**. `core.js:268` is explicit that it is taste context, *"not a rigid
  checklist"*.
- **[by design]** `status='confirmed'` and `favorite=1` are what make an outfit authoritative, and
  `outfit_pieces` is what preserves the combination. A saved outfit is a positive taste record, not
  just a gallery entry.

### 3 · Board feedback and favourites

- **Writes** — `POST /saved-boards` (`crud.js:999`); `PATCH /saved-boards/:id`
  (`crud.js:1170`, sets favourite / archived / hidden / title / reason / watch_for / payload);
  `DELETE /saved-boards/:id` (`crud.js:1226`, a real delete); `setSavedBoardFeedbackLabel`
  (`crud.js:523`) for label and detail updates; `indexSavedBoardPieceLinks` (`crud.js:982`) for
  board→piece links; and the two mirrors into `stylist_feedback` in §3.
- **User action** — saving a board, reacting to it, marking it "Use strongly", archiving it.
- **Reads** — see §4. `getSavedBoardInfluenceForPair` (score), `getSavedBoardMemory` (prompt),
  `getSavedBoardRendererMemory` (render prompt), `getPieceUsageStats` (usage counts).
- **Authority** — **score**, and it is the largest single positive weight in the codebase: a
  favourited board contributes **+45** per matching pair.

### 4 · Calibration / reference memory

- **Writes** — `POST /calibration-images` (`crud.js:910`), `PATCH /calibration-images/:id`
  (`crud.js:953`, sets `kind`, `labels`, `notes`, `favorite`, `archived`),
  `DELETE` (`crud.js:971`), plus the importer (`importer.js:713`).
- **User action** — uploading a reference image and labelling or favouriting it in Visual Lab.
- **Reads** — `getCalibrationMemoryForStylist` (`core.js:313`) → `routes/ai.js:1144` and
  `core.js:2822`.
- **Authority** — **prompt**, and the reader treats it as high-authority positive *and negative*
  styling memory.
- **[bug]** *(in the first draft of this document)* §1 previously declared `calibration_images` out of
  scope as "the image calibration surface". That was wrong: its labels and notes are styling memory,
  not only renderer calibration, and under this map's own stated scope it belongs.

### 5 · Global owner rules

Covered in §2 · E and §3. **Authority — prompt.** Never garment-scoped; see §2b.

### 6 · Board and outfit reactions

Covered in §2 · F, §3 and §4. **Authority — score and prompt.**

### 7 · Thread-scoped conversation state

- **Writes** — `saveStylistConversationState` (`tools.js:2457`), called from `core.js:3929`;
  thread payload writes in `routes/crud.js` (1333–1444) and `core.js:4154`.
- **User action** — simply having a conversation. Not an explicit save.
- **Reads** — `getStylistConversationState` (`tools.js:2446`) → `tools.js:1860`, `core.js:3746`.
  Holds the established occasion, weather, activity, location, active outfit and current outfit set
  used on follow-up turns.
- **Authority** — **thread-only.** Nothing here is durable preference, and it must not be read as
  taste.
- **[latent inconsistency]** — *corrected after review round 4.* Both conversation-state functions
  exist twice, and unlike `storeUserCorrection` (where only the `tools.js` copy runs) **both copies
  of these are live, for different callers**: `core.js`'s definitions serve `core.js` by lexical
  shadowing, `tools.js`'s serve the tool loop. Document them function by function; treating the pair
  as one shared implementation is what produced the wrong attribution in the previous draft.

### 8 · Short-lived recency / diversity memory

- **Writes** — `INSERT INTO whole_wardrobe_sessions` (`rules.js:1499`), which then prunes to the
  last 10 (`rules.js:1504`).
- **User action** — generating whole-wardrobe outfits. Not an explicit save.
- **Reads** — `getRecentWholeWardrobeSessionInfluence` (`rules.js:1514`) → `routes/ai.js:1501`, on a
  6-day cutoff. Reset by `DELETE` at `routes/ai.js:1333`, which is user-facing.
- **Authority** — **score (suppression).** It exists to stop repetition, not to record preference.
- Empty at time of writing; the writers, readers and reset route are all live.

### 9 · Tasks created from feedback

`todos`. Covered in §3 → *Into `todos`*. **Authority — display, then owner action.**

### 10 · Style constitution and global user context

**The largest preference store in the app, and the only one that reaches the *system* prompt.**

- **Writes** — `PUT /api/settings/constitution[/:layer]` (`crud.js:1524/1549`), which also appends
  to `constitution_history` (`crud.js:1551`) and calls `refreshPrompts`; the profile and
  home-location routes (`crud.js:1459/1609/1620`); Onboarding, which authors layers 1–4.
- **User action** — completing onboarding, then editing *"How your stylist understands you"* in
  Style profile.
- **Reads** — `loadConstitution` (`promptRuntime.js:32`) → `buildForUser` (`:55`), which
  interpolates the layers **into the system prompts** and caches per user until the next write.
  `home_location` additionally feeds weather resolution (`routes/ai.js:2692`), and therefore garment
  eligibility.
- **Authority** — **system prompt.** Stronger and broader than an owner rule: an owner rule is one
  line in a user message, a constitution layer is part of the stylist's standing instructions.
- Seven active layers at time of writing — `aesthetic_gravity`, `body_contract`, `editorial_shoes`,
  `editorial_subject`, `lane_neutrality`, `proven_formulas`, `working_style`. Five constrain styling
  judgment; `editorial_subject` and `editorial_shoes` govern rendered subject and footwear. Sizes in
  script §1b.
- **[bug]** *(in drafts 1–3 of this document)* This category was absent entirely, while `getOwnerRuleNotes`'
  seven prose rows were documented in detail. The map measured what looked like feedback rather than
  what shapes styling.
- `profile_display_name` and `profile_pronouns` reach every personalised prompt but affect address
  and grammar rather than garment selection — recorded here as global user context, not preference.

### 11 · Visual evidence

The uploads filesystem is an **input store**, not presentation media.

- **Writes** — the piece editor's photo fields, `POST /calibration-images` (`crud.js:910`), outfit
  photo upload, board generation, and the importer (`importer.js:713/741`).
- **User action** — photographing a garment, adding a worn photo, uploading a reference.
- **Reads** — the tagger (fit/garment truth, gated on `fit_visible`); visual candidate ranking; the
  renderer's references; saved-outfit evaluation; identity and calibration memory.
- **Authority** — **model evidence**, plus a **hard availability gate**: a piece with neither a
  hanger nor a worn photo is deterministically excluded from the Visual Composer roster at
  `rules.js:2681`, reason `'no photo'`.
- **[latent inconsistency]** The photo's *existence* is a hard gate, but its *contents* are the
  authority for fit fields — and whether a photo counts as fit-visible is a per-photo model judgment
  (`style_profile_json.photo_properties`). See `engine-behaviour-map.md` for that half.

### 12 · Intake and provenance

Not durable preference memory, but the **upstream writer** into categories 1 and 4, and it carries
human decisions.

- **`import_*`** — staging for bulk import. Review actions override model-generated name and
  category values before acceptance, then write into `pieces`, `pieces.worn_photo` and
  `calibration_images` (`importer.js:713/741/781`). **Those are user corrections that become garment
  truth**, so §3 lists import review as a writer even though the staging tables are not a memory
  store.
- **`piece_import_evidence`** — **[bug]** written by `importer.js:712` and read by **nothing** in
  production; the only other reference is a test asserting insertion
  (`test/importer_phase3.test.js:141/148`). Copies promoted into `pieces.worn_photo` are consumed;
  the evidence rows are not. Documented as unconsumed provenance rather than silently omitted.
- **`constitution_history`** — appended on every constitution write (`crud.js:1551`) and exposed
  read-only at `crud.js:1568`. It preserves prior user-authored text, feeds no styling prompt, and
  offers no restore action. **Provenance ledger, not active authority.**
  **[owner check wanted]** should editing a layer offer a restore from history?

## 2. The six feedback channels (categories 5–6 in detail)

> These six predate the category model in §1 and describe the *content* of feedback rather than its
> storage. They map onto §1 as: A→category 1, B/C/D→category 1, E→category 5, F→category 6. Kept
> because §2b and §4 reference them by letter.


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

## 2b. User action → storage → effect

The single table a reader needs. Everything in it is derived from §3 and §4; this is the synthesis,
not a separate source.

| user action | canonical storage | garment-scoped? | effect |
|---|---|---|---|
| "Wrong for hiking" (card menu) | `pieces.occasion_exclusions` | **yes, structurally** | hard exclusion in the shared gate |
| Verbal correction — *"never use these shorts at home"* | `stylist_feedback` `owner_rule` / `message` | **no** — the garment and its ID appear only in prose | global prompt guidance |
| "Replace in this outfit" | `stylist_feedback` `wrong_item_read` / `whole_wardrobe_outfit` | via payload IDs — but see the bug below | soft scoring, −24 |
| "Save as styling rule" | `pieces.styling_rules_learned` | yes | the **entire assistant message** becomes authoritative prompt text |
| Reaction chips on a board/outfit | `stylist_feedback`, various | by payload | soft scoring and/or prompt text |
| Favouriting a board | `saved_boards.favorite` | every garment in the board | soft scoring, positive |
| Historical `— rejected by <name> (<date>)` rules | `pieces.styling_rules_learned` | yes | authoritative prompt text; **[unverified]** writer unknown |

Five conclusions that follow, and that are easy to miss when reading the sections separately:

1. **Automatic correction capture already exists** — `store_user_correction` (§3). The gap is not
   that the app fails to notice corrections.
2. **It cannot produce a structurally garment-scoped rule.** Its tool schema accepts
   `context_type` of `'outfit'` or `'general'` with an optional outfit ID (`tools.js:593`), and
   `general` is the default — so the row may be outfit-scoped, but **never piece-scoped**, even when
   the note names a garment and its ID in prose.
3. **Conversation Memory and the garment card's Rules learned are two stores, not two views of
   one record.** Nothing reconciles them.
4. **An occasion exclusion is stored twice** — once structurally, once as prose. See §4b.
5. **[bug]** *"Replace in this outfit"* does not scope to the piece you flagged. Its payload carries
   `pieceIds` for the whole outfit, so `collectPieceIdsFromFeedbackPayload` returns all of them and
   the −24 lands on **every garment in that outfit** — 3.1 per click on live data. The card menu
   says *"Flags this piece as wrong for this look and steers your stylist away from choosing it as
   often"*, singular. Reproduce with script §3 plus the traversal in `rules.js:461`.

---

## 3. Writers

> Run this **for every table in §1**, not only the ones that look like feedback:
> ```bash
> for t in pieces outfits outfit_pieces saved_boards calibration_images \
>          stylist_feedback chat_threads stylist_conversation_state \
>          whole_wardrobe_sessions todos; do
>   echo "== $t"; grep -rn "INSERT INTO $t\|UPDATE $t\|DELETE FROM $t" \
>     --include=*.js routes/ styling-engine/ lib/
> done
> ```
> Search per table rather than by route name — two routes here are named for a column they do not
> write. **[bug]** *(in earlier drafts, 2026-08-08)* this inventory ran over `stylist_feedback` and
> then `saved_boards`, and so listed neither the canonical board writers nor any writer for
> categories 1, 2, 4, 7 or 8. Listing a store without its writers is the same scope failure as
> omitting the store.

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
identical rows. Both dedupe on exact note text. **The `tools.js` copy is the live one** — the tool
switch calls it lexically at `tools.js:1865`, the only call site anywhere. `routes/ai.js:160`
imports the `core.js` copy and never calls it, so that copy appears dead.

**[by design]** Both write `feedback_type='owner_rule'`, `target_type='message'`. Note the
consequence: a correction that names a garment in its prose is still stored with
`context_type='general'` and no `context_id`, so the rule is not attached to that garment.

### Into per-garment memory

| site | function | writes |
|---|---|---|
| `crud.js:296` | `PUT /pieces/:id` | the whole editor save, including all of channel B |
| `crud.js:378` | `POST /pieces/:id/occasion-exclusion` | `occasion_exclusions` **and** an `Excluded from …` note into `styling_rules_learned` |
| `crud.js:494` | `PATCH /pieces/:id/append-note` | **writes `styling_rules_learned`, not `notes`** |

**[latent inconsistency]** — *downgraded from `[bug]` after review, 2026-08-08.*
`PATCH /pieces/:id/append-note` writes to `styling_rules_learned` while its sibling
`PATCH /outfits/:id/append-note` (`crud.js:504`) writes to `outfits.notes`. For the **piece** case
this is not a destination defect: the button says *"Save as styling rule"*, and
`styling_rules_learned` is what that means. The route and the frontend function are simply named
for a column they do not write.

One wrinkle the naming does create: `StylistChat.jsx:6164` renders **one label for both contexts** —
*"Save as styling rule for &lt;name&gt;"* — so with an **outfit** selected the button promises a
styling rule and writes `outfits.notes`. There the label and the destination genuinely disagree.

The substantive concern is not the destination but the payload: it saves the **entire assistant
message** verbatim into a field the editor labels "AUTHORITATIVE — STYLIST FOLLOWS THESE FIRST".
That is a product question, and it lives in
[`feedback-routing-proposal.md`](feedback-routing-proposal.md).

**Removed 2026-08-08:** a fourth writer, the `appendToPiece` branch on `POST /stylist-feedback`,
copied board/outfit reaction prose into `styling_rules_learned` as `[feedback:<type>] (label) note`.
Owner ruling: board critique does not belong on the garment card. Script §5 still counts the rows it
left behind.

### Into `saved_boards` — the canonical board writers

Distinct from the two functions above, which only *mirror* board feedback into `stylist_feedback`.

| site | function | writes |
|---|---|---|
| `crud.js:999` | `POST /saved-boards` | creates the board |
| `crud.js:1170` | `PATCH /saved-boards/:id` | `favorite` ("Use strongly"), `archived`, `hidden_from_lookbook`, `title`, `reason`, `watch_for`, `payload` |
| `crud.js:1226` | `DELETE /saved-boards/:id` | a **real delete**, unlike `stylist_feedback`'s archive-on-delete |
| `crud.js:523` | `setSavedBoardFeedbackLabel` | feedback labels and details on the payload |
| `crud.js:982` | `indexSavedBoardPieceLinks` | board→piece link indexing (`links_indexed`) |

### Into `outfits` / `outfit_pieces`

| site | function | writes |
|---|---|---|
| `crud.js:422` | `POST /outfits` | the outfit and its `outfit_pieces` links |
| `crud.js:441/444/457` | `PUT /outfits/:id` | the outfit, then rewrites its links |
| `crud.js:465/487/490` | favourite / status / delete routes | `favorite`, `status='confirmed'` |
| `crud.js:504` | `PATCH /outfits/:id/append-note` | `outfits.notes` |

### Into `calibration_images`

| site | function | writes |
|---|---|---|
| `crud.js:910` | `POST /calibration-images` | upload |
| `crud.js:953` | `PATCH /calibration-images/:id` | `kind`, `labels`, `notes`, `favorite`, `archived` |
| `crud.js:971` | `DELETE /calibration-images/:id` | delete |
| `importer.js:713` | importer | bulk create |

### Into thread and session state

| site | function | writes |
|---|---|---|
| `core.js:4163` | `saveStylistConversationState` | `stylist_conversation_state.state_json` — **this is the copy that runs.** `core.js:3929` calls it lexically; `core.js` does not import the `tools.js` copy, so the local definition shadows it |
| `tools.js:2457` | `saveStylistConversationState` | an identical second copy with **no call site** — dead |
| `crud.js:1333–1444`, `core.js:4154` | thread routes | `chat_threads.payload` |
| `rules.js:1499` | whole-wardrobe generation | `whole_wardrobe_sessions`, pruned to the last 10 (`rules.js:1504`) |
| `routes/ai.js:1333` | `DELETE` reset route | clears `whole_wardrobe_sessions` — user-facing |

### Into the style constitution and global context

| site | function | writes |
|---|---|---|
| `crud.js:1524/1549` | `PUT /settings/constitution[/:layer]` | a layer body, appends `constitution_history` (`:1551`), calls `refreshPrompts` |
| `crud.js:1459/1609/1620` | profile + home-location routes | `app_meta` keys; `home_location` changes weather resolution |
| Onboarding | `Onboarding.jsx` | authors constitution layers 1–4 |

### Into garment truth from import review (upstream)

Import staging is not a memory store, but review decisions become garment truth.

| site | writes |
|---|---|
| `importer.js:713` | `calibration_images`, `piece_import_evidence` |
| `importer.js:741` | `pieces.worn_photo` |
| `importer.js:781` | `pieces` — accepted garments, with human-overridden name/category |

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

> Search: **both** feedback stores, then the call sites of each reader found:
> ```bash
> grep -rn "FROM stylist_feedback\|FROM saved_boards" --include=*.js routes/ styling-engine/ \
>   | grep -viE "INSERT|UPDATE|DELETE"
> grep -rn "<function>(" --include=*.js routes/ styling-engine/ scratch/
> ```
> **[bug]** *(in the first draft of this document, 2026-08-08)* The original search covered
> `stylist_feedback` only, so it structurally could not find the `saved_boards` readers below, and
> the map then claimed two deterministic consumers when there are three. Searching one store and
> concluding about the surface is the failure mode this document exists to prevent.

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
| **`getSavedBoardInfluenceForPair`** (`rules.js:660`) | `compatibilityScoreForSelectedItem` (`rules.js:1158`) — same chain as the pair scorer above | **deterministic score** |
| `getSavedBoardMemory` (`rules.js:694`) | `/evaluate-piece` (`ai.js:1141/1142`), whole-wardrobe generator (`core.js:2823`) | prompt text |
| `getConfirmedOutfitMemory` (`core.js:216`) | freeform chat, `/evaluate-piece`, critique (`ai.js:1034/1137`, `core.js:268/3762`) | prompt text |
| `getOutfitsForPieceMemory` (`rules.js:1259`) | `/evaluate-piece` (`ai.js:1035/1138`) | prompt text |
| `getCalibrationMemoryForStylist` (`core.js:313`) | `/evaluate-piece` (`ai.js:1144`), whole-wardrobe (`core.js:2822`) | prompt text |
| `getStylistConversationState` (`tools.js:2446`) | the tool loop (`tools.js:1860`), `core.js:3746` | **thread-only** |
| `getRecentWholeWardrobeSessionInfluence` (`rules.js:1514`) | whole-wardrobe generation (`ai.js:1501`) | **deterministic suppression** |
| `buildWholeWardrobeFeedbackInfluence` (`rules.js:1425`) | **no production caller** — only `scratch/run_agent_styling.js:34` | dead |

**There are three deterministic consumers, and they are two different scoring systems** —
*corrected after review, 2026-08-08.*

- **Two read `stylist_feedback`** and convert it via `feedbackWeight()` (`rules.js:~490`):
  `getFeedbackInfluenceForPair` and `buildVisualComposerRoster` (which adds ±18 for `is_gold`).
  **Only these two carry the defective `target_type` guard** described below.
- **One reads `saved_boards`** — `getSavedBoardInfluenceForPair` — and shares none of that
  machinery. It uses **fixed scores** (`+6` for *almost*, `+18` for a board with positive feedback,
  `+45` for a favourited board), caps at 70, filters image-fidelity labels **directly** rather than
  by `target_type`, and skips any board carrying `not_me` or an uncorrected styling complaint. It is
  therefore not affected by the `renderer_calibration` leak at all.

**`saved_boards` is the second feedback store, and it is easy to miss.**
`getSavedBoardInfluenceForPair` selects boards that are **either** scoped to the piece **or**
`favorite = 1`, so favouriting a board is itself a deterministic positive signal on every garment in
it — a channel with no reaction chip and no entry in the Style-profile panel. `getSavedBoardMemory`
sends the same favourites and labels into prompts. Script §8 counts both.

`getPieceUsageStats` (`rules.js:636`) also reads `saved_boards`, for usage counts rather than
feedback; noted so the enumeration is complete.

All three scorers guard image-fidelity feedback with
`row.target_type === 'generated_visual_board' && IMAGE_FIDELITY_FEEDBACK_TYPES.has(...)`, so
`renderer_calibration` rows fall through it. They all carry `context_type='piece'`, so they pass the
context filter too. **The consequence differs by scorer, and the distinction matters** *(refined
after review, 2026-08-08)*:

- **[bug]** `buildVisualComposerRoster` — **confirmed, with live data.** It applies the weight directly
  on `context_type='piece' && context_id`, with no further test. Script §7 lists 23
  `renderer_calibration` rows; 10 carry a nonzero weight (`wrong_proportions` −24 ×3,
  `wrong_silhouette` −8 ×6, `too_safe` −22 ×1) and are scoring against garment selection today.
- **[latent inconsistency]** `getFeedbackInfluenceForPair` — **same defective guard, no current
  impact.** It additionally requires `touchesCandidate`: the candidate's ID in the payload, or the
  candidate's name inside `note + label + context_name`. Verified on live data: **no
  `renderer_calibration` payload contains any piece ID (0 of 23)**, and the only garment name their
  prose contains is the *selected* piece itself (id 145, "Cream wool shell") — which
  `rankedComplementaryWardrobeFor` excludes from its own candidate list. So the condition cannot be
  met by current rows.

  It is one datum away from firing: a calibration note that mentions any *other* garment, or a
  garment renamed to a substring of that prose, would satisfy it. The name test is a substring
  match, not a token match.

Both guards should be widened — the fix is identical — but only the Visual Composer effect is
demonstrated on production data.

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
| single-piece outfit ranking | A, C + **F and saved-board favourites/labels, as scores** |
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

**[latent inconsistency]** — *reclassified after review, 2026-08-08; this is a data-history
limitation, not a defect in the normalizer.* `normalizeConfidenceMap` (`taggerMerge.js:39`)
deliberately and testably maps a missing or malformed confidence to `low`. The consequence is that
`low` cannot distinguish a genuine tagger judgment from absent legacy provenance — but the cause is
that provenance was not recorded before v2, not that the fallback is wrong. Any migration is a
separate decision (see the engine map's amendment for the two options and their traps).

The signature is in script §9, and it is **"zero medium", not "zero medium or high"** — pre-v2
pieces carry no `medium` on any structural field, while `length_hits_at` does carry a small number
of pre-v2 `high` values. Those exceptions are unexplained; **[unverified]** whether they came from an
older tagger that emitted confidence, or from an import. The claim the evidence supports is narrower
than a categorical one: *the pre-v2 population does not show a rating distribution*, not *it shows
no ratings at all*. Full analysis in `engine-behaviour-map.md` → *"Amendment, 2026-08-08"*.

---

## 4b. Occasion exclusions are stored twice

Marking "Wrong for X" writes **both** `pieces.occasion_exclusions` (structured, and what the gate
actually enforces) **and** a prose line into `styling_rules_learned` — `Excluded from X by <name>
(<date>)` — from the same handler, `crud.js:378`.

The prose chip is not the enforcement record. The editor's `PUT /pieces/:id` column list
(`crud.js:296`) **does not include `occasion_exclusions` at all**, so no editor save can change an
exclusion under any circumstances. Only `POST /pieces/:id/occasion-exclusion` can.

**[bug] — fixed 2026-08-09.** Removing the chip used to be guaranteed cosmetic: the note vanished on
save, the garment stayed blocked, and the only remaining sign of the rule was in a different screen.
`RuleList` now cross-references the garment's live `occasion_exclusions`; a chip whose occasion is
still excluded is marked `rule` and its ✕ calls the restore endpoint instead of editing text. A chip
naming an occasion that is no longer excluded stays an ordinary removable note, so an old
`Excluded from …` line left behind after a restore does not offer to restore it twice.

The restore takes effect immediately rather than on Save — Save cannot perform it, so deferring
would leave the button doing nothing again — and the form then syncs to the server's own list, which
keeps the `Excluded …` / `Restored …` pair as the audit trail.

---

---

## 8. Exclusion ledger — examined and deliberately left out

A store absent from §1 should be absent *on the record*. Without this list there is no way to tell
an audited exclusion from an undiscovered store — which is how four categories went missing through
three review rounds.

| store / key | medium | why excluded |
|---|---|---|
| `app_meta` API keys (BYOK) | SQLite | operational credentials, not user preference |
| `app_meta.seeded`, `constitution_migrated` | SQLite | migration and workflow markers |
| import spending and count telemetry | SQLite | operational accounting |
| `stylist_rail_collapsed`, `stylist_rail_view_mode` | browser | presentation only |
| `stylist_current_thread_id` | browser | navigation only |
| `importSessionId` | browser | in-flight workflow handle |
| `constitution_history` | SQLite | provenance only — **would move into §1 if a restore action were added** |
| `piece_import_evidence` | SQLite | written, never read in production (§12) |
| generated thumbnails, board images, derived caches | files | derived artifacts, not user input |
| `generation_runs` (1,990 rows), `freeform_generation_runs` (83) | SQLite | engine telemetry — flow, cap, token and gate counters. No user-authored content, and **no production reader**: written for offline diagnosis only |
| `import_clusters`, `import_images`, `import_sessions`, `import_garments` | SQLite | intake staging, covered as category 12; listed individually here so a table-by-table sweep resolves every name |

**Browser storage, in full.** The keys are
`stylist_chat_threads`, `stylist_chat_messages`, `stylist_chat_history`, `stylist_thread_memory`,
`stylist_current_thread_id`, `stylist_rail_collapsed`, `stylist_rail_view_mode`, `importSessionId`.
Of these, `stylist_chat_threads` is a **non-canonical client cache** reconciled against the server,
and `stylist_chat_messages` / `stylist_chat_history` / `stylist_thread_memory` are **legacy
migration sources** whose contents can move into `chat_threads`. They are recorded here rather than
in §1 because none of them is authoritative — but a reader auditing "where could a user's stated
preference be hiding" needs to know they exist.

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
