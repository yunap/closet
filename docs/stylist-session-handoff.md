# Stylist work — session handoff

**Last updated:** 2026-07-29. Branch `experiment/critique-cost-optimization`, started from
merged PR #187 on `origin/main` at `77fe064`.

## 2026-07-29 — critique cost optimization after B2

Branch `experiment/critique-cost-optimization` starts cleanly from merged PR #187 at `77fe064`.
It implements the first cost pass without changing the ratified full critique:

- Full critiques append the existing `PROMPT_CACHE_BREAKPOINT` to the stable evaluator system
  prompt. Anthropic receives a cache-controlled stable system block; OpenAI receives the same plain
  prompt and can apply its normal repeated-prefix caching.
- `evaluateOutfitThroughSharedPipeline` now keeps normalized provider usage and
  `estimateAiUsageCost` in `debug`. The dev-only message telemetry shows critique tokens, cache
  reads, estimated cost, and exact-result cache hit/miss state.
- Follow-ups use a dedicated, provider-enforced `{ answer }` contract capped at 500 output tokens
  instead of the full 3,000-token critique contract. They still receive the current outfit and
  linked-garment images, garment truth, compact prior evaluation, and relevant memory. The client
  preserves the existing full evaluation in thread memory after the answer-only response.
- Exact duplicate requests use a ten-minute, 50-entry in-memory result cache. The key hashes the
  provider/model, cache version, system prompt, response mode, token ceiling, complete messages,
  image bytes, garment truth, and memory. Concurrent identical misses share one in-flight promise.
  Failures are not cached.

Stable image/evidence prompt caching remains deliberately deferred until the new telemetry shows
it is worth the added request restructuring. No extra provider call was added and the four-paragraph
`detailedCritique` prompt is unchanged.

## 2026-07-29 — B2 readable critique ratified

The owner retained the B2 ruling that `Visible facts` must not be deleted: it is the falsifiable
record of what the model believed it saw. The current experiment separates that evidence from what
the client reads without adding a second provider call.

The default `userCritique` answers first with a short reason, one action, and one check. The
collapsed surface is now **More detail**, backed by a dedicated four-paragraph
`detailedCritique` written last in the same evaluator response. Full `visibleFacts` remain stored
for diagnosis and follow-up context. The requested schema removes redundant prose fields so this
does not simply append another essay to the old response. Older saved evaluations retain the
structured-field fallback.

Several live iterations were deliberately rejected before reaching this shape. Deterministic
headings were too short and too structured; unlabeled selected fields were only a longer summary;
and joining every field restored depth but repeated itself because each field was independently
authored. The dedicated field produced the first explanation with the intended depth and
continuity (`thread_1785358062445`). It still sometimes uses internal stylist vocabulary and names
internal evidence sources; the owner accepted that current behavior for now. `Visible facts`
remains stored/debug-only in the normal client experience. Corrections and refinements happen
through follow-up conversation, replacing the proposed editable `Intent` control.

No extra model call was added. This one-call, bounded-output architecture is sufficient for the
B2 cost ruling; before/after token telemetry is not a ratification prerequisite. Focused
prompt-equivalence tests pass. The full pre-rebase suite
reported the documented seven UI/contract baseline failures plus four stale assertions tied to the
old structured-read labels; fresh main contains their migrated versions. After rebasing, current
`origin/main` declared `pieceNeedsBase` twice; the branch removes the second identical declaration
as a separate merge-repair commit.

**Separate cost follow-up:** implemented on `experiment/critique-cost-optimization`; see the entry
above. Stable image/evidence caching still waits for measurements.

## 2026-07-29 — rejected looks are shown and repaired, not discarded

Follow-on to the capsule work in PR #184. Four changes, all offline-verified, no billed call made.

### 1. A rejected capsule look is a card, not an absence

**Owner ruling:** *"what we do in other flows is show the card with a disclaimer, do not throw it
away, and fix locally on that card."* The atomic capsule path was the only composing surface that
deleted a rejected attempt — `propose_outfit` has recorded `broken` / `brokenPieces` /
`rejectionReason` cards for ages, and `StylistChat` already renders them as **needs review** with
plain-language reasons. The capsule path assembled only `accepted` and announced the gap in prose.

`validateSubmittedPlanOutfits` now carries the rejected attempt itself and **which piece was
blocked**; `buildRejectedCapsuleCards` turns those into the existing broken-card shape, so the
established rendering and its reason shim apply unchanged. Three follow-on corrections stop the old
problem reappearing in a new place: the plan header counts only non-broken cards, the expansion
offer ignores broken cards when counting a slot's shown looks, and the shortfall line points at what
is on screen instead of announcing what is missing.

**This supersedes the disclosure wording shipped in #184** — see the amendment in that entry below.

### 2. `POST /api/ai/repair-capsule-look` — a deterministic in-place fix

`providerCalls: 0`, always. The rejection names the blocked garment, `capsulePlanContext` holds the
slot's gate-passing roster, and the real validator confirms the substitution — so the repair swaps
one piece and re-validates with the existing looks as held outfits (a repair cannot duplicate
another card's core). When the rejection names no single piece — a repeated core, say — it tries
each piece in turn. Candidates come only from the slot's own allowed roster, so a repair can never
smuggle in a garment that slot excludes.

**It deliberately has no billed fallback.** An unfixable look returns 409 with *"No single swap from
this capsule roster fixes that look — the pieces it would need are not in this capsule"*, which is a
true statement about the capsule. A test pins `providerCalls: 0` on the failure path too.

Live-verified in the sandbox: `POST → 200`, the broken card replaced in place, engine note
*"Swapped cream cotton button-up shirt for rust corduroy button-up shirt."*

**Verification trap worth knowing:** `?thread=<id>` is **not** the Stylist's URL parameter — it
silently loads whatever thread was last active, and the rail labels threads by their first message
rather than the `title` column. Both together produced two confident, wrong conclusions that broken
cards were being dropped by the renderer. Nothing was wrong with the code. Same class as the
screenshot-coordinate incident: a verification method that fails quietly.

### 3. The final-answer guard logs what it replaces, and over-matched

Its first live firing was undiagnosable — it incremented a counter, discarded the model's prose, and
recorded neither the reasons nor the original, so a correct catch and a false positive looked
identical afterwards. It now logs both.

It was also probably wrong that time. Measured offline: the bare words *"another/second … look/
option"* are ordinary English for explaining a rejection, and the tool message explicitly asks the
model to explain one — the guard replaced *"I couldn't land a second option that worked with walking
shoes."* An unvalidated **addition** now requires an actual garment: a piece ID, or a "wear/pair X
with Y". Verified both directions — all five honest closings pass, all four real violations
(engine-ceiling claim, prose outfits with IDs) still caught.

### 4. Supply precondition, and the `needs_base` selector rule

**Too little supply → ask for more of the closet, before composing.** `describeCapsuleSupplyGap`
runs ahead of the composition call, so an unsustainable request also costs nothing. The framing is
the ruling: the constraint is **what has been digitized, not what the person owns**, and the message
must never read as a shopping recommendation. It names which contexts are uncovered and which
category is short — that is what to photograph next — and offers what is possible now.

A first threshold of "at least 3 cores" let the 23-piece sandbox case straight through (5 contexts,
3 cores, one card — the exact failure this exists to catch). Replaced with a test that scales to the
request: a capsule that cannot give every requested context even one distinct look is not a
rotation. Measured: 243 pieces at budgets 24 and 10 proceed; 23 pieces at budget 10 declines,
naming `Errands / Weekends` and `Restaurant Dinner (needs a top)`.

**`needs_base`** (the field wired in #184, defaulting to unset) now does something: a garment that
cannot be worn alone may only hold a place in a finite roster when something it can go over is also
there. Expressed as a post-condition so a later pass cannot undo it, and **conditional** — the
requirement is only added when a dependent piece is actually present, so an unpopulated field
remains a strict no-op. The owner has hand-set two pieces (132, 258); on the real wardrobe 132 is
selected at budgets 14 and 24 with 4 and 9 wearable-alone tops beside it.

### Verification

Focused suites **222/222**; `aiEndpointContracts` back to the documented **138 pass / 7 fail**
baseline; capsule matrix reports no structural gaps; summer replay 11/11 accepted with zero raw
validator lines; bench invariant holds; style-claims, text ratchet (`outfitSetPlanner.js` still at
0 regexes), `git diff --check` and `npm run build` all pass.

Two failures that appeared mid-session were **not** capsule-related: an in-flight
`critiqueProse` → `userCritique` migration had updated one of three dependent assertions. The other
two were finished (lines 1455 and 1600) rather than worked around.

### One nuance the panel docs slightly overstate

`docs/panel-stage1-findings.md` now says composition "requires recurring use cases to demonstrate a
second gate-eligible shoe when one exists." That is stated to the model in `submission_requirements`
and enforced in the open workbench path — but in the **atomic** capsule path it is advisory: since
2026-07-28 that set-level check records the finding without dropping a card, because dropping one
with no repair round available just deletes a wearable look. Accurate as a composition instruction;
not a hard guarantee there.

## 2026-07-28 — comprehensive capsule work and related fixes

### Capsule design evaluation, six correctness fixes, and a selection rethink

An evaluation pass over the capsule design and implementation. The architecture held up — explicit
`plan_kind` routing, atomic one-call composition, and full garment truth plus thumbnails into that
call are all the right calls and are not revisited. The defects were at the seams, and four of them
compounded into the exact failure the last live run showed (13 looks planned, 10 shown, the closing
model inventing prose outfits to cover the difference).

**Shipped, all provider-free-verified, no billed call:**

1. **Capsule allocation is now bounded by the plan's real distinct-core capacity.**
   `allocateCapsuleRepresentativeRotation` sized each slot by its own
   `capsuleOutfitCoreCapacity` while `validateSubmittedPlanOutfits` enforces distinct cores
   *globally*. Overlapping slots — At Home and Errands routinely resolve to the identical gate
   result — therefore double-counted shared cores. Measured on the live wardrobe: **sum of per-slot
   capacities 253 against 91 actually distinct.** Allocation now tests each increment against the
   whole plan (`capsuleRotationFeasible`, augmenting-path matching over the demand units), and a
   slot retired for global infeasibility reports no unused core, so no billed "Show another" is
   offered against an already-complete rotation.
2. **The atomic capsule shortfall is disclosed.** `suppressModelCoverageGaps` kept raw per-slot
   internals out of production notes — correct — but it also removed the only signal that looks
   were missing, on the one path that cannot retry. New `describeCapsuleCompositionShortfall`
   emits an honest total while the raw validator reasons stay in the log.
   `boundedCapsuleFinalAnswer` no longer asserts completeness when the turn knows it fell short.
   **Superseded 2026-07-29 — read this before quoting the wording above.** The owner then ruled
   that a rejected look is not announced as an absence at all: it is shown as a "needs review"
   card and repaired in place, the way every other composing surface already does it. The line
   now reads "N of M planned looks are ready — … need a fix and are shown below marked for
   review". Disclosing the gap was the right fix for *silence*; showing the card is strictly
   better and is what ships.
3. **Set-level rules no longer delete a valid card when no repair round exists.** The shoe-range
   and transition-layer checks splice an accepted outfit out "so the normal resubmit path can
   repair it" — but the atomic path forbids resubmission, so the splice simply deleted a wearable
   look. Gated on a new `pendingPlan.boundedComposition`; the finding is still recorded.
4. **Non-capsule plans got their budget curve back.** `planTotalOutfitCapForBudget` had been
   collapsed to `min(budget, 12)` and every non-capsule caller passed 0 — pinning a 30-piece trip
   at 8 looks. The curve (12/16/20 at 18/24/30) is restored under that name; the capsule cap now
   lives in `capsuleTotalOutfitCap`. A regression asserts the two disagree at budget 24.
   The ruling was always "trips keep the day curve"; only the code had drifted.
5. **A capacity-trimmed slot names the real cause.** `describePlanCapTrim` blamed the card cap even
   when allocation trimmed for core capacity; new `[rotation limit: …]` line for that case. The
   chat's notes no longer offer "ask for the remaining looks" directly above "Full available
   rotation shown" — the note states the fact, the action row states availability.
6. **The plan's season chip reads plan state, not the prompt.** A `/\bwinter\b/` test against the
   user's wording labelled a winter *trip* "Winter capsule" and gave a summer capsule no chip at
   all. Now derived from `capsulePlanContext.is_winter_capsule`.

**Live-reviewed in the sandbox, and it found a seventh thing.** New fixture
`scratch/build_capsule_disclosure_demo_thread.js` drives the real planner against the sandbox
wardrobe (no AI client, no network) and inserts a reviewable thread, so the new disclosure copy can
be read as a user sees it. Doing that showed the capsule's own zero-capacity line reaching the user
verbatim — `[missing wardrobe gap: "Errands / Weekends" has no complete gate-valid outfit core in
this 10-piece capsule roster]`, brackets and engine vocabulary intact — which is the ratified
"capsule-gap internals are developer evidence, not stylist copy" rule being broken in production.
Now formatted like the others. Every bracketed line is gone from the rendered notes.

Verification: focused planner/intent/observability/layout suites **196/196**; capsule offline
matrix no structural gaps; summer replay 11/11 accepted with zero raw validator lines;
roster-utility and lifestyle audits unchanged; style-claims, text ratchet, `git diff --check`, and
`npm run build` all pass. `test/aiEndpointContracts.test.js` remains at the known **136 pass /
7 pre-existing fail** baseline.

**The larger finding is not a bug, and is written up separately:**
**`docs/capsule-roster-selection-spec.md`** (draft, awaiting ratification). Owner's framing: a
summer capsule should be "the ideal combination the stylist looking at my closet would pick", not
24 defensible pieces. `capsuleVersatilityScore` scores every piece **in isolation** — nothing in
the selector ever scores a pair or the set — and roster selection loads **no images at all**, while
composition now gets thumbnails. So the stage that is more aesthetic is the blind one. Proposal:
engine benches (gate-eligible, ranked, per-category and per-slot minimums) → model selects the
roster as a set with a stated palette and per-piece job → engine validates deterministically with
one bounded repair → existing atomic composition on the ratified roster. The six fixes above stand
regardless of who ends up picking the roster.

### Reserve guarantees are now checked once, at the end (2026-07-28)

The bench work turned up independent evidence for the "seven sequential mutating passes with ad-hoc
protected sets" problem, so it is fixed. Each reserve pass in `selectCapsuleRoster` states a
guarantee, mutates the roster, and hands it to the next pass — which is free to undo it. Measured:
a winter/casual capsule at budget 10 reached **2** register-compliant tops after
`ensureCapsuleGroupReserve` and ended with **1**, because `ensureWinterIndoorTopBalance` swaps on
sleeve coverage alone and knows nothing about register. Two of the final three tops were unwearable
in the very slots that requested them.

Fixed with a post-condition check rather than a fourth protected set: `capsuleRosterPostConditions`
collects what each pass promised (register reserve per group, winter covered bases, both winter
layer roles, every shoe demand) as data, and `enforceCapsulePostConditions` repairs violations after
all passes have run. Two properties make it safe: a swap target must leave every *already satisfied*
condition satisfied **after the swap** (judging removal alone rejects exactly the repairs worth
making — that was a real bug caught by its own test), and a roster with nothing violated is returned
untouched, which is what keeps ratified selections byte-identical. A guarantee the wardrobe cannot
meet is reported on `roster.postConditionGaps` instead of being silently abandoned. Declaring the
guarantees as data also means a future reserve pass is checked automatically rather than relying on
whoever adds it to thread a protected set correctly.

Effect on the provider-free matrix: no scenario regressed, three improved — winter/casual 10
weakest-slot cores 2→4, winter/mixed 14 2→3, summer/casual 18 13→16. Summer replay still 11/11,
structural gaps still none, focused suites 209/209, `aiEndpointContracts` still 136/7.

**`docs/capsule-bench-implementation-brief.md`** is the delegable slice of that spec — migration
steps 1–2 (bench builder, roster validator, bench width check), all deterministic with free offline
acceptance criteria, written for an agent starting cold. Step 3 (the roster-selection model call) is
deliberately excluded: its constraints are easy to satisfy in letter and miss in spirit, and its
failure mode is discovered by a billed call.

Owner rulings recorded in that spec: bench size **40** (with a free offline width check first),
**palette becomes an input**, and the roster rationale ships **user-visible and is judged on the
evidence** rather than hidden on a guess. The palette section was corrected mid-draft by the owner
— it had claimed the person can't know their wardrobe's colors before seeing a capsule, when the
Wardrobe page already ships a data-derived color filter. Measured while fixing it: **38 distinct
stored color values, 37 inside the picker vocabulary, exactly 1 off-vocabulary mention in 466** —
so the vocabulary is clean and usable as a real input. Two caveats went in with it: `colors` is
owner-corrected on only **13 of 241** pieces (~95% tagger-set, unlike `formality`'s 86%
hand-corrected), and **66% of all color mentions match `CAPSULE_NEUTRAL_COLORS`**, meaning
`capsuleVersatilityScore`'s +12 neutral bonus fires on two-thirds of the wardrobe and is closer to
a baseline offset than a selector.

### Two tagger `_confidence` fields were declared but never requested — fixed 2026-07-28

Found while wiring `needs_base`. `CONFIDENCE_FIELDS` in `styling-engine/taggerMerge.js` listed 23
fields, but the tagger prompt's own `_confidence` JSON block in `styling-engine/prompts.js` asked
for only 21: **`opacity` was missing, and `needs_base` inherited the gap by being wired to mirror
it.** `normalizeConfidenceMap` defaults an absent field to `'low'`, so `opacity` has always
reported low confidence for every piece regardless of what the tagger actually knew — the value
ships, the self-reported certainty behind it is fabricated. Both are now in the schema; the
membership check returns empty.

Two things this does **not** do. It does not change any stored row: existing pieces keep
`opacity: low` in their saved `_confidence` map until whenever the single planned re-tag happens,
and this fix does not trigger or justify one. And it does not fix the same class of gap elsewhere —
`routes/ai.js`'s `extract-pieces` schema still omits `tuck_behavior` and `waistband_type`, which is
the existing "extract-pieces is trusted more than the tagger's, on less evidence" open item below.

**Process note, worth more than the bug.** A delegated agent found this gap, correctly reported it,
and then deliberately reproduced it in the new field because the brief said to "mirror every place
`opacity` appears". The brief was wrong to say that without an exception, and a discovered defect is
never a thing to copy forward. Verified before fixing (23 declared vs 21 requested) and verified
after (`prompt_equivalence`'s byte-for-byte failure reproduces identically with the change reverted,
so it is pre-existing and unrelated).

### Capsule-design session completion record

This is the consolidated handoff for the capsule work completed in this session. The detailed
chronology and evidence remain below; this section is the authoritative short reading path.

### Owner rulings and product boundary

- A person can ask simply for “a summer capsule” or “a winter capsule.” The stylist owns the
  capsule expertise: it may ask one natural lifestyle question when the answer materially changes
  the plan, but must not require the person to supply stylist language, internal occasion slots,
  layering instructions, a representative-rotation rule, or a piece count.
- Seasonal capsules and trips share the conversation-led planning architecture, but they are
  different plan kinds. A budgeted trip remains a trip. Capsule-only roster selection, rotation
  capacity, validation, and bounded composition must never activate merely because a request has
  a piece budget.
- An unnumbered seasonal capsule uses a 24-piece working ceiling; an explicit user number wins.
  The initial display is a curated representative rotation capped at
  `min(piece_budget, 12)`, not a claim that the capsule contains only the displayed garments.
- Winter indoor clothing is not evaluated as though the wearer remains outdoors. Tops are indoor
  bases; the roster must still represent winter realistically with sleeve-covered options, a
  reusable indoor cardigan, and a separate transition coat/jacket when the budget supports those
  jobs. A winter sleeveless base is valid only when its displayed indoor outfit includes the
  appropriate cardigan layer.
- A capsule roster piece must have at least one legitimate requested-context job. Eligibility is
  the union of the real slot gates, not their intersection. “Eligible but not displayed” is not
  the same as “blocked.”
- The Visual Composer's recently-styled-piece memory does not currently influence capsule
  selection. That separation was accepted for now; no new memory coupling was added.
- Raw validator coaching, coverage-gap internals, capsule-gap internals, and retry diagnostics are
  developer evidence, not production stylist copy.

### Implemented capsule behavior

- Introduced explicit `plan_kind` routing (`trip`, `seasonal_capsule`, `coordinated_plan`) while
  preserving the conversational model's control over whether and how to plan.
- Added the 24-piece default, category quotas, coverage-first roster correction, per-slot capacity,
  representative-rotation allocation, distinct-core enforcement, truthful plan chips and notes,
  and a finite-roster expansion path.
- Split explicitly named home time from errands/weekends during capsule decomposition without
  inventing a new `home` hard gate. Current wardrobe metadata is too sparse to support that gate
  honestly.
- Added slot-aware preselection so pieces blocked by every requested slot cannot consume a finite
  capsule quota. The selector remains unchanged when no slots are supplied.
- Corrected seasonal-capsule shoe reuse: all shoes deliberately selected into the finite capsule
  may be demonstrated; the packing-light three-shoe ceiling remains for trips and other ordinary
  `reuse:maximize` plans.
- Preserved model-authored card titles, surfaced deterministic plan notes without clipping them,
  changed the 12-card cap disclosure from failure language to curation language, and made
  “Show another” unavailable when the saved slot's distinct-core capacity is exhausted.
- Replaced the generic multi-turn capsule expansion loop with one bounded structured-output call
  over the saved roster and slot. It performs no automatic corrective call after rejection.
- Replaced the main capsule search/propose/retry loop with one atomic, provider-enforced structured
  composition call after `plan_outfit_set` fixes the roster and slots. The outer model receives a
  final prose turn with tools disabled; it cannot search, re-plan, submit more cards, or promise to
  bypass the atomic result manually.
- The atomic composer now receives full structured garment truth plus a 448px thumbnail for every
  roster piece with an available image. This fixed the earlier partially blind composition
  contract that omitted pairing and real-wear rules.
- The composition schema now requires exactly the requested representative-look count. Its output
  ceiling scales with that count (actual generated tokens determine billed output cost). Empty or
  partial arrays cannot be reported as success; an empty atomic result becomes an engine error and
  cannot lead to “I’ll build it myself slot by slot” continuation prose.

### Live evidence and corrections

- The original winter capsule exposed excessive retrying, partial-result loss, generic titles,
  missing cardigan/transition-layer roles, warm-season tops dominating an indoor winter rotation,
  incorrect plan chips, repeated shoes, clipped notes, and internal validation text leaking into
  the UI. Each finding was converted into provider-free regression coverage before the next live
  check.
- The first one-call “Show another” attempt proved the no-retry architecture but failed because
  free prose consumed the JSON allowance. Expansion now uses provider-enforced structured output.
  A later attempt correctly stopped after one invalid result; saved capacity now prevents offering
  a billed action where no unused core exists.
- The first simple summer request (`thread_1785272841293`) verified natural one-question intake,
  the 24-piece default, roster images, atomic composition, and immediate tool shutdown. It exposed
  the seasonal shoe-cap leak, production debug-note leakage, and a combined home/errands context;
  all three were corrected offline.
- The first trip comparison (`thread_1785271684246`) ran against a stale process and is not valid
  isolation evidence. After restart, `thread_1785272563870` stayed on the ordinary trip path and
  produced all four requested looks without capsule context. Weather follow-through after a
  destination clarification and the dress-plus-patterned-shawl result remain separate open trip
  findings.
- A subsequent summer capsule returned zero cards and said the engine needed more guidance before
  promising manual slot-by-slot construction. Offline reconstruction proved that every requested
  slot had ample valid supply (allowed-piece counts 13/13/13/22/24; distinct valid core capacities
  25/25/25/81/91). The cause was the atomic response contract, not the wardrobe: an empty array was
  schema-valid, the 12-look output allowance was tight, and omission language contradicted the
  already-proved capacity. Exact-count schema enforcement, scaled output allowance, and the
  explicit zero-result error path are now implemented.

### Garment-data findings kept as data

- Garments 93 and 172 were corrected by the owner from dressy to elevated; their earlier audit was
  stale. They are eligible even when absent from a representative rotation.
- Garment 97's top-level experimental status—not its nested AI profile—was the blocking source; the
  owner changed it to trusted.
- Garment 996775 is a puffer coat and was corrected by the owner to elevated with evening use; it
  can serve elevated outdoor transitions. Garment 996762 remains appropriately blocked from
  dinner use.
- Many cardigans are top-level outerwear. Capsule logic now recognizes the indoor-cardigan job
  through structured layer properties rather than assuming every outerwear record is an outdoor
  coat.
- No garment IDs or names were embedded in engine rules.

### Cost controls and verification state

- Added provider-free scenario matrices, captured-roster replays, lifecycle audits, roster-utility
  audits, tool-script replay, per-call usage aggregation, and permanent contract tests. These are
  the default workflow; live calls are reserved for final integration checks.
- Current offline evidence after the exact-count/zero-result fix:
  `test/plan_outfit_set.test.js` plus `test/stylingIntent.test.js` 130/130;
  summer replay 11/11 accepted with no raw production validator lines; summer/winter
  10/14/18/24 scenario matrix has no unexpected structural gaps; roster-utility, style-claims,
  text-matching ratchet, and `git diff --check` pass.
- The last complete dirty-worktree suite observed nine failures: the seven established AI-contract
  baseline failures plus two unrelated current prompt/UI assertions. A later complete-suite retry
  was blocked by sandbox `listen EPERM`, so do not claim a new full-suite baseline from the focused
  runs. The stash list was inspected but not mutated; no trustworthy clean-stash comparison was
  available.
- No billed call was made by the agent for offline diagnosis or verification. Live tests were
  initiated explicitly by the owner.

### Current handoff point

The owner restarted the backend and completed a fresh “I want a summer capsule” live test after
the exact-count schema and zero-result handling changes (`thread_1785278212091`). Per the owner's
instruction, the consolidated record above was completed **before** inspecting
`/tmp/wardrobe-dev.log`.

The log then confirmed that the exact-count correction worked: the atomic composer submitted the
full bounded rotation in one call rather than returning an empty array. Ten cards were accepted.
Two of the three submitted `City Outings & Museums` looks used high-heeled piece 199 and correctly
failed the existing walking/activity gate. There was one validation pass, one partial acceptance,
and no automatic retry. Persisted turn usage was four provider iterations total (intake intent,
lifestyle/planning turn, nested atomic composition, and final prose), 14,603 input tokens, 2,987
output tokens, 71,443 cache-read tokens, and 47,351 cache-creation tokens. All 24 roster images
were attached to the atomic call.

The run exposed a separate final-prose contract defect. Although `plan_outfit_set` said “10
representative capsule outfits accepted” and explicitly prohibited additional actions, the outer
model:

- falsely called ten an “engine ceiling” (the requested 13 looks were curated to the 12-card
  initial cap, then two city cards failed validation);
- blamed the one-look nature-walk allocation instead of accurately disclosing the two rejected
  city cards; and
- manually supplied one extra city outfit and one extra nature-walk outfit in prose, with garment
  IDs, even though neither suggestion was represented by a validated card.

The internal high-heel failure reasons stayed out of the displayed structured cards, which is
correct, but the final model filled the missing coverage with invented explanatory copy. Diagnose
the final-response guard/contract before changing behavior; do not weaken the walking footwear
gate and do not make another billed request until the prose-addition path has provider-free
coverage.

**Resolved offline after owner approval:** completed atomic capsules now pass through a
capsule-specific final-answer check before the ordinary retrying output guards. A natural closing
that only introduces the accepted cards passes unchanged. A closing that cites garment IDs absent
from the accepted cards, invents an engine/card ceiling, or offers an additional/alternate outfit
in prose is replaced locally with a concise deterministic statement that the displayed cards and
Stylist's notes are the complete result. The replacement never asks the provider to retry and
increments the persisted `capsule_final_fallbacks` counter.

The same change removed the two remaining “budget implies capsule” planner fallbacks. Capsule
selection now requires `planKind === "seasonal_capsule"` even for direct engine callers; focused
tests were migrated to pass their intent explicitly. A permanent regression proves a budgeted
`trip` keeps an empty capsule roster. The runtime stylist prompt also no longer says a budget is
what makes a capsule, no longer advertises 14–20 displayed cards, and states the single
`min(piece_budget, 12)` initial-rotation cap. The budget still controls a genuine capsule's roster
size; it no longer determines plan identity.

Offline verification after these changes: focused planner/observability/intent contracts 183/183;
captured summer replay 11/11 accepted; summer/winter 10/14/18/24 matrix has no structural gaps;
current roster-utility audit has zero all-slot-blocked selected pieces; style-claims,
text-matching ratchet, and `git diff --check` pass. No billed call was made.

### Seasonal capsule is now a first-class plan kind

Owner ruling: a person may simply ask for “a summer capsule.” The product—not the person—must know
what a useful seasonal capsule entails. Do not require the user to prescribe internal occasions,
layering rules, a representative rotation, or a piece count. If lifestyle coverage is genuinely
unknown, the stylist may ask one natural question that would materially change the result; it must
not turn the intake into a stylist's questionnaire.

Implementation:

- `plan_outfit_set` now requires an explicit `plan_kind`: `trip`, `seasonal_capsule`, or
  `coordinated_plan`. The question-text fallback exists only for old direct callers.
- An unnumbered seasonal capsule receives the owner-ruled 24-piece working ceiling. An explicit
  user number still wins. The selected coherent roster may be smaller and must report its truth.
- Capsule roster selection, capsule validation, the larger representative-rotation cap, and the
  atomic one-call composer are gated by `plan_kind === "seasonal_capsule"`, not by the presence of
  a piece budget. A trip with a packing limit remains a trip and keeps the established trip
  workbench.
- After a successful atomic capsule composition, the outer conversational model receives one
  final prose turn with no tools exposed. It cannot spend more iterations searching, re-planning,
  or proposing cards after the bounded result already exists.

Offline coverage includes the simple unnumbered request, the 24-piece default, explicit
trip/capsule isolation, and post-composition tool shutdown. No billed model call was made.

### Live trip-isolation verification and follow-ups

The first attempted comparison (`thread_1785271684246`) began seconds before the separating code
landed and therefore exercised the stale process: a 12-piece Tahoe packing list entered atomic
capsule composition, returned only two of four requested looks, persisted `capsulePlanContext`,
then continued through searches and a blocked proposal for nine provider iterations. Do not use
that thread as evidence about the new routing.

After restart, `thread_1785272563870` verified the intended boundary. The model explicitly sent
`plan_kind:"trip"` with the same 12-piece budget; the ordinary slot workbench produced all four
requested looks on its first submission; no capsule context or capsule-gap wording was persisted.
The clarification also opened naturally instead of leaking the prior correction-shaped “You're
right” phrasing. The completed plan turn used six provider iterations rather than nine.

Two trip-flow findings remain open and are deliberately not capsule changes:

- The stylist asked for a named destination because weather mattered, but after “It’s Tahoe” the
  plan omitted dates and used `hot (estimated)` rather than resolving live weather. A destination
  clarification must lead to the promised weather resolution when the forecast window can be
  inferred or must ask for the missing dates plainly.
- The dinner card paired a black abstract-print dress with a red paisley shawl and justified the
  second pattern because it draped. This should be reviewed against the ratified stricter pattern
  discipline; drape alone is not an exemption from the one-loud-print rule.

### First simple summer-capsule live test and corrections

`thread_1785272841293` verified the new intake and bounded architecture end to end. “I want a
summer capsule” produced one natural lifestyle question; the answer became four lived use-case
slots; `plan_kind:"seasonal_capsule"` received the 24-piece default; the atomic composer saw 20
available roster photos; and the outer turn stopped immediately after the bounded result. The
completed generation recorded four provider calls including the nested composition call, with no
search/replan loop.

The run also exposed three production defects, corrected offline:

- A three-pair shoe cap attached to `reuse:maximize` rejected two restaurant looks even though the
  24-piece seasonal roster intentionally contained four shoes. Seasonal-capsule reuse now means
  mix-and-match value across the bounded roster; trip and other packing-light plans retain the
  three-pair cap.
- Atomic validation traces (`[capsule gap: ...]`, `[coverage gap: ...]`, validator coaching, and
  bounded-composition internals) were copied into persisted stylist notes and then paraphrased by
  the conversational model. Atomic failures now remain in server logs and numeric diagnostics;
  production plan lines contain only the accepted representative rotation.
- The bold botanical tiered midi skirt (92) was not a blind-image failure: its photo was available
  and its structured truth says bold/loud hero, casual/city high, but home low. The composer blurred
  “home” with “errands” inside one combined slot. The atomic composition contract now states that
  `best_for` is the lived scenario, not decorative text, and that a broad occasion gate does not
  override a garment's more specific context truth. A combined slot's rationale must name the
  narrower context the look genuinely serves.

Regression coverage proves seasonal capsules can use every shoe selected into their roster while
ordinary `reuse:maximize` plans still block a fourth pair; atomic failure details remain observable
but absent from production plan notes. Planner suite 118/118, provider-free capsule matrix has no
structural gaps, style-claims and text ratchets pass, and the AI contract suite remains at the known
136 pass / 7 pre-existing fail baseline. No billed call was made for these corrections.

The live summer case is now a permanent provider-free fixture:
`npm run test:capsule:summer-replay` reconstructs `thread_1785272841293`'s exact 24-piece roster
and saved per-slot gates, then submits an 11-look structural reference rotation through the real
validator and production metadata assembler. It proves 11/11 can clear from that roster, with zero
validator failures and zero raw validator lines in production notes. The reference combinations
are deliberately structural evidence, not saved aesthetic recommendations. This restores the
preferred working rhythm: recorded live evidence becomes a free regression fixture; further
capsule changes are batched offline before any final live acceptance run.

`npm run test:capsule:lifestyle-audit` adds the structured lifestyle audit for the same roster.
It found a real representation boundary: the frozen engine already has a `home_loungewear`
profile and garment records carry `occasion_confidence.home`, but `home` is absent from the
planner's controlled occasion vocabulary. The live planner therefore merged home with generic
casual/errands. On the captured roster, 16 pieces are explicitly home-low, 8 are unknown, and zero
are home-high/medium; across the entire active wardrobe only one top and one outerwear piece are
home-high, two shoes are medium, and no bottoms are home-positive. Therefore adding a deterministic
home gate now would falsely starve the capsule rather than solve the styling problem. Recommended
next ruling: when the owner explicitly names both home and errands/weekends, keep them as separate
lived-context slots while retaining the existing `casual` hard gate; let the model use `best_for`,
full garment truth, and images to judge low-key home suitability. Do not add a new home hard filter
until the metadata has enough coverage to support it.

Owner agreed. Implemented as a capsule-decomposition rule in `STYLIST_SYSTEM`: explicitly named
home time and errands/weekends become separate `At Home` and `Errands / Weekends` slots, both using
the existing `casual` hard gate. No occasion vocabulary, profile, score, or garment gate changed.
The saved summer replay now exercises the five-context split and still accepts 11/11 structural
reference looks with zero raw production diagnostics. Prompt contract, planner suite 118/118,
style-claims check, and text ratchet pass; no billed call was made.

### Capsule roster slots must have a real job

The captured summer roster exposed an audit-category error and one real selector defect. Garments
93 and 172 were first audited from stale pre-edit formality values; after the owner's edits both
are `elevated`, pass at least one requested slot, and were merely absent from the recorded
representative rotation. That is legal: a representative rotation need not display all 24 roster
pieces. Garment 132, by contrast, remained top-level `recommendation_status:"experimental"` and
was blocked by every normal-composition slot even though its nested AI profile said trusted.

`selectCapsuleRoster` now applies the existing trust/register/weather/activity gates to every
requested slot before spending category quotas. Eligibility is a union: a piece may fail four
contexts and still enter if it has one legitimate capsule job; a piece blocked from every context
cannot consume the finite roster. With no slots, the generic selector is unchanged. The audit
`npm run test:capsule:roster-utility` now reports historical “used,” “eligible but unused,” and
“blocked everywhere” as separate states, and separately verifies that today's selector contains
zero all-slot-blocked pieces. Permanent planner coverage pins the rule. No gate was weakened and
no billed call was made.

### Capsule testing cost controls, before capsule behavior work

Added a provider-free testing layer before changing capsule behavior:

- `scratch/diagnose_capsule_scenario_matrix.js` / `npm run test:capsule:offline` runs the real
  roster selector and hard gates across summer/winter, budgets 10/14/18/24, and casual,
  mixed-register, and social slot sets. No AI client, network request, or write. Its first run
  reproduced the recorded winter defect for free: the 14-piece winter mixed-register roster has
  zero evening cores, while summer at the same budget covers all slots.
- `replayStylistToolScript` in `styling-engine/provider.js` replays
  `declare_intent → plan_outfit_set → submit_plan_outfits → final` through the real tools and a
  shared context without constructing a provider client. Acceptance coverage lives in
  `test/plan_outfit_set.test.js`.
- Every real tool-loop provider iteration now aggregates input/output/cache tokens into the turn's
  `freeformDiagnostics`; the totals are returned in `/ask`'s existing `debug` payload and persisted
  in `freeform_generation_runs` for later cost audits.

No capsule selection, cap, trim, or composition behavior changed. Focused affected suite: 140/140
passing. Full `npm test`: established 7-failure baseline. The required `git stash push -u` baseline
check was attempted, but returned success while creating no stash and leaving the worktree
unchanged; the existing top stash is older and unrelated, so it was deliberately not touched.

**Winter gap diagnosed immediately afterward, still not fixed:** at budget 14 the initial winter
roster's only evening-capable bottom is the dressy oatmeal crochet midi skirt (93).
`capsuleDemandReserve` sees two requested casual looks and swaps that skirt for a second everyday
bottom, raising casual capacity 2→5 while collapsing evening 4→0. Full piece-level trace and the
general coverage-first policy implication are in `docs/stylist-bugfix-spec.md` → “Seasonal check.”

### Remove button didn't clear the board-feedback chip

The new Style Profile **Remove** button (added earlier the same session, see below) called the
existing `DELETE /api/stylist-feedback/:id` endpoint, which archives the row and correctly
re-syncs `saved_boards.payload.feedback_labels` for canonical (saved-to-Visual-Lab) boards. But an
unsaved board has no `saved_boards` row — `StylistChat.jsx`'s `boardFeedbackActive` falls back to
a per-thread snapshot (`chat_threads.payload.boardFeedbackLabels`), and **nothing had ever cleared
that snapshot**, not even the chat's own pre-existing "un-toggle a chip" flow. So deleting the
feedback row (via Remove, or by un-toggling the chip in chat) left the chip showing active again
next time the thread loaded, from either surface.

Fixed both sides that write into this snapshot:
- `routes/crud.js`: new `clearThreadBoardFeedbackSnapshot(row)`, called from the DELETE route —
  this is the one place both surfaces converge, since Style Profile has no access to the chat's
  live React state.
- `StylistChat.jsx`'s `toggleStylistFeedback`: the removal branch now also strips the type from
  local `boardFeedbackLabels` state, mirroring what the add branch (`saveStylistFeedback`) already
  did.

Live-verified in the sandbox (`thread_1784969252663`, "Friends Hangout" board, `generated_visual_board:4:0`
bucket): clicked "Looks good" for real, confirmed the bucket held `["works"]`; clicked it again to
un-toggle, confirmed the DELETE fired against the correct feedback row, the chip un-highlighted,
and the bucket came back `[]`. `npm test` still at the established 7-failure baseline.

**Caught a testing-process mistake worth flagging for next time:** an early verification pass used
`computer` click coordinates read off an 800×450 screenshot while `read_page`'s returned
coordinates were relative to the actual 1280×720 viewport — clicks landed on nothing, no network
request fired, and a stale leftover DB value made the follow-up check look like a pass. Caught by
cross-checking `read_network_requests` for the expected DELETE call before trusting a "looks
fixed" API read. Always click via `ref`, not raw screenshot-derived coordinates, when the two
differ.

### A1/A2/A5 shipped, C3 ratified, piece-action-menu rebuilt end to end

Re-verified panel-stage1-findings.md's Section A against the code (per its own "recurring failure
mode" warning) before trusting the "accepted, not yet implemented" status line — confirmed it was
still accurate, then implemented and shipped:

- **A1, A2, A5** — all three as `styling-engine/prompts.js` instruction fixes (this is
  chat-composed styling, not a deterministic gate): pattern discipline now explicitly covers
  shoes/accessories (A1); a new "Scarcity Honesty" rule degrades look count instead of writing
  confident rationale for a violated brief (A2); a new "Pushback on a Specific Garment" rule
  requires re-reading the garment record and forbids a byte-identical card in response to a
  correction (A5). A4 was deferred at that point because it belonged with the capsule redesign;
  the later 2026-07-28 capsule work implemented it there.
  Safety-rail snapshot `test/fixtures/prompts_yuna_snapshot.json` updated to match (deliberate
  content change, confirmed via diff that only the touched keys moved).
- **C3 ratified** as `AGENTS.md` Engineering Principle #7 (the five-question decision rule for new
  structure), amended twice from running it for real: added a build/fix/kill trichotomy (a failing
  test names what's missing, doesn't always mean delete) and a "deliberately soft" carve-out for
  test 3 (the `owner_rule` case, soft by design after the #44 memory-pollution incident). Full
  derivation stays in `docs/panel-stage1-findings.md` → C3.
- **B1 corrected** — the panel's two "chip → structure" proposals both already existed
  (`Wrong for <occasion>` hard edit; `store_user_correction` → editable Style Profile rule), same
  shape as the earlier C4 correction: argued from a packet without code access. Running C3 against
  the *existing* mechanism (not just proposals) is what surfaced the real, previously-unknown gap:
  `occasion_exclusions` had no view or undo path anywhere outside the chip itself.
- **The piece action menu (`···` on any outfit-card garment) rebuilt across several owner-caught
  rounds** — full derivation and every live-verification step in `docs/app-surface-map.md`'s
  occasion-exclusion entry, this is the summary:
  - Added the missing **Occasion exclusions** view (Style Profile) so the hard exclusion from
    above is checkable and reversible.
  - Trigger changed from literal `...` (reads as truncation, not a button — probably why two
    review passes missed this menu entirely) to the standard `⋮` kebab, better contrast.
  - Panel rewritten as a `document.body` portal (`PieceActionMenu` in `StylistChat.jsx`) — the
    old absolutely-positioned version was silently clipped on every edge (left/right/bottom) by
    the outfit card's own `overflow: hidden`.
  - Categorized into Piece information / Outfit pairing / Occasion rule (owner mockup), each with
    an icon and a plain-language consequence line; copy corrected against the actual scoring code
    before shipping (traced `getWholeWardrobeFeedbackMemory` — the "Replace" action penalizes the
    piece itself, not "this pairing," which is what the mockup's text claimed).
  - Two real regressions caught and fixed **in the same review, both by the owner, neither by
    me first**: a capture-phase auto-close raced the button's own click under genuine pointer
    input (synthetic `dispatchEvent` testing didn't reproduce it — real clicks did), breaking
    "Edit piece details"; and a button-label fix that didn't touch the actual click handler,
    so "Open source chat" kept opening the garment editor regardless of what it said.
  - Style Profile's "Outfit & styling feedback" list: raw `wrong item read` label → "Replaced in
    this outfit" (matches the chat's own words); its "Open garment"/"Open thread" choice reordered
    to prefer the thread (garment shows the piece in isolation, no outfit, no "why"); added a
    piece-set board-match fallback (`matchedBoardByPieceSet`) for threadless rows, generalized
    beyond just this one feedback type; added a **Remove** button (existing delete endpoint,
    previously unexposed here) for the rows that have no board, no thread, and never did.
  - **New, unfiled defect found while answering "what is this other entry":** legacy
    `message`-type feedback embeds its board image as markdown text instead of a structured field,
    so it can't be linked even when a matching board and thread both still exist — see `## Open`
    below.

### Board feedback desync fixed, plus three bugs found along the way

Picked up `docs/board-feedback-desync-spec.md` (previously "diagnosed, not implemented"). Now
**implemented and live-verified** — see that spec's "The display fix" section for the mechanism
(chat now indexes saved boards by `imageUrl` and branches reads/writes through the canonical
`saved_boards` record, same as Visual Lab). Full details, including what was deliberately left
alone, are in that spec; don't duplicate them here.

Three more bugs surfaced and were fixed in the same session, none of them things this session set
out to find:

1. **Wrong-length garment picker** (`GeneratedBoardLengthFeedback` in chat, its twin in Visual
   Lab) reset to the first piece on every open/close and never indicated which piece already had
   a saved correction — a correction on a second or third garment looked missing. Fixed by
   replacing the picker with one always-visible reason group per piece; also filtered which
   reasons apply by garment category (shoes/accessories get none). See
   `docs/app-surface-map.md`'s board-feedback-chips entry.
2. **Two chat board-rendering surfaces had no feedback UI at all** (`m.renderedBoards`/
   `render_preview`, and `boardResults[i]`/"wardrobe-board") — separate from the desync, since
   there was nothing to desync when one side had no chips to begin with. Given the desync fix's
   canonical helpers already existed, extended the same taxonomy to both. All four board surfaces
   in the Stylist now behave consistently.
3. **Thread-loading race**: opening a thread by direct URL could silently render a *different*
   thread's messages under the correct URL/title, survivably across a hard reload — a competing
   mount-time effect (`initAndMigrate`) picked its own thread from `localStorage`, independent of
   the URL, and reliably finished last. Fixed by making that effect's guard also skip when a
   thread was requested via the URL. See `docs/app-surface-map.md`'s thread-rail entry.

Also: Visual Lab's Calibration Boards "Needs review" filter was renamed to **"Flagged"** and no
longer includes `almost` ("Almost right"), which is a positive-leaning verdict and now counts as
Positive instead.

All fixes live-verified in the sandbox (feedback clicks are free, no billed calls). Build passes
throughout; suite held at the 7 pre-existing baseline failures the whole session (two test files
needed updates for refactors, not new failures).

## State

Two full days of work, and **the durable output is documentation, not code**. Stage 1 of the expert
panel ran; the more productive activity turned out to be mapping the app, which found four surfaces
the panel packet had missed and several behaviours nobody had written down.

**Docs that now exist, in the order a new session should read them:**

1. `docs/app-surface-map.md` — 33 entries. Every route, tab, mode-split and dialog. Plain English
   first, stores as a footnote, every observation tagged `[by design]` / `[known bug → ref]` /
   `[unverified]` / `[owner check wanted]`. **Read this before assuming anything about the app.**
2. `docs/engine-behaviour-map.md` — the non-UI companion, twelve passes and ~1,555 lines. Side-effect
   writes, thread state, retry loops, prompt splices, sweeps, **scoring weights with measured
   firing rates, caches, CI ratchets, the gates (every layer in order, with measured exclusion
   counts per context), the outfit-level pass after them (advisor-vs-gate mode, repair, diversity
   penalties), the full image-generation path including cost reporting, and the tagger prompt that
   populates every column the rest of it measures, the role vocabulary behind formula-family
   classification, a provenance table of which columns are yours vs the tagger's, and a swept
   singular/plural bug class.** Read its **Findings this map produced** section first: **33 things**
   that were not known before, including one unreachable code path, a billed render that reports no
   cost, a cost gate that under-quotes by 1.6x, and six garment keywords that never fire at all. No
   `[unverified]` tags remain in the body — anything answerable was answered.

   **Four findings withdraw or reorder recommendations made earlier in the same document**, each
   marked in place. All four were caught by the same two checks, which is the durable lesson:
   **check provenance** (owner-set or tagger-set? which prompt version?) and **check the keyword**
   (does the regex actually match real garment names?). Two scripts now do exactly that.
3. `docs/panel-stage1-findings.md` — the panel synthesis organised for triage by ID. Section A,
   C3, and B2 are ruled; B1 is substantially closed; later capsule decisions reconcile C1/C2/D1.
   B3, C4, C5's wording, and the unresolved E propositions remain open.
4. `docs/expert-panel-brief.md` — ratified protocol. **Part 4b lists six ways the implementing
   agent got this wrong**; read it before assembling a packet.
5. **`docs/tagger-cost-spec.md`** — **draft, awaiting ratification.** Cost-first tagger spec:
   cold-start onboarding is the primary case ($12.18 for 200 garments today, target <=$3.50).
   Four phases, one billed step (~$2.70), decision rule written down. Read §2 first — it lists the
   prior rulings that constrain it.
6. `docs/board-feedback-desync-spec.md` — **implemented and live-verified 2026-07-27.** Read for
   the mechanism if touching board feedback again; not an open item anymore.
7. `docs/ui-v1-design-handoff.md` — rulings, plus **Outstanding issues 1–8**.

**Eleven derivation/measurement scripts**, all read-only and free — none constructs an AI client:

| script | answers |
|---|---|
| `derive_surface_skeleton.js` | every surface, diffed against the surface map |
| `derive_engine_behaviours.js` | writes, retry loops, prompt splices |
| **`derive_board_producer_fanout.js`** | **for each image-producer function: its server call sites, and which frontend render block consumes the result — flags any board-rendering block with no feedback-chip UI.** Neither the surface map (UI-structure-first) nor the engine map (producer-function-first) tracks this fan-out axis; this is what caught the two no-chip surfaces fixed 2026-07-27. |
| `measure_scoring_terms.js` | how often each scoring term fires on the real 236-piece wardrobe |
| `measure_gate_impact.js` | what the hard gate excludes per context, by reason |
| `measure_diversity_classifiers.js` | the repeat-detection buckets diversity penalises on |
| `measure_image_path.js` | image payloads, prompt sizes, tagger cost vs the preflight estimate |
| `measure_roles.js` | the role vocabulary behind formula-family classification |
| **`measure_plural_gap.js`** | **which keyword rules never fire because names are plural** |
| **`measure_provenance.js`** | **which columns are owner-set vs tagger-set** (`<colA> <colB>` cross-tabs) |
| `measure_open_questions.js` | re-derives the findings the map turned up |

Run them to check the maps have not rotted. **The last two are the ones that stop wrong fixes** —
provenance caught three bad recommendations, and the plural sweep showed that several measured
distributions in the map are understated. Run both before acting on anything keyword- or
column-derived. **Run `derive_board_producer_fanout.js` too** before touching any board-rendering
surface — it's the one that catches a shared function with inconsistent frontend consumers (see
the recurring-failure-mode entry below); nothing else here checks that axis.

## What is decided vs open

**Ruled (panel findings section A):** A1 prints on shoes/accessories, A2 confident rationale under
scarcity, A4 shoe register span, A5 reasoning-then-interaction — all **accepted**. **A1, A2, A5
implemented and shipped 2026-07-28** (see this date's session entry above). **A4 was initially
deferred and then implemented inside the capsule redesign**: mixed-register and demanding-activity
shoe paths are protected in the roster and checked by the validator. A3 rejected (asking what you
own is deliberate). A6 reframed — the `~$0.07`
labels are owner-facing instrumentation, not user pricing, so the question is tiers, not honesty.

**C3 ratified 2026-07-28** — now `AGENTS.md` Engineering Principle #7, not an open item.

**B1 partially ruled 2026-07-28** — the per-piece menu consistency question and the
occasion-exclusion visibility gap are closed (see session entry above); the remaining half
(narrating a chip's effect at the moment it fires) was tried, found to have real problems for the
structured-feedback-chip case, and the owner ruled the chip's own active-state color is sufficient
— not pursued further for that case.

**B2 ratified 2026-07-29** — retain `Visible facts` as stored diagnostic evidence, while the normal
client surface separates a concise `userCritique` from a same-call four-paragraph
`detailedCritique` behind **More detail**. Current voice/provenance behavior is accepted for now.
Corrections happen through follow-up conversation rather than an editable `Intent` control. Older
saved evaluations keep their structured fallback. One provider call plus bounded output and
removed redundant prose is sufficient for the cost ruling; caching, telemetry, and a lean
follow-up contract are separate optimizations.

**Later capsule rulings reconcile C1/C2/D1.** Capacity is reported separately from a curated
`min(piece_budget, 12)` representative rotation; allocation is coverage-first and bounded by
per-slot capacity plus whole-plan distinct-core feasibility; the piece budget remains a real
finite-roster bound; and the roster is no longer trimmed to only pieces appearing in the shown
cards. The findings doc records which parts of the panel proposals survived.

**Not ruled:** B3 diagnostic cards, C4, C5's wording, and which unresolved E propositions become
product commitments.

**Stage 2** (Mode A craft review, per flow) not started. It should use the surface map's inventory.

## Read first, in order

1. **`docs/expert-panel-brief.md`** — the ratified panel protocol. Two modes: Mode A is craft
   review (proven on Wardrobe and Lookbook), Mode B is direction review over propositions (new,
   untested). Stage 1 for the Stylist is Mode B over the whole feature; Stage 2 is per-flow Mode A
   on whichever flows survive.
2. **`docs/stylist-bugfix-spec.md`** — everything found, fixed, and deliberately not fixed, with
   the owner rulings attached.
3. **`docs/ui-v1-design-handoff.md`** — the **Outstanding issues** and **Resolved, not open**
   sections. The second is copied verbatim into any panel packet; never paraphrase it (paraphrasing
   it once inverted it and cost a panel run).

## Hard rules

- **Never make a billed model call.** The owner is budget-constrained. Diagnose against the
  read-only database (`wardrobe.db`, 236 pieces) or with scratch scripts that call the real engine
  functions directly — see `scratch/diagnose_capsule_shoe_roster.js` and
  `scratch/build_dedup_fix_demo_thread.js` for the pattern. Both produce real engine behaviour with
  no AI call.
- **Do not kill anything on ports 3098/5174 without asking.** A previous session followed
  `CLAUDE.md`'s unconditional-restart rule and killed the owner's server mid-generation. That rule
  is still unamended and is what caused it. Port 3098 is frequently the owner's own **un-mocked**
  server.
- **`sandbox-web-asuser` (port 5176)** is the sandbox web server without `VITE_STYLIST_DEBUG` —
  use it for any "what does the owner actually see" question. `sandbox-web` (5174) has the dev flag
  on and shows engine internals no user ever sees.
- **`wardrobe-web` (5173) proxies to the live un-mocked API.** Browsing stored threads is free;
  clicking `Generate outfit image`, `Evaluate outfit`, or `Preview all directions` spends real
  money. Keep review agents off it entirely.

## Before generating panel evidence

**Clear the whole-wardrobe session recency memory**, unless the artifact is meant to show the
rotation mechanism — in which case declare it, with the skip count. The memory silently narrows the
pool (observed: 10 of 23 pieces skipped), and the only sign is one line in the composer footer.
**Include them again**, or `DELETE /api/ai/whole-wardrobe-session-memory`. Full rule in
`docs/expert-panel-brief.md` → Part 4.

## The recurring failure mode — read before reporting anything as a bug

Four times in one session, an absence was reported as a defect and turned out to be deliberate or
simply unbuilt:

- **Garment IDs in stylist prose** ("the tan leather tote (ID 12)") — requested, because garment
  names collide constantly, especially auto-tagger-written ones. The *presentation* is open to
  redesign; the disambiguation problem is not negotiable.
- **"city stroll" implying walking shoes** — by design.
- **One shoe carrying 7 of 8 capsule looks** — the 14-piece budget buys exactly 3 shoe slots
  (`capsuleQuotas`), one of which the register-floor guarantee spends on an evening-capable shoe.
  Correct behaviour.
- **Plans not absorbing their own revisions** — never built.

For any capsule- or plan-shaped question, start at `capsuleQuotas` / `selectCapsuleRoster`, **not**
at the per-slot gate. The gate, `PLAN_WORKBENCH_PIECE_LIMIT`, `planWorkbenchPieceScore`,
`fit_confidence`, and feedback influence all operate *after* the roster is chosen — an entire
investigation was spent in the wrong layer.

### A second failure mode, distinct from the one above — doc status claims go stale too

The four cases above are about *product behaviour* looking like a bug when it wasn't. This one is
about *a doc's own claim that something is still a bug* being wrong. Found 2026-07-28: an entire
section of `docs/stylist-bugfix-spec.md` ("§6, lower priority, same surface") listed four items as
open — a raw error string reaching the UI, a button-height CSS inconsistency, a missing
focus-return, and a styling gap in a chat component — and **all four had already shipped in
earlier PRs**. Nobody had gone back to update that spec once the fixes landed elsewhere. Worse:
the session immediately before this one **repeated one of those stale claims into new doc text**
(a "deliberately left unfixed" note in `docs/app-surface-map.md`) without checking the code first
— the exact same failure this project's docs keep warning about (measure one source, don't verify
against the current state), just applied to a doc's bug-status tag instead of a product behaviour.

**Before trusting any `[known bug]`, "still open", "not yet implemented", or similar status claim
in these docs — especially one you're about to cite, repeat, or build on — grep the code it names
and confirm the claim is still true.** A status tag is a claim about the state of the code *at the
time it was written*, not a live query. The docs get long-lived precisely because they're mostly
right; the failure mode is trusting the 5% that quietly went stale.

### A third failure mode — proposing structure that already exists, because the maps went unread

Found 2026-07-27, working panel finding B1 ("are chips a teaching mechanism"). The panel's packet
had no code access, so it argued from absence: chips "carry verdicts, not teaching," and offered
two synthesis proposals — a chip that opens a freeform note, and a chip that proposes a garment tag
edit. **Both already existed**, in a stronger combined form: the per-piece `Wrong for <occasion>`
chip is a one-click hard edit to `pieces.occasion_exclusions` (`docs/app-surface-map.md` lines
133-153), and `store_user_correction` from chat prose already surfaces as an editable, retirable
`owner_rule` in `StylistSettings.jsx`'s "Learned rules & preferences" (same doc, lines 860-882).
Neither is a secret — both are documented, with exact code locations, in the surface/engine maps.
An entire round of B1 analysis was written and delivered to the owner before either was checked.

That is a different mistake from the two above: not trusting a stale claim, but **skipping the
maps entirely when reasoning about what the product does or doesn't do.** The read-first list at
the top of this doc already says to read `app-surface-map.md` and `engine-behaviour-map.md` "before
assuming anything about the app" — this incident is what skipping that instruction looks like in
practice, mid-session, on a task that felt like open design discussion rather than "assuming."

**Before ruling on, redesigning, or filing as "missing" any B/C/D/E item in
`docs/panel-stage1-findings.md` (or any other proposition that claims the product lacks a
mechanism) — grep both maps for the item's key nouns first**: the feedback-taxonomy label, the
chip text, the tool name, the endpoint. If a mechanism doing roughly the job already exists, the
real question shrinks to whether it's complete/consistent/visible enough, not whether to build it.
This applies even mid-conversation, not just at session start — the maps don't go stale between
your first Read and your fifth tool call in the same session, so re-check them, don't rely on
memory of having glanced at the table of contents once.

## What shipped in PR #176

Legacy diagnostic cards leaking raw gate vocabulary; the `Useful repeats` label read from
structured `pieceReuse` instead of a keyword guess; look counts describing the plan rather than the
collapsed viewport; plan and whole-wardrobe responses no longer discarding the model's entire prose
answer; the canned "Outfit ideas for X…" line removed; engine field dumps kept out of the notes
disclosure; plans exempted from the outfit fold; raw slot ids removed from rail subtitles along
with a latent regex-alternation bug. Each has a regression test. Build passes; the suite sat at 6
known pre-existing failures at merge time — now 7 (see this session's note above; confirm with
`git stash` before attributing any new one).

## Panel artifacts

Real wardrobe (236 pieces): `thread_1784970885986` (14-piece capsule — the budget/declaration
case), `thread_1785005174812` (Tucson trip — clarify-then-plan, declared shoe economy),
`thread_1784240128734` (wedding — the one case where a live forecast actually resolved),
`thread_1785003920853` (today/dinner — conversational levers, and a within-session correction
landing next turn). Sandbox contrast (23 pieces): `thread_1784969942592`, `thread_1784969252663`.

## Open

- **Plan outfit cap does two jobs.** Approach decided — split by plan shape. **The research the
  number was waiting on is done (2026-07-25); the implementation still waits for Stage 1.** Full
  writeup in `docs/stylist-bugfix-spec.md` ("Research done 2026-07-25 — what the capsule number
  should be"); measurement scripts `scratch/diagnose_capsule_outfit_capacity.js` and
  `scratch/diagnose_capsule_supply_vs_selection.js` (real `selectCapsuleRoster` + real per-slot
  gate, read-only, no model call). Headlines:
  - **Pass `targetOutfits` on the slots** in any capsule diagnostic — it drives
    `capsuleDemandReserve`, and omitting it makes every low-register slot read about half as
    capable as the live plan is. This already produced one wrong set of numbers.
  - Real gate-valid capacity at budget 14 is **24** distinct cores against a naive 26, so the
    original "~25 combinations presented as 8" framing is **confirmed** — the cap undersells a
    14-piece capsule by roughly 3×.
  - **The wardrobe is not thin.** At the weakest slot (`casual_city_day`) supply is 44 eligible
    tops and 35 eligible bottoms; the roster bought 2 and 2. This is entirely a
    `selectCapsuleRoster`/`capsuleQuotas` question, not a "buy more clothes" one.
  - Capacity is **non-uniform per slot** (5 cores at `casual_city_day` vs 21 at
    `smart_casual_outing`), so a bigger total alone deepens the rich slots and makes the thin one
    repeat.
  - Capsule practice presents a **rotation, not an enumeration** — 10×10 is 10 pieces/10 outfits,
    3-3-3 is 9 pieces/9 base outfits, Project 333 lists no outfits at all; the big numbers
    ("15 pieces, 50+ outfits") are capacity claims, never lookbooks. All of these are *seasonal*
    capsules, and none varies its outfit count by season — supports a season-invariant cap.
  - Recommended, unratified: capsule cap = `min(piece_budget, 12)`; trips keep the day curve.
  - **New, unfiled defect signal:** winter at budget 14 with `targetOutfits` set leaves
    `evening_out` with 4T **0B** — zero possible looks. The everyday-tier demand reserve appears
    to crowd evening-capable bottoms out of the roster. Summer does not show it. Not investigated.
- **Lossy plan overview:** `getTripPlanOverviewRows` recognises only four line patterns, so the
  piece roster, budget verdict, and `plan trimmed` notices never reach the structured summary.
- **Revised plans unfindable in the rail — investigated, not fixed.** `threadMemory` is a single
  blob overwritten each turn (`StylistChat.jsx`'s `nextThreadMemory`); the rail's
  `getThreadOutcomeSummary` only ever sees the latest snapshot, so a plan revision (a lone
  `proposed` card) genuinely erases the prior plan's outfits from what the rail can summarize.
  There is no narrow fix available without first building the plan-revision merge itself, which is
  the deliberately-unbuilt feature above — do not attempt a rail-only patch here.
- **`explorationMode: 'aggressive'` is unreachable — needs a decision.** Six trust-relaxation
  clauses in `autoStylingTrustDecision` key on `explorationMode === 'aggressive'`, and **no call
  site anywhere passes that string.** The only non-default value produced is `'adventurous'`
  (`routes/ai.js:2158`, the saved-outfit *adjacent* variant), which fails the equality check. The
  two strings have separate origins (`c307a9b` vs PR #36) and were never reconciled. So "adjacent"
  mode changes prompt text only — it does not surface experimental or needs-fit-review pieces.
  **Decision needed:** align the strings, or delete the dead branch. Depends on whether adjacent
  mode is *meant* to loosen trust.
- **The import cost gate under-quotes tagging by ~1.6×.** `routes/importer.js` prices bulk tagging
  at **6,000** input tokens per garment — but `TAG_PIECE_PROMPT` alone is **6,097 tokens** before a
  single image is attached, and the real payload is **~9,880** (text + a ~2,220-token photo +
  ~1,557 tokens of anchor thumbnails). The output figure (1,400 vs a 2,500 cap) is only wrong if
  the tagger emits near its cap — unverified without a billed call, so treat input as the solid
  number. This is the one place the app asks permission before spending, and the gap **widens as
  you correct more pieces**, because the calibration anchor block grows with your corrections.
- **`casual` blocks 108 of 236 pieces on the register ceiling — 52 are also tagged `casual`, and
  provenance settles it.** ~~Earlier I suggested letting an explicit `casual` occasion tag override
  the ceiling.~~ **Withdrawn.** Of those 52 pieces, **49 have owner-corrected `formality`** and only
  **5 have owner-corrected `occasions`** — so for 47 of them the conflicting `casual` tag is
  auto-tagger output, and the override would let the tagger overrule you. `formality` is the most
  curated field in the wardrobe (**202 of 236** pieces hand-corrected); `elevated` has not drifted.
  What's actually left is the **5 pieces you tagged both ways** — a five-row list.
  ~~Raising `casual`'s ceiling to `elevated` remains a separate taste call.~~ **Also withdrawn** —
  `docs/occasion_profiles_ratification.md` shows you **ratified `casual → everyday` on 2026-07-05**,
  with the consequence written down at the time: *"the largest behavior change… would make
  park-friend, coffee, errands, and low-key social rosters reject `elevated` and `dressy` pieces."*
  The 108-piece exclusion is the intended, documented result of a decision you already made. The
  only live question is whether a given piece's `formality` is right — a tagging question.
- **`extract-pieces` output is trusted more than the tagger's, on less evidence.** The
  "identify every garment in this outfit photo" endpoint shares the tagger's schema but sends **no
  calibration anchors, no photo-authority rules, no `style_profile_json`, and no `_confidence`
  map** — so `getFieldConfidence` defaults its fields to **`medium`**, while the real tagger
  self-reports **`low`** on ~85% of the same fields. It also has no salvage on parse failure, logs
  the entire raw model response to the server log on every call, and instructs a shoe-only
  `delicate|slim|chunky` fabric-weight scale that `fabricWeight()` cannot read (returns `null`).
  That last one is **latent, not live** — no such value is in the DB, so it is being dropped before
  persistence.
- **[bug] The singular/plural gap — six core garment keywords never fire at all.** The engine tests
  word-boundaried **singulars** (`/\bloafer\b/`) against garment names that are overwhelmingly
  **plural** ("black slip-on loafers"). Swept across all 512 keyword literals in `styling-engine/`:
  **19 keywords miss 122 garments by name**, and `jean`, `sneaker`, `loafer`, `clog`,
  `pointed heel`, `tailored trouser` and `linen short` match **zero** pieces — while being
  referenced at 16, 8, 25 and 4 sites. `boot` is used at **28 sites** and matches **one** garment;
  `shoe` matches one while 33 garments are named "…shoes".
  **This understates numbers I reported earlier**: the "93% of outfits are shoe-shape `rounded`"
  result is largely this bug — 8 of 33 shoes leave the default bucket once plurals match. Profiles
  are unaffected (their lists are already plural and go through `pieceMatchesFootwear`); this is
  confined to hard-coded regexes. **Do not apply a blanket `s?` sweep** — measured both ways, it
  fixes shoe shape (93%→53% in the default bucket) but makes grounding strategy *worse*
  (47%→80%), because the newly-matching plurals all fall into one branch. The fix has to be
  judged per classifier, and `heel_height`/`walk_support` already exist as enums for the footwear
  question. **Re-measure any keyword-derived number with `node scratch/measure_plural_gap.js`
  before acting on it.**
- **Do NOT re-tag yet — owner ruling 2026-07-26, and I had this backwards.** I originally wrote
  "re-tag first, then fix the prompt." **Withdrawn.** This wardrobe has been re-tagged multiple
  times already; each pass is only as good as the tagger on that day, and the **167 unversioned
  pieces are the residue of previous re-tags**, not evidence one is overdue. Order is: **raise the
  tagger's ceiling first, re-tag once after.** The ~$11 cost is not the constraint — spending it on
  a tagger with known gaps is.
- **What would raise the tagger's ceiling** (full detail in the map → *Provenance → what would
  raise the tagger's ceiling*), all found by this mapping:
  1. **Anchors cover 2 of the gating fields.** `tagPieceWithProvider` anchors only `formality` +
     `fabric_weight` → 18 anchors. Adding **`occasions`** would give **49**, using **38 owner
     corrections that already exist and are currently unused**. One-line change — but two caveats:
     `occasions` is an array so each combination becomes its own bucket (38 corrections → 31
     near-unique anchors, which may read as noise not range), and more anchors means more tokens on
     a call already under-quoted 1.6×. Measure before shipping.
  2. **`heel_height` (0 corrections) and `walk_support` (4) can't be anchored at all** — both feed
     the activity footwear gate, and `heel_height` is 100% tagger-set. The missing input there is
     your corrections, not prompt text.
  3. **Only 8 of 18 anchors get a thumbnail**, and which 8 is bucket-iteration order, not
     importance. Worth making deliberate before a whole-wardrobe run calibrates against them.
  4. **The singular/plural gap is upstream of tagging** — the tagger writes `name`/`reads_as` and
     every keyword rule reads them; re-tagging into an engine where `jean`/`loafer`/`sneaker` never
     match spends money feeding classifiers that can't see the result.
  5. **`extract-pieces` emits no `_confidence` map**, so pieces added that way default to `medium`
     trust and undermine any confidence baseline a re-tag establishes.

  **Prior rulings checked across `docs/` before finalising any of this** (map → *Provenance →
  prior rulings a tagger spec must respect*). The load-bearing ones: optimising the tagger is
  **already owner-sanctioned as possibly the better first move**, framed as paying off across
  *every import path*, with the video-import decision downstream of it; *"AI retagging reports what
  changed, leaves results reviewable, and cannot race Save"* is **ratified**, so capture-then-apply
  is that principle at batch scale rather than a new idea; **nothing is retagged automatically, by
  design**; **worn-photo scope is an OPEN product decision** a spec must not quietly settle; and
  **any field change costs 9 wiring points with "tagger prompts x2" first** — which settles the
  scope question, `extract-pieces` travels with `tag-piece`.

  Evidence that the current prompt *does* work when it runs: where the photo-authority section ran,
  low-confidence `length_hits_at` falls from **81% (191/236) to 42% (24/57)**. And this is not
  "missing worn photos" — **176 of 236 pieces have one**, including 144 of the 191 low-confidence
  ones. The photos exist; the older tagger never classified them.
- **A provenance section and script now exist** (`node scratch/measure_provenance.js`, plus
  `measure_provenance.js <colA> <colB>` to cross-tab two columns). `formality` is 86% hand-corrected;
  `heel_height`, `recommendation_status` and `role_permission` are **100% tagger-set**. The tagger
  reports `low` confidence on ~85% of its own structural predictions, and low confidence doesn't
  suppress the value — it ships to the image prompt tagged `[low confidence - add worn photo]`.
  **Run this before resolving any conflict between two columns**; it is what caught all three of
  the recommendations I had to withdraw.
- **[FIXED 2026-07-29] The editorial image prompt has no length clause — and "wrong length" is the top render
  complaint.** `anchorFidelityInstructions` derives every fidelity rule from `name + notes`, so:
  `length_hits_at` is populated on **207 of 236** pieces and produces **no length instruction at
  all** (the builder has no such clause); `sleeve_type` is populated on 207 and reaches 48;
  `pattern_type` on 228 and reaches 17 (stripe only — no floral/botanical clause). **49 pieces
  produce no anchor fidelity instruction whatsoever.** Meanwhile the renderer memory that gets
  appended to these prompts is *live and full of length corrections* ("prior render had … rendered
  too long"). The wardrobe knows the length, the prompt never states it, the correction arrives
  afterwards as feedback. Same shape as the Visual Composer athletic-pants incident. The
  whole-wardrobe path is fine here — `buildPieceText` carries these columns — so this is an
  asymmetry between the two prompts, and the fix is to build the editorial description from the
  same truth text. Also in that builder: it reads `selectedPiece.fabric`, **a column that does not
  exist**, so that line never renders.
  **Fixed exactly as prescribed:** columns are now the primary source in `anchorFidelityInstructions`
  (regexes kept as the fallback so no piece lost a clause), the anchor description is now
  `buildPieceText`, and the dead `selectedPiece.fabric` line is gone. Over the live wardrobe:
  **206 of 243 pieces now carry a length clause** (was 0); pieces with **no** fidelity instruction
  fell **49 → 1**. A tagged sleeve also now carries *do not cover it with a layer that would crush
  it* (bishop-sleeve incident). Separately, `trustedFieldText` now drops the tagger's
  not-applicable `none` sentinel, so the shared truth text stopped emitting `sleeve: none` on 59
  bottoms, 13 accessories and 6 shoes. The 900-char truncation below is **still open**.
- **The whole-wardrobe image prompt truncates piece truth text at 900 chars; the real median is
  1,130** — 169 of 236 pieces lose their tail, and the fields at the end of the string are
  `fit_on_body`, tuck behavior, occasions and trust status.
- **Image cost reporting has a hole, and A6 now has a factual answer.** The `~$0.07` figures are
  computed **client-side** (`StylistChat.jsx:315`), re-hard-coding the token rates and adding a
  **flat constant** for the image — `$0.08` at 1024x1536, `$0.04` at 1024x1024 — regardless of
  quality, model, or how many attempts the server made. The server's pricing table has **no image
  model in it at all**. And the editorial **`gpt-image-1` fallback renderer never sets
  `timings.usage`**, so the cost line returns null and a *billed* generation displays no cost
  whatsoever. Collage renders correctly show nothing (they are free), which is why the gap is easy
  to miss. Two small fixes: set `timings.usage` on the fallback branch, and either move pricing
  server-side or relabel "Measured cost" to reflect that the image term is an estimate.
- **A failing editorial render can attempt five billed generations.** `gpt-4o`, then the
  `gpt-image-1 → gpt-image-1.5 → gpt-image-1-mini → chatgpt-image-latest` chain, then an SVG
  placeholder. The other four image producers fall back to a free local collage after one attempt.
  Also worth deleting: a duplicate `photoPreservingVisualsEnabled` in `rules.js` that **ignores
  `WARDROBE_MOCK_AI`** — `routes/ai.js` imports that copy (never calls it, so mock protection holds
  today, but the image endpoints live in exactly that file).
- **The engine's strongest positive signals have never been switched on.** `pieces.favorite` is
  **0 of 236** and `saved_boards.favorite` (the Visual Lab's **"Use strongly"**) is **0 of 237**.
  That disables four scoring terms, including the `+45` high-authority board branch — against `18`
  for an ordinary positive board — and makes the `favorite = 1` clauses in two memory queries
  select nothing. Both controls are fully built and wired (heart on every PieceCard;
  `VisualLab.jsx:967`). **Not a code defect** — but worth knowing before concluding the memory
  system is weak, and a cheap experiment: marking a handful of boards "Use strongly" turns on the
  largest positive signal the engine has.
- **A five-outfit set cannot avoid the −45 formula-repeat penalty.** There are exactly four formula
  families for separates outfits (five archetypes, one dress-only), and two hold 82% of real
  combinations — so by the third look the selector is choosing which repeat is cheapest, not
  whether to repeat. Related: the pattern classifiers regex over piece *names* and never read the
  populated `pattern_type` column, so **30 of 90 patterned pieces read as solid** (`botanical`,
  `geometric`, `paisley`, `polka dot`, `lace` have no matching term). Fixing that would also lower
  the text-matching ratchet count.
- **Two `planWorkbenchPieceScore` weights are provably decoration** — removing the
  `role_permission` +20 gives a byte-identical top-40; removing the `trusted` +50 moves one piece
  of 40. Tested, not inferred (`scratch/measure_open_questions.js` Q3). No action needed unless the
  weights are being tuned; then start with the four that actually order it.
- Smaller: the `All looks distinct` label branch unverified (not worth a billed call).
- **Capsule coverage-first ruling implemented 2026-07-28.** The roster selector now preserves an
  actually gate-eligible elevated dress path, or an elevated top+bottom path, for every requested
  dinner/gallery/smart-casual use case after reserving casual rotation. It protects the casual
  minimum while making those swaps, stays inside the piece budget, and uses no garment IDs or
  winter exception. Winter tops remain indoor bases; reusable outerwear supplies warmth.
  `npm run test:capsule:offline` now reports 3/3 covered slots and four weakest-slot cores for the
  real 14-piece winter mixed-register case (formerly 2/3 and zero evening cores). Explicit
  restaurant dinners are tested as indoor; generic evening wording remains unchanged. Budget-10
  mixed capsules still disclose real compression gaps.
- **Capsule output contract implemented 2026-07-28.** Capsule cards are a representative rotation
  capped at `min(piece_budget, 12)`; non-capsule plans keep the existing eight-card default. The
  plan report now uses the full curated roster rather than only pieces appearing in submitted
  cards, and separately states unique gate-valid outfit-core capacity across the requested use
  cases. Capacity requires an eligible shoe, counts top+bottom and dress cores, deduplicates a core
  that serves multiple slots, and does not claim every structurally valid core is aesthetically
  equal.
- **Capsule rotation allocation implemented 2026-07-28.** After real per-slot gates run, every
  coverable use case gets one card before any use case gets multiplicity. Remaining cards go to
  the largest unmet recurring demand, with stable slot order as the tie-break, bounded by both the
  global capsule card cap and each slot's unique core capacity. Zero-capacity slots request no
  impossible submission and produce an explicit wardrobe-gap plan line.
- **Capsule representative quality implemented 2026-07-28.** Capsule submissions cannot repeat the
  same top+bottom core or dress and call it a new representative merely by changing shoes, a layer,
  or accessories. Non-capsule plans retain that flexibility. Shoe/register span stays model
  judgment, delivered in the composition workbench: use the casual/elevated shoes already reserved
  for their relevant slots and avoid unnecessary single-shoe dominance. No arbitrary shoe-count
  taste gate was added.
- **First live winter-capsule test diagnosed and fixed offline, 2026-07-28.** Preserved request log:
  `scratch/run-logs/capsule-live-2026-07-28.log` (ignored local evidence, no credentials). The run
  spent an estimated $0.5515 over ten Sonnet iterations and returned no visible capsule even though
  two cards had briefly passed. Root causes fixed with regression tests: descriptive
  `comfort-first` prose can no longer lower a structured casual slot to a lounge ceiling;
  `submit_plan_outfits` recovers a JSON-encoded outfits array; and the partial-success gap-fill path
  retains already accepted same-slot cards instead of replacing them. Console usage was present,
  while that run's DB row stored zeros because the route process predated the persistence change;
  the backend was subsequently restarted. Do not spend another live call until the provider-free
  replay remains green and Yuna explicitly approves it.
- **Successful live capsule quality follow-up implemented offline, 2026-07-28.** The screenshots
  showed generic generated titles, no transition layer in any casual card, and one shoe dominating
  a recurring use case despite another eligible capsule shoe. Model-authored titles now survive
  assembly and UI rendering. Explicit "outerwear for transitions" language requires one
  outerwear-bearing representative per coverable use case. A recurring capsule slot with at least
  two gate-eligible shoes must demonstrate two; no-op for one-look slots or one-shoe supply. This is
  representation of curated options, not a global shoe quota. Provider-free captured-ID replay:
  `scratch/replay_capsule_live_2026_07_28.js`.
- **Winter indoor capsule balance and truthful plan chips implemented 2026-07-28.** `indoor`
  remains weather-neutral: it does not pretend a heated room has outdoor-winter physics, and
  year-round sleeveless layering bases remain eligible. When the owner explicitly requests a
  winter capsule, however, the finite roster no longer spends slots on `season = warm` pieces and
  reserves a majority of sleeve-covered tops using structured `season` and `sleeve_type`. On the
  real 14-piece captured replay this changed the top roster from four sleeveless tops out of five
  to four sleeve-covered tops plus one sleeveless option, while retaining the reusable transition
  jacket. This is a capsule-roster rule only and is provably absent when winter is not requested.
  The plan header also derives its chips from the cards and request: this mixed plan now says
  `Mixed occasions` / `Winter capsule` rather than leaking the generic freeform defaults
  `Casual` / `Current season`.
- **Winter capsule layer roles implemented 2026-07-28.** At budgets of 12 or more, an explicitly
  winter capsule now shifts one top slot into outerwear and carries two structured layer jobs:
  one medium/heavy everyday cardigan for indoor wear and one everyday coat/jacket that is heavy
  or has an insulating fiber for outdoor transitions. The 14-piece allocation is therefore
  4 tops / 4 bottoms / 1 dress / 2 layers / 3 shoes. On the real wardrobe the offline replay
  selects `grey textured cardigan or fleece` plus `Black puffer coat`, instead of asking the
  spring-weight olive utility jacket to do both jobs. No-op for non-winter requests and winter
  budgets below 12. The owner corrected garment `996775` (Black puffer coat) to
  `formality: elevated` with an explicit `evening` occasion. Explicit owner occasion tags take
  precedence over stale low AI confidence, so the puffer is valid for brunch and
  restaurant-dinner transition use; it remains intentionally excluded from casual indoor cores
  by the everyday formality ceiling. Garment `996762` (grey textured cardigan or fleece) remains
  dinner-blocked because its low evening confidence is consistent with the owner's judgment.
  an outdoor transition layer should be judged by destination-occasion confidence.
- **Winter capsule outfit-level layering and deterministic notes implemented 2026-07-28.**
  A winter capsule's indoor roster may still contain a sleeveless base, but a submitted indoor
  outfit using it must now include a structured medium/heavy cardigan; a coat or puffer alone is
  not an indoor layer. This is an explicit-winter-capsule validation rule, not a general ban on
  sleeveless tops or a change to indoor weather physics. Partial recovery also maps an
  unambiguously compatible model-created `Supplement` slot back onto the original missing slot,
  so a valid cardigan correction fills the gap instead of becoming an orphaned use case. Finally,
  the UI renders `tripPlanLines` from the structured response under **Stylist's notes** even when
  the model's closing prose is terse, while deduplicating lines the prose already repeats. The
  thread receives extra bottom clearance so those notes are not hidden behind the sticky composer.
- **Capsule card cap is now presented as curation, not failure, 2026-07-28.** The ratified
  `min(piece_budget, 12)` initial rotation remains in force and no hidden billed looks are generated.
  In the UI, the internal `[plan trimmed: …]` line is rewritten as “Showing M of N requested looks
  in this 12-look representative rotation.” Each affected use case gets a **Show N more** action
  that only pre-fills a same-roster, keep-existing-looks follow-up; it does not call the model until
  the owner deliberately sends it. If future composition ever returns valid over-cap cards, retain
  them rather than silently discarding them.
- **Renamed single-outfit retries no longer render as extra recommendations, 2026-07-28.** The
  first **Show 1 more** live follow-up rejected `black knit top` for exceeding the casual register
  ceiling, then accepted a one-top substitution under a new title. Retry cleanup previously
  required title equality, so the rejected attempt remained as a second `NEEDS REVIEW` Direction
  and the UI claimed two looks. Rejections now carry same-turn retry provenance; an accepted
  proposal sharing all but one piece supersedes that attempt even if the model renames it, while
  preserving the rejection as an engine substitution note. The same log exposed a separate cost
  problem still open: one ordinary extra look took six model iterations
  (`declare → view → reject → search → view → accept → prose`), and the recovery search incorrectly
  requested `weather:"hot"` for an indoor winter-capsule follow-up. That generic composition/cost
  architecture is now bypassed for new capsule expansion actions as described below.
- **Capsule expansion is now a one-call bounded operation, implemented offline 2026-07-28.**
  Newly generated capsule cards persist the curated roster and normalized slot context that the
  initial plan already resolved. **Show another for [use case]** reuses that state through
  `/api/ai/expand-capsule`: only saved, still-active roster pieces are presented; one JSON
  composition call is made; and the ordinary deterministic plan validator accepts or visibly
  rejects it. There is no declare/search/view/propose/prose tool chain, no broad wardrobe search,
  no weather reinterpretation, and no automatic corrective call after a rejection. Contract tests
  assert both the successful one-call path and the invalid-result one-call stop. Legacy capsule
  threads lack this saved state and intentionally do not show the action; generate a fresh capsule
  after restarting the backend to test it. No live/billed call has been made for this change.
  **First live expansion exposed and fixed one response-shape flaw:** the single call correctly
  avoided all retries, but ordinary prose generation began with “Looking at…”, exhausted its
  700-token output cap, and never completed JSON. Expansion now uses provider-enforced structured
  output instead: a forced named tool on Anthropic and strict JSON Schema on OpenAI. This preserves
  the one-call/no-retry contract while making narration structurally impossible. The failed live
  attempt remains visible in the thread rather than being silently retried. The next live attempt
  returned valid structure in one call but correctly failed validation: the saved casual slot had
  one top and two bottoms, and both possible cores were already shown. Per-slot core capacity is now
  persisted; exhausted slots say **Full available rotation shown** instead of offering a billed
  action. The endpoint independently recomputes/checks capacity and returns with `providerCalls: 0`
  before contacting a model, which also protects older threads whose UI lacks the new capacity field.
- **Main capsule retry-loop reduction, step 1 was useful but falsified as a cost optimization,
  2026-07-28.** The eight-call live
  trace showed that deterministic validator rules were hidden until rejection. Every workbench slot
  now states its exact required count and complete-outfit structure before composition: top+bottom
  or dress, exactly one shoe pair, and outerwear never substituting for the top. Applicable slots
  also receive the same winter sleeveless/cardigan, transition-layer coverage, and recurring
  shoe-range requirements that validation already enforces. No gate or aesthetic rule changed; this
  is earlier disclosure of the existing contract. Planner suite and the provider-free capsule matrix
  remained green. The fresh live test made the larger problem measurable rather than solving it:
  10 provider iterations, 4 submit calls, 4 validation failures, 4,782 output tokens, 460,487
  cache-read tokens, 65,014 cache-creation tokens, and only 5 valid looks. The model avoided some
  earlier structure mistakes but split overlapping use cases, searched outside the curated roster,
  re-planned after partial success, and invented slot IDs. Keep the truthful requirements; do not
  describe them as retry-loop control.
- **Main enforced-capsule composition is now atomic behind the model-called planner, implemented
  offline 2026-07-28.** This preserves the freeform architecture ruling: the conversational model
  still decides that planning is needed and decomposes the request into slots. There is no client or
  server capsule pre-route. Once `plan_outfit_set` resolves an enforced piece budget into a fixed
  roster/workbench, the tool performs one provider-enforced structured composition call, validates
  once, and returns accepted cards plus honest gaps. It cannot re-enter `submit_plan_outfits`,
  re-call `plan_outfit_set`, or trigger generic card-delivery retries in the same turn. The nested
  call's usage is included in the existing cost diagnostics. Non-capsule plans keep the existing
  open model-workbench flow. Provider-free regression coverage proves one composition callback,
  one validation pass, and blocked submit/replan attempts; planner suite 111/111, build green, and
  the full AI contract suite remains at the known 135 pass / 7 pre-existing fail baseline. No billed
  call was made for this implementation.
- **Atomic capsule composition now sees the roster and its full garment rules, 2026-07-28.**
  Before the first live test, a screenshot from the preceding open-loop run exposed a relaxed olive
  fleece hoodie under a relaxed cashmere cardigan. Both database records already said to avoid
  another loose top, but the plan workbench's compact catalog omitted those `do_not_pair_rules`, and
  photos were available only when the open-loop model happened to call `view_pieces`. The atomic
  call now sends `buildPieceText` truth for every fixed-roster garment and attaches its 448px
  thumbnail when available. Successfully attached IDs are recorded as visually seen; no-photo
  pieces remain tag-only. `atomicCapsuleVisualPieces` is surfaced in the existing turn diagnostics.
  This deliberately spends image tokens inside the one bounded call rather than testing a cheaper
  but partially blind composer. Still no billed call made.
- **Legacy `message`-type feedback can't find its own thread or board, even when both still
  exist.** Found 2026-07-28 tracing a real Style Profile row (`wardrobe.db` id 340, a `works` /
  `Gold` entry on "dark grey gathered mini dress"). Its `target_type` is `message` (a thumbs-up on
  a chat reply, not a whole-wardrobe-outfit correction), and the rendered image is embedded as
  **inline markdown in `payload.text`**
  (`![Belted Definition](sandbox:/uploads/generated-boards/whole-wardrobe-...png)`) rather than in
  a structured `payload.board.imageUrl` field. Both `matchedFeedbackBoard` and
  `referencedThreadForFeedback` (`routes/crud.js`) only ever look at the structured fields, so they
  come up empty — even though grepping the embedded filename against `saved_boards.image_url` and
  `chat_threads.payload` found an exact match on both (board id 224 "Belted Definition", thread
  `thread_1784016944304`). The links exist; nothing extracts them. Likely affects a whole class of
  older `message`-type feedback rows saved before the app started writing structured board/thread
  references. Fix shape: extract the image filename from `payload.text` via regex (same style as
  `readableFeedbackNote`'s own markdown-stripping regex, which already parses this exact pattern
  for *display*, just discards the match instead of using it to look anything up) and match it the
  same way `matchedBoardByPieceSet` matches on piece sets. Not started.
