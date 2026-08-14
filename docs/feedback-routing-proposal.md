# Feedback routing — proposal

**What exists is described in [`feedback-and-memory-map.md`](feedback-and-memory-map.md).** This
document does not restate it and carries no measurements of its own; where a number is needed, run
`node scratch/measure_feedback_surface.js` and cite the section. If this document and the map
disagree, the map is right.

Written 2026-08-08, after mapping the surface.

## Current project status — read this before the implementation table

**The user-feedback project is not complete.** The cleanup and routing foundation are complete,
and one owner-authorized synthesis pilot is working. The broader capability for learning from
outfit feedback is still in development.

| capability | status | boundary |
|---|---|---|
| Remove duplicate, dead and misrouted feedback authority | **complete** | Phases 0–2 cleanup |
| Record versioned provisional evidence for **Wrong choice for this outfit** | **complete** | one negative reaction only |
| Owner-authorized synthesis and review lifecycle | **pilot working** | consumes reasoned **Wrong choice for this outfit** evidence and reasoned **Almost right** / **Not for me** evidence (an owner comment attached to the verdict) |
| Route accepted lessons only to applicable styling requests | **pilot complete** | source-validated structured applicability is owner-reviewable/editable and matched before the eight-line cap; boundary prose remains explanation only |
| Learn formula, silhouette, mood or context lessons from positive / `Almost` reactions | **closed, 2026-08-14 — not proceeding** | no synthesis or scoring route was found that would not reinforce sameness, contradicting the app's stated purpose (§ "Product direction"); positive reactions remain organizational record for Lookbook inspiration only, with no active or planned path to prompt/scoring authority. Unrelated to this row: a *reasoned* Almost/Not-for-me verdict is a diagnostic complaint, not formula reinforcement, and is eligible under item 8 |
| Apply approved garment-fact corrections through an appropriate garment-truth workflow | **backend complete for the bounded routes** | field-specific generated-image reports can propose reviewable metadata changes; physical compatibility failures are routed to product quality instead of garment truth |
| Product workflow for general styling/model mistakes | **backend complete; review UI deferred** | accepted findings and explicitly confirmed no-cost reports enter a durable evidence queue, never personal memory |
| Route explicit learned constraints before unsuitable garments consume roster capacity | **backend complete; review UI deferred** | confirmed piece/category/material × occasion/activity/season/weather constraints gate per request or capsule slot and can be retired |
| UI/UX panel and presentation refinement | **deferred** | begins after routing behaviour is settled |

In this document, **shipped** means that the named bounded mechanism exists; it does not mean the
entire feedback-learning product is finished. **Pilot working** means the owner can exercise the
flow end to end, but its coverage or downstream routing is intentionally incomplete.

## The problem in one sentence

Feedback is collected in six channels and treated as if it answered one question, so most of it
either lands in a prompt or lands nowhere, and several reactions carry authority in two places at
once. Prompt text is also the destination with the worst cost-to-value ratio of the five available.

## Purpose and guardrails

The project is not an attempt to redesign styling, replace working calibration/weather/owner-rule
systems, or teach the application a comprehensive fashion ontology. Its purpose is to make each
explicit user action mean what the user reasonably intended and reach one appropriate behavioural
authority:

- factual corrections improve garment truth;
- image corrections guide rendering;
- explicit prohibitions reach an existing hard or standing-rule path;
- one-outfit reactions remain bounded evidence;
- durable personal principles become owner-reviewed memory.

Receipts and provenance may be visible in more than one place, but they do not acquire duplicate
authority. Generic styling mistakes are product-quality evidence, not personal preferences. No
paid synthesis happens automatically, and no historical record is assigned a broader meaning by
guessing.

Before changing any mechanism, the current-system map and engine map must be reconciled with the
proposal. An item marked open is not evidence that the capability is absent. Working mechanisms are
preserved unless the map, code and user workflow establish a specific failure.

## Product direction: learn the logic, diversify the closet

The purpose of positive outfit feedback is **not** to consolidate existing combinations or keep
putting the same garments together. The app exists to help a person rediscover their closet.

When a look works and structured logic is available, feedback should preserve its transferable
styling logic:

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
| `bad_occasion` | ❌ contextual outfit judgment | none without an explicit metadata correction |
| `layer_too_long`, `competing_hemlines` | ❌ relational | none — the stored garment length may be correct |
| “Wrong choice for this outfit” (historical storage value `wrong_item_read`) | ❌ provisional contextual evidence | none without synthesis and owner acceptance |
| `wrong_garment_details` | ❌ generated-image problem report | none without an explicit field-level metadata correction |
| `fit_issue`, `too_much_volume`, `shape_lost`, `unbalanced_proportions`, `too_columnar` | ❌ relational | none — these describe two garments against each other |

**`wrong_garment_details` fails this rule on both halves and stays in destination B.** It names one
garment but implicates several fields at once (`reads_as`, `pattern_*`, `neckline`, `sleeve_type`)
with no field-level sub-reason to disambiguate — unlike `wrong_length`, which ships six. And it is
classified as **image fidelity**, so the complaint may be that the *render* drifted rather than that
the wardrobe metadata is wrong; routing it to a retag task would ask the owner to correct data that
may be correct. It becomes a candidate only if the UI first collects an explicit field-level
correction, the way the wrong-length flow already does. No such metadata-correction control is
planned here; without it, the reaction remains renderer feedback.

`bad_occasion`, `layer_too_long`, and `competing_hemlines` are also not retag candidates. They
describe whether a garment worked in one outfit/context, not whether its stored occasion or length
is factually wrong. Routing them to metadata review would turn a relational styling judgment into a
garment-fact claim. Only an explicit owner correction naming the field may cross that boundary.

`fit_issue` is `target_type='whole_wardrobe_outfit'`: a judgment about how an outfit hangs together,
not about the garment field `fit_on_body`. Relational complaints belong in destination C.

The safety property that makes imperfect routing acceptable here: a wrong suggestion costs one
dismissed to-do, never a corrupted tag.

### B · "The picture is wrong" → piece-scoped image-fidelity instruction

**Two things share this destination and only one of them works.**

- **Saved-board image-fidelity feedback** (`wrong_length`, `wrong_garment_details`,
  `body_proportions_drift`, `identity_drift` on `target_type='generated_visual_board'`, plus
  `saved_boards.payload.feedback_labels`) — reaches the image prompt via
  `getSavedBoardRendererMemory`, and is correctly excluded from both pair scorers. The reader sends
  a short textual reminder only when the identified garment is in the new render. The rejected
  generated image is retained as evidence and is **never** supplied as a future visual reference.
  This half is **[by design]** and working.
- **`renderer_calibration` rows** — the retired experimental path. It reached no renderer and
  formerly leaked into garment selection. New writes now receive HTTP 410; historical rows remain
  untouched and defensively excluded from both scorers.

The active fidelity capability is the piece-scoped text path above plus the normal garment and
approved calibration/reference images. It does not treat an inaccurate generated image as
calibration. A field-specific wrong-length report may also create a reviewable retag task, because
the app cannot assume whether the render or stored garment data was wrong; no metadata changes
automatically.

**Misattribution bug found and fixed, 2026-08-14.** A `wrong_length` row with no actual
`length_correction` data (a legacy/malformed report — no `piece_id`, no `issue`) was silently
treated as a valid correction for *every* garment sharing that report's outfit board, not just the
one it was actually about — a print top and a pair of shorts worn together could each inherit a
length complaint that was, per the board's own recorded `watchFor` note, really about the top. This
existed in two independently-drifted places that had to be fixed together: `getSavedBoardRendererMemory`
(what actually reaches the image-generation prompt) and the Style Profile "Already in effect" list
(`rendererReportGroups` in `StylistSettings.jsx`, a separate reader over the same raw rows). Both now
require a genuine `piece_id` + recognized `issue` before attributing a correction to a garment;
neither falls back to guessing across a shared board. This is the "double authority" failure mode
row 0.4 exists to catch, recurring as two readers of the same evidence silently disagreeing about
what it meant rather than as a second scorer.

### C1 · "This garment is prohibited in this context" → a scoped constraint

**Hard, and it already works.** `occasion_exclusions` is the only per-garment channel that is both
personal and deterministic (map category 1). *"Never use these shorts for hiking"* belongs here, and
the answer is binary — the garment is removed from consideration for that context.

Its one structured per-garment owner-feedback axis is occasion. Weather and season are covered
through deterministic wearability gates based on structured garment data and request/forecast
context, plus standing personal rules such as “I do not wear boots in summer.” General material
physics must remain in the shared gate rather than becoming per-garment owner memory. The first
item-11 correction now treats canvas and suede footwear as ineligible for credible wet exposure
(explicit rain/wet/mud, or a foggy coastal outdoor walk) while leaving ordinary fog and dry walking
alone. Do not infer either a personal ban or a new per-piece weather exclusion from an outfit reaction.

**A `general_styling_failure` synthesis finding led to a real gap in that shared gate, 2026-08-14.**
A `wrong_choice` reaction on "green utility pocket shorts" for `outdoor_daytime_social` synthesized
into "athletic shorts are not appropriate for an outdoor daytime social occasion." That is not a
subjective register judgment — the piece's `fabric_category` is genuinely `technical/performance`,
and `outdoor_daytime_social`'s occasion profile (`styling-engine/occasions.js`) already declares
`discouraged_materials: [..., "performance fabric"]`, exactly the kind of shared, deterministic
material-physics gate this section says such a rule belongs in, not per-garment owner memory. But
checking the gate directly (`profileRuleFit`, no model call needed) showed it did not fire: the
gate's phrase `"performance fabric"` never matched the auto-tagger's actual enum value
`"technical/performance"`, because `pieceMatchesMaterial` requires the literal phrase as a
substring rather than a synonym or fuzzy match. The rule existed and was correctly scoped to the
shared gate; it simply never matched the one material category it was presumably written for.
Fixed by adding the tagger's literal enum value alongside the descriptive phrase. The general
lesson: a synthesis finding restating what looks like an existing deterministic rule is worth
checking against that rule directly before trusting either that the rule already covers the case or
that the finding is redundant — the two had silently diverged.

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

At audit time, 24 confirmed and 3 favourited outfits reached broad prompts through
`getConfirmedOutfitMemory`, while `getOutfitsForPieceMemory` supplied garment-relevant history.
The broad reader has now been removed. Literal examples remain available when the user is
inspecting that outfit or a garment it contains, but are no longer broadcast as general preference
memory into unrelated generation, where a list of past outfits invited literal reuse.

Do not manufacture formula evidence from an outfit name, note or piece list. When structured
formula/silhouette/direction/context evidence already exists, use it. When it does not, narrowing
delivery is safer than automatic inference or a paid migration. The remaining work in item 3 is
prompt scoping, not style-lesson generation.

## 1e. Structured constraints must be canonical

An occasion exclusion is currently both a structured hard gate and a generated prose line in
`styling_rules_learned`. The UI now removes them coherently, but the prose receipt can still repeat
the same instruction in a prompt. Keep the structured exclusion as the sole behavioural authority;
show its provenance in the UI without delivering the generated receipt as a second rule.

**Eligibility reassurance shipped 2026-08-13 — implements item13-panel-findings.md consensus §3.**
The two hard-limit card types (`owner_constraints` "Always avoid" firm rules, and per-garment
`occasion_exclusions` "Specific pieces") previously stated only what was blocked — "Not for
walking," "Not for Home" — with no confirmation that the garment remained available everywhere
else. Reading the card alone, there was no way to tell "skip this one situation" apart from
"this piece is basically benched." Soft-guidance cards (accepted synthesized lessons, direct
chat-captured guidance) were deliberately left alone — nothing is actually excluded there, so
"still available elsewhere" would introduce a concept those cards don't need.

Shipped copy, in `src/views/StylistSettings.jsx`:
- **Always avoid** — reassurance moved to the section level, stated once rather than per row:
  *"Firm rules your stylist always follows. These rules only apply in the situations shown.
  Everything else stays available."* Rows stay unchanged (`Heels — Not for walking.`).
- **Specific pieces** — reassurance is per-row, since owners are more likely to wonder whether one
  specific garment has been globally sidelined: *"Skip for Travel · Still available for other
  occasions"* for a single exclusion, or *"Skip for Hiking and Home · Still available elsewhere"*
  for multiple (new `joinWithAnd` helper renders the occasion list as prose instead of a comma
  list). The section heading also gained one framing sentence: *"Pieces your stylist avoids only in
  the situations shown. Outside those situations, they stay in the mix."*

### Owner-confirmed conversion — constraint-shaped learned rules

Conversation Memory also contains free-text owner rules whose meaning is stronger than ordinary
taste guidance, for example “never use these shorts for home outfits.” Today these remain prompt
guidance. They must not be converted automatically into gates: free text can be ambiguous, and a
model-authored or mis-scoped sentence must not silently remove garments from consideration.

The owner-confirmed structured workflow is now implemented in Style Profile:

1. attach a complete, validated structured **proposal** only to a learned rule whose meaning has
   already been verified, preserving its original receipt;
2. show **Make this a firm rule** only when that proposal already identifies both the clothing and
   the situation, then show the exact exclusion sentence for confirmation;
3. only after confirmation, write one canonical structured constraint;
4. use the prose receipt for source and undo, not as duplicate prompt authority.

The empty **Always avoid** collection is hidden. From a learned sentence the owner can choose
**Make this a firm rule**, preview the consequence, and confirm without a model call. There is no
generic free-text rule builder: unsupported or ambiguous memories do not show the action, and the
server validates the stored proposal again on confirmation. New chat memories receive this proposal
through the existing `store_user_correction` tool call, so creating the proposal costs no second model
call and still cannot activate a gate without owner confirmation. The first verified flow is
`footwear: boots × season: summer`. Footwear type is distinct from the coarse `shoes` wardrobe
category so the boots rule does not exclude every shoe. “Pants, not dresses, for airplane travel”
remains ordinary guidance for now: airplane travel is not a structured request dimension, so offering
a firm button would promise enforcement the current request pipeline cannot provide.

Enforcement must respect the shape of the styling request. For a single-outfit request, an
ineligible garment is removed before candidate capping and before the model receives the roster.
For a capsule or plan containing several occasion slots, build slot-aware eligibility: retain a
garment when it is valid for at least one requested slot, exclude it only from prohibited slots,
and remove it from the overall roster only when it is valid for none. Each composed outfit is then
validated against the same structured constraint. This prevents an instruction such as “not for
home” from either wasting a home-outfit slot or incorrectly removing the garment from a mixed
summer capsule where it remains suitable elsewhere.

**First bounded route shipped 2026-08-10.** The confirmed “beige tailored linen shorts are not for
home” instruction was moved out of global owner-rule prose and into the garment's existing
`occasion_exclusions` (`home` alongside `hiking`); the duplicate global row was archived. A casual
plan slot that is unambiguously home-specific (for example, **Home & Backyard**) now keeps its
public `casual` label while supplying `home` only to the owner-exclusion lookup before the model
sees the roster. The other occasion checks still evaluate the public `casual` context, so advisory
AI Style Read data does not become a hard gate. Ambiguous combined slots such as **At Home / Errands** remain broad rather than
incorrectly suppressing garments that are valid for errands. Explicit owner occasion exclusions
also appear in the plan garment catalog as a secondary safeguard. AI-generated
`occasion_confidence` remains advisory and was not promoted into owner authority.

### Direct guidance is now relevance-routed

New conversation guidance no longer defaults to “send this on every styling request.” The
`store_user_correction` write carries a versioned applicability envelope describing whether the
instruction is universal, garment-relevant, context-relevant, both, or unresolved. The server
validates that envelope and also runs a deliberately narrow local extractor over explicit supported
clothing and context terms. This is the safety net exposed by the sandals test: “I never wear
sandals for hiking” becomes sandals × hiking even when the model omits the optional structure.
There is no second model call and no additional owner question for an unambiguous sentence.
The garment half supports exact piece IDs plus conjunctive structured category, footwear, and
material selectors (for example, canvas **and** sneakers rather than either one). The context half
supports occasion/activity/season/weather and explicit request situations such as office or client
days. Situation terms are matched against the actual request/plan-slot wording, so an office rule
does not leak into every request that happens to share the broad smart-casual profile.

Direct guidance and accepted contextual lessons retain their different provenance and review
workflows, but now adapt into the same executable relevance matcher. Selected-piece, freeform,
whole-wardrobe and plan readers supply the bounded active garment set plus the actual request
occasion/activity/season/weather. Garment-and-context guidance requires both matches; a mixed plan
may match any real slot. Relevance filtering happens before the delivery cap, so unrelated recent
rules cannot hide an older applicable one. A new sentence that cannot be scoped is stored for
review but receives no prompt authority rather than silently becoming global. Existing records
without the envelope remain legacy-compatible for now and are visibly labelled as unreviewed scope;
this preserves established behavior without pretending their scope has been verified.

The five active legacy records in the development wardrobe were migrated after a read-only preview
on 2026-08-11: travel pants/dresses → travel context; canvas sneakers → canvas+sneakers with
rainy/wet exposure; office/client styling → those explicit request situations; the lilac cardigan
fit note → exact piece 224; leather jackets → leather+outerwear with summer+travel. The pre-migration
database is retained under `backups/wardrobe/`.

This advisory route is separate from **Make this a firm rule**. Applicability decides when prompt
guidance is worth sending; a firm rule changes deterministic garment eligibility and still requires
a complete supported proposal plus explicit owner confirmation.

Style Profile presents both advisory sources in one **Guidance for specific situations** collection,
ordered together by recency. “Told directly to your stylist” versus “feedback you reviewed” is
secondary source/history text, not a separate section. Firm rules and garment occasion exclusions
remain separate because they change deterministic eligibility rather than prompt guidance.

This mechanism is not a repair for incorrect base classification. In particular, broad `casual`
eligibility must not be treated as proof of `home` eligibility; if the engine collapses those
contexts, that is a separate context-routing defect to diagnose and fix rather than a reason to
manufacture an owner rule.

### Editing applicability without exposing it as a schema — pilot, 2026-08-11

An owner-editable structured-checkbox surface (reach dropdown, garment/context dimension groups)
was built, shipped to the sandbox, and then removed the same day after owner review: it exposed
internal routing vocabulary — scope, reach, dimension labels — directly to the person styling her
own clothes, which nothing else in this app does. Every other surface derives structure from plain
language or plain actions and shows it back as a sentence; this one asked her to construct it. Two
guardrail findings from that surface survive the redesign and remain load-bearing:

- A checkbox/dropdown editor can silently produce an unusable or narrower-than-shown state on save
  when client-side "is this usable" logic doesn't match server-side validation exactly — reproduced
  concretely for the synthesized-lesson case (an unsupported term, or evidence that drifted since
  acceptance, could zero out an active lesson's delivery with no error surfaced).
- A synthesized lesson's evidence can itself contain the composer's unresolved `current season`
  placeholder rather than a resolved season name, because request-time season context was never
  normalized before being written into `feedbackEvidence.context.season`. Fixed at the source:
  `compactSynthesisEvidenceRow` now resolves `current season`/`warm`/`autumn` against the reaction's
  own `created_at` (not "now"), reusing the same resolution `owner_constraints` firm-rule matching
  already applied. This was a real, pre-existing data gap the checkbox surface happened to surface
  first; it is not specific to that UI and stays fixed regardless of what replaces it.

What shipped instead, and is live in Style Profile as of 2026-08-11:

- **Direct guidance** — no separate scope control at all. Editing the note text and saving
  re-derives `ownerGuidanceApplicability` through the same deterministic extractor
  `store_user_correction` already runs at capture time; the owner only ever edits her own sentence.
  A row carrying an exact piece ID from the 2026-08-11 legacy migration is left untouched by a text
  edit — prose can never reconstruct a piece ID, so that scope is frozen rather than guessed away.
- **Synthesized lessons** — no scope control either, only plain removable tags ("Currently applies
  to: olive suede slip-on shoes ×, summer ×") built from the same server-computed,
  evidence-grounded option set the sanitizer validates against, so nothing shown can be silently
  dropped. Narrowing only, consistent with synthesis's existing rule that scope must never exceed
  what evidence actually showed; broadening still requires new evidence and a new synthesis call.
  Removing the last tag is disabled with a plain nudge toward Retire, and `scope` is recomputed from
  whatever remains rather than left stale. The server independently rejects (400) any save that
  would leave an already-accepted lesson with zero delivery scope, as a backstop behind the UI.

### Owner design review, 2026-08-12 — read-only memory, presented as explanations

The owner reviewed the editing surfaces and ruled that **active guidance carries no editing at
all**. Both card types — direct guidance and accepted synthesized lessons — are read-only, with a
single action: **Forget this**. Correcting a preference means telling the stylist again in chat,
which writes its own record through the normal `store_user_correction` path. The governing
principle: *records open as explanations, not forms; this area should read like "what my stylist
remembers about me", never like a memory-management console.*

Two intermediate designs were built and removed on the way to that ruling, and both failures are
worth keeping on the record because they are easy to reintroduce:

1. **A structured scope editor** (reach dropdown, dimension checkboxes) exposed internal routing
   vocabulary to the person styling her own clothes. Nothing else in this app asks that.
2. **A "remove a condition" chip row inverted its own meaning.** A lesson's conditions are ANDed,
   so removing one *widens* where it fires. Verified against the matcher: a lesson scoped
   `olive suede shoes AND summer`, with the summer chip removed, begins firing in **winter and
   fall** whenever those shoes are candidates; removing the garment chip instead makes a lesson
   about one pair colour **every summer request**. The control read as "stop using it here" and did
   the opposite — and broadening a synthesized lesson past its evidence is exactly what the
   synthesis guardrails exist to prevent. There is no safe in-place narrowing, so there is no
   control.

Scope is therefore stated, never edited, and stated as a sentence with the conjunction spelled out
(*"Applies when styling cream cotton button-up shirt for casual summer."*, *"For canvas sneakers and
rainy weather"*) rather than a comma-separated row that reads like a list of alternatives.

**Server contract.** `PATCH /stylist-feedback/:id` no longer re-derives applicability from a changed
note; a stored envelope only ever changes by the owner saying something new in chat. Pending
synthesis drafts remain authorable (she may reword what the stylist proposed before accepting it),
but their applicability is not owner-editable either.

**Page structure, from the owner's mockup (2026-08-12).** Active guidance is now two groups plus the
baseline, which supersedes the earlier "one unified collection ordered by recency" decision recorded
above in this section — creation path turned out to matter to the reader after all, because the two
kinds answer different questions:

- **When it matters** — *"Things your stylist remembers for particular clothes or situations"*.
  Accepted lessons as cards, each showing the garment it is about (its current photo, read from
  `pieces` rather than the evidence snapshot), the applies-when sentence, and *"Learned from feedback
  you approved."*
- **Other things you've told your stylist** — direct guidance as a quieter list with a scope line
  (*"For travel"*), capped at five with *See all guidance*.
- **Your foundation** — the onboarding baseline, deliberately distinct from the living memory above
  it: *"These are the preferences and guidance you set during onboarding."* Seven labelled tiles
  (Body & comfort, Aesthetic preferences, Proven formulas, Style range, Working relationship, Image
  guidance, Footwear guidance) using her words rather than layer keys. One is the baseline she
  authored at setup; the other is what the stylist has learned since.

**"What changed recently" removed, 2026-08-12.** The recency strip above the guidance sections was
deleted rather than restyled. It duplicated every card in the two sections directly below it, and
its labels asserted behaviour that relevance routing had already made untrue. Verified at runtime
against `getOwnerRuleNotes`: a scoped direct-guidance row is delivered on a matching office request
and **withheld** on an unrelated one; a row whose applicability is `unresolved` is withheld on
**every** request; only a legacy pre-envelope row is delivered unconditionally. So the strip's
**"Guides the stylist"** label was accurate for exactly one of three cases and outright false for
unresolved rows, and pairing it against **"Applies in matching situations"** on lessons implied a
conditional/unconditional split between the two sources that no longer exists — both are matched.
Any future recency surface must label by the row's actual envelope, not by which store it came from.

**"How this works" guidance explainer shipped, 2026-08-14.** The four active-guidance categories
(learned lessons, direct chat guidance, locked-in firm rules, per-piece limits) read as
understandable individually but the soft-guidance/hard-exclusion distinction between them required
reading all four card types across the page to infer. A popover, opened from a text trigger next to
the page intro (not a bare icon — discoverability, not decoration), states the four categories in
plain language with a one-line consequence label per category ("Gentle reminder" vs. "Always
enforced"), an explicit "stays available for everything else" example for the piece-limit category
(the same reassurance shipped § "Eligibility reassurance" above, demonstrated rather than only
described), and a quiet closing reassurance that memory can always be changed. No routing
vocabulary — scope, reach, dimension, synthesis — appears anywhere in it, consistent with the
2026-08-12 ruling that this page reads as explanations, not a console.

**Still queued:** firm-rule card wording, and the feedback-capture confirmations in chat (*"Got it —
I won't suggest this piece for Travel"*) that keep a one-off reaction visibly distinct from a durable
rule.

## 1f. Calibration reference priority is already qualified by reference kind

**Closed without a behavior change.** `calibration_images.favorite` means “prioritize this image
within its existing reference kind,” not generic garment or outfit approval. The image-generation
reader rotates starred references first, while `kind` supplies the purpose: `real_photo` is captioned
for identity/proportion reference and `good_reference` for taste/aesthetic calibration. These are
sent alongside, not instead of, available exact-garment hanger/worn-photo anchors. The flag has no
garment-selection or outfit-ranking authority. More specific UI wording may be considered during
the later UI/UX review, but the working calibration path should not be retired or neutralized.

## 1g. Positive feedback must not defeat diversity

Prompt size and selection diversity are separate concerns; compact feedback could still dominate
if it acquired candidate weight. The former exact-pair positive scorer was removed, while the
6-day recency suppression in `whole_wardrobe_sessions` remains. Structured positive evidence now
describes transferable logic and explicitly asks for different suitable garments, so the two
mechanisms no longer directly compete over literal piece selection.

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

1. **Scope contextual evidence to the decision in play.** Outfit/board evidence should reach a
   call only when its garment or context is relevant; `getSavedBoardRendererMemory` demonstrates
   the overlap pattern. Direct owner guidance now follows the same principle through its validated
   applicability envelope; only guidance explicitly stored as universal reaches every request.
2. **Consolidate, don't concatenate.** *"Marked too plain on 4 outfits containing this jacket"* is
   one line and stronger evidence than four lines.
3. **Cap per destination, not globally.** A garment with 20 reactions contributes a summary.

**Images are a prompt-size and cost dimension too, 2026-08-14.** The wrong-choice/reasoned-verdict
synthesis pilot (item 8) attaches the generated outfit image and referenced garment photos to its
call, not just text — a text-only description of "the vest shape doesn't work with the cropped top"
is a claim the model previously had no way to actually verify. This is scoped the same way the text
rules above are: resolution is tiered by garment complexity (reusing the app's existing
`pieceVisualDetailPolicy`, not inventing a new one), capped at one board image plus four garment
photos per evidence item (`MAX_GARMENT_IMAGES_PER_EVIDENCE_ITEM`, prioritized by
`visuallyPrioritizedPieces`), and the pre-authorization cost preview now sums real image-token cost
(Anthropic's width×height/750 formula) rather than only estimating text bytes, so the owner sees the
true cost before authorizing. This does not change what evidence is eligible (§ "Phase 1" above,
item 8) — only what the model can verify once it is.

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
| ~~1~~ | Establish the first canonical **scoped evidence contracts** | **foundation shipped — versioned wrong-choice evidence and preservation of pre-existing structured outfit logic; not a complete outfit-feedback learning model** |
| ~~2~~ | Verified piece-scoped chat corrections (`store_user_correction` takes a `piece_id`) | **shipped — exact ID is mechanically verified; garment rule is canonical; Conversation Memory receipt is display-only** |
| ~~3~~ | Consolidate and scope existing prompt memory, including saved outfits (§1d) | **bounded cleanup shipped — unrelated literal confirmed-outfit delivery removed** |
| 4 | Evaluate any scoring change against ranking **and diversity** tests (§1g) | **ongoing verification rule — no Phase 1 feedback score was introduced** |
| ~~5~~ | Expose all active memory with source, scope, effect and undo | **shipped — visual refinement deferred to the UI/UX panel** |
| ~~6~~ | Taxonomy and lifecycle cleanup: every feedback control and mechanism is kept, replaced, migrated or removed; none ends with no reader | **shipped — semantic completeness audit remains an ongoing guard** |
| ~~7~~ | Verify calibration-image favourite semantics and preserve the working reference rotation (§1f) | **closed — priority is qualified by `kind`; no behavior change** |
| 8 | **Wrong choice for this outfit** synthesis pilot: derive owner-reviewed advisory conclusions from explicit, versioned reactions | **pilot working — narrow reaction coverage; non-personal destinations remain incomplete** |
| 9 | Select accepted personal/contextual lessons by applicable garment, occasion/activity, season/weather and declared boundary | **shipped for the pilot — routing and owner-facing structured applicability control complete** |
| 10 | Extend owner-authorized learning to positive and `Almost` reactions without reinforcing literal garments **or formulas** | **closed 2026-08-14, not proceeding for formula/silhouette reinforcement — see below for the reasoned Almost/Not-for-me route shipped 2026-08-13, which is not that** |
| 11 | Complete approved destination workflows for garment facts and general product-quality findings | **backend complete for the approved scope — wrong-length renderer/retag review is preserved; accepted synthesis findings and explicitly confirmed no-cost reports enter a provenance-linked queue with durable evidence, resolution destination and undo; review UI is deferred to item 13** |
| 12 | Route learned guidance by relevant garment/context and owner-confirmed constraint-shaped rules into structured, slot-aware eligibility | **shipped for prompt relevance and confirmed firm-rule enforcement; the optional local acknowledgement fast path remains follow-up work** |
| 13 | Convene the UI/UX panel and refine the memory/review surfaces | **panel complete; owner-ratified page restructuring is in progress** |

**Item 12 remaining cost/interaction follow-up.** A live test on 2026-08-11 showed that sending “I
never wear sandals for hiking” inside an existing trip thread spent five provider iterations
re-reading trip and shoe context before storing the instruction. The storage defect is now closed:
the server locally recovers the supported sandals × hiking applicability (and a complete firm-rule
proposal can still be confirmed without another call). A separate optional optimization remains:
pre-route simple explicit prohibitions to a brief local acknowledgement so they can skip the full
stylist/tool loop entirely. That optimization is not required for correct routing and ambiguous
conversation must continue through ordinary chat.

**Formula/silhouette preservation from positive or `Almost` feedback is closed, not merely
paused, as of 2026-08-14.** No route was found that would let the app learn "what worked" without
reinforcing the same literal garments and formulas — every version tried collapsed back into the
sameness the app's own purpose (§ "Product direction: learn the logic, diversify the closet") exists
to prevent. Positive feedback (`signature`, `works`, a reasonless `almost`) remains exactly what it
is today: organizational record, useful as Lookbook inspiration, with no active or planned path into
prompt authority or scoring. This is a decision, not an open question — no formula-preservation
route should be built from positive/reasonless-`almost` evidence without a materially different
proposal that the owner has separately reviewed and accepted, not a resumption of this one.

**Reasoned Almost/Not-for-me route shipped 2026-08-13 — distinct from the paused item.** The item
10 pause is specifically about *preserving a positive outfit's formula/silhouette/mood/context* —
the risk that reinforcing "what worked" quietly reinforces the same literal garments. That risk
does not apply to an `Almost right` or `Not for me` verdict that carries the owner's own written
reason (the existing optional-comment field on both verdicts, `feedback_details.owner_comment` /
`ownerComment`; see the "Bounded first step shipped" note below for where that field comes from).
A reasoned Almost/Not-for-me reaction is evidentially the same shape as a reasoned **Wrong choice
for this outfit** complaint — the owner naming a specific problem — just scoped to the whole
outfit instead of one verified garment, so it now follows the same eligibility rule: a verdict
becomes selectable for the owner-authorized synthesis preview in Style Profile → Review feedback
only when it carries a non-empty owner comment; a reasonless `almost`/`not_me` (or any `signature`/
`works`) stays display-only exactly as before.

Implementation: `lib/feedbackTaxonomy.js` adds `REASONED_OUTFIT_VERDICT_TYPES` (`almost`, `not_me`);
`routes/crud.js`'s `syncFeedbackFromSavedBoard` mirrors the board's `owner_comment` onto the synced
`stylist_feedback` receipt; `lib/activeMemory.js` grants `synthesisEligible: true` and a
`provisional_context` destination only when that comment is present; `lib/feedbackSynthesis.js`
adds a `reasoned_outfit_verdict` evidence kind (reusing `wrong_choice`'s `outfit.otherPieces` +
`ownerReason` shape, so existing applicability validation needs no change) and teaches the
synthesis prompt the new evidence kind's rules — no piece may be named unless the owner's own
comment identifies it. Positive-verdict (`signature`/`works`) formula evidence and reasonless
`almost` legacy-snapshot evidence remain excluded from the synthesis preview's evidence filter,
unchanged.

**Adjacent bug found and fixed in the same pass:** `selectOverallVerdict` (VisualLab.jsx) and
`toggleCanonicalBoardVerdict` (StylistChat.jsx) reused their verdict-toggle logic for the "Add
optional reason"/"Edit reason" action. Because that logic treats "call again on an already-active
verdict" as toggle-off, using "Edit reason" on an already-selected Almost/Not-for-me verdict
silently cleared the verdict entirely instead of just updating its comment — discovered by
reproducing it live in the sandbox. Fixed by keeping the verdict active whenever the call is a
comment commit (`ownerComment !== null`), regardless of prior active state.

**Photo evidence can independently establish a reasoned verdict's cause, 2026-08-14.** The system
prompt previously treated the owner's own words as the *only* authority for a reasoned wrong-choice
or Almost/Not-for-me cause — a rule written before photos were attached (see the image
prompt-size-discipline note above), when there was nothing else to verify a claim against. Now that
a photo is attached, a directly-visible issue (a print/pattern clash, a proportion or silhouette
mismatch, a color with no echo elsewhere in the outfit) is sufficient on its own, even when the
owner's own account is hedged among several guesses or entirely absent ("not sure why, maybe
proportions, maybe shape, maybe contrast"). The model is told to prefer whichever cause a photo
actually confirms over guessing blindly among the owner's hedged possibilities. This does not loosen
the invention guard — a cause still must be either stated by the owner or visible in a photo, never
neither.

**Identifying the garments an evidence item is about is kept separate from what the resulting lesson
is scoped to, 2026-08-14 — a real over-scoping bug found live.** Confirming which specific garments
a photo shows is a *narrower* question than what the transferable lesson should generalize to, and
the two were getting conflated: a lesson about "these two prints clash in a similar tonal range"
was coming back bound to `piece_ids` for exactly those two garments (`scope: 'piece'`), so it would
only ever fire again if one of those two literal pieces was reselected — defeating the entire point
of a transferable lesson (§ "Product direction: learn the logic, diversify the closet"). A
combination-level issue (clash, mismatch, silhouette conflict) that would recur with any
similarly-attributed pieces must generalize into `scope: 'context'` with empty `piece_ids`, exactly
like evidence with no identifiable piece at all; a `piece_id` is bound only when the cause is
inherent to that literal garment and would not transfer (a specific fit problem, a specific fabric
behavior).

**A rejected synthesis draft no longer permanently locks its source feedback out of review,
2026-08-14.** `processedSynthesisFeedbackIds` (`StylistSettings.jsx`) excluded a feedback row from
"Needs your review" the moment it appeared as source for *any* draft, including a rejected one —
so declining a suggestion ("This shouldn't be a lesson") and then editing the underlying reason to
try again had no path back; the only existing recovery, Past Decisions → **Reconsider**, reactivates
the *old* draft text rather than re-running synthesis against the edit. A feedback row's source ids
are now excluded only by drafts that are still standing (`status !== 'rejected'`); once every draft
referencing it is rejected, it reopens for a fresh synthesis attempt.

**Bounded first step shipped:** `Almost right` and `Not for me` can accompany a later styling call
the owner already requested, without triggering critique, regeneration or synthesis. A reasonless
verdict is delivered only when every garment from that exact prior outfit is present in the current
composer roster and any recorded occasion/activity/season also matches. The prompt identifies only
the exact piece-ID set and says not to reproduce that combination unchanged; it explicitly forbids
inferring dislike of the formula, silhouette, colors or individual garments. A preset diagnostic
reason may accompany the reminder as an owner-selected issue. Generated board titles, formula
labels, rationales and garment names are not used as the subject of the verdict. Delivery is capped
at three recent relevant reactions and consumes no additional model call.

Selecting `Almost right` or `Not for me` now offers an optional, free owner-comment field. It
explicitly accepts uncertain ordinary language and stores the comment verbatim with the exact
outfit reaction (`feedback_details.owner_comment` on canonical saved boards; `ownerComment` on an
unsaved generated-board receipt). This applies both where a board appears in Stylist chat and in
the saved-board detail in Visual Lab. An already-selected canonical reaction exposes **Add optional
reason** / **Edit reason**, so reactions created before this field existed do not need to be removed
and recreated. Skipping the comment still saves the verdict. The comment may
accompany the same bounded later styling call described above, but it is labeled as potentially
uncertain and never becomes a formula, garment fact or personal rule.

Applicability normalizes placeholder context (`none`, `unspecified`, and empty values) as absent.
Compound occasion, activity, or season strings are compared as individual normalized terms, so a
reaction stored for `outdoor daytime social, wine festival` can match either bounded request while
remaining silent for an unrelated occasion. All source garments must still be present in the
styling roster before the reaction can be delivered.

The bounded reader is used by both whole-wardrobe and selected-piece composition. Selected-piece
composition no longer receives raw selected/global saved-board styling prose: a rejected board may
not turn one garment from that board into a global rejection merely because the garment is visible
to the composer. Relevant canonical board feedback reaches this flow only through exact
piece-set/context matching, or through a separately accepted applicability-scoped lesson.

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
| version-2 `wrong_item_read` with a verified subject garment | provisional contextual prompt; no score or standing preference |
| older unstructured `wrong_item_read` rows | defensively display/provenance only; the 28 live legacy rows were removed 2026-08-10 after owner confirmation because the old storage value represented more than one UI meaning |
| image-fidelity corrections (`wrong_length`, garment detail, body/identity drift, bad reference) | renderer |
| historical `renderer_calibration` | retired; display/provenance only |
| unknown legacy types | display/provenance only until deliberately classified |

This removes the second authority that converted relational judgments such as “this outfit is too
soft” into permanent weights on every garment the outfit happened to contain. A rendering
correction may still create a visible retag task, and every reaction may retain an audit receipt;
those are follow-up/display effects, not another styling reader. Positive saved-board evidence
continues to reach the scoped styling prompt without literal-pair scoring. Prompt consolidation
for the existing stores is shipped; applicability-based retrieval for accepted synthesized lessons
is item 9.

“Wrong choice for this outfit” (stored historically as `wrong_item_read`) was initially retained as
a −24 garment score during Phase 0, then removed after
the owner clarified the control's meaning: “replace in this outfit” may mean the garment is wrong
for this occasion or activity (for example, high heels for a long museum walk), not that the garment
should be selected less often everywhere. A version-2 receipt becomes provisional prompt evidence.
Older rows without that envelope route display-only because the historical storage value represented
more than one UI meaning and cannot be reconstructed safely. The 28 live legacy rows were removed on
2026-08-10 after the owner confirmed they were ambiguous test history not worth retaining; the route
remains defensive for stale imports. No contextual selection adjustment may be reintroduced without
a complete, explicit evidence contract and the item 4 ranking/diversity verification.

### Phase 1 — provisional garment × outfit evidence

New “Wrong choice for this outfit” writes carry a version-2 `feedbackEvidence` envelope while
preserving the historical database value `wrong_item_read` for compatibility. This is the forward storage
contract: explicit subject garment, outfit/context including available weather, source thread and
card position, user action, optional verbatim owner reason, scope and authority. It does not infer
formula, silhouette, garment role or cause. The existing
version-1 `scopedEvidence` writer and its −6/−12 scorer are retired. Historical rows are retained
only as provenance/display; none is backfilled by inference.

This is also the boundary for the plan item 8 pilot. The application validates identity, provenance,
lifecycle, prompt budget and diversity safeguards. The styling model may derive an advisory lesson
from the evidence, with links back to its sources and an undo/refinement path. No deterministic
fashion ontology is added to the application.

**Owner ruling 2026-08-10 — synthesis is user-authorized, not automatic.** Reactions accumulate as
provisional evidence over days or weeks. They may supply a bounded verbatim reminder inside an
already-requested styling call when the affected garment is actually under consideration, but they
do not become transferable memory on their own. Style Profile will preview the exact compact batch,
model and estimated cost before the owner authorizes one synthesis call. This preview and draft
review flow is shipped behind `/api/feedback-synthesis/*`. Results are reviewable
drafts. General model failures are product defects rather than personal preferences; garment facts
remain proposed corrections until approved. The user never pays an automatic call to explain the
model's own mistake.

A missing optional reason does not erase the click: it remains a narrow instruction not to repeat
that garment blindly in the exact recorded outfit. It is excluded from paid synthesis because the
application has no owner-supplied basis for a broader lesson. Preview is free. The displayed input
figure is a conservative local upper bound over the complete request (instructions, evidence,
structured schema, tool metadata and provider-framing allowance), rather than an estimate based
only on evidence text. The displayed output maximum is the enforced token cap for the authorized call, and provider usage is retained even
when a paid response fails structured parsing. Accepted personal lessons remain visible with their
source reactions and may be owner-edited or retired; retirement removes them from prompt memory.
Accepted non-personal dispositions remain visible provenance without prompt authority. The sandbox
provider returns a canned structured response for this route, so the lifecycle can be exercised
without a paid call.

The review lifecycle is per-card: both lesson text and scope boundary are editable, unchanged
accepted cards have no active save action, and confirmation appears on the card that was saved.
Once evidence has any synthesis result it remains visible as provenance but cannot be selected for
a duplicate paid synthesis call. Empty draft sections are suppressed.

### Existing positive evidence preservation

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
No automatic model call is used to invent missing logic. An older reaction first attempts an exact
piece-set match against structured outfits retained in its source chat. A unique match regains
`outfit_logic`; otherwise it receives a `legacy_outfit_snapshot` containing the original generated
description, context and anonymous garment attributes. That snapshot has no direct transferable
logic authority and is interpreted only inside an explicitly authorized synthesis call.

The chat writer and saved-board/Visual Lab writer use the same evidence builder. Lookbook Generated
Outfits use those same canonical `saved_boards` records and therefore follow this path too. Saved boards retain
the evidence on their canonical payload, and their mirrored `stylist_feedback` receipt is excluded
from the reader so the same reaction cannot acquire duplicate prompt authority. Changing a verdict
updates the evidence; removing it removes the board's transferable authority and archives the
mirrored receipt. Older image-only boards are never silently assigned a formula from their title or
garment list; they retain a lower-confidence synthesis snapshot instead.
Re-synchronizing an existing receipt merges into its payload, preserving renderer fields such as
`length_correction`, piece references and specific reason provenance.

This direct reader still preserves structured logic without a paid call. The synthesis extension
described below is a separate, owner-authorized path that may turn selected observations into an
editable lesson; accepting a synthesis result does not promote the original garments.

### Positive / Almost owner-authorized synthesis pilot — shipped with legacy recovery

`signature`, `works`, and `almost` rows with version-1 `outfit_logic` or a classified
`legacy_outfit_snapshot` can be selected in the
same preview → cost disclosure → explicit authorization → draft review flow as reasoned wrong-choice
evidence. Structured input contains verdict, formula, silhouette, direction, mood and context.
Legacy input contains the verdict, bounded generated description, context and anonymous garment
attributes enriched from current garment metadata when the old board retained piece IDs. Exact
occasion/activity/season/weather phrases in the generated description may bound a reviewable legacy
draft; they remain generated lower-confidence evidence and never become owner-authored rationale.
Neither input contains garment IDs, names, photos or a literal-combination reward. Storage context
labels such as `Whole wardrobe` and anchor-garment names are not treated as occasions.

A positive verdict confirms that the outfit worked; it does not automatically prove a durable
owner preference. Synthesis may propose personal memory only when the selected evidence reveals an
owner-specific, non-obvious choice that would materially change a future styling decision and that
a competent stylist could not safely assume without the reaction. A paraphrase of ordinary outfit
competence—such as “a relaxed top with a structured bottom looks cohesive”—returns **insufficient
evidence**, not a lesson. This deliberately favors an empty result over paid accumulation of banal
memory.

The verdict is the owner's signal; the structured logic remains a generated description the owner
reacted to rather than owner-authored prose. `signature` and `works` may support a bounded
personal/contextual draft. A lone `almost` reaction remains qualified and cannot become a positive
rule without an explicit owner reason saying what worked; it may refine a lesson supported by other
selected positive evidence. Positive synthesis results are mechanically forced to context scope
with empty piece IDs. Accepted lessons therefore guide a matching styling context without boosting
or repeating the source garments.

Acceptance also transfers prompt authority rather than duplicating it: while an accepted personal
lesson is active, its source `outfit_logic` reaction (and matching canonical saved-board logic, when
applicable) remains visible provenance but is omitted from direct prompt memory. Retiring the lesson
restores the source reaction's original contextual reader.

The 2026-08-10 recovery pass classified all 36 active positive Lookbook boards: one already carried
structured logic, three recovered it from a unique exact source-chat outfit, and 32 received legacy
snapshots. It also classified 135 active positive generated-outfit receipts outside that canonical
board set: 75 recovered structured evidence and 60 received legacy snapshots. Zero were skipped.
The backfill is deterministic and makes no model or network call; any interpretation of a legacy
snapshot still requires the owner's normal preview and paid-call authorization.

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
and reaches the garment-truth prompts that already treat this field as authoritative **prompt
guidance**. It does not become a deterministic gate or score unless a separate, structured mapping
exists for that constraint. A
`piece_rule_receipt` row makes the same correction visible and editable in Conversation Memory but
is deliberately display-only: it never becomes a second prompt reader. Editing or retiring that
receipt updates the canonical garment rule in the same database transaction. Global corrections
without `piece_id` retain the existing `owner_rule` path. Structured mappings such as an explicit
occasion exclusion remain a later taxonomy/lifecycle concern; this change does not infer a hard
gate from arbitrary prose.

The receipt is a projection, not a competing writer. If its canonical text was edited or removed
directly on the garment card, a later receipt edit returns `409 Conflict` and asks the client to
refresh instead of guessing which rule to replace or appending a duplicate. Retiring that stale
receipt remains safe and does not remove the independently edited garment rule. Un-archiving a
receipt deliberately restores its stored rule text, without creating a second copy if the rule is
already present.

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

**9 — shipped for the wrong-choice pilot.** Synthesis now returns a structured applicability object
alongside the owner-facing boundary: affected piece IDs plus explicit occasion, activity, season and
weather terms. IDs must occur in the compact source evidence, and every context term must occur as a
complete phrase in the recorded context or owner reason; unsupported model output is discarded.
Boundary prose remains explanation and owner review, never application logic.

The accepted-memory reader filters before applying its newest-eight cap. Piece-only lessons require
an active matching garment. Contextual lessons require every populated dimension to match. A
piece-and-context lesson requires both: its named garment must be actively in play and its context
must match (for example, fall shoes present in a bounded summer roster). This keeps unavailable
garments out of the prompt and prevents a contextual lesson from becoming an unconditional garment
rule. Missing or legacy applicability grants no prompt authority rather than silently becoming global.

“Actively in play” now covers the selected garment, garments in the exact outfit under discussion,
the selected-piece support bench, the whole-wardrobe visual-composer roster, the capsule roster
candidate bench, and the bounded plan/capsule composition pool. It deliberately does not mean every
garment merely present in the complete wardrobe manifest. Capsule and multi-use-case readers match
against any supplied slot context and still return one deduplicated newest-eight block. The two
accepted owner-pilot lessons were backfilled from their already-approved boundaries: piece 260 only
for the elevated-register lesson, and piece 195 in summer for the olive-shoes lesson.

**Lifecycle cleanup 2026-08-09:** `signature` no longer silently writes `is_gold=1`. The hidden
flag had no separate user action and no remaining score, but still forced old rows ahead of newer
feedback in prompt selection and displayed an unexplained “Gold” badge. New reactions write zero,
prompt/API ordering is now recency-based, and the ten historical non-zero values were cleared on
2026-08-09. The column remains only as inert legacy schema.

**4** — every scoring change requires a ranking A/B and a diversity check, including whether
recency suppression still rotates literal garments while preserving the learned formula.

**6 — shipped 2026-08-09.** The dormant generic score channel,
`buildWholeWardrobeFeedbackInfluence`, and its candidate/pair/board consumers were removed.
The label taxonomy now keeps three distinct styling meanings: “Too plain,” “Doesn’t feel like me,”
and “Looks generic or store-styled”; legacy `catalog_drift` is an alias of the last rather than a
fourth meaning. Legacy `wrong_proportions` and `proportion_problem` are aliases of renderer-only
`body_proportions_drift`, not outfit advice. This is an owner ruling, verified against the affected
calibration boards on 2026-08-09; Board 131 was the one stale garment-length exception. Detached
calibration receipts and that stale Board 131 receipt were removed; calibration boards retain the
canonical body-proportion label. The unused
`pairs_well_with` UI, parser, prompt authority, matcher, and +16 score were removed with zero stored
values; **Tried and rejected** remains the explicit garment-pair mechanism. The two live
`— rejected by Yuna` rules were owner-verified as valid garment rules captured through stylist chat,
so they remain authoritative rather than being treated as unexplained historical debris.

### Definition of done for this project

The overall user-feedback project may be called complete only when all of the following are true:

1. Every current feedback action has one documented meaning, canonical store, primary behavioural
   reader and visible undo or retirement path.
2. Provisional **Wrong choice for this outfit** evidence remains narrow, and accepted lessons reach
   only styling requests that match their declared applicability.
3. Positive and reasonless `Almost` feedback stays organizational Lookbook-inspiration record, per
   the 2026-08-14 closure (§4, point 1) — this criterion is satisfied by that decision, not by
   building a synthesis route, since no such route was found that would not give the original
   garments or pairing selection weight. A *reasoned* Almost/Not-for-me verdict is the separate,
   already-eligible diagnostic route under item 8 and is not what this criterion governs.
4. Garment-fact conclusions have an explicit owner-approved route into garment truth, while general
   model mistakes are visibly kept out of personal memory and handed off—or deliberately retained
   as provenance—without pretending they influence styling.
5. Prompt-size and closet-diversity checks demonstrate that the resulting memory remains bounded
   and does not consolidate the same garments or combinations.
6. The UI/UX panel reviews the settled workflows, and the owner reviews its recommendations before
   any visual direction is described as ratified.

Passing the feedback-surface completeness audit proves store/type classification only. Completing
the wrong-choice synthesis lifecycle proves one pilot only. Neither condition, by itself, satisfies
this definition of done.

## 4. Resolved boundaries and deferred decisions

Decisions about the plan. Questions about *what exists* live in the map's `[owner check wanted]`
markers.

1. **Positive board learning is closed, not paused, as of 2026-08-14.** **Works**, **Signature** and
   **Almost** preserve visible and organizational provenance — useful as Lookbook inspiration — but
   they do not enter broad styling prompts, scores or synthesis, and no route to do so is planned.
   Every formula/silhouette/direction/context route tried reinforced the original garments or
   pairing regardless of how the literal-garment reward was removed, contradicting the app's stated
   purpose. It must never promote original garment IDs, pairs, or a garment's general eligibility for
   a capsule; that guardrail now has no route to guard against, by decision rather than by absence of
   a good idea.
2. **No automatic retag threshold is planned for relational feedback.** Repetition does not turn
   an outfit judgment into a garment fact. Existing field-specific wrong-length corrections remain
   the only automatic retag-suggestion path.
3. **Explicit global prohibitions already belong in owner rules.** Standing global rules cover
   instructions such as “no boots in summer” and are supplied to the stylist as hard prompt
   requirements. Garment Rules learned provide piece-scoped prompt guidance, while occasion
   exclusions provide a structured pre-model hard gate. No new “never anywhere” feedback control
   is proposed, and repeated scoped evidence must not be promoted into any of these authorities.
