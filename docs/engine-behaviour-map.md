# Engine behaviour map

**Status:** twelfth pass, 2026-07-26; **amended 2026-08-25** for the shared eligibility API retirement
audit and canonical applicability projection; **amended 2026-08-12** to add the owner-constraint gate (which
shipped with item 12 and had never been recorded here) and the capsule roster prompt cache, the
seventh cache and the only one covering images; **amended 2026-08-14** to trace `fiber_content`'s
two other consumers (`pieceHasWetSensitiveFootwearMaterial`, `capsuleVersatilityScore`'s summer
term) alongside the already-documented hot-weather clause, finding one live gap and one latent one;
**amended 2026-08-25** also to remove two undocumented provider-side prompt-cache writes
(whole-wardrobe generation, critique/feedback `full` and `followup`) that were never read back;
**amended 2026-08-26** to remove an eighth, message-level image-manifest cache on the whole-wardrobe
composer (measured 0 reads against 30-49k written tokens on every sampled call) — see
`docs/deferred-conversational-cache-spec.md`; **amended 2026-08-26** again to add the new
`evaluateLayerPairConstruction` sleeve layer-pair verdict and its `evaluateWearableOutfit` stage;
**amended 2026-08-26** once more for `layerDirectionPromptRule()` and the verified
`OUTFIT_EVALUATOR_GATE_SYSTEM` register/footwear fix.
Companion to `docs/app-surface-map.md`.

Pass 1 covered side effects, thread state, recency memory, retry loops, prompt splices and sweeps.
Pass 2 added scoring, caches, CI ratchets and the import pipeline's model calls. Pass 3 added the
gates — every layer, in order, with measured exclusion counts per context. Pass 4 added the
outfit-level pass after the gate and closed every question the earlier passes had raised. Pass 5
measured the diversity classifiers, traced what repair actually does, and measured
`compatibilityScoreForSelectedItem`. Pass 6 mapped **the image-generation path** — producers,
models, reference payloads, the fallback ladder, and how cost is reported. Pass 7 mapped **the
image prompts themselves**, pass 8 **the tagger prompt** — the upstream call that populates
every column the rest of this document measures — pass 9 **provenance**, which columns are
owner-set versus model-set, pass 10 **the role vocabulary** behind formula-family
classification, and a sweep that found **the singular/plural gap** — a bug class that understates
several of this document's own measurements — and `extract-pieces`, the tagger's weaker sibling.

**Start at [Findings this map produced](#findings-this-map-produced)** — thirty-four things that
were not known before this document existed, including one unreachable code path, a billed render
that reports no cost, a cost gate that under-quotes by 1.6x, two fully-built features with zero
adoption, and a fidelity gap that lines up exactly with the most common recorded render complaint.

Three of those findings **withdraw or reorder recommendations made earlier in this same
document**; each is marked in place. All three were caught the same way: by checking **provenance**
— whether a value was set by the owner or by the tagger, and which prompt version produced it.
There is now a section and a script for exactly that check. **Run it before acting on any column
conflict.**

**A note on method:** an `[unverified]` tag is a debt, not a disclosure. Where a question was
answerable against the read-only wardrobe or by tracing call sites, it was answered here rather
than recorded. What remains tagged is genuinely undecidable without an owner ruling or a billed
call.

## What this is for

The surface map is derived UI-first — routes, tabs, mode gates, dialogs — so it is **structurally
blind to anything that never renders**. Every non-UI behaviour that reached it got there by
accident: one from a screenshot, one from an unrelated grep, one because the owner pointed at a
panel footer.

This map walks the other axis: **writes, prompt splices, retry loops, caches and sweeps.** That is
where the expensive surprises live, because none of it is visible to the owner or to a review panel.

Derived by `scratch/derive_engine_behaviours.js`, with the numbers measured against the real
wardrobe by `measure_scoring_terms.js` (per-term scoring frequencies), `measure_gate_impact.js`
(per-context gate exclusions), `measure_diversity_classifiers.js` (repeat-detection buckets),
`measure_image_path.js` (image-generation inputs) and `measure_open_questions.js` (the findings
below). All are read-only and make no model call — the image script never even constructs an
OpenAI client. The derivation finds *mechanisms*, not intent — a side effect is not automatically wrong. Same tags as the surface map:
**[by design]**, **[known bug → ref]**, **[unverified]**, **[owner check wanted]**.

---

## Side effects — writes that happen as a consequence of something else

Ninety-two write sites exist across the codebase. Most are ordinary CRUD, where a request says
"save this" and the handler saves it. **Seven originate inside `styling-engine/`**, which means
they fire as a side effect of composing or answering, not because anyone asked:

| write | trigger | entry |
|---|---|---|
| `stylist_conversation_state` | every stylist turn | thread state, below |
| `stylist_feedback` (`owner_rule`) | model decides you stated a durable preference | surface map → message-level actions |
| `whole_wardrobe_sessions` INSERT + DELETE | every whole-wardrobe generation | recency memory, below |
| `todos` (`metadata`) | a hard gate excludes a garment for missing data | surface map → Tasks |

Plus, from `routes/crud.js`, a single `PATCH /api/saved-boards/:id` fans out to **three** further
writes — retag-suggestion todos, a feedback mirror, and a structured-reason sync. One user action,
four writes, one of them landing in a different feature.

---

## Server-side thread state

**[by design]** `stylist_conversation_state` stores, per session, the established context and the
current outfit set — occasion, activity, season, mood, mission, the active outfit and its piece
ids. On any follow-up turn (anything not flagged `new_request`) the server **restores it and fills
gaps the client omitted**. Body values always win; state only fills blanks.

Why it exists: a follow-up like *"make it warmer"* carries almost nothing, and the thread would
otherwise lose what it was talking about. The comment is explicit that this exists so the thread
*"survives the client omitting fields."*

**Consequence worth knowing:** the same request can behave differently depending on what the server
remembered from earlier in the session, and nothing in the UI shows what was restored. If a
follow-up produces something unexpected, restored state is a candidate — check
`getStylistConversationState` before assuming the prompt or the gates changed.

> `styling-engine/core.js` (restore), `:3824` (read), `:3839` (write); mirrored in
> `tools.js`.

---

## Recency memory, and its cap

**[by design]** Every whole-wardrobe generation appends a row to `whole_wardrobe_sessions` holding
the piece ids and formula families it used, then immediately **deletes everything outside the
newest 10**. So the memory is a rolling window of the last ten generations, not an unbounded log.

That window is what produces *"Skipping N recently used pieces"* in the composer footer, penalising
recent pieces in scoring and reordering the roster. **Include them again** clears the table
outright.

**[by design]** The trim runs on every save, so the table cannot grow. Worth knowing when reasoning
about why a piece reappeared: eleven generations ago is invisible.

> `styling-engine/rules.js`. Surface counterpart: surface map → composer landing panels.

---

## Retry loops around model calls

Two mechanisms live in `askStylistWithTools`, with a second bounded operating profile for critique
follow-ups. All cost money when they advance to another provider iteration.

**[by design] The tool loop runs up to 10 iterations.** The comment records the reasoning and the
history: the disciplined flow — declare, search, view supports, view layers, propose ×N —
legitimately needs 6–8, and *"the old cap of 7 left no margin for a single corrective bounce and
live turns died with zero cards."* So 10 is a deliberate margin, raised after live failures.

**[by design, 2026-08-18] The disclosure pass enumerates EVERY clause, and narration does not
survive a retry.** Two correctness bugs in the first cut of the above, both found in review:

- `applyFreeformOutputChecks` short-circuits on the first failure — that is its job, since it exists
  to pick the next correction to send. Disclosing from a single call therefore surfaced at most one
  unresolved clause, and a newly-introduced failure that had *not* been retried would be returned
  first and mask a retried one behind it, shipping the reply with nothing said at all. The pass now
  re-runs with each found type suppressed, walking the whole list without duplicating a predicate.
- The narration accumulator spanned the whole loop, so a rejected answer's prose was prepended again
  after the model corrected itself — *"Use piece #999."* followed by *"Correction: use verified piece
  #12"* in one reply, with the clause that caught it already out of budget.
  `supersedeNarrationOnRetry` clears it at the correction boundary; narration written afterwards
  accumulates normally, so this is a boundary rather than a discard.

**[by design, 2026-08-17] A guard that spends its retry and still fails now says so.** Each clause
gets exactly one retry; after that `retriedChecks` suppressed it and the answer was returned
unchanged and unremarked, so a fired-but-unfixed guard left the person holding a flawed answer with
no sign of it. The turn contract now adopts capsule's ending — deliver, and state the unmet thing,
the way a bounded capsule ships as `model_repaired_with_gaps`. Not a second retry: the one-per-clause
budget exists to prevent that spiral. `discloseUnresolvedFreeformChecks` re-runs the same predicates
without recording diagnostics; counted as `unresolvedCheckDisclosures`.

**[by design] Output guards retry up to 6 times, one retry per guard.** `applyFreeformOutputChecks`
inspects the finished answer; if it violates a guard, the model is re-prompted with a correction
message. `retriedChecks` ensures each distinct guard only triggers one retry, so the loop cannot
ping-pong on the same violation.

**[by design] Critique follow-ups reuse the tool loop but not its broad authority.** Their
`allowedToolNames` list contains only `search_wardrobe`, `view_pieces`, and
`get_garment_details`; `stylistToolsForTurn` filters the provider-visible schemas to that set.
Their loop ceiling is 3 rather than 10, and `skipFreeformOutputChecks` disables the six general
freeform correction retries. A question answerable from the board/photo and linked pieces therefore
finishes in one call. A semantically phrased request for another owned garment can search and
continue without any client keyword classifier; verification can consume the third and final call.
The aggregate telemetry reports all iterations and tokens as one critique response.

**[flagged, 2026-08-18] Same-context multi-look requests can use one bounded visual-composer
call.** A model-declared new request for 2–5 fresh
looks sharing one occasion, activity and weather context routes through `generate_outfits` once.
The existing whole-wardrobe visual composer retains photograph-based aesthetic judgment and all
deterministic gates. After it returns, the provider loop ends immediately; deterministic code
writes the short introduction and any validation shortfall, and `applyFreeformOutputChecks` does
not reopen the generic card-count retry. One-look requests,
existing-card revisions and multi-context plans retain their existing paths. The nested composer's
usage is accumulated into the parent freeform diagnostics, so cost comparisons include the largest
call rather than only the outer loop. See `docs/freeform-bounded-execution-spec.md`.

**[corrected after live evidence, 2026-08-18] The bounded tool result is the terminal paid step.**
The first live run generated three valid hiking cards but then made a tool-free full-prefix closing
call, creating 32,745 cache tokens and raising total cost from the $0.3247 baseline to $0.3840.
`askStylistWithTools` now returns deterministic introduction/shortfall prose immediately after the
bounded composer succeeds. `generate_outfits` also resolves a supplied location and date before
roster construction and records whether weather was live, stated, or heuristic.

**[tightened after second live evidence, 2026-08-18] Bounded composition no longer buys a separate
intent declaration, and internal deliberation cannot become card advice.** For an eligible flagged
request, calling `generate_outfits` directly establishes `want:"cards"` and the requested count;
all other composing paths retain the declaration gate. The visual composer still reads recent-piece
memory as a soft diversity signal—repetition remains legal when it is best or necessary. Before
delivery, `sanitizeWholeWardrobeOutfitProse` withholds a reason that exposes rebuilding/checking or
cites IDs outside its final card, adds a visible resolution note, and records the issue in composer
debug without making another provider call. This follows `thread_1787079261414`, whose first card
contained the composer’s discarded alternatives while its actual IDs remained valid.

**[owner ruling after third live run, 2026-08-18] Ordinary “what should I wear?” means two
options.** `thread_1787089704692` searched first and only then invoked the bounded composer for two
looks, producing three paid iterations and about $0.3376. Under the flag, the controller and tool
schema now direct this ordinary request straight to `generate_outfits` with a default of two. An
explicit one/best/pick-one request keeps the targeted one-card path, and an explicit count wins.
The same run leaked recent-memory justification through `watchFor`; local prose integrity now
checks `reason`, `watchFor`, and `stylingInstructions` independently.

**Consequence:** a single user turn can be several model calls — tool iterations plus guard
retries. **Instrumented 2026-07-28:** every tool-loop iteration now accumulates input, output,
cache-read, and cache-creation tokens in the turn's `freeformDiagnostics`; `/ask` returns them in
its existing debug payload and `freeform_generation_runs` persists them. This makes a four-call
capsule turn distinguishable from a nine-call retry spiral without another live reproduction.
Nested calls made by `generate_outfits` are included in the same totals as of 2026-08-18.

**[by design] Capsule “Show another” does not enter either retry loop.** New capsule cards persist
their bounded roster and normalized use-case slot. The explicit expansion action sends that state
to `/api/ai/expand-capsule`, which reloads only those active garments, makes one JSON composition
call, and runs the normal deterministic plan validator. A failed composition returns visibly
after that one call; it is not corrected by another billed call. Legacy capsule threads without
the saved state do not offer this action and must be regenerated once. The response shape is
provider-enforced (forced Anthropic tool / strict OpenAI JSON Schema), not merely requested in
prompt prose; this was hardened after the first live one-call attempt narrated until its token cap.
Each saved slot also carries its distinct core capacity. Exhausted slots suppress the expansion
action, and the endpoint repeats that capacity check before the provider boundary (`providerCalls:
0`), so stale clients cannot purchase a composition the roster cannot possibly supply. **Amended
2026-08-25:** a persisted zero is an authoritative exhausted-slot verdict, not missing data. If a
version-1 card lacks the field, the route derives it through `capsuleOutfitCoreCapacity`; the
former route-local top × bottom + dress fallback was deleted because it overcounted unsupported
dependent tops.

**[by design] Plan validation requirements are disclosed before composition.** Each model workbench
slot carries `submission_requirements` generated from the same structured context the validator
uses: exact count, complete outfit roles, and—only when applicable—winter indoor cardigan,
transition-layer coverage, and recurring shoe range. This does not relax validation; it prevents
paid discovery of deterministic rules through rejection. **Live measurement did not support this
as a sufficient cost control:** the next winter-capsule run grew from 8 to 10 provider iterations,
from 2 to 4 validation failures, and delivered only 5 looks. The requirements prevented some earlier
structural mistakes, so they remain truthful guidance, but the model instead split overlapping slots,
searched outside the curated roster, re-planned after partial success, and invented new slot IDs.

**[by design] Seasonal capsules are explicit and compose atomically after the model calls
`plan_outfit_set`.** The conversational model still owns the turn and decomposes the request into
use-case slots; there is no client or server capsule keyword pre-route. The tool schema requires
`plan_kind` (`trip`, `seasonal_capsule`, or `coordinated_plan`). An unnumbered seasonal capsule gets
the owner-ruled 24-piece working ceiling; an explicit number wins. Capsule-only roster selection,
validation, display capacity, and atomic composition are gated by `plan_kind`, never merely by a
piece budget, so a budgeted trip remains on the ordinary trip workbench.

Once a seasonal capsule has produced its fixed roster and slot workbench, `plan_outfit_set` makes
one provider-enforced structured composition call, validates the whole response once, and returns
accepted cards. Validation failures remain in server logs and numeric diagnostics rather than
being promoted into production `tripPlanLines`; the model's internally chosen target counts are
not user promises, and raw validator coaching is not stylist copy. After success, the outer
conversational model gets one final
prose turn with no tools exposed; it cannot call `submit_plan_outfits`, search broadly, re-plan, or
start generic card-delivery retries. The nested call's usage is added to the existing turn
diagnostics. Trips, work weeks, event sets, and other non-capsule plans retain the ordinary model
workbench path. **Visual/truth correction before the first live test:** the atomic call now
attaches a 448px thumbnail for every fixed-roster piece with a photo and replaces the ordinary
compact workbench line with `buildPieceText`'s full truth, including pairing requirements,
do-not-pair rules, real-wear notes, and learned authoritative rules. Only successfully attached
photos are marked visually seen. This adds image input to the one bounded call, but prevents the
cheaper path from becoming a blind composer; `atomicCapsuleVisualPieces` reports the image count in
the turn debug payload.

There is no remaining numeric-budget fallback in the planner: direct callers, like production,
must pass `planKind:"seasonal_capsule"` to activate capsule roster selection. A `trip` or
`coordinated_plan` may still carry `piece_budget`; that constraint is reported and enforced without
changing the plan's identity.

**[by design] Atomic-capsule final prose never opens a retry loop.** The outer model may naturally
introduce the accepted rotation, but it may not add an unvalidated outfit in prose, cite a garment
ID absent from the accepted cards, or invent an engine/card ceiling. `boundedCapsuleFinalAnswer`
checks those mechanically. On a violation it returns a deterministic accepted-card summary
locally, without another provider call; compliant prose is unchanged. Replacements increment
`capsule_final_fallbacks` in `freeform_generation_runs`.

Seasonal-capsule `reuse:maximize` does not apply the packing-light three-shoe ceiling: every shoe
already selected into the finite capsule roster may appear in its representative rotation. Trips
and other packing-light plans retain the ceiling. The atomic composer also treats each slot's
`best_for` as lived context, not decorative narration; broad occasion eligibility cannot erase a
piece's more specific context truth.

Before capsule quotas rank and select garments, the selector takes the union of pieces admitted by
the existing deterministic gates for at least one requested use-case slot. Failing one slot is
normal; failing every slot means the piece has no capsule job and cannot consume the finite
budget. This is preselection, not a new taste score, and it is a provable no-op when no slots are
provided. “Eligible but not shown in the representative rotation” remains distinct from
“ineligible”: the rotation demonstrates the capsule rather than enumerating every roster piece.

> `styling-engine/provider.js` (guard retries), `:758` (tool loop).
> `routes/ai.js` (`composeCapsulePlanOnce`, `POST /expand-capsule`).

**[by design] Repeated ordinal names do not create artificial capsule coverage slots.**
At the `normalizePlanSlots` boundary, structurally identical slots whose labels are clearly
numbered variants of the same use case (for example, `Casual Indoor Day 1` and `Casual Indoor
Day 2`) merge into one slot and their requested counts are added. The merge is deliberately
conservative: occasion, activity, environment, register, season/weather, location, date,
best-for text, coverage text, and plan note must agree after ordinal normalization. A numbered
pair also remains separate when each entry requests exactly one look, since those may be real
calendar days; the captured artificial split is identifiable because one numbered “day” itself
requests multiple looks. Different dates or conditions likewise remain separate. This prevents displayed looks from
being credited to one bookkeeping variant while another variant falsely reports zero submitted.

> `styling-engine/outfitSetPlanner.js` (`normalizePlanSlots`,
> `mergeEquivalentOrdinalPlanSlots`).

**[by design] Multi-use-case trip requests may still need one material clarification.**
Listing several activities is not proof that the styling brief is complete. Before declaring
cards intent, the conversational model may ask one concise question when the answer changes
occasion coverage, activity safety, formality/register, footwear, or another required garment
role. It should otherwise proceed directly, must not ask users to repeat supplied facts, and
must not ask for weather when a named location can resolve it. This restores the useful Tucson
pattern: nice lunch versus backyard time and trail hike versus nature walk are styling decisions,
not conversational overhead.

> `styling-engine/prompts.js` (`STYLIST_SYSTEM`, coordinated multi-outfit planning).

---

## Prompt splice sites — what actually reaches the model

Where accumulated memory becomes prompt text. Traced 2026-07-26; each was verified by running the
builder against the real wardrobe rather than read from source alone.

- **`getSavedBoardMemory`** → board verdicts *and* specific reasons, in plain language, under
  *"Bias future outfit suggestions toward these successful formulas"* / *"Avoid repeating these
  drift/problem patterns"*. ~3.2 KB on the current wardrobe. Spliced at `core.js→:2737` and
  `routes/ai.js→:1116` (per-garment, flagged *"high-authority outfit memory"*) and
  `:1119` (global, *"should bias ranking"*).
- **Owner rules** → injected as **hard requirements**: *"OWNER RULES — hard requirements, not
  suggestions. Do not construct exceptions or conditional workarounds… If a rule makes a slot
  impossible, disclose the conflict instead of bending the rule."* (`outfitSetPlanner.js`.)
- **Style Constitution layers** → all four reach **eight** prompt templates, not just the image
  prompt: `STYLIST_SYSTEM`, `STYLE_SELECTED_ITEM_SYSTEM`, `GENERATE_OUTFIT_IDEAS_SYSTEM`,
  `OUTFIT_COMPOSER_SYSTEM`, `OUTFIT_BOARD_PLANNER_SYSTEM`, `EDITORIAL_NEW_PIECES_SYSTEM`,
  `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` (twice), plus `editorialImagePrompt`. Cached per user and
  invalidated on any write (`promptRuntime.js`), so an edit takes effect next request.
- **[by design, confirmed still true 2026-07-27 → `docs/board-feedback-desync-spec.md`]** The
  `stylist_feedback` mirror of grouped reasons reaches nothing: `getStylistFeedbackMemory` excludes
  rows whose board already exists in `saved_boards`, which is every row that mirror produces. Not
  a bug — `getSavedBoardMemory` already reads `saved_boards.payload` directly for saved boards, so
  the mirror was never load-bearing. The *display* desync this was originally filed under (chat
  showing stale chip state) is fixed as of that date; this specific sub-finding about the mirror
  itself was deliberately left as-is, not part of that fix.

---

## Sweeps

- **[by design]** `whole_wardrobe_sessions` trimmed to the newest 10 on every write.
- **[by design]** `POST /api/todos/clear-orphaned` deletes `metadata` todos whose linked piece is
  gone or inactive. Only `metadata`; user-created and retag tasks are never auto-deleted.
- **[by design]** Retag-suggestion todos for a board are deleted and rebuilt whenever that board's
  feedback changes — but completed `piece:issue` pairs are collected first and skipped, so a
  suggestion you have handled never returns.

---

## Scoring — the numbers that decide what you see

Mapped 2026-07-26. Weights read from source; **firing frequencies measured against the real
236-piece wardrobe** by `scratch/measure_scoring_terms.js` (read-only, no model call). A weight is
only a claim about what the engine cares about; it matters only if its condition is ever true, and
it only *discriminates* if its condition is sometimes false.

### The scorers, and what each one decides

| scorer | decides | scale |
|---|---|---|
| `planWorkbenchPieceScore` | which ≤40 pieces the model may compose a plan slot from | ~0–265, +100000 for anchors |
| all-slot capsule eligibility union | which pieces may compete for finite capsule roster slots; existing trust/register/weather/activity gates, no score |
| `capsuleVersatilityScore` | which eligible pieces the capsule roster buys inside the piece budget | ~-24 to +50 |
| `capsuleOutfitCoreCapacity` | reports unique gate-valid top+bottom or dress cores across requested capsule use cases; requires eligible shoes and deduplicates cross-slot overlap | count, report-only |
| `allocateCapsuleRepresentativeRotation` | reserves one displayed card per coverable capsule use case, then spends remaining cards on recurring demand without exceeding slot capacity | 0…`min(piece_budget, 12)` cards |
| `compatibilityScoreForSelectedItem` | ranking of partners for one selected garment | unbounded sum of clamped terms |
| `getRelevanceScore` (visual composer roster) | which pieces get an image slot | unbounded sum |
| `scoreWholeWardrobeCandidate` | ranking of whole-wardrobe outfit candidates | unbounded sum |
| ~~`scopedWrongItemInfluenceForRows`~~ | retired 2026-08-10: occasion/activity scoring discarded the actual correction reason | no current score |

The remaining feedback score is deliberately mild and context-bound. Relational outfit feedback
is prompt guidance; it does not mechanically reinforce literal garments or combinations.

### `planWorkbenchPieceScore` — measured

`(outfitSetPlanner.js)`. Terms, with how often each fires on the real wardrobe:

| term | fires | note |
|---|---|---|
| `+100000` anchor piece | n/a | not a weight — a hard pin. Anchors always survive the 40-piece cut |
| `+80` core group (top/bottom/dress/shoes) | 83% | |
| `+30` support group (outerwear/accessory) | 17% | the complement of the above |
| `+50` `recommendation_status = trusted` | **96%** | 226 of 236 pieces are `trusted` |
| `+30` `fit_confidence = high` | 62% | the term with the most real spread |
| `+20` `role_permission` hero or auto | **100%** | 235 of 236 are `auto` |
| `+35` piece tagged with the slot's occasion | 76% | |
| `0…+20` register proximity to the slot floor | 97% resolvable | `20 − |rank distance| × 5` |
| `+5` light fabric | 33% | |

**Measured consequence — tested, not inferred.** Two of the four "quality" terms do not affect the
selection at all. Re-running the selection with each term deleted:

- **Removing the `role_permission` +20 produces a byte-identical top 40.** 235 of 236 pieces are
  `auto`, so the term shifts every score equally and orders nothing. It is inert.
- **Removing the `trusted` +50 changes one piece out of 40.** 226 of 236 are `trusted`.

What actually orders the workbench is category group (+80/+30), slot-occasion tagging (+35),
`fit_confidence` (+30) and register proximity (0–20). This is a property of *this* wardrobe — a
fresh user with mixed `recommendation_status` would see the trusted term do real work — but on the
data the engine actually runs against, two of its weights are decoration. Re-derive with
`scratch/measure_open_questions.js` (Q3).

The 40-piece cut (`PLAN_WORKBENCH_PIECE_LIMIT`) is not purely score-ordered: anchors go in first,
then a per-group coverage sweep (8 slots each for top/bottom/dress/shoes, 4 for outerwear and
accessory), and only then the remaining score order. So a low-scoring bottom can beat a
high-scoring top — coverage outranks score. **[by design]** — otherwise a slot could be handed 40
tops and no bottoms.

### `capsuleVersatilityScore` — measured

`(outfitSetPlanner.js)`. `+12` neutral color, `+4` per occasion tag (capped at 4, so `+16` max),
`+8` solid/no pattern, `+4` trusted, and a summer block (`+10` light, `−24` heavy or
wool/cashmere/fleece/corduroy/tweed/flannel, `+6` linen/cotton/viscose/tencel/gauze).

| term | fires |
|---|---|
| `+12` neutral color | 84% |
| `+8` solid / no pattern | 62% |
| `+16` four or more occasion tags | **8%** |

**Measured consequence — and the reason for it.** The occasion-breadth term, conceptually the most
"capsule" of the three and the largest, fires on 19 of 236 pieces. The cause is not sparse tagging;
it is that **the term's cap sits exactly at the wardrobe's ceiling.** The full distribution is
0 occasions → 3 pieces, 1 → 16, 2 → 89, 3 → **109**, 4 → 19, and nothing above 4. So the score is
`4 × min(4, count)`, and 4 is the most any piece has: the term separates the top 8% from a mass of
109 pieces sitting one step below the cap, and can never reward more range than the tagging
vocabulary produces. Not a broken weight — a weight calibrated against a wider tagging range than
exists. On this wardrobe the roster's versatility ranking is carried by color and pattern. This
matters to the open capsule-cap work in `docs/stylist-bugfix-spec.md`, which is a
`selectCapsuleRoster` question, and this is the score that roster sorts on.

The source comment is explicit that this score **has no idea what registers the plan needs**
(`outfitSetPlanner.js`) — a roster can score high on "versatility" while reading uniformly
`elevated` and then failing every `casual` slot's ceiling. That is a live-tested failure from
2026-07-14, and is what `strictestRegisterCeilingRank` / `capsuleDemandReserve` exist to correct.

### The keyword-scored surfaces

`scoreWholeWardrobeCandidate` (`rules.js`) and `getRelevanceScore`
(`rules.js`) score largely by **regex over a concatenated text blob** of the pieces, not over
structured tags: `-24` "soft stack risk" when three soft words appear, `-28` catalog/librarian
drift, `-20` wide+wide, `-24` generic light-neutral, `+8` artistic texture/structure, and so on.
`bohoSignalForPiece` is the same shape with fractional weights.

This is **[by design] but frozen**: the text-matching ratchet (below) records 119 such sites in
`rules.js` and 58 in `attributes.js` as *debt with a baseline*, and fails the build if the count
rises. The existing sites are grandfathered; new ones are not permitted without an explicit
`// ratchet-allow:` comment. So the right reading of a keyword weight here is "legacy mechanism,
deliberately capped, not a pattern to copy" — the standing owner rule is to write new rules against
structured tags (season, formality, occasion), not against material or name words.

**Consequence worth knowing:** because these terms match a *blob*, a word in one piece's `notes`
can trigger a penalty attributed to the whole outfit. The `-60` occasion-incompatibility term and
the `-18` support-only term are the structured exceptions.

### Feedback authority

The former generic `feedbackWeight` table and its pair, board, roster and whole-outfit consumers
have been removed. Outfit reactions are classified for prompt memory as positive, qualified, or
negative evidence; they do not become literal garment weights. Image-fidelity feedback reaches
renderer memory only. Version-2 wrong-choice evidence is provisional: it may be delivered verbatim
and in bounded form inside an already-requested styling call when its subject garment is considered,
but it does not alter candidate or roster scores.

Reasonless evidence carries only the exact-outfit reminder and is not synthesis-eligible. Older
unstructured rows sharing the `wrong_item_read` storage value are display-only because their UI
meaning cannot be recovered safely. The 28 live legacy rows were removed on 2026-08-10 after owner
confirmation; display-only routing remains as stale-import protection. Broader interpretation happens only through an owner-authorized
synthesis call. The call creates reviewable `feedback_synthesis_drafts`, not prompt authority. The
free preview's output estimate is the enforced output-token cap, and paid failures retain any
provider usage returned before parsing failed. `getAcceptedFeedbackSynthesisMemory`
reads at most eight owner-accepted `personal_contextual_lesson` drafts into styling prompts, with
per-line length caps. These accepted personal lessons remain visible, editable, and retireable;
retirement removes them from prompt memory. Accepted `general_styling_failure` and
`garment_fact_correction` drafts remain visible review/provenance records: they neither become owner
preferences nor silently edit garment truth.

### The two sub-scorers, measured

`formalityFitForPiece` and `weatherFitForPiece` are summed into four different scorers, which made
them the largest unmeasured terms in the system. They turn out to be **switches, not dials**:

| sub-scorer | context | pieces with a non-zero score | range |
|---|---|---|---|
| `formalityFitForPiece` | dressy request | **229 / 236** | −18 … +10 |
| | walkable request | 10 / 236 | −18 … +8 |
| | no register intent | **0 / 236** | — |
| `weatherFitForPiece` | hot | 177 / 236 | −32 … +18 |
| | cold | 171 / 236 | −20 … +18 |
| | mild | **0 / 236** | — |

Both return exactly zero for every piece when their trigger is absent — `formalityFitForPiece`
short-circuits on `!intent.active`, and `weatherFitForPiece` has no adjustments outside hot/cold.
When the trigger *is* present they touch nearly the whole wardrobe. So the same outfit request
scored with and without a stated register is not "slightly differently weighted"; it is scored by a
materially different function. The walkable case is the exception — it applies to shoes only, so 10
pieces.

This is why a request's phrasing changes results so much: saying "something dressy" switches a
±18-per-piece term on across 229 pieces, and `resolveFormalityIntent` derives that intent from
**regex over the user's own words** (`rules.js`) — one of the few keyword paths that is about
user intent rather than garment text, and correctly `ratchet-allow`ed as such.

### `compatibilityScoreForSelectedItem` — measured

The historical feedback-pair sampling below is retired with the generic scorer. The live personal
pair terms are explicit garment metadata only:

| term | fires |
|---|---|
| `+16` confirmed pairing note | **0** |
| `−40` rejected pairing note | **0** |
| contextual garment reaction | no deterministic score; bounded provisional prompt evidence only |

Saved-board and garment favourites remain organization/display metadata and prompt evidence where
explicitly described; they do not mechanically promote literal pieces or pairs.

### Recency, again — as a score

`getRecentWholeWardrobeSessionInfluence` (`rules.js`) converts the 10-row session memory into
a *penalty*: `18 × decay` per piece and `30 × decay` per formula family, where
`decay = max(0.2, 1 − sessionIndex × 0.16)` times an occasion factor. So the most recent session
penalises a piece by 18 and a formula by 30; by the sixth session back the decay floor (0.2) has
been reached, at 3.6 and 6. That penalty is subtracted directly in `getRelevanceScore` and is also
the **first tie-breaker** in `comparePieces`. Surface counterpart: *"Skipping N recently used
pieces"* in the composer footer.

---

## Caches

Seven cache systems now outlive a request. The original derivation script reported 47 `new Map()`
hits; most are local lookups inside one function and are not caches at all. PR 188 added the
outfit-evaluation result cache and a paired in-flight registry; the seventh is the capsule roster
prompt cache described below, which is provider-side rather than a `Map` and so appears in no
`new Map()` sweep:

| cache | scope | key | eviction |
|---|---|---|---|
| `promptsByUser` (`promptRuntime.js`) | server, per user | user id | none — rebuilt on profile/constitution write via `refreshPrompts` |
| `wardrobeThumbCache` (`provider.js`) | server, module-wide | `userId:cacheKey:maxPx` | oldest entry dropped past 300 |
| `geocodeCache` / `weatherCache` (`weather.js`) | server, module-wide | location / `dates|lat,lon` | 3-hour TTL |
| `threadCache` (`src/utils/chatThreadCache.js`) | browser tab | thread id | none — lives until reload |
| `relationshipCache` (`src/utils/garmentRelationships.js`) | browser tab | piece id | none, but `loadGarmentRelationships(id, {refresh:true})` bypasses it |
| `outfitEvaluationResultCache` (`core.js`) | server, module-wide | SHA-256 of cache version + provider/model + mode/token cap + complete system/messages (including images and garment/memory context) | 10-minute TTL; LRU insertion order; max 50 |
| capsule roster prompt cache (`routes/ai.js`, `capsuleRosterSelectionContent`) | Anthropic-side, per exact content prefix | the literal `content[0]` text plus every thumbnail before the last `cache_control` | provider TTL; invalidated by any byte change in the prefix — see below |

`outfitEvaluationInFlight` uses the same key but is a coalescing registry rather than a retained
cache: concurrent identical evaluations await one promise, report `providerCalls: 0` to the
followers, and delete the entry when that request settles. Exact-result hits also report zero
provider calls and zero estimated cost. Tests disable the result cache by default unless
`WARDROBE_TEST_EVALUATION_CACHE=true`, keeping endpoint contracts isolated.

**[by design]** The thumbnail cache is user-id-prefixed as defense-in-depth — the comment is
explicit that no leak was observed, but the cache is module-wide across concurrent requests and
should not rely on upload-filename entropy for tenant scoping.

**[by design]** The prompt cache is invalidated on write, so a constitution edit takes effect on the
next request, not the next restart.

**Two more provider-side prompt caches, found and removed 2026-08-25.** Like the capsule roster
cache below, these are `cache_control` on a system string rather than a `Map`, so they never showed
up in the `new Map()` sweep that produced the table above. `generateWholeWardrobeOutfitsVisualInternal`
and `evaluateOutfitThroughSharedPipeline` (both `full` and `followup`) were requesting the same 1h
ephemeral `cache_control` the freeform stylist prompt uses (`PROMPT_CACHE_BREAKPOINT`,
`freeform-prompt-cache-levers.md`), but neither write was ever read back: a one-shot generation
thread that never gets a follow-up has no second turn to amortize it against, and critique's `full`
and `followup` variants are different system text, so they never shared a prefix with each other
either. Both writes were removed rather than documented as a cache, since there was no reuse to
describe — see `docs/deferred-conversational-cache-spec.md` for the full trace and the follow-up
routing (`message-lifecycle.md` dispatch branches 10–12) that made the writes provably wasted.

**A third, message-level cache found and removed 2026-08-26, while measuring the two above.**
`generateWholeWardrobeOutfitsVisualInternal` also put a plain 5-minute `cache_control` directly on
the last candidate thumbnail in the *message* content (not the system string, so `grep
PROMPT_CACHE_BREAKPOINT` also misses this one — same blind spot as the capsule roster cache, a
different mechanism than the two paragraphs above). Shared by three callers: standalone
whole-wardrobe generation, `/generate-saved-outfit-variants`, and freeform's `generate_outfits` tool.
Traced: the function makes exactly one provider call with no in-call retry, so unlike the capsule
roster cache's genuine attempt-1/attempt-2 relationship, this one could only ever be read by a
*separate, later* call landing within 5 minutes with an identical roster — and measured attribution
(new `providerImageManifestCache*` fields, `normalizeAiUsage`'s TTL-based creation split) found zero
such reads across every real call sampled, historical or freshly run. Removed for the same reason as
the two above — see `docs/deferred-conversational-cache-spec.md` Part 2.

### Which garments get a photo — fixed 2026-08-12

Image generation and outfit critique attach at most **five** garment references (`pieces.slice(0, 5)`
at three call sites in `core.js`). Until 2026-08-12 the five were chosen by **array order**, so which
garment lost its photo was arbitrary: on a real 8-garment board, a black herringbone pointed heel and
a floral cutout mule were described in prose while a solid coral maxi dress kept its reference. That
inverts this project's founding visual-grounding lesson — the pieces hardest to describe in words are
exactly the ones that must be shown.

`visuallyPrioritizedPieces` (`attributes.js`) now orders them: photographed **complex** pieces first
(the same hero/colour-accent/loud-or-medium-pattern/textured-fabric test `pieceVisualDetailPolicy`
already used to pick 800px vs 448px), then photographed plain ones, then anything with no usable
photo — those return `[]` from `garmentReferenceImages` and previously consumed a slot while
contributing nothing. Stable within each tier.

**[unverified]** whether five is still the right cap; it was not measured, only re-ordered.
**20.5%** of saved boards carry more than five pieces, though the largest counts are multi-outfit
collages rather than single looks.

**[by design]** The photo-preserving collage fallback (`createPhotoPreservingCollageImage`) still
uses array order. It is a rendered artifact the owner looks at, not a model input, so "hardest to
describe" is the wrong ranking there.

### The capsule roster prompt cache — measured 2026-08-12

**A seventh cache, and the only one that caches *images*.** It does not use
`PROMPT_CACHE_BREAKPOINT` (that marker splits a *system* prompt), so a grep for it misses this
entirely. `capsuleRosterSelectionContent` (`routes/ai.js`) instead puts `cache_control` directly on
content blocks:

```
content[0]  season + size + palette + OWNER RULES + accepted lessons + use cases + candidates
            └─ cache_control: ephemeral
imageParts  one text label + one thumbnail per bench piece
            └─ cache_control: ephemeral on the last one
[volatile]  repair text, appended only on attempt 2 — after both breakpoints
```

**Measured against the real wardrobe**, 40-piece bench, 39 with photos (18 hi-res 800px, 21 low
448px), using the production `capsuleRosterSelectionUserText` and `pieceVisualDetailPolicy`.
Regenerate with:

```bash
node scratch/measure_capsule_prompt_cache.js
```

Read-only, no provider call, safe against a live database.

| block | tokens |
|---|---|
| `content[0]` catalog text | 11,344 |
| thumbnails | 21,000 |
| **cacheable prefix** | **32,344** |
| owner rules + accepted lessons, at the **front** of that prefix | **162 (0.50%)** |

Text estimated at ~4 chars/token; images at Anthropic's `(w × h) / 750` — both local estimates, not
provider-reported usage, so treat them as an order-of-magnitude split rather than a bill. Re-run the
script if the hi-res/low mix changes: the image half dominates, and `pieceVisualDetailPolicy`
decides it per piece.

**[by design] The 162 tokens now vary per request, and that is accepted.** Since the owner-guidance
work, `getOwnerRuleNotes` filters by request context, so the rules block differs between two capsule
requests whose occasions/seasons differ. Because it sits at the *front* of the prefix, any such
difference invalidates all 32,344 tokens behind it, thumbnails included — a 0.5% cause with a 100%
effect.

**The invariant this cache was built for still holds.** Its stated purpose is intra-run: attempt 1
writes the cache, the attempt-2 repair reads it instead of re-paying for every thumbnail.
`ownerRules` is computed once per run upstream (`outfitSetPlanner.js` passes the same array into
both `chooseRoster` calls), so relevance filtering cannot change it between attempts. What
weakened is only opportunistic *cross-request* reuse, which was never the stated goal and already
required an identical bench.

**[by design] Not fixed, and the reason is a measured tradeoff.** The only way to restore
cross-request caching is to move the rules block behind the images, into the volatile tail — which
puts it roughly 21k tokens deep. The block is positioned early *deliberately*; the comment above it
cites this codebase's own measurement that stored rules lose out from tail position (spec 25/26,
`workbenchInstructions`). Trading a measured correctness failure for an unmeasured cache saving is
the wrong side of that bargain. Revisit only with a measurement showing the rules still bind from
the tail.

**The two browser caches never expire — and it does not matter, because both consumers
revalidate.** Traced: `StylistChat.jsx` and `PieceDetail.jsx` use the same idiom,
`load…(id, { refresh: Boolean(cached) })` — if a cached copy exists they refetch anyway and use the
cache only for the first paint. So neither cache can serve stale data beyond one frame, and there
is no cross-tab staleness bug here. The pattern is worth copying for any future cache: paint from
cache, revalidate unconditionally.

Two further per-piece caches are `WeakMap`s keyed on the piece object (`pieceTextBlobCache`,
`bohoSignalCache`) — they memoize within a request and are collected with the objects.

---

## CI ratchets — what future code is not allowed to do

Both run on every `npm test`, before the test suite: `check_style_claims.js && check_text_matching_ratchet.js && node --test`. **A failure here fails the build before a single test runs**, which
is why they are invisible until they bite.

**The text-matching ratchet** (`scratch/check_text_matching_ratchet.js`) counts keyword-matching
sites — `textIncludesAny(`, and `.includes(` / `.test(` against a named list of text-ish variables
(`blob`, `text`, `name`, `reads_as`, `notes`, `silhouette`, `piece.name`, …) — across
`styling-engine/` and `routes/`, and compares each file against
`scratch/ratchet_baseline.json`. Current state: **238 total, exactly at baseline** —
`rules.js` 119, `attributes.js` 58, `core.js` 61, everything else 0. A file going *over* fails the
build; going under just prints `DROPPED`. A line may be exempted with a trailing
`// ratchet-allow:` comment (32 in use, mostly in `tools.js` and `outfitSetPlanner.js`), which is
counted separately and never trips the baseline.

**The style-claims guard** (`scratch/check_style_claims.js`) does three things:

1. Fails on style-claim phrases (`best color`, `favorite color`, `signature color`, personalized
   "not your style" phrasings) anywhere in `styling-engine/` or `routes/` — the ratified
   constitution text is the one sanctioned home, so `constitutionSeed.js` is skipped whole and
   `prompts.js`'s `DEFAULT_CONSTITUTION` block is stripped before scanning.
2. Fails on a `prohibited_pieces` / `prohibited_footwear` entry naming dresses, skirts, blouses,
   sandals or mules unless the line carries a `// ratified:` comment — the categories the owner
   ruled may not be banned by an agent's own judgement.
3. Freezes the occasion-profile id list, so a new profile cannot be added silently.

**Consequence:** these two encode owner rulings as build failures rather than review comments. If a
change here is genuinely wanted, the baseline or allow-list is edited deliberately, with the
ruling attached — not routed around.

---

## The import pipeline's own model calls

Six model call sites, five of them cheap-tier and one full-tier. All spend is recorded per session
into `import_sessions.spent_usd` via `addSpend`, from **actual usage**, not estimates.

| stage | model | batching | max tokens |
|---|---|---|---|
| classification | cheap (`claude-haiku-4-5` by default) | 10 images per call | 1200 |
| garment detection | cheap | **one call per image** | 1600 |
| crop verification | cheap | 10 crops per sheet | 600 |
| crop relocation | cheap | one call per failed crop | 300 |
| clustering | cheap | 12 per sheet | 1500 |
| merge matching | cheap | one call per cluster | 400 |
| **tagging** | **full stylist model** | **one call per new-piece cluster** | schema-bound |

The cheap tier is overridable via `WARDROBE_IMPORT_CHEAP_MODEL`.

**[by design] Tagging is the only gated step.** `POST /sessions/:id/tag` refuses to run without
`{approve: true}`, and `GET /sessions/:id/preflight` exists to price it first — estimating
6000 input / 1400 output tokens per new-piece cluster at the full stylist model, and reporting
spend so far. Nothing else in the pipeline asks.

**[by design] `askCheapJson` has two recovery layers, one of which costs money.** A chatty response
is salvaged locally (free); a genuine mid-JSON truncation triggers **one retry at 3× the token
cap** (paid). So a detection call can cost up to 4× its nominal cap.

**Consequence worth knowing:** detection and relocation are per-image and per-failed-crop, so import
cost scales with photo count *and* with how badly the cheap detector performs — a batch of hard
photos silently costs more, and pass 2 of crop verification is a second per-garment call on top.
Crop verification is designed to fail open: a failed verify sheet leaves its crops trusted rather
than blocking the pipeline.

---

## The gates — what is excluded before the model chooses anything

Mapped 2026-07-26. Structure read from source; **exclusion counts measured against the real
236-piece wardrobe** by `scratch/measure_gate_impact.js`, which calls the real gate function with no
model call.

### One function, three composition paths

`wholeWardrobePieceTrustDecision` in `rules.js` is the hard gate. Pool consumers should call
`evaluateAutomaticUsePiecePool` in `eligibility.js`, which executes that verdict for every piece and
returns typed findings plus eligible/excluded projections. `evaluateAutomaticUsePiecePoolCore`
owns the dependency-neutral pool mechanics used by that public adapter and by recovery inside
`rules.js`. As of Slice 7 (2026-08-25), the legacy
`filterWholeWardrobePiecesForGeneration` response adapter is deleted; tracked tests and diagnostics
consume the shared pool result directly. `scoreWholeWardrobeCandidate` uses the piece verdict as a `-18`
support-only *penalty*, not a block. The hard gate itself returns
`{allowed, supportOnly, reasons}`; `allowed` is simply `reasons.length === 0`.

**[by design]** A user-requested **anchor changes disposition, not evidence**. The shared pool still
records the hard-gate findings and marks the underlying verdict, while anchor policy keeps the
explicit user premise eligible. Freeform proposal validation does not surface those findings as
errors for the anchor. Verification (retrieval + layer photos) still applies.

### The layers, in the order they run

1. **Evening bottoms.** For any evening occasion, a bottom is blocked unless it is *explicitly*
   tagged `evening` — and blocked regardless if it reads as utility/cargo. **[by design]**, and by
   far the bluntest rule in the stack.
2. **User occasion exclusions.** `piece.occasion_exclusions` matching the request. This is the
   owner's own per-piece veto and is the intended route for personal rules — `occasions.js` is
   frozen (`FROZEN, Yuna 2026-06-12: no new profiles`) precisely so that new rules land here
   instead.
   Plan slots retain their public broad occasion, but an unambiguous home-only label/use case now
   supplies `home` specifically to the owner-exclusion lookup. Other occasion gates still receive
   the public occasion, so an AI-generated `home: low` confidence remains advisory. Mixed
   **home + errands** slots deliberately remain broad because one veto cannot safely describe both uses.
3. **Owner constraints** (`ownerConstraintApplies`, `lib/ownerConstraints.js`), read by
   `wholeWardrobePieceTrustDecision` before roster assembly, slot replacement, complementary
   ranking and each capsule-plan slot. **[added 2026-08-12 — this layer was missing from every
   earlier pass of this document; it shipped with item 12 and was never recorded here.]** A row is
   an owner-confirmed standing prohibition that one garment's `occasion_exclusions` cannot express:
   a selector of verified piece IDs, wardrobe category, structured material or **footwear type**,
   crossed with one context dimension (occasion, activity, season or weather). Missing context is a
   no-op — the gate never fires on an unspecified dimension. A match hard-blocks the garment and
   emits the constraint ID and dimension in the suppression reason; retiring the row is the undo.
   Season comparison runs through `resolveCalendarSeason` (`lib/seasonContext.js`), so `warm` → summer, `autumn` → fall, and the
   composer's unresolved default `current season` resolves against `requestContext.currentDate`
   rather than always "now". **[unverified]** no exclusion counts have been measured for this layer;
   the counts elsewhere in this section predate it.
4. **Auto-use trust** (`autoStylingTrustDecision`, `src/utils/wardrobeAiContext.js`), with a
   dead escape hatch — see *Exploration mode* below.
   `recommendation_status` of `avoid` / `do_not_recommend` / `needs_fit_review` / `experimental`,
   `role_permission` of `never_auto` / `only_when_requested`, `fit_confidence: low`, the AI
   profile's own `auto_use_trust`, low occasion confidence without an explicit tag, an
   `occasion_permissions` list that omits the request, and a phrase scan of notes for
   *"too small"*, *"do not auto"*, *"testing only"* and similar. Most of these relax under
   `explorationMode: 'aggressive'`.
5. **Weather physics.** Hot: insulating fiber, or heavy weight, or (medium+ weight *and* insulating
   coverage / warm neckline / long sleeves). Cold: shorts, lightweight linen bottoms, high bareness.
   Credible wet exposure excludes footwear whose structured material is canvas or suede. Explicit
   rain, drizzle, wet ground, puddles or mud qualifies; a foggy coastal outdoor walk also qualifies
   from the combined environment and activity. Fog alone and dry beach walking do not.
   The exemptions here are all scar tissue and are commented as such — open-front layers
   (cardigans, kimonos) are exempt from the sleeve/coverage clauses (ratified 2026-07-12 after
   summer layering requests kept dying); shoes and accessories are never "insulating"; the
   weight qualifier exists because a light silk maxi was flagged purely for being full-length.
6. **Profile rules and the register ceiling** (`profileRuleFit`, `rules.js`). Prohibited
   materials → footwear-comfort enums → **register ceiling** → prohibited footwear → prohibited
   pieces → `unknown` → discouraged. **This function returns on the FIRST prohibition it finds**,
   so a piece has exactly one profile reason no matter how many it violates.

**Consequence:** layers 1–5 *push* reasons onto a list, layer 6 returns one. A blocked piece can
therefore carry several reasons, and the counts below sum to more than the blocked total. It also
means reason counts are **order-dependent** — under a walking activity, twelve shoes exit at the
footwear-comfort check and never reach the register check, so the register count drops by ten
without the underlying population changing.

### Measured: how much each context excludes

Fraction of the 236-piece wardrobe blocked, with the dominant reasons:

| context | blocked | dominant reasons |
|---|---|---|
| casual, mild | **113 (48%)** | register ceiling 108 (91 elevated + 17 dressy) |
| casual, hot | 146 (62%) | register 108, hot-weather insulating 66 |
| casual, cold | 148 (63%) | register 108, bare/sleeveless 58, shorts 11 |
| city smart casual, mild | **49 (21%)** | low occasion confidence 22, dressy over elevated ceiling 17 |
| evening, mild | 158 (67%) | low occasion confidence 96, prohibited evening bottom 51 |
| evening, cold | 176 (75%) | + bare/sleeveless 47 |
| outdoor daytime social, hot | 89 (38%) | hot-weather insulating 66, dressy over ceiling 17 |
| casual + walking | 114 (48%) | register 94, mid-heel unsuitable 12 |
| casual + hiking | 123 (52%) | register 90, mid-heel 12, medium-support 9 |
| home loungewear, mild | **197 (83%)** | low occasion confidence 169, register 108 |

Across every context, the same ~13 pieces are blocked by trust reasons (8 `needs fit review`, 3
engine-notes suppression, 2 low fit confidence) — that floor is context-independent.

### The register ceiling is the dominant layer

The wardrobe is tagged `everyday` 117, `elevated` 92, `dressy` 17, untagged 7. The `casual`
occasion profile's `register_ceiling` is `everyday`. `registerCeilingVerdict` exempts accessories
and passes untagged pieces, so:

> **Every one of the 91 non-accessory `elevated` pieces, and all 17 `dressy` pieces, is blocked
> from every `casual` request.** That is 108 of 236 — the single largest exclusion in the system,
> and it fires on the app's most common occasion.

This is not a defect. The register ceiling was rolled out deliberately (spec 8 made it
unconditional across all three composition paths, closing a gate-parity bug class), and blocking
dressy pieces from a coffee run is the behaviour it was built for.

**But the wardrobe's own data disagrees with itself, and the size of the disagreement is
measurable.** Of those 91 elevated pieces, **52 are also tagged with the `casual` occasion** — by
the owner or the tagger. Those 52 are pieces the `occasions` column says are casual-appropriate and
the `formality` column causes to be blocked from every casual request. The two columns are not
reconciled anywhere, and the gate reads only `formality`.

So the open item is not "is the ceiling right" — it is a **column conflict affecting 52 garments**.

> **Provenance settles most of it — see *The tagger prompt → owner corrections*.** Of those 52,
> **49 have owner-corrected `formality`** and only **5 have owner-corrected `occasions`**. The
> conflict is an owner ruling against an auto-tag, so the gate reading `formality` is reading the
> more authoritative column, and `elevated` has not drifted — it is the wardrobe's most curated
> field (202 of 236 pieces corrected by hand). An earlier draft of this document suggested letting
> an explicit `casual` occasion tag override the ceiling; that would let tagger output override the
> owner on 47 garments, and is withdrawn. The remaining question is the **5 pieces the owner tagged
> both ways** — a five-row list, not a policy decision.
>
> **And the ceiling itself is ratified — do not reopen it.**
> `docs/occasion_profiles_ratification.md` → *Ratified Amendment: Register Ceilings For Roster
> Gating*, **ratified by Yuna 2026-07-05**, sets `casual → everyday` explicitly, with this note
> recorded at the time: *"`casual -> everyday` is the largest behavior change. It would make
> park-friend, coffee, errands, and low-key social rosters reject `elevated` and `dressy`
> pieces."* The 108-piece exclusion measured above is the **documented, intended consequence of a
> ratified decision**, not a discovery. An earlier draft of this section offered "raise `casual`'s
> ceiling to `elevated`" as an open taste call; **that is withdrawn.** The only live question is
> whether a given piece's `formality` value is right — a tagging question, not a ceiling question.

This is upstream of the capsule-cap work, and is the mechanism behind the live-tested 2026-07-14
failure recorded at
`outfitSetPlanner.js` (a roster of `elevated` pieces producing zero outfits for casual
slots). Escalating a slot's `register` lifts the ceiling — that is what the field is for.

`city_smart_casual`, whose ceiling is `elevated`, blocks only 21%. The gap between those two
numbers is the whole story of this layer.

### Occasion confidence, the other big lever

For `evening_social` and `home_loungewear` the dominant reason is not a rule but
*"AI profile low confidence for X"* — 96 and 169 pieces respectively. These are auto-tagger
confidence judgements, not owner rulings, and an explicit occasion tag on the piece overrides them
(`explicitOccasionMatches` short-circuits the check).

**This is judgement, not missing data — checked.** All 96 and all 169 have a populated
`occasion_confidence` map; **zero** were blocked because the map was absent. The tagger looked at
each piece and returned `low`. The composition is what you would expect from a real wardrobe:
`home` blocks 72 tops, 53 bottoms and 19 outerwear — the tagger is saying ordinary clothes are not
loungewear, which is defensible. `evening` blocks 60 tops and 18 outerwear. The lever here is the
per-piece occasion tag, which overrides the tagger; there is nothing to fix in the gate.

### Gate-field coverage — and the todos side effect

`missingGateFields` (`attributes.js`) lists the columns the gate needs: `formality`,
`fabric_weight`, `fiber_content`, `occasions`, plus `heel_height` and `walk_support` on shoes. When
a hard gate excludes a garment for missing data, a `metadata` todo is written (surface map → Tasks;
side-effects table above).

Measured: **39 of 236 pieces are missing at least one gate field** — 35 `fiber_content`, 7
`formality`, 3 `occasions`. Shoes are fully tagged for `heel_height` and `walk_support`.

**The `fiber_content` gap is real in structure and empty in practice — checked.**
`pieceHasInsulatingFiber` reads `fiber_content` and nothing else, so it returns false for all 35,
and the hot-weather insulating-fiber clause blocks **none** of them — even though 32 are
medium/heavy weight, exactly the population the clause exists to catch. But scanning those 35 for
warm-fiber words in name, notes or `fabric_category` finds **one**: a pair of tweed heels, which is
a shoe (categorically exempt from the insulating check) and is blocked by the register ceiling
anyway. So no garment currently escapes hot-weather gating through this hole. It is a latent gap —
worth knowing before someone adds an untagged wool sweater — not a live defect, and the heavy-weight
and coverage clauses catch most of what the fiber clause would.

**`fiber_content` has two other real consumers, checked the same way — one is live, one is not.**
`fiber_content` is not single-purpose: `pieceHasWetSensitiveFootwearMaterial` (`attributes.js`)
also reads it, gating footwear out of wet-exposure requests when `'suede'` is present (or
`fabric_category = 'canvas'`); `capsuleVersatilityScore` (`outfitSetPlanner.js`) reads it inside
its summer-only term, penalizing `wool`/`cashmere`/`fleece` and rewarding `linen`/`cotton`/etc. via
the same `fiber_content`-or-`fabric_category` check. Both settled by
`scratch/measure_open_questions.js` (Q7, Q8):

- **The wet-exposure clause is a live miss, not a latent one.** Of the 27 no-`fiber_content` shoes,
  1 is still caught via `fabric_category = 'canvas'`, but **2 are missed entirely**: piece 199
  ("burgundy suede cork wedge sandals") and piece 200 ("taupe suede ankle boots") both name `suede`
  in their own title, have empty `fiber_content`, and `fabric_category = 'other'` — so
  `pieceHasWetSensitiveFootwearMaterial` returns false and neither is excluded from a wet-exposure
  request today. (Piece 200 is the same taupe suede boots already flagged in the capsule-bench work
  as under-selected with "nothing structural" explaining why — this is the structural reason.)
- **The capsule summer term is latent, like the hot-weather clause.** 0 of the 35 no-`fiber_content`
  pieces would score differently in `capsuleVersatilityScore`'s summer term if `fiber_content` were
  populated — every one of them either already gets the same answer through `fabric_category`, or
  doesn't match either list. Also: this term is additive scoring, not a hard gate, so even a real
  miss here would be a ranking effect, not a visibility one — unlike the wet-exposure clause, which
  hides a piece from the roster outright.

(Measured against the live wardrobe at 242 active pieces, 6 more than this section's 236-piece
baseline — the population count above may drift slightly on a fresh run; re-run
`scratch/measure_open_questions.js` rather than trusting these counts indefinitely.)

### Exploration mode — a relaxation that can never fire

**[known bug — string mismatch, unfiled]** `autoStylingTrustDecision` computes
`const aggressive = explorationMode === 'aggressive'` and uses it to disable **six** separate trust
clauses: `needs_fit_review`, `experimental`, `fit_confidence: low`, the AI profile's
`needs_fit_review` and `experimental`, low occasion confidence, and the engine-notes phrase scan.

**Nothing in the codebase ever passes `'aggressive'`.** Every call site is traced:
`tools.js` and `outfitSetPlanner.js` hard-code `'moderate'`; `rules.js` defaults to
`'moderate'`; the parameter default is `'moderate'`; `routes/ai.js` forwards a request value.
The only non-default value produced anywhere is **`'adventurous'`** (`routes/ai.js`, the
saved-outfit *adjacent* variant mode) — a different string, which fails the equality check and
relaxes nothing. No test sets it either.

The two strings have separate origins: `'aggressive'` arrived with the original
`wardrobeAiContext.js` (`c307a9b`, 2026-05-31); `'adventurous'` arrived later with the saved-outfit
variants feature (`0d3481f`, PR #36). Nobody reconciled them. So the "adjacent / explore further
afield" mode a user selects does **not** loosen any trust gate — it changes only the prompt text.

Two clean resolutions: align the strings so `'adventurous'` relaxes the clauses, or delete the
`aggressive` branch as dead. Which one depends on whether adjacent mode is *meant* to surface
experimental and needs-fit-review pieces — that is a product call, but the code question is
settled: today it does not, and no path can make it.

### What is not in this stack

Structural validity (`evaluateOutfitStructure` with its `describeOutfitStructureGap` message
projection, plus typed `evaluateOutfitRoles` — needs shoes, needs primary top+bottom or a dress, and
a layer role needs its primary) is a *separate* check on the assembled outfit, and
it runs **before** the piece gate in `propose_outfit`. Diversity, dedup and repair run after — see
the next section. None of those are piece-eligibility questions, which is why they are not here.

**[validation-ownership consolidation, first foundation migration, 2026-08-24] Category structure
now has one typed owner.** `evaluateOutfitStructure` returns ordered error findings for missing or
multiple shoes, multiple bottoms/dresses, dress-plus-bottom conflicts, and incomplete separates,
with category-count evidence. `describeOutfitStructureGap` returns only its primary message. The
former boolean adapter preserved the earlier contract during migration and was retired after its
last consumer moved. This removes duplicate category counting. A top over a dress
remains legal. Role intent, layer/base mechanics, ownership/context checks, plan slot/set rules, and
advisor disposition remain separate validators.

**[validation-ownership consolidation, second consumer migration, 2026-08-24] Whole-wardrobe and
submitted-plan gates now read typed structure findings directly.** `locallyGateWholeWardrobeOutfits`
maps any structural error to its existing `not a complete wardrobe outfit` rejection before
ownership/context/advisor policy. `validateSubmittedPlanOutfits` uses the primary finding's existing
message before its dependency, slot, repetition, and set checks. The former plan-side boolean-plus-
diagnosis double evaluation is gone. Structural acceptance, rejection wording, advisor behavior,
and model-call sequence are unchanged.

**[validation-ownership consolidation, third consumer migration, 2026-08-24] Route-level visual
composition no longer reimplements or repeatedly recomputes category structure.** Selected-piece
resolution filters on `evaluateOutfitStructure(...).valid`. Whole visual composition caches one
typed result per normalized model outfit and reuses it for structural diagnostics, clash-review
eligibility, saved-variant accounting, and final filtering. Its public diagnostic vocabulary is a
projection from finding codes, so existing strings and generation-run counts remain stable. Visual
critic policy, local fallback, saved-Main handling, and accepted-card behavior are unchanged.

**[validation-ownership consolidation, explicit-role migration, 2026-08-24] Freeform role
structure now has a typed owner outside the tool executor.** `evaluateOutfitRoles` returns ordered
error findings and role-count evidence for explicit role validity/cardinality, footwear and core
completeness, dress/primary conflicts, orphan layers, and role/category mismatches.
`propose_outfit` and slot-swap validation project the same messages and
retain the same reject/retry behavior. The former tool-local prose validator and its unused
`missingGaps` parameter are gone. This does not settle pair mechanics, direction, sight, plan
slot/set findings, or advisor disposition.

**[validation-ownership consolidation, layer direction, 2026-08-24] Ordinary over/under direction
is now a shared typed verdict.** `evaluateLayerDirections` resolves explicit overlay, underlayer,
dependent-garment, role, and outerwear evidence. Missing direction is `unknown`, requires sight of
both garments, and may then be accepted as a provisional one-turn model judgment; it is not saved
as garment truth. Freeform diagnostics distinguish blocked unknown direction from visually allowed
unknown direction, so the allowance can be evaluated and removed centrally. Submitted plans and
direction-participating slot swaps consume the same verdict. The former tee/tank keyword veto was
removed; required coverage mechanics remain a separate hard contract.

---

## The shape of a turn, and how many round-trips it takes

**Added 2026-08-17.**

**[by design] `tool_sequence` records which tools ran in which provider iteration.** Iterations are
`;`-separated, the calls within one `,`-separated, so a turn's structure is a query rather than an
inference. Before it, `freeform_generation_runs` recorded that a turn took 6 iterations and made 7
tool calls and never which call sat where — the shape had to be read out of the model's own prose.
Same provenance gap that hid a composer regression from 1,192 passing tests.

**[by design] `search_wardrobe` accepts several categories in one call.** Three searches differing
only by category cost three round-trips, and each one re-reads the entire conversation *and* the
cached prefix — the `thread_1786994644421` A/B established that prefix size is multiplied by
iteration count, so a round-trip is not cheap merely because the prompt is cached. Verified: one
batched call returns exactly what three separate calls did, 117 pieces, same tokens.

Stated structurally rather than as prompt guidance asking the model to batch, because prompt-only
instruction has failed every time it has been tried here (capsule criterion 8; freeform specs 3, 7
and 11).

**[by design] The image budget is per CATEGORY, not per call.** `SEARCH_WARDROBE_VISUAL_CAP` applied
per call, so collapsing three searches into one would have handed the model a third of the photos it
used to get. Visual grounding is a founding principle of this app and starving it to save a
round-trip would be the wrong trade; the cap now ranks within each category. Measured identical:
shoes 4, tops 16, bottoms 16, both ways.

**[flagged, 2026-08-18] The small execution router removes the full-prefix controller from a narrow
same-context batch.** An eligible fresh request is
classified from only its sentence, date and timezone. A `bounded_multi` decision invokes the
existing visual composer directly; all other decisions or failures fall through to the general
tool loop. The router cannot inspect or rank garments. Photographs, garment truth, memory, weather
physics and Style Constitution guidance remain in the nested composition call. Its decision and
cost are observable through `execution_router_calls`, aggregate provider usage, and
`tool_sequence`. The flag-off path is unchanged. See `routeFreeformExecutionProfile`
(`styling-engine/provider.js`) and `/ask` (`routes/ai.js`).

**[flagged, 2026-08-19] Compact text profiles avoid the wardrobe-wide controller when no
composition is requested.** The small router also has
three conservative outcomes: explain verified current cards, answer from verified structured
garment facts, or give wardrobe-independent general styling education. Each outcome gets one
bounded no-tools answer call and returns before `buildStylistConversationPayload`; general advice
receives no wardrobe/thread context at all. Requests to compose, revise, render, discover pieces,
or resolve ambiguous identity remain on the full stylist path. Usage is included in the parent
diagnostics and `tool_sequence` names the selected compact profile.

**[flagged, 2026-08-19] Full-stylist prose history is bounded independently from structured
state.** Bounded history is unconditional:
`boundFreeformConversationHistory` retains the newest four exchanges, at most eight messages,
12,000 total characters and 3,500 per message. It runs after duplicate-current-question removal.
Current cards, established context, resolved weather, feedback memory and the wardrobe manifest
are assembled separately and are not evicted. Oversized messages retain their beginning and end
around an omission marker; there is no paid summary call. `freeform_generation_runs` records
received/included message counts and removed characters without copying conversation text.

**[amended 2026-08-19] Tool-local contracts have one prompt owner.**
`freeformToolRoutingInstruction` replaces the volatile controller's duplicate mode and schema prose.
`buildStylistConversationDirective` now supplies the one mode directive; individual `STYLIST_TOOLS`
descriptions own local eligibility, arguments and mechanical output; the controller retains only
cross-tool selection boundaries. The stable cached prefix is unchanged. Ownership and deferred
stable-prefix questions are recorded in `docs/freeform-prompt-ownership.md`.

**[flagged, 2026-08-19] Anthropic can defer the long-tail tool catalog.**
`anthropicDeferredToolPlan` activates only for a supported Claude model, Anthropic provider, the
`WARDROBE_FREEFORM_DEFERRED_TOOLS=true` flag and at least ten currently available tools. It leaves
intent, search, view, correction storage and proposal eager; nine long-tail schemas load through
Anthropic BM25 tool search. OpenAI and unsupported/small catalogs are no-ops. Compatibility 400s
retry once with the original full catalog. Run diagnostics count mode iterations, server searches,
fallbacks and initially hidden schema characters. Full rationale and acceptance matrix:
`docs/freeform-deferred-tools-spec.md`.

**[owner-ratified correction, 2026-08-18] Live numeric weather outranks router season language.**
When bounded freeform has resolved a live forecast, `generateWholeWardrobeOutfitsVisualInternal`
uses that profile directly for hard hot/cold gates. The season string remains in the visual brief
but cannot reclassify 78°F as hot merely because it contains `summer`. Without a live profile, the
existing text/calendar heuristic is unchanged. This was measured on `thread_1787096409835` after
`summer` incorrectly removed 59 insulating pieces plus 20 fiber matches from a 78°F roster.

**[follow-up correction, 2026-08-19] Resolved weather physics is thread state, not a display
string.** `serializeWeatherProfile` stores source, numeric high/low, and hot/cold/extreme booleans
in `stylist_conversation_state.weather_profile`; `restoreWeatherProfile` supplies them to the next
tool context. Explicit weather in the new turn clears/supersedes the stored profile. Otherwise a
composite label containing `summer` cannot re-hot a live 78°F/56°F profile.

**[direct Visual Composer correction, 2026-08-19] "Current season" means current local weather.**
The direct `/generate-wardrobe-outfits-visual` route now reads the saved home location and resolves
today's live numeric forecast before roster gates run. An explicit seasonal or extreme-weather
selection remains an authored hypothetical and bypasses the live lookup, preserving the brief.
See `resolveStylingContext` (`styling-engine/stylingContext.js`) and
`generateWholeWardrobeOutfitsVisualInternal` (`routes/ai.js`).

**[forecast-failure correction, 2026-08-19] A named place is never converted from unknown weather
to guessed heat.** `getCurrentWeatherProfile` and `getWeatherProfileForPlan` return a neutral,
observable `weatherSource:"unavailable"` profile when a real location lookup fails. Hard hot/cold
gates remain off; shared context resolution preserves that neutral result instead of re-parsing
router season text. Bounded freeform removes the calendar label from the composer weather
brief and visibly says the forecast could not be verified. Requests without a location still use
the existing text/calendar heuristic. This follows `thread_1787098654251`, where failed Berkeley
weather became `summer; hot weather` and wrongly removed 79 weather-related candidates.

**[structured weather contract, 2026-08-30] Weather for `plan_outfit_set` is now typed at the tool
boundary, never parsed from prose.** `docs/future-trip-weather-estimate-spec.md` §1-6 implemented:
the model translates language into typed `user_weather` (only when the current message explicitly
states weather — a numeric range or a qualitative `hot|cold|mild` band, never both) and
`weather_estimate` (the model's own conservative seasonal numeric guess, used only as a fallback)
tool arguments; `styling-engine/weather.js` owns validation (`validateUserWeather`/
`validateWeatherEstimate`), field-level resolution (`resolveWeatherContext`: each of
temperature/precipitation/wind resolves independently as `stated_user` → `live` →
`model_estimate` → `unavailable`, so a stated condition and a live temperature coexist rather than
one erasing the other), and the async orchestrator every call resolves through before retrieval
(`resolveWeatherForRequest`). `classifyTemperatureRange` reuses the same HOT_F/COLD_F thresholds as
live weather and supports non-exclusive classification, so a genuinely wide range (a model estimate
or a user-stated range spanning both extremes) registers as both hot and cold instead of silently
collapsing to neutral via the single-day exclusivity `weatherProfileFromContext`'s own text branch
still applies elsewhere. A named destination/date with no resolved temperature returns a typed
`weather_context_required` stop before any roster/pendingPlan is built — checked via each slot's
actual `resolvedWeatherContext.status`, and via `.some()` so a mixed plan (one resolved slot, one
not) still stops rather than proceeding partially gated. Cold-transit footwear
(`wholeWardrobePieceTrustDecision`, `styling-engine/rules.js`) now hard-rejects open-toe/sandal
shoes (structured `shoe_type`/`toe_shape` fields, never garment names) whenever
`weatherProfile.isCold` or the indoor-transit-preserved `weatherProfile.transitIsCold` is true.
Corrected root-cause note (`thread_1788147143882`, a Vienna VA October trip): the live incident was
never a `propose_outfit`-vs-`plan_outfit_set` routing failure or a missing gate — both providers
called `plan_outfit_set` correctly, and the hard cold-bareness gate already existed. The actual
defect was that arbitrary model prose in `slot.weather` (e.g. "crisp outdoor walking weather")
became authoritative physical weather ahead of the live forecast, and a failed future-date forecast
read as neutral with no structured fallback. `environment` (indoor/outdoor/beach_coastal) is now
the sole model-facing setting field; the free-text `weather` field is removed from the tool schema
entirely.

**[single-outfit parity, 2026-08-31] `search_wardrobe`/`propose_outfit`/`generate_outfits` resolve
weather through the same structured contract as `plan_outfit_set`.** `stylingContext.js`'s shared
`resolveWeather` — used by every direct/non-chat generation caller too — gains
`resolveNamedDestinationWeather`, slotted exactly where the legacy live-weather branch used to sit:
after the existing prose-`statedWeather` and pre-resolved-`weatherProfile`-object precedence tiers
(which still win outright when present — an already-settled resolution must never be silently
re-resolved), gated by the same `isCurrentSeason` check the legacy branch used (an explicit
hypothetical season still bypasses live resolution). Triggers on a fresh `location`+`date` or a bare
structured `user_weather`/`weather_estimate` with no destination at all; reuses the injectable
`weatherResolver` seam (not a separate fetch mechanism) so existing test mocks intercept it
transparently. `toolContext.resolvedWeatherContext` caches the result — a matching second call
(`propose_outfit` after `search_wardrobe`, no location/date of its own) reuses the cache instead of
re-resolving. Deliberately does not fall back to `toolContext.location` (the route-level
home-location default) as a trigger, so an ordinary "what should I wear today" request is
unaffected. `search_wardrobe`'s free-text `weather` field is removed from its schema; `propose_outfit`
keeps its unrelated `season:'indoor'` convention as-is (a separate, pre-existing mechanism, not
weather prose about temperature).

**[typed unresolved stop, 2026-08-31]** `search_wardrobe`, `propose_outfit`, and `generate_outfits`
now stop with the same typed `weather_context_required` response `plan_outfit_set` already returns
(`weatherContextRequiredStop` in `styling-engine/tools.js`, called right after
`resolveToolStylingContext` in each of the three tools, before any retrieval/scoring). It only fires
when `resolvedWeatherContext.location` is non-empty — a genuine named destination/date that stayed
unresolved — never for a bare structured claim with no place attached (e.g. "it's raining" with no
destination), which legitimately carries `status: 'unavailable'` on temperature alone while still
resolving precipitation/wind, and must proceed as an ordinary local turn rather than stop. The
system prompt's Destination & Weather Clarification bullet now teaches this for all three tools, not
just `plan_outfit_set`.

**[§7 continuity persistence, 2026-08-31]** Every accepted card now carries `weatherUsed` (the
truthful display label, `truthfulWeatherLabel` in `outfitSetPlanner.js`, exported for reuse) and a
serialized `resolvedWeatherContext` alongside it — attached in `validateSubmittedPlanOutfits` for
plan/capsule cards (from the slot's own already-resolved `weatherProfile`), and via a shared
`weatherCardFields(stylingContext)` helper in `tools.js` for `propose_outfit` and `generate_outfits`.
No-op when nothing was structurally resolved (an ordinary at-home heuristic call). Both current-set
projections read these per-outfit fields as `weather_used`/`resolved_weather_context`:
`boundedConversationStateFromToolContext` (`routes/ai.js`, the router's direct-routing path) and the
`outfitSetFromBody` closure inside `buildStylistConversationPayload` (`styling-engine/core.js`, the
full-stylist tool-loop path) — this is per-outfit specifically because a multi-slot trip can have
different weather per slot, which the single shared `weather_profile`/`weatherProfile` field already
on both projections cannot represent. `freeform_generation_runs.weather_source` now reads
`resolvedWeatherContext.overallSource` (mixed-aware — e.g. user-stated rain + live temperature) when
the structured resolver ran, falling back to the old plain per-field source otherwise;
`plan_outfit_set` sets it from its own per-slot precheck (the shared source when every slot agrees,
`'mixed'` when slots differ).

**[§9 item 1, provider-schema parity, 2026-08-31]** Anthropic reads `STYLIST_TOOLS`' `input_schema`
with no projection of its own; Gemini (`toGeminiFunctionDeclaration`) and the newly-extracted OpenAI
equivalent (`toOpenAiFunctionTool`, `styling-engine/provider.js` — previously an inline map at the
`callOpenAiTurn` call site, now the same shape as the pre-existing Gemini helper) both wrap that
exact `input_schema` object unchanged rather than holding an independent copy, so `user_weather`/
`weather_estimate` parity across all three providers is structural, not merely tested — a test in
`test/gemini_tool_loop_adapter.test.js` asserts both the object-reference reuse and that every one
of the four composition tools (plus `plan_outfit_set`'s own per-slot schema) actually carries both
fields.

**[§9 checklist audit, 2026-08-31]** Cross-referenced all 31 acceptance items against the test suite.
Items 2-12, 14, 18, 20-22, 24, 27, 29 were already covered by earlier phases (`test/weather.test.js`,
`test/plan_outfit_set.test.js`, `test/freeform_observability.test.js`). This pass closed the remaining
gaps: item 13 (a different-location slot does not inherit the plan's `weather_estimate` —
`normalizePlanSlots`' `locationMatchesPlan`/`inheritsPlanWeather` binding, not previously tested
directly), item 15/17 (a single test feeding every prose phrase from the spec's own anti-regression
list — dates, counts, Celsius, styling adjectives — through both `requestText` and malformed
`user_weather`/`weather_estimate` shapes, proving none of it can create or alter resolved weather),
item 16 (an undeclared `weather` HTTP arg is silently ignored by `search_wardrobe`, proven end to
end via `executeTool`), item 19 (a submitted card with no outerwear/heavy main piece is rejected once
`weather_estimate` establishes cold — `validateSlotOutfitConstraints`'s pre-existing "no warm layer"
gate, now proven against the new resolver), item 23 (a shared coat repeats across two cold-weather
slots under `reuse:'maximize'` with no `no_repeat` set — the default, unrestricted case), item 25 (the
exact Vienna 65/45 request reaches `plan_outfit_set` once and `submit_plan_outfits` once, zero
retries, via `replayStylistToolScript`), item 26 (the same provider-free replay stands in for
per-provider fixtures: `executeTool` has zero `AI_PROVIDER`-conditional branching anywhere in the
weather-resolution/gating path — confirmed by grep — so behavior cannot diverge by provider; only the
wire-format adapters differ, and those are proven identical elsewhere), and item 28 (a mismatched
location on a second `resolveToolStylingContext` call re-resolves rather than reusing the cache — the
negative case of item 27's existing test). Item 30 (a follow-up states the exact range and calls it a
seasonal estimate) is covered at the data layer only — the persisted `weatherUsed` label already reads
`"65°F high / 45°F low — seasonal estimate, not a live forecast"` verbatim (spec §7's persistence
work) — the model's actual follow-up prose is live behavior an offline test cannot exercise. Item 31
is the full suite staying green, checked after every commit in this arc.

**Not yet done:** §10's live paid Vienna VA verification — requires printing estimated cost and the
owner's explicit confirmation before running, per the spec's own rule; not something to do
unilaterally.

**[context-ownership consolidation, 2026-08-24] Selected-piece and whole-wardrobe generation now
resolve the same evidence through one authority.** `resolveStylingContext` owns per-field source
precedence, normalization, occasion/activity profile construction, comfort constraints, and weather
selection. Explicit stated weather outranks physical inference; current-season requests refresh
live weather when a location exists; saved snapshots are used when that lookup is unavailable; and
explicit hypothetical seasons bypass live weather. Declared activity remains separate from
request-inferred activity so inference can guide the model without activating a hard footwear gate.
Both generators expose resolved values, provenance, and conflicts under response debug
`stylingContext`.

**[context-ownership consolidation completed, 2026-08-25] Freeform and plan slots now use the same
field resolver.** `resolveToolStylingContext` passes explicit request, action artifact, established
thread state, and inference to `resolveStylingContext`; it no longer owns a second stated/live
weather branch. `buildPlanSlotWorkbench` resolves each slot through the shared owner before roster
selection and preserves the result/provenance on the workbench and pending slot. Explicit supplied
weather profiles, including indoor-transit profiles, are authoritative evidence. Saved artifacts
and persistent thread state remain separate sources rather than overwriting one another.

**[calendar-season projection correction, 2026-08-25] A resolved request season and its executable
season are distinct fields.** `resolveStylingContext` preserves `season: "current season"` for live
weather and display behavior while deriving `calendarSeason` from the authoritative request date.
`resolveCalendarSeason` is also the shared defensive projection for direct/freeform/plan prompt
memory, hard owner constraints and historical exact-outfit reactions. This closes the live
`thread_1787651275782` gap where accepted summer guidance was omitted before the model call because
one reader compared the placeholder literally. It does not add a suede taste rule, alter ranking,
or turn a prompt preference into a hard eligibility gate.

**[applicability projection completed, 2026-08-25] Calendar Season and physical weather now cross
flow boundaries as one canonical executable shape.** `projectStylingApplicabilityContext` in
`stylingContext.js` derives Calendar Season against the authoritative request date and normalizes
hot, cold, rainy, and wet-exposure flags from the resolved Weather Profile. Direct selected/whole,
freeform search/propose/swap/generation, plan workbenches, and capsule feedback readers consume
that projection. Plan slots preserve Requested Season separately from `statedWeather`, so an
indoor summer slot remains summer for seasonal applicability without treating `indoor` as a
calendar season. Composite bounded labels such as `current season; mild weather` are parsed only
at the resolver boundary; they are not a new semantic source. The hard gate receives the same
Calendar Season and request date, so it cannot independently reinterpret the turn.

**[eligibility-ownership consolidation, 2026-08-24] Primary visual composition and selected-piece
recovery now consume one finite-pool verdict.** `evaluateVisualComposerPiecePool` classifies every
roster exclusion as validity, presentation, or capacity. The photo roster remains bounded, while
the recovery projection may reuse accessories, no-photo pieces, and cap cuts but cannot reintroduce
a weather, register, activity, footwear, metadata, or other validity exclusion. Selected local
fallback, absolute fallback, and comfort-footwear repair all use that recovery projection. A
shoe-anchor repair evaluates the full wardrobe through the same authority before choosing a
substitute; it does not reopen raw `allPieces`.

**[eligibility-ownership consolidation, second consumer migration, 2026-08-24] Freeform search,
proposal validation, and slot swaps now consume one hard-gate pool result.**
`evaluateAutomaticUsePiecePool` preserves the hard gate's underlying findings and labels owner
authority explicitly. `search_wardrobe` continues its deliberate retrieval disposition: owner
vetoes remain fixed while non-owner profile findings proceed to the existing rule-fit annotation
and `intent:"explain"` path. `propose_outfit` and `suggest_slot_swaps` keep their stricter
dispositions, and an explicit anchor remains usable without erasing the evidence that ordinary
automatic selection would have blocked it. No scoring, profile rule, or broadening order changed.

**[eligibility-ownership consolidation, third consumer migration, 2026-08-24] Selected support
ranking and whole-wardrobe suppression now consume the same automatic-use pool.**
`selectAutomaticUseCandidatesForOutfitGeneration` evaluates supporting pieces once, then injects
those decisions into the existing compatibility score and category-quota strategy; selected-piece
generation and concept-board planning no longer independently invoke the hard gate. Whole-wardrobe
generation also consumes `evaluateAutomaticUsePiecePool` directly. Its former hot-weather
outerwear behavior is an explicit capacity policy (keep the three lightest, deterministic by ID),
and a saved Main may bypass that disposition without erasing the hard-gate or capacity finding.
At this point the legacy whole-filter function still served plan, capsule, and recovery consumers.

**[eligibility-ownership consolidation, fourth consumer migration, 2026-08-24] Coordinated plans
and capsules now consume the same automatic-use pool before applying their own strategy.**
`evaluatePlannerAutomaticUsePool` carries each slot's resolved weather, activity, register ceiling,
and `ownerExclusionOccasion` into `evaluateAutomaticUsePiecePool`. It also declares the existing
three-piece hot-weather outerwear cap as capacity policy. `slotGateEligiblePieces`,
`elevatedCapsuleDemands`, and `buildPlanSlotWorkbench` consume the resulting eligible projection;
the workbench's suppression diagnostics retain `underlyingExcludedPieces`. Plan ranking and caps,
capsule slot union, quota/roster selection, structural coverage, and representative rotation do not
move into eligibility and do not change behavior. The legacy whole-filter adapter remains only in
recovery logic in `rules.js`.

**[eligibility-ownership consolidation, fifth consumer migration, 2026-08-24] Footwear recovery
now consumes the same automatic-use pool mechanics, completing the active-caller migration.**
`repairWholeWardrobeOutfit` uses `evaluateAutomaticUsePiecePoolCore` with
`wholeWardrobePieceTrustDecision` before its existing required-footwear match and relevance sort.
The core was extracted below `eligibility.js` to avoid a circular dependency; it owns owner-
constraint loading, typed findings, effective/underlying dispositions, and capacity policy, while
the public `evaluateAutomaticUsePiecePool` remains the domain entry point for every caller outside
`rules.js`. The legacy whole-filter export delegates to this core and remains only for contract
tests. Hiking activation, eligible shoe supply, scoring, tie-breaking, and the single-swap behavior
are unchanged.

**[candidate-set ownership, 2026-08-25] Hard caps preserve executable outfit supply before they
preserve category abundance.** `buildCoveredCandidateSet` is the shared bounded-set owner for
selected support candidates, visual photo rosters, coordinated-plan workbenches, and capsule model
benches. Caller-specific ranking remains intact, but a cap may replace a lower-priority duplicate
category piece with the ranked top/bottom/shoe or dress/shoe path needed to leave composition
possible. A `needs_base` anchor or path also reserves a base whose shared construction verdict is
not known incompatible. Already-complete selections keep their exact order. Missing wardrobe
supply and insufficient hard capacity are distinct report codes. Direct visual flows make no
composer call and return no fallback card when the final gated roster is incomplete; plan slots
continue only for the coverable portion and disclose each unfilled slot. Search remains retrieval
and does not inherit the composition-coverage requirement.

**[recovery ownership, 2026-08-25] A fallback or mutation cannot weaken the primary hard
contract.** `recovery.js` owns four mechanics: `validatedSubstitute`, `validatedComplete`,
`validatedFallback`, and `discloseRecoveryShortfall`. The first three require a validator callback
and run it immediately against each exact mutated/replacement result; rejected attempts remain
attempt evidence and are never returned as recovered. Selected local/absolute fallbacks inject
anchor, structure, and required-base checks; whole backfill injects
`locallyGateWholeWardrobeOutfits`; comfort and required-footwear swaps inject category structure;
plan/capsule mutations inject `validateSubmittedPlanOutfits` or `validateCapsuleRoster`; freeform
correction supersession injects explicit-role and required-base checks. Candidate ordering, whether
unknown visual evidence may proceed, retry/provider budgets, and visible disposition remain local
policy. Exhaustion uses one structured `recovery_shortfall` report while existing human-facing
wording stays flow-specific.

**[projection and result ownership, 2026-08-25] One finding has one model-visible definition and
one delivered disposition.** `outfitValidation.js` now projects its category-core, explicit-role,
and typed-finding contracts into whole-wardrobe, freeform proposal, coordinated-plan, and capsule
expansion prompts. The flows retain their distinct strategies and output schemas. After validation,
`outfitResult.js` gives selected, whole, freeform proposal, plan/capsule, expansion, and repair
cards a versioned `result` containing exactly one of `accepted`, `annotated`, `repairable`, or
`rejected`, plus findings, annotations, provenance, and an optional repair capability. Existing
top-level fields remain as UI compatibility aliases, so this is an additive no-op for ranking,
provider sequence, persistence, and current card actions.

**[visual-review authority correction, 2026-08-24] Unversioned tagger prose cannot buy or decide a
visual clash review.** `wholeWardrobeOutfitVisualReviewFindings` now requires two concrete structured
pattern signals. The mere presence of `garment_intelligence.do_not_pair_rules` is a no-op for review
routing: these notes came from multiple tagger generations, were not normalized or continuously
corrected, and remain composer guidance rather than executable authority. This follows
`thread_1787621859177`, where two already-satisfied legacy notes sent an ordinary emerald top,
beige tailored shorts, and brown leather shoes to a paid critic; unusual photo lighting then caused
a false mauve-shoe rejection.

**[forecast-failure integration correction, 2026-08-19] Neutral failure is global and disclosure
must match it.** `resolveSlotWeather` now labels failed named-place plan forecasts as unavailable
with unknown temperature, including indoor-transit slots. It no longer emits “winter (estimated)”
while applying neutral gates. The neutral policy remains deliberate: a calendar season cannot
reliably substitute for the climate of an unresolved place.

**[bounded-state correction, 2026-08-19] The direct router writes cross-turn authority before its
early response.** `/ask` calls `saveStylistConversationState` with
`boundedConversationStateFromToolContext`: normalized `established` context plus the generated
`current_outfit_set`. Every frontend `/ask` branch supplies its actual thread ID. The router still
does not build the large controller payload merely to persist state.

**[bounded-router correction, 2026-08-19] Social company does not define event register, and
location does not imply activity.** The compact router now maps a generic restaurant dinner,
including dinner with friends, to city smart casual; explicit dinner dates, nights out and dressy
dinners map to evening; only explicitly casual/low-key events map to casual. Walking is emitted only
when the request actually includes walking rather than merely naming a destination. This follows
`thread_1787099389227`, where `casual + walking` removed 48 elevated and 11 dressy pieces before the
composer saw a Berkeley dinner request.

**[whole-wardrobe evidence correction, 2026-08-19] Wear mechanics reach visual composition but are
not narrated back as garment facts.** `composerPieceLineSuffix` now places `tuck_behavior`,
`hem_finish`, `waistband_type`, `opacity`, and the explicit `needs_base` value beside the photograph and existing fabric/read
facts. The model must silently honor settled mechanics. `styling_instructions` remains conditional:
it records a useful action or chosen relationship, not an owner's already-known fixed garment truth.

**[garment-truth correction, 2026-08-19] Visual lace does not override stored opacity.** After
`thread_1787103886848` called an opaque, independently wearable lace top sheer and invented a nude
camisole, the shared composer contract made `opacity` and both `needs_base` values authoritative.
An opaque `needs_base:no` garment cannot acquire an unverified underlayer from visual inference.

**[architecture consolidation, 2026-08-24] `needs_base` has one runtime fact reader.**
`pieceRequiresBaseLayer` returns true only for normalized explicit `yes`; unset and explicit `no`
retain the historical independent default. Capsule capacity and outfit checks, protagonist
ordering, selected local fallback, renderer instructions, and freeform primary-top/dress swaps now
consume that reader instead of interpreting the field independently. This is a fact consolidation,
not a new coverage or pair-compatibility rule; the ranking A/B diagnostic reported zero changes.

**[validation-ownership consolidation, required-base contract, 2026-08-24] “Needs a base layer”
now has one construction verdict after the garment fact.** `evaluateBaseLayerCandidate` and
`evaluateRequiredBaseLayers` in `outfitValidation.js` consume the canonical `needs_base` fact plus
structured `opacity` and `fit_on_body`. A candidate is incompatible when it also needs a base, is
`sheer`/`semi_sheer`/`open_weave`, or has a known non-close fit (`drapes`, `hangs_straight`,
`structured`, `none`). It is known compatible only with recorded opaque coverage and a close fit
(`skims`, `clings_stretchy`, `clings_drapey`). Missing fit or opacity is `unknown`, never silently
converted into a fact. Capsule roster/capacity policy may reserve an unknown candidate so legacy
metadata does not erase supply; submitted plans and freeform `propose_outfit` require both garments
to have been visually seen before the model may submit that unknown pairing. Known incompatibility
still rejects after sight. The rule applies only to coverage required by a dependent garment;
ordinary inner-garment/outer-layer combinations do not inherit a close-fit requirement. Colour,
neckline, texture, bulk, and proportion remain model judgment.

**[validation-ownership consolidation completed, 2026-08-25] Wearable-outfit validity now has one
composed owner.** `evaluateWearableOutfit` combines category or explicit-role structure,
required-base mechanics, optional layer-direction evidence, and sight state into typed hard,
advisory, and unresolved results. Selected, whole, freeform proposal/swap, plan submission, and
recovery validators consume that result before their bounded extensions. Unknown evidence is not
invalid; it blocks only when sight is needed to prove a hard requirement and has not occurred.
Hard-invalid paid selected/whole model attempts remain visible as Needs review cards with the actual
finding, alongside valid sibling cards. A selected dependent anchor with no compatible base is
preserved as an incomplete Needs review premise. Concept boards intentionally retain their lighter
allowlist/anchor validation.

**[validation-ownership consolidation, sleeve layer-pair construction, 2026-08-26] Sleeve-bulk
compatibility between two layered garments now has one owner, closing a gap the 2026-08-25 composed
owner above did not yet cover.** `thread_1787728618995`: asked whether a lace-sleeve blouse could
layer over a turtleneck, the compact `garment_fact` answer confidently said the pairing worked even
though both garments were long-sleeve — a private prose rule was added directly to that one prompt
(citing the retired `sleeve_type` field, which `garment_fact` is never even supplied). A follow-up
census confirmed the same gap existed in `evaluateWearableOutfit` itself: `propose_outfit`, plan
submission, and capsule composition could already accept a genuine sleeve-bulk conflict, because
neither `evaluateRequiredBaseLayers` (scoped to `needs_base` dependents only) nor
`evaluateLayerDirections` (over/under direction only) reads `sleeve_length`, `sleeve_shape`, or
`fabric_weight`. `evaluateLayerPairConstruction` in `outfitValidation.js` is the new canonical
verdict, composed into `evaluateWearableOutfit` behind the same `includeLayerDirections` flag every
existing consumer already passes — no call-site changes were needed. Two cuffed sleeves (elbow-length
or longer) worn one over the other is deliberately **not** incompatible by itself: the verdict is
`incompatible` only with actual bulk evidence (a voluminous `sleeve_shape` — puff, bishop, bell — on
either garment, or both tagged a medium/heavy `fabric_weight`), `compatible` when both are known
fitted and lightweight, and `unknown` when the deciding fields are unrecorded. Unlike the required-base
contract, an `unknown` construction verdict does **not** force sight verification before composing —
most ordinary layered pairs in this wardrobe simply lack `sleeve_shape`/`fabric_weight` tags, and
escalating every one of those to a mandatory-photo gate would have blocked routine composition for a
data-completeness issue rather than a suspected conflict (verified against the live test suite: the
broader escalation broke an existing layered-outfit fixture with no real conflict). Only a *proven*
conflict is a hard `evaluateWearableOutfit` finding; an unresolved one remains a visible advisory
finding. `garment_fact` now computes the same verdict server-side and cites it as a "Layering evidence
(computed)" block instead of restating sleeve/fabric thresholds in prompt prose.

**[prompt-projection follow-up, 2026-08-26] The composed owner above closed validation; composition
itself was still blind until this pass.** The first landing gave every composer post-composition
enforcement through `evaluateWearableOutfit`, but no active composer told the model the rule *before*
it composed — each would otherwise have had to restate the same thresholds independently to give
advance guidance, exactly the private-prompt-rule pattern this fix exists to close. A new
`layerConstructionPromptRule()` projection (mirroring `requiredBaseLayerPromptRule()`'s existing
pattern) is now cited, not restated, by every active layering-capable composer: `WHOLE_WARDROBE_
VISUAL_COMPOSER_SYSTEM` (covers both the whole-wardrobe and selected-anchor visual composer, which
share one template), the static `propose_outfit` tool description, and the shared plan/capsule slot
workbench (`buildPlanSlotWorkbench` in `outfitSetPlanner.js`) — one wiring point for both, since
`composeCapsulePlanOnce` forwards that same workbench's `instructions` and per-slot `submission_
requirements` straight into the atomic capsule composer's prompt payload. The workbench projection is
gated to slots whose own roster can actually form a layering pair; most slots cannot, and an
unconditional projection would be cost, not signal. A contract test
(`styling_context_consumers.test.js`) proves the visual composer and `propose_outfit` cite the rule
text verbatim at the source/runtime level; a live-fixture test (`plan_outfit_set.test.js`) proves the
workbench projects it only for a slot that can layer and withholds it for one that cannot.

**[gate correction, 2026-08-26 same day] The first version of that gate reinvented "can these pieces
layer" as its own local definition and got it wrong.** It counted only `top`/`dress`-category pieces,
so a slot whose only layering candidate was a jacket over a top (`layer_top` assigned to an
`outerwear`-category piece — a legitimate assignment per `evaluateOutfitRoles`' own role/category
map) silently never received the projection. Fixed by exporting `ROLE_CATEGORY_EXPECTATIONS` (the map
`evaluateOutfitRoles`' `role_category_mismatch` check already used internally) and a new
`wardrobeSupportsLayeringPair()` built from that same map, so the workbench gate and the role
validator can no longer independently define who is eligible to layer. `outfit_structure.test.js`
covers the helper directly (outerwear+top, top+dress, two tops, and the negative single-piece cases);
`plan_outfit_set.test.js` adds the live outerwear-layer_top fixture the original gate missed.

**[prompt-projection follow-up, 2026-08-26] Layer direction was the one layering verdict with no
prompt projection at all, and one composer had quietly filled the gap itself.**
`evaluateLayerDirections` was validated post-composition for `propose_outfit` and plan submission,
but no composer received pre-composition guidance about which piece sits over/under which — until
`capsulePlanCompositionSystemPrompt` invented a private "TOP + DRESS LAYERING" paragraph,
independently worded from the actual evidence sources (`pieceHasExplicitTopLayerEvidence`,
`pieceHasExplicitBaseLayerEvidence`, `pieceDressSupportsUnderlayer`, `pieceRequiresBaseLayer`) and
covering only the dress case. Fixed with `layerDirectionPromptRule()`, describing the executable
contract without inventing new thresholds, wired at the same three points as
`layerConstructionPromptRule()` (visual composer, `propose_outfit`, plan/capsule workbench — gated by
the same `wardrobeSupportsLayeringPair()` supply check) and deleting the private paragraph. Disposition
is unchanged: `evaluateLayerDirections`'s `unknown`/sight-required behavior was not touched, only its
pre-composition visibility.

**[sleeve taxonomy + directional construction rewrite, 2026-08-26] `sleeve_shape`'s fashion-name enum
(`fitted|straight|relaxed|puff|bishop|bell|flutter|raglan|dolman|other|unknown`) and the symmetric
`layer_construction_sleeve_conflict` verdict above were both replaced in the same pass — the symmetric
check was the direct consequence of the old enum having no shared semantics to be directional about.**
The new enum (`fitted|straight|puff_shoulder|gathered_ruched|voluminous|flared|deep_armhole|other|
unknown`, canonically owned by `SLEEVE_SHAPE_VALUES`/`SLEEVE_SHAPE_OPTIONS` in `attributes.js`) is a
functional sleeve-VOLUME taxonomy: every value states *where* a sleeve's volume sits, not what it's
called. `raglan` is deliberately dropped (armhole attachment construction, not a volume profile) — see
docs/garment-field-reference.md's "Sleeve taxonomy" writeup for the full mapping and the DB migration.
`pieceSleeveInterference(piece)` derives `{ shoulder, arm, lowerArm, armhole }` zones
(`'none'|'elevated'|null`) from the new enum, replacing the old `VOLUMINOUS_SLEEVE_SHAPES` boolean set.
`evaluateLayerPairConstruction()`/`evaluateLayerPairConstructionFor()` now resolve which garment in a
pair is outer vs inner via a `resolveLayerDirection()` helper shared with `evaluateLayerDirections`
(same PR #264/#265 evidence — outerwear category, explicit overlay/underlay notes, dependent-needs-
base), then flag a conflict only when the INNER garment has elevated volume at a zone where the OUTER
garment is known `fitted`/`straight` (zero capacity) at that same zone — a voluminous outer garment
over a fitted inner one is no longer flagged, closing the "the old rule couldn't tell top-under from
top-over" gap the previous entry's writeup already named as future work. Direction unresolved or
either shape unrecorded still returns `unknown` (sight required), never a guessed incompatibility,
except: both garments carry fully-known zero-volume geometry (compatible regardless of direction), or
both are tagged medium/heavy `fabric_weight` (an incompatible fabric-bulk conflict — kept as a
direction-agnostic dimension independent of sleeve geometry, per the taxonomy spec's explicit
instruction not to conflate fabric bulk with sleeve volume). `layerConstructionPromptRule()` was
rewritten to describe the zone/direction mechanics; its three wiring points (visual composer,
`propose_outfit`, plan/capsule workbench) are unchanged. Migration and visual-backfill of existing
wardrobe data are a separate, deterministic-only DB pass (no AI calls in server-startup migration) —
see `scripts/sleeve-taxonomy-census.mjs` and `docs/garment-field-reference.md`.

**[no-silent-local-fallback policy, selected-piece flow, 2026-08-27] A composer timeout revealed that
"local fallback" and "user-facing recommendation" had never actually been kept separate for the
selected-piece flow — testing the sleeve fix above on real data (thread_1787803856242) surfaced a
shrug the model never evaluated, paired with a shirt, presented as a "Signature / strongest
direction" card.** Tracing it: the selected-item visual composer (`composeSelectedPieceVisualWardrobeOutfits`
in `routes/ai.js`) timed out at 90s (bumped to 120s the same pass, per the historical latency data —
one outlier in 20+ recorded calls, payload size normal, no evidence of a caused regression) and
returned zero outfits, and the code silently substituted `buildLocalFallbackOutfitDirections()`'s
category-fill picks — no photo judgment, no layering awareness, no `evaluateWearableOutfit` validation
of any kind — labeled identically to a real composition. A companion violation was found in
`composeStructuredOutfitsForPiece`'s closet-only branch (`styling-engine/core.js`, exported but not
reachable from the live `/generate-outfits-for-piece` route today, which only ever invokes this
function in ideal/ideal-only mode — fixed anyway as a dormant landmine, not left as a trap for a
future direct caller): mergeOutfitDirections() (deleted) blended real model outfits with local-fallback picks
up to `minCount: 4` with no visible distinction (an internal `isFallback` flag existed but was never
surfaced), and validated the merged set with `validateSelectedRecoveryOutfit()` — checked and
confirmed weaker than the canonical `evaluateWearableOutfit`: only `evaluateOutfitStructure` and
`evaluateRequiredBaseLayers`, no layer-direction or layer-construction check, so it would not have
caught this pairing either. `composeStructuredOutfitsForPiece`'s `idealMode` branch had the same
shape (`ensureIdealMissingCompletion(outfits.length ? outfits : localFallback, ...)`) and was fixed
too. The governing rule, applied uniformly: **local/deterministic logic may prepare, rank, filter,
validate, or recover candidate space, but it may not supply a user-facing outfit recommendation
unless a styling model actually selected/evaluated that outfit.** A composer that returns nothing now
sets `compositionSkipped: 'composer_failed'` (mirroring the existing `'incomplete_candidate_supply'`
early-return shape `composeSelectedPieceVisualWardrobeOutfits` already used for a different failure
mode) and a clear retry message, surfaced at both the top level and in `debug`; the outer shared
post-composer block in `generateOutfitsForPieceInternal` respects the same flag, so neither composer
path can reintroduce a substitute once one signals failure. The now-unused mergeOutfitDirections()
helper was deleted outright rather than left dormant, along with the "absolute basic backfill"
tier (a second, weaker local-fallback layer that fired when even the first fallback returned nothing).
`buildLocalFallbackOutfitDirections()` itself is kept, exported, currently uncalled — available if a
genuine internal recovery/retry mechanism needs it later, but its output must never reach
recommendation UI without model judgment again. Provenance was tightened alongside this:
`composedBy` used to default to `'model'` unconditionally; it now honestly distinguishes
`idealOnlyMode`'s outfits (`buildIdealOnlyCompletionsForPiece` — a deterministic, template-based
missing-piece/shopping-idea generator, a distinct feature from closet/mixed styling, never a model
call, left out of scope for this fix) as `'engine'`. Deliberately **not** touched: whole-wardrobe's
local backfill (`buildVisualLocalBackfill`/`buildDiagnosticLocalBackfill` in `routes/ai.js`), which
already gates fill-in candidates through `locallyGateWholeWardrobeOutfits()` and marks its diagnostic
tier `broken`/`diagnosticOnly` — the same "gate or mark broken, never silently present as real" shape
this fix establishes, just already in place there; and capsule roster selection's own deterministic
fallback (`paletteSafeDeterministic()`), which constructs candidate space (which pieces are eligible
for the capsule), not a final styled recommendation — explicitly out of scope by the same rule.
Regression coverage: `test/selected_piece_no_local_fallback.test.js` pins both fixed violations (empty
composer → explicit failure, not a substitute; partial model result → shown as-is, not padded) and
two same-file positive cases (a real composed outfit still reaches the user; the fix doesn't suppress
genuine model output).

**[follow-up, same day] `validateSelectedRecoveryOutfit()`'s weaker parallel contract — flagged above
but deliberately left untouched in the first pass — was resolved as its own reviewed change.** It
used to run only `evaluateOutfitStructure` and `evaluateRequiredBaseLayers` directly; now it is a
thin adapter around the canonical `evaluateWearableOutfit(pieces, { requireShoes: true,
includeLayerDirections: true })`, returning `{ valid: hardValid, primaryFinding }` — the shape
`recovery.js`'s `validatedFallback` already expected, so no caller-side changes were needed. This is
the one remaining place `composeStructuredOutfitsForPiece`'s closet-only branch validates real
model-composed outfits (`buildLocalFallbackOutfitDirections`'s own internal use of the same function
is unaffected in behavior terms — it's just now checked against the same canonical bar, though that
helper remains uncalled by any live path). The individual missing checks were deliberately not copied
in one at a time — the adapter projects through the canonical gate so a future check added to
`evaluateWearableOutfit` is inherited automatically rather than needing to be remembered here too.
`test/selected_piece_no_local_fallback.test.js` gained a fifth case: two model-composed candidates
sharing a voluminous-sleeve dress, one paired with a structured (zero-capacity) cardigan layer and one
with a roomy one — proving the sleeve-construction conflict is now rejected in this path exactly as it
already was in the visual composer path, not merely deprioritized.

**[image-generation grounding gap, 2026-08-27] `/editorial-render-one` (the "Generate image" button
on a selected-piece outfit card) rendered wrong pants/shoes details, and regenerating did not help —
thread_1787813410728 caught this on a real "style this piece using my existing wardrobe" direction.**
Root cause: `createEditorialConceptImage`/`editorialImagePrompt` were built for the genuine "ideal
missing piece" concept-board feature, where the non-anchor items are invented archetypes with no real
garment to preserve (`direction.missingPieces`, text only, by design). The same function is also used
to render a direction composed entirely of real, owned wardrobe pieces (pants, shoes) — for those,
nothing described the non-anchor garments at all: no reference photo, no structured fidelity text,
only `direction.reason`'s prose rationale. The model had nothing to ground the pants/shoes on and
invented them, and a re-render can't fix a prompt that never had the evidence — this is the same
failure mode the visual-grounding principle already names (composing/rendering from text alone
produces wrong results), just in the render step rather than composition. `wholeWardrobeImagePrompt`
(the correctly-built sibling used by `/generate-wardrobe-outfit-image` and the comparison sheet)
already solved this for its own callers with a per-piece fidelity checklist (category-level "don't
substitute" constraints) and a construction checklist (structured silhouette/length/sleeve/hem/tuck/
waistband/opacity facts) — both were factored out into shared `pieceFidelityChecklist(pieces)` /
`pieceConstructionChecklist(pieces)` helpers rather than reimplemented, so the two prompts can't drift
into different fidelity vocabularies. `createEditorialConceptImage` now resolves `direction.pieceIds`
to real DB rows (excluding the anchor) as `supportingPieces`, loads their reference photos via the
same `garmentReferenceImages()` every other multi-piece render path uses, and passes both the photos
and the two checklists through — `runGPT4oImageGeneration` gained a `supportingGarmentImages` param,
injected with "must also appear as shown" framing (one notch below the anchor's stricter "do not
redesign" language, since these are secondary to the anchor, not the premise). Genuinely invented
ideal-addition directions are unaffected: `supportingPieces` is empty whenever `direction.pieceIds`
resolves to nothing but the anchor, and `missingPieces` still reaches the prompt as prose exactly as
before. `test/editorialIdealAdditions.test.js` pins both: a real multi-piece direction produces the
supporting-garment fidelity/construction sections with the expected per-category constraints, and a
genuine ideal-addition direction (no owned pieceIds) produces neither section.

**[follow-up, same day] Garment photos were not the only evidence this renderer was dropping —
`styling_instructions` (how the pieces relate to each other: layering order, tuck/belt mechanics)
never reached it either, despite both selected-piece composer prompts already generating it and
documenting it as "the ONLY field the image renderer treats as authoritative for how pieces relate to
each other".** It survives `normalizeGeneratedOutfitObject` onto the outfit card — `editorialImagePrompt`
simply never read `direction.stylingInstructions`. Fixed the same way `wholeWardrobeImagePrompt`
already treats it: an "Authoritative styling instructions (how these garments relate to each other —
follow exactly)" line, ordered ahead of the non-authoritative `reason` prose. Also echoed on the
`/editorial-render-one` response body (alongside the existing `reason`/`watchFor`/`missingPieces`
fields) for consistency, though the prompt injection is the actual fix. `test/editorialIdealAdditions.test.js`
gained two more cases: a direction with `stylingInstructions` produces the authoritative line ordered
before `Stylist logic:`, and one without it produces neither.

**[projection-accuracy correction, 2026-08-26 same day] The first projection dropped a real evidence
branch and conflated relationship with direction.** It omitted `pieceRequiresBaseLayer` — the
role-aware `layer_top + primary_top` path treats a dependent `layer_top` (`needs_base: yes`) as
direction evidence on its own, resolving `layer_top_over_primary_top` with no overlay text required
(`evidence.source: 'dependent_layer_requires_base'`). It also claimed "two pieces merely appearing
together is not evidence of a layering relationship," which is wrong for a role-aware pairing — role
assignment already establishes the relationship; only the supported direction can be unknown. Fixed
to state both: role/category assignment can establish a pairing; construction/intent/dependency
evidence (including `needs_base` on either the added piece or the dress) decides direction.
`outfit_structure.test.js` pins the prose against the same `needs_base`-only fixture
`propose_outfit.test.js` uses for the executable verdict.

**[second projection-accuracy correction, 2026-08-26 same day] The fix above still over-claimed.**
It said role/category assignment never decides direction by itself — false for an
outerwear-category `layer_top`: `categoryGroup === 'outerwear'` alone resolves
`layer_top_over_primary_top` (`evidence.source: 'outerwear_category'`), no notes or dependency
required, unlike a `layer_top` role on an ordinary top (relationship only, direction still unknown
without other evidence). The projection now distinguishes the two explicitly, with the same
behavioral-fixture-plus-prose-check test pattern as the `needs_base` correction above.

**[verified duplication, 2026-08-26] `OUTFIT_EVALUATOR_GATE_SYSTEM` really could diverge from the
canonical register/footwear verdicts — traced, not assumed.** Call chain:
`composeStructuredOutfitsForPiece` (`core.js`) is reached only from the selected-piece ideal/missing-
piece branch of `generateOutfitsForPieceInternal`. Its supporting candidates come from
`selectAutomaticUseCandidatesForOutfitGeneration` → `evaluateAutomaticUsePiecePool`, so they already
passed `registerCeilingVerdict`/`footwearComfortVerdict` before the composer ever sees them — the
evaluator's prose could never actually disagree with the canonical verdict for those. The selected
anchor is different: it bypasses automatic-use eligibility by ratified 2026-08-25 design (the whole
point of an anchor), so it never runs those checks anywhere upstream, and every audited outfit must
include it (`evaluateOutfitRoles`'s sibling audit criterion "includes the selected garment"). The
evaluator's free prose ("clearly exceeds", "stilettos, delicate sandals, high heels") was therefore
the only place register/footwear suitability was ever decided for the anchor, using vaguer criteria
than the mechanical functions (no `walk_support` dimension at all, keyword shoe-name matching instead
of `heel_height`). Fixed by computing the anchor's own verdicts server-side
(`anchorRegisterFootwearComputedChecks()`, `core.js`) and citing the result; the evaluator no longer
re-derives either semantic and is told not to flag register/footwear absent a computed line, since
every other candidate is already guaranteed compliant. `EDITORIAL_NEW_PIECES_SYSTEM`'s near-identical
doctrine was traced separately and left alone: it reasons about conceptual, not-yet-tagged pieces
with no fields to compute a verdict from, so there is no canonical owner it could cite — legitimate
overlap, not duplication.

**[owner-ratified shared-composer scope, 2026-08-19] Wear mechanics and renderer instructions are
global; comparison pressure is not universal.** Evidence labels, the explicit
`styling_instructions` renderer contract, and prose integrity apply wherever
`generateWholeWardrobeOutfitsVisualInternal` is used. Multi-option freeform, direct Visual Composer,
and adjacent saved-outfit exploration receive comparison guidance. Formula-similar saved-outfit
variants pass `comparisonSetGuidance:false`, because manufacturing a new formula would violate that
flow's purpose.

**[weather-judgment clarification, 2026-08-19] A daily range is interpreted at the requested time.**
The shared composer is told to style evening/early-morning requests toward the relevant cooler end
of a numeric forecast and include a removable transition layer when the wardrobe supports one.
Indoor context governs the base but not arrival/departure. This is model guidance inside the mild
band, not a new score, cap, filter, or cold threshold. It follows `thread_1787101448245`, whose
70°F/55°F indoor-dinner first card had no layer.

**[weather-adequacy correction, 2026-08-19] A named layer must actually cover the cooler transit.**
After `thread_1787103270104` called a sleeveless vest over a light top sufficient at 55°F, the
shared composer contract was made falsifiable: at roughly that temperature it must choose
sleeve-bearing outerwear, combine an actually warm long-sleeved base with an adequate layer, or
state the wardrobe gap. This remains model judgment rather than a new deterministic cold gate.

**[card-consistency correction, 2026-08-19] Silhouette nouns must match the garments shown.**
`sanitizeWholeWardrobeOutfitProse` compares model
silhouette language with structured `bottom_kind`; if it calls a skirt trousers (or pants a skirt),
only the false silhouette field is withheld while a correct reason remains. A phrase such as
“boxy top over structured wide-leg trouser” already communicates the garment relationship to the
owner, but the image generator treats `stylingInstructions` as its authoritative mechanics field.
The composer contract therefore requires the model to state that relationship explicitly in
`styling_instructions` as well. **[owner correction, 2026-08-19]** Application code does not infer
renderer instructions from silhouette prose: `normalizeWholeWardrobeOutfitObject` transports only
the model's explicit field. Silhouette validation remains an independent card-integrity check and
does not rewrite explicit renderer instructions. This follows `thread_1787100432612`.

**[flagged experiment, 2026-08-18] Bounded adaptive visual detail.** With
bounded freeform uses the existing
`pieceVisualDetailPolicy`: complex/expressive/textured garments at 800px and plain garments at
448px, rather than forcing every image to 768px. No roster item or photograph is removed. The
corrected Larkspur roster measured 40/40 and 28.7% fewer aggregate pixels. Other visual-composer
flows and flag-off behavior retain 768px. On corrected live thread `thread_1787097967248`, this
reduced cache creation from 43,682 to 32,398 tokens while returning two valid cards; the total turn
estimated to ~$0.146, about 55% below the original ~$0.324 baseline.

## What a search result carries — judgment, not a re-description

**Added 2026-08-17.** [search-payload-spec.md](search-payload-spec.md).

**[by design] The wardrobe manifest is the one home for stable garment truth.** It sits in the
cached stable prefix and is paid for once per turn. `search_wardrobe` used to re-transmit most of the
same facts per call: one tops search measured **~13,764 tokens against the entire 251-piece
manifest's ~12,506** — and unlike the manifest it was written to cache at 1.25× input every time,
then re-read by every later iteration.

**[by design] A search result now returns only what cannot be cached** — which pieces passed, and how
they were judged for *this* occasion/activity/weather (`ruleFit`, `ruleFitLabel`, `weatherFit`), plus
`id`/`name`/`category` as the join key, `notes` (the one free-text field the manifest lacks), and the
thumbnail. Measured on `thread_1786954464459`'s three searches: **25,747 → 9,613 tokens, −63%**,
roster identity unchanged.

**[by design] Trimming is conditional on the manifest actually being in the prompt.** Above
`WARDROBE_MANIFEST_MAX_PIECES` (400) the manifest is omitted, and a trimmed row would then be the
model's only view of a garment; `wardrobeManifestIncluded` carries that fact from the payload builder
to the tool. Pinned by a test.

**[flagged experiment, owner-ratified 2026-08-19] Identity omniscience may replace full-truth
omniscience.** With `WARDROBE_FREEFORM_TIERED_DISCOVERY=true`, every active ID, exact name, category
and brief visual read remains in a deterministic discovery index, while construction/fit/suitability
truth is retrieved only when needed. This is not a shortlist and recently-shown memory cannot remove
an identity. `wardrobeManifestIncluded` is deliberately false and
`wardrobeDiscoveryIndexIncluded` true, so `search_wardrobe` returns full stable truth rather than the
trimmed judgment row. Broad category counts come directly from exact index headings; qualified
counts expand through `wardrobe_coverage`; known-piece questions through view/details; composition
and sparse uncertainty through database search. See
[freeform-tiered-discovery-spec.md](freeform-tiered-discovery-spec.md).

**[owner amendment 2026-08-19] Direct tuckability answers use an evidence hierarchy.** Automatic
composition continues to obey the saved `tuck_behavior` conservatively. In conversation, a
manual/high-confidence tag is strong evidence, not an unchallengeable fact; missing/low tags permit
inference from the full construction evidence, and a visible contradiction may be explained. A hem
shape alone cannot decide. `view_pieces`, untrimmed search rows and compact garment facts now expose
the field (plus confidence in compact facts), closing the omission found in
`thread_1787116925244`.

**[owner amendment 2026-08-19] Resolved garment mechanics may use bounded saved sight.** Tags can
be absent or mistagged while the wardrobe already contains direct evidence. For compact
`garment_fact` turns, `compactGarmentVisualEvidence` supplies only the resolved subjects' worn then
hanger photographs, capped at four 640px low-detail images. Clearly visible worn behavior outranks
a weak/missing tag for feasibility only. The shown result is judged separately; possibility does
not imply preference, and an unseen alternative cannot be ranked. It does not change the conservative metadata authority used by automatic
composition. The call records `compactVisualImages` and never loads a wardrobe-wide visual roster.

**[rollout contract 2026-08-19] Routing coverage is a tracked corpus.**
`test/fixtures/freeform_execution_routing_corpus.json` exercises every execution profile and the
full-stylist fallback classes through `routeFreeformExecutionProfile`. The provider is hermetically
mocked, so this proves schema/context wiring rather than live semantic accuracy; default-on still
requires the bounded live matrix in `docs/freeform-measured-rollout.md`.

**[live correction 2026-08-19] Compact education cannot turn signals into dress-code gates.**
`compactFreeformAnswerSystem` requires multiple valid pathways and labels structure, fabric, finish,
cohesion, accessories and footwear as optional whole-outfit signals. It distinguishes tendencies
from requirements and cannot characterize casual dress as careless/shapeless errand wear or use
status-loaded accessory contrasts. This corrects `thread_1787119133701` without changing routing.

**[live correction 2026-08-19] Saved sight is a routable capability, not fiber truth.** For resolved
garment subjects, `/ask` tells `routeFreeformExecutionProfile` only how many have saved photos. This
allows a visibly shown wear-mechanics judgment to use bounded `garment_fact`; names and image data
remain outside the router. `compactFreeformAnswerSystem` and the `view_pieces` tool contract both
limit photographs to visible drape, bulk, texture and behavior. They cannot establish exact fiber
composition, and a feasible shown configuration is not automatically a successful styling choice.

**The invariant that keeps this safe:** no field may be absent from *both* surfaces. A field in
neither is invisible to the model, and the failure is silent — worse composition, no error.
`test/wardrobeAiContext.test.js` asserts the union covers every stable field for a fully-populated
piece, and fails loudly if either side drops one.

**Live-verified 2026-08-17** (`thread_1786954464459` → `thread_1786994644421`, identical prompt):
cache creation 71,611 → 58,723, cost **$0.380 → $0.325 (−14.6%)**, iterations unchanged at 6, and the
model still names the right trail shoe unprompted from `walk_support` now that it arrives via the
manifest. **Note the multiplier this exposed:** anything added to the cached prefix is re-read on
every iteration, so the manifest's +3,557 tokens cost ~21,300 reads across six of them and ate a
third of the saving. Prefix size × iteration count is the real term.

**Two incidental fixes.** The manifest printed the tagger's literal `'none'` for inapplicable fields
(`silhouette none` on every shoe), and it showed `reads_as` **or** the colour list but never both, so
most pieces had no palette in the manifest at all. Both corrected; the manifest grew 12,506 → 16,063
tokens, a cache read costing ~$0.001 per iteration against ~16,100 tokens removed from cache writes.

## Activity — how it is resolved, and what it can do to a roster

**Added 2026-08-17.** [activity-and-roster-spec.md](activity-and-roster-spec.md).

**[by design] The declared activity is no longer final; request text may escalate it — one way.**
`resolveActivityProfile` used to return immediately on a supplied activity, so a model that declared
`walking` for a nature walk could not be corrected, even though its own reply discussed the trail.
Text may now lift `none`/`walking` → `hiking` and may **never** lower `hiking` → `walking`; an
explicit denial ("no hiking", "just a stroll") blocks escalation. The asymmetry is deliberate:
treating a city walk as a hike costs comfortable shoes nobody needed, treating a hike as a city walk
costs grip on a trail. `mood` is NOT scanned — it is the vibe axis, and a test pins that.

**[by design] A nature walk is a hike — and that ruling changed CLASSIFICATION only.** Owner ruling
2026-08-17: *"not climbing a mountain, but a hike."* One profile rather than a third enum value,
since another value would add exactly the classification choice the bug came from. **The hiking
profile's own rules are unchanged**: a revision that relaxed `excluded_walk_support` to `['low']`
shipped and was reverted the same day on the owner's correction — *"walk_support: medium is correct
and makes it eligible for outdoor social or museum with lots of walking, NOT a hike"*, and *"nothing
should have changed for the definition of hiking."* Verified by re-running the composer against the
recorded `suppressedReasonCounts` of `thread_1786908644157`: 150 suppressed, all seventeen counts
matching.

**[latent inconsistency] Hiking's footwear name-lists are unreachable.** `discouraged_footwear`
(sandals, mules) and `prohibited_footwear` (heels, wedges, flip-flops) sit behind
`if (isShoe && !activityProfile)` — skipped precisely when an activity IS set. Nothing depends on it
today because `excluded_walk_support: ['low','medium']` catches those shoes anyway. It bites only if
that floor is ever relaxed: measured on an instance with no owner constraints, relaxing it alone
scored strap sandals `neutral` for a hike. See activity-and-roster-spec.md §5.3a.

**[by design] Activity can now promote, not only remove.** `search_wardrobe` returns `walk_support`
and `heel_height` — the gate read them to exclude and showed them to nobody, so the model inferred
grip from garment names. Within a tier, shoes now order by support when an activity is set; nine
shoes used to tie at `preferred` in id order, ballet flats indistinguishable from trail sneakers.
Ordering never removes.

**[by design] The tag discouragement is the LAST check in `profileRuleFit`, after every hard gate.**
A soft signal must never pre-empt a hard one. An earlier revision returned from it before the
register ceiling, and measuring the composer against the recorded live run `thread_1786908644157`
showed elevated/dressy pieces losing their suppression for a casual hike — 45 register exclusions
collapsing to 8, admitting 20 pieces that should not have been in the roster. Caught only because
that run's `suppressedReasonCounts` was on record to compare against; the freeform tests were green
throughout. Pinned by a test that passes a `registerCeiling` explicitly.

**[by design] `required_occasion_tags` reaches the freeform path as a DISCOURAGEMENT.** Enforced only
in the composer before, so a correct hike gated the shoes and left city-only tops untouched. It is
deliberately not a hard gate: that would contradict the 2026-06-12 ratification keeping a day dress
allowed for outdoor-active, and would make the roster depend on how well one user tagged their
wardrobe. Untagged garments still appear, ranked below tagged ones and labelled.

**[by design] Owner constraints reach the roster, not only the proposal.** `search_wardrobe`'s
occasion filter passed `occasion` alone, so an `owner_constraints` row scoped to activity, season or
weather could never apply to what the model composes from. It now receives all four — but rejects at
that stage **only** for the owner's own standing decisions. Letting the full profile gate reject
there would move exclusions ahead of the pass that counts, labels and re-exposes them under
`intent:'explain'`, and a piece would vanish with no number and no way to ask why.

## A card must describe the card — the consistency clause

**Added 2026-08-16.** [card-consistency-spec.md](card-consistency-spec.md) Part 1. The turn
contract's clauses ask whether a card's pieces are real (*truth*), whether context is settled
(*context*), and whether cards arrived (*delivery*). None asks whether the card's **own words
describe the card**, so an internally inconsistent card passed every one of them.

**[by design] A top worn with a dress is legal and is never removed.** Owner ruling 2026-08-16: a
styling decision, not a hard ban. `evaluateOutfitStructure` preserves that ruling — with a dress
present it still rejects only a bottom, a second dress, or a second pair of shoes.

**[by design] What is enforced is that the card accounts for it.** `outfitLayersTopWithDress` is a
category-group fact; `unexplainedLayeredTops` then checks whether the card's own prose names the
top. Deliberately weak — a substring match against a name already known to be in the card, in the
spirit of `findZeroResultContradiction`: checking a known fact, not fact-checking prose. It cannot
judge whether an explanation is *good*; that is taste, and taste stays with the model.

A word shared with another garment in the same outfit does not count as naming the piece. "black
blouson v-neck top" beside "black brown lace floral midi dress" share *black*, so prose about the
dress would otherwise read as prose about the top — the exact false negative of the live case.

**[by design] Freeform retries once; the card ships either way.** `cardProseInconsistent` is a
fourth turn-contract clause in the truth family, using the existing per-`blockType` retry budget,
counted as `card_prose_inconsistent_blocks`. If the retry produces no explanation the top is
**kept** and the card carries a visible flag. It is never silently dropped: capsule ships
`model_repaired_with_gaps` with the gap stated, advisor mode exists so code does not censor composer
output, and Decision B (2026-06-25) ruled against filtering results down.

**[by design] The archetype no longer asserts a shape it did not check.** Because every dress outfit
is forced into `dress_grounded_sharp`, its "one-piece column" silhouette was being stamped onto
outfits carrying extra tops; that text is now replaced with what the pieces actually are. The
remaining half — giving the dress family more than one archetype so the label discriminates and the
`avoidRoles` penalty can bite — is styling content and **needs owner sign-off** (spec §5.2).

## Who writes the words on a card — the model, or the archetype template

**Amended 2026-08-16.** Two producers can author a card's `label`, `dominantDirection`,
`silhouette`, `reason` and `watchFor`: the composing model, or the archetype template
(`rewriteWholeWardrobeOutfitWithArchetype` → `buildOutfitMechanicsReason`).

**[by design] The model's own notes are preferred, and the template is the fallback.** The
whole-wardrobe and capsule paths get this for free: advisor mode sets `shouldRepair = !advisorMode`,
so repair never runs and the model's text is untouched. That is why those cards read in the model's
voice, keep its creative labels, and close with its `*Skipped directions:*` and
`**Saveable learning:**` lines.

**[bug, fixed 2026-08-16] The selected-piece path threw that away.** `routes/ai.js` repairs
unconditionally, and `repairWholeWardrobeOutfit`'s **first** step called the archetype rewriter,
which overwrote `reason` and `label` unconditionally — before the guard 100 lines below it
(`hasWholeWardrobePlaceholder || hasGenericWholeWardrobeText || !reason`) that exists to preserve
authored text could ever apply. That guard was dead code on this path, so the template was the
default rather than the fallback. Two visible consequences:

- Distinct model outfits collapsed into one name. A live response returned two different cards
  both labelled *"Grounded Dress Edit: standard wear"*.
- The prose omitted a garment the card contained. `buildOutfitMechanicsReason` had no branch for a
  top alongside a dress, so a card pairing a blouse with a lace midi dress described only the dress
  and the layer — the person was told to wear a piece the explanation never mentioned.

`rewriteWholeWardrobeOutfitWithArchetype` now takes `preserveAuthoredText`. The entry call passes
it (nothing has changed yet, so the model's words still describe this outfit); the call **after a
footwear substitution** deliberately does not, because the model's sentences then describe an
outfit that no longer exists. The template also names a top when a dress is present.

**[by design] Any outfit containing a dress is labelled `dress_grounded_sharp` ("Grounded Dress
Edit").** `inferOutfitArchetype` skips every other archetype when a dress is present, so this is
the only label a dress outfit can receive — it is not selected on fit. Its `avoidRoles:
['extra_pattern']` scores −12 but cannot disqualify, since no competing archetype survives. Worth
knowing before reading such a label as a judgment about the outfit. **[owner check wanted]**

## Candidate generation with a Main piece — the structural fallback

**Amended 2026-08-16.** `buildWholeWardrobeCandidateOutfits` (`rules.js`) composes candidates per
Outfit Mission. When the caller pins a Main piece (`requiredPieceId` / `mainPieceId` — saved-outfit
"Similar variants" does, via `routes/ai.js`), every candidate must contain it, and a mission that
does not qualify for the resulting combination yields nothing.

**[by design] A Main piece that no mission can place falls back to structural candidates.**
`addStructuralCandidate` skips mission qualification and the `-18` score floor, so the person still
gets outfits built around the garment they picked.

**[bug, fixed 2026-08-16] That fallback used to run only for an add-on Main.** It was gated on
`requiredIsAddOn` (outerwear/accessory). A top, bottom or dress Main in the same situation produced
**zero candidates** — the missions rejected every combination and nothing caught it. Live shape: a
saved two-top outfit asking for Similar variants returned nothing, and its layer-capable top could
not keep its base top. The gate is now `requiredPieceId && !hasRequiredCandidate()`, with the same
role guards the mission path uses (no dress appended onto a complete top+bottom+shoes look), and a
layer-capable top Main tries the two-top formula before falling back to a single-top look.

**[by design] The Main piece is appended only when a slot has not already supplied it.**
For an add-on the slot lists never contain it; for a top/bottom/dress Main the slot list *is*
`[requiredPiece]`, and appending unconditionally put the same garment in the outfit twice.
`withRequiredPiece` is that check. Covered by a no-repeated-piece assertion in
`test/aiEndpointContracts.test.js`.

**Measured effect on the live wardrobe (30 scenarios: 5 occasions × {no Main, 5 Main pieces}):**
28 identical, including **every** no-Main scenario — the default whole-wardrobe path is untouched.
Two changed, both with a Main whose `color_anchor` mission previously starved: `casual` gained one
candidate and removed none; `outdoor` stayed at its cap of 60, gaining the intended `color_anchor`
candidate and displacing two lower-ranked tail entries (adding to a capped list evicts the tail,
and the cross-mission `seenKeys` dedupe then admits a combination it had previously suppressed).

## After the gate — the outfit-level pass

`locallyGateWholeWardrobeOutfits` (`rules.js`) is where assembled outfits are repaired,
rejected, deduped and diversified. It has **two modes, and the mode changes the meaning of every
check in it.**

### `mode: 'gate'` rejects; `mode: 'advisor'` annotates

Seven checks run per outfit — body-shape/flattery language, missed mood, excess volume, soft-neutral
drift, a profile-prohibited piece, an untagged (`unknown`) piece, and a profile-discouraged piece.
In `gate` mode each one **drops the outfit**. In `advisor` mode each one instead attaches a
`systemFlag` and the outfit survives:

| check | gate mode | advisor mode |
|---|---|---|
| flattery language | rejected | sentence scrubbed, flagged *"Removed body-shape framing…"* |
| misses boho mood | rejected | flagged *"May miss the requested mood"* |
| ≥3 volume words | rejected | flagged *"Reads volume-heavy"* |
| ≥5 soft words, no grounding | rejected | flagged *"Soft neutral read"* |
| profile-prohibited piece | rejected | flagged with the profile reason |
| `unknown` (untagged) piece | rejected | flagged *"Not yet tagged for this gate"* |
| profile-discouraged piece | rejected | flagged |

This is the "hard gate vs LLM judgment" split made concrete: advisor mode trusts the model's
composition and reports concerns; gate mode enforces. **[by design]** — and the reason a check
"not firing" in one flow is not evidence it is absent.

Four checks are **unconditional in both modes** and always reject: structurally invalid, contains a
non-owned piece, user-excluded for the occasion, duplicate formula.

### Repair — what it actually does

`repairWholeWardrobeOutfit` (`rules.js`) does **not** fill missing slots. Traced end to end,
it does two things, and only one of them touches a garment:

1. **It rewrites the outfit's prose.** `label`, `dominantDirection`, `silhouette`, `reason` and
   `watchFor` are regenerated from the inferred archetype, but only where the existing text is a
   placeholder (`hasWholeWardrobePlaceholder`), generic boilerplate (`hasGenericWholeWardrobeText`),
   empty, or — for `silhouette` — identical to `dominantDirection`. Under a
   `modern_bohemian_restraint` mood with a boho signal ≥ 2 it rewrites label, direction, reason and
   watchFor unconditionally.
2. **It substitutes exactly one shoe**, and only when the resolved occasion or activity profile
   declares `required_footwear` and the current shoe does not match it. The replacement is chosen
   from gate-passing shoes by a small local relevance score (occasion score, ±10 preferred /
   discouraged footwear, −8 discouraged material, ties broken by id). If no qualifying shoe exists
   it appends *"footwear is not trail-rated — closest available match"* to `watchFor` and changes
   nothing.

**That shoe swap can only ever fire under the `hiking` activity profile.** It is the only profile
in the codebase with a populated `required_footwear` — `walking` declares `[]` and no occasion
profile declares the key at all. So outside hiking, repair is a **prose pass**: it cannot add a
missing bottom, cannot swap a top, cannot complete an incomplete outfit.

This reframes the mode split. Repair runs when `repair !== undefined ? repair : !advisorMode` —
on by default except in advisor mode, where a caller may force it on. The source comment justifies
the skip on the grounds that a mechanical slot-fill would "reinvent" a model's composition; what is
actually being protected in the overwhelming majority of cases is **the model's own prose**, since
that is what repair overwrites. The standing owner ruling (do not re-propose repair for
LLM-composed advisor-mode outfits) is unaffected and still correct — the reasoning behind it is
just narrower than it reads.

**[by design] Pieces are rehydrated before any gate runs** (spec 29 Part 1).
`normalizeWholeWardrobeOutfitObject` trims outfit pieces to `{id, name, category, photo,
worn_photo}` upstream, so every structured check would otherwise read `undefined` and silently
degrade to name-text matching. The rehydration against `candidatePieces` is a local variable only;
the response shape is untouched.

### Diversity — the largest penalties in the system

`applyWholeWardrobeDiversity` picks the final set greedily, scoring each candidate against what is
already selected with `wholeWardrobeDiversitySelectionScore` (`rules.js`). The repeat
penalties, per prior outfit sharing the trait:

| repeated trait | penalty each |
|---|---|
| same formula family | **−45** |
| same top | **−40** |
| same silhouette family | −35 |
| same bottom / same shoes | −20 each |
| print or stripe already used | −20 |
| same grounding strategy | −18 |
| same visual rhythm | −16 |
| same shoe shape | −14 |
| `compact_top_dark_column` repeated | −25 extra |

These dwarf every composition score in the system — a −45 formula repeat is larger than the whole
usable range of `capsuleVersatilityScore`. **That is the point**: after the first outfit, novelty
outranks quality, which is why a strong second look can lose to a weaker but more different one.
It also explains the reused-shoe complaint recorded in the handoff — shoes carry only −20, the
weakest of the three core slots, so the selector will repeat a shoe long before it repeats a top.

A mood profile can override all of it: under `modern_bohemian_restraint`, an outfit whose boho
signal is below 2 takes **−45**, which alone cancels a formula repeat.

### The classifiers those penalties key on — measured

A penalty is only as meaningful as the bucket it compares. Measured over 600 structurally-valid
top+bottom+shoe outfits built from the 123 pieces that pass the `casual` gate
(`scratch/measure_diversity_classifiers.js`):

| classifier | penalty | distinct buckets | largest bucket |
|---|---|---|---|
| formula family | −45 | **4** | 42% |
| silhouette | −35 | 4 | 42% |
| grounding strategy | −18 | 3 | 47% |
| visual rhythm | −16 | 3 | 52% |
| shoe shape | −14 | **2** | **93%** |
| print/stripe present | −20 | 2 | 66% |

**Four is the entire formula-family vocabulary, not a sampling artifact.** Formula family comes
from `WHOLE_WARDROBE_OUTFIT_ARCHETYPES` (`prompts.js`), which defines five families, one of
which (`dress_grounding_shoe`) requires a dress. Every separates outfit in the wardrobe therefore
falls into one of exactly four buckets, and two of them hold 82%.

**The consequence is arithmetic: a five-outfit set cannot avoid a formula repeat.** Five outfits
into four buckets is a guaranteed collision by pigeonhole, and in practice it happens by the third
outfit, because the top two buckets hold 82% of candidates. So the −45 — the largest single number
in the engine — is not an occasional tie-breaker; it fires on most sets. Every look after the
second is effectively selected on *which* repeat is cheapest, not on whether to repeat.

**Shoe shape is nearly a constant.** 93% of sampled outfits classify as `rounded`, the default
branch; `pointed`, `almond/oval` and `square` never appeared. Its −14 is close to a fixed offset,
in the same way `role_permission`'s +20 is in the workbench score.

This also explains the reused-shoe complaint in the handoff from a second direction: shoes carry
the weakest core-slot penalty (−20 against a top's −40) *and* the classifier that would otherwise
distinguish two shoes is effectively single-valued.

### The classifiers cannot see a third of the pattern data

`wholeWardrobeVisualRhythm`, `wholeWardrobeHasPrintOrStripe`, `wholeWardrobeFormulaType` and
`wholeWardrobeHeroPieceId` all test a regex —
`floral|print|graphic|stripe|striped|pattern|abstract|tapestry` — against `pieceNameBlob`, which is
`name + category + reads_as` (`rules.js`). They never read the structured `pattern_type`
column, which is populated.

Measured: **90 pieces have a non-solid `pattern_type`; 30 of them are invisible** to these
classifiers because their pattern word is not in the regex. The misses are systematic, not
marginal — `botanical`, `geometric`, `paisley`, `polka dot`, `lace` are all real `pattern_type`
values with no corresponding term:

> `paisley sleeveless blouse` (abstract) · `black cream botanical tiered midi skirt` (botanical) ·
> `black cream geometric maxi skirt` (geometric) · `white yellow polka dot cardigan` (geometric) ·
> `beige lace relaxed top` (other)

So a third of the patterned wardrobe reads as solid to the rhythm classifier and to the −20
print-repeat penalty. Two visibly patterned skirts can be selected back to back without either
penalty firing. One piece runs the other way: a single solid-tagged piece reads as patterned
because of a word in its name.

This is one of the grandfathered keyword sites the text-matching ratchet caps. Reading
`pattern_type` instead would make the classifier correct *and* lower the ratchet count — the
sanctioned direction of travel, not an exception to it.

Recency also lands here, clamped: `−min(piecePenalty, 40) − min(formulaPenalty, 35)` on
`localScore`, from the same 10-row session memory described above.

**Ranking differs by mode too:** `gate` mode sorts by stylistic strength before diversity; advisor
mode preserves the model's own order. Then `normalizeWholeWardrobeStrengths` labels positionally —
index 0 is `signature`, 1–2 `strong`, the rest `usable`. **Those labels are positions, not
judgements**, which is worth knowing before reading "signature" as an engine verdict.

**[expanded 2026-08-18] Multi-option comparison quality stays model-judged.** The visual composer
receives a volatile-tail contract asking for different formulas or silhouettes when the eligible
roster supports them; repeated activity-safe shoes remain legal. The advisor path intentionally
keeps `applyDiversity:false`, so the deterministic diversity selector does not replace a visually
judged card. `finalSelection.uniqueFormulaCount`, `uniqueSilhouetteCount`, and
`comparisonSetCollapsed` make a same-formula + same-silhouette result measurable for live review.
The collapsed flag describes the set; it neither rejects a card nor triggers another paid call.

**[expanded 2026-08-18] Live weather has two layers of authority.** `isHot`/`isCold` remain the
stable physical-gate contract. `highF`/`lowF` now travel alongside those booleans so the visual
stylist can judge sleeves, optional layers, and lived comfort inside the broad mild band. Bounded
freeform composition includes the numeric range in its volatile request tail and its deterministic
introduction; no additional provider call is made.

---

## The image-generation path

Mapped 2026-07-26. The app's most expensive operation. Traced by reading; the input payloads are
measured by `scratch/measure_image_path.js`, which runs the real reference builders (sharp only) and
**never constructs an OpenAI client**, so it costs nothing.

### One switch decides whether any of this is billed

`photoPreservingVisualsEnabled()` (`core.js`) returns true when `PHOTO_PRESERVING_VISUALS` is
set **or** `WARDROBE_MOCK_AI` is on. When true, every producer renders a **local sharp collage** of
real garment photos instead of calling a model. `hasOpenAiKey()` failing does the same. So there are
two renderer families, and the free one is the default in the sandbox.

**[known bug — dead duplicate, unfiled]** There are **two** functions with this name.
`rules.js` is a copy that checks only `PHOTO_PRESERVING_VISUALS` and **not** `mockAiEnabled()`.
`routes/ai.js` imports *that* one (its import block spans lines 52–116, from `rules.js`) — and never
calls it; the symbol appears exactly once in the file. So this is a latent trap, not a live leak:
the mock-mode protection is intact today because every live call site uses the `core.js` version.
But `routes/ai.js` is precisely where the image endpoints live, and the mock-unaware copy is already
imported and in scope there. Deleting the `rules.js` duplicate would remove the hazard outright.

### The producers

| function | renders | AI inputs |
|---|---|---|
| `createWholeWardrobeOutfitImage` | one outfit | ≤5 garments, with worn + hanger refs when both exist, + 2 calibration refs + prompt |
| `createSavedOutfitImage` | saved-outfit variants | source photo + worn + hanger refs when both exist |
| `createWholeWardrobeComparisonSheetImage` | up to 5 outfits on one sheet | one ref per unique piece across the 5, preferring worn evidence to cap cost |
| `createIdealAdditionsComparisonSheetImage` | directions sheet | worn + hanger refs for the selected garment when both exist |
| `createEditorialConceptImage` | ideal-addition concept | refs + anchor garment |
| `createOutfitBoardImage` | 2-3 candidate boards from the ad hoc "Generate visual boards" button (`POST /generate-outfit-boards`) | selected piece + owned/missing board pieces | **found 2026-07-27 — missing from this table since it was first written**; see `scratch/derive_board_producer_fanout.js`. |

All five call `client.responses.create` with **`model: 'gpt-4o'`** and
`tools: [{ type: 'image_generation', size, quality: 'medium' }]`. Quality is hard-coded. Size
resolves to **1024x1536** by default (`OPENAI_EDITORIAL_IMAGE_SIZE` / `OPENAI_IMAGE_SIZE` override).

`getOpenAIImageModel` / `getOpenAIImageFallbackModels` exist and explicitly reject `dall-e-2/3`,
but the five main paths never consult them — they hard-code `gpt-4o`. The chain resolves to
**gpt-image-1 → gpt-image-1.5 → gpt-image-1-mini → chatgpt-image-latest** and is reachable only
through `runOpenAIImageGeneration`, which has exactly one live caller: the editorial path's fallback.

### What actually gets sent — measured

Garment references are resized to 768px, JPEG q84, base64'd. Final single-outfit renders now send
both a worn and hanger photo when both exist: the worn image is labelled as authority for fit,
drape, body placement and real hem position; the hanger image is authority for construction,
colour, print scale, texture and garment shape. With no worn photo, the hanger caption explicitly
marks body fit and drape unconfirmed and tells the renderer to infer them conservatively from
structured garment data. Comparison sheets remain capped at one reference per garment, preferring
the worn photo, because they may contain 18 unique garments.

This improves the renderer's evidence but does not replace the wrong-length metadata-review path.
Some image complaints have correctly exposed mislabeled `length_hits_at` or `sleeve_type` values;
the field-specific task remains the way to correct those facts. Better photo delivery and metadata
review address different causes of the same visible symptom.

Across a 24-piece spread of the real
wardrobe (235 of 236 pieces have a usable photo): **min 50 KB, median 88 KB, max 152 KB, mean
95 KB** per photo. A five-garment final outfit can now send up to ten garment photos rather than
five, plus two calibration images and the prompt. This deliberately spends more input budget on
the final render; the many-garment comparison preview does not double its photo count.

At OpenAI's ~750 tokens for a 768px image, a three-garment final outfit with both photos for every
piece plus two calibration images is roughly **6,000 input tokens of imagery alone**, before prompt
text. The generated image is billed separately and dominates. Garments with only one photo retain
the prior cost shape.

Calibration references come from `getCalibrationReferenceImagesForGeneration`, which pulls a pool of
`max(limit × 4, 15)` rows, splits starred from unstarred, shuffles each, and takes starred first.
The real pool is **28 eligible rows — 13 `good_reference`, 15 `real_photo` — of which 15 are
starred.** Note this is the one `favorite` column in the database that *is* populated; the piece and
saved-board ones are not (see *Scoring → dead terms*). `real_photo` rows are captioned as identity
and proportion reference, `good_reference` as taste calibration.

### The fallback ladder

Editorial is the deepest: **gpt-4o → the four-model image chain → a hand-built SVG placeholder.** A
single failing editorial render can therefore attempt up to five billed generations before giving
up. The other four producers have a shallower ladder — gpt-4o, then straight to a local collage
tagged `fallback_collage`, which is free.

### Cost reporting — and where it is wrong

Cost is **not** computed by the server. `estimateAiUsageCost` (`provider.js`) prices text
tokens only, and its OpenAI table (`provider.js`) has entries for `gpt-5.x` and `gpt-4o` and
**no image model at all** — so it would return `pricingAvailable: false` for one.

Instead the number the user sees is computed **client-side** in
`StylistChat.jsx`, `calculateOpenAICost`, which re-hard-codes the rates ($2.50/Mtok in,
$10/Mtok out) and adds a **flat constant for the image**: `$0.08` for 1024x1536, `$0.04` for
1024x1024. That constant ignores quality, model, and how many attempts the server actually made.
It is rendered as *"Measured cost"* and is deliberately always visible, even with the debug flag
off — the comment cites "the product's paid-action honesty".

Two consequences follow directly:

1. **The label overstates its own precision.** Only the token half is measured; the image half —
   the dominant term — is a constant keyed on a string. A five-attempt editorial failure and a
   clean first-try render both report `$0.08`.
2. **[known bug — unfiled] The `gpt-image-1` fallback renderer reports no cost at all.**
   `calculateOpenAICost` returns `null` when `timings.usage` is absent. The collage paths set no
   usage and correctly show nothing — they are free. But the editorial `gpt-image-1` branch
   (`core.js`) also never sets `timings.usage`, so a **billed** generation renders with
   no cost line. The user sees a generated image and is told nothing about what it cost.

This is the concrete answer to panel finding A6 in the handoff: the `~$0.07` figures are neither
user pricing nor fully measured instrumentation. They are a client-side estimate with a constant
image term, and they silently vanish on one billed path.

### The prompts themselves

Two builders, and they describe the same garment very differently. Sizes measured against real
pieces: `wholeWardrobeImagePrompt` is **~3,900 chars (~980 tokens)** for a three-piece outfit;
`editorialImagePrompt` is **~5,800 chars (~1,455 tokens)** for a *single* anchor garment — larger,
because it splices four Style Constitution layers that the whole-wardrobe prompt does not.

**`wholeWardrobeImagePrompt`** (`core.js`) is four blocks: six blanket garment-fidelity rules
("do not simplify a printed top into a plain tee", "if two listed garments are both printed, keep
both actual prints recognizable", "do not add extra hero garments, belts, scarves"); a
**per-piece fidelity checklist**; a person/scene block (full figure, single adult woman, ordinary
realistic proportions, no beauty retouching, no text or watermark, "closer to a real try-on than a
fashion ad"); and the outfit's own label, direction, silhouette, mechanics and `watchFor` — the
`watchFor` line is passed as *"Avoid drift:"*, so the outfit-level warning becomes a rendering
instruction. Pieces are described with `buildPieceText`, the structured truth text.

**PR 188 closes a card-to-render truth gap.** Generated outfit/card payloads now retain the linked
piece records needed by the renderer instead of relying on the card's short rationale. Planner
rosters preserve the same render-relevant structural fields. `wholeWardrobeImagePrompt` converts
those records into positive visual directions — what the garment must visibly do — so a constraint
such as `tuck_behavior: wear_over_only` becomes an instruction to show the shirt hanging naturally
over the waistband. This is deliberately a general constraint-composition rule, not a catalogue of
forbidden tuck/belt/layer cases. Structured garment truth outranks card prose throughout.

The same provenance continues into evaluation. A generated render carries
`visualEvidenceType: generated_board`; its image block is labelled as an AI-generated styling
visualization, and linked reference images are individually labelled with garment identity and
category. The evaluator may judge the composition or call out a renderer error, but cannot infer
real tuck, fit, hem, placement, or construction from the synthetic board. A final cross-garment
validity instruction rejects a proposed action if any affected linked record forbids it. Saved
**My Outfits** do not use this rule: their first image remains the actual worn-photo authority.

**`editorialImagePrompt`** (`core.js`) splices `BODY_CONTRACT`, `PROVEN_FORMULAS`,
`AESTHETIC_GRAVITY`, `LANE_NEUTRALITY` and `EXPRESSIVE_HIERARCHY_RULES`, then a
category-conditional silhouette rule (a bottom or dress anchor gets "keep that exact length; do not
force a full-length lower half"), then `anchorFidelityInstructions`.

**Both are appended with `withSavedBoardRendererMemory`** — and unlike most of the memory systems
in this app, **this one is live.** On the real database it produces **6 correction lines**, all
genuine:

> *"denim mid-thigh shorts: prior render had pants, skirt, or dress rendered too short; match the
> saved garment reference length."* · *"black cream botanical tiered midi skirt: prior render had
> … rendered too long…"*

This is also the **only behavioural** consumer of the image-fidelity feedback types. It supplies
text only when the identified garment is being rendered; the rejected generated board is retained
as evidence and is **never** attached as a future visual reference. Recall that
`wrong_length`, `wrong_garment_details`, `body_proportions_drift`, `identity_drift` and
`bad_reference` are deliberately excluded from styling influence (*Scoring → feedback weights*).
The split is clean and worth stating: **image feedback steers the renderer, styling feedback steers
the composer, and neither leaks into the other.** A field-specific wrong-length reason can also
create a separate metadata-review task, but never changes garment truth automatically. Note one
asymmetry — `bodyProportionsDrift` and
`identityDrift` are latched *before* the piece-overlap check, so those two corrections fire from
any board's feedback, not just boards involving the requested pieces. They are properties of the
person, not the garment, so that reads as intended.

### The prompts ask about garments in keywords, not columns

Every fidelity rule in both builders is derived by regex over text, never from the structured
columns — the same pattern as the diversity classifiers, and here it is load-bearing for the
app's most expensive call.

**Three different regexes now answer "is this patterned?", and all three disagree:**

| asked by | reads | sees, of the 90 non-solid pieces |
|---|---|---|
| `pattern_type` column | — | **90** |
| image fidelity checklist | `pieceTextBlob` | 60 |
| diversity / rhythm classifier | `pieceNameBlob` | 72 |

The checklist's list has `botanical` and `paisley`; the classifier's has `print` and `graphic`
instead. Neither reads the column that knows the answer.

**The editorial path is the thinner of the two, and measurably so.** Its `pieceDesc` is
`name; category; colors; notes` — no `length_hits_at`, `sleeve_type`, `silhouette`, `fit_on_body`,
`hem_finish` or `fabric_category`. It also references **`selectedPiece.fabric`, a column that does
not exist** (the real ones are `fabric_category` / `fabric_weight` / `fiber_content`), so that line
never renders. `anchorFidelityInstructions` (`core.js`) then derives its rules from
`name + notes` alone:

| column | populated | stated in name/notes | resulting clause |
|---|---|---|---|
| `sleeve_type` | 207 / 236 | 48 | sleeve clause reaches 48 |
| `length_hits_at` | 207 / 236 | 53 | **no length clause exists in the builder at all** |
| `fit_on_body` | 164 / 236 | 84 | fit clause reaches 84 |
| `pattern_type` | 228 / 236 | 17 | stripe clause only; no floral/botanical clause |

**49 of 236 pieces produce no anchor fidelity instruction whatsoever.**

Put beside the renderer memory above, that is a closed loop worth naming: the most common recorded
render complaint is **wrong length**; `length_hits_at` is populated on **207 of 236 pieces**; and
the editorial fidelity builder has **no length clause**. The wardrobe knows the answer, the prompt
never states it, and the correction arrives afterwards as feedback. The whole-wardrobe path does
better here — `buildPieceText` carries `length_hits_at`, `silhouette`, `hem_finish` and
`fit_on_body` — which makes this an asymmetry between the two paths rather than a system-wide gap,
and the same shape as the Visual Composer athletic-pants incident already on record.

> **FIXED 2026-07-29.** `anchorFidelityInstructions` now reads the structural columns first and
> keeps the `name + notes` regexes only as the fallback for pieces that carry no tagged value, so
> nothing that produced a clause before stopped producing one. Measured over the live wardrobe:
> **206 of 243 active pieces now carry a length clause** (was 0), and the count producing no anchor
> fidelity instruction at all fell from **49 to 1**. `editorialImagePrompt` now describes the anchor
> with `buildPieceText` — the same truth text the whole-wardrobe path uses — which closes the
> asymmetry and removes the `selectedPiece.fabric` line that read a non-existent column. One clause
> was added beyond restoring parity: a tagged sleeve now says *do not cover it with a layer that
> would crush it*, from the bishop-sleeve incident. Also fixed at the source: `trustedFieldText`
> suppresses the tagger's not-applicable sentinel, so the truth text no longer emits `sleeve: none`
> on 59 bottoms, 13 accessories and 6 shoes. Tests: `test/editorialIdealAdditions.test.js`.
> The 900-character truncation below is **not** fixed.

**One more loss on the better path:** `wholeWardrobeImagePrompt` truncates each piece's truth text
at 900 characters, and the real median is **1,130** — so **169 of 236 pieces lose their tail**.
`buildWardrobePieceTruthText` appends in a fixed order, with `fit_on_body`, tuck behavior,
occasions and trust status last, so those are the fields that fall off the end.

---

## The tagger prompt — where every column comes from

Mapped 2026-07-26. `tagPieceWithProvider` (`routes/ai.js`) is the call that populates
`formality`, `fabric_weight`, `length_hits_at`, `sleeve_type`, `pattern_type`, `occasions`, the
style lanes and the whole `style_profile_json`. **Every number elsewhere in this document is
downstream of it.** Measured by `scratch/measure_image_path.js`.

### What is sent

| part | size |
|---|---|
| `TAG_PIECE_PROMPT` | **21,151 chars ≈ 5,290 tokens** |
| `TAG_PIECE_SYSTEM` | ~1,100 chars |
| wardrobe calibration anchors (text) | 2,059 chars, 18 anchors |
| garment photo @1568px | ~2,220 tokens each (import sends 1; add-piece can send 2) |
| up to 8 anchor thumbnails @448px | ~1,560 tokens total |
| output cap | 2,500 tokens |

The prompt has four sections: a **photo property authority map**, a **physical property framework**,
**descriptive cues and labels**, and **calibration anchors**.

### The authority map is the most interesting part

Before tagging anything the model must classify each image on two booleans — `fit_visible` and
`real_context` — and authority then follows those properties rather than the photo's label:

- Flat, even-lit garment photos are authoritative for colour, pattern, fabric surface,
  construction, neckline, sleeve existence.
- Fit-visible photos are authoritative **only** for `fit_on_body`, drape, `length_hits_at`,
  `tuck_behavior`, `waistband_type`, on-body silhouette.
- Real-context photos are positive evidence for occasion register, never negative.

Then seven conflict rules, of which two are doing real work: *"the worn photo owns how the garment
behaves, never what the garment is"*, and an explicit **context-insulation** rule — *"a polished
shell photographed at home with shorts is still a polished shell; home setting, shorts, bare legs,
or casual styling must not drag its lanes or occasion confidence toward casual."* When photos
disagree the instruction is to **lower confidence rather than silently pick**, and to emit a
`cross_photo_agreement_note`. That is why `_confidence` exists on every field, and it is the
mechanism behind `trustedFieldText` and `getFieldConfidence` used downstream.

### Two kinds of calibration anchor

**Static** — three archetypes hard-coded in the prompt (basic ribbed tank, stiff cotton
button-down, refined textured statement top), each with full expected lane scores and occasion
confidences, framed as *"range calibration, NOT templates to match."* They exist to set the width
of the scoring range so quiet pieces do not collapse to 1/5 across every lane.

**Dynamic** — `buildAnchorBlock` (`taggerMerge.js`) injects real pieces from *this* wardrobe
under the header *"These assignments are ground truth for THIS wardrobe — calibrate to them, not to
general fashion norms."* Two fields are anchored: `formality` and `fabric_weight`, up to 3 examples
per distinct value, each with a low-detail 448px thumbnail (capped at 8 images, so 18 anchors are
listed in text but only 8 illustrated).

**The anchors are built exclusively from pieces the owner has manually corrected** — the bucket
loop skips any piece whose field is not in `manual_overrides`. So the tagger's calibration is
literally a feedback loop on owner corrections, and it currently carries **18 anchors, 11 for
`formality` and 7 for `fabric_weight`.** Its cost also grows with correction count.

### Owner corrections — and what they settle

**228 of 236 pieces carry at least one manual override.** By field:

| field | pieces corrected |
|---|---|
| **`formality`** | **202** |
| `fit_confidence` | 72 |
| `occasions` | 38 |
| `fiber_content` | 37 |
| `fabric_category` | 28 |
| `fabric_weight` | 13 |

**This resolves the register-ceiling question, and reverses the recommendation made earlier in this
document.** Under *The gates* the finding was that 52 of the 91 blocked `elevated` pieces are also
tagged `casual`, and one suggested resolution was to let an explicit `casual` occasion tag override
the ceiling — on the precedent that user tags override AI profile confidence. **Checking
provenance shows that precedent does not apply here.** Of those 52 pieces:

- **49 have owner-corrected `formality`** — `elevated` is a deliberate ruling, not tagger drift.
- **Only 5 have owner-corrected `occasions`** — for 47 of the 52 the conflicting `casual` tag is
  *auto-tagger output*.

So the conflict is overwhelmingly **an owner ruling against an auto-tag**, and the gate reading
`formality` is reading the more authoritative column. Letting the occasion tag win would let tagger
output override the owner on 47 garments — the opposite of the precedent it was justified by. The
`elevated` tag has not drifted; it is the most curated field in the wardrobe.

What remains is a genuinely small question: **the 5 pieces where the owner set both** `elevated`
and `casual` by hand. That is a five-row list, not a policy decision.

### Merge protection

`applyTaggerResult` (`taggerMerge.js`) normalises `fiber_content`, `formality`, `heel_height`
and `walk_support`, then merges through `mergeWithManualOverrides` — **a manually-overridden field
is never overwritten by a re-tag**, at both top level and inside `style_profile_json`, with
`pinManualConfidence` forcing confidence on those fields. This is what makes re-tagging safe and
why the anchor loop can trust `manual_overrides` as ground truth.

### The prompt is scar tissue, and it shows

Much of both prompts is corrections for specific past failures, stated as prohibitions: *"do not
collapse lavender into taupe"*, *"do not mark every floral or botanical item as
modern_bohemian"*, *"leather and suede jackets default to elevated, not dressy"*, *"knit dresses
are not inherently dressy"*, *"ruffle detailing alone does not lift a piece out of everyday"*. The
`home` occasion is constrained **three separate times** across system and user prompt — twice in
the system prompt alone — which is a reliable signal of a mis-tag that kept recurring.

Note the formality definitions are explicitly calibrated to *"THIS wardrobe's artisan-nice
baseline"*, with `everyday` defined so that *"artisan texture, linen, and basic knits do NOT lift a
piece out of everyday on their own."* Read alongside the 202 formality corrections, the picture is
of a field that was hard to get right and was fixed by hand at scale.

### The cost gate under-quotes

`routes/importer.js` prices bulk tagging at `TAG_EST_INPUT_TOKENS = 6000` and
`TAG_EST_OUTPUT_TOKENS = 1400` per new-piece cluster, and that estimate is what the preflight
endpoint shows before asking for `{approve: true}`. Measured against the real payload:

| | preflight | measured |
|---|---|---|
| input | 6,000 | **~9,880** (6,097 text + ~2,220 photo + ~1,557 anchor thumbs) |
| output | 1,400 | cap is **2,500** |

**The prompt text alone is 6,097 tokens — it exceeds the entire input estimate before a single
image is attached**, so the estimate cannot have accounted for imagery at all. Input is
under-quoted by roughly **1.6×**. The output figure is only an underestimate if the tagger emits
near its cap, which this cannot measure without a billed call — so treat the input number as the
solid finding and the output number as unverified.

Two consequences: the one place the app asks permission before spending systematically quotes low,
and because the anchor block grows with owner corrections, **the gap widens as the wardrobe gets
better curated.**

---

## Roles — what decides an outfit's formula family

Mapped 2026-07-26 by `scratch/measure_roles.js`. `inferOutfitArchetype` scores each archetype by
which **roles** a piece set yields, and the winning archetype's `formulaFamily` is what the **−45**
diversity repeat penalty keys on. So this classifier sits upstream of the largest number in the
engine.

### It is the one classifier that respects confidence — by dropping data

`inferWholeWardrobePieceRoles` (`rules.js`) builds its text from `pieceNameBlob` **plus**
structured columns — `pattern_type`, `pattern_complexity`, `fabric_category`, `fabric_weight`,
`background_color`, `reads_as`, colors, notes. That already makes it better informed than the
pattern classifiers, which read names only.

But `silhouette` and `fit_on_body` are wrapped in `trustedField()`, and **`trustedField` drops a
low-confidence value entirely** rather than annotating it the way `trustedFieldText` does. Given
the confidence distribution under *Provenance*:

> `silhouette` reaches the role blob on **38 of 236** pieces.
> `fit_on_body` reaches it on **35 of 236**.

So for ~85% of the wardrobe, formula-family classification runs with no silhouette or fit signal at
all. This is the stale-tagger problem propagating into diversity: re-tagging would change what
counts as a repeat, not just what the image prompt says.

### The vocabulary comes from two sources and they do not agree

Roles arrive from the tagger (`style_profile_json.roles`, `visual_roles`, `best_outfit_role`) *and*
from hard-coded regex rules. The two use different names for the same concept:

| tagger-written | code-written |
|---|---|
| `support` (77) | `support_piece` (92) |
| `hero` (51) | `hero_piece` (58) |
| `grounding` (33) | `grounding_piece` (71) |

The archetypes reference only the code-written forms, so the tagger's `hero`, `support` and
`grounding` — plus `texture_piece` (86), `color_accent` (48), `quiet_anchor` (36),
`movement_piece` (25), `sharpener_piece` (8), `column_piece` (8) and `texture_accent` (11) — are
produced on every generation and **matched by no archetype**. They are inert vocabulary, carried
through the whole pipeline and scored on by nothing.

Most-frequent roles overall: `soft_texture` 45%, `support_piece` 39%, `texture_piece` 36%,
`graphic_element` 36%, `beige_sludge` 31%, `grounding_piece` 30%. Only 5 of 236 pieces yield no
role at all.

### [known bug — unfiled] Singular-only regexes miss plural garment names

Garment names are overwhelmingly plural for footwear — *"black slip-on loafers"*, *"brown leather
zip ankle boots"*. The classifiers test **singular** forms with word boundaries, and `\bloafer\b`
does not match `loafers`.

Measured on the 33 shoes, against `wholeWardrobeShoeShape`'s
`/\b(round|loafer|boot|sneaker)\b/`:

| | default `rounded` | `rounded/square` | `pointed` |
|---|---|---|---|
| as written | **30** | 1 | 2 |
| plural-tolerant | 22 | **9** | 2 |

**Eight shoes leave the default bucket the moment plurals match.** This substantially explains the
"93% of outfits classify as `rounded`" result reported under *After the gate → classifiers* — that
was read as real uniformity in the wardrobe, and it is largely a regex bug. Correcting it would
make the −14 shoe-shape diversity penalty discriminate where today it is nearly a constant.

The same miss hits `inferWholeWardrobePieceRoles`: four shoes fail to earn `sharp_finish` purely on
plural forms — *black floral cutout mules*, *brown leather zip ankle boots*, *black slip-on
loafers*, *taupe suede ankle boots*. `sharp_finish` is a `preferredRole` of `dress_grounded_sharp`,
so this changes archetype scoring too.

This is a bug class, not one site — swept below.

---

## [known bug — unfiled] The singular/plural gap, swept

Mapped 2026-07-26 by `scratch/measure_plural_gap.js`, which extracts every literal keyword
alternation (`/\b(a|b|c)\b/`) from `styling-engine/` and tests each term against the real wardrobe
in singular and plural form. **512 distinct singular keywords** across 16 files. Garment names are
overwhelmingly plural — *"dark blue bootcut denim jeans"*, *"black slip-on loafers"* — and a
word-boundaried singular does not match them.

**19 keywords miss garments whose own name carries the plural; 122 garment-matches are lost.**
Counting by *name* rather than by text blob, so these are unambiguous — the garment **is** the
thing, not merely mentioned in another piece's notes:

| keyword | pieces matched | garments missed by name | sites using it | |
|---|---|---|---|---|
| `shoe` | 1 | **33** | 4 | |
| `pant` | 1 | **28** | 10 | |
| `short` | 7 | 11 | 5 | |
| `jean` | **0** | 8 | **16** | **never fires** |
| `sandal` | 1 | 8 | 7 | |
| `trouser` | 3 | 7 | 17 | |
| `sneaker` | **0** | 5 | 8 | **never fires** |
| `heel` | 3 | 5 | 2 | |
| `flat` | 3 | 3 | 5 | |
| `boot` | 1 | 2 | **28** | |
| `loafer` | **0** | 1 | **25** | **never fires** |
| `clog` | **0** | 1 | 4 | **never fires** |
| `pointed heel` · `tailored trouser` · `linen short` | **0** | 2 · 2 · 1 | 1 each | **never fire** |

**Six keywords never fire at all on this wardrobe** — `jean`, `sneaker`, `loafer`, `clog`,
`pointed heel`, `tailored trouser`, `linen short` — and they are referenced at 16, 8, 25, 4 and 1
sites respectively. `boot` is used at **28 sites** and matches **one** garment. `shoe` matches one
garment while 33 are named `…shoes`.

**Why this matters more than its size suggests.** These are not exotic terms; they are the core
garment vocabulary the engine reasons in. Rules keyed on them — grounding strategy, shoe shape,
formula type, boho signal, occasion scoring, `isLightweightLinenBottom`, the image fidelity
checklist — are silently inert for the garments they were written for.

**It also means several distributions reported earlier in this document are understated.** The
"93% of outfits classify as `rounded`" result under *After the gate → classifiers* was read as real
uniformity in the wardrobe; eight of 33 shoes leave that bucket the moment plurals match. Any
keyword-derived number in this map should be re-measured against the plural-tolerant form before it
is acted on. That is what the script is for.

**What it is not.** Profile lists (`preferred_footwear: ["loafers", "sandals"]`) already use
plurals and go through `pieceMatchesFootwear`, which builds its regex from the profile string — so
the occasion and activity profiles are unaffected. This is confined to hard-coded regexes in
`rules.js`, `core.js` and `attributes.js`.

### But a blanket `s?` sweep is the wrong fix — measured

The obvious remedy is to add `s?` everywhere. Running the two shoe classifiers both ways over the
same 600 outfits shows that would help one and harm the other:

| classifier | as written | plural-tolerant |
|---|---|---|
| shoe shape (−14) | 93% in default `rounded` | **53% / 47% split** — now discriminates |
| grounding strategy (−18) | 47% in `soft casual grounding` | **80%** in `soft casual grounding` — worse |

Shoe shape improves exactly as expected. **Grounding gets more concentrated, not less**, because
the newly-matching plurals (`sneakers`, `sandals`, `flats`) all fall into the same
`soft casual grounding` branch, collapsing three buckets toward one. The −18 penalty would then
fire on 80% of pairs instead of 47%.

So the bug is real everywhere, but **the fix has to be evaluated per classifier**: correcting the
regex changes which bucket a garment lands in, and for grounding the branch order is what needs
attention, not the plurals. Anyone applying a mechanical `s?` sweep across the 19 keywords would
improve the shoe-shape penalty and quietly degrade the grounding one.

The ratchet counts these sites as text-matching debt already, so fixing them in place does not
raise the baseline — and reading the structured column instead, where one exists, would lower it.
`heel_height` and `walk_support` already exist as enums for exactly this footwear question.

---

## `extract-pieces` — the tagger's weaker sibling

`POST /api/ai/extract-pieces` (`routes/ai.js`) takes one outfit photo and returns every garment
in it. It shares the tagger's *schema* and almost none of its *machinery*. What it does **not**
send, all of which the tagger does:

- **No calibration anchors.** No wardrobe ground-truth block, no *"calibrate to THIS wardrobe"*
  instruction, no anchor thumbnails. It tags against general fashion norms.
- **No photo-property authority map.** No `fit_visible` / `real_context` classification, so none of
  the conflict-resolution or context-insulation rules apply — from a single worn photo, which is
  exactly the case the authority map was written for.
- **No `_confidence` map.** The schema has no confidence field at all. Downstream,
  `getFieldConfidence` falls back to **`medium`** for anything not in
  `STRUCTURE_FIT_CONFIDENCE_FIELDS`. So extract-pieces output is treated as *more* trusted than the
  real tagger's own low-confidence output, despite being derived from less evidence.
- **No `style_profile_json`.** No style lanes, no `garment_intelligence`, no occasion confidence,
  no roles — so pieces created this way contribute nothing to `profileRoles` in the role classifier
  and have no `auto_use_trust` for the gate to read.
- **No salvage on parse failure.** The tagger catches a chatty response with `salvageFirstJson`;
  this calls `parseModelJson(raw)` bare and 500s.

It is also the one call site that logs the **entire raw model response** to the server log on every
request (`console.log('RAW RESPONSE LENGTH:', raw?.length, 'RAW RESPONSE:', raw)`) — left-in debug
output, not a mechanism.

**[latent inconsistency] It instructs a fabric-weight vocabulary the engine cannot read.** The
schema says: *"for SHOES use the shoe scale instead: delicate|slim|medium|chunky."* But
`fabricWeight()` (`attributes.js`) recognises only `heavy`, `ultralight`, `light`,
`lightweight`, `medium` — anything else returns `null`, and nothing normalises the shoe scale.
A shoe tagged `chunky` would read as having no fabric weight at all, silently skipping the capsule
summer terms and the `+5 light` workbench term.

No such value exists in the database today (`fabric_weight` is only medium/light/heavy/ultralight),
so this is **not currently firing** — the value is presumably dropped before persistence, which is
the enumerate-and-drop behaviour already on record for the piece forms. Latent, not live; worth
fixing when the shoe scale is either implemented or removed from the prompt.

---

## Provenance — who set the value the engine decides on

Mapped 2026-07-26 by `scratch/measure_provenance.js`. **This section exists because provenance
reversed two recommendations in this document.** A conflict between two columns is not symmetric
when one side is a hand-correction and the other is model output — check which is which *before*
proposing a fix that resolves one against the other.

    node scratch/measure_provenance.js                      # the whole table
    node scratch/measure_provenance.js formality occasions   # cross-tab two columns

### The table

| column | owner-set | populated | what it decides |
|---|---|---|---|
| **`formality`** | **202** | 229 | register ceiling — the largest single exclusion |
| `fit_confidence` | 72 | 236 | +30 workbench term, auto-use trust |
| `occasions` | 38 | 233 | occasion gate, +35 workbench term |
| `fiber_content` | 37† | 201† | hot-weather insulating-fiber clause, wet-exposure footwear clause, capsule summer term |
| `fabric_category` | 28 | 230 | weather + profile material rules |
| `name` | 17 | 236 | **every keyword classifier in the engine** |
| `season` | 16 | 236 | not gated directly |
| `fabric_weight` | 13 | 236 | hot/cold weather gate |
| `notes` | 12 | 191 | engine-notes suppression, image prompts |
| `colors` | 10 | 234 | capsule neutral term |
| `fit_on_body` | 10 | 164 | image truth text |
| `length_hits_at` | 8 | 207 | image truth text |
| `walk_support` | 4 | 33 | activity footwear gate |
| `sleeve_type` / `silhouette` | 3 each | 207 / 190 | bareness gate, image truth |
| `pattern_type` | 1 | 228 | capsule solid term |
| **`heel_height`** | **0** | 33 | activity footwear gate — **entirely tagger-set** |
| **`recommendation_status`** | **0** | 236 | auto-use trust gate — **entirely tagger-set** |
| **`role_permission`** | **0** | 236 | auto-use trust gate — **entirely tagger-set** |

† `fiber_content`'s owner-set/populated counts are as of the 236-piece pass and not re-measured
here — only its "what it decides" cell was corrected, after tracing two consumers this table
previously omitted (`pieceHasWetSensitiveFootwearMaterial`, `capsuleVersatilityScore`'s summer
term — see *Gate-field coverage* above for what's actually live vs. latent about each). The
wardrobe is 242 active pieces as of this correction, 6 more than this table's baseline. Re-run
`node scratch/measure_provenance.js` for current counts on any row before relying on them.

`formality` is an outlier by an order of magnitude — 86% hand-corrected. Everything else the gates
read is predominantly or entirely model output. Note the two trust-gate columns with **zero**
owner input: they are also the two shown under *Scoring* to be non-discriminating (`trusted` on
226/236, `auto` on 235/236). A field nobody has ever corrected and that has one value everywhere is
not a signal.

### The tagger hedges on most of what it reports

`getFieldConfidence` returns the tagger's own `_confidence` value per field. Across the wardrobe:

| field | low | high | medium | manual |
|---|---|---|---|---|
| `length_hits_at` | **191** | 33 | 4 | 8 |
| `fit_on_body` | **201** | 19 | 6 | 10 |
| `silhouette` | **198** | 27 | 8 | 3 |
| `hem_finish` | **200** | 29 | 5 | 2 |
| `sleeve_type` | **191** | 39 | 3 | 3 |
| `formality` | 0 | 18 | 16 | **202** |

**The tagger reports `low` confidence on roughly 85% of its own structural predictions.** That is
not a malfunction — it is the prompt working as designed. The authority map instructs it to *"never
infer fit, drape, or length from a photo that is not fit_visible"* and to leave such fields
low-confidence.

> #### Amendment, 2026-08-08 — most of that 85% is not a tagger judgment at all
>
> The paragraph above reads every `low` as the tagger hedging. On pre-v2 pieces it is not: it is a
> **normalization default for an absent value**, and some of those values were typed by the owner.
>
> `normalizeConfidenceMap` ([`taggerMerge.js`](../styling-engine/taggerMerge.js)) ends with:
>
> ```js
> return [field, VALID_CONFIDENCE.has(confidence) ? confidence : 'low']
> ```
>
> Anything not already `high`/`medium`/`low`/`manual` becomes `low`. A garment tagged before the
> `_confidence` map existed has no entry, so it normalises to `low` — recording "provenance
> unknown", not "the tagger was unsure".
>
> **The distribution proves it. A rating process does not emit exactly one value.** `fit_on_body`,
> by tagger era, across 242 active pieces:
>
> | era | pieces | low | medium | high | manual |
> |---|--:|--:|--:|--:|--:|
> | (unversioned) | 164 | **134** | **0** | **0** | 28 |
> | `v1.0.0` | 11 | 7 | **0** | **0** | 4 |
> | `v2.0.0-photo-property-authority` | 67 | 28 | 6 | 25 | 8 |
>
> **Zero mediums before v2 on every structural field**, against a genuine spread after it. The
> claim is about the *shape* of the distribution, not a categorical absence: pre-v2 `length_hits_at`
> carries a handful of `high` values (`silhouette` and `hem_finish` carry none). **[unverified]**
> where those came from — an older tagger that emitted confidence, or an import. They are the
> exception that the wording must survive, not evidence against the reading: a rating process that
> never once returns `medium` across hundreds of pieces is not rating.
>
> Counts here are a 2026-08-08 snapshot and move as fields are re-confirmed; regenerate with
> `node scratch/measure_feedback_surface.js` §9.
>
> **Owner, 2026-08-08:** *"those values are there bc I put them there… probably just done before the
> user-tagged tag was introduced."* Provenance is recorded from v2 onward — `manual_overrides` and
> `_confidence.<field> = 'manual'` agree exactly, and `getFieldConfidence` falls back between them —
> but a value entered before either mechanism existed cannot be distinguished from an absent one.
>
> **Consequences, both live.** `trustedFieldText` renders these as
> `fit: [low confidence - add worn photo] skims` — telling the model to discount owner-entered data,
> and asking for a photo most of those garments already have (119 of the 132 fit-relevant pieces
> still at `low` on 2026-08-08; the count falls as the owner re-confirms fields by hand, so re-measure
> rather than citing it). `manifestValue` appends `?`
> to the same values throughout the wardrobe manifest. And `trustedField`
> ([`attributes.js`](../styling-engine/attributes.js)) accepts only `manual`/`high`/`medium`, so
> `attributePieceTextBlob` **drops** `fit_on_body`, `silhouette`, `tuck_behavior` and
> `waistband_type` entirely on these pieces — the value exists and search cannot see it.
>
> **Do not "fix" this by re-tagging.** That would overwrite owner-entered values with model guesses.
> Two options: introduce a provenance value distinct from `low` — `legacy` or `unrated`, meaning
> "recorded before provenance was tracked" — and exempt it from the low-confidence warning, the `?`
> suffix and the `trustedField` rejection; **or** the owner re-confirms the fields by hand, which
> marks them `manual` correctly, since the piece editor sets a field manual on any interaction with
> it. A new value must be added to `VALID_CONFIDENCE` (`taggerMerge.js`) or
> `normalizeConfidenceMap` will convert it straight back to `low`, and to all three
> `getFieldConfidence` implementations (`wardrobeAiContext.js`, `attributes.js`,
> `rules.js`) or they will disagree about the same garment.

**[by design]** Low confidence does **not** suppress the value downstream. `trustedFieldText`
(`wardrobeAiContext.js`) prefixes it instead: `length: [low confidence - add worn photo] midi`.
So the image prompts *do* carry the length — annotated with a disclaimer that it is unreliable, on
81% of pieces. That refines the finding under *The image-generation path*: the whole-wardrobe
prompt states a length, and simultaneously tells the renderer not to trust it.

### The real cause of the length problem — stale tags, not prompt construction

| tagger_version | pieces |
|---|---|
| **(unversioned)** | **167** |
| `v2.0.0-photo-property-authority` | 58 |
| `v1.0.0` | 11 |

**71% of the wardrobe was tagged before the photo-authority prompt existed.** Only **64** pieces
carry any photo-property judgment, and 57 have `fit_visible` set on some photo — essentially
exactly the v2 population.

Where the authority section actually ran, it works:

> low-confidence `length_hits_at` across all pieces: **191 / 236 (81%)**
> low-confidence `length_hits_at` among `fit_visible` pieces: **24 / 57 (42%)**

Structural confidence is roughly **twice as good** on pieces the current prompt tagged. And this is
not simply "no worn photos" — **176 of 236 pieces have a worn photo**; 144 of the 191
low-confidence-length pieces have one. The photos exist; the old tagger never classified them.

**This reorders the fix list under *The image-generation path*.** The editorial prompt's missing
length clause is real, but it is the second-order problem. The first-order problem is that the data
it would state is low-confidence on 81% of the wardrobe because those pieces were tagged by a
prompt that predates the section designed to fix exactly this. Re-tagging is upstream of every
prompt change.

**Re-tagging is billed, and here is the number.** 167 unversioned pieces at the measured ~9,880
input and the 2,500-token output cap, priced with the app's own table for
`anthropic / claude-sonnet-4-6`:

> **≈ $11.21** — $4.95 input, $6.26 output. Output is priced at the *cap*, so this is an upper
> bound; actual emission is likely lower.

`applyTaggerResult` never overwrites a manually-overridden field, so a re-tag **cannot undo the 202
formality corrections** or any other owner ruling. That is what makes this safe to consider — and
it is the reason the merge protection mapped under *The tagger prompt* matters.

**This is an owner decision, not something to run.** It is recorded here as a costed option.

### Re-tagging is not the first move — owner ruling, 2026-07-26

An earlier draft of this section said "re-tag first, then fix the prompt." **That is wrong and is
withdrawn.** The owner's position, which the data supports:

> This wardrobe has already been re-tagged **multiple times**. Each pass is only as good as the
> tagger was on the day it ran. The 167 unversioned pieces are not evidence that a re-tag is
> overdue — they are the *residue of previous re-tags* that predate the current prompt. Doing it
> again against a tagger with known gaps just buys another generation of data to redo.

So the ordering is: **raise the tagger's ceiling first, re-tag once afterwards.** The $11 is not
the constraint; spending it on a tagger that is not yet at its best is. Treat every item below as
blocking the next re-tag, not as optional polish.

### What would raise the tagger's ceiling — findings from this map

**1. Calibration anchors cover two fields out of the several that gate.**
`tagPieceWithProvider` calls `buildAnchorBlock` with `fields: ['formality', 'fabric_weight']`
(`routes/ai.js`). Measured, on the corrections that already exist:

| anchor fields | anchors produced |
|---|---|
| `formality` + `fabric_weight` (today) | **18** — 11 + 7 |
| add `occasions` | **49** — +31 |
| add `fit_on_body` + `length_hits_at` too | **67** |

`occasions` is the second-largest gate input (the occasion gate, the +35 workbench term, capsule
versatility) and **38 owner corrections for it already exist and are unused for calibration.**
Adding it to that array is a one-line change.

**Two honest caveats before doing it.** `occasions` is an *array*, and `buildAnchorBlock` buckets by
the joined string — so each distinct combination becomes its own bucket, which is why 38
corrections yield 31 anchors. Anchoring on a set is weaker calibration than anchoring on a scalar
like `formality`, and 31 near-unique anchors may read as noise rather than as a range. And more
anchors means more tokens per tag, on a call whose cost is already under-quoted by 1.6×. Worth
measuring the anchor block's token cost against its benefit before shipping — not an obvious win.

**2. Two gate columns cannot be anchored at all.** `heel_height` has **0** owner corrections and
`walk_support` has **4**, so no anchor bucket can form for either. Both feed the activity
footwear-comfort gate, and `heel_height` is 100% tagger-set (see the provenance table). If that
gate matters, the missing input is owner corrections, not prompt text.

**3. Only 8 of 18 anchors get a thumbnail.** `anchorThumbsForTagger` caps at `limit = 8`
(`routes/ai.js`) while the text block lists all 18. Which 8 depends on bucket iteration order,
not on importance — so the illustrated anchors are effectively arbitrary. Worth making
deliberate before a run that re-tags the whole wardrobe against them.

**4. The singular/plural gap is upstream of tagging too.** The tagger writes `name` and `reads_as`;
every downstream keyword rule then reads those. Re-tagging into an engine where `jean`, `loafer`,
`sneaker` and `clog` never match is spending money to feed classifiers that cannot see the result.

**5. `extract-pieces` emits no `_confidence` map**, so anything added through it is treated as
`medium` trust. If a re-tag is meant to establish a confidence baseline, that endpoint currently
undermines it.

**Not blocking:** the editorial image prompt's missing length clause and the `pattern_type` blind
spot in the classifiers are *consumer-side* — they misread good data rather than producing bad
data, so they can be fixed on either side of a re-tag.

### Tagging cost — the adoption barrier, not a personal budget line

**Owner reframing, 2026-07-26:** *"it's not just my tagging — the largest barrier for my users to
start using the app is bringing in/tagging their wardrobes."* So tagger spend is a **per-signup
onboarding cost**, paid on the user's own key (BYOK shipped in spec 33). Optimising it is an
adoption problem, and everything below is scoped that way.

**[known bug — unfiled] A new user gets zero calibration anchors.** `buildAnchorBlock` only buckets
pieces whose field is in `manual_overrides`, so a wardrobe with no corrections yields an **empty
anchor block** — verified. The wardrobe-calibration mechanism, the thing that makes the tagger
good, is **unavailable to precisely the population whose first impression decides adoption**. It is
rich-get-richer by construction: the tagger is at its worst on day one and improves only as the
user corrects it. Any cold-start quality work has to come from the static prompt, because the
dynamic half does not exist yet.

**Cost of onboarding, measured** (cold start: no anchors, no anchor thumbnails, so ~5,582 prompt
tokens + one ~2,226-token photo + up to 2,500 output):

| | 50 garments | 200 garments |
|---|---|---|
| today — sonnet-4-6, no caching | $3.05 | **$12.18** |
| + prompt caching | $2.29 | $9.17 |
| + haiku-4-5 | **$0.76** | **$3.06** |

**Output is 56% of the bill** ($0.0375 of $0.0671 per garment at sonnet), so prompt trimming
attacks the smaller half. The levers in order of measured value:

1. **Model tier — 67%.** The importer already runs haiku for classification, detection, crop
   verification, clustering and merge matching; only tagging uses the full stylist model. This is
   the one lever with real quality risk, and it is exactly what an evaluation harness should
   decide.
2. **Prompt caching — 31%, quality-neutral, currently impossible.** `tagPieceWithProvider` sets no
   `cache_control` at all, and cannot benefit until the content array is reordered: the per-piece
   photo is pushed **first** (`routes/ai.js`), before the anchors and the prompt, and a cache
   prefix must be contiguous from the start. Reorder to *[prompt + anchors] → [photo]*, then mark
   the prefix. The machinery already exists (`provider.js` → `PROMPT_CACHE_BREAKPOINT`,
   `systemToAnthropicBlocks`) and is used by the stylist conversation path.
3. **Output schema — attacks the expensive half.** `cross_photo_agreement_note` is explicitly
   demanded by the prompt (*"Always emit a brief cross-photo agreement note"*) and then **deleted**
   in `applyTaggerResult` (`taggerMerge.js`) — paid tokens discarded on arrival. The rest of
   the schema needs the same field-by-field trace; several sub-fields *are* consumed, so this is an
   audit, not a guess.
4. **Latency is a second adoption barrier.** Tagging is one call per garment, sequential, while the
   importer batches every other stage (10 images per classify call, 12 per cluster sheet). A
   200-garment onboarding is 200 serial calls. Batching amortises the prompt, but caching already
   does most of that — the real prize here is wall-clock, not dollars.

**Consequence for the evaluation harness:** the question it must answer is no longer "did my prompt
edit help" but **"does haiku tag well enough for a cold-start user"** — and it must be tested in the
*cold-start configuration*, with the anchor block stripped, not against this wardrobe's 18 anchors.
Testing warm would measure a configuration no new user ever sees.

### Prior rulings a tagger spec must respect

Checked across `docs/` 2026-07-26, because several of these would have made the suggestions above
wrong or redundant.

- **Optimising the tagger is already owner-sanctioned as a priority.**
  `ui-v1-design-handoff.md` (issue 5, owner 2026-07-26): *"The single most expensive step is AI
  tagging… **Optimising the tagging step may be the better first move**, and it pays off across
  every import path and the wardrobe generally — not just video."* So the spec's frame is **not**
  "make re-tagging cheaper" — it is "make tagging better everywhere", with the video-import
  decision explicitly downstream of it.
- **[ratified] "AI retagging reports what changed, leaves results reviewable, and cannot race
  Save."** `ui-v1-design-handoff.md`, PieceDetail acceptance criteria. Capture-then-apply is this
  principle at batch scale — cite it rather than proposing it as new.
- **[by design] Nothing is retagged automatically.** Surface map → Tasks: retag-suggestion todos
  name the field to review, and *"the sheet states at the point of capture that nothing is
  retagged automatically."* Any apply step stays a deliberate owner action.
- **[OPEN — needs owner agreement, do not assume] Worn-photo scope.**
  `ui-v1-design-handoff.md`: *"the UI promises a fit note, while the current AI tagging path can
  revise broader identity and style fields. Prefer scoping worn-photo analysis to fit, drape, and
  wear behavior unless the broader draft is made explicit and separately reviewable."* The engine's
  photo-authority map already approximates this — worn photos are authoritative only for
  `fit_on_body`, drape, `length_hits_at`, `tuck_behavior`, `waistband_type`, on-body silhouette —
  but the product decision is unresolved, so a spec must not quietly settle it.
- **Any field change costs 9 wiring points**, and *"tagger prompts ×2"* is the first of them
  (`freeform-rearchitecture-handoff.md` → new tag field checklist). That settles the scope
  question: **`extract-pieces` travels with `tag-piece`**; they are already treated as a pair.
- **`occasions.js` is frozen and its standing rules bind.**
  `occasion_profiles_ratification.md`: profile prohibitions may encode **validity only**,
  taste-adjacent entries are always SOFT; mood text may trigger a profile only via strong activity
  words, never generic ones; model-added entries are `[proposed]` and inert until ratified. A
  tagger spec may change what the tagger *emits*, not what the profiles *mean*.
- **Adjacent dead code:** `setPath` (`taggerMerge.js`) is marked **DEAD — delete in next spec**
  by `cleanup-inventory.md`. Cheap to fold in.
- **Known mis-tag for a test case:** piece **353** (cargo pants) has `length_hits_at` mis-tagged as
  `mid-thigh` (`freeform-rearchitecture-handoff.md`). Useful as a fixed regression case in any
  evaluation sample.

---

## Findings this map produced

Things that were not known before it was written, each settled against real data or a full call
trace rather than left as a question:

1. **`explorationMode: 'aggressive'` is unreachable.** Six trust-relaxation clauses that no caller
   can trigger; the mode a user selects emits `'adventurous'`. String mismatch, two separate
   origins, traced. → *The gates → Exploration mode.*
2. **52 of the 91 blocked `elevated` pieces are also tagged `casual`.** The `formality` and
   `occasions` columns contradict each other and only `formality` is read. → *The gates → register
   ceiling.*
3. **Two `planWorkbenchPieceScore` weights are decoration.** Removing `role_permission` gives a
   byte-identical top-40; removing `trusted` moves one piece. → *Scoring.*
4. **The two big sub-scorers are switches, not dials** — exactly 0/236 pieces scored in mild
   weather or with no register intent, 229/236 with one. → *Scoring → sub-scorers.*
5. **Advisor mode converts seven rejections into annotations.** The same check drops an outfit or
   merely flags it depending on mode. → *After the gate.*
6. **Diversity penalties are the largest numbers in the engine** (−45 formula, −40 top), and shoes
   are the cheapest core slot to repeat at −20. → *After the gate → diversity.*
7. **`signature` / `strong` / `usable` are positional labels**, assigned by index. → *After the
   gate.*
8. **The `fiber_content` gap is latent, not live** — no garment currently escapes hot-weather
   gating through it. → *The gates → gate-field coverage.*
9. **Neither browser cache can serve stale data** — both consumers revalidate on open. → *Caches.*
10. **The capsule occasion-breadth term caps exactly at the wardrobe's ceiling** (4), so it can
    never reward more range than the tagging vocabulary has. → *Scoring.*
11. **A five-outfit set cannot avoid a −45 formula repeat.** There are exactly four formula
    families for separates outfits, and two hold 82% of them. → *After the gate → classifiers.*
12. **The pattern classifiers cannot see a third of the patterned wardrobe** — they regex over
    piece names and never read the populated `pattern_type` column; `botanical`, `geometric`,
    `paisley`, `polka dot` and `lace` have no matching term. → *After the gate → classifiers.*
13. **`repairWholeWardrobeOutfit` does not fill missing slots.** It rewrites prose; its only
    garment substitution is a single shoe swap that can fire under the `hiking` activity profile
    alone — the one profile with a populated `required_footwear`. → *After the gate → repair.*
14. **The engine's strongest positive signals have never been switched on.** `pieces.favorite` is
    0 of 236 and `saved_boards.favorite` ("Use strongly") is 0 of 237, disabling four scoring terms
    including the `+45` high-authority board branch. Both controls are fully built and wired. →
    *Scoring → dead terms.*
15. **Pair-history terms are silent even on the most-annotated pieces** — 0 of 1410 pairs hit a
    confirmed or rejected pairing note; feedback influence fires on 0.9%. → *Scoring →
    compatibilityScoreForSelectedItem.*
16. **The `gpt-image-1` fallback renderer reports no cost**, because it never sets `timings.usage`
    and the cost line returns null without it — a billed generation that displays nothing. → *The
    image-generation path → cost reporting.*
17. **"Measured cost" is half-measured.** The image term — the dominant one — is a client-side flat
    constant ($0.08 / $0.04 by size string), not a measurement, and the server's pricing table has
    no image model in it at all. → *The image-generation path → cost reporting.*
18. **A second `photoPreservingVisualsEnabled` exists in `rules.js` that ignores mock mode**, and
    `routes/ai.js` — where the image endpoints live — imports that one. It is never called, so the
    mock-mode protection holds today; deleting the duplicate removes the trap. → *The
    image-generation path.*
19. **The editorial image prompt has no length clause, and length is the top render complaint.**
    `length_hits_at` is populated on 207 of 236 pieces; `anchorFidelityInstructions` derives rules
    from name and notes only and never emits a length instruction; the renderer memory is
    dominated by "rendered too long/short" corrections. 49 pieces produce no anchor fidelity
    instruction at all. → *The image-generation path → prompts.*
20. **Three regexes answer "is this patterned?" and all three disagree** — the `pattern_type`
    column says 90, the image fidelity checklist sees 60, the diversity classifier sees 72. →
    *The image-generation path → prompts.*
21. **The whole-wardrobe image prompt truncates piece truth text at 900 chars; the median is
    1,130**, so 169 of 236 pieces lose their tail — `fit_on_body`, tuck behavior, occasions and
    trust status are last in the string and fall off first. → *The image-generation path →
    prompts.*
22. **The renderer memory is one memory system that demonstrably works** — 6 real correction lines
    on the live database — and it is the sole consumer of the image-fidelity feedback types that
    are deliberately excluded from styling influence. → *The image-generation path → prompts.*
23. **The import cost gate under-quotes by ~1.6x.** The preflight prices tagging at 6,000 input
    tokens per garment; the prompt text alone is 6,097 before any image, and the real payload is
    ~9,880. It is the one place the app asks permission before spending. → *The tagger prompt.*
24. **`elevated` has not drifted — it is the wardrobe's most curated field.** 202 of 236 pieces
    carry an owner-corrected `formality`. Of the 52 elevated-and-casual conflicts, 49 have
    owner-set formality and only 5 have owner-set occasions, so the gate is reading the
    authoritative column. This **withdraws an earlier recommendation** in this document. → *The
    tagger prompt → owner corrections.*
25. **The tagger calibrates on owner corrections only.** `buildAnchorBlock` skips any piece whose
    field is not in `manual_overrides`, so the 18 anchors sent are a feedback loop on manual
    fixes — and per-tag cost grows as the wardrobe gets better curated. → *The tagger prompt.*
26. **71% of the wardrobe was tagged before the photo-authority prompt existed** (167 of 236
    unversioned). Where it ran, low-confidence `length_hits_at` drops from 81% to 42% — so the
    length problem is stale tag data first, prompt construction second. A re-tag costs ~$11 and
    cannot overwrite owner corrections. → *Provenance.*
27. **The tagger reports `low` confidence on ~85% of its own structural predictions**, and low
    confidence does not suppress the value — it ships to the image prompt with an
    "[low confidence - add worn photo]" disclaimer attached. → *Provenance.*
28. **Three trust-gate columns have never been corrected by anyone** — `heel_height`,
    `recommendation_status` and `role_permission` are 100% tagger-set, and the latter two are the
    same columns shown to be non-discriminating under *Scoring*. → *Provenance.*
29. **[bug] The singular/plural gap — six core keywords never fire at all.** `jean`, `sneaker`,
    `loafer`, `clog`, `pointed heel`, `tailored trouser` and `linen short` match **zero** pieces
    because the engine tests word-boundaried singulars against plural garment names; they are
    referenced at 16, 8, 25 and 4 sites. `boot` is used at 28 sites and matches one garment.
    19 keywords, 122 garment-matches lost. **This understates other distributions in this
    document** — the "93% rounded" shoe-shape uniformity is largely this bug. **But a blanket
    `s?` sweep is the wrong fix**: measured both ways, it fixes shoe shape (93%->53%) and makes
    grounding *worse* (47%->80%). → *The singular/plural gap.*
30. **`trustedField` drops low-confidence values; `trustedFieldText` annotates them.** The role
    classifier uses the dropping variant, so `silhouette` reaches formula-family classification on
    38 of 236 pieces and `fit_on_body` on 35. → *Roles.*
31. **A third of the role vocabulary is matched by no archetype.** Tagger-written `hero`,
    `support`, `grounding`, `texture_piece`, `color_accent` and five others are produced on every
    generation and scored on by nothing; the archetypes use the code-written `*_piece` forms. →
    *Roles.*
32. **`extract-pieces` output is trusted more than the tagger's, on less evidence.** It emits no
    `_confidence` map, so `getFieldConfidence` defaults its fields to `medium` — while the real
    tagger self-reports `low` on ~85% of the same fields. It also sends no calibration anchors, no
    photo-authority rules, and no `style_profile_json`. → *`extract-pieces`.*
33. **The `gpt-image-*` fallback chain has exactly one live caller.** The five main producers
    hard-code `gpt-4o`; only the editorial path can reach it, and it can attempt up to five billed
    generations before falling back to an SVG placeholder. → *The image-generation path.*
34. **`fiber_content` has a live wet-exposure gap, not just the already-documented latent
    hot-weather one.** Two owned pieces — "burgundy suede cork wedge sandals" and "taupe suede
    ankle boots" — name `suede` in their own title but have empty `fiber_content` and
    `fabric_category = 'other'`, so `pieceHasWetSensitiveFootwearMaterial` returns false and
    neither is excluded from a wet-exposure request today. The parallel capsule-scoring consumer
    checked clean (0 pieces affected, and it's additive scoring rather than a hard gate regardless).
    → *The gates → Gate-field coverage.*

## Still to map

- **`getRelevanceScore`'s occasion/activity profile terms per-context.** Its structure and weights
  are recorded under *Scoring*; the profile-rule terms (±8 materials, ±10 footwear, −10 pieces)
  fire off merged profile lists that vary per request, so a firing rate needs a context matrix
  rather than a single wardrobe pass. `scratch/measure_scoring_terms.js` is the place to extend.

Every area the first pass listed as unmapped is now covered, and the follow-on gaps each pass
opened have been closed in the next. What is left:

- **The comparison-sheet and identity/edit prompts** — `wholeWardrobeComparisonSheetPrompt` is
  summarised under the producers table but its layout rules are not walked line by line, and the
  `kind: 'identity'` image-edit branch of `runOpenAIImageGeneration` has no live caller to trace.
- **The surface map's own thin spots** — per-endpoint mapping (106 endpoints), onboarding step
  content, and the import review-gate UI. Those belong to `docs/app-surface-map.md`, not here.

**Before acting on any keyword-derived number in this document**, re-measure it plural-tolerant:
`node scratch/measure_plural_gap.js`. Before resolving any conflict between two columns, check
provenance: `node scratch/measure_provenance.js <colA> <colB>`.

**To check this map is still true:** run the scripts — `derive_surface_skeleton.js`,
`derive_engine_behaviours.js`, `measure_scoring_terms.js`, `measure_gate_impact.js`,
`measure_diversity_classifiers.js`, `measure_image_path.js`, `measure_roles.js`,
`measure_plural_gap.js`, `measure_provenance.js`, and `measure_open_questions.js`. They report mechanisms and numbers; they cannot tell you an entry has
gone *wrong*, only that the shape underneath it moved.
### Seasonal capsule bounded composition

For a seasonal capsule, deterministic roster selection and slot-capacity checks happen before the
single bounded model composition call. The composition response schema requires exactly the sum of
the requested slot counts; an empty or partial array is not a valid successful response. The
output-token ceiling scales with the requested representative-look count (within a fixed cap), but
billing remains based on actual generated tokens rather than that ceiling.

If the bounded composer nevertheless returns no outfits, `plan_outfit_set` returns an engine error,
locks the atomic attempt, and exposes no alternate outfit-building tools for that turn. It must not
report zero accepted cards as success or invite the conversational model to reconstruct the capsule
slot by slot.
