# Capsule work — index, live-run findings, and the plan out

Written 2026-07-30. **Start here** for anything capsule-related. This is the map and the sequence;
the detail lives in the documents linked below.

> **Current behavior — updated through merged PR #213.** Read
> [capsule-current-behaviour.md](capsule-current-behaviour.md) first. It is the canonical product
> and engine contract. This index and the linked research documents preserve how the decisions were
> reached; older hard layer, dress, shoe, statement, and card-derived quotas are historical.

## 1. How we got into this

The capsule feature was built correct-by-construction in its mechanics — global core allocation,
post-conditions, atomic composition, honest shortfall disclosure — on top of **category and colour
constants that were invented in code**, each with a plausible comment and no source. That was not
visible until someone asked where the numbers came from.

Once asked, the answers were uncomfortable:

- the ratified Style Constitution contains **zero** mentions of capsule, outerwear or quota
- a summer capsule was allotted **zero** layers, which no published framework supports
- the dress quota of 1 was silently capping the *bench*, so a stage whose entire purpose is letting
  the model choose the roster was showing it **1 of 10 eligible dresses**
- **18 colour entries across four engine lists can never match anything**, because they were written
  against a vocabulary that does not exist
- the wardrobe's colour vocabulary cannot express `coral`, so the coral maxi dress is tagged `pink`

None of this was reachable by reading the code, which is why the research documents exist. The rule
going forward: **a constant that shapes output needs a source, an owner ruling, or a measurement —
a comment explaining the reasoning is not one of those.**

## 2. The documents

**Research — what the outside world says.** New 2026-07-30, all with citations.

| document | what it settles |
|---|---|
| [capsule-current-behaviour.md](capsule-current-behaviour.md) | **Canonical current behavior.** Intake, model/engine selection flow, current hard checks, category guidance, palette contract, top/dress layering, evidence boundaries, and current comparison status. |
| [capsule-lifestyle-contract-2026-08-06.md](capsule-lifestyle-contract-2026-08-06.md) | **Current capsule contract.** Session record; real production intake; comparison-harness correction; which requirements are guidance, hard checks, or retired. |
| [capsule-real-world-rules.md](capsule-real-world-rules.md) | Historical category research across six frameworks, now corrected: the counts describe common starting shapes rather than universal validity rules. |
| [capsule-palette-rules.md](capsule-palette-rules.md) | Palette. 2–4 neutrals + 1–2 secondary + 1–2 accents; 60–70% neutral; the accent-connectivity rule; the 60/30/10 misattribution. |
| [color-taxonomy-rules.md](color-taxonomy-rules.md) | The colour model itself. Google's family/display-name split, Baymard on swatches, the dead-entry audit, the proposed family + neutrality model and migration. |

**Design and history.**

| document | what it holds |
|---|---|
| [capsule-roster-selection-spec.md](capsule-roster-selection-spec.md) | The three-stage roster-selection design (bench → model chooses → engine validates). Stage 3 is **default ON** since PR #196 (2026-07-31); `WARDROBE_MODEL_CAPSULE_ROSTER=false` turns it off. See §6 below for what that flip did and did not have behind it. |
| [capsule-step5-evaluation.md](capsule-step5-evaluation.md) | The first corrected live rerun, why it failed despite passing structural validation, the acceptance criteria and enforcement boundary for the smallest V1 correction. |
| [capsule-bench-implementation-brief.md](capsule-bench-implementation-brief.md) | Operating rules and acceptance commands for spec steps 1–2. Delegation brief. |
| [stylist-bugfix-spec.md](stylist-bugfix-spec.md) | "Research done 2026-07-25 — what the capsule number should be": the *outfit-count* axis. Solid capacity measurements; its published-practice claim cites no source. |
| [occasion_profiles_ratification.md](occasion_profiles_ratification.md) | **Authoritative for occasion behaviour.** The register ceilings (ratified 2026-07-05, a month of testing), the occasion profiles, and the amendments since. **Read before changing any ceiling, profile keyword, or slot-occasion guidance.** |
| [stylist-session-handoff.md](stylist-session-handoff.md) | Running record of owner rulings. **Read before overturning anything.** |
| [engine-behaviour-map.md](engine-behaviour-map.md) | Measured behaviour of the engine's paths, including the editorial-prompt findings. |
| [spec-archive-index.md](spec-archive-index.md) | 35 **historical** specs in `~/Downloads/spec_*.md`. The app has been redesigned several times since; most describe an architecture that no longer exists. Useful as *provenance* when live code does something no comment explains — not a design authority. |

## 3. Findings from the live run that are in no other document

From `thread_1785380251549` (2026-07-30, budget 24, 5 slots, stage 3 enabled). These came from
*observing a real run*, not from research, so they are the least reconstructible material here.

### 3a. The engine trusts model-declared slot facts that were wrong

| slot | environment declared | weather |
|---|---|---|
| At Home / Errands | indoor | `stated`, not hot |
| Weekends Out | outdoor | `isHot: true`, **heuristic** |
| City Outings / **Museums** | **outdoor** | `isHot: true`, **heuristic** |
| **Restaurants** / Social Events | **outdoor** | `isHot: true`, **heuristic** |
| Nature Walks | outdoor | `isHot: true`, **heuristic** |

Museums marked outdoor. Evening restaurants marked outdoor. Four of five slots stamped hot by
heuristic rather than from stated weather. **The two slots that most obviously need a layer are the
two labelled as not needing one.**

These feed the gate, the layer decision and the register ceiling simultaneously. Related: the slot
schema's `register` field is described as an event-weekend escalation tool — *"Omit for ordinary
slots (the occasion carries the register)"* — so the model omitted it on "Weekends Out", which
inherited a casual register from a neighbouring context.

**Status: partly fixed 2026-07-30 — the weather half.** The blanket `isHot` did not come from the
model at all; it came from the engine inferring heat from the word "summer" in the request.
`weatherProfileFromContext` now takes `seasonIsCalendarOnly`, set for a seasonal capsule, and a bare
season word no longer produces a hot profile. An explicit signal ("it's 95 here", "heatwave") still
wins, and cold is untouched.

Measured on the live plan: the hot gate had been removing **17-26 outerwear pieces from every
slot**, leaving **two of five slots unable to admit any layer**. After the fix every slot can reach
a layer and the two most indoor slots can reach both — which is what makes the outerwear quota
correction real rather than cosmetic, since the quota was buying layers the gate then discarded.

**Corrected 2026-07-30 by the owner — the occasion was not an error.** This section previously
called the model's `smart casual` choice for the restaurant slot a failure to follow schema
guidance. That was wrong, and the contradiction is inside this codebase, not in the model:

- `city_smart_casual`'s own keywords are `city, museum, shopping, **dinner**, brunch, office,
  everyday` — ceiling `elevated`.
- `evening_social`'s are `evening, dinner date, wine bar, theater, evening drinks, night out` —
  ceiling `dressy`.
- **Owner's semantics:** evening has historically been dressier than a restaurant; a restaurant
  usually reads smart casual, or maybe city.

So the model matched both the profile taxonomy and the owner's mental model. The `occasion` field
description telling it to *"map dinner/evening-restaurant/night-out use cases to 'evening'"* is what
disagrees — unratified scaffolding from PR #58, not an owner ruling, and it would have pushed the
restaurant slot to a `dressy` ceiling the owner does not want.

**Also corrected: occasion profiles do encode setting**, just not as a queryable field.
`outdoor_daytime_social` is outdoor by name; `gallery_art_event` and `home_loungewear` are indoor by
nature. A structured `climate_controlled` property would formalise what the ids and keywords already
imply rather than invent something new.

**Genuinely still open — `environment`.** Museums and evening restaurants were declared `outdoor`,
which is wrong. Its practical bite has shrunk, though: `environment: 'indoor'` mostly fed
`season: 'indoor'` to neutralise hot/cold gating, and for a seasonal capsule the
`seasonIsCalendarOnly` fix now neutralises heat anyway. What remains is its effect on winter capsule
indoor slots and on `beach_coastal` handling.

### 3b. The composer omits shoes when the roster has them

2 of 10 cards came back with no shoes, and in both cases the slot's own gate-allowed list had
plenty:

| slot | gate-allowed shoes | card |
|---|---|---|
| Restaurants / Social Events | **4** | "Tie-Front Blouse + Cream Linen Pants + Ribbed Cardigan" |
| Nature Walks | **3** | "White Tank + Tan Shorts + Navy Hoodie" |

Not supply, not the gate. **Pattern worth testing:** in both slots the *first* card had shoes and
the *second* did not. The atomic composer returns the whole rotation in one response under a prompt
that says "keep titles and reasons concise so the complete rotation fits comfortably" — consistent
with output-budget pressure, the model economising on later outfits.

**Status: fixed 2026-07-30.** `completeSubmittedPlanOutfits` fills only structural absence from
the slot's own gate-valid roster at zero provider calls, revalidating the entire rotation after
each completion so a repair cannot duplicate another card's core.

### 3c. What the run cost, and what stage 3 cost

Measured: 32,580 input / 3,726 output / 72,088 cache-read / 48,804 cache-creation ≈ **$0.358**,
against a $0.288 baseline without stage 3. The roster call is **~$0.075**, matching the pre-run
estimate of $0.075. Stage 3 fired cleanly: 1 call, 0 repairs, 0 fallbacks.

Its roster scored **71% pure-neutral against published guidance of 60–70%**, closer than the
deterministic roster's 79% — but spent 4 slots on outerwear (2 unused) and 1 on an accessory that
the composition prompt forbids, and covered **12 colour families against a recommended 5–9**.

## 4. The plan

Sequenced by dependency, not by appeal.

### Done — 2026-07-30

Accessories removed from the bench; explicit occasion tags now beat the register ceiling; summer
outerwear corrected from 0 to the season-invariant 2; quota **ceilings** added (quotas had only ever
declared floors); dress quota 1 → 2–3, which also unblocked the bench; season eligibility made
non-symmetric so a summer capsule drops cool-season cores but keeps a cool-season layer; the neutral
bonus restricted to pieces that introduce no colour; `taupe`/`oatmeal` added; roster utilization
disclosed.

### Step 1 — composition auto-complete *(complete 2026-07-30)*

When a submitted look is missing a structural piece and its slot roster can supply one, complete it
at composition time instead of rejecting it to a needs-review card. The logic already exists:
`repair-capsule-look` does exactly this at `providerCalls: 0`, using `describeOutfitStructureGap`.

On the live run this converts **7 good + 3 needs-review into 9 good + 1**, at no model cost.
Testable offline against the saved thread. Implemented as `completeSubmittedPlanOutfits`; only
structural absence is completed, and the entire rotation is revalidated after each completion.

### Step 2 — slot facts *(complete 2026-07-30)*

The weather half is fixed and the occasion half turned out not to be a defect at all — see §3a.
What was completed:

1. **The `occasion` field description was corrected** to stop routing ordinary restaurant dinners
   to `evening`; dressy night-out contexts still route to `evening_social`.
2. **Indoor-reading slot labels now override a wrong declared outdoor environment.** Explicitly
   outdoor places, walking/hiking activities, and `beach_coastal` remain outdoor. Occasion
   resolution is unchanged.
3. **The `register` guidance was corrected.** The field's own description was the
   cause: it framed `register` as an event-weekend escalation tool ("rehearsal dinner", "wedding
   ceremony") and then said to *"omit for ordinary slots"*, so the model never reached for it and a
   going-out slot inherited a stay-at-home register.

   Measured before rewriting: `register: 'elevated'` on the live "Weekends Out" slot lifts its
   roster from **7 to 11** elevated/dressy pieces (against 13 for a plain smart-casual slot), so the
   lever does work. And the per-look register **floor applies only at `dressy` and above**
   (`floorRank >= formalityRank('dressy')`) — verified empirically after a code-reading suggested
   otherwise — so `elevated` is permission without obligation, which is exactly what a going-out
   casual slot wants and what makes it safe to encourage.

   The description now says to set `register` whenever one slot reads dressier than its neighbours,
   states that `elevated` requires nothing, and states that `dressy`/`formal` require a
   dressy-or-better main piece in every look. Two tests: one on the wording, one pinning the
   floor-threshold asymmetry the wording depends on.

### Step 3 — colour taxonomy *(blocks step 4)*

Implemented 2026-07-30 from [color-taxonomy-rules.md](color-taxonomy-rules.md) §5. **The database
schema did not change** — family and neutrality are derived by lookup from the shade name. The
vocabulary, tagger, capsule-neutral logic, family similarity, and mission focal-colour list now
derive from the shared taxonomy.

The owner rulings are recorded in §6 of that document: silver is metallic; burgundy is an accent;
sage and olive are neutral-adjacent; periwinkle is dropped; and black, white, and grey remain
separate retrieval families. A *targeted* retag of garments whose colour the old vocabulary could
not express remains outstanding data work. It is not, and must not become, a wardrobe-wide retag.

### Step 4 — palette cohesion *(complete as evaluation disclosure 2026-07-30)*

Set-level breadth and accent connectivity are properties of colour *families*, so neither could be
measured before step 3. The first implementation is deliberately observational:
`describeCapsulePaletteCohesion` reports family breadth, neutral-base share, and accent-colour
pieces that the representative rotation did not demonstrate.

This is disclosure, **not a hard filter or a new generation instruction**. The `home`-gate
precedent is that hard filters on taste dimensions starve capacity, and the corrected roster has
not yet been evaluated. Step 5 supplies that evidence before any V2 scoring pressure is considered.

### Step 5 — decide stage 3 *(evaluated 2026-07-30: default-off; **flipped default-ON 2026-07-31**, see §6)*

> **Status note added 2026-08-03.** Everything in this section below describes the
> 2026-07-30 decision, when stage 3 remained default-off. It was flipped to
> default-on in PR #196 the following day. The section is kept as written because
> it is the record of *why* the answer was no at the time; §6 records the flip and
> what evidence it actually had. Do not read the "remains default-off" sentences
> below as current behaviour.

The corrected live rerun is recorded in
[capsule-step5-evaluation.md](capsule-step5-evaluation.md). Stage 3 fired, used one repair and no
fallback, and composition returned 12 valid cards. The result nevertheless met this section's
severe-failure exception: it traded the second layer for a fifth shoe, never demonstrated its only
layer, selected and did not use taupe suede ankle boots for summer, relied on one base for two
dependent tops, and cleared a binary statement-piece check without producing a convincing spread
of hero-led options. It remains default-off.

Evaluate two additional qualities in that rerun and one or two further captured capsule outputs:

- **Formula diversity:** does the rotation demonstrate meaningfully different outfit structures,
  rather than mostly substituting pieces into one repeated formula? This is not a demand for
  maximum novelty; repeating a strong formula with materially different expression can be right.
- **Roster demonstration:** do the representative looks make the capsule's reuse logic visible
  across contexts and pairings? This is not a 100% utilization target; forcing every roster piece
  into a weaker outfit would buy the metric at the expense of styling quality.

The first capture has now been reviewed and **did reveal a severe failure**. The next design step
is complete in `capsule-step5-evaluation.md`: settled allocation constraints and structural
availability remain deterministic; hero/support/grounding balance, seasonally convincing footwear
and whether selected pieces earn distinct jobs remain model judgments; post-composition disclosure
reports undemonstrated functions rather than letting a high raw utilization percentage hide them.

**The V1 correction is now implemented and awaiting owner review before the approved rerun.** It
is exactly the boundary above and nothing more:

- `layer_floor:outerwear` makes the researched layer allocation a validator floor as well as a
  ceiling. It is `validatorOnly`, so the deterministic selector is untouched; the validator's
  existing supply attribution supplies the "when the bench can supply it" condition, and
  `describeCapsuleLayerSupplyGap` discloses a genuine shortfall instead of failing forever.
- `dependent_base_unavailable` closes the roster-level loophole: a standalone base must be
  gate-valid in every slot where a `needs_base` piece is offered. Structural availability only —
  visual compatibility stays with the model.
- The roster-selection brief (used verbatim for the initial call and the bounded repair) asks for
  hero/support/grounding balance, independent wearability, seasonally credible footwear, and a
  distinct job per piece.
- The composition brief, plus a per-run clause derived from what the roster actually holds, asks
  the rotation to demonstrate its layers, dependent pieces and specialised shoes.
- `describeCapsuleUndemonstratedJobs` reports an undemonstrated category or special job with the
  utilization percentage stated beside it, so a high raw number cannot stand alone.

Palette pressure, formula optimisation, deterministic hero scoring, a blanket dependent-piece cap
and retagging remain out of scope, and none of them was added. Verified offline: the ranking A/B
against the 243-piece wardrobe reports 0 differing scenarios, and the scenario matrix, summer
replay, roster-utility audit and bench diagnostics are byte-identical to the pre-change baseline.

### First rerun under the correction — `thread_1785451253837`, 2026-07-30

**The run did not evaluate the correction, and the reason is itself a finding.** The model's roster
was rejected, repaired, rejected again, and the deterministic fallback shipped. Composition then ran
normally — the 12 looks are genuinely model-composed, three of them patched by engine
auto-completion — but they were composed from an **engine-chosen roster**, so criteria 5-7 (footwear
credibility, protagonists, dependent-top breadth), which are all judgments about *selection*, cannot
be read from this run at all. The comparison is direct: run 1074 at 14:53, before
the correction, took 1 call + 1 repair and **0** fallbacks; run 1076 at 15:43, after it, took 1 call
+ 1 repair and **1** fallback. Model roster choice is stochastic, so this is strong evidence rather
than proof.

What the run did establish:

- **Criterion 4 works on real data.** The disclosure fired as designed and named the failure that a
  raw percentage would have blurred: *19 of 24 roster pieces (79%) appear in a look, but 1 selected
  job(s) went undemonstrated — no look uses a layer.*
- **Criterion 8 did not take.** The per-run functional-demonstration clause was in the workbench,
  the olive jacket was in At Home's allowed IDs, and the composer still demonstrated no layer —
  while needing 3 engine auto-completions against 0 on the prior run. Instruction present, behaviour
  unchanged.
- **Two observability gaps, both now closed.** The validator's failure codes were discarded, so a
  fallback recorded only that it happened; and `capsuleRosterSource` was written and read by
  nothing, so the spec's stage-3 fallback disclosure — ratified, never implemented — meant an
  engine-chosen capsule presented exactly like a model-chosen one.
- **Two assumptions in `capsule-step5-evaluation.md` §2 need qualifying.** The taupe suede ankle
  boots are in the deterministic roster too and unused again, so that pick is not a model-roster
  failure; and the 10 colour families / 83% neutral result reproduced exactly, which makes it a
  property of the selector rather than of model taste. Both strengthen the case for keeping palette
  observational for now.

Corrections applied after this run (owner ruling 2026-07-30):

1. `capsule_roster_failure_codes` records which guarantees a rejection cited, so the next question
   is a query rather than another paid run.
2. Both outcomes now disclose themselves: a fallback says the engine chose the roster and why.
3. **The layer floor is coachable.** It still fails, so the model is always told and always gets its
   one correction round — but on its own it no longer spends the fallback. If the repair still
   misses it and nothing else is wrong, the model's roster ships as `model_repaired_with_gaps` with
   the unmet allocation stated. `dependent_base_unavailable` is deliberately not coachable: a piece
   that cannot form a look in a slot it was offered in is a wearability defect, not an allocation
   preference.

### Dependent-piece semantics — owner design review, 2026-07-30

Reviewing the same rerun, the owner examined the "Geometric Hero with Lace Trousers" card directly
(piece 258, `black geometric tassel hem crop top`, over piece 101, `wide leg trousers`) and made two
corrections to the initial diagnosis, then wrote a full proposed rule set for how a `needs_base`
piece should be treated as capsule arithmetic, not a convenience bundle:

- **The model did see both pieces' photos**, not just text — `atomicCapsuleVisualPieces: 24` in that
  turn's debug data. The stated `do_not_pair_rules` conflict (wide bottom vs. handkerchief volume)
  was in the model's context and it composed the pairing anyway.
- **The real friction the critique names is the lace waistband trim competing with the top's tassel
  trim** — not volume. This has no structured field to live in: piece 101 is tagged
  `pattern_complexity: solid` (lace trim isn't a print), so no `do_not_pair_rules` clause could ever
  have named it. Same shape as the pre-`needs_base` gap — a known, prose-only property.
- Logged to memory (`capsule-do-not-pair-rules-unenforced`), no code change — a single confirmed
  instance, not yet a pattern.

The rule-set proposal itself: both pieces of a dependency always count separately toward budget;
standalone and dependent top capacity must be counted separately, not folded into one "top" number;
a dependent's base must be genuinely compatible, not merely present; the base's own independent
value (strong vs. weak dependency) is a model judgment; outfit cores must require the compatible
base explicitly, not just the dependent top; cards should reveal the dependency rather than present
the dependent as standalone; reuse reporting should distinguish productive connector reuse from
forced dependency; the model decides whether a dependent earns its two-slot cost, never a
deterministic exclusion.

**Owner-scoped implementation, 2026-07-30 ("structural gaps + brief language," reuse reporting
deferred):**

1. **Capacity honesty** (`capsuleSlotCoreKeys`). A dependent top only contributes `separates:` cores
   in a slot when a standalone base also passes that slot's own gates — mirroring
   `dependent_base_unavailable`'s own definition of "available," so the two checks can never
   disagree. Confirmed real by reading the function before touching it: it previously paired every
   top against every bottom with zero `needs_base` awareness. A piece's own core-forming ability
   (can it be its own outfit's top) is governed by `needs_base` alone; a caught-by-test conflation
   briefly made it depend on opacity too — a sheer top not tagged `needs_base` still forms its own
   core, it just cannot rescue a *different* dependent's core.
2. **Standalone vs. dependent top capacity, counted separately — revised after owner review of the
   first version's overcorrection.** That version made a `needs_base` piece fail every `group: 'top'`
   condition unconditionally, which is stricter than "a dependent cannot satisfy the guarantee by
   itself": it swapped out an expressive dependent (piece 258) even when its base was genuinely
   present and usable. The corrected rule, in `capsuleConditionMatches` (now roster-aware): a
   `needs_base` piece counts toward a top-group guarantee only when a standalone base coexists in the
   SAME candidate pool — an unsupported dependent contributes nothing, a supported one is real
   dependent-top capacity. `base_for_dependent_top` is exempt, unchanged.
3. **One shared base-candidate predicate** (`isCapsuleBaseCandidate`), used everywhere "is this a
   valid base" is asked — capacity, the roster-level guarantee, slot validation, outfit validation —
   so none of them can disagree. Top category, not itself `needs_base`, and (new) not structurally
   sheer/semi_sheer/open_weave per the tagger's own definition of what "cannot work alone against
   skin as a base layer." Unknown/unset opacity (206 of 243 live pieces) stays eligible — absence of
   a tag is not evidence of unsuitability. Neckline, strap/sleeve shape, bulk, colour and visual fit
   stay model judgment.
4. **Outfit-level enforcement** (`validateSubmittedPlanOutfits`, shared by the atomic capsule
   composer and the model tool-loop `submit_plan_outfits`). A submitted look containing a `needs_base`
   top must also include a standalone top (per item 3's predicate); confirmed before implementing
   that **no such check existed anywhere** — a dependent could ship with just a bottom and shoes,
   presented as if standalone. This is the achievable form of "cards must show the base and the
   dependent, never present the dependent as standalone": adding literal `primary_top`/`layer_top`
   roles to the atomic composer's schema was considered and set aside, because the frontend does not
   render `role` distinctly anywhere today (confirmed by grep) — the visual half of that ask needs an
   actual UI change, not requested here.
5. **Brief language** (points 3/4/8 of the review): the roster-selection brief's "INDEPENDENT
   WEARABILITY" section now names concrete visual-compatibility checks (opacity, neckline,
   strap/sleeve shape, length, bulk, colour relationship, concealment intent) and the
   strong-vs-weak-dependency judgment, matching how hero/support/wearability guidance was already
   written. No deterministic score, no exclusion — model judgment, as designed.

**Ranking A/B: 0 scenarios differ — the corrected version is the no-op the V1 correction was too.**
The first implementation of item 2 was NOT `validatorOnly` like `layer_floor:outerwear`, and it
changed the deterministic path in one scenario: piece 258 (`formality: everyday`, `needs_base: yes`)
was swapped for a non-dependent, because the too-broad rule denied it credit toward a register
reserve even though its base (the orange tank) was present in the same roster. That was overcorrection,
not the intended fix — confirmed by the owner from the code, not from the observed symptom alone.
With the corrected, roster-aware "supported dependent counts" rule, 258 has its base in the roster,
counts again, and the deterministic selector's output returns to exactly the pre-correction baseline.
All four offline capsule scripts are byte-identical to baseline too.

### First clean model-roster acceptance, and a sharpened dependent-piece ruling — `thread_1785467959899`, 2026-07-30

After `ccb669d`, the next captured run was the first to genuinely succeed on the model path: **1
roster call, 0 repairs, 0 fallbacks.** Two `needs_base` tops were selected (the crop top and the
cream crochet top) and both were demonstrated over **different** bases — criterion 7's exact ask,
and the opposite of the original failing run's same-tank-twice pattern. The layer floor was met
(2/2 outerwear). The final-answer guard caught and discarded a real hallucination in the model's
closing prose (two accessory pieces, 357 and 996776, that were never part of the roster or verified
that turn) — the owner never saw that text; a safe generic replacement shipped instead, confirming
the guard works as designed.

Two further findings from reviewing the actual cards, both real, neither fixed yet:

- **A title/piece mismatch caused by auto-completion.** One card's title named "Ankle Boots"; its
  actual `piece_ids` held the navy canvas slip shoes. Root cause confirmed from the dev log: the
  model's own submission for that look had no shoe at all, `completeSubmittedPlanOutfits` filled
  the missing slot deterministically (lowest ID), and nothing reconciles a card's title/reason text
  against a piece the engine adds afterward. Logged, not fixed — see
  [[capsule-auto-completion-title-mismatch]] memory note.
- **Taupe suede ankle boots (200) unused for the third straight captured run**, this time in a
  genuinely clean model roster. Diagnosed as a seasonal-material-credibility gap (suede reads
  cool-weather; nothing structured captures that) matching `capsule-step5-evaluation.md` §2's
  original observation. Held for one more run before any brief change — see
  [[capsule-taupe-boots-seasonal-credibility-pattern]].

**Owner reassessment of the dependent-piece verdict, and a settled ruling.** Reviewing this run, the
owner revised the read on "two dependents, different bases": *"'different bases' alone does not
[justify the two-slot cost]. It passed demonstration mechanics, but may still have failed roster
judgment: it spent four roster positions on two dependent tops and two bases when standalone
alternatives could likely have produced more flexible capacity."* Sharpened verdict — criterion 3
passed structurally (bases existed), criterion 7 passed narrowly (demonstrated differently), overall
capsule citizenship remains questionable (different bases is necessary, not sufficient).

This produced a new, settled product ruling, deliberately **model-judged, not a deterministic
exclusion — "a harder rule, not a ban."** `needs_base` is not merely an extra cost the model may
justify; it is a **selection disadvantage**: default to independently wearable garments, and select
a dependent only when its distinctive contribution *clearly outweighs* the flexibility lost to its
required base — if a comparable standalone option exists among the candidates, choose it instead.
An exceptional piece can still earn inclusion; "the composer demonstrated it well" or "it used a
different base than the other dependent" does not, by itself, meet that bar.

Implemented directly in `capsuleRosterSelectionSystemPrompt`'s "INDEPENDENT WEARABILITY" section
(routes/ai.js) — the settled home for this ruling, not a generic `stylist_feedback` `owner_rule` row
(one was briefly stored as id 399, then archived once the brief itself became the authoritative
version — a floating duplicate risked drifting out of sync with the carefully-worded settled text).
No deterministic score, cap, or exclusion added — still purely a brief change, consistent with every
other "do not add" ruling in this document.

### Owner rules wired into roster selection, not just composition

**Owner: "wiring `getOwnerRuleNotes` generically into roster selection is a good idea."** Confirmed
before implementing: `buildPlanSlotWorkbench` already threads `ownerRules` (from
`getOwnerRuleNotes(8)`) into `workbenchInstructions`, reaching the **composer**. Roster
**selection** (`selectCapsuleRosterViaModel` → `chooseCapsuleRosterWithProvider` →
`capsuleRosterSelectionUserText`) never received it at all — a stored rule like "no maxi skirts at
work" could keep an unsuitable piece out of every composed look while it still spent a roster slot
the composer then had nothing to do with.

Threaded through the whole chain — `buildPlanSlotWorkbench`'s existing `ownerRules` param now also
flows into `selectCapsuleRosterViaModel`, into both the initial `chooseRoster` call and the repair
call, into `chooseCapsuleRosterWithProvider`, into `capsuleRosterSelectionUserText`. Rendered with
the same "hard requirements, not suggestions" framing `workbenchInstructions` already uses, and
placed early in the user text — before the (often long) candidate catalog — per this codebase's own
measured lesson (spec 25/26) that stored rules lose out from tail position. Strict no-op when no
rules are stored (empty array skips the block entirely).

Data-threading and prompt-only; touches nothing `selectCapsuleRoster` (deterministic) reads, so no
ranking A/B run. 3 new tests (user-text placement/no-op, both roster-selection attempts, end to end
through `buildPlanSlotWorkbench`). Capsule suite 225/225; full suite same 10 pre-existing failures.

### Deferred with reasons

- **tops:bottoms ratio.** Attempted, measured, reverted — see
  [capsule-real-world-rules.md](capsule-real-world-rules.md). It needs reserve-aware quotas, and its
  payoff is realism rather than capacity. Capacity is not the binding constraint: the engine never
  presents more than 12 looks against ~58 cores.
- **Bare `'blue'` in the neutral list.** The owner is correcting colour tags at the garment level;
  the auto-tagger's colour recognition is unreliable under varying lighting.

## 5. Standing constraints


- **The code and the ratified docs are the authority — not the spec archive.** 35 historical
  specs in `~/Downloads/spec_*.md` ([index](spec-archive-index.md)) predate several redesigns.
  Worth a look for *why* live code behaves oddly; never a reason on its own not to change
  something.
- **Occasion behaviour is ratified.** `occasion_profiles_ratification.md` holds a month of
  testing. Do not change a register ceiling, an occasion profile, or the guidance that routes a
  slot to an occasion without reading it first, and record any amendment there rather than only in
  code comments.
- Never make a billed model call without explicit owner approval.
- Do not retag the wardrobe. Fix the tagger first, then retag once, narrowly.
- Palette is a preference, not a filter.
- Read `stylist-session-handoff.md` before overturning an owner ruling; several rulings here look
  like bugs and are not.

## 6. Stage 3 default-on, and the bench width — recorded 2026-08-03

Written during an architectural coherence review of the whole capsule arc. Both
entries exist because the code and this document had drifted apart, and a reader
arriving at §4 would have concluded the opposite of what ships.

### 6a. Stage 3 is default-on, and §3's evidence checklist was not completed

`modelCapsuleRosterEnabled()` in `routes/ai.js` defaults to `true` (PR #196,
2026-07-31). Until this section was written, three places in the docs still said
default-off and nothing recorded the flip.

`capsule-step5-evaluation.md` §6 lists six pieces of evidence required before
default-on. Items 1–4 (offline proofs: the layer floor holds, the briefs state
the qualitative jobs, the composition contract asks for functional breadth, the
deterministic roster and ranking A/B are unchanged) **are satisfied** and have
permanent tests. Items 5 and 6 — *one explicitly approved rerun, reviewed
against all nine criteria* — **were not completed as written.** The nearest
record is the `thread_1785467959899` section above, which reviews criteria 3 and
7, does not walk all nine, and ends with the owner sharpening a criterion rather
than accepting the run.

This is recorded as a fact about the process, not as an argument to revert. The
flip may well be right; what was missing was any note saying it had happened.

### 6b. Bench width 40 → 70 — an open question, not a settled ruling

`capsule-roster-selection-spec.md` §"Too much supply" carries an owner ruling of
2026-07-28: `ABSOLUTE_CEILING` is 40, *"40 stays the shipped value until measured
on more than this wardrobe"*, and if 40 proves too narrow the fix is the two-tier
bench (text for a wide set, thumbnails for a top slice) **rather than raising the
image count**. Production has run `benchSize = 70` with per-piece thumbnails at
up to 800px since PR #196. That spec section was not amended and still reads 40.

**The reason for the change, from the owner (2026-08-03):** the capsules produced
at bench 40 were not good enough, and 70 was the response — compared against the
Visual Composer, which shows up to 90 pieces at 768px. That is a legitimate
motivation and it is why this is recorded as an open question rather than a
regression.

**What the free measurements since then established** (all reproducible with
`scratch/compare_capsule_rosters.js --bench-size N`, no model calls):

- The bench's *composition* was the larger defect. `capsuleVersatilityScore`
  ordered the bench globally across categories, and it ranks dresses at median
  116 of 160 eligible and shoes at 113, against tops at 84 — a fair comparator
  within a category, close to meaningless across them. Widening 40 → 70 bought
  15 tops, 8 bottoms and **zero** dresses, and left hero-capable representation
  at 10 of 46.
- That is now fixed (per-category targets, filled most-starved-first). At the
  same width and the same image cost, dresses went 3 → 6 and shoes 9 → 14.
- Width still buys something real *after* the fix, and it is concentrated in
  footwear: dressy-capable shoes on the bench are 2 of 18 at benchSize 40 and
  5 of 18 at 70. Given that "sneakers carried almost every context and the brown
  wedges were the sole elevated option" is a recorded live failure, this is not
  a cosmetic difference.
- Cost, measured on the live wardrobe: roughly 22k image tokens at 40 against
  38k at 70, per roster call.

**Open.** The next captured capsule run is the evidence that settles it, because
everything above measures what the model can *see*, not what it *chooses*. Until
then neither 40 nor 70 should be described as ratified, and the spec's two-tier
alternative remains untried.

### 6c. The dress requirement is presence, not register — owner ruling 2026-08-05

The roster validator required **one dress clearing the plan's strictest register
ceiling**. For a capsule whose most casual slot is `casual`, that means a dress
wearable on the most casual days. Owner ruling: *"the summer capsule should have
at least one dress, but no one said that it has to be casual."*

The requirement was two rules fused into one. Presence — a capsule of this size
holds a dress, because a dress is a complete outfit core and that is capacity
separates cannot replace — is right and stays, now as `dress_presence`. The
register half is dropped.

**Where the register half came from.** It rode along on the register reserve,
which exists for coverage: the measured 2026-07-14 failure was an all-elevated
roster where *"casual-occasion slots got zero outfits because only shoes cleared
the ceiling — no top/bottom/dress did."* The `top` and `bottom` reserves are what
actually fix that — a reserved everyday top plus a reserved everyday bottom forms
a casual core, and `capsuleSlotCoreKeys` builds cores from top+bottom **or**
dress. A casual dress was never load-bearing for coverage. Those two reserves are
untouched.

**What it cost.** Both recorded stage-3 fallbacks
(`thread_1785711580188`, `thread_1785883879348`) died on this rule —
*"roster has 0 dress(s) — needs 1 dress(s) clearing the everyday ceiling the
plan's lowest-register slots need"* — each discarding an otherwise sound
24-piece model selection for the engine's. That is the single reason those runs
could not evaluate criteria 5 and 7, and therefore the reason Step 5 has stayed
open.

**Blast radius, measured.** Ranking A/B: one scenario differs and the roster
itself is byte-identical — the winter capsule simply stops carrying a disclosed
`register_reserve:dress` gap it could never satisfy, because its two dresses are
elevated. Nothing about which pieces get chosen moved.

The roster brief was corrected in the same change: it had been telling the model
"at least one that is genuinely wearable in the plan's most casual use cases,"
which overstated the requirement. A brief that overstates a rule is the same
defect as one that hides it.
