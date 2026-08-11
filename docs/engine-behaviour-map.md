# Engine behaviour map

**Status:** twelfth pass, 2026-07-26. Companion to `docs/app-surface-map.md`.

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

**Start at [Findings this map produced](#findings-this-map-produced)** — thirty-three things that
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

> `styling-engine/core.js:3419` (restore), `:3824` (read), `:3839` (write); mirrored in
> `tools.js:1803`.

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

> `styling-engine/rules.js:1465-1474`. Surface counterpart: surface map → composer landing panels.

---

## Retry loops around model calls

Two mechanisms live in `askStylistWithTools`, with a second bounded operating profile for critique
follow-ups. All cost money when they advance to another provider iteration.

**[by design] The tool loop runs up to 10 iterations.** The comment records the reasoning and the
history: the disciplined flow — declare, search, view supports, view layers, propose ×N —
legitimately needs 6–8, and *"the old cap of 7 left no margin for a single corrective bounce and
live turns died with zero cards."* So 10 is a deliberate margin, raised after live failures.

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

**Consequence:** a single user turn can be several model calls — tool iterations plus guard
retries. **Instrumented 2026-07-28:** every tool-loop iteration now accumulates input, output,
cache-read, and cache-creation tokens in the turn's `freeformDiagnostics`; `/ask` returns them in
its existing debug payload and `freeform_generation_runs` persists them. This makes a four-call
capsule turn distinguishable from a nine-call retry spiral without another live reproduction.

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
0`), so stale clients cannot purchase a composition the roster cannot possibly supply.

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

> `styling-engine/provider.js:734` (guard retries), `:758` (tool loop).
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
  drift/problem patterns"*. ~3.2 KB on the current wardrobe. Spliced at `core.js:2683→:2737` and
  `routes/ai.js:1108-1109→:1116` (per-garment, flagged *"high-authority outfit memory"*) and
  `:1119` (global, *"should bias ranking"*).
- **Owner rules** → injected as **hard requirements**: *"OWNER RULES — hard requirements, not
  suggestions. Do not construct exceptions or conditional workarounds… If a rule makes a slot
  impossible, disclose the conflict instead of bending the rule."* (`outfitSetPlanner.js:1120`.)
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

`(outfitSetPlanner.js:931)`. Terms, with how often each fires on the real wardrobe:

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

`(outfitSetPlanner.js:500)`. `+12` neutral color, `+4` per occasion tag (capped at 4, so `+16` max),
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
(`outfitSetPlanner.js:555-563`) — a roster can score high on "versatility" while reading uniformly
`elevated` and then failing every `casual` slot's ceiling. That is a live-tested failure from
2026-07-14, and is what `strictestRegisterCeilingRank` / `capsuleDemandReserve` exist to correct.

### The keyword-scored surfaces

`scoreWholeWardrobeCandidate` (`rules.js:3273`) and `getRelevanceScore`
(`rules.js:2824`) score largely by **regex over a concatenated text blob** of the pieces, not over
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
**regex over the user's own words** (`rules.js:132`) — one of the few keyword paths that is about
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

`getRecentWholeWardrobeSessionInfluence` (`rules.js:1480`) converts the 10-row session memory into
a *penalty*: `18 × decay` per piece and `30 × decay` per formula family, where
`decay = max(0.2, 1 − sessionIndex × 0.16)` times an occasion factor. So the most recent session
penalises a piece by 18 and a formula by 30; by the sixth session back the decay floor (0.2) has
been reached, at 3.6 and 6. That penalty is subtracted directly in `getRelevanceScore` and is also
the **first tie-breaker** in `comparePieces`. Surface counterpart: *"Skipping N recently used
pieces"* in the composer footer.

---

## Caches

Six cache systems now outlive a request. The original derivation script reported 47 `new Map()`
hits; most are local lookups inside one function and are not caches at all. PR 188 added the
outfit-evaluation result cache and a paired in-flight registry:

| cache | scope | key | eviction |
|---|---|---|---|
| `promptsByUser` (`promptRuntime.js:63`) | server, per user | user id | none — rebuilt on profile/constitution write via `refreshPrompts` |
| `wardrobeThumbCache` (`provider.js:404`) | server, module-wide | `userId:cacheKey:maxPx` | oldest entry dropped past 300 |
| `geocodeCache` / `weatherCache` (`weather.js:16-17`) | server, module-wide | location / `dates|lat,lon` | 3-hour TTL |
| `threadCache` (`src/utils/chatThreadCache.js`) | browser tab | thread id | none — lives until reload |
| `relationshipCache` (`src/utils/garmentRelationships.js`) | browser tab | piece id | none, but `loadGarmentRelationships(id, {refresh:true})` bypasses it |
| `outfitEvaluationResultCache` (`core.js`) | server, module-wide | SHA-256 of cache version + provider/model + mode/token cap + complete system/messages (including images and garment/memory context) | 10-minute TTL; LRU insertion order; max 50 |

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

**The two browser caches never expire — and it does not matter, because both consumers
revalidate.** Traced: `StylistChat.jsx:895-898` and `PieceDetail.jsx:118-122` use the same idiom,
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

`wholeWardrobePieceTrustDecision` (`rules.js:2146`) is the hard gate. It is called by the freeform
`propose_outfit` tool (`tools.js:1122`), by `filterWholeWardrobePiecesForGeneration`, and by
`scoreWholeWardrobeCandidate` (there as a `-18` support-only *penalty*, not a block). It returns
`{allowed, supportOnly, reasons}`; `allowed` is simply `reasons.length === 0`.

**[by design]** A user-requested **anchor bypasses it entirely** — `if (piece.anchor) return []` in
the freeform gate. Asking to wear a garment overrides auto-use suitability. Verification
(retrieval + layer photos) still applies.

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
3. **Auto-use trust** (`autoStylingTrustDecision`, `src/utils/wardrobeAiContext.js:146`), with a
   dead escape hatch — see *Exploration mode* below.
   `recommendation_status` of `avoid` / `do_not_recommend` / `needs_fit_review` / `experimental`,
   `role_permission` of `never_auto` / `only_when_requested`, `fit_confidence: low`, the AI
   profile's own `auto_use_trust`, low occasion confidence without an explicit tag, an
   `occasion_permissions` list that omits the request, and a phrase scan of notes for
   *"too small"*, *"do not auto"*, *"testing only"* and similar. Most of these relax under
   `explorationMode: 'aggressive'`.
4. **Weather physics.** Hot: insulating fiber, or heavy weight, or (medium+ weight *and* insulating
   coverage / warm neckline / long sleeves). Cold: shorts, lightweight linen bottoms, high bareness.
   Credible wet exposure excludes footwear whose structured material is canvas or suede. Explicit
   rain, drizzle, wet ground, puddles or mud qualifies; a foggy coastal outdoor walk also qualifies
   from the combined environment and activity. Fog alone and dry beach walking do not.
   The exemptions here are all scar tissue and are commented as such — open-front layers
   (cardigans, kimonos) are exempt from the sleeve/coverage clauses (ratified 2026-07-12 after
   summer layering requests kept dying); shoes and accessories are never "insulating"; the
   weight qualifier exists because a light silk maxi was flagged purely for being full-length.
5. **Profile rules and the register ceiling** (`profileRuleFit`, `rules.js:2039`). Prohibited
   materials → footwear-comfort enums → **register ceiling** → prohibited footwear → prohibited
   pieces → `unknown` → discouraged. **This function returns on the FIRST prohibition it finds**,
   so a piece has exactly one profile reason no matter how many it violates.

**Consequence:** layers 1–4 *push* reasons onto a list, layer 5 returns one. A blocked piece can
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
`outfitSetPlanner.js:555-563` (a roster of `elevated` pieces producing zero outfits for casual
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

`missingGateFields` (`attributes.js:112`) lists the columns the gate needs: `formality`,
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

### Exploration mode — a relaxation that can never fire

**[known bug — string mismatch, unfiled]** `autoStylingTrustDecision` computes
`const aggressive = explorationMode === 'aggressive'` and uses it to disable **six** separate trust
clauses: `needs_fit_review`, `experimental`, `fit_confidence: low`, the AI profile's
`needs_fit_review` and `experimental`, low occasion confidence, and the engine-notes phrase scan.

**Nothing in the codebase ever passes `'aggressive'`.** Every call site is traced:
`tools.js:1711` and `outfitSetPlanner.js:1032` hard-code `'moderate'`; `rules.js:1150` defaults to
`'moderate'`; the parameter default is `'moderate'`; `routes/ai.js:1452` forwards a request value.
The only non-default value produced anywhere is **`'adventurous'`** (`routes/ai.js:2158`, the
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

Structural validity (`isOutfitStructurallyValid`, `validateOutfitRoles` — needs shoes, needs
top+bottom or a dress, a layer needs its base) is a *separate* check on the assembled outfit, and
it runs **before** the piece gate in `propose_outfit`. Diversity, dedup and repair run after — see
the next section. None of those are piece-eligibility questions, which is why they are not here.

---

## After the gate — the outfit-level pass

`locallyGateWholeWardrobeOutfits` (`rules.js:4553`) is where assembled outfits are repaired,
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

`repairWholeWardrobeOutfit` (`rules.js:4158`) does **not** fill missing slots. Traced end to end,
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
already selected with `wholeWardrobeDiversitySelectionScore` (`rules.js:4277`). The repeat
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
from `WHOLE_WARDROBE_OUTFIT_ARCHETYPES` (`prompts.js:984`), which defines five families, one of
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
`name + category + reads_as` (`rules.js:375`). They never read the structured `pattern_type`
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

---

## The image-generation path

Mapped 2026-07-26. The app's most expensive operation. Traced by reading; the input payloads are
measured by `scratch/measure_image_path.js`, which runs the real reference builders (sharp only) and
**never constructs an OpenAI client**, so it costs nothing.

### One switch decides whether any of this is billed

`photoPreservingVisualsEnabled()` (`core.js:1736`) returns true when `PHOTO_PRESERVING_VISUALS` is
set **or** `WARDROBE_MOCK_AI` is on. When true, every producer renders a **local sharp collage** of
real garment photos instead of calling a model. `hasOpenAiKey()` failing does the same. So there are
two renderer families, and the free one is the default in the sandbox.

**[known bug — dead duplicate, unfiled]** There are **two** functions with this name.
`rules.js:4066` is a copy that checks only `PHOTO_PRESERVING_VISUALS` and **not** `mockAiEnabled()`.
`routes/ai.js` imports *that* one (its import block spans lines 52–116, from `rules.js`) — and never
calls it; the symbol appears exactly once in the file. So this is a latent trap, not a live leak:
the mock-mode protection is intact today because every live call site uses the `core.js` version.
But `routes/ai.js` is precisely where the image endpoints live, and the mock-unaware copy is already
imported and in scope there. Deleting the `rules.js` duplicate would remove the hazard outright.

### The producers

| function | renders | AI inputs |
|---|---|---|
| `createWholeWardrobeOutfitImage` | one outfit | ≤5 garment refs + 2 calibration refs + prompt |
| `createSavedOutfitImage` | saved-outfit variants | source photo + refs |
| `createWholeWardrobeComparisonSheetImage` | up to 5 outfits on one sheet | unique pieces across the 5 |
| `createIdealAdditionsComparisonSheetImage` | directions sheet | **one** garment ref |
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

Garment references are resized to 768px, JPEG q84, base64'd. Across a 24-piece spread of the real
wardrobe (235 of 236 pieces have a usable photo): **min 50 KB, median 88 KB, max 152 KB, mean
95 KB**. A five-garment outfit therefore ships roughly **475 KB of base64 garment reference**, plus
two calibration images, plus the prompt.

At OpenAI's ~750 tokens for a 768px image, seven images is **~5,250 input tokens of imagery alone**
— about **$0.013** of gpt-4o input, before any prompt text. The generated image is billed
separately and dominates.

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

Cost is **not** computed by the server. `estimateAiUsageCost` (`provider.js:348`) prices text
tokens only, and its OpenAI table (`provider.js:279`) has entries for `gpt-5.x` and `gpt-4o` and
**no image model at all** — so it would return `pricingAvailable: false` for one.

Instead the number the user sees is computed **client-side** in
`StylistChat.jsx:315`, `calculateOpenAICost`, which re-hard-codes the rates ($2.50/Mtok in,
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
   (`core.js:3280-3296`) also never sets `timings.usage`, so a **billed** generation renders with
   no cost line. The user sees a generated image and is told nothing about what it cost.

This is the concrete answer to panel finding A6 in the handoff: the `~$0.07` figures are neither
user pricing nor fully measured instrumentation. They are a client-side estimate with a constant
image term, and they silently vanish on one billed path.

### The prompts themselves

Two builders, and they describe the same garment very differently. Sizes measured against real
pieces: `wholeWardrobeImagePrompt` is **~3,900 chars (~980 tokens)** for a three-piece outfit;
`editorialImagePrompt` is **~5,800 chars (~1,455 tokens)** for a *single* anchor garment — larger,
because it splices four Style Constitution layers that the whole-wardrobe prompt does not.

**`wholeWardrobeImagePrompt`** (`core.js:1870`) is four blocks: six blanket garment-fidelity rules
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

**`editorialImagePrompt`** (`core.js:3011`) splices `BODY_CONTRACT`, `PROVEN_FORMULAS`,
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
never renders. `anchorFidelityInstructions` (`core.js:2988`) then derives its rules from
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

Mapped 2026-07-26. `tagPieceWithProvider` (`routes/ai.js:357`) is the call that populates
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

**Dynamic** — `buildAnchorBlock` (`taggerMerge.js:116`) injects real pieces from *this* wardrobe
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

`applyTaggerResult` (`taggerMerge.js:230`) normalises `fiber_content`, `formality`, `heel_height`
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

`inferWholeWardrobePieceRoles` (`rules.js:1585`) builds its text from `pieceNameBlob` **plus**
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

`POST /api/ai/extract-pieces` (`routes/ai.js:823`) takes one outfit photo and returns every garment
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
`fabricWeight()` (`attributes.js:69`) recognises only `heavy`, `ultralight`, `light`,
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
| `fiber_content` | 37 | 201 | hot-weather insulating-fiber clause |
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
> `normalizeConfidenceMap` ([`taggerMerge.js:39`](../styling-engine/taggerMerge.js)) ends with:
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
> ([`attributes.js:29`](../styling-engine/attributes.js)) accepts only `manual`/`high`/`medium`, so
> `attributePieceTextBlob` **drops** `fit_on_body`, `silhouette`, `tuck_behavior` and
> `waistband_type` entirely on these pieces — the value exists and search cannot see it.
>
> **Do not "fix" this by re-tagging.** That would overwrite owner-entered values with model guesses.
> Two options: introduce a provenance value distinct from `low` — `legacy` or `unrated`, meaning
> "recorded before provenance was tracked" — and exempt it from the low-confidence warning, the `?`
> suffix and the `trustedField` rejection; **or** the owner re-confirms the fields by hand, which
> marks them `manual` correctly, since the piece editor sets a field manual on any interaction with
> it. A new value must be added to `VALID_CONFIDENCE` (`taggerMerge.js:5`) or
> `normalizeConfidenceMap` will convert it straight back to `low`, and to all three
> `getFieldConfidence` implementations (`wardrobeAiContext.js:27`, `attributes.js:23`,
> `rules.js:367`) or they will disagree about the same garment.

**[by design]** Low confidence does **not** suppress the value downstream. `trustedFieldText`
(`wardrobeAiContext.js:36`) prefixes it instead: `length: [low confidence - add worn photo] midi`.
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
(`routes/ai.js:370`). Measured, on the corrections that already exist:

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
(`routes/ai.js:335`) while the text block lists all 18. Which 8 depends on bucket iteration order,
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
   photo is pushed **first** (`routes/ai.js:364`), before the anchors and the prompt, and a cache
   prefix must be contiguous from the start. Reorder to *[prompt + anchors] → [photo]*, then mark
   the prefix. The machinery already exists (`provider.js` → `PROMPT_CACHE_BREAKPOINT`,
   `systemToAnthropicBlocks`) and is used by the stylist conversation path.
3. **Output schema — attacks the expensive half.** `cross_photo_agreement_note` is explicitly
   demanded by the prompt (*"Always emit a brief cross-photo agreement note"*) and then **deleted**
   in `applyTaggerResult` (`taggerMerge.js:243`) — paid tokens discarded on arrival. The rest of
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
- **Adjacent dead code:** `setPath` (`taggerMerge.js:168`) is marked **DEAD — delete in next spec**
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
