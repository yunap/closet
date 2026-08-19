# Feedback and memory map — where user input is stored, and who consumes it

Third map alongside [`app-surface-map.md`](app-surface-map.md) (what the user touches) and
[`engine-behaviour-map.md`](engine-behaviour-map.md) (how the engine behaves). This one covers the
plumbing between them: **everything the user tells the app about a garment or an outfit, where it
is written, and which consumer — if any — reads it back.**

**Ratified 2026-08-09** as the baseline description of the current system, after five review
rounds; **amended 2026-08-12** for the owner-guidance work (footwear constraint selectors, shared
season resolution, the `reported` synthesis status and its delete route, exclusion `changedAt`, and
guidance becoming read-only). Amendments are marked inline with their date. It describes; it does not propose. Recommendations live in
[`feedback-routing-proposal.md`](feedback-routing-proposal.md) and must cite this map rather than
restate it. Ideas for hardening the verification tooling are out of scope here and live in
[`feedback-audit-backlog.md`](feedback-audit-backlog.md).

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

**Code is cited by file and function name, never by line number.** This is a living document and
line numbers rot silently — every reader citation in §4 had drifted by roughly a hundred lines
before 2026-08-12 while still looking authoritative. Function names survive refactors and are
greppable; if a name is not enough to find something, name the file and the function it sits in.

**Owner-guidance envelope population** — the counts in §2 · E regenerate with:

```bash
sqlite3 -readonly wardrobe.db "
SELECT COALESCE(archived,0) AS archived,
  COALESCE(json_extract(payload,'\$.ownerGuidanceApplicability.reach'),'NO ENVELOPE') AS reach,
  COUNT(*) FROM stylist_feedback
WHERE feedback_type='owner_rule' OR (feedback_type='preference_reaction' AND target_type='message')
GROUP BY 1,2 ORDER BY 1,3 DESC;"
```

**A maintenance check, not a proof.** Run:

```bash
node scratch/audit_feedback_surface_completeness.js
```

It compares the running system against
[`scratch/feedback_surface_inventory.json`](../scratch/feedback_surface_inventory.json), which gives
every store an explicit **disposition** — `category` (documented in §1 with writer, action, reader
and authority) or `excluded` (out of scope, reason in §8), never both. It exits non-zero when the
system holds a store the inventory does not classify, or the inventory names one that no longer
exists.

**What it is good for:** catching drift when a table, `localStorage` key or `uploads/`
subdirectory is added and nobody updates this document. It also compares the registered
`stylist_feedback` types and scoped-evidence kinds with their semantic dispositions and the live
values in both feedback-bearing tables. It found two unclassified upload directories on its first
run.

**What it does not establish:** that this map's prose about any store is correct, or that the
categories are the right ones. Medium 4 (runtime/prompt caches) has no enumerable inventory at all —
the script prints its build sites and says the check there is manual. Treat a PASS as "nothing
obvious has drifted", not as completeness.

**Markers follow the existing maps' convention:** **[by design]** behaviour a code comment or
ratified doc states is intentional · **[unverified]** read from code but not executed ·
**[owner check wanted]** a question about intent that the code cannot answer · **[bug]** behaviour
that contradicts stated intent · **[latent inconsistency]** two things that will disagree eventually.

---

## 0b. The four persistence media — the audit boundary

User input persists in **four media**. The third and fourth are invisible to any
`grep "FROM <table>"`, which is why a SQLite-only sweep will always understate this surface:

| medium | what lives there | swept by |
|---|---|---|
| **1 · SQLite** | every table in §1 | `sqlite3 wardrobe.db ".tables"` then per-table writer/reader search |
| **2 · Uploaded files** | hanger, worn, outfit, board and calibration images | the DB columns that reference them, plus `uploads/` |
| **3 · Browser storage** | `localStorage` thread cache and migration sources | `grep -rhoE "localStorage\.(get\|set\|remove)Item\('[^']+'" src/` |
| **4 · Runtime / prompt caches** | prompts built from persisted user state and cached per user | `promptRuntime.js`, and anything calling `refreshPrompts` |

Medium 4 is the one with no row count and the widest blast radius: `buildForUser`
(`promptRuntime.js`) interpolates the style constitution and the user profile into the **system
prompts themselves**, caches the result per user, and rebuilds on any constitution or profile write.
Nothing about it appears in a table scan.

---

## 1. The stores, by category

**Twelve category entries**, not twelve stores — several aggregate more than one physical table
(`outfits` + `outfit_pieces`, `saved_boards` + `saved_board_pieces`, `chat_threads` +
`stylist_conversation_state`) and two split one table by meaning (`stylist_feedback`, categories 5
and 6).

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
| 1 | Durable garment truth and preferences | `pieces` columns, `pieces.favorite`, `style_profile_json._confidence` / `manual_overrides` | **hard gate**; favourite is organizational |
| 2 | Saved outfit / formula memory | `outfits`, `outfit_pieces` | prompt |
| 3 | Board feedback and favourites | `saved_boards` (+ `payload.feedback_labels`, `favorite`) | prompt + display; no literal-pair score |
| 4 | Calibration / reference memory | `calibration_images` (`labels`, `notes`, `kind`, `favorite`) | prompt |
| 5 | Direct owner guidance | `stylist_feedback` where `owner_rule` / `preference_reaction`+`message` | relevance-selected prompt; legacy no-envelope rows retain broad delivery pending review |
| 6 | Board and outfit reactions | all other `stylist_feedback`; `feedback_synthesis_batches`; `feedback_synthesis_drafts`; `product_quality_findings` | routed prompt, provisional context, renderer, product-review queue, retired, or display-only; only accepted personal/contextual synthesis drafts enter styling prompts |
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

- **Writes** — `PUT /pieces/:id` (`crud.js`, the editor save, which cannot touch
  `occasion_exclusions`); `PATCH /pieces/:id/favorite` (`crud.js`);
  `POST /pieces/:id/occasion-exclusion` (`crud.js`); the tagger.
- **User action** — editing a garment, hearting it, "Wrong for X".
- **Reads** — everything reads garment truth. `occasion_exclusions` is enforced by
  `pieceOccasionCompatible`; `favorite` remains available to inventory filters and display.
- **Authority** — **hard gate** for exclusions and structured gates. `favorite` has no styling or
  ranking authority as of 2026-08-09.

### 2 · Saved outfit / formula memory

- **Writes** — `POST /outfits` and `PUT /outfits/:id` (`crud.js/441`), which also rewrite
  `outfit_pieces` (`crud.js/457`); and the favourite toggle.
- **User action** — saving an outfit, confirming it, or favouriting it.
- **Reads** — `getOutfitsForPieceMemory` → selected-piece evaluation/generation, ordered by recency
  rather than favourite status. Direct saved-outfit evaluation reads the exact outfit and its
  linked pieces. The former global `getConfirmedOutfitMemory` reader was removed on 2026-08-10.
- **Authority** — **relevant-context prompt only**. A saved combination is available while its
  outfit or one of its garments is under discussion; unrelated confirmed combinations are not
  broadcast as general taste memory.
- **[by design]** `outfit_pieces` preserves the combination for direct retrieval. Confirmation and
  `favorite=1` remain organizational/status metadata and add no selection bonus to their garments.

### 3 · Board feedback and favourites

- **Writes** — `POST /saved-boards` (`crud.js`); `PATCH /saved-boards/:id`
  (`crud.js`, sets favourite / archived / hidden / title / reason / watch_for / payload);
  `DELETE /saved-boards/:id` (`crud.js`, a real delete); `setSavedBoardFeedbackLabel`
  (`crud.js`) for label and detail updates; `indexSavedBoardPieceLinks` (`crud.js`) for
  board→piece links; and the two mirrors into `stylist_feedback` in §3.
- **User action** — saving a board, reacting to it, marking it "Use strongly", archiving it.
- **Reads** — see §4. `getSavedBoardMemory` (prompt), `getSavedBoardRendererMemory` (render prompt),
  `getPieceUsageStats` (usage counts).
- **Authority** — **prompt and display.** Image-fidelity reports contribute only a textual reminder
  when the identified garment is rendered again; the rejected generated image is never reused as
  a reference and these reports never influence styling selection. Positive, *Almost*, and *Use strongly* reactions remain
  stored evidence, but no longer promote the literal garment pairs in the board. The former
  `+6` / `+18` / `+45` pair scorer was neutralized on 2026-08-09 to prevent repetition loops.

### 4 · Calibration / reference memory

- **Writes** — `POST /calibration-images` (`crud.js`), `PATCH /calibration-images/:id`
  (`crud.js`, sets `kind`, `labels`, `notes`, `favorite`, `archived`),
  `DELETE` (`crud.js`), plus the importer (`importer.js`).
- **User action** — uploading a reference image and labelling or favouriting it in Visual Lab.
- **Reads** — `getCalibrationMemoryForStylist` (`core.js`) → styling prompt memory; and
  `getCalibrationReferenceImagesForGeneration` → generated-outfit image calls. The image reader
  rotates references from a larger eligible pool, taking starred rows before unstarred rows.
  `real_photo` rows are sent as identity/proportion references; `good_reference` rows are sent as
  taste/aesthetic references. Exact garment hanger/worn photos remain separate garment anchors.
- **Authority** — **prompt and renderer evidence.** Within the renderer, `favorite` means priority
  reference within the row's existing `kind`; it does not replace garment truth or affect garment
  selection. The prompt reader also treats labels and notes as high-authority positive *and
  negative* styling memory.
- Its labels and notes are **styling** memory, not only renderer calibration — which is why it is a
  category here rather than an exclusion.

### 5 · Direct owner guidance

Covered in §2 · E and §3. **Authority — relevance-selected prompt.** New rows carry
`payload.ownerGuidanceApplicability`, a validated versioned envelope with universal, garment,
context, garment+context, or unresolved reach. The server deterministically recovers narrow
supported terms when the model omits them; unresolved new rows are retained for review but are not
sent. `ownerGuidanceApplies` is the executable matcher used by direct guidance and, through a shape
adapter, accepted personal/contextual lessons. Filtering happens before prompt caps. Style Profile presents this guidance read-only as of 2026-08-12, so `PATCH /stylist-feedback/:id`
does not re-derive the envelope from a changed note; a stored envelope only ever changes when the
owner says something new in chat, through `store_user_correction`. Rows created
before the envelope remain broadly delivered for compatibility and are labelled as legacy scope in
Style Profile; that is an explicit migration boundary, not a claim that they are universal.
Populated garment dimensions are conjunctive: `materials:[canvas]` plus `footwear:[sneakers]`
matches only canvas sneakers. Context dimensions are likewise conjunctive while values inside one
dimension are alternatives. Explicit `situations` match request/slot language such as office or
client rather than widening to the whole resolved smart-casual profile. Plan composition reselects
garment guidance against the bounded compose pool; the complete wardrobe manifest is not treated as
an active garment set.

### 6 · Board and outfit reactions

Covered in §2 · F, §3 and §4. **Authority — one primary behavioural reader per reaction**, enforced
by `feedbackBehaviour` in `lib/feedbackTaxonomy.js`.

Authorized synthesis adds two stores without changing that rule. `feedback_synthesis_batches`
records the exact compact input, hash, selected provider/model, estimate, actual usage and outcome
of an explicitly authorized call. `feedback_synthesis_drafts` holds the model's review proposals.
Drafts have no authority. A draft whose disposition is `insufficient_evidence` is the model
reporting that it could **not** learn anything from the selected reactions; it is written with the
terminal status `reported` and never enters the owner's decision queue. (Before 2026-08-12 it was
written as `draft`, so the only way to clear a non-result was **Reject**, which then recorded it as
a suggestion the owner had declined — the source of the five `insufficient_evidence`/`rejected` rows
in the development wardrobe.) `DELETE /feedback-synthesis/drafts/:id` removes such a row outright
and refuses every other disposition, so it cannot erase an accepted lesson or a recorded decision;
the paid batch and the source reactions are separate records and survive. After owner acceptance, only disposition
`personal_contextual_lesson` is read by `getAcceptedFeedbackSynthesisMemory`. Structured
applicability is matched against the active garment and request occasion/activity/season/weather
before the newest-eight cap; missing applicability matches nothing. The editable boundary remains
display/explanation rather than executable text. Active garment sets include selected-piece
candidates, whole-wardrobe visual rosters, capsule roster benches and bounded plan composition
pools, but never the complete wardrobe manifest merely because it lists the garment;
piece-and-context applicability requires both an active garment match and a context match;
accepted `garment_fact_correction` rows remain review/provenance. Accepted
`general_styling_failure` rows additionally create a product-quality work item, but neither class
enters styling prompts or silently edits garment truth.

The product-quality work item is one `product_quality_findings` row linked to the synthesis draft
and its source feedback IDs. Findings have `open`, `resolved`, and `dismissed` states and require an
explicit resolution destination (`shared_rule`, `model_instruction`, `garment_metadata`,
`renderer`, or `no_change`) before resolution. They never enter a styling prompt. This is the
backend/provenance portion of item 11. A confirmed report can also enter the same lifecycle directly
from an existing feedback row without a model call: the system records a zero-call batch, an accepted
general-failure draft and the linked finding. Its evidence snapshot preserves the source thread,
board image, garment IDs/photos and structured attributes even if the original reaction is later
removed. The dedicated review UI remains deferred to the UI/UX panel.

`owner_constraints` is the structured hard-authority destination for an owner-confirmed standing
constraint that cannot be represented by one garment's `occasion_exclusions`. Its selectors are
limited to verified piece IDs, wardrobe category, structured material or footwear type; its context is one of
occasion, activity, season or weather. The writer requires explicit confirmation and archives a
linked prose owner rule so the same instruction is not also prompt authority. The whole-wardrobe
trust gate reads active rows before roster assembly, slot replacement, complementary ranking and
each capsule-plan slot; missing context is a no-op. A matched row hard-blocks the garment and emits
its constraint ID/dimension in suppression reasons. Retiring the row is the undo. Season matching
normalizes through `resolveSeasonTerm` (`lib/ownerConstraints.js`), so the request selector values
`warm`, `autumn` and the unresolved default `current season` are resolved to a real season before
comparison — `current season` against `requestContext.currentDate` rather than always "now". The
same helper resolves the season recorded on synthesis evidence, so a reaction stored with the
literal placeholder no longer surfaces `current season` as if it were a season. Item 12's review
surface is deferred, but its bounded storage, routing and undo contract is executable.

### 7 · Thread-scoped conversation state

- **Writes** — shared `saveStylistConversationState` (`conversationState.js`),
  called from `core.js`;
  thread payload writes in `routes/crud.js` (1333–1444) and `core.js`.
- **User action** — simply having a conversation. Not an explicit save.
- **Reads** — shared `getStylistConversationState` (`conversationState.js`) serves both the tool
  loop and the freeform conversation pipeline.
  Holds the established occasion, weather, activity, location, active outfit and current outfit set
  used on follow-up turns.
- **[amended 2026-08-19]** Resolved weather is also stored as a normalized `weather_profile`
  (`source`, numeric high/low, and hot/cold/extreme booleans), separately from display-season prose.
  A new explicit weather statement supersedes it; otherwise follow-up gates restore these physical
  facts instead of reparsing a composite string such as `summer; mild; 78/56`.
- **Authority** — **thread-only.** Nothing here is durable preference, and it must not be read as
  taste.
- **[cleaned up 2026-08-09]** The two identical readers and the unused `tools.js` writer were
  consolidated into `conversationState.js`. Both live callers retain the same thread-only store.

### 8 · Short-lived recency / diversity memory

- **Writes** — `INSERT INTO whole_wardrobe_sessions` (`rules.js`), which then prunes to the
  last 10 (`rules.js`).
- **User action** — generating whole-wardrobe outfits. Not an explicit save.
- **Reads** — `getRecentWholeWardrobeSessionInfluence` (`rules.js`) → `routes/ai.js`, on a
  6-day cutoff. Reset by `DELETE` at `routes/ai.js`, which is user-facing.
- **Authority** — **score (suppression).** It exists to stop repetition, not to record preference.
- Empty at time of writing; the writers, readers and reset route are all live.

### 9 · Tasks created from feedback

`todos`. Covered in §3 → *Into `todos`*. **Authority — display, then owner action.**

### 10 · Style constitution and global user context

**The largest preference store in the app, and the only one that reaches the *system* prompt.**

- **Writes** — `PUT /api/settings/constitution[/:layer]` (`crud.js/1549`), which also appends
  to `constitution_history` (`crud.js`) and calls `refreshPrompts`; the profile and
  home-location routes (`crud.js/1609/1620`); Onboarding, which authors layers 1–4.
- **User action** — completing onboarding, then editing *"How your stylist understands you"* in
  Style profile.
- **Reads** — `loadConstitution` (`promptRuntime.js`) → `buildForUser` (`:55`), which
  interpolates the layers **into the system prompts** and caches per user until the next write.
  `home_location` additionally feeds weather resolution (`routes/ai.js`), and therefore garment
  eligibility.
- **Authority** — **system prompt.** Stronger and broader than an owner rule: an owner rule is one
  line in a user message, a constitution layer is part of the stylist's standing instructions.
- Seven active layers at time of writing — `aesthetic_gravity`, `body_contract`, `editorial_shoes`,
  `editorial_subject`, `lane_neutrality`, `proven_formulas`, `working_style`. Five constrain styling
  judgment; `editorial_subject` and `editorial_shoes` govern rendered subject and footwear. Sizes in
  script §1b.
- `profile_display_name` and `profile_pronouns` reach every personalised prompt but affect address
  and grammar rather than garment selection — recorded here as global user context, not preference.

### 11 · Visual evidence

The uploads filesystem is an **input store**, not presentation media.

- **Writes** — the piece editor's photo fields, `POST /calibration-images` (`crud.js`), outfit
  photo upload, board generation, and the importer (`importer.js/741`).
- **User action** — photographing a garment, adding a worn photo, uploading a reference.
- **Reads** — the tagger (fit/garment truth, gated on `fit_visible`); visual candidate ranking; the
  renderer's references; saved-outfit evaluation; identity and calibration memory.
- **Authority** — **model evidence**, plus a **hard availability gate**: a piece with neither a
  hanger nor a worn photo is deterministically excluded from the Visual Composer roster at
  `rules.js`, reason `'no photo'`.
- **Verification** — `measure_feedback_surface.js` §1 counts **database references**, not files.
  The filesystem sweep is in `audit_feedback_surface_completeness.js` (medium 2): it resolves every
  referenced filename against `uploads/`, reports missing files and unreferenced ones, and requires
  every `uploads/` subdirectory to carry a disposition. **[unverified]** files referenced from inside
  payload JSON rather than a dedicated column are not yet resolved by that sweep.
- **[latent inconsistency]** The photo's *existence* is a hard gate, but its *contents* are the
  authority for fit fields — and whether a photo counts as fit-visible is a per-photo model judgment
  (`style_profile_json.photo_properties`). See `engine-behaviour-map.md` for that half.

### 12 · Intake and provenance

Not durable preference memory, but the **upstream writer** into categories 1 and 4, and it carries
human decisions.

- **`import_*`** — staging for bulk import. Review actions override model-generated name and
  category values before acceptance, then write into `pieces`, `pieces.worn_photo` and
  `calibration_images` (`importer.js/741/781`). **Those are user corrections that become garment
  truth**, so §3 lists import review as a writer even though the staging tables are not a memory
  store.
- **`piece_import_evidence`** — **[bug]** written by `importer.js` and read by **nothing** in
  production; the only other reference is a test asserting insertion
  (`test/importer_phase3.test.js/148`). Copies promoted into `pieces.worn_photo` are consumed;
  the evidence rows are not. Documented as unconsumed provenance rather than silently omitted.
- **`constitution_history`** — appended on every constitution write (`crud.js`) and exposed
  read-only at `crud.js`. It preserves prior user-authored text, feeds no styling prompt, and
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
`notes`, `styling_rules_learned`, and `tried_and_rejected`. Prose. The retired
`pairs_well_with` database column remains for backward-compatible schema reads but has no UI,
parser, prompt reader, matcher, or score; it contained zero values when retired on 2026-08-09.

### C · Occasion exclusions
`pieces.occasion_exclusions`. **[by design]** The Style-profile panel states it plainly: *"This is a
hard rule — the piece will never be offered for that occasion again until you restore it here."*
Enforced in `pieceOccasionCompatible` (`rules.js`), inside the shared gate, so it binds both
model-chosen and engine-chosen selections. Its only axis is occasion — it cannot express season,
weather or material.

### D · Model-authored garment intelligence
`style_profile_json.garment_intelligence` — `do_not_pair_rules`, `pairing_requirements`,
`failure_risks`, `formula_compatibility`, `real_wear_notes`. Written by the tagger, not the user.
Included because it travels with the garment through the same readers as channel B.

### E · Standing prose rules
`stylist_feedback` rows selected by `feedback_type='owner_rule' OR (feedback_type='preference_reaction'
AND target_type='message')` — see `getOwnerRuleNotes` (`rules.js`) and the shared predicate
`isOwnerRuleRow` (`rules.js`).

**[amended 2026-08-12] The cap is no longer "the newest 8".** `getOwnerRuleNotes(limit = 8, ctx)`
now scans the newest `limit * 20` rows (capped at 4000), drops any whose stored applicability does
not match the supplied request context, and only then takes the newest `limit` survivors. Two
consequences the old description got wrong:

- **Filtering happens before the cap**, so an older applicable rule can be delivered ahead of a
  newer inapplicable one. Under the previous behaviour eight recent unrelated rules could bury a
  relevant older one.
- **Delivery is no longer global.** Only rows whose envelope matches the request are sent. A row
  whose applicability is `unresolved` is never sent, on any request.

Two fallback paths exist in code and currently carry **no active rows** — mechanism present,
population empty, in the same sense as the favourite flags in §1c:

| path | code | active rows | archived |
|---|---|---|---|
| `reach: 'universal'` — sent on every request | writable and matched | **0** | 0 |
| no envelope at all — passed through unfiltered | live `!applicability` branch | **0** | 3 |

Every active owner rule carries a resolved envelope (2 `garment_context`, 2 `context`,
1 `garment`), because the 2026-08-11 migration covered all five and no un-enveloped row has been
written since. Un-archiving a no-envelope row would restore broad delivery for it, which is why the
unfiltered branch is kept rather than removed. Re-check with the query in §0 before relying on
either being empty.

**[2026-08-12] The archived legacy owner rules were purged — all but three.** 57 of the 60 were
obsolete `preference_reaction`/`message` rows (Jun–Jul 2026) with no remaining reference, and were
deleted; `backups/wardrobe/wardrobe-before-legacy-owner-rule-purge-2026-08-12.db` holds the
pre-purge database. **Three were deliberately kept, because archived does not mean unused:**

| id | why it must stay |
|---|---|
| 234 | `owner_constraints.source_feedback_id` of the **active** boots × summer firm rule |
| 457 | `owner_constraints.source_feedback_id` of the **active** sandals × hiking firm rule |
| 401 | The only surviving explanation for piece 242's active `home` exclusion — that exclusion was written by the 2026-08-10 migration rather than the endpoint, so it has no `Excluded from …` receipt of its own |

This is the archive-as-provenance contract working as designed: confirming a firm rule **archives**
its source sentence so the instruction is not also prompt authority, and the constraint keeps
pointing at it for source and undo. Deleting an archived row therefore requires checking
`owner_constraints.source_feedback_id`, `feedback_synthesis_drafts.source_feedback_ids` and
`product_quality_findings.source_feedback_ids` first:

```bash
sqlite3 -readonly wardrobe.db "
WITH refs AS (
  SELECT source_feedback_id AS fid FROM owner_constraints WHERE source_feedback_id IS NOT NULL
  UNION ALL SELECT CAST(j.value AS INTEGER) FROM feedback_synthesis_drafts d, json_each(d.source_feedback_ids) j
  UNION ALL SELECT CAST(j.value AS INTEGER) FROM product_quality_findings p, json_each(p.source_feedback_ids) j)
SELECT f.id FROM stylist_feedback f JOIN refs ON refs.fid = f.id WHERE f.archived = 1;"
```

Both call sites pass 8 (`tools.js` capsule composition, `outfitSetPlanner.js` capsule
roster), so the delivered maximum is unchanged; what changed is which eight.

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

Every current user-facing feedback action, with its writer, destination, reader and behavioural
effect. Where an action has no reader, that is stated.

| user action | writer | destination | read by | effect |
|---|---|---|---|---|
| "Wrong for X" (card menu) | `crud.js` | `pieces.occasion_exclusions` **+** a prose receipt in `styling_rules_learned` | `pieceOccasionCompatible` (`rules.js`) | **hard gate**, garment-scoped. The only user action that removes a garment from consideration |
| Restoring it (chip ✕, or Style profile) | `crud.js` | same | same | lifts the gate; the ✕ calls the endpoint rather than editing text |
| Global verbal correction in chat | `store_user_correction` | `stylist_feedback` `owner_rule`/`message` | `getOwnerRuleNotes` → capsule roster + composition prompts | **prompt**, delivered only when its stored applicability matches the request (or is `universal`, or the row predates the envelope); used when no `piece_id` is supplied |
| Verified garment-specific correction in chat | `store_user_correction(piece_id)` | canonical `pieces.styling_rules_learned` + synchronized `piece_rule_receipt` projection | garment-truth prompts; receipt is Conversation Memory display/edit only | **authoritative garment prompt guidance**, not a deterministic gate or score unless separately mapped to a structured constraint; ID must be retrieved, in the current outfit, or the active garment; failed verification stores nothing |
| "Wrong choice for this outfit" | `POST /stylist-feedback` (`crud.js`) | `stylist_feedback` historical storage value `wrong_item_read` + version-2 `feedbackEvidence` | provisional garment-context reader (bounded delivery inside an already-requested styling call) | **provisional evidence**, no score or standing preference; records available weather and an optional verbatim owner reason without app-inferred diagnosis. Without a reason it is only an exact-outfit reminder and is excluded from synthesis |
| Positive whole-outfit reaction | `POST /stylist-feedback` (`crud.js`) | original reaction payload + version-1 `outfit_logic`; if unavailable, classified `legacy_outfit_snapshot` | consolidated branch of `getStylistFeedbackMemory`; snapshot is synthesis-only evidence | **scoped prompt** for structured formula/silhouette/direction/mood × context; legacy snapshot adds no invented direct logic; no literal-pair selection boost |
| Selecting positive / Almost reactions for synthesis | `GET /feedback-synthesis/preview` then authorized `POST /feedback-synthesis/batches` | compact verdict + structured logic, or bounded generated description + current anonymous garment attributes for legacy evidence → review drafts | accepted-personal reader only after owner acceptance | **draft then bounded prompt**; no source garment IDs/names/photos; exact context phrases from legacy description may bound review but remain generated lower-confidence clues; `Whole wardrobe`/garment context labels are not occasions; lone `almost` cannot become positive proof; acceptance suppresses source direct authority until retirement |
| Editing a positive verdict later in Visual Lab or a canonical Lookbook board | `PATCH /saved-boards/:id` | canonical `saved_boards.payload.scoped_evidence` + one mirrored feedback receipt | `getSavedBoardMemory`; mirrored row deliberately excluded | exact source-chat piece-set match recovers structured logic when unique; otherwise stores a synthesis-only legacy snapshot; removal withdraws authority |
| Exact garment-pair failure | garment editor | existing `tried_and_rejected` relationship | garment truth / rejected-pair reader | explicit owner-authored negative pair knowledge; no new Phase 1 writer or inferred pair penalty |
| "Save as styling rule" | retired 2026-08-09; inert state and append-note routes removed | no current writer | legacy records remain in their canonical stores and retain their normal readers | none |
| Reaction chips on a board or outfit | `POST /stylist-feedback` (`crud.js`) | `stylist_feedback`, type by chip | routed by `feedbackBehaviour` | relational styling reactions: **scoped prompt**; wrong choice: **provisional context with no score**; image fidelity: **renderer** |
| Previewing selected provisional reactions | `GET /feedback-synthesis/preview` | no write | local compactor and pricing table | **display only**, zero provider calls |
| Authorizing one synthesis call | `POST /feedback-synthesis/batches` | `feedback_synthesis_batches` + `feedback_synthesis_drafts` | Style Profile review; accepted-personal reader below | one paid call creates **drafts**, never immediate authority |
| Accepting, editing, or retiring a synthesis draft | `PATCH /feedback-synthesis/drafts/:id` | draft status, owner-edited text/boundary, and owner-reviewable source-validated structured applicability | `getAcceptedFeedbackSynthesisMemory` only for accepted applicable `personal_contextual_lesson` | accepted personal/contextual drafts are visible, editable, relevance-filtered capped **prompt** memory; garment/context scope is executable while boundary prose is explanatory; retirement removes prompt authority; missing applicability matches nothing; general failures and garment corrections remain visible review records |
| Marking a board "Use strongly" | `PATCH /saved-boards/:id` (`crud.js`) | `saved_boards.favorite` | `getSavedBoardMemory` | **prompt/display evidence**, no literal-pair boost |
| Favouriting a garment | `PATCH /pieces/:id/favorite` (`crud.js`) | `pieces.favorite` | inventory filters and display | **organizational only** |
| Confirming or favouriting an outfit | `crud.js` (favourite), `crud.js` (status via `PUT /outfits/:id`) | `outfits.status`, `outfits.favorite` | outfit history and lookbook organization | organizational/status metadata; the exact outfit remains retrievable, but neither flag broadcasts its pieces or adds selection authority |
| Labelling or favouriting a calibration image | `PATCH /calibration-images/:id` (`crud.js`) | `calibration_images` | `getCalibrationMemoryForStylist` | **prompt**, positive *and* negative styling memory |
| Editing a constitution layer | `PUT /settings/constitution` (`crud.js`) | `style_constitution` + `constitution_history` | `loadConstitution` → `buildForUser` | **system prompt**, and rebuilds the per-user prompt cache |
| Reporting a generated-image problem | `POST /stylist-feedback` (`crud.js`) | `stylist_feedback`, image-fidelity types | `getSavedBoardRendererMemory`; field-specific wrong-length also becomes a retag to-do | **piece-scoped text** to the image renderer when the identified garment recurs, **+ task**; the rejected generated image is evidence only and is never reused |
| Historical Visual Lab variation rating | retired; `POST /stylist-feedback` now returns 410 for `target_type='renderer_calibration'` | historical rows preserved | no reader | no effect; defensively excluded from both garment scorers |
| Completing a retag to-do | `PUT /pieces/:id` (`crud.js`) | `pieces` tags, marked `manual` | every consumer of garment truth | **hard gate / score / prompt**, depending on the field |
| Chat-authored `— rejected by <name> (<date>)` garment rules | historical stylist-chat writer; owner verified the two live records on 2026-08-09 | `pieces.styling_rules_learned` | `buildWardrobePieceTruthText` | **prompt**, valid authoritative garment rules |
| Legacy `wrong_proportions` / `proportion_problem` | retired calibration and identity-edit surfaces | compatibility alias to `body_proportions_drift` | renderer memory only | **renderer**, never styling or selection authority; owner verified on 2026-08-09 that the affected calibration boards meant inaccurate body rendering. Board 131 was the one stale garment-length exception and its detached receipt was removed |
| Legacy `catalog_drift` | retired chip name | compatibility alias to `catalog_like` (“Looks generic or store-styled”) | scoped styling memory | **prompt**, same authority as the canonical label rather than a separate feedback meaning |

Five conclusions that follow, and that are easy to miss when reading the sections separately:

1. **Automatic correction capture exists** — `store_user_correction` (§3).
2. **[fixed 2026-08-09] It can now produce a verified garment-scoped rule.** A structured
   `piece_id` routes the correction to that garment's Rules learned list; prose names and
   unverified IDs cannot create piece authority.
3. **[fixed for new chat-authored garment rules]** Conversation Memory holds a display/edit
   projection of the canonical garment rule. Editing or retiring it synchronizes
   `pieces.styling_rules_learned`; the receipt has no independent prompt reader. Historical manual
   rules and global owner rules remain separate stores by design. Un-archiving the receipt restores
   its stored canonical rule without duplicating an identical rule already on the garment.
4. **An occasion exclusion is stored twice** — once structurally, once as prose. See §4b.
5. **[bug — fixed 2026-08-09]** *"Wrong choice for this outfit"* previously scored every garment carried
   in the outfit payload. It was first narrowed to the explicit `pieceId`, then removed from
   deterministic scoring entirely after the owner clarified that the reaction can be
   occasion/activity-specific. Sibling and flagged garments now receive no weight.
6. **[bug fixed, then path removed 2026-08-09]** the pair scorer formerly added a positive `+35`
   for `is_gold` regardless of the base weight, turning a gold `wrong_item_read` from −24 into +11,
   and also allowed garment-name prose matching. The sign and name bugs were corrected before
   Phase 1. The generic `SCORE` readers and their unreachable branches were then deleted; they
   cannot produce −59 or any other score today.
7. **[cleaned up 2026-08-09]** `signature` formerly set `is_gold=1` automatically despite there
   being no distinct Gold action. The flag no longer scores, orders prompt memory, or appears as a
   UI badge. The ten historical non-zero flags were cleared on 2026-08-09; the column remains only
   as inert legacy schema and new rows write zero.

---

## 3. Writers

> Derive the table list rather than hard-coding it, so the census cannot silently fall behind the
> schema:
> ```bash
> for t in $(sqlite3 -readonly wardrobe.db \
>            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"); do
>   echo "== $t"; grep -rn "INSERT INTO $t\|UPDATE $t\|DELETE FROM $t" \
>     --include=*.js routes/ styling-engine/ lib/
> done
> ```
> Search per table rather than by route name — two routes here are named for a column they do not
> write. A store listed in §1 without its writers here is an incomplete entry — check both.

### Into `stylist_feedback`

| site | function | writes |
|---|---|---|
| `crud.js` | `POST /stylist-feedback` | every reaction chip in the chat |
| `crud.js` | `PATCH /stylist-feedback/:id` | edit note/label, set gold, archive |
| `crud.js` | `DELETE /stylist-feedback/:id` | archives (**does not delete**) |
| `crud.js/643` | `syncStructuredReasonsFromSavedBoard` | mirrors board reasons into rows |
| `crud.js/688` | `syncFeedbackFromSavedBoard` | mirrors saved-board labels into rows |
| `tools.js` | `storeUserCorrection` | global `owner_rule` rows, or a display-only `piece_rule_receipt` for a verified garment rule |

**[cleaned up 2026-08-09]** The unused `core.js` copy and its unused `routes/ai.js` import were
removed. `tools.js` now owns the sole implementation and its lexical tool-loop call site.

**[current live path]** The `tools.js` copy accepts an optional `piece_id`. Global corrections still
write `feedback_type='owner_rule'`, `target_type='message'`. A verified garment correction writes
the canonical prose to `pieces.styling_rules_learned` and a `piece_rule_receipt` projection to
`stylist_feedback`.

### Into per-garment memory

| site | function | writes |
|---|---|---|
| `crud.js` | `PUT /pieces/:id` | the whole editor save, including all of channel B |
| `crud.js` | `POST /pieces/:id/occasion-exclusion` | `occasion_exclusions` **and** an `Excluded from …` note into `styling_rules_learned` |
| `tools.js` | `storeUserCorrection(piece_id)` | appends a verified chat correction to `styling_rules_learned` |
| `crud.js` | `syncPieceRuleReceipt` | keeps edits/retirement from Conversation Memory synchronized with that canonical rule |

**[removed legacy path]** The generic chat button, its `savedIndices` thread-state marker, and the
piece/outfit `append-note` endpoints were removed on 2026-08-09 after confirming they had no live
writer. Historical notes and garment rules were not migrated or deleted; they remain readable in
their canonical stores.

Historical records retain their existing meaning; no migration deleted user data.

**Removed 2026-08-08:** a fourth writer, the `appendToPiece` branch on `POST /stylist-feedback`,
copied board/outfit reaction prose into `styling_rules_learned` as `[feedback:<type>] (label) note`.
Owner ruling: board critique does not belong on the garment card. Script §5 still counts the rows it
left behind.

### Into `saved_boards` — the canonical board writers

Distinct from the two functions above, which only *mirror* board feedback into `stylist_feedback`.

| site | function | writes |
|---|---|---|
| `crud.js` | `POST /saved-boards` | creates the board |
| `crud.js` | `PATCH /saved-boards/:id` | `favorite` ("Use strongly"), `archived`, `hidden_from_lookbook`, `title`, `reason`, `watch_for`, `payload` |
| `crud.js` | `DELETE /saved-boards/:id` | a **real delete**, unlike `stylist_feedback`'s archive-on-delete |
| `crud.js` | `setSavedBoardFeedbackLabel` | feedback labels and details on the payload |
| `crud.js` | `indexSavedBoardPieceLinks` | board→piece link indexing (`links_indexed`) |

### Into `outfits` / `outfit_pieces`

| site | function | writes |
|---|---|---|
| `crud.js` | `POST /outfits` | the outfit and its `outfit_pieces` links |
| `crud.js/444/457` | `PUT /outfits/:id` | the outfit, then rewrites its links |
| `crud.js` | `PATCH /outfits/:id/favorite` | `favorite` |
| `crud.js/453` | `PUT` / `DELETE /outfits/:id` | `status`, and the outfit row |

### Into `calibration_images`

| site | function | writes |
|---|---|---|
| `crud.js` | `POST /calibration-images` | upload |
| `crud.js` | `PATCH /calibration-images/:id` | `kind`, `labels`, `notes`, `favorite`, `archived` |
| `crud.js` | `DELETE /calibration-images/:id` | delete |
| `importer.js` | importer | bulk create |

### Into thread and session state

| site | function | writes |
|---|---|---|
| `conversationState.js` | `saveStylistConversationState` | `stylist_conversation_state.state_json`; shared by the freeform pipeline, with one implementation |
| `crud.js`, `core.js` | thread routes | `chat_threads.payload` |
| `rules.js` | whole-wardrobe generation | `whole_wardrobe_sessions`, pruned to the last 10 (`rules.js`) |
| `routes/ai.js` | `DELETE` reset route | clears `whole_wardrobe_sessions` — user-facing |

### Into the style constitution and global context

| site | function | writes |
|---|---|---|
| `crud.js/1549` | `PUT /settings/constitution[/:layer]` | a layer body, appends `constitution_history` (`:1551`), calls `refreshPrompts` |
| `crud.js/1609/1620` | profile + home-location routes | `app_meta` keys; `home_location` changes weather resolution |
| Onboarding | `Onboarding.jsx` | authors constitution layers 1–4 |

### Into garment truth from import review (upstream)

Import staging is not a memory store, but review decisions become garment truth.

| site | writes |
|---|---|
| `importer.js` | `calibration_images`, `piece_import_evidence` |
| `importer.js` | `pieces.worn_photo` |
| `importer.js` | `pieces` — accepted garments, with human-overridden name/category |

### Into `todos` (retag suggestions)

| site | function | writes |
|---|---|---|
| `crud.js` | `syncRetagSuggestionsFromSavedBoard` | wrong-length board feedback → a retag task naming the garment **and the field** |
| `crud.js` | `POST /todos` | manual |
| `rules.js` | `ensureMetadataTodo` | a missing gate-relevant field → a metadata todo |

**[by design]** The retag task never changes tags: its own text is *"Review the garment metadata; no
tags were changed automatically."* It clears when the field is saved, via
`resolved_retag_suggestion_ids` (`crud.js`). This is the only feedback destination that converts
a complaint into corrected data rather than into prompt text.

---

## 4. Readers

> Search: **both** feedback stores, then the call sites of each reader found:
> ```bash
> grep -rn "FROM stylist_feedback\|FROM saved_boards" --include=*.js routes/ styling-engine/ \
>   | grep -viE "INSERT|UPDATE|DELETE"
> grep -rn "<function>(" --include=*.js routes/ styling-engine/ scratch/
> ```
> Search **both** feedback stores. A search over `stylist_feedback` alone cannot find the
> `saved_boards` readers below, and will undercount the deterministic consumers.

| reader | consumed by | kind |
|---|---|---|
| `getStylistFeedbackMemory` (`rules.js`) | freeform stylist chat (`core.js/4026/4031`), `/evaluate-piece` (`ai.js/1143`) | prompt text |
| `getWholeWardrobeFeedbackMemory` (`rules.js`) | whole-wardrobe generator (`ai.js`, `core.js`) | prompt text |
| `getSavedBoardRendererMemory` (`rules.js`) | the image renderer, via `withSavedBoardRendererMemory` (`core.js`) — 5 render call sites; identified garments receive text only, never the rejected generated image | piece-scoped prompt text |
| `getOwnerRuleNotes` (`rules.js`) | capsule roster selection (`outfitSetPlanner.js`) **and** capsule composition (`tools.js`) | prompt text, relevance-filtered before its cap |
| `getAcceptedFeedbackSynthesisMemory` (`rules.js`) | freeform chat, selected-piece and whole-wardrobe styling prompts | capped prompt text; accepted personal/contextual drafts only |
| `getLastOutfitEvaluation` (`tools.js`) | the model's tool loop (`tools.js`) | prompt text |
| ~~`scopedWrongItemInfluenceForRows`~~ | retired 2026-08-10 | old −6/−12 occasion/activity score discarded weather, construction relationships and the owner's reason |
| `getSavedBoardMemory` (`rules.js`) | `/evaluate-piece` (`ai.js/1142`), whole-wardrobe generator (`core.js`) | prompt text |
| `getOutfitsForPieceMemory` (`rules.js`) | `/evaluate-piece` (`ai.js/1138`) | prompt text |
| `getCalibrationMemoryForStylist` (`core.js`) | `/evaluate-piece` (`ai.js`), whole-wardrobe (`core.js`) | prompt text |
| `getStylistConversationState` (`conversationState.js`) | tool loop and freeform conversation pipeline | **thread-only** |
| `getRecentWholeWardrobeSessionInfluence` (`rules.js`) | whole-wardrobe generation (`ai.js`) | **deterministic suppression** |

**The generic deterministic feedback scorer has been removed.** There is no `SCORE` routing
destination, feedback-weight table, literal-pair board scorer, or whole-outfit feedback scorer.
Relational board/outfit judgments reach prompt, provisional, and display memory without becoming
garment weights. There is no feedback-derived candidate or roster score.

**Evidence key convention.** New wrong-choice rows use camelCase `feedbackEvidence` version 2.
Historical `stylist_feedback.payload.scopedEvidence` is read only as legacy evidence;
`saved_boards.payload` still uses snake_case `scoped_evidence` for transferable outfit logic.

**`saved_boards` is the second feedback store, and it is easy to miss.**
`getSavedBoardMemory` sends favourites and labels into scoped prompt memory. The former exact-pair
weights were removed on 2026-08-09; the stored reaction remains available for future extraction of
formula, silhouette, mood and context.

`getPieceUsageStats` (`rules.js`) also reads `saved_boards`, for usage counts rather than
feedback; noted so the enumeration is complete.

**[bug — fixed 2026-08-09] Renderer calibration leaked into styling scores.** Both
`stylist_feedback` scorers formerly guarded only image-fidelity rows whose target was
`generated_visual_board`, allowing `renderer_calibration` rows to fall through. Both scorers now
exclude `renderer_calibration` unconditionally before applying a weight.

- **[historical impact before fix]** `buildVisualComposerRoster` applied the weight directly
  on `context_type='piece' && context_id`, with no further test. The pre-cleanup snapshot listed
  23 `renderer_calibration` rows, including proportion, silhouette, and safe/generic reactions.
  Detached proportion receipts were removed after the owner confirmed they were renderer-only.
- **[historical latent path before fix]** `getFeedbackInfluenceForPair` had the same defective guard, with no
  impact.** It additionally requires `touchesCandidate`: the candidate's ID in the payload, or the
  candidate's name inside `note + label + context_name`. Verified on live data: **no
  `renderer_calibration` payload contains any piece ID (0 of 23)**, and the only garment name their
  prose contains is the *selected* piece itself (id 145, "Cream wool shell") — which
  `rankedComplementaryWardrobeFor` excludes from its own candidate list. So the condition cannot be
  met by current rows.

  It is one datum away from firing: a calibration note that mentions any *other* garment, or a
  garment renamed to a substring of that prose, would satisfy it. The name test is a substring
  match, not a token match.

**`renderer_calibration` is retired.** It never had a renderer reader. The UI and obsolete snapshot
bookkeeping were removed on 2026-08-09, and the generic feedback endpoint returns 410 for attempted
new writes. Historical rows remain in place and excluded from both styling scorers. Working
calibration continues through saved-board image-fidelity feedback and uploaded reference images.

---

## 5. What each surface actually receives

| surface | channels it sees |
|---|---|
| freeform stylist chat | A, B, C, D, E, **F** |
| whole-wardrobe generator | A, B, C, D, E, **F** |
| `/evaluate-piece` | A, B, C, D, E, **F** |
| image renderer | image-fidelity subset of F |
| single-piece outfit ranking | A, C; no feedback-derived garment score |
| Visual Composer roster | A, C; provisional evidence may enter the existing model call only for roster garments |
| **capsule roster selection** | A, B, C, D, **E only** |
| **capsule composition** | A, B, C, D, **E only** |

The capsule path reads `getOwnerRuleNotes` and no other feedback reader. Verify with:

```bash
grep -nE "(getStylistFeedbackMemory|getWholeWardrobeFeedbackMemory|getSavedBoardRendererMemory)\(" \
  styling-engine/tools.js styling-engine/outfitSetPlanner.js
```

The trailing `(` matters: without it the search also matches a prose mention of
`getStylistFeedbackMemory` in a comment at `outfitSetPlanner.js`, which is not a call.

**Two piece-text builders**, and which one runs decides how much of B and D a prompt sees:

- `buildPieceText` → `buildWardrobePieceTruthText` (`src/utils/wardrobeAiContext.js`) — carries
  all of B and D. Used by capsule roster selection (`ai.js`) **and** the atomic capsule
  composer (`ai.js`), which deliberately overrides the compact catalog. Its comment records
  why: the compact line's omission *"allowed a relaxed hoodie under a relaxed cardigan even though
  both records explicitly prohibit another loose top."*
- `planWorkbenchPieceLine` (`outfitSetPlanner.js`) — compact. Carries
  `styling_rules_learned` and `tried_and_rejected` but **not** `notes` or any of
  D. It survives as `workbench.piece_catalog`, read by the `submit_plan_outfits` tool loop
  (`tools.js`) and by ordinary non-capsule plans.

---

## 6. Provenance of per-field edits

`_confidence.<field>` and `manual_overrides` both record owner edits and agree exactly;
`getFieldConfidence` falls back between them. **[by design]** the piece editor marks a field
`manual` on *any* interaction, and `pinManualConfidence` (`crud.js/282`) persists it on save.

**[latent inconsistency]** A data-history limitation, not a defect in the normalizer. `normalizeConfidenceMap` (`taggerMerge.js`)
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
(<date>)` — from the same handler, `crud.js`.

The owner-confirmed piece-242/home correction now follows this canonical route: `home` is stored in
the garment's `occasion_exclusions`, and its former global `owner_rule` row is archived. An
unambiguous home plan slot supplies `home` specifically to the owner-exclusion lookup before
composition. Other occasion checks still receive the public `casual` context; AI-generated
`occasion_confidence.home` therefore remains advisory.

**[2026-08-12] The receipt is now also the only source of "when".** `pieces` holds no
per-exclusion timestamp — its single date column, `date_added`, records when the *garment* was
added — and `GET /pieces/occasion-exclusions` returned rows alphabetically. To order exclusions by
recency, that route now parses the newest matching `Excluded from <occasion> by <name> (YYYY-MM-DD)`
line per piece/occasion and returns it as `changedAt`, newest first. Day precision only; an
exclusion written by migration rather than the endpoint has no receipt and returns `null`, sorting
last. This does not change authority: `occasion_exclusions` is still the enforcement record and the
prose remains display-only provenance.

The prose chip is not the enforcement record. The editor's `PUT /pieces/:id` column list
(`crud.js`) **does not include `occasion_exclusions` at all**, so no editor save can change an
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

A store absent from §1 should be absent *on the record*, so an audited exclusion is distinguishable
from an undiscovered store. `constitution_history`, `piece_import_evidence` and the `import_*`
tables are **not** here: they are category 12, provenance-only. Each store is in exactly one place,
and `feedback_surface_inventory.json` enforces that.

| store / key | medium | why excluded |
|---|---|---|
| `app_meta` API keys (BYOK) | SQLite | operational credentials, not user preference |
| `app_meta.seeded`, `constitution_migrated` | SQLite | migration and workflow markers |
| import spending and count telemetry | SQLite | operational accounting |
| `stylist_rail_collapsed`, `stylist_rail_view_mode` | browser | presentation only |
| `stylist_current_thread_id` | browser | navigation only |
| `importSessionId` | browser | in-flight workflow handle |
| generated thumbnails, board images, derived caches | files | derived artifacts, not user input |
| `generation_runs` (1,990 rows), `freeform_generation_runs` (83) | SQLite | engine telemetry — flow, cap, token and gate counters. No user-authored content, and **no production reader**: written for offline diagnosis only |

**Browser storage, in full.** The keys are
`stylist_chat_threads`, `stylist_chat_messages`, `stylist_chat_history`, `stylist_thread_memory`,
`stylist_current_thread_id`, `stylist_rail_collapsed`, `stylist_rail_view_mode`, `importSessionId`.
Of these, `stylist_chat_threads` is a **non-canonical client cache** reconciled against the server,
and `stylist_chat_messages` / `stylist_chat_history` / `stylist_thread_memory` are **legacy
migration sources** whose contents can move into `chat_threads`. They are recorded here rather than
in §1 because none of them is authoritative — but a reader auditing "where could a user's stated
preference be hiding" needs to know they exist.

## 7. Open questions the code cannot answer

- **[owner check wanted]** Should board reactions influence capsule *selection* at all?
  `getStylistFeedbackMemory` already separates scoped reactions ("taste signals, not global
  directives") from standing rules; §5 shows the capsule sees neither.
